# homunculus-engine/src/homunculus/tres/router.py
"""Yönetim › TRƏS (TRƏS-01, spec §6, D2, D3, D23, D24): the tenant's settings for the national
e-health feed, and a test of the connection. `tres.manage`, the caller's tenant only.

GET /admin/tres/settings — the tenant's row, or the defaults while it has none (mode `off`). The
answer carries `egress`, the install's lock (D2 (b)), so the tab can say that nothing leaves the
server whatever is set here — and NEVER a password: `password_set` only.

PUT /admin/tres/settings — makes the tenant's row if there is none and locks it, then reads the
body against it (mode, environment, the wait, the types, each base URL https with nothing riding
along, a NEW one on a host the install allows (`TRES_HOSTS`, egress.py) — one sent back as stored
is not judged against the hosts again (review M10) —, the lengths: a coded 422 that rolls back,
nothing written; `tres_host_not_allowed` names the `environment`). Then it writes what differs. A password omitted or null keeps the stored one — unless
that environment's base URL changes, which clears it (review #4: a stored password never follows
the account to another server); an empty string clears it. A save that changes something also lets a tenant the platform refused
(`session_refused_at`, worker.py) be tried again. The change is audited `tres.settings`
AFTER the commit with the NAMES of the fields that changed (`mode`, `test.password`…) and, for a
changed base URL, the HOST it now points at (no path, no credentials) — never another value (D24;
A-26: never a 500 for a committed change). A save that changes nothing writes no audit row.

POST /admin/tres/test — one sign-in at the platform with the stored account of the selected
environment: `{"ok": true}` or `{"ok": false, "message": <the platform's words>}`, never the
session id. 409 `egress_off` while the install's lock is closed — the route then builds no client
at all; 409 `tres_host_not_allowed` for a stored address the install does not allow (a row saved
before `TRES_HOSTS` was narrowed); 409 `tres_account_incomplete` while the account lacks a part.
The client comes from `app.state.tres_client_factory` (egress.open_client, the lock and the hosts
bound in), so the refusals hold even for a caller that forgot to ask. This route alone asks it for
`patient_data=False` (no patient data goes here): the live platform's lock, which the factory
applies to every other caller by default, does not hold the test. It is allowed in the mode
`off`: an administrator tests before turning the feed on. Not audited; it writes one thing only: a
success clears `session_refused_at` (the account opens a session again: the rounds go on). A
failed test parks nothing. It ends its database transaction before it asks the platform.

No patient data anywhere in this file."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from functools import partial

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tres.client import TresError
from homunculus.tres.egress import TresEgressRefused, open_client
from homunculus.tres.errors import EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_HOST_NOT_ALLOWED, refusal
from homunculus.tres.models import (
    ACCOUNT_FIELDS, DEFAULT_SETTLE_HOURS, ENVIRONMENTS, RESOURCE_TYPES, TresSettings, account_of,
)
from homunculus.tres.schemas import (
    TresAccountOut, TresSettingsIn, TresSettingsOut, TresTestOut, refusal_of,
)

router = APIRouter(prefix="/admin/tres", tags=["tres"])


def _egress(request: Request) -> bool:
    """The install's lock as the app read it at start-up; closed for an app that never read it."""
    return bool(getattr(request.app.state, "tres_egress", False))


def _hosts(request: Request) -> frozenset[str]:
    """The hosts the install allows, as the app read them at start-up; none at all for an app
    that never read them."""
    return getattr(request.app.state, "tres_hosts", frozenset())


def _host(base_url: str | None) -> str | None:
    """The host of a base URL and nothing else of it — what the audit row may name."""
    if not base_url:
        return None
    try:
        return httpx.URL(base_url).raw_host.decode("ascii").lower() or None   # the wire form (M1)
    except (httpx.InvalidURL, ValueError):
        return None


def _account_out(row: TresSettings | None, prefix: str) -> TresAccountOut:
    def value(name: str) -> str | None:
        return getattr(row, f"{prefix}_{name}") if row is not None else None

    return TresAccountOut(base_url=value("base_url"), username=value("username"),
                          password_set=bool(value("password")), provider_id=value("provider_id"),
                          organization_id=value("organization_id"),
                          organization_name=value("organization_name"))


def _out(row: TresSettings | None, egress: bool) -> TresSettingsOut:
    return TresSettingsOut(
        mode=row.mode if row is not None else "off",
        environment=row.environment if row is not None else "test",
        settle_hours=row.settle_hours if row is not None else DEFAULT_SETTLE_HOURS,
        enabled_types=list(row.enabled_types) if row is not None else list(RESOURCE_TYPES),
        test=_account_out(row, "test"), live=_account_out(row, "live"), egress=egress,
        updated_at=row.updated_at if row is not None else None,
        session_refused_at=row.session_refused_at if row is not None else None)


def _apply(row: TresSettings, payload: TresSettingsIn) -> list[str]:
    """Writes what differs onto the row; answers the NAMES of the fields that changed."""
    changed: list[str] = []

    def put(column: str, value, name: str) -> None:
        if getattr(row, column) != value:
            setattr(row, column, value)
            changed.append(name)

    put("mode", payload.mode, "mode")
    put("environment", payload.environment, "environment")
    put("settle_hours", payload.settle_hours, "settle_hours")
    # In the catalogue's order, whatever order the body listed them in.
    put("enabled_types", [key for key in RESOURCE_TYPES if key in payload.enabled_types], "enabled_types")
    for prefix in ENVIRONMENTS:
        account = getattr(payload, prefix)
        moved = getattr(row, f"{prefix}_base_url") != ((account.base_url or "").strip() or None)
        for name in ACCOUNT_FIELDS:
            value = getattr(account, name)
            if name == "password":
                if value is None and not moved:
                    continue                    # omitted or null: the stored one stays…
                value = value or None           # …unless the address changed; an empty string clears it
            else:
                value = (value or "").strip() or None
            put(f"{prefix}_{name}", value, f"{prefix}.{name}")
    return changed


@router.get("/settings", response_model=TresSettingsOut)
async def read_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> TresSettingsOut:
    return _out(await db.get(TresSettings, caller_tenant), _egress(request))


@router.put("/settings", response_model=TresSettingsOut)
async def write_settings(
    payload: TresSettingsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> TresSettingsOut:
    actor, user_id = user.username, user.id
    await db.execute(insert(TresSettings).values(tenant_id=caller_tenant)
                     .on_conflict_do_nothing(index_elements=["tenant_id"]))
    row = (await db.execute(
        select(TresSettings).where(TresSettings.tenant_id == caller_tenant)
        .with_for_update().execution_options(populate_existing=True))).scalar_one()
    # Judged against the row as stored (review M10): an address sent back unchanged is not judged
    # against the install's hosts again. A refusal writes nothing — not even a new row.
    refused = refusal_of(payload, hosts=_hosts(request),
                         stored={prefix: getattr(row, f"{prefix}_base_url") for prefix in ENVIRONMENTS})
    if refused is not None:
        await db.rollback()
        code, environment = refused
        extra = {"environment": environment} if code == TRES_HOST_NOT_ALLOWED else None
        raise refusal(422, code, extra).http()
    changed = _apply(row, payload)
    audit: dict = {"actor": actor, "changed": changed}
    hosts = {prefix: _host(getattr(row, f"{prefix}_base_url")) for prefix in ENVIRONMENTS
             if f"{prefix}.base_url" in changed}
    if hosts:
        audit["hosts"] = hosts
    if changed:
        row.updated_at, row.updated_by = datetime.now(timezone.utc), user_id
        # A changed setting is the administrator's answer to a refused login: the rounds try again.
        row.session_refused_at = None
    answer = _out(row, _egress(request))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    if changed:
        trail.record(request, hospital, "tres.settings", payload=audit)
    return answer


@router.post("/test", response_model=TresTestOut)
async def test_connection(
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> TresTestOut:
    if not _egress(request):
        raise refusal(409, EGRESS_OFF).http()
    row = await db.get(TresSettings, caller_tenant)
    account = account_of(row) if row is not None else None
    # Everything needed is read: the transaction ends (and its connection goes back to the pool)
    # BEFORE the platform is asked, which may take up to the client's deadline.
    await db.close()
    if account is None:
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http()
    factory = getattr(request.app.state, "tres_client_factory", None) or partial(
        open_client, egress=_egress(request), hosts=_hosts(request))
    try:
        # The one caller that sends no patient data: the live platform's lock (egress.live_closed)
        # does not hold it. Every other caller of the factory keeps the default, closed (review M10).
        client = factory(account, patient_data=False)
    except TresEgressRefused as exc:    # the lock, or an address the install does not allow
        raise refusal(409, exc.code).http() from None
    except ValueError:
        # Only from a factory that builds a TresClient itself (the app's, open_client, refuses
        # first): its constructor refused the stored base URL (not https, not a URL).
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http() from None
    try:
        await client.token()
    except TresError as exc:
        return TresTestOut(ok=False, message=exc.message)      # parks nothing, clears nothing
    finally:
        await client.aclose()
    # The platform opened a session with the stored account: a parked tenant's rounds go on.
    await db.execute(update(TresSettings).where(TresSettings.tenant_id == caller_tenant)
                     .values(session_refused_at=None))
    await db.commit()
    return TresTestOut(ok=True, message=None)
