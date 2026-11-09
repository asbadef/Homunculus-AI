# Group 2 · Lane B · slice B1c — The care team ("Bakım ekibi")

**Date** 2026-11-09
**Status** The owner's decisions of 2026-11-09 (§2) are binding. This text turns them into a design
and awaits the owner's reading. **Plan:** not written yet.
**Lane** Lane B.
**Branches** this spec: `docs/g2b-b1b-b1c`, cut from `feat/g2b-b3a-doluluk` @ `da306570`. The code
goes on `feat/g2b-b1c-bakim-ekibi`, cut from main when the plan is written.
**Builds on**
- B1a — `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md`: the sign-off, unit
  scope (`_reach_admission`, `_locked`), the patient screen's `SignOffStrip`.
- The board's own-patient rule (`scope/rules.py` `sees_patient`; `scope/service.py`
  `own_patient_rows`).
- O45 — `docs/superpowers/plans/2026-10-25-g2b-kabul-taburcu.md:56`: sign-off sets the attending
  but writes no care-team row.
- Migration `0017` — G3-02 «Görevlerim» (`0017_tasks`, planned on `feat/g3-gorevlerim`; its spec
  `2026-11-09-g3-gorevlerim-design.md`, D18).

**Companion** B1b (`2026-11-09-g2b-b1b-nakil-design.md`): a transfer closes the source's rows and
copies them onto the arriving admission.

## 0. Where the code stands (branch head `da306570`)

Paths are relative to `homunculus-engine/src/homunculus/`.

| # | Fact | Where |
|---|---|---|
| F1 | `CareTeamRole`: `ATTENDING`, `ASSOCIATE_PHYSICIAN`, `ONCALL_PHYSICIAN`. | `admission/models.py:146-150` |
| F2 | `CareTeamMember` holds `role`, `granted_by_id`, the window, `is_active`, `created_at` and `closed_at`. `UniqueConstraint(admission_id, user_id, is_active)` allows one CLOSED row per member and admission: ending a member twice breaks it. | `admission/models.py:384-414` (constraint `:412-413`) |
| F3 | `claim` makes the caller ATTENDING and sets `attending_physician_id`. It has no reach check, no state check, no lock and no audit. It does not end an earlier attending. | `admission/router.py:831-846`; `admission/service.py:197-211` |
| F4 | `add` checks tenant membership only. A duplicate raises IntegrityError, which becomes a 500. ONCALL needs a window of at most 48 h. | `admission/router.py:849-869`; `admission/service.py:214-238` (window `:220-226`) |
| F5 | `GET` (`admissions.view`) is limited to the tenant only. Its rows carry ids: no name, no `closed_at`. | `admission/router.py:872-882`; `admission/schemas.py:350-361` |
| F6 | Nothing ends a row except the discharge confirmation. | `admission/service.py:458-467` |
| F7 | Sign-off makes the signer the attending when none is set, and writes no care-team row (O45). | `admission/router.py:745-779` (`:760-761`) |
| F8 | `attending` holds `care_team.claim` and `care_team.assign`. `unit_physician` holds neither (its description: "bakım ekibi atamaz"); nor does `physician`. **`charge_nurse` holds `care_team.claim`.** | `auth/permissions.py` `_ATTENDING`, `DEFAULT_GROUPS` |
| F9 | The scope reads a user's ACTIVE rows, an ON-CALL row only inside its window, and keys them by the admission's board key. An own patient is always seen (`sees_patient`), but it widens only what she sees, not where she acts. | `scope/service.py:89-155`; `scope/rules.py:134-155`; `admission/unitscope.py:10-11` |
| F10 | A board stream binds its scope when its ticket is issued, for the life of the connection. | `api/app.py:1726-1757` |
| F11 | `/admin/users` needs `users.manage`. No route lists clinicians for a physician. | |

## 1. What this slice delivers

The record of who is responsible for a patient is written, shown and kept correct. A «Bakım ekibi»
box on the patient screen shows the attending, the associates and the on-call physicians. It lets
an authorised user add and remove them. Each member sees her patient on the board, even outside her
units.

## 2. Decisions (the owner's, 2026-11-09)

| # | Decision | Why |
|---|---|---|
| D1 | **Physicians only.** Nurses are not on the care team. | A nurse's link to a bed is a separate record (§7). |
| D2 | **Three roles.** `ATTENDING`, exactly one active; `ASSOCIATE_PHYSICIAN`; `ONCALL_PHYSICIAN`, with a window of at most 48 h. | One physician is responsible; others help or cover. |
| D3 | **The physician who signs off the admission becomes ATTENDING**, in the same transaction. This closes O45. | The signer takes the responsibility, and the own-patient rule then reaches her. |
| D4 | **A new attending ends the previous attending's row.** | One responsible physician at a time; the history stays. |
| D5 | **Members are added and removed in a «Bakım ekibi» box** on the patient screen. Every change is audited. | The team is read where the patient is read. |
| D6 | **A member sees her own patient outside her scope.** That rule exists (F9). This slice makes its rows right. | Consultation and on-call cover cross units. |

## 3. Derived in this spec

| # | Rule | Why |
|---|---|---|
| T1 | **A physician** is an active member of the tenant one of whose groups there is `attending`, `unit_physician` or `physician` (the default role groups, `kind: "role"`). Anyone else is refused 409 `care_team_not_physician`: as a member, as a claimer, or as a signer who would become attending. | The role group says what a person is. A permission cannot say it: the system group holds every key by rule. |
| T2 | **Every write** (claim, add, end, and the sign-off's row) checks reach with `_reach_admission`, takes `_locked`, checks the admission's state, and is audited after the commit. One exception: a member ending her own row needs no reach (§5.2). | F3, F4: none of this is done today. |
| T3 | **The team lives from sign-off to the end of the stay.** Writes need an ACTIVE or PENDING_DISCHARGE admission. A DRAFT or a closed one is 409 `invalid_transition`. | A DRAFT has no attending yet (D3). |
| T4 | **Making an attending** happens at sign-off, by claim, or by an add with role ATTENDING. It ends the previous ATTENDING row, ends the new attending's own other active row, sets `attending_physician_id`, and writes her ATTENDING row. One service function does it: `set_attending`. | D2, D4. A promoted associate holds one row, not two. |
| T5 | **The ATTENDING row is never ended alone:** 409 `care_team_attending_required`. It ends when another attending is made, at discharge, or at transfer. | D2: exactly one, for the whole stay. |
| T6 | **Migration `0018`** replaces the constraint with two partial unique indexes and fixes the data first (§5.1). | F2. The database holds D2, not only the route. |
| T7 | **A duplicate is a coded 409 `care_team_conflict`**, never a 500. The route tells the index apart by its name, as the admission route does with `uq_admissions_open_identity`. | F4. |
| T8 | **An expired on-call row is renewed.** Adding a physician as ONCALL ends her expired ONCALL row in the same transaction. | The same physician covers night after night. The box should not need two steps. |

## 4. Screen

- **The «Bakım ekibi» box** sits on `screens/patient/PatientScreen.jsx`, keyed by patient as
  `SignOffStrip` is. The box finds the admission as `SignOffStrip` does: the open admission in
  `GET /admissions` with this board key. A session without `admissions.view`, or an admission the
  list does not hold (another unit's), shows no box.
- **A DRAFT** shows one line: «Sorumlu hekim, kabul imzalanınca atanır.»
- **Each active member:** full name; role; for on-call, the window ("09.11 20:00 – 10.11 08:00"),
  marked «süresi doldu» once it has passed; «ekleyen: <ad>».
- **«Önceki üyeler (n)»**, collapsed: each closed row with its role and «bitti: <zaman>».
- **Actions.** Each is gated, re-reads the team after it, and says its result in the box and on a
  toast.

| Action | Shown to | Route |
|---|---|---|
| «Sorumlu hekim ol» | a `care_team.claim` holder who is a physician and not the attending | claim |
| «Ekibe ekle» → physician, role, and the window for on-call | `care_team.assign` | add |
| «Sorumlu hekim yap» on an associate or on-call row | `care_team.assign` | add, role ATTENDING |
| «Ekipten çıkar» on a row that is not the attending's | `care_team.assign` | end |
| «Ekipten ayrıl» on her own row, when it is not the attending's | the member herself | end |

- **The add dialog.** A searchable list from the candidates route, names only. The role: Yardımcı
  hekim / Nöbetçi hekim / Sorumlu hekim. For on-call, a start (now by default) and an end, with
  "en çok 48 saat" stated. Making a new attending asks once: «<ad> sorumlu hekim olur; <önceki>
  ekipten çıkar.»
- **The attending's row** has no remove action. It says «Yeni sorumlu hekim atanınca biter.»
- **Labels:**

| | tr | az | ru | en |
|---|---|---|---|---|
| the box | Bakım ekibi | Baxım komandası | Лечебная команда | Care team |
| `ATTENDING` | Sorumlu hekim | Məsul həkim | Лечащий врач | Attending physician |
| `ASSOCIATE_PHYSICIAN` | Yardımcı hekim | Köməkçi həkim | Врач-ассистент | Associate physician |
| `ONCALL_PHYSICIAN` | Nöbetçi hekim | Növbətçi həkim | Дежурный врач | On-call physician |

  The az, ru and en texts are the planner's and await a native reading (O48).
- The box supports four languages (az by default), the Gece and Gün themes, 390 px and 1440 px,
  keyboard and screen reader. A button is held while its write and the re-read are in flight
  (A-17). When the pressed row leaves, the focus goes to the box's heading. People are named; no
  UUID is shown.

## 5. Backend

### 5.1 Migration `0018`

`0018_care_team`, `down_revision = "0017"` (G3-02's `0017_tasks`). Alembic is one chain: if 0017
is not on main when this merges, the numbers move, as the G3-02 spec's D18 says.

Upgrade, in this order:
1. Drop the constraint `uq_care_team_active_member`.
2. Close the active rows of closed admissions (DISCHARGED, TRANSFERRED): `is_active` false,
   `closed_at` now.
3. Per admission, keep the newest active ATTENDING row (by `created_at`) and close the others.
   `attending_physician_id` is set to the kept row's user.
4. Backfill (O45). Each open, signed admission (ACTIVE, PENDING_DISCHARGE, PENDING_TRANSFER) with
   `attending_physician_id` set and no active ATTENDING row gets one for that user
   (`granted_by_id` NULL). If she already holds another active row there, that row becomes her
   ATTENDING row instead.
5. Create the unique index `uq_care_team_active_member` ON (`admission_id`, `user_id`) WHERE
   `is_active`.
6. Create the unique index `uq_care_team_one_attending` ON (`admission_id`) WHERE `is_active` AND
   `role = 'ATTENDING'`.
7. If the owner answers O-1 yes: delete `care_team.claim` from every `charge_nurse` group.

The model mirrors steps 5 and 6 with `postgresql_where` and `sqlite_where`, because
`scripts/dev_local.py` builds the models on SQLite (E10).

Downgrade drops the two indexes, restores the old constraint, and puts step 7 back. Restoring the
constraint fails loudly when a member has two closed rows on one admission; the plan's rollback
block counts them first. Rows closed or written by steps 2–4 stay.

### 5.2 Routes

All sit under `/admissions/{admission_id}/care-team`. The tenant is checked first (404), then
reach, then the lock, then the state.

| Route | Permission | Rule |
|---|---|---|
| `POST …/claim` | `care_team.claim` | The caller becomes the attending (T4). She must be a physician (T1). If she is the attending already: 409 `care_team_conflict`. |
| `POST …` (`CareTeamAdd`) | `care_team.assign` | `user_id` must be an active member of the tenant (422, as today) and a physician (T1). Role ATTENDING: T4. `ASSOCIATE_PHYSICIAN`: no window. `ONCALL_PHYSICIAN`: a window is required; its end is after its start, in the future, and at most 48 h after the start (422 `field_invalid:window_start` or `field_invalid:window_end`); T8 applies. A window on another role: 422. Already an active member: 409 `care_team_conflict`. |
| `POST …/{member_id}/end` (new) | `care_team.assign`, or the member herself | Ends an active row that is not the attending's: `is_active` false, `closed_at` now. The ATTENDING row: 409 `care_team_attending_required`. A row already ended: 409 `invalid_transition`. A row of another admission: 404. An assigner needs reach. A member ending her own row does not, because ending it only narrows what she sees. |
| `GET …` | `admissions.view` | Allowed when the caller's units hold the bed, or when she has an active row on this admission; otherwise 403 `out_of_scope`. All rows, the active ones first, newest first. |
| `GET …/candidates` (new) | `care_team.assign` | Reach as for the writes. The tenant's active physicians (T1) who hold no row in force on this admission, sorted by name. Each carries `user_id` and `full_name`, nothing else. (Breadth: §8 O-2.) |

The end route is guarded by `require_permission("care_team.assign", "admissions.view")`. Inside,
a caller without `care_team.assign` may end only her own row; another's is 403.

`CareTeamMemberResponse` gains `full_name`, `granted_by_name`, `closed_at` and `in_force` (active,
and for on-call, inside its window). The names are `users.full_name`: staff, not patients.

### 5.3 Sign-off (D3, O45)

`sign_off`, after `_locked`, in its own transaction:
- The attending is the form's `attending_physician_id` when the admission carries one (an API
  client; the Kabul screen sends none). Otherwise it is the signer.
- She must be a physician (T1). If not, 409 `care_team_not_physician` and nothing is written. An
  administrator signing a DRAFT that has no attending is refused this way.
- `set_attending` writes her ATTENDING row, with `granted_by_id` the signer.

The `admission.sign_off` audit row gains `attending` (a user name) and `member_id`.

### 5.4 Discharge and transfer

- The discharge confirmation closes every active row (F6). Unchanged.
- B1b's transfer closes the source's active rows and copies them onto the arriving row. With
  `0018`, a closed row never blocks a new one.

### 5.5 Audit

Written after the commit, never raising (A-26). `patient_id` is the board key. A row carries ids
and user names, never a patient's name.
- `care_team.attending`: `admission_id`, `member_id`, `member` (user name), `via` (`sign_off`,
  `claim` or `add`), `ended` (the ids of the rows it ended), `actor`. The sign-off writes this row
  as well as its own.
- `care_team.add`: `admission_id`, `member_id`, `member`, `role`, `window_start`, `window_end`,
  `renewed` (the ended on-call row's id, when T8 applied), `actor`.
- `care_team.end`: `admission_id`, `member_id`, `member`, `role`, `self: true|false`, `actor`.

### 5.6 Errors

| Code | When |
|---|---|
| 409 `care_team_conflict` | The user already holds an active row here, or a concurrent add or claim lost at an index. |
| 409 `care_team_not_physician` | The member, the claimer, or the attending a sign-off would make is not a physician (T1). |
| 409 `care_team_attending_required` | An end of the ATTENDING row. |
| 409 `invalid_transition` | A DRAFT or a closed admission; a row already ended. |
| 403 `out_of_scope` | The bed is outside the caller's units (and, for `GET`, she is not a member). |
| 403 | An end of another's row without `care_team.assign`. |
| 404 | The admission, the member row or the user is another tenant's, or missing. |
| 422 `field_invalid:window_start`, `field_invalid:window_end` | The window rules. |

The three new codes go into `admission/errors.py` `CODES` and `apiErrors.js`, with their words in
four languages.

## 6. Tests

Backend:
- **Migration `0018`** on Postgres. Upgrade over data with two active attendings, an attending
  without a row, and an open row on a discharged admission. The indexes then hold. Downgrade, then
  upgrade again.
- **The old fault.** Add, end, add again, end again: two closed rows, no error.
- **Sign-off.** It writes the ATTENDING row in its own transaction; a failure rolls back both. The
  signer becomes attending; a form-named attending gets the row instead. A non-physician signer is
  refused and nothing is written. The signer then sees the patient as her own (O45 closed).
- **Transitions of the attending.** Claim, and add with role ATTENDING, end the previous
  attending. A promoted associate holds one row. Two concurrent claims leave exactly one active
  ATTENDING; the loser gets 409 `care_team_conflict`.
- **Add.** The physician check. Each window rule, including 48 h and an end in the past. The
  renewal of an expired on-call row. A duplicate is a 409, never a 500.
- **End.** By `care_team.assign`. By the member herself, outside her units. Another's row without
  `care_team.assign` (403). The ATTENDING row (409). The same row twice (409). Another admission's
  member id (404).
- **State.** A DRAFT and a closed admission are refused on every write.
- **Scope and tenant isolation** on every route, the candidates route included. `GET` for a member
  outside her units.
- **Candidates.** Physicians only: never a nurse, a charge nurse or an administrator. Active users
  and memberships only, this tenant only. The keys are exactly `user_id` and `full_name`. Members
  in force are left out.
- **The own-patient rule.** An on-call member outside the unit sees the card inside her window and
  not after it. An ended member no longer sees it. After a B1b transfer, the copied rows point at
  the card's key.
- **Audit without PHI.** The rows carry ids and user names, no patient name.
- **The route-permission table** holds the two new routes.

Dashboard:
- Each action's gate, including the member's own «Ekipten ayrıl».
- Four languages: the role labels, the box, the dialogs, and the three new error codes.
- No UUID on screen: members and candidates are shown by name.
- The hold while a write is in flight; the focus when a row leaves; «süresi doldu».

## 7. Not in this slice

- Nurses on the care team, and a reader for the nurse-bed assignment (`POST /shift-schedule`).
- Ending expired on-call rows on their own (a sweep). An expired row already grants nothing (F9).
- The box for a member outside the unit. `GET /admissions` lists the caller's units only, so an
  assigner ends her row for her.
- Telling an open board stream about a new member. The stream picks the patient up when it
  reconnects (F10); the REST reads see her at once.
- `care_team.assign` for `unit_physician`. Its group says it does not assign.
- The receiving attending's confirmation after a transfer (S-27).
- A break-glass screen (O39).

## 8. Open for the owner

- **O-1 · `charge_nurse` holds `care_team.claim` (F8).** Under D1 a charge nurse's claim is always
  refused (T1). **Recommended:** remove the key from the group, in `DEFAULT_GROUPS` and, for
  existing tenants, in `0018` step 7. Drop «bakım ekibi» from the group's description.
- **O-2 · Whom the picker offers.** Either the tenant's physicians, or only those of the caller's
  units. The own-patient rule matters most for a physician from another unit, such as an on-call
  colleague, and a unit-only list would never offer her. **Recommended:** the tenant's physicians,
  names only.
