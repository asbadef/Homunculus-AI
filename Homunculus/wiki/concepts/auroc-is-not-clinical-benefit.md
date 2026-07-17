---
type: concept
tags: [methodology, ml, evaluation, product-critical]
sources: [nsofa-systematic-review-2026, phoenix-criteria-jama-2024]
---

# AUROC Is Not Clinical Benefit

Every performance number in this vault is **discrimination measured retrospectively**. Not one is a
demonstration that acting on the score helped a patient. The gap between those two things is where
clinical AI projects die, and Homunculus should name it now rather than discover it later.

## What the sources actually say

- [[nsofa]] reports median AUROC **0.89** for mortality at +12 h — genuinely strong. The same
  systematic review states that **"prospective impact-of-implementation studies and head-to-head
  comparisons with legacy illness-severity indices are fewer than ideal"**, that the evidence is
  "dominated by retrospective cohorts from higher-resource centers," and that **calibration is
  barely reported** ([[nsofa-systematic-review-2026]]).
- [[phoenix-sepsis-score]] was derived and validated on large cohorts — and its own authors note the
  mortality endpoint **"omits infection-associated morbidity"**, and that higher-resource derivation
  data came **only from US children's hospitals** ([[phoenix-criteria-jama-2024]]).

These are not weak papers. They are good papers, being honest about what their numbers mean.

## The three gaps between AUROC and benefit

**1. Discrimination ≠ calibration.**
AUROC says the model *ranks* patients correctly. It says nothing about whether "70% risk" means 70%.
An alerting system lives on calibration: a model that ranks beautifully but is systematically
over-confident will fire constantly, and clinicians will learn to ignore it. **Alarm fatigue is a
calibration failure, not a discrimination failure** — see [[alarm-fatigue]]. The nSOFA review notes
calibration is scarcely reported anywhere in the literature.

**2. Prediction ≠ actionability.**
A model can predict deterioration accurately and change nothing — because the prediction arrives too
late to act on, or because there is no action that alters the outcome, or because the clinician
already knew. **The correct question is not "how accurate is the alert?" but "what did the clinician
do differently, and did the patient do better?"** Only a prospective study answers that.

**3. Retrospective ≠ prospective.**
Retrospectively, the data is complete, the labels are clean, and the model sees a tidy record of what
happened. Prospectively, values arrive late or not at all, devices disconnect, the population differs
from the training set, and — most corrosively — **the model's own alerts change clinician behaviour,
which changes the outcomes it is being scored against.** A successful sepsis alert *prevents* the
sepsis it predicted, and is scored as a false positive for it.

## And the setting changes the answer

The clearest demonstration in the vault: a Phoenix score of ≥2 carries **7.1% mortality in
higher-resource settings and 28.5% in lower-resource settings**
([[phoenix-criteria-jama-2024]]) — the same score, a four-fold difference in what it means.

**A risk model is not a portable artefact.** It encodes the patients *and* the health system that
treated them. A model trained on MIMIC-IV and deployed in another country's ICU is making claims
about a population it has never seen. → [[generalisation-and-setting]]

## Relevance to Homunculus

- **Do not lead with AUROC.** It is table stakes, it is easy to inflate (see
  [[treatment-confounding-in-severity-scores]]), and no clinician has ever changed practice because
  of one.
- **Lead with lead time and with calibration.** *"Homunculus flagged this patient a median of N hours
  before the antibiotic was given, and when it says 70% it is right 70% of the time"* is a claim a
  clinician can evaluate — and it is honest.
- **Plan the prospective evaluation into the MVP, not after it.** Even a silent-mode deployment
  (running live, logging alerts, showing nobody) produces the only evidence that matters: **did it
  fire earlier than the clinician acted, and how often did it cry wolf?** This is cheap, it is safe
  (nothing is shown, so nothing can harm), it needs no ethics approval for an intervention, and it
  is the single highest-value experiment available to this project.
- **Report the failure modes alongside the successes.** The vision promises every recommendation
  explains *why*. That promise implies the system also knows when it is uncertain, and says so.

## Sources

- [[nsofa-systematic-review-2026]] (moderate) — strong AUROCs alongside the explicit admission that
  prospective implementation studies are lacking and calibration is under-reported.
- [[phoenix-criteria-jama-2024]] (high) — the resource-setting mortality gap; mortality omits
  morbidity; US-only higher-resource derivation.
