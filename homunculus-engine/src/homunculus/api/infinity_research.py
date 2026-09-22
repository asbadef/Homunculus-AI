"""Same-origin, role-gated window onto the Infinity research hub.

The browser never talks to the hub. It asks this API, which holds the viewer credential and
the hub's CA in protected config, calls one fixed HTTPS address, and hands back a reshaped
copy of the answer. Nothing the browser sends reaches the hub: there is no path, host or
query parameter to forward, so there is nothing to smuggle.

The data is research decoding of monitor traffic — candidate values, not observations. It
is shown to the roles responsible for the devices, not the roles responsible for patients,
and it is never written anywhere the clinical pipeline reads. See INFINITY-PARAMETER-RECORDS.md.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException

from homunculus.auth.dependencies import require_roles
from homunculus.auth.models import UserRole

router = APIRouter(prefix="/infinity-research", tags=["infinity-research"])

CONNECT_TIMEOUT = 3.0
MAX_BODY = 4 * 1024 * 1024
DEVICE_KEYS = ("device_id", "source_ip", "group", "status", "packets", "packet_age_ms")
PARAMETER_KEYS = ("value", "status", "unit", "age_ms", "alarm_low", "alarm_high",
                  "evidence", "capture_epoch", "history")
TOP_KEYS = ("schema", "mode", "evidence", "clinical_ingest_enabled", "clinical_mapping_verified",
            "clinical_validity", "stale_after_ms", "history_seconds", "accepted_packets",
            "rejected_packets", "old_or_duplicate_packets")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # The hub is one fixed address. A redirect would be a second address, and there is no
    # reason a research hub should ever send the API somewhere else.
    def redirect_request(self, *args, **kwargs):
        return None


def _settings():
    url = os.getenv("INFINITY_HUB_URL", "").strip()
    token = os.getenv("INFINITY_VIEWER_TOKEN", "").strip()
    ca_file = os.getenv("INFINITY_HUB_CA_FILE", "").strip()
    if not (url and token and ca_file):
        return None
    if not url.startswith("https://"):
        # Refusing here rather than falling back to plain HTTP: the credential rides in the
        # Authorization header and must not be exposed to the LAN by a typo in .env.
        raise HTTPException(503, {"reason": "misconfigured", "detail": "hub URL must be https"})
    return url.rstrip("/"), token, ca_file


def _reshape(raw: dict) -> dict:
    """Allow-list copy. Unknown keys from the hub never reach the browser."""
    devices = []
    for device in raw.get("devices") or ():
        parameters = {
            name: {key: entry.get(key) for key in PARAMETER_KEYS}
            for name, entry in (device.get("parameters") or {}).items()
        }
        devices.append({**{key: device.get(key) for key in DEVICE_KEYS}, "parameters": parameters})
    return {**{key: raw.get(key) for key in TOP_KEYS}, "devices": devices}


def fetch_state(settings) -> dict:
    url, token, ca_file = settings
    try:
        context = ssl.create_default_context(cafile=ca_file)
    except (OSError, ssl.SSLError):
        raise HTTPException(503, {"reason": "misconfigured", "detail": "hub CA file unreadable"})
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context), _NoRedirect())
    request = urllib.request.Request(url + "/infinity-research/state",
                                     headers={"Authorization": "Bearer " + token})
    try:
        with opener.open(request, timeout=CONNECT_TIMEOUT) as response:
            body = response.read(MAX_BODY + 1)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise HTTPException(503, {"reason": "upstream_unauthorized"})
        if error.code == 409:
            raise HTTPException(503, {"reason": "research_disabled"})
        raise HTTPException(503, {"reason": "upstream_error", "status": error.code})
    except TimeoutError:
        raise HTTPException(503, {"reason": "upstream_timeout"})
    except (urllib.error.URLError, OSError, ssl.SSLError):
        raise HTTPException(503, {"reason": "upstream_unreachable"})
    if len(body) > MAX_BODY:
        raise HTTPException(502, {"reason": "upstream_too_large"})
    try:
        raw = json.loads(body)
    except ValueError:
        raise HTTPException(502, {"reason": "upstream_invalid"})
    if not isinstance(raw, dict) or raw.get("clinical_ingest_enabled") is not False:
        # A hub that has started forwarding to the clinical path is not the hub this window
        # was built for. Refuse rather than display it as if nothing changed.
        raise HTTPException(502, {"reason": "upstream_policy"})
    return _reshape(raw)


# Module-level so a test can override exactly this gate and nothing else.
device_roles = require_roles(UserRole.BIOMEDICAL, UserRole.HOSPITAL_ADMIN)


@router.get("/state")
async def research_state(user=Depends(device_roles)):
    settings = _settings()
    if settings is None:
        raise HTTPException(503, {"reason": "not_configured"})
    return fetch_state(settings)
