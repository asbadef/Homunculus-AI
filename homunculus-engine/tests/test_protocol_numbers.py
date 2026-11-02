# homunculus-engine/tests/test_protocol_numbers.py
"""The protocol number (G2-B1d, spec §3, D1, D3, D5): twelve digits, all of them sequence, taken
under the settings row's lock inside the admission's transaction — two admissions at once get two
consecutive numbers, a rolled-back one gives its number back, a tenant with no start number is
refused `protocol_not_configured`, and past 999 999 999 999 `protocol_exhausted`. The format
tests need no database; the rest run on Postgres (`db_session`). Synthetic tenants only."""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.errors import PROTOCOL_EXHAUSTED, PROTOCOL_NOT_CONFIGURED, Refusal
from homunculus.protocol.models import ProtocolSettings
from homunculus.protocol.numbers import (
    PROTOCOL_MAX, format_protocol_no, next_protocol_no, parse_protocol_no,
)
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db


def test_a_protocol_number_is_twelve_zero_padded_digits():
    assert format_protocol_no(202600000001) == "202600000001"
    assert format_protocol_no(1) == "000000000001"
    assert format_protocol_no(PROTOCOL_MAX) == "999999999999"


@pytest.mark.parametrize("text, number", [("202600000001", 202600000001), ("000000000000", 0)])
def test_twelve_ascii_digits_read_as_their_number(text, number):
    assert parse_protocol_no(text) == number


#: 202600000001 in full-width digits: twelve characters, so only the `[0-9]`-not-`\d` guard refuses it
#: (`re.fullmatch(r"\d{12}", …)` accepts it).
FULL_WIDTH = "２０２６０００００００１"


def test_the_full_width_case_is_twelve_characters():
    assert len(FULL_WIDTH) == 12


@pytest.mark.parametrize("text", ["20260000001", "2026000000012", "20260000000A", " 202600000001",
                                  FULL_WIDTH, "", None, 202600000001])
def test_anything_else_is_not_a_protocol_number(text):
    assert parse_protocol_no(text) is None


async def _tenant(db, slug: str, next_no: int | None = None, *, settings: bool = True) -> uuid.UUID:
    """The tenant's id — not the ORM row: a rollback or `expire_all()` expires the row, and reading
    `tenant.id` afterwards would lazy-load outside the greenlet (E16)."""
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
    db.add(tenant)
    await db.flush()
    tenant_id = tenant.id
    if settings:
        db.add(ProtocolSettings(tenant_id=tenant_id, next_no=next_no))
    await db.commit()
    return tenant_id


async def _row(db, tenant_id: uuid.UUID) -> tuple[int | None, int | None]:
    db.expire_all()
    row = (await db.execute(select(ProtocolSettings.next_no, ProtocolSettings.last_issued)
                            .where(ProtocolSettings.tenant_id == tenant_id))).one()
    return tuple(row)


@requires_db
async def test_numbers_follow_each_other_from_the_start_the_administrator_set(db_session):
    a = await _tenant(db_session, "hastane-a", 202600000001)
    got = [await next_protocol_no(db_session, a) for _ in range(3)]
    assert got == ["202600000001", "202600000002", "202600000003"]
    await db_session.commit()
    assert await _row(db_session, a) == (202600000004, 202600000003)


@requires_db
async def test_each_tenant_has_its_own_sequence(db_session):
    a = await _tenant(db_session, "hastane-a", 202600000001)
    b = await _tenant(db_session, "hastane-b", 500000000000)
    assert await next_protocol_no(db_session, a) == "202600000001"
    assert await next_protocol_no(db_session, b) == "500000000000"
    assert await next_protocol_no(db_session, a) == "202600000002"


@requires_db
@pytest.mark.parametrize("settings", [False, True], ids=["no row", "next_no NULL"])
async def test_without_a_start_number_no_admission_takes_one(db_session, settings):
    """D5: a number range Homunculus picked by itself could collide with the old HBYS's."""
    a = await _tenant(db_session, "hastane-a", None, settings=settings)
    with pytest.raises(Refusal) as refused:
        await next_protocol_no(db_session, a)
    assert (refused.value.status, refused.value.code) == (409, PROTOCOL_NOT_CONFIGURED)


@requires_db
async def test_past_the_last_twelve_digit_number_the_admission_is_refused_and_gives_it_back(db_session):
    a = await _tenant(db_session, "hastane-a", PROTOCOL_MAX)
    assert await next_protocol_no(db_session, a) == "999999999999"
    await db_session.commit()
    with pytest.raises(Refusal) as refused:
        await next_protocol_no(db_session, a)
    assert (refused.value.status, refused.value.code) == (409, PROTOCOL_EXHAUSTED)
    await db_session.rollback()        # what the route's session does with a refused admission
    assert await _row(db_session, a) == (PROTOCOL_MAX + 1, PROTOCOL_MAX)


@requires_db
async def test_a_rolled_back_admission_gives_its_number_back(db_session):
    a = await _tenant(db_session, "hastane-a", 202600000001)
    assert await next_protocol_no(db_session, a) == "202600000001"
    await db_session.rollback()
    assert await next_protocol_no(db_session, a) == "202600000001"


@requires_db
async def test_two_admissions_at_once_get_two_consecutive_numbers(db_session):
    """Two sessions, two connections: the second waits on the settings row until the first
    commits, then takes the next number — never the same one."""
    a = await _tenant(db_session, "hastane-a", 202600000041)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    first_has_one = asyncio.Event()

    async def first():
        async with maker() as db:
            number = await next_protocol_no(db, a)
            first_has_one.set()
            await asyncio.sleep(0.3)        # hold the row lock while the second one asks
            await db.commit()
            return number

    async def second():
        await first_has_one.wait()
        async with maker() as db:
            number = await next_protocol_no(db, a)
            await db.commit()
            return number

    assert sorted(await asyncio.gather(first(), second())) == ["202600000041", "202600000042"]
    assert await _row(db_session, a) == (202600000043, 202600000042)
