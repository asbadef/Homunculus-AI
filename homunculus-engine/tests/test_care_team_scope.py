# homunculus-engine/tests/test_care_team_scope.py
"""A care-team member sees her patient outside her units (G2-B1c, spec D6, F9, F10), through the
rows the routes write:
- an on-call member granted another unit sees the card inside her window and not after it;
- a member whose row has ended no longer sees it;
- a member leaves her own team, and then reads it no more.
The board's scope is the resolver's (`build_scope` over the grants and `read_own_patient_ids`);
an open stream picks a new member up when it reconnects (F10), so these tests read the scope,
not a stream. Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest_asyncio

from homunculus.scope import build_scope, sees_patient
from homunculus.scope.service import read_own_patient_ids
from tests.conftest import requires_db
from tests.kabul_world import BOARD, build_ward, ward_client
from tests.test_care_team_service import add_physician
from tests.test_discharge_api import signed

pytestmark = [requires_db]
HOUR = timedelta(hours=1)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _on_call(client, w, admission_id: str, user_id, start: datetime, hours: float) -> str:
    r = await client.post(f"/admissions/{admission_id}/care-team",
                          json={"user_id": str(user_id), "role": "ONCALL_PHYSICIAN",
                                "window_start": start.isoformat(),
                                "window_end": (start + timedelta(hours=hours)).isoformat()},
                          headers=w.auth["doctor"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_an_on_call_member_outside_the_unit_sees_the_card_inside_her_window_only(
        ward, db_session):
    w, client, _ = ward
    tenant, neo = w.tenant.id, str(w.units["neo"].id)
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    start = datetime.now(timezone.utc).replace(microsecond=0) - HOUR
    await _on_call(client, w, admission["id"], oncall, start, 2)
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]

    async def sees(at: datetime) -> bool:
        own = await read_own_patient_ids(db_session, oncall, tenant, now=at)
        return sees_patient(card, build_scope("MEMBER", unit_ids=[neo], own_patient_ids=own))

    assert not sees_patient(card, build_scope("MEMBER", unit_ids=[neo]))       # her units alone
    assert await sees(start + HOUR)                                            # inside her window
    assert not await sees(start + 2 * HOUR + timedelta(seconds=1))            # after it


async def test_a_member_whose_row_has_ended_no_longer_sees_the_card(ward, db_session):
    w, client, _ = ward
    tenant = w.tenant.id
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    member_id = await _on_call(client, w, admission["id"], oncall,
                               datetime.now(timezone.utc) - HOUR, 2)
    assert admission["board_key"] in await read_own_patient_ids(db_session, oncall, tenant)
    r = await client.post(f"/admissions/{admission['id']}/care-team/{member_id}/end",
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert admission["board_key"] not in await read_own_patient_ids(db_session, oncall, tenant)


async def test_a_member_leaves_her_own_team_and_then_reads_it_no_more(ward, db_session):
    """§5.2, §7: she ends her own row from outside her units; the team's read is then her units'
    again, and the bed is not in them."""
    w, client, _ = ward
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    member_id = await _on_call(client, w, admission["id"], oncall,
                               datetime.now(timezone.utc) - HOUR, 2)
    url = f"/admissions/{admission['id']}/care-team"
    assert (await client.get(url, headers=w.auth["nobetci"])).status_code == 200
    r = await client.post(f"{url}/{member_id}/end", headers=w.auth["nobetci"])
    assert r.status_code == 200, r.text
    r = await client.get(url, headers=w.auth["nobetci"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
