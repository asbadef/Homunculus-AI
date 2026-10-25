# Group 2 · Lane B · slice B3a — Occupancy ("Doluluk")

**Date** 2026-10-26 · **Status** approved in conversation ("Doğru"), awaiting the user's read of
this file · **Branch** `feat/g2b-kabul` (implemented after B1a, on top of it)
**Builds on** B1a — `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md` (structure,
`GET /tenant/structure`, bed states, `beds.release`, the "Yataklar" tab, unit scope).
**Prototype** `tasarim-taslaklari/app/screens.js:173-214` (occupancy) on `origin/tasarim/prototip` —
visual language only.
**B3 split** (the user, 2026-10-26): B3a occupancy first (this file), B3b handover later in its own
slice with its own safety rules.

## 1. What this slice delivers

A ward-level bed view: which beds are free, occupied, being cleaned, reserved or out of service,
for how long, and the actions that move a bed between those states. It grows B1a's "Yataklar" tab
into its own screen.

## 2. Decisions (the user's, 2026-10-26)

| # | Decision | Why |
|---|---|---|
| D1 | **Two B3 slices, occupancy first.** | Occupancy is small and sits on B1a's structure; handover needs its own careful design (coverage, critical-alarm block, two signatures, expiry). |
| D2 | **Who sees it:** holders of `admissions.admit`, `admissions.discharge.confirm`, `admissions.view` or `beds.release` (nurse, charge nurse, physician) and the administrator — each limited to their own units. | Clinicians manage beds at night; the prototype's clerk role does not exist here. |
| D3 | **An occupied bed shows only the short name "Ahmet Y."** (first name + surname initial), produced on the server; no clinical data, no number, no birth date. | The screen is about beds, not patients; the same form the user chose for the wall display. |
| D4 | **Reserved and out-of-service states**, set and cleared by the charge nurse and the administrator through a new narrow permission; out of service always carries a reason. | The prototype has both; there is no way to take a bed out of use or hold it today. |
| D5 | **Admission into a reserved bed is allowed after an explicit confirmation** showing the reservation note; admission into an out-of-service bed is refused. | A reservation exists to receive the expected patient; it must not stand in that patient's way. |

## 3. Screen

- **Menu "Doluluk"** (own route, lane seam `// G2-B3a`). B1a's "Yataklar" tab under Hasta Kabul moves
  here; Hasta Kabul keeps Kabul and Taburcu.
- **Per unit header:** name and type; **"x / y dolu"** where y = usable beds (open, not out of
  service); counts of free, cleaning, reserved, out-of-service beds; a unit chooser with "Tümü".
- **Per room:** an isolation tag when `is_isolation`.
- **Bed tile:** label; state as colour **and** text; time in state ("temizlikte · 25 dk", from
  `state_updated_at`); occupied → "Ahmet Y.".
- **Actions** (each gated by its permission, each saying its result on screen as well as in a toast):

| Bed state | Action | Permission |
|---|---|---|
| Free | "Bu yatağa hasta kabul" → the Kabul form with this bed selected | `admissions.admit` |
| Free | "Rezerve et" (for whom / why, ≤ 200) | `beds.manage_state` (new) |
| Free | "Kullanım dışı" (reason: arıza / izolasyon temizliği / personel yetersizliği / diğer + note ≤ 200) | `beds.manage_state` |
| Cleaning | "Temizlik bitti · boş" | `beds.release` (B1a) |
| Reserved | "Rezervi kaldır" | `beds.manage_state` |
| Out of service | reason shown; "Kullanıma aç" | `beds.manage_state` |

Four languages (az default), Gece/Gün, 390/1440 px, keyboard and screen reader, no UUID, no raw key.

## 4. Backend

- **Bed states:** new `RESERVED`. Out of service = the existing `BLOCKED` plus a reason.
  Transitions added: AVAILABLE → RESERVED, RESERVED → AVAILABLE, RESERVED → OCCUPIED (admission
  with confirmation), AVAILABLE → BLOCKED; BLOCKED → AVAILABLE exists. `OCCUPIED` and the pending
  states cannot be reserved or blocked.
- **Columns (migration after B1a's `0012`; the number is fixed when the plan is written, after
  checking Lane A):** `beds.state_reason` (enum: FAULT / ISOLATION_CLEANING / STAFFING / OTHER, null
  unless BLOCKED), `beds.state_note` (≤ 200; the reservation note or the out-of-service note),
  cleared on leaving the state.
- **Permission** `beds.manage_state` → charge_nurse and hospital_admin (data migration for existing
  tenants, catalogue parity on the dashboard, four-language text).
- **Routes:** `POST /tenant/beds/{id}/reserve`, `/unreserve`, `/out-of-service`, `/return-to-service`
  — unit scope, stable error codes, tenant isolation, route-permission table.
- **Admission** (B1a's `POST /admissions`): a RESERVED bed needs `confirm_reserved: true`; without it
  the refusal `bed_reserved` carries the note so the form can ask.
- **`GET /tenant/structure`** gains, per bed, `state_since` and, for an occupied bed, `occupant_short`
  ("Ahmet Y.", built on the server from the admission's patient; nothing else about the patient).
- **Audit:** every state change — who, bed, from → to, reason/note.

## 5. Tests

Transitions allowed and refused (each state × each action); reserved-bed admission with and without
confirmation; out-of-service refusal; unit scope and tenant isolation on every route; the short
name never carries more than first name + initial (one-word names, names with spaces, Turkish and
Azerbaijani letters); counts and the usable-bed denominator; dashboard: every action's
permission gate, four languages, no UUID, the reserved-bed confirmation in the Kabul form.

## 6. Not in this slice

Printing the occupancy, beds-per-nurse figures, a "bed ready" notification, handover (B3b).
