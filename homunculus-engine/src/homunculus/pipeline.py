# src/homunculus/pipeline.py
"""Wire observation -> state -> rules -> reco -> alerts.
Holds per-patient recognition time to anchor the antibiotic clock."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime

from homunculus.canonical import Observation
from homunculus.reco.engine import Alert, to_alert
from homunculus.rules import antibiotic_clock, news2, patient_relative, septic_shock
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.profile import PatientProfile
from homunculus.state.repository import InMemoryPatientRepository, PatientRepository
from homunculus.state.timeline import PatientState

_RECOGNITION_KINDS = {"sepsis", "septic_shock"}


class Engine:
    def __init__(self, repository: PatientRepository | None = None):
        self._repo = repository or InMemoryPatientRepository()
        self._recognized_at: dict[str, datetime] = {}
        self._alerts: dict[str, dict[str, Alert]] = {}   # patient -> kind -> alert
        self._profiles: dict[str, PatientProfile] = {}
        self._scorer = None   # optional ML seam; inert until set_model loads an artifact

    def set_profile(self, profile: PatientProfile) -> None:
        """Register a clinician-entered baseline/comorbidity profile for a patient."""
        self._profiles[profile.patient_id] = profile

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

        findings = list(septic_shock.evaluate(state, now))
        findings += news2.evaluate(state)
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation.
        findings = patient_relative.apply(findings, state, self._profiles.get(obs.patient_id))

        # Anchor the antibiotic clock the first time sepsis/shock is recognized.
        if obs.patient_id not in self._recognized_at:
            if any(f.kind in _RECOGNITION_KINDS for f in findings):
                self._recognized_at[obs.patient_id] = now

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(obs.patient_id), now
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
        bucket = self._alerts.setdefault(obs.patient_id, {})
        for a in alerts:
            bucket[a.kind] = a   # latest alert per kind
        return alerts

    def active_alerts(self, patient_id: str) -> list[Alert]:
        return list(self._alerts.get(patient_id, {}).values())

    def patient_ids(self) -> list[str]:
        return self._repo.patient_ids()

    def state(self, patient_id: str) -> PatientState:
        return self._repo.get_or_create(patient_id)
