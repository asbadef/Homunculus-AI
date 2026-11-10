# homunculus-engine/tests/test_care_team_rules.py
"""The care team's rules that need no database (G2-B1c, spec T1, T8, §5.2 `in_force`):
- a physician is a member of a default ROLE group of physicians;
- a row is in force while it is active and, for an on-call row, inside its window (the board's
  own rule, scope/service.py `_window_open`);
- an on-call row whose window has passed is the one an add renews."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.admission.models import CareTeamMember, CareTeamRole
from homunculus.admission.service import PHYSICIAN_GROUPS, expired, in_force
from homunculus.auth.permissions import DEFAULT_GROUPS

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
HOUR = timedelta(hours=1)


def _row(role=CareTeamRole.ONCALL_PHYSICIAN, *, active=True, start=None, end=None):
    return CareTeamMember(role=role, is_active=active, window_start=start, window_end=end)


def test_the_physicians_are_the_three_default_role_groups_of_physicians():
    kinds = {g["slug"]: g["kind"] for g in DEFAULT_GROUPS}
    assert PHYSICIAN_GROUPS == ("attending", "unit_physician", "physician")
    assert all(kinds[slug] == "role" for slug in PHYSICIAN_GROUPS)


def test_a_row_is_in_force_while_active_and_inside_its_window():
    assert in_force(_row(CareTeamRole.ASSOCIATE_PHYSICIAN), NOW)
    assert in_force(_row(start=NOW - HOUR, end=NOW + HOUR), NOW)
    assert not in_force(_row(start=NOW - 3 * HOUR, end=NOW - HOUR), NOW)      # passed
    assert not in_force(_row(start=NOW + HOUR, end=NOW + 3 * HOUR), NOW)      # still to come
    assert not in_force(_row(CareTeamRole.ATTENDING, active=False), NOW)


def test_only_an_on_call_row_whose_window_has_passed_is_expired():
    assert expired(_row(start=NOW - 3 * HOUR, end=NOW - HOUR), NOW)
    assert not expired(_row(start=NOW - HOUR, end=NOW + HOUR), NOW)
    assert not expired(_row(start=NOW + HOUR, end=NOW + 3 * HOUR), NOW)
    assert not expired(_row(CareTeamRole.ASSOCIATE_PHYSICIAN), NOW)
