"""
Pure escalation-chain logic tests (S-05). No database required.

S-05: 3 min → CHARGE_NURSE, 5 min → physician, 10 min → RRT. Only CRITICAL and
HIGH tiers escalate automatically.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.escalation.models import AlertTier, EscalationStep
from homunculus.escalation.service import compute_escalation_step

T0 = datetime(2026, 7, 29, 8, 0, 0, tzinfo=timezone.utc)


def _step(tier, minutes):
    return compute_escalation_step(tier, T0, T0 + timedelta(minutes=minutes))


def test_no_escalation_before_three_minutes():
    assert _step(AlertTier.CRITICAL, 0) is EscalationStep.NONE
    assert _step(AlertTier.CRITICAL, 2) is EscalationStep.NONE


def test_tier1_at_three_minutes():
    assert _step(AlertTier.CRITICAL, 3) is EscalationStep.TIER_1_CHARGE_NURSE
    assert _step(AlertTier.CRITICAL, 4) is EscalationStep.TIER_1_CHARGE_NURSE


def test_tier2_at_five_minutes():
    assert _step(AlertTier.CRITICAL, 5) is EscalationStep.TIER_2_PHYSICIAN
    assert _step(AlertTier.CRITICAL, 9) is EscalationStep.TIER_2_PHYSICIAN


def test_tier3_at_ten_minutes():
    assert _step(AlertTier.CRITICAL, 10) is EscalationStep.TIER_3_RRT
    assert _step(AlertTier.CRITICAL, 60) is EscalationStep.TIER_3_RRT


def test_high_tier_also_escalates():
    assert _step(AlertTier.HIGH, 3) is EscalationStep.TIER_1_CHARGE_NURSE
    assert _step(AlertTier.HIGH, 10) is EscalationStep.TIER_3_RRT


def test_medium_low_info_never_auto_escalate():
    for tier in (AlertTier.MEDIUM, AlertTier.LOW, AlertTier.INFO):
        assert _step(tier, 3) is EscalationStep.NONE
        assert _step(tier, 60) is EscalationStep.NONE
