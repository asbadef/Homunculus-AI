---
type: concept
tags: [meta, ingest-queue, product-critical]
sources: []
---

# Open Questions and Ingest Queue

The vault's own list of what it does not yet know. Maintained by the compile loop; every item is
either a **source to capture** or a **decision to make**.

*(This article makes no clinical claims of its own, so it cites no sources. Every claim it points at
is sourced in the article that carries it.)*

## Priority 1 — sources that load-bearing articles are standing on without full footing

| # | What is missing | Why it matters | Where it bites |
|---|---|---|---|
| 1 | **NEWS2 specification** (Royal College of Physicians) | The **currently recommended** screening tool, computable entirely from telemetry with no labs. The most directly implementable thing in the vault — and its parameter bands are **not captured**. Do not reconstruct from memory | [[sepsis-screening-tools]], [[qsofa]] |
| 2 | **HeRO / heart-rate-characteristics primary literature** (Griffin & Moorman; the HeRO RCT) | [[heart-rate-variability-neonatal-sepsis]] is the vault's strongest support for the entire product thesis, and it currently rests on **one narrative review's summary** of the primary work. That is thin footing for a load-bearing claim | [[heart-rate-variability-neonatal-sepsis]], [[why-early-detection-is-possible]] |
| 3 | **nSOFA derivation paper** (Wynn & Polin, 2020) | The **scoring thresholds are not in the vault** — the systematic review omits the table | [[nsofa]] |
| 4 | **SSC 2026 full text** (Crit Care Med 54(4):725–812) | Only ~19 of **129 statements** are captured, from SCCM's summary page. Critically: **does the guideline say anything about automated screening, ML, or clinical decision support?** Unknown. This bears directly on what Homunculus is allowed to claim | [[surviving-sepsis-campaign-2026]] |

## Priority 2 — concepts referenced but not yet written

These wikilinks appear in articles and resolve to nothing. Each is a candidate article; **none may
be written without capturing a source first.**

- **[[alarm-fatigue]]** — referenced 5× across the vault as a central design risk, with **no source
  captured**. The literature exists (ICU alarm burden, false-alarm rates, the Joint Commission
  National Patient Safety Goal on alarm management). **Highest-value missing article** — the whole
  "why not just thresholds" argument leans on it.
- **[[grade-methodology]]** — needed to explain "strong recommendation, very low certainty," which
  appears throughout [[antimicrobial-timing-sepsis]] and matters for how Homunculus reports
  confidence.
- **[[generalisation-and-setting]]** — the Phoenix 7.1% vs 28.5% mortality gap
  ([[phoenix-sepsis-score]]) needs its own treatment; it is the argument against shipping a model
  as a universal constant.
- **[[ml-for-sepsis-prediction]]** — the review states ML for neonatal sepsis is "not yet in clinical
  application." The prior art (Epic Sepsis Model and its external validation, TREWS, InSight)
  is **essential reading for this project** and is entirely absent from the vault. The Epic model's
  independent evaluation is the most important cautionary tale in the field.
- **[[map-target-sepsis]]**, **[[initial-resuscitation-sepsis]]**, **[[vasopressors-in-septic-shock]]**,
  **[[source-control-sepsis]]**, **[[fluid-overload-icu]]** — all have captured content in
  [[surviving-sepsis-campaign-2026]]; simply not yet compiled into articles.
- **[[neonatal-sepsis-biomarkers]]** — content captured in [[neonatal-sepsis]]; could be split out.

## Priority 3 — decisions the project must make explicitly

These are not research gaps. They are choices that will be made by default — badly — if nobody makes
them deliberately.

1. **What is the ML label?** In the adult ICU, Sepsis-3 gives a defensible (if imperfect) target. **In
   the NICU there is none** ([[nicu-sepsis-gap]]). Culture-positive? Clinician-treated? nSOFA ≥4?
   Each is biased in a knowable direction, and the choice determines what the model actually learns.
   **Decide and publish the reasoning; do not let the dataset's convenient column decide.**

2. **What is time-zero?** "Within 1 hour" of *what* ([[antimicrobial-timing-sepsis]])? Retrospective
   sepsis studies live or die on this definition, and so will any performance claim Homunculus makes.

3. **Screen, prognostic score, or diagnosis?** The vision's alert list spans all three
   ([[prognosis-vs-diagnosis]]). They cannot be one model with one threshold.

4. **Does the ingest pipeline preserve beat-to-beat heart rate?** If HR is stored as a 1-minute
   average, the **HRV signal is destroyed before the model sees it**
   ([[heart-rate-variability-neonatal-sepsis]]) — and HRV is the vault's best-evidenced early signal.
   **This must be settled before the device gateway is built**; it is very expensive to retrofit.

5. **Which dataset, under which licence and ethics approval?** MIMIC-IV and eICU are the obvious
   candidates for the adult model — but note that *every* adult early-warning claim in this vault is
   currently structural rather than empirical, because no adult early-prediction study has been
   captured ([[why-early-detection-is-possible]]).

## Priority 4 — domains not yet begun

The MVP vision spans far more than sepsis. Each of these needs its own compile pass:

- **Mechanical ventilation and respiratory failure** — ARDSnet, lung-protective ventilation, weaning
  and extubation readiness, ABG interpretation. The vision's ventilator integration has **no
  clinical content behind it at all** yet.
- **Haemodynamics and shock** beyond sepsis — fluid responsiveness, vasopressor selection.
- **Neonatal respiratory support** — RDS, surfactant, CPAP vs intubation.
- **Acute kidney injury** (KDIGO), **electrolytes**, **sedation and delirium** (RASS, CAM-ICU).
