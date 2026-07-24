---
title: Early Prediction of Sepsis from Clinical Data — The PhysioNet/CinC Challenge 2019
source_url: https://physionet.org/content/challenge-2019/1.0.0/
authors: Reyna MA, Josef CS, Jeter R, Shashikumar SP, Westover MB, Nemati S, Clifford GD, Sharma A
publication: Critical Care Medicine (challenge summary) / PhysioNet
year: 2020
doi:                     # NOT captured — do not cite a DOI we have not verified
retrieved: 2026-07-25
type: dataset
capture: extract
status: current
superseded_by:
---

> **Capture note (extract).** Only the **dataset description and challenge design** are captured
> here — the labelling rule, the columns, the evaluation metric, and the cohort provenance. The
> **data itself is NOT in this repo and never will be** (its own PhysioNet licence + the charter's
> no-PHI rule): it lives only at a user-provided local path at training time. Absence of a detail
> below is not evidence of its absence in the source. The **DOI is deliberately left blank** rather
> than guessed — verify against the primary paper before citing one.

## What the challenge is

A public early-warning benchmark: predict, at **each ICU hour**, whether a patient will develop
sepsis, using only data available up to that hour. Data are de-identified ICU records from **three
US hospital systems** (two released as training sets A and B, one held out).

## Labelling rule (time-zero)

Sepsis onset `t_sepsis` is defined by a **Sepsis-3 utilization proxy**: the co-occurrence, within a
defined window, of a suspected-infection event (blood culture + antibiotics) and a **≥2-point SOFA
rise**. The published `SepsisLabel` column is then shifted so it reads **1 for every hour from
`t_sepsis − 6` onward** for septic patients (and 0 throughout for non-septic patients). The shift is
what makes the target an **early-prediction** target rather than a concurrent one.

## Columns (per hourly row)

- **Vitals:** HR, O2Sat, Temp, SBP, MAP, DBP, Resp, EtCO2.
- **Labs / gases:** BaseExcess, HCO3, FiO2, pH, PaCO2, SaO2, AST, BUN, Alkalinephos, Calcium,
  Chloride, Creatinine, Bilirubin_direct, Glucose, Lactate, Magnesium, Phosphate, Potassium,
  Bilirubin_total, TroponinI, Hct, Hgb, PTT, WBC, Fibrinogen, Platelets.
- **Statics / admin:** Age, Gender, Unit1, Unit2, HospAdmTime, ICULOS.
- **Target:** SepsisLabel.

Most lab cells are **empty (missing)** at any given hour — the data are sparse and irregular, which
is why the feature layer must be missingness-tolerant.

## Evaluation metric

A **custom utility score** that rewards a positive prediction in a window *before* onset, penalises
false alarms on non-septic patients, and penalises late or missed predictions — normalised so a
perfect predictor scores 1 and no-prediction scores 0. AUROC alone is reported alongside but the
utility score is the challenge's headline number.

## Limitations

- **Setting-specific:** three US ICUs; performance is not guaranteed to transfer (cf. the Phoenix
  cross-setting mortality gap).
- **The label is a proxy** for Sepsis-3, inheriting that definition's known biases.
- **Adult ICU only** — nothing here addresses the NICU gap.
