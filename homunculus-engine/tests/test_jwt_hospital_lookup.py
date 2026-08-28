"""The real JWT -> hospital lookup, with the database faked out.

The query itself needs Postgres and is exercised on the deployment; what is worth testing here is
the decision logic around it — an undecodable token, a user with no membership, and the
multi-membership case all have to behave predictably.
"""
from __future__ import annotations

from homunculus.api.prodserver import make_jwt_hospital_resolver


def _slugs(*values):
    """A stand-in for the database read, matching whatever shape the resolver expects."""
    async def read(_user_id):
        return list(values)
    return read


async def test_an_undecodable_token_is_not_a_hospital():
    resolve = make_jwt_hospital_resolver(_slugs(), decode=lambda _t: None)
    assert await resolve("not-a-jwt") is None


async def test_a_user_with_no_membership_is_not_a_hospital():
    resolve = make_jwt_hospital_resolver(
        _slugs(), decode=lambda _t: "11111111-1111-1111-1111-111111111111")
    assert await resolve("valid") is None


async def test_the_lowest_slug_wins():
    resolve = make_jwt_hospital_resolver(
        _slugs("kardiyoloji", "acil"),
        decode=lambda _t: "11111111-1111-1111-1111-111111111111")
    assert await resolve("valid") == "acil"


async def test_a_single_membership_resolves_to_it():
    resolve = make_jwt_hospital_resolver(
        _slugs("demo-hastanesi"),
        decode=lambda _t: "11111111-1111-1111-1111-111111111111")
    assert await resolve("valid") == "demo-hastanesi"
