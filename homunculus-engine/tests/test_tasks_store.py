# homunculus-engine/tests/test_tasks_store.py
"""G3-02 (spec D6, D10): the hand-task rows and the tenant's settings, in the in-memory store the
DB-less suite and the tests use. The Postgres store answers the same protocol (test_tasks_postgres.py)."""
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.tasks import DEFAULT_SETTINGS, InMemoryTaskStore, TaskNotOpen, TaskRow, TaskSettings, new_task

T0 = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


def _row(**over) -> TaskRow:
    base = new_task(tenant="h1", patient_id="S-001", title="Pansuman", due_at=T0 + timedelta(hours=1),
                    target_role="nurse", created_by="hem.ayse", now=T0)
    return base if not over else TaskRow(**{**base.__dict__, **over})


def test_create_get_and_list_in_a_window():
    store = InMemoryTaskStore()
    saved = store.create(_row())
    assert saved.id and saved.state == "open" and saved.created_at == T0
    assert store.get("h1", saved.id) == saved
    assert store.get("h2", saved.id) is None                       # another tenant never sees it
    assert store.list("h1", since=T0, until=T0 + timedelta(hours=2), patient_ids={"S-001"}) == [saved]
    assert store.list("h1", since=T0 + timedelta(hours=2), until=T0 + timedelta(hours=3), patient_ids={"S-001"}) == []
    assert store.list("h1", since=T0, until=T0 + timedelta(hours=2), patient_ids={"S-002"}) == []


def test_update_replaces_the_row():
    store = InMemoryTaskStore()
    saved = store.create(_row())
    closed = store.update(TaskRow(**{**saved.__dict__, "state": "done", "closed_by": "hem.ayse", "closed_at": T0}))
    assert store.get("h1", saved.id) == closed and closed.state == "done"


def test_settings_default_until_saved():
    store = InMemoryTaskStore()
    assert store.settings("h1") is None
    saved = store.save_settings("h1", TaskSettings(8, 20, 45, {**DEFAULT_SETTINGS.intervals, "b1_4": 360}), by="admin", now=T0)
    assert saved.grace_min == 45 and saved.intervals["b1_4"] == 360 and saved.updated_by == "admin" and saved.updated_at == T0
    assert store.settings("h1") == saved and store.settings("h2") is None


def test_admitted_at_and_zone_are_what_the_test_set():
    store = InMemoryTaskStore(zones={"h1": "Asia/Baku"}, admitted={("h1", "S-001"): T0})
    assert store.admitted_at("h1", "S-001") == T0 and store.admitted_at("h1", "S-009") is None
    assert store.timezone("h1") == "Asia/Baku" and store.timezone("h2") == "UTC"


def test_only_an_open_row_changes():
    store = InMemoryTaskStore()
    saved = store.create(_row())
    closed = store.update(TaskRow(**{**saved.__dict__, "state": "done", "closed_by": "hem.ayse", "closed_at": T0}))
    with pytest.raises(TaskNotOpen):                                   # a second nurse's close, read before the first
        store.update(TaskRow(**{**saved.__dict__, "state": "skipped", "closed_by": "hem.zeynep", "closed_at": T0,
                                "skip_reason": "ameliyatta"}))
    assert store.get("h1", saved.id) == closed
    with pytest.raises(KeyError):
        store.update(_row())                                           # a row the store never had
