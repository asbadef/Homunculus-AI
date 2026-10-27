"""What a clinician charts, on its way into the engine.

Everything the rules need that no device can measure arrives through here: whether infection is
suspected, the patient's weight, the vasopressor running, the fluid given, the antibiotic
administered, the GCS someone assessed at the bedside.

Until now none of it reached the engine at all. The dashboard let a physician enter a
noradrenaline dose and a fluid volume, wrote them to the browser's own store, and lost them on
reload — so the cardiovascular limb of SOFA read zero on a patient on pressors, "adequate fluid
resuscitation" could never be true, and the sepsis rule returned at its first line forever
because `suspected_infection` had nowhere to come from.

Two rules shape this module:

1. **A clinician may chart only what a clinician observes.** Device channels are not writable
   here. A hand-typed heart rate would be indistinguishable from a monitored one the moment it
   landed, and the board would have no way to tell a reading from a typo.

2. **Every entry is attributable.** The audit record names the account that charted it. A
   clinical fact with no author is not evidence.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import live_keys, sync_alerts
from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.notify import Notifier
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.septic_shock import MAX_SOFA
from homunculus.state.profile import BaselineRange, PatientProfile

# What a clinician is allowed to chart, and the unit each is recorded in. The unit is fixed by
# the engine rather than taken from the caller: the rules read these numbers directly
# (ug/kg/min for pressors, mL for boluses), and a caller free to say "mg/h" would be quietly
# scored on the wrong scale.
CHARTABLE: dict[SignalCode, str] = {
    # The clinical judgement the whole sepsis branch waits on.
    SignalCode.SUSPECTED_INFECTION: "bool",
    # Needed before "30 mL/kg" can mean anything.
    SignalCode.WEIGHT_KG: "kg",
    # Vasopressors and inotropes — SOFA's cardiovascular limb.
    SignalCode.NOREPINEPHRINE_RATE: "ug/kg/min",
    SignalCode.EPINEPHRINE_RATE: "ug/kg/min",
    SignalCode.DOPAMINE_RATE: "ug/kg/min",
    SignalCode.DOBUTAMINE_RATE: "ug/kg/min",
    # Resuscitation and the antibiotic clock.
    SignalCode.CRYSTALLOID_BOLUS_ML: "mL",
    SignalCode.ANTIBIOTIC_ADMINISTERED: "bool",
    # Bedside assessments no monitor produces.
    SignalCode.GCS: "score",
    SignalCode.ACVPU: "ordinal",
    SignalCode.URINE_OUTPUT_ML: "mL",
    SignalCode.SUPPLEMENTAL_OXYGEN: "bool",
    # Labs a clinician transcribes while there is no feed from the laboratory. When the HIS
    # ORU feed opens these arrive on their own and this door stops being the usual way in.
    SignalCode.LACTATE: "mmol/L",
    SignalCode.PLATELETS: "10^3/uL",
    SignalCode.BILIRUBIN: "mg/dL",
    SignalCode.CREATININE: "mg/dL",
    SignalCode.PAO2_FIO2: "ratio",
    SignalCode.FIO2: "fraction",
    SignalCode.ARTERIAL_PH: "pH",
    SignalCode.BICARBONATE: "mmol/L",
    SignalCode.SODIUM: "mmol/L",
    SignalCode.POTASSIUM: "mmol/L",
    SignalCode.HAEMATOCRIT: "%",
    SignalCode.WHITE_CELL_COUNT: "10^3/mm3",
}

# Bounds that catch a slipped decimal point or a wrong unit, not clinical judgement. They are
# deliberately far outside any survivable value: the job here is to refuse 8000 mL/kg-worth of
# typing, never to argue with a clinician about a plausible number.
PLAUSIBLE: dict[SignalCode, tuple[float, float]] = {
    SignalCode.WEIGHT_KG: (0.3, 400.0),          # 300 g preterm to 400 kg
    SignalCode.NOREPINEPHRINE_RATE: (0.0, 20.0),
    SignalCode.EPINEPHRINE_RATE: (0.0, 20.0),
    SignalCode.DOPAMINE_RATE: (0.0, 100.0),
    SignalCode.DOBUTAMINE_RATE: (0.0, 100.0),
    SignalCode.CRYSTALLOID_BOLUS_ML: (0.0, 10000.0),
    SignalCode.GCS: (3.0, 15.0),
    SignalCode.ACVPU: (0.0, 4.0),
    SignalCode.URINE_OUTPUT_ML: (0.0, 5000.0),
    SignalCode.LACTATE: (0.0, 40.0),
    SignalCode.ARTERIAL_PH: (6.5, 8.0),
    SignalCode.FIO2: (0.21, 1.0),
    SignalCode.SODIUM: (80.0, 200.0),
    SignalCode.POTASSIUM: (1.0, 10.0),
    SignalCode.HAEMATOCRIT: (5.0, 75.0),
}

# The flags are recorded as 1.0 / 0.0; anything else is a caller error rather than a value.
_BOOLEAN = {SignalCode.SUSPECTED_INFECTION, SignalCode.ANTIBIOTIC_ADMINISTERED,
            SignalCode.SUPPLEMENTAL_OXYGEN}


# Vitals a clinician may chart a personal baseline range for. These are the parameters NEWS2
# scores against a population threshold — which is precisely the list where "normal" is
# patient-specific: a chronic-AF patient living at 105 bpm scores every hour of every day.
BASELINE_SIGNALS: dict[str, SignalCode] = {
    "heart_rate": SignalCode.HEART_RATE,
    "resp_rate": SignalCode.RESP_RATE,
    "spo2": SignalCode.SPO2,
    "sbp": SignalCode.SBP,
    "temperature": SignalCode.TEMPERATURE,
}


class ClinicalEntryError(ValueError):
    """A charting request that cannot be turned into an observation. Carries a reason for the
    clinician, not a stack trace."""


@dataclass(frozen=True)
class ChartedEntry:
    """One fact a clinician charted, ready for the engine."""
    observation: Observation
    charted_by: str


def _code(raw: str) -> SignalCode:
    try:
        code = SignalCode(raw)
    except ValueError:
        raise ClinicalEntryError(f"bilinmeyen klinik alan: {raw!r}") from None
    if code not in CHARTABLE:
        # Named separately from "unknown" on purpose: this one exists, and the answer is that
        # it comes from a device, so the message should say so rather than deny it exists.
        raise ClinicalEntryError(
            f"{raw!r} elle girilemez — bu alan cihazdan gelir")
    return code


def _value(code: SignalCode, raw) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ClinicalEntryError(f"{code.value}: sayı değil ({raw!r})") from None
    if value != value or value in (float("inf"), float("-inf")):   # NaN / inf
        raise ClinicalEntryError(f"{code.value}: geçersiz sayı")
    if code in _BOOLEAN and value not in (0.0, 1.0):
        raise ClinicalEntryError(f"{code.value}: yalnız 0 veya 1 olabilir")
    low, high = PLAUSIBLE.get(code, (float("-inf"), float("inf")))
    if not (low <= value <= high):
        raise ClinicalEntryError(
            f"{code.value}: {value:g} beklenen aralığın ({low:g}–{high:g}) dışında — "
            f"birim veya ondalık hatası olabilir")
    return value


def build_entries(patient_id: str, entries: list[dict], *, charted_by: str,
                  recorded_at: datetime | None = None) -> list[ChartedEntry]:
    """Turn a charting request into observations, or raise with a reason.

    All-or-nothing: one bad entry rejects the whole request rather than charting some of it.
    A half-applied chart is worse than a refused one, because nobody can tell afterwards which
    half landed.
    """
    if not patient_id or not str(patient_id).strip():
        raise ClinicalEntryError("hasta kimliği boş olamaz")
    if not entries:
        raise ClinicalEntryError("boş kayıt gönderilemez")

    when = recorded_at or datetime.now(timezone.utc)
    if when.tzinfo is None:
        # A timestamp with no zone is the failure mode this project has already been bitten by:
        # the NCE server's local clock ran an hour off the UTC stamp in its own filenames.
        raise ClinicalEntryError("zaman damgası saat dilimi taşımalı")

    built: list[ChartedEntry] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ClinicalEntryError("her kayıt bir nesne olmalı")
        code = _code(str(entry.get("code", "")))
        value = _value(code, entry.get("value"))
        built.append(ChartedEntry(
            observation=Observation(
                patient_id=str(patient_id).strip(),
                code=code,
                value=value,
                unit=CHARTABLE[code],
                timestamp=when,
                # Provenance, not a device: the board and the audit must be able to tell a
                # charted value from a measured one forever after.
                source_device="clinician",
            ),
            charted_by=charted_by,
        ))
    return built


def chart_observations(engine: Engine, store: AckStore, audit: AuditLog, notifier: Notifier,
                       hospital: str, patient_id: str, charted: list[ChartedEntry],
                       now: datetime, escalate_after: timedelta,
                       mirror: Callable[[Observation], None] | None = None) -> list[Alert]:
    """Run charted entries through the engine as the `/clinical` door does, and return the last
    evaluation's alerts (G2-A11, D8 — X62). One function so the admission form can chart through
    it too; the door keeps parsing, the discharged-number drop, the final dedup prune, the frame
    and the answer.

    `now` is the request's one wall-clock instant: each entry is judged at its charted time but
    never past it (G2-A2, X10). After every entry: the lifecycle hook (G2-A1, D4, D7 — charting is
    often what ends an alert), the nurse's dedup re-armed (D5: `[norepinephrine 0, dopamine 5]`
    ends an acknowledged shock and starts a new one inside this loop), the `chart` row and the
    `alert_cleared` rows — the hook before any audit write, so an audit that fails leaves an
    unacknowledged critical on the board. Then the `alert` rows, and a first-seen stamp with its
    row for every firing kind (wall-clock time; audited so a restart keeps the escalation clock;
    a latched kind keeps its episode's stamp and is not stamped anew).

    `mirror(obs)`, when given, hands each entry on after the real evaluation and its lifecycle hook
    — Aşama B's shadow engine (spec D1; the API passes `app.state.shadow_mirror`, which guards
    itself and never raises)."""
    alerts: list[Alert] = []
    for item in charted:
        obs = item.observation
        alerts = engine.ingest(obs, now=min(obs.timestamp, now))
        cleared = sync_alerts(engine, store, obs.patient_id, now)
        if mirror is not None:
            mirror(obs)
        notifier.prune(hospital, live_keys(engine, store))
        audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(),
                                 "charted_by": item.charted_by}))
        for ended in cleared:
            audit.append(AuditEvent(hospital, "alert_cleared", ended.patient_id, ended.kind,
                                    ended.payload(now)))
    for a in alerts:
        audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                {"severity": a.severity, "urgency": a.urgency,
                                 "summary": a.summary, "source": a.source,
                                 "evidence": a.supporting_evidence}))
    for a in engine.active_alerts(patient_id):
        if store.stamp_first_seen(patient_id, a.kind, now, chain_gap=escalate_after):
            audit.append(AuditEvent(hospital, "first_seen", patient_id, a.kind,
                                    {"at": now.isoformat()}))
    return alerts


def profile_from_payload(patient_id: str, payload: dict,
                         base: PatientProfile | None = None) -> PatientProfile:
    """A clinician-charted profile from the request (or the audit record replaying it).

    `base` is the profile already charted for this patient, and a field the payload does not
    mention keeps its charted value. This is a merge and not a replace on purpose: the screens
    that write here are separate — the admission form sends comorbidities, the sepsis panel sends
    a baseline SOFA — and under replace semantics whichever was used second would silently erase
    the other's work. Losing a charted comorbidity because someone typed a baseline is exactly
    the kind of quiet harm this system must not do. The one way to take ranges away is to name
    them: `{"baselines": {}}` (or null) over an existing profile is an explicit clear of every
    range — and, combined with `comorbidities: []`, it may empty the profile entirely.

    Two rules, both from `rules/patient_relative.py`, restated here because this is the door
    the values come through:

    * **We never mint a boundary.** Every range is one a clinician charted for this patient.
      The layer downgrades a NEWS2 finding only when the value sits inside a range a person put
      there, and surfaces an acute change only when it leaves one.
    * **A comorbidity we do not recognise is still recorded.** The admission form takes free
      text ("DM, HT, KOAH"); only some of it maps to something the rules can act on, and the
      rest is context for the clinician reading the card. Dropping it would quietly discard
      what someone took the trouble to write.
    """
    # "absent" and "explicitly empty" are different: an absent key keeps what is charted, an
    # empty list is a clinician clearing it.
    if "comorbidities" in payload:
        raw_comorbidities = payload.get("comorbidities") or []
        if isinstance(raw_comorbidities, str):
            raw_comorbidities = [raw_comorbidities]
        if not isinstance(raw_comorbidities, (list, tuple)):
            raise ClinicalEntryError("comorbidities bir liste olmalı")
        comorbidities = frozenset(
            str(c).strip().lower().replace(" ", "_") for c in raw_comorbidities if str(c).strip()
        )
    else:
        comorbidities = base.comorbidities if base is not None else frozenset()

    # Only null and {} are "no ranges". Anything else that is not an object (`[]`, `""`, `0`, `false`)
    # is refused rather than read as empty: a clinical range must not be cleared by junk.
    raw_baselines = payload.get("baselines")
    if raw_baselines is None:
        raw_baselines = {}
    if not isinstance(raw_baselines, dict):
        raise ClinicalEntryError("baselines bir nesne olmalı")

    baselines: dict[SignalCode, BaselineRange] = {}
    for name, span in raw_baselines.items():
        code = BASELINE_SIGNALS.get(str(name))
        if code is None:
            raise ClinicalEntryError(
                f"{name!r} için bazal aralık tutulmuyor — "
                f"tutulanlar: {', '.join(sorted(BASELINE_SIGNALS))}")
        if not isinstance(span, dict):
            raise ClinicalEntryError(f"{name}: aralık {{low, high}} biçiminde olmalı")
        if isinstance(span.get("low"), bool) or isinstance(span.get("high"), bool):
            # A bool is an int in Python, as `_baseline_sofa` notes: `true` would chart a bound of 1 —
            # a range nobody typed, inside which the layer would downgrade this patient's findings.
            raise ClinicalEntryError(f"{name}: low ve high sayı olmalı")
        try:
            low, high = float(span["low"]), float(span["high"])
        except (KeyError, TypeError, ValueError):
            raise ClinicalEntryError(f"{name}: low ve high sayı olmalı") from None
        if any(v != v or v in (float("inf"), float("-inf")) for v in (low, high)):   # NaN / inf
            # "nan" and "inf" parse as floats, and `low > high` is False with a NaN: a NaN bound would
            # reach every trends read for this patient (JSON refuses it) and replay with the audit.
            raise ClinicalEntryError(f"{name}: geçersiz sayı")
        if low > high:
            # Silently swapping them would hide a data-entry mistake behind a range that looks
            # deliberate, and the layer would then downgrade on a boundary nobody chose.
            raise ClinicalEntryError(f"{name}: alt sınır ({low:g}) üst sınırdan ({high:g}) büyük")
        baselines[code] = BaselineRange(low=low, high=high)

    if not baselines and base is not None and "baselines" not in payload:
        baselines = dict(base.baselines)

    if "baseline_sofa" in payload:
        baseline_sofa = _baseline_sofa(payload.get("baseline_sofa"))
    else:
        baseline_sofa = base.baseline_sofa if base is not None else None

    # An empty set sent over a charted profile is a clinician taking every range away: the trend
    # screen's form writes the whole set, and a range charted in error must be removable even when
    # it is the last thing charted. From nothing there is nothing to clear, and an empty profile is
    # still refused — as is one emptied by a payload that does not name the baselines at all. A
    # present key that is null or {} is a clear (the merge above reads it so): absent keeps,
    # null/{} clears, anything else that is not an object was refused above.
    clearing = base is not None and "baselines" in payload and not raw_baselines
    if not comorbidities and not baselines and baseline_sofa is None and not clearing:
        raise ClinicalEntryError(
            "profil boş olamaz — komorbidite, bazal aralık veya bazal SOFA gerekir")

    return PatientProfile(patient_id=str(patient_id).strip(),
                          comorbidities=comorbidities, baselines=baselines,
                          baseline_sofa=baseline_sofa)


def _baseline_sofa(raw: object) -> int | None:
    """The patient's charted pre-infection SOFA total, or None when nobody charted one.

    Validated hard, because this number *raises* the bar for a sepsis alert: an over-stated
    baseline silences the alert on a genuinely deteriorating patient. A typo has to fail loudly
    rather than quietly buy the patient a higher threshold.
    """
    if raw is None or raw == "":
        return None
    # A bool is an int in Python; True would land here as a baseline of 1.
    if isinstance(raw, bool) or (isinstance(raw, float) and not raw.is_integer()):
        raise ClinicalEntryError("baseline_sofa tam sayı olmalı")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ClinicalEntryError("baseline_sofa tam sayı olmalı") from None
    if not 0 <= value <= MAX_SOFA:
        raise ClinicalEntryError(f"baseline_sofa 0 ile {MAX_SOFA} arasında olmalı (girilen: {value})")
    return value


def profile_to_payload(profile: PatientProfile) -> dict:
    """The audit form of a profile — what `profile_from_payload` reads back on replay."""
    return {
        "comorbidities": sorted(profile.comorbidities),
        "baselines": {
            name: {"low": rng.low, "high": rng.high}
            for name, code in BASELINE_SIGNALS.items()
            if (rng := profile.baselines.get(code)) is not None
        },
        "baseline_sofa": profile.baseline_sofa,
    }
