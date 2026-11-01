# homunculus-engine/tests/test_edge_pdq_client.py
"""The bridge's client of POST /edge/patient-query (G2-B1d, spec §5.2, D8): the derived URL, the
device token, a JSON body with the one id, 2 s; the three answers — a record, NOT_FOUND, or
QueryUnavailable for anything the bridge cannot trust (no route, a timeout, a non-200, a body that
is not the route's); and no id in the words of a failure. No network: an injected opener."""
from __future__ import annotations

import http.client
import io
import json
import urllib.error
from datetime import datetime, timezone

import pytest

from homunculus.edge.adt import PatientIdentity
from homunculus.edge.pdq import NOT_FOUND
from homunculus.edge.pdq_client import TIMEOUT_S, PatientQueryClient, QueryUnavailable, query_url

NUMBER = "202600000001"
NOW = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


class _Response(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200) -> None:
        super().__init__(body)
        self.status = status


def _opener(answer=None, *, raises: BaseException | None = None, status: int = 200,
            raw: bytes | None = None):
    sent: list = []

    def open_(request, timeout):
        sent.append((request, timeout))
        if raises is not None:
            raise raises
        return _Response(raw if raw is not None else json.dumps(answer).encode(), status)

    open_.sent = sent
    return open_


def _client(opener) -> PatientQueryClient:
    return PatientQueryClient("http://api:8000/edge/patient-query", "device-token", opener=opener,
                              clock=lambda: NOW)


def test_the_url_is_the_cloud_url_and_the_route():
    assert query_url("http://api:8000") == "http://api:8000/edge/patient-query"
    assert query_url("https://host/api/") == "https://host/api/edge/patient-query"


def test_a_found_answer_is_a_record_with_the_name_and_the_request_is_the_routes():
    opener = _opener({"found": True, "family": "", "given": "Test Hasta",
                      "birth_date": "1970-05-05", "sex": "female"})
    got = _client(opener).ask(NUMBER)
    assert got == PatientIdentity(patient_id=NUMBER, family="", given="Test Hasta",
                                  birth_date="1970-05-05", sex="female", state="admitted", at=NOW)
    ((request, timeout),) = opener.sent
    assert (request.full_url, request.get_method(), timeout) == (
        "http://api:8000/edge/patient-query", "POST", TIMEOUT_S)
    assert TIMEOUT_S == 2.0
    assert request.get_header("Authorization") == "Bearer device-token"
    assert request.get_header("Content-type") == "application/json"
    assert json.loads(request.data) == {"id": NUMBER}


def test_a_not_found_answer_is_not_found():
    assert _client(_opener({"found": False})).ask(NUMBER) is NOT_FOUND


_URL = "http://api:8000/edge/patient-query"


@pytest.mark.parametrize("opener", [
    _opener(raises=urllib.error.HTTPError(_URL, 503, "x", {}, None)),
    _opener(raises=urllib.error.HTTPError(_URL, 401, "x", {}, None)),
    _opener(raises=urllib.error.HTTPError(_URL, 404, "x", {}, None)),
    _opener(raises=urllib.error.URLError("connection refused")),
    _opener(raises=TimeoutError("timed out")),
    _opener(raises=ConnectionResetError("reset")),
    _opener(raises=http.client.IncompleteRead(b"{")),
    _opener(raises=http.client.BadStatusLine("")),
    _opener({"found": True}, status=204),
    _opener(raw=b"<html>not json</html>"),
    _opener(["found"]),
    _opener({"found": "yes"}),
    _opener({"found": True, "family": "", "given": 7, "birth_date": "", "sex": ""}),
    _opener({"found": True, "given": "Test Hasta"}),
], ids=["503", "401", "404", "refused", "timeout", "reset", "incomplete", "bad-status", "204",
        "html", "list", "found-text", "given-int", "fields-missing"])
def test_anything_the_bridge_cannot_trust_is_unavailable_and_never_names_the_id(opener):
    with pytest.raises(QueryUnavailable) as failed:
        _client(opener).ask(NUMBER)
    assert NUMBER not in str(failed.value)
