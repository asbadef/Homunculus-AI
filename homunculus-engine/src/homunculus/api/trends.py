# src/homunculus/api/trends.py
"""One patient's vital history, as the trend charts draw it (GET /patients/{id}/trends).

The browser draws and never scores (spec D1). Everything a chart needs in order to be honest is
decided here, by the engine: the series, how the latest value moved since the previous one, its
NEWS2 points, whether it sits inside the normal a clinician charted for this patient, the NEWS2 rows
as bands, and the moments an alarm episode began or an antibiotic dose was charted. A threshold has
ONE home — `rules/news2.py` `NEWS2_BANDS` — and this module serves that table rather than restating
it, so a band on a chart and a point in the score cannot disagree.

Since G3-01 (D13, X1) it also lists each channel's HAND entries in the window — the bedside form's and every
other door's — with their withdrawal («hatalı giriş») when there is one, read from the trail like the marks:
the drawn `points` are the engine's, a withdrawn value gone from them; `manual` is what was typed, and by whom.
Since G3-05 (D16) it lists each channel's DEVICE readings the same way (`device`: the `ingest` rows, each with
the device that sent it and its withdrawal), so the trend table can say «cihaz» and offer «Düzelt» on one.

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
from datetime import datetime, timedelta, timezone

from homunculus.api.alarm_quality import _event_time
from homunculus.api.audit import AuditLog
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT
from homunculus.api.rehydrate import device_key_of, withdrawal_key     # G3-05: one device reading, one key
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.rules.news2 import BANDS_SOURCE, NEWS2_BANDS, points_for, score as news2_score
from homunculus.state.profile import BaselineRange
from homunculus.state.timeline import PatientState, thin

#: The windows the screen offers: 6 hours, 24 hours, 3 days. Any other is refused.
TRENDS_HOURS = (6, 24, 72)
#: Above this many readings in a window a channel is thinned (`state/timeline.py` `thin`), D8.
TRENDS_MAX_POINTS = 2000
#: The most alarm-episode rows kept for one patient's window. An episode is a `first_seen` row.
#: Since G2-A1 (O17) the engine drops a kind from `active_alerts` on the first reading that does not
#: produce it (pipeline.py), the stamp is pruned with it and stamped again when the kind returns: a ▲
#: on a chart means "an alert began here", once per episode. A flapping alert therefore writes a
#: `first_seen` row each time it comes back — about 30 an hour at one reading a minute, about 2 160
#: in the 72-hour window — and this bound sits above that. The read is oldest-first
#: (`records` orders by id), so a window that ever held more would lose its NEWEST marks; the read
#: asks for one row more than the limit, and `markers_truncated` is true only when that extra row
#: came back, i.e. when something was actually cut.
TRENDS_MARKER_LIMIT = 5000
#: G3-01 (D13, X1): the most hand-entry rows (charted and withdrawn together) one trends read keeps — the
#: NEWEST ones. A ward charting the bedside set every hour writes about 6 × 72 = 432 `chart` rows in the 3-day
#: window; this sits far above it, and `manual_truncated` says when a read had to cut. A cut loses the OLDEST
#: entries: a withdrawal is written after the row it withdraws, so a row that is kept keeps its withdrawal.
TRENDS_MANUAL_LIMIT = 5000

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


def _finite(series: list[Observation]) -> list[Observation]:
    """The readings whose value is a number. NaN and ±inf are not measurements: the gateways refuse
    them now, but rows from before that still replay from the audit into PatientState (`rehydrate`
    passes no gateway), and one left in would break the JSON answer (Starlette's JSONResponse
    refuses NaN, so the read would answer 500) and `thin()` (a NaN first in a slice takes its
    minimum and maximum — `thin` stays NaN-intolerant on purpose; this is where they stop)."""
    return [o for o in series if math.isfinite(o.value)]


def _latest(state: PatientState, key: str, code: SignalCode, breakdown: dict[str, int],
            baseline: BaselineRange | None) -> dict | None:
    recorded = state.history(code)
    history = _finite(recorded)
    if not history:
        return None
    last = history[-1]
    # The previous MEASUREMENT: a reading at the same instant is the same one delivered again
    # (edge/uplink.py is at-least-once) or its twin, never "the previous".
    previous = next((o for o in reversed(history) if o.timestamp < last.timestamp), None)
    parameter = _NEWS2_PARAMETER.get(key)
    # The engine's breakdown scores the newest reading. When that one is not a number it is not
    # `last`: its points are not this value's to print, and neither is a verdict on the patient's own
    # normal — the engine's `acute_change` finding (`patient_relative`) is judged on the newest
    # reading, and an older finite value called "within normal" beside it could tell the clinician
    # the opposite of what the engine is saying.
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
        # Judged here, against the range a clinician charted; None when nobody charted one, and None
        # when the newest reading is not a number (see `scored` above).
        "within_own_normal": (None if baseline is None or not scored
                              else baseline.contains(last.value)),
    }


def _markers(state: PatientState, audit: AuditLog, hospital: str, patient_id: str,
             since: datetime, until: datetime) -> tuple[list[dict], bool]:
    """When an alarm episode began, and when an antibiotic dose was charted, in time order — and
    whether the episode read had to cut rows off at its limit.

    An alarm is its `first_seen` row, not its `alert` rows: the engine re-emits an active alert on
    every reading, so the `alert` rows count how often the monitor sampled, not how often the ward
    was asked to look (`api/alarm_quality.py` makes the same choice for the same reason). Its instant
    is the escalation clock's own (`payload["at"]`, else the row's `ts`), written in UTC like every
    other instant in the answer.

    The read asks for one row more than `TRENDS_MARKER_LIMIT` and keeps the limit: the extra row is
    the proof that something was cut, so exactly the limit is not "truncated".
    """
    found: list[tuple[datetime, dict]] = []
    fetched = audit.records(tenant=hospital, patient_id=patient_id, event_type="first_seen",
                            since=since, limit=TRENDS_MARKER_LIMIT + 1)
    truncated = len(fetched) > TRENDS_MARKER_LIMIT
    for rec in fetched[:TRENDS_MARKER_LIMIT]:
        at = _event_time(rec)
        if at is not None and since <= at <= until:
            at = at.astimezone(timezone.utc)
            found.append((at, {"ts": at.isoformat(), "kind": "alarm", "label": rec.subject}))
    for obs in state.window(SignalCode.ANTIBIOTIC_ADMINISTERED, since, until):
        # A charted 0 is "not given" (api/board.py `_meds`), never a dose on the time axis.
        if obs.value >= 1.0:
            at = obs.timestamp.astimezone(timezone.utc)
            found.append((at, {"ts": at.isoformat(), "kind": "antibiotic",
                               "label": SignalCode.ANTIBIOTIC_ADMINISTERED.value}))
    found.sort(key=lambda pair: pair[0])
    return [marker for _at, marker in found], truncated


def _instant(text) -> datetime | None:
    """An ISO instant that carries a zone, or None."""
    try:
        at = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    return at if at.tzinfo is not None else None


def _finite_number(value) -> bool:
    """A JSON number the answer can carry: not a bool, finite, and — an int — small enough to be a float.
    `math.isfinite` raises OverflowError for an int past the float range, and the read would answer 500 for as
    long as the row sat in the window."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _manual(audit: AuditLog, hospital: str, patient_id: str, since: datetime,
            until: datetime) -> tuple[dict[str, list[dict]], dict[str, list[dict]], bool]:
    """Each published channel's hand entries measured in [since, until], in the order they were written, each
    with its withdrawal when there is one (G3-01, D13, X1) — and, since G3-05 (D16), its device readings the
    same way, from the same read: `(manual, device, truncated)`. A device entry is `{entry, at, value, source,
    retracted}`: `entry` the `ingest` row «Düzelt» names, `source` the device as it named itself.

    A hand entry is paired with its withdrawal by its own row id. A device entry is paired by the reading
    (`rehydrate.device_key`): a reading the trail holds twice is one reading, the engine skips every copy of a
    withdrawn one, and a withdrawal names only one `ingest` row — so every copy is listed and every copy carries
    the withdrawal (the earliest written), whichever row the nurse named. A copy is never collapsed away: the
    list is what the trail holds, marked as the engine counts it.

    Read from the trail, as the marks are, so the live door, the admission form's charting and a restart all
    show one list. One bounded read of the patient's `chart` and `chart_retract` rows is enough, for two reasons
    that the read's two bounds follow:
      * the NEWEST rows are kept (`newest=True`, returned oldest first, so `manual` stays in write order). A
        withdrawal is written after the row it withdraws, so a kept chart row keeps its withdrawal and a cut
        loses only the oldest entries, `manual_truncated` saying so. Kept the other way (the oldest rows), a
        withdrawal behind the cut would leave an entry the engine dropped shown as not withdrawn.
      * a row is written at or after the time it records, except a bedside value the door lets run up to
        `BEDSIDE_SKEW` ahead of its write. The read therefore starts `BEDSIDE_SKEW` before `since`, and the
        time filter below keeps the exact bound. A lactate (no future bound at the door) dated ahead and
        written before the window start is the one hole left.
    A value the trail cannot read is left out, never shown as 0: not a finite number, or a time with no zone.
    Who: the `charted_by` the door wrote, the `retracted_by` the withdrawal wrote."""
    fetched = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", "ingest", RETRACT},
                            since=since - BEDSIDE_SKEW, limit=TRENDS_MANUAL_LIMIT + 1, newest=True)
    truncated = len(fetched) > TRENDS_MANUAL_LIMIT
    rows = fetched[max(len(fetched) - TRENDS_MANUAL_LIMIT, 0):]    # drop the extra, OLDEST row
    withdrawn: dict[int, dict] = {}                # by the row a withdrawal names: a hand entry's id
    withdrawn_reading: dict[tuple, dict] = {}      # by the reading it withdrew (`device_key`): a device reading
    for rec in rows:
        if rec.event_type != RETRACT:
            continue
        at = _instant(rec.ts)
        mark = {"reason": str(rec.payload.get("reason") or ""),
                "by": str(rec.payload.get("retracted_by") or ""),
                "at": at.astimezone(timezone.utc).isoformat() if at is not None else None}
        entry = rec.payload.get("entry")
        if isinstance(entry, int) and not isinstance(entry, bool):
            withdrawn[entry] = mark
        key = withdrawal_key(rec)                  # None unless the withdrawal says `"origin": "device"`
        if key is not None:
            withdrawn_reading.setdefault(key, mark)    # rows come oldest first: the first withdrawal stands
    out: dict[str, list[dict]] = {key: [] for key in _PUBLISHED_SIGNALS}
    device: dict[str, list[dict]] = {key: [] for key in _PUBLISHED_SIGNALS}
    for rec in rows:
        if rec.event_type not in ("chart", "ingest") or rec.subject not in out:
            continue
        at = _instant(rec.payload.get("obs_ts"))
        value = rec.payload.get("value")
        if at is None or not since <= at <= until or not _finite_number(value):
            continue
        if rec.event_type == "ingest":
            mark = withdrawn.get(rec.id) or withdrawn_reading.get(device_key_of(rec))
            device[rec.subject].append({
                "entry": rec.id, "at": at.astimezone(timezone.utc).isoformat(), "value": value,
                "source": str(rec.payload.get("device") or ""), "retracted": None if mark is None else dict(mark),
            })
            continue
        out[rec.subject].append({
            "entry": rec.id, "at": at.astimezone(timezone.utc).isoformat(), "value": value,
            "by": str(rec.payload.get("charted_by") or ""), "retracted": withdrawn.get(rec.id),
        })
    return out, device, truncated


def patient_trends(engine: Engine, audit: AuditLog, *, hospital: str, patient_id: str,
                   hours: int, now: datetime) -> dict:
    """The trends response for `patient_id` over the `hours` before `now` (spec §4)."""
    if hours not in TRENDS_HOURS:
        raise ValueError(f"hours must be one of {TRENDS_HOURS}, not {hours!r}")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must carry a time zone")
    # The window is cut in UTC and `since`/`until`/`generated_at` are written `+00:00`, whatever zone
    # the caller's clock wore; the marks are written in UTC too.
    now = now.astimezone(timezone.utc)
    state = (engine.state(patient_id) if patient_id in set(engine.patient_ids())
             else PatientState(patient_id))
    profile = engine.profile(patient_id)
    breakdown = news2_score(state).breakdown
    since, until = now - timedelta(hours=hours), now

    manual, device, manual_truncated = _manual(audit, hospital, patient_id, since, until)   # G3-01 (D13, X1); G3-05 (D16)
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
            # G3-01 (D13): what was typed into this channel in the window, a withdrawn value included and marked.
            "manual": manual[key],
            # G3-05 (D16): what a device sent into this channel in the window, a withdrawn value included and marked.
            "device": device[key],
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
        "manual_truncated": manual_truncated,
    }
