---
type: concept
tags: [methodology, product-critical, alerting]
sources: [nsofa-systematic-review-2026, surviving-sepsis-campaign-2021, sepsis-3-jama-2016]
---

# Prognosis vs Diagnosis vs Screening

Three different questions, three different instruments, three different tuning targets. **The vault
contains two worked examples of what happens when they are confused, and both are cautionary.**

| Question | Instrument type | Optimise for | Cost of error |
|---|---|---|---|
| *Who might have sepsis?* | **Screen** | **Sensitivity** | A miss can kill; a false positive costs a look |
| *How sick is this patient, and which way are they going?* | **Prognostic score** | **Calibration** | Over-confidence produces [[alarm-fatigue]] |
| *Does this patient have sepsis?* | **Diagnosis** | Specificity + clinical judgement | **Homunculus does not do this** |

## Example 1 — qSOFA: a prognostic tool used as a screen

[[qsofa]] discriminates well (AUROC 0.81) for *poor outcome in patients with suspected infection*.
It was pressed into service as a *screening* tool and its sensitivity turned out to be **24%**
([[surviving-sepsis-campaign-2021]]). It now carries a strong recommendation against that use.

The instrument was never broken. **It was pointed at the wrong decision.**

## Example 2 — nSOFA: a prognostic score that cannot detect

[[nsofa]] achieves AUROC 0.89 for mortality at +12 h. Its own systematic review says, in as many
words, that it is validated for **prognosis, not diagnosis**, and that **"organ dysfunction scoring
does not replace infection ascertainment"** ([[nsofa-systematic-review-2026]]). It quantifies
severity **"once clinical concern is present."**

So an alert built on nSOFA fires *after* the clinician is already worried — which is the exact
moment at which Homunculus adds nothing.

## The rule this yields

**Before building any alert, write down the decision it serves.** Not the model, not the metric —
the decision. Who reads this alert, what do they do differently because of it, and what does it cost
when it is wrong in each direction?

An alert without a decision behind it is a notification, and a notification without a decision is
noise.

## Relevance to Homunculus

The MVP vision lists alert types spanning all three categories — "High Sepsis Risk" (a screen),
"Patient Deterioration Detected" (a screen or prognostic trigger), "High Mortality Risk" (purely
prognostic), "Possible Septic Shock" (approaching diagnosis). **These cannot be one model with one
threshold.** They are different products with different tuning and, honestly, different levels of
defensibility:

- **Deterioration detection (screen)** — well supported by the vault. Build this.
  → [[sepsis-screening-tools]], [[why-early-detection-is-possible]]
- **Severity and trajectory (prognostic)** — well supported. Compute [[sofa-score]] / [[nsofa]]
  continuously, show the trend. Honest, useful, no ML required.
- **"Sepsis probability" (diagnosis)** — **not supported**, and in the NICU there is not even a
  definition to be probable about ([[nicu-sepsis-gap]]). Sepsis-3 states plainly that neither qSOFA
  nor SOFA "is intended to be a stand-alone definition of sepsis" ([[sepsis-3-jama-2016]]).

The vision already says Homunculus "never issues direct medical orders" and "does not diagnose
patients autonomously." **This article is the clinical-evidence argument for why that constraint is
not merely a legal hedge — it is the only claim the evidence supports.**

## Sources

- [[nsofa-systematic-review-2026]] (moderate) — nSOFA is prognostic, not diagnostic; it quantifies
  severity once concern exists.
- [[surviving-sepsis-campaign-2021]] (high, superseded) — qSOFA's 24% sensitivity as a screen.
- [[sepsis-3-jama-2016]] (high) — neither qSOFA nor SOFA is a stand-alone definition of sepsis.
