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
    assert tasks_postgres.ADMITTED_AT == ("SELECT a.admission_datetime " + admission_keys.OPEN_ADMISSION_OF_KEY
                                          + admission_keys.NEWEST_FIRST)
    assert readings_postgres.ADMISSION_OF == ("SELECT CAST(a.id AS text) " + admission_keys.OPEN_ADMISSION_OF_KEY
                                              + admission_keys.NEWEST_FIRST)
    assert readings_postgres.OPEN_STAYS == admission_keys.OPEN_STAYS
    assert admission_keys.OPEN_STAYS.startswith("SELECT COALESCE(a.protocol_no, p.patient_number), a.admission_datetime ")


def test_the_stays_come_oldest_first_so_a_shared_key_keeps_the_newest():
    """Two open legacy admissions of one patient share the H-number as their key: `open_stays` builds a dict
    from these rows, the last write wins, so the order must end with the newest start (and `admission_of` takes
    the newest too: NEWEST_FIRST)."""
    sql = admission_keys.OPEN_STAYS
    assert sql.endswith(" ORDER BY a.admission_datetime") and "DESC" not in sql
    assert admission_keys.OPEN_STATES in sql and "t.slug = :tenant" in sql
