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


def test_the_warning_names_the_key_and_says_what_breaks(caplog):
    """The operator has to be able to act on this line without reading the source."""
    import logging

    from homunculus.api.prodserver import warn_about_unmatched_tenants

    with caplog.at_level(logging.WARNING):
        warn_about_unmatched_tenants(["HOSP1"], ["demo-hastanesi"])

    message = caplog.text
    assert "HOSP1" in message
    assert "demo-hastanesi" in message


def test_no_warning_when_every_key_matches(caplog):
    import logging

    from homunculus.api.prodserver import warn_about_unmatched_tenants

    with caplog.at_level(logging.WARNING):
        warn_about_unmatched_tenants(["demo-hastanesi"], ["demo-hastanesi"])

    assert caplog.text == ""


def test_tenants_entries_with_an_empty_token_or_hospital_are_dropped(caplog):
    """`TENANTS="tokA:HOSP1, :HOSP2"` once parsed to a "" token: a request with no token at all
    was then HOSP2's device, and `/stream` with no token streamed HOSP2's board. The warning
    names the entry's position only, since an entry may hold a token."""
    import logging

    from homunculus.api.prodserver import _parse_tenants

    with caplog.at_level(logging.WARNING):
        parsed = _parse_tenants("tokA:HOSP1, :HOSP2, secret-tok: ,no-colon-tok, tokE:HOSP5,")

    assert parsed == {"tokA": "HOSP1", "tokE": "HOSP5"}
    for position in (2, 3, 4):
        assert f"entry {position} " in caplog.text
    assert "secret-tok" not in caplog.text and "no-colon-tok" not in caplog.text


async def test_a_failing_startup_check_does_not_stop_the_service(caplog):
    """A diagnostic that can take the ward's monitoring down is worse than the fault it reports."""
    import logging

    from fastapi.testclient import TestClient

    from homunculus.api.app import create_app

    async def exploding_check():
        raise RuntimeError("database unreachable")

    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False,
                     on_startup_check=exploding_check)

    with caplog.at_level(logging.ERROR):
        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
