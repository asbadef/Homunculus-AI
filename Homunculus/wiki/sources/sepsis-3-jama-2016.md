---
type: source-note
raw: "../../raw/sepsis-3-jama-2016-raw.md"
authority: high
capture: extract
status: current
---

# Sepsis-3 (JAMA 2016)

**What it is.** The Third International Consensus Definitions task force paper (SCCM/ESICM).
It replaced the SIRS-based definition of sepsis that had stood since 2001, and it is the
reference definition of sepsis and septic shock in adults today.

**Authority: high.** International consensus statement from the two major critical care
societies. Ten years old and still current — [[surviving-sepsis-campaign-2026]] builds its
management recommendations on these definitions rather than replacing them.

## Key claims it supports

- Sepsis is **life-threatening organ dysfunction caused by a dysregulated host response to
  infection**, operationalised as an acute rise in [[sofa-score]] of **≥2 points** in a patient
  with suspected infection. → [[sepsis-3-definition]]
- SIRS criteria are **dropped** from the definition. Inflammation is a normal response to
  infection, not in itself a marker of a life-threatening one. → [[sepsis-3-definition]]
- [[septic-shock]] requires **both** vasopressors to maintain MAP ≥65 mmHg **and** lactate
  >2 mmol/L after adequate fluid resuscitation. Mortality >40%. → [[septic-shock]]
- Lactate >2 mmol/L is not merely a marker of severity but part of the definition — the
  metabolic component distinguishes septic shock (42.3% mortality) from fluid-resistant
  hypotension alone (30.1%). → [[lactate-in-sepsis]]
- [[qsofa]] (RR ≥22, SBP ≤100, GCS <15; ≥2 of 3) is a **bedside prompt**, AUROC 0.81 outside
  the ICU. → [[qsofa]]
- Full [[sofa-score]] table with per-organ thresholds. → [[sofa-score]]

## Limitations that matter to Homunculus

- **"Neither qSOFA nor SOFA is intended to be a stand-alone definition of sepsis."** Any
  system that fires an alert purely on a computed score is misusing these instruments. The
  suspicion of infection is a *clinical* input the score does not contain.
- **The cardiovascular sub-score is confounded by treatment.** It rises when a clinician starts
  a vasopressor. A model trained on SOFA trajectories partly learns *what the clinician did*,
  not only what the patient did — see [[treatment-confounding-in-severity-scores]].
- **Derived largely from retrospective US EHR cohorts.** The task force explicitly asks for
  prospective validation elsewhere. Homunculus will run in a different population.
- **Lactate is not universally available**, and the criterion passed with only 72.2% of task
  force votes — it "warrants revisiting."
- **Adults only.** Explicitly defers paediatric definitions — since answered by
  [[phoenix-criteria-jama-2024]], which in turn excludes neonates. See [[nicu-sepsis-gap]].

## Raw document

- [[sepsis-3-jama-2016-raw]] — the captured evidence this note summarises.
