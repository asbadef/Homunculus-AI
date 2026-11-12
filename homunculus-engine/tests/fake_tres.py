# homunculus-engine/tests/fake_tres.py
"""An in-process stand-in for the national e-health platform (TRƏS-01, spec §9): `FakeTres().transport`
is an `httpx.MockTransport` a `TresClient` talks to, and nothing leaves the process.

It enforces what spec §4 states, and only that — every rule below is second-hand knowledge of the
real server (spec §2), so the stand-in is a statement of what the module was built against, not of
what the ministry's server does:

* one account (Basic credentials and the provider id) opens a session; every FHIR request needs the
  Bearer token of a session that is still open (`expire_session()` closes them all → 401);
* `throttle(n, retry_after=…)` makes the next n FHIR requests answer 429;
* POST: the body must carry an `id` («Resource to be added has no ID», 400); the server assigns
  its own and answers the stored resource;
* PUT: the body's `id` must equal the URL's («Resource ID mismatch», 400); 404 for an unknown id;
  a body whose local id is not the stored resource's is refused (400): a PUT never moves a record
  from one local id to another;
* every stored or validated resource carries `meta.profile` and the local-id extension (400);
* a reference that is not `Type/id` («Patient/», «#p1», a URL…) is refused (400), and one to a
  resource the server does not hold is refused («Non-existent reference», 409);
* the only search is `?local-system-unique-id=` (any other, or none: 400), and it is a FHIR
  `string` search: a resource whose local id STARTS with the value, in any case, is a hit — so
  `hmn-l-12` also finds `hmn-l-120`, and the client must pick the exact one (review #3). It answers
  a searchset Bundle a PAGE at a time (`page_size`, 20 by default), with `total` and a `next` link
  when more matches exist — the next page itself is never served (review I1: the client must not
  take a first page for the whole answer);
* DELETE of a resource another stored resource refers to is refused («There are other resources
  referencing this resource», 409);
* `$validate` runs the same checks and stores nothing.

Errors are OperationOutcome JSON with `issue[].diagnostics`. `requests` keeps every request as
`(method, path)`, the token's included. `seed()` plants a resource the server already holds (an
Organization, say) without a request.

* PER PROFILE (`meta.profile[0]`; plan F1, N6): the elements spec §5 and FHIR R4 itself require
  (`REQUIRED`, «<Type>.<path>: minimum required = 1», 400), and the values a profile fixes or
  restricts (`ALLOWED`, «<Type>.<path>: value not allowed», 400). Keyed by the profile, not by the
  FHIR type: a vital sign and a laboratory result are both Observations, under two profiles. A
  profile the table does not name is held to spec §4 alone — `UNCHECKED_PROFILE` is the one the
  tests of §4 send. Phase F1 fills in its four profiles; each later phase adds its own with its
  mapper.

Synthetic account, synthetic resources only."""
from __future__ import annotations

import base64
import json
import re

import httpx

from homunculus.tres.client import LOCAL_ID_EXTENSION, LOCAL_ID_PARAM, TOKEN_CONTENT_TYPE, TresAccount

BASE_URL = "https://tres.test"
NO_ID = "Resource to be added has no ID"
ID_MISMATCH = "Resource ID mismatch"
NO_REFERENCE = "Non-existent reference"
REFERRED = "There are other resources referencing this resource"
MALFORMED_REFERENCE = "A reference must be Type/id"
LOCAL_ID_CHANGED = "The local-system-unique-id differs from the stored resource's"
_REFERENCE = re.compile(r"^([A-Za-z]+)/([A-Za-z0-9\-.]+)$")

STRUCTURE = "http://fhir.az/StructureDefinition/"
#: A profile the stand-in holds no rules for: what the tests of spec §4 alone send.
UNCHECKED_PROFILE = BASE_URL + "/StructureDefinition/unchecked"
_SEX = STRUCTURE + "sex"
_FATHERS_NAME = STRUCTURE + "fathersName"
_FIN = "http://fhir.az/sid/fin"

#: Per profile, the elements it requires, each a dotted path; a list on the way may hold the next
#: step in any of its items, and `name(x)` keeps the items whose `url` or `system` is x. From spec
#: §5 and D16, D17, D20 (second-hand, §2) and from FHIR R4 (4.0.1) itself: Observation.status and
#: .code, Encounter.status and .class are 1..1 there (hl7.org/fhir/R4, read 2026-11-12).
REQUIRED: dict[str, tuple[str, ...]] = {
    STRUCTURE + "az-patient": (f"identifier({_FIN}).value", "name.family", "name.given",   # D20
                               f"extension({_SEX}).valueCode", f"extension({_FATHERS_NAME}).valueString"),
    STRUCTURE + "az-practitioner": (f"identifier({_FIN}).value", "active"),                 # D16; §5
    STRUCTURE + "az-encounter": ("status", "class", "serviceType"),                         # R4; D17
    STRUCTURE + "az-observation": ("status", "code"),                                       # R4
}
#: Per profile, the values an element may take (D20: the platform refuses any other sex code; §5:
#: the profile fixes a practitioner's `active`).
ALLOWED: dict[str, dict[str, frozenset]] = {
    STRUCTURE + "az-patient": {f"extension({_SEX}).valueCode": frozenset({"K", "Q"})},
    STRUCTURE + "az-practitioner": {"active": frozenset({True})},
}
_STEP = re.compile(r"([A-Za-z]+)(?:\(([^)]*)\))?")


def steps(path: str) -> list[tuple[str, str | None]]:
    """A REQUIRED path's steps, each (name, selector or None); a selector may hold dots (a URL)."""
    return [(match.group(1), match.group(2)) for match in _STEP.finditer(path)]


def values_at(node, path: str) -> list:
    """Every value at `path` in `node` (REQUIRED's syntax), lists walked through."""
    found = [node]
    for name, selector in steps(path):
        found = [item.get(name) for item in found if isinstance(item, dict)]
        found = [x for value in found for x in (value if isinstance(value, list) else [value])]
        if selector is not None:
            found = [x for x in found if isinstance(x, dict) and selector in (x.get("url"), x.get("system"))]
    return [value for value in found if value not in (None, "", [], {})]


def local_id_of(resource: dict) -> str | None:
    """The value of the resource's local-system-unique-id extension, or None."""
    for extension in resource.get("extension") or ():
        if isinstance(extension, dict) and extension.get("url") == LOCAL_ID_EXTENSION:
            value = extension.get("valueString")
            return value if isinstance(value, str) and value else None
    return None


def references_of(node) -> set[str]:
    """Every `{"reference": "Type/id"}` anywhere in the JSON."""
    found: set[str] = set()
    if isinstance(node, dict):
        reference = node.get("reference")
        if isinstance(reference, str) and _REFERENCE.match(reference):
            found.add(reference)
        for value in node.values():
            found |= references_of(value)
    elif isinstance(node, list):
        for value in node:
            found |= references_of(value)
    return found


def reference_values(node) -> list:
    """Every value held under a `reference` key anywhere in the JSON, well-formed or not."""
    found: list = []
    if isinstance(node, dict):
        if "reference" in node:
            found.append(node["reference"])
        for value in node.values():
            found += reference_values(value)
    elif isinstance(node, list):
        for value in node:
            found += reference_values(value)
    return found


def _outcome(status: int, text: str, *, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(status, headers=headers, json={
        "resourceType": "OperationOutcome",
        "issue": [{"severity": "error", "code": "processing", "diagnostics": text}]})


class FakeTres:
    def __init__(self, *, username: str = "sentetik", password: str = "gizli-parola",
                 provider_id: str = "PRV-0001", page_size: int = 20) -> None:
        self.account = TresAccount(BASE_URL, username, password, provider_id)
        #: The most entries one search answer carries (a server's default page).
        self.page_size = page_size
        #: FHIR type → server id → the stored resource.
        self.resources: dict[str, dict[str, dict]] = {}
        #: Every request, in order: (method, path).
        self.requests: list[tuple[str, str]] = []
        self.sessions: set[str] = set()
        self._issued = 0
        self._next_id = 7000
        self._throttled = 0
        self._retry_after: float | None = None
        self.transport = httpx.MockTransport(self._handle)

    # ------------------------------------------------------------ what a test arranges
    def expire_session(self) -> None:
        """Every open session ends: the next FHIR request answers 401 until a new token is asked."""
        self.sessions.clear()

    def throttle(self, n: int, *, retry_after: float | None = None) -> None:
        """The next `n` FHIR requests answer 429, with `Retry-After` when given."""
        self._throttled, self._retry_after = n, retry_after

    def seed(self, resource_type: str, resource_id: str, resource: dict | None = None) -> None:
        """A resource the server already holds, planted without a request."""
        self.resources.setdefault(resource_type, {})[resource_id] = {
            "resourceType": resource_type, **(resource or {}), "id": resource_id}

    def stored(self, resource_type: str) -> list[dict]:
        return list(self.resources.get(resource_type, {}).values())

    @property
    def fhir_requests(self) -> list[tuple[str, str]]:
        return [line for line in self.requests if line[1].startswith("/fhir/")]

    # ------------------------------------------------------------ the server
    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append((request.method, path))
        if path == "/auth/token":
            return self._token(request)
        if not path.startswith("/fhir/"):
            return _outcome(404, "Not found")
        bearer = request.headers.get("Authorization", "")
        if not bearer.startswith("Bearer ") or bearer[len("Bearer "):] not in self.sessions:
            return httpx.Response(401, json={"error": "Session expired"})
        if self._throttled > 0:
            self._throttled -= 1
            headers = {} if self._retry_after is None else {"Retry-After": f"{self._retry_after:g}"}
            return _outcome(429, "Too many requests", headers=headers)
        parts = path[len("/fhir/"):].split("/")
        resource_type, rest = parts[0], parts[1:]
        if request.method == "GET" and not rest:
            return self._search(resource_type, request)
        if request.method == "POST" and rest == ["$validate"]:
            refused = self._refusal(resource_type, self._body(request), creating=True)
            if refused is not None:
                return refused
            return httpx.Response(200, json={
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "information", "diagnostics": "No issues"}]})
        if request.method == "POST" and not rest:
            return self._create(resource_type, self._body(request))
        if len(rest) == 1 and request.method in ("GET", "PUT", "DELETE"):
            held = self.resources.get(resource_type, {})
            if rest[0] not in held:
                return _outcome(404, "Resource not found")
            if request.method == "GET":
                return httpx.Response(200, json=held[rest[0]])
            if request.method == "PUT":
                return self._update(resource_type, rest[0], self._body(request))
            return self._delete(resource_type, rest[0])
        return _outcome(405, "Method not allowed")

    def _token(self, request: httpx.Request) -> httpx.Response:
        account = self.account
        basic = base64.b64encode(f"{account.username}:{account.password}".encode()).decode()
        body = self._body(request)
        if (request.method != "POST" or request.headers.get("Authorization") != f"Basic {basic}"
                or request.headers.get("Content-Type") != TOKEN_CONTENT_TYPE
                or body.get("healthcareProviderId") != account.provider_id):
            return httpx.Response(401, json={"message": "Invalid credentials"})
        self._issued += 1
        session = f"session-{self._issued}"
        self.sessions.add(session)
        return httpx.Response(200, json={"payload": {"sessionId": session}})

    @staticmethod
    def _body(request: httpx.Request) -> dict:
        try:
            body = json.loads(request.content or b"{}")
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {}

    def _refusal(self, resource_type: str, body: dict, *, creating: bool,
                 url_id: str | None = None) -> httpx.Response | None:
        """Why the platform would not take this body, or None. The order is the stand-in's own."""
        if creating and not body.get("id"):
            return _outcome(400, NO_ID)
        if url_id is not None and body.get("id") != url_id:
            return _outcome(400, ID_MISMATCH)
        profiles = (body.get("meta") or {}).get("profile") if isinstance(body.get("meta"), dict) else None
        if not isinstance(profiles, list) or not profiles:
            return _outcome(400, "meta.profile is required")
        if local_id_of(body) is None:
            return _outcome(400, "The local-system-unique-id extension is required")
        for path in REQUIRED.get(profiles[0], ()):
            if not values_at(body, path):
                return _outcome(400, f"{resource_type}.{path}: minimum required = 1")
        for path, allowed in ALLOWED.get(profiles[0], {}).items():
            if any(value not in allowed for value in values_at(body, path)):
                return _outcome(400, f"{resource_type}.{path}: value not allowed")
        if any(not isinstance(value, str) or not _REFERENCE.match(value) for value in reference_values(body)):
            return _outcome(400, MALFORMED_REFERENCE)
        for reference in sorted(references_of(body)):
            referred_type, referred_id = reference.split("/", 1)
            if referred_id not in self.resources.get(referred_type, {}):
                return _outcome(409, NO_REFERENCE)
        return None

    def _search(self, resource_type: str, request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if set(params) != {LOCAL_ID_PARAM}:
            return _outcome(400, "Only a search by local-system-unique-id is supported")
        wanted = params[LOCAL_ID_PARAM].lower()
        hits = [resource for resource in self.stored(resource_type)
                if (local_id_of(resource) or "").lower().startswith(wanted)]
        link = [{"relation": "self", "url": str(request.url)}]
        if len(hits) > self.page_size:
            link.append({"relation": "next",
                         "url": f"{BASE_URL}/fhir?_getpages=stand-in&_getpagesoffset={self.page_size}"})
        return httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset", "total": len(hits),
                                         "link": link,
                                         "entry": [{"resource": resource} for resource in hits[:self.page_size]]})

    def _create(self, resource_type: str, body: dict) -> httpx.Response:
        refused = self._refusal(resource_type, body, creating=True)
        if refused is not None:
            return refused
        self._next_id += 1
        server_id = str(self._next_id)
        stored = {**body, "id": server_id}
        self.resources.setdefault(resource_type, {})[server_id] = stored
        return httpx.Response(201, json=stored)

    def _update(self, resource_type: str, server_id: str, body: dict) -> httpx.Response:
        refused = self._refusal(resource_type, body, creating=False, url_id=server_id)
        if refused is not None:
            return refused
        held = local_id_of(self.resources[resource_type][server_id])
        if held is not None and local_id_of(body) != held:
            return _outcome(400, LOCAL_ID_CHANGED)
        self.resources[resource_type][server_id] = body
        return httpx.Response(200, json=body)

    def _delete(self, resource_type: str, server_id: str) -> httpx.Response:
        target = f"{resource_type}/{server_id}"
        for other_type, held in self.resources.items():
            for other_id, resource in held.items():
                if (other_type, other_id) != (resource_type, server_id) and target in references_of(resource):
                    return _outcome(409, REFERRED)
        del self.resources[resource_type][server_id]
        return httpx.Response(204)
