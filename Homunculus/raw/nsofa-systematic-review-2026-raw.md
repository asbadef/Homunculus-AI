---
title: "Neonatal Sepsis as Organ Dysfunction: Prognostic Accuracy and Clinical Utility of the nSOFA in the NICU — A Systematic Review"
source_url: https://pmc.ncbi.nlm.nih.gov/articles/PMC12839694/
authors: Cerbu B, Boia M, Pantea M, et al.
publication: Diagnostics (Basel)
year: 2026
volume: 16(2):349
doi: 10.3390/diagnostics16020349
pmid: 41594325
retrieved: 2026-07-14
type: review
capture: extract
status: current
---

> **Capture note.** Structured extract from the open-access PMC copy. Not the verbatim full
> text. A **systematic review** — authority moderate-to-high for pooled prognostic performance,
> but it is not itself a consensus definition.
>
> **Known gap:** this review does *not* reproduce the nSOFA scoring table. The exact point
> thresholds (SpO₂/FiO₂ ratios, ventilation criteria, inotrope rules, platelet cut-offs) must
> be captured from the **original derivation paper (Wynn & Polin, 2020)**, which is not yet in
> `raw/`. Do not reconstruct the table from memory.

# nSOFA in the NICU — Systematic Review (Diagnostics 2026)

## What nSOFA is

A neonatal adaptation of SOFA, scoring organ dysfunction across **three domains**:

- **Respiratory** — escalating ventilatory / oxygen requirement
- **Cardiovascular** — vasopressor or corticosteroid support
- **Haematological** — thrombocytopenia (platelet count)

**Range 0–15.** The review cites the original work (Wynn 2020) showing a **cut-point of ≥4**
strongly separated mortality risk across time windows.

*(Exact per-domain thresholds are not given in this review — see the capture note above.)*

## Prognostic accuracy for mortality

Discrimination **improves with serial scoring** — this is the headline finding:

| Timepoint | Median AUROC |
|---|---|
| Baseline (T0) | 0.76 |
| +6 hours | 0.85 (IQR ≈0.81–0.88) |
| +12 hours | 0.89 (IQR ≈0.87–0.92) |

Best-reported values per study range **0.87–0.95**, median 0.90 (IQR 0.875–0.92):

- **Poggi et al.** — AUROC 0.95 at T0 for late-onset neonatal sepsis
- **Wynn et al.** — AUROC 0.93 at +12 h (VLBW, late-onset sepsis)
- **Lobo et al.** — AUROC 0.92 (Brazilian VLBW cohort)

"Discrimination improved at +6 versus T0 across centers"; "+6 h outperformed T0" consistently.

## Why neonates need their own score

- "Neonates — particularly preterm infants — differ physiologically, and consensus neonatal
  definitions remain unsettled."
- In preterm neonates, respiratory and haemodynamic deterioration "may be infectious or
  noninfectious" — cardio-respiratory instability is common in preterm physiology *regardless
  of infection*. This is precisely why adult and paediatric frameworks fail here.
- nSOFA uses only three domains to "preserve core pathophysiology while enabling granular,
  repeated assessments," and is described as a "developmentally sensitive, EHR-friendly
  approach" compared with earlier multi-organ indices such as NEOMOD.

## Validation status — PROGNOSIS, NOT DIAGNOSIS

Stated explicitly:

- nSOFA is validated for **prognosis** (mortality and morbidity prediction), **not for
  diagnosis**.
- **"Organ dysfunction scoring does not replace infection ascertainment."**
- "nSOFA primarily quantifies the severity and trajectory of organ dysfunction once clinical
  concern is present." It must be paired with cultures, clinical context, adjunct diagnostics
  and biomarkers.

## Stated limitations

- Evidence base "dominated by retrospective cohorts from higher-resource centers."
- Heterogeneity in case definitions, scoring intervals and thresholds across studies.
- External validity to **term** neonates and to lower-resource settings "remains incompletely
  characterized."
- Limited calibration or decision-analytic metrics reported.
- Prospective implementation-impact studies and head-to-head comparisons with legacy severity
  indices "are fewer than ideal."
