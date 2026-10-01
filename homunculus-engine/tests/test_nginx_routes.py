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
    text = CONF.read_text(encoding="utf-8")
    patterns = []
    for match in re.finditer(r"location\s+~\s+(\S+)\s*\{(.*?)\}", text, re.S):
        if "proxy_pass http://api:8000" in match.group(2):
            patterns.append(re.compile(match.group(1)))
    return patterns


def _app_prefixes() -> set[str]:
    from homunculus.api.app import create_app

    app = create_app({"t": "h"}, run_escalation_loop=False)
    skip = {"docs", "redoc", "openapi.json"}
    out: set[str] = set()
    for route in app.routes:
        path = getattr(route, "path", "")
        first = path.split("/")[1] if path.startswith("/") else ""
        if first and not first.startswith("{") and first not in skip:
            out.add("/" + first)
    return out


def test_every_app_route_prefix_is_proxied() -> None:
    missing = sorted(p for p in _app_prefixes() if not any(loc.search(p) for loc in _api_locations()))
    assert not missing, f"routers not proxied by nginx: {missing}"


def test_stream_ticket_is_served_by_the_sse_block() -> None:
    text = CONF.read_text(encoding="utf-8")
    sse = [
        m for m in re.finditer(r"location\s+~\s+(\S+)\s*\{(.*?)\}", text, re.S)
        if "proxy_buffering off" in m.group(2)
    ]
    assert len(sse) == 1 and re.search(sse[0].group(1), "/stream-ticket")


def test_both_api_locations_are_found() -> None:
    assert len(_api_locations()) == 2


@pytest.mark.parametrize("path", API_PATHS)
def test_api_path_is_proxied(path: str) -> None:
    assert any(p.search(path) for p in _api_locations()), f"{path} falls through to the SPA"


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_path_is_not_proxied(path: str) -> None:
    assert not any(p.search(path) for p in _api_locations()), f"{path} would hit the API"
