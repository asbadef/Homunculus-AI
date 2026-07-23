---
type: concept
tags: [alerting, design-principle, comorbidity, product-critical]
sources: [news2-rcp-2017]
---

# Patient-Relative / Comorbidity-Aware Alerting

A **population-threshold** score judges every patient against the same boundaries. This article
records why that is not enough, and the design — now implemented in the engine — for judging a
patient against **their own charted baseline** instead. It is the general form of the idea NEWS2
already applies in one narrow case (see [[news2]]).

> **Provenance note.** The requirement was relayed by a collaborating clinician (2026-07). Its one
> *sourced* clinical footing in this vault is NEWS2's **Scale 2** ([[news2-rcp-2017]]); the deeper
> literature this rests on — [[alarm-fatigue]] and the comorbidity/baseline-variation evidence — is
> **not yet captured** (see [[open-questions]]). The clinician's specific judgements below are
> attributed as such, not presented as literature.

## The problem, in the clinician's own examples

- A patient with **chronic atrial fibrillation** whose usual pulse is 100–110 scores a NEWS2 pulse
  point on *every* reading. A chronically-abnormal patient — chronic AF plus, say, COPD tachypnoea —
  can **live at NEWS2 4–6** while completely at their own baseline. Alarming on that chronic-normal
  is exactly the [[alarm-fatigue]] that makes clinicians stop trusting the score.
- A **chronic-hypertensive** whose baseline systolic is 150–170 looks "fine" at 95 mmHg. The
  population score barely flags it — yet 95 is a **dangerous drop for them**. Here the population
  threshold *under*-represents a real, acute change.

The two failure modes point in opposite directions: the same population rule is **too loud** on the
chronic patient and **too quiet** on the acute deviation. Only the patient's own baseline
distinguishes them.

## NEWS2 already concedes the point — narrowly

NEWS2's whole reason for existing over NEWS is **Scale 2**: the population SpO₂ rule was *wrong* for
patients in chronic hypercapnic respiratory failure, so a second, group-specific rule was carved out
(it even penalises over-oxygenation). That is the score itself admitting, coarsely, that **"normal"
can depend on the patient** ([[news2-rcp-2017]]). Patient-relative alerting is that admission
generalised from *one group* to *the individual*.

## The design (implemented)

The engine keeps the population score honest and adds a layer on top — it never rewrites the NEWS2
number, because that number *is* the population score and misreporting it would be dishonest.

- **A clinician-entered profile** carries the patient's **comorbidities** and **baseline vital
  ranges** (e.g. baseline pulse 120–130, baseline systolic 150–170). Baselines are **charted by a
  clinician**, not learned from telemetry — learning a rolling baseline is a later ML task and risks
  mistaking the acute-illness window for "normal."
- **Downgrade chronic-normal.** If *every* vital that scored NEWS2 points sits **within the patient's
  charted baseline**, the finding is chronic-expected: it stays **visible** on the board, marked
  *"Beklenen (kronik)"* with the reason, but it **does not alarm or escalate**. If even one
  points-scoring vital is outside baseline, the finding keeps alarming and names the **acute
  contributor**.
- **Surface acute deviation.** When a charted vital's latest value falls **outside** its baseline
  range, the engine raises an `acute_change` finding — *"systolic 95 is below this patient's charted
  baseline 150–170 — assess for an acute cause."* This is the chronic-hypertensive case the
  population score would have muffled.

**No minted thresholds.** The boundary is always the **clinician-charted range**, never a number
Homunculus invents — the charter's hard rule. The register stays review-only ("Assess…"), never a
diagnosis or an order.

## Relevance to Homunculus

- This is a **first-class requirement, not a polish step**: without it, NEWS2 in a real ICU produces
  precisely the noise the clinician warned about, and the product loses trust on day one.
- It needs an input the telemetry does not carry — the **profile** (comorbidities + baselines) — so
  it also defines a data boundary: someone must chart the baseline. That is a workflow commitment,
  not just code.
- **ACVPU's "new confusion" already assumes a baseline** — you cannot score "new" anything without a
  prior state — so [[news2]] was quietly patient-relative in one cell before this layer existed.
- The honest next step is [[alarm-fatigue]] and the baseline-variation literature, so the *why* here
  graduates from a relayed clinical judgement to a sourced argument.

## Sources

- [[news2-rcp-2017]] (high; secondary-sourced) — Scale 2 as the in-vault precedent that "normal" can
  be patient-specific.
- *Design input:* collaborating clinician, relayed 2026-07 (the chronic-AF and chronic-hypertensive
  examples). Recorded as provenance, not as a literature citation.
- *Pending:* [[alarm-fatigue]] and comorbidity/baseline-variation evidence — see [[open-questions]].
