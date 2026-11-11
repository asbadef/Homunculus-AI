# homunculus-engine/src/homunculus/tres/egress.py
"""The install's lock on the national e-health feed (TRƏS-01, spec D2 (b)), and where the feed may
send what it sends.

Homunculus is installed on-prem with the promise «no patient data leaves the building»
(docs/EDGE-BRIDGE-LOCAL.md). The feed is the first thing that can break it, so it is closed twice:
by each tenant's own `tres_settings.mode`, and by this switch, which belongs to whoever runs the
server. `TRES_EGRESS` unset, empty or anything but `on` means the module opens NO connection,
whatever a tenant's row says: the worker is not started, a round builds no client, the connection
test answers 409 `egress_off`, and the settings tab says the feed is closed.

WHERE the data may go is the install's decision as well, not a tenant administrator's (review #4):
`TRES_HOSTS` names the hosts a base URL may point at (comma-separated; unset or empty: the
platform's own two, DEFAULT_HOSTS), always over https on port 443. The settings route refuses any
other address (`tres_host_not_allowed`), and `open_client` — the ONE way production code builds a
client — refuses it again, and refuses everything while the lock is closed: a caller that forgets
the lock fails closed (`app.state.tres_client_factory` is `open_client` bound to the app's lock and
hosts).

Both are read once, at start-up (`api/app.py` → `app.state.tres_egress`, `app.state.tres_hosts`):
changing either is a restart."""
from __future__ import annotations

from collections.abc import Mapping

import httpx

from homunculus.tres.client import TresAccount, TresClient
from homunculus.tres.errors import EGRESS_OFF, TRES_HOST_NOT_ALLOWED

#: The platform's two hosts (spec §4.1): the sandbox and live.
DEFAULT_HOSTS: frozenset[str] = frozenset({"ehr-sandbox.e-health.gov.az", "ehr.e-health.gov.az"})


def egress_on(env: Mapping[str, str]) -> bool:
    """True only when TRES_EGRESS, stripped and lower-cased, is exactly `on`."""
    return (env.get("TRES_EGRESS", "") or "").strip().lower() == "on"


def allowed_hosts(env: Mapping[str, str]) -> frozenset[str]:
    """The hosts TRES_HOSTS names — comma-separated, stripped, lower-cased, empties dropped — or
    DEFAULT_HOSTS when it names none."""
    named = frozenset(host.strip().lower() for host in (env.get("TRES_HOSTS", "") or "").split(","))
    return (named - {""}) or DEFAULT_HOSTS


def address_allowed(base_url: str, hosts: frozenset[str]) -> bool:
    """Does this base URL point where the install allows? https, one of `hosts`, port 443 (or none
    named), no credentials, no query, no fragment."""
    if not isinstance(base_url, str) or not base_url.startswith("https://") or "?" in base_url \
            or "#" in base_url:
        return False
    try:
        url = httpx.URL(base_url)
    except httpx.InvalidURL:
        return False
    # httpx reads «:443» on https as no port at all.
    return not url.userinfo and url.port is None and (url.host or "").lower() in hosts


class TresEgressRefused(Exception):
    """`open_client` would not build a client: `code` is `egress_off` (the install's lock is
    closed) or `tres_host_not_allowed` (the account points where the install does not allow)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def open_client(account: TresAccount, *, egress: bool, hosts: frozenset[str],
                transport: httpx.AsyncBaseTransport | None = None) -> TresClient:
    """The one way production code builds a client: refused while the lock is closed, and for an
    address that is not on an allowed host and port. Nothing is connected here."""
    if not egress:
        raise TresEgressRefused(EGRESS_OFF)
    if not address_allowed(account.base_url, hosts):
        raise TresEgressRefused(TRES_HOST_NOT_ALLOWED)
    return TresClient(account, transport=transport)
