"""The real JWT -> hospital lookup, with the database faked out.

The query itself needs Postgres and is exercised on the deployment; what is worth testing here is
the decision logic around it — an undecodable token, a user with no membership, and the
multi-membership case all have to behave predictably.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from jose import jwt as jose_jwt

from homunculus.api.prodserver import (
    _decode_access_token,
    _tenant_slug_query,
    make_jwt_hospital_resolver,
)
from homunculus.auth import jwt as auth_jwt
from homunculus.auth.jwt import create_access_token, create_refresh_token


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


# --- the real decode(), not the fakes above -------------------------------------------------
#
# Every test up to here injects `decode`, so `_decode_access_token` — the function that actually
# has to tell an access token from a refresh token, and a live one from an expired one — was
# never exercised. These mint real tokens with the project's own signing helpers and call it
# directly.

def _expired_access_token(subject: str) -> str:
    """A genuinely expired, correctly-signed access token: same shape `create_access_token`
    produces, but with `exp` in the past. Minted with the real secret/algorithm rather than
    monkeypatching the clock, so the test proves the actual expiry check in `decode_token`."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": now - timedelta(hours=2),
        "exp": now - timedelta(hours=1),
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    return jose_jwt.encode(payload, auth_jwt.JWT_SECRET, algorithm=auth_jwt.JWT_ALGORITHM)


def test_a_refresh_token_is_rejected_by_the_real_decoder():
    # Access and refresh tokens share a signing key; only the `type` claim tells them apart.
    # A refresh token authorising the clinical board would be a real hole.
    token = create_refresh_token("11111111-1111-1111-1111-111111111111")
    assert _decode_access_token(token) is None


def test_an_access_token_is_accepted_by_the_real_decoder():
    token = create_access_token("11111111-1111-1111-1111-111111111111")
    assert _decode_access_token(token) == "11111111-1111-1111-1111-111111111111"


def test_an_expired_access_token_is_rejected_by_the_real_decoder():
    token = _expired_access_token("11111111-1111-1111-1111-111111111111")
    assert _decode_access_token(token) is None


def test_garbage_is_rejected_by_the_real_decoder():
    assert _decode_access_token("not-a-jwt-at-all") is None


# --- proof that a deactivated user is excluded, not just a deactivated membership -----------
#
# The critical fix: the query has to filter on User.is_active as well as
# TenantMembership.is_active, or deactivating a user's account leaves their still-unexpired
# access token able to keep resolving to a hospital. This needs no database — the query object's
# compiled SQL already shows whether the filter is there, and a test that could only run against
# a live Postgres (and therefore skips everywhere else) would protect nothing on a laptop.

def test_the_membership_query_also_requires_the_user_to_be_active():
    compiled = str(_tenant_slug_query("11111111-1111-1111-1111-111111111111"))
    assert "JOIN users" in compiled, "query no longer joins the users table at all"
    assert "users.is_active" in compiled, "query no longer filters on User.is_active"
    assert "tenant_memberships.is_active" in compiled, "query no longer filters on membership"
