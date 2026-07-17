---
type: concept
tags: [sepsis, treatment, adult-icu, time-critical]
sources: [surviving-sepsis-campaign-2026, surviving-sepsis-campaign-2021]
---

# Antimicrobial Timing in Sepsis

The clock that makes a sepsis alert worth building — and the recommendation that changed most
between guideline editions.

## Current guidance (2026)

| Situation | Recommendation | Strength | Certainty |
|---|---|---|---|
| **Septic shock** | Antimicrobials immediately, **ideally within 1 hour** | **Strong** | Very low |
| **Sepsis without shock** | **Within 1 hour** | **Strong** | Very low |
| **Possible sepsis without shock** | **Within 3 hours** of suspicion | Conditional | Very low |

([[surviving-sepsis-campaign-2026]])

## What changed from 2021 — and why it matters to this product

| | 2021 | 2026 |
|---|---|---|
| Septic shock | within 1 h, **strong** | within 1 h, **strong** |
| **Sepsis without shock** | **within 3 h, *weak*** | **within 1 h, *strong*** |

**The window for non-shock sepsis narrowed from three hours to one, and the recommendation hardened
from weak to strong.** ([[surviving-sepsis-campaign-2021]] → [[surviving-sepsis-campaign-2026]])

This is not a detail. It changes the specification of the alerting system:

- **An alert is only useful if it leaves time to act on it.** Under 2021, a system that flagged
  non-shock sepsis within 90 minutes was clinically fine. Under 2026, that alert is **already
  late** — the antibiotic should have been given.
- **The latency budget is therefore not an engineering nicety; it is a clinical requirement.** From
  physiological onset → data ingest → inference → alert → clinician sees it → antibiotic hangs, the
  whole chain must fit inside an hour, with enough margin left for the human part, which is the
  slowest and least compressible link.
- **This is the strongest available argument for the vision's escalation feature.** If an alert sits
  unacknowledged for 20 minutes, a third of the window is gone. Escalation is not a convenience
  feature — it is what keeps the recommendation inside the guideline.

## The "strong recommendation, very low certainty" pattern

Note the shape of these recommendations: **strong** with **very low certainty evidence** — a
combination that looks contradictory until you see what it encodes.

GRADE permits it when the **consequences are asymmetric**. The evidence that a 60-minute door is
better than a 180-minute door is weak. But the cost of being late is death, and the cost of being
early is an unnecessary dose of antibiotics. Faced with that asymmetry, the panel recommends
strongly on weak evidence — **deliberately, and it says so.**

**Homunculus must transmit this, not flatten it.** An alert that says "give antibiotics within 1
hour (Surviving Sepsis Campaign 2026)" without conveying that the underlying evidence is very low
certainty is misrepresenting the guideline it cites. The confidence in the *recommendation* and the
certainty of the *evidence* are two different numbers, and the vision's promise of "confidence
score + supporting evidence" only means something if both are shown. See [[grade-methodology]].

## Relevance to Homunculus

- **The 1-hour window is the design constraint for the entire adult sepsis pathway.** Every latency
  in the vision's pipeline — device → gateway → stream → inference → risk → recommendation →
  notification — is spending a budget that belongs to the clinician.
- **"Review antibiotic coverage" (an MVP-listed recommendation) is well-founded**, but timing is the
  higher-value intervention: *whether* antibiotics were given, and *when*, relative to the moment the
  criteria were first met. **That is a metric Homunculus can compute and display, and it is exactly
  what a sepsis quality programme already audits by hand.** It is arguably the most immediately
  saleable output in the whole system, and it needs no ML at all.
- **Time-zero must be defined and defensible.** "Within 1 hour" of *what*? Of shock recognition? Of
  the first qualifying vital sign? Of the alert? Retrospective sepsis studies live or die on this
  choice, and so will Homunculus's own performance claims. → [[open-questions]]

## Sources

- [[surviving-sepsis-campaign-2026]] (high) — 1 h for shock and for sepsis without shock (both
  strong, very low certainty); 3 h for possible sepsis (conditional).
- [[surviving-sepsis-campaign-2021]] (high, superseded) — the previous 3-hour weak recommendation
  for sepsis without shock.
