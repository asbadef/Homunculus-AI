"""The board's identity block: present when the HIS told us, null when it did not.

Synthetic names.
"""
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)
RECORD = IdentityRecord(patient_id="20239121", family="YILMAZ", given="AYSE", unit="YB",
                        room="304", bed="2", source="comed", updated_at=WHEN)


def engine_with_a_reading() -> Engine:
    engine = Engine()
    engine.ingest(Observation("20239121", SignalCode.SPO2, 97.0, "%", WHEN, "nce"), now=WHEN)
    return engine


def test_a_card_without_an_identity_keeps_todays_shape():
    board = patient_board(engine_with_a_reading(), "20239121", AckStore())
    assert board["identity"] is None
    assert board["latest"]["spo2"] == 97.0


def test_a_card_with_an_identity_carries_name_bed_state_and_source():
    board = patient_board(engine_with_a_reading(), "20239121", AckStore(), identity=RECORD)
    assert board["identity"] == {
        "patient_id": "20239121",
        "display_name": "AYSE YILMAZ",
        "bed_label": "YB 304-2",
        "state": "admitted",
        "source": "comed",
        "updated_at": WHEN.isoformat(),
    }


def test_an_admitted_patient_with_no_reading_still_gets_a_card():
    board = identity_only_board(RECORD)
    assert board["patient_id"] == "20239121"
    assert board["risk"] == "none" and board["alerts"] == []
    assert board["identity"]["display_name"] == "AYSE YILMAZ"
    assert set(board["latest"]) == {"heart_rate", "map", "spo2", "temperature", "resp_rate",
                                    "lactate", "sofa"}
    assert all(v is None for v in board["latest"].values())


def test_the_snapshot_unions_measured_patients_and_admitted_ones():
    identities = InMemoryIdentityStore()
    identities.apply("h1", RECORD)
    identities.apply("h1", IdentityRecord(patient_id="99999", given="BORIS", family="X",
                                          source="comed", updated_at=WHEN))
    snapshot = board_snapshot(engine_with_a_reading(), AckStore(),
                              identities=identities, hospital="h1")
    ids = [entry["patient_id"] for entry in snapshot]
    assert ids == ["20239121", "99999"]
    assert snapshot[0]["latest"]["spo2"] == 97.0        # measured
    assert snapshot[1]["latest"]["spo2"] is None        # admitted only


def test_the_snapshot_without_a_store_is_unchanged():
    snapshot = board_snapshot(engine_with_a_reading(), AckStore())
    assert [e["patient_id"] for e in snapshot] == ["20239121"]
    assert snapshot[0]["identity"] is None
