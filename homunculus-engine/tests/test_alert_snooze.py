# tests/test_alert_snooze.py
"""G2-B5b «Ertele» (spec 2026-11-10-g2b-b5b-ertele-design.md): snoozing an alarm on the live system.

Owner D1: critical never; high at most 30 minutes; moderate at most 120; low and info none; a reason from a fixed
list, OTHER with at least 15 characters; anyone with `alerts.ack`, never a device. A snooze is a trail row first and
the store's second, rides the card's alert as `snooze`, keeps the alarm from escalating, and at its `until` gives the
alarm a fresh escalation clock and a cleared page. An acknowledgement, the episode's end, a discharge and the same
alarm worse (plan note 1) end it; it rides no X13 chain; a restart replays it. Synthetic patients and values only."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.api.app as app_module
import homunculus.scenarios
from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import sync_alerts
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.board import patient_board
from homunculus.api.identity import Caller
from homunculus.api.rehydrate import rehydrate
from homunculus.api.snooze import (
    OTHER_MIN_CHARS, REASON_TEXT_MAX, SNOOZE_CAPS, SNOOZE_REASONS, clean_reason, minutes_ok, snooze_cap, worse,
)
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.scenarios.loader import load_scenario


# --- the owner's rules (api/snooze.py) -------------------------------------------------------------------

def test_the_caps_are_the_owners():
    assert SNOOZE_CAPS == {"high": 30, "moderate": 120}
    assert snooze_cap("high") == 30 and snooze_cap("moderate") == 120
    for severity in ("critical", "low", "info", "unheard_of", None, 7):
        assert snooze_cap(severity) is None, severity


def test_minutes_must_be_a_whole_number_within_the_cap():
    assert minutes_ok("high", 1) and minutes_ok("high", 30) and minutes_ok("moderate", 120)
    for bad in (0, -5, 31, 30.0, 15.5, "15", True, None, [15]):
        assert not minutes_ok("high", bad), bad
    assert not minutes_ok("moderate", 121)
    for severity in ("critical", "low", "info"):
        assert not minutes_ok(severity, 1), severity


def test_the_reasons_are_the_fixed_list():
    assert SNOOZE_REASONS == {"CLINICAL_DECISION_MADE", "ARTEFACT_OR_SIGNAL_NOISE", "PROCEDURE_IN_PROGRESS",
                              "PATIENT_BASELINE", "OTHER"}
    for reason in SNOOZE_REASONS - {"OTHER"}:
        assert clean_reason(reason, None) == (reason, None)
        assert clean_reason(reason, "   ") == (reason, None), "a blank text is no text"
        assert clean_reason(reason, "  kısa not ") == (reason, "kısa not")
    for bad in ("other", "", None, 3, "SNOOZE"):
        assert clean_reason(bad, None) is None, bad


def test_other_needs_at_least_15_characters_and_no_text_is_over_500():
    assert OTHER_MIN_CHARS == 15 and REASON_TEXT_MAX == 500
    assert clean_reason("OTHER", None) is None
    assert clean_reason("OTHER", "  " + "a" * 14 + "  ") is None, "counted once trimmed"
    assert clean_reason("OTHER", "a" * 15) == ("OTHER", "a" * 15)
    assert clean_reason("OTHER", "a" * 500) == ("OTHER", "a" * 500)
    assert clean_reason("OTHER", "a" * 501) is None
    assert clean_reason("PATIENT_BASELINE", "a" * 501) is None
    assert clean_reason("PATIENT_BASELINE", {"t": "x"}) is None, "a text that is not a string"


def test_worse_ranks_the_engines_severities():
    assert worse("high", "moderate") and worse("critical", "high") and worse("moderate", "low")
    assert not worse("high", "high") and not worse("moderate", "high")
    assert worse("unheard_of", "high"), "a severity this build does not know may be the worst"
