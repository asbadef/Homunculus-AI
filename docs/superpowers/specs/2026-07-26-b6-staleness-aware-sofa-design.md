# B6 — Staleness-Aware SOFA Design Spec

**Date:** 2026-07-26
**Status:** approved-in-spirit (user: "then skip to B6").
**Depends on:** `rules/sofa.py`, `rules/septic_shock.py`, `state/timeline.py` (`PatientState.age`).

## Problem

`total_sofa` reads `state.latest(code)` regardless of how old that observation is. A renal point
computed from a **creatinine last measured 30 hours ago** is presented with the same confidence as
one from a fresh draw. The `PatientState.age(code, now)` method exists but no rule consumes it. A
score that silently leans on stale data can hand a clinician false confidence.

## Charter-safe framing (no invented clinical thresholds)

SOFA's scoring thresholds are sourced (Sepsis-3) and **do not change**. Staleness only affects
**transparency**: the system flags which SOFA inputs are old so the reasoning says so and confidence
is tempered. The freshness windows are **operational data-recency defaults** (configurable),
analogous to a monitor's refresh expectation — *not* a clinical claim that a value is "invalid" after
N hours. We do not drop stale values (that would silently under-score); we surface their age.

## Design

- **`DEFAULT_FRESHNESS: dict[SignalCode, timedelta]`** in `sofa.py` — per-input recency windows.
  Operational defaults (configurable), reflecting how fast each input class moves:
  - continuous / haemodynamic (MAP, vasopressor rates): ~1 h
  - lactate: ~6 h · GCS, PaO₂/FiO₂: ~8 h · creatinine, bilirubin, platelets: ~26 h
- **`stale_inputs(state, now, freshness=DEFAULT_FRESHNESS) -> list[SignalCode]`** — the SOFA inputs
  that are **present but older** than their window (missing inputs are already scored 0; not "stale").
  Ordered oldest-first for a useful "oldest: …" note.
- **`septic_shock.evaluate`** (already takes `now`): when the sepsis finding fires, compute
  `stale_inputs`; if non-empty, append a staleness note to the finding's `reasoning`
  (e.g. "Data recency: 2 SOFA input(s) stale — oldest creatinine ~30 h old; interpret the score with
  that in mind.") and reflect it in the reasoning register. No new Finding fields (the reasoning is
  already surfaced on the alert card), keeping the frontend untouched for this slice.

## Test plan (TDD)

- `stale_inputs` flags a creatinine older than its window; not a fresh one; ignores a missing input.
- Boundary: an input exactly at its window edge is not stale (age strictly greater = stale).
- Ordering: oldest input first.
- `septic_shock.evaluate` sepsis finding reasoning **includes** a staleness note when a SOFA input is
  stale, and **omits** it when all inputs are fresh.
- Regression: the SOFA *score* and which findings fire are unchanged by staleness (thresholds intact).

## Vault + guide

- `wiki/concepts/sofa-score.md`: add a short "Data recency" note — the score is a snapshot; stale
  inputs are flagged, thresholds unchanged; windows are operational defaults.
- Turkish guide: one-line note under SOFA that the engine now flags stale inputs.

## Out of scope (later)

Dropping/decaying stale inputs from the score; per-tenant freshness configuration UI; staleness on
NEWS2 and the patient-relative layer; a structured `stale` field on Finding + frontend badge (kept
text-only here).
