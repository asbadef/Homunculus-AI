# Early Sepsis-Onset ML Model (Adult ICU) — Design Spec

**Date:** 2026-07-25
**Status:** approved (design decisions locked with the user)
**Sub-project:** the small ML model — the roadmap's next headline item after the rule engine + dashboard.

## Purpose

Add a **statistical early-warning signal** to the engine that flags a patient trending toward
sepsis **hours before the deterministic Sepsis-3 rule fires**. It is an **additive** signal at the
engine's `model/` seam — labelled model-derived, never overriding or silencing the rules, never a
diagnosis. If it merely re-states what the rule already knows, it has no value; its whole reason to
exist is *lead time*.

## Decisions locked with the user

1. **Population:** adult ICU (Sepsis-3 gives a defensible label; public de-identified data exists).
2. **Task / label:** **early sepsis-onset prediction** on the **PhysioNet/CinC 2019 Challenge**
   dataset — hourly `SepsisLabel` that turns 1 **six hours before** clinical onset. This settles
   label, time-zero, and evaluation metric in one well-trodden path.
3. **Model class:** **gradient-boosted trees** (XGBoost/LightGBM), with a **logistic-regression
   baseline** kept alongside. Small, CPU-trainable, explainable via feature importance / SHAP —
   every risk score can say which signals pushed it. Deep learning is rejected for this slice
   (black-box, data/compute-hungry, conflicts with the explainability charter).

## Charter / PHI boundary — non-negotiable

- **No patient data in the repo, ever.** PhysioNet 2019 data (its own licence) lives **outside**
  the repo at a user-provided path. The repo holds: pipeline code, a **tiny synthetic fixture** for
  tests, and a **metrics report**. The trained model artifact is data-derived → **not committed**;
  the checked-in training script reproduces it.
- **This environment cannot download the real data.** All tests here run on synthetic fixtures; the
  user runs real training against their local PhysioNet copy.
- **Recommendation register only.** The model output is "Consider / Assess…", model-derived,
  explicitly *not* a diagnosis, and carries the generalisation caveat below.

## Architecture

```
homunculus-ml/                         ← new package (training lives here, offline)
  src/homunculus_ml/
    data.py        ← load PhysioNet PSV files from a local path -> tidy per-hour frame
    features.py    ← per-hour feature engineering (windowed trend/texture), leakage-safe
    labels.py      ← align SepsisLabel / prediction horizon; time-zero definition
    split.py       ← patient-level train/val/test split (NO patient across splits)
    train.py       ← fit GBDT (+ LR baseline), persist artifact + feature list
    evaluate.py    ← PhysioNet utility score, AUROC, calibration, lead-time; ablation runner
    report.py      ← write the metrics report (committed; no PHI)
  fixtures/        ← tiny SYNTHETIC PhysioNet-shaped sample for tests
  tests/

homunculus-engine/src/homunculus/model/
    scorer.py      ← load artifact + feature list; score a live PatientState -> risk + top features
    (pipeline.py hooks it as an additive `sepsis_watch` alert, source="model")
```

The engine depends only on a small **feature-vector contract** (ordered feature names) shared with
training — not on the training package — so the engine stays lightweight.

## Feature engineering

Per patient-hour, from PhysioNet columns:
- **Vitals:** HR, MAP, SBP, RR, SpO₂, Temp.
- **Labs:** lactate, WBC, creatinine, platelets, bilirubin (+ others present).
- **Demographics:** age, sex, ICU length-of-stay hour.
- **Windowed derivatives** over 4–8 h: last value, delta from N-hours-ago, rolling min/max, slope.
  This is where the model earns its keep — **trend and texture** (a value drifting within "normal",
  several signals moving together) that a fixed threshold is blind to by construction.

**Leakage safety:** every windowed feature uses only data at or before the scoring hour (no
future rows). Enforced in code and asserted in tests.

**Intervention-feature ablation (required experiment):** train with and without treatment-derived
features and report the delta, so we measure how much the model leans on *the clinician's response*
rather than the patient's physiology (vault: [[treatment-confounding-in-severity-scores]], the Epic
Sepsis Model cautionary tale). PhysioNet 2019 is mostly vitals/labs, but the ablation discipline is
baked in regardless.

## Label and time-zero

`SepsisLabel` = 1 for every hour **≥ 6 h before** the utilization-based sepsis onset time
`t_sepsis`, per the challenge. The model predicts, at each hour, the probability that this hour is
within the pre-onset window. **Time-zero is the challenge's onset definition** — documented
explicitly, closing the vault's open question for the model. The prediction horizon is a config,
default matching the challenge.

## Evaluation

- **PhysioNet 2019 utility score** — rewards early true positives, penalises false alarms and
  late/missed. The metric the task was designed around.
- **AUROC** + **calibration** (reliability curve) — a risk score a clinician reads must be honest
  about magnitude, not just ranking.
- **Lead-time** distribution — how many hours before rule-fire the model would have flagged.
- **Patient-level split** with **no patient leakage** across train/val/test.
- **Generalisation caveat shipped with the model:** trained on specific US ICUs; the Phoenix
  7.1 % vs 28.5 % mortality gap ([[generalisation-and-setting]]) is the standing warning against
  treating a model as a universal constant. The report states the training setting plainly.

## Engine integration

- `model/scorer.py` loads the artifact + ordered feature list, builds the feature vector from a live
  `PatientState`, and returns `(risk_probability, top_contributing_features)`.
- The pipeline emits an additive **`sepsis_watch`** alert when risk crosses a configured threshold:
  `source="model"`, severity/urgency modest (an early heads-up, not an immediate crisis),
  `clinical_reasoning` = the top SHAP/importance contributors in plain language, `confidence` states
  it is a statistical model with the setting caveat. It **never** suppresses or overrides a rule
  finding, and it flows through the existing board / ack / patient-relative machinery like any alert.
- No profile / no model artifact present → the engine behaves exactly as today (seam is optional).

## Test plan (TDD, synthetic fixtures only)

- `data.py`: parse a synthetic PhysioNet-shaped PSV → tidy frame; handle missing cells.
- `labels.py`: SepsisLabel alignment + the 6-h pre-onset window; a patient who never gets sepsis.
- `features.py`: windowed features use only past rows (leakage assertion); deltas/slopes correct on
  a hand-built series.
- `split.py`: no patient id appears in two splits.
- `train.py`: fits on the fixture and persists an artifact + feature list that round-trips.
- `evaluate.py`: utility score on a hand-scored tiny case; ablation runner returns both variants.
- `model/scorer.py`: a known feature vector → deterministic score; missing signals handled.
- Engine: with a (fixture-trained) artifact, a deteriorating synthetic patient raises a
  `sepsis_watch` alert *before* the rule would fire; without an artifact, nothing changes.

## Honest scope for slice 1

Deliver the **reproducible training + evaluation pipeline**, the **honest evaluation harness**
(utility score, calibration, leakage guard, intervention ablation, lead-time), and the **engine
scoring seam**. **Not** a performance guarantee — a genuinely strong model is a research effort. The
slice makes the infrastructure correct and the evaluation trustworthy so that model quality can then
be improved against a metric that won't lie.

## Out of scope (later)

NICU/neonatal model (no gold-standard label — [[nicu-sepsis-gap]]); beat-to-beat HRV features
(needs waveform ingestion — [[heart-rate-variability-neonatal-sepsis]]); deep sequence models;
online / continual learning; automated retraining pipelines.
