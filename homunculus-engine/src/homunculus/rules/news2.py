# src/homunculus/rules/news2.py
"""NEWS2 early-warning score (RCP 2017).

Thresholds: Homunculus/wiki/concepts/news2.md (news2-rcp-2017).

Scale 1 only. Scale 2 (the hypercapnic / target-88-92% chart) is senior-authorised
and carries a threshold cell the captured secondary sources disagree on, so it is
deliberately NOT implemented here rather than bake in a value we cannot source.

Per the score's own honesty ethos: a parameter with no recent observation does not
contribute, and the result records which parameters were missing so a partial
aggregate is never presented as a complete NEWS2.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.timeline import PatientState


#: The vault source note every row below is read from (Homunculus/wiki/sources/news2-rcp-2017.md).
#: That note is `capture: extract`: the Scale 1 rows come from its secondary renderings, and the
#: primary RCP chart is not captured in full.
#: Served with the rows by the trends endpoint, so a chart's legend names it.
BANDS_SOURCE = "news2-rcp-2017"


@dataclass(frozen=True)
class Band:
    """One row of a NEWS2 parameter's chart: a value with `low < value <= high` scores `points`.

    `None` is an open side. The vault writes the chart at the chart's own resolution (whole
    numbers; tenths for temperature), e.g. 41–50 → 1, but the engine scores real numbers, and rows
    written that way leave 40 < value < 41 belonging to none of them. So each row's lower edge is
    the previous row's upper edge, exclusive: the rows tile the line with no gap and no overlap,
    and every boundary sits where the if-chains these replaced had it.
    """
    low: float | None
    high: float | None
    points: int

    def as_dict(self) -> dict:
        return {"low": self.low, "high": self.high, "points": self.points}


# The five scored vitals, Scale 1 only, as Homunculus/wiki/concepts/news2.md gives them. ONE source:
# the *_points functions below look a value up here, and the trends endpoint (api/trends.py) serves
# these same rows to the screen that draws them as bands — so a band on a chart and a point in the
# score cannot disagree. Keyed by the names `score()` puts in its breakdown.
NEWS2_BANDS: dict[str, tuple[Band, ...]] = {
    "respiration_rate": (Band(None, 8, 3), Band(8, 11, 1), Band(11, 20, 0), Band(20, 24, 2),
                         Band(24, None, 3)),
    "spo2": (Band(None, 91, 3), Band(91, 93, 2), Band(93, 95, 1), Band(95, None, 0)),
    "systolic_bp": (Band(None, 90, 3), Band(90, 100, 2), Band(100, 110, 1), Band(110, 219, 0),
                    Band(219, None, 3)),
    "pulse": (Band(None, 40, 3), Band(40, 50, 1), Band(50, 90, 0), Band(90, 110, 1),
              Band(110, 130, 2), Band(130, None, 3)),
    "temperature": (Band(None, 35.0, 3), Band(35.0, 36.0, 1), Band(36.0, 38.0, 0),
                    Band(38.0, 39.0, 1), Band(39.0, None, 2)),
}


def points_for(parameter: str, value: float) -> int:
    """The points `value` scores for one of the five vitals, read from NEWS2_BANDS.

    Walked exactly as the if-chains it replaced were walked: the first row whose upper edge the
    value does not exceed, else the last, open row. A value no comparison holds for (NaN) therefore
    still lands where it always landed, so this rewrite moves no score at all
    (tests/test_news2_bands.py holds the old chains as the reference).
    """
    rows = NEWS2_BANDS[parameter]
    for band in rows[:-1]:
        if value <= band.high:
            return band.points
    return rows[-1].points


def resp_rate_points(rr: float) -> int:
    return points_for("respiration_rate", rr)


def spo2_scale1_points(spo2: float) -> int:
    return points_for("spo2", spo2)


def air_or_oxygen_points(*, on_oxygen: bool) -> int:
    return 2 if on_oxygen else 0


def systolic_bp_points(sbp: float) -> int:
    return points_for("systolic_bp", sbp)


def pulse_points(hr: float) -> int:
    return points_for("pulse", hr)


def temperature_points(temp: float) -> int:
    return points_for("temperature", temp)


def consciousness_points(acvpu: float) -> int:
    """ACVPU as an ordinal: 0 = Alert, 1..4 = Confusion/Voice/Pain/Unresponsive."""
    return 0 if acvpu <= 0 else 3


# The five continuous monitor channels. If one is not reporting the aggregate is
# partial (it can only understate), and score() lists it in `missing`.
_CORE_VITALS = ("respiration_rate", "spo2", "systolic_bp", "pulse", "temperature")

# The seven inputs by the names score() puts in its breakdown, and the signal each reads (G2-A2):
# the five vitals, then the two a clinician charts.
_INPUT_SIGNAL: dict[str, SignalCode] = {
    "respiration_rate": SignalCode.RESP_RATE, "spo2": SignalCode.SPO2,
    "systolic_bp": SignalCode.SBP, "pulse": SignalCode.HEART_RATE,
    "temperature": SignalCode.TEMPERATURE,
    "air_or_oxygen": SignalCode.SUPPLEMENTAL_OXYGEN, "consciousness": SignalCode.ACVPU,
}


@dataclass(frozen=True)
class News2Result:
    total: int
    breakdown: dict[str, int]      # parameter name -> points
    missing: list[str] = field(default_factory=list)   # core vitals with no observation
    red_param: bool = False        # any single parameter scored the maximum 3
    # G2-A2 (D1, D4, D7). `stale`: core vitals whose last reading is older than its window at
    # `now`, scored 0 like a missing one. `assumed`: air-or-oxygen and consciousness scored as air
    # and Alert because nothing current is charted — not partial. `measured_at`: when each of the
    # seven inputs was last read, None if never; `fresh_until`: that instant plus the input's
    # window, None if never — in the past for a stale or expired input.
    stale: list[str] = field(default_factory=list)
    assumed: list[str] = field(default_factory=list)
    measured_at: dict[str, datetime | None] = field(default_factory=dict)
    fresh_until: dict[str, datetime | None] = field(default_factory=dict)

    @property
    def partial(self) -> bool:
        # A stale vital is as absent from the total as a missing one (G2-A2, D1): either way the
        # aggregate can only understate.
        return bool(self.missing or self.stale)


def score(state: PatientState, now: datetime | None = None) -> News2Result:
    """Aggregate NEWS2 (Scale 1) from current state.

    Air-or-oxygen defaults to air (0) and consciousness to Alert (0) when not
    recorded — the benign, overwhelmingly-common case, and neither is derivable
    from monitor telemetry. Only the five continuous vitals are treated as
    'missing' when absent, so a partial aggregate is never shown as complete.

    G2-A2. With `now`, a reading speaks for the patient only inside its window (D1): a vital older
    than its `_NEWS2_FRESHNESS` window scores 0 and is listed in `stale`, so the score is partial;
    an air-or-oxygen or ACVPU value charted more than `_CHARTED_FRESHNESS` ago is assumed again
    (D8). Every default is listed in `assumed` and does not make the score partial (D7). An age
    equal to the window is still fresh, and a reading stamped after `now` never ages. Without
    `now` nothing ages (D2): the trend charts read what each value scores, not its share of the
    total. `measured_at` and `fresh_until` name all seven inputs either way (D4).
    """
    breakdown: dict[str, int] = {}
    missing: list[str] = []
    stale: list[str] = []
    assumed: list[str] = []
    measured_at: dict[str, datetime | None] = {}
    fresh_until: dict[str, datetime | None] = {}

    def latest(name: str, window: timedelta) -> tuple[float | None, bool]:
        """The input's last value (None if never), and whether it is older than `window` at `now`."""
        obs = state.latest(_INPUT_SIGNAL[name])
        measured_at[name] = None if obs is None else obs.timestamp
        fresh_until[name] = None if obs is None else obs.timestamp + window
        if obs is None:
            return None, False
        return obs.value, now is not None and now - obs.timestamp > window

    def core(name: str, fn) -> None:
        v, aged = latest(name, _NEWS2_FRESHNESS[_INPUT_SIGNAL[name]])
        if v is None:
            breakdown[name] = 0
            missing.append(name)
        elif aged:
            breakdown[name] = 0
            stale.append(name)
        else:
            breakdown[name] = fn(v)

    def charted(name: str) -> float:
        v, aged = latest(name, _CHARTED_FRESHNESS[_INPUT_SIGNAL[name]])
        if v is None or aged:
            assumed.append(name)
            return 0.0
        return v

    core("respiration_rate", resp_rate_points)
    core("spo2", spo2_scale1_points)
    core("systolic_bp", systolic_bp_points)
    core("pulse", pulse_points)
    core("temperature", temperature_points)

    breakdown["air_or_oxygen"] = air_or_oxygen_points(on_oxygen=charted("air_or_oxygen") >= 1.0)
    breakdown["consciousness"] = consciousness_points(charted("consciousness"))

    total = sum(breakdown.values())
    red_param = any(p >= 3 for p in breakdown.values())
    return News2Result(total=total, breakdown=breakdown, missing=missing, red_param=red_param,
                       stale=stale, assumed=assumed, measured_at=measured_at,
                       fresh_until=fresh_until)


def _band(result: News2Result) -> tuple[Severity, Urgency, str] | None:
    """Map an aggregate to (severity, urgency, response). None = nothing to surface."""
    if result.total >= 7:
        return Severity.HIGH, Urgency.IMMEDIATE, "high risk — immediate emergency-team review"
    if result.total >= 5:
        return Severity.MODERATE, Urgency.SOON, "medium risk — urgent clinician review"
    if result.red_param:
        return Severity.MODERATE, Urgency.SOON, "single parameter scoring 3 — urgent ward review for the cause"
    return None


# NEWS2 inputs are all continuous vitals — they go stale in minutes, not hours. Operational
# data-recency defaults (configurable), not clinical claims (mirrors the SOFA staleness approach).
# Since G2-A2 (D1) a vital older than its window leaves the total (`score(state, now)`).
_NEWS2_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.RESP_RATE: timedelta(hours=1), SignalCode.SPO2: timedelta(hours=1),
    SignalCode.SBP: timedelta(hours=1), SignalCode.HEART_RATE: timedelta(hours=1),
    SignalCode.TEMPERATURE: timedelta(hours=2),
}
# The two inputs a clinician charts and no monitor sends (G2-A2, D8): a charted oxygen or ACVPU
# speaks for one nursing shift, then the input is assumed again (air, Alert) and says so.
# Operational defaults like the windows above, not clinical claims. The clock runs from the
# observation's own time — the chart's `recorded_at`.
_CHARTED_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.SUPPLEMENTAL_OXYGEN: timedelta(hours=8), SignalCode.ACVPU: timedelta(hours=8),
}
_VITAL_LABEL: dict[SignalCode, str] = {
    SignalCode.RESP_RATE: "resp rate", SignalCode.SPO2: "SpO2", SignalCode.SBP: "systolic BP",
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}
#: How the reasoning names each of the seven inputs, keyed by the names `score()` puts in its
#: breakdown: the vitals as the recency note (and `stale_inputs`) names them, the two charted inputs
#: as the patient-relative notes do. One word per input in every note, a held alert's (pipeline,
#: G2-A2 X9) included; a breakdown key is never shown.
INPUT_LABEL: dict[str, str] = {
    **{name: _VITAL_LABEL[_INPUT_SIGNAL[name]] for name in _CORE_VITALS},
    "air_or_oxygen": "supplemental oxygen", "consciousness": "consciousness",
}
# What an assumed input was scored as, in the alert's reasoning (G2-A2, D7).
_ASSUMED_AS: dict[str, str] = {"air_or_oxygen": "room air", "consciousness": "Alert"}


def _stale_vital_labels(state: PatientState, now: datetime) -> list[str]:
    aged: list[tuple[str, timedelta]] = []
    for code, window in _NEWS2_FRESHNESS.items():
        age = state.age(code, now)
        if age is not None and age > window:
            aged.append((_VITAL_LABEL[code], age))
    aged.sort(key=lambda kv: kv[1], reverse=True)
    return [label for label, _age in aged]


def evaluate(state: PatientState, now: datetime | None = None) -> list[Finding]:
    # The board's score, judged at the same instant (G2-A2, D6): a stale vital can no longer lift
    # the alert into a band the card's total does not reach — one NEWS2, one number.
    result = score(state, now)
    band = _band(result)
    if band is None:
        return []
    severity, urgency, response = band

    contributing = ", ".join(
        f"{INPUT_LABEL[name]} {pts}" for name, pts in result.breakdown.items() if pts > 0
    )
    partial_note = ""
    if result.partial:
        # Missing and stale alike, in breakdown order (G2-A2, X1): neither is in the total.
        absent = [INPUT_LABEL[name] for name in result.breakdown
                  if name in result.missing or name in result.stale]
        partial_note = (
            f" This is a partial NEWS2: {', '.join(absent)} not recently recorded, "
            f"so the true aggregate can only be higher."
        )
    stale = _stale_vital_labels(state, now) if now is not None else []
    stale_note = ""
    if stale:
        # Since G2-A2 (D1) a stale vital scores 0: the note says it is out, not to be borne in mind.
        stale_note = (f" Data recency: {', '.join(stale)} older than the expected refresh window; "
                      f"not counted in the score.")
    assumed_note = ""
    if result.assumed:
        # G2-A2 (D7): an assumption is said out loud, and is not counted as partial.
        assumed_note = (" Assumed, nothing current charted: "
                        + ", ".join(f"{INPUT_LABEL[name]} as {_ASSUMED_AS[name]}"
                                    for name in result.assumed) + ".")
    reasoning = (
        f"NEWS2 {result.total} ({response}). Contributing: {contributing}. "
        f"Screen for deterioration, not a diagnosis; the response is review, not an order."
        f"{partial_note}{stale_note}{assumed_note}"
    )
    return [Finding(
        kind="news2",
        severity=severity,
        urgency=urgency,
        summary=f"NEWS2 {result.total} — {response.split(' — ')[0]}",
        reasoning=reasoning,
        citations=[Citation("news2-rcp-2017", "aggregate NEWS2 score, risk band and escalation response")],
        stale_inputs=stale,
    )]
