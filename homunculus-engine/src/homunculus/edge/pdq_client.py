# src/homunculus/edge/pdq_client.py
"""The bridge asks the API who a queried number is (Group 2 · B1d, spec §5.2, D8).

    POST <cloud-url>/edge/patient-query   {"id": "<number>"}   Bearer <the bridge's --token>

The same credential the bridge's /ingest uses (a device token); the route is reachable only on the
compose network (D12). Two seconds at most: NCE gives its patient-query host ten, and the bridge
must still answer from its mirror after a slow API. The bound is this client's own, so it holds
even against an API whose store blocks.

`ask` answers a `PatientIdentity` (found: the name always, D3), `pdq.NOT_FOUND` (D4), or raises
`QueryUnavailable` for anything the bridge cannot trust — no route, no answer in time, a status
that is not 200 (the route's 503 included: its store could not answer), a body that is not the
route's. The bridge then answers from its mirror (D8). Stdlib only, as edge/uplink.py.

PHI: the answer holds a name; nothing here logs, and a failure's words never name the id.
"""
from __future__ import annotations

import http.client
import json
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone

from homunculus.edge.adt import ADMITTED, PatientIdentity
from homunculus.edge.pdq import NOT_FOUND

QUERY_PATH = "/edge/patient-query"
TIMEOUT_S = 2.0
_FIELDS = ("family", "given", "birth_date", "sex")


class QueryUnavailable(Exception):
    """The API could not answer the query, or answered something the bridge cannot trust. Its
    words name the reason, never the id."""


def query_url(cloud_url: str) -> str:
    """The route's address, derived from the bridge's `--cloud-url` (as `/ingest`'s is)."""
    return cloud_url.rstrip("/") + QUERY_PATH


class PatientQueryClient:
    """`ask(number)`. `opener` and `clock` are injected by the tests."""

    def __init__(self, url: str, token: str, *, timeout: float = TIMEOUT_S,
                 opener: Callable = urllib.request.urlopen,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self.url = url
        self._token = token
        self.timeout = timeout
        self._open = opener
        self._clock = clock

    def ask(self, patient_id: str) -> PatientIdentity | object:
        request = urllib.request.Request(
            self.url, data=json.dumps({"id": patient_id}).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"})
        try:
            with self._open(request, timeout=self.timeout) as response:
                status, body = response.status, response.read()
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
