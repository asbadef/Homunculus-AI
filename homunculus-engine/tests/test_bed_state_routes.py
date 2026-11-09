# homunculus-engine/tests/test_bed_state_routes.py
"""The Doluluk's four bed moves (G2-B3a, spec §4, D4, R6, R8, X3–X6). A charge nurse:
- reserves a free bed of her unit, with or without a note, and cancels the reservation;
- takes a free bed out of service with a reason;
- returns it, or a bed in maintenance, to service.
Each move belongs to the charge nurse or the administrator (`beds.manage_state`). It works only in
the caller's own units, on an open bed, in the state the move needs. Each is audited with the
reason and whether a note was written, never its words; the note is stored encrypted. The
administrator's raw move cannot set either state, and a reserved bed is not closed.
Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from homunculus.tenant import router as tenant_router
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client

pytestmark = [requires_db]
NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _set_state(db, bed: Bed, state: BedState) -> None:
    bed.state = state
    db.add(bed)
    await db.commit()


def _rows(app) -> list:
    """The ward's audit rows of this slice's four moves, oldest first."""
    kinds = {"bed.reserve", "bed.unreserve", "bed.out_of_service", "bed.return_to_service"}
    return [r for r in app.state.audit.records(tenant=SLUG, limit=500) if r.event_type in kinds]


async def _stored(db, bed_id) -> tuple:
    """The bed's state, reason and note as the database holds them — the note's raw column."""
    db.expire_all()
    row = (await db.execute(text("SELECT state::text, state_reason, state_note FROM beds "
                                 "WHERE id = :id"), {"id": bed_id})).one()
    return tuple(row)


async def test_a_charge_nurse_reserves_a_free_bed_with_a_note_kept_encrypted(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["3"].id, w.units["rea"].id         # read before `_stored` expires the session
    r = await client.post(f"/tenant/beds/{bed_id}/reserve", json={"note": f"  {NOTE}  "},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "RESERVED" and "state_note" not in r.json()
    state, reason, raw = await _stored(db_session, bed_id)
    assert (state, reason) == ("RESERVED", None)
    assert raw and NOTE not in raw                                  # R8: ciphertext in the column
    db_session.expire_all()
    assert (await db_session.get(Bed, bed_id)).state_note == NOTE     # trimmed, read back
    (row,) = _rows(app)
    assert row.event_type == "bed.reserve"
    assert row.payload == {"bed_id": str(bed_id), "unit_id": str(unit_id),
                           "from": "AVAILABLE", "to": "RESERVED", "reason": None, "note": True,
                           "actor": "charge@kabul.example.com"}


async def test_a_reservation_without_a_note_is_still_a_reservation(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id                                     # read before `_stored` expires the session
    url = f"/tenant/beds/{bed_id}"
    for body in ({}, {"note": "   "}):
        r = await client.post(f"{url}/reserve", json=body, headers=w.auth["charge"])
        assert r.status_code == 200, r.text
        assert (await _stored(db_session, bed_id))[2] is None
        r = await client.post(f"{url}/unreserve", headers=w.auth["charge"])
        assert r.status_code == 200, r.text
    assert [x.payload["note"] for x in _rows(app) if x.event_type == "bed.reserve"] == [False, False]


async def test_cancelling_a_reservation_frees_the_bed_and_forgets_the_note(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id
    await client.post(f"/tenant/beds/{bed_id}/reserve", json={"note": NOTE}, headers=w.auth["charge"])
    r = await client.post(f"/tenant/beds/{bed_id}/unreserve", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert await _stored(db_session, bed_id) == ("AVAILABLE", None, None)
    assert [(x.payload["from"], x.payload["to"]) for x in _rows(app)] == [
        ("AVAILABLE", "RESERVED"), ("RESERVED", "AVAILABLE")]


async def test_out_of_service_carries_its_reason_and_returns_to_service_clean(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id
    r = await client.post(f"/tenant/beds/{bed_id}/out-of-service",
                          json={"reason": "FAULT", "note": "Sentetik arıza"}, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    state, reason, raw = await _stored(db_session, bed_id)
    assert (state, reason) == ("BLOCKED", "FAULT") and raw and "Sentetik" not in raw
    r = await client.post(f"/tenant/beds/{bed_id}/return-to-service", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert await _stored(db_session, bed_id) == ("AVAILABLE", None, None)
    out, back = _rows(app)
    assert (out.event_type, out.payload["reason"], out.payload["note"]) == ("bed.out_of_service", "FAULT", True)
    assert (back.event_type, back.payload["from"], back.payload["reason"]) == (
        "bed.return_to_service", "BLOCKED", "FAULT")


async def test_the_reason_other_needs_a_note_and_an_unknown_reason_is_refused(ward, db_session):
    w, client, app = ward
    url = f"/tenant/beds/{w.beds['3'].id}/out-of-service"
    r = await client.post(url, json={"reason": "OTHER"}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "field_invalid:note")      # X3
    assert (await client.post(url, json={"reason": "BROKEN"}, headers=w.auth["charge"])).status_code == 422
    r = await client.post(url, json={"reason": "STAFFING", "note": "x" * 201}, headers=w.auth["charge"])
    assert r.status_code == 422
    assert (await _stored(db_session, w.beds["3"].id))[0] == "AVAILABLE" and _rows(app) == []


async def test_a_bed_in_maintenance_returns_to_service(ward, db_session):
    w, client, _ = ward
    await _set_state(db_session, w.beds["3"], BedState.MAINTENANCE)
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/return-to-service", headers=w.auth["charge"])
    assert r.status_code == 200 and r.json()["state"] == "AVAILABLE"


@pytest.mark.parametrize(("route", "body", "states"), [
    ("reserve", {}, ["OCCUPIED", "HOUSEKEEPING", "RESERVED", "BLOCKED", "MAINTENANCE",
                     "PENDING_DISCHARGE"]),
    ("out-of-service", {"reason": "FAULT"}, ["OCCUPIED", "HOUSEKEEPING", "RESERVED", "BLOCKED",
                                             "MAINTENANCE"]),
    ("unreserve", None, ["AVAILABLE", "OCCUPIED", "BLOCKED"]),
    ("return-to-service", None, ["AVAILABLE", "OCCUPIED", "RESERVED", "HOUSEKEEPING"]),
])
async def test_each_move_needs_the_state_it_starts_from(ward, db_session, route, body, states):
    w, client, app = ward
    for state in states:
        await _set_state(db_session, w.beds["3"], BedState(state))
        r = await client.post(f"/tenant/beds/{w.beds['3'].id}/{route}", json=body,
                              headers=w.auth["charge"])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition"), (route, state)
        assert (await _stored(db_session, w.beds["3"].id))[0] == state
    assert _rows(app) == []


async def test_only_beds_manage_state_moves_a_bed(ward):
    w, client, _ = ward
    for who in ("nurse", "doctor"):
        r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth[who])
        assert r.status_code == 403 and r.json()["detail"] == "permission required: beds.manage_state"
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth["admin"])
    assert r.status_code == 200, r.text


async def test_a_bed_of_another_unit_is_out_of_scope(ward):
    w, client, app = ward
    r = await client.post(f"/tenant/beds/{w.beds['N1'].id}/reserve", json={}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    assert _rows(app) == []


async def test_a_closed_bed_is_reopened_before_it_is_moved(ward, db_session):
    """X6."""
    w, client, _ = ward
    w.beds["3"].is_active = False
    db_session.add(w.beds["3"])
    await db_session.commit()
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_closed")


async def test_return_to_service_runs_the_guards_of_every_freeing_move(ward, db_session, monkeypatch):
    """R6: an admission still open on the bed refuses it `bed_in_use`, as the raw move does."""
    w, client, _ = ward

    async def held(db, bed_id):
        return True

    monkeypatch.setattr(tenant_router, "_holds_open_admission", held)
    await _set_state(db_session, w.beds["3"], BedState.BLOCKED)
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/return-to-service", headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_in_use")
    assert (await _stored(db_session, w.beds["3"].id))[0] == "BLOCKED"


@pytest.mark.parametrize("target", ["RESERVED", "BLOCKED"])
async def test_the_raw_move_sets_no_state_that_needs_a_note_or_a_reason(ward, db_session, target):
    """X4."""
    w, client, _ = ward
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/transition", json={"new_state": target},
                          headers=w.auth["admin"])
    assert r.status_code == 400
    assert (await _stored(db_session, w.beds["3"].id))[0] == "AVAILABLE"


async def test_a_reserved_bed_is_not_closed(ward):
    """X5: the reservation is cancelled first."""
    w, client, _ = ward
    await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth["charge"])
    r = await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"is_active": False},
                           headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_in_use")
