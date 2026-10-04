"""The panel's nginx must hand every API path to the API.

A path nginx does not proxy falls through to `try_files … /index.html`: the browser receives the
dashboard's HTML with a 200, the API client fails to parse it, and the screen shows a generic
error. That is how the staff tab would have shipped broken (2026-10-01): `/admin` was missing
from the location regex. These tests read the real config. `API_PATHS` is a hand-written list of
representative paths (including ones from routers merged in later); the drift guard is
`test_every_app_route_prefix_is_proxied`, which derives the prefixes from the real FastAPI app so
a new router that nginx does not proxy fails here.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

CONF = Path(__file__).resolve().parents[2] / "deploy" / "local" / "web" / "nginx.conf"

# One representative path per API prefix the dashboard or the bridge calls.
API_PATHS = [
    "/auth/login", "/admin/users", "/tenant/tenants", "/admissions", "/shift-schedule",
    "/handovers", "/alerts/x", "/break-glass", "/scope/me", "/clinical/p1",
    "/scores/sofa/p1", "/alarm-quality", "/infinity-research/state", "/patients", "/ack",
    "/ingest", "/view", "/audit", "/audit/verify", "/health", "/stream", "/stream-ticket",
    "/notifications",
]
# Paths that must stay with the single-page app.
SPA_PATHS = ["/", "/index.html", "/assets/index-abc.js", "/administrator-guide"]


def _api_locations() -> list[re.Pattern[str]]:
    """Every location that proxies to the API, as a pattern: a regex location (`~`) as written,
    an exact one (`=`) as that one path."""
    text = CONF.read_text(encoding="utf-8")
    patterns = []
    for match in re.finditer(r"location\s+(~|=)\s+(\S+)\s*\{(.*?)\}", text, re.S):
        if "proxy_pass http://api:8000" in match.group(3):
            kind, target = match.group(1), match.group(2)
            patterns.append(re.compile(target if kind == "~" else f"^{re.escape(target)}$"))
    return patterns


def _app_prefixes() -> set[str]:
    # Read the public OpenAPI schema, not `app.routes`: included routers appear there as objects
    # without a `.path`. Routes with include_in_schema=False are therefore not seen here.
    from homunculus.api.app import create_app

    app = create_app({"t": "h"}, run_escalation_loop=False)
    return {"/" + path.split("/")[1] for path in app.openapi()["paths"]}


def test_every_app_route_prefix_is_proxied() -> None:
    prefixes = _app_prefixes()
    # Guard against the introspection going vacuous (a schema change once hid every router).
    assert {"/auth", "/admin", "/patients"} <= prefixes, prefixes
    missing = sorted(p for p in prefixes if not any(loc.search(p) for loc in _api_locations()))
    assert not missing, f"routers not proxied by nginx: {missing}"


def test_stream_ticket_is_served_by_the_sse_block() -> None:
    text = CONF.read_text(encoding="utf-8")
    sse = [
        m for m in re.finditer(r"location\s+~\s+(\S+)\s*\{(.*?)\}", text, re.S)
        if "proxy_buffering off" in m.group(2)
    ]
    assert len(sse) == 1 and re.search(sse[0].group(1), "/stream-ticket")


def test_every_api_location_is_found() -> None:
    """Three: the SSE block, the prefix block — and the exact `/auth/login` block, which nginx
    picks before any regex location so that sign-in alone carries the per-address limit."""
    assert len(_api_locations()) == 3


def _location(text: str, header: str) -> str:
    """The body of the location block whose header (at the start of a line, not in a comment)
    starts with `header`."""
    match = re.search(r"^\s*" + re.escape(header) + r"[^{]*\{(.*?)\}", text, re.S | re.M)
    assert match, header
    return match.group(1)


def _directives(body: str, *names: str) -> set[str]:
    return {" ".join(d.split()) for d in re.findall(rf"^\s*((?:{'|'.join(names)})\s[^;]*);",
                                                     body, re.M)}


def test_sign_in_is_rate_limited_per_client_address() -> None:
    """In front of the API's per-account AD throttle: one address trying passwords across many
    accounts is slowed at the edge — 10 a minute, a burst of 10. The refusal is 429, a refusal
    the client should not retry at once, not nginx's default 503, which reads as the server
    being down. The zone is declared at the file's top level: the file is installed
    as conf.d/default.conf, which nginx includes inside `http {}`."""
    text = CONF.read_text(encoding="utf-8")
    zone = re.search(r"^limit_req_zone\s+\$binary_remote_addr\s+zone=homunculus_login:\S+"
                     r"\s+rate=10r/m;", text, re.M)
    assert zone and zone.start() < text.index("server {")
    body = _location(text, "location = /auth/login")
    assert _directives(body, "limit_req", "limit_req_status") == {
        "limit_req zone=homunculus_login burst=10 nodelay", "limit_req_status 429"}
    api = _location(text, "location ~ ^/(auth|")
    proxy = ("proxy_pass", "proxy_http_version", "proxy_set_header")
    assert _directives(body, *proxy) == _directives(api, *proxy)
    assert "limit_req" not in api                # nothing but sign-in is limited


LOGIN_LIMITED = "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin"


def _named_location(text: str, name: str) -> str:
    """The body of `location <name> { … }`, read up to its own closing brace: a brace inside a
    quoted string (a JSON answer) does not end it."""
    match = re.search(r"^\s*location\s+" + re.escape(name) + r"\s*\{", text, re.M)
    assert match, name
    quote = None
    for i in range(match.end(), len(text)):
        ch = text[i]
        if quote:
            quote = None if ch == quote else quote
        elif ch in "'\"":
            quote = ch
        elif ch == "}":
            return text[match.end():i]
    raise AssertionError(f"location {name} is not closed")


def test_a_limited_sign_in_is_answered_in_json() -> None:
    """nginx's own 429 page is HTML, and the dashboard reads the reason from a JSON `detail`:
    it would show a generic failure. The sign-in location hands its 429 to a named location
    that answers in the API's shape — {"detail": "…"}, JSON in UTF-8 — which
    dashboard/src/clinicalI18n.js maps (i18n.rbac.test.js reads it from this file). Only nginx's
    own refusal: the API's 429s pass through as they are (no proxy_intercept_errors)."""
    text = CONF.read_text(encoding="utf-8")
    body = _location(text, "location = /auth/login")
    assert _directives(body, "error_page") == {"error_page 429 = @login_limited"}
    assert _directives(text, "proxy_intercept_errors") == set()
    named = _named_location(text, "@login_limited")
    assert re.findall(r"^\s*default_type\s+(.+?);\s*$", named, re.M) == [
        '"application/json; charset=utf-8"']                # its own `;` is inside the quotes
    answer = re.findall(r"^\s*return\s+429\s+'([^']*)';\s*$", named, re.M)
    assert len(answer) == 1 and json.loads(answer[0]) == {"detail": LOGIN_LIMITED}
    assert text.count("@login_limited") == 2                 # declared once, used once


@pytest.mark.parametrize("path", API_PATHS)
def test_api_path_is_proxied(path: str) -> None:
    assert any(p.search(path) for p in _api_locations()), f"{path} falls through to the SPA"


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_path_is_not_proxied(path: str) -> None:
    assert not any(p.search(path) for p in _api_locations()), f"{path} would hit the API"
