# homunculus-engine/tests/test_care_team_reads.py
"""The care team read (G2-B1c, spec §5.2, D6, D8, T1; X4, X10):
- `GET …/care-team`: every row, the active ones first and each group newest first, by name, with
  who added her, when it ended, and whether it is in force; never the patient's name. For a caller
  whose units hold the bed, or who holds an active row here herself; anyone else 403
  `out_of_scope`;
- `GET …/care-team/candidates`: every physician of the tenant from every unit, active accounts and
  memberships only, by name and nothing else, sorted by name. A member whose row is in force is
  left out; an expired on-call member is offered again (T8, X4). The assigner's, in her units.
Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import update

from homunculus.admission import service
from homunculus.admission.models import Admission, CareTeamRole
from homunculus.auth.models import TenantMembership, User
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client
from tests.test_care_team_service import add_physician, physician_elsewhere
from tests.test_discharge_api import signed

pytestmark = [requires_db]
HOUR = timedelta(hours=1)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def test_the_team_is_read_by_name_active_first_and_newest_first(ward, db_session):
    w, client, _ = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    late = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)                    # the doctor's ATTENDING row (Task 6)
    aid = uuid.UUID(admission["id"])
    adm = await db_session.get(Admission, aid)
    now = datetime.now(timezone.utc)
    gone = await service.add_care_team_member(db_session, adm, user_id=helper,
                                              role=CareTeamRole.ASSOCIATE_PHYSICIAN,
                                              granted_by_id=doctor)
    await service.end_care_team_member(db_session, gone, now=now)
    await service.add_care_team_member(db_session, adm, user_id=helper,
                                       role=CareTeamRole.ASSOCIATE_PHYSICIAN, granted_by_id=doctor)
    await service.add_care_team_member(db_session, adm, user_id=late,
                                       role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                       window_start=now - 10 * HOUR, window_end=now - 2 * HOUR)
    await db_session.commit()
    r = await client.get(f"/admissions/{aid}/care-team", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    got = [(m["full_name"], m["role"], m["is_active"], m["in_force"], m["granted_by_name"],
            m["closed_at"] is not None) for m in r.json()]
    assert got == [
        ("nobetci", "ONCALL_PHYSICIAN", True, False, "doctor", False),      # expired: not in force
        ("yardimci", "ASSOCIATE_PHYSICIAN", True, True, "doctor", False),
        ("doctor", "ATTENDING", True, True, "doctor", False),
        ("yardimci", "ASSOCIATE_PHYSICIAN", False, False, "doctor", True),
    ]
    assert "Sentetik" not in r.text                                         # no patient's name


async def test_a_member_outside_her_units_reads_the_team_she_is_on_and_no_other(ward, db_session):
    """§5.2, D6, X10: an active row opens the team's read to her; her units do not."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    await add_physician(db_session, w, "komsu", unit="neo")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team"
    r = await client.get(url, headers=w.auth["nobetci"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    adm = await db_session.get(Admission, aid)
    now = datetime.now(timezone.utc)
    await service.add_care_team_member(db_session, adm, user_id=oncall,
                                       role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                       window_start=now - HOUR, window_end=now + HOUR)
    await db_session.commit()
    assert (await client.get(url, headers=w.auth["nobetci"])).status_code == 200
    r = await client.get(url, headers=w.auth["komsu"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


async def test_the_picker_offers_every_physician_of_the_tenant_by_name_and_nobody_else(
        ward, db_session):
    """D8, T1, X4: from every unit (and from none), physicians only, active ones, this tenant's;
    `user_id` and `full_name` and nothing else, by name. The attending and an associate in force
    are left out; the physician whose on-call window passed is offered again."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    unit = await add_physician(db_session, w, "unite", group="unit_physician")
    far = await add_physician(db_session, w, "uzak", unit="neo")
    loose = await add_physician(db_session, w, "atamasiz", unit=None)
    late = await add_physician(db_session, w, "gecmis")
    gone = await add_physician(db_session, w, "ayrilan")
    left = await add_physician(db_session, w, "uyeligi-biten")
    await physician_elsewhere(db_session)
    await db_session.execute(update(User).where(User.id == gone).values(is_active=False))
    await db_session.execute(update(TenantMembership).where(TenantMembership.user_id == left)
                             .values(is_active=False))
    await db_session.commit()
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    adm = await db_session.get(Admission, aid)
    now = datetime.now(timezone.utc)
    await service.add_care_team_member(db_session, adm, user_id=late,
                                       role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                       window_start=now - 10 * HOUR, window_end=now - 2 * HOUR)
    await service.add_care_team_member(db_session, adm, user_id=unit,
                                       role=CareTeamRole.ASSOCIATE_PHYSICIAN, granted_by_id=doctor)
    await db_session.commit()
    r = await client.get(f"/admissions/{aid}/care-team/candidates", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json() == [{"user_id": str(loose), "full_name": "atamasiz"},
                        {"user_id": str(late), "full_name": "gecmis"},
                        {"user_id": str(far), "full_name": "uzak"}]


async def test_the_picker_is_the_assigners_and_only_in_her_units(ward, db_session):
    w, client, _ = ward
    await add_physician(db_session, w, "uzak-sorumlu", group="attending", unit="neo")
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/care-team/candidates"
    r = await client.get(url, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: care_team.assign")
    r = await client.get(url, headers=w.auth["uzak-sorumlu"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
