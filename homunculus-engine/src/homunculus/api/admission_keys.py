# homunculus-engine/src/homunculus/api/admission_keys.py
"""The SQL that ties a card key to its open admission (G3-05, spec D8) — admission/boardkey.py's rule, as the
api world's stores read it: an admission made since migration 0015 is keyed by its protocol number, one from
before it by the patient's H-number. Text fragments for `text()` SQL on a sync engine, bound with `:tenant` (the
hospital slug) and `:key`. Two readers: the task queue's admission time (api/tasks_postgres.py) and the readings
store's admission id (api/readings_postgres.py). A DRAFT is open: its card exists from POST /admissions."""
from __future__ import annotations

#: admission/models.py OPEN_ADMISSION_STATES, as the enum's values (tests/test_admission_keys.py holds them equal).
OPEN_STATES = "('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER')"
_JOINS = ("FROM admissions a JOIN patients p ON p.id = a.patient_id JOIN tenants t ON t.id = a.tenant_id "
          "WHERE t.slug = :tenant AND CAST(a.state AS text) IN " + OPEN_STATES)
#: `SELECT <columns of a> ` + this + NEWEST_FIRST: the open admission whose card key is `:key`.
OPEN_ADMISSION_OF_KEY = (_JOINS + " AND (a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key))")
NEWEST_FIRST = " ORDER BY a.admission_datetime DESC LIMIT 1"
#: The card key of every open admission of `:tenant`, with the time the stay began. Oldest first: two open legacy
#: admissions of one patient share a key (its H-number), and a dict built from these rows — the last write wins —
#: keeps the NEWEST start, as `NEWEST_FIRST` makes `admission_of` answer the newest stay.
OPEN_STAYS = ("SELECT COALESCE(a.protocol_no, p.patient_number), a.admission_datetime " + _JOINS
              + " ORDER BY a.admission_datetime")
