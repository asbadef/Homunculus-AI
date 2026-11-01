"""Time bounds on the API's sync Postgres engines (spec 2026-11-01-pg-sinirlari-design.md).

The audit, the identity store and the monitor samples reach Postgres through a sync driver from the
event loop: a database that accepts a connection and then says nothing would hold every request of
the API, and the ward's screens with it, until the operating system's TCP timeout. None of these
tests needs a database."""
from __future__ import annotations

import socket
import threading
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import OperationalError

from homunculus.api import audit_postgres, monitor_samples, patient_identity_postgres
from homunculus.api.audit import AuditEvent
from homunculus.api.audit_postgres import PostgresAuditLog, bounded_connect_args
from homunculus.api.monitor_samples import PostgresSamples, Sample
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
