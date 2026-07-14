---
type: concept
tags: [sepsis, scoring, paediatric, definitions]
sources: [phoenix-criteria-jama-2024]
---

# Phoenix Sepsis Score

The paediatric counterpart to [[sofa-score]], introduced in 2024. It moved children off the
SIRS-based 2005 definition and onto an organ-dysfunction basis — the same conceptual shift
[[sepsis-3-definition]] made for adults eight years earlier.

- **Paediatric sepsis** = suspected infection **+ Phoenix score ≥2**
- **Septic shock** = sepsis **+ ≥1 cardiovascular point**

## The score — four domains, max 13

**Respiratory (0–3)**

| Points | Criterion |
|---|---|
| 0 | PaO₂/FiO₂ ≥400 **or** SpO₂/FiO₂ ≥292 |
| 1 | PaO₂/FiO₂ <400 on respiratory support, or SpO₂/FiO₂ <292 on any support |
| 2 | PaO₂/FiO₂ 100–200 with invasive ventilation, or SpO₂/FiO₂ 148–220 with IMV |
| 3 | PaO₂/FiO₂ <100 with IMV, or SpO₂/FiO₂ <148 with IMV |

**Cardiovascular (0–6)** — three components, up to 2 points each: vasoactive agents (1 agent = 1,
≥2 agents = 2); lactate (5–10.9 mmol/L = 1, ≥11 = 2); age-adjusted MAP.

**Coagulation (0–2)** — 1 point each, capped at 2: platelets <100 ×10³/µL; INR >1.3; D-dimer
>2 mg/L FEU; fibrinogen <100 mg/dL.

**Neurological (0–2)** — GCS ≤10 = 1; bilaterally fixed pupils = 2.

## Three things worth noticing

**1. SpO₂/FiO₂ is a first-class citizen.** Phoenix deliberately allows SpO₂/FiO₂ *in place of*
PaO₂/FiO₂ at every respiratory level. Pulse oximetry is continuous and non-invasive; arterial blood
gas is neither. A score designed for children — from whom drawing blood is harder — built in the
continuously-measurable substitute. **For a continuous monitoring system this is the more useful
formulation**, and it is worth asking whether the adult [[sofa-score]] should be computed the same
way. → [[open-questions]]

**2. The same score means different things in different hospitals.** Mortality with Phoenix ≥2 is
**7.1% in higher-resource settings and 28.5% in lower-resource settings** — a four-fold difference
for an identical score. **A risk model is not portable across health systems**, because the score
measures the patient while the outcome depends on the system treating them. Any Homunculus
mortality-risk output must be calibrated to the deploying hospital, not shipped as a universal
constant.

**3. It scores the treatment.** Vasoactive agents and invasive ventilation are score *inputs*. A
child scores points because a clinician escalated support. See
[[treatment-confounding-in-severity-scores]].

## Scope — it does not cover the NICU

Phoenix **explicitly excludes** preterm neonates (<37 weeks), newborns still hospitalised after
birth, and birth hospitalisations. This is not a footnote; it is the reason
**[[nicu-sepsis-gap]]** exists. Do not apply this score in the NICU.

## Relevance to Homunculus

- If Homunculus ever covers paediatric ICU (not in MVP scope), this is the target definition.
- **The SpO₂/FiO₂ substitution is the transferable idea** for the adult and neonatal pathways
  alike: prefer the continuously-available proxy where it is validated, so the score can update in
  real time instead of waiting on a gas.
- The resource-setting mortality gap is a direct warning about **[[generalisation-and-setting]]**:
  a model trained on US data will not carry its calibration to another health system.

## Sources

- [[phoenix-criteria-jama-2024]] (high) — the score, the definitions, the exclusions, the
  resource-setting mortality difference, the treatment-incorporation limitation.
