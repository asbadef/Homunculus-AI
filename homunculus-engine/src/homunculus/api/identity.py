# src/homunculus/api/identity.py
"""Which hospital a request belongs to, and who is calling a board route.

Two credentials reach the clinical routes: the bridge's static tenant token, and a clinician's
JWT. They meet because the engine's hospital key *is* the tenant slug — so the bridge is
configured with the slug, and a clinician's token carries theirs in its `tenant` claim (sign-in
resolves it once, with `hospital_for_slugs`). No second mapping table to drift out of step with
the first.

`Caller` is what the board routes in app.py act on. The functions here are pure so the decisions
can be tested without a database; the query behind a clinician's `Caller` (account, token
version, and the tenant claim checked against an active membership) lives in
`api/prodserver.py`.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass


def hospital_for_slugs(slugs: Sequence[str]) -> str | None:
    """The hospital key for a user's tenant memberships.

    A user with several memberships gets the lowest slug, always. Deterministic rather than
    arbitrary: someone seeing the wrong hospital's board must see the same wrong board every
    time, or the fault cannot be reproduced or reported.
    """
    return min(slugs) if slugs else None


def unmatched_hospital_keys(configured: Iterable[str], known_slugs: Iterable[str]) -> list[str]:
    """Configured TENANTS hospital keys that match no tenant slug.

    This catches a failure with no symptoms: the bridge writes observations under a key no user
    can ever resolve to, so data arrives, alerts fire, escalations run — and every screen stays
    empty, with nothing anywhere reporting a problem.
    """
    known = set(known_slugs)
    return sorted({key for key in configured if key not in known})


@dataclass(frozen=True)
class Caller:
    """Who is calling a board route.

    A device (the bridge's static tenant token) is a machine identity: it is exempt from
    permission checks and can only ever reach the hospital its token names. A clinician's JWT
    resolves to an actor, their groups and their permissions.

    Being a device is stated, never inferred. `device` defaults to False, so a Caller that
    merely lacks an actor is not a device; it has no permissions, and the board refuses it
    outright (`_caller` in app.py).
    """
    hospital: str
    actor: str | None = None
    groups: tuple[str, ...] = ()
    perms: frozenset[str] = frozenset()
    device: bool = False

    def __post_init__(self) -> None:
        """Refuse a malformed Caller when it is built, not when a route reads it. `perms` above
        all: a plain string would pass `in` as a substring match ("board" in "board.view"). A
        blank `actor` is allowed here — a device has none — and refused for a JWT by `_caller`."""
        if not isinstance(self.hospital, str) or not self.hospital.strip():
            raise ValueError("Caller.hospital must be a non-blank string")
        if self.actor is not None and not isinstance(self.actor, str):
            raise TypeError("Caller.actor must be None or a string")
        if not isinstance(self.groups, tuple) or not all(isinstance(g, str) for g in self.groups):
            raise TypeError("Caller.groups must be a tuple of strings")
        if (not isinstance(self.perms, frozenset)
                or not all(isinstance(p, str) for p in self.perms)):
            raise TypeError("Caller.perms must be a frozenset of strings")
        if not isinstance(self.device, bool):
            raise TypeError("Caller.device must be a bool")

    @property
    def is_device(self) -> bool:
        return self.device

    def can(self, permission: str) -> bool:
        return self.device or permission in self.perms
