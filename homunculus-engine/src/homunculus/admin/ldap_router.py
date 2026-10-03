"""
/admin/ldap — the Active Directory side of user administration (spec §7, "Import and
mapping"). Every route needs `users.manage` and resolves the caller's tenant:

  GET    /admin/ldap/status        configured?, the directory's host, the last connection test
  POST   /admin/ldap/test          bind with the service account now (200 {ok, reason})
  GET    /admin/ldap/search?q=     AD accounts (at most 50), each flagged already_imported
  GET    /admin/ldap/groups?q=     AD groups (at most 50), for the mapping picker
  POST   /admin/ldap/import        create accounts from AD (idempotent; plan decision D12)

With LDAP off (LDAP_URL unset) every route but `status` answers 409 `Dizin yapılandırılmamış`;
`status` answers `configured: false`, so the panel can hide itself (plan decision D14). A
caller without `users.manage` gets 403 first, configured or not. A directory that does not
answer is 503 `Dizin sunucusuna ulaşılamıyor`. The service account's password never appears in
a response. Writes follow `admin/router.py`: `_begin` (the tenant lock and a re-read of the
caller), AdminError → rollback, the audit row after the commit.
"""
from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import ldap_service
from homunculus.admin.router import _audit, _begin, _run
from homunculus.admin.router import _user_out as _admin_user_out
from homunculus.admin.schemas import (
    LdapGroupOut, LdapImportedOut, LdapImportIn, LdapImportOut, LdapSkippedOut, LdapStatusOut,
    LdapTestOut, LdapUserOut,
)
from homunculus.admin.service import get_tenant_user
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission,
)
from homunculus.auth.ldap import (
    DIRECTORY_DOWN, NOT_CONFIGURED, LdapIdentity, LdapRuntime, LdapUnavailable, get_ldap,
)
from homunculus.db import get_db

router = APIRouter(prefix="/admin/ldap", tags=["admin"])

_users = [Depends(require_permission("users.manage"))]
# Every route resolves the caller's tenant (tests/test_tenant_isolation.py demands it), a
# search included: the directory is one per deployment, the caller is not.
_users_here = [*_users, Depends(caller_tenant_id)]


def configured_ldap(ldap: LdapRuntime | None = Depends(get_ldap)) -> LdapRuntime:
    """The directory, or 409 when LDAP is off. Resolved after the permission guard, so a caller
    without `users.manage` learns nothing about the configuration."""
    if ldap is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=NOT_CONFIGURED)
    return ldap


def _directory_down() -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=DIRECTORY_DOWN)


def _identity_out(identity: LdapIdentity, imported: bool) -> LdapUserOut:
    return LdapUserOut(external_id=identity.external_id, username=identity.username,
                       upn=identity.upn, email=identity.email,
                       display_name=identity.display_name, dn=identity.dn,
                       disabled=identity.disabled, already_imported=imported)


@router.get("/status", response_model=LdapStatusOut, dependencies=_users_here)
async def ldap_status(ldap: LdapRuntime | None = Depends(get_ldap)) -> LdapStatusOut:
    if ldap is None:
        return LdapStatusOut(configured=False)
    return LdapStatusOut(configured=True, url_host=ldap.url_host,
                         last_test_at=ldap.last_test_at, last_test_ok=ldap.last_test_ok)


@router.post("/test", response_model=LdapTestOut, dependencies=_users_here)
async def ldap_test(request: Request, principal: Principal = Depends(get_principal),
                    ldap: LdapRuntime = Depends(configured_ldap)) -> LdapTestOut:
    ok, reason = await ldap.test()
    _audit(request, principal, "ldap.test", ldap.url_host, after={"ok": ok, "reason": reason})
    return LdapTestOut(ok=ok, reason=reason, checked_at=ldap.last_test_at)


@router.get("/search", response_model=list[LdapUserOut], dependencies=_users_here)
async def ldap_search(q: str = Query(min_length=2, max_length=64),
                      ldap: LdapRuntime = Depends(configured_ldap),
                      db: AsyncSession = Depends(get_db)) -> list[LdapUserOut]:
    try:
        found = await ldap.directory.search_users(q, ldap_service.RESULT_CAP)
    except LdapUnavailable:
        raise _directory_down() from None
    found = found[:ldap_service.RESULT_CAP]
    imported = await ldap_service.imported_ids(db, [i.external_id for i in found])
    return [_identity_out(i, i.external_id in imported) for i in found]


@router.get("/groups", response_model=list[LdapGroupOut], dependencies=_users_here)
async def ldap_groups(q: str = Query(min_length=2, max_length=64),
                      ldap: LdapRuntime = Depends(configured_ldap)) -> list[LdapGroupOut]:
    try:
        found = await ldap.directory.search_groups(q, ldap_service.RESULT_CAP)
    except LdapUnavailable:
        raise _directory_down() from None
    return [LdapGroupOut(dn=g.dn, name=g.name) for g in found[:ldap_service.RESULT_CAP]]


@router.post("/import", response_model=LdapImportOut, dependencies=_users)
async def ldap_import(body: LdapImportIn, request: Request,
                      principal: Principal = Depends(get_principal),
                      tenant_id: uuid.UUID = Depends(caller_tenant_id),
                      ldap: LdapRuntime = Depends(configured_ldap),
                      db: AsyncSession = Depends(get_db)) -> LdapImportOut:
    """The directory is asked first, before the tenant lock — a slow directory must not hold up
    every other /admin write — and only about ids that have no account yet. A directory that
    does not answer is 503 with nothing written. Then the import, under the lock, in one
    transaction; one `ldap.import` audit row per created account, after the commit."""
    wanted = list(dict.fromkeys(str(i) for i in body.external_ids))
    known = await ldap_service.imported_ids(db, wanted)
    fresh = [eid for eid in wanted if eid not in known]
    try:
        answers = await asyncio.gather(
            *(ldap.directory.find_by_external_id(eid) for eid in fresh))
    except LdapUnavailable:
        raise _directory_down() from None
    actor = await _begin(db, tenant_id, principal)
    report = await _run(db, ldap_service.import_users(
        db, tenant_id, actor, wanted, dict(zip(fresh, answers)),
        extra_group_ids=list(dict.fromkeys(body.extra_group_ids))))
    await db.commit()
    imported: list[LdapImportedOut] = []
    for row in report.imported:
        user = await get_tenant_user(db, tenant_id, row.user_id)
        groups = _admin_user_out(user, tenant_id).groups
        imported.append(LdapImportedOut(external_id=row.external_id, id=user.id,
                                        username=user.username, groups=groups))
        _audit(request, principal, "ldap.import", str(user.id),
               after={"username": user.username, "external_id": row.external_id,
                      "groups": [g.slug for g in groups]})
    return LdapImportOut(imported=imported,
                         skipped=[LdapSkippedOut(external_id=e, reason=r)
                                  for e, r in report.skipped])
