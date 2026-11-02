# homunculus-engine/tests/test_edge_pdq_client.py
"""The bridge's client of POST /edge/patient-query (G2-B1d, spec §5.2, D8): the derived URL, the
device token, a JSON body with the one id, 2 s; the three answers — a record, NOT_FOUND, or
QueryUnavailable for anything the bridge cannot trust (no route, a timeout, a non-200, a body that
is not the route's); and no id in the words of a failure. No network: an injected opener."""
from __future__ import annotations

import http.client
import io
import json
import logging
import socket
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import pytest

from homunculus.edge import pdq_client
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


# ---------------------------------------------------------------- G2-B1d O9: one wall-clock bound
# urllib's timeout is per socket operation and never covers name resolution: with the api container
# stopped, Docker's DNS failed `api` after ~4 s, and a slowly dripped answer could take longer than
# 2 s in total. `ask` now returns or raises within `timeout` of wall-clock time, whatever blocks.
DEADLINE = 0.2          # the client's bound in these tests (seconds)
SLACK = 0.5             # scheduling slack allowed on top of it (a loaded machine)


def _exchange_threads() -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name == pdq_client.THREAD_NAME]


def _join_exchange_threads(limit: float = 5.0) -> list[threading.Thread]:
    """Wait (bounded) for the exchange threads to end; what is left, if anything, is returned."""
    end = time.monotonic() + limit
    for thread in _exchange_threads():
        thread.join(timeout=max(0.0, end - time.monotonic()))
    return _exchange_threads()


@pytest.fixture
def release():
    """The event a blocked stub waits on. Whatever the test did, it is set afterwards and every
    exchange thread the test started is joined (bounded): none is left behind."""
    event = threading.Event()
    yield event
    event.set()
    assert _join_exchange_threads() == []


def _gated_opener(release: threading.Event, *, late, then=None, blocks: int = 1):
    """The first `blocks` calls block until `release` is set, then return `late` (a dict: the
    API's answer) or raise it (an exception); the calls after those answer `then` at once."""
    entered = threading.Event()
    timeouts: list = []

    def open_(request, timeout):
        timeouts.append(timeout)
        if len(timeouts) > blocks:
            return _Response(json.dumps(then).encode())
        entered.set()
        release.wait(timeout=10)            # a safety bound only: the fixture releases it
        if isinstance(late, BaseException):
            raise late
        return _Response(json.dumps(late).encode())

    open_.entered, open_.timeouts = entered, timeouts
    return open_


def _bounded(opener, **kwargs) -> PatientQueryClient:
    return PatientQueryClient(_URL, "device-token", timeout=DEADLINE, opener=opener,
                              clock=lambda: NOW, **kwargs)


def test_a_blocked_exchange_ends_at_the_deadline_and_never_names_the_id(release):
    opener = _gated_opener(release, late={"found": False})
    started = time.monotonic()
    with pytest.raises(QueryUnavailable) as failed:
        _bounded(opener).ask(NUMBER)
    elapsed = time.monotonic() - started
    assert opener.entered.wait(1)               # the exchange did start: it is the one that blocked
    assert DEADLINE * 0.75 <= elapsed < DEADLINE + SLACK
    assert "did not answer in time" in str(failed.value)
    assert NUMBER not in str(failed.value)
    assert opener.timeouts == [DEADLINE]        # the socket timeout is still passed, as before


def test_a_stalled_name_resolution_ends_at_the_deadline_with_the_real_opener(release, monkeypatch):
    """The reported symptom itself: `getaddrinfo` does not come back (no DNS, no network)."""
    def stalled(*_args, **_kwargs):
        release.wait(timeout=10)
        raise socket.gaierror(-2, "name resolution gave up")

    monkeypatch.setattr(socket, "getaddrinfo", stalled)
    client = PatientQueryClient(_URL, "device-token", timeout=DEADLINE)
    started = time.monotonic()
    with pytest.raises(QueryUnavailable) as failed:
        client.ask(NUMBER)
    assert time.monotonic() - started < DEADLINE + SLACK
    assert "did not answer in time" in str(failed.value)
    assert NUMBER not in str(failed.value)


def test_a_slowly_dripped_answer_ends_at_the_deadline_though_no_single_read_times_out(
        api_stub, release):
    """Each byte arrives well inside the socket timeout, the whole answer takes ~1.6 s: urllib's
    per-operation timeout never fires, the wall-clock bound does."""
    body = b'{"found": false}'

    def drip(handler) -> None:
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        for index in range(len(body)):
            if release.wait(0.1):               # the fixture's release ends the drip early
                return
            handler.wfile.write(body[index:index + 1])
            handler.wfile.flush()

    api = api_stub(drip)
    client = PatientQueryClient(f"http://127.0.0.1:{api.port}/edge/patient-query", "device-token",
                                timeout=0.3)
    started = time.monotonic()
    with pytest.raises(QueryUnavailable) as failed:
        client.ask(NUMBER)
    assert time.monotonic() - started < 0.3 + SLACK
    assert "did not answer in time" in str(failed.value)


def test_the_cap_answers_at_once_while_a_blocked_exchange_holds_its_slot(release):
    opener = _gated_opener(release, late={"found": False}, then={"found": False})
    client = _bounded(opener, max_pending=1)
    with pytest.raises(QueryUnavailable) as first:
        client.ask(NUMBER)
    assert "did not answer in time" in str(first.value)
    assert opener.entered.wait(1)               # its thread is still blocked in the opener

    started = time.monotonic()
    with pytest.raises(QueryUnavailable) as second:
        client.ask(NUMBER)
    assert time.monotonic() - started < DEADLINE / 2        # at once, not at the deadline
    assert "still waiting" in str(second.value)
    assert NUMBER not in str(second.value)
    assert len(opener.timeouts) == 1            # the second never reached the opener

    release.set()
    assert _join_exchange_threads() == []       # the slot is given back when the thread ends
    assert client.ask(NUMBER) is NOT_FOUND      # a third ask, with a normal answer, succeeds
    assert len(opener.timeouts) == 2


def test_the_default_cap_is_eight_exchanges_still_in_flight(release):
    assert pdq_client.MAX_PENDING == 8
    opener = _gated_opener(release, late={"found": False}, blocks=1000)
    client = PatientQueryClient(_URL, "device-token", timeout=0.05, opener=opener,
                                clock=lambda: NOW)
    for _ in range(pdq_client.MAX_PENDING):
        with pytest.raises(QueryUnavailable) as waited:
            client.ask(NUMBER)
        assert "did not answer in time" in str(waited.value)
    with pytest.raises(QueryUnavailable) as ninth:
        client.ask(NUMBER)
    assert "still waiting" in str(ninth.value)
    assert len(opener.timeouts) == pdq_client.MAX_PENDING


@pytest.mark.parametrize("late", [
    {"found": True, "family": "", "given": "Test Hasta", "birth_date": "1970-05-05", "sex": "female"},
    urllib.error.URLError("connection refused"),
], ids=["found", "refused"])
def test_a_late_result_is_dropped_silently(release, late, caplog, capsys, monkeypatch):
    """The exchange ends after the deadline: `ask` has already raised, and nothing else happens —
    no log (PHI: this module logs nothing), no output, no unhandled thread exception, no answer
    served to the next query."""
    unhandled: list = []
    monkeypatch.setattr(threading, "excepthook", unhandled.append)
    opener = _gated_opener(release, late=late, then={"found": False})
    client = _bounded(opener, max_pending=1)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(QueryUnavailable):
            client.ask(NUMBER)
        assert opener.entered.wait(1)
        release.set()                           # the answer (or the failure) arrives late
        assert _join_exchange_threads() == []
        assert client.ask(NUMBER) is NOT_FOUND  # the next query gets its own answer, not that one
    assert caplog.records == []
    assert tuple(capsys.readouterr()) == ("", "")
    assert unhandled == []


def test_an_exchange_that_ends_in_time_gives_its_slot_back_before_ask_returns():
    """With one slot, back-to-back queries must all reach the API: the slot is released before the
    caller is woken, so a fast answer can never leave the next ask facing a full cap."""
    opener = _opener({"found": False})
    client = PatientQueryClient(_URL, "device-token", opener=opener, clock=lambda: NOW,
                                max_pending=1)
    for _ in range(25):
        assert client.ask(NUMBER) is NOT_FOUND
    assert len(opener.sent) == 25


def test_a_thread_that_cannot_be_started_is_unavailable_and_gives_its_slot_back(monkeypatch):
    real_start = threading.Thread.start

    def refuse(self):
        raise RuntimeError("can't start new thread")

    client = PatientQueryClient(_URL, "device-token", opener=_opener({"found": False}),
                                clock=lambda: NOW, max_pending=1)
    monkeypatch.setattr(threading.Thread, "start", refuse)
    with pytest.raises(QueryUnavailable) as failed:
        client.ask(NUMBER)
    assert NUMBER not in str(failed.value)
    monkeypatch.setattr(threading.Thread, "start", real_start)
    assert client.ask(NUMBER) is NOT_FOUND      # the one slot was not leaked


@pytest.mark.parametrize("opener, words", [
    (_opener(raises=urllib.error.HTTPError(_URL, 503, "x", {}, None)), "the API answered 503"),
    (_opener(raises=urllib.error.URLError("connection refused")),
     "the API could not be reached (URLError)"),
    (_opener(raises=TimeoutError("timed out")), "the API could not be reached (TimeoutError)"),
    (_opener(raises=http.client.IncompleteRead(b"{")),
     "the API could not be reached (IncompleteRead)"),
    (_opener({"found": True}, status=204), "the API answered 204"),
    (_opener(raw=b"<html>not json</html>"), "the API's answer is not JSON"),
], ids=["503", "refused", "timeout", "incomplete", "204", "html"])
def test_what_ends_in_time_keeps_its_words(opener, words):
    """The exchange now runs on a thread; inside the deadline the words are what they were."""
    with pytest.raises(QueryUnavailable) as failed:
        _client(opener).ask(NUMBER)
    assert str(failed.value) == words
