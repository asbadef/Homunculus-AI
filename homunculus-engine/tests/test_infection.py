# homunculus-engine/tests/test_infection.py
"""G4-05 «Enfeksiyon kontrol» (spec D10 as §5 S1, S2, A3, M3, M4 amend it): `ward_infection`, pure. The rows of the
two lists (a patient in both), each with Eczane's antibiotic object for its card, the three Sepsis-3 rule kinds firing
and latched (listed, not counted), `sort_group`; the bed occupants; the counts whole and per unit, the two «unrecorded»
counts among them; an identity-only card read defensively; no card → the whole shape. The cards are built here in the
board's shape (api/board.py); synthetic keys and names only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.infection import SEPSIS_KINDS, ward_infection
from homunculus.api.pharmacy import antibiotic_of

NOW = datetime(2026, 11, 12, 9, 30, tzinfo=timezone.utc)
KEYS = ["now", "antibiotic_window_min", "antibiotic_window_source", "counts", "units", "isolated", "suspected",
        "bed_occupants"]
COUNT_KEYS = ["patients", "isolated", "isolation_unrecorded", "suspected", "suspected_unrecorded", "clock_missed",
              "sepsis_open"]
ZERO = dict.fromkeys(COUNT_KEYS, 0)


def iso(*types, state=None, at="2026-11-12T08:10:00+00:00"):
    """A card's `isolation` block (api/board.py `_isolation`) with these types in place; `state` overrides."""
    flags = {name: (name in types) for name in ("contact", "droplet", "airborne", "protective")}
    return {**flags, "types": list(types), "state": state or ("isolated" if types else "not_isolated"),
            "charted_at": at}


UNRECORDED_BLOCK = {"contact": None, "droplet": None, "airborne": None, "protective": None, "types": [],
                    "state": "unrecorded", "charted_at": None}


def alert(kind, severity="high", *, resolved_at=None, acknowledged=False, snooze=None):
    return {"kind": kind, "severity": severity, "first_seen_at": "2026-11-12T08:20:00+00:00", "resolved_at": resolved_at,
            "acknowledged": acknowledged, "snooze": snooze, "summary": "x"}


def clock(remaining_sec, **over):
    """A `meds` block whose antibiotic clock is open (no administration), `remaining_sec` from the deadline."""
    return {"antibiotic_given": None, "antibiotic_at": None, **over,
            "antibiotic_clock": {"recognized_at": "2026-11-12T08:05:00+00:00", "deadline": "2026-11-12T09:05:00+00:00",
                                 "remaining_sec": remaining_sec, "elapsed_sec": 0, "met": None}}


def card(pid, *, bed="", bed_id=None, unit=None, name="", isolation=UNRECORDED_BLOCK, suspected=None, meds=None,
         alerts=()):
    """A measured card in the board's shape — only what the builder reads."""
    return {"patient_id": pid,
            "identity": {"bed_label": bed, "bed_id": bed_id, "unit_id": unit, "display_name": name},
            "isolation": isolation, "alerts": list(alerts), "meds": meds,
            "sepsis": {"suspected_infection": suspected, "sofa": 2, "baseline_sofa": None, "baseline_assumed": True,
                       "rise": 2}}


def identity_only(pid, *, bed_id=None, unit=None):
    """api/board.py `identity_only_board`: no `sepsis`, no `meds`, `isolation: null`."""
    return {"patient_id": pid, "risk": "none", "alerts": [], "latest": {}, "isolation": None,
            "identity": {"bed_label": "", "bed_id": bed_id, "unit_id": unit, "display_name": ""}}


def ids(rows):
    return [row["patient_id"] for row in rows]


class TestTheShape:
    def test_no_card_is_the_whole_shape(self):
        answer = ward_infection([], now=NOW)
        assert list(answer) == KEYS
        assert answer["now"] == "2026-11-12T09:30:00+00:00"
        assert (answer["antibiotic_window_min"], answer["antibiotic_window_source"]) == (
            60, "surviving-sepsis-campaign-2026")
        assert answer["counts"] == ZERO and list(answer["counts"]) == COUNT_KEYS
        assert answer["units"] == answer["isolated"] == answer["suspected"] == answer["bed_occupants"] == []

    def test_the_structures_part_is_the_pages_own(self):
        """§5 S1: the isolation beds come from the structure tree on the page, so the answer carries no `beds`, no
        `isolation_beds`, no unit names and no `in_isolation_room`."""
        answer = ward_infection([card("S-101", bed_id="b9", unit="u1", isolation=iso("contact"))], now=NOW)
        (row,) = answer["isolated"]
        assert "beds" not in answer and "isolation_beds" not in answer["counts"]
        assert answer["units"] == [{"unit_id": "u1", "counts": answer["counts"]}]
        assert "in_isolation_room" not in row and "charted_by" not in row["isolation"]


class TestTheRows:
    def test_a_row_is_one_card_with_eczanes_antibiotic_object(self):
        meds = clock(-1500)
        c = card("S-103", bed="YBU 1-3", bed_id="b3", unit="u1", name="Ali Sentetik", suspected=True, meds=meds,
                 alerts=[alert("septic_shock", "critical")])
        (row,) = ward_infection([c], now=NOW)["suspected"]
        assert row == {
            "patient_id": "S-103", "bed_label": "YBU 1-3", "bed_id": "b3", "unit_id": "u1", "display_name": "Ali Sentetik",
            "isolation": {"state": "unrecorded", "types": [], "charted_at": None},
            "suspected_infection": True,
            "antibiotic": antibiotic_of(meds),
            "sepsis_alarms": [{"kind": "septic_shock", "severity": "critical", "first_seen_at": "2026-11-12T08:20:00+00:00",
                               "resolved_at": None, "acknowledged": False, "snooze_until": None}],
            "sort_group": 0}
        assert row["antibiotic"]["state"] == "missed" and row["antibiotic"]["remaining_sec"] == -1500

    def test_a_patient_isolated_and_suspected_is_in_both_lists(self):
        c = card("S-101", bed="İzo 1", bed_id="b9", unit="u1", name="Ayşe Sentetik", isolation=iso("contact", "droplet"),
                 suspected=True)
        answer = ward_infection([c], now=NOW)
        assert ids(answer["isolated"]) == ids(answer["suspected"]) == ["S-101"]
        assert answer["isolated"][0]["isolation"] == {"state": "isolated", "types": ["contact", "droplet"],
                                                       "charted_at": "2026-11-12T08:10:00+00:00"}

    def test_isolated_holds_only_the_cards_in_isolation(self):
        cards = [card("S-101", isolation=iso("airborne")), card("S-102", isolation=iso()),
                 card("S-103"), identity_only("S-104")]
        assert ids(ward_infection(cards, now=NOW)["isolated"]) == ["S-101"]

    def test_suspected_holds_a_charted_mark_or_an_alarm_of_the_three_kinds(self):
        """§5 M3: a latched septic shock stays on the page after suspected infection was charted 0."""
        cards = [card("S-101", suspected=True), card("S-102", suspected=False),
                 card("S-103", suspected=False, alerts=[alert("septic_shock", "critical", resolved_at="2026-11-12T09:00:00+00:00")]),
                 card("S-104", suspected=None, alerts=[alert("sepsis_watch", "moderate"), alert("antibiotic_overdue", "critical")]),
                 card("S-105", suspected=None, alerts=[alert("under_resuscitated_sepsis")])]
        answer = ward_infection(cards, now=NOW)
        assert ids(answer["suspected"]) == ["S-101", "S-103", "S-105"]
        assert answer["counts"]["suspected"] == 1                     # the mark charted true, only
        assert answer["counts"]["sepsis_open"] == 1                   # S-105's firing alarm; S-103's is latched

    def test_the_alarms_are_the_three_kinds_in_their_order_firing_and_latched(self):
        c = card("S-101", suspected=True, alerts=[
            alert("news2", "high"), alert("under_resuscitated_sepsis", "high"), alert("antibiotic_due", "high"),
            alert("sepsis", "high", acknowledged=True),
            alert("septic_shock", "critical", resolved_at="2026-11-12T09:00:00+00:00"),
            alert("sepsis_watch", "moderate")])
        (row,) = ward_infection([c], now=NOW)["suspected"]
        assert [(a["kind"], a["resolved_at"], a["acknowledged"]) for a in row["sepsis_alarms"]] == [
            ("septic_shock", "2026-11-12T09:00:00+00:00", False), ("sepsis", None, True),
            ("under_resuscitated_sepsis", None, False)]
        assert SEPSIS_KINDS == ("septic_shock", "sepsis", "under_resuscitated_sepsis")

    def test_an_acknowledged_and_a_snoozed_firing_alarm_both_count(self):
        snooze = {"by": "hem.ayse", "at": "2026-11-12T09:00:00+00:00", "until": "2026-11-12T09:15:00+00:00",
                  "minutes": 15, "reason": "PATIENT_BASELINE", "reason_text": None}
        cards = [card("S-101", alerts=[alert("sepsis", acknowledged=True)]),
                 card("S-102", alerts=[alert("under_resuscitated_sepsis", snooze=snooze)])]
        answer = ward_infection(cards, now=NOW)
        assert answer["counts"]["sepsis_open"] == 2
        assert [a["snooze_until"] for row in answer["suspected"] for a in row["sepsis_alarms"]] == [
            None, "2026-11-12T09:15:00+00:00"]

    def test_sort_group_is_an_open_clock_then_a_firing_alarm_then_the_rest(self):
        given = {"antibiotic_given": True, "antibiotic_at": "2026-11-12T08:30:00+00:00", "antibiotic_clock": None}
        cards = [card("S-101", suspected=True, meds=clock(1200)),                                    # running
                 card("S-102", suspected=True, meds=clock(-60), alerts=[alert("sepsis")]),            # missed
                 card("S-103", suspected=True, meds=given, alerts=[alert("sepsis")]),                 # firing alarm
                 card("S-104", suspected=True, alerts=[alert("septic_shock", "critical",
                                                             resolved_at="2026-11-12T09:00:00+00:00")]),   # latched
                 card("S-105", suspected=True)]
        groups = {row["patient_id"]: row["sort_group"] for row in ward_infection(cards, now=NOW)["suspected"]}
        assert groups == {"S-101": 0, "S-102": 0, "S-103": 1, "S-104": 2, "S-105": 2}

    def test_the_lists_come_by_patient_key_the_page_orders_them(self):
        """§5 M4: the order by unit and bed NAME is the page's; the server sends its lists by key."""
        cards = [card(pid, isolation=iso("contact")) for pid in ("S-103", "S-101", "S-102")]
        assert ids(ward_infection(cards, now=NOW)["isolated"]) == ["S-101", "S-102", "S-103"]


class TestTheIdentityOnlyCard:
    def test_it_is_read_defensively_through_every_count(self):
        """§5 M4: no `sepsis`, no `meds`, `isolation: null` — suspected null, antibiotic `none`, no alarm, unrecorded."""
        answer = ward_infection([identity_only("S-104", bed_id="b4", unit="u1")], now=NOW)
        assert answer["counts"] == {**ZERO, "patients": 1, "isolation_unrecorded": 1, "suspected_unrecorded": 1}
        assert answer["isolated"] == answer["suspected"] == []
        assert answer["bed_occupants"] == [{"bed_id": "b4", "patient_id": "S-104", "display_name": "",
                                            "isolation": {"state": "unrecorded", "types": []}}]


class TestTheOccupantsAndTheCounts:
    def test_one_occupant_per_card_with_a_bed_none_for_a_card_without(self):
        cards = [card("S-101", bed_id="b9", unit="u1", name="Ayşe Sentetik", isolation=iso("contact", "droplet")),
                 card("S-102", bed_id="b9", unit="u1", isolation=iso()),
                 card("S-103", unit="u1")]
        assert ward_infection(cards, now=NOW)["bed_occupants"] == [
            {"bed_id": "b9", "patient_id": "S-101", "display_name": "Ayşe Sentetik",
             "isolation": {"state": "isolated", "types": ["contact", "droplet"]}},
            {"bed_id": "b9", "patient_id": "S-102", "display_name": "", "isolation": {"state": "not_isolated", "types": []}}]

    def test_the_counts_whole_and_per_unit_and_a_row_on_no_unit_only_in_the_whole(self):
        cards = [card("S-101", unit="u1", isolation=iso("contact"), suspected=True),
                 card("S-102", unit="u1", isolation=iso(), suspected=False, meds=clock(-30)),
                 card("S-103", unit="u2", alerts=[alert("sepsis")]),
                 card("S-104", isolation=iso("airborne"), suspected=None),                       # on no unit
                 identity_only("S-105", unit="u2")]
        answer = ward_infection(cards, now=NOW)
        assert answer["counts"] == {"patients": 5, "isolated": 2, "isolation_unrecorded": 2, "suspected": 1,
                                    "suspected_unrecorded": 3, "clock_missed": 1, "sepsis_open": 1}
        assert answer["units"] == [
            {"unit_id": "u1", "counts": {"patients": 2, "isolated": 1, "isolation_unrecorded": 0, "suspected": 1,
                                         "suspected_unrecorded": 0, "clock_missed": 1, "sepsis_open": 0}},
            {"unit_id": "u2", "counts": {"patients": 2, "isolated": 0, "isolation_unrecorded": 2, "suspected": 0,
                                         "suspected_unrecorded": 2, "clock_missed": 0, "sepsis_open": 1}}]

    def test_a_not_isolated_card_is_not_counted_as_unrecorded(self):
        answer = ward_infection([card("S-101", isolation=iso()), card("S-102")], now=NOW)
        assert (answer["counts"]["isolated"], answer["counts"]["isolation_unrecorded"]) == (0, 1)
