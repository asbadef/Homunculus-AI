"""
DATABASE_URL normalisation.

Supabase (and every other managed Postgres UI) hands you a `postgresql://…` URL. The app needs an
async driver and Alembic-in-async needs the same, while the audit needs the sync one. Making the
operator remember to rewrite the scheme is a foot-gun that fails at deploy time with an error that
does not name the cause — so the code accepts whatever form is pasted and derives both.
"""
from __future__ import annotations

import pytest

from homunculus.api.audit_postgres import to_sync_url
from homunculus.db import to_async_url

SUPABASE = "postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"


@pytest.mark.parametrize("given", [
    f"postgresql://{SUPABASE}",           # what the Supabase dashboard shows
    f"postgresql+psycopg2://{SUPABASE}",  # the sync driver spelled out
    f"postgresql+asyncpg://{SUPABASE}",   # already correct
    f"postgres://{SUPABASE}",             # the legacy scheme some tools still emit
])
def test_every_pasted_form_becomes_the_async_driver(given):
    assert to_async_url(given) == f"postgresql+asyncpg://{SUPABASE}"


@pytest.mark.parametrize("given", [
    f"postgresql://{SUPABASE}",
    f"postgresql+asyncpg://{SUPABASE}",
    f"postgres://{SUPABASE}",
])
def test_every_pasted_form_becomes_the_sync_driver_for_the_audit(given):
    assert to_sync_url(given) == f"postgresql+psycopg2://{SUPABASE}"


def test_non_postgres_urls_are_left_alone():
    """SQLite is used in tests and local runs; normalisation must not touch it."""
    assert to_async_url("sqlite:///local.db") == "sqlite:///local.db"
    assert to_sync_url("sqlite:///local.db") == "sqlite:///local.db"


def test_credentials_and_query_parameters_survive():
    url = f"postgresql://{SUPABASE}?application_name=homunculus"
    assert to_async_url(url) == f"postgresql+asyncpg://{SUPABASE}?application_name=homunculus"


def test_warns_about_the_ipv6_only_direct_host():
    """The failure it prevents is a bare "Network is unreachable" that names no cause."""
    from homunculus.db import warn_if_ipv6_only_host

    direct = "postgresql+asyncpg://postgres:pw@db.abc.supabase.co:5432/postgres"
    hint = warn_if_ipv6_only_host(direct)
    assert hint and "Session pooler" in hint

    pooler = f"postgresql+asyncpg://{SUPABASE}"
    assert warn_if_ipv6_only_host(pooler) is None
    assert warn_if_ipv6_only_host("postgresql+asyncpg://u:p@localhost:5432/x") is None


def test_tls_is_off_without_the_env_var():
    from homunculus.db import ssl_context
    import os
    os.environ.pop("DATABASE_SSL", None)
    assert ssl_context() is None


def test_tls_is_encrypted_but_unverified_without_a_ca(monkeypatch):
    """The Supabase pooler's chain is not in the system trust store, so ssl=True fails there.
    Encryption stays on; verification is what is traded away until a CA bundle is configured."""
    import ssl as _ssl
    from homunculus.db import ssl_context
    monkeypatch.setenv("DATABASE_SSL", "require")
    monkeypatch.delenv("DATABASE_CA_CERT", raising=False)

    ctx = ssl_context()
    assert ctx is not None
    assert ctx.verify_mode == _ssl.CERT_NONE
    assert ctx.check_hostname is False


def test_a_ca_bundle_turns_verification_back_on(monkeypatch, tmp_path):
    import ssl as _ssl
    from homunculus.db import ssl_context
    ca = tmp_path / "ca.pem"
    ca.write_bytes(_ssl.get_default_verify_paths().cafile and open(_ssl.get_default_verify_paths().cafile, "rb").read() or b"")
    if not ca.stat().st_size:
        import pytest as _pytest
        _pytest.skip("no system CA bundle available to reuse in this environment")
    monkeypatch.setenv("DATABASE_SSL", "require")
    monkeypatch.setenv("DATABASE_CA_CERT", str(ca))

    ctx = ssl_context()
    assert ctx.verify_mode == _ssl.CERT_REQUIRED
