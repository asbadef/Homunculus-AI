"""A directory in memory (spec §10: "FakeDirectory implements the same protocol from an
in-memory list") and the helpers the LDAP tests share. Synthetic accounts only.

FakeDirectory keeps Ldap3Directory's contract: `authenticate` finds the account by objectGUID,
returns a disabled one as found WITHOUT checking the password, and answers None for an unknown
account or an empty or wrong password. `unavailable = True` makes every call raise
LdapUnavailable("unreachable"), as a domain controller that is down would. `calls` records which
method was asked about what — never a password."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, replace

from homunculus.auth.ldap import LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable

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
           display_name: str | None = None, pwd_last_set: int | None = None) -> FakePerson:
    """An AD account: sAMAccountName `username`; UPN `<username>@hastane.local` unless given;
    display name `username.title()` unless given; a fresh objectGUID."""
    name = display_name or username.title()
    return FakePerson(
        identity=LdapIdentity(
            external_id=str(uuid.uuid4()), username=username,
            dn=f"CN={name},OU=Personel,{DOMAIN_DN}",
            upn=upn or f"{username.lower()}@hastane.local", email=email, display_name=name,
            group_dns=tuple(groups), disabled=disabled, pwd_last_set=pwd_last_set),
        password=password)


class FakeDirectory:
    def __init__(self, people: list[FakePerson] | tuple = (),
                 groups: list[LdapGroup] | tuple = ()) -> None:
        self.people: dict[str, FakePerson] = {p.identity.external_id: p for p in people}
        self.groups: list[LdapGroup] = list(groups)
        self.unavailable = False
        self.calls: list[tuple[str, str]] = []

    def add(self, p: FakePerson) -> FakePerson:
        self.people[p.identity.external_id] = p
        return p

    def update(self, external_id: str, **changes) -> None:
        """Change the account in AD: disable it, move it between groups, set pwdLastSet."""
        p = self.people[external_id]
        p.identity = replace(p.identity, **changes)

    def _ask(self, method: str, about: str) -> None:
        self.calls.append((method, about))
        if self.unavailable:
            raise LdapUnavailable("unreachable")

    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        self._ask("authenticate", external_id)
        p = self.people.get(external_id)
        if p is None:
            return None
        if p.identity.disabled:
            return p.identity
        return p.identity if password and password == p.password else None

    async def find_by_external_id(self, external_id: str) -> LdapIdentity | None:
        self._ask("find_by_external_id", external_id)
        p = self.people.get(external_id)
        return p.identity if p is not None else None

    async def search_users(self, query: str, limit: int = 50) -> list[LdapIdentity]:
        self._ask("search_users", query)
        q = query.strip().lower()
        if not q:
            return []
        hits = [p.identity for p in self.people.values()
                if any(q in (value or "").lower() for value in (
                    p.identity.username, p.identity.display_name, p.identity.upn,
                    p.identity.email))]
        return sorted(hits, key=lambda i: i.username.lower())[:limit]

    async def search_groups(self, query: str, limit: int = 50) -> list[LdapGroup]:
        self._ask("search_groups", query)
        q = query.strip().lower()
        return [g for g in self.groups if q and q in g.name.lower()][:limit]

    async def test_connection(self) -> None:
        self._ask("test_connection", "")


def runtime(directory: FakeDirectory) -> LdapRuntime:
    return LdapRuntime(directory=directory, url_host="dc1.hastane.local")
