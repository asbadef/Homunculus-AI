# src/homunculus/pipeline.py
"""Wire observation -> state -> rules -> reco -> alerts.
Holds per-patient recognition time to anchor the antibiotic clock."""
from __future__ import annotations

import copy as _copy
from dataclasses import replace
from datetime import datetime, timedelta

from homunculus.canonical import Observation, SignalCode
from homunculus.reco.engine import Alert, to_alert
from homunculus.rules import antibiotic_clock, news2, patient_relative, septic_shock
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.profile import PatientProfile
from homunculus.state.repository import InMemoryPatientRepository, PatientRepository
from homunculus.state.timeline import PatientState

_RECOGNITION_KINDS = {"sepsis", "septic_shock"}

#: How long after its drop an antibiotic-clock anchor can still be restored (G2-A1, X12). Charting
#: suspected infection absent and then present again inside this is a correction of the toggle —
#: the same episode, whose hour is still running or already overdue; restarting it turned an
#: antibiotic 10 min overdue into "60 min remaining". The window runs from the drop, not from the
#: anchor, and is a correction's size: a mis-click is put right within minutes. A recognition after
#: it is a second episode with its own hour (D9) — a new infection after a rule-out must not
#: inherit the old anchor, and with it the doses given since (X12 review).
ANCHOR_RESTORE_S = 900

#: How long past its window a stale NEWS2 input can keep a running alert held (G2-A2, X12): one
#: nursing shift. A held alert waits for the input to be measured again; one pressure of 88 and
#: then two days of normal vitals, the pressure never re-taken, read "NEWS2 3, held" beside a card
#: at 0 for ever. Past this a stale reading no longer counts toward the hold — the alert ends at
#: the next evaluation unless another input, stale for less, still reaches the band on its own.
#: Runs from when the input went stale (its `fresh_until`), a vital's window or a chart's shift.
#: An operational default like the windows themselves, not a clinical claim.
HOLD_MAX_S = 8 * 3600


def _suspicion_start(state: PatientState) -> datetime | None:
    """When the current suspicion of infection began (G3-06, D2, owner: «Şüpheden önceye gitmesin»):
    the stamp of the FIRST `suspected_infection` mark charted present since the last one charted
    absent — a repeated present mark never moves it. None when the latest mark is absent or there is
    none. The marks are in stamp order, as `PatientState` keeps them."""
    start = None
    for mark in reversed(state.history(SignalCode.SUSPECTED_INFECTION)):
        if mark.value < 1.0:
            break
        start = mark.timestamp
    return start


def _level(alert: Alert) -> tuple[Severity, Urgency]:
    """How loud an alert is — the order a held NEWS2 may step down in, never up (G2-A2, X9d)."""
    return Severity[alert.severity.upper()], Urgency[alert.urgency.upper()]


class Engine:
    #: Every dict the engine keeps per patient besides the readings in its repository. `forget`,
    #: `copy` and `adopt` move exactly these: a per-patient dict added to `__init__` and left off
    #: this list would be kept by a discharged patient and lost by a shadow copy, so a test pins
    #: the list against the instance's dicts.
    _PER_PATIENT = ("_recognized_at", "_dropped_anchor", "_alerts", "_held_news2_alert",
                    "_judged_at", "_profiles")

    def __init__(self, repository: PatientRepository | None = None):
        self._repo = repository or InMemoryPatientRepository()
        self._recognized_at: dict[str, datetime] = {}
        # X12: an anchor dropped by infection charted absent -> (anchor, the floored instant it was
        # dropped at; G3-06 D2).
        self._dropped_anchor: dict[str, tuple[datetime, datetime]] = {}
        self._alerts: dict[str, dict[str, Alert]] = {}   # patient -> kind -> alert
        # G2-A2 X9b: patient -> the NEWS2 alert a running hold keeps, as it was last scored.
        self._held_news2_alert: dict[str, Alert] = {}
        # G3-06 (D1; NEWS2's since G2-A2 X9e): patient -> the latest instant the rules judged the patient
        # at. It never goes back, and every rule of an evaluation judges at it (`_evaluate`).
        self._judged_at: dict[str, datetime] = {}
        self._profiles: dict[str, PatientProfile] = {}
        self._scorer = None   # optional ML seam; inert until set_model loads an artifact

    def set_profile(self, profile: PatientProfile) -> None:
        """Register a clinician-entered baseline/comorbidity profile for a patient."""
        self._profiles[profile.patient_id] = profile

    def recognized_at(self, patient_id: str) -> datetime | None:
        """When sepsis/shock was first recognised for this patient — the anchor the 1-hour
        antibiotic clock runs from. Published so a pharmacist can see the clock rather than infer
        it from an alert that has already fired."""
        return self._recognized_at.get(patient_id)

    def profile(self, patient_id: str) -> PatientProfile | None:
        """The charted profile, or None if nobody charted one. Read by the board so the ward can
        see what a score is being judged against, rather than only its result."""
        return self._profiles.get(patient_id)

    def set_model(self, artifact: dict | None) -> None:
        """Load (or clear) the optional ML scoring artifact. No artifact => seam stays inert."""
        if artifact is None:
            self._scorer = None
            return
        from homunculus.model.scorer import Scorer
        self._scorer = Scorer(artifact)

    def ingest(self, obs: Observation, now: datetime, *, anchor_at: datetime | None = None) -> list[Alert]:
        """Add one reading and evaluate its patient. `now` is the REQUESTED instant — the doors'
        min(stamp, wall clock) (G2-A2, X10), the replay's min(stamp, the row's write time) (X10b) —
        and the rules judge at its floor (`_evaluate`, G3-06 D1). The reading keeps its own stamp.
        `anchor_at` is the anchor of a recognition this reading completes (D2): None is `now`, the
        doors' one instant; a linked reading is judged at the link and anchored at its measurement
        (D4)."""
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)
        return self._evaluate(obs.patient_id, state, now, now if anchor_at is None else anchor_at)

    def _evaluate(self, patient_id: str, state: PatientState, requested: datetime,
                  anchor_at: datetime) -> list[Alert]:
        """One evaluation of `patient_id` as its state stands. Every rule judges at `at`, the
        requested instant floored at the patient's last judgement (G3-06, D1; NEWS2's since G2-A2,
        X9e): a reading stamped in the past is information about the past, not a reason to judge the
        present as if it were the past. Judged at its stamp, a reading from four hours ago turned an
        overdue antibiotic into «300 min remaining» and ended the overdue's episode, and a vital stale
        at the wall clock lifted NEWS2 again or ended a hold. The values keep their own stamps: the
        state, freshness, trends and the audit's `obs_ts` do not move. The engine reads no clock — `at`
        is only ever an instant a caller asked for."""
        at = max(requested, self._judged_at.get(patient_id, requested))
        self._judged_at[patient_id] = at

        profile = self._profiles.get(patient_id)
        # The profile reaches septic_shock directly, not through patient_relative: a charted
        # baseline SOFA is part of the Sepsis-3 criterion itself, not a downgrade applied after
        # the fact. Getting it there late would mean the alert had already been raised.
        findings = list(septic_shock.evaluate(state, at, profile))
        news2_findings = news2.evaluate(state, at)
        findings += news2_findings
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation. At the same
        # instant NEWS2 was judged at (G2-A2, D6).
        findings = patient_relative.apply(findings, state, profile, at)

        # The antibiotic clock (G2-A1, D9, X1, X9). Recognition is `sepsis` OR `septic_shock`: a
        # baseline SOFA charted during shock can take `sepsis` away while `septic_shock` still
        # holds, and restarting an overdue antibiotic's hour then would hide that it is overdue.
        #  - The anchor is set the first time a recognition kind fires in an episode.
        #  - It is dropped only when suspected infection is charted absent (< 1) while no
        #    recognition kind fires — the episode is over and a later one is a second recognition
        #    with its own hour. (The `None` branch below is defensive only: an anchor can exist
        #    only after infection was charted >= 1.) Sepsis merely stopping is not that: SOFA
        #    reads the latest MAP, so a single reading at 70 or above (MAP 70 scores 0) stops
        #    `sepsis` for one evaluation, and an anchor dropped then would let an untreated sepsis
        #    never go overdue, or give a treated one a false overdue when it came back.
        #  - A dropped anchor is remembered with the floored instant of its drop (X12; G3-06, D2). A
        #    recognition within ANCHOR_RESTORE_S (15 min) after the drop, floored instant to floored
        #    instant, restores the old anchor: infection charted absent and present again is a
        #    corrected toggle, the same episode, and an antibiotic charted in the gap counts against
        #    the restored hour. A later recognition gets its own anchor: `anchor_at` — the requested
        #    instant at the doors, the reading's measurement at the link (D4) — never after `at`,
        #    and never before the suspicion that makes the recognition possible, the start of the
        #    current one (the first infection mark charted present since the last absent one; a
        #    repeated present mark does not move it), nor before the rule-out it follows (D2, owner:
        #    «Şüpheden önceye gitmesin»; `_new_anchor`). Requested instants can run backwards;
        #    compared on them, a back-dated recognition "before" the drop restored the anchor
        #    however long ago the rule-out was.
        #  - The antibiotic findings are emitted only while a recognition kind fires in THIS
        #    evaluation, so they leave the board with the sepsis alert (D9); the clock keeps
        #    counting underneath, and a sepsis that fires again shows the true elapsed time.
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if patient_id not in self._recognized_at:
                # A recognition kind fires only with infection charted present (septic_shock.evaluate):
                # the current suspicion makes it possible — the hour never starts before it began.
                suspected_at = _suspicion_start(state) or anchor_at
                self._recognized_at[patient_id] = self._new_anchor(patient_id, anchor_at, at, suspected_at)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[patient_id] = (dropped, at)

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(patient_id) if recognizing else None, at
        )

        # Optional ML seam: an additive early-warning signal that NEVER overrides the rules.
        if self._scorer is not None:
            risk, top = self._scorer.score(state, at)
            if risk >= self._scorer.threshold:
                drivers = ", ".join(f"{n} {v:g}" for n, v in top) or "rising trend"
                findings.append(Finding(
                    kind="sepsis_watch",
                    severity=Severity.MODERATE,
                    urgency=Urgency.SOON,
                    summary=f"Model early-warning: sepsis risk {risk:.0%}",
                    reasoning=(
                        f"A statistical model estimates {risk:.0%} risk of sepsis onset from the "
                        f"recent trend (top contributors: {drivers}). This is an early heads-up "
                        f"before the deterministic rule fires — a prompt to look, not a diagnosis."
                    ),
                    citations=[Citation("physionet-cinc-2019", "early-sepsis model, setting-specific")],
                ))

        alerts = [to_alert(f, patient_id) for f in findings]
        alerts = [replace(a, source="model") if a.kind == "sepsis_watch" else a for a in alerts]
        # Staleness — a vital past its window, a chart past its shift (X11) — may withhold a new
        # NEWS2 alert but cannot end a running one (G2-A2, X9, X9b).
        held = self._held_news2(patient_id, bool(news2_findings), state, profile, at)
        if held is not None:
            alerts.append(held)
        # The bucket IS this evaluation (G2-A1, D1): exactly the kinds the rules produced for this
        # reading. A kind they did not produce has stopped firing and is gone — no quiet time, no
        # hysteresis — except a NEWS2 held while an input is stale (G2-A2, X9b, X9c, X11), which
        # goes with the first evaluation that has none stale and is below the band, or whose stale
        # values at their last reading are below it too — a reading counted for at most HOLD_MAX_S
        # past its window (X12). What the API keeps of one (a
        # critical nobody acknowledged) is the API's business (api/alert_lifecycle.py), not the
        # engine's.
        self._alerts[patient_id] = {a.kind: a for a in alerts}
        return alerts

    def _held_news2(self, patient_id: str, fired: bool, state: PatientState,
                    profile: PatientProfile | None, now: datetime) -> Alert | None:
        """The running NEWS2 alert, held, when this evaluation's NEWS2 (`fired`) produced none while
        a vital is stale or a chart expired at `now` (G2-A2, X9, X9b, X9c, X9d, X11). None — the
        alert ends — when it fired, when none was running, when nothing is stale or expired (the
        score at `now` is below the band on current inputs; a vital never measured still leaves it
        partial, as it always did), or when even the stale values, counted at their last reading
        for at most HOLD_MAX_S past their window (X12), no longer reach a band.

        The bridge posts a vitals set one reading at a time, every reading stamped with the set's
        time. Judged at each, the first readings of a set taken more than a window after the last
        saw the rest stale, fell below the band and ended the alert, and the next reading raised it
        again as a new episode: a new nurse notification, the acknowledgement gone. So a running
        alert (the bucket, before this evaluation replaces it) is held while a vital is stale. It is
        kept as it was last scored — total, severity, urgency, downgrade — and says what it is held
        on (X9b): re-scored on the stale readings (X9) it could climb a band, to "immediate" and a
        nurse notification, on a value hours old. The score on the stale values at their last
        reading — "ageless" — ends a hold when it is below the band (X9c: a pulse back to normal
        beside a stale pressure scoring 1 is an improvement even on the stale values), and is a
        floor the held alert never sits above (X9d): when its band, after the patient-relative
        layer, is lower than the kept alert's, that ageless alert is kept from then on. It steps
        down, never up, and within one band keeps its number, so a set arriving reading by reading
        does not move it. A fresh score that reaches a band is the alert again, a lower one
        included. A stale input still never raises a new alert (D6), and a feed that stops entirely
        keeps the held alert, as before G2-A2.

        A charted oxygen or ACVPU past its shift is scored as air and Alert at `now` (D8) and held
        on like a stale vital (X11). Before, its expiry ended the alert an "on oxygen" or a U had
        raised, though nobody had charted the patient off oxygen or awake. The ageless score counts
        the chart at its last value, as it does a stale reading, and the held note names it with
        the shift it outlived. Charted again it is current, and room air or Alert below the band
        ends the alert.

        A hold has an end (X12). The ageless score counts a stale reading only while it has been
        stale for at most HOLD_MAX_S (8 h, a shift) — it is judged HOLD_MAX_S before `now` — so an
        input never measured again stops holding the alert, and the alert ends at the first
        evaluation after that unless another input, stale for less, reaches the band on its own.
        The bound is on the input that keeps the hold, not on any stale one: a pulse that went
        stale since does not stretch a pressure's hold. The held note says so in its last sentence.

        A profile charted during a hold reaches the held alert only through that floor: a baseline
        that now downgrades it steps it down, but one withdrawn mid-hold, which would raise it,
        reaches it only when the hold ends.
        """
        kept = self._held_news2_alert.pop(patient_id, None)    # spent unless the hold goes on
        running = self._alerts.get(patient_id, {}).get("news2")
        if fired or running is None:
            return None
        at_now = news2.score(state, now)
        # X11: a chart past its shift, assumed again though it was charted, holds as a stale vital.
        expired = [name for name in at_now.assumed if at_now.measured_at[name] is not None]
        # X12: the stale values at their last reading while stale for at most HOLD_MAX_S. Judged
        # HOLD_MAX_S ago, a reading inside its window then has been stale for no longer than that
        # now; an older one is out, and one stamped after that instant never ages.
        bound = now - timedelta(seconds=HOLD_MAX_S)
        ageless = news2.evaluate(state, bound)
        if not (at_now.stale or expired) or not ageless:
            return None
        kept = running if kept is None else kept
        # Judged as the kept alert was — after the patient-relative layer — on the ageless score.
        [floor] = [to_alert(f, patient_id)
                   for f in patient_relative.apply(ageless, state, profile, bound)
                   if f.kind == "news2"]
        if _level(floor) < _level(kept):
            kept = floor
        self._held_news2_alert[patient_id] = kept

        def oldest_first(names: list[str]) -> list[str]:    # longest stale first, as the recency note
            return sorted(names, key=lambda name: at_now.measured_at[name])

        vitals = [news2.INPUT_LABEL[name] for name in oldest_first(at_now.stale)]
        on = [f"{', '.join(vitals)} older than the expected refresh window"] if vitals else []
        charts: dict[str, list[str]] = {}       # X11: the expired charts, by the shift outlived
        for name in oldest_first(expired):
            shift = (at_now.fresh_until[name] - at_now.measured_at[name]) / timedelta(hours=1)
            charts.setdefault(f"{shift:g}", []).append(news2.INPUT_LABEL[name])
        on += [f"{', '.join(labels)} charted more than {shift} h ago"
               for shift, labels in charts.items()]
        note = (f" Held while inputs are stale: {'; '.join(on)}. The alert was already firing, "
                f"so it is not raised on a stale value: it keeps its last score, or the lower band "
                f"its stale values still reach at their last reading. It ends when those readings "
                f"are below the band, or when they have not been re-measured within "
                f"{HOLD_MAX_S // 3600:g} h of going stale.")
        stale = vitals + [label for labels in charts.values() for label in labels]
        return replace(kept, clinical_reasoning=kept.clinical_reasoning + note, stale_inputs=stale)

    def _new_anchor(self, patient_id: str, anchor_at: datetime, at: datetime,
                    infection_at: datetime) -> datetime:
        """The anchor of a recognition with none running (X12; G3-06, D2): the anchor dropped at
        most ANCHOR_RESTORE_S before `at`, restored — a corrected toggle, the old episode's anchor,
        and the bounds below do not apply — or else a new episode's. `at` is the recognising
        evaluation's floored instant and the drop is remembered at its own, so the difference is
        measured in the engine's one-way time; within one engine the floor never goes back, and
        `forget`, `copy` and `adopt` move `_judged_at` and `_dropped_anchor` together, so it is
        never negative — the `0 <=` is a guard. A new episode's anchor is `anchor_at` (the
        requested instant, or the link's measurement) lifted to the start of the suspicion that
        makes the recognition possible, `infection_at`, and to the rule-out it follows (the drop's
        instant, when one is remembered), and held to `at`: it never goes back before either
        (D2, owner: «Şüpheden önceye gitmesin»). Either way the remembered drop is spent."""
        dropped = self._dropped_anchor.pop(patient_id, None)
        if dropped is not None and 0 <= (at - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
            return dropped[0]
        bounds = [anchor_at, infection_at] + ([dropped[1]] if dropped is not None else [])
        return min(max(bounds), at)

    def active_alerts(self, patient_id: str) -> list[Alert]:
        return list(self._alerts.get(patient_id, {}).values())

    def patient_ids(self) -> list[str]:
        return self._repo.patient_ids()

    def state(self, patient_id: str) -> PatientState:
        return self._repo.get_or_create(patient_id)

    def forget(self, patient_id: str) -> None:
        """Drop everything the engine holds for one patient (G2-A11, D9): readings, the alerts
        of the last evaluation, the antibiotic anchor and a dropped anchor's memory, a held NEWS2
        alert, the instant the rules last judged it at (G3-06, D1) and the charted profile. The API calls it when an admission made
        here is discharged: the number is retired, and a reading that still arrives for it is
        dropped at the door, so nothing would ever end these alerts otherwise. A profile is the
        admission's — a readmission is a new number and a new profile. Idempotent."""
        self._repo.remove(patient_id)
        for name in self._PER_PATIENT:
            getattr(self, name).pop(patient_id, None)

    def copy(self) -> "Engine":
        """An independent copy: every patient's readings, profile, alerts and the per-patient
        memory (Aşama B, D9 — the shadow engine starts as the real engine's copy). Readings are
        copied series by series (`PatientState.copy`), everything else in `_PER_PATIENT` deeply;
        nothing is shared, so what the copy ingests never reaches this engine (D1). The optional
        model scorer is shared, not copied: it is read-only. Assumes the in-memory repository:
        the twin always gets one, filled through the repository protocol."""
        repo = InMemoryPatientRepository()
        for patient_id in self._repo.patient_ids():
            repo.put(patient_id, self._repo.get_or_create(patient_id).copy())
        twin = Engine(repo)
        for name in self._PER_PATIENT:
            setattr(twin, name, _copy.deepcopy(getattr(self, name)))
        twin._scorer = self._scorer
        return twin

    def adopt(self, other: "Engine", patient_id: str) -> None:
        """Replace everything this engine holds for `patient_id` with a deep copy of what `other`
        holds (Aşama B, D5: un-linking a monitor returns the shadow patient to the real one's
        picture). A patient `other` does not know is forgotten here. `other` is read, never
        written (D1). Each structure is copied only where `other` has an entry: a patient can have
        a profile and no reading (after a restart the replay only sets the profile), and that
        profile must survive the un-linking. Assumes the in-memory repository, as `copy` does."""
        self.forget(patient_id)
        if patient_id in other.patient_ids():       # the guard keeps other.state() from creating the patient
            self._repo.put(patient_id, other.state(patient_id).copy())
        for name in self._PER_PATIENT:
            theirs = getattr(other, name)
            if patient_id in theirs:
                getattr(self, name)[patient_id] = _copy.deepcopy(theirs[patient_id])
