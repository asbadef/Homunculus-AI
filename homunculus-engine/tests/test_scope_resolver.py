"""Turning a credential into a scope — the decisions, without a database or a signing key.

The interesting cases here are all failures. A scope resolver that widens when it cannot answer
is worse than none at all: it looks like access control every day and hands over the hospital on
the day Postgres blinks.
"""
from __future__ import annotations

import pytest

from homunculus.scope import ScopeReason
from homunculus.scope.resolver import make_scope_resolver


def reader(role="NURSE", units=(), beds=(), own=()):
    async def read(_user_id: str):
        return role, list(units), list(beds), list(own)
    return read


def decoder(user_id: str | None):
    return lambda _credential: user_id


class TestAWhatItResolves:
    async def test_a_valid_token_resolves_to_the_users_assignment(self):
        resolve = make_scope_resolver(reader(units=["unit-adult"]), decode=decoder("u-1"))
        scope = await resolve("token")
        assert scope.unit_ids == frozenset({"unit-adult"})
        assert scope.reason == ScopeReason.ASSIGNED

    async def test_an_administrator_resolves_unrestricted(self):
        resolve = make_scope_resolver(reader(role="HOSPITAL_ADMIN"), decode=decoder("u-1"))
        assert (await resolve("token")).unrestricted is True

    async def test_break_glass_adds_the_patients_it_names(self):
        async def glass(_user_id):
            return ["p-77"]

        resolve = make_scope_resolver(reader(units=["unit-adult"]), decode=decoder("u-1"),
                                      break_glass=glass)
        assert (await resolve("token")).own_patient_ids == frozenset({"p-77"})

    async def test_without_a_break_glass_reader_nothing_is_granted_silently(self):
        resolve = make_scope_resolver(reader(units=["unit-adult"]), decode=decoder("u-1"))
        assert (await resolve("token")).own_patient_ids == frozenset()


class TestBWhenItCannotAnswer:
    async def test_a_token_that_does_not_decode_gets_nothing(self):
        resolve = make_scope_resolver(reader(), decode=decoder(None))
        scope = await resolve("expired-or-forged")
        assert scope.unrestricted is False
        assert scope.reason == "unknown"

    async def test_a_failing_database_refuses_rather_than_widens(self):
        """The failure mode that matters. Treating a look-up error as "no restrictions" would
        hand every patient to whoever is logged in at the moment the database hiccups."""
        async def broken(_user_id: str):
            raise RuntimeError("connection reset")

        resolve = make_scope_resolver(broken, decode=decoder("u-1"))
        scope = await resolve("token")
        assert scope.unrestricted is False
        assert scope.is_empty

    async def test_a_failing_break_glass_lookup_also_refuses(self):
        async def broken(_user_id: str):
            raise RuntimeError("connection reset")

        resolve = make_scope_resolver(reader(units=["unit-adult"]), decode=decoder("u-1"),
                                      break_glass=broken)
        assert (await resolve("token")).is_empty


class TestCTheEnforcementFlag:
    """Whether an unassigned user sees everything or nothing is a deployment decision, made on a
    date, not a consequence of a deploy."""

    async def test_off_by_default_the_unassigned_see_the_ward(self):
        resolve = make_scope_resolver(reader(), decode=decoder("u-1"),
                                      enforce_unassigned=lambda: False)
        scope = await resolve("token")
        assert scope.unrestricted is True
        assert scope.reason == ScopeReason.UNASSIGNED

    async def test_on_the_unassigned_see_nothing(self):
        resolve = make_scope_resolver(reader(), decode=decoder("u-1"),
                                      enforce_unassigned=lambda: True)
        assert (await resolve("token")).unrestricted is False

    def test_the_flag_reads_the_environment_and_defaults_to_off(self, monkeypatch):
        from homunculus.scope.resolver import enforce_unassigned_default

        monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
        assert enforce_unassigned_default() is False
        monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
        assert enforce_unassigned_default() is True
        monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "no")
        assert enforce_unassigned_default() is False


class TestDTheProductionServerActuallyWiresIt:
    """This project's signature failure is a capability nothing calls. The scope boundary is
    worth nothing if `prodserver` builds the app without it."""

    def test_prodserver_passes_a_scope_resolver_to_create_app(self, monkeypatch):
        import inspect

        from homunculus.api import prodserver

        source = inspect.getsource(prodserver)
        assert "resolve_scope=_scope_resolver()" in source

    def test_the_resolver_it_builds_is_callable(self):
        from homunculus.api.prodserver import _scope_resolver

        assert callable(_scope_resolver())


@pytest.mark.parametrize("role,expected", [
    ("HOSPITAL_ADMIN", True), ("PLATFORM_SUPPORT", True),
    ("NURSE", False), ("ATTENDING", False), ("RAPID_RESPONSE", False),
    ("PHARMACIST", False), ("BIOMEDICAL", False), ("AUDITOR", False),
])
async def test_which_roles_are_unscoped_is_a_short_and_explicit_list(role, expected):
    """Written as a table so widening it is a visible edit rather than a side effect.

    BIOMEDICAL is scoped here although `patientScope.js` leaves it unrestricted on screen; the
    engineer's access to patient *names* is a separate open item and this table does not grant it.
    """
    resolve = make_scope_resolver(reader(role=role, units=["unit-adult"]), decode=decoder("u-1"))
    assert (await resolve("token")).unrestricted is expected
