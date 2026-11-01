# homunculus-engine/tests/test_protocol_admission.py
"""The admit path under the protocol (G2-B1d, spec §3, §4, D1, D5, D7): the admission takes the
tenant's next protocol number inside its own transaction; its card, weight and comorbidities go
under it — the number on the device, the label and the card are one (D7); the answer carries
`protocol_no` and `board_key`; the audit row names the key, with the protocol and the H-number in
its payload and never a name. No start number: nothing is written (D5). A refused admission gives
its number back. A resend is answered with the same protocol; a duplicate names the open
admission's key. Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update

from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, Patient
from homunculus.protocol.models import ProtocolSettings
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form

SECOND_PROTOCOL = "202600000002"


def test_the_key_is_the_protocol_and_a_legacy_admissions_is_its_h_number():
    assert board_key("202600000001", "H2600042") == "202600000001"
    assert board_key(None, "H2600042") == "H2600042"
    assert board_key("", "H2600042") == "H2600042"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _settings(db) -> tuple[int | None, int | None]:
    db.expire_all()
    return tuple((await db.execute(select(ProtocolSettings.next_no, ProtocolSettings.last_issued))).one())


@requires_db
async def test_an_admission_takes_the_next_protocol_and_its_card_goes_under_it(ward, db_session):
    w, client, app = ward
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["protocol_no"], body["board_key"]) == (FIRST_PROTOCOL, FIRST_PROTOCOL)
    assert body["patient_number"].startswith("H")                       # D2: still issued, apart
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.protocol_no))).scalar_one() == FIRST_PROTOCOL
    assert await _settings(db_session) == (int(SECOND_PROTOCOL), int(FIRST_PROTOCOL))

    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert card["patient_id"] == FIRST_PROTOCOL                         # D7: the card's key
    assert card["identity"]["display_name"] == "Sentetik Hasta"
    assert card["meds"]["weight_kg"] == 72.5                            # the weight under the key
    engine = app.state.board_link._engine(SLUG)
    assert engine.profile(FIRST_PROTOCOL).comorbidities == frozenset({"copd"})
    assert body["patient_number"] not in set(engine.patient_ids())     # nothing under the H-number


@requires_db
async def test_the_next_admission_takes_the_next_protocol(ward):
    w, client, _ = ward
    first = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    second = (await client.post("/admissions", json=form(w, "2"), headers=w.auth["charge"])).json()
    assert (first["protocol_no"], second["protocol_no"]) == (FIRST_PROTOCOL, SECOND_PROTOCOL)


@requires_db
@pytest.mark.parametrize("unset", ["no row", "next_no NULL"])
async def test_without_a_start_number_no_admission_is_written(ward, db_session, unset):
    """D5: refused `protocol_not_configured`, and nothing at all is written — not the patient, not
    the bed, not an H-number."""
    w, client, app = ward
    # The ids and the form as plain values: `expire_all()` below expires the ward's ORM rows, and
    # reading `.id` off an expired row lazy-loads outside the greenlet (E17, as Task 2's E16).
    bed_id, tenant_id, body = w.beds["1"].id, w.tenant.id, form(w)
    if unset == "no row":
        await db_session.execute(delete(ProtocolSettings))
    else:
        await db_session.execute(update(ProtocolSettings).values(next_no=None))
    await db_session.commit()
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "protocol_not_configured"), r.text
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (0, 0)
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.AVAILABLE
    assert [x for x in app.state.audit.records(tenant=SLUG, limit=50)
            if x.event_type == "admission.admit"] == []
    # Once it is set, the first admission takes the first H-number: none was spent above.
    if unset == "no row":
        db_session.add(ProtocolSettings(tenant_id=tenant_id, next_no=int(FIRST_PROTOCOL)))
    else:
        await db_session.execute(update(ProtocolSettings).values(next_no=int(FIRST_PROTOCOL)))
    await db_session.commit()
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["patient_number"].endswith("00001")


@requires_db
async def test_past_the_last_twelve_digit_number_the_admission_is_refused(ward, db_session):
    w, client, _ = ward
    await db_session.execute(update(ProtocolSettings).values(next_no=1_000_000_000_000))
    await db_session.commit()
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "protocol_exhausted"), r.text
    assert await _count(db_session, Admission) == 0
    assert await _settings(db_session) == (1_000_000_000_000, None)        # rolled back


@requires_db
async def test_an_admission_refused_after_its_number_gives_the_number_back(ward, db_session):
    """The bed is taken by the service's own check, after both numbers were taken: the whole
    transaction rolls back, and the next admission gets the number — no gap."""
    w, client, _ = ward
    assert (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).status_code == 201
    taken = form(w, "1", patient={"display_name": "Sentetik Başqa"})
    r = await client.post("/admissions", json=taken, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available"), r.text
    nxt = await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])
    assert nxt.json()["protocol_no"] == SECOND_PROTOCOL


@requires_db
async def test_the_audit_row_is_the_cards_and_names_both_numbers_never_the_name(ward):
    w, client, app = ward
    body = (await client.post("/admissions", json=form(w), headers=w.auth["nurse"])).json()
    (row,) = [x for x in app.state.audit.records(tenant=SLUG, limit=50)
              if x.event_type == "admission.admit"]
    assert row.patient_id == FIRST_PROTOCOL                             # E4: the card's key
    assert row.payload == {"admission_id": body["id"], "bed_id": str(w.beds["1"].id),
                           "unit_id": str(w.units["rea"].id), "actor": "nurse@kabul.example.com",
                           "protocol_no": FIRST_PROTOCOL, "patient_number": body["patient_number"]}
    assert "Sentetik" not in repr([x.payload for x in app.state.audit.records(tenant=SLUG, limit=50)])


@requires_db
async def test_a_resend_of_the_form_is_answered_with_the_same_protocol(ward, db_session):
    w, client, _ = ward
    body = form(w, request_id=uuid.uuid4())
    first = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert (first.status_code, again.status_code) == (201, 200), again.text
    assert (again.json()["protocol_no"], again.json()["board_key"]) == (FIRST_PROTOCOL, FIRST_PROTOCOL)
    assert await _settings(db_session) == (int(SECOND_PROTOCOL), int(FIRST_PROTOCOL))   # one taken


@requires_db
async def test_a_duplicate_and_a_request_conflict_name_the_open_admissions_key(ward):
    """E6: the number the screen sends the nurse to look for is the card's."""
    w, client, _ = ward
    request_id = uuid.uuid4()
    first = (await client.post("/admissions", json=form(w, "1", request_id=request_id),
                               headers=w.auth["nurse"])).json()
    dup = await client.post("/admissions", json=form(w, "2", patient={"display_name": "Sentetik Hasta"}),
                            headers=w.auth["nurse"])
    assert dup.json()["detail"]["code"] == "duplicate_open_admission"
    other = await client.post("/admissions", json=form(w, "2", request_id=request_id),
                              headers=w.auth["nurse"])
    assert other.json()["detail"]["code"] == "request_conflict"
    for refused in (dup, other):
        detail = refused.json()["detail"]
        assert (detail["board_key"], detail["patient_number"]) == (FIRST_PROTOCOL, first["patient_number"])
