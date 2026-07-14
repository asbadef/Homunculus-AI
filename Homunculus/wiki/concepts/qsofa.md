---
type: concept
tags: [sepsis, scoring, screening, adult-icu]
sources: [sepsis-3-jama-2016, surviving-sepsis-campaign-2021, surviving-sepsis-campaign-2026]
---

# qSOFA

A three-item bedside prompt introduced by [[sepsis-3-jama-2016]] for identifying patients with
suspected infection who are likely to do badly — **outside** the ICU, where labs are not to hand.

**≥2 of 3:**

| Criterion | Threshold |
|---|---|
| Respiratory rate | ≥22/min |
| Systolic blood pressure | ≤100 mmHg |
| Altered mentation | GCS <15 |

AUROC 0.81 (95% CI 0.80–0.82) for poor outcome outside the ICU.

## qSOFA has been demoted — twice

This is the clearest example in the vault of **guidelines changing their mind**, and it is worth
holding both positions rather than flattening them.

- **2016** ([[sepsis-3-jama-2016]]): qSOFA introduced as a prompt to *consider* sepsis and escalate
  investigation. Never proposed as a diagnostic test.
- **2021** ([[surviving-sepsis-campaign-2021]]): **strong recommendation AGAINST qSOFA as a single
  screening tool**, versus SIRS/NEWS/MEWS. The reason is stark — **sensitivity was only 24%** in
  the derivation study. It misses three out of four.
- **2026** ([[surviving-sepsis-campaign-2026]]): the position hardens into a positive
  recommendation for the alternatives — **use NEWS, NEWS2, MEWS or SIRS *over* qSOFA** (strong,
  moderate certainty).

## Why it failed, and the lesson

qSOFA was optimised for **specificity and predictive value** — its positives really are sick
(that is the AUROC 0.81). But screening needs **sensitivity**: the job is to not miss people. A
24%-sensitive screen is not a screen.

The instrument was sound; **it was deployed for a job it was not built for.** It answers "is this
patient with suspected infection likely to deteriorate?" and it was pressed into service to answer
"which patients might have sepsis?" — a different question with a different cost asymmetry.

**This is the single most transferable lesson in the vault for Homunculus.** A model with
excellent discrimination can still be the wrong instrument if it is pointed at the wrong decision.
Before building a sepsis alert, the project must state which question it answers:

- *"Who might be septic?"* → a **screen**. Optimise sensitivity; accept false positives; the cost
  of a miss is death, the cost of a false alarm is a look.
- *"Is this patient deteriorating?"* → a **prognostic trigger**. Optimise calibration; false
  positives are expensive because they arrive constantly and produce [[alarm-fatigue]].
- *"Does this patient have sepsis?"* → a **diagnosis**. Homunculus explicitly does not do this.

These are three products. Conflating them is how qSOFA got a strong recommendation against it.
See [[prognosis-vs-diagnosis]].

## Relevance to Homunculus

- **Do not build the sepsis screen on qSOFA.** Current guidance recommends against it, and the
  RR/SBP/GCS inputs are already in NEWS/NEWS2, which is recommended and richer.
- **NEWS2 is the currently recommended screening instrument and is not yet in this vault.** It is
  computed entirely from continuously-available observations (RR, SpO₂, oxygen use, SBP, HR,
  consciousness, temperature) — which makes it directly implementable from Homunculus's telemetry
  stream, with no lab dependency. Capturing the NEWS2 specification is the **highest-priority
  remaining ingest** for the adult pathway. → [[sepsis-screening-tools]], [[open-questions]]
- The qSOFA elements remain useful as *inputs*, and GCS <15 is a reminder that **mentation is part
  of the sepsis picture** — a signal that lives in nursing notes rather than the monitor.

## Sources

- [[sepsis-3-jama-2016]] (high) — the criteria, AUROC 0.81, and the "not a stand-alone definition"
  caveat.
- [[surviving-sepsis-campaign-2021]] (high, superseded) — strong recommendation against qSOFA as a
  single screening tool; the 24% sensitivity figure.
- [[surviving-sepsis-campaign-2026]] (high) — use NEWS/NEWS2/MEWS/SIRS over qSOFA (strong,
  moderate certainty).
