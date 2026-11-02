# homunculus-engine/tests/test_admission_trail.py
"""admission/trail.py (Group 2 · B1a): one audit row, written after the change it describes has
committed. Amendment A-26: a store that fails then is logged at ERROR, never raised, and the log
line carries only the ids an allow-list names, never another field of the payload. No database:
the request is a stand-in carrying the app's audit store. Synthetic values only."""
from __future__ import annotations

import logging
from types import SimpleNamespace

from homunculus.admission import trail


class _StoreDown:
    def append(self, event):
        raise RuntimeError("audit store down")


def _request(audit) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(audit=audit)))


def test_a_failing_store_is_logged_with_the_allow_listed_ids_and_nothing_else(caplog):
    caplog.set_level(logging.ERROR, logger="homunculus.admission.trail")
    trail.record(
        _request(_StoreDown()), "sentetik-hastane", "admission.admit", patient_id="H9900001",
        payload={"kind": "bed", "id": "x-1", "admission_id": "a-1", "bed_id": "b-1",
                 "unit_id": "u-1", "room_id": "r-1", "site_id": "s-1",
                 # Keys no allow-list names: an id that identifies a person, a name, a decision.
                 "national_id": "AZE-SENTETIK-1234567", "display_name": "Sentetik Ad",
                 "disposition": "home", "actor": "nurse@sentetik.example.com"})
    (logged,) = [r for r in caplog.records if r.name == "homunculus.admission.trail"]
    assert logged.levelno == logging.ERROR
    message = logged.getMessage()
    for shown in ("admission.admit", "sentetik-hastane", "H9900001", "kind=bed", "id=x-1",
                  "admission_id=a-1", "bed_id=b-1", "unit_id=u-1", "room_id=r-1", "site_id=s-1",
                  "nurse@sentetik.example.com", "RuntimeError"):
        assert shown in message, (shown, message)
    for hidden in ("national_id", "AZE-SENTETIK", "Sentetik Ad", "disposition", "home",
                   "audit store down"):
        assert hidden not in message, (hidden, message)


def test_an_app_without_an_audit_store_writes_nothing_and_raises_nothing():
    trail.record(_request(None), "sentetik-hastane", "bed.release", payload={"bed_id": "b-1"})
