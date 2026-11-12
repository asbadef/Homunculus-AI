# homunculus-engine/tests/test_admission_keys.py
"""G3-05 (spec D8): one SQL fragment ties a card key to its open admission — the rule of admission/boardkey.py,
`protocol_no`, else (an admission from before 0015) the patient's H-number — and both stores that need it read
it from one place. No database: the fragment is text, and what it must say is checked as text."""
from __future__ import annotations

from homunculus.admission.models import OPEN_ADMISSION_STATES
from homunculus.api import admission_keys, readings_postgres, tasks_postgres


def test_the_open_states_are_the_models():
    named = {part.strip("'") for part in admission_keys.OPEN_STATES.strip("()").split(",")}
    assert named == {state.value for state in OPEN_ADMISSION_STATES}
    assert "DRAFT" in named                      # a draft has a card from POST /admissions: a valid target (D8)


def test_the_key_is_the_protocol_or_a_legacy_admissions_h_number():
    sql = admission_keys.OPEN_ADMISSION_OF_KEY
    assert "a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key)" in sql
    assert "t.slug = :tenant" in sql and admission_keys.OPEN_STATES in sql
    assert admission_keys.NEWEST_FIRST.strip() == "ORDER BY a.admission_datetime DESC LIMIT 1"


def test_both_stores_read_the_one_fragment():
    assert not hasattr(tasks_postgres, "_OPEN_STATES")            # the copy is gone
    # The task store's open row is the fragment's; G2-B1b (X18) then walks back along the stay's moves.
    assert tasks_postgres.ADMITTED_AT == ("WITH RECURSIVE open_row AS (SELECT a.id " + admission_keys.OPEN_ADMISSION_OF_KEY
                                          + admission_keys.NEWEST_FIRST + "), " + tasks_postgres.STAY_WALK_BACK)
    assert readings_postgres.ADMISSION_OF == ("SELECT CAST(a.id AS text) " + admission_keys.OPEN_ADMISSION_OF_KEY
                                              + admission_keys.NEWEST_FIRST)
    assert readings_postgres.OPEN_ADMISSIONS == admission_keys.OPEN_ADMISSIONS
    assert admission_keys.OPEN_ADMISSIONS.startswith(
        "SELECT COALESCE(a.protocol_no, p.patient_number), a.admission_datetime ")
    assert not hasattr(admission_keys, "OPEN_STAYS")            # renamed: it dates the ROW, a moved one at the move


def test_the_readings_store_walks_a_stay_back_with_the_task_stores_own_statement():
    """G3-05 final review (I-1, minor 6): a stay's start is the task store's walk (G2-B1b X18) — the readings store
    imports that statement, it keeps no copy of it."""
    assert readings_postgres.ADMITTED_AT is tasks_postgres.ADMITTED_AT
    assert readings_postgres.MOST_MOVES is tasks_postgres.MOST_MOVES
    assert "WITH RECURSIVE" not in open(readings_postgres.__file__, encoding="utf-8").read()


def test_the_admissions_come_oldest_first_so_a_shared_key_keeps_the_newest():
    """Two open legacy admissions of one patient share the H-number as their key: `open_admissions` builds a dict
    from these rows, the last write wins, so the order must end with the newest start (and `admission_of` takes
    the newest too: NEWEST_FIRST)."""
    sql = admission_keys.OPEN_ADMISSIONS
    assert sql.endswith(" ORDER BY a.admission_datetime") and "DESC" not in sql
    assert admission_keys.OPEN_STATES in sql and "t.slug = :tenant" in sql
