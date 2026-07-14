---
type: concept
tags: [sepsis, screening, adult-icu, product-critical]
sources: [surviving-sepsis-campaign-2026, surviving-sepsis-campaign-2021, sepsis-3-jama-2016]
---

# Sepsis Screening Tools

**Current guidance: use NEWS, NEWS2, MEWS or SIRS *over* [[qsofa]] for hospital sepsis screening** —
**strong recommendation, moderate certainty** ([[surviving-sepsis-campaign-2026]]). In the
prehospital setting, use a standardised screening tool (conditional, very low certainty).

## The tools, and what they need

| Tool | Inputs | Continuously computable? |
|---|---|---|
| **NEWS / NEWS2** | RR, SpO₂, oxygen use, SBP, HR, consciousness, temperature | **Yes** — every input is a monitor channel or a routine observation |
| **MEWS** | RR, SBP, HR, temperature, consciousness | **Yes** |
| **SIRS** | Temperature, HR, RR, WBC | Almost — WBC needs a lab |
| **qSOFA** | RR, SBP, GCS | Yes — but **recommended against** |
| **[[sofa-score]]** | 6 organs; labs + gases | **No** — updates in jumps ([[sofa-score]]) |

**The recommended screening tools are the ones Homunculus can compute in real time from the
telemetry stream it is already ingesting.** NEWS2 needs no laboratory value at all. This is a
fortunate alignment and it should shape the MVP: **a continuously-recomputed NEWS2 with a visible
trend is a defensible, guideline-concordant, zero-ML deliverable** — and it is more than most
bedside monitors do today.

## Screening is a different job from diagnosis

The history of [[qsofa]] is the cautionary tale, and it is worth stating the principle it teaches:

**A screening tool must be sensitive.** Its job is to *not miss* patients. Its false positives cost a
clinician a second look; its false negatives cost a life. qSOFA was demoted precisely because its
sensitivity was **24%** ([[surviving-sepsis-campaign-2021]]) — it was built for prediction, deployed
for screening, and failed.

**A diagnostic or prognostic tool can afford to be specific.** [[sofa-score]] and [[nsofa]] belong
here: they grade what is already suspected.

Homunculus must decide, for each alert it emits, **which job it is doing** — and tune it
accordingly. A single "sepsis risk score" that tries to do both will be too insensitive to screen and
too noisy to trust. See [[prognosis-vs-diagnosis]] and [[alarm-fatigue]].

## The screening tools are not sepsis-specific — and that is a feature

NEWS2 and MEWS detect **physiological deterioration**, whatever its cause. They were not built for
sepsis; they were built to find the patient who is getting worse.

This is worth sitting with, because it suggests the honest framing for the whole product. The
strongest thing Homunculus can say — the thing best supported by the vault — is **"this patient is
deteriorating, here is the evidence, and here are the causes consistent with the pattern (sepsis
among them)."** That is a claim the guidelines already endorse instruments for, and it does not
require the system to assert a diagnosis it is not permitted to make.

It is also, notably, the same conclusion the NICU evidence reaches from the opposite direction: there
the sepsis definition does not even exist, and deterioration detection is all that is available
([[nicu-sepsis-gap]]).

## Known gap

**NEWS2's specification is not yet in this vault.** It is the currently-recommended tool and the most
directly implementable one — the exact parameter bands and aggregate scoring must be captured into
`raw/` from the Royal College of Physicians source before anything is built on it. **Do not
reconstruct NEWS2 from memory.** → [[open-questions]]

## Relevance to Homunculus

- **Build the adult screen on NEWS2, not qSOFA.** It is what the guideline recommends, it is
  computable from the stream, and it aligns with what the receiving hospital's own protocols already
  use.
- **Screening sensitivity is the metric that matters** for the screening layer — not AUROC.
- Continuous NEWS2 + trend + the reasoning behind the score is a **shippable MVP increment** that is
  guideline-concordant on day one and requires no model, no dataset, and no ethics approval.

## Sources

- [[surviving-sepsis-campaign-2026]] (high) — NEWS/NEWS2/MEWS/SIRS over qSOFA (strong, moderate
  certainty); prehospital screening (conditional).
- [[surviving-sepsis-campaign-2021]] (high, superseded) — strong recommendation against qSOFA as a
  sole screening tool; the 24% sensitivity figure.
- [[sepsis-3-jama-2016]] (high) — qSOFA's derivation and intended (non-screening) purpose.
