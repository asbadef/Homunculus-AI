"""
/admin/ldap — the Active Directory side of user administration (spec §7, "Import and
mapping"). Every route needs `users.manage` and resolves the caller's tenant:

  GET    /admin/ldap/status        configured?, the directory's host, the last connection test
  POST   /admin/ldap/test          bind with the service account now (200 {ok, reason})
  GET    /admin/ldap/search?q=     AD accounts (at most 50), each flagged already_imported
  GET    /admin/ldap/groups?q=     AD groups (at most 50), for the mapping picker
  POST   /admin/ldap/import        create accounts from AD (idempotent; plan decision D12)
  GET    /admin/ldap/group-mappings        this tenant's AD group → group table
  POST   /admin/ldap/group-mappings        add a row (applies from each user's next sign-in or refresh)
  DELETE /admin/ldap/group-mappings/{id}   remove a row and, now, the rights it gave

Writing the mapping table (its POST and DELETE) needs more: the whole catalogue, i.e. the system
group (403 `AD grup eşlemesini yalnız sistem yöneticisi değiştirebilir`) — a row regroups every
member of its AD group, which a user desk may not do (`ldap_service._full_administrator`).

With LDAP off (LDAP_URL unset) every route but `status` answers 409 `Dizin yapılandırılmamış`;
`status` answers `configured: false`, so the panel can hide itself (plan decision D14). A
caller without `users.manage` gets 403 first, configured or not. A directory that does not
answer is 503 `Dizin sunucusuna ulaşılamıyor`. The service account's password never appears in
a response. Writes follow `admin/router.py`: `_begin` (the tenant lock and a re-read of the
caller), AdminError → rollback, the audit row after the commit.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BeforeValidator
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import ldap_service
from homunculus.admin.router import _audit, _begin, _run
from homunculus.admin.schemas import (
    LdapGroupOut, LdapImportedOut, LdapImportIn, LdapImportOut, LdapMappingIn, LdapMappingOut,
    LdapSkippedOut, LdapStatusOut, LdapTestOut, LdapUserOut, UserGroupOut,
)
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission,
)
from homunculus.auth.ldap import (
    DIRECTORY_DOWN, NOT_CONFIGURED, LdapIdentity, LdapRuntime, LdapUnavailable, get_ldap,
)
from homunculus.auth.models import Group, LdapGroupMapping
from homunculus.db import get_db

router = APIRouter(prefix="/admin/ldap", tags=["admin"])

_users = [Depends(require_permission("users.manage"))]
# Every route resolves the caller's tenant (tests/test_tenant_isolation.py demands it), a
# search included: the directory is one per deployment, the caller is not.
_users_here = [*_users, Depends(caller_tenant_id)]


def _trimmed(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


# A search's `q` (plan D17: 2-64 characters), trimmed BEFORE its length is checked: two
# characters of query, not of padding; the directory gets it trimmed.
SearchQuery = Annotated[str, Query(min_length=2, max_length=64), BeforeValidator(_trimmed)]


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
async def ldap_search(q: SearchQuery,
                      ldap: LdapRuntime = Depends(configured_ldap),
                      db: AsyncSession = Depends(get_db)) -> list[LdapUserOut]:
    try:
        found = await ldap.directory.search_users(q, ldap_service.RESULT_CAP,
                                                  lane=ldap.admin_lane)
    except LdapUnavailable:
        raise _directory_down() from None
    found = found[:ldap_service.RESULT_CAP]
    imported = await ldap_service.imported_ids(db, [i.external_id for i in found])
    return [_identity_out(i, i.external_id in imported) for i in found]


@router.get("/groups", response_model=list[LdapGroupOut], dependencies=_users_here)
async def ldap_groups(q: SearchQuery,
                      ldap: LdapRuntime = Depends(configured_ldap)) -> list[LdapGroupOut]:
    try:
        found = await ldap.directory.search_groups(q, ldap_service.RESULT_CAP,
                                                   lane=ldap.admin_lane)
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
    every other /admin write — and only about ids that have no account yet, through the admin
    lane (`ldap_service.lookup_accounts`). A directory that does not answer is 503 with nothing
    written. Then the import, under the lock, in one transaction; one `ldap.import` audit row
    per created account, after the commit. The response and those rows are built from what the
    import wrote, read before the commit (`ldap_service.Imported`): no lookup after it, which a
    concurrent change could turn into a 500 for a committed import."""
    wanted = list(dict.fromkeys(str(i) for i in body.external_ids))
    known = await ldap_service.imported_ids(db, wanted)
    fresh = [eid for eid in wanted if eid not in known]
    try:
        identities = await ldap_service.lookup_accounts(ldap, fresh)
    except LdapUnavailable:
        raise _directory_down() from None
    actor = await _begin(db, tenant_id, principal)
    report = await _run(db, ldap_service.import_users(
        db, tenant_id, actor, wanted, identities,
        extra_group_ids=list(dict.fromkeys(body.extra_group_ids))))
    await db.commit()
    imported: list[LdapImportedOut] = []
    for row in report.imported:                     # as written, no lookup after the commit
        imported.append(LdapImportedOut(
            external_id=row.external_id, id=row.user_id, username=row.username,
            groups=[UserGroupOut(id=g.id, slug=g.slug, name=g.name, source=g.source)
                    for g in row.groups]))
        _audit(request, principal, "ldap.import", str(row.user_id),
               after={"username": row.username, "external_id": row.external_id,
                      "groups": [g.slug for g in row.groups]})
    return LdapImportOut(imported=imported,
                         skipped=[LdapSkippedOut(external_id=e, reason=r)
                                  for e, r in report.skipped])


def _mapping_out(mapping: LdapGroupMapping, group: Group) -> LdapMappingOut:
    return LdapMappingOut(id=mapping.id, ad_group_dn=mapping.ad_group_dn, group_id=group.id,
                          group_slug=group.slug, group_name=group.name,
                          created_at=mapping.created_at)


@router.get("/group-mappings", response_model=list[LdapMappingOut],
            dependencies=[*_users, Depends(configured_ldap)])
async def list_group_mappings(tenant_id: uuid.UUID = Depends(caller_tenant_id),
                              db: AsyncSession = Depends(get_db)) -> list[LdapMappingOut]:
    return [_mapping_out(m, g) for m, g in await ldap_service.list_mappings(db, tenant_id)]


@router.post("/group-mappings", response_model=LdapMappingOut,
             status_code=status.HTTP_201_CREATED,
             dependencies=[*_users, Depends(configured_ldap)])
async def create_group_mapping(body: LdapMappingIn, request: Request,
                               principal: Principal = Depends(get_principal),
                               tenant_id: uuid.UUID = Depends(caller_tenant_id),
                               db: AsyncSession = Depends(get_db)) -> LdapMappingOut:
    actor = await _begin(db, tenant_id, principal)
    mapping, group = await _run(db, ldap_service.create_mapping(
        db, tenant_id, actor, ad_group_dn=body.ad_group_dn, group_id=body.group_id))
    await db.commit()
    _audit(request, principal, "ldap.mapping.create", str(mapping.id),
           after={"ad_group_dn": mapping.ad_group_dn, "group": group.slug})
    return _mapping_out(mapping, group)


@router.delete("/group-mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[*_users, Depends(configured_ldap)])
async def delete_group_mapping(mapping_id: uuid.UUID, request: Request,
                               principal: Principal = Depends(get_principal),
                               tenant_id: uuid.UUID = Depends(caller_tenant_id),
                               db: AsyncSession = Depends(get_db)) -> Response:
    actor = await _begin(db, tenant_id, principal)
    removed = await _run(db, ldap_service.delete_mapping(db, tenant_id, actor, mapping_id))
    await db.commit()
    _audit(request, principal, "ldap.mapping.delete", str(mapping_id),
           before={"ad_group_dn": removed.ad_group_dn, "group": removed.group_slug},
           after={"removed_from": list(removed.removed_from)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
