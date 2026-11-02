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

1. **A typed value is always told from a measured one.** Every observation this door builds is
   stamped `source_device` "clinician", and the board prints it «elle». Until G3-01 the device
   channels were not writable here at all. Since then the bedside set — the five vitals and MAP — is
   (G3-01, D5): the ward's HIS feed that carried a nurse's vitals is silent, and the monitors feed
   only the shadow engine. A wrong hand entry is withdrawn as «hatalı giriş», never edited
   (`api/app.py`, the retract route, which rebuilds the patient without it). One device-derived flag
   was chartable before them: `ON_RESP_SUPPORT` (G2-A4, X16 — see its `CHARTABLE` entry for why).

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
    # G2-A4 (D4, X16): whether the patient is on respiratory support — the fact the 3- and 4-point
    # PaO2/FiO2 bands turn on (rules/sofa.py `respiration_points_of`). The ventilator bridge infers it
    # (medibus: a ventilator answering its poll is support, and it only ever says yes); no ventilator
    # feeds the ward, and whether a patient is supported is seen at the bedside, so this is a clinician's
    # observation as much as a device's. Charted here it reaches both SOFAs: the form's
    # (scoring/sofa_form.py — each ratio scored on the support in force at its own time, D13) and the alerting
    # one (rules/sofa.py reads the latest). A flag, 1 or 0 (`_BOOLEAN`).
    SignalCode.ON_RESP_SUPPORT: "bool",
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
    # G3-01 (D5, X6): the bedside set a nurse measures and types — the five vitals and MAP. Each keeps the
    # provenance `build_entries` stamps ("clinician"), which the board prints as «elle». The units are the
    # trend endpoint's (`api/trends.py` `_UNITS`), pinned equal by tests/test_bedside_door.py; no rule reads one.
    SignalCode.RESP_RATE: "/min",
    SignalCode.SPO2: "%",
    SignalCode.SBP: "mmHg",
    SignalCode.MAP: "mmHg",
    SignalCode.HEART_RATE: "/min",
    SignalCode.TEMPERATURE: "°C",
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
    # G2-A4 (D4): the SOFA form's labs, in the units CHARTABLE fixes. Engineering bounds against a slipped
    # digit or a unit — a creatinine typed in µmol/L above 40 is refused, one below 40 is not; a PaO2/FiO2
    # worked out with FiO2 as a percentage lands far below 20 — never clinical thresholds: the band tables
    # in rules/sofa.py stay the only place a value is judged. A bilirubin typed in µmol/L can still fall
    # inside 0–60, as a creatinine below 40 can; the unit printed beside the field is the guard there
    # (D11; plan O12). Platelets and
    # creatinine sit far enough out to keep this header's promise (X18): rare survivable values exist above
    # 2000 and 30, and past those the points no longer change (0 and 4), so refusing them would only force
    # a false entry.
    SignalCode.PLATELETS: (0.0, 5000.0),          # ×10³/µL
    SignalCode.BILIRUBIN: (0.0, 60.0),            # mg/dL
    SignalCode.CREATININE: (0.0, 40.0),           # mg/dL
    SignalCode.PAO2_FIO2: (20.0, 700.0),          # mmHg (CHARTABLE: "ratio")
    # G3-01 (D6): the bedside set's slip bounds — a slipped digit or a unit, never a clinical threshold: NEWS2's
    # bands live in rules/news2.py alone. MAP's is the SOFA correction's (X7).
    SignalCode.RESP_RATE: (0.0, 80.0),            # /min
    SignalCode.SPO2: (0.0, 100.0),                # %
    SignalCode.SBP: (0.0, 300.0),                 # mmHg
    SignalCode.MAP: (0.0, 300.0),                 # mmHg
    SignalCode.HEART_RATE: (0.0, 300.0),          # /min
    SignalCode.TEMPERATURE: (25.0, 45.0),         # °C
}

# G2-A4 review: the refusal of a GCS that is not a whole number — at this door, and for a SOFA correction
# (api/app.py `_sofa_to_sign`), in one sentence.
GCS_NOT_WHOLE = "GCS tam sayı olmalı"

#: G3-01 (D6): the bedside values counted in whole units, as a monitor shows them and the form asks for them.
WHOLE_VITALS = frozenset({SignalCode.RESP_RATE, SignalCode.SPO2, SignalCode.SBP, SignalCode.MAP,
                          SignalCode.HEART_RATE})
NOT_WHOLE = "{code}: tam sayı olmalı"
#: G3-01 (D6): within one request — one form — the mean pressure is below the systolic.
MAP_NOT_BELOW_SBP = "MAP sistolik basınçtan küçük olmalı"
#: G3-01 (D7, X12): the six codes this slice opened, held to the measurement-time rule when a time is sent:
#: at most a day back, never ahead (two minutes of clock skew allowed). The other codes keep today's rule.
BEDSIDE_VITALS = frozenset({SignalCode.RESP_RATE, SignalCode.SPO2, SignalCode.SBP, SignalCode.MAP,
                            SignalCode.HEART_RATE, SignalCode.TEMPERATURE})
BEDSIDE_BACKDATE = timedelta(hours=24)
BEDSIDE_SKEW = timedelta(minutes=2)
AT_TOO_OLD = "ölçüm saati en çok 24 saat geriye alınabilir"
AT_FUTURE = "ölçüm saati ileri olamaz"
#: G3-01 (D10, D12): the audit row a «hatalı giriş» writes — `{entry, code, value, obs_ts, reason, retracted_by}`,
#: subject the code too; `entry` is the withdrawn `chart` row's id. The replay and the rebuild skip that row.
RETRACT = "chart_retract"
#: G3-01 (D10, D11, X11): the withdrawal's reason, after trim, and its refusals in the clinician's words.
RETRACT_MIN_REASON_CHARS = 10
RETRACT_REASON_SHORT = "gerekçe en az 10 karakter olmalı"
#: Review of G3-01: as admin/schemas.py `_REASON_MAX` — the reason is plaintext in the append-only trail, kept for
#: good, and the trends answer carries it on every poll for the window; unbounded, a body could fill it to nginx's
#: body limit.
RETRACT_MAX_REASON_CHARS = 200
RETRACT_REASON_LONG = "gerekçe en çok 200 karakter olabilir"
#: G3-01 (X22, the local walk): what «hatalı giriş» may withdraw — the bedside form's set (G3-01 D2): the six
#: BEDSIDE_VITALS, supplemental oxygen and ACVPU, by the slug a `chart` row carries as its subject. Other chart rows
#: — a physician's suspected-infection mark, the SOFA form's labs, the meds chart — are corrected by a new entry,
#: not withdrawn (X22); the sepsis panel says so of its mark.
RETRACTABLE_CODES = frozenset(code.value for code in
                              BEDSIDE_VITALS | {SignalCode.SUPPLEMENTAL_OXYGEN, SignalCode.ACVPU})
RETRACT_NOT_BEDSIDE = "yalnız yatak başı ölçümü hatalı giriş olarak işaretlenebilir"
RETRACT_NEEDS_PERSON = "geri alma bir kişinin işidir — cihaz kimliğiyle yapılamaz"
RETRACT_UNKNOWN = "bu hastada böyle bir elle girilmiş değer yok"
#: The dashboard tells «already withdrawn» from the other 409s by this exact sentence (apiErrors.js).
RETRACT_ALREADY = "bu değer zaten hatalı giriş olarak işaretlenmiş"
RETRACT_DISCHARGED = "taburcu edilmiş bir hastada değer geri alınamaz"

# The flags are recorded as 1.0 / 0.0; anything else is a caller error rather than a value.
_BOOLEAN = {SignalCode.SUSPECTED_INFECTION, SignalCode.ANTIBIOTIC_ADMINISTERED,
            SignalCode.SUPPLEMENTAL_OXYGEN, SignalCode.ON_RESP_SUPPORT}   # G2-A4 (D4)


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
    # G3-01 review: a bool is an int in Python, so a JSON `true` would chart a heart rate of 1 (a NEWS2 red
    # parameter) and `false` a 0 inside every bound. Only the flags (`_BOOLEAN`) are sent as true / false.
    if isinstance(raw, bool) and code not in _BOOLEAN:
        raise ClinicalEntryError(f"{code.value}: sayı değil ({raw!r})")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ClinicalEntryError(f"{code.value}: sayı değil ({raw!r})") from None
    if value != value or value in (float("inf"), float("-inf")):   # NaN / inf
        raise ClinicalEntryError(f"{code.value}: geçersiz sayı")
    if code in _BOOLEAN and value not in (0.0, 1.0):
        raise ClinicalEntryError(f"{code.value}: yalnız 0 veya 1 olabilir")
    if code is SignalCode.GCS and not value.is_integer():
        # G2-A4 review: the scale counts whole points, so 14.5 is a slip, not an assessment — and between
        # two bands of the SOFA table it would be scored as one of them without anyone having said which.
        raise ClinicalEntryError(GCS_NOT_WHOLE)
    if code in WHOLE_VITALS and not value.is_integer():
        # G3-01 (D6): 88.5 beats a minute is a slip, not a reading.
        raise ClinicalEntryError(NOT_WHOLE.format(code=code.value))
    low, high = PLAUSIBLE.get(code, (float("-inf"), float("inf")))
    if not (low <= value <= high):
        raise ClinicalEntryError(
            f"{code.value}: {value:g} beklenen aralığın ({low:g}–{high:g}) dışında — "
            f"birim veya ondalık hatası olabilir")
    return value


def build_entries(patient_id: str, entries: list[dict], *, charted_by: str,
                  recorded_at: datetime | None = None,
                  now: datetime | None = None) -> list[ChartedEntry]:
    """Turn a charting request into observations, or raise with a reason.

    All-or-nothing: one bad entry rejects the whole request rather than charting some of it.
    A half-applied chart is worse than a refused one, because nobody can tell afterwards which
    half landed.
    """
    # G3-01 review: one instant per request — an untouched time is stamped at the same `now` the bedside
    # time bound is judged at, not at a second reading of the clock a few microseconds later.
    now = now or datetime.now(timezone.utc)
    if not patient_id or not str(patient_id).strip():
        raise ClinicalEntryError("hasta kimliği boş olamaz")
    if not entries:
        raise ClinicalEntryError("boş kayıt gönderilemez")

    when = recorded_at or now
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
    _check_bedside(built, recorded_at, now)
    return built


def _check_bedside(built: list[ChartedEntry], recorded_at: datetime | None, now: datetime) -> None:
    """G3-01 (D6, D7, X12): the bedside set's two rules that read more than one value. The time is bounded
    only when one was sent (an untouched time is the server's clock), and only for a request that charts one
    of the six; MAP is compared with a systolic in the SAME request — one form's two numbers, not an older
    reading's. Raises with the clinician's sentence; all-or-nothing, as the loop above."""
    codes = {item.observation.code for item in built}
    if recorded_at is not None and codes & BEDSIDE_VITALS:
        if recorded_at < now - BEDSIDE_BACKDATE:
            raise ClinicalEntryError(AT_TOO_OLD)
        if recorded_at > now + BEDSIDE_SKEW:
            raise ClinicalEntryError(AT_FUTURE)
    # A code named twice in one request keeps every value: the highest MAP must be below the lowest systolic,
    # so neither a later systolic nor a later MAP can hide an earlier impossible pair (G3-01 review).
    maps = [i.observation.value for i in built if i.observation.code is SignalCode.MAP]
    sbps = [i.observation.value for i in built if i.observation.code is SignalCode.SBP]
    if maps and sbps and max(maps) >= min(sbps):
        raise ClinicalEntryError(MAP_NOT_BELOW_SBP)


def chart_observations(engine: Engine, store: AckStore, audit: AuditLog, notifier: Notifier,
                       hospital: str, patient_id: str, charted: list[ChartedEntry],
                       now: datetime, escalate_after: timedelta,
                       mirror: Callable[[Observation], None] | None = None,
                       entry_ids: list[tuple[str, int]] | None = None) -> list[Alert]:
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
    itself and never raises).

    `entry_ids`, when given, receives `(code, id)` of each `chart` row as it is written, in request order —
    the door answers them, and a withdrawal (G3-01, D10) is addressed by that id."""
    alerts: list[Alert] = []
    for item in charted:
        obs = item.observation
        alerts = engine.ingest(obs, now=min(obs.timestamp, now))
        cleared = sync_alerts(engine, store, obs.patient_id, now)
        if mirror is not None:
            mirror(obs)
        notifier.prune(hospital, live_keys(engine, store))
        written = audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                          {"value": obs.value, "unit": obs.unit,
                                           "obs_ts": obs.timestamp.isoformat(),
                                           "charted_by": item.charted_by}))
        if entry_ids is not None:
            entry_ids.append((obs.code.value, written.id))
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
