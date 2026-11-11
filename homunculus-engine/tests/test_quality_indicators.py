# homunculus-engine/tests/test_quality_indicators.py
"""G4-03 «Kalite göstergeleri» (spec D4): the answer of GET /quality, built from what the route read — pure, no
database. One synthetic hospital: Reanimasiya (two protocol numbers), Neonatal (a legacy H-number), a third unit with
nothing (left out), and two keys no admission holds (a HIS-fed id and a monitor-only id: unplaced). Synthetic ids,
synthetic people, synthetic texts."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from homunculus.api.alarm_quality import EPISODE_KINDS
from homunculus.api.audit import AuditRecord
from homunculus.api.snooze import SNOOZE_REASONS
from homunculus.quality.indicators import (
    QUALITY_KINDS, HandoverFacts, Reach, build_report, handovers_of, snoozes_of,
)

T0 = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)
NOW = T0 + timedelta(hours=6)
REA, NEO, KARDIO = uuid.UUID(int=0xA1), uuid.UUID(int=0xB2), uuid.UUID(int=0xC3)
K1, K3 = "202600000001", "202600000003"          # Reanimasiya, protocol numbers
K2 = "H2600002"                                  # Neonatal, a legacy admission's H-number
HIS, MONITOR = "S-HIS-7", "MON-3"                # no admission here: unplaced
KEY_UNITS = {K1: REA, K3: REA, K2: NEO}
ALL_UNITS = {REA: "Reanimasiya", NEO: "Neonatal", KARDIO: "Kardiyoloji"}
NURSE = {"role": "ayse.sentetik", "actor": "ayse.sentetik", "via": "user", "groups": ["nurse"]}
OTHER_TEXT = "Sentetik açıklama, on beş harften uzun"
RRT_TEXT = "Sentetik gerekçe: tansiyon düşüyor"
WINDOW_FROM = (NOW - timedelta(days=7)).isoformat()

_ids = iter(range(1, 10_000))


def rec(event_type: str, key: str, kind: str, minute: float, **payload) -> AuditRecord:
    when = (T0 + timedelta(minutes=minute)).isoformat()
    return AuditRecord(id=next(_ids), ts=when, tenant="kalite-hastane", event_type=event_type, patient_id=key,
                       subject=kind, payload={"at": when, **payload})


def snooze(key: str, kind: str, minute: float, *, minutes: int, reason: str, severity: str, **extra) -> AuditRecord:
    return rec("alert_snooze", key, kind, minute, **NURSE, minutes=minutes, reason=reason, severity=severity,
               until=(T0 + timedelta(minutes=minute + minutes)).isoformat(), **extra)


TRAIL = [
    # Reanimasiya: answered in 60 s, 180 s and 600 s (one escalated); one whose rule stopped by itself; one never
    # answered; one still pending.
    rec("first_seen", K1, "news2", 0), rec("ack", K1, "news2", 1, **NURSE),
    snooze(K1, "news2", 5, minutes=15, reason="CLINICAL_DECISION_MADE", severity="moderate"),
    rec("first_seen", K1, "news2", 30), rec("ack", K1, "news2", 33, **NURSE),
    rec("first_seen", K3, "septic_shock", 40), rec("escalation", K3, "septic_shock", 45),
    rec("rrt_call", K3, "septic_shock", 46, **NURSE, reason=RRT_TEXT),
    rec("ack", K3, "septic_shock", 50, **NURSE),
    rec("first_seen", K3, "spo2_low", 60),
    snooze(K3, "spo2_low", 61, minutes=10, reason="OTHER", severity="high", reason_text=OTHER_TEXT),
    rec("alert_cleared", K3, "spo2_low", 62, reason="resolved", severity="high"),
    rec("first_seen", K1, "spo2_low", 70),
    # Neonatal: answered in 240 s, one snooze.
    rec("first_seen", K2, "news2", 100), rec("ack", K2, "news2", 104, **NURSE),
    snooze(K2, "news2", 101, minutes=30, reason="ARTEFACT_OR_SIGNAL_NOISE", severity="moderate"),
    # Unplaced: a HIS-fed patient never answered (and snoozed), a monitor-only id answered in 60 s (and an RRT call).
    rec("first_seen", HIS, "news2", 120),
    snooze(HIS, "news2", 121, minutes=5, reason="PROCEDURE_IN_PROGRESS", severity="high"),
    rec("first_seen", MONITOR, "news2", 130), rec("ack", MONITOR, "news2", 131, **NURSE),
    rec("rrt_call", MONITOR, "news2", 130.5, **NURSE, reason=RRT_TEXT),
    # Reanimasiya, raised two minutes ago: pending.
    rec("first_seen", K3, "news2", 358),
]


def handover(unit, status, *, out_min=None, in_min=None, expires_min=30.0) -> HandoverFacts:
    at = lambda minute: None if minute is None else T0 + timedelta(minutes=minute)   # noqa: E731
    return HandoverFacts(unit_id=unit, status=status, bridge_expires_at=at(expires_min),
                         outgoing_signed_at=at(out_min), incoming_signed_at=at(in_min))


HANDOVERS = [
    handover(REA, "COMPLETED", out_min=60, in_min=65),           # countersigned in 300 s
    handover(REA, "COMPLETED", out_min=120, in_min=135),         # 900 s
    handover(REA, "OUTGOING_SIGNED", out_min=200),               # waiting
    handover(REA, "OPEN", expires_min=300),                      # past its bridge: expired
    handover(REA, "OPEN", expires_min=370),                      # still inside its bridge
    handover(REA, "EXPIRED"),
    handover(NEO, "COMPLETED", out_min=180, in_min=181),         # 60 s
]


def report(reach: Reach, *, records=TRAIL, handovers=HANDOVERS, truncated=False, window_from=WINDOW_FROM) -> dict:
    return build_report(records=records, key_units=KEY_UNITS, reach=reach, handovers=handovers, now=NOW, days=7,
                        window_from=window_from, truncated=truncated)


EVERYONE = Reach(units=ALL_UNITS, scoped=False)


def test_the_answer_says_its_period_and_how_it_was_read():
    body = report(EVERYONE, truncated=True, window_from=T0.isoformat())
    assert (body["days"], body["generated_at"], body["window_from"]) == (7, NOW.isoformat(), T0.isoformat())
    assert (body["truncated"], body["scoped"]) == (True, False)
    assert set(body) == {"days", "generated_at", "window_from", "truncated", "scoped", "coverage", "units",
                         "unplaced", "hospital"}


def test_each_unit_counts_its_own_alarms_by_the_alarm_quality_rules():
    units = {u["unit_name"]: u for u in report(EVERYONE)["units"]}
    rea = units["Reanimasiya"]["alarms"]
    assert {k: rea[k] for k in ("episodes", "answered", "escalated", "unanswered", "unanswered_resolved",
                                "pending")} == {"episodes": 6, "answered": 3, "escalated": 1, "unanswered": 2,
                                               "unanswered_resolved": 1, "pending": 1}
    assert (rea["answered_rate"], rea["median_response_sec"], rea["p90_response_sec"]) == (0.6, 180.0, 600.0)
    assert rea["per_kind"] == [
        {"kind": "news2", "episodes": 3, "answered": 2, "escalated": 0, "unanswered": 0, "median_response_sec": 120.0},
        {"kind": "spo2_low", "episodes": 2, "answered": 0, "escalated": 0, "unanswered": 2, "median_response_sec": None},
        {"kind": "septic_shock", "episodes": 1, "answered": 1, "escalated": 1, "unanswered": 0,
         "median_response_sec": 600.0},
    ]
    neo = units["Neonatal"]["alarms"]
    assert (neo["episodes"], neo["answered"], neo["median_response_sec"], neo["answered_rate"]) == (1, 1, 240.0, 1.0)


def test_the_units_are_by_name_and_a_unit_with_nothing_is_left_out():
    body = report(EVERYONE)
    assert [(u["unit_id"], u["unit_name"]) for u in body["units"]] == [(str(NEO), "Neonatal"), (str(REA), "Reanimasiya")]
    assert set(body["units"][0]) == {"unit_id", "unit_name", "alarms", "snoozes", "rrt", "handovers"}


def test_snoozes_by_reason_and_severity_and_rrt_calls_are_counted_per_unit():
    units = {u["unit_name"]: u for u in report(EVERYONE)["units"]}
    rea = units["Reanimasiya"]
    assert rea["snoozes"] == {"count": 2, "by_reason": {**{r: 0 for r in SNOOZE_REASONS}, "CLINICAL_DECISION_MADE": 1,
                                                         "OTHER": 1},
                              "by_severity": {"high": 1, "moderate": 1}, "median_minutes": 12.5}
    assert rea["rrt"] == {"count": 1}
    assert units["Neonatal"]["snoozes"]["by_reason"]["ARTEFACT_OR_SIGNAL_NOISE"] == 1
    assert units["Neonatal"]["rrt"] == {"count": 0}


def test_handovers_per_unit_opened_countersigned_waiting_expired_and_their_times():
    units = {u["unit_name"]: u for u in report(EVERYONE)["units"]}
    assert units["Reanimasiya"]["handovers"] == {"opened": 6, "countersigned": 2, "waiting": 1, "expired": 2,
                                                 "median_countersign_sec": 600.0, "p90_countersign_sec": 900.0}
    assert units["Neonatal"]["handovers"]["countersigned"] == 1
    assert handovers_of([], NOW) == {"opened": 0, "countersigned": 0, "waiting": 0, "expired": 0,
                                     "median_countersign_sec": None, "p90_countersign_sec": None}


def test_an_unrestricted_caller_gets_the_unplaced_and_the_whole_hospital():
    body = report(EVERYONE)
    assert body["coverage"] == {"episodes": 9, "placed": 7, "unplaced": 2}
    unplaced = body["unplaced"]
    assert set(unplaced) == {"alarms", "snoozes", "rrt"}                 # every handover has a unit
    assert (unplaced["alarms"]["episodes"], unplaced["alarms"]["answered"], unplaced["alarms"]["unanswered"]) == (2, 1, 1)
    assert (unplaced["snoozes"]["count"], unplaced["rrt"]["count"]) == (1, 1)
    hospital = body["hospital"]
    assert (hospital["alarms"]["episodes"], hospital["alarms"]["answered"], hospital["alarms"]["unanswered"]) == (9, 5, 3)
    assert hospital["alarms"]["answered_rate"] == 0.625
    # Over every episode the caller may see (60, 60, 180, 240, 600 s) — not a mean of the groups' medians (160 s).
    assert (hospital["alarms"]["median_response_sec"], hospital["alarms"]["p90_response_sec"]) == (180.0, 240.0)
    assert (hospital["snoozes"]["count"], hospital["snoozes"]["median_minutes"], hospital["rrt"]["count"]) == (4, 12.5, 2)
    assert hospital["handovers"] == {"opened": 7, "countersigned": 3, "waiting": 1, "expired": 2,
                                     "median_countersign_sec": 300.0, "p90_countersign_sec": 900.0}


def test_a_scoped_caller_gets_her_units_only_and_no_unplaced():
    body = report(Reach(units={REA: "Reanimasiya"}, scoped=True), handovers=HANDOVERS)
    assert body["scoped"] is True and body["unplaced"] is None
    assert [u["unit_name"] for u in body["units"]] == ["Reanimasiya"]
    assert body["coverage"] == {"episodes": 6, "placed": 6, "unplaced": 0}
    assert body["hospital"]["alarms"]["episodes"] == 6
    assert (body["hospital"]["snoozes"]["count"], body["hospital"]["rrt"]["count"]) == (2, 1)
    assert body["hospital"]["handovers"]["opened"] == 6          # Neonatal's handover is not hers


def test_a_caller_who_reaches_nothing_gets_no_unit_and_zeros():
    body = report(Reach(units={}, scoped=True))
    assert (body["units"], body["unplaced"], body["scoped"]) == ([], None, True)
    assert body["coverage"] == {"episodes": 0, "placed": 0, "unplaced": 0}
    alarms = body["hospital"]["alarms"]
    assert (alarms["episodes"], alarms["answered_rate"], alarms["median_response_sec"], alarms["per_kind"]) == (0, None, None, [])
    assert body["hospital"]["snoozes"] == {"count": 0, "by_reason": {r: 0 for r in SNOOZE_REASONS},
                                           "by_severity": {"high": 0, "moderate": 0}, "median_minutes": None}
    assert body["hospital"]["handovers"]["opened"] == 0


def test_an_unrestricted_callers_key_in_a_unit_she_does_not_list_is_unplaced_not_lost():
    body = report(Reach(units={NEO: "Neonatal"}, scoped=False))
    assert body["coverage"] == {"episodes": 9, "placed": 1, "unplaced": 8}


def test_the_answer_names_no_patient_key_no_person_and_no_free_text():
    text = json.dumps(report(EVERYONE), ensure_ascii=False)
    for told in (K1, K2, K3, HIS, MONITOR, "ayse.sentetik", "nurse", OTHER_TEXT, RRT_TEXT):
        assert told not in text, told


def test_snoozes_read_only_well_formed_figures():
    odd = [rec("alert_snooze", K1, "news2", 1, minutes=True, reason=["OTHER"], severity={"high": 1}),
           rec("alert_snooze", K1, "news2", 2, minutes=20, reason="UNKNOWN_CODE", severity="critical")]
    assert snoozes_of(odd) == {"count": 2, "by_reason": {r: 0 for r in SNOOZE_REASONS},
                               "by_severity": {"high": 0, "moderate": 0}, "median_minutes": 20}


def test_the_kinds_read_are_the_episodes_and_the_two_acts():
    assert QUALITY_KINDS == EPISODE_KINDS | {"alert_snooze", "rrt_call"}
