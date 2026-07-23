# Patient-Relative / Comorbidity-Aware Alerting — Design Spec

**Date:** 2026-07-23
**Status:** approved (design decisions locked with the user)
**Depends on:** the NEWS2 rule (`rules/news2.py`), the engine pipeline, the live board + escalation (B2).

## Problem

Population-threshold scores (NEWS2 first, others later) score every patient against the
*same* boundaries. A clinician gave us the concrete failure mode:

- A patient with **chronic atrial fibrillation** whose normal pulse is 100–110 scores NEWS2
  points on *every* reading. Alarming on their chronic-normal is exactly the alarm fatigue that
  makes clinicians stop trusting the score. **Don't alarm on chronic-normal.**
- A **chronic-hypertensive** whose baseline systolic is 150–170 looks "fine" at 95 mmHg — the
  population score flags it only modestly, yet 95 is a **dangerous drop for them**. The score
  *under*-represents an acute change. **Do surface the acute deviation.**

This is the honest generalisation of NEWS2's own **Scale 2**: the score itself already admits, in
a coarse one-group way, that *"normal" can depend on the patient*. See [[news2]] / [[news2-rcp-2017]].

## Decisions locked with the user

1. **Chronic-normal behaviour → downgrade + annotate.** A finding explained by the patient's
   charted baseline does **not** alarm or escalate, but stays **visible** on the board marked
   *"Expected — within this patient's charted baseline."* We never *silently hide* it (that would
   be an un-auditable suppression and could bury a real change).
2. **Baseline source → clinician profile.** Comorbidities and baseline vital ranges are
   **clinician/admission-entered**, not learned from telemetry. Learning a rolling baseline is a
   later ML sub-project and carries a "mistake the acute-illness window for baseline" risk.

## Charter safety — no invented thresholds

The boundary we alarm against is the **patient's own clinician-charted baseline range**, never a
number we mint. "Acute change" = *outside the range the clinician charted for this patient*. The
recommendation register stays review-only ("Assess…"), never a diagnosis or order. Findings cite
`news2-rcp-2017` (the Scale-2 patient-specific-normal precedent); the reasoning states plainly that
the range itself is clinician-provided.

## Data model

```python
@dataclass(frozen=True)
class BaselineRange:
    low: float
    high: float
    def contains(self, v: float) -> bool: ...   # low <= v <= high

@dataclass(frozen=True)
class PatientProfile:
    patient_id: str
    comorbidities: frozenset[str] = frozenset()          # e.g. {"chronic_af", "chronic_hypertension"}
    baselines: dict[SignalCode, BaselineRange] = {}       # e.g. {HEART_RATE: 100-110, SBP: 150-170}
```

The `Engine` holds a `dict[str, PatientProfile]`; `Engine.set_profile(profile)` registers one. A
patient with no profile behaves exactly as today (pure population NEWS2) — the layer is a no-op.

## Finding / Alert extension

`Finding` and `Alert` gain two optional fields (default empty → fully backward compatible):

- `downgraded: bool = False` — chronic-expected; must not alarm/escalate.
- `chronic_context: str = ""` — human explanation ("HR 105 is within this patient's charted AF
  baseline 100–110").

Downgrading also sets `severity → LOW`, `urgency → ROUTINE`, so the existing escalation loop
(which only escalates `urgency == immediate`) never touches it. Blast radius stays tiny.

## The layer — `rules/patient_relative.py`

Applied in the pipeline **after** the rules run, **before** findings become alerts.

1. **Downgrade chronic-normal.** For a `news2` finding: if **every** vital that scored points has
   a charted baseline **and its latest value is within that baseline**, the finding is
   chronic-expected → set `downgraded`, `chronic_context`, and lower severity/urgency. If *any*
   points-scoring vital is outside baseline (or has no baseline), leave the finding alarming and
   name the acute contributor in `chronic_context` ("acute contributor: SBP 95").
2. **Surface acute deviation.** For each baselined signal, if the latest value is **outside** the
   charted range, emit an `acute_change` finding: *"SBP 95 is below this patient's charted
   baseline (150–170) — assess for an acute cause."* Review register, cited to `news2-rcp-2017`.
   This catches the hypertensive-drop case even when the population NEWS2 is modest.

## Pipeline wiring

```
findings = septic_shock.evaluate(...) + news2.evaluate(state)
profile  = self._profiles.get(patient_id)
if profile:
    findings = patient_relative.apply(findings, state, profile)   # downgrade in place + append acute_change
findings += antibiotic_clock.evaluate(...)
```

`acute_change` is a new alert kind (its own `_ACTIONS` / `_CONFIDENCE`). Because alerts are keyed
by `kind`, a patient carries at most one `news2` and one `acute_change` alert, each updated in place.

## Frontend (minimal)

- `AlertCard`: when `alert.downgraded`, render a muted grey **"Beklenen (kronik)"** badge and the
  `chronic_context` line, and drop the alarm styling / the escalation path (it is already
  non-immediate so it never enters the Eskale section). `acute_change` renders as an ordinary alert.
- One Vitest test for the downgraded rendering.

## Vault

- Write the concept article **`patient-relative-alerting`** (resolves the long-standing unresolved
  link / open question), grounded in `news2-rcp-2017` (Scale 2) and the clinician requirement.
- Update `INDEX.md` and `open-questions.md` (close the gap).
- Add a Turkish-guide glossary entry.

## Test plan (TDD)

- `BaselineRange.contains` boundaries.
- `apply`: chronic-AF HR-105 news2 → downgraded, low/routine, context names the baseline.
- `apply`: a points-scoring vital *outside* baseline → **not** downgraded (stays alarming).
- `apply`: chronic-hypertensive SBP 95 (baseline 150–170) → an `acute_change` finding appears,
  cited, review register.
- `apply`: no profile → findings pass through untouched.
- Engine-level: `set_profile` + ingest → downgraded news2 alert carries the flag; escalation loop
  leaves it alone.
- Frontend: downgraded badge renders; acute_change renders as an alert.

## Out of scope (later)

Learned rolling baselines (ML sub-project); comorbidity-specific rules beyond baseline-range
comparison (e.g. rhythm classification for "new-onset AF" from the ECG — needs waveform);
per-comorbidity escalation policies.
