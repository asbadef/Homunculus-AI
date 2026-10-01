"""The panel's nginx must hand every API path to the API.

A path nginx does not proxy falls through to `try_files … /index.html`: the browser receives the
dashboard's HTML with a 200, the API client fails to parse it, and the screen shows a generic
error. That is how the staff tab would have shipped broken (2026-10-01): `/admin` was missing
from the location regex. This test reads the real config so a new router cannot be forgotten.
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


def test_both_api_locations_are_found() -> None:
    assert len(_api_locations()) == 2


@pytest.mark.parametrize("path", API_PATHS)
def test_api_path_is_proxied(path: str) -> None:
    assert any(p.search(path) for p in _api_locations()), f"{path} falls through to the SPA"


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_path_is_not_proxied(path: str) -> None:
    assert not any(p.search(path) for p in _api_locations()), f"{path} would hit the API"
