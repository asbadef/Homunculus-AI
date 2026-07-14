---
type: concept
tags: [sepsis, labs, adult-icu, monitoring]
sources: [sepsis-3-jama-2016, surviving-sepsis-campaign-2026, surviving-sepsis-campaign-2021]
---

# Lactate in Sepsis

Lactate does two jobs in sepsis, and they are easy to confuse: it is **part of the definition** of
[[septic-shock]], and it is a **resuscitation target**.

## As a definitional criterion

[[septic-shock]] requires **lactate >2 mmol/L (>18 mg/dL)** *despite adequate fluid resuscitation*,
**together with** a vasopressor requirement. The threshold is not arbitrary — it separates
populations with markedly different mortality ([[sepsis-3-jama-2016]]):

| | Hospital mortality |
|---|---|
| Lactate >2, no vasopressors | 25.7% |
| Vasopressors, lactate ≤2 | 30.1% |
| **Vasopressors + lactate >2 (septic shock)** | **42.3%** |
| **Vasopressors + lactate >4** | **49.7%** |

Lactate is doing real work here: it is the **cellular/metabolic** half of the definition, the
evidence that tissue is failing to use oxygen even when pressure has been restored.

## As a resuscitation target

**Serial lactate measurements to guide resuscitation** — conditional, low certainty
([[surviving-sepsis-campaign-2026]]).

Two cautions from the guidelines themselves, and both are important for an automated system:

- **Do not chase complete normalisation.** 2026 states fluid administration after the initial bolus
  should be individualised **rather than targeting complete lactate normalisation**. A naive
  Homunculus rule of "lactate still elevated → recommend more fluid" would drive exactly the fluid
  overload the same guideline elsewhere recommends actively removing.
- **Lactate must be "interpreted considering the clinical context and other causes"**
  ([[surviving-sepsis-campaign-2021]]). Elevated lactate is not specific to sepsis: it also comes
  from seizures, exercise, regional ischaemia, hepatic failure, and — awkwardly for a sepsis
  system — **from beta-agonists such as epinephrine and salbutamol**, which are drugs given to
  exactly these patients.

## The awkward fact: lactate is the definitional criterion the system cannot see

Every other component of the sepsis picture is either continuous (MAP, HR, RR, SpO₂) or at least
frequently charted. **Lactate arrives only when a human decides to draw it.**

This has a consequence the project should confront early:

- The definition of septic shock **cannot be evaluated continuously.** Between draws, Homunculus
  does not know whether the patient meets criteria.
- The Sepsis-3 task force itself flagged that the lactate criterion "warrants revisiting" —
  it passed with only **72.2% of votes**, partly because lactate is not universally available
  ([[sepsis-3-jama-2016]]).

**So the highest-value lactate recommendation is often to obtain one.** When the continuous signals
are deteriorating (falling MAP, rising pressor dose, falling urine output) and the last lactate is
stale, the missing measurement is the bottleneck in the entire reasoning chain. *"Monitor lactate
trend"* and *"consider repeat lactate"* — both listed in the MVP vision — are therefore not filler
recommendations. **They are the system correctly identifying that it is blind on the one axis that
would resolve the question**, and saying so. That is a genuinely intelligent behaviour, it is fully
explainable, and it requires no model.

## Relevance to Homunculus

- **Model lactate with explicit staleness and a trend.** A lactate of 3.1 from four hours ago and a
  lactate of 3.1 from ten minutes ago are different evidence, and the dashboard must not draw them
  the same way.
- **Rising lactate + rising vasopressor dose is the septic shock trajectory** — evaluate them
  jointly ([[septic-shock]]).
- **Recommend the measurement, not the conclusion.** "Consider repeat lactate — MAP has required
  escalating norepinephrine over the last 2 h and the last lactate (3.1 mmol/L) is 4 h old" is a
  well-founded, fully explained recommendation.
- **Guard against the fluid-overload failure mode:** never recommend fluid purely on a lactate
  number. 2026 explicitly warns against targeting normalisation, and separately recommends **active
  fluid removal** after resuscitation.

## Sources

- [[sepsis-3-jama-2016]] (high) — the >2 mmol/L criterion, the mortality stratification, the
  availability caveat and the 72.2% vote.
- [[surviving-sepsis-campaign-2026]] (high) — serial lactate to guide resuscitation (conditional,
  low certainty); do not target complete normalisation.
- [[surviving-sepsis-campaign-2021]] (high, superseded) — lactate must be interpreted in clinical
  context.
