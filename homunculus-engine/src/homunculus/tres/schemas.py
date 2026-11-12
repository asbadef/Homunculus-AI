# homunculus-engine/src/homunculus/tres/schemas.py
"""GET|PUT /admin/tres/settings and POST /admin/tres/test (TRƏS-01, spec §6, D3).

The screen sends whole bodies. A field too many, or of the wrong type, is FastAPI's own 422; a
value of the right type that the rules refuse is a coded 422 (`settings_refusal`, tres/errors.py).

THE PASSWORD IS WRITE-ONLY. `TresAccountIn.password`: omitted or null keeps the stored one, an
empty string clears it, anything else replaces it. `TresAccountOut` has no password field at all —
only `password_set`. Every other account field is cleared by null or an empty string. A changed
base URL clears the stored password too unless the same body brings a new one (router.py).

`send_from` (plan F1, O15 — PROPOSED, AWAITING THE OWNER'S WORD): the automatic rounds' cut-off.
Omitted or null keeps the stored one; a time with a zone moves it — not before 2020-01-01 and not
more than 366 days after the save (`tres_send_from`, batch-4 review). The first save that chooses
`send` sets it to that moment when none is stored. A mode other than `off` is refused while the
selected account would reach the live platform (`tres_live_closed`, egress.live_closed)."""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone

import httpx
from pydantic import AwareDatetime, BaseModel, ConfigDict, StrictInt, StrictStr

from homunculus.tres.egress import address_allowed, live_closed
from homunculus.tres.errors import (
    TRES_BASE_URL, TRES_ENVIRONMENT, TRES_FIELD_LENGTH, TRES_HOST_NOT_ALLOWED, TRES_LIVE_CLOSED, TRES_MODE,
    TRES_SEND_FROM, TRES_SETTLE_HOURS, TRES_TYPES,
)
from homunculus.tres.models import ACCOUNT_FIELDS, ENVIRONMENTS, MODES, RESOURCE_TYPES

#: The most characters each account field takes (the columns' widths; a password's is its own).
FIELD_MAX = {"base_url": 200, "username": 120, "password": 200, "provider_id": 64,
             "organization_id": 64, "organization_name": 200}
SETTLE_MAX = 168
#: `send_from`'s bounds (batch-4 review): nothing before 2020, nothing more than a year and a day ahead.
SEND_FROM_FLOOR = datetime(2020, 1, 1, tzinfo=timezone.utc)
SEND_FROM_AHEAD = timedelta(days=366)


class TresAccountIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: StrictStr | None = None
    username: StrictStr | None = None
    password: StrictStr | None = None
    provider_id: StrictStr | None = None
    organization_id: StrictStr | None = None
    organization_name: StrictStr | None = None


class TresSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: StrictStr
    environment: StrictStr
    settle_hours: StrictInt
    enabled_types: list[StrictStr]
    test: TresAccountIn
    live: TresAccountIn
    send_from: AwareDatetime | None = None   # O15 (proposed): None keeps the stored cut-off


class TresAccountOut(BaseModel):
    base_url: str | None
    username: str | None
    password_set: bool               # never the password itself (D3)
    provider_id: str | None
    organization_id: str | None
    organization_name: str | None


class TresSettingsOut(BaseModel):
    mode: str
    environment: str
    settle_hours: int
    enabled_types: list[str]
    test: TresAccountOut
    live: TresAccountOut
    egress: bool                     # the install's lock (D2 (b)): false = nothing leaves the server
    updated_at: datetime | None      # None: the tenant has never saved the tab
    session_refused_at: datetime | None   # when the platform refused the login; the rounds wait (I3)
    send_from: datetime | None       # O15 (proposed): stays discharged before it go only by hand


class TresTestOut(BaseModel):
    ok: bool
    message: str | None              # the platform's words when it refused; never a session id


def base_url_ok(value: str) -> bool:
    """https only (the credentials ride in a header), a host, and nothing that would ride along
    with every request: no credentials, no query, no fragment, no port but 443 (review #4)."""
    if (not value.startswith("https://") or len(value) > FIELD_MAX["base_url"] or "?" in value
            or "#" in value):
        return False
    try:
        url = httpx.URL(value)
        # The host must also read as a name (review M1): `.host` decodes punycode, and an «xn--»
        # label IDNA cannot read raises (IDNAError, a ValueError) — a 422 here, never a 500.
        url.host  # noqa: B018
    except (httpx.InvalidURL, ValueError):
        return False
    # httpx reads «:443» on https as no port at all.
    return bool(url.raw_host) and not url.userinfo and url.port is None


def send_from_ok(value: datetime, now: datetime) -> bool:
    """The cut-off within its bounds (batch-4 review): not before SEND_FROM_FLOOR, and not more than
    SEND_FROM_AHEAD after `now` — a year typed wrong must not send a hospital's whole past, nor
    nothing for years."""
    return SEND_FROM_FLOOR <= value <= now + SEND_FROM_AHEAD


def refusal_of(payload: TresSettingsIn, *, hosts: frozenset[str],
               stored: Mapping[str, str | None] | None = None,
               now: datetime | None = None) -> tuple[str, str | None] | None:
    """(the code the body is refused with, the environment it is about or None), or None. In the
    form's order: the first wrong value. `now` judges `send_from` (the moment of the save by default).

    A NEW base URL whose host is not among `hosts` — the install's (egress.allowed_hosts) — is
    `tres_host_not_allowed`: where the data may go is not the tenant administrator's choice. A base
    URL sent back exactly as `stored` (that environment's saved one) is not judged against the
    hosts again (review M10): an install that narrows TRES_HOSTS must not lock the whole form;
    the client refuses that address at connect anyway (egress.open_client). Its shape still is."""
    if payload.mode not in MODES:
        return TRES_MODE, None
    if payload.environment not in ENVIRONMENTS:
        return TRES_ENVIRONMENT, None
    if not 0 <= payload.settle_hours <= SETTLE_MAX:
        return TRES_SETTLE_HOURS, None
    types = payload.enabled_types
    if len(set(types)) != len(types) or not set(types) <= set(RESOURCE_TYPES):
        return TRES_TYPES, None
    for prefix in ENVIRONMENTS:
        account = getattr(payload, prefix)
        base_url = (account.base_url or "").strip()
        if base_url and not base_url_ok(base_url):
            return TRES_BASE_URL, prefix
        unchanged = base_url == ((stored or {}).get(prefix) or "")
        if base_url and not unchanged and not address_allowed(base_url, hosts):
            return TRES_HOST_NOT_ALLOWED, prefix
        for name in ACCOUNT_FIELDS:
            value = getattr(account, name)
            if value is not None and len(value) > FIELD_MAX[name]:
                return TRES_FIELD_LENGTH, prefix
    if payload.send_from is not None and not send_from_ok(payload.send_from, now or datetime.now(timezone.utc)):
        return TRES_SEND_FROM, None
    selected = (getattr(payload, payload.environment).base_url or "").strip() or None
    if payload.mode != "off" and live_closed(payload.environment, selected):
        return TRES_LIVE_CLOSED, payload.environment
    return None


def settings_refusal(payload: TresSettingsIn, *, hosts: frozenset[str],
                     stored: Mapping[str, str | None] | None = None, now: datetime | None = None) -> str | None:
    """The code alone of `refusal_of`."""
    refused = refusal_of(payload, hosts=hosts, stored=stored, now=now)
    return refused[0] if refused is not None else None
