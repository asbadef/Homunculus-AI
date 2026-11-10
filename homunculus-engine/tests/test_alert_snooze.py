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


# --- the store (api/ackstore.py) -------------------------------------------------------------------------

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
KEY = ("p", "k")


def _snoozed(store, minutes=15, at=NOW, severity="high", reason="ARTEFACT_OR_SIGNAL_NOISE", text=None):
    return store.snooze("p", "k", by="hem.leyla", at=at, minutes=minutes, reason=reason, reason_text=text,
                        severity=severity)


def test_a_snooze_is_kept_with_its_until_and_takes_the_alarm_out_of_the_escalated_set():
    store = AckStore()
    store.first_seen[KEY] = store.clock_from[KEY] = NOW - timedelta(minutes=10)
    store.escalated.add(KEY)
    store.paged.add(KEY)
    entry = _snoozed(store)
    assert entry == {"by": "hem.leyla", "at": NOW, "until": NOW + timedelta(minutes=15), "minutes": 15,
                     "reason": "ARTEFACT_OR_SIGNAL_NOISE", "reason_text": None, "severity": "high"}
    assert store.snoozes[KEY] is entry
    assert KEY not in store.escalated, "no escalation while snoozed"
    assert KEY in store.paged, "the doctor's page stays sent"


def test_snoozing_again_replaces_the_snooze():
    store = AckStore()
    _snoozed(store, minutes=30)
    _snoozed(store, minutes=5, at=NOW + timedelta(minutes=2))
    assert store.snoozes[KEY]["until"] == NOW + timedelta(minutes=7)
    assert store.snoozes[KEY]["minutes"] == 5


def test_at_until_the_snooze_ends_with_a_fresh_clock_and_a_cleared_page():
    store = AckStore()
    store.first_seen[KEY] = store.clock_from[KEY] = NOW - timedelta(minutes=10)
    store.paged.add(KEY)
    _snoozed(store, minutes=15)
    assert store.expire_snoozes(NOW + timedelta(minutes=14, seconds=59)) == []
    assert KEY in store.snoozes
    assert store.expire_snoozes(NOW + timedelta(minutes=15)) == [KEY]
    assert store.snoozes == {}
    assert store.clock_from[KEY] == NOW + timedelta(minutes=15), "the clock starts again from until"
    assert KEY not in store.paged, "and the page is cleared: silence after it may page the doctor again"
    assert store.first_seen[KEY] == NOW - timedelta(minutes=10), "the episode is the same one"


def test_an_acknowledgement_ends_the_snooze():
    store = AckStore()
    _snoozed(store)
    store.acknowledge("p", "k", "hem.leyla", NOW)
    assert store.snoozes == {}


def test_prune_ends_the_snooze_with_its_episode_and_no_chain_carries_it():
    store = AckStore()
    store.stamp_first_seen("p", "k", NOW - timedelta(minutes=3), chain_gap=timedelta(minutes=5))
    _snoozed(store)
    store.prune(live_keys={KEY})
    assert KEY in store.snoozes, "the episode is still on the board"
    store.prune(live_keys=set(), now=NOW + timedelta(minutes=1))
    assert store.snoozes == {}
    assert KEY in store.recent, "the episode ended unanswered: its X13 chain is kept"
    assert store.stamp_first_seen("p", "k", NOW + timedelta(minutes=2), chain_gap=timedelta(minutes=5))
    assert store.snoozes == {}, "a return is a new alarm, and sounds: no snooze rides the chain"
    assert store.clock_from[KEY] == NOW - timedelta(minutes=3), "the chain's own clock goes on (plan note 2)"


def test_a_discharge_ends_the_snooze():
    store = AckStore()
    _snoozed(store)
    store.snooze("q", "k", by="u", at=NOW, minutes=5, reason="PATIENT_BASELINE", reason_text=None,
                 severity="moderate")
    store.forget_patient("p")
    assert set(store.snoozes) == {("q", "k")}


# --- the card, and the same alarm worse (an Engine, as a door drives it) -----------------------------------
#
# Heart rate 115 and temperature 39.5 score 2 NEWS2 points each. A respiratory rate of 26 adds 3 (NEWS2 7, a HIGH,
# immediate `news2`); one of 22 adds 2 (NEWS2 6, MODERATE). Made-up values on a synthetic bed.

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
NEWS2 = ("bed-3", "news2")


def _measure(engine, store, rr, at):
    for code, value in ((SignalCode.HEART_RATE, 115.0), (SignalCode.TEMPERATURE, 39.5),
                        (SignalCode.RESP_RATE, float(rr))):
        engine.ingest(Observation("bed-3", code, value, "", at, "mon"), now=at)
    sync_alerts(engine, store, "bed-3", at)


def _news2_engine(rr):
    engine, store = Engine(), AckStore()
    _measure(engine, store, rr, T0)
    store.stamp_first_seen("bed-3", "news2", T0)
    return engine, store


def _card_alert(engine, store, kind="news2"):
    return next(a for a in patient_board(engine, "bed-3", store, now=T0)["alerts"] if a["kind"] == kind)


def test_the_card_carries_the_snooze_and_none_without_one():
    engine, store = _news2_engine(rr=26)
    assert _card_alert(engine, store)["snooze"] is None
    store.snooze("bed-3", "news2", by="hem.leyla", at=T0, minutes=15, reason="OTHER",
                 reason_text="Hasta yıkanıyor, prob çıktı", severity="high")
    assert _card_alert(engine, store)["snooze"] == {
        "by": "hem.leyla", "at": T0.isoformat(), "until": (T0 + timedelta(minutes=15)).isoformat(), "minutes": 15,
        "reason": "OTHER", "reason_text": "Hasta yıkanıyor, prob çıktı"}


def test_a_latched_alert_on_the_card_has_no_snooze():
    engine, store = _news2_engine(rr=26)
    shock = Alert(patient_id="bed-3", kind="septic_shock", severity="critical", urgency="immediate", summary="",
                  clinical_reasoning="", supporting_evidence=[], recommended_actions=[], confidence="")
    store.resolved[("bed-3", "septic_shock")] = {"alert": asdict(shock), "resolved_at": T0, "first_seen": T0}
    latched = _card_alert(engine, store, "septic_shock")
    assert latched["resolved_at"] is not None and latched["snooze"] is None


def test_the_same_alarm_worse_ends_its_snooze():
    engine, store = _news2_engine(rr=22)
    assert store.firing[NEWS2].severity == "moderate"
    store.snooze("bed-3", "news2", by="u", at=T0, minutes=120, reason="PATIENT_BASELINE", reason_text=None,
                 severity="moderate")
    _measure(engine, store, 22, T0 + timedelta(minutes=1))
    assert NEWS2 in store.snoozes, "the same severity: the snooze stands"
    _measure(engine, store, 26, T0 + timedelta(minutes=2))
    assert store.firing[NEWS2].severity == "high"
    assert NEWS2 not in store.snoozes, "a worse alarm is not the one a person snoozed (plan note 1)"
    assert store.clock_from[NEWS2] == T0, "and it waits as if never snoozed: its clock is its own"


def test_a_milder_alarm_keeps_its_snooze():
    engine, store = _news2_engine(rr=26)
    store.snooze("bed-3", "news2", by="u", at=T0, minutes=30, reason="PATIENT_BASELINE", reason_text=None,
                 severity="high")
    _measure(engine, store, 22, T0 + timedelta(minutes=1))
    assert store.firing[NEWS2].severity == "moderate"
    assert NEWS2 in store.snoozes
