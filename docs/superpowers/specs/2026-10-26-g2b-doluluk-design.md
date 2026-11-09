# Group 2 · Lane B · slice B3a — Occupancy ("Doluluk")

**Date** 2026-10-26 · **Refreshed** 2026-11-09 against main `628c46d4` (§0)
**Status** approved in conversation on 2026-10-26 ("Doğru"). Refreshed 2026-11-09 and approved by
the owner the same day («tamam»). **Plan:** `docs/superpowers/plans/2026-11-09-g2b-b3a-doluluk.md`.
Its departures X1–X10 refine this text; X1 is folded in below (R8, §4).
**Lane** Lane B wrote it. The B1d session (homunculus-ai-bd) now carries it: on 2026-11-09 the
owner chose "the rest of Group 2" as that session's next work.
**Branches** this spec: `docs/g2b-b3a-doluluk`. The code goes on `feat/g2b-b3a-doluluk`, cut from
main when the plan is written.
**Builds on** main as it stands:
- B1a — `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md`: structure,
  `GET /tenant/structure`, bed states, `beds.release`, the "Yataklar" tab, unit scope.
- B1d (protocol).
- G2-ESLEME (monitor → bed).

**Prototype** `tasarim-taslaklari/app/screens.js:173-214` (occupancy) on `origin/tasarim/prototip`.
Use it for its visual language only.
**B3 split** (the user, 2026-10-26): B3a occupancy comes first (this file). B3b handover follows
later, in its own slice with its own safety rules.

## 0. Since 2026-10-26 (the refresh — read this first)

Main moved on after this spec was approved: B1d, the monitor → bed editor, A4, G3-01 and DALGA.
Each change below either follows from a fact on main or settles a point the old text left open.
**R1**, **R8** and **R9** change the design; R7 records the user's answer to O1. The rest are bookkeeping.

| # | Change | Why |
|---|---|---|
| R1 | **The short name and the notes no longer go into `GET /tenant/structure`.** A new read, **`GET /tenant/occupancy`**, carries them. It is gated by D2's permissions and limited to the caller's units. `/tenant/structure` stays free of patient data; per bed it gains only `state_since`. | Since B1a, `/tenant/structure` is also read by `users.manage` (the scope editor, X52) and by `devices.map_beds` (the monitor → bed editor). A user manager or a device mapper must not get patient names. |
| R2 | **The migration is `0016`.** Main ends at `0015_protocol`, and on 2026-11-09 no other branch carried a migration (`docs/hbys-h1a-kisi-kaydi` carries a spec only). The held H1a spec also names `0016`; H1a renumbers to `0017` when the owner starts it. | The old text left the number open "until the plan, after checking Lane A". |
| R3 | **`MAINTENANCE` ("Bakımda") is shown as its own state** and counted as not usable, like out of service. Its "Kullanıma aç" uses the same return-to-service route. The screen offers **no way into** `MAINTENANCE`; only the administrator's raw `POST /tenant/beds/{id}/transition` reaches it today, from cleaning. | `MAINTENANCE` is in the state machine on main (HOUSEKEEPING → MAINTENANCE → AVAILABLE), and the old text did not say what the screen does with it. |
| R4 | **`BLOCKED` is renamed on screen** from "Kapatılmış / Bağlanıb / Заблокирована / Blocked" to **"Kullanım dışı / İstifadədən kənar / Не используется / Out of service"**. | "Kapat" already means the structure editor's close (`is_active: false`, B1a). Two different things must not share one word. |
| R5 | **Only admission meets a reserved bed in this slice.** Transfer is closed on main (A-37: both transfer routes refuse `transfer_unavailable`). B1b applies the same `confirm_reserved` rule when it opens transfer. | Settles the gap in D5. |
| R6 | **Reserve, unreserve, out of service and return to service all run under the bed's row lock** (`_lock_bed`), like release and the raw move. **Return to service** also runs the same guards as the raw move to AVAILABLE: `bed_in_use`, and the board check `_last_card_off`. | Otherwise an admission and a reservation can race for the same free bed. The guards keep the release's own invariants. |
| R7 | **The short name comes from `patients.display_name`**, a single encrypted free-text field (the Kabul form's one "Ad Soyad" box). **The ward writes the surname first** (the user, 2026-11-09, O1: "Soyad Ad Ata adı"). The server shows the **second** word in full, followed by the first letter of the **first** word: "Məmmədov Əli Rauf oğlu" → "Əli M."; "Kaya Ayşe" → "Ayşe K.". This keeps D3's form, "first name + surname initial". A one-word name is shown as it is. Surrounding whitespace is stripped, and letters keep their case in Turkish and Azerbaijani ("İ", "ı", "Ə"). | The old text assumed separate first-name and surname fields. Main has one field. Its order is the ward's habit, and the user stated that habit. |
| R9 | **The Kabul form's name box is relabelled to match how the ward writes:** "Ad soyad / Ad soyad / Имя и фамилия / Full name" becomes **"Soyad ad / Soyad ad / Фамилия и имя / Surname and name"**. The label changes in both the form and the list headers. The stored field stays the same, and so do the separate "Baba adı / Ata adı" box and the identity digest. | A label saying "Ad soyad" invites name-first entries, which R7 would shorten wrongly. |
| R8 | **The reservation note and the out-of-service note are patient data at rest.** A note may well name the expected patient. `beds.state_note` is stored like `display_name` (`EncryptedString`). The audit record carries the reason and only *whether* a note was written, never the note's text. The notes are returned only by `GET /tenant/occupancy`. The `bed_reserved` refusal names the bed and never the note, because a refusal never carries a name (`admission/errors.py` `Refusal`). The Kabul form reads the note from the occupancy read (plan X1). | "For whom" invites a name. An unencrypted column, or an audit payload holding the text, would put a name where the project's patient-data rule says it must not go. |

## 1. What this slice delivers

A ward-level bed view. It shows which beds are free, occupied, being cleaned, reserved, out of
service or in maintenance, and for how long. It offers the actions that move a bed between those
states. It grows B1a's "Yataklar" tab into its own screen.

## 2. Decisions (the user's, 2026-10-26)

| # | Decision | Why |
|---|---|---|
| D1 | **Two B3 slices, occupancy first.** | Occupancy is small and sits on B1a's structure. Handover needs its own careful design: coverage, the critical-alarm block, two signatures, expiry. |
| D2 | **Who sees it:** holders of `admissions.admit`, `admissions.discharge.confirm`, `admissions.view` or `beds.release` — the nurse, charge nurse and physician — and the administrator. Each sees only their own units. | Clinicians manage beds at night. The prototype's clerk role does not exist here. |
| D3 | **An occupied bed shows only the short name "Ahmet Y."** (R7), produced on the server. No clinical data, no number, no birth date. | The screen is about beds, not patients. It is the same form the user chose for the wall display. |
| D4 | **Reserved and out-of-service states.** The charge nurse and the administrator set and clear them through a new, narrow permission. Out of service always carries a reason. | The prototype has both, and today there is no way to take a bed out of use or to hold it. |
| D5 | **Admission into a reserved bed is allowed after an explicit confirmation** that shows the reservation note. Admission into an out-of-service or maintenance bed is refused. | A reservation exists to receive the expected patient; it must not stand in that patient's way. |

## 3. Screen

- **Menu "Doluluk"**: its own route, with the lane seam `// G2-B3a`. B1a's "Yataklar" tab moves
  here from Hasta Kabul, which keeps Kabul and Taburcu.
- **Per unit header:**
  - the unit's name and type;
  - **"x / y dolu"**, where y = usable beds (open, not out of service, not in maintenance);
  - counts of free, cleaning, reserved, out-of-service and maintenance beds;
  - a unit chooser with "Tümü".
- **Per room:** an isolation tag when `is_isolation` is set.
- **Bed tile:**
  - the bed's label;
  - its state, shown as colour **and** as text;
  - the time in that state ("temizlikte · 25 dk", from `state_since`);
  - for an occupied bed, the short name "Ahmet Y.";
  - for a reserved or out-of-service bed, its note, plus the reason when out of service.
- **Actions.** Each is gated by its permission. Each states its result on the screen as well as in
  a toast.

| Bed state | Action | Permission |
|---|---|---|
| Free | "Bu yatağa hasta kabul" → the Kabul form with this bed selected | `admissions.admit` |
| Free | "Rezerve et" (for whom / why, ≤ 200) | `beds.manage_state` (new) |
| Free | "Kullanım dışı" (reason: arıza / izolasyon temizliği / personel yetersizliği / diğer, + note ≤ 200) | `beds.manage_state` |
| Cleaning | "Temizlik bitti · boş" | `beds.release` (B1a) |
| Reserved | "Rezervi kaldır" | `beds.manage_state` |
| Out of service | reason and note shown; "Kullanıma aç" | `beds.manage_state` |
| Maintenance | "Kullanıma aç" (R3) | `beds.manage_state` |

The screen supports:
- four languages, with az as the default;
- the Gece and Gün themes;
- 390 px and 1440 px widths;
- keyboard and screen reader.

It shows no UUID and no raw key.

## 4. Backend

- **Bed states:**
  - New state `RESERVED`. Out of service is the existing `BLOCKED`, plus a reason.
  - Transitions added: AVAILABLE → RESERVED, RESERVED → AVAILABLE, RESERVED → OCCUPIED (an
    admission, with confirmation), AVAILABLE → BLOCKED.
  - Transitions that already exist: BLOCKED → AVAILABLE, MAINTENANCE → AVAILABLE.
  - `OCCUPIED`, the pending states, `HOUSEKEEPING` and `MAINTENANCE` cannot be reserved or blocked.
- **Migration `0016` (R2)** adds two columns, both cleared when the bed leaves the state:
  - `beds.state_reason` — an enum (FAULT / ISOLATION_CLEANING / STAFFING / OTHER), null unless
    BLOCKED;
  - `beds.state_note` — `EncryptedString`, ≤ 200 characters of plaintext (R8); holds the
    reservation note or the out-of-service note.
- **Permission `beds.manage_state`** goes to charge_nurse and hospital_admin. This needs:
  - a data migration for existing tenants;
  - catalogue parity on the dashboard;
  - its text in four languages.
- **Routes:** `POST /tenant/beds/{id}/reserve`, `/unreserve`, `/out-of-service` and
  `/return-to-service`. Each one:
  - runs under the bed's row lock (R6);
  - is limited to the caller's units and isolated by tenant;
  - refuses with stable error codes;
  - has its row in the route-permission table.

  `/return-to-service` accepts BLOCKED or MAINTENANCE and runs the raw move's guards to AVAILABLE
  (R6).
- **Admission** (B1a's `POST /admissions`): a RESERVED bed needs `confirm_reserved: true`, which
  sits beside the form and is not part of it (plan X2). Without it, the refusal `bed_reserved`
  carries the bed's id; the form reads the note from `GET /tenant/occupancy` and asks (plan X1).
  Both a BLOCKED and a MAINTENANCE bed are refused.
- **`GET /tenant/structure`** gains `state_since` per bed (from `state_updated_at`). It gains
  nothing about patients, and no notes (R1).
- **`GET /tenant/occupancy`** (new, R1) is gated by D2's permissions and limited to the caller's
  units. Per bed it returns:
  - `bed_id`;
  - `occupant_short` — for an occupied bed only (R7);
  - `state_reason`;
  - `state_note` — decrypted, for reserved and out-of-service beds.

  Nothing else about the patient is returned. The screen joins it to the structure by `bed_id`.
- **Audit:** every state change records who, the bed, from → to, the reason, and `note: true/false`
  — never the note's text (R8).

## 5. Tests

Backend:
- Transitions, allowed and refused: each state × each action, including MAINTENANCE.
- Concurrency: a reservation racing an admission for the same bed leaves exactly one winner (R6).
- Admission into a reserved bed, with and without confirmation.
- Refusal of admission into out-of-service and maintenance beds.
- Unit scope and tenant isolation on every route, including `/tenant/occupancy`.
- **A caller holding only `users.manage` or only `devices.map_beds` is refused by
  `/tenant/occupancy`, and their `/tenant/structure` carries no name and no note (R1).**
- The short name never carries more than one word and one initial, and takes the second word plus
  the first word's initial. Cases: one-word names, two words, names with several spaces,
  surname-first names ending in "oğlu" / "qızı", Turkish and Azerbaijani letters (R7).
- The note is stored encrypted, and is absent from the audit payload (R8).
- The counts, and the usable-bed denominator.

Dashboard:
- Every action's permission gate.
- Four languages, the BLOCKED label renamed in all four (R4), and the Kabul name box relabelled "Soyad ad" in all four (R9).
- No UUID on screen.
- The reserved-bed confirmation in the Kabul form.

## 5a. Constraints the plan must keep (Lane B, 2026-11-09)

Lane B checked its own branches and worktrees. It has no draft or open decision for any slice left
in Group 2. On main, four points sit next to this slice:

- **One open admission per person** (A-37 decision 2, `a659e7d0`). It is checked under the bed's
  lock and backed by a partial unique index. The new routes take the bed's lock in the same order
  as admission and release, so no new lock order is introduced.
- **The administrator's raw move** (`34aa97d7`, `b112d98f`). A move to AVAILABLE while an
  admission is open is refused with `bed_in_use`, and the release's card check runs first.
  `/return-to-service` reuses these guards; it does not copy them.
- **Transfer is closed** (A-37 decision 1, `090ca488`; the dashboard handles it in `08837fd2`), and
  the protocol is kept across a transfer (O8, `b19d654c`). This slice changes neither of them (R5).
- **dalga-perf-2** (Lane B) changes three files: `scope/resolver.py`, `scope/service.py`, and
  `_scope_resolver` in `api/prodserver.py`. `GET /tenant/occupancy` reads unit scope through
  `homunculus.admission.unitscope`, as `/tenant/structure` does, and touches none of the three.
  On 2026-11-09 it reached main (`14b4a642`, live on the VM). The branch was rebased onto it
  before any code was written.

## 6. Not in this slice

- Printing the occupancy.
- Beds-per-nurse figures.
- A "bed ready" notification.
- A way into MAINTENANCE from the screen (R3).
- Reserved-bed handling for transfer, which goes to B1b (R5).
- Handover, which is B3b.
