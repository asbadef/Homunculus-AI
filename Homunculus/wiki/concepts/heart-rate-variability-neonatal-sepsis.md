---
type: concept
tags: [nicu, neonatal, sepsis, monitoring, early-detection, product-critical]
sources: [neonatal-sepsis-review-2024]
---

# Heart Rate Variability and Neonatal Sepsis (HeRO)

**"Abnormal heart rates with decreased variability and transient decelerations are found to precede
the diagnosis of late-onset sepsis by hours, even days."** ([[neonatal-sepsis-review-2024]])

That sentence is the closest thing in this vault to **direct evidence for the Homunculus thesis** —
that deterioration is visible in continuous physiology long before it is visible to a threshold
alarm or a clinician.

## What HeRO is

The **HeRO score** (Heart Rate Observation), developed in 2005, is a non-invasive continuous
monitoring method that analyses **heart rate characteristics** — specifically reduced variability
and transient decelerations — to give "early indications of sepsis prior to any symptoms." It is
applicable to VLBW, preterm and term infants in the NICU. The review notes that combining it with
other risk-assessment tools improves outcomes.

## Why this signal exists, physiologically

Sepsis produces an inflammatory state that blunts autonomic modulation of the sinus node. The heart
rate becomes **less variable** — a stiffer, more mechanical rhythm — and shows brief decelerations.
Critically, this happens **while the heart rate itself is still within normal limits**.

This is precisely the failure mode of threshold alarms. Every instantaneous value is normal, so no
bedside monitor fires. **The information is not in the level; it is in the texture of the signal over
time.** A monitor that only asks "is HR between 100 and 180?" is structurally blind to it, no matter
how well it is tuned.

## Why it matters more than any other finding in the vault

1. **It is early.** Hours to days — not the minutes of a threshold alarm.
2. **It is continuous.** No lab draw, no nurse charting, no blood volume from a 900 g infant.
3. **It is already validated and deployed.** HeRO is not a research proposal; it is a commercial
   NICU product with a two-decade evidence base.
4. **It works precisely where the definitions fail.** The NICU has **no consensus sepsis
   definition** ([[nicu-sepsis-gap]]) — yet this signal predicts the *clinical event* anyway,
   without needing to first resolve what to call it.

## The uncomfortable implication for Homunculus

**The most valuable NICU capability in the vision may already exist as a product, and it is not an
LLM.** HeRO is a signal-processing method on a single channel — heart rate — deployed on a bedside
box.

That is not a reason to stop; it is a reason to be precise about where Homunculus adds value, and
honest about where it does not:

- **HeRO does one thing**: it produces a risk number from HR characteristics. It does not explain
  itself, it does not integrate ventilator settings, labs, feeding intolerance or nursing notes, and
  it does not tell a clinician what to consider next.
- **Homunculus's claim should be integration and explanation**, not the discovery of a new signal.
  "HRV is degrading **and** apnoeic episodes have increased **and** FiO₂ requirement has crept up
  **and** feeds were held twice — this pattern is consistent with evolving late-onset sepsis;
  consider blood culture and CRP, noting that CRP will be uninformative for the first 8–12 hours."
  That is a sentence HeRO cannot produce, and a clinician can act on.
- **Anything Homunculus claims for a new NICU signal must be benchmarked against HeRO.** A model
  that predicts LOS at some AUROC has not demonstrated anything until it is compared with an
  instrument that has been doing it since 2005.

## Relevance to Homunculus — engineering consequences

- **Heart rate must be ingested as a waveform or beat-to-beat series, not as a 1-minute average.**
  Variability *is* the signal. A pipeline that stores one HR value per minute has destroyed the
  information before the model ever sees it. **This is an architecture decision that must be made
  before the device gateway is built** — it is very expensive to retrofit, and the vision's
  "Streaming Engine" must be sized for it.
- The same is true of **apnoea and bradycardia events**: their *frequency and clustering over
  hours* is the signal, not any single event.
- This is the strongest argument in the vault for the vision's premise that "critical deterioration
  often begins several hours before traditional alarms are triggered." **In the NICU, that is not a
  hypothesis — it is documented.**

## Open questions

- The primary HeRO literature (Griffin & Moorman; the RCT of HeRO monitoring and its mortality
  effect) is **not yet in `raw/`** — this article rests entirely on a narrative review's summary of
  it. That is thin footing for a claim this load-bearing. **Capturing the primary sources is the
  top ingest priority for the NICU pathway.** → [[open-questions]]
- Does the HRV signal work equally for **early-onset** sepsis, or only late-onset? The review only
  claims LOS.

## Sources

- [[neonatal-sepsis-review-2024]] (moderate) — the HRV-precedes-LOS finding; the HeRO score;
  tachycardia early / hypotension late.
