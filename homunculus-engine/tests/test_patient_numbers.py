# homunculus-engine/tests/test_patient_numbers.py
"""The Homunculus patient number (Group 2 · B1a, spec §4.2): `H` + two-digit year + five digits,
one sequence per tenant and UTC year, taken under the counter row's lock so that two admissions
never share one, and refused rather than overflowed at 99 999. The format tests need no database;
the rest run on Postgres (`db_session`). Synthetic tenants only."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.errors import PATIENT_NUMBER_EXHAUSTED, Refusal
from homunculus.admission.models import PatientNumberCounter
from homunculus.admission.numbers import SEQUENCE_MAX, format_patient_number, next_patient_number
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

MID_2026 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def test_the_number_is_h_the_year_and_five_digits():
    assert format_patient_number(2026, 42) == "H2600042"
    assert format_patient_number(2031, 1) == "H3100001"
    assert format_patient_number(2026, SEQUENCE_MAX) == "H2699999"


def test_the_number_holds_no_path_pid_or_hl7_separator():
    """`/` would be a path segment, `_` is where the NCE device splits a PID, `|^~\\&` are HL7's."""
    for year, seq in ((2026, 1), (2026, 99_999), (2099, 12_345), (2100, 7)):
        assert re.fullmatch(r"H\d{7}", format_patient_number(year, seq))


async def _tenant(db, slug: str) -> Tenant:
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
    db.add(tenant)
    await db.flush()
    return tenant


@requires_db
async def test_numbers_follow_each_other_within_a_tenants_year(db_session):
    a = await _tenant(db_session, "hastane-a")
    got = [await next_patient_number(db_session, a.id, now=MID_2026) for _ in range(3)]
    assert got == ["H2600001", "H2600002", "H2600003"]


@requires_db
async def test_each_tenant_has_its_own_sequence(db_session):
    a, b = await _tenant(db_session, "hastane-a"), await _tenant(db_session, "hastane-b")
    assert await next_patient_number(db_session, a.id, now=MID_2026) == "H2600001"
    assert await next_patient_number(db_session, a.id, now=MID_2026) == "H2600002"
    assert await next_patient_number(db_session, b.id, now=MID_2026) == "H2600001"


@requires_db
async def test_the_sequence_starts_again_at_one_in_the_new_utc_year(db_session):
    a = await _tenant(db_session, "hastane-a")
    eve = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    # 02:00 on 1 January in Baku (UTC+4) is still 31 December in UTC: the old year's number.
    baku_new_year = datetime.fromisoformat("2027-01-01T02:00:00+04:00")
    new_year = datetime(2027, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert await next_patient_number(db_session, a.id, now=eve) == "H2600001"
    assert await next_patient_number(db_session, a.id, now=baku_new_year) == "H2600002"
    assert await next_patient_number(db_session, a.id, now=new_year) == "H2700001"


@requires_db
async def test_at_the_last_number_of_a_year_the_admission_is_refused(db_session):
    a = await _tenant(db_session, "hastane-a")
    db_session.add(PatientNumberCounter(tenant_id=a.id, year=2026, last=SEQUENCE_MAX - 1))
    await db_session.commit()

    assert await next_patient_number(db_session, a.id, now=MID_2026) == "H2699999"
    await db_session.commit()
    with pytest.raises(Refusal) as refused:
        await next_patient_number(db_session, a.id, now=MID_2026)
    assert (refused.value.status, refused.value.code) == (409, PATIENT_NUMBER_EXHAUSTED)
    await db_session.rollback()      # what the route's session does with a refused admission
    last = (await db_session.execute(select(PatientNumberCounter.last))).scalar_one()
    assert last == SEQUENCE_MAX


@requires_db
async def test_a_rolled_back_admission_gives_its_number_back(db_session):
    tenant_id = (await _tenant(db_session, "hastane-a")).id
    await db_session.commit()
    assert await next_patient_number(db_session, tenant_id, now=MID_2026) == "H2600001"
    await db_session.rollback()
    assert await next_patient_number(db_session, tenant_id, now=MID_2026) == "H2600001"


@requires_db
async def test_two_admissions_at_once_never_share_a_number(db_session):
    """Two sessions, two connections, both taking a number inside their own transaction: the
    second waits on the counter row until the first commits, then takes the next number."""
    a = await _tenant(db_session, "hastane-a")
    await db_session.commit()
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    first_has_one = asyncio.Event()

    async def first():
        async with maker() as db:
            number = await next_patient_number(db, a.id, now=MID_2026)
            first_has_one.set()
            await asyncio.sleep(0.3)        # hold the row lock while the second one asks
            await db.commit()
            return number

    async def second():
        await first_has_one.wait()
        async with maker() as db:
            number = await next_patient_number(db, a.id, now=MID_2026)
            await db.commit()
            return number

    got = await asyncio.gather(first(), second())
    assert sorted(got) == ["H2600001", "H2600002"]
