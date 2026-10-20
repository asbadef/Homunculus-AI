# src/homunculus/api/trends.py
"""One patient's vital history, as the trend charts draw it (GET /patients/{id}/trends).

The browser draws and never scores (spec D1). Everything a chart needs in order to be honest is
decided here, by the engine: the series, how the latest value moved since the previous one, its
NEWS2 points, whether it sits inside the normal a clinician charted for this patient, the NEWS2 rows
as bands, and the moments an alarm episode began or an antibiotic dose was charted. A threshold has
ONE home — `rules/news2.py` `NEWS2_BANDS` — and this module serves that table rather than restating
it, so a band on a chart and a point in the score cannot disagree.

What it deliberately does not do:
  * chart Aşama A's monitor values. That lane keeps no history, binds no patient and is unvalidated
    (spec D7); this module imports nothing of it (tests/test_infinity_shadow_isolation.py).
  * serve the device's own alarm limits. Stage B validates them; `bands.device` is reserved as None
    now so the response's shape does not change then (D9).
  * write an audit row. Opening the patient already wrote `view`; a chart read every minute would
    bury that record under its own.
  * create a patient. `Engine.state()` creates the id it is asked about; an id the engine has not
    measured is read from an empty state instead — the rule `_score_state` keeps for the score forms.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

from homunculus.api.alarm_quality import _event_time
from homunculus.api.audit import AuditLog
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.rules.news2 import BANDS_SOURCE, NEWS2_BANDS, points_for, score as news2_score
from homunculus.state.timeline import PatientState, thin

#: The windows the screen offers: 6 hours, 24 hours, 3 days. Any other is refused.
TRENDS_HOURS = (6, 24, 72)
#: Above this many readings in a window a channel is thinned (`state/timeline.py` `thin`), D8.
TRENDS_MAX_POINTS = 2000
#: The most alarm-episode rows read for one patient's window. An episode is a `first_seen` row, and
#: `AckStore.prune` drops the stamp when an alert clears, so a flapping alert writes one each time it
#: comes back — about 30 an hour at one reading a minute, about 2 160 in the 72-hour window. The bound
#: sits above that. The read is oldest-first (`records` orders by id), so a window that ever holds
#: more loses its NEWEST marks — and the answer says so in `markers_truncated`.
TRENDS_MARKER_LIMIT = 5000

# The NEWS2 parameter each published channel is — the names `score()` puts in its breakdown and
# NEWS2_BANDS is keyed by. MAP and lactate are not NEWS2 parameters: no band, no points.
_NEWS2_PARAMETER = {
    "heart_rate": "pulse", "resp_rate": "respiration_rate", "spo2": "spo2",
    "sbp": "systolic_bp", "temperature": "temperature",
}

# The scale the rules read each channel's number on — what `api/clinical.py` CHARTABLE fixes for a
# charted value and what the NEWS2 rows are written in. Informational: the screen prints its own
# unit words (dashboard `vitals.js`).
_UNITS = {
    "heart_rate": "/min", "map": "mmHg", "sbp": "mmHg", "spo2": "%",
    "temperature": "°C", "resp_rate": "/min", "lactate": "mmol/L",
}


def _finite(observations: list) -> list:
    """The readings whose value is a number. NaN and ±inf are not measurements: the gateways refuse
    them now, but rows from before that still replay from the audit into PatientState (`rehydrate`
    passes no gateway), and one left in would break the JSON answer (Starlette's JSONResponse
    refuses NaN, so the read would answer 500) and `thin()` (a NaN first in a slice takes its
    minimum and maximum — `thin` stays NaN-intolerant on purpose; this is where they stop)."""
    return [o for o in observations if math.isfinite(o.value)]


def _latest(state: PatientState, key: str, code: SignalCode, breakdown: dict[str, int],
            baseline) -> dict | None:
    recorded = state.history(code)
    history = _finite(recorded)
    if not history:
        return None
    last = history[-1]
    previous = history[-2] if len(history) > 1 else None
    parameter = _NEWS2_PARAMETER.get(key)
    # The engine's breakdown scores the newest reading. When that one is not a number it is not
    # `last`, and its points are not this value's to print.
    scored = recorded[-1] is last
    return {
        "ts": last.timestamp.isoformat(),
        "value": last.value,
        # Over the whole history, not the window: "since the previous measurement" is a fact about
        # the patient, and a 6-hour window must not turn a change into "no previous one". Rounded,
        # because 37.2 − 36.9 is 0.30000000000000426 in binary and 0.3 at the bedside.
        "delta": None if previous is None else round(last.value - previous.value, 2),
        # The engine's own NEWS2 breakdown — the same number the board's score is built from.
        "news2_points": breakdown.get(parameter) if parameter is not None and scored else None,
        # Judged here, against the range a clinician charted; None when nobody charted one.
        "within_own_normal": None if baseline is None else baseline.contains(last.value),
    }


def _markers(state: PatientState, audit: AuditLog, hospital: str, patient_id: str,
             since: datetime, until: datetime) -> tuple[list[dict], bool]:
    """When an alarm episode began, and when an antibiotic dose was charted, in time order — and
    whether the episode read stopped at its limit.

    An alarm is its `first_seen` row, not its `alert` rows: the engine re-emits an active alert on
    every reading, so the `alert` rows count how often the monitor sampled, not how often the ward
    was asked to look (`api/alarm_quality.py` makes the same choice for the same reason). Its instant
    is the escalation clock's own (`payload["at"]`, else the row's `ts`).
    """
    found: list[tuple[datetime, dict]] = []
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_type="first_seen",
                         since=since, limit=TRENDS_MARKER_LIMIT)
    for rec in rows:
        at = _event_time(rec)
        if at is not None and since <= at <= until:
            found.append((at, {"ts": at.isoformat(), "kind": "alarm", "label": rec.subject}))
    for obs in state.window(SignalCode.ANTIBIOTIC_ADMINISTERED, since, until):
        # A charted 0 is "not given" (api/board.py `_meds`), never a dose on the time axis.
        if obs.value >= 1.0:
            found.append((obs.timestamp, {"ts": obs.timestamp.isoformat(), "kind": "antibiotic",
                                          "label": SignalCode.ANTIBIOTIC_ADMINISTERED.value}))
    found.sort(key=lambda pair: pair[0])
    return [marker for _at, marker in found], len(rows) >= TRENDS_MARKER_LIMIT


def patient_trends(engine: Engine, audit: AuditLog, *, hospital: str, patient_id: str,
                   hours: int, now: datetime) -> dict:
    """The trends response for `patient_id` over the `hours` before `now` (spec §4)."""
    if hours not in TRENDS_HOURS:
        raise ValueError(f"hours must be one of {TRENDS_HOURS}, not {hours!r}")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must carry a time zone")
    state = (engine.state(patient_id) if patient_id in set(engine.patient_ids())
             else PatientState(patient_id))
    profile = engine.profile(patient_id)
    breakdown = news2_score(state).breakdown
    since, until = now - timedelta(hours=hours), now

    channels = []
    for key, code in _PUBLISHED_SIGNALS.items():
        window = _finite(state.window(code, since, until))
        kept = thin(window, TRENDS_MAX_POINTS)
        parameter = _NEWS2_PARAMETER.get(key)
        baseline = profile.baselines.get(code) if profile is not None else None
        channels.append({
            "key": key,
            "unit": _UNITS[key],
            # [instant, value, the NEWS2 points that value scores] — the third so the table view
            # prints the engine's points for every reading instead of looking a band up itself.
            "points": [[o.timestamp.isoformat(), o.value,
                        points_for(parameter, o.value) if parameter is not None else None]
                       for o in kept],
            "thinned": len(window) > TRENDS_MAX_POINTS,
            "total_points": len(window),
            "latest": _latest(state, key, code, breakdown, baseline),
            "bands": {
                "news2": ([band.as_dict() for band in NEWS2_BANDS[parameter]]
                          if parameter is not None else None),
                "own_normal": (None if baseline is None
                               else {"low": baseline.low, "high": baseline.high}),
                "device": None,
            },
        })

    markers, markers_truncated = _markers(state, audit, hospital, patient_id, since, until)
    return {
        "patient_id": patient_id,
        "hours": hours,
        "since": since.isoformat(),
        "until": until.isoformat(),
        # The instant the window was cut at: the same as `until`, named for what it is.
        "generated_at": now.isoformat(),
        "bands_source": BANDS_SOURCE,
        "news2_scale": 1,
        "channels": channels,
        "markers": markers,
        "markers_truncated": markers_truncated,
    }
