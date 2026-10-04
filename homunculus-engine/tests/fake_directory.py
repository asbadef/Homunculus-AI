"""A directory in memory (spec §10: "FakeDirectory implements the same protocol from an
in-memory list") and the helpers the LDAP tests share. Synthetic accounts only.

FakeDirectory keeps Ldap3Directory's contract: `authenticate` finds the account by objectGUID,
returns a disabled or expired one (accountExpires passed) as found WITHOUT checking the
password, and answers None for an unknown account or an empty or wrong password. As there, bad input never reaches the "server": an empty
password or a malformed objectGUID is None and a blank query [] whether or not the directory is
up, and is not recorded; a search returns at most 1–50 rows (`limit` clamped) and no group
lists. `unavailable = True` makes every other call raise LdapUnavailable("unreachable"), as a
domain controller that is down would; a string names another reason (`timeout`, `tls`, ...).
By default such an outage came before any password was sent (the service bind, a search, a
call cut off while queued: `bind_attempted` False); `outage_after_bind = True` makes the outage
`authenticate` raises one that came once the bind as the account had started (a user bind cut
off at the deadline: `bind_attempted` True, counted by the sign-in throttle).
`calls` records which method was asked about what — never a password.

The admin lane is kept too: a call given a `lane` waits for a place in it before the "server"
is asked (and is recorded in `calls` only then), and holds it while it is answered. `delay`
makes every answer take that many seconds (asyncio.sleep); `inside` counts, per method, the
calls being answered right now, and `peak` the most there ever were at once.

One difference to keep in mind: the fake returns a disabled account to `authenticate` and
`find_by_external_id` as found. The real directory does that only under a custom
LDAP_USER_FILTER — the default one excludes disabled accounts, so there a disabled account is
NOT FOUND (sign-in: `bad_credentials`, refresh: `directory_not_found`), and `directory_disabled`
is reached only with a filter that lets disabled accounts through."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, nullcontext
from dataclasses import dataclass, replace

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap import (
    LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable, account_expired,
)
from homunculus.auth.models import (
    AUTH_LDAP, Group, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.service import hash_password
from homunculus.db import get_db
from homunculus.tenant.models import Tenant

DOMAIN_DN = "DC=hastane,DC=local"
AD_PASSWORD = "Ad-Parola-1"


def group_dn(cn: str) -> str:
    return f"CN={cn},OU=Gruplar,{DOMAIN_DN}"


@dataclass
class FakePerson:
    identity: LdapIdentity
    password: str


def person(username: str, *, password: str = AD_PASSWORD, groups: tuple[str, ...] = (),
           disabled: bool = False, email: str | None = None, upn: str | None = None,
           display_name: str | None = None, pwd_last_set: int | None = None,
           account_expires: int | None = None) -> FakePerson:
    """An AD account: sAMAccountName `username`; UPN `<username>@hastane.local` unless given;
    display name `username.title()` unless given; a fresh objectGUID."""
    name = display_name or username.title()
    return FakePerson(
        identity=LdapIdentity(
            external_id=str(uuid.uuid4()), username=username,
            dn=f"CN={name},OU=Personel,{DOMAIN_DN}",
            upn=upn or f"{username.lower()}@hastane.local", email=email, display_name=name,
            group_dns=tuple(groups), disabled=disabled, pwd_last_set=pwd_last_set,
            account_expires=account_expires),
        password=password)


RESULT_CAP = 50          # as Ldap3Directory caps a search


def _is_guid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _limit(limit: int) -> int:
    return max(1, min(limit, RESULT_CAP))


class FakeDirectory:
    def __init__(self, people: list[FakePerson] | tuple = (),
                 groups: list[LdapGroup] | tuple = ()) -> None:
        self.people: dict[str, FakePerson] = {p.identity.external_id: p for p in people}
        self.groups: list[LdapGroup] = list(groups)
        self.unavailable: bool | str = False
        self.outage_after_bind = False
        self.calls: list[tuple[str, str]] = []
        self.delay = 0.0
        self.inside: Counter[str] = Counter()
        self.peak: Counter[str] = Counter()

    def add(self, p: FakePerson) -> FakePerson:
        self.people[p.identity.external_id] = p
        return p

    def update(self, external_id: str, **changes) -> None:
        """Change the account in AD: disable it, move it between groups, set pwdLastSet."""
        p = self.people[external_id]
        p.identity = replace(p.identity, **changes)

    async def _ask(self, method: str, about: str, *, binds: bool = False,
                   lane: asyncio.Semaphore | None = None) -> None:
        async with lane if lane is not None else nullcontext():
            self.calls.append((method, about))
            self.inside[method] += 1
            self.peak[method] = max(self.peak[method], self.inside[method])
            try:
                if self.delay:
                    await asyncio.sleep(self.delay)
            finally:
                self.inside[method] -= 1
        if self.unavailable:
            raise LdapUnavailable(self.unavailable if isinstance(self.unavailable, str)
                                  else "unreachable",
                                  bind_attempted=binds and self.outage_after_bind)

    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        if not password or not _is_guid(external_id):
            return None
        await self._ask("authenticate", external_id, binds=True)
        p = self.people.get(external_id)
        if p is None:
            return None
        if p.identity.disabled or account_expired(p.identity.account_expires, time.time()):
            return p.identity
        return p.identity if password == p.password else None

    async def find_by_external_id(self, external_id: str, *,
                                  lane: asyncio.Semaphore | None = None) -> LdapIdentity | None:
        if not _is_guid(external_id):
            return None
        await self._ask("find_by_external_id", external_id, lane=lane)
        p = self.people.get(external_id)
        return p.identity if p is not None else None

    async def search_users(self, query: str, limit: int = 50, *,
                           lane: asyncio.Semaphore | None = None) -> list[LdapIdentity]:
        q = query.strip().lower()
        if not q:
            return []
        await self._ask("search_users", query, lane=lane)
        hits = [replace(p.identity, group_dns=()) for p in self.people.values()
                if any(q in (value or "").lower() for value in (
                    p.identity.username, p.identity.display_name, p.identity.upn,
                    p.identity.email))]
        return sorted(hits, key=lambda i: i.username.lower())[:_limit(limit)]

    async def search_groups(self, query: str, limit: int = 50, *,
                            lane: asyncio.Semaphore | None = None) -> list[LdapGroup]:
        q = query.strip().lower()
        if not q:
            return []
        await self._ask("search_groups", query, lane=lane)
        return [g for g in self.groups if q in g.name.lower()][:_limit(limit)]

    async def test_connection(self, *, lane: asyncio.Semaphore | None = None) -> None:
        await self._ask("test_connection", "", lane=lane)


def runtime(directory: FakeDirectory) -> LdapRuntime:
    return LdapRuntime(directory=directory, url_host="dc1.hastane.local")


# ---------------------------------------------------------------- database helpers
ADMIN_PASSWORD = "Gizli-123"
TENANT_SLUG = "demo-hastanesi"


async def add_mapping(db: AsyncSession, tenant_id: uuid.UUID, ad_group_dn: str,
                      group: Group) -> LdapGroupMapping:
    """A mapping row as the admin API writes it: the DN lower-cased."""
    mapping = LdapGroupMapping(tenant_id=tenant_id, ad_group_dn=ad_group_dn.strip().lower(),
                               group_id=group.id)
    db.add(mapping)
    await db.flush()
    return mapping


async def add_directory_account(db: AsyncSession, tenant_id: uuid.UUID, p: FakePerson, *,
                                is_active: bool = True) -> User:
    """The Homunculus row an import would have made for `p`, before its first sign-in: the
    sAMAccountName lower-cased as username, no e-mail yet, an old name, no groups."""
    user = User(username=p.identity.username.lower(), email=None, full_name="Eski Ad",
                hashed_password=None, auth_source=AUTH_LDAP,
                external_id=p.identity.external_id, is_active=is_active)
    db.add(user)
    await db.flush()
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id))
    await db.flush()
    return user


async def fresh_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    """The committed row, not the session's cached copy."""
    return (await db.execute(select(User).where(User.id == user_id)
                             .execution_options(populate_existing=True))).scalar_one()


async def group_rows(db: AsyncSession, user_id: uuid.UUID) -> set[tuple[str, str]]:
    """(group slug, source) for every group link of the user."""
    rows = await db.execute(select(Group.slug, UserGroup.source)
                            .join(UserGroup, UserGroup.group_id == Group.id)
                            .where(UserGroup.user_id == user_id))
    return set(rows.all())


async def ad_world(db: AsyncSession) -> dict:
    """One tenant with its default groups; a LOCAL administrator `admin` (ADMIN_PASSWORD, in
    hospital_admin); the AD mappings YB-Hemsire → nurse and YB-Hekim → physician; and `ayse`,
    an AD account (sAMAccountName AYilmaz, in YB-Hemsire, mail Ayse.Yilmaz@hastane.az) already
    imported as `ayilmaz`, before her first sign-in. Committed."""
    tenant = Tenant(name="Demo", slug=TENANT_SLUG, country_code="TR")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    admin = User(username="admin", email="admin@example.com", full_name="Yönetici",
                 hashed_password=hash_password(ADMIN_PASSWORD))
    db.add(admin)
    await db.flush()
    db.add(TenantMembership(user_id=admin.id, tenant_id=tenant.id))
    await db.flush()
    await set_manual_groups(db, user=admin, tenant_id=tenant.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    mappings = {
        "YB-Hemsire": await add_mapping(db, tenant.id, group_dn("YB-Hemsire"), groups["nurse"]),
        "YB-Hekim": await add_mapping(db, tenant.id, group_dn("YB-Hekim"), groups["physician"]),
    }
    ayse = person("AYilmaz", groups=(group_dn("YB-Hemsire"),), email="Ayse.Yilmaz@hastane.az",
                  display_name="Ayşe Yılmaz")
    directory = FakeDirectory([ayse], groups=[LdapGroup(group_dn(cn), cn) for cn in
                                              ("YB-Hemsire", "YB-Hekim", "YB-Sorumlu")])
    account = await add_directory_account(db, tenant.id, ayse)
    await db.commit()
    return {"tenant": tenant, "groups": groups, "admin": admin, "mappings": mappings,
            "ayse": ayse, "account": account, "directory": directory}


# ---------------------------------------------------------------- the app
@asynccontextmanager
async def ad_client(db: AsyncSession, directory: FakeDirectory
                    ) -> AsyncIterator[tuple[AsyncClient, object]]:
    """The real app with `directory` as its LDAP directory. Every request gets its own session,
    as `get_db` gives it in production: the sign-in route rolls its session back while the
    directory answers (plan decision D7), which must not expire the test's objects."""
    app = create_app({"bridge-token": TENANT_SLUG}, run_escalation_loop=False,
                     ldap=runtime(directory))
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app


def audit_events(app, event_type: str, subject: str) -> list:
    return [r for r in app.state.audit.records(event_type=event_type, limit=10_000)
            if r.subject == subject]
