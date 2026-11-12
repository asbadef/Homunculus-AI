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
import yaml

CONF = Path(__file__).resolve().parents[2] / "deploy" / "local" / "web" / "nginx.conf"
COMPOSE = Path(__file__).resolve().parents[2] / "deploy" / "local" / "docker-compose.yml"

# One representative path per API prefix the dashboard or the bridge calls.
API_PATHS = [
    "/auth/login", "/auth/reauth", "/auth/password", "/auth/me", "/admin/users", "/tenant/tenants", "/admissions", "/shift-schedule",
    "/shift-schedule/nurses",                                                        # G4-04: the form's people
    "/handovers", "/handovers/pending", "/alerts/x", "/break-glass", "/scope/me", "/clinical/p1",
    "/scores/sofa/p1", "/alarm-quality", "/infinity-research/state",
    "/infinity-shadow/board", "/infinity-shadow/readings", "/infinity-shadow/device-beds",
    "/infinity-waves/192.0.2.10", "/patients", "/pharmacy", "/quality", "/ack",
    "/ingest", "/view", "/audit", "/audit/verify", "/health", "/stream", "/stream-ticket",
    "/notifications", "/readings/unmatched",       # G3-05: «Eşleşmeyen ölçümler»
]
# Paths that must stay with the single-page app.
SPA_PATHS = ["/", "/index.html", "/assets/index-abc.js", "/administrator-guide"]
# API prefixes nginx must NOT proxy: the bridge reaches them on the compose network only
# (G2-B1d, spec D12 — the device's patient query).
NOT_PROXIED = {"/edge"}


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
    missing = sorted(p for p in prefixes - NOT_PROXIED
                     if not any(loc.search(p) for loc in _api_locations()))
    assert not missing, f"routers not proxied by nginx: {missing}"


def test_the_bridges_patient_query_is_never_proxied() -> None:
    """D12: /edge/patient-query is in the app (the bridge calls it on the compose network) and in
    no location that hands a path to the API — from outside, it is the single-page app's."""
    assert NOT_PROXIED <= _app_prefixes()
    assert _api_locations()         # vacuity guard: with no API location the loop below proves nothing
    for path in ("/edge", "/edge/patient-query"):
        assert not any(loc.search(path) for loc in _api_locations()), path


def test_the_api_publishes_no_host_port() -> None:
    """D12, the other half: nginx leaving /edge out is not enough if the API itself listens on the
    host — the device credential's patient query would then be reachable from the ward network.
    The compose file's `api` service has no `ports:` (its comment there says why); the bridge and
    the web container reach it on the compose network."""
    services = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
    assert "api" in services, sorted(services)
    assert "ports" not in services["api"], services["api"].get("ports")


def test_stream_ticket_is_served_by_the_sse_block() -> None:
    text = CONF.read_text(encoding="utf-8")
    sse = [
        m for m in re.finditer(r"location\s+~\s+(\S+)\s*\{(.*?)\}", text, re.S)
        if "proxy_buffering off" in m.group(2)
    ]
    assert len(sse) == 1 and re.search(sse[0].group(1), "/stream-ticket")


def test_every_api_location_is_found() -> None:
    """Six: the SSE block, the prefix block — the exact `/auth/login`, `/auth/reauth` and
    `/auth/password` blocks, which nginx picks before any regex location so that the routes
    that check a password carry a per-address limit — and the exact block of Aşama A's
    forwarder POST, which refuses plain HTTP."""
    assert len(_api_locations()) == 6


def _condition_map(text: str) -> list[tuple[str, str]]:
    """(key, value) of `map $uri $homunculus_access_logged { … }` at the file's top level, in
    file order (tests/test_access_log_redaction.py pins its exact entries)."""
    block = re.search(r"^map\s+\$uri\s+\$homunculus_access_logged\s*\{(.*?)^\}", text, re.S | re.M)
    assert block, "no `map $uri $homunculus_access_logged { … }` in nginx.conf"
    lines = (raw.split("#", 1)[0].strip() for raw in block.group(1).splitlines())
    return [tuple(line.rstrip(";").split()) for line in lines if line]


def _logged(condition: list[tuple[str, str]], path: str) -> str:
    """The map's value for `path` as nginx picks it: the first regex that matches, else `default`."""
    for key, value in condition:
        if key.startswith("~") and re.search(key.lstrip("~*"), path, re.I if key.startswith("~*") else 0):
            return value
    return dict(condition)["default"]


def test_the_waves_poll_is_proxied_as_the_api_and_is_the_one_path_left_out_of_the_access_log() -> None:
    """Dalga (final review M-3): every open wave panel polls GET /infinity-waves/<monitor>
    about 1.33 times a second, so one panel left open would write ~115,000 access lines a day.
    The prefix block proxies it as any API path. The server's one access log (G2-B1d O10)
    writes a request only `if=$homunculus_access_logged`, and that map's only `0` is the
    waves: every other API path, and the single-page app's, is still logged."""
    text = CONF.read_text(encoding="utf-8")
    path = "/infinity-waves/192.0.2.10"
    matching = [loc for loc in _api_locations() if loc.search(path)]
    assert len(matching) == 1 and matching[0].pattern.startswith("^/(auth|"), [loc.pattern for loc in matching]
    assert not matching[0].search("/infinity-wavesx")
    assert re.findall(r"^\s*access_log\s+([^;]*);", text, re.M) == [
        "/var/log/nginx/access.log homunculus_redacted if=$homunculus_access_logged"]
    condition = _condition_map(text)
    assert [key for key, value in condition if value == "0"] == ["~^/infinity-waves(/|$)"], condition
    unlogged = [p for p in API_PATHS + SPA_PATHS if _logged(condition, p) == "0"]
    assert unlogged == [path], unlogged


def _block(text: str, header: str) -> str:
    """A whole location block, nested braces included: from its header to its own closing brace
    (four spaces in, as every block of this server is)."""
    start = text.index(header)
    return text[start:text.index("\n    }\n", start)]


def test_the_forwarders_post_is_https_only_post_only_and_64_kib() -> None:
    """Aşama A: the hub forwarder sends its own bearer token to POST /infinity-shadow/readings. The
    panel also listens in the clear (:8080 on the VM), and that port must never carry the token: a
    plain-HTTP request is refused here, before the API sees it. POST only, and nginx's body limit
    is the API's own 64 KiB (the API counts the bytes itself as well). An allow-list of the hub's
    address is added once its $remote_addr has been seen on the VM (plan, D-3)."""
    text = CONF.read_text(encoding="utf-8")
    body = _block(text, "location = /infinity-shadow/readings {")
    assert re.search(r'if \(\$scheme != "?https"?\)\s*\{\s*return 403 ', body)
    assert re.search(r"limit_except POST\s*\{\s*deny all;\s*\}", body)
    assert re.search(r"^\s*client_max_body_size 64k;", body, re.M)
    assert re.search(r"^\s*proxy_pass http://api:8000;", body, re.M)
    assert "proxy_set_header X-Forwarded-Proto $scheme;" in body
    assert body.index("proxy_pass") < body.index("if (")                # read by _api_locations


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
    assert "limit_req" not in api                # the prefix block itself is never limited


@pytest.mark.parametrize("path", ["/auth/reauth", "/auth/password"])
def test_unlock_and_password_change_are_rate_limited_per_client_address(path: str) -> None:
    """The two routes where a held token can test the account's password: the API counts the
    wrong ones per account (5 for a local account, the AD chain for an AD one), and nothing
    else stood in front of them — every refusal was a request the API answered and audited.
    Per address, in their own zone (a ward's unlocks must not spend its sign-ins), and
    generous — 30 a minute, a burst of 30 — because a ward's PCs share one address behind
    NAT. Refused as a limited sign-in is — 429, a warning in the log — with an answer of its
    own (`@reauth_limited`): this is no sign-in."""
    text = CONF.read_text(encoding="utf-8")
    zone = re.search(r"^limit_req_zone\s+\$binary_remote_addr\s+zone=homunculus_reauth:\S+"
                     r"\s+rate=30r/m;", text, re.M)
    assert zone and zone.start() < text.index("server {")
    body = _location(text, f"location = {path}")
    assert _directives(body, "limit_req", "limit_req_status", "limit_req_log_level",
                       "error_page") == {
        "limit_req zone=homunculus_reauth burst=30 nodelay", "limit_req_status 429",
        "limit_req_log_level warn", "error_page 429 = @reauth_limited"}
    api = _location(text, "location ~ ^/(auth|")
    proxy = ("proxy_pass", "proxy_http_version", "proxy_set_header")
    assert _directives(body, *proxy) == _directives(api, *proxy)


def test_a_limited_sign_in_is_logged_as_a_warning() -> None:
    """nginx logs each request it refuses under `limit_req` at `error` by default: one address
    spending its 10 a minute — a ward PC's mistyping, a shared NAT at shift change — would read
    as server errors. `warn` keeps the record and its level honest."""
    body = _location(CONF.read_text(encoding="utf-8"), "location = /auth/login")
    assert _directives(body, "limit_req_log_level") == {"limit_req_log_level warn"}


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
    dashboard/src/live/apiErrors.js maps (live/apiErrors.test.js reads it from nginx.conf). Only
    nginx's own refusal: the API's 429s pass through as they are (no proxy_intercept_errors)."""
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


def test_a_limited_sign_in_says_when_to_try_again() -> None:
    """`Retry-After: 60` on nginx's 429 (`always`: add_header otherwise skips an error status):
    the limit refills at 10 a minute, and a client — or an operator reading the response — knows
    to wait a minute, as the JSON detail says."""
    named = _named_location(CONF.read_text(encoding="utf-8"), "@login_limited")
    assert _directives(named, "add_header") == {"add_header Retry-After 60 always"}


REAUTH_LIMITED = "Çok fazla deneme. Bir dakika sonra yeniden deneyin."


def test_a_limited_unlock_or_password_change_is_answered_in_json_and_says_when() -> None:
    """The unlock and the password change are no sign-in: their 429 says "too many attempts",
    not "too many sign-in attempts" — in the API's shape ({"detail": "…"}, JSON in UTF-8, which
    dashboard/src/live/apiErrors.js maps; live/apiErrors.test.js reads it from nginx.conf), with
    `Retry-After: 60` as the sign-in's. Declared once, used by the two locations."""
    text = CONF.read_text(encoding="utf-8")
    named = _named_location(text, "@reauth_limited")
    assert re.findall(r"^\s*default_type\s+(.+?);\s*$", named, re.M) == [
        '"application/json; charset=utf-8"']
    answer = re.findall(r"^\s*return\s+429\s+'([^']*)';\s*$", named, re.M)
    assert len(answer) == 1 and json.loads(answer[0]) == {"detail": REAUTH_LIMITED}
    assert _directives(named, "add_header") == {"add_header Retry-After 60 always"}
    assert len(re.findall(r"^\s*location\s+@reauth_limited\s*\{", text, re.M)) == 1
    assert len(re.findall(r"^\s*error_page\s+429\s*=\s*@reauth_limited;", text, re.M)) == 2


@pytest.mark.parametrize("path", API_PATHS)
def test_api_path_is_proxied(path: str) -> None:
    assert any(p.search(path) for p in _api_locations()), f"{path} falls through to the SPA"


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_path_is_not_proxied(path: str) -> None:
    assert not any(p.search(path) for p in _api_locations()), f"{path} would hit the API"
