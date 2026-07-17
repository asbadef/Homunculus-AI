---
type: question
date: 2026-07-14
asked: "What defines septic shock, and what would Homunculus need in order to detect it?"
articles_used: [septic-shock, sepsis-3-definition, sofa-score, lactate-in-sepsis, antimicrobial-timing-sepsis, treatment-confounding-in-severity-scores]
---

# What defines septic shock, and what would Homunculus need to detect it?

*Answered from the vault, 2026-07-14. This is the first Q&A run against the knowledge base — it
doubles as the acceptance test for the compile pipeline.*

---

## The definition

**Septic shock = [[sepsis-3-definition|sepsis]] + BOTH of:**

1. **vasopressors required to maintain MAP ≥65 mmHg**, and
2. **serum lactate >2 mmol/L**, **despite adequate fluid resuscitation**.

Hospital mortality **>40%**. ([[sepsis-3-jama-2016]])

And sepsis itself = **suspected infection + an acute rise in [[sofa-score]] of ≥2 points.**

## Why both criteria — and why this is the interesting part

The task force measured each criterion alone ([[sepsis-3-jama-2016]]):

| | Mortality |
|---|---|
| Lactate >2 alone, no pressors | 25.7% |
| Pressors, lactate ≤2 | 30.1% |
| **Both — septic shock** | **42.3%** |

**The conjunction identifies a different patient, not a sicker version of the same one.** Someone on
pressors who clears lactate is compensating. Someone with lactate who holds their pressure is
perfusing. The patient who needs pressors **and still cannot clear lactate** has exhausted both
haemodynamic and cellular reserve.

This is precisely what a threshold monitor cannot see. Two separate alarms — one for pressure, one
for lactate — is the bedside monitor's failure mode. **One alert that recognises their conjunction is
the product.** ([[septic-shock]])

---

## What Homunculus would need

### 1. Data it must ingest — and one that is usually forgotten

| Signal | Source | Availability |
|---|---|---|
| MAP | Patient monitor | **Continuous** |
| **Vasopressor dose and its rate of change** | **Infusion pump** | **Continuous** |
| Lactate | Lab / blood gas analyser | **Only when drawn** |
| **Fluid volume administered, and when** | **Infusion pump / EMR** | Continuous, but often not ingested |
| SOFA components (platelets, bilirubin, creatinine, PaO₂/FiO₂, GCS, urine output) | Lab, ventilator, nursing charts | Intermittent |

**The one that is usually forgotten is fluid administration — and it is a correctness requirement, not
a nice-to-have.**

The definition says lactate >2 with pressors **"despite adequate fluid resuscitation."** Before
adequate fluids, that same picture may simply be **hypovolaemia**. "Adequate" is anchored by the
guideline at **≥30 mL/kg crystalloid within 3 hours** ([[surviving-sepsis-campaign-2026]]).

So a Homunculus that ingests vitals and labs but **not** the infusion pumps **cannot distinguish
septic shock from under-resuscitated sepsis** — and those two states call for **opposite** next
actions (escalate pressors vs give volume). Getting that backwards at the bedside is not a
degraded feature; it is a harm. ([[septic-shock]])

### 2. The signal that no threshold alarm will ever fire on

**The vasopressor infusion rate is continuous, and its trajectory is the deterioration.**

A norepinephrine dose titrated upward three times in two hours is a patient losing ground — and at
**every single instant, the MAP is within limits.** That is the whole point: the alarm is silent
because the treatment is working, and the treatment is working harder every hour.

**That trajectory is computable today, from the pump, with no model.** ([[septic-shock]],
[[why-early-detection-is-possible]])

### 3. The recommendation the system should actually make

Lactate is the rate-limiting input: it exists only when someone draws it. When MAP is falling, the
pressor dose is climbing, and **the last lactate is four hours old**, the system is blind on the one
axis that would resolve the question.

So the correct output is not a diagnosis. It is:

> **"Consider repeat lactate.** Norepinephrine has been titrated up 3× in the last 2 h to hold MAP
> ≥65. The last lactate (3.1 mmol/L, 4 h ago) was already above the septic shock threshold. If it has
> risen, this patient meets criteria for septic shock — mortality >40%, and antimicrobials are
> indicated within 1 hour."

Every clause of that is traceable: the criteria to [[sepsis-3-jama-2016]], the 1-hour window to
[[surviving-sepsis-campaign-2026]] ([[antimicrobial-timing-sepsis]]), the mortality to the Sepsis-3
cohort tables. **It recommends a measurement, not a treatment. It explains itself. It needs no ML.**
And it is exactly the register the MVP vision demands. ([[lactate-in-sepsis]])

### 4. The trap to avoid

A model trained to predict septic shock will find that **"norepinephrine dose is rising" is a superb
predictor** — because the clinician starts norepinephrine *after* they have already noticed the
patient crashing.

The model will score beautifully in retrospective validation and be worthless in production: at the
moment its alert would be *valuable* (before the clinician acted), that feature is still zero. **It
has learned to predict the past.**

**The decisive experiment is cheap: ablate the intervention features and re-evaluate.** If
performance collapses, the model learned the clinician, not the patient. Run it before making any
claim. ([[treatment-confounding-in-severity-scores]])

---

## The short answer

**To detect septic shock, Homunculus needs the infusion pumps** — not just the monitor and the lab.
MAP alone cannot see it (the pressors are holding MAP up, which is what pressors do), and lactate
alone cannot see it (it arrives hours late). **The disease is defined by the conjunction of a
treatment and a metabolic failure**, so the treatment stream is not context — it is a *criterion*.

And once the pumps are ingested, **the single highest-value output requires no model at all**: notice
that the pressor requirement is escalating while the lactate is stale, and ask for a lactate.

---

## Filed back into the wiki

- The fluid-administration point strengthened [[septic-shock]] (infusion-pump ingest is now stated
  there as a *correctness* requirement, not an integration nice-to-have).
- The escalating-pressor-dose trajectory is recorded in [[septic-shock]] and
  [[why-early-detection-is-possible]] as a zero-ML early signal.
- **New gap identified:** no article yet covers **fluid responsiveness** or what "adequate fluid
  resuscitation" means at the bedside beyond the 30 mL/kg figure. Added to [[open-questions]] as
  [[initial-resuscitation-sepsis]].
