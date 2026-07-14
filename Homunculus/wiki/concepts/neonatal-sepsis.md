---
type: concept
tags: [nicu, neonatal, sepsis]
sources: [neonatal-sepsis-review-2024, nsofa-systematic-review-2026]
---

# Neonatal Sepsis

Sepsis in the newborn — with **no consensus definition** ([[nicu-sepsis-gap]]), a clinical picture
that inverts adult heuristics, and a gold standard (blood culture) that is unreliable in exactly the
patients who need it most.

## Early-onset vs late-onset

| | **Early-onset (EOS)** | **Late-onset (LOS)** |
|---|---|---|
| **Timing** | First 7 days (CDC); **first 72 h** for infants hospitalised from birth | Beyond 3–7 days |
| **Source** | Perinatal / maternal | Hospital environment or community |
| **Organisms** | Group B *Streptococcus* (term), *E. coli* (preterm/VLBW) — together **two-thirds of EOS** | Coagulase-negative staphylococci (high-income); Gram-negatives (low/middle-income). ***Candida* is the 3rd most common in VLBW** |

The distinction is operational, not academic: **they have different risk factors, different
organisms, and — crucially for Homunculus — different detectability.** The HRV signal
([[heart-rate-variability-neonatal-sepsis]]) is documented for **LOS**. EOS presents within hours of
birth, often before any monitoring baseline exists to detect a *change* from.

## Presentation — every adult heuristic breaks

- **Temperature instability, not fever.** Hyperthermia in term infants; **hypothermia** most often
  in preterms.
- **Respiratory:** tachypnoea, grunting, **apnoea**, cyanosis, nasal flaring, accessory muscle use.
- **Cardiovascular:** **tachycardia is early**. Hypotension and poor perfusion (delayed capillary
  refill, mottling, cool extremities) "**tend to arise later**."
- **Neurological:** lethargy, irritability, high-pitched cry, hypotonia, poor feeding.
- **Gastrointestinal:** **feeding intolerance**, vomiting, abdominal distension, jaundice.

Two of these deserve emphasis for a monitoring system. **Hypotension is late** — so a
blood-pressure-triggered alert is a late alert. And **feeding intolerance is early** — but it lives
in *nursing charting*, not on any monitor. A NICU system that ingests only device telemetry is
deaf to one of the earliest signs.

## Risk factors

**Prematurity is the single most significant factor** for both EOS and LOS — immune immaturity, low
transplacental maternal IgG (acquired mainly in the second half of pregnancy), and prolonged
hospital stay.

- **Maternal:** GBS colonisation, rupture of membranes **≥18 h**, intrapartum fever,
  chorioamnionitis.
- **Neonatal:** male sex, meconium-stained fluid, traumatic delivery, perinatal asphyxia, need for
  resuscitation/intubation at birth, congenital anomalies.
- **Iatrogenic (LOS):** central venous catheters, prolonged IV access, parenteral nutrition,
  invasive ventilation, long hospitalisation.

Note that most LOS risk factors are **known at admission and change slowly** — they are exactly the
kind of static context a risk model should condition on, rather than re-learning from vitals.

## Why the diagnosis is so hard

- **Blood culture needs ≥1 mL** for optimal detection — a serious volume from a 900 g infant.
  Sensitivity falls with small samples and low-level bacteraemia.
- **A negative culture does not rule out sepsis.** "Culture-negative" or "suspected" sepsis is
  common and its reported rates "vary widely in the literature."
- **Signs overlap** with respiratory distress syndrome, meconium aspiration, and simply *being
  preterm*.

**This is the ML label problem in its most acute form.** If the label is "culture-positive," the
model is trained to ignore every culture-negative septic infant — a large and unmeasured group. If
the label is "clinician treated for sepsis," the model learns to predict clinician behaviour. There
is no clean target. → [[nicu-sepsis-gap]], [[open-questions]]

## Biomarkers — and their timing, which decides their usefulness

| Marker | Rises | Peaks | The catch |
|---|---|---|---|
| **CRP** | 8–12 h | 24–48 h | **"Unacceptably low sensitivity within the first 24 h."** Two normal values (8–24 h apart) give **NPV 99.7%** — good for ruling *out*, useless for ruling *in* early. Single values must not drive decisions |
| **Procalcitonin** | 2–4 h | 6–12 h | Slightly better early sensitivity than CRP, slightly worse specificity |
| **Presepsin (sCD14)** | 2 h | 3 h | Best reported accuracy: **88.9% sens / 85.7% spec** for EOS |
| **I:T neutrophil ratio** | — | — | >0.22 (preterm), >0.27 (term); but elevated in **25–50% of uninfected infants** |
| **Platelets** | — | — | Thrombocytopenia is frequent, non-specific, and **late** |

**Neither CRP nor PCT is adequate as a single marker.** All are raised by fetal hypoxia, delivery
stress, RDS, meconium aspiration, IVH, surgery, and pneumothorax — i.e. by the ordinary business of
a NICU.

**The CRP kinetics are directly actionable for Homunculus.** If the system flags a possible LOS at
hour 0, a CRP drawn at hour 0 is close to worthless — it has not had time to rise. The correct
recommendation is not "send a CRP" but **"CRP will be uninformative for the next 8–12 hours;
consider culture now and PCT if available; a repeat CRP in 12–24 h is more informative than one
now."** That is a recommendation with a *reason*, of exactly the kind the MVP vision calls for —
and it comes straight out of the biomarker kinetics, no model required.

## Relevance to Homunculus

- **Ingest nursing observations, not just device telemetry.** Feeding intolerance, lethargy and
  temperature instability are early signs that no monitor emits.
- **Do not build the NICU alert on blood pressure.** It is a late sign, by the review's own words.
- **Condition on static risk** (gestational age, birth weight, central line days, ROM ≥18 h) — these
  are strong, known, and free.
- **Time the biomarker recommendations to the biomarker kinetics.** This is a place where the
  knowledge base directly produces a better recommendation than a model would.

## Sources

- [[neonatal-sepsis-review-2024]] (moderate) — EOS/LOS definitions and organisms, presentation, risk
  factors, biomarker kinetics, culture limitations.
- [[nsofa-systematic-review-2026]] (moderate) — preterm cardio-respiratory instability may be
  infectious or non-infectious.
