---
type: concept
tags: [methodology, ml, scoring, product-critical]
sources: [sepsis-3-jama-2016, phoenix-criteria-jama-2024, nsofa-systematic-review-2026]
---

# Treatment Confounding in Severity Scores

**Every severity score in this vault scores the treatment as well as the patient.** This is stated
as a limitation by the authors of each one — and it is the most dangerous trap on the path from the
knowledge base to a working model.

## The evidence

- **[[sofa-score]]** — the cardiovascular sub-score above 1 point is *defined by vasopressor doses*.
  Sepsis-3 acknowledges the score "can be affected by iatrogenic interventions"
  ([[sepsis-3-jama-2016]]).
- **[[phoenix-sepsis-score]]** — the authors list as a limitation that the score **"incorporates
  treatments delivered in response to sepsis"**: vasoactive agents and invasive ventilation are
  score inputs ([[phoenix-criteria-jama-2024]]).
- **[[nsofa]]** — all three domains are support-based: escalating ventilation, vasopressors or
  corticosteroids, and platelets (which drive transfusion decisions)
  ([[nsofa-systematic-review-2026]]).

## Why this breaks a naive model

Suppose Homunculus trains a model to predict deterioration, and gives it SOFA components as
features. The model discovers — correctly, and to its great benefit on the validation set — that
**"norepinephrine dose is increasing" is an outstanding predictor of bad outcome.**

Of course it is. **A clinician starts norepinephrine because they have already noticed the patient is
crashing.** The feature does not measure the patient's physiology; it measures *the doctor's belief
about the patient's physiology*, recorded some minutes after they formed it.

The model will look excellent in retrospective validation. It will be nearly useless in production —
because at the moment its alert would be *valuable* (before the clinician has acted), the feature
that carries all its signal is still at zero. **It has learned to predict the past.**

This failure has a name in the ML-for-healthcare literature (label leakage / treatment paradox), and
it is the single most common reason deployed clinical models underperform their published AUROCs.
It is also *invisible in offline evaluation* — the metrics look wonderful right up until deployment.

## The awkward corollary: the same trap sits inside the label

It is not only the features. **The label is usually treatment-defined too.**

"Sepsis" in a retrospective ICU dataset typically means *cultures were drawn and antibiotics were
started* — i.e. the clinician acted. So a model trained to predict "sepsis onset" is often trained to
predict **"the moment a clinician will order antibiotics."** A system that predicts clinician
behaviour perfectly adds nothing: it tells you what you were about to do anyway.

In the NICU this is even sharper, because there is **no definition to fall back on** —
[[nicu-sepsis-gap]].

## What to do about it

1. **Separate the feature classes explicitly.** Physiological signals (HR, HRV, RR, SpO₂, MAP,
   temperature) versus **intervention signals** (vasopressor dose, FiO₂ setting, ventilator mode,
   transfusion, antibiotic administration). Know which is which, in the schema, by name.
2. **Evaluate with intervention features ablated.** If the model's performance collapses without
   them, it has learned the clinician, not the patient. **This is a cheap, decisive experiment and it
   should be run before any performance claim is made.**
3. **Predict forward from a defensible time-zero**, with a **blanking window** before the clinical
   action. Predicting sepsis "at the time of the antibiotic order" is not prediction. Predicting it
   *four hours before* — using only data available at that moment — is.
4. **Prefer signals that lead the clinician**, not ones that trail them. This is exactly why
   [[heart-rate-variability-neonatal-sepsis]] is so valuable: HRV degrades **before** anyone
   intervenes, so it cannot be an echo of the intervention.
5. **Compute the severity scores anyway** — for display, for trend, for triage. They are excellent
   *descriptions* of how sick someone is. Just do not mistake a description for a prediction.

## Relevance to Homunculus

- **The MVP's headline metric should be lead time over clinician action**, and lead time is only
  meaningful if the model was blind to the action's precursors. This single design decision
  determines whether the product is real.
- **The dashboard and the model want opposite things.** The dashboard *should* show the vasopressor
  dose — it is exactly what a clinician needs to see. The model should be evaluated as if it could
  not. Keep the two pipelines conceptually separate.
- **Be sceptical of any impressive retrospective AUROC — including our own.** See
  [[auroc-is-not-clinical-benefit]].

## Sources

- [[sepsis-3-jama-2016]] (high) — SOFA cardiovascular score "can be affected by iatrogenic
  interventions."
- [[phoenix-criteria-jama-2024]] (high) — the score "incorporates treatments delivered in response
  to sepsis."
- [[nsofa-systematic-review-2026]] (moderate) — nSOFA's domains are support-based.
