"""Aşama B through the API: the stage `rules` feeds the shadow engine from the readings route,
the board carries `shadow`, the findings route lists the week, and below `rules` none of it
exists (spec D1, D4, D6, D7, D9, D10). Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import profile_from_payload
from homunculus.api.identity import Caller
from homunculus.api.infinity_device_beds import TableFile, TableState
from homunculus.api.infinity_shadow import shadow_settings_from_env
from homunculus.api.monitor_samples import InMemorySamples, PostgresSamples, Sample
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.canonical import SignalCode
from homunculus.scope import Scope, ScopeReason
from homunculus.tenant.bedmap import BedMap, BedRef
from tests.test_infinity_shadow_equivalence import SCEN, _encounter, load_scenario
from tests.test_infinity_shadow_isolation import TABLE, _body as _strip_body

DEVICE, SHADOW, HOSPITAL = "tok-device-00000000000000000000000000", "s" * 40, "h1"
HDR = {"Authorization": f"Bearer {DEVICE}"}
SHDR = {"Authorization": f"Bearer {SHADOW}"}
T0 = 1_800_000_000.0
# The table puts the monitor 192.0.2.10 on bed-b1 (TABLE, from the isolation test); the bed map puts
# the encounter's location YB^1^1 on that bed, so the strip links the monitor to its one patient.
BEDS = {"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")}
# Clinicians as well as the device token: the findings route is scoped like the board.
JWTS = {
    "bed-jwt": Caller(hospital=HOSPITAL, actor="ayse", groups=("nurse",), perms=frozenset({"board.view"})),
    "other-jwt": Caller(hospital=HOSPITAL, actor="zeyneb", groups=("nurse",), perms=frozenset({"board.view"})),
    "tech-jwt": Caller(hospital=HOSPITAL, actor="kamal", groups=("tech",), perms=frozenset({"devices.manage"})),
    "h2-jwt": Caller(hospital="h2", actor="leyla", groups=("nurse",), perms=frozenset({"board.view"})),
}
SCOPES = {"bed-jwt": Scope(False, ScopeReason.ASSIGNED, bed_ids=frozenset({"bed-b1"})),
          "other-jwt": Scope(False, ScopeReason.ASSIGNED, bed_ids=frozenset({"bed-x9"}))}


class Clock:
    """The lane's own clock (epoch s), advanced by the tests; the engine never reads it."""
    t = T0


async def _resolve_jwt(token):
    return JWTS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


def _settings(tmp_path, stage="rules", table=True):
    path = tmp_path / f"device-beds-{stage}.json"
    if table:
        path.write_text(json.dumps(TABLE), encoding="utf-8")
    return shadow_settings_from_env({"INFINITY_CLINICAL_STAGE": stage, "INFINITY_SHADOW_TOKEN": SHADOW,
                                     "INFINITY_SHADOW_HOSPITAL": HOSPITAL,
                                     "INFINITY_DEVICE_BEDS_PATH": str(path)}, {DEVICE: HOSPITAL})


def _app(tmp_path, stage="rules", *, table=True, audit=None, samples=None, identities=None):
    Clock.t = T0
    audit = audit if audit is not None else InMemoryAuditLog()
    samples = samples if samples is not None else InMemorySamples()
    identities = identities if identities is not None else InMemoryIdentityStore()
    app = create_app({DEVICE: HOSPITAL}, run_escalation_loop=False, audit=audit, samples=samples,
                     identities=identities, bedmap=BedMap(dict(BEDS)), shadow=_settings(tmp_path, stage, table),
                     shadow_clock=lambda: Clock.t, resolve_jwt=_resolve_jwt, resolve_scope=_resolve_scope)
    return TestClient(app), audit, samples, identities


def _kabul(store, patient, state="admitted"):
    """What Lane B's admission writes on bed YB/1/1: source `kabul`; discharged, a tombstone. Stamped
    at the wall clock and a second apart, so the discharge is the newer record."""
    at = datetime.now(timezone.utc) + timedelta(seconds=0 if state == "admitted" else 1)
    store.apply(HOSPITAL, IdentityRecord(patient, family="TEST", given="SYNTH", unit="YB", room="1", bed="1",
                                         state=state, source="kabul", updated_at=at))


def _body(now, hr=140.0, spo2=85.0):
    body = _strip_body(now)
    body["devices"][0]["readings"] = [
        {"parameter": "hr", "value": hr, "unit": "bpm", "valid": True, "captured_at": now - 1.0},
        {"parameter": "spo2", "value": spo2, "unit": "%", "valid": True, "captured_at": now - 1.0}]
    return body


def _post(client, **values):
    Clock.t += 2.0                       # past the strip's 1 s spacing, no sleeping
    return client.post("/infinity-shadow/readings", json=_body(Clock.t, **values), headers=SHDR)


def _linked(client):
    """Two bodies: the first pass starts the link and takes nothing — a sample is never taken for a
    time before the link was seen (D5, forward only) — the second takes HR and SpO2."""
    assert _post(client).status_code == 200
    assert _post(client).status_code == 200


def _card(client, pid, headers=HDR):
    return next(p for p in client.get("/patients", headers=headers).json()["patients"] if p["patient_id"] == pid)


def _kinds(audit):
    return [r.event_type for r in audit.records(tenant=HOSPITAL, limit=1000)]


def _all(samples):
    return samples.since(HOSPITAL, datetime.fromtimestamp(0, timezone.utc),
                         now=datetime.fromtimestamp(Clock.t + 3600, timezone.utc))


def _sample(received_at):
    return Sample(HOSPITAL, "bed-1", "bed-b1", "192.0.2.10", SignalCode.HEART_RATE.value, "hr", 80.0, "bpm",
                  received_at, received_at)


# --- the stage `rules` --------------------------------------------------------------------------

def test_rules_feeds_the_shadow_engine_and_the_board_carries_shadow(tmp_path):
    client, audit, samples, _ = _app(tmp_path)
    with client:
        assert client.post("/ingest", json=_encounter("bed-1"), headers=HDR).status_code == 200
        _linked(client)
        card = _card(client, "bed-1")
        assert card["shadow"]["vitals"]["heart_rate"]["value"] == 140.0
        assert card["shadow"]["vitals"]["heart_rate"]["via"] == "hr"
        assert card["shadow"]["vitals"]["spo2"]["source"] == "infinity:192.0.2.10:spo2"
        assert card["shadow"]["news2"]["total"] >= 5
        assert any(f["kind"] == "news2" and f["relation"] == "shadow_only" for f in card["shadow"]["findings"])
        # The REAL picture is untouched: no alert, no risk, no reading in `latest`.
        assert card["alerts"] == [] and card["risk"] == "none" and card["latest"]["heart_rate"] is None
        assert client.get("/alerts/bed-1", headers=HDR).json()["alerts"] == []
        kinds = _kinds(audit)
        assert "shadow_alert" in kinds and "alert" not in kinds and "ingest" not in kinds
        assert len(samples.since(HOSPITAL, datetime.fromtimestamp(Clock.t - 3600, timezone.utc),
                                 now=datetime.fromtimestamp(Clock.t, timezone.utc))) == 2
        strip = client.get("/infinity-shadow/board", headers=HDR).json()
        assert strip["stage"] == "rules" and strip["feed"]["rules_state"] == "ok"


def test_a_patient_the_real_engine_never_measured_stays_unmeasured_there(tmp_path):
    """D1: the sampler's frame and the board give an admitted patient the real engine has never
    measured its identity-only card plus `shadow`. The measured card would create the patient in the
    REAL engine and turn its `news2: null` into a NEWS2 0 nobody measured."""
    client, _, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        assert _post(client).status_code == 200                 # the link starts; nothing is taken yet
        queue = client.app.state.broadcaster.subscribe(HOSPITAL)
        assert _post(client).status_code == 200                 # the first samples: one frame
        frame = queue.get_nowait()
        assert queue.empty(), "one frame for the one patient whose shadow picture changed"
        assert frame["patient_id"] == "bed-1" and frame["shadow"]["findings"]
        assert frame["latest"]["news2"] is None and "sepsis" not in frame
        card = _card(client, "bed-1")
        assert card["latest"]["news2"] is None and "sepsis" not in card and card["shadow"] == frame["shadow"]
        # A minute later the next samples change the picture again; still nothing in the real engine.
        Clock.t += 60.0
        assert _post(client, hr=150.0).status_code == 200
        assert queue.get_nowait()["shadow"]["vitals"]["heart_rate"]["value"] == 150.0
        assert _card(client, "bed-1")["latest"]["news2"] is None


def test_the_findings_route_lists_the_week_and_is_409_below_rules(tmp_path):
    client, _, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _linked(client)
        answer = client.get("/infinity-shadow/findings?days=7", headers=HDR)
        assert answer.status_code == 200, answer.text
        body = answer.json()
        rows = body["findings"]
        assert body["days"] == 7
        assert rows and rows[0]["patient_id"] == "bed-1" and rows[0]["kind"] == "news2"
        assert rows[0]["relation"] == "shadow_only" and rows[0]["cleared_at"] is None
        assert client.get("/infinity-shadow/findings", headers=HDR).json() == body       # 7 is the default
        # Anything but 1–7 is the route's own 400 in its words — not FastAPI's 422 for a non-number.
        for days in ("0", "8", "abc", "7.5", "", "-1"):
            answer = client.get(f"/infinity-shadow/findings?days={days}", headers=HDR)
            assert answer.status_code == 400, (days, answer.status_code)
            assert answer.json()["detail"] == "geçersiz days: 1–7 olmalı", days
        assert client.get("/infinity-shadow/findings?days=1", headers=HDR).json()["days"] == 1
        other = client.get("/infinity-shadow/findings", headers={"Authorization": "Bearer h2-jwt"})
        assert other.status_code == 409 and other.json()["detail"] == {"reason": "stage_not_rules"}
    plain, _, _, _ = _app(tmp_path, stage="shadow")
    with plain:
        answer = plain.get("/infinity-shadow/findings", headers=HDR)
        assert answer.status_code == 409 and answer.json()["detail"] == {"reason": "stage_not_rules"}


def test_the_findings_route_is_scoped_like_the_board(tmp_path):
    client, _, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _linked(client)

        def get(token, path="/infinity-shadow/findings"):
            return client.get(path, headers={"Authorization": f"Bearer {token}"})

        assert [row["patient_id"] for row in get("bed-jwt").json()["findings"]] == ["bed-1"]
        assert get("other-jwt").json()["findings"] == []
        # The same answer the board gives each of them.
        assert [p["patient_id"] for p in get("bed-jwt", "/patients").json()["patients"]] == ["bed-1"]
        assert get("other-jwt", "/patients").json()["patients"] == []
        assert get("tech-jwt").status_code == 403


def test_below_rules_nothing_of_it_exists(tmp_path):
    client, audit, samples, _ = _app(tmp_path, stage="shadow")
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _linked(client)
        assert _card(client, "bed-1")["shadow"] is None
        assert _kinds(audit) == ["identity"]
        assert _all(samples) == []
        assert client.app.state.shadow_lane.engines == {}
        strip = client.get("/infinity-shadow/board", headers=HDR).json()
        assert strip["stage"] == "shadow" and "rules_state" not in strip["feed"]


def test_with_the_table_missing_a_post_changes_nothing_in_the_lane(tmp_path):
    """No valid table is not "every link ended": the pass is skipped and touches nothing."""
    client, audit, samples, _ = _app(tmp_path, table=False)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        for _ in range(3):
            assert _post(client).status_code == 200
        lane = client.app.state.shadow_lane
        assert lane.linked.get(HOSPITAL, {}) == {} and _all(samples) == []
        assert _kinds(audit) == ["identity"]
        assert _card(client, "bed-1")["shadow"] is None
        strip = client.get("/infinity-shadow/board", headers=HDR).json()
        assert strip["table"]["status"] != "ok" and strip["feed"]["rules_state"] == "ok"


def test_a_table_that_goes_bad_ends_no_link(tmp_path, monkeypatch):
    client, audit, samples, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _linked(client)
        lane = client.app.state.shadow_lane
        taken, rows = len(_all(samples)), _kinds(audit)
        monkeypatch.setattr(TableFile, "current",
                            lambda self, now=None: TableState(None, "invalid", "synthetic", None, None))
        Clock.t += 60.0                                   # a sample would be due, had the pass run
        assert _post(client).status_code == 200
        assert "bed-1" in lane.linked[HOSPITAL] and not lane.linked[HOSPITAL]["bed-1"].provisional
        assert len(_all(samples)) == taken and _kinds(audit) == rows        # no sample, no `unlinked`
        assert _card(client, "bed-1")["shadow"]["findings"]


# --- the mirror and the discharge (D1, A-11) -----------------------------------------------------

def test_a_reading_at_ingest_reaches_the_shadow_engine_after_the_real_one(tmp_path):
    client, _, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _linked(client)
        at = datetime.now(timezone.utc) - timedelta(minutes=1)
        reading = {"resourceType": "Observation", "status": "final",
                   "code": {"coding": [{"code": "resp_rate"}]}, "subject": {"reference": "Patient/bed-1"},
                   "effectiveDateTime": at.isoformat(), "valueQuantity": {"value": 26, "unit": "/min"}}
        assert client.post("/ingest", json=reading, headers=HDR).status_code == 200
        shadow_engine = client.app.state.shadow_lane.engines[HOSPITAL]
        assert shadow_engine.state("bed-1").latest(SignalCode.RESP_RATE).value == 26.0
        card = _card(client, "bed-1")
        assert card["latest"]["resp_rate"] == 26.0 and card["latest"]["heart_rate"] is None   # the real one
        assert card["shadow"]["news2"]["breakdown"]["respiration_rate"] > 0     # the shadow NEWS2 counts it

def test_a_clinical_write_is_mirrored_and_a_discharge_forgets_in_both(tmp_path):
    identities = InMemoryIdentityStore()
    _kabul(identities, "bed-1")
    client, audit, _, _ = _app(tmp_path, identities=identities)
    with client:
        _linked(client)
        lane = client.app.state.shadow_lane
        shadow_engine = lane.engines[HOSPITAL]
        charted = client.post("/clinical/bed-1", json={"entries": [{"code": "suspected_infection", "value": 1}]},
                              headers=HDR)
        assert charted.status_code == 200, charted.text
        assert shadow_engine.state("bed-1").latest(SignalCode.SUSPECTED_INFECTION).value == 1.0
        profile = client.put("/clinical/bed-1/profile", json={"comorbidities": ["copd"]}, headers=HDR)
        assert profile.status_code == 200, profile.text
        assert "copd" in shadow_engine.profile("bed-1").comorbidities
        assert lane.recent_findings(HOSPITAL, since=datetime.now(timezone.utc) - timedelta(days=1))
        # A discharge made here (A-11): Lane B's tombstone write, then its call to retire.
        _kabul(identities, "bed-1", state="discharged")
        client.portal.call(client.app.state.retire_patient, HOSPITAL, "bed-1")
        assert "bed-1" not in shadow_engine.patient_ids()
        cleared = audit.records(tenant=HOSPITAL, event_type="shadow_alert_cleared", limit=10)
        assert cleared and {r.payload["reason"] for r in cleared} == {"discharged"}
        week = lane.recent_findings(HOSPITAL, since=datetime.now(timezone.utc) - timedelta(days=1))
        assert week and all(row["cleared_at"] is not None for row in week)


def test_a_discharge_drops_the_occupants_cache_at_once(tmp_path):
    """The strip's occupants are cached for 10 s; a discharge must not leave the retired number
    on its bed for that long — nor be sampled on the next body."""
    identities = InMemoryIdentityStore()
    _kabul(identities, "bed-1")
    client, _, samples, _ = _app(tmp_path, identities=identities)
    with client:
        _linked(client)
        assert client.get("/infinity-shadow/board", headers=HDR).json()["beds"][0]["patient_id"] == "bed-1"
        taken = len(_all(samples))
        _kabul(identities, "bed-1", state="discharged")
        client.portal.call(client.app.state.retire_patient, HOSPITAL, "bed-1")
        bed = client.get("/infinity-shadow/board", headers=HDR).json()["beds"][0]   # the same lane instant
        assert (bed["link"], bed["patient_id"]) == ("none", None)
        assert _post(client).status_code == 200
        Clock.t += 60.0                                   # a minute on: a sample would be due
        assert _post(client).status_code == 200
        assert len(_all(samples)) == taken
        assert "bed-1" not in client.app.state.shadow_lane.engines[HOSPITAL].patient_ids()


def test_a_republish_the_lane_asks_for_after_a_discharge_here_is_the_removal(tmp_path, monkeypatch):
    """Merge with G2-B1a: a settle the lane retries on a later pass reports the retired number as
    changed, and the sampler republishes it. The real engine has forgotten the patient, so the frame
    would be the identity-only card — of a `kabul` tombstone, which keeps the name (A-16): the
    discharged patient back on every screen (A-29). It is the tombstone's removal, as
    `patient_board` answers it: no name, no shadow key."""
    identities = InMemoryIdentityStore()
    _kabul(identities, "bed-1")
    client, _, _, _ = _app(tmp_path, identities=identities)
    with client:
        _linked(client)
        _kabul(identities, "bed-1", state="discharged")
        client.portal.call(client.app.state.retire_patient, HOSPITAL, "bed-1")
        lane = client.app.state.shadow_lane
        monkeypatch.setattr(lane, "sample", lambda *a, **k: ["bed-1"])     # the retried settle's report
        queue = client.app.state.broadcaster.subscribe(HOSPITAL)
        assert _post(client).status_code == 200
        frame = queue.get_nowait()
        assert queue.empty()
        assert (frame["patient_id"], frame["removed"]) == ("bed-1", True)
        assert "shadow" not in frame and "SYNTH" not in repr(frame)
        assert "bed-1" not in client.app.state.shadow_lane.engines[HOSPITAL].patient_ids()


def test_an_adt_transfer_through_ingest_moves_the_link_on_the_next_body(tmp_path):
    """T6 review: only a discharge made here dropped the occupants' 10 s cache, so an ADT transfer
    left the old patient linked — and sampled — for up to 10 s. Every identity write through /ingest
    drops it: the next body links the bed's new occupant and ends the old link."""
    client, audit, samples, _ = _app(tmp_path)
    with client:
        assert client.post("/ingest", json=_encounter("bed-1"), headers=HDR).status_code == 200
        _linked(client)                                   # bed-1 on bed-b1, its link confirmed
        lane = client.app.state.shadow_lane
        assert set(lane.linked[HOSPITAL]) == {"bed-1"}
        # The transfer, 2 s after the cache was filled: bed-1 to a bed the map does not cover, bed-2 in.
        assert client.post("/ingest", json=_encounter("bed-1", "YB^9^9"), headers=HDR).status_code == 200
        assert client.post("/ingest", json=_encounter("bed-2"), headers=HDR).status_code == 200
        assert _post(client).status_code == 200
        assert set(lane.linked[HOSPITAL]) == {"bed-2"}
        cleared = audit.records(tenant=HOSPITAL, event_type="shadow_alert_cleared", limit=10)
        assert [(r.patient_id, r.payload["reason"]) for r in cleared] == [("bed-1", "unlinked")]
        bed = client.get("/infinity-shadow/board", headers=HDR).json()["beds"][0]
        assert (bed["link"], bed["patient_id"]) == ("one", "bed-2")
        Clock.t += 60.0                                   # a minute on: bed-2's samples, none of bed-1's
        assert _post(client).status_code == 200
        assert {s.patient_id for s in _all(samples) if s.received_at.timestamp() > Clock.t - 30.0} == {"bed-2"}


def test_lane_bs_admission_can_drop_the_occupants_cache(tmp_path):
    """The hook Lane B's admission (`kabul`) calls after its identity write, as its discharge calls
    `retire_patient`: the next body sees the admitted patient on the bed at once."""
    identities = InMemoryIdentityStore()
    client, _, _, _ = _app(tmp_path, identities=identities)
    with client:
        assert _post(client).status_code == 200           # the cache filled: nobody on bed-b1
        bed = client.get("/infinity-shadow/board", headers=HDR).json()["beds"][0]
        assert (bed["link"], bed["patient_id"]) == ("none", None)
        _kabul(identities, "bed-1")                       # Lane B's admission writes the store...
        assert client.app.state.shadow_occupancy_reset(HOSPITAL) is None    # ...and drops the cache
        assert _post(client).status_code == 200
        assert set(client.app.state.shadow_lane.linked[HOSPITAL]) == {"bed-1"}


def test_lane_bs_admission_can_mirror_its_profile_to_the_shadow_engine(tmp_path):
    """The hook Lane B's admission calls after its `set_profile` (final review), as
    `PUT /clinical/{pid}/profile` mirrors its own: the shadow engine judges against the same
    profile. Guarded, and it writes nothing — the admission audits its profile itself."""
    identities = InMemoryIdentityStore()
    _kabul(identities, "bed-1")
    client, audit, _, _ = _app(tmp_path, identities=identities)
    with client:
        _linked(client)
        lane = client.app.state.shadow_lane
        profile = profile_from_payload("bed-1", {"comorbidities": ["copd"]})
        written = _kinds(audit)
        assert client.app.state.shadow_profile(HOSPITAL, profile) is None
        assert lane.engines[HOSPITAL].profile("bed-1") == profile
        assert _kinds(audit) == written and lane.state == "ok"


def test_the_profile_door_audits_before_it_mirrors_and_a_raising_mirror_leaves_the_row(
        tmp_path, monkeypatch):
    """Lane B's review of 457a2bd (M-1): `PUT /clinical/{pid}/profile` writes its `profile` audit
    row before the shadow lane hears the profile. The lane's guard swallows a failure, so the
    order is the point: the row is already there when the lane is called, and a lane that raises
    leaves the row a restart replays and an answer as if it were not there."""
    identities = InMemoryIdentityStore()
    _kabul(identities, "bed-1")
    client, audit, _, _ = _app(tmp_path, identities=identities)
    with client:
        lane = client.app.state.shadow_lane
        heard: list[bool] = []

        def boom(hospital, profile):
            heard.append("profile" in _kinds(audit))
            raise RuntimeError("synthetic lane failure")

        monkeypatch.setattr(lane, "mirror_profile", boom)
        put = client.put("/clinical/bed-1/profile", json={"comorbidities": ["copd"]}, headers=HDR)
        assert put.status_code == 200, put.text
        assert put.json()["comorbidities"] == ["copd"]
        assert heard == [True]                           # the row was there when the lane was called
        (row,) = audit.records(tenant=HOSPITAL, event_type="profile", patient_id="bed-1", limit=10)
        assert row.payload["comorbidities"] == ["copd"]


def test_a_failing_shadow_install_keeps_the_real_engine_and_answers_200(tmp_path):
    """The guard around the lane's install in `_ensure` (D1): the samples' read fails at start-up —
    the clinical request still answers 200 with the real engine installed, the device screen reads
    the error, and after the lane's retry wait the next readings body installs the shadow engine."""
    class Flaky(InMemorySamples):
        failures = 1

        def since(self, hospital, since, *, now):
            if self.failures:
                self.failures -= 1
                raise RuntimeError("monitor_samples: not reachable yet")
            return super().since(hospital, since, now=now)

    client, _, _, _ = _app(tmp_path, samples=Flaky())
    with client:
        assert client.post("/ingest", json=_encounter("bed-1"), headers=HDR).status_code == 200
        lane = client.app.state.shadow_lane
        assert HOSPITAL in client.app.state.ack_stores and HOSPITAL not in lane.engines   # the real one only
        assert lane.state == "error"
        assert [p["patient_id"] for p in client.get("/patients", headers=HDR).json()["patients"]] == ["bed-1"]
        assert client.get("/infinity-shadow/board", headers=HDR).json()["feed"]["rules_state"] == "error"
        Clock.t += 29.0                                   # +31 s with the body's 2 s: past INSTALL_RETRY_S
        assert _post(client).status_code == 200
        assert HOSPITAL in lane.engines and "bed-1" in lane.linked[HOSPITAL]


def test_a_lane_failure_never_fails_the_clinical_request(tmp_path, monkeypatch):
    client, _, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        lane = client.app.state.shadow_lane

        def boom(*a, **k):
            raise RuntimeError("x")

        monkeypatch.setattr(lane, "mirror_observation", boom)
        monkeypatch.setattr(lane, "sample", boom)
        _ts, fhir = load_scenario(SCEN / "news2_deterioration.yaml")[0]
        fhir["subject"]["reference"] = "Patient/bed-1"
        assert client.post("/ingest", json=fhir, headers=HDR).status_code == 200
        assert client.post("/clinical/bed-1", json={"entries": [{"code": "suspected_infection", "value": 1}]},
                           headers=HDR).status_code == 200
        assert _post(client).status_code == 200
        assert lane.state == "error"
        assert client.get("/infinity-shadow/board", headers=HDR).json()["feed"]["rules_state"] == "error"
        # The real engine took both.
        card = _card(client, "bed-1")
        assert any(at is not None for at in card["latest"]["at"].values()) and card["shadow"] is None


# --- below `rules`, the restart, the prune (D9, D10, D8) ------------------------------------------

def test_below_rules_the_first_touch_closes_what_a_rules_run_left_open(tmp_path):
    audit = InMemoryAuditLog()
    opened = audit.append(AuditEvent(HOSPITAL, "shadow_alert", "bed-1", "news2",
                                     {"severity": "high", "urgency": "urgent", "summary": "synthetic",
                                      "evidence": [], "sources": ["infinity:192.0.2.10:hr"],
                                      "relation": "shadow_only", "at": "2027-01-15T08:00:00+00:00"}))
    client, _, _, _ = _app(tmp_path, stage="shadow", audit=audit)
    with client:
        assert client.get("/patients", headers=HDR).status_code == 200
        assert client.get("/patients", headers=HDR).status_code == 200
    rows = audit.records(tenant=HOSPITAL, event_type="shadow_alert_cleared", limit=10)
    assert [(r.patient_id, r.subject, r.payload["reason"], r.payload["opened_id"]) for r in rows] == [
        ("bed-1", "news2", "stage", opened.id)]
    # A restart below `rules` finds nothing open: the row is written once.
    again, _, _, _ = _app(tmp_path, stage="off", audit=audit)
    with again:
        assert again.get("/patients", headers=HDR).status_code == 200
    assert len(audit.records(tenant=HOSPITAL, event_type="shadow_alert_cleared", limit=10)) == 1


def test_a_restart_rebuilds_the_shadow_picture_and_opens_nothing_twice(tmp_path):
    audit, samples, identities = InMemoryAuditLog(), InMemorySamples(), InMemoryIdentityStore()
    client, _, _, _ = _app(tmp_path, audit=audit, samples=samples, identities=identities)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _linked(client)
        before = _card(client, "bed-1")["shadow"]
    lane_now = Clock.t
    opened = len(audit.records(tenant=HOSPITAL, event_type="shadow_alert", limit=100))
    again, _, _, _ = _app(tmp_path, audit=audit, samples=samples, identities=identities)
    Clock.t = lane_now                                     # the lane's clock goes on across the restart
    with again:
        # Rebuilt from the 24 h of samples, the link provisional until a card confirms it (D5, D9).
        assert _card(again, "bed-1")["shadow"] is None
        assert _post(again).status_code == 200
        after = _card(again, "bed-1")["shadow"]
        assert after["vitals"] == before["vitals"]
        assert [(f["kind"], f["severity"], f["since"]) for f in after["findings"]] == [
            (f["kind"], f["severity"], f["since"]) for f in before["findings"]]
    assert len(audit.records(tenant=HOSPITAL, event_type="shadow_alert", limit=100)) == opened


class _Watched(InMemorySamples):
    """A store that records each prune's bound and whether it ran on the event loop's thread."""

    def __init__(self, durable=False, error=None):
        super().__init__()
        self.durable, self.error = durable, error
        self.pruned: list[tuple[datetime, bool]] = []

    def prune(self, *, before):
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:                               # a worker thread has no running loop
            on_loop = False
        self.pruned.append((before, on_loop))
        if self.error is not None:
            raise self.error
        return super().prune(before=before)


def _wait(condition):
    deadline = time.monotonic() + 5.0
    while not condition() and time.monotonic() < deadline:
        time.sleep(0.02)
    return condition()


def test_in_memory_at_rules_the_prune_keeps_the_replay_window_on_the_loop(tmp_path):
    """T6 review: in memory the store kept 30 days (nothing reads them after the install) and its
    prune ran in a worker thread, racing `append` on the loop. It keeps the 24 h an install replays,
    and prunes on the loop — at start-up, then hourly."""
    samples = _Watched()
    lane_now = datetime.fromtimestamp(T0, timezone.utc)
    old, fresh = _sample(lane_now - timedelta(hours=25)), _sample(lane_now - timedelta(hours=1))
    samples.append(old)
    samples.append(fresh)
    client, _, _, _ = _app(tmp_path, samples=samples)
    with client:
        assert _wait(lambda: samples.pruned)
        assert samples.pruned[0] == (lane_now - timedelta(hours=24), True)
        assert _all(samples) == [fresh]


@pytest.mark.parametrize("stage", ["off", "shadow", "rules"])
def test_a_durable_store_is_pruned_at_every_stage_off_the_loop(tmp_path, stage):
    """T6 review: the table and its prune existed only at `rules`, so after a rollback to `shadow` or
    `off` the rows a `rules` run wrote were never deleted. A durable store is pruned whatever the
    stage — 30 days, off the loop."""
    samples = _Watched(durable=True)
    client, _, _, _ = _app(tmp_path, stage=stage, samples=samples)
    with client:
        assert _wait(lambda: samples.pruned), stage
        assert samples.pruned[0] == (datetime.fromtimestamp(T0, timezone.utc) - timedelta(days=30), False)


def test_below_rules_a_store_in_memory_has_no_prune_loop(tmp_path):
    """Below `rules` nothing writes to a store in memory, so nothing is started to prune it."""
    samples = _Watched()
    client, _, _, _ = _app(tmp_path, stage="shadow", samples=samples)
    with client:
        time.sleep(0.2)                                    # the start-up pass would have run by now
        assert samples.pruned == []


def test_a_missing_table_is_logged_and_skipped_each_hour(tmp_path, caplog):
    """Migration 0013 not applied: the table's DELETE fails each hour. One WARNING per pass, naming
    the migration, and the loop goes on — a prune is never a reason for anything else to stop."""
    from sqlalchemy.exc import ProgrammingError

    class UndefinedTable(Exception):
        pgcode = "42P01"                                   # psycopg2's undefined_table

    missing = ProgrammingError("DELETE FROM monitor_samples", {}, UndefinedTable('relation "monitor_samples" does not exist'))
    samples = _Watched(durable=True, error=missing)
    client, _, _, _ = _app(tmp_path, stage="shadow", samples=samples)
    with caplog.at_level("WARNING", logger="homunculus.api.app"), client:
        assert _wait(lambda: samples.pruned)
        client.portal.call(client.app.state.prune_samples)    # the next hour's pass
        assert len(samples.pruned) == 2
        warned = [r for r in caplog.records if "0013" in r.getMessage()]
        assert len(warned) == 2 and all(r.levelname == "WARNING" and r.exc_info is None for r in warned)
    other = _Watched(durable=True, error=RuntimeError("the database is down"))
    client, _, _, _ = _app(tmp_path, stage="shadow", samples=other)
    caplog.clear()
    with caplog.at_level("ERROR", logger="homunculus.api.app"), client:
        assert _wait(lambda: other.pruned)
        client.portal.call(client.app.state.prune_samples)      # does not raise
        assert [r.exc_info is not None for r in caplog.records if "monitor_samples" in r.getMessage()] == [True, True]


def test_prodserver_keeps_the_samples_in_postgres_whenever_the_database_is_postgres():
    """At every stage (T6 review): the stage is not an input — a rollback below `rules` keeps
    pruning the table a `rules` run filled."""
    from homunculus.api import prodserver

    durable = prodserver._samples("postgresql+asyncpg://homunculus@db/homunculus")
    try:
        assert isinstance(durable, PostgresSamples) and durable.durable
    finally:
        durable.dispose()
    assert isinstance(prodserver._samples(""), InMemorySamples)
    assert isinstance(prodserver._samples("sqlite:///x.db"), InMemorySamples)
