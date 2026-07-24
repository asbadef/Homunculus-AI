---
type: concept
tags: [ml, sepsis, early-warning, adult-icu, product-critical]
sources: [physionet-cinc-2019, sepsis-3-jama-2016]
---

# Early Sepsis-Onset ML Model (Adult ICU)

An **additive statistical signal** that flags a patient trending toward sepsis **hours before the
deterministic [[sepsis-3-definition]] rule fires**. It attaches at the engine's `model/` seam,
labelled model-derived, and **never overrides or silences the rules** — if it merely re-stated what
the rule already knows, it would add nothing; its whole value is **lead time**.

## What it predicts, and time-zero

Trained on the [[physionet-cinc-2019]] cohort, whose `SepsisLabel` is already shifted to read
positive **6 hours before** the challenge's Sepsis-3 utilization-proxy onset. So the label *is* an
early-prediction target, and **time-zero is that onset definition** — one of the project's standing
[[open-questions]], settled here for the adult model. The model is **gradient-boosted trees**
(`HistGradientBoostingClassifier`, which tolerates the data's heavy missingness natively) with a
**logistic-regression baseline** kept alongside for transparency.

## Why it can see what a threshold cannot

The features are **windowed derivatives** of each vital and lab — last value, delta, min/max, and
slope over the recent window — not just the current number. That is deliberately the **trend and
texture** a fixed cut-off is blind to: a value drifting upward while still "in range", several
signals moving together. This is the same argument the vault makes for why early detection is
possible at all ([[why-early-detection-is-possible]]).

## Honest evaluation is the point of the slice

The build delivers the **pipeline and an evaluation harness that will not lie**, not a performance
guarantee:

- **No patient leakage:** the train/val/test split is **by patient**, never by hour.
- **Calibration, not just ranking:** Brier score alongside AUROC, because a risk number a clinician
  reads must be honest about magnitude.
- **Intervention-feature ablation:** train with and without treatment-adjacent features and report
  the delta — the [[treatment-confounding-in-severity-scores]] discipline, the Epic-Sepsis-Model
  cautionary tale made a routine check.
- **Generalisation caveat shipped with the model:** trained on three US ICUs; the Phoenix
  7.1 % vs 28.5 % cross-setting mortality gap ([[generalisation-and-setting]]) is the standing
  warning against treating a model as a universal constant. Revalidate before use elsewhere.

## How it surfaces

When the estimated risk crosses a configured threshold, the engine emits a **`sepsis_watch`** alert:
`source = "model"`, a modest severity (an early heads-up, not a crisis), a plain-language list of the
**top contributing signals**, and a confidence line that states outright it is a statistical model,
**not a diagnosis**, valid only in its training setting. It flows through the same board / ack /
[[patient-relative-alerting]] machinery as any alert, and it sits **beside** the rules, never over
them.

## Relevance to Homunculus

- It is the **first model** in a rule-first system, and the architecture enforces that order:
  rules decide; the model only *adds* an earlier prompt. This keeps the system explainable and
  auditable even as a statistical component enters.
- It **defers** the hard NICU problem (no gold-standard label — [[nicu-sepsis-gap]]) and waveform
  HRV features ([[heart-rate-variability-neonatal-sepsis]]) to later sub-projects on purpose.

## Sources

- [[physionet-cinc-2019]] (moderate) — the dataset, the 6-hour-shifted label / time-zero, the
  feasibility of early prediction from routine vitals and labs, and the utility metric.
- [[sepsis-3-jama-2016]] (high) — the underlying definition the label is a proxy for.
