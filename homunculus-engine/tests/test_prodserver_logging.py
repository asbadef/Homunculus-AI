"""The production entry's log: the engine's own INFO lines reach the container log, once each.

uvicorn configures only its `uvicorn.*` loggers. Without a handler of its own, a `homunculus.*`
record went to Python's last-resort handler — WARNING and up only — so the start-up bind's
"LDAP: service-account bind to … succeeded" (INFO), the line the runbook told the operator to
look for, never appeared, and a working directory looked like one LDAP_URL never reached."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import textwrap
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"


def test_under_uvicorns_logging_the_engines_info_lines_reach_the_log_once(tmp_path):
    """As the container runs it: uvicorn configures its logging, then imports the app. A
    development start (no DATABASE_URL), every file it writes in a temporary directory."""
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
    env = {name: value for name, value in os.environ.items()
           if not name.startswith(("LDAP_", "DATABASE_URL", "TENANTS"))}
    env.update(PYTHONPATH=str(SRC), AUDIT_DB_PATH=str(tmp_path / "audit.db"),
               IDENTITY_DB_PATH=str(tmp_path / "identity.db"))
    done = subprocess.run([sys.executable, "-c", script], cwd=tmp_path, env=env,
                          capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    log = done.stderr
    assert log.count("LDAP: service-account bind to dc1.hastane.test succeeded") == 1, log
    assert log.count("a warning line") == 1, log
    assert "a debug line" not in log
    assert "INFO homunculus.auth.ldap: LDAP: service-account bind" in log


def test_the_handler_is_added_once_and_the_records_still_propagate():
    """Calling it again (a second import path, a test) adds nothing; propagation is left on, so
    a test's log capture — on the root logger — still sees the engine's records."""
    from homunculus.api import prodserver

    engine = logging.getLogger("homunculus")
    first = prodserver.configure_logging()
    assert prodserver.configure_logging() is first
    assert engine.handlers.count(first) == 1
    assert engine.getEffectiveLevel() == logging.INFO and engine.propagate is True
