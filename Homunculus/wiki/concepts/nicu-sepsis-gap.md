---
type: concept
tags: [sepsis, nicu, neonatal, definitions, product-critical]
sources: [phoenix-criteria-jama-2024, neonatal-sepsis-review-2024, nsofa-systematic-review-2026, sepsis-3-jama-2016]
---

# The NICU Sepsis Gap

**There is no consensus definition of sepsis for the NICU population.** Not a contested one — an
*absent* one. This is the most important single fact in the vault for Homunculus, because the
product promises "sepsis probability" in both ICU and NICU, and in the NICU there is no agreed
target to predict.

## The gap, stated precisely

| Population | Consensus definition | Source |
|---|---|---|
| Adults | **Yes** — Sepsis-3: suspected infection + [[sofa-score]] rise ≥2 | [[sepsis-3-jama-2016]] |
| Children <18 y | **Yes** — Phoenix: suspected infection + [[phoenix-sepsis-score]] ≥2 | [[phoenix-criteria-jama-2024]] |
| **Neonates in the NICU** | **NO** | [[neonatal-sepsis-review-2024]] |

And the exclusion is not an oversight — it is **explicit**. The Phoenix criteria specifically
exclude ([[phoenix-criteria-jama-2024]]):

- preterm neonates (**<37 weeks' gestation at birth**),
- **newborns who remained hospitalised after birth**,
- birth hospitalisations,
- any child whose postconceptional age is <37 weeks.

Those four exclusions describe **the NICU census**. The paediatric criteria are, by design, criteria
for children who have *left* the newborn period. Meanwhile Sepsis-3 is explicitly adults-only and
says so, deferring paediatrics to others.

The review literature is blunt: **"No clear consensus definition for sepsis in neonates exists"**
([[neonatal-sepsis-review-2024]]).

## Why neonates resist the organ-dysfunction framework

Sepsis-3 and Phoenix both define sepsis as *infection + organ dysfunction*. That works when organ
dysfunction is abnormal. **In a preterm neonate it is the baseline.**

A 27-week infant on CPAP with apnoea, desaturations, thrombocytopenia and labile blood pressure is
not septic — that infant is **preterm**. Respiratory and haemodynamic instability "may be
infectious or noninfectious," as the nSOFA review puts it
([[nsofa-systematic-review-2026]]); immature lungs, an immature autonomic system and a patent
ductus arteriosus produce the same numbers sepsis does.

Applying an adult or paediatric organ-dysfunction score here would flag most of the unit, most of
the time. The specificity collapses because the population's baseline *is* the abnormality the
score was built to detect.

## The clinical picture is also different

Neonatal sepsis does not look like adult sepsis ([[neonatal-sepsis-review-2024]]):

- **Temperature instability, not fever** — and in preterms, typically **hypothermia**. A
  fever-driven rule finds nothing.
- **Apnoea and bradycardia** are cardinal signs. In adults, bradycardia is not a sepsis sign at
  all.
- **Feeding intolerance and lethargy** are early and are *nursing observations*, not monitor
  channels.
- **Tachycardia is early; hypotension is LATE.** A blood-pressure-triggered alert in a neonate
  fires after the window has largely closed.

Every one of those inverts or breaks an adult heuristic. A model transferred from MIMIC-IV to a
NICU would not merely underperform — **it would be looking for the wrong signs.**

## What exists instead

Not nothing — but nothing that closes the gap:

- **[[nsofa]]** — a neonatal organ-dysfunction score. Excellent *prognostic* discrimination
  (AUROC up to 0.89 at +12 h), but its own systematic review states plainly that it is validated
  for **prognosis, not diagnosis**, and that "organ dysfunction scoring does not replace infection
  ascertainment" ([[nsofa-systematic-review-2026]]). It grades severity *once someone is already
  concerned*. It does not tell you to be concerned.
- **[[heart-rate-variability-neonatal-sepsis]]** — the HeRO score, and the finding that heart rate
  variability degrades **hours to days before** late-onset sepsis is diagnosed. This is the only
  instrument in the vault that is genuinely *early*, genuinely *continuous*, and genuinely
  *neonatal*.
- **Blood culture** — the nominal gold standard, which needs ≥1 mL of blood from a neonate and
  still "does not rule out sepsis" when negative. Culture-negative sepsis is common and its
  reported rates "vary widely."

## Relevance to Homunculus — this changes the product

1. **The NICU is not a parameter change on the ICU model. It is a different product.** Different
   physiology, different signs, different definition (none), different gold standard, different
   evidence base. Any plan that treats NICU as "ICU with paediatric reference ranges" is wrong at
   the foundation, and this vault should be cited when that plan is proposed.

2. **The ML label problem is severe.** Supervised learning needs a label. In the adult ICU, the
   label is Sepsis-3 (imperfect, but agreed). **In the NICU there is no agreed label to train
   against.** The options — culture-positive sepsis (misses culture-negative cases, which are
   many), clinician-treated sepsis (learns clinician behaviour, not disease), nSOFA ≥4 (measures
   severity and treatment, not infection) — are each biased in a knowable direction, and the choice
   determines what the model actually learns. **This must be decided explicitly and stated
   publicly, not settled by whichever column happens to be in the dataset.** → [[open-questions]]

3. **The honest NICU MVP is a deterioration detector, not a sepsis detector.** The evidence supports
   detecting *physiological deterioration* early (HRV, apnoea/bradycardia trends, escalating
   support) and surfacing it with its reasoning. It does not support claiming "sepsis probability"
   against a definition that does not exist. Framing the NICU alert as **"this infant is
   deteriorating; late-onset sepsis is among the causes that present this way"** is both more
   truthful and more useful — and it is what the underlying evidence will actually bear.

## Sources

- [[phoenix-criteria-jama-2024]] (high) — the explicit exclusion of preterm neonates and
  hospitalised newborns.
- [[neonatal-sepsis-review-2024]] (moderate) — no consensus definition; the distinct clinical
  presentation; culture limitations.
- [[nsofa-systematic-review-2026]] (moderate) — preterm instability may be infectious or
  non-infectious; nSOFA is prognostic, not diagnostic.
- [[sepsis-3-jama-2016]] (high) — adults only; explicitly defers paediatrics.
