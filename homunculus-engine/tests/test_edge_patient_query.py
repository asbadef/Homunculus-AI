# homunculus-engine/tests/test_edge_patient_query.py
"""The bridge's patient query (G2-B1d, spec §5.1 as amended, D3, D4, D12): POST /edge/patient-query
takes one exact number from the device credential and answers the board identity's name, birth
date and sex — always the name (D3) — or `found: false` for no record, a `kabul` tombstone or a
HIS record discharged (D4). A clinician's JWT is refused (403), a bad body is 400, and a store that
raises is 503 — never `found: false`, and never logged with the number (E14). No database: the
app's in-memory identity store. Synthetic numbers and names only."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.admission.boardlink import kabul_record
from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore

HOSPITAL = "HOSP1"
DEVICE = {"Authorization": "Bearer device-token"}
NURSE = {"Authorization": "Bearer jwt-nurse"}
URL = "/edge/patient-query"
NUMBER = "202600000001"
T0 = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


async def _resolve_jwt(credential: str) -> Caller | None:
    if credential == "jwt-nurse":
        return Caller(hospital=HOSPITAL, actor="hemsire", perms=frozenset({"board.view"}))
    return None


def _client(identities) -> TestClient:
    app = create_app({"device-token": HOSPITAL, "other-device": "HOSP2"}, run_escalation_loop=False,
                     identities=identities, resolve_jwt=_resolve_jwt)
    return TestClient(app)


def _admitted(number: str = NUMBER) -> IdentityRecord:
    return kabul_record(patient_number=number, display_name="Test Hasta", birth_date=date(1970, 5, 5),
                        sex="female", bed_label="1", bed_id="bed-1", unit_id="unit-1", at=T0)


@pytest.fixture
def store() -> InMemoryIdentityStore:
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _admitted())
    return identities


def test_a_known_number_is_answered_with_the_name_birth_date_and_sex(store):
    r = _client(store).post(URL, json={"id": NUMBER}, headers=DEVICE)
    assert r.status_code == 200, r.text
    assert r.json() == {"found": True, "family": "", "given": "Test Hasta",
                        "birth_date": "1970-05-05", "sex": "female"}


def test_a_comed_fed_record_is_answered_the_same_way():
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="20239121", family="HASTA", given="TEST",
                                              birth_date="1980-01-15", sex="male", state="admitted",
                                              source="comed", updated_at=T0))
    r = _client(identities).post(URL, json={"id": "20239121"}, headers=DEVICE)
    assert r.json() == {"found": True, "family": "HASTA", "given": "TEST",
                        "birth_date": "1980-01-15", "sex": "male"}


@pytest.mark.parametrize("asked", ["202600000002", "20260000000", NUMBER + "0", " " + NUMBER,
                                   "2026000000", "9" * 64])      # 64: the inclusive bound, a 200
def test_any_other_number_is_not_found_exact_match_only(store, asked):
    r = _client(store).post(URL, json={"id": asked}, headers=DEVICE)
    assert (r.status_code, r.json()) == (200, {"found": False})


def test_a_discharged_admission_is_not_found(store):
    """D4: a tombstone keeps the name (A-16) — the device must never be shown it."""
    store.apply(HOSPITAL, IdentityRecord(patient_id=NUMBER, state="discharged", source=KABUL,
                                         updated_at=T0 + timedelta(hours=1)))
    r = _client(store).post(URL, json={"id": NUMBER}, headers=DEVICE)
    assert r.json() == {"found": False}


def test_a_his_discharged_record_is_not_found():
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="20239121", family="HASTA", given="TEST",
                                              state="discharged", source="comed", updated_at=T0))
    r = _client(identities).post(URL, json={"id": "20239121"}, headers=DEVICE)
    assert r.json() == {"found": False}


def test_another_hospitals_device_never_sees_this_hospitals_patient(store):
    r = _client(store).post(URL, json={"id": NUMBER}, headers={"Authorization": "Bearer other-device"})
    assert r.json() == {"found": False}


def test_only_a_device_asks(store):
    client = _client(store)
    assert client.post(URL, json={"id": NUMBER}, headers=NURSE).status_code == 403
    assert client.post(URL, json={"id": NUMBER}).status_code == 401
    assert client.post(URL, json={"id": NUMBER}, headers={"Authorization": "Bearer nope"}).status_code == 401


@pytest.mark.parametrize("sent", [{"content": b"junk"}, {"json": {}}, {"json": {"id": ""}}])
def test_the_device_check_comes_before_the_body_is_read(store, sent):
    """The order is pinned: a clinician's JWT with a body that would be a 400 is 403 — the route
    does not tell a non-device what a good body looks like — and no credential is 401 first."""
    client = _client(store)
    assert client.post(URL, headers=NURSE, **sent).status_code == 403
    assert client.post(URL, **sent).status_code == 401


@pytest.mark.parametrize("sent", [{}, {"id": ""}, {"id": 202600000001}, {"id": None},
                                  {"id": "9" * 65}, ["202600000001"], "202600000001"])
def test_a_body_that_is_not_one_number_is_400(store, sent):
    r = _client(store).post(URL, json=sent, headers=DEVICE)
    assert r.status_code == 400, r.text


def test_a_body_that_is_not_json_is_400(store):
    r = _client(store).post(URL, content=b"id=202600000001", headers={**DEVICE, "Content-Type": "text/plain"})
    assert r.status_code == 400


class _Stalled(InMemoryIdentityStore):
    """A store whose read fails as Lane A's bounded Postgres store does on a stalled database,
    the number in its words as SQLAlchemy puts the statement's parameters there."""

    def get(self, hospital, patient_id):
        raise RuntimeError(f"OperationalError: canceling statement [parameters: ('{patient_id}',)]")


def test_a_store_that_raises_is_503_never_not_found_and_the_number_is_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    r = _client(_Stalled()).post(URL, json={"id": NUMBER}, headers=DEVICE)
    assert r.status_code == 503, r.text
    assert "found" not in r.text
    assert not any(NUMBER in rec.getMessage() or (rec.exc_text and NUMBER in rec.exc_text)
                   for rec in caplog.records)
    assert any("RuntimeError" in rec.getMessage() for rec in caplog.records)


def test_a_tombstone_check_that_raises_is_503_too(store, monkeypatch):
    import homunculus.api.edge_query as edge_query

    def broken(record):
        raise ValueError("a record the predicate cannot read")

    monkeypatch.setattr(edge_query, "is_tombstone", broken)
    assert _client(store).post(URL, json={"id": NUMBER}, headers=DEVICE).status_code == 503
