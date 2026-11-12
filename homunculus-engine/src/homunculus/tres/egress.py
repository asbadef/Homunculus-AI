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
changing either is a restart.

THE LIVE PLATFORM IS CLOSED IN THIS VERSION (plan F1): no package goes to the live environment, or
to an account whose address is on the platform's live host, whatever the install and the tenant
say — while `LIVE_OPEN` is False. The legal basis of sending and a patient whose consent is
`UNCONSCIOUS_LATER` (spec O5), and the cut-over where another system already reports (O11), are
the owner's open questions. Opening it is a code change, reviewed, made with the owner's word; the
connection test (no patient data) is not held by it. `live_closed` is asked by the rounds (the
tenant is passed over), the hand routes (409) and the settings form (422) — and, closed by default,
by `open_client` itself (review M10): a client for patient data is not built for the live host
(`TresLiveClosed`), whatever path asked for it; only the connection test says `patient_data=False`.
The lock FAILS CLOSED: an address that cannot be read counts as the live platform (review M1)."""
from __future__ import annotations

from collections.abc import Mapping

import httpx

from homunculus.tres.client import TresAccount, TresClient
from homunculus.tres.errors import EGRESS_OFF, TRES_HOST_NOT_ALLOWED

#: The platform's two hosts (spec §4.1): the sandbox and live.
DEFAULT_HOSTS: frozenset[str] = frozenset({"ehr-sandbox.e-health.gov.az", "ehr.e-health.gov.az"})
#: Patient data to the live platform: closed until O5 and O11 are answered (the docstring).
LIVE_OPEN = False
#: The platform's live host (spec §4.1).
LIVE_HOSTS: frozenset[str] = frozenset({"ehr.e-health.gov.az"})


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
    # The host as it goes on the wire (`raw_host`, ASCII — punycode for a name in another script),
    # never `.host`, which decodes it and raises for a label IDNA cannot read (review M1).
    # httpx reads «:443» on https as no port at all.
    return not url.userinfo and url.port is None and url.raw_host.decode("ascii").lower() in hosts


def live_closed(environment: str, base_url: str | None) -> bool:
    """Would a package to this account reach the live platform while it is closed? True for the
    live environment, and for an account of either environment whose address is on a live host.

    FAIL CLOSED (review M1): this lock must hold whatever the install says, so an address that
    cannot be read — httpx refuses it, or it parses to no host (no scheme, `https://`) — counts as
    closed, and the host is judged as DNS reads it: lower-cased, without a trailing dot
    (`ehr.e-health.gov.az.` is the live host). No address at all (None, empty) is not an unreadable
    one: there is nothing to reach (the account is incomplete; `address_allowed` refuses it)."""
    if LIVE_OPEN:
        return False
    if environment == "live":
        return True
    address = (base_url or "").strip()
    if not address:
        return False
    try:
        host = httpx.URL(address).raw_host.decode("ascii").lower().rstrip(".")
    except (httpx.InvalidURL, ValueError, UnicodeDecodeError):
        return True
    return not host or host in LIVE_HOSTS


class TresEgressRefused(Exception):
    """`open_client` would not build a client: `code` is `egress_off` (the install's lock is
    closed), `tres_host_not_allowed` (the account points where the install does not allow) or
    `tres_live_closed` (`TresLiveClosed`: it points at the live platform, closed in this version)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class TresLiveClosed(TresEgressRefused):
    """`open_client` would not build a client for patient data: the account's address is on the
    live platform, closed in this version (`live_closed`). A constant message, never the address
    or the account. Its code is the settings and hand routes' `tres_live_closed`; errors.py gains
    that constant with its dashboard words in plan F1's Task 10 (one commit), and this literal
    becomes an import of it there."""

    def __init__(self) -> None:
        super().__init__("tres_live_closed")


def open_client(account: TresAccount, *, egress: bool, hosts: frozenset[str],
                transport: httpx.AsyncBaseTransport | None = None,
                patient_data: bool = True) -> TresClient:
    """The one way production code builds a client: refused while the lock is closed, for an
    address that is not on an allowed host and port, and — CLOSED BY DEFAULT (review M10) — for
    an address on the live platform while it is closed (`live_closed`; the account carries no
    environment, so its address is what is judged — the rounds and the hand routes judge the
    environment as well, before they get here). `patient_data=False` is the connection test's
    alone: it sends no patient data, so the live lock does not hold it (the other two do). The
    point of the default: a sending path added later (F2–F6, deletes among them) that forgets its
    own `live_closed` check still cannot reach the live host. Nothing is connected here."""
    if not egress:
        raise TresEgressRefused(EGRESS_OFF)
    if not address_allowed(account.base_url, hosts):
        raise TresEgressRefused(TRES_HOST_NOT_ALLOWED)
    if patient_data and live_closed("test", account.base_url):
        raise TresLiveClosed()
    return TresClient(account, transport=transport)
