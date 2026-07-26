---
type: concept
tags: [sepsis, scoring, adult-icu]
sources: [sepsis-3-jama-2016]
---

# SOFA Score

The Sequential Organ Failure Assessment score grades dysfunction in **six organ systems**, 0–4
points each (max 24). It is the instrument that operationalises [[sepsis-3-definition]]: an acute
rise of **≥2 points** in a patient with suspected infection *is* sepsis.

## The table

| Organ system | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **Respiration** PaO₂/FiO₂, mmHg | ≥400 | <400 | <300 | <200 + resp. support | <100 + resp. support |
| **Coagulation** platelets ×10³/µL | ≥150 | <150 | <100 | <50 | <20 |
| **Liver** bilirubin mg/dL | <1.2 | 1.2–1.9 | 2.0–5.9 | 6.0–11.9 | >12.0 |
| **Cardiovascular** | MAP ≥70 | MAP <70 | dopamine <5 *or* dobutamine any dose | dopamine 5.1–15 *or* epi ≤0.1 *or* norepi ≤0.1 | dopamine >15 *or* epi >0.1 *or* norepi >0.1 |
| **CNS** GCS | 15 | 13–14 | 10–12 | 6–9 | <6 |
| **Renal** creatinine mg/dL | <1.2 | 1.2–1.9 | 2.0–3.4 | 3.5–4.9 | >5.0 |
| **Renal** urine output | — | — | <500 mL/d | — | <200 mL/d |

Catecholamine doses in µg/kg/min sustained ≥1 hour.

## What the score is actually made of

Look closely at what each row needs, because it determines when Homunculus can compute it:

- **Continuously available from monitors:** MAP. That is all.
- **Available from the ventilator + intermittent ABG:** PaO₂/FiO₂ — FiO₂ streams continuously,
  but PaO₂ requires an arterial blood gas, which is drawn every few hours at best.
- **Available from the lab, intermittently:** platelets, bilirubin, creatinine.
- **Available from nursing charting:** GCS, urine output.
- **Available from the infusion pumps / medication record:** vasopressor doses.

So **SOFA is not a continuous score.** It updates in jumps, when a lab returns or a nurse charts.
Between updates it is stale. Sepsis-3 itself notes SOFA "may not promptly capture dysfunction in
individual organ systems" ([[sepsis-3-jama-2016]]).

This is the gap Homunculus exists to fill: **the continuous signals (heart rate, respiratory rate,
SpO₂, MAP, their variability and trends) move before the intermittent ones**, and a SOFA-based
alert by construction cannot fire until the slow inputs catch up. See
[[why-early-detection-is-possible]].

## The cardiovascular row is a trap

The cardiovascular sub-score above 1 point is **defined by the drugs the clinician started**. A
patient scores 3 because norepinephrine is running. The score therefore rises *in response to
treatment*, and rises fastest when the clinician has already recognised the problem.

Any model trained on SOFA trajectories partly learns to predict *clinician behaviour*, not patient
physiology — and will look impressive in retrospective validation for exactly the wrong reason.
See [[treatment-confounding-in-severity-scores]].

## Relevance to Homunculus

- Compute SOFA **continuously, with explicit staleness**: each organ sub-score should carry the
  timestamp of the value it rests on. A respiratory sub-score derived from a six-hour-old ABG is
  not the same evidence as one from a fresh gas, and the UI must not present them identically.
  **Implemented (B6):** the engine flags **stale SOFA inputs** — inputs present but older than an
  operational freshness window (haemodynamics ~1 h; lactate ~6 h; GCS / PaO₂:FiO₂ ~8 h; creatinine,
  bilirubin, platelets ~26 h) — and the sepsis finding's reasoning names the oldest and tempers
  confidence. The **thresholds are unchanged** (still sepsis-3); the windows are *operational
  data-recency defaults*, not a clinical claim, and stale values are **surfaced, never dropped**
  (dropping would silently under-score).
- **Track the delta from a per-patient baseline**, not the absolute value.
- The **"consider a repeat arterial blood gas"** recommendation from the MVP vision falls
  naturally out of this: when the continuous signals suggest respiratory deterioration but the
  PaO₂/FiO₂ term is stale, the highest-value action is to **refresh the input the score is blind
  on**. That is a genuinely useful recommendation, it is explainable in one sentence, and it needs
  no model at all.
- SpO₂/FiO₂ can substitute for PaO₂/FiO₂ when no gas is available — [[phoenix-sepsis-score]] and
  [[nsofa]] both do this deliberately for exactly this reason. Worth capturing the adult
  validation for that substitution. → [[open-questions]]

## Sources

- [[sepsis-3-jama-2016]] (high) — the full table, the ≥2-point criterion, the stated limitations
  (lab dependence, iatrogenic confounding of the cardiovascular row).
