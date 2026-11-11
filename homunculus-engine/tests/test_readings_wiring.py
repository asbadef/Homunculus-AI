# homunculus-engine/tests/test_readings_wiring.py
"""G3-05: how the production entry and `create_app` are handed the readings store (spec §3) and — from Task B5 —
the policy for a number nobody is admitted under (D9). No database: a Postgres store is built, never connected."""
from __future__ import annotations

from homunculus.api import prodserver
from homunculus.api.readings import InMemoryReadingStore
from homunculus.api.readings_postgres import PostgresReadingStore


def test_the_store_is_postgres_in_production_and_memory_elsewhere():
    assert isinstance(prodserver._readings(""), InMemoryReadingStore)
    assert isinstance(prodserver._readings("sqlite:///x.db"), InMemoryReadingStore)
    store = prodserver._readings("postgresql+asyncpg://u:p@db.invalid:5432/homunculus")
    try:
        assert isinstance(store, PostgresReadingStore) and store.durable is True
    finally:
        store.close()
