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

    @pytest.fixture()
    def admitted_store(self):
        """What the admissions table would say, told to the store: the stay's kabul (`admitted_at`) and the move
        that opened its open row (`moved_at`)."""
        def make(stays):
            ids = {key: f"{i + 1:08d}-1111-4111-8111-111111111111" for i, key in enumerate(stays)}
            return InMemoryReadingStore(admitted={("h1", key): ids[key] for key in stays},
                                        admitted_at={("h1", key): began for key, (began, _) in stays.items()},
                                        moved_at={("h1", key): moved for key, (_, moved) in stays.items() if moved},
                                        ), ids
        return make


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
    assert store.open_stays("h1") == {KEY: start} == store.open_admissions("h1")
    assert store.stay_start("h1", KEY) == start


def test_a_stay_the_test_gave_no_time_began_at_epoch():
    store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
    assert store.stay_start("h1", KEY) == EPOCH and store.open_admissions("h1") == {KEY: EPOCH}


def test_close_is_harmless():
    assert InMemoryReadingStore().close() is None
