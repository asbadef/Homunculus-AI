---
type: concept
tags: [nicu, neonatal, scoring, prognosis]
sources: [nsofa-systematic-review-2026]
---

# nSOFA (Neonatal SOFA)

A neonatal adaptation of [[sofa-score]], scoring organ dysfunction across **three** domains rather
than six — chosen to be "developmentally sensitive" and EHR-friendly.

| Domain | What it captures |
|---|---|
| **Respiratory** | escalating ventilatory / oxygen requirement |
| **Cardiovascular** | vasopressor **or corticosteroid** support |
| **Haematological** | thrombocytopenia (platelet count) |

**Range 0–15.** A cut-point of **≥4** separates mortality risk (from the original Wynn derivation,
as cited by the review).

> **The exact scoring thresholds are not in this vault.** The systematic review does not reproduce
> the table, and the original derivation paper (**Wynn & Polin, 2020**) is not yet in `raw/`. The
> thresholds must be captured from the primary source — **do not reconstruct them from memory.**
> → [[open-questions]]

## What it is for — prognosis, not diagnosis

The review is unambiguous, and this matters more than the score itself:

- nSOFA is validated for **prognosis** — predicting mortality and morbidity.
- It is **not** validated for **diagnosis**.
- **"Organ dysfunction scoring does not replace infection ascertainment."**
- It "primarily quantifies the severity and trajectory of organ dysfunction **once clinical concern
  is present**."

In other words: nSOFA tells you *how bad it is* after someone has already decided something is
wrong. **It does not tell you to worry.** A Homunculus NICU alert built on nSOFA would therefore
fire only after the clinician had already acted — which is precisely the value the product claims to
add, and precisely what this score cannot deliver. See [[prognosis-vs-diagnosis]].

## The serial-scoring finding

This is the part worth taking seriously:

| Timepoint | Median AUROC (mortality) |
|---|---|
| Baseline (T0) | **0.76** |
| +6 hours | **0.85** |
| +12 hours | **0.89** |

Best per-study values reach 0.87–0.95 (Poggi 0.95 at T0 for LOS; Wynn 0.93 at +12 h in VLBW LOS;
Lobo 0.92 in a Brazilian VLBW cohort).

**The same score, applied repeatedly, gains 0.13 AUROC.** The information is in the *trajectory*.
This is the cleanest quantitative support in the vault for continuous re-evaluation as a design
principle — see [[why-early-detection-is-possible]].

## Limitations

- Evidence base is **retrospective, from higher-resource centres**.
- **Heterogeneous** case definitions, scoring intervals and thresholds across studies — the pooled
  AUROCs blend methodologies.
- External validity to **term** neonates and lower-resource settings is "incompletely
  characterized."
- **Calibration is barely reported.** For an alerting system this is arguably a bigger problem than
  discrimination: a score that *ranks* patients well but is systematically over-confident will
  generate alerts nobody trusts. → [[alarm-fatigue]]
- **"Prospective impact-of-implementation studies… are fewer than ideal."** → [[auroc-is-not-clinical-benefit]]

## Relevance to Homunculus

- **Use nSOFA for severity and trajectory, not for detection.** It is a legitimate way to answer
  "how sick is this infant, and which way are they going" — and an illegitimate way to answer "is
  this infant becoming septic." The detection job belongs to continuous signals
  ([[heart-rate-variability-neonatal-sepsis]]).
- Its three domains are cheap to compute from data Homunculus will already have: ventilator
  settings, infusion pumps, and platelet counts. **A continuously-updated nSOFA with a visible
  trend line is a realistic early deliverable** for the NICU dashboard — genuinely useful, and
  honest about what it is.
- The +6 h / +12 h result argues for **recomputing and displaying the trajectory**, not a single
  admission-time number.

## Sources

- [[nsofa-systematic-review-2026]] (moderate) — the three domains, 0–15 range, ≥4 cut-point, the
  serial AUROC progression, and the explicit prognosis-not-diagnosis limitation.
