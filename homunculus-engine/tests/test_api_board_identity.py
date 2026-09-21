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
        # No bed table was passed, so the HIS location resolves to nothing — and says which
        # key an operator would have to add. The card is still produced: a patient is never
        # withheld for want of a bed match.
        "bed_id": None,
        # The unit that bed belongs to, for the same reason and with the same caveat: it comes
        # from the bed table, so with no table there is nothing to say. It is what a unit-level
        # scope grant matches against, and until the board published it no filter could see it.
        "unit_id": None,
        "bed_matched": False,
        "bed_key": "YB^304^2",
        # This record was built by hand and carried no DG1, so the list is empty — which means
        # "the message did not say", not "this patient has no diagnoses".
        "diagnoses": [],
        # Carried so the admission form does not ask a clinician to retype what the HIS sent.
        # This fixture's message carried neither, and both come through as "not told" rather
        # than as a guess.
        "birth_date": "",
        "sex": "unknown",
    }


def test_an_admitted_patient_with_no_reading_still_gets_a_card():
    board = identity_only_board(RECORD)
    assert board["patient_id"] == "20239121"
    assert board["risk"] == "none" and board["alerts"] == []
    assert board["identity"]["display_name"] == "AYSE YILMAZ"
    assert set(board["latest"]) == {"heart_rate", "map", "sbp", "spo2", "temperature",
                                    "resp_rate", "lactate", "sofa", "news2", "at"}
    # All null, news2 included: this card has never had an observation, and a NEWS2 of 0 would
    # read as "measured and normal" rather than "nothing has been measured".
    assert all(v is None for key, v in board["latest"].items() if key != "at")
    # `at` keeps its shape so a consumer never branches — every channel present, every one null.
    assert all(v is None for v in board["latest"]["at"].values())


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
