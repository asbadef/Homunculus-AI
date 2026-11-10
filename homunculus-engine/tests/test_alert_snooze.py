# tests/test_alert_snooze.py
"""G2-B5b «Ertele» (spec 2026-11-10-g2b-b5b-ertele-design.md): snoozing an alarm on the live system.

Owner D1: critical never; high at most 30 minutes; moderate at most 120; low and info none; a reason from a fixed
list, OTHER with at least 15 characters; anyone with `alerts.ack`, never a device. A snooze is a trail row first and
the store's second, rides the card's alert as `snooze`, keeps the alarm from escalating, and at its `until` gives the
alarm a fresh escalation clock and a cleared page. An acknowledgement, the episode's end, a discharge and the same
alarm worse (plan note 1) end it; it rides no X13 chain; a restart replays it. Synthetic patients and values only."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.api.app as app_module
import homunculus.scenarios
from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import sync_alerts
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.board import patient_board
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import InMemoryIdentityStore
from homunculus.api.rehydrate import rehydrate
from homunculus.api.snooze import (
    OTHER_MIN_CHARS, REASON_TEXT_MAX, SNOOZE_CAPS, SNOOZE_REASONS, clean_reason, minutes_ok, snooze_cap, worse,
)
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.scenarios.loader import load_scenario


# --- the owner's rules (api/snooze.py) -------------------------------------------------------------------

def test_the_caps_are_the_owners():
    assert SNOOZE_CAPS == {"high": 30, "moderate": 120}
    assert snooze_cap("high") == 30 and snooze_cap("moderate") == 120
    for severity in ("critical", "low", "info", "unheard_of", None, 7):
        assert snooze_cap(severity) is None, severity


def test_minutes_must_be_a_whole_number_within_the_cap():
    assert minutes_ok("high", 1) and minutes_ok("high", 30) and minutes_ok("moderate", 120)
    for bad in (0, -5, 31, 30.0, 15.5, "15", True, None, [15]):
        assert not minutes_ok("high", bad), bad
    assert not minutes_ok("moderate", 121)
    for severity in ("critical", "low", "info"):
        assert not minutes_ok(severity, 1), severity


def test_the_reasons_are_the_fixed_list():
    assert SNOOZE_REASONS == {"CLINICAL_DECISION_MADE", "ARTEFACT_OR_SIGNAL_NOISE", "PROCEDURE_IN_PROGRESS",
                              "PATIENT_BASELINE", "OTHER"}
    for reason in SNOOZE_REASONS - {"OTHER"}:
        assert clean_reason(reason, None) == (reason, None)
        assert clean_reason(reason, "   ") == (reason, None), "a blank text is no text"
        assert clean_reason(reason, "  kısa not ") == (reason, "kısa not")
    for bad in ("other", "", None, 3, "SNOOZE"):
        assert clean_reason(bad, None) is None, bad


def test_other_needs_at_least_15_characters_and_no_text_is_over_500():
    assert OTHER_MIN_CHARS == 15 and REASON_TEXT_MAX == 500
    assert clean_reason("OTHER", None) is None
    assert clean_reason("OTHER", "  " + "a" * 14 + "  ") is None, "counted once trimmed"
    assert clean_reason("OTHER", "a" * 15) == ("OTHER", "a" * 15)
    assert clean_reason("OTHER", "a" * 500) == ("OTHER", "a" * 500)
    assert clean_reason("OTHER", "a" * 501) is None
    assert clean_reason("PATIENT_BASELINE", "a" * 501) is None
    assert clean_reason("PATIENT_BASELINE", {"t": "x"}) is None, "a text that is not a string"


def test_worse_ranks_the_engines_severities():
    assert worse("high", "moderate") and worse("critical", "high") and worse("moderate", "low")
    assert not worse("high", "high") and not worse("moderate", "high")
    assert worse("unheard_of", "high"), "a severity this build does not know may be the worst"


# --- the store (api/ackstore.py) -------------------------------------------------------------------------

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
KEY = ("p", "k")


def _snoozed(store, minutes=15, at=NOW, severity="high", reason="ARTEFACT_OR_SIGNAL_NOISE", text=None):
    return store.snooze("p", "k", by="hem.leyla", at=at, minutes=minutes, reason=reason, reason_text=text,
                        severity=severity)


def test_a_snooze_is_kept_with_its_until_and_takes_the_alarm_out_of_the_escalated_set():
    store = AckStore()
    store.first_seen[KEY] = store.clock_from[KEY] = NOW - timedelta(minutes=10)
    store.escalated.add(KEY)
    store.paged.add(KEY)
    entry = _snoozed(store)
    assert entry == {"by": "hem.leyla", "at": NOW, "until": NOW + timedelta(minutes=15), "minutes": 15,
                     "reason": "ARTEFACT_OR_SIGNAL_NOISE", "reason_text": None, "severity": "high"}
    assert store.snoozes[KEY] is entry
    assert KEY not in store.escalated, "no escalation while snoozed"
    assert KEY in store.paged, "the doctor's page stays sent"


def test_snoozing_again_replaces_the_snooze():
    store = AckStore()
    _snoozed(store, minutes=30)
    _snoozed(store, minutes=5, at=NOW + timedelta(minutes=2))
    assert store.snoozes[KEY]["until"] == NOW + timedelta(minutes=7)
    assert store.snoozes[KEY]["minutes"] == 5


def test_at_until_the_snooze_ends_with_a_fresh_clock_and_a_cleared_page():
    store = AckStore()
    store.first_seen[KEY] = store.clock_from[KEY] = NOW - timedelta(minutes=10)
    store.paged.add(KEY)
    _snoozed(store, minutes=15)
    assert store.expire_snoozes(NOW + timedelta(minutes=14, seconds=59)) == []
    assert KEY in store.snoozes
    assert store.expire_snoozes(NOW + timedelta(minutes=15)) == [KEY]
    assert store.snoozes == {}
    assert store.clock_from[KEY] == NOW + timedelta(minutes=15), "the clock starts again from until"
    assert KEY not in store.paged, "and the page is cleared: silence after it may page the doctor again"
    assert store.first_seen[KEY] == NOW - timedelta(minutes=10), "the episode is the same one"


def test_an_acknowledgement_ends_the_snooze():
    store = AckStore()
    _snoozed(store)
    store.acknowledge("p", "k", "hem.leyla", NOW)
    assert store.snoozes == {}


def test_prune_ends_the_snooze_with_its_episode_and_no_chain_carries_it():
    store = AckStore()
    store.stamp_first_seen("p", "k", NOW - timedelta(minutes=3), chain_gap=timedelta(minutes=5))
    _snoozed(store)
    store.prune(live_keys={KEY})
    assert KEY in store.snoozes, "the episode is still on the board"
    store.prune(live_keys=set(), now=NOW + timedelta(minutes=1))
    assert store.snoozes == {}
    assert KEY in store.recent, "the episode ended unanswered: its X13 chain is kept"
    assert store.stamp_first_seen("p", "k", NOW + timedelta(minutes=2), chain_gap=timedelta(minutes=5))
    assert store.snoozes == {}, "a return is a new alarm, and sounds: no snooze rides the chain"
    assert store.clock_from[KEY] == NOW - timedelta(minutes=3), "the chain's own clock goes on (plan note 2)"


def test_a_discharge_ends_the_snooze():
    store = AckStore()
    _snoozed(store)
    store.snooze("q", "k", by="u", at=NOW, minutes=5, reason="PATIENT_BASELINE", reason_text=None,
                 severity="moderate")
    store.forget_patient("p")
    assert set(store.snoozes) == {("q", "k")}


def test_a_clock_stepped_back_ends_the_snooze_now_with_a_fresh_clock_and_a_cleared_page():
    """Review (fix 2): a snooze taken «later» than the clock now reads, or one that would still run longer than its
    cap from now, cannot be held to the owner's cap. It ends at once, by the expiry path, with the clock from now."""
    store = AckStore()
    store.first_seen[KEY] = store.clock_from[KEY] = NOW - timedelta(minutes=10)
    store.paged.add(KEY)
    _snoozed(store, minutes=15)                                     # at NOW, until NOW+15
    stepped_back = NOW - timedelta(hours=1)
    assert store.expire_snoozes(stepped_back) == [KEY]
    assert store.snoozes == {} and KEY not in store.paged
    assert store.clock_from[KEY] == stepped_back, "the clock starts from now: until is an hour and a quarter away"
    # a snooze whose until lies further than its cap from now (minutes past the cap, written by no door)
    store.paged.add(KEY)
    _snoozed(store, minutes=60, severity="high")                    # at NOW, until NOW+60; a high's cap is 30
    assert store.expire_snoozes(NOW + timedelta(minutes=1)) == [KEY]
    assert store.clock_from[KEY] == NOW + timedelta(minutes=1) and KEY not in store.paged
    # within its cap, and taken before now: it runs on
    _snoozed(store, minutes=30, severity="high")
    assert store.expire_snoozes(NOW) == [] and KEY in store.snoozes


# --- the card, and the same alarm worse (an Engine, as a door drives it) -----------------------------------
#
# Heart rate 115 and temperature 39.5 score 2 NEWS2 points each. A respiratory rate of 26 adds 3 (NEWS2 7, a HIGH,
# immediate `news2`); one of 22 adds 2 (NEWS2 6, MODERATE). Made-up values on a synthetic bed.

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
NEWS2 = ("bed-3", "news2")


def _measure(engine, store, rr, at):
    for code, value in ((SignalCode.HEART_RATE, 115.0), (SignalCode.TEMPERATURE, 39.5),
                        (SignalCode.RESP_RATE, float(rr))):
        engine.ingest(Observation("bed-3", code, value, "", at, "mon"), now=at)
    sync_alerts(engine, store, "bed-3", at)


def _news2_engine(rr):
    engine, store = Engine(), AckStore()
    _measure(engine, store, rr, T0)
    store.stamp_first_seen("bed-3", "news2", T0)
    return engine, store


def _card_alert(engine, store, kind="news2"):
    return next(a for a in patient_board(engine, "bed-3", store, now=T0)["alerts"] if a["kind"] == kind)


def test_the_card_carries_the_snooze_and_none_without_one():
    engine, store = _news2_engine(rr=26)
    assert _card_alert(engine, store)["snooze"] is None
    store.snooze("bed-3", "news2", by="hem.leyla", at=T0, minutes=15, reason="OTHER",
                 reason_text="Hasta yıkanıyor, prob çıktı", severity="high")
    assert _card_alert(engine, store)["snooze"] == {
        "by": "hem.leyla", "at": T0.isoformat(), "until": (T0 + timedelta(minutes=15)).isoformat(), "minutes": 15,
        "reason": "OTHER", "reason_text": "Hasta yıkanıyor, prob çıktı"}


def test_a_latched_alert_on_the_card_has_no_snooze():
    engine, store = _news2_engine(rr=26)
    shock = Alert(patient_id="bed-3", kind="septic_shock", severity="critical", urgency="immediate", summary="",
                  clinical_reasoning="", supporting_evidence=[], recommended_actions=[], confidence="")
    store.resolved[("bed-3", "septic_shock")] = {"alert": asdict(shock), "resolved_at": T0, "first_seen": T0}
    latched = _card_alert(engine, store, "septic_shock")
    assert latched["resolved_at"] is not None and latched["snooze"] is None


def test_the_same_alarm_worse_ends_its_snooze():
    engine, store = _news2_engine(rr=22)
    assert store.firing[NEWS2].severity == "moderate"
    store.snooze("bed-3", "news2", by="u", at=T0, minutes=120, reason="PATIENT_BASELINE", reason_text=None,
                 severity="moderate")
    _measure(engine, store, 22, T0 + timedelta(minutes=1))
    assert NEWS2 in store.snoozes, "the same severity: the snooze stands"
    _measure(engine, store, 26, T0 + timedelta(minutes=2))
    assert store.firing[NEWS2].severity == "high"
    assert NEWS2 not in store.snoozes, "a worse alarm is not the one a person snoozed (plan note 1)"
    assert store.clock_from[NEWS2] == T0, "and it waits as if never snoozed: its clock is its own"


def test_a_milder_alarm_keeps_its_snooze():
    engine, store = _news2_engine(rr=26)
    store.snooze("bed-3", "news2", by="u", at=T0, minutes=30, reason="PATIENT_BASELINE", reason_text=None,
                 severity="high")
    _measure(engine, store, 22, T0 + timedelta(minutes=1))
    assert store.firing[NEWS2].severity == "moderate"
    assert NEWS2 in store.snoozes


# --- the door: POST /alerts/snooze -----------------------------------------------------------------------

SCEN = Path(homunculus.scenarios.__file__).parent
START = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
WALL0 = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)
REASON_RULE = "erteleme gerekçesi listeden olmalı; «Diğer» için açıklama 15–500 karakter"
MINUTES_RULE = "erteleme süresi bu alarm için izin verilen aralıkta değil"
SEVERITY_CHANGED = "alarmın önemi değişti; ertelemeyi yeniden seçin"
SEEN_RULE = "geçersiz seen_severity"

DEVICE = {"Authorization": "Bearer tok"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
DEVICE_H2 = {"Authorization": "Bearer tok2"}
NURSE_H2 = {"Authorization": "Bearer nurse-h2-jwt"}
CHARGE = {"Authorization": "Bearer charge-jwt"}
PEOPLE = {
    "charge-jwt": Caller(hospital="h1", actor="hem.sorumlu", groups=("nurse",),
                         perms=frozenset({"board.view", "alerts.ack", "clinical.chart"})),
    "nurse-jwt": Caller(hospital="h1", actor="hem.leyla", groups=("nurse",),
                        perms=frozenset({"board.view", "alerts.ack"})),
    "viewer-jwt": Caller(hospital="h1", actor="izleyici", groups=("viewer",), perms=frozenset({"board.view"})),
    "nurse-h2-jwt": Caller(hospital="h2", actor="hem.sona", groups=("nurse",),
                           perms=frozenset({"board.view", "alerts.ack"})),
}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


class _Wall(datetime):
    """The doors' wall clock, set by the test: a snooze's `until`, and the escalation clock, are wall time."""
    at = WALL0

    @classmethod
    def now(cls, tz=None):
        return cls.at


@pytest.fixture
def wall(monkeypatch):
    _Wall.at = WALL0                  # a test that failed half-way must not leak its time
    monkeypatch.setattr(app_module, "datetime", _Wall)
    return _Wall


@pytest.fixture
def audit():
    return InMemoryAuditLog()


def _app(audit):
    return create_app({"tok": "h1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False, audit=audit,
                      resolve_jwt=_resolve)


def _reading(client, code, value, minute=0, patient="bed-3", headers=DEVICE, at=None):
    fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"},
            "effectiveDateTime": (at or START + timedelta(minutes=minute)).isoformat(),
            "valueQuantity": {"value": value, "unit": ""}}
    assert client.post("/ingest", json=fhir, headers=headers).status_code == 200


def _vitals(client, rr, minute=0, headers=DEVICE):
    """HR 115, temperature 39.5 and respiratory rate `rr` on bed-3: RR 26 a HIGH `news2`, RR 22 a MODERATE one."""
    for code, value in (("heart_rate", 115), ("temperature", 39.5), ("resp_rate", rr)):
        _reading(client, code, value, minute, headers=headers)


def _drive_shock(client):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        assert client.post("/ingest", json=fhir, headers=DEVICE).status_code == 200


_ABSENT = object()


def _snooze(client, minutes=15, reason="ARTEFACT_OR_SIGNAL_NOISE", text=None, kind="news2", headers=NURSE,
            patient="bed-3", seen=_ABSENT):
    body = {"patient_id": patient, "kind": kind, "minutes": minutes, "reason": reason}
    if text is not None:
        body["reason_text"] = text
    if seen is not _ABSENT:
        body["seen_severity"] = seen
    return client.post("/alerts/snooze", json=body, headers=headers)


def _alerts(client, patient="bed-3"):
    board = client.get("/patients", headers=DEVICE).json()["patients"]
    return {a["kind"]: a for b in board if b["patient_id"] == patient for a in b["alerts"]}


def _on(response, kind="news2"):
    return next(a for a in response.json()["alerts"] if a["kind"] == kind)


def _rows(audit):
    return audit.records(tenant="h1", event_type="alert_snooze", limit=10_000)


def _store(app):
    return app.state.ack_stores["h1"]


def test_a_snooze_puts_the_snooze_on_the_card_and_one_row_in_the_trail(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)                                      # NEWS2 7: a HIGH news2
        wall.at = WALL0 + timedelta(minutes=1)
        r = _snooze(client, minutes=15)
        assert r.status_code == 200, r.text
        snooze = _on(r)["snooze"]
        assert snooze == {"by": "hem.leyla", "at": (WALL0 + timedelta(minutes=1)).isoformat(),
                          "until": (WALL0 + timedelta(minutes=16)).isoformat(), "minutes": 15,
                          "reason": "ARTEFACT_OR_SIGNAL_NOISE", "reason_text": None}
        assert _alerts(client)["news2"]["snooze"] == snooze, "the board carries the same snooze"
        [row] = _rows(audit)
        assert (row.patient_id, row.subject) == NEWS2
        assert row.payload == {"role": "hem.leyla", "via": "user", "actor": "hem.leyla", "groups": ["nurse"],
                               "minutes": 15, "until": snooze["until"], "reason": "ARTEFACT_OR_SIGNAL_NOISE",
                               "severity": "high", "at": snooze["at"]}, "the severity it was given at (fix 4)"


def test_who_may_snooze(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)
        r = _snooze(client, headers=VIEWER)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: alerts.ack")
        r = _snooze(client, headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (403, "alarmı bir kişi erteler")
        assert _snooze(client, headers={}).status_code == 401
        assert _rows(audit) == []


def test_the_owners_caps_hold(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)                                      # HIGH: at most 30 minutes
        for minutes in (0, -1, 31, "15", 15.5, True, None):
            r = _snooze(client, minutes=minutes)
            assert (r.status_code, r.json()["detail"]) == (422, MINUTES_RULE), minutes
        assert _rows(audit) == []
        assert _snooze(client, minutes=30).status_code == 200
        _vitals(client, rr=22, minute=1)                            # the same alarm MODERATE: at most 120
        assert _alerts(client)["news2"]["severity"] == "moderate"
        assert _snooze(client, minutes=121).status_code == 422
        r = _snooze(client, minutes=120)
        assert r.status_code == 200, r.text
        assert _on(r)["snooze"]["minutes"] == 120


def test_a_critical_alarm_is_never_snoozed_firing_or_latched(audit):
    with TestClient(_app(audit)) as client:
        _drive_shock(client)
        r = _snooze(client, kind="septic_shock", minutes=5)
        assert (r.status_code, r.json()["detail"]) == (409, "snooze_not_allowed")
        assert _snooze(client, kind="sepsis", minutes=30).status_code == 200, "a HIGH alarm that is not immediate may be"
        _reading(client, "lactate", 1.5, minute=61)                 # back under 2: the shock latches, unacknowledged
        assert _alerts(client)["septic_shock"]["resolved_at"] is not None
        assert _alerts(client)["septic_shock"]["snooze"] is None
        r = _snooze(client, kind="septic_shock", minutes=5)
        assert (r.status_code, r.json()["detail"]) == (409, "snooze_not_allowed")
        assert [row.subject for row in _rows(audit)] == ["sepsis"]


def test_the_reason_is_from_the_list_and_other_is_explained(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)
        for reason, text in (("NOPE", None), ("OTHER", None), ("OTHER", "a" * 14), ("OTHER", "a" * 501),
                             ("PATIENT_BASELINE", "a" * 501)):
            r = _snooze(client, reason=reason, text=text)
            assert (r.status_code, r.json()["detail"]) == (422, REASON_RULE), (reason, text)
        assert _rows(audit) == []
        r = _snooze(client, reason="OTHER", text="  Hasta yıkanıyor, prob çıktı  ")
        assert r.status_code == 200, r.text
        assert _on(r)["snooze"]["reason_text"] == "Hasta yıkanıyor, prob çıktı"
        assert _rows(audit)[0].payload["reason_text"] == "Hasta yıkanıyor, prob çıktı"


def test_an_unknown_alarm_is_404_and_an_answered_one_409(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)
        r = _snooze(client, kind="no_such_kind")
        assert (r.status_code, r.json()["detail"]) == (404, "no such active alert")
        assert _snooze(client, patient="bed-9").status_code == 404
        ack = client.post("/ack", json={"patient_id": "bed-3", "kind": "news2", "role": "nurse"}, headers=DEVICE)
        assert ack.status_code == 200
        r = _snooze(client)
        assert (r.status_code, r.json()["detail"]) == (409, "alarm zaten yanıtlandı; ertelenmez")
        assert _rows(audit) == []


def test_snoozing_again_replaces_the_snooze_with_its_own_until(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)
        assert _snooze(client, minutes=30).status_code == 200
        wall.at = WALL0 + timedelta(minutes=3)
        r = _snooze(client, minutes=5, reason="CLINICAL_DECISION_MADE")
        assert r.status_code == 200, r.text
        assert _on(r)["snooze"]["until"] == (WALL0 + timedelta(minutes=8)).isoformat()
        assert _on(r)["snooze"]["reason"] == "CLINICAL_DECISION_MADE"
        assert len(_rows(audit)) == 2, "each snooze is its own row"


def test_an_acknowledgement_ends_the_snooze(wall, audit):
    app = _app(audit)
    with TestClient(app) as client:
        _vitals(client, rr=26)
        assert _snooze(client).status_code == 200
        r = client.post("/ack", json={"patient_id": "bed-3", "kind": "news2"}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _on(r)["acknowledged"] is True and _on(r)["snooze"] is None
        assert _store(app).snoozes == {}


class _TimesOut(InMemoryAuditLog):
    """An audit whose append of `fail_on` raises once: the database timing out mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit timed out")
        return super().append(event)


def test_a_snooze_whose_audit_row_fails_is_a_500_and_leaves_no_snooze_and_the_retry_is_the_snooze(wall):
    """The trail before memory, as `/ack`. Applied first, a failed snooze would silence an alarm while the trail held
    nothing, and a restart would silently un-snooze it."""
    audit = _TimesOut()
    app = _app(audit)
    with TestClient(app, raise_server_exceptions=False) as client:
        _vitals(client, rr=26)
        audit.fail_on = "alert_snooze"
        assert _snooze(client).status_code == 500
        assert _store(app).snoozes == {}
        assert _alerts(client)["news2"]["snooze"] is None
        assert _rows(audit) == []
        r = _snooze(client)
        assert r.status_code == 200, r.text
        assert len(_rows(audit)) == 1
        assert _alerts(client)["news2"]["snooze"]["minutes"] == 15


def test_a_snooze_chosen_on_a_severity_the_alarm_no_longer_has_is_refused_and_writes_nothing(wall, audit):
    """Review (item 7): the dialog opened on a MODERATE news2, a frame made it HIGH, and the nurse chose. Taken at
    HIGH, the snooze would never end by «worse» (plan note 1): a decision made on a moderate alarm would silence a
    high, immediate one. The dialog says what it showed (`seen_severity`); a mismatch is refused, before the
    minutes, and nothing is written."""
    app = _app(audit)
    with TestClient(app) as client:
        _vitals(client, rr=26)                                      # HIGH now
        r = _snooze(client, minutes=30, seen="moderate")
        assert (r.status_code, r.json()["detail"]) == (409, SEVERITY_CHANGED)
        r = _snooze(client, minutes=120, seen="moderate")
        assert (r.status_code, r.json()["detail"]) == (409, SEVERITY_CHANGED), "judged before the minutes"
        assert _rows(audit) == [] and _store(app).snoozes == {}
        assert _alerts(client)["news2"]["snooze"] is None
        r = _snooze(client, minutes=30, seen="high")
        assert r.status_code == 200, r.text
        assert _on(r)["snooze"]["minutes"] == 30 and _rows(audit)[0].payload["severity"] == "high"
        _vitals(client, rr=22, minute=1)                            # MODERATE now
        r = _snooze(client, minutes=120, seen="moderate")
        assert r.status_code == 200, r.text
        assert len(_rows(audit)) == 2


def test_a_malformed_body_is_400(wall, audit):
    """Review (fix 5): a patient or a kind that is not a non-blank string is the caller's error, as at `/ack`."""
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)
        for body, detail in (({"kind": "news2"}, "geçersiz patient_id"),
                             ({"patient_id": 5, "kind": "news2"}, "geçersiz patient_id"),
                             ({"patient_id": "  ", "kind": "news2"}, "geçersiz patient_id"),
                             ({"patient_id": "bed-3"}, "geçersiz kind"),
                             ({"patient_id": "bed-3", "kind": ["news2"]}, "geçersiz kind")):
            r = client.post("/alerts/snooze", json={"minutes": 15, "reason": "PATIENT_BASELINE"} | body,
                            headers=NURSE)
            assert (r.status_code, r.json()["detail"]) == (400, detail), body
        assert _rows(audit) == []


def test_a_low_news2_is_never_snoozed_and_the_minutes_are_judged_after_the_severity(wall, audit):
    """Review (fix 5): a NEWS2 whose every scoring vital sits in the patient's charted baseline is LOW
    (chronic-expected): it makes no sound, and there is nothing to snooze. The severity is judged before the
    minutes, so a low or a critical alarm answers 409 whatever minutes were asked for."""
    baselines = {"heart_rate": {"low": 110, "high": 120}, "temperature": {"low": 39, "high": 40},
                 "resp_rate": {"low": 24, "high": 28}}
    with TestClient(_app(audit)) as client:
        r = client.put("/clinical/bed-3/profile", json={"baselines": baselines}, headers=DEVICE)
        assert r.status_code == 200, r.text
        _vitals(client, rr=26)
        assert _alerts(client)["news2"]["severity"] == "low"
        for minutes in (15, 0, 500):
            r = _snooze(client, minutes=minutes)
            assert (r.status_code, r.json()["detail"]) == (409, "snooze_not_allowed"), minutes
        _drive_shock(client)
        r = _snooze(client, kind="septic_shock", minutes=0)
        assert (r.status_code, r.json()["detail"]) == (409, "snooze_not_allowed")
        assert _rows(audit) == []


async def test_a_chain_of_snoozes_is_the_owners_rule_each_named_capped_and_in_the_trail(wall, audit):
    """A re-snooze replaces the running snooze (spec §2, the owner's «mevcut kurallar»): three 30-minute snoozes in
    a row keep a HIGH, immediate alarm from escalating for 90 minutes. Pinned, not a gap: each is a person's named,
    capped decision with its own trail row, and an acknowledgement already silences an alarm for good."""
    app = _app(audit)
    client = TestClient(app)
    _vitals(client, rr=26)
    store = _store(app)
    for i in range(3):
        wall.at = WALL0 + timedelta(minutes=30 * i)
        assert _snooze(client, minutes=30, reason="CLINICAL_DECISION_MADE").status_code == 200
        for minute in range(0, 30, 5):
            await app.state.escalation_cycle(WALL0 + timedelta(minutes=30 * i + minute, seconds=59))
            assert NEWS2 not in store.escalated
    assert _escalations(audit) == [] and len(_rows(audit)) == 3


def test_seen_severity_is_high_or_moderate_or_absent(wall, audit):
    """Review (item 7): any other value is a 422, judged with the body before the patient's scope; absent — or
    null — the door behaves as before the field existed."""
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=26)
        for bad in ("critical", "low", "info", "HIGH", "", 7, True, ["high"], {"s": "high"}):
            r = _snooze(client, seen=bad)
            assert (r.status_code, r.json()["detail"]) == (422, SEEN_RULE), bad
        r = _snooze(client, seen="moderate", patient="bed-9")
        assert r.status_code == 404, "a well-formed field reaches the patient's checks"
        assert _rows(audit) == []
        assert _snooze(client, seen=None).status_code == 200
        assert _snooze(client).status_code == 200
        assert len(_rows(audit)) == 2


# --- the escalation cycle --------------------------------------------------------------------------------

def _escalations(audit):
    return audit.records(tenant="h1", event_type="escalation", limit=10_000)


async def test_no_escalation_while_snoozed_then_a_fresh_clock_from_until(wall, audit):
    app = _app(audit)
    client = TestClient(app)
    _vitals(client, rr=26)                                          # a HIGH, immediate news2 first seen at WALL0
    wall.at = WALL0 + timedelta(minutes=1)
    assert _snooze(client, minutes=15).status_code == 200           # until WALL0+16
    store = _store(app)
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))
    assert NEWS2 not in store.escalated, "past the delay, but snoozed"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=15, seconds=59))
    assert NEWS2 not in store.escalated and NEWS2 in store.snoozes
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=16))
    assert NEWS2 not in store.snoozes, "its time came"
    assert store.clock_from[NEWS2] == WALL0 + timedelta(minutes=16), "the clock starts again from until"
    assert NEWS2 not in store.escalated, "and has only just started"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=20, seconds=59))
    assert NEWS2 not in store.escalated
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=21))
    assert NEWS2 in store.escalated, "unanswered for the delay after until: a new failure to answer"
    assert len(_escalations(audit)) == 1


async def test_an_escalated_alarm_leaves_the_set_keeps_its_page_and_is_paged_again_after_until(wall, audit):
    app = _app(audit)
    client = TestClient(app)
    _vitals(client, rr=26)                                          # first seen at WALL0
    store = _store(app)
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))
    assert NEWS2 in store.escalated and NEWS2 in store.paged and len(_escalations(audit)) == 1
    wall.at = WALL0 + timedelta(minutes=7)
    r = _snooze(client, minutes=5)                                  # until WALL0+12
    assert r.status_code == 200, r.text
    assert _on(r)["escalated"] is False, "it leaves the escalated set at once"
    assert NEWS2 in store.paged, "the doctor's page stays sent"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=8))
    assert NEWS2 not in store.escalated and len(_escalations(audit)) == 1
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=12))
    assert NEWS2 not in store.snoozes and NEWS2 not in store.paged, "at until the page is cleared"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=17))
    assert NEWS2 in store.escalated
    assert len(_escalations(audit)) == 2, "and the doctor is paged again"


async def test_the_cycle_republishes_the_card_when_a_snooze_ends(wall, audit):
    app = _app(audit)
    client = TestClient(app)
    _vitals(client, rr=26)
    assert _snooze(client, minutes=5).status_code == 200            # at WALL0, until WALL0+5
    frames = app.state.broadcaster.subscribe("h1")
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=4))
    assert frames.empty(), "nothing changed yet"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=5))
    sent = [frames.get_nowait() for _ in range(frames.qsize())]
    cards = [f for f in sent if f.get("patient_id") == "bed-3"]
    assert cards, "a screen without its own clock hears the alarm again within a cycle"
    assert next(a for a in cards[-1]["alerts"] if a["kind"] == "news2")["snooze"] is None


async def test_a_cycle_on_a_clock_stepped_back_ends_the_snooze_and_republishes_the_card(wall, audit):
    """Review (fix 2): the wall clock stepped back an hour after the snooze was taken. Held to `until`, the alarm
    would be silent for an hour and a quarter; it sounds again at once, on a clock from now."""
    app = _app(audit)
    client = TestClient(app)
    _vitals(client, rr=26)
    wall.at = WALL0 + timedelta(hours=1)
    assert _snooze(client, minutes=15).status_code == 200           # at WALL0+1h, until WALL0+1h15
    store = _store(app)
    frames = app.state.broadcaster.subscribe("h1")
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=2))
    assert NEWS2 not in store.snoozes
    assert store.clock_from[NEWS2] == WALL0 + timedelta(minutes=2)
    cards = [f for f in (frames.get_nowait() for _ in range(frames.qsize())) if f.get("patient_id") == "bed-3"]
    assert cards and next(a for a in cards[-1]["alerts"] if a["kind"] == "news2")["snooze"] is None


async def test_a_cycle_that_runs_late_still_starts_the_clock_from_until(wall, audit):
    """Review (fix 5): the first cycle after `until` comes late — the clock is `until`, not the cycle's instant, so
    the alarm is judged unanswered from the moment its snooze ended."""
    app = _app(audit)
    client = TestClient(app)
    _vitals(client, rr=26)
    wall.at = WALL0 + timedelta(minutes=1)
    assert _snooze(client, minutes=15).status_code == 200           # until WALL0+16
    store = _store(app)
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=25))
    assert NEWS2 not in store.snoozes
    assert store.clock_from[NEWS2] == WALL0 + timedelta(minutes=16)
    assert NEWS2 in store.escalated, "nine minutes unanswered since until: past the five-minute delay already"


class _FlakyIdentities(InMemoryIdentityStore):
    """An identity store whose next read for `fail_for` raises, once: the store blipping mid-cycle."""

    def __init__(self):
        super().__init__()
        self.fail_for = None

    def get(self, hospital, patient_id):
        if hospital == self.fail_for:
            self.fail_for = None
            raise RuntimeError("identity store blip")
        return super().get(hospital, patient_id)


def _news2_cards(queue):
    """The news2 alert of every bed-3 card sent on `queue` since it was last read."""
    frames = [queue.get_nowait() for _ in range(queue.qsize())]
    return [next(a for a in f["alerts"] if a["kind"] == "news2") for f in frames if f.get("patient_id") == "bed-3"]


async def test_a_cycle_that_raises_after_a_snooze_ended_leaves_the_card_to_the_next_and_wakes_every_hospital(
        wall, audit):
    """Review (fix 3): the cycle ends the snoozes before anything that can raise, for every hospital, and lets a
    woken patient go only once its card is out. An identity read failing in the first hospital — the cycle still
    raises, and the loop logs it — neither keeps the second hospital's alarm silent nor loses the frames that tell
    the screens the snoozes ended: the next cycle sends them, once."""
    identities = _FlakyIdentities()
    app = create_app({"tok": "h1", "tok2": "h2"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False,
                     audit=audit, resolve_jwt=_resolve, identities=identities)
    client = TestClient(app)
    _vitals(client, rr=26)                                          # h1 first, h2 second in the cycle's walk
    _vitals(client, rr=26, headers=DEVICE_H2)
    assert _snooze(client, minutes=5).status_code == 200            # at WALL0, until WALL0+5
    assert _snooze(client, minutes=5, headers=NURSE_H2).status_code == 200
    frames = {h: app.state.broadcaster.subscribe(h) for h in ("h1", "h2")}
    identities.fail_for = "h1"
    with pytest.raises(RuntimeError):
        await app.state.escalation_cycle(WALL0 + timedelta(minutes=5))
    stores = app.state.ack_stores
    assert stores["h1"].snoozes == {} and stores["h2"].snoozes == {}, "every hospital's spent snooze ended"
    assert stores["h2"].clock_from[NEWS2] == WALL0 + timedelta(minutes=5)
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=5, seconds=20))
    for hospital in ("h1", "h2"):
        cards = _news2_cards(frames[hospital])
        assert cards and cards[-1]["snooze"] is None, hospital
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=5, seconds=40))
    assert _news2_cards(frames["h1"]) == [] and _news2_cards(frames["h2"]) == [], "sent once, then let go"


# --- the episode, through the doors ----------------------------------------------------------------------

def test_an_episode_that_clears_takes_its_snooze_and_a_return_sounds(wall, audit):
    app = _app(audit)
    with TestClient(app) as client:
        _vitals(client, rr=26)                                      # first seen at WALL0
        wall.at = WALL0 + timedelta(minutes=1)
        assert _snooze(client, minutes=30).status_code == 200
        wall.at = WALL0 + timedelta(minutes=2)
        _reading(client, "resp_rate", 16, minute=2)                 # NEWS2 4: cleared (HIGH does not latch)
        assert "news2" not in _alerts(client) and _store(app).snoozes == {}
        wall.at = WALL0 + timedelta(minutes=4)
        _reading(client, "resp_rate", 26, minute=4)                 # back inside the escalation delay
        card = _alerts(client)["news2"]
        assert card["snooze"] is None, "a return is a new alarm, and sounds: no snooze rides the chain"
        assert card["first_seen_at"] == wall.at.isoformat()
        assert _store(app).clock_from[NEWS2] == WALL0, "its X13 chain goes on, on the chain's clock (plan note 2)"


def test_the_same_alarm_worse_sounds_again_and_is_held_to_its_own_cap(wall, audit):
    with TestClient(_app(audit)) as client:
        _vitals(client, rr=22)                                      # NEWS2 6: MODERATE
        assert _snooze(client, minutes=120).status_code == 200
        wall.at = WALL0 + timedelta(minutes=1)
        _reading(client, "resp_rate", 26, minute=1)                 # NEWS2 7: HIGH
        card = _alerts(client)["news2"]
        assert card["severity"] == "high" and card["snooze"] is None
        assert _snooze(client, minutes=120).status_code == 422, "a HIGH alarm is held to 30 minutes"
        assert _snooze(client, minutes=30).status_code == 200


# --- a restart ---------------------------------------------------------------------------------------------

T0_ISO = "2026-07-14T10:00:00+00:00"
AT = datetime(2026, 7, 14, 10, 1, tzinfo=timezone.utc)


def _news2_rows(audit, rr=26.0):
    for slug, val in (("heart_rate", 115.0), ("temperature", 39.5), ("resp_rate", rr)):
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", slug,
                                {"value": val, "unit": "", "obs_ts": T0_ISO, "device": "mon"}))
    audit.append(AuditEvent("HOSP1", "first_seen", "bed-3", "news2", {"at": T0_ISO}))
    return audit


def _shock_rows(audit):
    for slug, val in [("suspected_infection", 1.0), ("weight_kg", 100.0), ("crystalloid_bolus_ml", 3000.0),
                      ("map", 60.0), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", slug,
                                {"value": val, "unit": "", "obs_ts": T0_ISO, "device": "mon"}))
    return audit


def _snooze_row(kind="news2", patient="bed-3", **payload):
    body = {"role": "hem.leyla", "via": "user", "actor": "hem.leyla", "groups": ["nurse"], "minutes": 15,
            "until": (AT + timedelta(minutes=15)).isoformat(), "reason": "ARTEFACT_OR_SIGNAL_NOISE",
            "at": AT.isoformat()} | payload
    return AuditEvent("HOSP1", "alert_snooze", patient, kind, body)


def _replayed(audit, now):
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"), now=now)
    return engine, store


def test_a_restart_brings_a_running_snooze_back_and_ends_a_spent_one_by_the_clock_rule():
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(_snooze_row())
    _engine, store = _replayed(audit, now=AT + timedelta(minutes=5))
    assert store.snoozes[NEWS2] == {"by": "hem.leyla", "at": AT, "until": AT + timedelta(minutes=15),
                                    "minutes": 15, "reason": "ARTEFACT_OR_SIGNAL_NOISE", "reason_text": None,
                                    "severity": "high"}
    _engine, store = _replayed(audit, now=AT + timedelta(minutes=20))
    assert store.snoozes == {}, "a snooze whose until has passed has no effect"
    assert store.clock_from[NEWS2] == AT + timedelta(minutes=15), "but the clock rule at expiry applies"


def test_what_ends_a_snooze_live_ends_it_in_the_replay():
    later = AT + timedelta(minutes=3)
    # an acknowledgement
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(_snooze_row())
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "news2", {"role": "doctor", "at": T0_ISO}))
    assert _replayed(audit, now=later)[1].snoozes == {}
    # the episode's end: a respiratory rate of 16 clears it
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(_snooze_row())
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "resp_rate",
                            {"value": 16.0, "unit": "", "obs_ts": "2026-07-14T10:02:00+00:00", "device": "mon"}))
    assert _replayed(audit, now=later)[1].snoozes == {}
    # a discharge
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(_snooze_row())
    audit.append(AuditEvent("HOSP1", "alert_cleared", "bed-3", "news2",
                            {"first_seen": T0_ISO, "at": T0_ISO, "reason": "discharged", "severity": "high"}))
    assert _replayed(audit, now=later)[1].snoozes == {}
    # a second snooze replaces the first
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(_snooze_row())
    audit.append(_snooze_row(minutes=5, at=(AT + timedelta(minutes=2)).isoformat(), reason="CLINICAL_DECISION_MADE"))
    snooze = _replayed(audit, now=later)[1].snoozes[NEWS2]
    assert (snooze["until"], snooze["reason"]) == (AT + timedelta(minutes=7), "CLINICAL_DECISION_MADE")


def test_a_row_the_live_door_would_have_refused_is_passed_over():
    later = AT + timedelta(minutes=3)
    audit = InMemoryAuditLog()
    audit.append(_snooze_row())                                     # nothing is firing yet
    _news2_rows(audit)
    for bad in (_snooze_row("no_such_kind"), _snooze_row(patient="bed-9"), _snooze_row(minutes=31),
                _snooze_row(minutes="15"), _snooze_row(reason="NOPE"), _snooze_row(reason="OTHER", reason_text="kısa"),
                _snooze_row(at="not a time"), _snooze_row(at=None)):
        audit.append(bad)
    assert _replayed(audit, now=later)[1].snoozes == {}
    audit.append(_snooze_row(minutes=10))                           # and a good row after them still counts
    assert _replayed(audit, now=later)[1].snoozes[NEWS2]["minutes"] == 10
    # an acknowledged alarm: the door answers 409, so a later row is not replayed either
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "news2", {"role": "doctor", "at": T0_ISO}))
    audit.append(_snooze_row())
    assert _replayed(audit, now=later)[1].snoozes == {}
    # a critical is never snoozed; a HIGH sepsis alarm on the same patient is
    audit = _shock_rows(InMemoryAuditLog())
    audit.append(_snooze_row("septic_shock", minutes=5))
    audit.append(_snooze_row("sepsis", minutes=30))
    assert set(_replayed(audit, now=later)[1].snoozes) == {("bed-3", "sepsis")}


def test_a_running_app_restarts_with_its_running_snooze_and_without_a_spent_one(wall, audit):
    with TestClient(_app(audit)) as live:
        _vitals(live, rr=26)                                        # first seen at WALL0
        wall.at = WALL0 + timedelta(minutes=1)
        snooze = _on(_snooze(live, minutes=15))["snooze"]           # until WALL0+16
    wall.at = WALL0 + timedelta(minutes=5)
    with TestClient(_app(audit)) as restarted:
        assert _alerts(restarted)["news2"]["snooze"] == snooze
    wall.at = WALL0 + timedelta(minutes=17)
    later = _app(audit)
    with TestClient(later) as restarted:
        assert _alerts(restarted)["news2"]["snooze"] is None, "its time ran out before this restart"
        assert _store(later).clock_from[NEWS2] == WALL0 + timedelta(minutes=16), "the clock rule at expiry"
    assert len(_rows(audit)) == 1, "a replay writes nothing"


@pytest.mark.parametrize("bad_at", [
    "2026-07-14T10:01:00",                                          # no UTC offset
    "9999-12-31T23:59:00+00:00",                                    # its `until` would be past year 9999
    (AT + timedelta(hours=2)).isoformat(),                          # later than the restart's own clock
], ids=["naive", "year-9999", "future"])
def test_a_snooze_row_the_replay_cannot_judge_is_passed_over_and_the_rest_still_installs(bad_at):
    """Review (fix 1): one bad `alert_snooze` row never fails a replay, nor installs a snooze. A time with no
    offset cannot be compared with the clock, a time whose `until` overflows has no `until`, and a time later
    than the restart's `now` (a clock stepped back since the row was written) would outlive its cap from `now`."""
    later = AT + timedelta(minutes=3)
    audit = _news2_rows(InMemoryAuditLog())
    audit.append(_snooze_row(at=bad_at))
    _engine, store = _replayed(audit, now=later)
    assert store.snoozes == {}
    assert store.clock_from[NEWS2] == datetime.fromisoformat(T0_ISO), "passed over, not installed and ended"
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "resp_rate",
                            {"value": 22.0, "unit": "", "obs_ts": "2026-07-14T10:02:00+00:00", "device": "mon"}))
    audit.append(_snooze_row(minutes=10))
    _engine, store = _replayed(audit, now=later)
    assert store.firing[NEWS2].severity == "moderate", "the rows after it were replayed"
    assert (store.snoozes[NEWS2]["at"], store.snoozes[NEWS2]["minutes"]) == (AT, 10), "and a good row still counts"


def test_a_worse_reading_ends_a_replayed_snooze_in_the_log_or_after_the_restart():
    """Review (fix 5): a snooze the replay brought back is the live one — the same alarm worse ends it, whether the
    worse reading is a later row of the log or the first one after the restart."""
    later = AT + timedelta(minutes=3)
    worse_rr = {"value": 26.0, "unit": "", "obs_ts": "2026-07-14T10:02:00+00:00", "device": "mon"}
    audit = _news2_rows(InMemoryAuditLog(), rr=22.0)                # MODERATE
    audit.append(_snooze_row(minutes=60, severity="moderate"))
    engine, store = _replayed(audit, now=later)
    assert store.snoozes[NEWS2]["severity"] == "moderate"
    engine.ingest(Observation("bed-3", SignalCode.RESP_RATE, 26.0, "", later, "mon"), now=later)
    sync_alerts(engine, store, "bed-3", later)                      # as the door runs it
    assert store.firing[NEWS2].severity == "high" and store.snoozes == {}, "after the restart"
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "resp_rate", worse_rr))
    assert _replayed(audit, now=later)[1].snoozes == {}, "a later row of the log"


def test_a_replayed_snooze_is_held_to_the_milder_severity_and_to_both_caps():
    """Review (fix 4): the row records the severity the snooze was given at. The replay holds the snooze to the
    milder of that and the alarm it has, and its minutes to both caps; an alarm worse than the one snoozed ended
    its snooze live, and is not snoozed by the restart."""
    later = AT + timedelta(minutes=3)
    audit = _news2_rows(InMemoryAuditLog())                         # HIGH at the row
    audit.append(_snooze_row(minutes=15, severity="moderate"))
    assert _replayed(audit, now=later)[1].snoozes == {}, "given on a MODERATE: not this alarm"
    audit = _news2_rows(InMemoryAuditLog(), rr=22.0)                # MODERATE at the row
    audit.append(_snooze_row(minutes=60, severity="high"))
    assert _replayed(audit, now=later)[1].snoozes == {}, "60 minutes is within a moderate's cap, not a high's"
    audit.append(_snooze_row(minutes=30, severity="high"))
    assert _replayed(audit, now=later)[1].snoozes[NEWS2]["severity"] == "moderate", "held to the milder"
    for bad in ("critical", "low", "unheard_of", 7):
        audit = _news2_rows(InMemoryAuditLog())
        audit.append(_snooze_row(severity=bad))
        assert _replayed(audit, now=later)[1].snoozes == {}, bad
    audit = _news2_rows(InMemoryAuditLog(), rr=22.0)                # a row from before the review: today's rule
    audit.append(_snooze_row(minutes=60))
    assert _replayed(audit, now=later)[1].snoozes[NEWS2]["minutes"] == 60


def test_a_restart_does_not_bring_back_a_snooze_a_withdrawal_ended(wall, audit):
    """Review (fix 4): W, a charted respiratory rate of 22, lowers news2 to MODERATE, and the snooze is taken on
    that. W is withdrawn («hatalı giriş»): news2 is HIGH again, which ends the snooze live (plan note 1). The
    restart replays without W, so news2 is HIGH at the snooze's row, and its 15 minutes are within a high's cap:
    only the row's own severity tells that this was not the alarm a person snoozed."""
    with TestClient(_app(audit)) as live:
        for code, value in (("heart_rate", 115), ("temperature", 39.5), ("resp_rate", 26)):
            _reading(live, code, value, at=WALL0)                   # NEWS2 7: HIGH, measured at the wall's time
        wall.at = WALL0 + timedelta(minutes=1)
        r = live.post("/clinical/bed-3", json={"entries": [{"code": "resp_rate", "value": 22}]}, headers=CHARGE)
        assert r.status_code == 200, r.text
        [w] = [e["entry"] for e in r.json()["entries"]]
        assert _alerts(live)["news2"]["severity"] == "moderate"
        wall.at = WALL0 + timedelta(minutes=2)
        assert _snooze(live, minutes=15, headers=CHARGE).status_code == 200      # until WALL0+17
        assert _rows(audit)[0].payload["severity"] == "moderate"
        wall.at = WALL0 + timedelta(minutes=3)
        r = live.post(f"/clinical/bed-3/entries/{w}/retract", json={"reason": "yanlış hasta seçilmişti"},
                      headers=CHARGE)
        assert r.status_code == 200, r.text
        card = _alerts(live)["news2"]
        assert card["severity"] == "high" and card["snooze"] is None, "the worse alarm ended it live"
    wall.at = WALL0 + timedelta(minutes=5)                          # a restart within until
    restarted_app = _app(audit)
    with TestClient(restarted_app) as restarted:
        card = _alerts(restarted)["news2"]
        assert card["severity"] == "high" and card["snooze"] is None, "and the restart does not bring it back"
        assert _store(restarted_app).snoozes == {}
