# src/homunculus/api/identity.py
"""Which hospital a request belongs to.

Two credentials reach the clinical routes: the bridge's static tenant token, and a clinician's
JWT. They meet because the engine's hospital key *is* the tenant slug — so the bridge is
configured with the slug, and a user resolves to theirs through their membership. No second
mapping table to drift out of step with the first.

These functions are pure so the decisions can be tested without a database; the queries that feed
them live in app.py.
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

    A device (the bridge's static tenant token) has no `actor`: it is a machine identity and
    is exempt from permission checks — it can only ever reach the hospital its token names.
    A clinician's JWT resolves to an actor, their groups and their permissions.
    """
    hospital: str
    actor: str | None = None
    groups: tuple[str, ...] = ()
    perms: frozenset[str] = frozenset()

    @property
    def is_device(self) -> bool:
        return self.actor is None

    def can(self, permission: str) -> bool:
        return self.is_device or permission in self.perms
