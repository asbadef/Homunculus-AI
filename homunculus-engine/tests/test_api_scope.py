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
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.canonical import Observation, SignalCode
from homunculus.scope import Scope, ScopeReason, build_scope
from homunculus.tenant.bedmap import BedMap

WHEN = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
TOKEN = {"Authorization": "Bearer bridge-token"}
NURSE = {"Authorization": "Bearer nurse-jwt"}

# The nurse is a signed-in person with the default nurse group's permissions: scope narrows
# *whom* she sees, the permissions decide *what* she may do, and these tests are about the first.
NURSE_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "nurse"))


async def resolve_nurse(_credential: str) -> Caller:
    return Caller(hospital="demo", actor="nurse-1", groups=("nurse",), perms=NURSE_PERMS)


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


def app_with(scope: Scope, perms: frozenset[str] = NURSE_PERMS):
    """An app whose every JWT caller resolves to `scope`, holding `perms` (the nurse's by
    default). The tenant token stays unscoped."""

    async def resolve_scope(_credential: str) -> Scope:
        return scope

    async def resolve_jwt(_credential: str) -> Caller:
        return Caller(hospital="demo", actor="nurse-1", groups=("nurse",), perms=perms)

    app = create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                     identities=_identities(), bedmap=BEDMAP,
                     resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)
    return app


def _reading(client: TestClient, pid: str, spo2: float = 97.0) -> None:
    """One SpO2 reading through the bridge's own credential. 85 % raises a NEWS2 alert."""
    obs = Observation(patient_id=pid, code=SignalCode.SPO2, value=spo2, unit="%",
                      timestamp=WHEN, source_device="nce")
    r = client.post("/ingest", headers=TOKEN, json={
        "resourceType": "Observation",
        "subject": {"reference": f"Patient/{pid}"},
        "effectiveDateTime": WHEN.isoformat(),
        "code": {"coding": [{"code": "spo2"}]},   # the gateway reads the SignalCode slug
        "valueQuantity": {"value": obs.value, "unit": "%"},
    })
    assert r.status_code == 200, r.text


def _admit_everyone(client: TestClient) -> None:
    """One reading per patient, through the bridge's own credential."""
    for pid in ("p-a1", "p-a2", "p-n1"):
        _reading(client, pid)


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
        app = create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                         identities=_identities(), bedmap=BEDMAP,
                         resolve_jwt=resolve_nurse)
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


ADULT = build_scope("NURSE", unit_ids=["unit-adult"])
EVERYONE = ["p-a1", "p-a2", "p-n1"]


def _board_ids(client: TestClient) -> list[str]:
    """The whole ward, as the unscoped wall board sees it."""
    return sorted(p["patient_id"] for p in client.get("/patients", headers=TOKEN).json()["patients"])


def _rows(app, event_type: str) -> list:
    return [r for r in app.state.audit.records(tenant="demo", limit=1000)
            if r.event_type == event_type]


class TestFAProbeCreatesNothing:
    """The scope check reads a card built from the identity store, never `patient_board`: that
    calls `engine.state()`, which creates the patient it is asked about, so a refused probe for
    a made-up id used to put that id on every board in the hospital."""

    def test_refused_probes_leave_no_ghost_on_the_board(self, adult_nurse):
        _app, client = adult_nurse
        assert client.get("/alerts/ghost-1", headers=NURSE).status_code == 404
        assert client.post("/ack", headers=NURSE,
                           json={"patient_id": "ghost-2", "kind": "news2"}).status_code == 404
        assert client.post("/view", headers=NURSE, json={"patient_id": "ghost-3"}).status_code == 404
        assert client.get("/scores/sofa/ghost-4", headers=NURSE).status_code == 404
        assert _board_ids(client) == EVERYONE

    def test_a_score_for_an_unknown_id_is_404_and_creates_nothing(self):
        """Unrestricted, so the scope check passes and the score route's own check answers."""
        app = app_with(build_scope("HOSPITAL_ADMIN"), perms=NURSE_PERMS | {"scores.sign"})
        with TestClient(app) as client:
            _admit_everyone(client)
            read = client.get("/scores/sofa/ghost-5", headers=NURSE)
            signed = client.post("/scores/sofa/ghost-6", headers=NURSE, json={"overrides": []})
            assert _board_ids(client) == EVERYONE
        assert (read.status_code, read.json()["detail"]) == (404, "hasta bulunamadı")
        assert (signed.status_code, signed.json()["detail"]) == (404, "hasta bulunamadı")
        assert not _rows(app, "score_signed")

    def test_an_in_scope_patient_is_still_admitted(self, adult_nurse):
        """The check card carries the same bed and unit the board publishes for the patient."""
        _app, client = adult_nurse
        assert client.get("/alerts/p-a1", headers=NURSE).status_code == 200
        assert client.post("/view", headers=NURSE, json={"patient_id": "p-a1"}).status_code == 200
        assert client.get("/scores/sofa/p-a1", headers=NURSE).status_code == 200

    def test_an_admitted_patient_with_no_reading_is_reachable_and_stays_unmeasured(self):
        """In scope through the identity store alone; scoring them must not make them measured."""
        app = app_with(ADULT)
        with TestClient(app) as client:
            _reading(client, "p-a1")           # p-a2 is admitted and has never been measured
            assert client.get("/scores/sofa/p-a2", headers=NURSE).status_code == 200
            assert client.post("/view", headers=NURSE,
                               json={"patient_id": "p-a2"}).status_code == 200
            card = next(p for p in client.get("/patients", headers=TOKEN).json()["patients"]
                        if p["patient_id"] == "p-a2")
        assert card["latest"]["news2"] is None   # still the identity-only card


class TestGThePermissionAndTheScopeBothHold:
    def test_the_denial_names_who_was_refused(self, adult_nurse):
        app, client = adult_nurse
        client.get("/alerts/p-n1", headers=NURSE)
        [row] = _rows(app, "scope_denied")
        assert (row.payload["actor"], row.payload["via"]) == ("nurse-1", "user")

    def test_a_missing_permission_is_refused_before_the_scope_is_consulted(self):
        """403 for the permission, and no `scope_denied` row: the caller was never asking as
        someone allowed to read a patient at all."""
        app = app_with(ADULT, perms=frozenset())
        with TestClient(app) as client:
            _admit_everyone(client)
            r = client.get("/alerts/p-n1", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert not _rows(app, "scope_denied")

    def test_an_out_of_scope_ack_is_refused_and_stores_nothing(self):
        app = app_with(ADULT)
        with TestClient(app) as client:
            _admit_everyone(client)
            _reading(client, "p-n1", spo2=85.0)    # a live NEWS2 alert on the NICU patient
            _reading(client, "p-a1", spo2=85.0)    # and one the nurse may answer
            refused = client.post("/ack", headers=NURSE,
                                  json={"patient_id": "p-n1", "kind": "news2"})
            allowed = client.post("/ack", headers=NURSE,
                                  json={"patient_id": "p-a1", "kind": "news2"})
        assert refused.status_code == 404
        assert allowed.status_code == 200, allowed.text   # the alert was there to acknowledge
        assert set(app.state.ack_stores["demo"].acks) == {("p-a1", "news2")}
        assert [r.patient_id for r in _rows(app, "ack")] == ["p-a1"]

    def test_the_audit_trail_of_an_out_of_scope_patient_is_not_served(self):
        app = app_with(ADULT, perms=NURSE_PERMS | {"audit.view"})
        with TestClient(app) as client:
            _admit_everyone(client)
            assert client.get("/audit?patient_id=p-n1", headers=NURSE).status_code == 404
            assert client.get("/audit?patient_id=p-a1", headers=NURSE).status_code == 200

    def test_the_whole_trail_is_refused_to_a_scoped_caller(self):
        app = app_with(ADULT, perms=NURSE_PERMS | {"audit.view"})
        with TestClient(app) as client:
            r = client.get("/audit", headers=NURSE)
        assert r.status_code == 403
        assert r.json()["detail"] == "denetim kaydının tamamı kapsam dışı; bir patient_id verin"

    def test_the_alarm_quality_report_follows_the_whole_trail_rule(self):
        """Its noisiest beds are patient ids from every unit, so a scoped caller gets none."""
        scoped = app_with(ADULT, perms=NURSE_PERMS | {"audit.view"})
        whole = app_with(build_scope("HOSPITAL_ADMIN"), perms=NURSE_PERMS | {"audit.view"})
        with TestClient(scoped) as client:
            r = client.get("/alarm-quality", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (
            403, "alarm kalitesi raporunun tamamı kapsam dışı")
        with TestClient(whole) as client:
            assert client.get("/alarm-quality", headers=NURSE).status_code == 200
            assert client.get("/alarm-quality", headers=TOKEN).status_code == 200


class TestHAnUnreadableScopeGetsNoTicket:
    """A ticket bound to UNKNOWN would stream an empty ward for the life of the connection."""

    def test_no_ticket_is_issued_when_the_scope_cannot_be_read(self):
        from homunculus.scope.resolver import UNKNOWN

        app = app_with(UNKNOWN)
        with TestClient(app) as client:
            r = client.post("/stream-ticket", headers=NURSE)
            device = client.post("/stream-ticket", headers=TOKEN)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert device.status_code == 200 and device.json()["ticket"]

    @pytest.mark.parametrize("scope", [ADULT, build_scope("NURSE"),
                                       build_scope("HOSPITAL_ADMIN")],
                             ids=["assigned", "unassigned", "unrestricted"])
    def test_a_readable_scope_still_gets_its_ticket(self, scope):
        app = app_with(scope)
        with TestClient(app) as client:
            ticket = client.post("/stream-ticket", headers=NURSE).json()["ticket"]
        assert app.state.tickets.consume(ticket, now=0.0)[1] == scope


class TestIAMalformedBodyIsTheCallersError:
    """A dict where a patient id belongs reached a set lookup and answered 500."""

    @pytest.mark.parametrize("route,body", [
        ("/ack", {"patient_id": {"x": 1}, "kind": "news2"}),
        ("/ack", {"patient_id": "  ", "kind": "news2"}),
        ("/ack", {"patient_id": "p" * 129, "kind": "news2"}),
        ("/ack", {"kind": "news2"}),
        ("/view", {"patient_id": {"x": 1}}),
        ("/view", {"patient_id": ["p-a1"]}),
        ("/view", {"patient_id": "p" * 129}),
        ("/view", {}),
    ])
    def test_a_malformed_patient_id_is_400(self, adult_nurse, route, body):
        _app, client = adult_nurse
        r = client.post(route, headers=NURSE, json=body)
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz patient_id")

    def test_a_malformed_kind_is_400(self, adult_nurse):
        _app, client = adult_nurse
        r = client.post("/ack", headers=NURSE, json={"patient_id": "p-a1", "kind": {"x": 1}})
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz kind")

    def test_a_128_character_id_is_still_an_id(self, adult_nurse):
        _app, client = adult_nurse
        assert client.post("/view", headers=TOKEN,
                           json={"patient_id": "p" * 128}).status_code == 200


class TestJAnUnreadableScopeIsUnavailableNotNotFound:
    """G2-A2 (D13, D13b). A scope the resolver could not read — a database blip, no membership it
    could find — answered 404 «hasta bulunamadı» on every single-patient route and wrote a
    `scope_denied` row nobody committed; the whole-trail routes called it «kapsam dışı». It is 503
    now, the stream ticket's own answer, with no row; the device token, which is unscoped, still
    gets its answer."""

    PERMS = NURSE_PERMS | {"audit.view", "scores.sign"}
    ROUTES = [
        ("POST", "/clinical/p-a1", {"entries": [{"code": "suspected_infection", "value": 1}]}, 200),
        ("PUT", "/clinical/p-a1/profile", {"comorbidities": ["copd"]}, 200),
        ("POST", "/ack", {"patient_id": "p-a1", "kind": "news2"}, 200),
        ("POST", "/view", {"patient_id": "p-a1"}, 200),
        ("GET", "/alerts/p-a1", None, 200),
        ("GET", "/audit?patient_id=p-a1", None, 200),
        ("GET", "/scores/sofa/p-a1", None, 200),
        ("POST", "/scores/sofa/p-a1", {}, 403),          # a device never signs: its own refusal
        ("GET", "/audit", None, 200),                    # D13b: the whole trail
        ("GET", "/alarm-quality", None, 200),            # D13b
    ]

    @pytest.mark.parametrize("method,path,body,device", ROUTES,
                             ids=[f"{m} {p}" for m, p, _b, _d in ROUTES])
    def test_an_unreadable_scope_is_503_and_writes_no_denial(self, method, path, body, device):
        from homunculus.scope.resolver import UNKNOWN
        app = app_with(UNKNOWN, perms=self.PERMS)
        with TestClient(app) as client:
            _admit_everyone(client)
            _reading(client, "p-a1", spo2=85.0)          # a live NEWS2 alert, for the ack
            r = client.request(method, path, headers=NURSE, json=body)
            assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
            assert not _rows(app, "scope_denied")
            answered = client.request(method, path, headers=TOKEN, json=body)
        assert answered.status_code == device, answered.text

    def test_the_board_is_503_before_it_is_narrowed(self):
        from homunculus.scope.resolver import UNKNOWN
        app = app_with(UNKNOWN)
        with TestClient(app) as client:
            _admit_everyone(client)
            r = client.get("/patients", headers=NURSE)
            device = client.get("/patients", headers=TOKEN)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert device.status_code == 200 and len(device.json()["patients"]) == 3

    @pytest.mark.parametrize("path,detail", [
        ("/audit", "denetim kaydının tamamı kapsam dışı; bir patient_id verin"),
        ("/alarm-quality", "alarm kalitesi raporunun tamamı kapsam dışı"),
    ])
    def test_a_readable_restricted_scope_keeps_its_403_on_the_whole_trail(self, path, detail):
        app = app_with(ADULT, perms=self.PERMS)
        with TestClient(app) as client:
            r = client.get(path, headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, detail)

    def test_a_missing_permission_and_a_malformed_body_still_come_first(self):
        from homunculus.scope.resolver import UNKNOWN
        with TestClient(app_with(UNKNOWN, perms=frozenset())) as client:
            r = client.get("/alerts/p-a1", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        with TestClient(app_with(UNKNOWN)) as client:
            r = client.post("/ack", headers=NURSE, json={"patient_id": {"x": 1}, "kind": "news2"})
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz patient_id")
