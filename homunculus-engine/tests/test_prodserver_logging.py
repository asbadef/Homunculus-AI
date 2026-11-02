"""The production entry's log: the engine's own INFO lines reach the container log, once each,
and the live waveform panel's poll leaves no uvicorn access line.

uvicorn configures only its `uvicorn.*` loggers. Without a handler of its own, a `homunculus.*`
record went to Python's last-resort handler — WARNING and up only — so the start-up bind's
"LDAP: service-account bind to … succeeded" (INFO), the line the runbook told the operator to
look for, never appeared, and a working directory looked like one LDAP_URL never reached.

The waves poll (`GET /infinity-waves/<monitor address>?since=…`) comes about 1.33 times a second
from every open panel: one access line each would put ~115,000 lines a day into the API
container's unrotated log. nginx already drops it; `WavesPollAccessFilter` drops uvicorn's."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from homunculus.api import prodserver

SRC = Path(__file__).resolve().parents[1] / "src"


def _under_uvicorns_logging(script: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    """Run `script` in a fresh interpreter as a development start (no DATABASE_URL), every file
    it writes in a temporary directory."""
    env = {name: value for name, value in os.environ.items()
           if not name.startswith(("LDAP_", "DATABASE_URL", "TENANTS"))}
    env.update(PYTHONPATH=str(SRC), AUDIT_DB_PATH=str(tmp_path / "audit.db"),
               IDENTITY_DB_PATH=str(tmp_path / "identity.db"))
    return subprocess.run([sys.executable, "-c", script], cwd=tmp_path, env=env,
                          capture_output=True, text=True, timeout=120)


def test_under_uvicorns_logging_the_engines_info_lines_reach_the_log_once(tmp_path):
    """As the container runs it: uvicorn configures its logging, then imports the app."""
    script = textwrap.dedent("""
        import logging
        import uvicorn

        config = uvicorn.Config("homunculus.api.prodserver:app")   # logging, as uvicorn sets it
        config.load()                                              # then the app is imported
        log = logging.getLogger("homunculus.auth.ldap")
        log.info("LDAP: service-account bind to dc1.hastane.test succeeded")
        log.warning("a warning line")
        log.debug("a debug line")
    """)
    done = _under_uvicorns_logging(script, tmp_path)
    assert done.returncode == 0, done.stderr
    log = done.stderr
    assert log.count("LDAP: service-account bind to dc1.hastane.test succeeded") == 1, log
    assert log.count("a warning line") == 1, log
    assert "a debug line" not in log
    assert "INFO homunculus.auth.ldap: LDAP: service-account bind" in log


def test_the_handler_is_added_once_and_the_records_still_propagate():
    """Calling it again (a second import path, a test) adds nothing; propagation is left on, so
    a test's log capture — on the root logger — still sees the engine's records."""
    engine = logging.getLogger("homunculus")
    first = prodserver.configure_logging()
    assert prodserver.configure_logging() is first
    assert engine.handlers.count(first) == 1
    assert engine.getEffectiveLevel() == logging.INFO and engine.propagate is True


# ---------------------------------------------------------------- the waves poll's access line

# uvicorn's own call (protocols/http/h11_impl.py and httptools_impl.py, uvicorn 0.54.0):
# access_logger.info(ACCESS_FORMAT, client_addr, method, full_path, http_version, status_code)
ACCESS_FORMAT = '%s - "%s %s HTTP/%s" %d'
CLIENT = "172.18.0.5:51234"
WAVES_POLL = "/infinity-waves/192.0.2.21?since=0&started=x"


@pytest.fixture
def access_log():
    """The real `uvicorn.access` logger with no filter and one capturing handler; its filters,
    handlers, level, propagation and disabled flag are put back afterwards."""
    access = logging.getLogger("uvicorn.access")
    filters, handlers = list(access.filters), list(access.handlers)
    level, propagate, disabled = access.level, access.propagate, access.disabled
    captured: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    for existing in filters:
        access.removeFilter(existing)
    for existing in handlers:
        access.removeHandler(existing)
    access.addHandler(Capture())
    access.setLevel(logging.INFO)
    access.propagate = False
    access.disabled = False          # a fileConfig elsewhere in the run may have disabled it
    try:
        yield access, captured
    finally:
        for added in list(access.filters):
            access.removeFilter(added)
        for added in list(access.handlers):
            access.removeHandler(added)
        for existing in filters:
            access.addFilter(existing)
        for existing in handlers:
            access.addHandler(existing)
        access.setLevel(level)
        access.propagate, access.disabled = propagate, disabled


def _access_line(access: logging.Logger, path: str) -> None:
    access.info(ACCESS_FORMAT, CLIENT, "GET", path, "1.1", 200)


def test_the_waves_poll_leaves_no_access_line(access_log):
    access, captured = access_log
    prodserver.configure_logging()
    _access_line(access, WAVES_POLL)
    assert captured == []


@pytest.mark.parametrize("path", ["/infinity-shadow/board", "/infinity-waves-other"])
def test_every_other_access_line_is_kept_as_it_was(access_log, path):
    access, captured = access_log
    prodserver.configure_logging()
    _access_line(access, path)
    assert [r.getMessage() for r in captured] == [f'{CLIENT} - "GET {path} HTTP/1.1" 200']


@pytest.mark.parametrize("msg, args", [
    ("GET /infinity-waves/192.0.2.21", ()),                                   # no args
    ("%s", ("/infinity-waves/192.0.2.21",)),                                  # one arg
    ("%(path)s", ({"path": "/infinity-waves/192.0.2.21"},)),                  # a mapping
    ('%s - "%s %r HTTP/%s" %d', (CLIENT, "GET", b"/infinity-waves/x", "1.1", 200)),  # bytes
    ("%s %s %s %s %s %s", (CLIENT, "GET", "/infinity-waves/x", "1.1", 200, "?")),  # six args
], ids=["no-args", "one-arg", "mapping", "bytes-path", "six-args"])
def test_a_record_not_shaped_like_uvicorns_access_line_is_kept(access_log, msg, args):
    """Not uvicorn's five-tuple with a text path: kept, and the filter does not raise (an
    exception in a logger's filter would reach the request that logged the line)."""
    access, captured = access_log
    prodserver.configure_logging()
    access.info(msg, *args)
    assert len(captured) == 1


def test_configure_logging_puts_one_waves_filter_on_the_access_logger(access_log):
    """On the logger, not on a handler: uvicorn's dictConfig replaces the logger's handlers and
    leaves its filters. Calling again (a second import path, a test) adds no second one."""
    access, _ = access_log
    prodserver.configure_logging()
    prodserver.configure_logging()
    waves = [f for f in access.filters if isinstance(f, prodserver.WavesPollAccessFilter)]
    assert len(waves) == 1


def test_under_uvicorns_logging_the_waves_poll_leaves_no_access_line(tmp_path):
    """As the container runs it: uvicorn configures its logging (the access handler on stdout),
    then imports the app, then logs the requests."""
    script = textwrap.dedent(f"""
        import logging
        import uvicorn

        config = uvicorn.Config("homunculus.api.prodserver:app")
        config.load()
        access = logging.getLogger("uvicorn.access")
        access.info({ACCESS_FORMAT!r}, {CLIENT!r}, "GET", {WAVES_POLL!r}, "1.1", 200)
        access.info({ACCESS_FORMAT!r}, {CLIENT!r}, "GET", "/infinity-shadow/board", "1.1", 200)
    """)
    done = _under_uvicorns_logging(script, tmp_path)
    assert done.returncode == 0, done.stderr
    assert "/infinity-waves/" not in done.stdout + done.stderr
    assert done.stdout.count(f'{CLIENT} - "GET /infinity-shadow/board HTTP/1.1" 200') == 1, \
        done.stdout
