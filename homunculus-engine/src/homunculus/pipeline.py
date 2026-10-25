# src/homunculus/pipeline.py
"""Wire observation -> state -> rules -> reco -> alerts.
Holds per-patient recognition time to anchor the antibiotic clock."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime

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


class Engine:
    def __init__(self, repository: PatientRepository | None = None):
        self._repo = repository or InMemoryPatientRepository()
        self._recognized_at: dict[str, datetime] = {}
        # X12: an anchor dropped by infection charted absent -> (anchor, when it was dropped).
        self._dropped_anchor: dict[str, tuple[datetime, datetime]] = {}
        self._alerts: dict[str, dict[str, Alert]] = {}   # patient -> kind -> alert
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

    def ingest(self, obs: Observation, now: datetime) -> list[Alert]:
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)

        profile = self._profiles.get(obs.patient_id)
        # The profile reaches septic_shock directly, not through patient_relative: a charted
        # baseline SOFA is part of the Sepsis-3 criterion itself, not a downgrade applied after
        # the fact. Getting it there late would mean the alert had already been raised.
        findings = list(septic_shock.evaluate(state, now, profile))
        news2_findings = news2.evaluate(state, now)
        findings += news2_findings
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation. At the same
        # `now` NEWS2 was judged at (G2-A2, D6).
        findings = patient_relative.apply(findings, state, profile, now)
        if not news2_findings:
            # Staleness may withhold a new NEWS2 alert but cannot end a running one (G2-A2, X9).
            findings += self._held_news2(obs.patient_id, state, profile, now)

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
        #  - A dropped anchor is remembered with the time of its drop (X12). A recognition within
        #    ANCHOR_RESTORE_S (15 min) of the drop restores the old anchor: infection charted absent
        #    and present again is a corrected toggle, the same episode, and an antibiotic charted in
        #    the gap counts against the restored hour. A later recognition gets its own anchor,
        #    `now`.
        #  - The antibiotic findings are emitted only while a recognition kind fires in THIS
        #    evaluation, so they leave the board with the sepsis alert (D9); the clock keeps
        #    counting underneath, and a sepsis that fires again shows the true elapsed time.
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if obs.patient_id not in self._recognized_at:
                self._recognized_at[obs.patient_id] = self._new_anchor(obs.patient_id, now)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(obs.patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[obs.patient_id] = (dropped, now)

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(obs.patient_id) if recognizing else None, now
        )

        # Optional ML seam: an additive early-warning signal that NEVER overrides the rules.
        if self._scorer is not None:
            risk, top = self._scorer.score(state, now)
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

        alerts = [to_alert(f, obs.patient_id) for f in findings]
        alerts = [replace(a, source="model") if a.kind == "sepsis_watch" else a for a in alerts]
        # The bucket IS this evaluation (G2-A1, D1): exactly the kinds the rules produced for this
        # reading. A kind they did not produce has stopped firing and is gone — no quiet time, no
        # hysteresis. (A held NEWS2, G2-A2 X9, is produced by this evaluation, from the readings it
        # holds, and goes with the first evaluation those do not reach a band.) What the API keeps of
        # one (a critical nobody acknowledged) is the API's business (api/alert_lifecycle.py), not
        # the engine's.
        self._alerts[obs.patient_id] = {a.kind: a for a in alerts}
        return alerts

    def _held_news2(self, patient_id: str, state: PatientState, profile: PatientProfile | None,
                    now: datetime) -> list[Finding]:
        """The running NEWS2 alert, held, for an evaluation whose score at `now` does not reach a
        band (G2-A2, X9); empty when no NEWS2 alert is running or its last readings do not reach one.

        The bridge posts a vitals set one reading at a time, every reading stamped with the set's
        time. Judged at each, the first readings of a set taken more than a window after the last
        saw the rest stale, fell below the band and ended the alert, and the next reading raised it
        again as a new episode: a new nurse notification, the acknowledgement gone. So while a NEWS2
        alert is running (the bucket, before this evaluation replaces it), NEWS2 is scored again
        ageless — every input at its last reading, the score before G2-A2 — and if that reaches a
        band the alert is held and says what it is held on: the vitals past their window, and a
        charted oxygen or ACVPU past its shift (D8). It ends when those readings no longer reach the
        band — a complete fresh set below it, or a fresh reading that resolves it while another
        input is still stale. A stale input still never raises a new alert (D6).

        The patient-relative layer judges the held finding on the score it reports, ageless. Judged
        at `now` a stale input would be no contributor: a stale pressure inside its charted baseline
        would no longer explain a chronic alert, which would start alarming, and one outside it
        would no longer count against the downgrade, which would silence an acute one.
        """
        if "news2" not in self._alerts.get(patient_id, {}):
            return []
        held = news2.evaluate(state)
        if not held:
            return []
        # The acute-change findings the layer appends again here are already in this evaluation.
        [finding] = [f for f in patient_relative.apply(held, state, profile) if f.kind == "news2"]
        # The two scores differ only by inputs aged out at `now`, so a held alert has at least one.
        at_now = news2.score(state, now)
        aged_out = sorted(
            (name for name in at_now.breakdown if name in at_now.stale
             or (name in at_now.assumed and at_now.measured_at[name] is not None)),
            key=lambda name: at_now.measured_at[name])      # longest stale first, as the recency note
        note = (f" Held while inputs are stale: "
                f"{', '.join(news2.INPUT_LABEL[name] for name in aged_out)} older than the expected "
                f"refresh window. The alert was already firing, so a stale input is counted at its "
                f"last reading rather than left out; it ends when the readings no longer reach the "
                f"band.")
        # `stale_inputs` keeps its vocabulary, the vital labels the clients translate.
        return [replace(finding, reasoning=finding.reasoning + note,
                        stale_inputs=[news2.INPUT_LABEL[name] for name in aged_out
                                      if name in at_now.stale])]

    def _new_anchor(self, patient_id: str, now: datetime) -> datetime:
        """The anchor of a recognition with none running (X12): the anchor dropped at most
        ANCHOR_RESTORE_S ago, restored, or else `now`. Either way the remembered drop is spent."""
        dropped = self._dropped_anchor.pop(patient_id, None)
        if dropped is not None and (now - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
            return dropped[0]
        return now

    def active_alerts(self, patient_id: str) -> list[Alert]:
        return list(self._alerts.get(patient_id, {}).values())

    def patient_ids(self) -> list[str]:
        return self._repo.patient_ids()

    def state(self, patient_id: str) -> PatientState:
        return self._repo.get_or_create(patient_id)
