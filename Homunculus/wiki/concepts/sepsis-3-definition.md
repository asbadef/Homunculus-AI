---
type: concept
tags: [sepsis, definitions, adult-icu]
sources: [sepsis-3-jama-2016, surviving-sepsis-campaign-2026]
---

# Sepsis-3 Definition

Since 2016, sepsis in adults is defined as **life-threatening organ dysfunction caused by a
dysregulated host response to infection**. Two things in that sentence carry the weight. The
danger is not the infection; it is the **organ dysfunction**. And the dysfunction comes from the
*host's own response*, not from the pathogen directly. Sepsis is the body's defence turning on
the body.

Operationally: **suspected or documented infection + an acute increase in [[sofa-score]] of ≥2
points**. Baseline SOFA is assumed zero unless pre-existing organ dysfunction is documented. A
SOFA rise of ≥2 carries roughly **10% in-hospital mortality** — a 2- to 25-fold increase over
patients with SOFA <2.

## What Sepsis-3 removed, and why it matters

Sepsis-3 **abolished SIRS** from the definition. The old framework (temperature, heart rate,
respiratory rate, white cell count) identified *inflammation*, and inflammation is what a healthy
person does when infected. SIRS was so sensitive it was nearly meaningless — and so, in an ICU, it
was a machine for producing false alarms. The task force also dropped "severe sepsis" as a
category: under the new definition sepsis is *already* the severe entity, and the only escalation
above it is [[septic-shock]].

For a system like Homunculus, this history is a warning written in advance. **SIRS-style
threshold logic is exactly what bedside monitors already do, and exactly what clinicians have
learned to ignore.** Rebuilding it in software with an AI label on it would reproduce the failure
at higher cost. See [[alarm-fatigue]].

## The three inputs, only two of which are data

The definition needs: (1) suspected infection, (2) organ dysfunction, (3) the judgement that the
dysfunction is *attributable* to the infection.

Only the second is straightforwardly computable from telemetry and labs. **Suspicion of infection
is a clinical act** — it usually becomes visible in the record as a proxy (cultures drawn,
antibiotics started), and that proxy arrives *after* the clinician already suspected. Attribution
is judgement. The task force is explicit: **"neither qSOFA nor SOFA is intended to be a
stand-alone definition of sepsis"** ([[sepsis-3-jama-2016]]).

## Relevance to Homunculus

- The system can compute a rising [[sofa-score]] continuously. It **cannot** compute "suspected
  infection." It can only detect *evidence of suspicion* (culture orders, antibiotic
  administration) — which lags the clinician — or infer *risk* of infection from context.
- Therefore Homunculus should not claim "this patient has sepsis." It should say **"organ
  dysfunction is worsening; if you suspect infection, this now meets the Sepsis-3 threshold."**
  That framing is honest, is clinically actionable, and keeps the diagnosis where it belongs.
  It is also exactly the register the MVP vision demands: recommendations, never orders.
- **The alerting signal is a delta, not a level.** Sepsis-3 is defined by an *acute rise of ≥2
  points*, which means the system must hold a baseline per patient. In an ICU where many patients
  carry chronic organ dysfunction, an absolute SOFA of 6 may be normal for that person. Building
  the alert on absolute scores instead of per-patient deltas is the most obvious way to get this
  wrong.

## Sources

- [[sepsis-3-jama-2016]] (high) — the definition, the ≥2-point criterion, the SIRS removal, the
  stand-alone caveat.
- [[surviving-sepsis-campaign-2026]] (high) — current management guidance built on this
  definition.
