---
title: "National Early Warning Score 2 (NEWS2) — scoring specification"
source_url: https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/
authors: Royal College of Physicians (NEWS Development and Implementation Group)
publication: Royal College of Physicians
year: 2017
retrieved: 2026-07-19
type: guideline
capture: extract
status: current
---

> **Capture note — read before citing.** The primary RCP NEWS2 document is a PDF that could not
> be text-extracted cleanly. This specification is **compiled from secondary renderings** that
> reproduce the RCP table:
> - Shared NEWS/NEWS2 parameter bands (RR, SpO₂ Scale 1, air/oxygen, systolic BP, pulse,
>   temperature, consciousness): **MDCalc** — https://www.mdcalc.com/calc/1873/national-early-warning-score-news-2
> - SpO₂ **Scale 2** (hypercapnic target 88–92%) and **ACVPU**: **theimdoctor.com** —
>   https://theimdoctor.com/news2-the-national-early-warning-score/
> - Aggregate risk bands + clinical response: theimdoctor.com and the validation paper
>   Thomas A, et al., *Cureus* 2025;17(2):e79538 (PMCID PMC11942526).
>
> These are **secondary** sources. One cell disagrees across sources (SpO₂ Scale 2, ≥97% on
> oxygen — see the flag below). **Obtaining and capturing the primary RCP NEWS2 chart is still
> required** to remove that ambiguity and to raise this from secondary to primary sourcing.

# NEWS2 — National Early Warning Score 2 (RCP, 2017)

A standardised bedside track-and-trigger score for acute-illness severity in adults, computed from
**seven physiological parameters**, each scored **0–3**; aggregate **0–20**. Endorsed by NHS England
as the national standard. It is a **screening / deterioration-detection** tool, not a diagnosis.

## Scoring table (points by band)

**Respiration rate (breaths/min)**

| ≤8 | 9–11 | 12–20 | 21–24 | ≥25 |
|---|---|---|---|---|
| 3 | 1 | 0 | 2 | 3 |

**SpO₂ Scale 1 (%)** — default, for most patients

| ≤91 | 92–93 | 94–95 | ≥96 |
|---|---|---|---|
| 3 | 2 | 1 | 0 |

**SpO₂ Scale 2 (%)** — ONLY for confirmed hypercapnic respiratory failure with a target of 88–92%
(e.g. some COPD patients); requires senior-clinician authorisation to use.

| Saturation | Score |
|---|---|
| ≤83 | 3 |
| 84–85 | 2 |
| 86–87 | 1 |
| 88–92 | 0 |
| 93–94 on air | 0 |
| 93–94 on oxygen | 1 |
| 95–96 on air | 0 |
| 95–96 on oxygen | 2 |
| ≥97 on air | 0 |
| ≥97 on oxygen | **2 or 3 — CONFLICT** (see flag) |

> **Discrepancy flag.** theimdoctor.com lists **≥97% on oxygen = 2**. The official RCP NEWS2
> chart is widely reproduced elsewhere as **≥97% on oxygen = 3** (Scale 2 penalises over-oxygenation
> because it can suppress respiratory drive and worsen hypercapnia). This single cell is unresolved
> in the captured secondary sources — verify against the primary RCP chart before relying on it.

**Air or oxygen**

| Breathing air | On supplemental oxygen |
|---|---|
| 0 | 2 |

**Systolic blood pressure (mmHg)**

| ≤90 | 91–100 | 101–110 | 111–219 | ≥220 |
|---|---|---|---|---|
| 3 | 2 | 1 | 0 | 3 |

**Pulse (beats/min)**

| ≤40 | 41–50 | 51–90 | 91–110 | 111–130 | ≥131 |
|---|---|---|---|---|---|
| 3 | 1 | 0 | 1 | 2 | 3 |

**Temperature (°C)**

| ≤35.0 | 35.1–36.0 | 36.1–38.0 | 38.1–39.0 | ≥39.1 |
|---|---|---|---|---|
| 3 | 1 | 0 | 1 | 2 |

**Consciousness — ACVPU** (this is the change from NEWS's AVPU)

| Alert | new Confusion (C) / Voice (V) / Pain (P) / Unresponsive (U) |
|---|---|
| 0 | 3 |

The **C = new confusion** is NEWS2's addition: a change from the patient's baseline cognition scores
3, capturing new-onset delirium that AVPU missed.

## Aggregate score → risk band and clinical response

| Aggregate NEWS2 | Risk | Response (per RCP) |
|---|---|---|
| 0 | routine | Minimum 12-hourly observations |
| **1–4** | **Low** | Assessment by a competent registered nurse, who decides whether to increase monitoring frequency or escalate |
| **3 in any single parameter** | **Low–medium** | Urgent review by a ward-based clinician to determine the cause |
| **5–6** | **Medium** | Urgent review by a ward doctor / acute-team nurse; consider Critical Care Outreach |
| **≥7** | **High** | Emergency threshold — immediate assessment by a team with critical-care competencies (Medical Emergency Team); consider transfer to HDU/ITU |

## What NEWS2 is and is not

- It is a **population-threshold** score: the same band applies to every patient regardless of their
  chronic baseline. It does **not** adjust for comorbidities or a patient's individual normal.
- It is a **screening** tool optimised for **sensitivity** to deterioration, deliberately triggering
  review rather than asserting a diagnosis.
- SpO₂ Scale 2 exists precisely because a single population rule was wrong for one group (hypercapnic
  patients) — an in-built acknowledgement that "normal" can be patient-group-specific.
