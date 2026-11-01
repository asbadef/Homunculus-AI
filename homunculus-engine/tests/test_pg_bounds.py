"""Time bounds on the API's sync Postgres engines (spec 2026-11-01-pg-sinirlari-design.md).

The audit, the identity store and the monitor samples reach Postgres through a sync driver from the
event loop: a database that accepts a connection and then says nothing would hold every request of
the API, and the ward's screens with it, until the operating system's TCP timeout. None of these
tests needs a database."""
from __future__ import annotations

import pytest

from homunculus.api.audit_postgres import bounded_connect_args


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
