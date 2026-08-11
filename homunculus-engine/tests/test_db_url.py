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
