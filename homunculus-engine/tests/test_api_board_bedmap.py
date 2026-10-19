"""The board says whether the HIS bed a patient is in is a bed we know.

Faz 3's premise is that a patient admitted in the hospital's own system appears here, on that
bed, without anyone typing anything. The join between the two namings is a table someone
writes per site. These tests fix what happens on both sides of that table — and especially on
the side where it has no answer, because a patient the HIS admitted and we quietly dropped
leaves a ward believing a bed is watched when nothing is watching it.
"""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.tenant.bedmap import BedMap

WHEN = datetime(2026, 9, 8, 10, 0, tzinfo=timezone.utc)

KNOWN = IdentityRecord(patient_id="20239121", given="AYSE", family="YILMAZ",
                       unit="YB", room="304", bed="2", source="comed", updated_at=WHEN)
UNKNOWN_BED = IdentityRecord(patient_id="88888", given="MEHMET", family="KAYA",
                             unit="YB", room="999", bed="9", source="comed", updated_at=WHEN)

BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^2": {"bed_id": "bed-a1", "unit_id": "unit-adult", "label": "Oda 304 · Yatak 2"},
}})


def _engine(patient_id: str) -> Engine:
    engine = Engine()
    engine.ingest(Observation(patient_id=patient_id, code=SignalCode.SPO2, value=97.0,
                              unit="%", timestamp=WHEN, source_device="nce"), WHEN)
    return engine


class TestAMatchedBed:
    def test_the_card_names_the_bed_we_know(self):
        board = patient_board(_engine("20239121"), "20239121", AckStore(),
                              identity=KNOWN, bedmap=BEDMAP)
        assert board["identity"]["bed_matched"] is True
        assert board["identity"]["bed_id"] == "bed-a1"

    def test_the_his_bed_text_still_travels(self):
        """Our label and the hospital's are both useful; the HIS one is what the nurse sees on
        the ward whiteboard."""
        board = patient_board(_engine("20239121"), "20239121", AckStore(),
                              identity=KNOWN, bedmap=BEDMAP)
        assert board["identity"]["bed_label"] == "YB 304-2"


class TestAnUnmatchedBed:
    def test_the_patient_still_gets_a_card(self):
        board = patient_board(_engine("88888"), "88888", AckStore(),
                              identity=UNKNOWN_BED, bedmap=BEDMAP)
        assert board["patient_id"] == "88888"
        assert board["identity"]["display_name"] == "MEHMET KAYA"

    def test_the_card_says_it_is_unmatched_rather_than_guessing(self):
        board = patient_board(_engine("88888"), "88888", AckStore(),
                              identity=UNKNOWN_BED, bedmap=BEDMAP)
        assert board["identity"]["bed_matched"] is False
        assert board["identity"]["bed_id"] is None

    def test_the_card_carries_the_key_an_operator_must_add(self):
        """This is what turns "not on a bed" into a fixable instruction."""
        board = patient_board(_engine("88888"), "88888", AckStore(),
                              identity=UNKNOWN_BED, bedmap=BEDMAP)
        assert board["identity"]["bed_key"] == "YB^999^9"

    def test_the_miss_is_counted_for_the_discovery_report(self):
        bedmap = BedMap.from_dict({"beds": {}})
        patient_board(_engine("88888"), "88888", AckStore(), identity=UNKNOWN_BED, bedmap=bedmap)
        assert bedmap.unmatched() == {"YB^999^9": 1}


class TestNoTableAtAll:
    def test_a_site_that_has_not_written_its_table_still_shows_every_patient(self):
        """An unwritten table and an unknown bed are the same situation from the ward's point
        of view, and neither may cost a patient their card."""
        board = patient_board(_engine("20239121"), "20239121", AckStore(), identity=KNOWN)
        assert board["identity"]["bed_matched"] is False
        assert board["identity"]["bed_key"] == "YB^304^2"

    def test_a_card_with_no_identity_at_all_reports_no_bed_and_no_key(self):
        board = patient_board(_engine("bed-7"), "bed-7", AckStore())
        assert board["identity"] is None


class TestTheWholeSnapshot:
    def test_measured_and_admitted_patients_both_carry_the_resolution(self):
        identities = InMemoryIdentityStore()
        identities.apply("h1", KNOWN)
        identities.apply("h1", UNKNOWN_BED)   # admitted, never measured

        boards = board_snapshot(_engine("20239121"), AckStore(),
                                identities=identities, hospital="h1", bedmap=BEDMAP)
        by_id = {b["patient_id"]: b for b in boards}

        assert by_id["20239121"]["identity"]["bed_matched"] is True
        assert by_id["88888"]["identity"]["bed_matched"] is False
        assert by_id["88888"]["identity"]["bed_key"] == "YB^999^9"

    def test_an_identity_only_card_resolves_too(self):
        card = identity_only_board(KNOWN, BEDMAP)
        assert card["identity"]["bed_id"] == "bed-a1"
        assert card["latest"]["news2"] is None   # nothing measured yet, and it says so


class TestALookupThatCountsNothing:
    """Aşama A's monitor strip asks the bed map which bed an admitted patient is in every few
    seconds. The discovery counter is the board's statement of where its patients arrived from;
    a reader that is not the board must not inflate it."""

    def test_lookup_finds_what_resolve_finds(self):
        bedmap = BedMap.from_dict({"beds": {"YB^304^2": {"bed_id": "bed-a1", "unit_id": "unit-adult"}}})
        assert bedmap.lookup("yb", " 304 ", "2") == bedmap.resolve("YB", "304", "2").ref
        assert bedmap.lookup("YB", "999", "9") is None

    def test_lookup_never_changes_the_discovery_counter(self):
        bedmap = BedMap.from_dict({"beds": {"YB^304^2": {"bed_id": "bed-a1"}}})
        bedmap.resolve("YB", "999", "9")
        before = bedmap.unmatched()
        for _ in range(50):
            bedmap.lookup("YB", "999", "9")
            bedmap.lookup("YB", "304", "2")
            bedmap.lookup("", "", "")
        assert bedmap.unmatched() == before == {"YB^999^9": 1}
        assert bedmap.discovery_report() == "Eşlenmemiş yataklar: YB^999^9 (1)"
