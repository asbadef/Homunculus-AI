"""The HIS location → our bed table, and what it does when it cannot answer.

The behaviour under test is mostly about the miss, not the hit: a location this table does not
cover must survive, be counted, and be nameable in a report — because a patient the HIS
admitted and we silently dropped leaves a ward believing a bed is watched when nothing is.
"""
from __future__ import annotations

import json

import pytest

from homunculus.tenant.bedmap import BedMap, BedRef, normalise_key

TABLE = {
    "beds": {
        "YB^304^2": {"bed_id": "bed-a1", "unit_id": "unit-adult", "label": "Oda 304 · Yatak 2"},
        "YB^304^1": {"bed_id": "bed-a2", "unit_id": "unit-adult", "label": "Oda 304 · Yatak 1"},
        "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu", "label": "Yenidoğan 12-A"},
    }
}


def _map() -> BedMap:
    return BedMap.from_dict(TABLE)


class TestNormalisation:
    def test_case_and_padding_do_not_decide_whether_a_bed_is_found(self):
        assert normalise_key(" yb ", "304", "2") == "YB^304^2"

    def test_empty_components_are_kept_as_slots(self):
        """`YB^^2` and `YB^2^` are different locations; collapsing them would put a patient in
        the wrong bed."""
        assert normalise_key("YB", "", "2") != normalise_key("YB", "2", "")

    def test_a_table_written_in_lower_case_still_matches_upper_case_traffic(self):
        m = BedMap.from_dict({"beds": {"yb^304^2": "bed-a1"}})
        assert m.resolve("YB", "304", "2").ref == BedRef(bed_id="bed-a1")


class TestResolution:
    def test_a_known_location_resolves_to_our_bed(self):
        r = _map().resolve("YB", "304", "2")
        assert r.matched is True
        assert r.ref.bed_id == "bed-a1"
        assert r.ref.unit_id == "unit-adult"
        assert r.ref.label == "Oda 304 · Yatak 2"

    def test_an_unknown_location_resolves_to_nothing_but_does_not_raise(self):
        r = _map().resolve("YB", "999", "9")
        assert r.matched is False
        assert r.ref is None
        assert r.key == "YB^999^9"   # the key an operator would add to the table

    def test_a_near_miss_is_a_miss(self):
        """Room 305 is not room 304. A fuzzy match here would be a patient in the wrong bed."""
        assert _map().resolve("YB", "305", "2").matched is False


class TestCounters:
    def test_misses_are_counted_so_a_wrong_table_cannot_look_like_a_quiet_ward(self):
        m = _map()
        for _ in range(3):
            m.resolve("YB", "999", "9")
        m.resolve("KVC", "1", "1")
        assert m.unmatched() == {"YB^999^9": 3, "KVC^1^1": 1}

    def test_hits_are_not_counted_as_misses(self):
        m = _map()
        m.resolve("YB", "304", "2")
        assert m.unmatched() == {}

    def test_the_report_names_what_is_missing_most_often_first(self):
        m = _map()
        m.resolve("KVC", "1", "1")
        for _ in range(2):
            m.resolve("YB", "999", "9")
        report = m.discovery_report()
        assert report.index("YB^999^9") < report.index("KVC^1^1")
        assert "(2)" in report and "(1)" in report

    def test_the_report_carries_no_patient_data(self):
        """It is meant to be logged, so it may contain locations and counts and nothing else."""
        m = _map()
        m.resolve("YB", "999", "9")
        assert m.discovery_report() == "Eşlenmemiş yataklar: YB^999^9 (1)"

    def test_a_clean_run_says_so_rather_than_saying_nothing(self):
        assert _map().discovery_report() == "Eşlenmemiş yatak yok."


class TestLoading:
    def test_a_site_with_no_table_yet_still_runs_and_counts_everything(self, tmp_path):
        """A missing file must not stop the service — the discovery report is what tells the
        operator the table has not been written."""
        m = BedMap.from_file(tmp_path / "does-not-exist.json")
        assert len(m) == 0
        assert m.resolve("YB", "304", "2").matched is False
        assert "YB^304^2" in m.discovery_report()

    def test_a_table_loads_from_disk(self, tmp_path):
        p = tmp_path / "bed-mapping.json"
        p.write_text(json.dumps(TABLE), encoding="utf-8")
        m = BedMap.from_file(p)
        assert len(m) == 3
        assert m.resolve("YYB", "12", "A").ref.unit_id == "unit-nicu"

    def test_a_bare_string_value_is_accepted_as_the_bed_id(self):
        m = BedMap.from_dict({"beds": {"YB^1^1": "bed-x"}})
        assert m.resolve("YB", "1", "1").ref == BedRef(bed_id="bed-x")

    @pytest.mark.parametrize("raw", [{}, {"beds": {}}, {"beds": None}])
    def test_an_empty_or_malformed_table_is_empty_not_an_error(self, raw):
        assert len(BedMap.from_dict(raw)) == 0

    def test_a_directory_where_the_file_should_be_does_not_take_the_service_down(self, tmp_path):
        """Docker leaves a DIRECTORY at a bind-mount target whose source file does not exist.
        Reading it would kill the API at boot over a table that was merely never written."""
        target = tmp_path / "bed-mapping.json"
        target.mkdir()
        m = BedMap.from_file(target)
        assert len(m) == 0
        assert m.resolve("YB", "304", "2").matched is False

    def test_unreadable_json_runs_with_an_empty_table_and_says_so_in_the_counters(self, tmp_path, caplog):
        """Refusing to start would cost the ward its monitor over a config file. Running with an
        empty table costs nothing that the discovery report does not then shout about."""
        p = tmp_path / "bed-mapping.json"
        p.write_text("{ this is not json", encoding="utf-8")
        with caplog.at_level("ERROR"):
            m = BedMap.from_file(p)
        assert len(m) == 0
        assert "okunamadı" in caplog.text
        m.resolve("YB", "304", "2")
        assert "YB^304^2" in m.discovery_report()

    def test_a_json_document_that_is_not_an_object_is_refused_the_same_way(self, tmp_path):
        p = tmp_path / "bed-mapping.json"
        p.write_text("[1, 2, 3]", encoding="utf-8")
        assert len(BedMap.from_file(p)) == 0
