# G2-B3b — «Vardiya devri»: the shift handover, per patient

**Date:** 2026-11-10 · **Lane:** B (session homunculus-ai-3b), assigned by Lane A · **Branch:**
`feat/g2b-b3b-devir`, cut from `46844297` (B5 RRT, itself on main `1c03557a`) · **Starting points:** the B1d finding
«handover'ın GET rotası yok; kritik kapısı canlı panoyu değil eskalasyon tablosunu sayıyor»; the B3 split
(`2026-10-26-g2b-doluluk-design.md`: «B3b handover later in its own slice with its own safety rules»); the design
prototype's `hand` screen and patient tab «Teslim notu» (`origin/tasarim/prototip`).

## 1. What exists

The backend lives in `admission/`: the `handovers` table (migration 0002), the `Handover` model, and three routes under `/handovers`. All three are gated by `handover.sign`:

| Route | What it does |
|---|---|
| `POST /handovers` | Opens a handover for a unit, an incoming user and a list of admissions. The bridge window is now + 30 min. |
| `POST /handovers/{id}/sign-outgoing` | The outgoing signature. Requires state OPEN, the outgoing user, and an unexpired bridge. Refused while a critical alarm is unacknowledged. Takes an optional `narrative_note`. Moves the handover to OUTGOING_SIGNED. |
| `POST /handovers/{id}/countersign` | The named incoming user countersigns. Moves the handover to COMPLETED. |

The model is per unit: one handover holds a list of admissions and one free-text note.

Gaps:
1. There is no GET route, so nothing can read a handover back.
2. The critical gate counts the Postgres escalation `Alert` table, which is never written on the VM. The live alarms are in memory. B1a closed the same gap for discharge with `BoardLink.open_critical`.
3. The routes write no audit rows and apply no unit scope.
4. `auto_populated_summary` is never filled.
5. There is no screen, and no list of colleagues a nurse could hand over to.

## 2. Owner's decisions (2026-11-10)

- **D1 — per patient**, as the prototype has it.
  - One handover is one patient: `admission_ids` holds one admission.
  - It carries a D-Ö-D-Ö note (Durum · Öykü · Değerlendirme · Öneri) and a system summary taken from the live board.
  - An unacknowledged critical alarm stops that patient's handover only.
  - No migration is needed.
- **D2 — the outgoing person chooses the receiver** from the colleagues who hold `handover.sign`. Only that person countersigns, which is the existing rule. A colleague list is added.

## 3. Decisions taken in the spec

### D3 — the critical gate reads the live board

- `sign-outgoing` counts the patient's open critical alerts through `BoardLink.open_critical(hospital, key)`, as B1a's discharge does: alerts that are firing or latched and that nobody acknowledged.
- The count is summed over the handover's admissions. In this slice that is one admission.
- B1a's `_open_critical` has a discharge-specific log line. That line is made neutral.
- The handover no longer calls the Postgres `escalation_service.count_unacknowledged_critical`. The function is not deleted.
- The refusal is unchanged: 409 with code `critical_alarm_open`.

### D4 — scope and checks on open

`POST /handovers` keeps its body, so existing callers and tests still work. Every admission must now also pass two checks:
- **(a)** It is in an open state (ACTIVE, PENDING_DISCHARGE or PENDING_TRANSFER). Otherwise 409 `invalid_transition`.
- **(b)** It is in the caller's units (`_reach_admission`). Otherwise 403 `out_of_scope`.

The screen sends exactly one admission. The API still accepts a list, and the gate sums over it.

### D5 — the note

`HandoverSign` gains an optional `note: {situation, background, assessment, recommendation}`.
- Each part is at most 2000 characters.
- At least one part must have at least 3 characters after trimming. Otherwise 422.

Storage and reading:
- The note is stored as JSON text in `narrative_note`: `{"v": 1, …}`.
- A legacy plain-text note reads back as `{situation: <text>}`.
- The old `narrative_note` field is still accepted, and is stored as plain text.
- The note is sealed at the outgoing signature. Nothing changes it afterwards.

### D6 — the system summary, sealed at the outgoing signature

At `sign-outgoing`, `auto_populated_summary` is filled from the live card by a new `BoardLink.handover_summary(hospital, key)`. The summary holds:
- `risk`;
- `news2 {total, partial}`;
- `latest {heart_rate, map, spo2, resp_rate, temperature}`;
- `on_pressor`;
- `open_alerts [{kind, severity, acknowledged}]`;
- `captured_at`.

It holds no name and no free text. A patient who was never measured gets `{captured_at}` only.

The screen shows it as «Sistem özeti · imza anındaki veri», and links to the patient for the current data.

### D7 — reads

**`GET /handovers?box=incoming|outgoing`** (`handover.sign`): the caller's own handovers.
- **incoming:** `incoming_user_id` is the caller. **outgoing:** `outgoing_user_id` is the caller.
- **States:** OPEN and OUTGOING_SIGNED, plus COMPLETED and EXPIRED from the last 24 h.
- **Order and size:** newest first, at most 100.
- **Each row:**
  - `id`, `status`;
  - `created_at`, `bridge_expires_at`, `outgoing_signed_at`, `incoming_signed_at`;
  - `outgoing {id, name}`, `incoming {id, name}`;
  - `patients [{admission_id, board_key, display_name, bed_label, unit_name}]`;
  - `note`: D5's shape, or null;
  - `summary`.
- **Scope:** by person, not by unit. The caller sees only handovers they are a party to.

**`GET /handovers/colleagues`** (`handover.sign`): the people the caller can hand over to.
- **Who:** active members of the caller's tenant whose groups hold `handover.sign`, excluding the caller.
- **Each row:** `{id, name}`, where `name` is `full_name` and falls back to `username`.
- **Order:** sorted by name.

`/handovers/colleagues` also gets a «No parameter» line in nginx's access-log map, placed before the `/handovers` catch-all, as the drift guard requires.

### D8 — the trail

Each route writes one audit row through `trail.record` after its commit, as B1a's routes do. The `patient` field is the admission's board key, since a handover is one patient.

| Event | Payload |
|---|---|
| `handover.open` | `{handover_id, admission_id, incoming_user_id, actor}` |
| `handover.sign_outgoing` | `{handover_id, actor}` |
| `handover.countersign` | `{handover_id, actor}` |

The note's text is not written to the trail; it stays in the handover row. The audit page gets labels for all three event types.

### D9 — the screen `/devir` «Vardiya devri»

**Route:**
```js
{ id: "devir", path: "/devir", icon: "swap", labelKey: "devir.nav", shortKey: "devir.navShort",
  perms: ["handover.sign"], work: true, nav: "main" }
```
It goes after `rrt`, so nobody's home moves.

**«Karşı imzanızı bekleyenler».** My incoming handovers in OUTGOING_SIGNED. Each row shows:
- the bed and the patient, linked to the patient;
- who it is from, and when they signed;
- the sealed D-Ö-D-Ö note;
- the system summary;
- the button «Okudum, karşı imzala».

**«Benim devrettiklerim».** My outgoing handovers:
- OPEN (the signature was refused): «İmza bekliyor», with «İmzala»;
- OUTGOING_SIGNED: «Karşı imza bekleniyor»;
- COMPLETED in the last 24 h.

**«Yeni devir»** opens a dialog:
- **Patient:** chosen from `GET /admissions` (my units, open states).
- **Receiver:** chosen from the colleagues list.
- **Note:** four text areas (D · Durum, Ö · Öykü, D · Değerlendirme, Ö · Öneri), with the hint «Taslak tanı içermez; ad ya da kimlik numarası yazmayın».
- **Critical check:** if the chosen patient's card on the board shows an unacknowledged critical alarm, the dialog says «İmzalanamaz: bu hastada yanıtlanmamış kritik alarm var», links to the alarms, and does not send. The server stays the judge.
- **«Devret ve imzala»** calls `POST /handovers`, then `sign-outgoing`.
- **If the signature is refused,** the OPEN handover stays in «Benim devrettiklerim» to be signed later.

**No rail badge in this slice.** A badge would need polling of `GET /handovers`.

### D10 — not in this slice

- the patient tab «Teslim notu», and drafts saved on the server;
- the 30-minute bridge's access semantics (S-24 access). Only its expiry stays, as today;
- the shift schedule and the unit report (`generateShiftHandover`);
- a rail badge or home tile;
- a migration.

## 4. Tests

**Engine.** These are DB-backed. They run on a throwaway Postgres on port 5644x, never on the shared 56432.
- `tests/test_handover_api.py`:
  - D3: the gate counts the live board (firing and latched alerts) and ignores the Postgres `Alert` table.
  - D4: opening refuses an admission that is closed or out of scope.
  - D5: the note's shape, the 422 bounds, and a legacy text note read back.
  - D6: the summary is sealed and has no names.
  - D7: the two boxes, scope by person, the 24 h window, and colleagues (permission, self excluded, tenant only).
  - D8: the audit rows.
- Route tables: `test_route_permissions`, `test_tenant_isolation`, `test_nginx_routes`, `test_access_log_redaction`.
- `test_admission_workflow`'s handover cases stay green.

**Dashboard:**
- `devir.js` (pure): the note, the live critical check, the grouping;
- `DevirScreen.test.jsx` and the dialog;
- `routes.test.js`, `rawKeys.test.jsx`, the denetim labels.

**Gates:**
- the engine's no-DB suite, plus the DB subset that touches admission and handover;
- the whole dashboard suite;
- `vite build`.
