# Dashboard B2 — Acknowledge + Escalation — Design

**Date:** 2026-07-19
**Status:** Approved (design); implementation not yet begun
**Scope:** B2 — make the live board **actionable**: a clinician can acknowledge an alert, and an
unacknowledged high-urgency alert **escalates** on a server-side timer. Second slice of Plan B,
built on B1 (the read-only board).

---

## Why this

B1 gave Homunculus eyes — a live board showing cited alerts. But a board you can only *look at*
does nothing when no one looks. B2 closes that gap: alerts can be **acknowledged** (so the team
knows they're handled), and an alert that is **ignored** past a threshold **escalates** on its own.
Escalation is the feature that makes the antibiotic clock meaningful — with a one-hour window, an
alert nobody acts on has to raise its own voice.

## Decisions locked with the user

1. **Single board with a timer** (not role-split views, not per-clinician login). Everyone sees the
   same board; a simple role selector (doctor / nurse) records *who* acknowledged.
2. **Acknowledge marks, it does not dismiss.** An acknowledged alert stays visible showing
   "✓ acknowledged by {role} at {time}", and stops escalating. Alerts never silently vanish.
3. **Escalation clock runs server-side.** The whole point of escalation is that it fires when the
   alert is ignored — even if no dashboard is open. A background task scans alerts and flips
   unacknowledged high-urgency alerts to `escalated` past the threshold, then publishes.
4. **Threshold: 5 minutes, configurable.** Well inside the 1-hour antibiotic window. Only
   **high-urgency** alerts (urgency `immediate`) escalate.
5. **Role via query parameter / request field** (demo), reusing the tenant bearer token from B1.

## Non-goals

- **No notification delivery** (push / SMS / sound-to-phone) — that is B3. B2's escalation is
  **in-app visual** (banner, escalated section, optional in-page sound).
- **No real per-clinician authentication** — role is a label, not an identity. Auditable identity is later.
- **No comorbidity / patient-relative suppression** — that is its own slice
  ([[patient-relative-alerting]] in the vault). B2 handles alerts as the engine produces them.
- **No Postgres persistence** — ack + first-seen state is in-memory per tenant (B4 persists it).
- **No new clinical logic** — B2 is workflow on top of existing alerts. No orders, no diagnosis, no PHI.

---

## Architecture

Extends the B1 backend (`homunculus-engine/src/homunculus/api/`) and the React dashboard.

### Backend

Alerts are regenerated on every `/ingest` (the engine keeps the latest `Alert` per kind, and
`Alert` is a frozen dataclass). So **acknowledge state must live outside the alert**, in a
per-tenant registry, and be **merged into the board JSON** when the board is built.

- **Ack + first-seen registry** (`api/ackstore.py`, per tenant): two maps keyed by
  `(patient_id, kind)` — `acks: {by, at}` and `first_seen: datetime`. First-seen is stamped the
  first time an alert kind appears for a patient (needed for the escalation clock); the ack is
  stamped by `POST /ack`. Both survive alert regeneration as long as that kind persists; when a
  kind clears, its entries are pruned.
- **Escalation as a pure function** (`api/escalation.py`):
  `escalate(alerts, acks, first_seen, now, threshold) -> set[(patient_id, kind)]` returning which
  alerts are escalated (high-urgency, unacknowledged, `now - first_seen >= threshold`). Pure and
  clock-injected, so it is unit-tested without waiting on a real timer.
- **Background escalation task**: an asyncio loop (started on app startup) that every ~20 s, per
  tenant, calls `escalate(...)` and, when the escalated set changes, publishes the affected patient
  boards to the broadcaster (so open dashboards update live). Resilient: a failure in one cycle is
  logged and the loop continues.
- **`POST /ack`** (body: `patient_id`, `kind`, `role`; tenant bearer token): records the ack,
  publishes the updated patient board, returns it. Ack for an unknown/cleared alert is a no-op 404.
- **Board JSON** — each alert gains: `acknowledged` (bool), `acknowledged_by`, `acknowledged_at`,
  `first_seen_at`, `escalated` (bool). Built in `api/board.py` by merging the registry.

The engine and its alert schema are otherwise unchanged; `/ingest` additionally stamps first-seen.

### Frontend (dashboard)

- **Role selector** (doctor / nurse) in the header; the choice is sent with each `POST /ack`.
- **Acknowledge button** ("Onayla") on each alert card → `POST /ack`; the SSE board update reflects
  the acknowledgement. Acknowledged alerts render "✓ Onaylandı: {role} · {time}" and stop pulsing.
- **Escalated alerts** render a red "ESKALE EDİLDİ" banner and pull to the top; the patient list row
  shows an escalation indicator; an **"Eskale" section** surfaces all escalated alerts across
  patients. An optional short in-page sound on a new escalation (mutable).
- Register preserved: acknowledging never changes the recommendation text; alerts still cite the vault.

### Data flow

```
acknowledge:  Onayla → POST /ack → ackstore → publish board → SSE → UI shows ✓
escalation:   background task → escalate(now) → publish board → SSE → UI shows banner
ingest:       /ingest → engine → stamp first_seen → publish board (as in B1)
```

---

## Error handling

- **Ack for a cleared/unknown alert** → 404, no state change; the UI refetches `/patients`.
- **Escalation cycle failure** → logged, loop continues; never crashes the app.
- **A cleared alert kind** → its ack + first-seen entries are pruned so a re-raised alert starts fresh.
- **Tenant isolation** → ack, first-seen, escalation and their broadcasts are strictly per tenant
  (a tested invariant, as in B1).

## Testing

- **Backend (pytest):**
  - `escalate(...)` pure function: a high-urgency unacked alert older than the threshold is
    escalated; an acknowledged one is not; a low-urgency one is not; boundary at exactly the
    threshold. Clock injected — no real waiting.
  - `POST /ack` marks the alert acknowledged in the board and **stops** its escalation.
  - Ack + first-seen survive alert regeneration across repeated `/ingest`, and prune when a kind clears.
  - Tenant isolation: HOSP2 cannot ack or see HOSP1's alerts.
- **Frontend (Vitest + RTL):**
  - The Onayla button calls `/ack` with the selected role and the alert shows acknowledged.
  - An `escalated` alert renders the escalation banner and appears in the Eskale section.
  - Acknowledging removes the escalation state in the rendered board.

## Done when

A clinician watches the septic-shock scenario stream in, sees the shock alert, and **does nothing**
for the threshold — the alert turns to "ESKALE EDİLDİ" on its own (server-driven, even with the tab
just opened); then a nurse clicks **Onayla**, the alert shows "✓ Onaylandı: hemşire · {time}" and
stops escalating — with no order and no diagnosis anywhere, and HOSP2 unaffected.

## Next slices

- **B3** notification delivery (push / SMS / sound) — escalation currently in-app only.
- **B4** Postgres + audit (ack/escalation history is exactly what the audit trail must record) +
  multi-process pub-sub.
- **Patient-relative / comorbidity-aware suppression** ([[patient-relative-alerting]]) — which alerts
  are worth raising at all, per the clinician's requirement; pairs naturally with NEWS2.
- **NEWS2 rule** — now captured in the vault; implement as a `rules/` module, then apply the
  patient-relative layer.
