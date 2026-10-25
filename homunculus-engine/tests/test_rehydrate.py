# tests/test_rehydrate.py
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.ackstore import AckStore
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.rehydrate import rehydrate
from homunculus.pipeline import Engine

T0 = "2026-07-14T10:00:00+00:00"

_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100.0), ("crystalloid_bolus_ml", 3000.0),
          ("map", 60.0), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def _audit_with_shock(tenant="HOSP1", patient="bed-3"):
    audit = InMemoryAuditLog()
    for slug, val in _SHOCK:
        audit.append(AuditEvent(tenant, "ingest", patient, slug,
                                {"value": val, "unit": "", "obs_ts": T0, "device": "mon"}))
    return audit


def test_rehydrate_replays_ingests_into_alerts():
    audit = _audit_with_shock()
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    kinds = {a.kind for a in engine.active_alerts("bed-3")}
    assert "septic_shock" in kinds


def test_rehydrate_replays_acks():
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock",
                            {"role": "doctor", "at": T0}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert ("bed-3", "septic_shock") in store.acks
    assert store.acks[("bed-3", "septic_shock")]["by"] == "doctor"


def test_rehydrate_ignores_non_replayable_events():
    audit = InMemoryAuditLog()
    audit.append(AuditEvent("HOSP1", "alert", "bed-3", "septic_shock", {"severity": "critical"}))
    audit.append(AuditEvent("HOSP1", "notification", "bed-3", "septic_shock", {"audience": "nurse"}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))   # must not raise
    assert engine.active_alerts("bed-3") == []


def test_rehydrate_writes_no_new_audit_records():
    audit = _audit_with_shock()
    before = len(audit.records(tenant="HOSP1"))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert len(audit.records(tenant="HOSP1")) == before   # replay does not re-audit


def _replayed_by(role):
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock", {"role": role, "at": T0}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    return store.acks[("bed-3", "septic_shock")]["by"]


def test_a_replayed_role_that_is_not_a_short_string_is_unknown():
    """Rows written before the device role was bounded may hold anything the body sent. The
    legacy board renders `acknowledged_by` as text; a dict there breaks the render."""
    for role in ({"name": "dr.x"}, ["nurse"], 7, None, "", "r" * 129):
        assert _replayed_by(role) == "unknown", role


def test_a_replayed_username_survives_whole():
    """128, not the device path's 64: a signed-in user's username may be that long."""
    assert _replayed_by("ayse") == "ayse"
    assert _replayed_by("u" * 128) == "u" * 128
    assert _replayed_by("r" * 64) == "r" * 64


# --- G2-A1 (O17): the replay runs the lifecycle hook the doors run --------------------------------

SHOCK = ("bed-3", "septic_shock")


def _latched_audit():
    """The shock fires and is first seen; then the lactate is back under 2 and nobody had
    acknowledged it — live, it latched."""
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "first_seen", "bed-3", "septic_shock", {"at": T0}))
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "lactate",
                            {"value": 1.5, "unit": "", "obs_ts": T0, "device": "lab"}))
    return audit


def test_a_critical_that_resolved_unacknowledged_is_latched_again_by_the_replay():
    audit = _latched_audit()
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert "septic_shock" not in {a.kind for a in engine.active_alerts("bed-3")}
    assert set(store.resolved) == {SHOCK}
    assert store.resolved[SHOCK]["resolved_at"] == datetime.fromisoformat(audit.records(tenant="HOSP1")[-1].ts)
    assert store.first_seen[SHOCK] == datetime.fromisoformat(T0)


def test_an_ack_row_for_a_latched_alert_removes_it_on_replay_and_is_no_acknowledgement():
    audit = _latched_audit()
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock", {"role": "ayse", "at": T0}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert store.resolved == {}
    assert SHOCK not in store.first_seen and SHOCK not in store.acks


def test_a_replay_starts_every_escalation_chain_over_at_its_episodes_first_seen():
    """G2-A1, X13: the escalation chain is not in the audit log. Replayed, an episode's clock is its
    own `first_seen` row and no cleared chain is remembered: after a restart a chain starts over, as
    `paged` and `escalated` do."""
    audit = _audit_with_shock()
    for kind in ("septic_shock", "sepsis"):
        audit.append(AuditEvent("HOSP1", "first_seen", "bed-3", kind, {"at": T0}))
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "suspected_infection",
                            {"value": 0.0, "unit": "", "obs_ts": T0, "device": "lab"}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert set(store.resolved) == {SHOCK}, "the shock latched; sepsis (HIGH) ended"
    assert store.clock_from == store.first_seen == {SHOCK: datetime.fromisoformat(T0)}
    assert store.recent == {}, "sepsis ended inside the replay: its chain is not carried past the restart"


def test_an_ack_row_for_a_kind_that_is_not_live_does_not_answer_a_later_episode():
    """The live door answers 404 to an ack for an alert that is neither firing nor latched, so such
    a row is not an acknowledgement of anything — and recorded, a later episode of the same kind
    would inherit it."""
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "suspected_infection",
                            {"value": 0.0, "unit": "", "obs_ts": T0, "device": "lab"}))   # sepsis ends
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "sepsis", {"role": "ayse", "at": T0}))
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "suspected_infection",
                            {"value": 1.0, "unit": "", "obs_ts": T0, "device": "lab"}))   # and returns
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert "sepsis" in {a.kind for a in engine.active_alerts("bed-3")}
    assert ("bed-3", "sepsis") not in store.acks, "a new episode: nobody has answered it"


def test_a_latch_made_by_clinical_requests_survives_a_restart():
    """`chart` rows run through the same hook as `ingest` rows. Without it the replay would drop a
    critical that charting ended — the antibiotic given, the infection ruled out — while the ward
    still has it on its board, unacknowledged."""
    audit = InMemoryAuditLog()
    hdr = {"Authorization": "Bearer tok"}
    start = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)

    def boot():
        app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit)
        client = TestClient(app)
        client.get("/patients", headers=hdr)          # builds the tenant: rehydrated from the audit
        return app, client

    def chart(client, entries, minute):
        r = client.post("/clinical/bed-3", headers=hdr, json={
            "entries": entries, "recorded_at": (start + timedelta(minutes=minute)).isoformat()})
        assert r.status_code == 200, r.text

    live_app, live = boot()
    chart(live, [{"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                 {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50}], 0)
    chart(live, [{"code": "crystalloid_bolus_ml", "value": 1600}], 1)
    chart(live, [{"code": "suspected_infection", "value": 0}], 10)       # the shock's rule stops
    live_store = live_app.state.ack_stores["HOSP1"]
    assert set(live_store.resolved) == {SHOCK}

    restarted_app, _ = boot()
    again = restarted_app.state.ack_stores["HOSP1"]
    assert set(again.resolved) == set(live_store.resolved)
    assert again.resolved[SHOCK]["alert"] == live_store.resolved[SHOCK]["alert"]


def test_a_restart_rebuilds_the_board_the_ward_had_episode_by_episode():
    """Fire, clear, re-fire, acknowledge — through the API, then a fresh engine and store from its
    audit trail. The replay must hand each episode its own stamp and its own answer: the one a
    restart got wrong before (the code map's question 1)."""
    import json
    from datetime import timedelta
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app
    from homunculus.api.audit import AuditRecord
    from homunculus.api.board import patient_board

    start = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    client = TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False))
    hdr = {"Authorization": "Bearer tok"}

    def reading(code, value, minute):
        fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
                "subject": {"reference": "Patient/bed-3"},
                "effectiveDateTime": (start + timedelta(minutes=minute)).isoformat(),
                "valueQuantity": {"value": value, "unit": ""}}
        assert client.post("/ingest", json=fhir, headers=hdr).status_code == 200

    def ack(kind):
        assert client.post("/ack", json={"patient_id": "bed-3", "kind": kind, "role": "nurse"},
                           headers=hdr).status_code == 200

    for code, value in _SHOCK:
        reading(code, value, 0)                   # episode 1 of the shock, unanswered
    reading("lactate", 1.5, 1)                    # it latches
    ack("septic_shock")                           # and the ack removes it
    reading("lactate", 3.4, 2)                    # episode 2
    ack("septic_shock")
    reading("lactate", 1.5, 3)                    # it leaves, answered
    reading("lactate", 3.6, 4)                    # episode 3, unanswered
    reading("lactate", 1.4, 5)                    # it latches
    reading("heart_rate", 140, 6)                 # NEWS2: fires,
    reading("heart_rate", 80, 7)                  # ends,
    reading("heart_rate", 140, 8)                 # and fires again

    def alerts(board):
        board = json.loads(json.dumps(board))
        return [{**a, "resolved_at": a["resolved_at"] is not None} for a in board["alerts"]], board["risk"]

    live = next(b for b in client.get("/patients", headers=hdr).json()["patients"]
                if b["patient_id"] == "bed-3")
    records = [AuditRecord(**r) for r in client.get(
        "/audit", params={"limit": 100000}, headers=hdr).json()["records"]]
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, records)
    assert alerts(patient_board(engine, "bed-3", store)) == alerts(live)
    stamps = [r.payload["at"] for r in records if r.event_type == "first_seen" and r.subject == "septic_shock"]
    assert len(stamps) == 3
    shock = next(a for a in live["alerts"] if a["kind"] == "septic_shock")
    assert (shock["first_seen_at"], shock["acknowledged"]) == (stamps[-1], False), \
        "the latch is episode 3's: its own stamp, and no answer inherited from episode 2"


def test_a_restart_replays_every_row_a_page_at_a_time(monkeypatch):
    """G2-A2 (D12): the replay read the first 1 000 000 rows in one go, and on a large tenant the rows
    it dropped were the newest — the current state. It reads every row by id now, a page at a time;
    a page of 5 here stands for the real 5000."""
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "REHYDRATE_PAGE", 5)
    reads: list[dict] = []

    class Counting(InMemoryAuditLog):
        def records(self, **kw):
            reads.append(kw)
            return super().records(**kw)

    audit = Counting()
    for minute, rate in enumerate([80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 140]):
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "heart_rate", {
            "value": rate, "unit": "/min", "obs_ts": f"2026-07-14T10:{minute:02d}:00+00:00",
            "device": "mon"}))
    client = TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit))
    [card] = client.get("/patients", headers={"Authorization": "Bearer tok"}).json()["patients"]
    assert card["latest"]["heart_rate"] == 140, "the newest row is the board's"
    assert {a["kind"] for a in card["alerts"]} == {"news2"}
    replay = [r for r in reads if r.get("tenant") == "HOSP1" and "after_id" in r]
    assert [(r["after_id"], r["limit"]) for r in replay] == [(None, 5), (5, 5), (10, 5)]


def test_a_replay_that_fails_midway_installs_nothing_and_the_next_request_retries(monkeypatch):
    """G2-A2, Task 4 review: the tenant was marked rehydrated, and its engine built, BEFORE the replay
    ran — so a page read that failed (a database hiccup; ~200 reads at a million rows) answered 500
    once and the next request served the half-replayed engine as the board: an old heart rate and
    the NEWS2 alert gone — believable, and wrong. A failed replay installs nothing; the next request
    reads the log again, from the first row."""
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "REHYDRATE_PAGE", 5)

    class FailsOnce(InMemoryAuditLog):
        def __init__(self):
            super().__init__()
            self.after_ids: list = []
            self.failed = False

        def records(self, **kw):
            self.after_ids.append(kw.get("after_id"))
            if kw.get("after_id") == 5 and not self.failed:      # the second page, once
                self.failed = True
                raise RuntimeError("page read failed")
            return super().records(**kw)

    audit = FailsOnce()
    for minute, rate in enumerate([80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 140]):
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "heart_rate", {
            "value": rate, "unit": "/min", "obs_ts": f"2026-07-14T10:{minute:02d}:00+00:00",
            "device": "mon"}))
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit)
    client = TestClient(app, raise_server_exceptions=False)
    hdr = {"Authorization": "Bearer tok"}

    assert client.get("/patients", headers=hdr).status_code == 500
    assert "HOSP1" not in app.state.ack_stores, "a replay that did not finish installed its store"

    again = client.get("/patients", headers=hdr)
    assert again.status_code == 200
    [card] = again.json()["patients"]
    assert card["latest"]["heart_rate"] == 140, "the retry replayed every row, the newest included"
    assert {a["kind"] for a in card["alerts"]} == {"news2"}
    assert audit.after_ids == [None, 5, None, 5, 10], "the retry reads the log from the first row"


def test_a_reading_stamped_in_the_future_is_replayed_at_the_instant_the_door_judged_it():
    """G2-A2 (X10b). The doors judge a reading at its own stamp but never past the wall clock (X10);
    the replay judged it at its stamp. A device clock 30 minutes ahead, then a restart: the replay
    aged the resp rate, pulse and pressure to the future stamp, so the ward's NEWS2 8 came back
    held, and it moved the antibiotic anchor 30 minutes on. The replay judges at the earlier of the
    stamp and the row's write time — the door's wall clock, to within the request. Synthetic."""
    import json
    audit = InMemoryAuditLog()
    hdr = {"Authorization": "Bearer tok"}
    wall = datetime.now(timezone.utc)

    def boot():
        return TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit))

    def reading(client, code, value, at):
        fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
                "subject": {"reference": "Patient/bed-3"}, "effectiveDateTime": at.isoformat(),
                "valueQuantity": {"value": value, "unit": ""}}
        assert client.post("/ingest", json=fhir, headers=hdr).status_code == 200

    def board(client):
        return json.loads(json.dumps(next(b for b in client.get("/patients", headers=hdr).json()["patients"]
                                          if b["patient_id"] == "bed-3")))

    def alerts(b):
        return [{**a, "resolved_at": a["resolved_at"] is not None} for a in b["alerts"]]

    live = boot()
    for code, value in [("resp_rate", 25), ("heart_rate", 120), ("sbp", 88)] + _SHOCK[1:]:
        reading(live, code, value, wall - timedelta(minutes=50))          # NEWS2 8, and a shock
    reading(live, "suspected_infection", 1.0, wall + timedelta(minutes=30))   # a clock 30 min ahead
    before = board(live)
    news2 = next(a for a in before["alerts"] if a["kind"] == "news2")
    assert (news2["severity"], news2["urgency"]) == ("high", "immediate")
    assert "Held" not in news2["clinical_reasoning"]

    after = board(boot())                                                  # the restart
    assert alerts(after) == alerts(before)
    anchors = [datetime.fromisoformat(b["meds"]["antibiotic_clock"]["recognized_at"])
               for b in (before, after)]
    assert abs(anchors[1] - anchors[0]) < timedelta(seconds=1), "the row is written after the judgement"
