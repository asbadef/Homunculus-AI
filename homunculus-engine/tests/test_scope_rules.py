"""The scope rules, without a database, a token or a server.

`patientScope.js` filters the board on screen and says in its own header that anyone talking to
the API directly still gets the whole ward. These tests pin the rules for the side that
actually decides — and, as much as anything, they pin the two rules that are easy to get
backwards under pressure: a scope that matches nothing must produce an empty board that
*announces itself*, and an unassigned user must not be blacked out on the day this ships.
"""
from __future__ import annotations

from homunculus.scope import (
    Scope,
    ScopeReason,
    apply_scope,
    build_scope,
    scope_report,
    sees_patient,
)


def card(patient_id: str, bed_id: str | None = None, unit_id: str | None = None) -> dict:
    return {"patient_id": patient_id,
            "identity": {"bed_id": bed_id, "unit_id": unit_id,
                         "bed_matched": bed_id is not None, "bed_key": "YB^1^1"}}


WARD = [
    card("p-adult-1", "bed-a1", "unit-adult"),
    card("p-adult-2", "bed-a2", "unit-adult"),
    card("p-nicu-1", "bed-n1", "unit-nicu"),
    card("p-nobed", None, None),
]


class TestAWhoIsNotScoped:
    def test_an_administrator_is_not_scoped_to_beds(self):
        scope = build_scope("HOSPITAL_ADMIN")
        assert scope.unrestricted is True
        assert scope.reason == ScopeReason.UNRESTRICTED_ROLE

    def test_role_outranks_an_empty_assignment(self):
        """An administrator's access must not depend on someone having filled in a matrix."""
        assert build_scope("HOSPITAL_ADMIN", unit_ids=[]).unrestricted is True

    def test_break_glass_opens_the_patient_it_names_and_not_the_ward(self):
        """`BreakGlassSession` records a reason about ONE patient. Reading it as blanket access
        would hand over a ward on a justification written about one bed."""
        scope = build_scope("NURSE", unit_ids=["unit-adult"],
                            break_glass_patient_ids=["p-nicu-1"])
        assert scope.unrestricted is False
        seen = [b["patient_id"] for b in apply_scope(WARD, scope).boards]
        assert seen == ["p-adult-1", "p-adult-2", "p-nicu-1"]

    def test_break_glass_does_not_open_the_rest_of_the_other_unit(self):
        ward = WARD + [card("p-nicu-2", "bed-n2", "unit-nicu")]
        scope = build_scope("NURSE", unit_ids=["unit-adult"],
                            break_glass_patient_ids=["p-nicu-1"])
        seen = [b["patient_id"] for b in apply_scope(ward, scope).boards]
        assert "p-nicu-2" not in seen

    def test_break_glass_alone_is_named_as_the_reason(self):
        """An otherwise unassigned clinician sees that one patient, and the reason says why."""
        scope = build_scope("NURSE", break_glass_patient_ids=["p-nicu-1"])
        assert scope.reason == ScopeReason.BREAK_GLASS
        assert [b["patient_id"] for b in apply_scope(WARD, scope).boards] == ["p-nicu-1"]


class TestBTheUnassignedUser:
    """The pilot has no assignments at all. What happens on the day this ships is a decision,
    not an accident."""

    def test_unassigned_is_unrestricted_by_default(self):
        scope = build_scope("NURSE")
        assert scope.unrestricted is True
        assert scope.reason == ScopeReason.UNASSIGNED

    def test_unassigned_is_reported_differently_from_being_an_admin(self):
        """Both see everything; only one of them is a gap someone has to close."""
        assert build_scope("NURSE").reason != build_scope("HOSPITAL_ADMIN").reason

    def test_enforcing_unassigned_denies_everything(self):
        scope = build_scope("NURSE", enforce_unassigned=True)
        assert scope.unrestricted is False
        assert apply_scope(WARD, scope).boards == []

    def test_enforcing_unassigned_still_leaves_own_patients(self):
        """A physician on a care team is not unassigned in any sense that matters."""
        scope = build_scope("ATTENDING", own_patient_ids=["p-nicu-1"], enforce_unassigned=True)
        seen = [b["patient_id"] for b in apply_scope(WARD, scope).boards]
        assert seen == ["p-nicu-1"]


class TestCTheAssignment:
    def test_a_unit_grant_gives_that_units_beds(self):
        scope = build_scope("NURSE", unit_ids=["unit-adult"])
        seen = [b["patient_id"] for b in apply_scope(WARD, scope).boards]
        assert seen == ["p-adult-1", "p-adult-2"]

    def test_a_bed_grant_gives_only_that_bed(self):
        scope = build_scope("NURSE", bed_ids=["bed-n1"])
        seen = [b["patient_id"] for b in apply_scope(WARD, scope).boards]
        assert seen == ["p-nicu-1"]

    def test_own_patient_is_visible_off_the_assigned_unit(self):
        """Consultation and handover are real; the system may not contradict its own care-team
        record by hiding a patient from the clinician it holds responsible for them."""
        scope = build_scope("ATTENDING", unit_ids=["unit-adult"], own_patient_ids=["p-nicu-1"])
        seen = [b["patient_id"] for b in apply_scope(WARD, scope).boards]
        assert seen == ["p-adult-1", "p-adult-2", "p-nicu-1"]

    def test_ids_match_regardless_of_case_and_spacing(self):
        """One side of this comparison is a hand-written JSON file, the other a form field."""
        scope = build_scope("NURSE", unit_ids=["  Unit-ADULT "])
        assert len(apply_scope(WARD, scope).boards) == 2

    def test_a_patient_on_no_known_bed_is_not_visible_to_a_scoped_user(self):
        """An unmatched bed belongs to no unit, so no assignment can reach it. The patient is
        not lost — the administrator and the discovery report both still see them."""
        scope = build_scope("NURSE", unit_ids=["unit-adult", "unit-nicu"])
        seen = [b["patient_id"] for b in apply_scope(WARD, scope).boards]
        assert "p-nobed" not in seen

    def test_a_bed_with_no_unit_is_reachable_by_bed_but_not_by_unit(self):
        ward = [card("p-x", "bed-x", None)]
        assert apply_scope(ward, build_scope("NURSE", bed_ids=["bed-x"])).boards != []
        assert apply_scope(ward, build_scope("NURSE", unit_ids=["unit-adult"])).boards == []


class TestDSayingWhyTheBoardIsThisSize:
    """An empty ward and a broken scope look identical. They must not read identical."""

    def test_an_empty_scoped_board_is_flagged_blind(self):
        result = apply_scope(WARD, build_scope("NURSE", unit_ids=["unit-that-does-not-exist"]))
        assert result.blind is True
        assert "GELMEZ" in scope_report(result)

    def test_an_unrestricted_board_is_never_blind_and_says_nothing(self):
        result = apply_scope(WARD, build_scope("HOSPITAL_ADMIN"))
        assert result.blind is False
        assert scope_report(result) is None

    def test_hidden_patients_are_counted(self):
        result = apply_scope(WARD, build_scope("NURSE", unit_ids=["unit-adult"]))
        assert result.hidden == 2
        assert result.unresolved_hidden == 1

    def test_a_grant_nothing_on_the_board_matches_is_named(self):
        result = apply_scope(WARD, build_scope("NURSE", unit_ids=["unit-adult", "unit-ghost"]))
        assert result.unmatched_grants == ("unit-ghost",)

    def test_unmatched_grants_travel_as_data_units_apart_from_beds_never_in_a_sentence(self):
        """G2-B1a walk (I-1): since B1a a grant key is the tenant's UUID (spec D9), and the Turkish
        sentence that listed the keys put one on a nurse's board. The keys go out as data, units
        apart from beds, and the screen names each from the structure in its reader's language;
        the server writes no prose around them. The flat `unmatched_grants` list leaves the
        payload: nothing read it, and a key whose kind is lost cannot be named."""
        result = apply_scope(WARD, build_scope("NURSE", unit_ids=["unit-adult", "unit-ghost"],
                                               bed_ids=["bed-ghost"]))
        assert result.unmatched_unit_ids == ("unit-ghost",)
        assert result.unmatched_bed_ids == ("bed-ghost",)
        assert result.unmatched_grants == ("bed-ghost", "unit-ghost")   # the log line's view
        published = result.as_dict()
        assert published["unmatched_unit_ids"] == ["unit-ghost"]
        assert published["unmatched_bed_ids"] == ["bed-ghost"]
        assert "unmatched_grants" not in published
        assert scope_report(result) is None

    def test_a_scope_that_fully_matches_reports_nothing(self):
        result = apply_scope(WARD, build_scope("NURSE", unit_ids=["unit-adult"]))
        assert result.unmatched_grants == ()
        assert result.as_dict()["unmatched_unit_ids"] == []
        assert result.as_dict()["unmatched_bed_ids"] == []
        assert scope_report(result) is None

    def test_an_unrestricted_scope_has_no_unmatched_keys(self):
        published = apply_scope(WARD, build_scope("HOSPITAL_ADMIN")).as_dict()
        assert published["unmatched_unit_ids"] == []
        assert published["unmatched_bed_ids"] == []

    def test_the_published_shape_carries_the_reason(self):
        result = apply_scope(WARD, build_scope("NURSE", unit_ids=["unit-adult"]))
        published = result.as_dict()
        assert published["reason"] == ScopeReason.ASSIGNED
        assert published["unrestricted"] is False
        assert published["unit_ids"] == ["unit-adult"]
        assert published["blind"] is False


class TestEOneCardAtATime:
    """`/alerts/{id}`, `/clinical/{id}` and the score routes ask about a single patient; they
    must get the same answer the board gives."""

    def test_sees_patient_agrees_with_the_filtered_board(self):
        scope = build_scope("NURSE", unit_ids=["unit-adult"])
        allowed = {b["patient_id"] for b in apply_scope(WARD, scope).boards}
        for board in WARD:
            assert sees_patient(board, scope) is (board["patient_id"] in allowed)

    def test_an_unrestricted_scope_sees_a_card_with_no_identity_at_all(self):
        assert sees_patient({"patient_id": "p"}, Scope(True, ScopeReason.UNRESTRICTED_ROLE))

    def test_a_scoped_user_does_not_see_a_card_with_no_identity(self):
        assert not sees_patient({"patient_id": "p"}, build_scope("NURSE", unit_ids=["u"]))
