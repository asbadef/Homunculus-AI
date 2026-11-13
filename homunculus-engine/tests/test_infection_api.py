# homunculus-engine/tests/test_infection_api.py
"""G4-05 «Enfeksiyon kontrol» (spec D4, D10, D12 as §5 amends them): GET /infection against the DB-less app — the right
that opens it (and the device token, as on every board route), the caller's scoped cards with `/patients`' own scope
block, a flag saved through the chart door and then ended, a sepsis alarm and its clock, an identity-only card, an
unreadable scope, a discharged patient, two hospitals, and a read that writes nothing. Synthetic ward only (as
tests/test_pharmacy_api.py: `p-a1`…, units `unit-adult` / `unit-nicu`)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.scope import Scope, build_scope
from homunculus.scope.resolver import UNKNOWN
from homunculus.tenant.bedmap import BedMap

DEVICE = {"Authorization": "Bearer bridge-token"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
KEY_ONLY = {"Authorization": "Bearer key-only-jwt"}
PHARMACIST = {"Authorization": "Bearer pharmacist-jwt"}
#: A clinician who charts on every unit (her scope is the whole hospital, whatever the app's other callers are given):
#: an isolation flag is a clinician's record — the device token's chart of one is refused (test_isolation_chart.py).
CHARGE = {"Authorization": "Bearer charge-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="demo", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart", "infection.view"})),
    "key-only-jwt": Caller(hospital="demo", actor="hem.leyla", groups=("synth",), perms=frozenset({"infection.view"})),
    "pharmacist-jwt": Caller(hospital="demo", actor="ecz.murad", groups=("pharmacist",),
                             perms=frozenset({"board.view", "pharmacy.view"})),
    "charge-jwt": Caller(hospital="demo", actor="hem.sevda", groups=("charge_nurse",),
                         perms=frozenset({"board.view", "clinical.chart"})),
}
ADULT = build_scope("NURSE", unit_ids=["unit-adult"])
WHOLE = build_scope("HOSPITAL_ADMIN")
BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"},
    "YB^304^2": {"bed_id": "bed-a2", "unit_id": "unit-adult"},
    "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu"},
}})
KEYS = ["now", "antibiotic_window_min", "antibiotic_window_source", "counts", "units", "isolated", "suspected",
        "bed_occupants", "scope", "scope_note"]
FLAGS = ("contact", "droplet", "airborne", "protective")


def _identities() -> InMemoryIdentityStore:
    store = InMemoryIdentityStore()
    for pid, given, unit, room, bed in (("p-a1", "Bir", "YB", "304", "1"), ("p-a2", "İki", "YB", "304", "2"),
                                        ("p-n1", "Üç", "YYB", "12", "A")):
        store.apply("demo", IdentityRecord(patient_id=pid, given="Örnek Hasta", family=given, unit=unit, room=room,
                                           bed=bed, source="comed",
                                           updated_at=datetime(2026, 11, 4, tzinfo=timezone.utc)))
    return store


def _app(scope: Scope = WHOLE, *, identities=None):
    async def resolve_scope(credential: str) -> Scope:
        return WHOLE if credential == "charge-jwt" else scope

    async def resolve_jwt(credential: str):
        return PEOPLE.get(credential)

    return create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                      identities=identities if identities is not None else _identities(), bedmap=BEDMAP,
                      resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)


def _chart(client, pid, entries, at=None, headers=NURSE):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at.isoformat()
    r = client.post(f"/clinical/{pid}", json=body, headers=headers)
    assert r.status_code == 200, r.text


def _isolate(client, pid, *types, headers=NURSE):
    """The box's save: all four flags, no time (the server's instant is the record's)."""
    _chart(client, pid, [{"code": f"isolation_{name}", "value": int(name in types)} for name in FLAGS], headers=headers)


def _raise_sepsis(client, pid, at, headers=DEVICE):
    """Suspected infection with a SOFA rise: the engine's sepsis rule fires, and recognition is stamped `at`."""
    _chart(client, pid, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 80},
                         {"code": "creatinine", "value": 3.5}], at, headers)


def _infection(client, headers=NURSE):
    return client.get("/infection", headers=headers)


def _ids(rows):
    return [row["patient_id"] for row in rows]


@pytest.fixture()
def ward():
    app = _app()
    with TestClient(app) as client:
        yield app, client


class TestTheRight:
    def test_it_needs_infection_view_and_the_key_alone_opens_it(self, ward):
        _app_, client = ward
        assert client.get("/infection").status_code == 401
        refused = _infection(client, PHARMACIST)
        assert (refused.status_code, refused.json()["detail"]) == (403, "permission required: infection.view")
        assert _infection(client, KEY_ONLY).status_code == 200          # without board.view
        assert _infection(client).status_code == 200

    def test_the_device_token_passes_as_on_every_board_route(self, ward):
        _app_, client = ward
        r = _infection(client, DEVICE)
        assert r.status_code == 200 and r.json()["scope"]["unrestricted"] is True


class TestTheAnswer:
    def test_the_keys_the_window_and_its_source(self, ward):
        _app_, client = ward
        before = datetime.now(timezone.utc)
        answer = _infection(client).json()
        after = datetime.now(timezone.utc)
        assert list(answer) == KEYS
        assert (answer["antibiotic_window_min"], answer["antibiotic_window_source"]) == (
            60, "surviving-sepsis-campaign-2026")
        assert answer["now"].endswith("+00:00") and before <= datetime.fromisoformat(answer["now"]) <= after

    def test_identity_only_cards_are_counted_unrecorded_and_listed_nowhere_but_their_beds(self, ward):
        _app_, client = ward
        answer = _infection(client).json()
        assert answer["counts"] == {"patients": 3, "isolated": 0, "isolation_unrecorded": 3, "suspected": 0,
                                    "suspected_unrecorded": 3, "clock_missed": 0, "sepsis_open": 0}
        assert answer["isolated"] == answer["suspected"] == []
        assert answer["bed_occupants"] == [
            {"bed_id": "bed-a1", "patient_id": "p-a1", "display_name": "Örnek Hasta Bir",
             "isolation": {"state": "unrecorded", "types": []}},
            {"bed_id": "bed-a2", "patient_id": "p-a2", "display_name": "Örnek Hasta İki",
             "isolation": {"state": "unrecorded", "types": []}},
            {"bed_id": "bed-n1", "patient_id": "p-n1", "display_name": "Örnek Hasta Üç",
             "isolation": {"state": "unrecorded", "types": []}}]
        assert [u["unit_id"] for u in answer["units"]] == ["unit-adult", "unit-nicu"]

    def test_a_save_through_the_chart_door_lists_the_patient_and_four_zeros_end_it(self, ward):
        _app_, client = ward
        before = datetime.now(timezone.utc)
        _isolate(client, "p-a1", "contact", "droplet")
        answer = _infection(client).json()
        (row,) = answer["isolated"]
        assert (row["patient_id"], row["bed_label"], row["bed_id"], row["unit_id"], row["display_name"]) == (
            "p-a1", "YB 304-1", "bed-a1", "unit-adult", "Örnek Hasta Bir")
        assert (row["isolation"]["state"], row["isolation"]["types"]) == ("isolated", ["contact", "droplet"])
        assert before <= datetime.fromisoformat(row["isolation"]["charted_at"]) <= datetime.now(timezone.utc)
        assert set(row["isolation"]) == {"state", "types", "charted_at"}               # no person (§5 S2)
        assert (answer["counts"]["isolated"], answer["counts"]["isolation_unrecorded"]) == (1, 2)
        _isolate(client, "p-a1")                                                      # all four to 0
        answer = _infection(client).json()
        assert answer["isolated"] == []
        assert (answer["counts"]["isolated"], answer["counts"]["isolation_unrecorded"]) == (0, 2)
        (occupant,) = [o for o in answer["bed_occupants"] if o["patient_id"] == "p-a1"]
        assert occupant["isolation"] == {"state": "not_isolated", "types": []}

    def test_a_sepsis_alarm_and_its_clock(self, ward):
        _app_, client = ward
        now = datetime.now(timezone.utc).replace(microsecond=0)
        _raise_sepsis(client, "p-n1", now - timedelta(hours=3))                 # the window closed two hours ago
        answer = _infection(client).json()
        (row,) = answer["suspected"]
        assert (row["patient_id"], row["suspected_infection"], row["sort_group"]) == ("p-n1", True, 0)
        assert row["antibiotic"]["state"] == "missed"
        (eczane,) = [r for r in client.get("/pharmacy", headers=DEVICE).json()["rows"] if r["patient_id"] == "p-n1"]
        # Eczane's object for the same card; `remaining_sec` is counted at each read's own instant, a moment apart.
        assert {**row["antibiotic"], "remaining_sec": 0} == {**eczane["antibiotic"], "remaining_sec": 0}
        assert [(a["kind"], a["resolved_at"]) for a in row["sepsis_alarms"]] == [("sepsis", None)]
        assert answer["counts"] == {"patients": 3, "isolated": 0, "isolation_unrecorded": 3, "suspected": 1,
                                    "suspected_unrecorded": 2, "clock_missed": 1, "sepsis_open": 1}
        (nicu,) = [u for u in answer["units"] if u["unit_id"] == "unit-nicu"]
        assert (nicu["counts"]["suspected"], nicu["counts"]["sepsis_open"]) == (1, 1)


class TestTheScope:
    def test_only_the_callers_beds_with_patients_own_scope_block(self):
        with TestClient(_app(ADULT)) as client:
            _isolate(client, "p-n1", "airborne", headers=CHARGE)
            _isolate(client, "p-a2", "protective", headers=CHARGE)
            answer = _infection(client).json()
            board = client.get("/patients", headers=NURSE).json()
            everything = _infection(client, DEVICE).json()
        assert _ids(answer["isolated"]) == ["p-a2"]                                  # the NICU's patient is not hers
        assert [o["patient_id"] for o in answer["bed_occupants"]] == ["p-a1", "p-a2"]
        assert [u["unit_id"] for u in answer["units"]] == ["unit-adult"]
        assert answer["counts"]["patients"] == 2
        assert (answer["scope"], answer["scope_note"]) == (board["scope"], board["scope_note"])
        assert answer["scope"]["unit_ids"] == ["unit-adult"] and answer["scope"]["hidden"] == 1
        assert _ids(everything["isolated"]) == ["p-a2", "p-n1"]

    def test_a_scope_that_reaches_no_card_answers_the_whole_shape_and_says_why(self):
        with TestClient(_app(build_scope("NURSE", unit_ids=["unit-yok"]))) as client:
            answer = _infection(client).json()
        assert list(answer) == KEYS and answer["counts"]["patients"] == 0
        assert answer["units"] == answer["isolated"] == answer["suspected"] == answer["bed_occupants"] == []
        assert answer["scope"]["blind"] is True and answer["scope_note"]

    def test_an_unreadable_scope_is_503_not_an_empty_list(self):
        with TestClient(_app(UNKNOWN)) as client:
            r = _infection(client)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")

    def test_a_patient_discharged_through_kabul_is_absent_as_on_the_board(self):
        identities = _identities()
        with TestClient(_app(identities=identities)) as client:
            _isolate(client, "p-a1", "contact")
            assert _ids(_infection(client).json()["isolated"]) == ["p-a1"]
            identities.apply("demo", IdentityRecord(patient_id="p-a1", given="Örnek Hasta", family="Bir",
                                                    state="discharged", source="kabul",
                                                    updated_at=datetime.now(timezone.utc)))
            answer = _infection(client).json()
        assert answer["isolated"] == [] and "p-a1" not in [o["patient_id"] for o in answer["bed_occupants"]]
        assert answer["counts"]["patients"] == 2


class TestTheTrail:
    def test_the_read_appends_nothing_to_the_audit_log(self, ward):
        app, client = ward
        _isolate(client, "p-a1", "contact")
        before = len(app.state.audit.records(tenant="demo", limit=10_000))
        for headers in (NURSE, KEY_ONLY, DEVICE):
            assert _infection(client, headers).status_code == 200
        assert _infection(client, PHARMACIST).status_code == 403
        assert len(app.state.audit.records(tenant="demo", limit=10_000)) == before


class TestTwoHospitals:
    def test_each_hospital_reads_only_its_own_rows_and_counts(self):
        """Two hospitals whose patients share the patient key AND the bed label: a caller of one sees its own row,
        flags and counts — nothing of the other's, not a name, a flag or an alarm."""
        other = {"Authorization": "Bearer other-jwt"}
        other_device = {"Authorization": "Bearer bridge-other"}
        people = {**PEOPLE, "other-jwt": Caller(hospital="diger", actor="hem.nigar", groups=("nurse",),
                                                perms=frozenset({"board.view", "infection.view"}))}
        identities = _identities()
        identities.apply("diger", IdentityRecord(patient_id="p-a1", given="Örnek Hasta", family="Dört", unit="YB",
                                                 room="304", bed="1", source="comed",
                                                 updated_at=datetime(2026, 11, 4, tzinfo=timezone.utc)))

        async def resolve_scope(_credential: str) -> Scope:
            return WHOLE

        async def resolve_jwt(credential: str):
            return people.get(credential)

        app = create_app({"bridge-token": "demo", "bridge-other": "diger"}, run_escalation_loop=False,
                         identities=identities, bedmap=BEDMAP, resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)
        with TestClient(app) as client:
            _isolate(client, "p-a1", "contact")                       # demo's nurse: a flag is a clinician's record
            _raise_sepsis(client, "p-a1", datetime.now(timezone.utc) - timedelta(hours=3), other_device)
            here, there = _infection(client).json(), _infection(client, other).json()
        (mine,) = here["isolated"]
        assert (mine["display_name"], mine["isolation"]["types"], mine["suspected_infection"]) == (
            "Örnek Hasta Bir", ["contact"], None)
        assert here["suspected"] == [] and here["counts"]["sepsis_open"] == 0
        (theirs,) = there["suspected"]
        assert (theirs["patient_id"], theirs["bed_label"], theirs["display_name"]) == ("p-a1", "YB 304-1",
                                                                                       "Örnek Hasta Dört")
        assert theirs["isolation"]["state"] == "unrecorded" and there["isolated"] == []
        assert there["counts"] == {"patients": 1, "isolated": 0, "isolation_unrecorded": 1, "suspected": 1,
                                   "suspected_unrecorded": 0, "clock_missed": 1, "sepsis_open": 1}
