"""The /admin/ldap logic (spec §7, "Import and mapping"). The same rules as the rest of /admin
(`admin/service.py`): the tenant lock first (`serialise`, which the router calls), nobody grants
beyond their own rights, and every change that can take administrator rights away ends with
`count_admins`, which counts LOCAL administrators only. Errors are AdminError; the router turns
them into HTTP and rolls back.

It borrows `admin/service.py`'s private helpers (`_within`, `_grantable`, `_rights_by_user`,
`_union`, `_flush`) on purpose: one implementation of the rights rule, not two."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.models import User

RESULT_CAP = 50


async def imported_ids(db: AsyncSession, external_ids: Iterable[str]) -> set[str]:
    """Which of these objectGUIDs already have a Homunculus account (in any tenant)."""
    ids = [i for i in external_ids if i]
    if not ids:
        return set()
    rows = await db.execute(select(User.external_id).where(User.external_id.in_(ids)))
    return {value for value in rows.scalars().all() if value is not None}
