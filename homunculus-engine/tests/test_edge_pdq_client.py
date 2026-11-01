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
import urllib.request
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


@pytest.mark.parametrize("url", ["/edge/patient-query", "api/edge/patient-query", ""])
def test_a_url_that_cannot_make_a_request_is_unavailable_not_a_crash(url):
    """F-31: a `--cloud-url` without a scheme makes `urllib.request.Request` raise ValueError
    («unknown url type»); the query must still end in the mirror's answer, not an exception."""
    opener = _opener({"found": False})
    client = PatientQueryClient(url, "device-token", opener=opener, clock=lambda: NOW)
    with pytest.raises(QueryUnavailable) as failed:
        client.ask(NUMBER)
    assert NUMBER not in str(failed.value)
    assert opener.sent == []                    # nothing was sent: there was nothing to send to


@pytest.mark.parametrize("url", ["api:8000/edge/patient-query", "http://"])
def test_a_url_the_real_opener_refuses_is_unavailable_too(url):
    """The same, where the scheme parses but the opener refuses (URLError, nothing is connected)."""
    with pytest.raises(QueryUnavailable) as failed:
        PatientQueryClient(url, "device-token").ask(NUMBER)
    assert NUMBER not in str(failed.value)


# ---------------------------------------------------------------- Lane A S5 (F-29): the real opener
class _Recorder:
    """A local HTTP server that records what it is asked and answers with `respond(handler)`."""

    def __init__(self, respond) -> None:
        import http.server
        import threading

        seen: list[tuple[str, str | None]] = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):                          # noqa: N802 — the stdlib's name
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append((self.path, self.headers.get("Authorization")))
                respond(self)

            def log_message(self, *_args):              # keep the test output quiet
                pass

        self.seen = seen
        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def _answer(status: int, body: bytes = b"", location: str | None = None):
    def respond(handler) -> None:
        handler.send_response(status)
        if location:
            handler.send_header("Location", location)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    return respond


@pytest.fixture
def other_host():
    """Somewhere a redirect or a proxy could send the request: it must never be asked."""
    other = _Recorder(_answer(200, b'{"found": false}'))
    yield other
    other.close()


@pytest.fixture
def api_stub():
    made: list[_Recorder] = []

    def make(respond) -> _Recorder:
        made.append(_Recorder(respond))
        return made[-1]

    yield make
    for stub in made:
        stub.close()


def test_the_default_opener_follows_no_redirect_and_the_token_goes_nowhere_else(api_stub, other_host):
    """A 30x would carry the Authorization header and the number to another host: it is
    «cannot answer» (the mirror's turn), and the other host is never asked."""
    api = api_stub(_answer(302, location=f"http://127.0.0.1:{other_host.port}/edge/patient-query"))
    client = PatientQueryClient(f"http://127.0.0.1:{api.port}/edge/patient-query", "device-token")
    with pytest.raises(QueryUnavailable) as failed:
        client.ask(NUMBER)
    assert "302" in str(failed.value) and NUMBER not in str(failed.value)
    assert api.seen == [("/edge/patient-query", "Bearer device-token")]
    assert other_host.seen == []


def test_the_default_opener_ignores_the_proxy_variables(api_stub, other_host, monkeypatch):
    """HTTP_PROXY in the environment would send the token and the number through a proxy: the
    bridge talks to the API directly, on the compose network."""
    for name in ("NO_PROXY", "no_proxy"):
        monkeypatch.delenv(name, raising=False)
    # urlopen builds its shared opener once, from the environment of that moment: rebuild it here.
    monkeypatch.setattr(urllib.request, "_opener", None)
    for name in ("HTTP_PROXY", "http_proxy"):
        monkeypatch.setenv(name, f"http://127.0.0.1:{other_host.port}")
    api = api_stub(_answer(200, b'{"found": false}'))
    client = PatientQueryClient(f"http://127.0.0.1:{api.port}/edge/patient-query", "device-token")
    assert client.ask(NUMBER) is NOT_FOUND
    assert api.seen == [("/edge/patient-query", "Bearer device-token")]
    assert other_host.seen == []
