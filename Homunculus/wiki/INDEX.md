---
type: index
updated: 2026-07-14
---

# Homunculus Knowledge Base — Index

The map of the vault. **Read this first for any question**, then follow the links.

**Domain covered so far:** sepsis and septic shock (adult ICU + NICU).
**Sources:** 6 in `raw/`. **Concept articles:** 13.
**What is missing and what must be decided:** [[open-questions]] — read it before building anything.

---

## Start here — the three findings that should change the product

1. **[[nicu-sepsis-gap]]** — **There is no consensus definition of sepsis for the NICU.** Sepsis-3 is
   adults-only; the Phoenix criteria *explicitly exclude* preterm neonates and hospitalised newborns.
   The NICU is not a parameter change on the ICU model — it is a different product, and there is no
   agreed label to train against.
2. **[[heart-rate-variability-neonatal-sepsis]]** — HRV degrades **hours to days before** late-onset
   neonatal sepsis is diagnosed, while the heart rate is still within normal limits. This is the
   vault's strongest direct evidence for the whole Homunculus thesis. It also implies a hard
   architecture constraint: **beat-to-beat HR must survive the ingest pipeline.**
3. **[[treatment-confounding-in-severity-scores]]** — every severity score here partly scores *the
   clinician's response*, not the patient. A model given these features learns to predict the past,
   and will look excellent in retrospective validation for exactly the wrong reason.

---

## Adult ICU — definitions and scores

- **[[sepsis-3-definition]]** — sepsis = suspected infection + acute SOFA rise ≥2. SIRS abolished.
  The definition is a **delta**, not a threshold.
- **[[septic-shock]]** — sepsis + vasopressors for MAP ≥65 + lactate >2 despite adequate fluids.
  Mortality >40%. The **conjunction** is the signal, and it requires knowing what fluid was given.
- **[[sofa-score]]** — the six-organ table. **Not continuously computable** — it updates in jumps as
  labs return. That gap is where Homunculus lives.
- **[[qsofa]]** — RR ≥22 / SBP ≤100 / GCS <15. **Recommended against as a screening tool** (24%
  sensitivity). The vault's best lesson in pointing a good instrument at the wrong decision.
- **[[lactate-in-sepsis]]** — definitional criterion *and* resuscitation target. The one axis the
  system is structurally blind on between draws.

## Adult ICU — management

- **[[sepsis-screening-tools]]** — **use NEWS2/NEWS/MEWS/SIRS, not qSOFA** (strong, 2026). NEWS2 needs
  **no labs** — it is computable live from telemetry. The most implementable thing in the vault.
- **[[news2]]** — the full NEWS2 scoring table + risk bands + escalation. The recommended adult screen,
  computable live with no labs. **But it is population-threshold** → needs a **patient-relative /
  comorbidity-aware layer** (a clinician's requirement) or it fires on chronic-normal values = alarm
  fatigue. See [[patient-relative-alerting]].
- **[[patient-relative-alerting]]** — judge a patient against **their own clinician-charted baseline**,
  not the population threshold. Downgrade chronic-normal (chronic AF/COPD living at NEWS2 4–6), surface
  acute deviation (a chronic-hypertensive dropping to a "normal-looking" systolic). **Implemented** in
  the engine; the general form of NEWS2's own Scale 2. Sourcing dependency: [[alarm-fatigue]].
- **[[antimicrobial-timing-sepsis]]** — **the 1-hour window**, and the 2026 change that narrowed
  non-shock sepsis from 3 hours to 1. This is the latency budget for the entire adult pathway.

## NICU / neonatal

- **[[nicu-sepsis-gap]]** — see above. The most consequential article in the vault.
- **[[neonatal-sepsis]]** — EOS vs LOS; **temperature instability not fever; hypotension is late;
  feeding intolerance is early** (and lives in nursing notes, not on a monitor). Biomarker kinetics —
  CRP is useless in the first 24 h.
- **[[nsofa]]** — neonatal organ dysfunction score, 0–15. **Prognosis, not diagnosis.** Serial scoring
  lifts AUROC from 0.76 → 0.89 at +12 h.
- **[[heart-rate-variability-neonatal-sepsis]]** — see above.

## Paediatric (out of MVP scope, but defines the NICU boundary)

- **[[phoenix-sepsis-score]]** — the 2024 paediatric criteria. Notable for using **SpO₂/FiO₂** as a
  first-class continuous substitute for PaO₂/FiO₂, and for the **7.1% vs 28.5%** mortality gap between
  resource settings for an identical score.

## Methodology — the traps between this vault and a working model

- **[[treatment-confounding-in-severity-scores]]** — see above. **Run the ablation experiment.**
- **[[auroc-is-not-clinical-benefit]]** — every number here is retrospective discrimination. Lead with
  **lead time and calibration**, and plan a **silent-mode prospective run** into the MVP.
- **[[prognosis-vs-diagnosis]]** — screen vs prognostic score vs diagnosis. Three products, three
  tunings. The vision's alert list conflates all three.
- **[[why-early-detection-is-possible]]** — what the vault actually supports (trend, texture,
  conjunction) and, just as importantly, **what it does not** (no adult early-prediction evidence
  captured; no lead-time number is licensed by anything here).
- **[[early-sepsis-ml-model]]** — the first ML model: an **additive** `sepsis_watch` signal that
  flags rising sepsis risk **before the rule fires** (adult ICU, PhysioNet 2019, gradient-boosted
  trees). Built rule-first — the model only *adds* lead time, never overrides. **Implemented.**
  Honest-evaluation stance: patient-level split, calibration, intervention ablation, setting caveat.

## Meta

- **[[open-questions]]** — the ingest queue and the decisions that will otherwise be made by default.

---

## Sources in `raw/`

| Source | Type | Authority | Status |
|---|---|---|---|
| [[sepsis-3-jama-2016]] — Singer et al., *JAMA* 2016 | guideline | **high** | current |
| [[surviving-sepsis-campaign-2026]] — Prescott et al., *Crit Care Med* 2026 | guideline | **high** | current *(extract only — 19 of 129 statements)* |
| [[surviving-sepsis-campaign-2021]] — Evans et al., *Intensive Care Med* 2021 | guideline | high | **superseded** by 2026 |
| [[phoenix-criteria-jama-2024]] — Schlapbach et al., *JAMA* 2024 | guideline | **high** | current |
| [[neonatal-sepsis-review-2024]] — Kariniotaki et al., *Antibiotics* 2024 | review | moderate | current |
| [[nsofa-systematic-review-2026]] — Cerbu et al., *Diagnostics* 2026 | review | moderate | current |
| [[news2-rcp-2017]] — Royal College of Physicians, 2017 | guideline | **high** | current *(secondary-sourced extract; one cell unresolved)* |
| [[physionet-cinc-2019]] — Reyna et al., *Crit Care Med* 2020 | dataset | moderate | current *(description only; data never in repo)* |

**All seven are `capture: extract`, not full text.** Absence of a statement in an extract is **not**
evidence of its absence in the source. See `CLAUDE.md`.

## Answered questions

- [[2026-07-14-what-defines-septic-shock-and-what-would-homunculus-need|What defines septic shock, and what would Homunculus need to detect it?]]
