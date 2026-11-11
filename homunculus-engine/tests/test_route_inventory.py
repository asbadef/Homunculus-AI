# homunculus-engine/tests/test_route_inventory.py
"""Every JWT route reaches the full principal (MFA done, no temporary password left to replace);
only /auth/totp/* and /auth/me may stop at the pre-MFA one, and only /auth/password at the MFA
gate. A route added later without a guard fails here, not in a ward."""
from __future__ import annotations

from homunculus.api.app import create_app
from homunculus.auth.dependencies import (
    get_principal, get_principal_pre_mfa, get_principal_pre_password,
)
from tests.route_walk import api_routes      # descends into FastAPI's _IncludedRouter wrappers

# Routes that are deliberately reachable without the MFA-gated principal. Everything else — any
# router added later, including one merged from another branch — must reach get_principal.
PUBLIC = {"/auth/login", "/auth/refresh"}
PRE_MFA = {"/auth/totp/setup", "/auth/totp/verify", "/auth/me"}
# MFA-gated, but reachable while the account must still replace its temporary password: the one
# route that replaces it (D4). Everything else answers 403 `password_change_required` then.
PRE_PASSWORD = {"/auth/password"}
# The board and device routes live in api/app.py and resolve their caller through the separate
# Caller resolver (tenant token or JWT), not through FastAPI dependencies.
CALLER_RESOLVED_MODULE = "homunculus.api.app"
# G2-B1d (E22): the bridge's patient query is built by a factory bound to the app's `_caller`
# (api/edge_query.py, E2): the device token only, so it too has no JWT principal to reach. Keyed
# on (module, method, path): a GET or PUT added later to the same path is not exempted by it.
# Dalga: the waveform GET is registered from api/infinity_waves.py, and resolves its caller by
# calling the strip board's own handler (`shadow_board`: the Caller, board.view/devices.manage).
CALLER_RESOLVED_ROUTES = {("homunculus.api.edge_query", "POST", "/edge/patient-query"),
                          ("homunculus.api.infinity_waves", "GET", "/infinity-waves/{device_id}"),
                          # G3-02: the task queue resolves its caller through the app's `_caller`
                          ("homunculus.api.tasks", "GET", "/tasks"),
                          ("homunculus.api.tasks", "POST", "/tasks"),
                          ("homunculus.api.tasks", "POST", "/tasks/{task_id}/claim"),
                          ("homunculus.api.tasks", "POST", "/tasks/{task_id}/done"),
                          ("homunculus.api.tasks", "POST", "/tasks/{task_id}/skip"),
                          ("homunculus.api.tasks", "POST", "/tasks/vitals/{patient_id}/skip"),
                          ("homunculus.api.tasks", "GET", "/tasks/settings"),
                          ("homunculus.api.tasks", "PUT", "/tasks/settings"),
                          # G3-05: «Eşleşmeyen ölçümler» resolves its caller the same way — `clinical.chart`,
                          # and a person only (tests/test_readings_api.py holds both)
                          ("homunculus.api.readings", "GET", "/readings/unmatched"),
                          ("homunculus.api.readings", "POST", "/readings/unmatched/assign"),
                          ("homunculus.api.readings", "POST", "/readings/unmatched/reject")}


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


def _caller_resolved(route) -> bool:
    """Every method of the route is one the exemption names (module, method, path)."""
    return all((route.endpoint.__module__, method, route.path) in CALLER_RESOLVED_ROUTES
               for method in route.methods)


def test_every_route_is_guarded_or_explicitly_exempt():
    missing = [f"{sorted(r.methods)} {r.path}" for r in _routes()
               if r.endpoint.__module__ != CALLER_RESOLVED_MODULE
               and not _caller_resolved(r)
               and r.path not in PUBLIC | PRE_MFA | PRE_PASSWORD
               and get_principal not in _calls(r.dependant)]
    assert missing == []


def test_only_enrolment_and_profile_routes_skip_the_mfa_gate():
    pre_only = {r.path for r in _routes()
                if get_principal_pre_mfa in _calls(r.dependant)
                and get_principal_pre_password not in _calls(r.dependant)}
    assert pre_only == PRE_MFA


def test_only_the_password_change_skips_the_password_gate():
    mfa_only = {r.path for r in _routes()
                if get_principal_pre_password in _calls(r.dependant)
                and get_principal not in _calls(r.dependant)}
    assert mfa_only == PRE_PASSWORD


def test_the_admin_router_is_mounted_and_walked():
    """The two tests above are vacuous for /admin unless the walker actually reaches it."""
    assert {r.path for r in _routes() if r.path.startswith("/admin/")} >= {
        "/admin/permissions", "/admin/groups", "/admin/users", "/admin/ldap/status"}
