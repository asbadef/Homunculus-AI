"""Time bounds on the API's sync Postgres engines (spec 2026-11-01-pg-sinirlari-design.md).

The audit, the identity store, the monitor samples and the device→bed table (G2-ESLEME) reach
Postgres through a sync driver from the event loop: a database that accepts a connection and then
says nothing would hold every request of the API, and the ward's screens with it, until the
operating system's TCP timeout. None of these tests needs a database."""
from __future__ import annotations

import functools
import logging
import socket
import threading
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from homunculus.api import (
    audit_postgres, device_beds_postgres, monitor_samples, patient_identity_postgres,
)
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.audit_postgres import (
    CONNECT_TIMEOUT_S, PostgresAuditLog, bounded_connect_args, set_local_statement_timeout,
)
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import TableFile
from homunculus.api.monitor_samples import InMemorySamples, PostgresSamples, Sample
from homunculus.api.patient_identity import InMemoryIdentityStore
from homunculus.api.patient_identity_postgres import PostgresIdentityStore

# How long a store may take to give up on a server that never answers: twice the connect bound.
SILENT_BOUND_S = 6.0
T0 = datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc)


def test_the_helper_holds_every_bound_with_its_value():
    assert bounded_connect_args(ssl_required=False, statement_timeout_ms=2000) == {
        "connect_timeout": 3,
        "options": "-c statement_timeout=2000",
        "keepalives": 1,
        "keepalives_idle": 10,
        "keepalives_interval": 5,
        "keepalives_count": 3,
        "tcp_user_timeout": 4000,
    }


def test_ssl_required_adds_sslmode_require_and_its_absence_adds_nothing():
    plain = bounded_connect_args(ssl_required=False, statement_timeout_ms=2000)
    tls = bounded_connect_args(ssl_required=True, statement_timeout_ms=2000)
    assert "sslmode" not in plain
    assert tls == {**plain, "sslmode": "require"}


@pytest.mark.parametrize("ms", [2000, 10_000])
def test_the_statement_timeout_is_an_integer_of_milliseconds_in_options(ms):
    # No unit: Postgres reads a bare integer as milliseconds.
    assert bounded_connect_args(ssl_required=False, statement_timeout_ms=ms)["options"] == \
        f"-c statement_timeout={ms}"


@pytest.mark.parametrize("bad", [0, -1, 2.5, True, "2000"])
def test_a_statement_timeout_that_bounds_nothing_is_refused(bad):
    """0 is Postgres's "no timeout": a typo here would quietly lift the bound this exists to set."""
    with pytest.raises(ValueError):
        bounded_connect_args(ssl_required=False, statement_timeout_ms=bad)


# Each store, its module (whose `create_engine` is captured) and its own statement timeout (D2):
# the identity store and the samples read or write a handful of rows; the audit also serves
# /audit, /audit/verify and the alarm-quality report's reads.
STORES = [
    pytest.param(audit_postgres, PostgresAuditLog, 10_000, id="audit"),
    pytest.param(patient_identity_postgres, PostgresIdentityStore, 2000, id="identity"),
    pytest.param(monitor_samples, PostgresSamples, 2000, id="samples"),
    pytest.param(device_beds_postgres, functools.partial(PostgresDeviceBeds, hospital="h1"), 2000,
                 id="device_beds"),
]


@pytest.mark.parametrize("ssl_required", [False, True], ids=["plain", "tls"])
@pytest.mark.parametrize("module, store, statement_ms", STORES)
def test_each_engine_is_built_with_the_bounds_and_its_own_statement_timeout(
        monkeypatch, module, store, statement_ms, ssl_required):
    seen = {}

    def create_engine(url, **kwargs):
        seen.update(kwargs)
        return object()

    monkeypatch.setattr(module, "create_engine", create_engine)
    store("postgresql://u:p@db/test_bounds", ssl_required=ssl_required)
    assert seen["pool_timeout"] == 3                     # a checkout waits at most 3 s for a connection
    assert seen["connect_args"] == bounded_connect_args(ssl_required=ssl_required,
                                                        statement_timeout_ms=statement_ms)
    assert seen["pool_pre_ping"] is True and seen["hide_parameters"] is True


@pytest.fixture
def silent_server():
    """A database that accepts the connection and then never sends a byte — an overloaded
    container, a migration's lock, a half-open connection. Yields its URL; on the way out every
    socket is closed, which also releases a client still waiting on it (the red run)."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    held: list[socket.socket] = []
    stop = threading.Event()
    acceptor = None
    try:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.settimeout(0.1)

        def accept() -> None:
            while not stop.is_set():
                try:
                    conn, _ = listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    return
                held.append(conn)                        # held open, never written to

        acceptor = threading.Thread(target=accept, daemon=True)
        acceptor.start()
        yield f"postgresql://u:p@127.0.0.1:{listener.getsockname()[1]}/test_silent"
    finally:
        stop.set()
        if acceptor is not None:
            acceptor.join(1.0)
        for conn in held:
            conn.close()
        listener.close()


def _gives_up_in_time(operation) -> BaseException:
    """Runs a store's first operation in a worker thread, so that a hang fails this test instead
    of holding the run; returns what it raised. Measured from the call to the raise."""
    outcome: dict = {}

    def run() -> None:
        started = time.monotonic()
        try:
            operation()
        except Exception as error:                       # the test inspects it below
            outcome["error"] = error
        outcome["elapsed"] = time.monotonic() - started

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(SILENT_BOUND_S)
    assert not worker.is_alive(), f"still waiting on a silent server after {SILENT_BOUND_S} s"
    assert "error" in outcome, "the operation returned against a server that never answered"
    assert outcome["elapsed"] < SILENT_BOUND_S
    # Not an instant refusal either: the connect bound is what fired.
    assert outcome["elapsed"] >= CONNECT_TIMEOUT_S - 1
    return outcome["error"]


def test_an_audit_append_to_a_silent_server_raises_in_time(silent_server):
    """D3: the timeout propagates — the request fails; the record is never skipped or queued."""
    log = PostgresAuditLog(silent_server)
    try:
        error = _gives_up_in_time(lambda: log.append(AuditEvent(
            tenant="h1", event_type="alert", patient_id="bed-1", subject="news2", payload={})))
    finally:
        log.dispose()
    assert isinstance(error, OperationalError)


def test_an_identity_read_from_a_silent_server_raises_in_time(silent_server):
    store = PostgresIdentityStore(silent_server)
    try:
        error = _gives_up_in_time(lambda: store.get("h1", "bed-1"))
    finally:
        store.close()
    assert isinstance(error, OperationalError)


def test_a_samples_write_to_a_silent_server_raises_in_time(silent_server):
    store = PostgresSamples(silent_server)
    sample = Sample(hospital="h1", patient_id="bed-1", bed_id="b-1", source="10.0.0.5",
                    code="heart_rate", via="hr", value=72.0, unit="bpm", captured_at=T0,
                    received_at=T0)
    try:
        error = _gives_up_in_time(lambda: store.append_many([sample]))
    finally:
        store.dispose()
    assert isinstance(error, OperationalError)


class _Result:
    rowcount = 0

    def mappings(self):
        return self

    def all(self):
        return []

    def scalar(self):                                    # the audit chain's head: none yet
        return None

    def scalar_one(self):                                # the new row's id
        return 1


class _Transaction:
    def __init__(self, statements: list[str]):
        self.statements = statements

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, parameters=None):
        self.statements.append(str(statement))
        return _Result()


class _RecordingEngine:
    """Records each transaction's SQL in order. Only `begin`: a statement bound set with SET LOCAL
    lasts to the end of a transaction, so a call that takes one must open one."""

    def __init__(self):
        self.transactions: list[list[str]] = []

    def begin(self):
        self.transactions.append([])
        return _Transaction(self.transactions[-1])


def _recorded_samples(monkeypatch):
    engine = _RecordingEngine()
    monkeypatch.setattr(monitor_samples, "create_engine", lambda url, **kwargs: engine)
    return PostgresSamples("postgresql://u:p@db/test_bounds"), engine


@pytest.mark.parametrize("call, bound, verb", [
    pytest.param(lambda store: store.since("h1", T0, now=T0), 30_000, "SELECT", id="replay"),
    pytest.param(lambda store: store.prune(before=T0), 60_000, "DELETE", id="prune"),
])
def test_the_replay_and_the_prune_set_their_own_statement_bound_first(monkeypatch, call, bound, verb):
    """The install's 24 h replay and the hourly prune are long by nature; the engine's 2 s is
    for the appends on the loop, and a bound for a stalled server must not cut them."""
    store, engine = _recorded_samples(monkeypatch)
    call(store)
    ((first, second),) = engine.transactions                 # one transaction, two statements
    assert first == f"SET LOCAL statement_timeout = {bound}"
    assert second.startswith(verb)


def test_the_appends_keep_the_engines_bound(monkeypatch):
    store, engine = _recorded_samples(monkeypatch)
    store.append_many([Sample(hospital="h1", patient_id="bed-1", bed_id="b-1", source="10.0.0.5",
                              code="heart_rate", via="hr", value=72.0, unit="bpm", captured_at=T0,
                              received_at=T0)])
    ((only,),) = engine.transactions
    assert only.startswith("INSERT INTO monitor_samples")


def _recorded_audit(monkeypatch):
    engine = _RecordingEngine()
    monkeypatch.setattr(audit_postgres, "create_engine", lambda url, **kwargs: engine)
    return PostgresAuditLog("postgresql://u:p@db/test_bounds"), engine


def test_the_audits_reads_set_their_own_statement_bound_first(monkeypatch):
    """GET /audit, /audit/verify (AUDIT_VERIFY_PAGE rows a read), the alarm-quality report and a
    restart's replay all read through `records`: 30 s, where the appends keep the engine's 10 s."""
    log, engine = _recorded_audit(monkeypatch)
    log.records(tenant="h1", limit=50_000)
    ((first, second),) = engine.transactions
    assert first == "SET LOCAL statement_timeout = 30000"
    assert second.startswith("SELECT id, ts, tenant")


def test_an_audit_append_keeps_the_engines_bound(monkeypatch):
    log, engine = _recorded_audit(monkeypatch)
    log.append(AuditEvent(tenant="h1", event_type="alert", patient_id="bed-1", subject="news2",
                          payload={}))
    ((head, insert),) = engine.transactions
    assert head.startswith("SELECT hash FROM audit") and insert.startswith("INSERT INTO audit")


@pytest.mark.parametrize("bad", [0, -1, 2.5, True, "30000"])
def test_a_transaction_bound_that_bounds_nothing_is_refused_before_it_is_sent(bad):
    statements: list[str] = []
    with pytest.raises(ValueError):
        set_local_statement_timeout(_Transaction(statements), bad)
    assert statements == []


class _Releasing:
    """Records its release under its name; raises from it when told to — a pool that would not
    close."""

    def _release(self, name: str) -> None:
        self.calls.append(name)
        if self.fail:
            raise RuntimeError(f"the {name} pool would not close")


class _Audit(_Releasing, InMemoryAuditLog):
    def __init__(self, calls, fail):
        super().__init__()
        self.calls, self.fail = calls, fail

    def dispose(self) -> None:                           # PostgresAuditLog's
        self._release("audit")


class _Identities(_Releasing, InMemoryIdentityStore):
    def __init__(self, calls, fail):
        super().__init__()
        self.calls, self.fail = calls, fail

    def close(self) -> None:                             # PostgresIdentityStore's
        self._release("identities")


class _Samples(_Releasing, InMemorySamples):
    def __init__(self, calls, fail):
        super().__init__()
        self.calls, self.fail = calls, fail

    def dispose(self) -> None:                           # PostgresSamples'
        self._release("samples")


class _DeviceBeds(_Releasing, TableFile):
    def __init__(self, calls, fail):
        super().__init__("no-such-table.json", clock=time.monotonic)
        self.calls, self.fail = calls, fail

    def dispose(self) -> None:                           # PostgresDeviceBeds'
        self._release("device_beds")


def _app_with_stores(failing: str | None = None):
    calls: list[str] = []
    app = create_app({"tok-1": "h1"}, run_escalation_loop=False,
                     audit=_Audit(calls, failing == "audit"),
                     identities=_Identities(calls, failing == "identities"),
                     samples=_Samples(calls, failing == "samples"),
                     device_beds=_DeviceBeds(calls, failing == "device_beds"))
    return app, calls


def test_leaving_the_app_releases_each_store_once():
    """D4: the pools go back at shutdown, not at the server's idle timeout."""
    app, calls = _app_with_stores()
    with TestClient(app):
        assert calls == []                               # nothing is released while it serves
    assert sorted(calls) == ["audit", "device_beds", "identities", "samples"]


@pytest.mark.parametrize("failing", ["audit", "identities", "samples", "device_beds"])
def test_a_store_that_fails_to_release_is_logged_and_keeps_no_other_open(failing, caplog):
    app, calls = _app_with_stores(failing)
    with caplog.at_level(logging.ERROR, logger="homunculus.api.app"):
        with TestClient(app):
            pass                                         # leaving does not raise
    assert sorted(calls) == ["audit", "device_beds", "identities", "samples"]
    (logged,) = [r for r in caplog.records if r.exc_info is not None]
    assert logged.levelname == "ERROR" and failing in logged.getMessage()
