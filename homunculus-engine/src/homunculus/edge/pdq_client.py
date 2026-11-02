# src/homunculus/edge/pdq_client.py
"""The bridge asks the API who a queried number is (Group 2 · B1d, spec §5.2, D8).

    POST <cloud-url>/edge/patient-query   {"id": "<number>"}   Bearer <the bridge's --token>

The same credential the bridge's /ingest uses (a device token); the route is reachable only on the
compose network (D12). Two seconds at most: NCE gives its patient-query host ten, and the bridge
must still answer from its mirror after a slow API. The bound is this client's own, so it holds
even against an API whose store blocks — and it is one wall-clock bound (O9): whatever blocks —
name resolution (urllib's timeout does not cover it: with the api container stopped Docker's DNS
failed `api` after about 4 s), the connect, the send, or an answer dripped slowly enough that no
single read times out — `ask` returns or raises within `timeout` seconds, plus scheduling.

How: the network exchange (open, status, read) runs on a daemon thread, and `ask` waits for it at
most `timeout`. Past that it raises `QueryUnavailable` and the mirror answers; the abandoned
exchange ends on its own (the socket timeout is still passed to the opener, DNS apart) and its
result or failure is dropped without a word — late is as good as never, and nothing is logged.

The threads are bounded. `ask` runs on asyncio's default worker threads (edge/mllp.py,
`asyncio.to_thread`), several at once — one per connection with a query in hand — and a ward has
a few dozen devices, of which only the few being admitted or scanned at any moment ask anything.
`MAX_PENDING` = 8 exchanges still in flight is therefore ample for a healthy API (each ends in well
under a second) and a hard ceiling when it is not: a hung name resolution holds its thread until
the resolver gives up, and the ninth query meets a full cap. A slot is taken without waiting and
given back only when the exchange thread itself ends; with none free, `ask` raises at once and the
mirror answers at once — the same answer it would give at the deadline, two seconds sooner.

`ask` answers a `PatientIdentity` (found: the name always, D3), `pdq.NOT_FOUND` (D4), or raises
`QueryUnavailable` for anything the bridge cannot trust — no route, no answer in time, a status
that is not 200 (the route's 503 included: its store could not answer), a body that is not the
route's. The bridge then answers from its mirror (D8). Stdlib only, as edge/uplink.py. The default
opener ignores the proxy variables and follows no redirect (a 30x is «cannot answer»): the token
and the number go to the configured address and nowhere else.

PHI: the answer holds a name; nothing here logs, and a failure's words never name the id.
"""
from __future__ import annotations

import http.client
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone

from homunculus.edge.adt import ADMITTED, PatientIdentity
from homunculus.edge.pdq import NOT_FOUND

QUERY_PATH = "/edge/patient-query"
TIMEOUT_S = 2.0
MAX_PENDING = 8                 # exchanges still in flight, at most — see the module docstring
THREAD_NAME = "pdq-exchange"    # the name of an exchange thread (a test finds them by it)
_FIELDS = ("family", "given", "birth_date", "sex")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the Authorization header and the number to wherever it points:
    never follow one. The 3xx then arrives as an HTTPError, which `ask` maps to «cannot answer»
    (same idiom as edge/infinity_shadow.py)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _direct_opener() -> Callable:
    """`urlopen`'s shape, minus what must not happen to this request: no proxy from the
    environment (HTTP(S)_PROXY would carry the token and the number through it — the API is
    reached directly, on the compose network) and no redirect."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect()).open


class QueryUnavailable(Exception):
    """The API could not answer the query, or answered something the bridge cannot trust. Its
    words name the reason, never the id."""


def query_url(cloud_url: str) -> str:
    """The route's address, derived from the bridge's `--cloud-url` (as `/ingest`'s is)."""
    return cloud_url.rstrip("/") + QUERY_PATH


class PatientQueryClient:
    """`ask(number)`, within `timeout` seconds of wall-clock time, whatever blocks (O9).
    `opener` and `clock` are injected by the tests; the default opener is the direct,
    redirect-free one above. `max_pending` caps the exchanges still in flight (`MAX_PENDING`)."""

    def __init__(self, url: str, token: str, *, timeout: float = TIMEOUT_S,
                 opener: Callable | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 max_pending: int = MAX_PENDING) -> None:
        self.url = url
        self._token = token
        self.timeout = timeout
        self._open = opener if opener is not None else _direct_opener()
        self._clock = clock
        if max_pending < 1:
            # 0 would build a client that never asks the API (every ask «still waiting»).
            raise ValueError(f"max_pending must be at least 1, not {max_pending}")
        self._slots = threading.BoundedSemaphore(max_pending)

    def ask(self, patient_id: str) -> PatientIdentity | object:
        try:
            # Built inside the try: a `--cloud-url` without a scheme makes Request raise
            # ValueError («unknown url type»), and that too is «cannot answer», not a crash
            # (F-31). The words name the class only — the URL is the operator's, not ours to echo.
            request = urllib.request.Request(
                self.url, data=json.dumps({"id": patient_id}).encode("utf-8"), method="POST",
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self._token}"})
        except ValueError as exc:
            raise QueryUnavailable(f"the request could not be made ({type(exc).__name__})") from None
        try:
            status, body = self._exchange(request)
        except urllib.error.HTTPError as exc:
            raise QueryUnavailable(f"the API answered {exc.code}") from None
        except (OSError, http.client.HTTPException) as exc:
            # OSError covers URLError, a timeout and a reset; HTTPException is what a connection
            # cut mid-answer raises (IncompleteRead, BadStatusLine) and urllib does not wrap (E23).
            raise QueryUnavailable(f"the API could not be reached ({type(exc).__name__})") from None
        if status != 200:
            raise QueryUnavailable(f"the API answered {status}")
        try:
            answer = json.loads(body)
        except ValueError:
            raise QueryUnavailable("the API's answer is not JSON") from None
        if not isinstance(answer, dict) or not isinstance(answer.get("found"), bool):
            raise QueryUnavailable("the API's answer is not a patient-query answer")
        if not answer["found"]:
            return NOT_FOUND
        fields = {name: answer.get(name) for name in _FIELDS}
        if not all(isinstance(value, str) for value in fields.values()):
            raise QueryUnavailable("the API's answer is missing a field")
        return PatientIdentity(patient_id=patient_id, family=fields["family"],
                               given=fields["given"], birth_date=fields["birth_date"],
                               sex=fields["sex"] or "unknown", state=ADMITTED, at=self._clock())

    def _exchange(self, request: urllib.request.Request) -> tuple[int, bytes]:
        """The network exchange — open, status, read — on a daemon thread that `ask` waits for at
        most `timeout`. What the exchange raises in time is raised here, for `ask` to map as it
        always has; past the deadline `QueryUnavailable`, and the exchange's late result or failure
        goes unread and unlogged. The slot is given back by the thread itself when it ends, before
        it wakes the caller, so a fast answer never leaves the next ask facing a full cap."""
        if not self._slots.acquire(blocking=False):
            raise QueryUnavailable("earlier queries are still waiting on the API")
        outcome: dict[str, object] = {}
        ended = threading.Event()

        def run() -> None:
            try:
                with self._open(request, timeout=self.timeout) as response:
                    outcome["answer"] = (response.status, response.read())
            except BaseException as exc:  # noqa: BLE001 — carried to `ask`, or dropped if late
                outcome["failure"] = exc
            finally:
                self._slots.release()
                ended.set()

        try:
            threading.Thread(target=run, name=THREAD_NAME, daemon=True).start()
        except RuntimeError:                    # «can't start new thread»: the machine has no more
            self._slots.release()
            raise QueryUnavailable("the query could not be started") from None
        if not ended.wait(self.timeout):
            raise QueryUnavailable("the API did not answer in time")
        if "failure" in outcome:
            raise outcome["failure"]
        return outcome["answer"]
