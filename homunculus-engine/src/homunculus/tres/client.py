# homunculus-engine/src/homunculus/tres/client.py
"""The HTTP client of the national e-health platform (TRƏS-01, spec §4, D4, D21).

The contract is SECOND-HAND (spec §2): read from a third-party sender, true of its sandbox and
live runs up to October 2026. Phase F6 re-checks every line below against the sandbox; where this
file and the server disagree, the server is right and this file changes.

* The session (§4.1). `POST {base}/auth/token` with Basic credentials, the content type
  `application/json-patch+json` and `{"healthcareProviderId": …}` answers `payload.sessionId`;
  every FHIR request carries it as a Bearer token. No expiry is published: a 401 means a new
  token, asked once, and the request once more.
* One resource per request (§4.2, D4): `find` by the local id — an exact match only, the search
  itself being a prefix — then `create` or `update`.
  `create` must carry an `id` although the server assigns its own (the caller's placeholder);
  `update` carries the server's id in the URL and in the body. `validate` stores nothing.
* Errors (§4.5) come in three shapes; `read_error` reads all three. Every refusal is a
  `TresError` with the HTTP status; a failure with no answer at all (a timeout, a refused
  connection) is a `TresError` with `status` None, named by its class and never by a URL.
* A session that cannot be had is a `TresSessionError`: the token route answered anything but a
  2xx, or a 2xx with no usable session id; or a FHIR call was refused 401 again after the one new
  token. Nothing in it is about one resource, so the ledger counts it against none and the round
  ends (review #1: a password changed at the ministry must not make every due stay `stuck`).
* HTTP 429 (D21) is never retried here: the `TresError` carries `retry_after` and the round ends.
* `is_outage` tells the platform's (or the line's) failures — a session refused, a 429, a 5xx, no
  answer — from a refusal of ONE resource (any other status), which is the only kind the ledger
  counts towards `stuck` (open item O13, closed «no»).

As `api/infinity_waves.py`'s hub client: `trust_env=False` (no proxy from the environment), no
redirects, https only, an explicit timeout, one keep-alive client built on first use. Nothing is
logged here: a body is PHI (D25).

`pace`, when set, is awaited before every request: the worker's 300 ms spacing (D21)."""
from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

TIMEOUT_S = 20.0
#: The most characters of a platform message this module hands on.
ERROR_MAX = 500
#: The platform's one search key (§4.2), and the extension every resource carries it in (§4.4).
LOCAL_ID_PARAM = "local-system-unique-id"
LOCAL_ID_EXTENSION = "http://fhir.az/StructureDefinition/local-system-unique-id"
TOKEN_CONTENT_TYPE = "application/json-patch+json"


@dataclass(frozen=True)
class TresAccount:
    """One environment's account at the platform. The password never appears in a repr."""
    base_url: str
    username: str
    password: str = field(repr=False)
    provider_id: str


class TresError(Exception):
    """The platform refused, or did not answer. `status` is the HTTP status, None when there was
    no answer; `message` the platform's own words (at most ERROR_MAX characters), or the class of
    the transport failure; `retry_after` the seconds a 429 asked for, when it said."""

    def __init__(self, status: int | None, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after = retry_after


class TresSessionError(TresError):
    """No session could be had: the token route refused or answered no usable session id, or a
    FHIR call was refused 401 again after the one new token. `status`, `message` and
    `retry_after` as `TresError`'s (a 429 from the token route keeps its `Retry-After`)."""


def is_outage(exc: TresError) -> bool:
    """Is this failure the platform's or the line's, not one resource's? A session refused, a 429,
    any 5xx, or no answer at all. Everything else (a 4xx about the body, a 2xx `$validate` that
    holds an error) is a refusal of the resource that was sent."""
    return (isinstance(exc, TresSessionError) or exc.status is None or exc.status == 429
            or exc.status >= 500)


def local_id_of(resource: dict) -> str | None:
    """The value of the resource's local-system-unique-id extension (§4.4), or None."""
    extensions = resource.get("extension")
    for extension in extensions if isinstance(extensions, list) else ():
        if isinstance(extension, dict) and extension.get("url") == LOCAL_ID_EXTENSION:
            value = extension.get("valueString")
            return value if isinstance(value, str) else None
    return None


#: What a session id must look like to ride in a header: printable ASCII, no space.
_SESSION_ID = re.compile(r"[!-~]+")


def read_error(body: str) -> str:
    """The words of an error answer, whichever of the three shapes it has (§4.5): an
    OperationOutcome's `issue[].diagnostics`; one whose text is at `issue[].details.text.value`
    (or at `details.text`, as FHIR itself writes it); a plain `{"error" | "message": "…"}`.
    Anything else is the body's own text. Never longer than ERROR_MAX."""
    text = (body or "").strip()
    try:
        data = json.loads(text)
    except (ValueError, RecursionError):
        return text[:ERROR_MAX]
    if not isinstance(data, dict):
        return text[:ERROR_MAX]
    words: list[str] = []
    issues = data.get("issue")
    for issue in issues if isinstance(issues, list) else ():
        if not isinstance(issue, dict):
            continue
        said = issue.get("diagnostics")
        if not isinstance(said, str) or not said.strip():
            details = issue.get("details")
            inner = details.get("text") if isinstance(details, dict) else None
            said = inner.get("value") if isinstance(inner, dict) else inner
        if isinstance(said, str) and said.strip():
            words.append(said.strip())
    if not words:
        for key in ("error", "message"):
            said = data.get(key)
            if isinstance(said, str) and said.strip():
                words.append(said.strip())
                break
    return ("; ".join(words) or text)[:ERROR_MAX]


def _retry_after(response: httpx.Response) -> float | None:
    """`Retry-After` in seconds, or None: absent, a date, or not a number."""
    raw = (response.headers.get("Retry-After") or "").strip()
    try:
        seconds = float(raw)
    except ValueError:
        return None
    return seconds if 0 <= seconds < 86_400 else None


def _answer(response: httpx.Response) -> dict:
    """The answer's JSON object, or an empty one."""
    try:
        data = response.json()
    except (ValueError, RecursionError):
        return {}
    return data if isinstance(data, dict) else {}


def _refuse_unless_ok(response: httpx.Response) -> None:
    if not response.is_success:
        raise TresError(response.status_code,
                        read_error(response.text) or f"HTTP {response.status_code}")


class TresClient:
    """One account's session and the six calls of §4. Built without touching the network; the
    connection is made by the first request. `aclose()` when done."""

    def __init__(self, account: TresAccount, *,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not account.base_url.startswith("https://"):
            # The credentials ride in a header: never over plain HTTP.
            raise ValueError("the TRƏS base URL must start with https://")
        try:
            httpx.URL(account.base_url)
        except httpx.InvalidURL:
            raise ValueError("the TRƏS base URL is not a URL") from None
        self.account = account
        self._base = account.base_url.rstrip("/")
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._session: str | None = None
        #: Awaited before every request when set (the worker's spacing, D21).
        self.pace: Callable[[], Awaitable[None]] | None = None
        #: Requests made, the token's included: the tests and a round's report read it.
        self.requests = 0

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            common = {"timeout": httpx.Timeout(TIMEOUT_S), "follow_redirects": False,
                      "trust_env": False}
            if self._transport is not None:
                self._client = httpx.AsyncClient(transport=self._transport, **common)
            else:
                self._client = httpx.AsyncClient(
                    **common, limits=httpx.Limits(max_connections=2, max_keepalive_connections=2,
                                                  keepalive_expiry=30.0))
        return self._client

    async def aclose(self) -> None:
        client, self._client = self._client, None
        self._session = None
        if client is not None:
            await client.aclose()

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        if self.pace is not None:
            await self.pace()
        self.requests += 1
        try:
            return await self._http().request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            # No answer at all. The class names the failure; str(exc) may carry the URL.
            raise TresError(None, type(exc).__name__) from None

    async def token(self) -> str:
        """The session id (§4.1), asked once and kept until a 401 or `aclose()`. Any answer but a
        2xx carrying a usable session id is a `TresSessionError`; no answer at all stays a plain
        `TresError` with `status` None (a dead line counts towards the round's five in a row)."""
        if self._session is None:
            response = await self._request(
                "POST", f"{self._base}/auth/token",
                auth=httpx.BasicAuth(self.account.username, self.account.password),
                headers={"Content-Type": TOKEN_CONTENT_TYPE, "Accept": "application/json"},
                content=json.dumps({"healthcareProviderId": self.account.provider_id}))
            status = response.status_code
            if not response.is_success:
                said = read_error(response.text) or ("Too Many Requests" if status == 429 else f"HTTP {status}")
                raise TresSessionError(status, said,
                                       retry_after=_retry_after(response) if status == 429 else None)
            payload = _answer(response).get("payload")
            session = payload.get("sessionId") if isinstance(payload, dict) else None
            if not isinstance(session, str) or not _SESSION_ID.fullmatch(session):
                raise TresSessionError(status, "the platform's answer carries no session id")
            self._session = session
        return self._session

    async def _fhir(self, method: str, path: str, *, params: dict | None = None,
                    resource: dict | None = None) -> httpx.Response:
        """One FHIR request with the session. A 401 asks one new token and sends it once more; a
        second 401 is a `TresSessionError`. A 429 raises with what `Retry-After` said. Every other
        answer is the caller's to read."""
        headers = {"Accept": "application/json"}
        content = None
        if resource is not None:
            headers["Content-Type"] = "application/json"
            content = json.dumps(resource, ensure_ascii=False).encode("utf-8")
        response = None
        for attempt in (1, 2):
            session = await self.token()
            response = await self._request(
                method, f"{self._base}/fhir/{path}", params=params, content=content,
                headers={**headers, "Authorization": f"Bearer {session}"})
            if response.status_code != 401:
                break
            self._session = None            # §4.1: a 401 means a new token
        if response.status_code == 401:
            raise TresSessionError(401, read_error(response.text) or "HTTP 401")
        if response.status_code == 429:
            raise TresError(429, read_error(response.text) or "Too Many Requests",
                            retry_after=_retry_after(response))
        return response

    async def find(self, resource_type: str, local_id: str) -> str | None:
        """The server's id of the resource carrying EXACTLY this local id, or None (§4.2).

        The search parameter is a FHIR `string`: the server answers every resource whose local id
        STARTS with the value, in any case — `hmn-l-12` finds `hmn-l-120` too (review #3). So the
        answer is the first entry whose own local-id extension equals the one asked, character
        for character; another resource's id is never taken for this one's."""
        response = await self._fhir("GET", resource_type, params={LOCAL_ID_PARAM: local_id})
        _refuse_unless_ok(response)
        entries = _answer(response).get("entry")
        for entry in entries if isinstance(entries, list) else ():
            resource = entry.get("resource") if isinstance(entry, dict) else None
            if not isinstance(resource, dict) or local_id_of(resource) != local_id:
                continue
            found = resource.get("id")
            if isinstance(found, str) and found:
                return found
        return None

    async def create(self, resource_type: str, resource: dict) -> str:
        """POST. The body must carry an `id` (the caller's placeholder) although the server
        assigns its own; the server's id, from the answer, is what is returned."""
        if not isinstance(resource.get("id"), str) or not resource["id"]:
            raise ValueError("a resource to create carries a placeholder id (spec §4.2)")
        response = await self._fhir("POST", resource_type, resource=resource)
        _refuse_unless_ok(response)
        remote = _answer(response).get("id")
        if not isinstance(remote, str) or not remote:
            raise TresError(response.status_code, "the platform's answer carries no resource id")
        return remote

    async def update(self, resource_type: str, remote_id: str, resource: dict) -> None:
        """PUT, the body's `id` equal to the URL's (§4.2)."""
        response = await self._fhir("PUT", f"{resource_type}/{quote(remote_id, safe='')}",
                                    resource={**resource, "id": remote_id})
        _refuse_unless_ok(response)

    async def validate(self, resource_type: str, resource: dict) -> None:
        """`$validate`: the platform checks the resource and stores nothing. A refusal, or an
        answer whose OperationOutcome holds an issue of severity error or fatal, raises. A green
        validate proves the shape, not the codes (§4.5)."""
        response = await self._fhir("POST", f"{resource_type}/$validate", resource=resource)
        _refuse_unless_ok(response)
        issues = _answer(response).get("issue")
        bad = [issue for issue in issues if isinstance(issue, dict)
               and issue.get("severity") in ("error", "fatal")] if isinstance(issues, list) else []
        if bad:
            raise TresError(response.status_code, read_error(json.dumps({"issue": bad})))

    async def delete(self, resource_type: str, remote_id: str) -> None:
        """DELETE, hard (§4.3). A resource still referred to answers 409."""
        response = await self._fhir("DELETE", f"{resource_type}/{quote(remote_id, safe='')}")
        _refuse_unless_ok(response)

    async def read(self, resource_type: str, remote_id: str) -> dict | None:
        """The resource as the platform holds it, or None when it holds none by that id."""
        response = await self._fhir("GET", f"{resource_type}/{quote(remote_id, safe='')}")
        if response.status_code == 404:
            return None
        _refuse_unless_ok(response)
        return _answer(response)
