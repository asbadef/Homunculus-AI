---
type: source-note
raw: "../../raw/phoenix-criteria-jama-2024-raw.md"
authority: high
capture: extract
status: current
---

# Phoenix Criteria (JAMA 2024)

**What it is.** The international consensus criteria for **paediatric** sepsis and septic shock
(Schlapbach, Watson, Sorce, et al., *JAMA* 2024;331(8):665–674). Replaces the 2005 SIRS-based
paediatric definition, moving children onto an organ-dysfunction basis in the same spirit as
[[sepsis-3-definition]] did for adults.

**Authority: high.** International consensus, derived and validated on large multi-site cohorts
across higher- and lower-resource settings.

## Key claims it supports

- **Paediatric sepsis = suspected infection + Phoenix Sepsis Score ≥2.** **Septic shock =
  sepsis + ≥1 cardiovascular point.** → [[phoenix-sepsis-score]]
- Four domains — respiratory, cardiovascular, coagulation, neurological — with full point
  thresholds. → [[phoenix-sepsis-score]]
- Mortality with Phoenix ≥2: **7.1% in higher-resource settings, 28.5% in lower-resource
  settings.** The same score means very different things in different health systems — a
  four-fold difference. → [[phoenix-sepsis-score]], [[generalisation-and-setting]]
- **The criteria explicitly EXCLUDE preterm neonates (<37 weeks), newborns still hospitalised
  after birth, and birth hospitalisations.** → [[nicu-sepsis-gap]]

## Limitations that matter to Homunculus

- **This is the single most important scope fact in the vault for the NICU half of the
  product:** neither Sepsis-3 (adults) nor Phoenix (children ≥37 weeks postconceptional,
  post-birth-discharge) covers the NICU population. Homunculus cannot borrow either. See
  [[nicu-sepsis-gap]].
- **The score incorporates treatments delivered in response to sepsis** — vasoactive agents,
  mechanical ventilation. Like SOFA, it partly measures the clinician's response. →
  [[treatment-confounding-in-severity-scores]]
- **Infection is identified by proxy** (microbiology results, antibiotic administration), not
  a gold standard. Any label derived this way carries that noise into a model.
- Higher-resource derivation data came **only from US children's hospitals**.
- Mortality is the endpoint; **morbidity is not captured** — and 30–40% of paediatric sepsis
  survivors face lasting health issues ([[surviving-sepsis-campaign-2026]]).

## Raw document

- [[phoenix-criteria-jama-2024-raw]] — the captured evidence this note summarises.
