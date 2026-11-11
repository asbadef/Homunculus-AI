# homunculus-engine/tests/test_readings_store.py
"""G3-05: the in-memory ReadingStore — the contract every store passes (tests/readings_contract.py), and what
only this one has: the admissions a test tells it about."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.api.readings import EPOCH, InMemoryReadingStore
from tests.readings_contract import KEY, ReadingStoreContract

ADMISSION = "11111111-1111-4111-8111-111111111111"       # a synthetic admission id


class TestInMemoryReadingStore(ReadingStoreContract):
    @pytest.fixture()
    def store(self):
        return InMemoryReadingStore()


def test_the_memory_store_is_not_durable():
    """`create_app` starts the hourly reconcile for a durable store only (spec D7)."""
    assert InMemoryReadingStore().durable is False


def test_the_admission_of_a_key_is_what_the_test_said():
    store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
    assert store.admission_of("h1", KEY) == ADMISSION
    assert store.admission_of("h1", "202600000002") is None
    assert store.admission_of("h2", KEY) is None
    assert store.open_stays("h1") == {KEY: EPOCH} and store.open_stays("h2") == {}


def test_the_start_of_an_open_stay_is_what_the_test_said():
    start = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)
    store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION}, admitted_at={("h1", KEY): start})
    assert store.open_stays("h1") == {KEY: start}


def test_close_is_harmless():
    assert InMemoryReadingStore().close() is None
