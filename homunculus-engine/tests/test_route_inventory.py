# homunculus-engine/tests/test_route_inventory.py
"""Every JWT route reaches the MFA-gated principal; only /auth/totp/* and /auth/me may stop at the
pre-MFA one. A route added later without a guard fails here, not in a ward."""
from __future__ import annotations

from homunculus.api.app import create_app
from homunculus.auth.dependencies import get_principal, get_principal_pre_mfa
from tests.route_walk import api_routes      # descends into FastAPI's _IncludedRouter wrappers

# Routes that are deliberately reachable without the MFA-gated principal. Everything else — any
# router added later, including one merged from another branch — must reach get_principal.
PUBLIC = {"/auth/login", "/auth/refresh"}
PRE_MFA = {"/auth/totp/setup", "/auth/totp/verify", "/auth/me"}
# The board and device routes live in api/app.py and resolve their caller through the separate
# Caller resolver (tenant token or JWT), not through FastAPI dependencies.
CALLER_RESOLVED_MODULE = "homunculus.api.app"


def _calls(dependant) -> set:
    out, stack = set(), [dependant]
    while stack:
        d = stack.pop()
        if d.call is not None:
            out.add(d.call)
        stack.extend(d.dependencies)
    return out


def _routes():
    return api_routes(create_app({"t": "HOSP1"}, run_escalation_loop=False))


def test_every_route_is_guarded_or_explicitly_exempt():
    missing = [f"{sorted(r.methods)} {r.path}" for r in _routes()
               if r.endpoint.__module__ != CALLER_RESOLVED_MODULE
               and r.path not in PUBLIC | PRE_MFA
               and get_principal not in _calls(r.dependant)]
    assert missing == []


def test_only_enrolment_and_profile_routes_skip_the_mfa_gate():
    pre_only = {r.path for r in _routes()
                if get_principal_pre_mfa in _calls(r.dependant)
                and get_principal not in _calls(r.dependant)}
    assert pre_only == PRE_MFA


def test_the_admin_router_is_mounted_and_walked():
    """The two tests above are vacuous for /admin unless the walker actually reaches it."""
    assert {r.path for r in _routes() if r.path.startswith("/admin/")} >= {
        "/admin/permissions", "/admin/groups", "/admin/users"}
