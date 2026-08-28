"""Which hospital a request belongs to.

The engine keys its state by a hospital string; a logged-in user belongs to one or more tenants.
These are the pure decisions in that mapping — kept out of the request handlers so they can be
tested without a database.
"""
from __future__ import annotations

from homunculus.api.identity import hospital_for_slugs, unmatched_hospital_keys


def test_no_membership_means_no_hospital():
    assert hospital_for_slugs([]) is None


def test_a_single_membership_resolves_to_it():
    assert hospital_for_slugs(["demo-hastanesi"]) == "demo-hastanesi"


def test_several_memberships_resolve_deterministically():
    """Lowest slug, always the same one.

    A user who lands on the wrong hospital's board must land on the *same* wrong board every
    time — an intermittent one is a bug nobody can report or reproduce.
    """
    assert hospital_for_slugs(["kardiyoloji", "acil", "yogun-bakim"]) == "acil"
    assert hospital_for_slugs(["yogun-bakim", "acil", "kardiyoloji"]) == "acil"


def test_configured_keys_matching_no_tenant_are_reported():
    """The silent failure this catches: the bridge writes to a hospital key no user can read,
    so observations arrive, alerts fire, and every screen stays empty with nothing complaining."""
    assert unmatched_hospital_keys(["HOSP1"], ["demo-hastanesi"]) == ["HOSP1"]
    assert unmatched_hospital_keys(["demo-hastanesi"], ["demo-hastanesi"]) == []
    assert unmatched_hospital_keys([], ["demo-hastanesi"]) == []


def test_unmatched_keys_are_reported_in_a_stable_order():
    assert unmatched_hospital_keys(["b", "a"], []) == ["a", "b"]
