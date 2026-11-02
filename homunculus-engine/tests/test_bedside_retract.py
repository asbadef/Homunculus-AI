"""G3-01 (D10–D12, X3, X4, X11): «hatalı giriş» through the API. A withdrawn hand entry leaves every score
as if it had never been charted; the trail keeps both rows; a restart agrees; an alert the withdrawal
uncovers is told; the refusals hold and write nothing. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.alert_lifecycle import ENTERED_IN_ERROR
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import (
    RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_NEEDS_PERSON, RETRACT_NOT_BEDSIDE, RETRACT_REASON_LONG,
    RETRACT_REASON_SHORT, RETRACT_UNKNOWN, RETRACTABLE_CODES,
)
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}
WHY = "yazım hatası — 26 değil 16"
# RR 26, SpO₂ 91, systolic 88: NEWS2 9, the immediate band.
RISKY = [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 91}, {"code": "sbp", "value": 88}]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit=None, identities=None, **kw) -> TestClient:
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve,
                     audit=audit if audit is not None else InMemoryAuditLog(), identities=identities, **kw)
    return TestClient(app)


@pytest.fixture()
def client():
    with _app() as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(c, entries, at, pid="bed-3") -> dict[str, int]:
    """Chart as the nurse; the answer's `entries` by code (one value per code per call here)."""
    r = c.post(f"/clinical/{pid}", json={"entries": entries, "recorded_at": at}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _retract(c, entry, reason=WHY, headers=NURSE, pid="bed-3"):
    return c.post(f"/clinical/{pid}/entries/{entry}/retract", json={"reason": reason}, headers=headers)


def _card(c, pid="bed-3"):
    return next(p for p in c.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


def _firing(card):
    """The alerts firing now. Every alert on the card carries `resolved_at`: None while it fires
    (api/board.py `_merge_alert`), the time its rule stopped once latched (`_latched_alerts`)."""
    return sorted(a["kind"] for a in card["alerts"] if a["resolved_at"] is None)


def _latched(card):
    return sorted(a["kind"] for a in card["alerts"] if a["resolved_at"] is not None)


def _news2(card):
    n = card["latest"]["news2"]
    return {k: n[k] for k in ("total", "partial", "missing", "red_param", "breakdown", "stale", "measured_at")}


def _rows(c, kind):
    return c.app.state.audit.records(tenant="h1", event_type=kind, limit=100)


def _engine(c):
    """The hospital's real engine, through the handle the admission's BoardLink is given (app.state.board_link)."""
    return c.app.state.board_link._engine("h1")


def _store(c):
    return c.app.state.ack_stores["h1"]


def _frames(queue, pid="bed-3"):
    """The frames published for `pid` since `queue` subscribed (app.state.broadcaster)."""
    out = []
    while not queue.empty():
        frame = queue.get_nowait()
        if frame.get("patient_id") == pid:
            out.append(frame)
    return out


def _internals(c, pid="bed-3"):
    """Everything the engine keeps for one patient (pipeline.py `_PER_PATIENT` and the readings) — what
    `Engine.adopt` replaces — read without creating the patient."""
    e = _engine(c)
    readings = None
    if pid in e.patient_ids():
        st = e.state(pid)
        readings = sorted((o.code.value, o.value, o.timestamp.isoformat(), o.source_device)
                          for code in list(st._history) for o in st.history(code))
    held = e._held_news2_alert.get(pid)
    return {"readings": readings, "recognized_at": e._recognized_at.get(pid), "dropped": e._dropped_anchor.get(pid),
            "alerts": sorted((k, a.severity, a.urgency, a.summary) for k, a in e._alerts.get(pid, {}).items()),
            "held": held and held.summary, "judged": e._news2_judged_at.get(pid), "profile": e._profiles.get(pid)}


def _view(card):
    """What the card says of the patient's scores, the antibiotic clock and the firing alerts."""
    n = card["latest"]["news2"]
    return {"news2": n and {k: n[k] for k in ("total", "partial", "missing", "red_param", "breakdown", "stale")},
            "sofa": card["latest"].get("sofa"), "sepsis": card.get("sepsis"),
            "clock": card["meds"]["antibiotic_clock"] if card.get("meds") else None, "firing": _firing(card)}


def _equal_to_never_charted(script, withdraw, never):
    """`script` charted in one app — each step (entries, minutes ago) — then `withdraw`'s (step, code) withdrawn
    by the route; `never` charted in a fresh app. The live engine's patient before the withdrawal, then both
    engines' patient and both cards, as a pair each."""
    stamps = {}

    def at(minutes):
        return stamps.setdefault(minutes, _ago(minutes))     # one instant per step, shared by both apps

    with _app() as live:
        ids = [_chart(live, entries, at(minutes)) for entries, minutes in script]
        before = _internals(live)
        for step, code in withdraw:
            assert _retract(live, ids[step][code]).status_code == 200
        got = (_internals(live), _view(_card(live)))
    with _app() as fresh:
        for entries, minutes in never:
            _chart(fresh, entries, at(minutes))
        want = (_internals(fresh), _view(_card(fresh)))
    return before, got, want


class TestTheWithdrawalScoresAsIfNeverCharted:
    def test_withdrawing_the_value_that_raised_news2(self, client):
        at = _ago(5)
        ids = _chart(client, RISKY, at)
        assert "news2" in _firing(_card(client))
        r = _retract(client, ids["resp_rate"])
        assert r.status_code == 200, r.text
        assert (r.json()["retracted"], r.json()["code"]) == (ids["resp_rate"], "resp_rate")
        with _app() as fresh:
            _chart(fresh, [e for e in RISKY if e["code"] != "resp_rate"], at)
            assert _news2(_card(client)) == _news2(_card(fresh))
            assert _firing(_card(client)) == _firing(_card(fresh))

    def test_withdrawing_a_map_that_turned_sepsis_on_leaves_no_antibiotic_clock(self, client):
        """X4: removing the value alone would not stop the hour the recognition started (pipeline.py)."""
        at = _ago(5)
        base = [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}]
        _chart(client, base, at)
        ids = _chart(client, [{"code": "map", "value": 60}], at)
        assert _card(client)["meds"]["antibiotic_clock"] is not None     # SOFA 2 with the MAP: the hour runs
        assert _retract(client, ids["map"]).status_code == 200
        after = _card(client)
        assert after["meds"]["antibiotic_clock"] is None
        # only a critical latches
        assert all(a["severity"] == "critical" for a in after["alerts"] if a["resolved_at"] is not None)
        with _app() as fresh:
            _chart(fresh, base, at)
            assert _firing(after) == _firing(_card(fresh))
            assert after["sepsis"] == _card(fresh)["sepsis"]


class TestTheTrailKeepsBoth:
    def test_the_chart_row_stays_and_the_withdrawal_names_it(self, client):
        at = _ago(5)
        ids = _chart(client, RISKY, at)
        assert _retract(client, ids["resp_rate"], reason=f"  {WHY}  ").status_code == 200
        assert ids["resp_rate"] in [r.id for r in _rows(client, "chart")]
        (row,) = _rows(client, RETRACT)
        assert (row.patient_id, row.subject) == ("bed-3", "resp_rate")
        assert row.payload == {"entry": ids["resp_rate"], "code": "resp_rate", "value": 26, "obs_ts": at,
                               "reason": WHY, "retracted_by": "hem.ayse"}


class TestTheRestartAgrees:
    def test_a_restart_skips_the_withdrawn_entry(self):
        """D12: the replay reads the withdrawals first and scores as the live rebuild did."""
        log, at = InMemoryAuditLog(), _ago(5)
        with _app(audit=log) as first:
            ids = _chart(first, RISKY, at)
            assert _retract(first, ids["resp_rate"]).status_code == 200
            live = _card(first)
        with _app(audit=log) as second:
            again = _card(second)
            assert _news2(again) == _news2(live)
            assert _firing(again) == _firing(live)


class TestTheNurseIsToldOfWhatItUncovers:
    def test_a_withdrawal_that_brings_an_immediate_alert_back_tells_the_nurse(self, client):
        """X3: three wrong normal values hid an immediate NEWS2; withdrawn one by one, the last brings it back."""
        _chart(client, RISKY, _ago(10))                                      # NEWS2 9: told once
        ids = _chart(client, [{"code": "resp_rate", "value": 16}, {"code": "spo2", "value": 97},
                              {"code": "sbp", "value": 120}], _ago(5))       # NEWS2 0: the alert ended
        assert "news2" not in _firing(_card(client))
        assert len(_rows(client, "notification")) == 1
        for code in ("resp_rate", "spo2"):
            assert _retract(client, ids[code]).status_code == 200            # NEWS2 6: soon, not immediate
        assert len(_rows(client, "notification")) == 1
        assert _retract(client, ids["sbp"]).status_code == 200               # the 88 again: NEWS2 9
        assert len(_rows(client, "notification")) == 2


class TestTheRefusals:
    def test_a_short_reason_is_refused(self, client):
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], reason="   kısa   ")
        assert (r.status_code, r.json()["detail"]) == (400, RETRACT_REASON_SHORT)

    # Final review (I1): the reason is plaintext in the append-only trail and in every trends answer for days — at
    # most 200 characters, counted after the trim and in characters, not bytes («ğ» is two in UTF-8).
    def test_a_reason_of_200_characters_is_taken(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"], reason="ğ" * 200).status_code == 200
        (row,) = _rows(client, RETRACT)
        assert row.payload["reason"] == "ğ" * 200

    def test_a_reason_of_201_characters_is_refused_and_writes_nothing(self, client):
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], reason="ğ" * 201)
        assert (r.status_code, r.json()["detail"]) == (400, RETRACT_REASON_LONG)
        assert RETRACT_REASON_LONG == "gerekçe en çok 200 karakter olabilir"      # the dashboard maps it so
        assert _rows(client, RETRACT) == []
        assert _card(client)["latest"]["resp_rate"] == 26

    def test_201_characters_that_trim_to_200_are_taken(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"], reason=" " + "ğ" * 200).status_code == 200
        (row,) = _rows(client, RETRACT)
        assert row.payload["reason"] == "ğ" * 200

    @pytest.mark.parametrize("entry", ["999999", "abc", "-1"])
    def test_an_unknown_entry_is_404(self, client, entry):
        _chart(client, RISKY, _ago(5))
        r = _retract(client, entry)
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)

    def test_another_patients_entry_is_404(self, client):
        ids = _chart(client, RISKY, _ago(5), pid="bed-4")
        _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["spo2"], pid="bed-3").status_code == 404

    def test_a_row_that_is_not_a_chart_row_is_404(self, client):
        """A device's reading is an `ingest` row, an alert an `alert` row: neither is a hand entry."""
        _chart(client, RISKY, _ago(5))
        alert = _rows(client, "alert")[0]
        assert _retract(client, alert.id).status_code == 404

    # X22 (the local walk): only the bedside form's values. A nurse with clinical.chart withdrew a physician's
    # suspected-infection mark and the SOFA form's platelets through the API; they are corrected by a new entry.
    @pytest.mark.parametrize("code,value", [
        ("suspected_infection", 1),     # a physician's mark: «geri alınmaz», the sepsis panel says
        ("platelets", 120),             # the SOFA form's lab
        ("lactate", 4),                 # a trends channel, but not a value the bedside form charts
    ])
    def test_a_value_the_bedside_form_does_not_chart_is_refused_and_nothing_is_written(self, client, code, value):
        ids = _chart(client, [{"code": code, "value": value}], _ago(5))
        trail = len(client.app.state.audit.records(tenant="h1", limit=1000))
        r = _retract(client, ids[code])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_NOT_BEDSIDE)
        assert RETRACT_NOT_BEDSIDE == "yalnız yatak başı ölçümü hatalı giriş olarak işaretlenebilir"   # mapped so
        assert len(client.app.state.audit.records(tenant="h1", limit=1000)) == trail

    def test_the_withdrawable_codes_are_the_bedside_forms(self):
        """The bedside form's own codes (dashboard live/screens/bedside/vitalsFields.js), as a chart row's
        subject."""
        assert RETRACTABLE_CODES == {"resp_rate", "spo2", "supplemental_oxygen", "sbp", "map", "heart_rate",
                                     "acvpu", "temperature"}

    @pytest.mark.parametrize("code,value", [
        ("resp_rate", 18), ("spo2", 96), ("supplemental_oxygen", 1), ("sbp", 120), ("map", 85), ("heart_rate", 80),
        ("acvpu", 0), ("temperature", 37.2),
    ])
    def test_each_bedside_value_can_be_withdrawn(self, client, code, value):
        ids = _chart(client, [{"code": code, "value": value}], _ago(5))
        r = _retract(client, ids[code])
        assert (r.status_code, r.json()["code"]) == (200, code)

    def test_a_second_withdrawal_is_409(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = _retract(client, ids["resp_rate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)

    def test_a_device_credential_cannot_withdraw(self, client):
        """X11: a withdrawal names who made it."""
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], headers=AUTH)
        assert (r.status_code, r.json()["detail"]) == (403, RETRACT_NEEDS_PERSON)

    def test_it_needs_a_credential_and_the_chart_permission(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert client.post(f"/clinical/bed-3/entries/{ids['spo2']}/retract", json={"reason": WHY}).status_code == 401
        assert _retract(client, ids["spo2"], headers=VIEWER).status_code == 403

    def test_a_discharged_number_is_409(self):
        store = InMemoryIdentityStore()
        with _app(identities=store) as c:
            ids = _chart(c, RISKY, _ago(5))
            store.apply("h1", IdentityRecord(patient_id="bed-3", state="discharged", source=KABUL,
                                             updated_at=datetime.now(timezone.utc)))
            r = _retract(c, ids["resp_rate"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_DISCHARGED)

    def test_a_discharged_number_is_refused_before_the_trail_is_read(self):
        """Review of Task 5: the tombstone is checked before any read or rebuild — the rebuild never reads the
        discharge's row, and `adopt` would bring a retired patient back. With the read failing, still a 409."""
        log, store = _Faulty(), InMemoryIdentityStore()
        with _app(audit=log, identities=store) as c:
            ids = _chart(c, RISKY, _ago(5))
            store.apply("h1", IdentityRecord(patient_id="bed-3", state="discharged", source=KABUL,
                                             updated_at=datetime.now(timezone.utc)))
            log.fail_read = True
            r = _retract(c, ids["resp_rate"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_DISCHARGED)

    def test_no_refusal_writes_a_row(self, client):
        ids = _chart(client, RISKY, _ago(5))
        for entry, reason, headers in ((ids["spo2"], "kısa", NURSE), ("999999", WHY, NURSE),
                                       (ids["spo2"], WHY, AUTH), (ids["spo2"], WHY, VIEWER)):
            assert _retract(client, entry, reason=reason, headers=headers).status_code >= 400
        assert _rows(client, RETRACT) == []

    def test_an_id_that_is_not_plain_ascii_digits_or_too_long_names_no_entry(self, client):
        """Review: `str.isdigit` alone takes «²», which `int` then refuses (a 500), and Arabic-Indic «٢», which
        `int` reads as 2 — another entry's id typed in another script. Past 18 digits an id is no audit row's
        (a 64-bit id has 19 at most), and a padded one would reach a real entry the same way. All three are 404,
        with nothing written and the value still counted."""
        ids = _chart(client, RISKY, _ago(5))
        real = str(ids["spo2"])
        arabic_indic = real.translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))
        for entry in ("²", arabic_indic, real.rjust(19, "0")):
            r = _retract(client, entry)
            assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN), entry
        assert _rows(client, RETRACT) == []
        assert _card(client)["latest"]["spo2"] == 91


# --- the invariants the controller's self-review names, pinned (G3-01 review of Task 5) -----------------------

# Suspected infection with platelets 120: SOFA 1, no sepsis until a MAP below 70 adds a point.
BASE = [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}]
OVERDUE = ("bed-3", "antibiotic_overdue")


def _overdue(c) -> dict[str, int]:
    """A critical alert a bedside value stands on (X22: only those can be withdrawn). A bedside MAP 60 makes it
    sepsis 90 minutes ago (SOFA 2 with BASE), which starts the antibiotic hour; a temperature charted now finds
    the hour gone with no antibiotic — `antibiotic_overdue`, critical and immediate. Withdrawn, the MAP never made
    it sepsis, so no hour ran. BASE's mark and lab are not bedside values: no withdrawal reaches them. The entries
    by code."""
    ids = _chart(c, BASE, _ago(90)) | _chart(c, [{"code": "map", "value": 60}], _ago(90))
    ids |= _chart(c, [{"code": "temperature", "value": 37.0}], _ago(5))
    assert "antibiotic_overdue" in _firing(_card(c))
    return ids


def _withdraw_in_trail(c, entry):
    """The `chart_retract` row the route writes, straight into the trail — for a value the route refuses (X22): a
    non-bedside row. The engine's memory is not rebuilt by it; the next withdrawal through the route reads it."""
    (target,) = [r for r in _rows(c, "chart") if r.id == entry]
    c.app.state.audit.append(AuditEvent("h1", RETRACT, "bed-3", target.subject, {
        "entry": target.id, "code": target.subject, "value": target.payload["value"],
        "obs_ts": target.payload["obs_ts"], "reason": WHY, "retracted_by": "hem.ayse"}))


class TestTheLatchHolds:
    def test_an_unacknowledged_critical_the_withdrawal_ends_stays_latched(self, client):
        """G2-A1 (D3) through the lifecycle hook the withdrawal runs once: the overdue antibiotic nobody
        acknowledged is a to-do on the board, not gone; and the nurse, told of it once, is not told again."""
        ids = _overdue(client)
        told = len(_rows(client, "notification"))
        assert _retract(client, ids["map"]).status_code == 200
        after = _card(client)
        assert "antibiotic_overdue" not in _firing(after)
        assert _latched(after) == ["antibiotic_overdue"]
        assert len(_rows(client, "notification")) == told
        # Review of Task 5: some reading is left, so the latch stays on this card (D10) — not ended in error.
        assert ENTERED_IN_ERROR not in {r.payload["reason"] for r in _rows(client, "alert_cleared")}
        assert OVERDUE in _store(client).resolved

    def test_an_acknowledged_critical_simply_ends(self, client):
        ids = _overdue(client)
        acked = client.post("/ack", json={"patient_id": "bed-3", "kind": "antibiotic_overdue", "role": "nurse"},
                            headers=AUTH)
        assert acked.status_code == 200, acked.text
        assert _retract(client, ids["map"]).status_code == 200
        assert "antibiotic_overdue" not in [a["kind"] for a in _card(client)["alerts"]]


class _Faulty(InMemoryAuditLog):
    """A trail that fails on demand — the withdrawal's read of the patient's rows, or its own row: a bounded
    audit that timed out (O6)."""
    fail_read = fail_append = False

    def records(self, **kw):
        if self.fail_read and kw.get("patient_id") is not None:
            raise RuntimeError("the trail read timed out")
        return super().records(**kw)

    def append(self, event):
        if self.fail_append and event.event_type == RETRACT:
            raise RuntimeError("the trail write timed out")
        return super().append(event)


class TestAFailureChangesNothing:
    @pytest.mark.parametrize("fault", ["fail_read", "fail_append"])
    def test_a_read_or_an_append_that_fails_leaves_the_patient_as_it_was(self, fault):
        """X4: the trail row first, then memory — the scratch engine is dropped, and the value still counts."""
        log = _Faulty()
        with _app(audit=log) as c:
            ids = _chart(c, RISKY, _ago(5))
            before = _card(c)
            setattr(log, fault, True)
            with pytest.raises(RuntimeError):
                _retract(c, ids["resp_rate"])
            setattr(log, fault, False)
            after = _card(c)
            assert _rows(c, RETRACT) == []
            assert (_news2(after), _firing(after), after["latest"]["resp_rate"]) == (
                _news2(before), _firing(before), 26)
            assert _retract(c, ids["resp_rate"]).status_code == 200       # once the trail answers, it can be


class TestTheOnlyReading:
    """Never charting a patient's only value leaves the patient unmeasured — the card must not be rebuilt as a
    measured one (`patient_board` creates the patient in the engine, and its NEWS2 0 would read as measured)."""

    def test_an_admitted_patient_goes_back_to_its_identity_card(self):
        store = InMemoryIdentityStore()
        store.apply("h1", IdentityRecord(patient_id="bed-3", state="admitted", source=KABUL,
                                         updated_at=datetime.now(timezone.utc)))
        with _app(identities=store) as c:
            ids = _chart(c, [{"code": "temperature", "value": 38.2}], _ago(5))
            assert _card(c)["latest"]["news2"] is not None
            queue = c.app.state.broadcaster.subscribe("h1")
            assert _retract(c, ids["temperature"]).status_code == 200
            card = _card(c)
            assert (card["latest"]["news2"], card["alerts"], card["identity"]["patient_id"]) == (None, [], "bed-3")
            # Review of Task 5: the ward is told so — `/patients` alone would read the same with no frame sent.
            (frame,) = _frames(queue)
            assert "removed" not in frame
            assert (frame["latest"]["news2"], frame["alerts"], frame["identity"]["patient_id"]) == (
                None, [], "bed-3")

    def test_an_id_with_no_identity_leaves_the_board(self, client):
        ids = _chart(client, [{"code": "temperature", "value": 38.2}], _ago(5))
        queue = client.app.state.broadcaster.subscribe("h1")
        assert _retract(client, ids["temperature"]).status_code == 200
        assert "bed-3" not in [p["patient_id"] for p in client.get("/patients", headers=AUTH).json()["patients"]]
        assert _frames(queue) == [{"patient_id": "bed-3", "removed": True, "identity": None}]


# --- review of Task 5 --------------------------------------------------------------------------------------------

def _admitted(store):
    store.apply("h1", IdentityRecord(patient_id="bed-3", state="admitted", source=KABUL,
                                     updated_at=datetime.now(timezone.utc)))
    return store


class TestNoReadingLeftEndsTheLatches:
    """Decided in review: when every value is withdrawn — the «charted on the wrong patient» case — the patient's
    latches end (`entered_in_error`). Kept, one would wait in the store with no card to show it, nobody able to
    acknowledge it, for the next real reading to bring it back; and a restart never builds it (O4)."""

    @pytest.mark.parametrize("admitted", [True, False], ids=["identity card", "removal"])
    def test_withdrawing_every_value_ends_the_latch_and_a_restart_agrees(self, admitted):
        """No critical alert stands on bedside values alone — NEWS2 tops out at «high», and both criticals need a
        suspected-infection mark — and the route withdraws only those (X22). So BASE's mark and lab are withdrawn
        straight in the trail (`_withdraw_in_trail`), and the route's last withdrawal, the temperature, rebuilds
        the patient with no reading left."""
        log = InMemoryAuditLog()
        identities = _admitted(InMemoryIdentityStore()) if admitted else InMemoryIdentityStore()
        with _app(audit=log, identities=identities) as c:
            ids = _overdue(c)
            assert _retract(c, ids["map"]).status_code == 200
            assert _latched(_card(c)) == ["antibiotic_overdue"]           # some reading left: on the card (D10)
            for code in ("suspected_infection", "platelets"):
                _withdraw_in_trail(c, ids[code])
            queue = c.app.state.broadcaster.subscribe("h1")
            assert _retract(c, ids["temperature"]).status_code == 200      # no reading left
            acks = _store(c)
            assert OVERDUE not in acks.resolved and OVERDUE not in acks.first_seen
            assert OVERDUE not in acks.clock_from
            (ended,) = [r for r in _rows(c, "alert_cleared") if r.payload["reason"] == ENTERED_IN_ERROR]
            assert (ended.subject, ended.payload["severity"]) == ("antibiotic_overdue", "critical")
            assert ended.payload["first_seen"] is not None                  # the episode's own first sight
            assert _frames(queue)[-1].get("alerts", []) == []               # the last frame shows none
            _chart(c, [{"code": "heart_rate", "value": 80}], _ago(1))       # the next real reading
            live = _card(c)
            assert live["alerts"] == [], "the latch came back with the next reading"
        with _app(audit=log, identities=identities) as again:              # the new reason is not replayed
            assert _card(again)["alerts"] == live["alerts"]
            acks = _store(again)
            assert OVERDUE not in acks.resolved and OVERDUE not in acks.first_seen


class TestTheChainIsNotInherited:
    def test_a_real_alert_after_a_withdrawn_one_gets_its_own_clock_and_its_own_page(self):
        """Review of Task 5, unlike X13 on purpose: a NEWS2 raised by wrong values pages the doctor; withdrawn,
        it ends unanswered. A real NEWS2 within `escalate_after` is a chain of its own — its own clock, and a page
        after `escalate_after` — not the withdrawn episode's, whose page would have kept it silent for good."""
        with _app(escalate_after=timedelta(minutes=10)) as c:
            cycle, key, t0 = c.app.state.escalation_cycle, ("bed-3", "news2"), datetime.now(timezone.utc)
            _chart(c, [{"code": "heart_rate", "value": 70}], _ago(20))     # a real reading stays on the card
            ids = _chart(c, RISKY, _ago(3))
            c.portal.call(cycle, t0 + timedelta(minutes=11))
            assert len(_rows(c, "escalation")) == 1                         # the doctor is paged
            for code in ("resp_rate", "spo2", "sbp"):
                assert _retract(c, ids[code]).status_code == 200
            assert "news2" not in _firing(_card(c))                         # ended, unanswered
            _chart(c, RISKY, _ago(1))                                       # a real deterioration
            acks = _store(c)
            assert acks.clock_from[key] == acks.first_seen[key], "the withdrawn episode's clock was inherited"
            t1 = acks.first_seen[key]
            c.portal.call(cycle, t1 + timedelta(minutes=5))
            assert len(_rows(c, "escalation")) == 1                         # not yet: its own clock
            c.portal.call(cycle, t1 + timedelta(minutes=11))
            assert len(_rows(c, "escalation")) == 2, "the real episode was never paged"


class _CommitsThenRaises(InMemoryAuditLog):
    """A withdrawal's row that commits and whose append then raises — a bounded write timing out after its
    commit: the caller gets a 500, and the trail holds the row."""
    armed = False

    def append(self, event):
        written = super().append(event)
        if self.armed and event.event_type == RETRACT:
            self.armed = False
            raise RuntimeError("the commit's answer timed out")
        return written


class TestARetryRepairsMemory:
    def test_a_row_that_committed_while_its_append_raised_is_repaired_by_the_retry(self):
        log, at = _CommitsThenRaises(), _ago(5)
        with _app(audit=log) as c:
            ids = _chart(c, RISKY, at)
            log.armed = True
            with pytest.raises(RuntimeError):
                _retract(c, ids["resp_rate"])
            assert len(_rows(c, RETRACT)) == 1 and _card(c)["latest"]["resp_rate"] == 26   # memory still counts it
            r = _retract(c, ids["resp_rate"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)
            assert len(_rows(c, RETRACT)) == 1                                              # no second row
            repaired = _card(c)
            assert repaired["latest"]["resp_rate"] is None
            with _app() as fresh:
                _chart(fresh, [e for e in RISKY if e["code"] != "resp_rate"], at)
                assert (_news2(repaired), _firing(repaired)) == (_news2(_card(fresh)), _firing(_card(fresh)))

    def test_a_409_with_memory_already_right_writes_nothing_and_sends_the_card_again(self, client):
        """No repair (the counts agree), no row; the current card goes out once more (final review, X21)."""
        ids = _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"]).status_code == 200
        queue = client.app.state.broadcaster.subscribe("h1")
        written = len(client.app.state.audit.records(tenant="h1", limit=1000))
        assert _retract(client, ids["resp_rate"]).status_code == 409
        assert len(client.app.state.audit.records(tenant="h1", limit=1000)) == written
        (frame,) = _frames(queue)
        assert _view(frame) == _view(_card(client))


class _FailsOnce(InMemoryAuditLog):
    """An append that raises once, for the first row `when` accepts after `armed` — a bounded write timing out —
    and writes nothing for it."""

    def __init__(self, when):
        super().__init__()
        self.when, self.armed = when, False

    def append(self, event):
        if self.armed and self.when(event):
            self.armed = False
            raise RuntimeError("the trail write timed out")
        return super().append(event)


class TestTheTrailBeforeMemoryToTheEnd:
    """Final review (X19, X21): the withdrawal's tail writes its rows before memory forgets, and an «already»
    answer finishes what a failed one left — the latch it kept, the card it never sent."""

    def test_a_failed_entered_in_error_row_keeps_the_latch_and_the_retry_ends_it(self):
        """BASE's rows are withdrawn straight in the trail — they are not bedside values (X22; `_overdue`)."""
        log = _FailsOnce(lambda e: e.event_type == "alert_cleared" and e.payload.get("reason") == ENTERED_IN_ERROR)
        with _app(audit=log) as c:
            ids = _overdue(c)
            assert _retract(c, ids["map"]).status_code == 200              # the overdue latches, on the card
            for code in ("suspected_infection", "platelets"):
                _withdraw_in_trail(c, ids[code])
            log.armed = True
            with pytest.raises(RuntimeError):
                _retract(c, ids["temperature"])                            # the last value: no reading left
            acks = _store(c)
            assert OVERDUE in acks.resolved and OVERDUE in acks.first_seen, \
                "memory forgot before the trail had the row"
            assert ENTERED_IN_ERROR not in {r.payload["reason"] for r in _rows(c, "alert_cleared")}
            r = _retract(c, ids["temperature"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)
            assert OVERDUE not in acks.resolved and OVERDUE not in acks.first_seen
            assert [r.payload["reason"] for r in _rows(c, "alert_cleared")].count(ENTERED_IN_ERROR) == 1

    def test_a_withdrawal_whose_later_step_raised_has_its_card_sent_by_the_retry(self):
        """The row committed and memory was rebuilt; the `alert_cleared` append that followed raised, so no card
        went out. Memory is right, so there is nothing to repair — the retry sends the card, once."""
        log = _FailsOnce(lambda e: e.event_type == "alert_cleared")
        with _app(audit=log) as c:
            ids = _overdue(c)
            queue = c.app.state.broadcaster.subscribe("h1")
            log.armed = True
            with pytest.raises(RuntimeError):
                _retract(c, ids["map"])                                    # the overdue latches: its row raises
            assert _frames(queue) == []                                    # the card never went out
            assert _latched(_card(c)) == ["antibiotic_overdue"]            # memory is right
            r = _retract(c, ids["map"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)
            (frame,) = _frames(queue)
            assert (_latched(frame), frame["latest"]["map"]) == (["antibiotic_overdue"], None)

    def test_a_withdrawal_whose_first_seen_row_raised_is_stamped_and_told_by_the_retry(self):
        """X3 (final review): a wrong RR 16 hid an immediate NEWS2 — RR 26 the one red parameter of a 7 — down to a
        4, which raises nothing; withdrawn, the NEWS2 is a new episode, to be stamped and told. Its `first_seen`
        append raised after `adopt`: the retry, memory being right, writes the row and tells the nurse, once each;
        a second retry writes neither."""
        log = _FailsOnce(lambda e: e.event_type == "first_seen")
        with _app(audit=log) as c:
            # NEWS2 7, immediate; then the wrong RR: NEWS2 4, nothing.
            _chart(c, [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 93},
                       {"code": "sbp", "value": 95}], _ago(10))
            wrong = _chart(c, [{"code": "resp_rate", "value": 16}], _ago(5))["resp_rate"]
            assert "news2" not in _firing(_card(c))
            seen, told = len(_rows(c, "first_seen")), len(_rows(c, "notification"))
            log.armed = True
            with pytest.raises(RuntimeError):
                _retract(c, wrong)
            assert "news2" in _firing(_card(c))                                                  # memory is right
            assert (len(_rows(c, "first_seen")), len(_rows(c, "notification"))) == (seen, told)
            assert ("bed-3", "news2") not in _store(c).first_seen, "stamped with no row behind the stamp"
            for _ in range(2):
                r = _retract(c, wrong)
                assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)
                assert (len(_rows(c, "first_seen")), len(_rows(c, "notification"))) == (seen + 1, told + 1)
            row, note = _rows(c, "first_seen")[-1], _rows(c, "notification")[-1]
            assert (row.subject, note.subject, note.payload["audience"]) == ("news2", "news2", "nurse")
            assert _store(c).first_seen[("bed-3", "news2")].isoformat() == row.payload["at"]


class TestEqualToNeverCharted:
    """Review of Task 5: the engine's whole picture of the patient (`Engine.adopt` replaces it) and the card,
    against a fresh app charted without the withdrawn value."""

    def test_an_older_value_withdrawn_while_a_newer_one_of_its_code_exists(self):
        script = [(RISKY, 10), ([{"code": "resp_rate", "value": 16}], 5)]
        never = [([e for e in RISKY if e["code"] != "resp_rate"], 10), ([{"code": "resp_rate", "value": 16}], 5)]
        before, got, want = _equal_to_never_charted(script, [(0, "resp_rate")], never)
        assert ("resp_rate", 26.0) in [(code, value) for code, value, *_ in before["readings"]]
        assert got == want

    def test_a_map_withdrawn_after_the_anchor_it_set_was_dropped(self):
        """MAP 60 made it sepsis and set the antibiotic anchor; infection charted absent dropped it, and the dropped
        anchor is remembered (X12) — withdrawn, the MAP never set one, so nothing is left to restore."""
        script = [(BASE, 30), ([{"code": "map", "value": 60}], 25),
                  ([{"code": "suspected_infection", "value": 0}], 20)]
        never = [(BASE, 30), ([{"code": "suspected_infection", "value": 0}], 20)]
        before, got, want = _equal_to_never_charted(script, [(1, "map")], never)
        assert before["dropped"] is not None
        assert got == want
