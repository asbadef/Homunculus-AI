---
type: concept
tags: [early-detection, monitoring, product-critical, thesis]
sources: [neonatal-sepsis-review-2024, nsofa-systematic-review-2026, sepsis-3-jama-2016]
---

# Why Early Detection Is Possible

Homunculus rests on a claim: **deterioration is detectable before conventional alarms fire.** This
article assembles what the vault actually supports for that claim, and what it does not.

## The evidence, from strongest to weakest

**1. Heart rate variability precedes late-onset neonatal sepsis by hours to days.**
The strongest and most direct support. Reduced HRV and transient decelerations appear *while the
heart rate is still within normal limits* — so no threshold alarm can fire, by construction. There is
a deployed instrument (HeRO) built on it. ([[neonatal-sepsis-review-2024]] →
[[heart-rate-variability-neonatal-sepsis]])

**2. Serial scoring beats single-timepoint scoring.**
nSOFA's discrimination for mortality improves markedly as it is repeated: **AUROC 0.76 at baseline →
0.85 at +6 h → 0.89 at +12 h** ([[nsofa-systematic-review-2026]]). The *trajectory* carries
information the snapshot does not. This is the general form of the Homunculus argument, and it is
measured, not assumed.

**3. Sepsis-3 is itself defined as a delta.**
Sepsis is an *acute rise* in [[sofa-score]] of ≥2 points — not a level. The consensus definition of
the disease is a **change over time** ([[sepsis-3-jama-2016]]). A monitoring system built on
thresholds is not merely suboptimal for sepsis; it is measuring the wrong kind of quantity.

**4. In neonates, the signs arrive in a known order.**
Tachycardia is early; **hypotension is late** ([[neonatal-sepsis-review-2024]]). Any alert keyed to
blood pressure fires after the useful window. The ordering of signs *is* the early-warning
opportunity.

## The mechanism, stated plainly

Threshold alarms ask: **"is this value outside its limits *right now*?"**

The information about deterioration lives in three places that question cannot reach:

- **Trend** — a value moving steadily through the normal range (FiO₂ crept from 0.25 to 0.40 over
  six hours; every reading was "normal").
- **Texture** — variability, spectral content, clustering of events (HRV; apnoea episodes bunching).
- **Conjunction** — several signals moving together, each individually unremarkable (rising lactate
  *and* escalating pressor dose *and* falling urine output → [[septic-shock]]).

A per-channel threshold alarm is blind to all three **by design**, not by poor tuning. This is why
the answer is not "better thresholds." It is why there is room for a system like Homunculus at all —
and it is the honest version of the pitch.

## What the vault does NOT support

Being precise here protects the project from its own marketing:

- **It does not support "predicting sepsis hours before onset" in the adult ICU.** No adult
  early-prediction evidence has been captured yet. The adult case currently rests on the *structural*
  argument (delta > threshold) plus nSOFA's serial-scoring result in neonates. **That is an argument,
  not a result.** → [[open-questions]]
- **It does not support any specific lead time.** "Hours, even days" is what a narrative review says
  about neonatal HRV. Nothing in the vault licenses a number on a slide.
- **It does not support a claim of clinical benefit.** Every performance figure here is
  *discrimination* (AUROC) from retrospective cohorts. The nSOFA review says outright that
  "prospective impact-of-implementation studies… are fewer than ideal." Detecting earlier and
  *improving outcomes* are different claims, and only the first has evidence.
  See [[auroc-is-not-clinical-benefit]].

## Relevance to Homunculus

- **Design for trend, texture and conjunction — not thresholds.** That is the entire technical
  thesis, and it drives the data architecture: raw waveforms and beat-to-beat series must survive the
  ingest pipeline, because averaging destroys texture ([[heart-rate-variability-neonatal-sepsis]]).
- **The measurable MVP claim is lead time.** Not "AI detects sepsis," but: *how many minutes or hours
  before the clinical action (culture drawn, antibiotic given, pressor started) did Homunculus flag
  this patient?* That is computable retrospectively, it is the number a clinician will actually ask
  for, and it is the only claim the current evidence base can carry.
- **Serial evaluation is not an optimisation — it is the product.** nSOFA at +12 h beats nSOFA at T0
  by 0.13 AUROC using the *same score*. Continuous re-evaluation is where the value comes from.

## Sources

- [[neonatal-sepsis-review-2024]] (moderate) — HRV precedes LOS by hours to days; tachycardia early,
  hypotension late.
- [[nsofa-systematic-review-2026]] (moderate) — serial scoring improves AUROC 0.76 → 0.85 → 0.89.
- [[sepsis-3-jama-2016]] (high) — sepsis defined as an acute *change* in SOFA ≥2.
