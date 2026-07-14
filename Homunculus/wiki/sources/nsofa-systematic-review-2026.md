---
type: source-note
raw: "../../raw/nsofa-systematic-review-2026-raw.md"
authority: moderate
capture: extract
status: current
---

# nSOFA in the NICU — Systematic Review (Diagnostics 2026)

**What it is.** A systematic review of the neonatal SOFA score's prognostic accuracy and
clinical utility in the NICU (Cerbu, Boia, Pantea, et al., *Diagnostics* 2026;16(2):349).

**Authority: moderate.** Systematic review — good for pooled prognostic performance, but it is
not a consensus definition and does not establish nSOFA as a diagnostic instrument. The review
itself is emphatic on that point.

**Known gap.** The review does **not** reproduce the nSOFA scoring table. Exact thresholds must
come from the original derivation paper (**Wynn & Polin, 2020**), which is **not yet in
`raw/`**. Do not reconstruct the table from memory. → [[open-questions]]

## Key claims it supports

- **nSOFA scores three domains** — respiratory (ventilatory/oxygen requirement), cardiovascular
  (vasopressor or corticosteroid support), haematological (platelets). **Range 0–15**;
  cut-point **≥4** separates mortality risk. → [[nsofa]]
- **Serial scoring beats single scoring.** Median AUROC for mortality: **0.76 at T0 → 0.85 at
  +6 h → 0.89 at +12 h.** Best per-study values 0.87–0.95. → [[nsofa]],
  [[why-early-detection-is-possible]]
- **In preterm neonates, respiratory and haemodynamic deterioration "may be infectious or
  noninfectious"** — cardio-respiratory instability is a baseline feature of preterm physiology.
  This is *why* adult and paediatric criteria fail here. → [[nicu-sepsis-gap]]
- **nSOFA is validated for PROGNOSIS, NOT DIAGNOSIS.** "Organ dysfunction scoring does not
  replace infection ascertainment." → [[nsofa]], [[prognosis-vs-diagnosis]]

## Limitations that matter to Homunculus

- **Retrospective, higher-resource cohorts**; heterogeneous scoring intervals and thresholds;
  external validity to **term** neonates and lower-resource settings "incompletely
  characterized."
- **"Prospective impact-of-implementation studies… are fewer than ideal."** An AUROC of 0.89
  says the score *discriminates*; it says nothing about whether acting on it helps a baby. That
  gap — between retrospective discrimination and prospective clinical benefit — is the one
  Homunculus will eventually have to cross itself. See [[auroc-is-not-clinical-benefit]].
- **Calibration is barely reported.** For an alerting system, calibration matters more than
  discrimination: a score that ranks well but is systematically over-confident produces alarm
  fatigue. → [[alarm-fatigue]]

## Raw document

- [[nsofa-systematic-review-2026-raw]] — the captured evidence this note summarises.
