# Homunculus Real-Time Engine — Design

**Date:** 2026-07-14
**Status:** Approved (design); implementation not yet begun
**Scope:** The real-time clinical intelligence engine — first vertical: **adult ICU sepsis**.
Second sub-project of Homunculus. Depends on the knowledge vault (first sub-project) for its
clinical content.

---

## Why this, and why now

The [vision](../../vision.md) describes a real-time copilot: ingest live device data, detect
deterioration, generate explainable recommendations, notify clinicians, explain every alert.
The [second-brain design](2026-07-14-second-brain-design.md) built the evidence base that makes
those recommendations defensible. This sub-project builds the engine that turns that evidence
into live, cited alerts against a streaming patient.

It is buildable **now**, because the recommendation logic is a deterministic rule engine driven
by the vault — it needs no trained model and no patient data. The ML model (third sub-project)
plugs into this engine later as an additional signal source, not a replacement.

## Non-goals

- **No ML model in this phase.** The engine exposes a seam for it; training is a separate spec.
- **No autonomous orders, ever.** The engine recommends; the clinician decides. (Charter rule 5.)
- **No diagnosis.** "Criteria for septic shock are met," never "the patient has septic shock."
- **No PHI, ever.** Synthetic scenarios only. No real patient data in this repository or in any
  prompt. (Charter rule 6.)
- **No Kafka / Kubernetes / vLLM / vector DB** in the first slice. Module boundaries are drawn so
  these can be adopted later without redesign, but adopting them now is YAGNI.
- **No ventilator/NICU vertical yet.** Adult sepsis first; each further vertical needs its own
  vault compile pass and its own rule set.
- **Not a medical device.** This is a research/demonstration system. Anything that would ship to
  a bedside is out of scope and would carry regulatory obligations addressed elsewhere.

---

## Approach

**Lean modular monolith. Pure, vault-driven rule engine.**

One FastAPI application, internally divided into modules whose boundaries map one-to-one onto the
vision's service list — so the system can be split into microservices later as a mechanical
refactor, not a rewrite. Recommendations come from deterministic clinical rules encoded from
vault articles; every alert is traceable to a vault source note, mirroring the vault's own "no
unsourced claim" rule.

Chosen over a vision-faithful microservice stack (Kafka/Redis/K8s from day one) because a working,
demonstrable slice is worth far more than production plumbing around logic that does not exist yet.
Chosen over an LLM-narrated engine because, in a clinical product, a fabricated sentence in an
alert is unacceptable; deterministic text that cites its source is the safe first version. Chosen
over an ML-first engine because there is no data yet, and because a rule engine cannot fall into
the [treatment-confounding](../../../Homunculus/wiki/concepts/treatment-confounding-in-severity-scores.md)
trap the way a naively-trained model can.

**Device simulation uses a realistic transport.** Scenarios are hand-authored deteriorating-patient
timelines (full narrative control), but they are delivered as **FHIR R4 Observations** (and,
optionally, HL7v2 `ORU^R01`) — so the Device Gateway is realistic from day one and a real hospital
feed plugs into the same seam later.

---

## Components

One app; each module is a directory with one clear responsibility and a well-defined interface.

### `sim/` — Device Simulator
Emits scripted patient scenarios as FHIR R4 Observations over HTTP/WebSocket to the gateway.
Scenarios are declarative timelines (YAML/JSON): per-patient values for vitals, labs, ventilator
settings, and infusion-pump rates, changing over simulated time, at a configurable clock rate.
**Ships with at least three scenarios** (see Testing). Knows nothing about the rules — it only
produces data, exactly as a real device would.

### `gateway/` — Device Gateway
Receives FHIR/HL7 messages, validates them, and normalizes into a single canonical internal
`Observation` type: `{patient_id, code (LOINC-style), value, unit, timestamp, source_device}`.
Malformed messages are rejected with a logged reason and do not crash the stream. **This module is
the seam where real hospital feeds replace the simulator** — nothing downstream knows the
difference.

### `state/` — Patient State / Timeline
Maintains, per patient, the current value of each signal plus its history — and, critically, the
**staleness** of each signal (the timestamp of the value it rests on). A four-hour-old lactate and
a fresh one are different evidence and are represented as such. Backed by Postgres, with an
in-memory hot cache for current values. This is the single source of truth the rules and (later)
the model both read.

### `rules/` — Clinical Rule Engine
Pure functions over patient state. No I/O, no side effects — trivially unit-testable. Computes:

- **NEWS2** — continuously, from vitals only, no lab dependency. The
  [recommended screening tool](../../../Homunculus/wiki/concepts/sepsis-screening-tools.md).
- **SOFA** — with explicit per-organ staleness; flags which sub-scores rest on stale inputs.
  ([sofa-score](../../../Homunculus/wiki/concepts/sofa-score.md))
- **Septic shock conjunction** — vasopressor requirement **and** lactate >2 **and** adequate fluid
  given; evaluated jointly, not as independent thresholds.
  ([septic-shock](../../../Homunculus/wiki/concepts/septic-shock.md))
- **Antibiotic-timing clock** — once criteria are met, tracks the 1-hour window.
  ([antimicrobial-timing-sepsis](../../../Homunculus/wiki/concepts/antimicrobial-timing-sepsis.md))

Each rule returns a structured **finding** carrying the vault source note(s) it derives from. This
is also where the future `model/` module adds findings alongside the rules.

### `reco/` — Recommendation Engine
Turns findings into **alerts** with the vision's schema: `severity · confidence · clinical
reasoning · supporting evidence · recommended actions · urgency`. Register is fixed:
recommendations a clinician evaluates, never orders. **`confidence` conveys the GRADE certainty of
the underlying recommendation** (e.g. "strong recommendation, very low certainty"), not a
fabricated probability — and that nuance survives to the UI.

### `notify/` — Notification + Escalation
Pushes alerts to connected dashboards (doctor + nurse views) over WebSocket. **Escalation timer:**
an unacknowledged high-urgency alert escalates to the next role after a configurable interval.
Escalation is a correctness requirement, not a convenience — with a one-hour antibiotic window,
twenty minutes of an unread alert spends a third of it
([antimicrobial-timing-sepsis](../../../Homunculus/wiki/concepts/antimicrobial-timing-sepsis.md)).

### `web/` — Dashboard API + Web UI
Live patient list with risk indicator; per-patient timeline (vitals, ventilator, labs, meds);
active alerts with their **full reasoning chain and citations**; acknowledge / escalate actions.
**Two roles: doctor view and nurse view** (the escalation path runs between them). Frontend is a
**React app** (Vite build), talking to the FastAPI backend over REST + a WebSocket for the live
alert/observation stream.

### `audit/` — Audit Log
Every alert, every recommendation, every acknowledgement and escalation, written immutably with
timestamps. Satisfies the vision's "every recommendation is logged / every action auditable"
requirement and is a precondition for any future clinical evaluation.

---

## Data flow

```
sim → (FHIR/HL7) → gateway → normalize → state (persist + staleness)
   → rules (on each update) → findings → reco → alert
   → notify/escalation → WebSocket → web dashboard
audit taps the alert + acknowledgement stream
```

### The ML seam (how sub-project 3 attaches)

`rules/` emits findings from a read of `state/`. The future `model/` module reads the **same**
`state/` and emits its own findings — a risk score with an estimated lead time — which `reco/`
merges with the rule findings. Every alert is labelled **rule-derived** or **model-derived** so a
clinician always knows which is which. The model is thus purely additive: it cannot silently
override a rule, and the engine runs unchanged if the model is absent.

---

## Safety register (non-negotiable — from the project charter)

1. **No orders.** Every output is "consider X, because Y (source); you decide."
2. **No diagnosis.** State criteria, not conclusions.
3. **No PHI.** Synthetic scenarios only; the canonical model is designed for de-identified data;
   real feeds terminate in the hospital environment and never enter this repository.
4. **No unsourced alert.** Every alert traces to a vault source note. An alert without a citation
   is a bug, caught in test.
5. **Confidence conveys evidence strength, honestly.** GRADE certainty reaches the UI intact;
   "strong recommendation on very low certainty evidence" is shown as exactly that.

---

## Error handling

- **Missing / stale data** — rules degrade gracefully and state what they are blind on ("lactate
  4 h old — consider repeat"). No value is ever fabricated.
- **Device disconnect** — the patient is marked stale, not silently dropped from the board.
- **Malformed FHIR/HL7** — rejected at the gateway with a logged reason; the stream survives.
- **Duplicate / out-of-order observations** — resolved by timestamp in `state/`.

---

## Testing

- **Scenario replays are the end-to-end tests.** Each scripted patient has an expected alert
  sequence with expected timing, asserted deterministically. Three seed scenarios:
  1. **Septic shock** — a patient sliding into shock; must fire the septic-shock alert within a
     bounded time of the lactate + vasopressor conjunction, citing
     [sepsis-3](../../../Homunculus/wiki/sources/sepsis-3-jama-2016.md).
  2. **Stable control** — must fire **no** sepsis alert (guards against alarm-happy rules).
  3. **Under-resuscitated sepsis** — lactate + hypotension **before** adequate fluid; must
     recommend fluid assessment, **not** declare septic shock (the fluid-vs-pressor distinction
     from the vault Q&A).
- **Rule unit tests** — each rule against vault thresholds (NEWS2 bands, SOFA points, the shock
  conjunction, the antibiotic clock).
- **Golden test** — the Q&A scenario reproduces: escalating vasopressor + stale lactate →
  "consider repeat lactate," with the full reasoning chain and citation.

---

## Done when

A clinician can watch the dashboard, see a simulated patient deteriorate in real time, and receive
a cited, explained septic-shock alert with a recommended action and an escalation path — with every
claim in that alert traceable to the vault, and no order and no diagnosis anywhere in it.

## Next sub-projects

- **Ventilator / respiratory vertical** — needs a vault compile pass (ARDSnet, lung-protective
  ventilation, weaning) before its rules can be written. This is the user's originally-emphasised
  area; it is deferred only because the engine is proven fastest on the vault-ready sepsis content.
- **The small ML model** — deterioration / risk prediction on public de-identified data
  (MIMIC-IV, eICU), attaching at the `model/` seam. Its own spec must settle the label, the
  time-zero, and the intervention-feature ablation described in
  [treatment-confounding](../../../Homunculus/wiki/concepts/treatment-confounding-in-severity-scores.md)
  and [open-questions](../../../Homunculus/wiki/concepts/open-questions.md).
