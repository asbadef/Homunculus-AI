---
type: concept
tags: [screening, scoring, adult-icu, deterioration, product-critical]
sources: [news2-rcp-2017, surviving-sepsis-campaign-2026]
---

# NEWS2

The **National Early Warning Score 2** is the UK national standard for spotting a deteriorating adult
at the bedside. It adds up **seven physiological parameters**, each scored 0–3 (aggregate 0–20), and
maps the total to a risk band with a defined escalation response. It is a **screen** — built to catch
deterioration early and prompt review, never to make a diagnosis.

NEWS2 matters to Homunculus for one blunt reason: it is **the score the current sepsis guideline tells
you to screen with** (NEWS/NEWS2/MEWS/SIRS over [[qsofa]], SSC 2026 — see [[sepsis-screening-tools]]),
**and** it is computable in real time from the telemetry the engine already ingests, with **no
laboratory value**. It is the most directly implementable clinical score in the whole project.

## The score

**Respiration rate** (/min): ≤8→3 · 9–11→1 · 12–20→0 · 21–24→2 · ≥25→3
**SpO₂ Scale 1** (%): ≤91→3 · 92–93→2 · 94–95→1 · ≥96→0
**Air or oxygen**: air→0 · supplemental O₂→2
**Systolic BP** (mmHg): ≤90→3 · 91–100→2 · 101–110→1 · 111–219→0 · ≥220→3
**Pulse** (/min): ≤40→3 · 41–50→1 · 51–90→0 · 91–110→1 · 111–130→2 · ≥131→3
**Temperature** (°C): ≤35.0→3 · 35.1–36.0→1 · 36.1–38.0→0 · 38.1–39.0→1 · ≥39.1→2
**Consciousness (ACVPU)**: Alert→0 · new Confusion / Voice / Pain / Unresponsive→3

**SpO₂ Scale 2** (hypercapnic respiratory failure only, target 88–92%, senior-authorised): ≤83→3 ·
84–85→2 · 86–87→1 · 88–92→0 · then 93–94 / 95–96 / ≥97 score 0 **on air** but 1 / 2 / (2-or-3) **on
oxygen** — the ≥97%-on-oxygen cell is unresolved across the captured secondary sources; see
[[news2-rcp-2017]].

## Risk bands and escalation

| Aggregate | Band | Response |
|---|---|---|
| 0 | routine | min 12-hourly obs |
| 1–4 | **low** | registered-nurse assessment; decide monitoring/escalation |
| **3 in one parameter** | **low–medium** | urgent ward-clinician review for the cause |
| 5–6 | **medium** | urgent doctor / acute-team review; consider Critical Care Outreach |
| ≥7 | **high** | immediate Medical Emergency Team; consider HDU/ITU |

Two design-relevant details: a **single parameter scoring 3** escalates even at a low total (one very
abnormal vital matters), and the response is always **review**, never an order — the same register
Homunculus keeps.

## Two scales, one lesson

NEWS2's whole reason for existing over NEWS is **Scale 2**: the population rule for SpO₂ was *wrong* for
hypercapnic patients, so a second, group-specific rule was carved out (and it even penalises
over-oxygenation). That is the score itself admitting, in a coarse way, that **"normal" can depend on
the patient**. It is a one-group exception; the general version of that idea is the next section.

## Relevance to Homunculus

- **Build the adult screen on NEWS2.** Every input is a monitor channel or a routine observation, so a
  continuously-recomputed NEWS2 with a visible trend is a **guideline-concordant, zero-ML, zero-lab**
  deliverable — more than most bedside monitors do. It slots in beside the existing SOFA/septic-shock
  rules as another `rules/` module.
- **But NEWS2 alone will produce the exact noise a clinician warned us about.** NEWS2 is a
  **population-threshold** score: it scores the same for everyone, ignoring the patient's chronic
  baseline and comorbidities. A patient with **chronic atrial fibrillation** whose normal pulse is
  100–110 scores points every reading; a **chronic-hypertensive** whose baseline systolic is high looks
  "fine" at a pressure that is actually a dangerous drop *for them*; a stable COPD patient perpetually
  on oxygen carries the +2 forever. Firing on chronic-normal values is precisely the alarm fatigue that
  makes clinicians stop trusting a score.
- **So NEWS2 needs a patient-relative / comorbidity-aware layer on top** — evaluate the *deviation from
  the patient's own baseline and known diagnoses*, suppress chronic-normal, and surface **acute change**
  (new-onset AF, a drop from a high baseline, new confusion). This requires new inputs the engine does
  not yet take: **admission diagnoses / comorbidities** and a **baseline vitals profile**. This is a
  first-class design requirement, not a nice-to-have — see [[patient-relative-alerting]] and
  [[open-questions]]. It is also the honest reading of NEWS2's own Scale 2: patient-group-specific
  normal, generalised to patient-specific normal.
- **ACVPU's "new confusion" already assumes a baseline.** Scoring "new" anything is impossible without
  knowing the patient's prior state — the same baseline the layer above needs.

## Sources

- [[news2-rcp-2017]] (high; secondary-sourced extract) — the full scoring table, risk bands, escalation,
  and the Scale 2 / ACVPU additions.
- [[surviving-sepsis-campaign-2026]] (high) — NEWS/NEWS2/MEWS/SIRS recommended over qSOFA for screening.
