---
type: concept
tags: [sepsis, definitions, adult-icu, shock]
sources: [sepsis-3-jama-2016, surviving-sepsis-campaign-2026]
---

# Septic Shock

**Septic shock is [[sepsis-3-definition|sepsis]] plus profound circulatory *and* cellular/metabolic
failure.** Both halves are required — and that pairing is the whole point of the definition.

## Criteria

Sepsis, **and both** of:

1. **Vasopressors required to maintain MAP ≥65 mmHg**, and
2. **Serum lactate >2 mmol/L** (>18 mg/dL), **despite adequate fluid resuscitation**.

Hospital mortality: **>40%**.

## Why both criteria — the numbers make the case

The Sepsis-3 task force tested each criterion alone and together
([[sepsis-3-jama-2016]]):

| Condition | Hospital mortality |
|---|---|
| Hyperlactataemia alone (>2 mmol/L), no vasopressors | 25.7% |
| Fluid-resistant hypotension on vasopressors, lactate ≤2 | 30.1% |
| **Both — septic shock** | **42.3%** |
| Both, with lactate >4 mmol/L | 49.7% |

The combination is not the sum of its parts; it identifies a different, far sicker patient. A
patient who needs pressors but clears lactate is compensating. A patient who has lactate but
holds pressure is in trouble but perfusing. **The one who needs pressors *and* still cannot clear
lactate has run out of both haemodynamic and cellular reserve** — that is the 42%.

For Homunculus this is a lesson in feature interaction: **the two signals must be evaluated
jointly, not as two independent thresholds.** Two "moderate" alarms firing separately (one for
pressure, one for lactate) is the traditional monitor's failure mode. One alarm that recognises
their *conjunction* is clinical intelligence — and it is the difference between a 30% patient and
a 42% patient.

## The hidden clock: "despite adequate fluid resuscitation"

The definition contains a time-and-treatment precondition, not just numbers. Lactate >2 with
pressors **before** adequate fluids is not septic shock — it may just be hypovolaemia.
"Adequate" is anchored by [[initial-resuscitation-sepsis]]: **≥30 mL/kg crystalloid within 3
hours** ([[surviving-sepsis-campaign-2026]], conditional).

So to classify septic shock correctly, a system must know **how much fluid has been given, and
when** — data that lives in the infusion pumps and the medication record, not the monitor. A
Homunculus that ingests vitals and labs but not fluid administration **cannot distinguish septic
shock from under-resuscitated sepsis**, and those two states call for opposite next actions
(escalate pressors vs give volume). This makes infusion-pump integration a *correctness*
requirement for the sepsis pathway, not a nice-to-have.

## Relevance to Homunculus

- **Detect the conjunction, not the components.** Rising lactate + escalating vasopressor
  requirement + fluids already given = septic shock, and the alert should say so with its full
  reasoning chain.
- **Escalating pressor dose is itself the signal.** The vasopressor infusion rate is continuously
  available from the pump. A norepinephrine dose that has been titrated upward three times in two
  hours is a deterioration trajectory that no threshold alarm will ever fire on — it is *within
  limits* at every instant.
- **Lactate is the rate-limiting input.** It arrives only when someone draws it. "Monitor lactate
  trend" and "consider repeat lactate" (both named in the MVP vision) are recommendations
  Homunculus can generate on solid ground: when the other criteria are moving and the lactate is
  stale, the missing measurement is the highest-value next action. See [[lactate-in-sepsis]].
- Mortality >40% justifies a high-urgency escalation path — this is the archetypal case for the
  vision's "if an alert is ignored, escalate to another clinician."

## Sources

- [[sepsis-3-jama-2016]] (high) — the criteria, the mortality table, the fluid precondition.
- [[surviving-sepsis-campaign-2026]] (high) — MAP target 65 mmHg (strong); norepinephrine
  first-line (strong); what "adequate fluid resuscitation" means in practice.
