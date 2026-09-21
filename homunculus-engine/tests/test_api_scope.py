"""Scope at the boundary: does the API actually narrow, or was it only ever the screen?

`test_scope_rules.py` fixes the rules. These fix the thing this project keeps getting wrong —
whether anything *calls* them. Every test here goes through HTTP, because the failure being
guarded against is not a wrong rule, it is a right rule nothing reaches: a filter applied to
`/patients` and forgotten on `/alerts`, or applied to both and forgotten on the live stream that
pushes the same patients a second later.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.canonical import Observation, SignalCode
from homunculus.scope import Scope, ScopeReason, build_scope
from homunculus.tenant.bedmap import BedMap

WHEN = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
TOKEN = {"Authorization": "Bearer bridge-token"}
NURSE = {"Authorization": "Bearer nurse-jwt"}

BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"},
    "YB^304^2": {"bed_id": "bed-a2", "unit_id": "unit-adult"},
    "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu"},
}})


def _identities() -> InMemoryIdentityStore:
    store = InMemoryIdentityStore()
    for pid, unit, room, bed in (("p-a1", "YB", "304", "1"),
                                 ("p-a2", "YB", "304", "2"),
                                 ("p-n1", "YYB", "12", "A")):
        store.apply("demo", IdentityRecord(patient_id=pid, given="X", family="Y",
                                           unit=unit, room=room, bed=bed,
                                           source="comed", updated_at=WHEN))
    return store


def app_with(scope: Scope):
    """An app whose every JWT caller resolves to `scope`. The tenant token stays unscoped."""

    async def resolve_scope(_credential: str) -> Scope:
        return scope

    async def resolve_hospital(_credential: str) -> str | None:
        return "demo"

    app = create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                     identities=_identities(), bedmap=BEDMAP,
                     resolve_jwt_hospital=resolve_hospital, resolve_scope=resolve_scope)
    return app


def _admit_everyone(client: TestClient) -> None:
    """One reading per patient, through the bridge's own credential."""
    for pid in ("p-a1", "p-a2", "p-n1"):
        obs = Observation(patient_id=pid, code=SignalCode.SPO2, value=97.0, unit="%",
                          timestamp=WHEN, source_device="nce")
        client.post("/ingest", headers=TOKEN, json={
            "resourceType": "Observation",
            "subject": {"reference": f"Patient/{pid}"},
            "effectiveDateTime": WHEN.isoformat(),
            "code": {"coding": [{"system": "http://loinc.org", "code": "59408-5"}]},
            "valueQuantity": {"value": obs.value, "unit": "%"},
        })


@pytest.fixture
def adult_nurse():
    app = app_with(build_scope("NURSE", unit_ids=["unit-adult"]))
    with TestClient(app) as client:
        _admit_everyone(client)
        yield app, client


class TestATheBoard:
    def test_the_board_carries_only_the_assigned_unit(self, adult_nurse):
        _app, client = adult_nurse
        body = client.get("/patients", headers=NURSE).json()
        assert sorted(p["patient_id"] for p in body["patients"]) == ["p-a1", "p-a2"]

    def test_the_board_says_why_it_is_this_size(self, adult_nurse):
        """An empty ward and a filtered one are the same picture without this block."""
        _app, client = adult_nurse
        body = client.get("/patients", headers=NURSE).json()
        assert body["scope"]["reason"] == ScopeReason.ASSIGNED
        assert body["scope"]["unrestricted"] is False
        assert body["scope"]["hidden"] == 1

    def test_the_machine_credential_still_sees_the_whole_ward(self, adult_nurse):
        """The bridge and the corridor wall board have no user behind them to scope."""
        _app, client = adult_nurse
        body = client.get("/patients", headers=TOKEN).json()
        assert len(body["patients"]) == 3
        assert body["scope"]["reason"] == ScopeReason.TENANT_TOKEN

    def test_a_scope_matching_nothing_is_announced_not_just_empty(self):
        app = app_with(build_scope("NURSE", unit_ids=["unit-that-moved"]))
        with TestClient(app) as client:
            _admit_everyone(client)
            body = client.get("/patients", headers=NURSE).json()
        assert body["patients"] == []
        assert body["scope"]["blind"] is True
        assert "GELMEZ" in body["scope_note"]


class TestBTheRoutesThatNameAPatient:
    """Filtering the list alone is theatre: the list is a list of ids, and a caller who has one
    reaches the patient without it."""

    def test_alerts_for_an_out_of_scope_patient_are_not_served(self, adult_nurse):
        _app, client = adult_nurse
        assert client.get("/alerts/p-n1", headers=NURSE).status_code == 404

    def test_alerts_inside_scope_still_work(self, adult_nurse):
        _app, client = adult_nurse
        assert client.get("/alerts/p-a1", headers=NURSE).status_code == 200

    def test_charting_on_an_out_of_scope_patient_is_refused(self, adult_nurse):
        _app, client = adult_nurse
        response = client.post("/clinical/p-n1", headers=NURSE, json={
            "entries": [{"code": "suspected_infection", "value": 1}]})
        assert response.status_code == 404

    def test_the_profile_route_is_guarded_too(self, adult_nurse):
        _app, client = adult_nurse
        assert client.put("/clinical/p-n1/profile", headers=NURSE,
                          json={"baseline_sofa": 3}).status_code == 404

    def test_the_severity_score_is_guarded_too(self, adult_nurse):
        _app, client = adult_nurse
        assert client.get("/scores/sofa/p-n1", headers=NURSE).status_code == 404

    def test_recording_a_view_of_an_out_of_scope_patient_is_refused(self, adult_nurse):
        """Otherwise a caller can write a false line into the one record an inspection trusts."""
        _app, client = adult_nurse
        assert client.post("/view", headers=NURSE,
                           json={"patient_id": "p-n1", "role": "nurse"}).status_code == 404

    def test_the_refusal_looks_like_an_unknown_patient_not_a_locked_door(self, adult_nurse):
        """403 would confirm the patient exists here — the very fact being withheld."""
        _app, client = adult_nurse
        known = client.get("/alerts/p-n1", headers=NURSE)
        unknown = client.get("/alerts/p-does-not-exist", headers=NURSE)
        assert known.status_code == unknown.status_code == 404


class TestCTheRefusalIsRecorded:
    def test_a_denied_read_lands_in_the_audit_log(self, adult_nurse):
        app, client = adult_nurse
        client.get("/alerts/p-n1", headers=NURSE)
        denied = [r for r in app.state.audit.records(tenant="demo", limit=1000)
                  if r.event_type == "scope_denied"]
        assert [r.patient_id for r in denied] == ["p-n1"]

    def test_a_permitted_read_records_no_denial(self, adult_nurse):
        app, client = adult_nurse
        client.get("/alerts/p-a1", headers=NURSE)
        assert not [r for r in app.state.audit.records(tenant="demo", limit=1000)
                    if r.event_type == "scope_denied"]


class TestDTheLiveFeed:
    """The board is filtered once; the stream pushes the same patients every few seconds."""

    def test_the_ticket_carries_the_scope_it_was_issued_under(self, adult_nurse):
        app, client = adult_nurse
        ticket = client.post("/stream-ticket", headers=NURSE).json()["ticket"]
        _hospital, scope = app.state.tickets.consume(ticket, now=0.0)
        assert scope.unit_ids == frozenset({"unit-adult"})

    def test_a_tenant_token_ticket_is_unscoped(self, adult_nurse):
        app, client = adult_nurse
        ticket = client.post("/stream-ticket", headers=TOKEN).json()["ticket"]
        _hospital, scope = app.state.tickets.consume(ticket, now=0.0)
        assert scope.unrestricted is True

    async def test_the_frame_generator_drops_out_of_scope_boards(self):
        """The filter has to sit in the generator: the broadcaster fans one board out to every
        subscriber of the tenant, so there is nowhere earlier that knows who is listening."""
        import asyncio

        from homunculus.api.app import sse_board_frames
        from homunculus.scope import sees_patient

        scope = build_scope("NURSE", unit_ids=["unit-adult"])
        queue: asyncio.Queue = asyncio.Queue()
        await queue.put({"patient_id": "p-n1",
                         "identity": {"bed_id": "bed-n1", "unit_id": "unit-nicu"}})
        await queue.put({"patient_id": "p-a1",
                         "identity": {"bed_id": "bed-a1", "unit_id": "unit-adult"}})

        frames = sse_board_frames(queue, keepalive=0.05,
                                  allow=lambda b: sees_patient(b, scope))
        first = await anext(frames)
        assert "p-a1" in first and "p-n1" not in first


class TestEWhenNothingIsWired:
    """A deployment that has not wired a resolver keeps today's behaviour, deliberately: the
    pilot's database holds no assignments, and enforcing scope on the day this ships would empty
    every clinical screen in the hospital at once."""

    def test_without_a_resolver_every_caller_sees_the_whole_ward(self):
        async def resolve_hospital(_credential: str) -> str | None:
            return "demo"

        app = create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                         identities=_identities(), bedmap=BEDMAP,
                         resolve_jwt_hospital=resolve_hospital)
        with TestClient(app) as client:
            _admit_everyone(client)
            body = client.get("/patients", headers=NURSE).json()
        assert len(body["patients"]) == 3
        assert body["scope"]["unrestricted"] is True

    def test_an_unassigned_user_is_not_blacked_out(self):
        app = app_with(build_scope("NURSE"))
        with TestClient(app) as client:
            _admit_everyone(client)
            body = client.get("/patients", headers=NURSE).json()
        assert len(body["patients"]) == 3
        assert body["scope"]["reason"] == ScopeReason.UNASSIGNED
