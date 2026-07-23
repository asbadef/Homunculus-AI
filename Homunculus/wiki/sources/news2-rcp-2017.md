---
type: source-note
raw: "../../raw/news2-rcp-2017-raw.md"
authority: high
capture: extract
status: current
---

# NEWS2 (RCP, 2017)

**What it is.** The National Early Warning Score 2 — the UK national standard bedside track-and-trigger
score for acute-illness deterioration in adults (Royal College of Physicians, 2017; endorsed by NHS
England). Seven parameters, each 0–3, aggregate 0–20, mapped to risk bands and an escalation response.

**Authority: high.** National consensus standard, in routine NHS use and widely validated. But see the
capture caveat — what is in `raw/` is compiled from **secondary** renderings, not the primary RCP PDF.

**Capture caveat.** The primary RCP document is a PDF that would not text-extract. The bands in `raw/`
come from MDCalc (shared NEWS/NEWS2 parameters), theimdoctor.com (SpO₂ Scale 2 + ACVPU), and the Cureus
validation paper (risk bands). One cell — SpO₂ Scale 2, ≥97% on oxygen — **conflicts** across sources
(2 vs 3) and is flagged unresolved. Capturing the primary RCP chart is still required.

## Key claims it supports

- **NEWS2 is the currently recommended hospital sepsis-screening tool**, over qSOFA (SSC 2026) —
  → [[sepsis-screening-tools]], and it is what Homunculus should build the adult screen on.
- **The full scoring table** (RR, SpO₂ Scale 1 & 2, air/oxygen, systolic BP, pulse, temperature,
  ACVPU) with exact bands. → [[news2]]
- **Computable from continuous telemetry + routine observations, with no laboratory value** — the
  reason it is the most directly implementable score in the engine. → [[news2]]
- **Aggregate risk bands and escalation response** (low 1–4, single-parameter 3, medium 5–6, high ≥7).
  → [[news2]]
- **SpO₂ Scale 2** shows the score itself acknowledging that a single population rule is wrong for a
  patient group (hypercapnic failure) — a built-in, coarse form of patient-group-specific "normal".
  → [[comorbidity-aware-alerting]] (design requirement), [[news2]]

## Limitations that matter to Homunculus

- **Population thresholds, not patient-relative.** NEWS2 applies the same bands to everyone regardless
  of chronic baseline or comorbidities. This is exactly the alarm-fatigue failure a clinician flagged:
  a chronic-AF patient at HR 100–110, or a chronic-hypertensive whose "normal" systolic is high, will
  score points that are noise for *that* patient. NEWS2 in Homunculus needs a **patient-relative /
  comorbidity-aware adjustment layer** on top. → see the project requirement
  [[comorbidity-aware-alerting]], [[news2]].
- **New-confusion (C) needs a known baseline.** ACVPU's "new confusion = 3" is only meaningful against
  the patient's prior cognition — the system must know the baseline to score it honestly.
- **Secondary-sourced, with one unresolved cell** (see caveat) — do not treat the ≥97%-Scale-2-on-oxygen
  value as settled until the primary RCP chart is captured.

## Raw document

- [[news2-rcp-2017-raw]] — the captured NEWS2 specification this note summarises.
