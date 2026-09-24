"""
Signed-in HTTP clients for DB-backed route tests.

A user is placed in a tenant's default groups the way `/admin` does it, and the access token is
minted exactly as sign-in mints it (`build_context` + `issue_tokens`), MFA-verified wherever the
user's groups require MFA. The app's request sessions share the test database with the test's
own session, so a test can arrange rows, call a route, and read the rows back.
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import set_manual_groups
from homunculus.auth.models import Group, TenantMembership, User
from homunculus.auth.service import build_context, issue_tokens
from homunculus.db import get_db


def make_app() -> FastAPI:
    return create_app({"t": "HOSP1"}, run_escalation_loop=False)


async def add_user(
    db: AsyncSession, *, username: str, tenant_id: uuid.UUID | None = None,
    group: Group | None = None, platform_support: bool = False,
) -> User:
    """A local account; a member of `tenant_id` (if given) in `group` (if given). Committed."""
    user = User(username=username, email=username, full_name=username.split("@")[0],
                hashed_password=None, is_active=True, is_platform_support=platform_support)
    db.add(user)
    await db.flush()
    if tenant_id is not None:
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id))
        if group is not None:
            await set_manual_groups(db, user=user, tenant_id=tenant_id,
                                    group_ids=[group.id], granted_by_id=None)
    await db.commit()
    return user


async def bearer(db: AsyncSession, user: User) -> dict[str, str]:
    """An Authorization header carrying the token sign-in would issue to `user` right now."""
    ctx = await build_context(db, user)
    token = issue_tokens(user, ctx, mfa_verified=ctx.mfa_required)["access_token"]
    return {"Authorization": f"Bearer {token}"}


@asynccontextmanager
async def api_client(db: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = make_app()
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
