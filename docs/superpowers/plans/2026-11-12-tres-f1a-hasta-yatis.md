# TRƏS-01 · F1a Patient, Practitioner, Encounter, vital signs — the engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first phase of the national e-health feed that builds real resources (TRƏS-01, phase F1 of F0–F6). A due stay — discharged, past its tenant's wait, within the week after it — goes to the platform as a Patient, its attendings' Practitioners, one Encounter and the first and last hand-charted value of each bedside vital sign, through F0's guarded client, ledger and rounds; an administrator can see the ledger, find a stay by its protocol number, preview it, send it now, retry a refused or stuck row, and keep the two maps the platform needs (departments, practitioner identities). The nightly retry of `stuck` rows runs at 04:00 in the tenant's zone. The live platform stays closed: no package reaches it in this version (O5, O11).

**Architecture:** Spec `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (§13 overrides everything above it), F0's plan `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md` (its «Notes for F1» N1–N17 are this plan's input). New, in `homunculus/tres/`: `codes.py` (the checked LOINC/UCUM/HL7 codes, D12), `ids.py` (D5's local ids, one dot at the end, O20), `az.py` (D20's person rules), `stay.py` (one stay as plain values; the bedside readings, first and last), `mapping/` (four pure mappers: Patient, Practitioner, Encounter, vital signs), `package.py` (D8's order, the validate-mode reference rule of O14, the preview's sender), `source.py` (which stays are due — D9, O15's proposed cut-off, a week's reach — the nightly retry, a stay read whole with ONE audit read through `asyncio.to_thread`; built in `create_app` and put on `app.state.tres_source`, N1), `maps.py` and `deliveries.py` (the `/admin/tres/*` routes of the two maps, the ledger, the preview and the hand). Changed: `models.py` and migration `0020_tres.py` in place (two tables, two settings columns; O19), `ledger.py` (a lock timeout for a person's request, N12), `worker.py` (`park` only while the settings are the round's, N15; the live lock), `egress.py` (`LIVE_OPEN = False`), `errors.py`, `schemas.py`, `router.py` (`send_from`, the live refusal), `api/app.py`, and `tests/fake_tres.py` (each profile's required elements, N6). The dashboard is touched only where an engine change must land with its words in the same commit (audit labels, N5; refusal codes): the panels are F1b's.

**Tech Stack:** Python 3.12 (FastAPI, async SQLAlchemy 2.1 + asyncpg, Alembic, httpx 0.28, pydantic 2), pytest + pytest-asyncio (`asyncio_mode = auto`); React 18 + vitest for the dashboard's lines. The HL7 terminology server `tx.fhir.org` was used once, while planning, to check every code (D12); the code does not call it.

**This plan is half of phase F1.** Whole, the phase passed 7000 lines, so it is split: **F1a, this document, the engine** (source, mappers, routes, retry), and **F1b** (`docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md`), **the dashboard's panels**, written against the routes as this plan writes them. F1b starts after this plan's Task 13; F1b's last tasks carry the documents (spec §14, the guide, the gates' record) and the final review of the whole phase.

**Spec amendments this phase makes (recorded by F1b, Task 21, in spec §14):**
1. **O20 — a local id ends with its only dot.** Every D5 id is `hmn-…` followed by a single `.` at its end and nowhere else: `hmn-p-{phi_digest(FİN)[:32]}.`, `hmn-pr-{user id}.`, `hmn-e-{root admission id}.`, `hmn-v-{root admission id}-{signal key}-{first|last}.`; F2–F5's ids follow (`hmn-c-{row}.`, `hmn-l-{audit id}.`…). With one end mark, no id is a proper prefix of another, in any case, so the platform's prefix search answers one entry. The dot rather than another `-`: `-` is inside every UUID and every signal key (`heart-rate`); `.` is in none and is in FHIR's `id` alphabet `[A-Za-z0-9\-\.]{1,64}` (a POST carries the local id as its placeholder `id`, §4.2). Every id here is at most 64 characters (`ids.is_local_id` holds the tests to it). The vital sign's key is the signal's stable `id_key` in `codes.py` (`heart-rate`, `resp-rate`, `spo2`, `temperature`, `sbp`, `map`, `weight`, `height`), never its LOINC code: a code may change (SpO2, O7) and then it is a PUT of the same resource (amendment 23). Decided before the first mapper: a sent local id never changes.
2. **O14 — a validate round and references.** In `validate` a resource that refers to another is checked only when the ledger holds that other's platform id (from an earlier `send` in the same environment). Otherwise its row reads `skipped` with the reason `no_reference` — the Encounter when the Patient has no platform id, every vital sign when the Encounter has none — and nothing pointing at nothing is sent. A tenant that never sent validates its Patients and Practitioners, the profiles with the most rules. F6 checks on the sandbox what `$validate` does with an unknown reference and may relax this. Why: a reference to a made-up id proves nothing, and the stand-in, like the platform's own `$validate` as far as anything is known, refuses it.
3. **N2 — one stay, one trail read.** A transfer keeps the visit's protocol number: `admission/service.py` `confirm_transfer_arrival` moves it to the arriving row (O8 of 2026-11-02 — on this branch and on `origin/main`, where transfers are still closed by `_transfer_closed`) and copies `patient_id`. So the stay's chart rows are all under the board key of the chain's LAST row: the source reads them once (`iter_records_of(…, patient_id=<that key>)`).
4. **N3 — the person from the root's row.** The Patient's id is `phi_digest` of the decrypted, normalised FİN of the root admission's patient row (one row for the whole chain). A Patient that cannot be built for want of a usable FİN (`fin_missing`, `fin_format`) is recorded under the stay's placeholder `hmn-p-s-{root}.`; once a FİN keys the person, the package removes that placeholder's skip.
5. **D9 — a week's reach.** The rounds rebuild a stay from the moment it is due (`settle_hours` after `discharge_at`) for seven days (`source.REACH`); by D7 an unchanged resource asks the platform nothing. An older stay goes only by «Şimdi gönder» (or the nightly retry, for its `stuck` rows). Without a bound every discharged stay would be read every five minutes for ever. A DISCHARGED row without `discharge_at` is never due on its own.
6. **O15 — PROPOSED, AWAITING THE OWNER'S WORD: the first round's reach.** A per-tenant setting `tres_settings.send_from`: only a stay discharged at or after it is due automatically; it is set to the moment of the save that first chooses `send` (none stored before); the tab shows it and can move it, so the owner can change the rule without code. An older stay goes by hand. A `validate` round with no cut-off stored reaches back as far as its week.
7. **O5 and O11 — the live platform is closed in this version.** A third lock in code: `tres.egress.LIVE_OPEN = False`. While it is False no package goes to the live environment, nor to an account of either environment whose address is on the live host (`egress.LIVE_HOSTS`, `ehr.e-health.gov.az`): the rounds pass the tenant over (`refused`, logged `tres_live_closed`), the hand routes answer 409 `tres_live_closed`, and a settings save with a mode other than `off` on such an account is 422 `tres_live_closed`. F0 did not enforce this (its locks were `TRES_EGRESS`, `TRES_HOSTS` — whose default includes the live host — and the mode). Opening it is a reviewed code change with the owner's word, after O5 (legal basis, `UNCONSCIOUS_LATER`) and O11 (cut-over) are answered; a test pins the constant. The connection test (no patient data) is not held. O5 itself is NOT decided here.
8. **D21, O21, N14 — the nightly retry.** At the first round after 04:00 in the tenant's zone every stay with a `stuck` row in the selected environment is rebuilt and sent with `force`, whatever its age. The night is marked first, in `tres_settings.retried_at` (its own statement, never touching `updated_at`), so it runs once a night and a round that ends early leaves the rest to the next night or «Yeniden dene». «Yeniden dene» (`POST /admin/tres/deliveries/{id}/retry`) forces the row's whole stay: a `sent` row with an unchanged payload still asks nothing.
9. **N12 — a person's request does not queue behind a round.** «Şimdi gönder» and «Yeniden dene» take each ledger row under `SET LOCAL lock_timeout = '2000ms'` (`ledger.HAND_LOCK_TIMEOUT_MS`) and answer 409 `tres_busy` when it runs out. Not `FOR UPDATE NOWAIT`: a round that has INSERTED a new row and not committed makes `INSERT … ON CONFLICT DO NOTHING` wait for its transaction, which NOWAIT does not bound (the test holds both cases).
10. **N15 — parking only on the round's settings.** `worker.park` sets `session_refused_at` only `WHERE updated_at = <the version the round (or the request) began on>`: a login that left with the old password and came back refused after the administrator saved the new one parks nothing. The «Gönderimler» panel says a parked tenant at its top (F1b).
11. **D12 — the codes.** Every LOINC code, display and UCUM unit was looked up on 2026-11-12 (the table below). `code.text` carries the LOINC display, not a «local label» (§5): no reviewed Azerbaijani name for a signal exists, and an unreviewed one would go into the national record. `valueQuantity.unit` is the UCUM code (as `code`), invented nothing. SpO2 goes as `2708-6`, the code the platform accepted; O7 stays the ministry's question.
12. **§5, D20 — what is not sent yet.** `identity-document-type` `15` and `encounter-type` `1` go without a `display` (§4.4 asks one on every coding): no source in hand gives their displays. The blood group is not sent: the codes of `az:CodeSystem/blood-group` are in no source in hand. Both wait for the ministry's CodeSystem files (F2's loader) — new open item O23.
13. **D8, §5 — who the Practitioners are.** In F1 a stay's Practitioners are its attendings: the distinct `attending_physician_id` of the chain's rows, in chain order (B1c keeps it equal to the care team's ATTENDING). `participant[].individual` carries no `type` (§5 names none).
14. **D17 — the stay's department** is the LAST admission's unit (where it ended, or is); the Encounter's `period` runs from the root's admission to the last's discharge; `status` `finished` once the last row is DISCHARGED, else `in-progress`.
15. **D6 — `tres_deliveries.admission_id` is the stay's last admission** (where its protocol number is held), so the ledger's list joins it to the board key directly.
16. **D22 — a zone the server does not know** is never guessed: the Encounter is skipped `timezone_unknown` (and with it the vitals). `UTC` (the tenant's default) is used as UTC — the guide asks the hospital to set `Asia/Baku`.
17. **D24 — the events and their payloads (no PHI):** `tres.map` `{actor, units: [<unit ids changed>]}`; `tres.identity` `{actor, user_id, changed: [<field names>]}`; `tres.send` `{actor, admission_id, result, counts?}`; `tres.retry` `{actor, delivery_id, admission_id, result, counts?}` — `result` is `sent` or the refusal's code, `counts` only when the package ran to its end, and a refused precondition writes no row; `tres.preview` `{actor, admission_id}`; `tres.package` `{admission_id, environment, counts}`, written once per stay and environment, in `send` mode, at the end of the run in which its Encounter first got a platform id — a run cut short by an outage after that moment writes none (the ledger still holds every row). The audit row's `patient_id` is the board key, as the admission's own rows.
18. **D25 — the platform's words** (`last_error`) are not in the ledger's list: they may echo a value. The audited preview carries them.
19. **D16 — a practitioner's FİN is write-only at the door**, as the account's password: the routes answer `fin_set`, an omitted or null `fin` keeps the stored one and `""` clears it. A FİN is held to D20's rule at save (422 `tres_fin_format`).
20. **§6 — one more route and the refusal codes.** `GET /admin/tres/admissions?key=` finds a stay by its board key (what «Şimdi gönder» and the preview are asked for). New codes in `tres/errors.py`: `tres_live_closed` (422, 409), `tres_unit_unknown`, `tres_department_code`, `tres_department_display`, `tres_fin_format`, `tres_name` (422), `tres_user_unknown` (404), `tres_filter`, `tres_cursor` (422), `tres_stay_unknown` (404), `tres_off`, `tres_busy`, `tres_login_refused` (409), `tres_platform_unavailable` (503).
21. **§9, N6 — the stand-in checks each profile** by `meta.profile[0]`, not by FHIR type (a vital sign and a laboratory result are both Observations): the elements spec §5, D16, D17, D20 and FHIR R4 itself require, and the values a profile fixes. F0's tests of §4 now send `fake_tres.UNCHECKED_PROFILE`, a profile the stand-in holds no rules for.
22. **§7 — nginx's access log.** The routes with a path parameter (`/admin/tres/practitioners/{user_id}`, `/admin/tres/admissions/{admission_id}/preview|send`, `/admin/tres/deliveries/{delivery_id}/retry`) join `deploy/local/web/nginx.conf`'s `map $uri $homunculus_log_uri` (G2-B1d O10's drift guard, `tests/test_access_log_redaction.py`), and their prefixes the map's catch-all: an id never reaches the log. `GET /admin/tres/admissions?key=` carries the protocol number in the query string, which that log format never writes.
23. **Batch-1 review (2026-11-12) — the pure layer (Tasks 1–3) after an independent review; the files and the code blocks of Tasks 1–3 below carry it.** (1) `az.normal_fin` refuses a value that is not ASCII BEFORE `upper()`: `ß`→`SS`, `ﬀ`→`FF`, `ſ`→`S`, `ı`→`I` are transliteration, which D20 forbids. (2) `az.phone` takes ASCII digits only (`\d` let Arabic-Indic and full-width digits into the value sent). (3) `stay.readings_of` counts a `chart_retract`'s `entry` only as an `int` that is not a `bool` (the engine's own guard, `api/rehydrate.py` `retracted_entries`): `True` and `1.0` had withdrawn row 1, `[1]` had raised; drift tests hold `stay.RETRACT` to `api/clinical.py` and run the real `/clinical` door so a renamed `chart` row cannot silently empty the readings. (5) A `chart` row whose `charted_by` is `stay.DEVICE_CHARTER` (`tenant-token`, what `api/app.py` writes when the bridge's token charts) is skipped: D10 sends hand-charted values, and a device's sample is unverified (a test reads `app.py`'s literal). (6) A vital sign's local id is keyed by the signal's stable `id_key`, not by its LOINC code — `hmn-v-{root admission id}-{key}-{first|last}.` with `heart-rate`, `resp-rate`, `spo2`, `temperature`, `sbp`, `map`, `weight`, `height` — because a sent local id never changes (amendment 1) and SpO2's code is the ministry's open question (O7: `2708-6` now, maybe `59408-5`): a code change must become a PUT of the same resource, not a second record; `ids.vital` validates the key. (7) `ids.patient` normalises the FİN through `az.normal_fin` itself (`ab12c3d` and `AB12C3D` are one id) and raises a `ValueError` with a constant message, never the FİN, when it is unusable. (8) `mapping.common.instant` raises on a time with no zone instead of reading it as the server's local time. (9) A weight or height must be finite as well as positive (`inf` never reaches `valueQuantity`). (10) A `finished` stay without a `discharge_at` is skipped with the new catalogue reason `discharge_missing` (`mapping/common.py`, beside `timezone_unknown`) rather than sent as a `finished` Encounter without `period.end`; its dashboard words come with F1b. (11) `Person`'s and `Clinician`'s identity fields are `repr=False`. NOT changed, on purpose: a reading timed before the stay's `admitted_at` or after its `discharged_at` is sent as charted, with no clamping or filtering (O27).
24. **Batch-2 review (2026-11-12) — Tasks 4–7 after an independent review; the files carry it (Tasks 4–7 are implemented: their code blocks below keep the first cut), and Tasks 10, 12 and 13 below follow the files.** (1) **I1 — O19's down-and-up from F0's cut.** `0020_tres.py`'s `downgrade()` drops every object `IF EXISTS` (`op.drop_table` and `op.drop_index` with `if_exists=True`; the settings' `send_from` and `retried_at` go with their table): F0's cut of the file has neither of F1's tables nor those columns, and a plain `DROP` stopped on the first. Tested from two hand-made earlier cuts, down to 0019 and up again. (2) **M1 — `egress.live_closed` fails closed.** An address it cannot read — httpx refuses it, or it parses to no host (`not a url`, `https://`, no scheme) — counts as the live platform, and the host is judged without a trailing dot (`https://ehr.e-health.gov.az.` is the live host); no address at all (None, empty) is still not closed (the account is incomplete; nothing to reach). Why: this lock must hold whatever the install says. The settings save already judges the URL first (Task 10's check stands after the loop over both accounts), so a base URL that cannot be read still answers `tres_base_url`, never `tres_live_closed`; a test holds the order. (3) **M10 — the live lock inside the client factory, closed by default.** `egress.open_client(…, patient_data=True)` raises `TresLiveClosed` (a `TresEgressRefused`; code `tres_live_closed`, no URL and no account in it) before any client is built for an address on a live host; the connection test alone passes `patient_data=False` (the app's factory takes the keyword; a stand-in factory used for the connection test accepts `**_`). The rounds' and the hand routes' own `live_closed` check stays: it also judges the environment, which the factory cannot see (`TresAccount` carries none). Why: F2–F6 add sending paths (deletes in F6); one that forgets its own check still cannot reach the live host. Every `open_client` call that carries patient data keeps the default (the rounds, Task 12's `_hand`); Task 12's block needs a comment only. (4) **M2 — `worker.park(…, version=None)` parks nothing** (False, logged «not parked», the database untouched): the N15 race cannot come back through a careless caller. (5) **M3 — the lock timeout bounds only taking the row.** `ledger._row` runs `SET LOCAL lock_timeout TO DEFAULT` once the row is held, so the write after the HTTP calls is not under the 2-second bound. (6) **M4 — `forget_skip` (and `Sender.forget_skip`) are under the same hand lock timeout**; `LedgerBusy` on timeout. (7) **M5, M6, M8 — tests, wording, docstrings.** Both maps cascade from the tenant (the models, and the migration's constraints), the existing row is unchanged after `LedgerBusy`, `lock_timeout` is the default after the row and after the commit; «two tables» became four, `RoundReport.refused` names `tres_live_closed`, E302; `ledger.deliver`, `record_skip` and the `Sender` say that `LedgerBusy` rolls back the caller's whole session transaction (a caller holds no pending write it wants to keep). (8) **D16's practitioner identity is keyed (tenant, user)**, not per user as the spec's D16 text says — right for a multi-tenant engine; recorded here so spec §14 carries it (F1b, Task 21). Counts: this amendment's tests are +18 passed / +9 skipped in the no-DB engine suite (egress +17 and worker +1 passed; ledger +2, models +1, migration +4, settings +1, worker +1 skipped); Task 10 adds one more test (+1 passed). The gates below carry them.

**The codes, checked (D12).** Source: the HL7 terminology server, `https://tx.fhir.org/r4` `CodeSystem/$lookup` (LOINC 2.83, UCUM 2.2 as served there). Checked 2026-11-12. Every LOINC code's STATUS is ACTIVE; its display is LOINC's LONG_COMMON_NAME.

| Signal (engine slug) | LOINC | Display | UCUM | Checked |
|---|---|---|---|---|
| heart rate (`heart_rate`) | 8867-4 | Heart rate | `/min` | 2026-11-12, tx.fhir.org |
| respiratory rate (`resp_rate`) | 9279-1 | Respiratory rate | `/min` | 2026-11-12, tx.fhir.org |
| SpO2 (`spo2`) — O7 | 2708-6 | Oxygen saturation in Arterial blood | `%` | 2026-11-12, tx.fhir.org |
| temperature (`temperature`) | 8310-5 | Body temperature | `Cel` | 2026-11-12, tx.fhir.org |
| systolic pressure (`sbp`) | 8480-6 | Systolic blood pressure | `mm[Hg]` | 2026-11-12, tx.fhir.org |
| mean arterial pressure (`map`) | 8478-0 | Mean blood pressure | `mm[Hg]` | 2026-11-12, tx.fhir.org |
| weight (admission) | 29463-7 | Body weight | `kg` | 2026-11-12, tx.fhir.org |
| height (admission) | 8302-2 | Body height | `cm` | 2026-11-12, tx.fhir.org |
| the alternative for SpO2, NOT sent (O7) | 59408-5 | Oxygen saturation in Arterial blood by Pulse oximetry | `%` | 2026-11-12, tx.fhir.org |

Also checked there the same day: `http://terminology.hl7.org/CodeSystem/observation-category` `vital-signs` «Vital Signs», and `http://terminology.hl7.org/CodeSystem/v3-ActCode` `IMP` «inpatient encounter». And, for the stand-in's base rules, `https://hl7.org/fhir/R4/{observation,encounter,patient,practitioner}.profile.json` (FHIR 4.0.1): Observation.status and .code, Encounter.status and .class are 1..1; Patient and Practitioner require nothing. **No signal is left out:** all six of D10 and both admission measurements verified. Diastolic pressure is not charted (D10) and has no line.

**New open items (recorded in spec §14):**
- O23 The displays of `identity-document-type` `15` and `encounter-type` `1`, and the codes of `az:CodeSystem/blood-group` — from the ministry's CodeSystem files (F2's loader may carry them); until then the two codings go without a display and the blood group is not sent.
- O24 Whether the platform takes a placeholder `id` (and a `local-system-unique-id`) ending in `.` — FHIR allows it; F6's first POST shows it. If not, O20's end mark becomes another character before any live send.
- O25 A `last` vital sign withdrawn after it was sent while the patient was still admitted (a hand send) stays on the platform until F6's deletes (D19).
- O26 REACH (7 days) bounds how late a correction reaches the platform without a hand. F2–F5 write records after the discharge (diagnoses, procedures, the summary): F2 decides whether a change to them brings an older stay back within reach.
- O27 A reading timed outside the Encounter's period (charting allows up to 24 h back; `discharge_at` can be entered before the last reading) is sent as charted. Whether the platform refuses an Observation outside its Encounter's period is for F6's sandbox; a refusal would leave that row `stuck`.
- O28 At the merge with G3-05 (Welch Allyn ward device readings): decide whether its rows reach `readings_of` and whether they count as hand-charted for TRƏS (they must not arrive as `chart` rows under the device token unnoticed: `stay.DEVICE_CHARTER` would drop them).

**Gates (measured when the plan is carried out — every `…` replaced by the number seen):**
- Baseline (Task 0, head `485dcf4f` = `f74b474a` + this plan): engine 4199 passed / 1428 skipped (no-DB); dashboard 166 files / 4481 tests.
- After F1a (Task 13): engine … passed / … skipped (no-DB; expected baseline +144 passed / +45 skipped: +79 as first planned, +46 from amendment 23's tests of Tasks 1–3, +19 passed / +9 skipped from amendment 24's tests and the one Task 10 adds); Postgres per file (Task 13, Step 3) …; dashboard … files / … tests (expected the baseline's file count, the test count unchanged — F1a changes assertions, not tests); head `<sha>`.

---

## Ground rules (read before Task 0)

- **Worktree:** `/c/tmp/tres` (branch `feat/tres-esaglik`; F0 ends at `f74b474a`, on `main` `331df704`; this plan's commit is above it). Work ONLY here. Never touch `c:\Users\User\Desktop\Project\Homunculus AI`. Never `git stash`, never switch branches, never rebase or merge `main` in. Commit with explicit pathspecs only — every `git add` in this plan names its files.
- **`origin/main` has moved** (G4-03 `0020_quality_view.py` at `b2fb07d0`, `quality.view` as the 29th key, the i18n split at `746f30a9`…). Do not bring it in: the renumbering and the merge are the controller's, at merge time.
- **Migration numbering (spec D26; §13.1; F0's N13; the controller's addition of 2026-11-12):** this slice's migration stays `0020_tres.py` (`revision = "0020"`, `down_revision = "0019"`) on the branch, and this plan extends it IN PLACE (O19). Main's chain today: head `0020_quality_view` (← 0019); next in line 0021 (G3-05) and 0022 (G4-04). At merge this file is renumbered onto main's head of that moment — **0023 by today's queue** — with every «0020» in its docstrings and in spec §13–§14. Do NOT renumber it now. Two rules for every test here: a test MAY pin the exact revision (as `test_migration_0020_tres.py` does); a check of «the head» must verify ANCESTRY (Alembic's script directory: is X an ancestor of the head?), never a string comparison such as `>= "0020"`. A development database upgraded to an earlier cut of 0020 is taken down to 0019 and up again before this plan's tests (O19); the tests' own database is rebuilt per test.
- **Engine commands** run from `/c/tmp/tres/homunculus-engine`; one file or a few:
  ```
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings <files> 2>&1 | tail -3
  ```
  - **Never run `tests/test_infinity_vm_pilot.py`** (it hangs); with a glob, `--ignore` does not exclude it — use explicit file lists (Task 0 and Task 13 give them). **Never set or export `DATABASE_URL`.**
  - Postgres tests: put `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` in front, **on the command line only**. The container is `homunculus-test-pg-56`. The database is shared and serialised by an advisory lock: a run may print `waiting for another test run …` and wait — sometimes ten minutes or more; that is not a hang. **Run one Postgres session at a time**, and before a long wait tell the controller in one line. A DB test takes about 4 s (the schema is rebuilt per test), so a whole feed file takes minutes: the steps below run a task's NEW tests by `-k`, and Task 13 runs every file in chunks.
  - Without `TEST_DATABASE_URL` the DB-backed tests are **skipped**, not failed; every step says which result to expect with and without it.
- **Dashboard commands** run from `/c/tmp/tres/dashboard` with the local binaries, never `npx`: `./node_modules/.bin/vitest run <paths>`. `dashboard/node_modules` is a JUNCTION to the shared install (F0, Task 0): never delete or replace it, never `npm install`/`npm ci` through it. The dashboard's tests run in Azerbaijani.
- **Every test command runs in the FOREGROUND**, each under about three minutes. Never background a test run and wait for it. A command the tool would cut off is split (by file, or by `-k`).
- **The feed stays closed.** No step contacts any `e-health.gov.az` host; every test runs against the in-process stand-in (`tests/fake_tres.py`). `TRES_EGRESS` is set only inside a test (`monkeypatch`, `app.state.tres_egress`), never in a shell. `tres.egress.LIVE_OPEN` stays False.
- **Style:** every new Python file starts with a `# homunculus-engine/…` path comment and a docstring that says what and why; every new JS/JSX file with a `// src/live/…` path comment. **Synthetic data only** (CLAUDE.md hard rule 6): names like `Sentetikova Leyla`, FİN-shaped strings like `AB12C3D`, `ZZ99YY8`, hosts `tres.test` / `example.az`. Nothing from the reference repository of spec §2 (`zatruga/ekiz`) is opened or copied — its facts are already in spec §4–§5.
- **No code, display or unit from memory (D12).** The codes are `tres/codes.py`'s, checked; a new one is looked up (tx.fhir.org or loinc.org) and its record written beside it before it is used.
- **Merge seams** take one new line or block with a blank line either side: `api/app.py` (the routers, `app.state`), `auth/permissions.py` (untouched here), `tests/test_route_permissions.py` (the table), `screens/denetim/denetim.js` (EVENT_TYPES), `apiErrors.js` (TRES_CODE_KEYS).
- **An audit event lands with its label** (N5): every `trail.record(…, "tres.<x>", …)` and `AuditEvent(…, "tres.<x>", …)` has its line in `dashboard/src/live/screens/denetim/denetim.js`, its four strings and the count in `denetim.test.js` IN THE SAME COMMIT — `engineTypes.test.js` reads the engine. **A refusal code lands with its words**: every constant added to `tres/errors.py` has its line in `apiErrors.js` `TRES_CODE_KEYS`, its four strings in `strings/tres.js` `err` and its name in `apiErrors.test.js`'s list IN THE SAME COMMIT — a dashboard test reads `tres/errors.py`.
- **Line endings:** `core.autocrlf=true` (files CRLF on disk, LF in git). Edit with the Edit tool; a new file may be written with LF. `warning: LF will be replaced by CRLF` is not an error.
- **Edits are given as «replace this … with this».** The first block occurs exactly once in the file. If it does not match, STOP and read the file: another lane has changed it; re-place the edit by hand next to the same neighbours — never guess.
- **«Append at the end of the file»** means: after the file's last line, leave the blank lines the file's own style puts between top-level blocks (two in Python, one in JavaScript), then the block as given.
- **Commits** follow the repository's style — `feat(tres-01): …`, `test(tres-01): …` — and every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (each commit command carries it as a second `-m`). Push only `feat/tres-esaglik` (F1b's docs task does); nothing to `main`, nothing to any server.
- **Verified before it was written.** Every task's code was run while this plan was written, on a scratch copy of `f74b474a` (engine and dashboard suites, Postgres included); the expected outputs below are what those runs printed.

---

### Task 0: Baseline — the branch, the migration head, the numbers

- [ ] **Step 1: The worktree, the branch, the head**

Run: `cd /c/tmp/tres && git status -sb | head -3 && git log --oneline -2`
Expected: `## feat/tres-esaglik...origin/feat/tres-esaglik` and no file line under it; the first log line this plan's commit (`docs(tres-01): plan F1 …`), the second `f74b474a docs(tres-01): F0 — the spec's amendments …`. Other hashes (a rebase by the controller): go on and write them into the baseline line.

- [ ] **Step 2: The migration head is still the branch's 0020**

Run: `cd /c/tmp/tres && ls homunculus-engine/alembic/versions | tail -2`
Expected: `0019_pharmacy_view.py` and `0020_tres.py`. Anything else: STOP and tell the controller.

- [ ] **Step 3: The test database's container, and the dashboard's install**

Run: `docker ps --filter name=homunculus-test-pg-56 --format "{{.Names}} {{.Status}}"` — Expected: `homunculus-test-pg-56 Up …` (nothing: tell the controller before Task 5).
Run: `cd /c/tmp/tres/dashboard && ls node_modules/.bin/vitest && git status --short` — Expected: the path, and nothing from `git status`.

- [ ] **Step 4: The baseline numbers**

The no-DB engine suite in six chunks, each well under three minutes (explicit lists — the pilot test excluded; the last chunk is the three test packages below `tests/`):
```
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $(ls tests/test_a*.py) 2>&1 | tail -1
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $(ls tests/test_[b-h]*.py) 2>&1 | tail -1
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $(ls tests/test_i*.py | grep -v test_infinity_vm_pilot) 2>&1 | tail -1
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $(ls tests/test_[j-r]*.py) 2>&1 | tail -1
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $(ls tests/test_[s-z]*.py) 2>&1 | tail -1
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/rules tests/scoring tests/tenant 2>&1 | tail -1
```
Expected: `N passed, M skipped` and no `failed` in each (measured on the scratch copy of `f74b474a`: the six add up to 4199 passed / 1428 skipped, as F0's last gate). Add them up.
The dashboard: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -6` — Expected `Test Files  F passed (F)`, `Tests  T passed (T)`.
Write `baseline: engine N/M, dashboard F/T` into the Gates block above. A failure BEFORE any change is not yours to fix: STOP and tell the controller.

---

### Task 1: The checked codes and the local ids — `tres/codes.py`, `tres/ids.py`

D12: the vital signs' LOINC codes, displays and UCUM units, as the terminology server answered them on 2026-11-12, with the record of the check beside them. D5 with O20: every local id `hmn-…`, a FHIR id, one dot at the end.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/codes.py`
- Create: `homunculus-engine/src/homunculus/tres/ids.py`
- Test: `homunculus-engine/tests/test_tres_codes.py`

- [ ] **Step 1: Write the test**

Create `homunculus-engine/tests/test_tres_codes.py`:
```python
# homunculus-engine/tests/test_tres_codes.py
"""TRƏS-01 (spec D5, D10, D12; plan F1, O20): the checked codes and the local ids.

The codes are pinned EXACTLY as the terminology server answered them on 2026-11-12 (tres/codes.py
names the server): a change to one fails here until its line is looked up again and both move
together. The local ids: `hmn-`, a valid FHIR id, one dot at the end — so no id is a proper prefix
of another (O20) — and a person's id from the FİN, never the row. No database, synthetic ids only."""
from __future__ import annotations

import itertools
import re
import uuid

import pytest

from homunculus.tres import codes, ids

ROOT = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER = uuid.UUID("00000000-0000-4000-8000-000000000002")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000aa")


def test_the_signals_are_the_six_bedside_ones_with_their_checked_codes():
    assert {slug: (s.loinc.code, s.loinc.display, s.charted_unit, s.ucum) for slug, s in codes.SIGNALS.items()} == {
        "heart_rate": ("8867-4", "Heart rate", "/min", "/min"),
        "resp_rate": ("9279-1", "Respiratory rate", "/min", "/min"),
        "spo2": ("2708-6", "Oxygen saturation in Arterial blood", "%", "%"),
        "temperature": ("8310-5", "Body temperature", "°C", "Cel"),
        "sbp": ("8480-6", "Systolic blood pressure", "mmHg", "mm[Hg]"),
        "map": ("8478-0", "Mean blood pressure", "mmHg", "mm[Hg]"),
    }
    assert (codes.WEIGHT.loinc.code, codes.WEIGHT.loinc.display, codes.WEIGHT.ucum) == ("29463-7", "Body weight", "kg")
    assert (codes.HEIGHT.loinc.code, codes.HEIGHT.loinc.display, codes.HEIGHT.ucum) == ("8302-2", "Body height", "cm")
    assert all(s.loinc.system == codes.LOINC == "http://loinc.org"
               for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT))
    assert codes.UCUM == "http://unitsofmeasure.org"


def test_the_charted_units_are_the_bedside_doors_own():
    """A chart row in another unit is never sent (codes.py): the table must name the door's units."""
    from homunculus.api.clinical import CHARTABLE
    from homunculus.canonical import SignalCode
    for slug, signal in codes.SIGNALS.items():
        assert CHARTABLE[SignalCode(slug)] == signal.charted_unit, slug


def test_the_two_hl7_codings_and_every_check_is_recorded():
    assert codes.VITAL_SIGNS.coding() == {"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                          "code": "vital-signs", "display": "Vital Signs"}
    assert codes.INPATIENT.coding() == {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                                        "code": "IMP", "display": "inpatient encounter"}
    assert len(codes.CHECKS) == 8 and {check[3] for check in codes.CHECKS} == {"2026-11-12"}
    assert "tx.fhir.org" in codes.CHECKED_WITH


def test_each_vital_sign_has_its_stable_key_and_the_key_is_not_its_loinc_code():
    """A local id never changes once sent (amendment 1). SpO2's LOINC code is an open question to the
    ministry (O7: `2708-6` now, maybe `59408-5`): a code change must become a PUT of the SAME resource,
    so the id is keyed by the signal, never by the code. FHIR ids allow no `_`: hyphenated words."""
    assert {slug: s.id_key for slug, s in codes.SIGNALS.items()} == {
        "heart_rate": "heart-rate", "resp_rate": "resp-rate", "spo2": "spo2", "temperature": "temperature",
        "sbp": "sbp", "map": "map"}
    assert (codes.WEIGHT.id_key, codes.HEIGHT.id_key) == ("weight", "height")
    every = (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT)
    assert len({s.id_key for s in every}) == len(every)                      # no two share an id
    for s in every:
        assert s.loinc.code not in s.id_key and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", s.id_key)


def test_every_local_id_is_hmn_a_fhir_id_and_ends_with_its_only_dot():
    made = [ids.patient("AB12C3D"), ids.patient_placeholder(ROOT), ids.practitioner(USER), ids.encounter(ROOT),
            *(ids.vital(ROOT, s.id_key, which) for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT)
              for which in (ids.FIRST, ids.LAST))]
    for local_id in made:
        assert ids.is_local_id(local_id), local_id
        assert len(local_id) <= 64
    assert ids.encounter(ROOT) == f"hmn-e-{ROOT}."
    assert ids.vital(ROOT, "heart-rate", "last") == f"hmn-v-{ROOT}-heart-rate-last."
    assert ids.vital(ROOT, codes.SIGNALS["spo2"].id_key, "first") == f"hmn-v-{ROOT}-spo2-first."
    assert ids.practitioner(USER) == f"hmn-pr-{USER}."
    for bad in ("hmn-l-12", "hmn-l-12.x.", "xmn-l-12.", "hmn-l 12.", "hmn-" + "x" * 64 + "."):
        assert not ids.is_local_id(bad), bad


def test_no_local_id_is_a_proper_prefix_of_another_in_any_case():
    """O20: the platform's search is by prefix and in any case. With one dot, at the end, none can be."""
    made = [ids.patient(fin) for fin in ("AB12C3D", "AB12C3E", "0000001")] + [
        ids.encounter(root) for root in (ROOT, OTHER)] + [
        ids.vital(root, s.id_key, which) for root in (ROOT, OTHER)
        for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT) for which in (ids.FIRST, ids.LAST)]
    for a, b in itertools.permutations(made, 2):
        assert not b.lower().startswith(a.lower()), (a, b)


def test_a_person_is_keyed_by_the_fin_digest_never_by_the_fin():
    assert ids.patient("AB12C3D") == ids.patient("AB12C3D") != ids.patient("AB12C3E")
    assert "AB12C3D" not in ids.patient("AB12C3D") and len(ids.patient("AB12C3D")) == len("hmn-p-") + 32 + 1
    with pytest.raises(ValueError):
        ids.vital(ROOT, "heart-rate", "middle")


def test_a_patient_id_is_made_from_the_normalised_fin_or_not_at_all():
    """`ids.patient` normalises through `az.normal_fin` itself: one person, one id however the FİN was
    typed — and a FİN the platform would not accept never gets an id (the message is a constant: a
    FİN is PHI and must not travel in an exception)."""
    assert ids.patient("ab12c3d") == ids.patient("AB12C3D") == ids.patient("  Ab12C3d ")
    for unusable in ("AB12C3", "ƏB12C3D", "ß12345", "", "   ", None):
        with pytest.raises(ValueError) as refused:
            ids.patient(unusable)
        assert str(refused.value) == ids.FIN_UNUSABLE
    with pytest.raises(ValueError) as refused:
        ids.patient("AB12C3")
    assert "AB12C3" not in str(refused.value) and "AB12C3" not in repr(refused.value)


@pytest.mark.parametrize("key", ["heart_rate", "Heart-Rate", "", "-heart", "heart-", "heart--rate", "heart.rate",
                                 "8867-4 ", "ürək", "x" * 20])
def test_a_vital_key_that_is_not_hyphenated_lower_case_words_is_refused(key):
    with pytest.raises(ValueError) as refused:
        ids.vital(ROOT, key, ids.FIRST)
    assert str(refused.value) == ids.VITAL_KEY_INVALID
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_codes.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'codes' from 'homunculus.tres'` — `1 error`.

- [ ] **Step 3: The codes**

Create `homunculus-engine/src/homunculus/tres/codes.py`:
```python
# homunculus-engine/src/homunculus/tres/codes.py
"""The codes the national e-health feed writes from outside the ministry's own lists (TRƏS-01, spec
D10, D12, §5) — every one CHECKED against an official terminology source when it was written, and
the check recorded beside it. No code, display or unit here is from memory (D12).

THE CHECK. On 2026-11-12 each LOINC code was looked up with `CodeSystem/$lookup` on the HL7
terminology server `https://tx.fhir.org/r4` (LOINC version 2.83 as served there); `display` below
is the display it answered (LOINC's LONG_COMMON_NAME for every code here), and every code's STATUS
was ACTIVE. Each UCUM unit was looked up the same day on the same server
(`system=http://unitsofmeasure.org`, UCUM 2.2) and is a valid UCUM code. The two HL7 codings
(observation-category `vital-signs`, v3-ActCode `IMP`) were looked up there too, and `display` is
the server's. A code changed here is looked up again, and its line's record changed with it.

THE SIGNALS (D10). The six hand-charted bedside signals, by the engine's own slug
(`canonical.SignalCode`), each with the unit the bedside door records it in (`api/clinical.py`
CHARTABLE) — a chart row in any other unit is not sent, never converted — and the UCUM code the
value goes out with. Weight and height come from the admission, not from a chart row (D10). The
codes the reference sender used and the platform accepted (spec §5) are the starting point; the
two it did not use (respiratory rate, mean arterial pressure) are LOINC's own for the measurement.

SpO2 goes as `2708-6` «Oxygen saturation in Arterial blood», the code the platform accepted from
the reference sender. A bedside SpO2 is a pulse oximetry reading, which LOINC also codes:
`59408-5` «Oxygen saturation in Arterial blood by Pulse oximetry» (looked up the same day, ACTIVE).
Which one the ministry wants is ITS question to answer before live (spec O7); until then nothing
here changes.

`code.text` carries the LOINC display, not a local label: the module holds no reviewed Azerbaijani
name for a signal, and an unreviewed one would go into the national record (plan F1, amendment)."""
from __future__ import annotations

from dataclasses import dataclass

LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
OBSERVATION_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category"
ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode"

#: Where and when the codes below were checked (D12).
CHECKED_AT = "2026-11-12"
CHECKED_WITH = "https://tx.fhir.org/r4 CodeSystem/$lookup (LOINC 2.83, UCUM 2.2)"


@dataclass(frozen=True)
class Coded:
    """One coding the feed writes: its system, code and display as the terminology server answered."""
    system: str
    code: str
    display: str

    def coding(self) -> dict:
        return {"system": self.system, "code": self.code, "display": self.display}


@dataclass(frozen=True)
class Signal:
    """A vital sign as it is sent: its LOINC coding, the unit the engine charts it in, its UCUM code and
    the key its local id carries.

    `id_key` is what `ids.vital` puts in the id (`hmn-v-{root}-{id_key}-{first|last}.`), NEVER the LOINC
    code: a sent local id never changes (plan F1, amendment 1) and a code may (SpO2 — O7: `2708-6` now,
    perhaps `59408-5`), and then the same resource must be PUT again under the same id. The key is
    lower-case words joined by single hyphens (a FHIR id allows no `_`), and no two signals share one."""
    loinc: Coded
    charted_unit: str | None          # the chart row's `unit`; None: not a chart row (weight, height)
    ucum: str
    id_key: str


#: observation-category `vital-signs` — checked 2026-11-12, display «Vital Signs».
VITAL_SIGNS = Coded(OBSERVATION_CATEGORY, "vital-signs", "Vital Signs")
#: v3-ActCode `IMP` (an Encounter's class) — checked 2026-11-12, display «inpatient encounter».
INPATIENT = Coded(ACT_CODE, "IMP", "inpatient encounter")

#: The bedside signals (D10) by the engine's slug, in the order they are sent. Each checked
#: 2026-11-12 (CHECKED_WITH); the UCUM codes `/min`, `%`, `Cel`, `mm[Hg]` likewise.
SIGNALS: dict[str, Signal] = {
    "heart_rate": Signal(Coded(LOINC, "8867-4", "Heart rate"), "/min", "/min", "heart-rate"),
    "resp_rate": Signal(Coded(LOINC, "9279-1", "Respiratory rate"), "/min", "/min", "resp-rate"),
    "spo2": Signal(Coded(LOINC, "2708-6", "Oxygen saturation in Arterial blood"), "%", "%", "spo2"),   # O7
    "temperature": Signal(Coded(LOINC, "8310-5", "Body temperature"), "°C", "Cel", "temperature"),
    "sbp": Signal(Coded(LOINC, "8480-6", "Systolic blood pressure"), "mmHg", "mm[Hg]", "sbp"),
    "map": Signal(Coded(LOINC, "8478-0", "Mean blood pressure"), "mmHg", "mm[Hg]", "map"),
}

#: The admission's measurements (D10): one value each, at the admission. Checked 2026-11-12; UCUM
#: `kg`, `cm`.
WEIGHT = Signal(Coded(LOINC, "29463-7", "Body weight"), None, "kg", "weight")
HEIGHT = Signal(Coded(LOINC, "8302-2", "Body height"), None, "cm", "height")

#: The record of each check, per code, as the plan and the guide print it.
CHECKS: tuple[tuple[str, str, str, str], ...] = tuple(
    (signal.loinc.code, signal.loinc.display, signal.ucum, CHECKED_AT)
    for signal in (*SIGNALS.values(), WEIGHT, HEIGHT))
```

- [ ] **Step 4: The local ids**

Create `homunculus-engine/src/homunculus/tres/ids.py`:
```python
# homunculus-engine/src/homunculus/tres/ids.py
"""The local ids of the national e-health feed (TRƏS-01, spec D5, amended by plan F1 for O20).

A local id is the platform's ONLY search key (`local-system-unique-id`), unique per resource type,
in a space shared with any other sender on the same provider account: every one starts `hmn-`.
It carries no PHI — a person's is a keyed digest of the FİN (`crypto.phi_digest`), never the FİN.

EVERY LOCAL ID ENDS WITH A DOT, AND HOLDS NO OTHER (O20). The platform's search is a FHIR `string`
search, by prefix and in any case: `hmn-l-1` would also find `hmn-l-10`…`hmn-l-1999`. With the dot
as the one end mark, no id is a proper prefix of another — a proper prefix would end in a dot
that the longer id holds before its end — so a search answers one entry. A sent local id never
changes; this rule holds from the first one.

They are also valid FHIR ids (`[A-Za-z0-9\\-\\.]{1,64}`): a POST carries the local id as its
placeholder `id` (spec §4.2). `is_local_id` checks both rules; the tests hold every id to it.

    Patient        hmn-p-{phi_digest(FİN)[:32]}.        the person, not the admission row (D5)
    Practitioner   hmn-pr-{user id}.
    Encounter      hmn-e-{root admission id}.           one stay across beds (D5)
    vital sign     hmn-v-{root admission id}-{signal key}-{first|last}.
                   the key is `codes.Signal.id_key` (`heart-rate`, `resp-rate`, `spo2`, `temperature`,
                   `sbp`, `map`, `weight`, `height`) — NEVER the LOINC code: a sent id never changes,
                   a code may (SpO2, O7), and then it is the same resource PUT again

A Patient that cannot be built for want of a usable FİN has no digest to be keyed by; its skip is
recorded under `hmn-p-s-{root admission id}.` (the stay's placeholder), which the package removes
once the person's own id can be built."""
from __future__ import annotations

import re
import uuid

from homunculus.crypto import phi_digest
from homunculus.tres import az

PREFIX = "hmn-"
END = "."
#: FHIR's `id`: letters, digits, '-' and '.', 1 to 64 of them.
_FHIR_ID = re.compile(r"[A-Za-z0-9\-.]{1,64}")
FIRST, LAST = "first", "last"
#: A vital sign's id key: lower-case ASCII words joined by single hyphens (FHIR ids allow no `_`).
_VITAL_KEY = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
#: Constant messages: an exception raised here never carries the FİN or the key it was given.
FIN_UNUSABLE = "a patient's id needs a usable FİN (seven Latin capitals or digits)"
VITAL_KEY_INVALID = "a vital sign's id key is lower-case words joined by single hyphens, and its id fits 64 characters"


def is_local_id(value: str) -> bool:
    """`hmn-…`, a valid FHIR id, and exactly one dot, at its end (O20)."""
    return (isinstance(value, str) and value.startswith(PREFIX) and bool(_FHIR_ID.fullmatch(value))
            and value.endswith(END) and value.count(END) == 1)


def patient(fin: str | None) -> str:
    """The person's id: the digest of the FİN as `az.normal_fin` normalises it, so one person is one
    national Patient however the FİN was typed (`ab12c3d` and `AB12C3D` are the same id). A FİN the
    platform would not accept has no id: ValueError, whose message never holds the FİN."""
    normal, _ = az.normal_fin(fin)
    if normal is None:
        raise ValueError(FIN_UNUSABLE)
    return f"{PREFIX}p-{phi_digest(normal)[:32]}{END}"


def patient_placeholder(root: uuid.UUID) -> str:
    """Where a Patient's skip is recorded while it has no usable FİN (fin_missing, fin_format)."""
    return f"{PREFIX}p-s-{root}{END}"


def practitioner(user_id: uuid.UUID) -> str:
    return f"{PREFIX}pr-{user_id}{END}"


def encounter(root: uuid.UUID) -> str:
    return f"{PREFIX}e-{root}{END}"


def vital(root: uuid.UUID, key: str, which: str) -> str:
    """A vital sign's id: the stay's root, the signal's key (`codes.Signal.id_key`, never its LOINC
    code) and `first` or `last`. Raises ValueError for a key that is not hyphenated lower-case words
    or that would make the id longer than FHIR allows."""
    if which not in (FIRST, LAST):
        raise ValueError("a vital sign's id is its first or its last value")
    if not isinstance(key, str) or not _VITAL_KEY.fullmatch(key):
        raise ValueError(VITAL_KEY_INVALID)
    local_id = f"{PREFIX}v-{root}-{key}-{which}{END}"
    if not is_local_id(local_id):
        raise ValueError(VITAL_KEY_INVALID)
    return local_id
```

- [ ] **Step 5: Run it to see it pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_codes.py 2>&1 | tail -3`
Expected: `18 passed`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/codes.py homunculus-engine/src/homunculus/tres/ids.py homunculus-engine/tests/test_tres_codes.py && git commit -m "feat(tres-01): F1 — the checked vital-sign codes (LOINC, UCUM, tx.fhir.org 2026-11-12) and the local ids, each ending with its only dot (O20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A person's rules — `tres/az.py`

D20: FİN (seven Latin capitals or digits, never transliterated), «Soyad Ad» split, the platform's two sex codes, `+994` and nine digits, the birth date — or the catalogue's reason. The phone's forms are this module's reading of the Azerbaijani numbering: `+994…`, `994…`, the domestic form with its leading `0`, the nine digits alone.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/az.py`
- Test: `homunculus-engine/tests/test_tres_az.py`

- [ ] **Step 1: Write the test**

Create `homunculus-engine/tests/test_tres_az.py`:
```python
# homunculus-engine/tests/test_tres_az.py
"""TRƏS-01 (spec D20): a person's values in the platform's form, or the catalogue's reason they are
not — FİN, name, sex, phone, birth date. No database; every value synthetic."""
from __future__ import annotations

import pytest

from homunculus.tres import az


@pytest.mark.parametrize("typed, expected", [
    ("AB12C3D", ("AB12C3D", None)),
    ("  ab12c3d ", ("AB12C3D", None)),                       # trimmed and upper-cased
    ("0000001", ("0000001", None)),
    (None, (None, "fin_missing")), ("", (None, "fin_missing")), ("   ", (None, "fin_missing")),
    ("AB12C3", (None, "fin_format")), ("AB12C3DE", (None, "fin_format")),
    ("AB 12C3D", (None, "fin_format")), ("ƏB12C3D", (None, "fin_format")),   # never transliterated
    ("AB-12C3", (None, "fin_format")),
])
def test_the_fin_is_seven_latin_capitals_or_digits(typed, expected):
    assert az.normal_fin(typed) == expected


@pytest.mark.parametrize("typed", [
    "ß123456",      # str.upper() would make it «SS123456»-shaped: ß → SS
    "ß12345",       # …and «SS12345», seven characters: an invented FİN
    "ﬀ12345",       # the ff ligature → FF
    "ſ123456",      # the long s → S
    "ı123456",      # the dotless i → I
    "AB12C3Ｄ",  # a full-width D
])
def test_a_fin_that_is_not_ascii_is_refused_before_it_is_upper_cased(typed):
    """D20 forbids transliteration: `str.upper()` maps ß to SS, ﬀ to FF, ſ to S and ı to I, which is
    one — so the value is judged as typed, and any character outside ASCII is `fin_format`."""
    assert az.normal_fin(typed) == (None, "fin_format")


@pytest.mark.parametrize("typed, expected", [
    ("Sentetik Ayşe", (("Sentetik", ["Ayşe"]), None)),
    ("  Sentetikova   Leyla  Nur ", (("Sentetikova", ["Leyla", "Nur"]), None)),
    ("Sentetik", (None, "name_single")), ("", (None, "name_single")), (None, (None, "name_single")),
])
def test_the_name_is_family_first_then_the_given_names(typed, expected):
    assert az.split_name(typed) == expected


@pytest.mark.parametrize("sex, expected", [
    ("male", ("K", None)), ("female", ("Q", None)), (" Female ", ("Q", None)),
    ("other", (None, "sex_unmapped")), ("unknown", (None, "sex_unmapped")), (None, (None, "sex_unmapped")),
])
def test_sex_has_the_platforms_two_codes_only(sex, expected):
    assert az.sex_code(sex) == expected


@pytest.mark.parametrize("typed, expected", [
    ("+994501234567", "+994501234567"), ("994501234567", "+994501234567"),
    ("050 123 45 67", "+994501234567"), ("(050) 123-45-67", "+994501234567"), ("501234567", "+994501234567"),
    ("+90 532 123 45 67", None), ("12345", None), ("", None), (None, None), ("05012345678", None),
    # only ASCII digits: Arabic-Indic, Persian and full-width digits are `\d` to Python, not to the platform
    ("+٩٩٤٥٠١٢٣٤٥٦٧", None), ("٠٥٠١٢٣٤٥٦٧", None), ("۰۵۰۱۲۳۴۵۶۷", None), ("+994５０１２３４５６７", None),
    ("+99450123456٧", None),
])
def test_a_phone_is_plus_994_and_nine_digits_or_not_sent(typed, expected):
    assert az.phone(typed) == expected


def test_the_birth_date_is_a_date_or_its_reason():
    assert az.birth_date("1980-01-31") == ("1980-01-31", None)
    for bad in (None, "", "31.01.1980", "1980-02-30"):
        assert az.birth_date(bad) == (None, "birth_date_invalid"), bad
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_az.py 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'az' from 'homunculus.tres'` — `1 error`.

- [ ] **Step 3: The rules**

Create `homunculus-engine/src/homunculus/tres/az.py`:
```python
# homunculus-engine/src/homunculus/tres/az.py
"""The platform's rules for a person (TRƏS-01, spec D20, D16) — pure functions, no I/O.

What the `az-patient` profile requires — the FİN, the family and the given name, the father's
name and the sex — is either here in the platform's form, or the reason it is not, as a catalogue
code the tab shows so the ward can complete the record. Nothing here guesses: a value that does
not fit is a skip, never a correction.

* FİN: trimmed, refused when any character is outside ASCII, then upper-cased and exactly seven
  Latin capitals or digits. Never transliterated (an `Ə` typed in it is `fin_format`, not an `E`;
  nor does `ß` become `SS`, which `str.upper()` would do).
* Name: the admission form writes «Soyad Ad» (family first), so the first word is the family name
  and the rest the given names; a single word cannot be split (`name_single`).
* Sex: `male` → `K`, `female` → `Q` (the platform's own codes); `other` and `unknown` have none.
* Phone: `+994` and the nine (ASCII) digits of the national number, from `+994…`, `994…`, the domestic
  form with its leading `0`, or the nine digits alone — spaces, dashes, dots and brackets dropped.
  Anything else is not sent (a phone is not required: no skip)."""
from __future__ import annotations

import re
from datetime import date

FIN_MISSING = "fin_missing"
FIN_FORMAT = "fin_format"
NAME_SINGLE = "name_single"
FATHER_NAME_MISSING = "father_name_missing"
SEX_UNMAPPED = "sex_unmapped"
BIRTH_DATE_INVALID = "birth_date_invalid"

_FIN = re.compile(r"[A-Z0-9]{7}")
SEX_CODES = {"male": "K", "female": "Q"}
_PHONE_PUNCTUATION = re.compile(r"[\s\-.()]")
# ASCII digits only: `\d` alone takes Arabic-Indic, Persian and full-width digits too, and they would
# go into the value sent (D20: nothing is transliterated, so nothing is passed off as ASCII either).
_PHONE_FORMS = (re.compile(r"\+994([0-9]{9})"), re.compile(r"994([0-9]{9})"), re.compile(r"0([0-9]{9})"),
                re.compile(r"([0-9]{9})"))


def normal_fin(value: str | None) -> tuple[str | None, str | None]:
    """(the FİN in the platform's form, None) or (None, the skip reason)."""
    fin = (value or "").strip()
    if not fin:
        return None, FIN_MISSING
    # Judged as typed, BEFORE any case-folding: `str.upper()` maps ß to SS, ﬀ to FF, ſ to S and ı to I,
    # which is transliteration (D20) — a FİN with a character outside ASCII is a `fin_format`, never
    # a corrected one.
    if not fin.isascii():
        return None, FIN_FORMAT
    fin = fin.upper()
    if not _FIN.fullmatch(fin):
        return None, FIN_FORMAT
    return fin, None


def split_name(display_name: str | None) -> tuple[tuple[str, list[str]] | None, str | None]:
    """((family, [given…]), None) from «Soyad Ad …», or (None, the skip reason)."""
    words = (display_name or "").split()
    if len(words) < 2:
        return None, NAME_SINGLE
    return (words[0], words[1:]), None


def sex_code(sex: str | None) -> tuple[str | None, str | None]:
    code = SEX_CODES.get((sex or "").strip().lower())
    return (code, None) if code else (None, SEX_UNMAPPED)


def phone(value: str | None) -> str | None:
    """`+994` and nine digits, or None (not sent)."""
    bare = _PHONE_PUNCTUATION.sub("", value or "")
    for form in _PHONE_FORMS:
        match = form.fullmatch(bare)
        if match:
            return "+994" + match.group(1)
    return None


def birth_date(value: str | None) -> tuple[str | None, str | None]:
    """The stored ISO date as the platform's `date`, or (None, `birth_date_invalid`)."""
    try:
        return date.fromisoformat((value or "").strip()).isoformat(), None
    except ValueError:
        return None, BIRTH_DATE_INVALID
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_az.py 2>&1 | tail -3`
Expected: `44 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/az.py homunculus-engine/tests/test_tres_az.py && git commit -m "feat(tres-01): F1 — a person's rules (D20): FİN, the name's two parts, the platform's sex codes, the phone, the birth date, or the catalogue's reason" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The stay and the four mappers — `tres/stay.py`, `tres/mapping/`

A `Stay` is plain values (no session): the chain's root and last admission, the person decrypted, the zone, the department, the attendings with their identities, the admission's weight and height, the bedside readings. `readings_of` drops the withdrawn, the unreadable and another unit's rows; `first_and_last` picks per signal by measurement time. Four pure mappers return a resource or a `Skip` with its reason (spec §5; amendments 11–14 and 16).

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/stay.py`
- Create: `homunculus-engine/src/homunculus/tres/mapping/__init__.py`, `homunculus-engine/src/homunculus/tres/mapping/common.py`, `homunculus-engine/src/homunculus/tres/mapping/patient.py`, `homunculus-engine/src/homunculus/tres/mapping/practitioner.py`, `homunculus-engine/src/homunculus/tres/mapping/encounter.py`, `homunculus-engine/src/homunculus/tres/mapping/vitals.py`
- Test: `homunculus-engine/tests/test_tres_mapping.py`

- [ ] **Step 1: Write the golden tests**

Create `homunculus-engine/tests/test_tres_mapping.py`:
```python
# homunculus-engine/tests/test_tres_mapping.py
"""TRƏS-01 (spec §5, D5, D8, D10, D16, D17, D20, D22): the four mappers of phase F1 as golden tests —
each resource exactly as spec §5 shapes it, every time in the tenant's zone with its offset, every
skip with its catalogue reason — and the stay's bedside readings: the withdrawn ones left out, the
first and last by measurement time. Pure functions: no database, no network (the drift guards
against the engine's `/clinical` door run it in memory: `create_app` with an `InMemoryAuditLog`).
A synthetic stay of a synthetic person; the zone is a fixed +04:00 (Asia/Baku has had no DST since
2016), so the test needs no time zone database."""
from __future__ import annotations

import uuid
from dataclasses import replace
from pathlib import Path
from datetime import datetime, timedelta, timezone, tzinfo

import pytest
from fastapi.testclient import TestClient

from homunculus.api import clinical
from homunculus.api.app import create_app
from homunculus.api.audit import AuditRecord, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.rehydrate import retracted_entries
from homunculus.tres import codes, ids, stay as stay_module
from homunculus.tres.client import LOCAL_ID_EXTENSION
from homunculus.tres.mapping.common import DISCHARGE_MISSING, INSTANT_NAIVE, Built, Skip, instant
from homunculus.tres.mapping.encounter import encounter
from homunculus.tres.mapping.patient import patient
from homunculus.tres.mapping.practitioner import practitioner
from homunculus.tres.mapping.vitals import vitals
from homunculus.tres.stay import Clinician, Department, Person, Reading, Stay, first_and_last, readings_of

BAKU = timezone(timedelta(hours=4), "Asia/Baku")
ROOT = uuid.UUID("00000000-0000-4000-8000-000000000001")
LAST = uuid.UUID("00000000-0000-4000-8000-000000000002")
DOCTOR = uuid.UUID("00000000-0000-4000-8000-0000000000d1")
ADMITTED = datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc)        # 10:30 in Baku
DISCHARGED = datetime(2026, 11, 6, 11, 0, tzinfo=timezone.utc)      # 15:00 in Baku
PERSON = Person(fin="ab12c3d", display_name="Sentetikova Leyla Nur", father_name="Sentetik",
                sex="female", date_of_birth="1980-01-31", phone="050 123 45 67")
PATIENT_ID = ids.patient("AB12C3D")


def at(hours: float) -> datetime:
    return ADMITTED + timedelta(hours=hours)


def stay(**over) -> Stay:
    values = dict(root_id=ROOT, last_id=LAST, board_key="202600000001", admitted_at=ADMITTED,
                  discharged_at=DISCHARGED, finished=True, person=PERSON, zone=BAKU,
                  department=Department("RE-01", "Reanimasiya"),
                  clinicians=(Clinician(DOCTOR, "zz99yy8", "Sentetikov", "Elçin", known=True),),
                  weight_kg=72.5, height_cm=168.0,
                  readings=(Reading("heart_rate", 88.0, at(1), 11), Reading("heart_rate", 76.0, at(90), 41),
                            Reading("heart_rate", 92.0, at(40), 31), Reading("temperature", 37.2, at(2), 12),
                            Reading("spo2", 95.0, at(1), 13)))
    return Stay(**{**values, **over})


def local(resource: dict) -> str:
    return resource["extension"][0]["valueString"]


# ---------------------------------------------------------------- Patient (D20)
def test_a_patient_is_the_person_keyed_by_the_fin_digest():
    built = patient(PERSON, ROOT)
    assert isinstance(built, Built) and (built.resource_type, built.fhir_type, built.local_id) == (
        "patient", "Patient", PATIENT_ID)
    assert built.resource == {
        "resourceType": "Patient",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": PATIENT_ID},
                      {"url": "http://fhir.az/StructureDefinition/sex", "valueCode": "Q"},
                      {"url": "http://fhir.az/StructureDefinition/fathersName", "valueString": "Sentetik"}],
        "identifier": [{"type": {"coding": [{"system": "http://fhir.az/CodeSystem/identity-document-type",
                                             "code": "15"}]},
                        "system": "http://fhir.az/sid/fin", "value": "AB12C3D"}],
        "active": True,
        "name": [{"family": "Sentetikova", "given": ["Leyla", "Nur"]}],
        "birthDate": "1980-01-31",
        "telecom": [{"system": "phone", "value": "+994501234567"}],
    }
    assert "AB12C3D" not in built.local_id                      # the id says nothing about the FİN
    assert patient(replace(PERSON, display_name="Sentetik Ayşe", sex="male"), LAST).local_id == PATIENT_ID


def test_a_patient_without_a_phone_the_platform_reads_is_sent_without_one():
    built = patient(replace(PERSON, phone="+90 532 000 00 00"), ROOT)
    assert isinstance(built, Built) and "telecom" not in built.resource


def test_each_missing_requirement_is_a_skip_with_its_reason():
    placeholder = ids.patient_placeholder(ROOT)
    cases = [(replace(PERSON, fin=None), placeholder, "fin_missing"),
             (replace(PERSON, fin="AB12C3"), placeholder, "fin_format"),
             (replace(PERSON, display_name="Sentetik"), PATIENT_ID, "name_single"),
             (replace(PERSON, father_name="  "), PATIENT_ID, "father_name_missing"),
             (replace(PERSON, sex="unknown"), PATIENT_ID, "sex_unmapped"),
             (replace(PERSON, date_of_birth="31.01.1980"), PATIENT_ID, "birth_date_invalid")]
    for person, local_id, reason in cases:
        assert patient(person, ROOT) == Skip("patient", local_id, reason), reason


# ---------------------------------------------------------------- Practitioner (D16)
def test_a_practitioner_is_the_identity_the_tab_holds():
    built = practitioner(Clinician(DOCTOR, " zz99yy8 ", "Sentetikov", "Elçin Rəşad", known=True))
    assert built.resource == {
        "resourceType": "Practitioner",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-practitioner"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-pr-{DOCTOR}."}],
        "identifier": [{"type": {"coding": [{"system": "http://fhir.az/CodeSystem/identity-document-type",
                                             "code": "15"}]},
                        "system": "http://fhir.az/sid/fin", "value": "ZZ99YY8"}],
        "active": True,
        "name": [{"family": "Sentetikov", "given": ["Elçin", "Rəşad"]}],
    }


def test_a_practitioner_without_a_whole_identity_is_skipped():
    local_id = f"hmn-pr-{DOCTOR}."
    assert practitioner(Clinician(DOCTOR)) == Skip("practitioner", local_id, "identity_missing")
    assert practitioner(Clinician(DOCTOR, None, "S", "E", known=True)) == Skip("practitioner", local_id, "fin_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99", "S", "E", known=True)) == Skip("practitioner", local_id, "fin_format")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", "", "E", known=True)) == Skip("practitioner", local_id, "name_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", "S", "", known=True)) == Skip("practitioner", local_id, "name_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", "S", "   ", known=True)) == Skip("practitioner", local_id, "name_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", None, None, known=True)) == Skip("practitioner", local_id, "name_missing")


# ---------------------------------------------------------------- Encounter (D8, D17, D22)
def test_an_encounter_is_the_stay_from_its_root_in_the_tenants_zone():
    built = encounter(stay(), patient_id="7001", practitioner_ids=["7002"], organization_id="ORG-0001")
    assert built.local_id == f"hmn-e-{ROOT}."
    assert built.resource == {
        "resourceType": "Encounter",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-encounter"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-e-{ROOT}."}],
        "status": "finished",
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP",
                  "display": "inpatient encounter"},
        "type": [{"coding": [{"system": "http://fhir.az/CodeSystem/encounter-type", "code": "1"}]}],
        "subject": {"reference": "Patient/7001"},
        "period": {"start": "2026-11-02T10:30:00+04:00", "end": "2026-11-06T15:00:00+04:00"},
        "serviceType": {"coding": [{"system": "http://fhir.az/CodeSystem/hospital-departments",
                                    "code": "RE-01", "display": "Reanimasiya"}]},
        "serviceProvider": {"reference": "Organization/ORG-0001"},
        "participant": [{"individual": {"reference": "Practitioner/7002"}}],
    }


def test_a_stay_still_open_is_in_progress_with_no_end_and_no_participant_when_none_was_sent():
    built = encounter(stay(finished=False, discharged_at=None), patient_id="7001", practitioner_ids=[],
                      organization_id="ORG-0001")
    assert (built.resource["status"], built.resource["period"]) == ("in-progress", {"start": "2026-11-02T10:30:00+04:00"})
    assert "participant" not in built.resource


def test_a_utc_tenant_gets_a_plus_zero_offset_never_a_z():
    """D22: a time carries its offset; `Z` is never written — a tenant left on `UTC` reads `+00:00`."""
    built = encounter(stay(zone=timezone.utc), patient_id="7001", practitioner_ids=[], organization_id="ORG-0001")
    assert built.resource["period"] == {"start": "2026-11-02T06:30:00+00:00", "end": "2026-11-06T11:00:00+00:00"}
    observation = vitals(stay(zone=timezone.utc), patient_id="7001", encounter_id="7003")[0].resource
    assert observation["effectiveDateTime"] == "2026-11-02T07:30:00+00:00"
    assert instant(ADMITTED, timezone.utc) == "2026-11-02T06:30:00+00:00"
    assert "Z" not in str(built.resource["period"]) + observation["effectiveDateTime"]


class _NoOffset(tzinfo):
    """A tzinfo that is attached but knows no offset: as naive as no tzinfo at all (Python's own rule)."""

    def utcoffset(self, dt):
        return None

    def dst(self, dt):
        return None


def test_a_time_with_no_zone_is_refused_not_read_as_the_servers_local_time():
    for naive in (datetime(2026, 11, 2, 10, 30), datetime(2026, 11, 2, 10, 30, tzinfo=_NoOffset())):
        with pytest.raises(ValueError) as refused:
            instant(naive, BAKU)
        assert str(refused.value) == INSTANT_NAIVE and "2026" not in str(refused.value)
    assert instant(datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc), BAKU) == "2026-11-02T10:30:00+04:00"


def test_a_stay_finished_with_no_discharge_time_is_skipped_not_sent_open_ended():
    """A `finished` Encounter without `period.end` is a record that contradicts itself."""
    skipped = encounter(stay(finished=True, discharged_at=None), patient_id="7001", practitioner_ids=[],
                        organization_id="ORG-0001")
    assert skipped == Skip("encounter", f"hmn-e-{ROOT}.", "discharge_missing")
    assert skipped.reason == DISCHARGE_MISSING == "discharge_missing"


def test_an_encounter_without_its_department_organization_or_zone_is_skipped():
    local_id = f"hmn-e-{ROOT}."
    assert encounter(stay(department=None), patient_id="1", practitioner_ids=[], organization_id="O") == Skip(
        "encounter", local_id, "unit_unmapped")
    assert encounter(stay(), patient_id="1", practitioner_ids=[], organization_id=" ") == Skip(
        "encounter", local_id, "organization_missing")
    assert encounter(stay(zone=None), patient_id="1", practitioner_ids=[], organization_id="O") == Skip(
        "encounter", local_id, "timezone_unknown")


# ---------------------------------------------------------------- vital signs (D10, D12)
def test_each_signal_goes_as_its_first_and_last_then_weight_and_height():
    built = vitals(stay(), patient_id="7001", encounter_id="7003")
    assert [(b.resource_type, b.fhir_type) for b in built] == [("vital", "Observation")] * 6
    assert [b.local_id for b in built] == [
        f"hmn-v-{ROOT}-heart-rate-first.", f"hmn-v-{ROOT}-heart-rate-last.", f"hmn-v-{ROOT}-spo2-first.",
        f"hmn-v-{ROOT}-temperature-first.", f"hmn-v-{ROOT}-weight-first.", f"hmn-v-{ROOT}-height-first."]
    assert all(ids.is_local_id(b.local_id) and len(b.local_id) <= 64 for b in built)
    first_hr = built[0].resource
    assert first_hr == {
        "resourceType": "Observation",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-observation"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-v-{ROOT}-heart-rate-first."}],
        "status": "final",
        "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                  "code": "vital-signs", "display": "Vital Signs"}]}],
        "code": {"coding": [{"system": "http://loinc.org", "code": "8867-4", "display": "Heart rate"}],
                 "text": "Heart rate"},
        "subject": {"reference": "Patient/7001"},
        "encounter": {"reference": "Encounter/7003"},
        "effectiveDateTime": "2026-11-02T11:30:00+04:00",
        "valueQuantity": {"value": 88, "unit": "/min", "system": "http://unitsofmeasure.org", "code": "/min"},
    }
    last_hr = built[1].resource
    assert (last_hr["effectiveDateTime"], last_hr["valueQuantity"]["value"]) == ("2026-11-06T04:30:00+04:00", 76)
    temperature = built[3].resource["valueQuantity"]
    assert temperature == {"value": 37.2, "unit": "Cel", "system": "http://unitsofmeasure.org", "code": "Cel"}
    weight = built[4].resource
    assert (weight["effectiveDateTime"], weight["valueQuantity"]["value"], weight["valueQuantity"]["code"]) == (
        "2026-11-02T10:30:00+04:00", 72.5, "kg")
    assert built[5].resource["valueQuantity"] == {"value": 168, "unit": "cm", "system": "http://unitsofmeasure.org",
                                                  "code": "cm"}


def test_a_changed_loinc_code_is_the_same_resource_under_the_same_local_id(monkeypatch):
    """O7: SpO2 may move from `2708-6` to `59408-5` (the ministry's answer). A sent local id never
    changes (amendment 1), so the code is not in it: the next round PUTs the same resource."""
    before = {b.local_id: b.resource for b in vitals(stay(), patient_id="7001", encounter_id="7003")}
    other = replace(codes.SIGNALS["spo2"], loinc=codes.Coded(
        codes.LOINC, "59408-5", "Oxygen saturation in Arterial blood by Pulse oximetry"))
    monkeypatch.setitem(codes.SIGNALS, "spo2", other)
    after = {b.local_id: b.resource for b in vitals(stay(), patient_id="7001", encounter_id="7003")}
    assert list(after) == list(before)
    spo2 = f"hmn-v-{ROOT}-spo2-first."
    assert before[spo2]["code"]["coding"][0]["code"] == "2708-6"
    assert after[spo2]["code"]["coding"][0]["code"] == "59408-5"


def test_no_readings_and_no_measurements_send_no_vitals():
    assert vitals(stay(readings=(), weight_kg=None, height_cm=None), patient_id="1", encounter_id="2") == []
    assert vitals(stay(zone=None), patient_id="1", encounter_id="2") == []


@pytest.mark.parametrize("bad", [0, 0.0, -1.0, -72.5, float("inf"), float("-inf"), float("nan")])
def test_a_weight_or_height_that_is_not_a_positive_finite_number_is_not_sent(bad):
    """`inf` must never reach `valueQuantity`; zero and negative values are not measurements."""
    assert vitals(stay(readings=(), weight_kg=bad, height_cm=bad), patient_id="1", encounter_id="2") == []
    only_height = vitals(stay(readings=(), weight_kg=bad), patient_id="1", encounter_id="2")
    assert [b.local_id for b in only_height] == [f"hmn-v-{ROOT}-height-first."]
    only_weight = vitals(stay(readings=(), height_cm=bad), patient_id="1", encounter_id="2")
    assert [b.local_id for b in only_weight] == [f"hmn-v-{ROOT}-weight-first."]


def test_first_and_last_are_by_measurement_time_and_one_value_is_first_only():
    chosen = first_and_last(stay().readings)
    assert {slug: (first.entry, last.entry if last else None) for slug, (first, last) in chosen.items()} == {
        "heart_rate": (11, 41), "temperature": (12, None), "spo2": (13, None)}
    tie = first_and_last([Reading("map", 70.0, at(1), 9), Reading("map", 72.0, at(1), 8)])
    assert (tie["map"][0].entry, tie["map"][1].entry) == (8, 9)


def _record(id_, event_type, subject, payload) -> AuditRecord:
    return AuditRecord(id=id_, ts="2026-11-02T07:00:00+00:00", tenant="sentetik", event_type=event_type,
                       patient_id="202600000001", subject=subject, payload=payload)


def test_the_readings_are_the_charted_ones_less_the_withdrawn_and_the_unreadable():
    obs = at(1).isoformat()
    records = [
        _record(1, "chart", "heart_rate", {"value": 88.0, "unit": "/min", "obs_ts": obs}),
        _record(2, "chart", "heart_rate", {"value": 180.0, "unit": "/min", "obs_ts": obs}),
        _record(3, "chart_retract", "heart_rate", {"entry": 2, "reason": "yanlış hasta seçilmiş"}),
        _record(4, "chart", "temperature", {"value": 99.0, "unit": "°F", "obs_ts": obs}),        # another unit
        _record(5, "chart", "spo2", {"value": True, "unit": "%", "obs_ts": obs}),                 # not a number
        _record(6, "chart", "resp_rate", {"value": 18.0, "unit": "/min", "obs_ts": "2026-11-02T07:00:00"}),  # no zone
        _record(7, "chart", "lactate", {"value": 2.0, "unit": "mmol/L", "obs_ts": obs}),         # not a vital (F4)
        _record(8, "ingest", "heart_rate", {"value": 90.0, "unit": "/min", "obs_ts": obs}),       # a monitor's: never
        _record(9, "chart", "map", {"value": 70.0, "unit": "mmHg", "obs_ts": obs}),
    ]
    assert readings_of(records) == (Reading("heart_rate", 88.0, at(1), 1), Reading("map", 70.0, at(1), 9))


def _chart_row(id_, slug, value, hours, **payload) -> AuditRecord:
    return _record(id_, "chart", slug, {"value": value, "unit": "/min", "obs_ts": at(hours).isoformat(), **payload})


def _retract_row(id_, entry) -> AuditRecord:
    return _record(id_, "chart_retract", "heart_rate", {"entry": entry, "reason": "yanlış hasta seçilmiş"})


@pytest.mark.parametrize("entry", [True, 1.0, [1], "1", None, {"id": 1}, 1.5])
def test_a_malformed_retract_withdraws_nothing_and_raises_nothing(entry):
    """The engine's own guard (api/rehydrate.py `retracted_entries`): only an `int` that is not a `bool`
    names a row. `True` and `1.0` equal 1 and would have withdrawn row 1; `[1]` is unhashable and
    would have raised."""
    records = [_chart_row(1, "heart_rate", 88.0, 1), _retract_row(2, entry)]
    assert retracted_entries(records) == frozenset()
    assert readings_of(records) == (Reading("heart_rate", 88.0, at(1), 1),)


def test_withdrawing_the_earliest_or_the_latest_reading_promotes_the_next():
    rows = [_chart_row(1, "heart_rate", 80.0, 1), _chart_row(2, "heart_rate", 82.0, 5),
            _chart_row(3, "heart_rate", 84.0, 9)]

    def ends(*withdrawn):
        chosen = first_and_last(readings_of([*rows, *(_retract_row(10 + n, n) for n in withdrawn)]))
        first, last = chosen["heart_rate"]
        return first.entry, last.entry if last else None

    assert ends() == (1, 3)
    assert ends(1) == (2, 3)             # the earliest withdrawn: the next is the first
    assert ends(3) == (1, 2)             # the latest withdrawn: the one before is the last
    assert ends(1, 3) == (2, None)       # both: one value left, first only
    assert "heart_rate" not in first_and_last(                    # all three: no reading, no vital sign
        readings_of([*rows, *(_retract_row(10 + n, n) for n in (1, 2, 3))]))


def test_a_row_the_device_token_charted_is_not_hand_charted_but_every_other_charter_is():
    """D10 sends hand-charted values only. `/clinical` also takes the tenant (device) token and then
    writes `charted_by` «tenant-token» (api/app.py): a machine's sample is unverified, so it is left out."""
    records = [_chart_row(1, "heart_rate", 88.0, 1, charted_by=stay_module.DEVICE_CHARTER),
               _chart_row(2, "heart_rate", 90.0, 2, charted_by="hem.ayse"),
               _chart_row(3, "heart_rate", 92.0, 3)]
    assert [r.entry for r in readings_of(records)] == [2, 3]
    assert stay_module.DEVICE_CHARTER == "tenant-token"


# ---------------------------------------------------------------- drift guards against the engine's doors
def test_the_trail_names_the_stay_reads_are_the_engines_own():
    """`chart_retract` is a constant of api/clinical.py; the `chart` row's type is a literal there, so the
    guard runs the real door: a hand entry and a device entry in, the withdrawal out, through
    `create_app` with an in-memory trail — a rename would leave `readings_of` silently empty."""
    assert stay_module.RETRACT == clinical.RETRACT

    async def resolve(credential):
        return {"nurse": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                                perms=frozenset({"board.view", "clinical.chart"}))}.get(credential)

    audit = InMemoryAuditLog()
    app = create_app({"tok": "h1"}, run_escalation_loop=False, resolve_jwt=resolve, audit=audit)
    when = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    nurse = {"Authorization": "Bearer nurse"}

    def chart(headers, value):
        answer = client.post("/clinical/bed-3", headers=headers, json={
            "entries": [{"code": "heart_rate", "value": value}], "recorded_at": when})
        assert answer.status_code == 200, answer.text
        return answer.json()["entries"][0]["entry"]

    with TestClient(app) as client:
        chart({"Authorization": "Bearer tok"}, 70)                    # the bridge's token: a device row
        hand, wrong = chart(nurse, 80), chart(nurse, 160)
        withdrawn = client.post(f"/clinical/bed-3/entries/{wrong}/retract", headers=nurse,
                                json={"reason": "yazım hatası — 160 değil 60"})
        assert withdrawn.status_code == 200, withdrawn.text
    records = audit.records(tenant="h1", limit=1000)
    assert {r.event_type for r in records} >= {stay_module.CHART, stay_module.RETRACT}
    assert [r.payload["charted_by"] for r in records if r.event_type == stay_module.CHART] == [
        stay_module.DEVICE_CHARTER, "hem.ayse", "hem.ayse"]
    assert [r.entry for r in readings_of(records)] == [hand]          # not the device's, not the withdrawn


def test_the_device_branch_of_charted_by_still_writes_the_literal_the_stay_skips():
    """api/app.py `_charted_by` records the token path as exactly the string `stay.DEVICE_CHARTER`; the
    engine's source is read, as the dashboard's tests read it, so a changed literal fails here."""
    source = (Path(clinical.__file__).parent / "app.py").read_text(encoding="utf-8")
    assert f'return "{stay_module.DEVICE_CHARTER}" if caller.is_device else caller.actor' in source


# ---------------------------------------------------------------- no identity in a repr
def test_a_persons_and_a_clinicians_repr_hold_none_of_their_identity():
    """A `Stay` ends up in a log line or a pytest diff: its repr must not carry a FİN, a name, a birth date…"""
    shown = repr(PERSON) + repr(stay().clinicians[0]) + repr(stay())
    for value in ("ab12c3d", "AB12C3D", "zz99yy8", "ZZ99YY8", "Sentetikova", "Leyla", "Nur", "Sentetik", "Sentetikov",
                  "Elçin", "female", "1980", "050 123 45 67"):
        assert value not in shown, value
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_mapping.py 2>&1 | tail -3`
Expected: `ModuleNotFoundError: No module named 'homunculus.tres.mapping'` — `1 error`.

- [ ] **Step 3: The stay**

Create `homunculus-engine/src/homunculus/tres/stay.py`:
```python
# homunculus-engine/src/homunculus/tres/stay.py
"""One stay as the mappers read it (TRƏS-01, spec D5, D8, D10) — plain values, no session, no I/O.

`tres/source.py` reads a stay from the database and the audit trail into a `Stay`; the mappers
(`tres/mapping/`) turn it into resources. Keeping the two apart keeps every mapper a pure function
a golden test can hold to spec §5 with synthetic people.

A STAY is a transfer chain of admissions (`Admission.source_admission_id`): its ROOT is the first
row — the Encounter's id (D5) and its start — and its LAST row is where it is now or ended — its
state, its discharge, its department and its board key. A transfer moves the protocol number to
the arriving row (admission/service.py, spec O8 of 2026-11-02) and keeps the patient row, so the
last row's board key is the key of every chart row of the stay: one read (plan F1, N2).

`readings_of` reads the hand-charted bedside values (D10) from the trail's `chart` rows, less the
ones a `chart_retract` withdrew; `first_and_last` picks each signal's first and last by the time it
was measured (the audit id breaks a tie). A row the trail cannot read — not a finite number, a time
with no zone, another unit than the door records — is left out, never sent as a guess. So is a row
the device token charted: `/clinical` takes the bridge's tenant token as well as a clinician's, and
records it as `DEVICE_CHARTER` — a machine's sample is unverified, and D10 sends what a person charted.

Nothing here carries an identity into a repr: the person's and the clinician's fields are
`repr=False`, so a stay in a log line, an assertion message or a debugger shows no FİN or name."""
from __future__ import annotations

import math
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, tzinfo

from homunculus.tres.codes import SIGNALS

CHART = "chart"                    # the audit event type api/clinical.py writes (a literal there; a test runs the door)
RETRACT = "chart_retract"          # api/clinical.py RETRACT: the withdrawal of one `chart` row
#: `charted_by` of a `chart` row the static tenant token wrote (api/app.py `_charted_by`): a device's.
DEVICE_CHARTER = "tenant-token"


@dataclass(frozen=True)
class Person:
    """The patient row's identity, decrypted (spec D20). `fin` is `Patient.national_id`. Every field
    is `repr=False`: this is PHI, and a repr reaches logs and assertion messages."""
    fin: str | None = field(repr=False)
    display_name: str | None = field(repr=False)
    father_name: str | None = field(repr=False)
    sex: str | None = field(repr=False)
    date_of_birth: str | None = field(repr=False)
    phone: str | None = field(repr=False)


@dataclass(frozen=True)
class Clinician:
    """An attending of the stay and the identity the tab holds for them (D16); the identity's three
    fields are None when the tab has no row for this user. The identity is `repr=False`."""
    user_id: uuid.UUID
    fin: str | None = field(default=None, repr=False)
    family_name: str | None = field(default=None, repr=False)
    given_name: str | None = field(default=None, repr=False)
    known: bool = False                # a `tres_practitioner_identity` row exists


@dataclass(frozen=True)
class Department:
    """The `hospital-departments` coding the tab maps the stay's unit to (D17)."""
    code: str
    display: str


@dataclass(frozen=True)
class Reading:
    """One hand-charted value: the engine's signal slug, the value, when it was measured, its audit id."""
    slug: str
    value: float
    at: datetime
    entry: int


@dataclass(frozen=True)
class Stay:
    root_id: uuid.UUID
    last_id: uuid.UUID
    board_key: str
    admitted_at: datetime
    discharged_at: datetime | None     # the last row's, once DISCHARGED
    finished: bool                     # the last row is DISCHARGED
    person: Person
    zone: tzinfo | None                # the tenant's zone; None: unknown to this server
    department: Department | None = None
    clinicians: tuple[Clinician, ...] = ()
    weight_kg: float | None = None
    height_cm: float | None = None
    readings: tuple[Reading, ...] = field(default_factory=tuple)


def _instant(text) -> datetime | None:
    try:
        at = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    return at if at.tzinfo is not None and at.utcoffset() is not None else None


def _row_id(value) -> bool:
    """A `chart_retract`'s `entry` names a row only as an `int` that is not a `bool` — as
    api/rehydrate.py `retracted_entries` holds it: `True` and `1.0` equal 1 and would withdraw row 1,
    and a list is unhashable. (Copied, not imported: this module stays free of the engine's `api`.)"""
    return isinstance(value, int) and not isinstance(value, bool)


def _finite(value) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def readings_of(records: Iterable) -> tuple[Reading, ...]:
    """The bedside values of `records` (audit records of one stay's board key, `chart` and
    `chart_retract`): every `chart` row of the six signals that no `chart_retract` withdrew, in the
    door's unit, with a finite value and a zone-aware time, that a person charted (not the device token)."""
    records = list(records)
    withdrawn = set()
    for rec in records:
        if rec.event_type == RETRACT and _row_id(entry := rec.payload.get("entry")):
            withdrawn.add(entry)
    out = []
    for rec in records:
        signal = SIGNALS.get(rec.subject)
        if rec.event_type != CHART or signal is None or rec.id in withdrawn:
            continue
        if rec.payload.get("charted_by") == DEVICE_CHARTER:
            continue
        value, at = rec.payload.get("value"), _instant(rec.payload.get("obs_ts"))
        if rec.payload.get("unit") != signal.charted_unit or not _finite(value) or at is None:
            continue
        out.append(Reading(rec.subject, float(value), at, rec.id))
    return tuple(out)


def first_and_last(readings: Iterable[Reading]) -> dict[str, tuple[Reading, Reading | None]]:
    """Per signal: (its first reading, its last — or None when there is only one) by measurement
    time, the audit id breaking a tie (D10)."""
    by_signal: dict[str, list[Reading]] = {}
    for reading in readings:
        by_signal.setdefault(reading.slug, []).append(reading)
    out = {}
    for slug, values in by_signal.items():
        ordered = sorted(values, key=lambda r: (r.at, r.entry))
        out[slug] = (ordered[0], ordered[-1] if len(ordered) > 1 else None)
    return out
```

- [ ] **Step 4: What every resource carries**

Create `homunculus-engine/src/homunculus/tres/mapping/__init__.py`:
```python
# homunculus-engine/src/homunculus/tres/mapping/__init__.py
"""The mappers of the national e-health feed (TRƏS-01, spec §5, §7): pure functions from a `Stay`
(tres/stay.py) to a resource or the reason it cannot be built. No I/O, no clock, no session."""
```

Create `homunculus-engine/src/homunculus/tres/mapping/common.py`:
```python
# homunculus-engine/src/homunculus/tres/mapping/common.py
"""What every resource of the feed carries (TRƏS-01, spec §4.4, §5, D22), and what a mapper answers.

* `meta.profile` — the platform's profile, `http://fhir.az/StructureDefinition/<name>`;
* the local-id extension (`client.LOCAL_ID_EXTENSION`, `valueString`), the platform's only search key;
* a reference is `Type/<the platform's id>` — never a local id, never a URL;
* a time is ISO 8601 in the TENANT's zone with its offset (`+04:00` for Asia/Baku), to the second,
  never UTC `Z` (D22); a mapper that needs a time and has no zone is skipped (`timezone_unknown`).

Systems under `http://fhir.az/` are the platform's own, as spec §5 names them (second-hand, §2)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, tzinfo

from homunculus.tres.client import LOCAL_ID_EXTENSION

AZ = "http://fhir.az/"
STRUCTURE = AZ + "StructureDefinition/"
CODE_SYSTEM = AZ + "CodeSystem/"
TIMEZONE_UNKNOWN = "timezone_unknown"
#: A stay whose last admission is DISCHARGED but holds no discharge time (the Encounter cannot say when it ended).
DISCHARGE_MISSING = "discharge_missing"
#: `instant` is given a time with no zone: refused, never read as the server's local time (D22). Constant,
#: and without the value, so the exception holds nothing of the record.
INSTANT_NAIVE = "a time sent to the platform needs a zone: refusing to read it as the server's local time"


@dataclass(frozen=True)
class Built:
    """A resource ready for the ledger: its ledger key (`resource_type`), its FHIR type, its local id."""
    resource_type: str
    fhir_type: str
    local_id: str
    resource: dict


@dataclass(frozen=True)
class Skip:
    """Why a resource was not built: a catalogue code (never text), under the local id its row keeps."""
    resource_type: str
    local_id: str
    reason: str


def base(fhir_type: str, profile: str, local_id: str) -> dict:
    return {"resourceType": fhir_type, "meta": {"profile": [STRUCTURE + profile]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}


def reference(fhir_type: str, remote_id: str) -> dict:
    return {"reference": f"{fhir_type}/{remote_id}"}


def instant(at: datetime, zone: tzinfo) -> str:
    """`at` in the tenant's zone with its offset, to the second (D22). A time with no zone (naive, or a
    tzinfo that gives no offset) is a ValueError: `astimezone` would read it as the SERVER's local
    time, and a wrong hour would go into the national record unseen."""
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError(INSTANT_NAIVE)
    return at.astimezone(zone).isoformat(timespec="seconds")


def number(value: float) -> int | float:
    """A whole value as a JSON integer (72, not 72.0) — one payload, one digest (D7)."""
    return int(value) if float(value).is_integer() else float(value)
```

- [ ] **Step 5: Patient and Practitioner**

Create `homunculus-engine/src/homunculus/tres/mapping/patient.py`:
```python
# homunculus-engine/src/homunculus/tres/mapping/patient.py
"""Patient · `az-patient` (TRƏS-01, spec §5, D5, D20).

The person, keyed by their FİN (ids.patient): one national Patient however many stays. Required
by the profile — FİN, family and given name, father's name, sex — or the stay's Patient is
skipped with the reason (D20), under the person's own id once a FİN can key it, else under the
stay's placeholder (ids.patient_placeholder).

NOT SENT in phase F1 (plan F1, amendments): the blood group — the codes of
`az:CodeSystem/blood-group` are in no source in hand (O23); the identifier type's display —
`identity-document-type` `15` goes without one, which no source in hand gives (O23); address,
marital status and citizenship are not recorded (O10)."""
from __future__ import annotations

import uuid

from homunculus.tres import az, ids
from homunculus.tres.mapping.common import AZ, CODE_SYSTEM, STRUCTURE, Built, Skip, base
from homunculus.tres.stay import Person

PROFILE = "az-patient"
FIN_SYSTEM = AZ + "sid/fin"
IDENTITY_DOCUMENT_TYPE = CODE_SYSTEM + "identity-document-type"
FIN_DOCUMENT = "15"
SEX = STRUCTURE + "sex"
FATHERS_NAME = STRUCTURE + "fathersName"


def fin_identifier(fin: str) -> dict:
    """The FİN as the platform identifies a person (Patient and Practitioner alike, spec §5)."""
    return {"type": {"coding": [{"system": IDENTITY_DOCUMENT_TYPE, "code": FIN_DOCUMENT}]},
            "system": FIN_SYSTEM, "value": fin}


def patient(person: Person, root_id: uuid.UUID) -> Built | Skip:
    fin, reason = az.normal_fin(person.fin)
    if fin is None:
        return Skip("patient", ids.patient_placeholder(root_id), reason)
    local_id = ids.patient(fin)
    name, reason = az.split_name(person.display_name)
    if name is None:
        return Skip("patient", local_id, reason)
    father = (person.father_name or "").strip()
    if not father:
        return Skip("patient", local_id, az.FATHER_NAME_MISSING)
    sex, reason = az.sex_code(person.sex)
    if sex is None:
        return Skip("patient", local_id, reason)
    born, reason = az.birth_date(person.date_of_birth)
    if born is None:
        return Skip("patient", local_id, reason)
    family, given = name
    resource = base("Patient", PROFILE, local_id)
    resource["extension"] += [{"url": SEX, "valueCode": sex}, {"url": FATHERS_NAME, "valueString": father}]
    resource.update({"identifier": [fin_identifier(fin)], "active": True,
                     "name": [{"family": family, "given": given}], "birthDate": born})
    phone = az.phone(person.phone)
    if phone is not None:
        resource["telecom"] = [{"system": "phone", "value": phone}]
    return Built("patient", "Patient", local_id, resource)
```

Create `homunculus-engine/src/homunculus/tres/mapping/practitioner.py`:
```python
# homunculus-engine/src/homunculus/tres/mapping/practitioner.py
"""Practitioner · `az-practitioner` (TRƏS-01, spec §5, D5, D16).

An attending of the stay, from the identity the tab holds for them (`tres_practitioner_identity`:
FİN, family name, given name). No row → `identity_missing`; no FİN or a malformed one →
`fin_missing` / `fin_format` (the patient's rule, az.normal_fin); a name part empty →
`name_missing`. `active` is true: the profile fixes it (spec §5)."""
from __future__ import annotations

from homunculus.tres import az, ids
from homunculus.tres.mapping.common import Built, Skip, base
from homunculus.tres.mapping.patient import fin_identifier
from homunculus.tres.stay import Clinician

PROFILE = "az-practitioner"
IDENTITY_MISSING = "identity_missing"
NAME_MISSING = "name_missing"


def practitioner(clinician: Clinician) -> Built | Skip:
    local_id = ids.practitioner(clinician.user_id)
    if not clinician.known:
        return Skip("practitioner", local_id, IDENTITY_MISSING)
    fin, reason = az.normal_fin(clinician.fin)
    if fin is None:
        return Skip("practitioner", local_id, reason)
    family, given = (clinician.family_name or "").strip(), (clinician.given_name or "").strip()
    if not family or not given:
        return Skip("practitioner", local_id, NAME_MISSING)
    resource = base("Practitioner", PROFILE, local_id)
    resource.update({"identifier": [fin_identifier(fin)], "active": True,
                     "name": [{"family": family, "given": given.split()}]})
    return Built("practitioner", "Practitioner", local_id, resource)
```

- [ ] **Step 6: Encounter and the vital signs**

Create `homunculus-engine/src/homunculus/tres/mapping/encounter.py`:
```python
# homunculus-engine/src/homunculus/tres/mapping/encounter.py
"""Encounter · `az-encounter` (TRƏS-01, spec §5, D5, D8, D17, D22).

One stay, keyed by its chain's ROOT admission (ids.encounter): one Encounter across beds.

* `status` `finished` once the chain's last admission is DISCHARGED, else `in-progress` (a stay
  sent by hand while admitted, D9); a finished stay with no discharge time is skipped
  `discharge_missing` — never a `finished` Encounter with no `period.end`;
* `class` v3-ActCode `IMP` (codes.INPATIENT, checked); `type` `az:CodeSystem/encounter-type` `1`,
  without a display — none is in any source in hand (plan F1, O23);
* `subject` the Patient's platform id; `period` from the root's admission to the last's
  discharge, in the tenant's zone (D22);
* `serviceType` the tab's `hospital-departments` mapping of the LAST admission's unit (D17) — none
  → `unit_unmapped`, never a silent «999 Digər»;
* `serviceProvider` `Organization/<organization id>` of the selected environment's account — none
  → `organization_missing`;
* `participant[].individual` each attending the platform holds a Practitioner of (D8: one that
  could not be sent is left out). `diagnosis[]` comes with F2."""
from __future__ import annotations

from homunculus.tres import ids
from homunculus.tres.codes import INPATIENT
from homunculus.tres.mapping.common import (
    CODE_SYSTEM, DISCHARGE_MISSING, TIMEZONE_UNKNOWN, Built, Skip, base, instant, reference,
)
from homunculus.tres.stay import Stay

PROFILE = "az-encounter"
ENCOUNTER_TYPE = CODE_SYSTEM + "encounter-type"
INPATIENT_STAY = "1"
DEPARTMENTS = CODE_SYSTEM + "hospital-departments"
UNIT_UNMAPPED = "unit_unmapped"
ORGANIZATION_MISSING = "organization_missing"


def encounter(stay: Stay, *, patient_id: str, practitioner_ids: list[str],
              organization_id: str | None) -> Built | Skip:
    local_id = ids.encounter(stay.root_id)
    if stay.zone is None:
        return Skip("encounter", local_id, TIMEZONE_UNKNOWN)
    if stay.finished and stay.discharged_at is None:
        return Skip("encounter", local_id, DISCHARGE_MISSING)
    if stay.department is None:
        return Skip("encounter", local_id, UNIT_UNMAPPED)
    organization = (organization_id or "").strip()
    if not organization:
        return Skip("encounter", local_id, ORGANIZATION_MISSING)
    period = {"start": instant(stay.admitted_at, stay.zone)}
    if stay.finished:
        period["end"] = instant(stay.discharged_at, stay.zone)
    resource = base("Encounter", PROFILE, local_id)
    resource.update({
        "status": "finished" if stay.finished else "in-progress",
        "class": INPATIENT.coding(),
        "type": [{"coding": [{"system": ENCOUNTER_TYPE, "code": INPATIENT_STAY}]}],
        "subject": reference("Patient", patient_id),
        "period": period,
        "serviceType": {"coding": [{"system": DEPARTMENTS, "code": stay.department.code,
                                    "display": stay.department.display}]},
        "serviceProvider": reference("Organization", organization),
    })
    if practitioner_ids:
        resource["participant"] = [{"individual": reference("Practitioner", remote)}
                                   for remote in practitioner_ids]
    return Built("encounter", "Encounter", local_id, resource)
```

Create `homunculus-engine/src/homunculus/tres/mapping/vitals.py`:
```python
# homunculus-engine/src/homunculus/tres/mapping/vitals.py
"""Observation · `az-observation`, vital signs (TRƏS-01, spec §5, D5, D10, D12).

Per signal of the stay, its FIRST and its LAST hand-charted value (stay.first_and_last) — one value
only → only `first` — then the admission's weight and height, each once, at the admission (a value
that is not a positive, finite number is not sent). Monitor
samples are never sent (D10). Every code, display and unit is codes.py's, checked (D12); the
systolic pressure goes alone under its own code, not as a panel: the diastolic is not charted.

`status` `final`; `category` vital-signs; `code` the LOINC coding and, as its text, the LOINC
display (plan F1: no reviewed local label exists); `subject` and `encounter` the platform's ids;
`effectiveDateTime` in the tenant's zone (D22); `valueQuantity` the value, its UCUM code as both
`code` and `unit`."""
from __future__ import annotations

import math
from datetime import datetime

from homunculus.tres import ids
from homunculus.tres.codes import HEIGHT, SIGNALS, UCUM, VITAL_SIGNS, WEIGHT, Signal
from homunculus.tres.mapping.common import Built, base, instant, number, reference
from homunculus.tres.stay import Stay, first_and_last

PROFILE = "az-observation"


def _observation(stay: Stay, signal: Signal, which: str, value: float, at: datetime, *,
                 patient_id: str, encounter_id: str) -> Built:
    local_id = ids.vital(stay.root_id, signal.id_key, which)
    resource = base("Observation", PROFILE, local_id)
    resource.update({
        "status": "final",
        "category": [{"coding": [VITAL_SIGNS.coding()]}],
        "code": {"coding": [signal.loinc.coding()], "text": signal.loinc.display},
        "subject": reference("Patient", patient_id),
        "encounter": reference("Encounter", encounter_id),
        "effectiveDateTime": instant(at, stay.zone),
        "valueQuantity": {"value": number(value), "unit": signal.ucum, "system": UCUM, "code": signal.ucum},
    })
    return Built("vital", "Observation", local_id, resource)


def vitals(stay: Stay, *, patient_id: str, encounter_id: str) -> list[Built]:
    """The stay's vital-sign Observations in the order they are sent. None without a zone (the
    Encounter, which needs one too, was skipped before these)."""
    if stay.zone is None:
        return []
    out: list[Built] = []
    chosen = first_and_last(stay.readings)
    for slug, signal in SIGNALS.items():
        if slug not in chosen:
            continue
        first, last = chosen[slug]
        out.append(_observation(stay, signal, ids.FIRST, first.value, first.at,
                                patient_id=patient_id, encounter_id=encounter_id))
        if last is not None:
            out.append(_observation(stay, signal, ids.LAST, last.value, last.at,
                                    patient_id=patient_id, encounter_id=encounter_id))
    for signal, value in ((WEIGHT, stay.weight_kg), (HEIGHT, stay.height_cm)):
        if value is not None and math.isfinite(value) and value > 0:
            out.append(_observation(stay, signal, ids.FIRST, value, stay.admitted_at,
                                    patient_id=patient_id, encounter_id=encounter_id))
    return out
```

- [ ] **Step 7: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_mapping.py tests/test_tres_codes.py tests/test_tres_az.py 2>&1 | tail -3`
Expected: `97 passed`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/stay.py homunculus-engine/src/homunculus/tres/mapping/__init__.py homunculus-engine/src/homunculus/tres/mapping/common.py homunculus-engine/src/homunculus/tres/mapping/patient.py homunculus-engine/src/homunculus/tres/mapping/practitioner.py homunculus-engine/src/homunculus/tres/mapping/encounter.py homunculus-engine/src/homunculus/tres/mapping/vitals.py homunculus-engine/tests/test_tres_mapping.py && git commit -m "feat(tres-01): F1 — the stay as plain values and the four mappers (Patient, Practitioner, Encounter, vital signs; spec §5) as pure functions, golden-tested" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The stand-in checks each profile — `tests/fake_tres.py` (N6)

The stand-in reads `meta.profile[0]` and holds the elements F1's four profiles require (spec §5, D16, D17, D20, FHIR R4) and the values they restrict. F0's tests of §4 send minimal bodies; they now name `UNCHECKED_PROFILE`, a profile with no rules, so they keep testing §4 alone.

**Files:**
- Modify: `homunculus-engine/tests/fake_tres.py` (the docstring's last paragraph; `REQUIRED`; `_refusal`)
- Modify: `homunculus-engine/tests/test_fake_tres.py`, `homunculus-engine/tests/test_tres_client.py`, `homunculus-engine/tests/test_tres_ledger.py`, `homunculus-engine/tests/test_tres_worker.py` (their bodies' profile)
- Test: `homunculus-engine/tests/test_fake_tres.py` (four new tests at the end)

- [ ] **Step 1: The tests — F0's bodies under the unchecked profile, and F1's profiles held**

In `homunculus-engine/tests/test_fake_tres.py` replace
```python
from tests.fake_tres import (
    BASE_URL, ID_MISMATCH, LOCAL_ID_CHANGED, MALFORMED_REFERENCE, NO_ID, NO_REFERENCE, REFERRED, FakeTres,
    local_id_of, references_of,
)

PROFILE = "http://fhir.az/StructureDefinition/"


def resource(resource_type: str, local_id: str, **elements) -> dict:
    return {"resourceType": resource_type, "meta": {"profile": [PROFILE + "az-" + resource_type.lower()]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}], **elements}
```
with
```python
from tests.fake_tres import (
    BASE_URL, ID_MISMATCH, LOCAL_ID_CHANGED, MALFORMED_REFERENCE, NO_ID, NO_REFERENCE, REFERRED, UNCHECKED_PROFILE,
    FakeTres, local_id_of, references_of,
)

def resource(resource_type: str, local_id: str, **elements) -> dict:
    return {"resourceType": resource_type, "meta": {"profile": [UNCHECKED_PROFILE]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}], **elements}
```

Append at the end of `homunculus-engine/tests/test_fake_tres.py`:
```python
# ---------------------------------------------------------------- the profiles of phase F1 (plan F1, N6)
def _f1_resources():
    """Phase F1's four resources as its mappers build them (tests/test_tres_mapping.py's stay)."""
    from homunculus.tres.mapping.encounter import encounter
    from homunculus.tres.mapping.patient import patient as map_patient
    from homunculus.tres.mapping.practitioner import practitioner
    from homunculus.tres.mapping.vitals import vitals
    from tests.test_tres_mapping import PERSON, ROOT, stay
    built = stay()
    return (map_patient(PERSON, ROOT), practitioner(built.clinicians[0]),
            encounter(built, patient_id="7001", practitioner_ids=["7002"], organization_id="ORG-0001"),
            vitals(built, patient_id="7001", encounter_id="7003")[0])


def _without(resource: dict, path: str) -> dict:
    """A deep copy of `resource` with every value at `path` (REQUIRED's syntax) emptied."""
    import copy
    from tests.fake_tres import steps
    copied = copy.deepcopy(resource)
    *walk, (last, _) = steps(path)
    nodes = [copied]
    for name, selector in walk:
        nodes = [x for node in nodes if isinstance(node, dict)
                 for x in (node.get(name) if isinstance(node.get(name), list) else [node.get(name)])]
        if selector is not None:
            nodes = [x for x in nodes if isinstance(x, dict) and selector in (x.get("url"), x.get("system"))]
    for node in nodes:
        if isinstance(node, dict):
            node.pop(last, None)
    return copied


async def test_phase_f1s_resources_are_taken_and_each_required_element_is_held(platform):
    from tests.fake_tres import REQUIRED
    fake, client = platform
    fake.seed("Patient", "7001")
    fake.seed("Practitioner", "7002")
    fake.seed("Encounter", "7003")
    fake.seed("Organization", "ORG-0001")
    resources = _f1_resources()
    assert {r.resource["meta"]["profile"][0] for r in resources} == set(REQUIRED)       # one test per profile
    for built in resources:
        await client.validate(built.fhir_type, {**built.resource, "id": built.local_id})
        for path in REQUIRED[built.resource["meta"]["profile"][0]]:
            with pytest.raises(TresError) as raised:
                await client.validate(built.fhir_type, {**_without(built.resource, path), "id": built.local_id})
            assert (raised.value.status, raised.value.message) == (
                400, f"{built.fhir_type}.{path}: minimum required = 1"), path


async def test_a_sex_code_the_platform_has_not_and_an_inactive_practitioner_are_refused(platform):
    from tests.fake_tres import ALLOWED
    _, client = platform
    patient_, practitioner_, _, _ = _f1_resources()
    other_sex = {**patient_.resource, "extension": [
        {**ext, "valueCode": "M"} if ext.get("valueCode") else ext for ext in patient_.resource["extension"]]}
    inactive = {**practitioner_.resource, "active": False}
    for built, body in ((patient_, other_sex), (practitioner_, inactive)):
        (path,) = ALLOWED[built.resource["meta"]["profile"][0]]
        with pytest.raises(TresError) as raised:
            await client.create(built.fhir_type, {**body, "id": built.local_id})
        assert (raised.value.status, raised.value.message) == (400, f"{built.fhir_type}.{path}: value not allowed")


def test_values_at_walks_lists_and_selects_by_url_or_system():
    from tests.fake_tres import values_at
    body = {"identifier": [{"system": "x", "value": "1"}, {"system": "http://fhir.az/sid/fin", "value": "AB12C3D"}],
            "name": [{"family": "S", "given": ["A", "B"]}], "extension": [{"url": "u", "valueCode": ""}]}
    assert values_at(body, "identifier(http://fhir.az/sid/fin).value") == ["AB12C3D"]
    assert values_at(body, "name.given") == ["A", "B"]
    assert values_at(body, "extension(u).valueCode") == [] and values_at(body, "missing.path") == []


async def test_a_profile_the_table_does_not_name_is_held_to_section_4_alone(platform):
    _, client = platform
    assert await client.create("Patient", {**patient(), "id": "hmn-p-0001"}) == "7001"   # UNCHECKED_PROFILE
```

In `homunculus-engine/tests/test_tres_client.py` replace
```python
from homunculus.tres.ledger import _write
from tests.fake_tres import FakeTres

ACCOUNT = TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
PATIENT = {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
           "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": "hmn-p-0001"}],
```
with
```python
from homunculus.tres.ledger import _write
from tests.fake_tres import UNCHECKED_PROFILE, FakeTres

ACCOUNT = TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
PATIENT = {"resourceType": "Patient", "meta": {"profile": [UNCHECKED_PROFILE]},
           "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": "hmn-p-0001"}],
```

In `homunculus-engine/tests/test_tres_ledger.py` replace
```python
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
```
with
```python
from tests.conftest import requires_db
from tests.fake_tres import UNCHECKED_PROFILE, FakeTres
```

In `homunculus-engine/tests/test_tres_ledger.py` replace
```python
def patient(given: str = "Ayşe", local_id: str = LOCAL) -> dict:
    return {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
```
with
```python
def patient(given: str = "Ayşe", local_id: str = LOCAL) -> dict:
    return {"resourceType": "Patient", "meta": {"profile": [UNCHECKED_PROFILE]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
```

In `homunculus-engine/tests/test_tres_worker.py` replace
```python
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
```
with
```python
from tests.conftest import requires_db
from tests.fake_tres import UNCHECKED_PROFILE, FakeTres
```

In `homunculus-engine/tests/test_tres_worker.py` replace
```python
def patient(local_id: str, given: str = "Ayşe") -> dict:
    return {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
```
with
```python
def patient(local_id: str, given: str = "Ayşe") -> dict:
    return {"resourceType": "Patient", "meta": {"profile": [UNCHECKED_PROFILE]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
```

In `homunculus-engine/tests/test_tres_worker.py` replace
```python
def practitioner(local_id: str) -> dict:
    return {"resourceType": "Practitioner", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-practitioner"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}
```
with
```python
def practitioner(local_id: str) -> dict:
    return {"resourceType": "Practitioner", "meta": {"profile": [UNCHECKED_PROFILE]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_fake_tres.py tests/test_tres_client.py tests/test_tres_ledger.py tests/test_tres_worker.py 2>&1 | tail -3`
Expected: four errors at collection — `ImportError: cannot import name 'UNCHECKED_PROFILE' from 'tests.fake_tres'` — `4 errors`.

- [ ] **Step 3: The profiles' rules**

In `homunculus-engine/tests/fake_tres.py` replace
```python

NOT here yet: the per-profile required elements of spec §5 (a Patient's FİN, an Encounter's
`serviceType`…). Each later phase adds its profile's rules to `REQUIRED` with its mapper.
Synthetic account, synthetic resources only."""
```
with
```python

* PER PROFILE (`meta.profile[0]`; plan F1, N6): the elements spec §5 and FHIR R4 itself require
  (`REQUIRED`, «<Type>.<path>: minimum required = 1», 400), and the values a profile fixes or
  restricts (`ALLOWED`, «<Type>.<path>: value not allowed», 400). Keyed by the profile, not by the
  FHIR type: a vital sign and a laboratory result are both Observations, under two profiles. A
  profile the table does not name is held to spec §4 alone — `UNCHECKED_PROFILE` is the one the
  tests of §4 send. Phase F1 fills in its four profiles; each later phase adds its own with its
  mapper.

Synthetic account, synthetic resources only."""
```

In `homunculus-engine/tests/fake_tres.py` replace
```python

#: Per FHIR type, the elements its profile requires (spec §5) — filled in by F1–F5.
REQUIRED: dict[str, tuple[str, ...]] = {}
```
with
```python

STRUCTURE = "http://fhir.az/StructureDefinition/"
#: A profile the stand-in holds no rules for: what the tests of spec §4 alone send.
UNCHECKED_PROFILE = BASE_URL + "/StructureDefinition/unchecked"
_SEX = STRUCTURE + "sex"
_FATHERS_NAME = STRUCTURE + "fathersName"
_FIN = "http://fhir.az/sid/fin"

#: Per profile, the elements it requires, each a dotted path; a list on the way may hold the next
#: step in any of its items, and `name(x)` keeps the items whose `url` or `system` is x. From spec
#: §5 and D16, D17, D20 (second-hand, §2) and from FHIR R4 (4.0.1) itself: Observation.status and
#: .code, Encounter.status and .class are 1..1 there (hl7.org/fhir/R4, read 2026-11-12).
REQUIRED: dict[str, tuple[str, ...]] = {
    STRUCTURE + "az-patient": (f"identifier({_FIN}).value", "name.family", "name.given",   # D20
                               f"extension({_SEX}).valueCode", f"extension({_FATHERS_NAME}).valueString"),
    STRUCTURE + "az-practitioner": (f"identifier({_FIN}).value", "active"),                 # D16; §5
    STRUCTURE + "az-encounter": ("status", "class", "serviceType"),                         # R4; D17
    STRUCTURE + "az-observation": ("status", "code"),                                       # R4
}
#: Per profile, the values an element may take (D20: the platform refuses any other sex code; §5:
#: the profile fixes a practitioner's `active`).
ALLOWED: dict[str, dict[str, frozenset]] = {
    STRUCTURE + "az-patient": {f"extension({_SEX}).valueCode": frozenset({"K", "Q"})},
    STRUCTURE + "az-practitioner": {"active": frozenset({True})},
}
_STEP = re.compile(r"([A-Za-z]+)(?:\(([^)]*)\))?")


def steps(path: str) -> list[tuple[str, str | None]]:
    """A REQUIRED path's steps, each (name, selector or None); a selector may hold dots (a URL)."""
    return [(match.group(1), match.group(2)) for match in _STEP.finditer(path)]


def values_at(node, path: str) -> list:
    """Every value at `path` in `node` (REQUIRED's syntax), lists walked through."""
    found = [node]
    for name, selector in steps(path):
        found = [item.get(name) for item in found if isinstance(item, dict)]
        found = [x for value in found for x in (value if isinstance(value, list) else [value])]
        if selector is not None:
            found = [x for x in found if isinstance(x, dict) and selector in (x.get("url"), x.get("system"))]
    return [value for value in found if value not in (None, "", [], {})]
```

In `homunculus-engine/tests/fake_tres.py` replace
```python
            return _outcome(400, "The local-system-unique-id extension is required")
        for element in REQUIRED.get(resource_type, ()):
            if body.get(element) in (None, "", [], {}):
                return _outcome(400, f"{resource_type}.{element}: minimum required = 1")
        if any(not isinstance(value, str) or not _REFERENCE.match(value) for value in reference_values(body)):
```
with
```python
            return _outcome(400, "The local-system-unique-id extension is required")
        for path in REQUIRED.get(profiles[0], ()):
            if not values_at(body, path):
                return _outcome(400, f"{resource_type}.{path}: minimum required = 1")
        for path, allowed in ALLOWED.get(profiles[0], {}).items():
            if any(value not in allowed for value in values_at(body, path)):
                return _outcome(400, f"{resource_type}.{path}: value not allowed")
        if any(not isinstance(value, str) or not _REFERENCE.match(value) for value in reference_values(body)):
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_fake_tres.py tests/test_tres_client.py tests/test_tres_ledger.py tests/test_tres_worker.py 2>&1 | tail -3`
Expected: `119 passed, 65 skipped` (with `TEST_DATABASE_URL`, the ledger and worker files' DB tests run too: Task 13).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/tests/fake_tres.py homunculus-engine/tests/test_fake_tres.py homunculus-engine/tests/test_tres_client.py homunculus-engine/tests/test_tres_ledger.py homunculus-engine/tests/test_tres_worker.py && git commit -m "test(tres-01): F1 — the stand-in holds each profile's required elements and fixed values (N6); the tests of §4 send an unchecked profile" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Two tables and two settings columns — `models.py`, migration 0020 in place (D16, D17, O15, O21)

`tres_department_map` (one row per unit) and `tres_practitioner_identity` (one per tenant and user, the FİN encrypted) join the slice's one migration (D26, O19); `tres_settings` gains `send_from` (O15, proposed) and `retried_at` (the nightly retry's mark).

**Files:**
- Modify: `homunculus-engine/src/homunculus/tres/models.py`
- Modify: `homunculus-engine/alembic/versions/0020_tres.py`
- Test: `homunculus-engine/tests/test_migration_0020_tres.py`, `homunculus-engine/tests/test_tres_models.py`

- [ ] **Step 1: The tests**

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python
tables. The migration's two constants are the models' (no database for that one). Synthetic rows
only. F1–F5 extend this file with their tables (D26)."""
from __future__ import annotations
```
with
```python
tables. The migration's two constants are the models' (no database for that one). Synthetic rows
only. F1–F5 extend this file with their tables (D26): F1 adds `tres_department_map` and
`tres_practitioner_identity` (each gone with its unit or user and with its tenant; the FİN is
ciphertext at rest) and the settings' `send_from` and `retried_at`."""
from __future__ import annotations
```

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python
SETTINGS, DELIVERIES = "tres_settings", "tres_deliveries"
KEY, INDEX = "uq_tres_deliveries_key", "ix_tres_deliveries_tenant_status"
```
with
```python
SETTINGS, DELIVERIES = "tres_settings", "tres_deliveries"
DEPARTMENTS, IDENTITIES = "tres_department_map", "tres_practitioner_identity"     # F1 (D16, D17)
DEPARTMENTS_INDEX = "ix_tres_department_map_tenant_id"
TABLES = {SETTINGS, DELIVERIES, DEPARTMENTS, IDENTITIES}
KEY, INDEX = "uq_tres_deliveries_key", "ix_tres_deliveries_tenant_status"
```

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python

def _delivery(conn, tenant: uuid.UUID, **columns) -> uuid.UUID:
```
with
```python

def _unit_of(conn, admission: uuid.UUID) -> uuid.UUID:
    return conn.execute(text("SELECT admitting_unit_id FROM admissions WHERE id = :id"),
                        {"id": admission}).scalar_one()


def _user(conn) -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(text("INSERT INTO users (id, username, full_name, is_active, created_at, updated_at) "
                      "VALUES (:id, :u, 'Sentetik Hekim', true, now(), now())"),
                 {"id": uid, "u": f"hekim-{uid.hex[:8]}@sentetik.example.com"})
    return uid


def _delivery(conn, tenant: uuid.UUID, **columns) -> uuid.UUID:
```

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python
    command.upgrade(cfg, "0020")
    assert set(inspect(engine).get_table_names()) - before == {SETTINGS, DELIVERIES}
    with engine.connect() as conn:
```
with
```python
    command.upgrade(cfg, "0020")
    assert set(inspect(engine).get_table_names()) - before == TABLES
    with engine.connect() as conn:
```

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python
            f"SELECT mode, environment, settle_hours, enabled_types, test_password, live_base_url, "
            f"updated_at IS NOT NULL, updated_by, session_refused_at FROM {SETTINGS}")).one()
    assert tuple(row) == ("off", "test", 24, list(RESOURCE_TYPES), None, None, True, None, None)
    for bad in ("mode = 'on'", "environment = 'prod'", "settle_hours = -1", "settle_hours = 169"):
```
with
```python
            f"SELECT mode, environment, settle_hours, enabled_types, test_password, live_base_url, "
            f"updated_at IS NOT NULL, updated_by, session_refused_at, send_from, retried_at FROM {SETTINGS}")).one()
    assert tuple(row) == ("off", "test", 24, list(RESOURCE_TYPES), None, None, True, None, None, None, None)
    for bad in ("mode = 'on'", "environment = 'prod'", "settle_hours = -1", "settle_hours = 169"):
```

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python
        if type_ == "table":
            return name in {SETTINGS, DELIVERIES}
        if type_ == "column":
            return (object_.table.name if object_ is not None else None) in {SETTINGS, DELIVERIES}
        if type_ in ("index", "unique_constraint"):
            return name in {INDEX, KEY, ADMISSION_INDEX}
        return False
```
with
```python
        if type_ == "table":
            return name in TABLES
        if type_ == "column":
            return (object_.table.name if object_ is not None else None) in TABLES
        if type_ in ("index", "unique_constraint"):
            return name in {INDEX, KEY, ADMISSION_INDEX, DEPARTMENTS_INDEX}
        return False
```

In `homunculus-engine/tests/test_migration_0020_tres.py` replace
```python
    assert {INDEX, KEY, ADMISSION_INDEX} <= indexes
```
with
```python
    assert {INDEX, KEY, ADMISSION_INDEX} <= indexes
    with engine.connect() as conn:
        assert DEPARTMENTS_INDEX in set(conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename = :t"), {"t": DEPARTMENTS}).scalars())


@requires_db
def test_the_two_maps_go_with_their_unit_user_and_tenant_and_the_fin_is_ciphertext(clean_db):
    """F1 (D16, D17): one department row per unit, one identity per (tenant, user)."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit = _unit_of(conn, _admission(conn, tenant))
        doctor = _user(conn)
        conn.execute(text(f"INSERT INTO {DEPARTMENTS} (unit_id, tenant_id, code, display) "
                          "VALUES (:u, :t, 'RE-01', 'Reanimasiya')"), {"u": unit, "t": tenant})
        conn.execute(text(f"INSERT INTO {IDENTITIES} (tenant_id, user_id, fin, family_name, given_name) "
                          "VALUES (:t, :u, 'enc::v1::sentetik', 'Sentetikov', 'Elçin')"), {"t": tenant, "u": doctor})
        row = conn.execute(text(f"SELECT updated_at IS NOT NULL, updated_by FROM {DEPARTMENTS}")).one()
        assert tuple(row) == (True, None)
    with pytest.raises(IntegrityError), engine.begin() as conn:            # one row per unit
        conn.execute(text(f"INSERT INTO {DEPARTMENTS} (unit_id, tenant_id, code, display) "
                          "VALUES (:u, :t, 'X', 'Y')"), {"u": unit, "t": tenant})
    with pytest.raises(IntegrityError), engine.begin() as conn:            # one identity per (tenant, user)
        conn.execute(text(f"INSERT INTO {IDENTITIES} (tenant_id, user_id, family_name, given_name) "
                          "VALUES (:t, :u, 'A', 'B')"), {"t": tenant, "u": doctor})
    with pytest.raises(IntegrityError), engine.begin() as conn:            # the names are required
        conn.execute(text(f"INSERT INTO {IDENTITIES} (tenant_id, user_id, family_name) VALUES (:t, :u, 'A')"),
                     {"t": tenant, "u": _user(conn)})
    with engine.begin() as conn:
        width = conn.execute(text("SELECT character_maximum_length FROM information_schema.columns "
                                  "WHERE table_name = :t AND column_name = 'fin'"), {"t": IDENTITIES}).scalar_one()
        assert width == PHI_COLUMN_LENGTH
        conn.execute(text("DELETE FROM users WHERE id = :u"), {"u": doctor})
        assert conn.execute(text(f"SELECT count(*) FROM {IDENTITIES}")).scalar_one() == 0
        conn.execute(text("DELETE FROM admissions WHERE tenant_id = :t"), {"t": tenant})
        conn.execute(text("DELETE FROM beds"))
        conn.execute(text("DELETE FROM rooms"))
        conn.execute(text("DELETE FROM units WHERE id = :u"), {"u": unit})
        assert conn.execute(text(f"SELECT count(*) FROM {DEPARTMENTS}")).scalar_one() == 0
```

In `homunculus-engine/tests/test_tres_models.py` replace
```python
# homunculus-engine/tests/test_tres_models.py
"""TRƏS-01 (spec D3, D6): the two tables as the models map them — the defaults (mode `off`,
environment `test`, every type on, 24 hours), the CHECKs, the ledger's key with the environment in
it, the password and the platform's message encrypted at rest, both gone with their tenant — and
`account_of`, which needs no database. The DB part runs on Postgres. Synthetic tenant only."""
from __future__ import annotations
```
with
```python
# homunculus-engine/tests/test_tres_models.py
"""TRƏS-01 (spec D3, D6, D16, D17): the tables as the models map them — the defaults (mode `off`,
environment `test`, every type on, 24 hours), the CHECKs, the ledger's key with the environment in
it, the password and the platform's message encrypted at rest, both gone with their tenant — and
`account_of`, which needs no database; and (F1) the department map and the practitioner identities,
the FİN ciphertext at rest. The DB part runs on Postgres. Synthetic tenant only."""
from __future__ import annotations
```

In `homunculus-engine/tests/test_tres_models.py` replace
```python
    ACCOUNT_FIELDS, ENVIRONMENTS, MODES, OPERATIONS, RESOURCE_TYPES, SESSION_FIELDS, STATUSES,
    TresDelivery, TresSettings, account_of,
)
```
with
```python
    ACCOUNT_FIELDS, ENVIRONMENTS, MODES, OPERATIONS, RESOURCE_TYPES, SESSION_FIELDS, STATUSES,
    TresDelivery, TresDepartmentMap, TresPractitionerIdentity, TresSettings, account_of,
)
```

Append at the end of `homunculus-engine/tests/test_tres_models.py`:
```python
@requires_db
async def test_the_department_map_and_the_identities_and_the_fin_at_rest(db_session):
    """F1 (D16, D17): a unit's department, a practitioner's identity — the FİN ciphertext at rest
    and plain to the model; `send_from` and `retried_at` start empty."""
    from homunculus.auth.models import User
    from homunculus.tenant.models import Site, Unit, UnitType
    tenant = await _tenant(db_session)
    tenant_id = tenant.id
    site = Site(tenant_id=tenant_id, name="Ana bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    doctor = User(username="hekim@sentetik.example.com", full_name="Sentetik Hekim", is_active=True)
    db_session.add_all([unit, doctor, TresSettings(tenant_id=tenant.id)])
    await db_session.flush()
    db_session.add_all([TresDepartmentMap(unit_id=unit.id, tenant_id=tenant.id, code="RE-01", display="Reanimasiya"),
                        TresPractitionerIdentity(tenant_id=tenant.id, user_id=doctor.id, fin="ZZ99YY8",
                                                 family_name="Sentetikov", given_name="Elçin")])
    await db_session.commit()
    stored = (await db_session.execute(text("SELECT fin FROM tres_practitioner_identity"))).scalar_one()
    assert stored.startswith("enc::v1::") and "ZZ99YY8" not in stored
    db_session.expire_all()
    identity = (await db_session.execute(select(TresPractitionerIdentity))).scalar_one()
    assert (identity.fin, identity.family_name, identity.updated_at is not None) == ("ZZ99YY8", "Sentetikov", True)
    department = (await db_session.execute(select(TresDepartmentMap))).scalar_one()
    assert (department.code, department.display, department.tenant_id) == ("RE-01", "Reanimasiya", tenant_id)
    settings = (await db_session.execute(select(TresSettings))).scalar_one()
    assert (settings.send_from, settings.retried_at) == (None, None)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_migration_0020_tres.py tests/test_tres_models.py 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'TresDepartmentMap' from 'homunculus.tres.models'` — `1 error` (collection stops there: nothing runs).

- [ ] **Step 3: The models**

In `homunculus-engine/src/homunculus/tres/models.py` replace
```python
# homunculus-engine/src/homunculus/tres/models.py
"""`tres_settings` and `tres_deliveries` (migration 0020; TRƏS-01 spec D3, D6).
```
with
```python
# homunculus-engine/src/homunculus/tres/models.py
"""`tres_settings`, `tres_deliveries`, `tres_department_map` and `tres_practitioner_identity`
(migration 0020; TRƏS-01 spec D3, D6, D16, D17).
```

In `homunculus-engine/src/homunculus/tres/models.py` replace
```python
                 connection test. Not a setting: writing it never touches `updated_at`.
```
with
```python
                 connection test. Not a setting: writing it never touches `updated_at`.
* `send_from`    the cut-off of the automatic rounds (open item O15, plan F1 — PROPOSED, AWAITING THE
                 OWNER'S WORD): only a stay discharged at or after it is sent without a hand.
                 Set to the moment of the save that first chooses `send`; the tab can move it.
                 None until then (no cut-off: a `validate` round reaches back as far as its window).
* `retried_at`   when the nightly retry of `stuck` rows last ran for this tenant (D21, O21): it runs
                 at the first round after 04:00 in the tenant's zone. Not a setting either: written
                 by its own statement, never touching `updated_at`.
```

In `homunculus-engine/src/homunculus/tres/models.py` replace
```python
`resource_type` is the LEDGER's key (`vital`, `lab`, `patient`…), not the FHIR type: two of them
are both `Observation` on the platform."""
from __future__ import annotations
```
with
```python
`resource_type` is the LEDGER's key (`vital`, `lab`, `patient`…), not the FHIR type: two of them
are both `Observation` on the platform. `admission_id` is the stay's LAST admission (its chain's
newest row: where its protocol number is held, plan F1).

`tres_department_map` — the tab's map of a unit to a `hospital-departments` code and display
(D17): an Encounter's `serviceType`. One row per unit; a unit with no row is unmapped, and its
stays' Encounters are skipped (`unit_unmapped`), never sent under a default department.

`tres_practitioner_identity` — what the platform needs of a practitioner and `users` does not hold
(D16): the FİN (encrypted at rest, as a patient's; write-only at the door), the family and the
given name. One row per user and tenant. `users` is not touched."""
from __future__ import annotations
```

In `homunculus-engine/src/homunculus/tres/models.py` replace
```python
    session_refused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```
with
```python
    session_refused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    send_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

In `homunculus-engine/src/homunculus/tres/models.py` replace
```python

def account_of(settings: TresSettings, environment: str | None = None) -> TresAccount | None:
```
with
```python

class TresDepartmentMap(Base):
    __tablename__ = "tres_department_map"
    __table_args__ = (Index("ix_tres_department_map_tenant_id", "tenant_id"),)

    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    display: Mapped[str] = mapped_column(String(200), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class TresPractitionerIdentity(Base):
    __tablename__ = "tres_practitioner_identity"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    fin: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    family_name: Mapped[str] = mapped_column(String(100), nullable=False)
    given_name: Mapped[str] = mapped_column(String(100), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


def account_of(settings: TresSettings, environment: str | None = None) -> TresAccount | None:
```

- [ ] **Step 4: The migration**

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
# homunculus-engine/alembic/versions/0020_tres.py
"""TRƏS-01 (spec 2026-11-11, D3, D6, D26): `tres_settings` and `tres_deliveries`
```
with
```python
# homunculus-engine/alembic/versions/0020_tres.py
"""TRƏS-01 (spec 2026-11-11, D3, D6, D16, D17, D26): the feed's settings, ledger and two maps
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
procedures, F4 the laboratory code map, F5 the discharge summaries) and extends the downgrade and
the test with them. Phase F0 creates the two tables it has models for:
```
with
```python
procedures, F4 the laboratory code map, F5 the discharge summaries) and extends the downgrade and
the test with them. Phases F0 and F1 create the four tables they have models for:
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
  `session_refused_at` (null; when the platform last refused the tenant's login — the rounds pass
  it over while set). The two password columns hold Fernet ciphertext (`EncryptedString`). NO ROW
  is written: a tenant with no row reads as the defaults, and the feed is off.
* `tres_deliveries`: the ledger, one row per (tenant, environment, resource type, local id) —
```
with
```python
  `session_refused_at` (null; when the platform last refused the tenant's login — the rounds pass
  it over while set), `send_from` (null; F1, open item O15: the automatic rounds' cut-off) and
  `retried_at` (null; F1: when the nightly retry of `stuck` rows last ran). The two password
  columns hold Fernet ciphertext (`EncryptedString`). NO ROW is written: a tenant with no row reads
  as the defaults, and the feed is off.
* `tres_deliveries`: the ledger, one row per (tenant, environment, resource type, local id) —
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
  it, and an admission's delete must not scan the ledger). No request or response body.
```
with
```python
  it, and an admission's delete must not scan the ledger). No request or response body.
* `tres_department_map` (F1, D17): one row per unit (PK, FK units ON DELETE CASCADE) — its tenant
  (FK tenants ON DELETE CASCADE, indexed), the `hospital-departments` code and display, who and
  when.
* `tres_practitioner_identity` (F1, D16): one row per (tenant, user) (FK tenants and users, both ON
  DELETE CASCADE) — the FİN (Fernet ciphertext, nullable), the family and the given name, who and
  when.
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
tables); only its start command's `alembic upgrade head` refuses the unknown revision. Downgrade
drops exactly these two tables — and with them every tenant's account and the whole ledger.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013) — this revision needs none.
```
with
```python
tables); only its start command's `alembic upgrade head` refuses the unknown revision. Downgrade
drops exactly these four tables — and with them every tenant's account, the whole ledger and both
maps.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013) — this revision needs none.
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
ADMISSION_INDEX = "ix_tres_deliveries_admission_id"
#: homunculus.tres.models.ALL_TYPES_JSON — written out: a migration does not import the models.
```
with
```python
ADMISSION_INDEX = "ix_tres_deliveries_admission_id"
DEPARTMENTS = "tres_department_map"
DEPARTMENTS_TENANT_INDEX = "ix_tres_department_map_tenant_id"
IDENTITIES = "tres_practitioner_identity"
#: homunculus.tres.models.ALL_TYPES_JSON — written out: a migration does not import the models.
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
        sa.Column("session_refused_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('off', 'validate', 'send')", name="ck_tres_settings_mode"),
```
with
```python
        sa.Column("session_refused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("send_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retried_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('off', 'validate', 'send')", name="ck_tres_settings_mode"),
```

In `homunculus-engine/alembic/versions/0020_tres.py` replace
```python
    op.create_index(ADMISSION_INDEX, DELIVERIES, ["admission_id"])


def downgrade() -> None:
    op.drop_index(ADMISSION_INDEX, table_name=DELIVERIES)
```
with
```python
    op.create_index(ADMISSION_INDEX, DELIVERIES, ["admission_id"])
    op.create_table(
        DEPARTMENTS,
        sa.Column("unit_id", UUID(as_uuid=True), sa.ForeignKey("units.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("display", sa.String(200), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
    )
    op.create_index(DEPARTMENTS_TENANT_INDEX, DEPARTMENTS, ["tenant_id"])
    op.create_table(
        IDENTITIES,
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("fin", sa.String(CIPHERTEXT), nullable=True),
        sa.Column("family_name", sa.String(100), nullable=False),
        sa.Column("given_name", sa.String(100), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table(IDENTITIES)
    op.drop_index(DEPARTMENTS_TENANT_INDEX, table_name=DEPARTMENTS)
    op.drop_table(DEPARTMENTS)
    op.drop_index(ADMISSION_INDEX, table_name=DELIVERIES)
```

- [ ] **Step 5: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_migration_0020_tres.py tests/test_tres_models.py 2>&1 | tail -3`
Expected: `3 passed, 19 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_migration_0020_tres.py tests/test_tres_models.py 2>&1 | tail -3`
Expected: `22 passed` (about 80 s).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/models.py homunculus-engine/alembic/versions/0020_tres.py homunculus-engine/tests/test_migration_0020_tres.py homunculus-engine/tests/test_tres_models.py && git commit -m "feat(tres-01): F1 — the department map and the practitioner identities (D16, D17), send_from (O15, proposed) and retried_at, in migration 0020" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The ledger — a person never waits for a round (N12), `held`, `forget_skip`

A deliverer given `lock_timeout_ms` waits that long for the row at most, then `LedgerBusy` (nothing written). `held` reads a row's platform id without a lock (references, the preview); `forget_skip` removes a skip the platform holds nothing of (the Patient's placeholder, amendment 4).

**Files:**
- Modify: `homunculus-engine/src/homunculus/tres/ledger.py`
- Test: `homunculus-engine/tests/test_tres_ledger.py`

- [ ] **Step 1: The tests**

In `homunculus-engine/tests/test_tres_ledger.py` replace
```python
from homunculus.tres.ledger import (
    ERROR_MAX_BYTES, ERROR_MAX_CHARS, MAX_ATTEMPTS, RETRY_AFTER, _row, clip_error, deliver, due,
    payload_digest, record_skip,
)
```
with
```python
from homunculus.tres.ledger import (
    ERROR_MAX_BYTES, ERROR_MAX_CHARS, HAND_LOCK_TIMEOUT_MS, MAX_ATTEMPTS, RETRY_AFTER, LedgerBusy, _row, clip_error,
    deliver, due, forget_skip, held, is_lock_timeout, payload_digest, record_skip,
)
```

Append at the end of `homunculus-engine/tests/test_tres_ledger.py`:
```python
# ---------------------------------------------------------------- a hand never waits for a round (plan F1, N12)
def test_a_lock_timeout_is_told_by_its_sqlstate():
    class Orig:
        def __init__(self, code):
            self.sqlstate = code

    class Wrapped(Exception):
        def __init__(self, code):
            self.orig = Orig(code)

    assert is_lock_timeout(Wrapped("55P03")) and not is_lock_timeout(Wrapped("23505"))
    assert not is_lock_timeout(RuntimeError("x")) and HAND_LOCK_TIMEOUT_MS == 2000


@requires_db
@pytest.mark.parametrize("committed", [True, False], ids=["a-row-a-round-holds", "a-row-a-round-is-inserting"])
async def test_a_deliverer_with_a_lock_timeout_answers_busy_and_writes_nothing(db_session, committed):
    """N12: a round holds the row (FOR UPDATE across its HTTP calls) — or has inserted it and not
    committed, which makes the INSERT … ON CONFLICT wait for its transaction (NOWAIT would not bound
    that wait). «Şimdi gönder» waits a moment, then is told the row is busy; nothing is asked."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    if committed:
        db_session.add(TresDelivery(tenant_id=tenant.id, environment="test", resource_type="patient",
                                    local_id=LOCAL, status="failed", attempts=1))
    await db_session.commit()
    tenant_id = tenant.id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    async with maker() as round_, maker() as hand:
        await _row(round_, tenant_id=tenant_id, environment="test", resource_type="patient", local_id=LOCAL,
                   admission_id=None)                                  # the round's lock, uncommitted
        with pytest.raises(LedgerBusy):
            await deliver(hand, client, tenant_id=tenant_id, environment="test", mode="send",
                          resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(),
                          now=T0, lock_timeout_ms=200)
        with pytest.raises(LedgerBusy):
            await record_skip(hand, tenant_id=tenant_id, environment="test", resource_type="patient",
                              local_id=LOCAL, reason="fin_missing", lock_timeout_ms=200)
        assert fake.requests == []
        await round_.commit()
        # the round is done: the same hand now goes through (its session is usable again)
        row = await deliver(hand, client, tenant_id=tenant_id, environment="test", mode="send",
                            resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(),
                            now=T0, lock_timeout_ms=200, force=True)
        assert row.status == "sent"
    await client.aclose()


@requires_db
async def test_held_reads_the_platforms_id_and_forget_skip_removes_only_an_unheld_skip(world, db_session):
    fake, send, tenant = world
    assert await held(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id=LOCAL) is None
    await send()
    assert await held(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id=LOCAL) == "7001"
    await record_skip(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id="hmn-p-s-1.", reason="fin_missing")
    for local_id in ("hmn-p-s-1.", LOCAL):                       # the sent row is never removed
        await forget_skip(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                          local_id=local_id)
    db_session.expire_all()
    rows = (await db_session.execute(select(TresDelivery.local_id, TresDelivery.status))).all()
    assert [tuple(r) for r in rows] == [(LOCAL, "sent")]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_ledger.py 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'HAND_LOCK_TIMEOUT_MS' from 'homunculus.tres.ledger'` — `1 error`.

- [ ] **Step 3: The ledger**

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
`record_skip` writes why a resource was not built (`fin_missing`, `unit_unmapped`… — a catalogue
code, never text).
```
with
```python
`record_skip` writes why a resource was not built (`fin_missing`, `unit_unmapped`… — a catalogue
code, never text). `held` reads the platform's id of a row without locking it (a reference, a
preview); `forget_skip` removes a skip that stood for no record at all (a Patient's placeholder,
ids.patient_placeholder) once the resource has an id of its own.

A DELIVERER THAT MUST NOT WAIT (plan F1, N12): «Şimdi gönder» and «Yeniden dene» are a person's
request, and a round may hold the row they need for minutes (its transaction spans its HTTP
calls). With `lock_timeout_ms` the row is waited for that long at most, then `LedgerBusy` is
raised and nothing is written: the route answers «busy, try again». It is `SET LOCAL lock_timeout`,
not `FOR UPDATE NOWAIT`: a round that has INSERTED a new row and not committed makes the INSERT …
ON CONFLICT wait for its transaction, which NOWAIT would not bound.
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
```
with
```python

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
ERROR_MAX_BYTES = 1000
```
with
```python
ERROR_MAX_BYTES = 1000
#: How long a hand-started delivery waits for a row a round holds, in milliseconds (N12).
HAND_LOCK_TIMEOUT_MS = 2000
#: Postgres's SQLSTATE for a lock not had within `lock_timeout`.
LOCK_NOT_AVAILABLE = "55P03"


class LedgerBusy(Exception):
    """Another deliverer holds this resource's row: nothing was written; try again later."""


def is_lock_timeout(error: BaseException) -> bool:
    """A statement cancelled because its lock was not had within `lock_timeout`."""
    orig = getattr(error, "orig", None)
    return (getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)) == LOCK_NOT_AVAILABLE
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
async def _row(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str, admission_id: uuid.UUID | None) -> TresDelivery:
    """The row of this key, made if there is none, and LOCKED until the caller's commit — ONE
```
with
```python
async def _row(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str, admission_id: uuid.UUID | None,
               lock_timeout_ms: int | None = None) -> TresDelivery:
    """The row of this key, made if there is none, and LOCKED until the caller's commit — ONE
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
    what it wrote — `populate_existing`, so a row this session already holds is read again, never
    trusted from memory."""
    key = (TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
           TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id)
    await db.execute(insert(TresDelivery).values(
        id=uuid.uuid4(), tenant_id=tenant_id, environment=environment, resource_type=resource_type,
        local_id=local_id, admission_id=admission_id, status="pending", attempts=0,
    ).on_conflict_do_nothing(constraint="uq_tres_deliveries_key"))
    row = (await db.execute(select(TresDelivery).where(*key).with_for_update()
                            .execution_options(populate_existing=True))).scalar_one()
    if admission_id is not None and row.admission_id != admission_id:
```
with
```python
    what it wrote — `populate_existing`, so a row this session already holds is read again, never
    trusted from memory. With `lock_timeout_ms`, a wait longer than that is `LedgerBusy` (the
    transaction rolled back, nothing written)."""
    key = (TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
           TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id)
    try:
        if lock_timeout_ms is not None:
            await db.execute(text(f"SET LOCAL lock_timeout = '{int(lock_timeout_ms)}ms'"))
        await db.execute(insert(TresDelivery).values(
            id=uuid.uuid4(), tenant_id=tenant_id, environment=environment, resource_type=resource_type,
            local_id=local_id, admission_id=admission_id, status="pending", attempts=0,
        ).on_conflict_do_nothing(constraint="uq_tres_deliveries_key"))
        row = (await db.execute(select(TresDelivery).where(*key).with_for_update()
                                .execution_options(populate_existing=True))).scalar_one()
    except DBAPIError as exc:
        if not is_lock_timeout(exc):
            raise
        await db.rollback()
        raise LedgerBusy(resource_type) from None
    if admission_id is not None and row.admission_id != admission_id:
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
                  admission_id: uuid.UUID | None = None, now: datetime | None = None,
                  force: bool = False) -> TresDelivery:
    """One resource to the platform, its outcome on its ledger row (the module's docstring).
```
with
```python
                  admission_id: uuid.UUID | None = None, now: datetime | None = None,
                  force: bool = False, lock_timeout_ms: int | None = None) -> TresDelivery:
    """One resource to the platform, its outcome on its ledger row (the module's docstring).
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id)
    same = row.payload_digest == digest
```
with
```python
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id, lock_timeout_ms=lock_timeout_ms)
    same = row.payload_digest == digest
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
                      resource_type: str, local_id: str, reason: str,
                      admission_id: uuid.UUID | None = None, keep_held: bool = False) -> TresDelivery:
    """The resource was not built: its row reads `skipped` with the catalogue's reason code. With
```
with
```python
                      resource_type: str, local_id: str, reason: str,
                      admission_id: uuid.UUID | None = None, keep_held: bool = False,
                      lock_timeout_ms: int | None = None) -> TresDelivery:
    """The resource was not built: its row reads `skipped` with the catalogue's reason code. With
```

In `homunculus-engine/src/homunculus/tres/ledger.py` replace
```python
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id)
    if keep_held and row.remote_id:
```
with
```python
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id, lock_timeout_ms=lock_timeout_ms)
    if keep_held and row.remote_id:
```

Append at the end of `homunculus-engine/src/homunculus/tres/ledger.py`:
```python
async def held(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str) -> str | None:
    """The platform's id of this resource as the ledger holds it, or None — read, never locked."""
    return (await db.execute(select(TresDelivery.remote_id).where(
        TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
        TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id))).scalar_one_or_none()


async def forget_skip(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
                      local_id: str) -> None:
    """Removes a `skipped` row the platform holds no record of (no `remote_id`), and commits."""
    await db.execute(delete(TresDelivery).where(
        TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
        TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id,
        TresDelivery.status == "skipped", TresDelivery.remote_id.is_(None)))
    await db.commit()
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_ledger.py 2>&1 | tail -3`
Expected: `4 passed, 38 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_ledger.py -k "lock_timeout or held_reads" 2>&1 | tail -3`
Expected: `4 passed, 38 deselected` (about 15 s; the busy cases wait 200 ms each).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/ledger.py homunculus-engine/tests/test_tres_ledger.py && git commit -m "feat(tres-01): F1 — a person's delivery waits for a round's row at most its lock timeout, then LedgerBusy (N12); held and forget_skip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The live platform closed (O5, O11), parking on the round's settings (N15), the Sender's hand

`egress.LIVE_OPEN = False` and `live_closed`: the rounds pass over a tenant whose account would reach the live platform. `worker.park` parks only while `updated_at` is the version the round began on. The `Sender` carries a person's lock timeout and offers `held` and `forget_skip` to the package.

**Files:**
- Modify: `homunculus-engine/src/homunculus/tres/egress.py`, `homunculus-engine/src/homunculus/tres/worker.py`
- Test: `homunculus-engine/tests/test_tres_egress.py`, `homunculus-engine/tests/test_tres_worker.py`

- [ ] **Step 1: The tests**

In `homunculus-engine/tests/test_tres_egress.py` replace
```python
from homunculus.tres.client import TresAccount, TresClient
from homunculus.tres.egress import (
    DEFAULT_HOSTS, TresEgressRefused, address_allowed, allowed_hosts, egress_on, open_client,
)
```
with
```python
from homunculus.tres.client import TresAccount, TresClient
from homunculus.tres import egress
from homunculus.tres.egress import (
    DEFAULT_HOSTS, LIVE_HOSTS, TresEgressRefused, address_allowed, allowed_hosts, egress_on, live_closed, open_client,
)
```

Append at the end of `homunculus-engine/tests/test_tres_egress.py`:
```python
# ---------------------------------------------------------------- the live platform (plan F1: O5, O11)
def test_the_live_platform_is_closed_in_this_version():
    """Opening it is a code change with the owner's word (O5, O11): this line changes with it."""
    assert egress.LIVE_OPEN is False
    assert LIVE_HOSTS == {"ehr.e-health.gov.az"} and LIVE_HOSTS < DEFAULT_HOSTS


@pytest.mark.parametrize("environment, base_url, closed", [
    ("live", "https://ehr.e-health.gov.az", True),
    ("live", "https://ehr-sandbox.e-health.gov.az", True),          # the live environment, wherever it points
    ("live", None, True),
    ("test", "https://ehr.e-health.gov.az", True),                  # the live host, under the test account
    ("test", "https://EHR.e-health.gov.az/fhir-base", True),
    ("test", "https://ehr-sandbox.e-health.gov.az", False),
    ("test", "https://tres.test", False),
    ("test", None, False), ("test", "not a url", False),
])
def test_a_package_to_the_live_platform_is_held_back(environment, base_url, closed):
    assert live_closed(environment, base_url) is closed


def test_with_live_open_nothing_is_held_back(monkeypatch):
    monkeypatch.setattr(egress, "LIVE_OPEN", True)
    assert not live_closed("live", "https://ehr.e-health.gov.az")
```

Append at the end of `homunculus-engine/tests/test_tres_worker.py`:
```python
# ---------------------------------------------------------------- plan F1: the live platform, a stale refusal
@requires_db
@pytest.mark.parametrize("environment, base_url", [("live", "https://tres.test"),
                                                   ("test", "https://ehr.e-health.gov.az")],
                         ids=["the-live-environment", "the-live-host-under-test"])
async def test_a_tenant_whose_account_reaches_the_live_platform_is_passed_over(feed, db_session, caplog,
                                                                             environment, base_url):
    """O5, O11: no package to the live platform in this version, whatever the install allows."""
    fake, tenants, round_ = feed
    settings = await db_session.get(TresSettings, tenants["acik"].id)
    settings.environment = environment
    for name, value in (("base_url", base_url), ("username", fake.account.username),
                        ("password", fake.account.password), ("provider_id", fake.account.provider_id)):
        setattr(settings, f"{environment}_{name}", value)
    await db_session.commit()
    with caplog.at_level("WARNING"):
        report, _, clients = await round_(source_of(sends("hmn-p-0001")))
    assert (report.tenants, report.refused, report.packages) == (0, 1, 0)
    assert clients == [] and fake.requests == []
    assert "tres_live_closed" in caplog.text


@requires_db
async def test_a_login_refused_after_the_settings_were_saved_parks_nothing(feed, db_session):
    """N15: the round began on the old password; the administrator saved the new one; the old
    login's refusal comes back. The save has answered it: the tenant is not parked."""
    from homunculus.tres.client import TresLoginRefused
    fake, tenants, round_ = feed
    tenant_id = tenants["acik"].id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def refused_after_a_save(sender) -> None:
        await _change_settings(maker, tenant_id, test_password="yeni-parola")
        raise TresLoginRefused(401, "Invalid credentials")

    report, _, _ = await round_(source_of(refused_after_a_save))
    assert report.failed == 1
    assert (await _parking(db_session, tenant_id))[0] is None
    report, _, _ = await round_(source_of(sends("hmn-p-0001")))          # the next round is not passed over
    assert (report.tenants, report.parked) == (1, 0)


@requires_db
async def test_the_sender_holds_a_hand_to_its_lock_timeout_and_reads_and_forgets(feed, db_session):
    """N12: the Sender carries a person's lock timeout to every ledger call; `held` and
    `forget_skip` reach the ledger for the package (tres/package.py)."""
    from homunculus.tres.ledger import LedgerBusy, _row
    from homunculus.tres.worker import Sender
    fake, tenants, _ = feed
    tenant_id = tenants["acik"].id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    client = TresClient(fake.account, transport=fake.transport)
    async with maker() as round_db, maker() as hand_db:
        hand = Sender(hand_db, client, tenant_id=tenant_id, environment="test", mode="send", now=T0,
                      enabled_types=["patient"], lock_timeout_ms=200)
        await _row(round_db, tenant_id=tenant_id, environment="test", resource_type="patient",
                   local_id="hmn-p-0001", admission_id=None)
        with pytest.raises(LedgerBusy):
            await hand.send(resource_type="patient", fhir_type="Patient", local_id="hmn-p-0001",
                            resource=patient("hmn-p-0001"))
        with pytest.raises(LedgerBusy):
            await hand.skip(resource_type="patient", local_id="hmn-p-0001", reason="fin_missing")
        await round_db.commit()
        row = await hand.send(resource_type="patient", fhir_type="Patient", local_id="hmn-p-0001",
                              resource=patient("hmn-p-0001"))
        assert await hand.held(resource_type="patient", local_id="hmn-p-0001") == row.remote_id == "7001"
        await hand.skip(resource_type="patient", local_id="hmn-p-s-1.", reason="fin_missing")
        await hand.forget_skip(resource_type="patient", local_id="hmn-p-s-1.")
        assert await hand.held(resource_type="patient", local_id="hmn-p-s-1.") is None
    await client.aclose()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_egress.py tests/test_tres_worker.py 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'LIVE_HOSTS' from 'homunculus.tres.egress'` — `1 error`.

- [ ] **Step 3: The live lock**

In `homunculus-engine/src/homunculus/tres/egress.py` replace
```python
Both are read once, at start-up (`api/app.py` → `app.state.tres_egress`, `app.state.tres_hosts`):
changing either is a restart."""
from __future__ import annotations
```
with
```python
Both are read once, at start-up (`api/app.py` → `app.state.tres_egress`, `app.state.tres_hosts`):
changing either is a restart.

THE LIVE PLATFORM IS CLOSED IN THIS VERSION (plan F1): no package goes to the live environment, or
to an account whose address is on the platform's live host, whatever the install and the tenant
say — while `LIVE_OPEN` is False. The legal basis of sending and a patient whose consent is
`UNCONSCIOUS_LATER` (spec O5), and the cut-over where another system already reports (O11), are
the owner's open questions. Opening it is a code change, reviewed, made with the owner's word; the
connection test (no patient data) is not held by it. `live_closed` is asked by the rounds (the
tenant is passed over), the hand routes (409) and the settings form (422)."""
from __future__ import annotations
```

In `homunculus-engine/src/homunculus/tres/egress.py` replace
```python
DEFAULT_HOSTS: frozenset[str] = frozenset({"ehr-sandbox.e-health.gov.az", "ehr.e-health.gov.az"})
```
with
```python
DEFAULT_HOSTS: frozenset[str] = frozenset({"ehr-sandbox.e-health.gov.az", "ehr.e-health.gov.az"})
#: Patient data to the live platform: closed until O5 and O11 are answered (the docstring).
LIVE_OPEN = False
#: The platform's live host (spec §4.1).
LIVE_HOSTS: frozenset[str] = frozenset({"ehr.e-health.gov.az"})
```

In `homunculus-engine/src/homunculus/tres/egress.py` replace
```python

class TresEgressRefused(Exception):
```
with
```python

def live_closed(environment: str, base_url: str | None) -> bool:
    """Would a package to this account reach the live platform while it is closed? True for the
    live environment, and for an account of either environment whose address is on a live host."""
    if LIVE_OPEN:
        return False
    if environment == "live":
        return True
    try:
        host = httpx.URL(base_url or "").raw_host.decode("ascii").lower()
    except (httpx.InvalidURL, ValueError, UnicodeDecodeError):
        return False
    return host in LIVE_HOSTS


class TresEgressRefused(Exception):
```

- [ ] **Step 4: The worker**

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
  until a save that changes something, or a successful connection test, clears it (router.py).
  Without it a wrong password costs a failed login every five minutes — 288 a day, and the
```
with
```python
  until a save that changes something, or a successful connection test, clears it (router.py).
  It is set only while the settings are the ones the round began on (`park`, plan F1, N15): a
  login that left with the old password and came back refused after the administrator saved the
  new one parks nothing — the save has already answered it.
  Without it a wrong password costs a failed login every five minutes — 288 a day, and the
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
client factory is `egress.open_client` (the lock and the allowed hosts bound in): a tenant whose
address the install does not allow is passed over, counted in `refused`.
```
with
```python
client factory is `egress.open_client` (the lock and the allowed hosts bound in): a tenant whose
address the install does not allow is passed over, counted in `refused` — and so is a tenant whose
account would reach the LIVE platform, closed in this version (`egress.live_closed`, plan F1).
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
from homunculus.tres.client import TresAccount, TresClient, TresError, TresLoginRefused, TresSessionError
from homunculus.tres.egress import TresEgressRefused
from homunculus.tres.ledger import deliver, record_skip
from homunculus.tres.models import TresDelivery, TresSettings, account_of
```
with
```python
from homunculus.tres.client import TresAccount, TresClient, TresError, TresLoginRefused, TresSessionError
from homunculus.tres.egress import TresEgressRefused, live_closed
from homunculus.tres.ledger import deliver, forget_skip, held, record_skip
from homunculus.tres.models import TresDelivery, TresSettings, account_of
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
    holds that resource: its row (`remote_id`, `sent`) is left as it is (review M7). The round
    refreshes `enabled_types` before each package (`_work`)."""

    def __init__(self, db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID,
                 environment: str, mode: str, now: datetime, enabled_types: Iterable[str]) -> None:
        self._db, self._client = db, client
        self.tenant_id, self.environment, self.mode, self.now = tenant_id, environment, mode, now
        self.enabled_types = frozenset(enabled_types)
```
with
```python
    holds that resource: its row (`remote_id`, `sent`) is left as it is (review M7). The round
    refreshes `enabled_types` before each package (`_work`).

    `lock_timeout_ms` (plan F1, N12): set for a person's request («Şimdi gönder», «Yeniden dene»),
    so that a row a round holds is waited for that long at most (`ledger.LedgerBusy`). `held`
    reads the platform's id a reference needs; `forget_skip` removes a placeholder's skip."""

    def __init__(self, db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID,
                 environment: str, mode: str, now: datetime, enabled_types: Iterable[str],
                 lock_timeout_ms: int | None = None) -> None:
        self._db, self._client = db, client
        self.tenant_id, self.environment, self.mode, self.now = tenant_id, environment, mode, now
        self.enabled_types = frozenset(enabled_types)
        self.lock_timeout_ms = lock_timeout_ms
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
                                     resource_type=resource_type, local_id=local_id, reason=TYPE_OFF,
                                     admission_id=admission_id, keep_held=True)
        return await deliver(self._db, self._client, tenant_id=self.tenant_id,
                             environment=self.environment, mode=self.mode,
                             resource_type=resource_type, fhir_type=fhir_type, local_id=local_id,
                             resource=resource, admission_id=admission_id, now=self.now, force=force)
```
with
```python
                                     resource_type=resource_type, local_id=local_id, reason=TYPE_OFF,
                                     admission_id=admission_id, keep_held=True,
                                     lock_timeout_ms=self.lock_timeout_ms)
        return await deliver(self._db, self._client, tenant_id=self.tenant_id,
                             environment=self.environment, mode=self.mode,
                             resource_type=resource_type, fhir_type=fhir_type, local_id=local_id,
                             resource=resource, admission_id=admission_id, now=self.now, force=force,
                             lock_timeout_ms=self.lock_timeout_ms)
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
                                 resource_type=resource_type, local_id=local_id, reason=reason,
                                 admission_id=admission_id)
```
with
```python
                                 resource_type=resource_type, local_id=local_id, reason=reason,
                                 admission_id=admission_id, lock_timeout_ms=self.lock_timeout_ms)

    async def held(self, *, resource_type: str, local_id: str) -> str | None:
        return await held(self._db, tenant_id=self.tenant_id, environment=self.environment,
                          resource_type=resource_type, local_id=local_id)

    async def forget_skip(self, *, resource_type: str, local_id: str) -> None:
        await forget_skip(self._db, tenant_id=self.tenant_id, environment=self.environment,
                          resource_type=resource_type, local_id=local_id)
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python

async def _park(db: AsyncSession, sender: Sender, status: int | None = None) -> None:
    """The platform refused this tenant's login: `session_refused_at` is set (by a statement of
    its own, so `updated_at` — the administrator's — is not touched) and committed. One log line:
    the tenant and the status, never the platform's words (they may echo the account)."""
    await db.execute(update(TresSettings).where(TresSettings.tenant_id == sender.tenant_id)
                     .values(session_refused_at=sender.now))
    await db.commit()
    log.warning("TRƏS: the platform refused tenant %s's login (HTTP %s); it is parked until its "
                "settings are saved or a connection test succeeds", sender.tenant_id, status)
```
with
```python

async def park(db: AsyncSession, *, tenant_id: uuid.UUID, now: datetime, status: int | None,
               version: datetime | None) -> bool:
    """The platform refused this tenant's login: `session_refused_at` is set (by a statement of
    its own, so `updated_at` — the administrator's — is not touched) and committed — ONLY while
    the settings are still the ones the caller began on (`updated_at` = `version`; plan F1, N15).
    A login that left with the old password and came back refused after a save parks nothing: the
    save has answered it, and the next round tries the new account. True when it parked. One log
    line: the tenant and the status, never the platform's words (they may echo the account)."""
    stale = [TresSettings.updated_at == version] if version is not None else []
    parked = (await db.execute(update(TresSettings).where(TresSettings.tenant_id == tenant_id, *stale)
                               .values(session_refused_at=now))).rowcount > 0
    await db.commit()
    if parked:
        log.warning("TRƏS: the platform refused tenant %s's login (HTTP %s); it is parked until its "
                    "settings are saved or a connection test succeeds", tenant_id, status)
    else:
        log.warning("TRƏS: the platform refused tenant %s's login (HTTP %s) with settings saved since; "
                    "not parked", tenant_id, status)
    return parked
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
                if isinstance(exc, TresLoginRefused):
                    await _park(db, sender, exc.status)
                    return
```
with
```python
                if isinstance(exc, TresLoginRefused):
                    await park(db, tenant_id=sender.tenant_id, now=sender.now, status=exc.status,
                               version=version)
                    return
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
            if account is None:
                report.incomplete += 1
                continue
            try:
```
with
```python
            if account is None:
                report.incomplete += 1
                continue
            if live_closed(environment, account.base_url):
                log.warning("TRƏS: tenant %s passed over (tres_live_closed)", tenant_id)
                report.refused += 1
                continue
            try:
```

- [ ] **Step 5: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_egress.py tests/test_tres_worker.py 2>&1 | tail -3`
Expected: `48 passed, 34 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_worker.py -k "live_platform or parks_nothing or lock_timeout or refused_login_parks" 2>&1 | tail -3`
Expected: `6 passed, 32 deselected` (about 50 s).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/egress.py homunculus-engine/src/homunculus/tres/worker.py homunculus-engine/tests/test_tres_egress.py homunculus-engine/tests/test_tres_worker.py && git commit -m "feat(tres-01): F1 — no package to the live platform while LIVE_OPEN is False (O5, O11); park only on the round's settings (N15); the Sender's lock timeout, held, forget_skip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: One stay's package — `tres/package.py` (D8, O14)

Patient → Practitioner(s) → Encounter → vital signs, each referring to the platform's ids of what came before; the validate rule of O14; `first_complete` for the `tres.package` row; `PreviewSender`, which writes nothing. `tests/tres_world.py` builds synthetic stays on the kabul ward for this and the later tasks.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/package.py`
- Create: `homunculus-engine/tests/tres_world.py`
- Test: `homunculus-engine/tests/test_tres_package.py`

- [ ] **Step 1: The synthetic world**

Create `homunculus-engine/tests/tres_world.py`:
```python
# homunculus-engine/tests/tres_world.py
"""Synthetic stays for the national e-health feed's tests (TRƏS-01, plan F1): the kabul ward
(tests/kabul_world.py) and what the feed reads of it — a discharged admission of a synthetic person
with a FİN, the attending's identity on the tab, the unit's department, the tenant's settings
pointing at the stand-in (tests/fake_tres.py), and the bedside values as the app's audit trail
holds them (`chart` rows under the stay's board key). Every name, number and FİN here is made up."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.api.audit import AuditEvent
from homunculus.tres.models import TresDepartmentMap, TresPractitionerIdentity, TresSettings
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, Ward

#: Asia/Baku as a fixed +04:00 (no DST since 2016): the tests need no time zone database.
BAKU = timezone(timedelta(hours=4), "Asia/Baku")
ADMITTED = datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc)
DISCHARGED = datetime(2026, 11, 6, 11, 0, tzinfo=timezone.utc)
#: A day and an hour after the discharge: past the default 24-hour wait (D9).
NOW = DISCHARGED + timedelta(hours=25)
ORGANIZATION = "ORG-0001"


async def add_stay(db: AsyncSession, ward: Ward, *, protocol_no: str | None = "202600000101",
                   number: str = "H2600101", fin: str | None = "AB12C3D",
                   state: AdmissionState = AdmissionState.DISCHARGED, admitted_at: datetime = ADMITTED,
                   discharged_at: datetime | None = DISCHARGED, bed: str = "1", unit: str = "rea",
                   attending: str | None = "doctor", weight_kg: float | None = 72.5,
                   source: Admission | None = None, patient: Patient | None = None) -> Admission:
    """One admission of a synthetic person (a new patient row unless `patient` is given); with
    `source`, the arriving row of a transfer from it."""
    if patient is None:
        patient = Patient(tenant_id=ward.tenant.id, patient_number=number, display_name="Sentetikova Leyla",
                          date_of_birth="1980-01-31", sex="female", father_name="Sentetik", national_id=fin,
                          phone="050 123 45 67")
        db.add(patient)
        await db.flush()
    admission = Admission(
        patient_id=patient.id, tenant_id=ward.tenant.id, state=state, admission_datetime=admitted_at,
        admitting_unit_id=ward.units[unit].id, bed_id=ward.beds[bed].id,
        attending_physician_id=ward.users[attending].id if attending else None,
        admission_diagnosis_free_text="Sentetik tanı", protocol_no=protocol_no, weight_kg=weight_kg,
        discharge_at=discharged_at if state == AdmissionState.DISCHARGED else None,
        source_admission_id=source.id if source is not None else None)
    db.add(admission)
    await db.commit()
    return admission


async def map_unit(db: AsyncSession, ward: Ward, unit: str = "rea", code: str = "RE-01",
                   display: str = "Reanimasiya") -> None:
    db.add(TresDepartmentMap(unit_id=ward.units[unit].id, tenant_id=ward.tenant.id, code=code, display=display))
    await db.commit()


async def identify(db: AsyncSession, ward: Ward, user: str = "doctor", fin: str | None = "ZZ99YY8") -> None:
    db.add(TresPractitionerIdentity(tenant_id=ward.tenant.id, user_id=ward.users[user].id, fin=fin,
                                    family_name="Sentetikov", given_name="Elçin"))
    await db.commit()


async def feed_settings(db: AsyncSession, ward: Ward, fake: FakeTres, *, mode: str = "send",
                        **over) -> TresSettings:
    """The tenant's settings, its test account the stand-in's."""
    account = fake.account
    settings = TresSettings(tenant_id=ward.tenant.id, mode=mode, environment="test",
                            test_base_url=account.base_url, test_username=account.username,
                            test_password=account.password, test_provider_id=account.provider_id,
                            test_organization_id=ORGANIZATION, **over)
    db.add(settings)
    await db.commit()
    return settings


def chart(audit, key: str, slug: str, value: float, unit: str, at: datetime) -> int:
    """A bedside value as the door writes it (api/clinical.py): a `chart` row under the board key."""
    return audit.append(AuditEvent(SLUG, "chart", key, slug, {"value": value, "unit": unit,
                                                               "obs_ts": at.isoformat(),
                                                               "charted_by": "hemsire@kabul.example.com"})).id
```

- [ ] **Step 2: The tests**

Create `homunculus-engine/tests/test_tres_package.py`:
```python
# homunculus-engine/tests/test_tres_package.py
"""TRƏS-01 (spec D8, O14 decided by plan F1): one stay's package — Patient, its attendings, the
Encounter, the vital signs, in that order, each referring to the platform's ids of what came
before; a skipped or unheld Patient or Encounter stops it; a Practitioner that cannot be sent is
left out of `participant`; in `validate` mode a resource whose reference has no platform id is
recorded `no_reference`, never sent pointing at nothing; the first run that gives a stay its
Encounter says so (`first_complete`, the `tres.package` audit row). The order and the rules run
against a recording sender (no database); the whole package then runs on Postgres through the
real ledger against the stand-in, whose profile rules every resource passes — and a second run
asks nothing. The preview sender writes nothing. Synthetic stay, synthetic people."""
from __future__ import annotations

from dataclasses import dataclass, replace

import pytest
from sqlalchemy import func, select

from homunculus.tenant.models import Tenant
from homunculus.tres import ids
from homunculus.tres.client import TresClient
from homunculus.tres.models import TresDelivery
from homunculus.tres.package import NO_REFERENCE, PreviewSender, run
from homunculus.tres.stay import Clinician
from homunculus.tres.worker import Sender
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import build_ward
from tests.test_tres_mapping import DOCTOR, PATIENT_ID, PERSON, ROOT, stay
from tests.tres_world import add_stay

ENCOUNTER_ID = f"hmn-e-{ROOT}."
VITALS = [f"hmn-v-{ROOT}-heart-rate-first.", f"hmn-v-{ROOT}-heart-rate-last.", f"hmn-v-{ROOT}-spo2-first.",
          f"hmn-v-{ROOT}-temperature-first.", f"hmn-v-{ROOT}-weight-first.", f"hmn-v-{ROOT}-height-first."]
PRACTITIONER_ID = f"hmn-pr-{DOCTOR}."


@dataclass(frozen=True)
class Row:
    status: str
    remote_id: str | None
    reason: str | None


class Recorder:
    """A sender that remembers what it was asked. Send mode hands out platform ids 7001, 7002…;
    validate mode hands out none (the platform stores nothing). `held` is what the ledger holds
    already; a type in `refuse` fails without an id."""

    def __init__(self, mode: str = "send", held: dict | None = None, refuse=()) -> None:
        self.mode, self.ids, self.refuse = mode, dict(held or {}), set(refuse)
        self.calls: list[tuple] = []
        self._next = 7000

    async def held(self, *, resource_type, local_id):
        return self.ids.get((resource_type, local_id))

    async def send(self, *, resource_type, fhir_type, local_id, resource, admission_id=None, force=False):
        self.calls.append(("send", resource_type, local_id, force))
        self.last = resource
        key = (resource_type, local_id)
        if resource_type in self.refuse:
            return Row("failed", self.ids.get(key), None)
        if self.mode == "validate":
            return Row("validated", self.ids.get(key), None)
        if key not in self.ids:
            self._next += 1
            self.ids[key] = str(self._next)
        return Row("sent", self.ids[key], None)

    async def skip(self, *, resource_type, local_id, reason, admission_id=None):
        self.calls.append(("skip", resource_type, local_id, reason))
        return Row("skipped", None, reason)

    async def forget_skip(self, *, resource_type, local_id):
        self.calls.append(("forget", resource_type, local_id))


# ---------------------------------------------------------------- the order and the rules (no database)
async def test_a_whole_package_goes_in_order_each_referring_to_the_platforms_ids():
    sender = Recorder()
    outcome = await run(stay(), sender, organization_id="ORG-0001")
    assert sender.calls == [("forget", "patient", ids.patient_placeholder(ROOT)),
                            ("send", "patient", PATIENT_ID, False), ("send", "practitioner", PRACTITIONER_ID, False),
                            ("send", "encounter", ENCOUNTER_ID, False),
                            *(("send", "vital", local_id, False) for local_id in VITALS)]
    assert sender.ids[("encounter", ENCOUNTER_ID)] == "7003"
    assert sender.last["subject"] == {"reference": "Patient/7001"}
    assert sender.last["encounter"] == {"reference": "Encounter/7003"}
    assert outcome.first_complete is True
    assert outcome.counts() == {"patient": {"sent": 1}, "practitioner": {"sent": 1}, "encounter": {"sent": 1},
                                "vital": {"sent": 6}}
    again = await run(stay(), sender, organization_id="ORG-0001", force=True)
    assert again.first_complete is False                                   # the Encounter was there already
    assert {call[3] for call in sender.calls if call[0] == "send"} == {False, True}


async def test_a_skipped_patient_stops_the_package_under_its_placeholder():
    sender = Recorder()
    outcome = await run(stay(person=replace(PERSON, fin=None)), sender, organization_id="ORG-0001")
    assert sender.calls == [("skip", "patient", ids.patient_placeholder(ROOT), "fin_missing")]
    assert outcome.rows == [("patient", ids.patient_placeholder(ROOT), "skipped", "fin_missing")]
    assert outcome.first_complete is False


async def test_a_patient_the_platform_does_not_hold_stops_the_package_before_the_encounter():
    sender = Recorder(refuse={"patient"})
    await run(stay(), sender, organization_id="ORG-0001")
    assert [call[1] for call in sender.calls if call[0] == "send"] == ["patient", "practitioner"]
    assert not any(call[0] == "skip" for call in sender.calls)             # send mode: the Patient's row says why


async def test_a_practitioner_that_cannot_be_sent_is_left_out_of_participant():
    sender = Recorder()
    await run(stay(clinicians=(Clinician(DOCTOR),)), sender, organization_id="ORG-0001")
    assert ("skip", "practitioner", PRACTITIONER_ID, "identity_missing") in sender.calls
    encounter = [c for c in sender.calls if c[1] == "encounter"]
    assert encounter == [("send", "encounter", ENCOUNTER_ID, False)]
    refused = Recorder(refuse={"practitioner"})
    await run(stay(), refused, organization_id="ORG-0001")
    assert ("send", "vital", VITALS[0], False) in refused.calls          # the stay went on without them


async def test_a_skipped_encounter_stops_the_package_before_the_vitals():
    sender = Recorder()
    outcome = await run(stay(department=None), sender, organization_id="ORG-0001")
    assert sender.calls[-1] == ("skip", "encounter", ENCOUNTER_ID, "unit_unmapped")
    assert not any(call[1] == "vital" for call in sender.calls) and outcome.first_complete is False


async def test_validate_with_nothing_sent_before_checks_the_people_and_records_no_reference_for_the_rest():
    """O14: nothing the Encounter could point at exists on the platform."""
    sender = Recorder(mode="validate")
    outcome = await run(stay(), sender, organization_id="ORG-0001")
    assert [c for c in sender.calls if c[0] == "send"] == [("send", "patient", PATIENT_ID, False),
                                                          ("send", "practitioner", PRACTITIONER_ID, False)]
    assert [c for c in sender.calls if c[0] == "skip"] == [
        ("skip", "encounter", ENCOUNTER_ID, NO_REFERENCE), *(("skip", "vital", v, NO_REFERENCE) for v in VITALS)]
    assert outcome.first_complete is False


async def test_validate_after_a_send_checks_the_encounter_against_the_ids_the_ledger_holds():
    sender = Recorder(mode="validate", held={("patient", PATIENT_ID): "7001"})
    await run(stay(), sender, organization_id="ORG-0001")
    assert ("send", "encounter", ENCOUNTER_ID, False) in sender.calls
    assert sender.last["subject"] == {"reference": "Patient/7001"} and "participant" not in sender.last
    assert [c[1:] for c in sender.calls if c[0] == "skip"] == [("vital", v, NO_REFERENCE) for v in VITALS]


# ---------------------------------------------------------------- through the ledger, against the stand-in (Postgres)
@requires_db
async def test_the_package_lands_on_the_stand_in_and_a_second_run_asks_nothing(db_session):
    ward = await build_ward(db_session)
    admission = await add_stay(db_session, ward)
    the_stay = stay(root_id=admission.id, last_id=admission.id)
    fake = FakeTres()
    fake.seed("Organization", "ORG-0001")
    client = TresClient(fake.account, transport=fake.transport)
    sender = Sender(db_session, client, tenant_id=ward.tenant.id, environment="test", mode="send",
                    now=the_stay.discharged_at, enabled_types=("patient", "practitioner", "encounter", "vital"))
    outcome = await run(the_stay, sender, organization_id="ORG-0001")
    assert outcome.first_complete and outcome.counts() == {
        "patient": {"sent": 1}, "practitioner": {"sent": 1}, "encounter": {"sent": 1}, "vital": {"sent": 6}}
    (encounter,) = fake.stored("Encounter")
    assert encounter["subject"]["reference"] == f"Patient/{fake.stored('Patient')[0]['id']}"
    assert encounter["participant"][0]["individual"]["reference"] == f"Practitioner/{fake.stored('Practitioner')[0]['id']}"
    assert len(fake.stored("Observation")) == 6
    asked = list(fake.requests)
    again = await run(the_stay, sender, organization_id="ORG-0001")
    assert fake.requests == asked and again.first_complete is False         # D7: nothing changed, nothing asked
    rows = (await db_session.execute(select(TresDelivery.admission_id).distinct())).scalars().all()
    assert rows == [admission.id]                                           # every row: the stay's last admission
    await client.aclose()


@requires_db
async def test_the_preview_sender_builds_everything_and_writes_nothing(db_session):
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    preview = PreviewSender(db_session, tenant_id=tenant.id, environment="test")
    await run(stay(), preview, organization_id="ORG-0001")
    assert [(i["resource_type"], i["local_id"], i["held"]) for i in preview.items] == [
        ("patient", PATIENT_ID, False), ("practitioner", PRACTITIONER_ID, False), ("encounter", ENCOUNTER_ID, False),
        *(("vital", v, False) for v in VITALS)]
    encounter = preview.items[2]["resource"]
    assert encounter["subject"] == {"reference": f"Patient/{PATIENT_ID}"}          # not yet held: its local id
    assert (await db_session.execute(select(func.count()).select_from(TresDelivery))).scalar_one() == 0
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_package.py 2>&1 | tail -3`
Expected: `ModuleNotFoundError: No module named 'homunculus.tres.package'` — `1 error`.

- [ ] **Step 4: The package**

Create `homunculus-engine/src/homunculus/tres/package.py`:
```python
# homunculus-engine/src/homunculus/tres/package.py
"""One stay's package (TRƏS-01, spec D8; phase F1's share): its resources to the platform, in an
order where everything a resource refers to is there before it.

    Patient → Practitioner(s) → Encounter → vital-sign Observations

F2–F5 add their types in D8's places (Conditions and the Encounter's `diagnosis[]` after the
Encounter, then Procedures, the Composition, the laboratory results — before the vitals).

* A skipped Patient or Encounter stops the package there (D8), and so does one the platform does
  not hold after its delivery (failed, `stuck`, its type switched off before it was ever sent): a
  reference is the platform's id (`remote_id`), never a local id.
* A Practitioner that cannot be sent is left out of the Encounter's `participant` (D8).
* A Patient built under its own id removes the skip its stay's placeholder may still hold
  (ids.patient_placeholder): the person now has a record, the old reason no longer applies.

VALIDATE MODE AND REFERENCES (spec O14, decided by plan F1). `$validate` stores nothing, so a
round in `validate` has no platform id for what a resource refers to unless an earlier `send` in
the same environment left one in the ledger. Such a resource is NOT sent for validation with a
reference to nothing: it is recorded `skipped` with the reason `no_reference` — the Encounter when
the Patient has no platform id, every vital sign when the Encounter has none — so every resource
of the stay has a row that says what happened. A tenant that has never sent therefore validates
its Patients and Practitioners, the profiles with the most rules. F6 checks on the sandbox what
`$validate` does with a reference to an unknown id, and may relax this.

`run` answers what it did (`Outcome`): each row it touched, and whether this run gave the stay its
Encounter on the platform for the first time (`first_complete`, send mode only) — the moment the
caller writes the stay's one `tres.package` audit row (D24).

`PreviewSender` stands in for the worker's `Sender` and asks nothing of anyone: the preview route
(D25) runs the same package through it and shows what would be sent."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from homunculus.tres import ids
from homunculus.tres.ledger import held as ledger_held
from homunculus.tres.mapping.common import Built, Skip
from homunculus.tres.mapping.encounter import encounter as map_encounter
from homunculus.tres.mapping.patient import patient as map_patient
from homunculus.tres.mapping.practitioner import practitioner as map_practitioner
from homunculus.tres.mapping.vitals import vitals as map_vitals
from homunculus.tres.stay import Stay

NO_REFERENCE = "no_reference"


@dataclass
class Outcome:
    """What one run of a package did: (resource type, local id, status, reason) per row touched."""
    rows: list[tuple[str, str, str, str | None]] = field(default_factory=list)
    first_complete: bool = False

    def add(self, resource_type: str, local_id: str, status: str, reason: str | None) -> None:
        self.rows.append((resource_type, local_id, status, reason))

    def counts(self) -> dict[str, dict[str, int]]:
        """{resource type: {status: how many}} — what an audit row may carry (no id, no value)."""
        out: dict[str, dict[str, int]] = {}
        for resource_type, _local_id, status, _reason in self.rows:
            by_status = out.setdefault(resource_type, {})
            by_status[status] = by_status.get(status, 0) + 1
        return out


async def run(stay: Stay, sender, *, organization_id: str | None, force: bool = False) -> Outcome:
    """The stay's resources through `sender` (worker.Sender or PreviewSender), in D8's order.
    `force` is handed to every send: the nightly retry and «Yeniden dene» (D21) — a `stuck` or
    waiting row is tried now, a `sent` one with the same payload still asks nothing (ledger.py)."""
    outcome = Outcome()
    validating = sender.mode == "validate"

    async def send(built: Built):
        row = await sender.send(resource_type=built.resource_type, fhir_type=built.fhir_type,
                                local_id=built.local_id, resource=built.resource,
                                admission_id=stay.last_id, force=force)
        outcome.add(built.resource_type, built.local_id, row.status, row.reason)
        return row

    async def skip(resource_type: str, local_id: str, reason: str) -> None:
        row = await sender.skip(resource_type=resource_type, local_id=local_id, reason=reason,
                                admission_id=stay.last_id)
        outcome.add(resource_type, local_id, row.status, row.reason)

    async def unreferenced(*local_ids: tuple[str, str]) -> None:
        if validating:
            for resource_type, local_id in local_ids:
                await skip(resource_type, local_id, NO_REFERENCE)

    def vital_ids() -> list[tuple[str, str]]:
        # The vitals' local ids depend on the stay alone; the references are never sent from here.
        return [("vital", built.local_id) for built in map_vitals(stay, patient_id="-", encounter_id="-")]

    built = map_patient(stay.person, stay.root_id)
    if isinstance(built, Skip):
        await skip(built.resource_type, built.local_id, built.reason)
        return outcome
    await sender.forget_skip(resource_type="patient", local_id=ids.patient_placeholder(stay.root_id))
    patient_id = (await send(built)).remote_id

    practitioner_ids: list[str] = []
    for clinician in stay.clinicians:
        built = map_practitioner(clinician)
        if isinstance(built, Skip):
            await skip(built.resource_type, built.local_id, built.reason)
            continue
        remote = (await send(built)).remote_id
        if remote:
            practitioner_ids.append(remote)

    if not patient_id:
        await unreferenced(("encounter", ids.encounter(stay.root_id)), *vital_ids())
        return outcome
    built = map_encounter(stay, patient_id=patient_id, practitioner_ids=practitioner_ids,
                          organization_id=organization_id)
    if isinstance(built, Skip):
        await skip(built.resource_type, built.local_id, built.reason)
        return outcome
    before = await sender.held(resource_type="encounter", local_id=built.local_id)
    encounter_id = (await send(built)).remote_id
    if not encounter_id:
        await unreferenced(*vital_ids())
        return outcome

    for built in map_vitals(stay, patient_id=patient_id, encounter_id=encounter_id):
        await send(built)
    outcome.first_complete = sender.mode == "send" and before is None
    return outcome


@dataclass(frozen=True)
class PreviewRow:
    """What `PreviewSender` answers in place of a ledger row."""
    status: str
    remote_id: str | None
    reason: str | None


class PreviewSender:
    """A `Sender` that sends nothing and writes nothing (the preview, D25). It reads the ledger for
    the platform's ids; a resource the platform holds none of is referred to by its local id, and
    its item says `held: false` — the preview shows what would be sent, references as they would be
    once the resources before it are there."""

    mode = "send"

    def __init__(self, db, *, tenant_id: uuid.UUID, environment: str) -> None:
        self._db, self.tenant_id, self.environment = db, tenant_id, environment
        self.items: list[dict] = []

    async def held(self, *, resource_type: str, local_id: str) -> str | None:
        return await ledger_held(self._db, tenant_id=self.tenant_id, environment=self.environment,
                                 resource_type=resource_type, local_id=local_id)

    async def send(self, *, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                   admission_id: uuid.UUID | None = None, force: bool = False) -> PreviewRow:
        remote = await self.held(resource_type=resource_type, local_id=local_id)
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": remote is not None,
                           "resource": resource, "reason": None})
        return PreviewRow("preview", remote or local_id, None)

    async def skip(self, *, resource_type: str, local_id: str, reason: str,
                   admission_id: uuid.UUID | None = None) -> PreviewRow:
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": False,
                           "resource": None, "reason": reason})
        return PreviewRow("skipped", None, reason)

    async def forget_skip(self, *, resource_type: str, local_id: str) -> None:
        return None
```

- [ ] **Step 5: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_package.py 2>&1 | tail -3`
Expected: `7 passed, 2 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_package.py 2>&1 | tail -3`
Expected: `9 passed` (about 20 s).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/package.py homunculus-engine/tests/tres_world.py homunculus-engine/tests/test_tres_package.py && git commit -m "feat(tres-01): F1 — one stay's package in D8's order; validate records no_reference rather than send a reference to nothing (O14); the preview's sender" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Where a round's packages come from — `tres/source.py`, on `app.state.tres_source` (N1–N3, D9, O15, O21)

`StaySource(audit)` is built in `create_app` (the bedside values are rows of the app's audit trail): the due stays (D9, a week's reach, `send_from`), the nightly retry at 04:00 in the tenant's zone, a stay read whole with one trail read through `asyncio.to_thread`, and the stay's one `tres.package` audit row — whose label lands here too (N5).

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/source.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import; `app.state.tres_source`), `homunculus-engine/src/homunculus/tres/worker.py` (two docstrings)
- Modify: `dashboard/src/live/screens/denetim/denetim.js`, `dashboard/src/live/i18n/strings/denetim.js`, `dashboard/src/live/screens/denetim/denetim.test.js` (the `tres.package` label)
- Test: `homunculus-engine/tests/test_tres_source.py`, `homunculus-engine/tests/test_tres_worker.py` (the lifespan test)

- [ ] **Step 1: The tests**

Create `homunculus-engine/tests/test_tres_source.py`:
```python
# homunculus-engine/tests/test_tres_source.py
"""TRƏS-01 (spec D8, D9, D10, D21, D24; plan F1, N1–N3, O15, O21): the stays a round sends, read whole.

* which stays are due: discharged, past the tenant's wait, within the week after it (REACH), not
  before the tenant's `send_from` (O15, proposed); never an open one, never another tenant's;
* a stay read whole: the person from the root's patient row with the FİN decrypted, the chain from
  root to last, the last row's department, the attendings and their identities, the bedside values
  of ONE trail read under the last row's board key (a transfer moves the protocol number), the
  withdrawn ones left out;
* a round with the app's source puts the stay on the stand-in — every time in +04:00 — and writes
  the one `tres.package` audit row; the next round asks nothing and writes none;
* the nightly retry: at the first round after 04:00 in the tenant's zone, a `stuck` row's stay is
  rebuilt and forced, however old; once a night.

No database for the zone and the night; the rest runs on Postgres against the stand-in, the trail
in memory. Synthetic ward (tests/kabul_world.py), synthetic stays (tests/tres_world.py)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import AdmissionState
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.tres import ids, source
from homunculus.tres.client import TresClient
from homunculus.tres.ledger import payload_digest
from homunculus.tres.mapping.patient import patient as map_patient
from homunculus.tres.models import TresDelivery, TresSettings
from homunculus.tres.source import REACH, StaySource, due_stays, nightly_due, zone_of
from homunculus.tres.worker import run_round
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward
from tests.tres_world import (
    ADMITTED, BAKU, DISCHARGED, NOW, ORGANIZATION, add_stay, chart, feed_settings, identify, map_unit,
)


# ---------------------------------------------------------------- the zone and the night (no database)
def test_the_zone_is_the_tenants_and_an_unknown_one_is_none_never_utc():
    assert zone_of("UTC") is timezone.utc and zone_of("") is timezone.utc and zone_of(None) is timezone.utc
    assert zone_of("Mars/Olympus_Mons") is None


def test_the_nightly_retry_is_due_once_after_four_in_the_tenants_zone():
    before_four = datetime(2026, 11, 7, 23, 30, tzinfo=timezone.utc)        # 03:30 in Baku
    after_four = datetime(2026, 11, 8, 0, 30, tzinfo=timezone.utc)          # 04:30 in Baku
    assert nightly_due(None, before_four, BAKU)                             # never ran: due now
    assert not nightly_due(before_four - timedelta(hours=2), before_four, BAKU)   # ran after yesterday's 04:00
    assert nightly_due(before_four, after_four, BAKU)                       # 04:00 has come since
    assert not nightly_due(after_four, after_four + timedelta(hours=5), BAKU)


# ---------------------------------------------------------------- Postgres
async def _world(db_session):
    ward = await build_ward(db_session)
    fake = FakeTres()
    fake.seed("Organization", ORGANIZATION)
    return ward, fake


def _source(audit, now=NOW) -> StaySource:
    return StaySource(audit, clock=lambda: now, zone=lambda name: BAKU)


async def _round(db_session, fake, audit, now=NOW):
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def quiet(seconds: float) -> None:
        return None

    return await run_round(maker, egress=True, source=_source(audit, now), now=now, sleep=quiet,
                           client_factory=lambda account: TresClient(account, transport=fake.transport))


@requires_db
async def test_due_stays_are_the_discharged_past_their_wait_within_the_week_and_after_send_from(db_session):
    ward, fake = await _world(db_session)
    due = await add_stay(db_session, ward, protocol_no="202600000101", number="H2600101")
    await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                   discharged_at=NOW - timedelta(hours=23))                          # still within its wait
    await add_stay(db_session, ward, protocol_no="202600000103", number="H2600103", bed="3",
                   discharged_at=NOW - timedelta(hours=24) - REACH - timedelta(minutes=1))   # past the week
    await add_stay(db_session, ward, protocol_no="202600000104", number="H2600104", bed="10",
                   state=AdmissionState.ACTIVE)                                     # still admitted
    settings = await feed_settings(db_session, ward, fake)
    assert await due_stays(db_session, settings, NOW) == [due.id]
    settings.send_from = DISCHARGED + timedelta(minutes=1)                          # O15: discharged before it
    assert await due_stays(db_session, settings, NOW) == []
    settings.send_from, settings.settle_hours = DISCHARGED, 0
    assert len(await due_stays(db_session, settings, NOW)) == 2                     # at the cut-off itself: due


@requires_db
async def test_a_stay_is_read_whole_with_one_trail_read_under_its_last_board_key(db_session):
    """N2, N3: a transfer chain — the protocol number moved to the arriving row, the patient row
    kept; the chart rows of both beds are under that one key."""
    ward, fake = await _world(db_session)
    first = await add_stay(db_session, ward, state=AdmissionState.TRANSFERRED, protocol_no=None)
    from homunculus.admission.models import Patient
    person = await db_session.get(Patient, first.patient_id)
    last = await add_stay(db_session, ward, unit="neo", bed="N1", attending="admin", source=first, patient=person,
                          protocol_no="202600000101", admitted_at=ADMITTED + timedelta(days=1), weight_kg=None)
    await map_unit(db_session, ward, unit="neo", code="NEO-01", display="Neonatal")
    await identify(db_session, ward, user="doctor")
    audit = InMemoryAuditLog()
    hr1 = chart(audit, "202600000101", "heart_rate", 88.0, "/min", ADMITTED + timedelta(hours=1))
    wrong = chart(audit, "202600000101", "heart_rate", 180.0, "/min", ADMITTED + timedelta(hours=30))
    audit.append(AuditEvent(SLUG, "chart_retract", "202600000101", "heart_rate", {"entry": wrong, "reason": "yanlış hasta"}))
    hr2 = chart(audit, "202600000101", "heart_rate", 76.0, "/min", ADMITTED + timedelta(hours=60))
    chart(audit, "H2600999", "heart_rate", 99.0, "/min", ADMITTED + timedelta(hours=2))     # someone else's key
    for admission_id in (first.id, last.id):                                    # from either end of the chain
        stay = await _source(audit).load(db_session, ward.tenant.id, admission_id)
        assert (stay.root_id, stay.last_id, stay.board_key) == (first.id, last.id, "202600000101")
        assert (stay.admitted_at, stay.discharged_at, stay.finished) == (ADMITTED, DISCHARGED, True)
        assert stay.person.fin == "AB12C3D" and stay.person.display_name == "Sentetikova Leyla"
        assert (stay.department.code, stay.department.display) == ("NEO-01", "Neonatal")       # the last row's unit
        assert [(c.user_id, c.known) for c in stay.clinicians] == [(ward.users["doctor"].id, True),
                                                                 (ward.users["admin"].id, False)]
        assert stay.weight_kg == 72.5                                           # the root's
        assert [r.entry for r in stay.readings] == [hr1, hr2]
    assert await _source(audit).load(db_session, ward.tenant.id, ward.units["rea"].id) is None   # not an admission


@requires_db
async def test_a_round_puts_the_due_stay_on_the_stand_in_and_writes_one_package_row(db_session):
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    chart(audit, "202600000101", "heart_rate", 88.0, "/min", ADMITTED + timedelta(hours=1))
    chart(audit, "202600000101", "heart_rate", 76.0, "/min", ADMITTED + timedelta(hours=90))
    chart(audit, "202600000101", "temperature", 37.2, "°C", ADMITTED + timedelta(hours=2))
    report = await _round(db_session, fake, audit)
    assert (report.tenants, report.packages, report.failed) == (1, 1, 0)
    (encounter,) = fake.stored("Encounter")
    assert encounter["period"] == {"start": "2026-11-02T10:30:00+04:00", "end": "2026-11-06T15:00:00+04:00"}
    assert encounter["serviceType"]["coding"][0]["code"] == "RE-01" and encounter["status"] == "finished"
    assert sorted(o["effectiveDateTime"] for o in fake.stored("Observation")) == [
        "2026-11-02T10:30:00+04:00", "2026-11-02T11:30:00+04:00", "2026-11-02T12:30:00+04:00",
        "2026-11-06T04:30:00+04:00"]                                            # weight, HR first, temperature, HR last
    rows = (await db_session.execute(select(TresDelivery.resource_type, TresDelivery.status,
                                            TresDelivery.admission_id))).all()
    assert {tuple(r) for r in rows} == {(t, "sent", admission.id) for t in ("patient", "practitioner", "encounter", "vital")}
    (package_row,) = audit.records(tenant=SLUG, event_type="tres.package")
    assert package_row.patient_id == "202600000101"
    assert package_row.payload == {"admission_id": str(admission.id), "environment": "test",
                                   "counts": {"patient": {"sent": 1}, "practitioner": {"sent": 1},
                                              "encounter": {"sent": 1}, "vital": {"sent": 4}}}
    assert "AB12C3D" not in str(package_row.payload) and "Sentetik" not in str(package_row.payload)
    asked = list(fake.requests)
    report = await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert report.packages == 1 and fake.requests == asked                     # D7: nothing changed
    assert len(audit.records(tenant=SLUG, event_type="tres.package")) == 1


@requires_db
async def test_a_stay_whose_unit_is_unmapped_is_skipped_and_goes_once_it_is_mapped(db_session):
    ward, fake = await _world(db_session)
    await add_stay(db_session, ward)
    await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    rows = {r.resource_type: (r.status, r.reason) for r in (await db_session.execute(select(TresDelivery))).scalars()}
    assert rows["encounter"] == ("skipped", "unit_unmapped") and rows["practitioner"] == ("skipped", "identity_missing")
    assert fake.stored("Encounter") == []
    await map_unit(db_session, ward)
    await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert len(fake.stored("Encounter")) == 1                                  # the next round sent it


@requires_db
async def test_the_nightly_retry_forces_a_stuck_stay_once_a_night_however_old(db_session):
    """O21: a stay discharged two weeks ago, past the rounds' week, has a `stuck` Patient row whose
    payload is unchanged — no round would try it. The first round after 04:00 in Baku does."""
    ward, fake = await _world(db_session)
    old = DISCHARGED - timedelta(days=14)
    admission = await add_stay(db_session, ward, admitted_at=old - timedelta(days=2), discharged_at=old)
    await map_unit(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    stay = await _source(audit).load(db_session, ward.tenant.id, admission.id)
    built = map_patient(stay.person, stay.root_id)
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                                local_id=built.local_id, status="stuck", attempts=5,
                                payload_digest=payload_digest(built.resource), admission_id=admission.id))
    settings.retried_at = datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc)      # 05:00 in Baku, 7 Nov
    await db_session.commit()
    night = datetime(2026, 11, 7, 22, 0, tzinfo=timezone.utc)                   # 02:00 in Baku, 8 Nov
    await _round(db_session, fake, audit, now=night)
    assert fake.stored("Patient") == []                                         # not yet 04:00
    await _round(db_session, fake, audit, now=night + timedelta(hours=2, minutes=5))   # 04:05
    assert len(fake.stored("Patient")) == 1 and len(fake.stored("Encounter")) == 1
    db_session.expire_all()
    row = (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "patient"))).scalar_one()
    assert (row.status, row.attempts) == ("sent", 0)
    marked = (await db_session.execute(select(TresSettings.retried_at))).scalar_one()
    assert marked == night + timedelta(hours=2, minutes=5)
    asked = len(fake.requests)
    await _round(db_session, fake, audit, now=night + timedelta(hours=3))      # the same night: nothing again
    assert len(fake.requests) == asked


@requires_db
async def test_a_stay_still_admitted_goes_by_hand_in_progress(db_session):
    """D9: «Şimdi gönder» sends a stay at any time; its Encounter is `in-progress`, with no end."""
    from homunculus.tres.worker import Sender
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward, state=AdmissionState.ACTIVE)
    await map_unit(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    client = TresClient(fake.account, transport=fake.transport)
    sender = Sender(db_session, client, tenant_id=ward.tenant.id, environment="test", mode="send", now=NOW,
                    enabled_types=("patient", "practitioner", "encounter", "vital"))
    outcome = await _source(InMemoryAuditLog()).package(db_session, settings, admission.id)(sender)
    (encounter,) = fake.stored("Encounter")
    assert encounter["status"] == "in-progress" and "end" not in encounter["period"]
    assert outcome.first_complete and ids.encounter(admission.id) in [row[1] for row in outcome.rows]
    await client.aclose()
```

In `homunculus-engine/tests/test_tres_worker.py` replace
```python
    opened = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    assert opened.state.tres_source is no_packages
    # the rounds get the app's guarded factory (egress.open_client), never a bare TresClient
```
with
```python
    opened = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    # plan F1: the app's source is the stays that are due, bound to the app's own audit trail
    from homunculus.tres.source import StaySource
    assert isinstance(opened.state.tres_source, StaySource) and opened.state.tres_source.audit is opened.state.audit
    # the rounds get the app's guarded factory (egress.open_client), never a bare TresClient
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_source.py tests/test_tres_worker.py 2>&1 | tail -3`
Expected: `ImportError: cannot import name 'source' from 'homunculus.tres'` — `1 error`.

- [ ] **Step 3: The source**

Create `homunculus-engine/src/homunculus/tres/source.py`:
```python
# homunculus-engine/src/homunculus/tres/source.py
"""Where a round's packages come from (TRƏS-01, spec D8, D9, D10, D21, D24; plan F1, N1–N3, O15,
O21): the stays that are due, read whole, each handed to the package (tres/package.py).

BUILT IN `create_app` (N1), because the bedside values are `chart` rows of the app's AUDIT LOG — a
synchronous store, keyed by the tenant's SLUG and the stay's board key — and put on
`app.state.tres_source`, which the lifespan hands to the rounds and the hand routes read. Every
audit read and write here goes through `asyncio.to_thread`: the event loop never waits on it.

WHICH STAYS A ROUND SENDS (D9, amended by plan F1):
* the chain's last admission is DISCHARGED, with a `discharge_at`;
* `settle_hours` have passed since it;
* no more than REACH (7 days) have passed after that — a stay is rebuilt every round for a week
  after it became due, which is when a late correction is picked up by D7 (an unchanged resource
  asks the platform nothing). An older stay goes only by hand («Şimdi gönder»);
* O15 (PROPOSED, AWAITING THE OWNER'S WORD): not discharged before the tenant's `send_from` — the
  moment `send` was first chosen, by default — so opening `send` where another system has reported
  the stays already (O11) does not send its whole recent past again.
THE NIGHTLY RETRY (D21, O21): at the first round after 04:00 in the tenant's zone, every stay with
a `stuck` row in the selected environment is rebuilt and sent with `force` — whatever its age. The
night is marked first (`retried_at`, by its own statement): a round that ends early leaves the
rest to the next night or «Yeniden dene».

A STAY READ WHOLE (`load`, N2, N3): from any of its admissions, the chain up to its root and down
to its last row; the person from the root's patient row (a transfer keeps it) with the FİN
decrypted (`national_id` is an `EncryptedString` and cannot be searched); the last row's unit's
department; the chain's attendings with the identities the tab holds; the tenant's zone; and the
bedside values — ONE read of the trail under the last row's board key, because a transfer moves
the protocol number to the arriving row (admission/service.py, O8 of 2026-11-02) and keeps the
patient row, so every chart row of the stay is under that one key.

A stay whose Encounter reached the platform for the first time in this run writes the one
`tres.package` audit row (D24): the board key, the last admission's id, the environment and the
counts by type and status — no person, no value."""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.api.audit import AuditEvent, AuditLog, iter_records_of
from homunculus.tenant.models import Tenant
from homunculus.tres.models import TresDelivery, TresDepartmentMap, TresPractitionerIdentity, TresSettings
from homunculus.tres.package import Outcome, run
from homunculus.tres.stay import CHART, RETRACT, Clinician, Department, Person, Stay, readings_of

log = logging.getLogger(__name__)

#: How long after it became due a stay is still rebuilt by the rounds (plan F1, D9 amended).
REACH = timedelta(days=7)
#: The hour, in the tenant's zone, after which a night's retry of `stuck` rows runs (D21).
NIGHTLY_HOUR = 4
#: The trail is read this many rows at a time (iter_records_of).
PAGE = 500


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def zone_of(name: str | None) -> tzinfo | None:
    """The tenant's zone: UTC for an empty name or "UTC", None for a name this server's zone
    database does not hold — a time is then never sent (`timezone_unknown`), never guessed."""
    if not name or name == "UTC":
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None


def nightly_due(retried_at: datetime | None, now: datetime, zone: tzinfo) -> bool:
    """Has NIGHTLY_HOUR come, in `zone`, since the last nightly retry? (Never run: yes.)"""
    local = now.astimezone(zone)
    night = local.replace(hour=NIGHTLY_HOUR, minute=0, second=0, microsecond=0)
    if local < night:
        night -= timedelta(days=1)
    return retried_at is None or retried_at < night


async def due_stays(db: AsyncSession, settings: TresSettings, now: datetime) -> list[uuid.UUID]:
    """The last admissions of the stays a round sends (the module's docstring), oldest discharge first."""
    settled = now - timedelta(hours=settings.settle_hours)
    query = select(Admission.id).where(
        Admission.tenant_id == settings.tenant_id, Admission.state == AdmissionState.DISCHARGED,
        Admission.discharge_at.is_not(None), Admission.discharge_at <= settled,
        Admission.discharge_at > settled - REACH)
    if settings.send_from is not None:
        query = query.where(Admission.discharge_at >= settings.send_from)
    return list((await db.execute(query.order_by(Admission.discharge_at, Admission.id))).scalars())


async def stuck_stays(db: AsyncSession, settings: TresSettings) -> list[uuid.UUID]:
    """The stays (their last admissions) with a `stuck` row in the selected environment."""
    return list((await db.execute(
        select(TresDelivery.admission_id).where(
            TresDelivery.tenant_id == settings.tenant_id, TresDelivery.environment == settings.environment,
            TresDelivery.status == "stuck", TresDelivery.admission_id.is_not(None))
        .distinct().order_by(TresDelivery.admission_id))).scalars())


async def chain_of(db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> list[Admission]:
    """The stay's admissions, root first, from any one of them — the caller's tenant only (empty
    when the admission is not the tenant's). Read afresh (`populate_existing`): a round's session
    lives for many stays."""
    async def one(query):
        return (await db.execute(query.execution_options(populate_existing=True))).scalars().first()

    row = await one(select(Admission).where(Admission.id == admission_id, Admission.tenant_id == tenant_id))
    if row is None:
        return []
    chain = [row]
    while chain[0].source_admission_id is not None and len(chain) < 64:
        parent = await one(select(Admission).where(Admission.id == chain[0].source_admission_id,
                                                   Admission.tenant_id == tenant_id))
        if parent is None:
            break
        chain.insert(0, parent)
    while len(chain) < 64:
        child = await one(select(Admission).where(Admission.source_admission_id == chain[-1].id,
                                                  Admission.tenant_id == tenant_id)
                          .order_by(Admission.created_at, Admission.id))
        if child is None:
            break
        chain.append(child)
    return chain


class StaySource:
    """The app's `PackageSource` (worker.py) and the hand routes' way to one stay's package."""

    def __init__(self, audit: AuditLog, *, clock: Callable[[], datetime] = _utcnow,
                 zone: Callable[[str | None], tzinfo | None] = zone_of) -> None:
        self.audit, self.clock, self.zone = audit, clock, zone

    async def __call__(self, db: AsyncSession, settings: TresSettings) -> AsyncIterator:
        """A round's packages for one tenant: the nightly retry's first when its night has come,
        then the stays that are due."""
        now = self.clock()
        tenant_id = settings.tenant_id
        zone = self.zone((await db.get(Tenant, tenant_id)).timezone) or timezone.utc
        if nightly_due(settings.retried_at, now, zone):
            await db.execute(update(TresSettings).where(TresSettings.tenant_id == tenant_id)
                             .values(retried_at=now))
            await db.commit()
            for admission_id in await stuck_stays(db, settings):
                yield self.package(db, settings, admission_id, force=True)
        for admission_id in await due_stays(db, settings, now):
            yield self.package(db, settings, admission_id)

    def package(self, db: AsyncSession, settings: TresSettings, admission_id: uuid.UUID, *,
                force: bool = False):
        """The package of the stay `admission_id` belongs to. It reads the stay when it runs (never
        before), and answers what it did (`package.Outcome`), or None when the stay is gone."""
        tenant_id = settings.tenant_id

        async def package(sender) -> Outcome | None:
            stay = await self.load(db, tenant_id, admission_id)
            if stay is None:
                return None
            organization = getattr(settings, f"{sender.environment}_organization_id", None)
            outcome = await run(stay, sender, organization_id=organization, force=force)
            if outcome.first_complete:
                await self._audit_package(db, tenant_id, stay, sender.environment, outcome)
            return outcome

        return package

    async def load(self, db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> Stay | None:
        """The stay `admission_id` belongs to, read whole (the module's docstring); None when the
        admission is not the tenant's."""
        chain = await chain_of(db, tenant_id, admission_id)
        if not chain:
            return None
        root, last = chain[0], chain[-1]
        person = await db.get(Patient, root.patient_id, populate_existing=True)
        tenant = await db.get(Tenant, tenant_id)
        department = (await db.execute(select(TresDepartmentMap).where(
            TresDepartmentMap.unit_id == last.admitting_unit_id, TresDepartmentMap.tenant_id == tenant_id)
            .execution_options(populate_existing=True))).scalar_one_or_none()
        attendings = list(dict.fromkeys(a.attending_physician_id for a in chain if a.attending_physician_id))
        identities = {row.user_id: row for row in (await db.execute(select(TresPractitionerIdentity).where(
            TresPractitionerIdentity.tenant_id == tenant_id, TresPractitionerIdentity.user_id.in_(attendings))
            .execution_options(populate_existing=True))).scalars()} if attendings else {}
        key = board_key(last.protocol_no, person.patient_number)
        records = await asyncio.to_thread(lambda: list(iter_records_of(
            self.audit, tenant=tenant.slug, event_types=(CHART, RETRACT), page=PAGE, patient_id=key)))
        clinicians = tuple(
            Clinician(user_id, identities[user_id].fin, identities[user_id].family_name,
                      identities[user_id].given_name, known=True) if user_id in identities else Clinician(user_id)
            for user_id in attendings)
        return Stay(
            root_id=root.id, last_id=last.id, board_key=key, admitted_at=root.admission_datetime,
            discharged_at=last.discharge_at, finished=last.state == AdmissionState.DISCHARGED,
            person=Person(fin=person.national_id, display_name=person.display_name,
                          father_name=person.father_name, sex=person.sex,
                          date_of_birth=person.date_of_birth, phone=person.phone),
            zone=self.zone(tenant.timezone),
            department=Department(department.code, department.display) if department else None,
            clinicians=clinicians, weight_kg=root.weight_kg, height_cm=root.height_cm,
            readings=readings_of(records))

    async def _audit_package(self, db: AsyncSession, tenant_id: uuid.UUID, stay: Stay, environment: str,
                             outcome: Outcome) -> None:
        """The stay's one `tres.package` row (D24). An audit that fails is logged by its class and
        never fails the package: the ledger already holds what was sent."""
        slug = (await db.get(Tenant, tenant_id)).slug
        event = AuditEvent(slug, "tres.package", stay.board_key, "",
                           {"admission_id": str(stay.last_id), "environment": environment,
                            "counts": outcome.counts()})
        try:
            await asyncio.to_thread(self.audit.append, event)
        except Exception as exc:  # noqa: BLE001 — the ledger is the record of what was sent
            log.error("TRƏS: the tres.package row of admission %s was not written (%s)", stay.last_id,
                      type(exc).__name__)
```

- [ ] **Step 4: The app builds it; the worker says so**

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
from homunculus.tres.egress import allowed_hosts, egress_on, open_client   # TRƏS-01 (D2): the lock, the hosts
from homunculus.tres.worker import no_packages, tres_loop   # TRƏS-01 (spec D21): the rounds
```
with
```python
from homunculus.tres.egress import allowed_hosts, egress_on, open_client   # TRƏS-01 (D2): the lock, the hosts
from homunculus.tres.source import StaySource   # TRƏS-01 F1 (spec D9, N1): the stays a round sends
from homunculus.tres.worker import tres_loop   # TRƏS-01 (spec D21): the rounds
```

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
    app.state.tres_hosts = allowed_hosts(os.environ)
    # The feed's rounds (tres/worker.py, D21). WHAT is sent: phase F0 has no package builder, so
    # the source yields nothing and a round asks the platform nothing; F1 puts the stays here. The
    # client: ONLY through `open_client`, bound to this app's lock and hosts — a caller that forgets
    # to ask whether the lock is open still gets no client (a test may stand a stand-in's in).
```
with
```python
    app.state.tres_hosts = allowed_hosts(os.environ)
    # The feed's rounds (tres/worker.py, D21). WHAT is sent: the stays that are due, read whole —
    # built here because the bedside values are rows of this app's audit trail (tres/source.py,
    # plan F1 N1); the hand routes take one stay's package from it too. The client: ONLY through
    # `open_client`, bound to this app's lock and hosts — a caller that forgets to ask whether the
    # lock is open still gets no client (a test may stand a stand-in's in).
```

In `homunculus-engine/src/homunculus/api/app.py` replace
```python

    app.state.tres_source = no_packages
    app.state.tres_client_factory = _tres_client
```
with
```python

    app.state.tres_source = StaySource(audit)
    app.state.tres_client_factory = _tres_client
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
  Practitioner → Encounter → …), reading each row's `remote_id` for the references of the next.
  Phase F0 has no package builder: `no_packages` yields nothing, so a round asks the platform
  nothing. F1 supplies the source (`app.state.tres_source`).
* requests are sequential and at least PACE_S apart (the client's `pace` hook);
```
with
```python
  Practitioner → Encounter → …), reading each row's `remote_id` for the references of the next.
  `no_packages` yields nothing (phase F0's, and a test's); the app's source is F1's
  `source.StaySource` (`app.state.tres_source`): the stays that are due.
* requests are sequential and at least PACE_S apart (the client's `pace` hook);
```

In `homunculus-engine/src/homunculus/tres/worker.py` replace
```python
async def no_packages(db: AsyncSession, settings: TresSettings) -> AsyncIterator[Package]:
    """Phase F0's source: nothing to send. F1 replaces it on `app.state.tres_source`."""
    return
```
with
```python
async def no_packages(db: AsyncSession, settings: TresSettings) -> AsyncIterator[Package]:
    """A source with nothing to send (phase F0's; the app's is source.StaySource since F1)."""
    return
```

- [ ] **Step 5: The audit label of `tres.package` (N5)**

In `dashboard/src/live/screens/denetim/denetim.js` replace
```js
  ["tres.settings", "tresSettings"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));
```
with
```js
  ["tres.settings", "tresSettings"],
  // TRƏS-01 F1 (spec D24): a stay's package reached the platform whole for the first time (tres/source.py) — counts only.
  ["tres.package", "tresPackage"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresSettings: "TRƏS ayarları değişti",
    },
```
with
```js
      tresSettings: "TRƏS ayarları değişti",
      tresPackage: "TRƏS: yatış paketi gönderildi",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresSettings: "TRƏS ayarları dəyişdirildi",
    },
```
with
```js
      tresSettings: "TRƏS ayarları dəyişdirildi",
      tresPackage: "TRƏS: yatış paketi göndərildi",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresSettings: "Изменены настройки TRƏS",
    },
```
with
```js
      tresSettings: "Изменены настройки TRƏS",
      tresPackage: "TRƏS: пакет госпитализации отправлен",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresSettings: "TRƏS settings changed",
    },
```
with
```js
      tresSettings: "TRƏS settings changed",
      tresPackage: "TRƏS: a stay's package was sent",
    },
```

In `dashboard/src/live/screens/denetim/denetim.test.js` replace
```js
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(56);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(56);
    expect(typeKey("tres.settings")).toBe("denetim.type.tresSettings");   // TRƏS-01 (spec D24)
```
with
```js
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(57);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings; + F1's tres.package
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(57);
    expect(typeKey("tres.package")).toBe("denetim.type.tresPackage");     // TRƏS-01 F1
    expect(typeKey("tres.settings")).toBe("denetim.type.tresSettings");   // TRƏS-01 (spec D24)
```

- [ ] **Step 6: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_source.py tests/test_tres_worker.py 2>&1 | tail -3`
Expected: `6 passed, 40 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_source.py 2>&1 | tail -3`
Expected: `8 passed` (about 30 s).
Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/denetim 2>&1 | tail -4`
Expected: every file passed (`engineTypes.test.js` finds `tres.package` written by `tres/source.py` and named).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/source.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/tres/worker.py homunculus-engine/tests/test_tres_source.py homunculus-engine/tests/test_tres_worker.py dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js && git commit -m "feat(tres-01): F1 — the stays a round sends (D9, a week's reach, send_from — O15 proposed), the nightly retry of stuck rows (O21), a stay read whole with one trail read (N1–N3); tres.package and its label" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The settings — `send_from` (O15, proposed) and the live refusal

The first save that chooses `send` sets `send_from` to its own moment; a body's `send_from` moves it; null keeps it. A mode other than `off` on an account that would reach the live platform is 422 `tres_live_closed` — with its dashboard words in this commit. The live check stands AFTER the loop over the two accounts (`refusal_of`), so a base URL that cannot be read answers `tres_base_url`, never `tres_live_closed` (amendment 24: `egress.live_closed` fails closed on an address it cannot read, so the URL's own refusal must come first; a test holds the order). The factory's refusal `egress.TresLiveClosed` takes its code from the constant this task adds.

**Files:**
- Modify: `homunculus-engine/src/homunculus/tres/errors.py`, `homunculus-engine/src/homunculus/tres/schemas.py`, `homunculus-engine/src/homunculus/tres/router.py`, `homunculus-engine/src/homunculus/tres/egress.py`
- Modify: `dashboard/src/live/apiErrors.js`, `dashboard/src/live/apiErrors.test.js`, `dashboard/src/live/i18n/strings/tres.js`
- Test: `homunculus-engine/tests/test_tres_settings.py`

- [ ] **Step 1: The tests**

In `homunculus-engine/tests/test_tres_settings.py` replace
```python
    (body(live={**EMPTY, "base_url": "https://xn--hr-e-health-xyz.gov.az"}), "tres_base_url"),
])
```
with
```python
    (body(live={**EMPTY, "base_url": "https://xn--hr-e-health-xyz.gov.az"}), "tres_base_url"),
    # plan F1 (O5, O11): no mode but off may point at the live platform in this version
    (body(mode="validate", environment="live", settle_hours=0, enabled_types=[]), "tres_live_closed"),
    (body(mode="send", environment="live"), "tres_live_closed"),
])
```

In `homunculus-engine/tests/test_tres_settings.py` replace
```python
@pytest.mark.parametrize("sent", [
    body(), body(mode="validate", environment="live", settle_hours=0, enabled_types=[]),
    body(mode="send", settle_hours=168, enabled_types=["lab", "patient"], test=SANDBOX),
```
with
```python
@pytest.mark.parametrize("sent", [
    body(), body(mode="off", environment="live", settle_hours=0, enabled_types=[]),
    body(mode="send", settle_hours=168, enabled_types=["lab", "patient"], test=SANDBOX),
```

In `homunculus-engine/tests/test_tres_settings.py` replace
```python
                        "enabled_types": list(RESOURCE_TYPES), "test": account, "live": account,
                        "egress": False, "updated_at": None, "session_refused_at": None}
    assert await _count(db_session) == 0                    # a read writes no row
```
with
```python
                        "enabled_types": list(RESOURCE_TYPES), "test": account, "live": account,
                        "egress": False, "updated_at": None, "session_refused_at": None, "send_from": None}
    assert await _count(db_session) == 0                    # a read writes no row
```

Append at the end of `homunculus-engine/tests/test_tres_settings.py`:
```python
# ---------------------------------------------------------------- plan F1: the live platform, the cut-off (O15)
def test_a_live_host_under_the_test_account_is_refused_too_but_not_while_off():
    live_host = {**EMPTY, "base_url": "https://ehr.e-health.gov.az"}
    hosts = DEFAULT_HOSTS
    assert settings_refusal(TresSettingsIn(**body(mode="send", test=live_host)), hosts=hosts) == "tres_live_closed"
    assert settings_refusal(TresSettingsIn(**body(mode="off", test=live_host)), hosts=hosts) is None
    assert settings_refusal(TresSettingsIn(**body(mode="send", live=live_host)), hosts=hosts) is None   # not selected


def test_an_address_that_cannot_be_read_is_the_urls_own_refusal_never_the_live_lock():
    """Amendment 24 (M1): `live_closed` fails closed on an address it cannot read, so the form judges the
    URL FIRST, in either environment."""
    for unreadable in ("not a url", "ehr.e-health.gov.az", "https://"):
        for environment in ("test", "live"):
            sent = body(mode="send", environment=environment, **{environment: {**EMPTY, "base_url": unreadable}})
            assert settings_refusal(TresSettingsIn(**sent), hosts=DEFAULT_HOSTS) == "tres_base_url", (
                unreadable, environment)


@requires_db
async def test_the_first_save_in_send_sets_the_cut_off_and_the_form_can_move_it(ward, db_session):
    """O15 (proposed, awaiting the owner's word): a stay discharged before `send_from` is sent only
    by hand. The first save that chooses `send` sets it; a later one keeps it; a body may move it."""
    w, client, app = ward
    r = await client.put(URL, json=body(mode="validate", test=SANDBOX), headers=w.auth["admin"])
    assert r.json()["send_from"] is None                                     # validate: no cut-off yet
    before = datetime.now(timezone.utc)
    r = await client.put(URL, json=body(mode="send", test=SANDBOX), headers=w.auth["admin"])
    first = datetime.fromisoformat(r.json()["send_from"])
    assert before <= first <= datetime.now(timezone.utc)
    assert _audit(app)[-1].payload["changed"] == ["mode", "send_from"]
    r = await client.put(URL, json=body(mode="send", test=SANDBOX, send_from=None), headers=w.auth["admin"])
    assert datetime.fromisoformat(r.json()["send_from"]) == first            # null keeps it
    moved = "2026-11-01T00:00:00+04:00"
    r = await client.put(URL, json=body(mode="send", test=SANDBOX, send_from=moved), headers=w.auth["admin"])
    assert datetime.fromisoformat(r.json()["send_from"]) == datetime.fromisoformat(moved)
    assert _audit(app)[-1].payload["changed"] == ["send_from"]
    assert (await client.put(URL, json=body(mode="send", test=SANDBOX, send_from="2026-11-01T00:00:00"),
                             headers=w.auth["admin"])).status_code == 422          # no zone: FastAPI's own 422


@requires_db
async def test_a_mode_on_the_live_platform_is_refused_and_writes_nothing(ward, db_session):
    w, client, app = ward
    r = await client.put(URL, json=body(mode="send", environment="live", live=SANDBOX), headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "tres_live_closed")
    assert await _count(db_session) == 0 and _audit(app) == []
    r = await client.put(URL, json=body(mode="off", environment="live", live=SANDBOX), headers=w.auth["admin"])
    assert r.status_code == 200                                                # an account set up, the feed off
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_settings.py 2>&1 | tail -3`
Expected: `3 failed, 39 passed, 31 skipped` — the two `tres_live_closed` cases of `test_a_bad_body_has_its_code` (`assert None == 'tres_live_closed'`) and `test_a_live_host_under_the_test_account_is_refused_too_but_not_while_off`.

- [ ] **Step 3: The code, the body, the route**

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
TRES_HOST_NOT_ALLOWED = "tres_host_not_allowed"      # a host the install does not allow (TRES_HOSTS)

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_HOST_NOT_ALLOWED})
```
with
```python
TRES_HOST_NOT_ALLOWED = "tres_host_not_allowed"      # a host the install does not allow (TRES_HOSTS)
TRES_LIVE_CLOSED = "tres_live_closed"                # F1: the live platform is closed in this version (O5, O11)

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_HOST_NOT_ALLOWED,
                   TRES_LIVE_CLOSED})
```

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
    TRES_HOST_NOT_ALLOWED: "The base URL's host is not one this installation allows (TRES_HOSTS).",
}
```
with
```python
    TRES_HOST_NOT_ALLOWED: "The base URL's host is not one this installation allows (TRES_HOSTS).",
    TRES_LIVE_CLOSED: "Sending patient data to the live platform is closed in this version: the legal basis "
                      "and the cut-over are open (O5, O11). Only the mode off is saved for a live account.",
}
```

In `homunculus-engine/src/homunculus/tres/egress.py` replace
```python
from homunculus.tres.errors import EGRESS_OFF, TRES_HOST_NOT_ALLOWED
```
with
```python
from homunculus.tres.errors import EGRESS_OFF, TRES_HOST_NOT_ALLOWED, TRES_LIVE_CLOSED
```

In `homunculus-engine/src/homunculus/tres/egress.py` replace
```python
    or the account. Its code is the settings and hand routes' `tres_live_closed`; errors.py gains
    that constant with its dashboard words in plan F1's Task 10 (one commit), and this literal
    becomes an import of it there."""

    def __init__(self) -> None:
        super().__init__("tres_live_closed")
```
with
```python
    or the account. Its code is the settings and hand routes' `tres_live_closed`."""

    def __init__(self) -> None:
        super().__init__(TRES_LIVE_CLOSED)
```

In `homunculus-engine/src/homunculus/tres/schemas.py` replace
```python
only `password_set`. Every other account field is cleared by null or an empty string. A changed
base URL clears the stored password too unless the same body brings a new one (router.py)."""
from __future__ import annotations
```
with
```python
only `password_set`. Every other account field is cleared by null or an empty string. A changed
base URL clears the stored password too unless the same body brings a new one (router.py).

`send_from` (plan F1, O15 — PROPOSED, AWAITING THE OWNER'S WORD): the automatic rounds' cut-off.
Omitted or null keeps the stored one; a time with a zone moves it. The first save that chooses
`send` sets it to that moment when none is stored. A mode other than `off` is refused while the
selected account would reach the live platform (`tres_live_closed`, egress.live_closed)."""
from __future__ import annotations
```

In `homunculus-engine/src/homunculus/tres/schemas.py` replace
```python
import httpx
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from homunculus.tres.egress import address_allowed
from homunculus.tres.errors import (
    TRES_BASE_URL, TRES_ENVIRONMENT, TRES_FIELD_LENGTH, TRES_HOST_NOT_ALLOWED, TRES_MODE,
    TRES_SETTLE_HOURS, TRES_TYPES,
```
with
```python
import httpx
from pydantic import AwareDatetime, BaseModel, ConfigDict, StrictInt, StrictStr

from homunculus.tres.egress import address_allowed, live_closed
from homunculus.tres.errors import (
    TRES_BASE_URL, TRES_ENVIRONMENT, TRES_FIELD_LENGTH, TRES_HOST_NOT_ALLOWED, TRES_LIVE_CLOSED, TRES_MODE,
    TRES_SETTLE_HOURS, TRES_TYPES,
```

In `homunculus-engine/src/homunculus/tres/schemas.py` replace
```python
    live: TresAccountIn
```
with
```python
    live: TresAccountIn
    send_from: AwareDatetime | None = None   # O15 (proposed): None keeps the stored cut-off
```

In `homunculus-engine/src/homunculus/tres/schemas.py` replace
```python
    session_refused_at: datetime | None   # when the platform refused the login; the rounds wait (I3)
```
with
```python
    session_refused_at: datetime | None   # when the platform refused the login; the rounds wait (I3)
    send_from: datetime | None       # O15 (proposed): stays discharged before it go only by hand
```

In `homunculus-engine/src/homunculus/tres/schemas.py` replace
```python
                return TRES_FIELD_LENGTH, prefix
    return None
```
with
```python
                return TRES_FIELD_LENGTH, prefix
    selected = (getattr(payload, payload.environment).base_url or "").strip() or None
    if payload.mode != "off" and live_closed(payload.environment, selected):
        return TRES_LIVE_CLOSED, payload.environment
    return None
```

In `homunculus-engine/src/homunculus/tres/router.py` replace
```python
A-26: never a 500 for a committed change). A save that changes nothing writes no audit row.
```
with
```python
A-26: never a 500 for a committed change). A save that changes nothing writes no audit row.
Plan F1: the answer carries `send_from` (O15, proposed: the rounds' cut-off), which the first save
that chooses `send` sets to its own moment and a body's `send_from` moves; a mode other than `off`
is refused 422 `tres_live_closed` while the selected account would reach the live platform.
```

In `homunculus-engine/src/homunculus/tres/router.py` replace
```python
        updated_at=row.updated_at if row is not None else None,
        session_refused_at=row.session_refused_at if row is not None else None)


def _apply(row: TresSettings, payload: TresSettingsIn) -> list[str]:
    """Writes what differs onto the row; answers the NAMES of the fields that changed."""
```
with
```python
        updated_at=row.updated_at if row is not None else None,
        session_refused_at=row.session_refused_at if row is not None else None,
        send_from=row.send_from if row is not None else None)


def _apply(row: TresSettings, payload: TresSettingsIn, now: datetime) -> list[str]:
    """Writes what differs onto the row; answers the NAMES of the fields that changed."""
```

In `homunculus-engine/src/homunculus/tres/router.py` replace
```python
    put("mode", payload.mode, "mode")
    put("environment", payload.environment, "environment")
```
with
```python
    put("mode", payload.mode, "mode")
    # O15 (proposed): the cut-off is the body's when it names one, else the moment `send` is first chosen.
    if payload.send_from is not None:
        put("send_from", payload.send_from, "send_from")
    elif row.send_from is None and payload.mode == "send":
        put("send_from", now, "send_from")
    put("environment", payload.environment, "environment")
```

In `homunculus-engine/src/homunculus/tres/router.py` replace
```python
        raise refusal(422, code, extra).http()
    changed = _apply(row, payload)
    audit: dict = {"actor": actor, "changed": changed}
```
with
```python
        raise refusal(422, code, extra).http()
    now = datetime.now(timezone.utc)
    changed = _apply(row, payload, now)
    audit: dict = {"actor": actor, "changed": changed}
```

In `homunculus-engine/src/homunculus/tres/router.py` replace
```python
    if changed:
        row.updated_at, row.updated_by = datetime.now(timezone.utc), user_id
        # A changed setting is the administrator's answer to a refused login: the rounds try again.
```
with
```python
    if changed:
        row.updated_at, row.updated_by = now, user_id
        # A changed setting is the administrator's answer to a refused login: the rounds try again.
```

- [ ] **Step 4: Its words on the dashboard**

In `dashboard/src/live/apiErrors.js` replace
```js
  ["tres_host_not_allowed", "tres.err.hostNotAllowed"],
]);
```
with
```js
  ["tres_host_not_allowed", "tres.err.hostNotAllowed"],
  ["tres_live_closed", "tres.err.liveClosed"],          // F1: the live platform, closed in this version (O5, O11)
]);
```

In `dashboard/src/live/apiErrors.test.js` replace
```js
  const CODES = ["tres_mode", "tres_environment", "tres_settle_hours", "tres_types", "tres_base_url",
    "tres_field_length", "egress_off", "tres_account_incomplete", "tres_host_not_allowed"];
```
with
```js
  const CODES = ["tres_mode", "tres_environment", "tres_settle_hours", "tres_types", "tres_base_url",
    "tres_field_length", "egress_off", "tres_account_incomplete", "tres_host_not_allowed",
    "tres_live_closed"];
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      accountIncomplete: "Seçili ortamın hesabı eksik; bağlantı sınanmadı.",
    },
```
with
```js
      accountIncomplete: "Seçili ortamın hesabı eksik; bağlantı sınanmadı.",
      liveClosed: "Canlı platforma hasta verisi gönderimi bu sürümde kapalı (yasal dayanak ve geçiş henüz karara bağlanmadı). Canlı hesap için yalnız «Kapalı» kip kaydedilir.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      accountIncomplete: "Seçilmiş mühitin hesabı natamamdır; bağlantı yoxlanılmadı.",
    },
```
with
```js
      accountIncomplete: "Seçilmiş mühitin hesabı natamamdır; bağlantı yoxlanılmadı.",
      liveClosed: "Canlı platformaya xəstə məlumatlarının göndərilməsi bu versiyada bağlıdır (hüquqi əsas və keçid hələ qərara alınmayıb). Canlı hesab üçün yalnız «Bağlı» rejimi yadda saxlanılır.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      accountIncomplete: "Учётная запись выбранной среды неполная; соединение не проверялось.",
    },
```
with
```js
      accountIncomplete: "Учётная запись выбранной среды неполная; соединение не проверялось.",
      liveClosed: "Передача данных пациентов на рабочую платформу в этой версии закрыта (правовое основание и переход ещё не решены). Для рабочей учётной записи сохраняется только режим «Выключено».",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      accountIncomplete: "The selected environment's account is incomplete; the connection was not tested.",
    },
```
with
```js
      accountIncomplete: "The selected environment's account is incomplete; the connection was not tested.",
      liveClosed: "Sending patient data to the live platform is closed in this version (the legal basis and the cut-over are not yet decided). For a live account, only the mode «Off» is saved.",
    },
```

- [ ] **Step 5: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_settings.py 2>&1 | tail -3`
Expected: `42 passed, 31 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_settings.py -k "cut_off or live_platform or starts_off or bad_value or administrator_saves" 2>&1 | tail -3`
Expected: `13 passed, 60 deselected` (about 75 s).
Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js 2>&1 | tail -4`
Expected: passed (the map holds every code `tres/errors.py` names).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/errors.py homunculus-engine/src/homunculus/tres/schemas.py homunculus-engine/src/homunculus/tres/router.py homunculus-engine/src/homunculus/tres/egress.py dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/tres.js homunculus-engine/tests/test_tres_settings.py && git commit -m "feat(tres-01): F1 — send_from, set by the first save in send and movable (O15, proposed); a mode on the live platform refused (tres_live_closed)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The two maps — `tres/maps.py` (D16, D17)

`GET|PUT /admin/tres/departments` (the whole map) and `GET /admin/tres/practitioners`, `PUT /admin/tres/practitioners/{user_id}` (the FİN write-only). `tres.map` and `tres.identity` with their labels; six refusal codes with their words.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/maps.py`
- Modify: `homunculus-engine/src/homunculus/tres/errors.py`, `homunculus-engine/src/homunculus/api/app.py` (the router), `homunculus-engine/tests/test_route_permissions.py`, `deploy/local/web/nginx.conf` (the access log's map)
- Modify: `dashboard/src/live/screens/denetim/denetim.js`, `dashboard/src/live/i18n/strings/denetim.js`, `dashboard/src/live/screens/denetim/denetim.test.js`, `dashboard/src/live/apiErrors.js`, `dashboard/src/live/apiErrors.test.js`, `dashboard/src/live/i18n/strings/tres.js`
- Test: `homunculus-engine/tests/test_tres_maps.py` (and `test_access_log_redaction.py`, unchanged: its drift guard reads the new route)

- [ ] **Step 1: The tests**

Create `homunculus-engine/tests/test_tres_maps.py`:
```python
# homunculus-engine/tests/test_tres_maps.py
"""Yönetim › TRƏS, the two maps (TRƏS-01, spec §6, D16, D17, D24; plan F1): GET|PUT
/admin/tres/departments and GET /admin/tres/practitioners, PUT …/{user_id} — `tres.manage`, the
caller's tenant only; the department map is written whole, a unit left out unmapped; a practitioner's
FİN is write-only (`fin_set`), ciphertext at rest, held to D20's rule; every change audited with ids
and field names and never a value; a save that changes nothing writes no row. Postgres
(tests/kabul_world.py). Synthetic ward, synthetic people."""
from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.tenant.models import Site, Tenant, Unit, UnitType
from homunculus.tres.errors import WORDS
from homunculus.tres.models import TresDepartmentMap, TresPractitionerIdentity
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client

DEPARTMENTS, PRACTITIONERS = "/admin/tres/departments", "/admin/tres/practitioners"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _audit(app, event_type: str) -> list:
    return app.state.audit.records(tenant=SLUG, event_type=event_type, limit=50)


def _department(unit, code="RE-01", display="Reanimasiya") -> dict:
    return {"unit_id": str(unit.id), "code": code, "display": display}


# ---------------------------------------------------------------- the department map (D17)
@requires_db
async def test_every_unit_is_listed_unmapped_until_the_map_is_saved(ward):
    w, client, _ = ward
    r = await client.get(DEPARTMENTS, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert [(u["unit_name"], u["code"], u["display"], u["unit_active"]) for u in r.json()] == [
        ("Neonatal", None, None, True), ("Reanimasiya", None, None, True)]


@requires_db
async def test_the_map_is_saved_whole_audited_by_unit_and_a_unit_left_out_is_unmapped(ward, db_session):
    w, client, app = ward
    rea, neo = w.units["rea"], w.units["neo"]
    sent = {"departments": [_department(rea), _department(neo, " NEO-01 ", " Neonatal ")]}
    r = await client.put(DEPARTMENTS, json=sent, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {u["unit_name"]: (u["code"], u["display"]) for u in r.json()} == {
        "Neonatal": ("NEO-01", "Neonatal"), "Reanimasiya": ("RE-01", "Reanimasiya")}
    (row,) = _audit(app, "tres.map")
    assert row.payload == {"actor": w.users["admin"].username, "units": sorted([str(rea.id), str(neo.id)])}
    assert (await client.put(DEPARTMENTS, json=sent, headers=w.auth["admin"])).status_code == 200
    assert len(_audit(app, "tres.map")) == 1                                    # nothing changed: no row
    r = await client.put(DEPARTMENTS, json={"departments": [_department(rea, "RE-02")]}, headers=w.auth["admin"])
    assert {u["unit_name"]: u["code"] for u in r.json()} == {"Neonatal": None, "Reanimasiya": "RE-02"}
    assert _audit(app, "tres.map")[-1].payload["units"] == sorted([str(rea.id), str(neo.id)])
    stored = (await db_session.execute(select(func.count()).select_from(TresDepartmentMap))).scalar_one()
    assert stored == 1


@requires_db
async def test_a_bad_map_is_refused_with_its_code_and_writes_nothing(ward, db_session):
    w, client, app = ward
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    site = Site(tenant_id=other.id, name="Başka bina")
    db_session.add(site)
    await db_session.flush()
    foreign = Unit(site_id=site.id, name="Başka", unit_type=UnitType.ADULT_ICU)
    db_session.add(foreign)
    await db_session.commit()
    rea = w.units["rea"]
    for departments, code in (([_department(foreign)], "tres_unit_unknown"),
                              ([{"unit_id": str(uuid.uuid4()), "code": "X", "display": "Y"}], "tres_unit_unknown"),
                              ([_department(rea), _department(rea, "RE-02")], "tres_unit_unknown"),
                              ([_department(rea, "  ")], "tres_department_code"),
                              ([_department(rea, "X" * 33)], "tres_department_code"),
                              ([_department(rea, display="")], "tres_department_display"),
                              ([_department(rea, display="Y" * 201)], "tres_department_display")):
        r = await client.put(DEPARTMENTS, json={"departments": departments}, headers=w.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, code), departments
        assert r.json()["detail"]["message"] == WORDS[code]
    assert (await db_session.execute(select(func.count()).select_from(TresDepartmentMap))).scalar_one() == 0
    assert _audit(app, "tres.map") == []


# ---------------------------------------------------------------- the practitioners' identities (D16)
@requires_db
async def test_the_physicians_are_listed_and_an_identity_is_saved_with_its_fin_write_only(ward, db_session):
    w, client, app = ward
    doctor_id, actor = w.users["doctor"].id, w.users["admin"].username
    r = await client.get(PRACTITIONERS, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert [(p["user_id"], p["fin_set"], p["family_name"]) for p in r.json()] == [(str(doctor_id), False, None)]
    r = await client.put(f"{PRACTITIONERS}/{doctor_id}", json={"fin": " zz99yy8 ", "family_name": " Sentetikov ",
                                                               "given_name": "Elçin"}, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {k: r.json()[k] for k in ("fin_set", "family_name", "given_name")} == {
        "fin_set": True, "family_name": "Sentetikov", "given_name": "Elçin"}
    assert "ZZ99YY8" not in r.text and "fin\"" not in r.text.replace("fin_set\"", "")
    stored = (await db_session.execute(text("SELECT fin FROM tres_practitioner_identity"))).scalar_one()
    assert stored.startswith("enc::v1::") and "ZZ99YY8" not in stored
    db_session.expire_all()
    assert (await db_session.execute(select(TresPractitionerIdentity.fin))).scalar_one() == "ZZ99YY8"
    (row,) = _audit(app, "tres.identity")
    assert row.payload == {"actor": actor, "user_id": str(doctor_id),
                           "changed": ["fin", "family_name", "given_name"]}
    assert "ZZ99YY8" not in str(row.payload)


@requires_db
async def test_a_fin_left_out_stays_an_empty_one_clears_it_and_no_change_writes_no_row(ward, db_session):
    w, client, app = ward
    url = f"{PRACTITIONERS}/{w.users['doctor'].id}"
    names = {"family_name": "Sentetikov", "given_name": "Elçin"}
    await client.put(url, json={"fin": "ZZ99YY8", **names}, headers=w.auth["admin"])
    r = await client.put(url, json=names, headers=w.auth["admin"])
    assert r.json()["fin_set"] is True and len(_audit(app, "tres.identity")) == 1      # nothing changed
    r = await client.put(url, json={"fin": None, **names, "given_name": "Elçin Rəşad"}, headers=w.auth["admin"])
    assert r.json()["fin_set"] is True and _audit(app, "tres.identity")[-1].payload["changed"] == ["given_name"]
    r = await client.put(url, json={"fin": "", **names}, headers=w.auth["admin"])
    assert r.json()["fin_set"] is False
    assert _audit(app, "tres.identity")[-1].payload["changed"] == ["fin", "given_name"]


@requires_db
async def test_a_bad_identity_is_refused_and_writes_nothing(ward, db_session):
    w, client, app = ward
    url = f"{PRACTITIONERS}/{w.users['doctor'].id}"
    for sent, status, code in (({"fin": "ZZ99", "family_name": "S", "given_name": "E"}, 422, "tres_fin_format"),
                               ({"fin": "ƏZ99YY8", "family_name": "S", "given_name": "E"}, 422, "tres_fin_format"),
                               ({"family_name": " ", "given_name": "E"}, 422, "tres_name"),
                               ({"family_name": "S" * 101, "given_name": "E"}, 422, "tres_name")):
        r = await client.put(url, json=sent, headers=w.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (status, code), sent
    r = await client.put(f"{PRACTITIONERS}/{uuid.uuid4()}", json={"family_name": "S", "given_name": "E"},
                         headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_user_unknown")
    assert (await client.put(url, json={"family_name": "S", "given_name": "E", "role": "x"},
                             headers=w.auth["admin"])).status_code == 422          # a field too many: FastAPI's
    assert (await db_session.execute(select(func.count()).select_from(TresPractitionerIdentity))).scalar_one() == 0
    assert _audit(app, "tres.identity") == []


@requires_db
async def test_only_tres_manage_and_only_the_callers_tenant(ward, db_session):
    w, client, _ = ward
    url = f"{PRACTITIONERS}/{w.users['doctor'].id}"
    for who in ("nurse", "charge", "doctor", "auditor"):
        assert (await client.get(DEPARTMENTS, headers=w.auth[who])).status_code == 403, who
        assert (await client.put(DEPARTMENTS, json={"departments": []}, headers=w.auth[who])).status_code == 403, who
        assert (await client.get(PRACTITIONERS, headers=w.auth[who])).status_code == 403, who
        assert (await client.put(url, json={"family_name": "S", "given_name": "E"},
                                 headers=w.auth[who])).status_code == 403, who
    # another tenant's map and identities are never read nor written from here
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresPractitionerIdentity(tenant_id=other.id, user_id=w.users["nurse"].id, fin="AA11BB2",
                                            family_name="Başka", given_name="Kişi"))
    await db_session.commit()
    r = await client.get(PRACTITIONERS, headers=w.auth["admin"])
    assert [p["user_id"] for p in r.json()] == [str(w.users["doctor"].id)]
```

The route table: In `homunculus-engine/tests/test_route_permissions.py` replace
```python
    "homunculus.tres.router",           # TRƏS-01
}
```
with
```python
    "homunculus.tres.router",           # TRƏS-01
    "homunculus.tres.maps",             # TRƏS-01 F1: the two maps
}
```

In `homunculus-engine/tests/test_route_permissions.py` replace
```python
    ("POST", "/admin/tres/test"): ANY("tres.manage"),
}
```
with
```python
    ("POST", "/admin/tres/test"): ANY("tres.manage"),
    # tres/maps.py — TRƏS-01 F1 (spec D16, D17): the department map, the practitioners' identities
    ("GET", "/admin/tres/departments"): ANY("tres.manage"),
    ("PUT", "/admin/tres/departments"): ANY("tres.manage"),
    ("GET", "/admin/tres/practitioners"): ANY("tres.manage"),
    ("PUT", "/admin/tres/practitioners/{user_id}"): ANY("tres.manage"),
}
```

In `homunculus-engine/tests/test_route_permissions.py` replace
```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 78      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending; TRƏS-01 F0: +3, the settings read and write, the connection test
```
with
```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 82      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending; TRƏS-01 F0: +3, the settings read and write, the connection test; F1: +4, the two maps
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_route_permissions.py tests/test_tres_maps.py 2>&1 | tail -3`
Expected: `1 failed, 8 passed, 13 skipped` — `test_no_table_entry_lacks_a_route` (the four routes are not there yet).

- [ ] **Step 3: The codes**

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
TRES_LIVE_CLOSED = "tres_live_closed"                # F1: the live platform is closed in this version (O5, O11)

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_HOST_NOT_ALLOWED,
                   TRES_LIVE_CLOSED})
```
with
```python
TRES_LIVE_CLOSED = "tres_live_closed"                # F1: the live platform is closed in this version (O5, O11)
TRES_UNIT_UNKNOWN = "tres_unit_unknown"              # F1: a unit not the tenant's, or named twice (D17)
TRES_DEPARTMENT_CODE = "tres_department_code"        # F1: a department code empty or over 32 characters
TRES_DEPARTMENT_DISPLAY = "tres_department_display"  # F1: a department name empty or over 200 characters
TRES_USER_UNKNOWN = "tres_user_unknown"              # F1: no active member of the tenant by that id (D16)
TRES_FIN_FORMAT = "tres_fin_format"                  # F1: a FİN that is not seven Latin capitals or digits
TRES_NAME = "tres_name"                              # F1: a practitioner's name part empty or over 100 characters

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_HOST_NOT_ALLOWED,
                   TRES_LIVE_CLOSED, TRES_UNIT_UNKNOWN, TRES_DEPARTMENT_CODE, TRES_DEPARTMENT_DISPLAY,
                   TRES_USER_UNKNOWN, TRES_FIN_FORMAT, TRES_NAME})
```

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
                      "and the cut-over are open (O5, O11). Only the mode off is saved for a live account.",
}
```
with
```python
                      "and the cut-over are open (O5, O11). Only the mode off is saved for a live account.",
    TRES_UNIT_UNKNOWN: "A unit in the map is not one of this hospital's, or is named twice.",
    TRES_DEPARTMENT_CODE: "A department code is required, at most 32 characters.",
    TRES_DEPARTMENT_DISPLAY: "A department name is required, at most 200 characters.",
    TRES_USER_UNKNOWN: "No active member of this hospital has that id.",
    TRES_FIN_FORMAT: "A FİN is seven Latin capital letters or digits.",
    TRES_NAME: "The family and the given name are required, each at most 100 characters.",
}
```

- [ ] **Step 4: The routes**

Create `homunculus-engine/src/homunculus/tres/maps.py`:
```python
# homunculus-engine/src/homunculus/tres/maps.py
"""Yönetim › TRƏS — the two maps the platform needs and Homunculus does not hold (TRƏS-01, spec §6,
D16, D17, D24). `tres.manage`, the caller's tenant only.

GET /admin/tres/departments — every unit of the tenant (closed ones too: a past stay may be in one)
with its `hospital-departments` code and display, or none. An unmapped unit's stays are skipped
(`unit_unmapped`), never sent under a default department.

PUT /admin/tres/departments — THE WHOLE MAP: `{"departments": [{"unit_id", "code", "display"}]}`;
a unit the body leaves out is unmapped. A unit that is not the tenant's, or named twice, is 422
`tres_unit_unknown`; an empty code or one over 32 characters `tres_department_code`; an empty
display or one over 200 `tres_department_display` — nothing written. A change is audited
`tres.map` AFTER the commit: `{"actor", "units": [<the unit ids whose mapping changed>]}`; a save
that changes nothing writes no row.

GET /admin/tres/practitioners — the tenant's physicians (admission/service.py `physician_ids`) and
anyone the tab already holds an identity for, each with `fin_set` (never the FİN: it is
write-only, as the account's password), the family and the given name.

PUT /admin/tres/practitioners/{user_id} — `{"fin", "family_name", "given_name"}`. `fin` omitted or
null keeps the stored one, an empty string clears it; otherwise it is trimmed and upper-cased and
must be seven Latin capitals or digits (`tres_fin_format`, D20's rule). Both names are required,
at most 100 characters (`tres_name`). A user who is not an active member of the tenant is 404
`tres_user_unknown`. A change is audited `tres.identity`: `{"actor", "user_id", "changed": [<field
names>]}` — never a value; a save that changes nothing writes no row.

`users` is never touched (D16): staff identity proper is H4's."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, StrictStr
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.service import physician_ids
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import TenantMembership, User
from homunculus.db import get_db
from homunculus.tenant.models import Site, Unit
from homunculus.tres import az
from homunculus.tres.errors import (
    TRES_DEPARTMENT_CODE, TRES_DEPARTMENT_DISPLAY, TRES_FIN_FORMAT, TRES_NAME, TRES_UNIT_UNKNOWN, TRES_USER_UNKNOWN,
    refusal,
)
from homunculus.tres.models import TresDepartmentMap, TresPractitionerIdentity

router = APIRouter(prefix="/admin/tres", tags=["tres"])

CODE_MAX, DISPLAY_MAX, NAME_MAX = 32, 200, 100


class DepartmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    code: StrictStr
    display: StrictStr


class DepartmentsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    departments: list[DepartmentIn]


class DepartmentOut(BaseModel):
    unit_id: uuid.UUID
    unit_name: str
    unit_active: bool
    code: str | None
    display: str | None
    updated_at: datetime | None


class IdentityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fin: StrictStr | None = None          # omitted or null keeps; "" clears
    family_name: StrictStr
    given_name: StrictStr


class PractitionerOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    fin_set: bool                         # never the FİN itself
    family_name: str | None
    given_name: str | None
    updated_at: datetime | None


async def _departments(db: AsyncSession, tenant_id: uuid.UUID) -> list[DepartmentOut]:
    rows = (await db.execute(
        select(Unit, TresDepartmentMap).join(Site, Site.id == Unit.site_id)
        .outerjoin(TresDepartmentMap, TresDepartmentMap.unit_id == Unit.id)
        .where(Site.tenant_id == tenant_id).order_by(Unit.name, Unit.id)
        .execution_options(populate_existing=True))).all()
    return [DepartmentOut(unit_id=unit.id, unit_name=unit.name, unit_active=unit.is_active,
                          code=mapped.code if mapped else None, display=mapped.display if mapped else None,
                          updated_at=mapped.updated_at if mapped else None) for unit, mapped in rows]


@router.get("/departments", response_model=list[DepartmentOut])
async def read_departments(
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> list[DepartmentOut]:
    return await _departments(db, caller_tenant)


@router.put("/departments", response_model=list[DepartmentOut])
async def write_departments(
    payload: DepartmentsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> list[DepartmentOut]:
    actor, user_id = user.username, user.id
    units = set((await db.execute(select(Unit.id).join(Site, Site.id == Unit.site_id)
                                  .where(Site.tenant_id == caller_tenant))).scalars())
    wanted: dict[uuid.UUID, tuple[str, str]] = {}
    for item in payload.departments:
        if item.unit_id not in units or item.unit_id in wanted:
            raise refusal(422, TRES_UNIT_UNKNOWN).http()
        code, display = item.code.strip(), item.display.strip()
        if not code or len(code) > CODE_MAX:
            raise refusal(422, TRES_DEPARTMENT_CODE).http()
        if not display or len(display) > DISPLAY_MAX:
            raise refusal(422, TRES_DEPARTMENT_DISPLAY).http()
        wanted[item.unit_id] = (code, display)
    held = {row.unit_id: (row.code, row.display) for row in (await db.execute(
        select(TresDepartmentMap).where(TresDepartmentMap.tenant_id == caller_tenant))).scalars()}
    gone = sorted(set(held) - set(wanted), key=str)
    changed = sorted(gone + [unit for unit, value in wanted.items() if held.get(unit) != value], key=str)
    now = datetime.now(timezone.utc)
    if gone:
        await db.execute(delete(TresDepartmentMap).where(TresDepartmentMap.tenant_id == caller_tenant,
                                                         TresDepartmentMap.unit_id.in_(gone)))
    for unit_id, (code, display) in wanted.items():
        if held.get(unit_id) == (code, display):
            continue
        values = {"code": code, "display": display, "updated_at": now, "updated_by": user_id}
        await db.execute(insert(TresDepartmentMap).values(unit_id=unit_id, tenant_id=caller_tenant, **values)
                         .on_conflict_do_update(index_elements=["unit_id"], set_=values))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    if changed:
        trail.record(request, hospital, "tres.map", payload={"actor": actor, "units": [str(u) for u in changed]})
    return await _departments(db, caller_tenant)


async def _practitioners(db: AsyncSession, tenant_id: uuid.UUID,
                         only: uuid.UUID | None = None) -> list[PractitionerOut]:
    identities = {row.user_id: row for row in (await db.execute(
        select(TresPractitionerIdentity).where(TresPractitionerIdentity.tenant_id == tenant_id)
        .execution_options(populate_existing=True))).scalars()}
    wanted = set((await db.execute(physician_ids(tenant_id))).scalars()) | set(identities)
    if only is not None:
        wanted &= {only}
    users = (await db.execute(select(User.id, User.full_name).where(User.id.in_(wanted))
                              .order_by(User.full_name, User.id))).all() if wanted else []
    out = []
    for user_id, full_name in users:
        row = identities.get(user_id)
        out.append(PractitionerOut(user_id=user_id, full_name=full_name, fin_set=bool(row and row.fin),
                                   family_name=row.family_name if row else None,
                                   given_name=row.given_name if row else None,
                                   updated_at=row.updated_at if row else None))
    return out


@router.get("/practitioners", response_model=list[PractitionerOut])
async def read_practitioners(
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> list[PractitionerOut]:
    return await _practitioners(db, caller_tenant)


@router.put("/practitioners/{user_id}", response_model=PractitionerOut)
async def write_practitioner(
    user_id: uuid.UUID,
    payload: IdentityIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> PractitionerOut:
    actor, editor = user.username, user.id
    member = (await db.execute(
        select(TenantMembership.user_id).join(User, User.id == TenantMembership.user_id)
        .where(TenantMembership.tenant_id == caller_tenant, TenantMembership.user_id == user_id,
               TenantMembership.is_active.is_(True), User.is_active.is_(True)))).first()
    if member is None:
        raise refusal(404, TRES_USER_UNKNOWN).http()
    family, given = payload.family_name.strip(), payload.given_name.strip()
    if not family or not given or len(family) > NAME_MAX or len(given) > NAME_MAX:
        raise refusal(422, TRES_NAME).http()
    row = (await db.execute(select(TresPractitionerIdentity).where(
        TresPractitionerIdentity.tenant_id == caller_tenant, TresPractitionerIdentity.user_id == user_id)
        .execution_options(populate_existing=True))).scalar_one_or_none()
    fin = row.fin if row is not None else None
    if payload.fin is not None:
        fin = None
        if payload.fin.strip():
            fin, _reason = az.normal_fin(payload.fin)
            if fin is None:
                raise refusal(422, TRES_FIN_FORMAT).http()
    before = (row.fin, row.family_name, row.given_name) if row is not None else (None, None, None)
    changed = [name for name, old, new in zip(("fin", "family_name", "given_name"), before, (fin, family, given))
               if old != new]
    if changed:
        # An upsert: two saves of one new identity at once must not meet at the primary key as a 500.
        values = {"fin": fin, "family_name": family, "given_name": given,
                  "updated_at": datetime.now(timezone.utc), "updated_by": editor}
        await db.execute(insert(TresPractitionerIdentity).values(tenant_id=caller_tenant, user_id=user_id, **values)
                         .on_conflict_do_update(index_elements=["tenant_id", "user_id"], set_=values))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    if changed:
        trail.record(request, hospital, "tres.identity",
                     payload={"actor": actor, "user_id": str(user_id), "changed": changed})
    return (await _practitioners(db, caller_tenant, only=user_id))[0]
```

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
    app.include_router(tres_router)
    # G2-B1d (spec §5, D12): the bridge's patient query — the device token only, never proxied by
```
with
```python
    app.include_router(tres_router)
    # TRƏS-01 F1: the department map and the practitioners' identities (tres/maps.py, D16, D17).
    from homunculus.tres.maps import router as tres_maps_router
    app.include_router(tres_maps_router)
    # G2-B1d (spec §5, D12): the bridge's patient query — the device token only, never proxied by
```

The practitioner's id never reaches nginx's access log (amendment 22; without this `test_access_log_redaction.py` fails twice):

In `deploy/local/web/nginx.conf` replace
```
    ~^/admissions/[^/]+/care-team/[^/]+/end$                 /admissions/:id/care-team/:id/end;
    ~^/alerts/[^/]+/(?<act>acknowledge|escalate|snooze)$     /alerts/:id/$act;
```
with
```
    ~^/admissions/[^/]+/care-team/[^/]+/end$                 /admissions/:id/care-team/:id/end;
    # TRƏS-01 F1: a stay (its last admission), a ledger row, a practitioner's user — never a key in the log.
    ~^/admin/tres/practitioners/[^/]+$                       /admin/tres/practitioners/:id;
    ~^/alerts/[^/]+/(?<act>acknowledge|escalate|snooze)$     /alerts/:id/$act;
```

In `deploy/local/web/nginx.conf` replace
```
    # Anything else below a prefix that carries a key or an id, whole: LAST.
    ~^/(?<pre>patients|clinical|scores/sofa|alerts|admissions|handovers|break-glass|scope|infinity-waves|tasks|admin/users|admin/groups|admin/ldap/group-mappings|tenant/(?:beds|rooms|sites|tenants|units))/.   /$pre/:redacted;
}
```
with
```
    # Anything else below a prefix that carries a key or an id, whole: LAST.
    ~^/(?<pre>patients|clinical|scores/sofa|alerts|admissions|handovers|break-glass|scope|infinity-waves|tasks|admin/users|admin/groups|admin/ldap/group-mappings|admin/tres/practitioners|tenant/(?:beds|rooms|sites|tenants|units))/.   /$pre/:redacted;
}
```

- [ ] **Step 5: The labels and the words on the dashboard (N5)**

In `dashboard/src/live/screens/denetim/denetim.js` replace
```js
  ["tres.package", "tresPackage"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));
```
with
```js
  ["tres.package", "tresPackage"],
  // TRƏS-01 F1 (spec D24): the department map and a practitioner's identity changed (tres/maps.py).
  ["tres.map", "tresMap"], ["tres.identity", "tresIdentity"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresPackage: "TRƏS: yatış paketi gönderildi",
    },
```
with
```js
      tresPackage: "TRƏS: yatış paketi gönderildi",
      tresMap: "TRƏS bölüm eşlemesi değişti", tresIdentity: "TRƏS hekim kimliği değişti",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresPackage: "TRƏS: yatış paketi göndərildi",
    },
```
with
```js
      tresPackage: "TRƏS: yatış paketi göndərildi",
      tresMap: "TRƏS şöbə uyğunlaşdırması dəyişdirildi", tresIdentity: "TRƏS həkim identifikasiyası dəyişdirildi",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresPackage: "TRƏS: пакет госпитализации отправлен",
    },
```
with
```js
      tresPackage: "TRƏS: пакет госпитализации отправлен",
      tresMap: "Изменено сопоставление отделений TRƏS", tresIdentity: "Изменены данные врача для TRƏS",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresPackage: "TRƏS: a stay's package was sent",
    },
```
with
```js
      tresPackage: "TRƏS: a stay's package was sent",
      tresMap: "TRƏS department map changed", tresIdentity: "TRƏS practitioner identity changed",
    },
```

In `dashboard/src/live/screens/denetim/denetim.test.js` replace
```js
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(57);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings; + F1's tres.package
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(57);
    expect(typeKey("tres.package")).toBe("denetim.type.tresPackage");     // TRƏS-01 F1
    expect(typeKey("tres.settings")).toBe("denetim.type.tresSettings");   // TRƏS-01 (spec D24)
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
```
with
```js
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(59);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings; + F1's tres.package, tres.map, tres.identity
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(59);
    expect(typeKey("tres.package")).toBe("denetim.type.tresPackage");     // TRƏS-01 F1
    expect(typeKey("tres.settings")).toBe("denetim.type.tresSettings");   // TRƏS-01 (spec D24)
    expect(typeKey("tres.map")).toBe("denetim.type.tresMap");             // TRƏS-01 F1
    expect(typeKey("tres.identity")).toBe("denetim.type.tresIdentity");
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
```

In `dashboard/src/live/apiErrors.js` replace
```js
  ["tres_live_closed", "tres.err.liveClosed"],          // F1: the live platform, closed in this version (O5, O11)
]);
```
with
```js
  ["tres_live_closed", "tres.err.liveClosed"],          // F1: the live platform, closed in this version (O5, O11)
  ["tres_unit_unknown", "tres.err.unitUnknown"],        // F1: the department map (D17)
  ["tres_department_code", "tres.err.departmentCode"],
  ["tres_department_display", "tres.err.departmentDisplay"],
  ["tres_user_unknown", "tres.err.userUnknown"],        // F1: the practitioners' identities (D16)
  ["tres_fin_format", "tres.err.finFormat"],
  ["tres_name", "tres.err.name"],
]);
```

In `dashboard/src/live/apiErrors.test.js` replace
```js
    "tres_field_length", "egress_off", "tres_account_incomplete", "tres_host_not_allowed",
    "tres_live_closed"];
```
with
```js
    "tres_field_length", "egress_off", "tres_account_incomplete", "tres_host_not_allowed",
    "tres_live_closed", "tres_unit_unknown", "tres_department_code", "tres_department_display", "tres_user_unknown",
    "tres_fin_format", "tres_name"];
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      liveClosed: "Canlı platforma hasta verisi gönderimi bu sürümde kapalı (yasal dayanak ve geçiş henüz karara bağlanmadı). Canlı hesap için yalnız «Kapalı» kip kaydedilir.",
    },
```
with
```js
      liveClosed: "Canlı platforma hasta verisi gönderimi bu sürümde kapalı (yasal dayanak ve geçiş henüz karara bağlanmadı). Canlı hesap için yalnız «Kapalı» kip kaydedilir.",
      unitUnknown: "Eşlemedeki bir birim bu hastanenin değil ya da iki kez yazılmış.",
      departmentCode: "Bölüm kodu gerekli, en çok 32 karakter.",
      departmentDisplay: "Bölüm adı gerekli, en çok 200 karakter.",
      userUnknown: "Bu kimlikle hastanenin etkin bir üyesi yok.",
      finFormat: "FİN yedi Latin büyük harf ya da rakamdır.",
      name: "Soyad ve ad gerekli, her biri en çok 100 karakter.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      liveClosed: "Canlı platformaya xəstə məlumatlarının göndərilməsi bu versiyada bağlıdır (hüquqi əsas və keçid hələ qərara alınmayıb). Canlı hesab üçün yalnız «Bağlı» rejimi yadda saxlanılır.",
    },
```
with
```js
      liveClosed: "Canlı platformaya xəstə məlumatlarının göndərilməsi bu versiyada bağlıdır (hüquqi əsas və keçid hələ qərara alınmayıb). Canlı hesab üçün yalnız «Bağlı» rejimi yadda saxlanılır.",
      unitUnknown: "Uyğunlaşdırmadakı bölmələrdən biri bu xəstəxanaya aid deyil və ya iki dəfə yazılıb.",
      departmentCode: "Şöbə kodu tələb olunur, ən çoxu 32 simvol.",
      departmentDisplay: "Şöbənin adı tələb olunur, ən çoxu 200 simvol.",
      userUnknown: "Bu identifikatorla xəstəxananın aktiv üzvü yoxdur.",
      finFormat: "FİN yeddi latın böyük hərfi və ya rəqəmdən ibarətdir.",
      name: "Soyad və ad tələb olunur, hər biri ən çoxu 100 simvol.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      liveClosed: "Передача данных пациентов на рабочую платформу в этой версии закрыта (правовое основание и переход ещё не решены). Для рабочей учётной записи сохраняется только режим «Выключено».",
    },
```
with
```js
      liveClosed: "Передача данных пациентов на рабочую платформу в этой версии закрыта (правовое основание и переход ещё не решены). Для рабочей учётной записи сохраняется только режим «Выключено».",
      unitUnknown: "Одно из подразделений в сопоставлении не принадлежит этой больнице или указано дважды.",
      departmentCode: "Код отделения обязателен, не длиннее 32 символов.",
      departmentDisplay: "Название отделения обязательно, не длиннее 200 символов.",
      userUnknown: "В этой больнице нет активного сотрудника с таким идентификатором.",
      finFormat: "FİN состоит из семи заглавных латинских букв или цифр.",
      name: "Фамилия и имя обязательны, каждое не длиннее 100 символов.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      liveClosed: "Sending patient data to the live platform is closed in this version (the legal basis and the cut-over are not yet decided). For a live account, only the mode «Off» is saved.",
    },
```
with
```js
      liveClosed: "Sending patient data to the live platform is closed in this version (the legal basis and the cut-over are not yet decided). For a live account, only the mode «Off» is saved.",
      unitUnknown: "A unit in the map is not one of this hospital's, or is listed twice.",
      departmentCode: "A department code is required, at most 32 characters.",
      departmentDisplay: "A department name is required, at most 200 characters.",
      userUnknown: "This hospital has no active member with that id.",
      finFormat: "A FİN is seven Latin capital letters or digits.",
      name: "The family and the given name are required, each at most 100 characters.",
    },
```

- [ ] **Step 6: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_route_permissions.py tests/test_tres_maps.py tests/test_access_log_redaction.py tests/test_nginx_routes.py 2>&1 | tail -3`
Expected: `73 passed, 13 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_maps.py 2>&1 | tail -3`
Expected: `7 passed` (about 40 s).
Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/screens/denetim 2>&1 | tail -4`
Expected: every file passed.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/maps.py homunculus-engine/src/homunculus/tres/errors.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tres_maps.py deploy/local/web/nginx.conf dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/tres.js && git commit -m "feat(tres-01): F1 — the department map and the practitioner identities (D16, D17): tres.manage, the caller's tenant, the FİN write-only; tres.map, tres.identity" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The ledger, a stay, its preview, the hand — `tres/deliveries.py` (D9, D21, D25; N12, N14, N15)

`GET /admin/tres/deliveries` (no platform words; the parked tenant said), `GET /admin/tres/admissions?key=`, `GET …/{id}/preview` (audited), `POST …/{id}/send` and `POST /admin/tres/deliveries/{id}/retry` (locks, lock timeout, parking, outage) — `tres.send`, `tres.retry`, `tres.preview` with their labels; seven refusal codes with their words.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/deliveries.py`
- Modify: `homunculus-engine/src/homunculus/tres/errors.py`, `homunculus-engine/src/homunculus/api/app.py`, `homunculus-engine/tests/test_route_permissions.py`, `deploy/local/web/nginx.conf`
- Modify: `dashboard/src/live/screens/denetim/denetim.js`, `dashboard/src/live/i18n/strings/denetim.js`, `dashboard/src/live/screens/denetim/denetim.test.js`, `dashboard/src/live/apiErrors.js`, `dashboard/src/live/apiErrors.test.js`, `dashboard/src/live/i18n/strings/tres.js`
- Test: `homunculus-engine/tests/test_tres_deliveries.py` (and `test_access_log_redaction.py`, unchanged)

- [ ] **Step 1: The tests**

Create `homunculus-engine/tests/test_tres_deliveries.py`:
```python
# homunculus-engine/tests/test_tres_deliveries.py
"""Yönetim › TRƏS, the ledger and a person's hand on it (TRƏS-01, spec §6, D9, D21, D24, D25; plan F1,
N12, N14, N15, O21): the list (newest first, a page at a time, filtered, the stay's board key, no
platform words, a parked tenant said), a stay found by its key, its audited preview, «Şimdi gönder»
and «Yeniden dene» — each refused while a lock is closed, `busy` rather than waiting behind a
round, a refused login parking the tenant, an outage a 503, every attempt audited with its result
and counts. `tres.manage`, the caller's tenant only. Postgres (tests/kabul_world.py) against the
stand-in (tests/fake_tres.py). Synthetic ward, synthetic stays."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import AdmissionState
from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresClient
from homunculus.tres.ledger import _row
from homunculus.tres.models import TresDelivery, TresSettings
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.tres_world import ADMITTED, BAKU, ORGANIZATION, add_stay, chart, feed_settings, identify, map_unit

LIST, FIND = "/admin/tres/deliveries", "/admin/tres/admissions"


@pytest_asyncio.fixture
async def desk(db_session, monkeypatch):
    """The ward with one discharged stay, mapped and identified, the tenant in `send` on the
    stand-in; the app's lock open and its client factory the stand-in's."""
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    ward = await build_ward(db_session)
    fake = FakeTres()
    fake.seed("Organization", ORGANIZATION)
    stay = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake)
    async with ward_client(db_session) as (client, app):
        app.state.tres_egress = True
        app.state.tres_client_factory = lambda account: TresClient(account, transport=fake.transport)
        app.state.tres_source.zone = lambda name: BAKU
        chart(app.state.audit, "202600000101", "heart_rate", 88.0, "/min", ADMITTED + timedelta(hours=1))
        yield ward, fake, stay, client, app


def _audit(app, event_type: str) -> list:
    return app.state.audit.records(tenant=SLUG, event_type=event_type, limit=50)


def _send(stay) -> str:
    return f"/admin/tres/admissions/{stay.id}/send"


# ---------------------------------------------------------------- «Şimdi gönder» (D9)
@requires_db
async def test_send_now_puts_the_stay_on_the_platform_and_is_audited_with_its_counts(desk):
    ward, fake, stay, client, app = desk
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    answer = r.json()
    assert answer["admission_id"] == str(stay.id)
    assert answer["counts"] == {"patient": {"sent": 1}, "practitioner": {"sent": 1}, "encounter": {"sent": 1},
                                "vital": {"sent": 2}}
    assert [row["resource_type"] for row in answer["rows"]] == ["patient", "practitioner", "encounter", "vital", "vital"]
    assert "AB12C3D" not in r.text and "Sentetik" not in r.text                 # ids and statuses, no person
    assert len(fake.stored("Encounter")) == 1
    (row,) = _audit(app, "tres.send")
    assert row.patient_id == "202600000101"
    assert row.payload == {"actor": ward.users["admin"].username, "admission_id": str(stay.id), "result": "sent",
                           "counts": answer["counts"]}
    assert len(_audit(app, "tres.package")) == 1                                # the stay's first complete package


@requires_db
async def test_send_now_is_refused_while_a_lock_is_closed_and_asks_nothing(desk, db_session):
    ward, fake, stay, client, app = desk
    app.state.tres_egress = False
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "egress_off")
    app.state.tres_egress = True
    await db_session.execute(text("UPDATE tres_settings SET mode = 'off'"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_off")
    await db_session.execute(text("UPDATE tres_settings SET mode = 'send', test_base_url = 'https://ehr.e-health.gov.az'"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_live_closed")      # O5, O11
    await db_session.execute(text("UPDATE tres_settings SET test_base_url = 'https://tres.test', test_password = NULL"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")
    assert fake.requests == [] and _audit(app, "tres.send") == []


@requires_db
async def test_send_now_answers_busy_rather_than_wait_behind_a_round(desk, db_session):
    """N12: a round holds the stay's Patient row; the hand is told at once, and nothing is asked."""
    ward, fake, stay, client, app = desk
    async with async_sessionmaker(db_session.bind, expire_on_commit=False)() as round_:
        from homunculus.tres import ids
        await _row(round_, tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                   local_id=ids.patient("AB12C3D"), admission_id=stay.id)       # held, uncommitted
        started = datetime.now(timezone.utc)
        r = await client.post(_send(stay), headers=ward.auth["admin"])
        assert datetime.now(timezone.utc) - started < timedelta(seconds=30)
        await round_.rollback()
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_busy")
    assert fake.fhir_requests == []
    assert _audit(app, "tres.send")[-1].payload["result"] == "tres_busy"


@requires_db
async def test_a_refused_login_parks_the_tenant_and_an_outage_is_a_503(desk, db_session):
    ward, fake, stay, client, app = desk
    await db_session.execute(text("UPDATE tres_settings SET test_password = :p"), {"p": "yanlis-parola"})
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_login_refused")
    parked = (await db_session.execute(text("SELECT session_refused_at FROM tres_settings"))).scalar_one()
    assert parked is not None                                                    # as a round would (N15)
    await db_session.execute(text("UPDATE tres_settings SET test_password = :p, session_refused_at = NULL"),
                             {"p": fake.account.password})
    await db_session.commit()

    def down(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return fake.transport.handler(request)
        return httpx.Response(503, text="")

    app.state.tres_client_factory = lambda account: TresClient(account, transport=httpx.MockTransport(down))
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (503, "tres_platform_unavailable")
    assert [a.payload["result"] for a in _audit(app, "tres.send")] == ["tres_login_refused", "tres_platform_unavailable"]


# ---------------------------------------------------------------- «Yeniden dene» (D21, O21)
@requires_db
async def test_retry_forces_a_stuck_row_of_the_stay_and_is_audited(desk, db_session):
    ward, fake, stay, client, app = desk
    actor, stay_id = ward.users["admin"].username, stay.id                  # plain values: expire_all below
    await client.post(_send(stay), headers=ward.auth["admin"])
    vital = (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "vital")
                                      .order_by(TresDelivery.local_id).limit(1))).scalar_one()
    vital_id = vital.id
    await db_session.execute(text("UPDATE tres_deliveries SET status = 'stuck', attempts = 5, payload_digest = :d "
                                  "WHERE id = :id"), {"d": vital.payload_digest, "id": vital_id})
    await db_session.commit()
    r = await client.post(f"{LIST}/{vital_id}/retry", headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    db_session.expire_all()
    row = await db_session.get(TresDelivery, vital_id)
    assert (row.status, row.attempts) == ("sent", 0)                             # forced: tried, and taken
    (audit,) = _audit(app, "tres.retry")
    assert audit.payload == {"actor": actor, "delivery_id": str(vital_id),
                             "admission_id": str(stay_id), "result": "sent", "counts": r.json()["counts"]}
    r = await client.post(f"{LIST}/{uuid.uuid4()}/retry", headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")


# ---------------------------------------------------------------- the list (N15)
@requires_db
async def test_the_list_is_newest_first_with_the_board_key_and_no_platform_words(desk, db_session):
    ward, fake, stay, client, app = desk
    await client.post(_send(stay), headers=ward.auth["admin"])
    await db_session.execute(text("UPDATE tres_deliveries SET last_error = NULL"))
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = now()"))
    await db_session.commit()
    r = await client.get(LIST, headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    answer = r.json()
    assert answer["environment"] == "test" and answer["session_refused_at"] is not None and answer["next"] is None
    items = answer["items"]
    assert len(items) == 5 and {i["board_key"] for i in items} == {"202600000101"}
    assert [i["updated_at"] for i in items] == sorted((i["updated_at"] for i in items), reverse=True)
    assert all("last_error" not in i for i in items) and "AB12C3D" not in r.text
    only = (await client.get(LIST, params={"type": "vital", "status": "sent"}, headers=ward.auth["admin"])).json()
    assert [i["resource_type"] for i in only["items"]] == ["vital", "vital"]
    stay_rows = (await client.get(LIST, params={"admission": str(stay.id)}, headers=ward.auth["admin"])).json()
    assert len(stay_rows["items"]) == 5
    assert (await client.get(LIST, params={"environment": "live"}, headers=ward.auth["admin"])).json()["items"] == []
    for params, code in (({"status": "done"}, "tres_filter"), ({"type": "imaging"}, "tres_filter"),
                         ({"environment": "prod"}, "tres_filter"), ({"cursor": "not-a-cursor"}, "tres_cursor")):
        r = await client.get(LIST, params=params, headers=ward.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, code), params


@requires_db
async def test_the_list_pages_by_its_cursor(desk, db_session, monkeypatch):
    from homunculus.tres import deliveries
    monkeypatch.setattr(deliveries, "PAGE", 2)
    ward, fake, stay, client, app = desk
    await client.post(_send(stay), headers=ward.auth["admin"])
    seen, cursor = [], None
    while True:
        params = {"cursor": cursor} if cursor else {}
        page = (await client.get(LIST, params=params, headers=ward.auth["admin"])).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next"]
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 5


# ---------------------------------------------------------------- a stay by its key, its preview (D25)
@requires_db
async def test_a_stay_is_found_by_its_protocol_number(desk):
    ward, fake, stay, client, app = desk
    r = await client.get(FIND, params={"key": "202600000101"}, headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    assert r.json()["admission_id"] == str(stay.id) and r.json()["state"] == "DISCHARGED"
    r = await client.get(FIND, params={"key": "209900000001"}, headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")


@requires_db
async def test_the_preview_rebuilds_the_stay_writes_nothing_and_is_audited(desk, db_session):
    ward, fake, stay, client, app = desk
    app.state.tres_egress = False                                               # allowed with the locks closed
    await db_session.execute(text("UPDATE tres_settings SET mode = 'off'"))
    await db_session.commit()
    r = await client.get(f"/admin/tres/admissions/{stay.id}/preview", headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [(i["resource_type"], i["held"], i["status"]) for i in items] == [
        ("patient", False, None), ("practitioner", False, None), ("encounter", False, None), ("vital", False, None),
        ("vital", False, None)]
    assert items[0]["resource"]["identifier"][0]["value"] == "AB12C3D"         # the body itself: PHI, audited
    assert fake.requests == []
    assert (await db_session.execute(select(TresDelivery))).scalars().all() == []
    (row,) = _audit(app, "tres.preview")
    assert row.payload == {"actor": ward.users["admin"].username, "admission_id": str(stay.id)}


@requires_db
async def test_another_tenants_stay_and_rows_are_never_reached(desk, db_session):
    ward, fake, stay, client, app = desk
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresDelivery(tenant_id=other.id, environment="test", resource_type="patient",
                                local_id="hmn-p-baska.", status="stuck"))
    await db_session.commit()
    foreign = (await db_session.execute(select(TresDelivery.id).where(TresDelivery.tenant_id == other.id))).scalar_one()
    assert (await client.get(LIST, headers=ward.auth["admin"])).json()["items"] == []
    r = await client.post(f"{LIST}/{foreign}/retry", headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")
    for who in ("nurse", "doctor", "auditor"):
        assert (await client.get(LIST, headers=ward.auth[who])).status_code == 403, who
        assert (await client.post(_send(stay), headers=ward.auth[who])).status_code == 403, who
        assert (await client.get(f"/admin/tres/admissions/{stay.id}/preview",
                                 headers=ward.auth[who])).status_code == 403, who
```

The route table: In `homunculus-engine/tests/test_route_permissions.py` replace
```python
    "homunculus.tres.maps",             # TRƏS-01 F1: the two maps
}
```
with
```python
    "homunculus.tres.maps",             # TRƏS-01 F1: the two maps
    "homunculus.tres.deliveries",       # TRƏS-01 F1: the ledger, the preview, the hand
}
```

In `homunculus-engine/tests/test_route_permissions.py` replace
```python
    ("PUT", "/admin/tres/practitioners/{user_id}"): ANY("tres.manage"),
}
```
with
```python
    ("PUT", "/admin/tres/practitioners/{user_id}"): ANY("tres.manage"),
    # tres/deliveries.py — TRƏS-01 F1 (spec §6, D9, D21, D25): the ledger, a stay, its preview, the hand
    ("GET", "/admin/tres/deliveries"): ANY("tres.manage"),
    ("GET", "/admin/tres/admissions"): ANY("tres.manage"),
    ("GET", "/admin/tres/admissions/{admission_id}/preview"): ANY("tres.manage"),
    ("POST", "/admin/tres/admissions/{admission_id}/send"): ANY("tres.manage"),
    ("POST", "/admin/tres/deliveries/{delivery_id}/retry"): ANY("tres.manage"),
}
```

In `homunculus-engine/tests/test_route_permissions.py` replace
```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 82      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending; TRƏS-01 F0: +3, the settings read and write, the connection test; F1: +4, the two maps
```
with
```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 87      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending; TRƏS-01 F0: +3, the settings read and write, the connection test; F1: +4, the two maps, +5, the ledger, a stay, the preview, send, retry
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_route_permissions.py tests/test_tres_deliveries.py 2>&1 | tail -3`
Expected: `1 failed, 8 passed, 16 skipped` — `test_no_table_entry_lacks_a_route`.

- [ ] **Step 3: The codes**

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
TRES_NAME = "tres_name"                              # F1: a practitioner's name part empty or over 100 characters
```
with
```python
TRES_NAME = "tres_name"                              # F1: a practitioner's name part empty or over 100 characters
TRES_FILTER = "tres_filter"                          # F1: a ledger filter that names no status, type or environment
TRES_CURSOR = "tres_cursor"                          # F1: a cursor the ledger's list did not write
TRES_STAY_UNKNOWN = "tres_stay_unknown"              # F1: no stay of this tenant by that id or key
TRES_OFF = "tres_off"                                # F1: the tenant's mode is off (a hand send, a retry)
TRES_BUSY = "tres_busy"                              # F1: a round holds the stay's rows (N12): try again
TRES_LOGIN_REFUSED = "tres_login_refused"            # F1: the platform refused the login; the tenant is parked
TRES_PLATFORM_UNAVAILABLE = "tres_platform_unavailable"   # F1: no answer, an outage or a server error
```

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
                   TRES_LIVE_CLOSED, TRES_UNIT_UNKNOWN, TRES_DEPARTMENT_CODE, TRES_DEPARTMENT_DISPLAY,
                   TRES_USER_UNKNOWN, TRES_FIN_FORMAT, TRES_NAME})
```
with
```python
                   TRES_LIVE_CLOSED, TRES_UNIT_UNKNOWN, TRES_DEPARTMENT_CODE, TRES_DEPARTMENT_DISPLAY,
                   TRES_USER_UNKNOWN, TRES_FIN_FORMAT, TRES_NAME, TRES_FILTER, TRES_CURSOR, TRES_STAY_UNKNOWN,
                   TRES_OFF, TRES_BUSY, TRES_LOGIN_REFUSED, TRES_PLATFORM_UNAVAILABLE})
```

In `homunculus-engine/src/homunculus/tres/errors.py` replace
```python
    TRES_NAME: "The family and the given name are required, each at most 100 characters.",
}
```
with
```python
    TRES_NAME: "The family and the given name are required, each at most 100 characters.",
    TRES_FILTER: "A filter names no known status, record type or environment.",
    TRES_CURSOR: "The page cursor is not one this list wrote.",
    TRES_STAY_UNKNOWN: "No stay of this hospital has that id or number.",
    TRES_OFF: "The feed's mode is off for this hospital.",
    TRES_BUSY: "A round is sending this stay right now; try again in a moment.",
    TRES_LOGIN_REFUSED: "The platform refused the login; the feed waits until the account is saved again or a "
                        "connection test succeeds.",
    TRES_PLATFORM_UNAVAILABLE: "The platform did not answer, or answered with an error; nothing more was sent.",
}
```

- [ ] **Step 4: The routes**

Create `homunculus-engine/src/homunculus/tres/deliveries.py`:
```python
# homunculus-engine/src/homunculus/tres/deliveries.py
"""Yönetim › TRƏS — what was sent, and a person's hand on it (TRƏS-01, spec §6, D9, D21, D24, D25;
plan F1, N12, N14, N15, O21). `tres.manage`, the caller's tenant only.

GET /admin/tres/deliveries?status=&type=&admission=&environment=&cursor= — the ledger, newest change
first, PAGE rows at a time (`next`: the cursor of the next page, or null), each row with its stay's
board key (the protocol number; the H-number of an older admission): status, skip reason,
attempts, operation, whether the platform holds it, when it is tried next. NO `last_error`: the
platform's words may echo a value — they are shown by the audited preview only (D25). The answer
also says which environment it lists and whether the platform refused the tenant's login
(`session_refused_at`, N15: the tab shows it at the top of the panel). `environment` defaults to
the selected one; `admission` is any admission of a stay; a filter the ledger cannot hold is 422
`tres_filter`, a cursor this route did not write 422 `tres_cursor`.

GET /admin/tres/admissions?key= — the stay a board key (protocol number, or an older admission's
H-number) belongs to: its last admission's id, the key, the state, the discharge. 404
`tres_stay_unknown`. What «Şimdi gönder» and the preview are asked for.

GET /admin/tres/admissions/{id}/preview — the stay's resources rebuilt as they would be sent
(package.PreviewSender: nothing is asked of the platform, nothing written to the ledger), each
with its ledger row's status and the platform's last words — PHI, so the read is audited
`tres.preview` `{"actor", "admission_id"}` (D25). Allowed whatever the locks say: an administrator
checks the mappings before turning the feed on.

POST /admin/tres/admissions/{id}/send — «Şimdi gönder» (D9): the stay's package now, whether or not
it is due — an admitted patient goes as `in-progress`. POST /admin/tres/deliveries/{id}/retry —
«Yeniden dene» (D21, O21): the package of the row's stay with `force`, so a `stuck` row (or one in
its 30-minute wait) is tried now. Both:
* 409 `egress_off` (the install's lock), `tres_off` (the tenant's mode), `tres_account_incomplete`,
  `tres_live_closed` (the live platform, closed in this version), `tres_host_not_allowed`;
* run under a LOCK TIMEOUT (N12): a row a round holds is waited for HAND_LOCK_TIMEOUT_MS at most,
  then 409 `tres_busy` — try again — never a request that hangs behind a round;
* a login the platform refuses parks the tenant as a round would (worker.park, N15: only while
  the settings are the ones the request began on) — 409 `tres_login_refused`; an outage or a
  server error is 503 `tres_platform_unavailable`;
* answer the rows the package touched (type, local id, status, reason — no value);
* are audited AFTER the attempt (`tres.send`, `tres.retry`): the actor, the admission (and the
  delivery for a retry), the result's code and, when it ran to its end, the counts by type and
  status. A refused precondition (the 409s above, a 404) asked nothing and writes no row."""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timezone
from functools import partial

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tres.client import TresError, TresLoginRefused
from homunculus.tres.egress import TresEgressRefused, live_closed, open_client
from homunculus.tres.errors import (
    EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_BUSY, TRES_CURSOR, TRES_FILTER, TRES_LIVE_CLOSED, TRES_LOGIN_REFUSED,
    TRES_OFF, TRES_PLATFORM_UNAVAILABLE, TRES_STAY_UNKNOWN, refusal,
)
from homunculus.tres.ledger import HAND_LOCK_TIMEOUT_MS, LedgerBusy
from homunculus.tres.models import ENVIRONMENTS, RESOURCE_TYPES, STATUSES, TresDelivery, TresSettings, account_of
from homunculus.tres.package import PreviewSender, run
from homunculus.tres.source import chain_of
from homunculus.tres.worker import Sender, park

router = APIRouter(prefix="/admin/tres", tags=["tres"])

#: Rows per page of the ledger's list.
PAGE = 50


class DeliveryOut(BaseModel):
    id: uuid.UUID
    resource_type: str
    local_id: str
    status: str
    reason: str | None
    attempts: int
    operation: str | None
    remote_id: str | None
    next_attempt_at: datetime | None
    updated_at: datetime
    admission_id: uuid.UUID | None
    board_key: str | None


class DeliveriesOut(BaseModel):
    environment: str
    session_refused_at: datetime | None
    items: list[DeliveryOut]
    next: str | None


class StayOut(BaseModel):
    admission_id: uuid.UUID
    board_key: str
    state: str
    discharge_at: datetime | None


class RowOut(BaseModel):
    resource_type: str
    local_id: str
    status: str
    reason: str | None


class HandOut(BaseModel):
    admission_id: uuid.UUID
    rows: list[RowOut]
    counts: dict[str, dict[str, int]]


class PreviewItem(BaseModel):
    resource_type: str
    local_id: str
    held: bool
    reason: str | None
    resource: dict | None
    status: str | None                 # the ledger row's, when there is one
    last_error: str | None             # the platform's last words for it (may echo a value: audited read)


class PreviewOut(BaseModel):
    admission_id: uuid.UUID
    board_key: str
    environment: str
    items: list[PreviewItem]


def _cursor(row_updated_at: datetime, row_id: uuid.UUID) -> str:
    raw = f"{row_updated_at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _uncursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        at, row_id = raw.split("|")
        when = datetime.fromisoformat(at)
        if when.tzinfo is None:
            raise ValueError("no zone")
        return when, uuid.UUID(row_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise refusal(422, TRES_CURSOR).http() from None


async def _settings(db: AsyncSession, tenant_id: uuid.UUID) -> TresSettings | None:
    return await db.get(TresSettings, tenant_id, populate_existing=True)


async def _stay(db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> list[Admission]:
    chain = await chain_of(db, tenant_id, admission_id)
    if not chain:
        raise refusal(404, TRES_STAY_UNKNOWN).http()
    return chain


async def _key_of(db: AsyncSession, last: Admission) -> str:
    number = (await db.execute(select(Patient.patient_number).where(Patient.id == last.patient_id))).scalar_one()
    return board_key(last.protocol_no, number)


@router.get("/deliveries", response_model=DeliveriesOut)
async def list_deliveries(
    status: str | None = None,
    type: str | None = Query(default=None),       # noqa: A002 — the query parameter's name (spec §6)
    admission: uuid.UUID | None = None,
    environment: str | None = None,
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> DeliveriesOut:
    if (status is not None and status not in STATUSES) or (type is not None and type not in RESOURCE_TYPES) \
            or (environment is not None and environment not in ENVIRONMENTS):
        raise refusal(422, TRES_FILTER).http()
    settings = await _settings(db, caller_tenant)
    env = environment or (settings.environment if settings is not None else "test")
    query = (select(TresDelivery, Admission.protocol_no, Patient.patient_number)
             .outerjoin(Admission, Admission.id == TresDelivery.admission_id)
             .outerjoin(Patient, Patient.id == Admission.patient_id)
             .where(TresDelivery.tenant_id == caller_tenant, TresDelivery.environment == env))
    if status is not None:
        query = query.where(TresDelivery.status == status)
    if type is not None:
        query = query.where(TresDelivery.resource_type == type)
    if admission is not None:
        query = query.where(TresDelivery.admission_id == (await _stay(db, caller_tenant, admission))[-1].id)
    if cursor is not None:
        at, row_id = _uncursor(cursor)
        query = query.where(or_(TresDelivery.updated_at < at,
                                and_(TresDelivery.updated_at == at, TresDelivery.id < row_id)))
    rows = (await db.execute(query.order_by(TresDelivery.updated_at.desc(), TresDelivery.id.desc())
                             .limit(PAGE + 1))).all()
    items = [DeliveryOut(id=row.id, resource_type=row.resource_type, local_id=row.local_id, status=row.status,
                         reason=row.reason, attempts=row.attempts, operation=row.operation, remote_id=row.remote_id,
                         next_attempt_at=row.next_attempt_at, updated_at=row.updated_at,
                         admission_id=row.admission_id,
                         board_key=board_key(protocol, number) if number is not None else None)
             for row, protocol, number in rows[:PAGE]]
    last = rows[PAGE - 1][0] if len(rows) > PAGE else None
    return DeliveriesOut(environment=env, items=items,
                         session_refused_at=settings.session_refused_at if settings is not None else None,
                         next=_cursor(last.updated_at, last.id) if last is not None else None)


@router.get("/admissions", response_model=StayOut)
async def find_stay(
    key: str,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> StayOut:
    key = key.strip()
    found = (await db.execute(
        select(Admission.id).join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.tenant_id == caller_tenant,
               or_(Admission.protocol_no == key,
                   and_(Admission.protocol_no.is_(None), Patient.patient_number == key)))
        .order_by(Admission.created_at, Admission.id))).scalars().first()
    if found is None:
        raise refusal(404, TRES_STAY_UNKNOWN).http()
    last = (await _stay(db, caller_tenant, found))[-1]
    return StayOut(admission_id=last.id, board_key=await _key_of(db, last), state=last.state.value,
                   discharge_at=last.discharge_at if last.state == AdmissionState.DISCHARGED else None)


@router.get("/admissions/{admission_id}/preview", response_model=PreviewOut)
async def preview(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> PreviewOut:
    actor = user.username
    last = (await _stay(db, caller_tenant, admission_id))[-1]
    settings = await _settings(db, caller_tenant)
    environment = settings.environment if settings is not None else "test"
    stay = await request.app.state.tres_source.load(db, caller_tenant, last.id)
    sender = PreviewSender(db, tenant_id=caller_tenant, environment=environment)
    organization = getattr(settings, f"{environment}_organization_id", None) if settings is not None else None
    await run(stay, sender, organization_id=organization)
    ledger = {(row.resource_type, row.local_id): row for row in (await db.execute(select(TresDelivery).where(
        TresDelivery.tenant_id == caller_tenant, TresDelivery.environment == environment,
        TresDelivery.admission_id == last.id))).scalars()}
    items = []
    for item in sender.items:
        row = ledger.get((item["resource_type"], item["local_id"]))
        items.append(PreviewItem(**item, status=row.status if row else None, last_error=row.last_error if row else None))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    trail.record(request, hospital, "tres.preview", patient_id=stay.board_key,
                 payload={"actor": actor, "admission_id": str(last.id)})
    return PreviewOut(admission_id=last.id, board_key=stay.board_key, environment=environment, items=items)


async def _hand(request: Request, db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID, *,
                force: bool) -> tuple[HandOut | None, str, str, uuid.UUID]:
    """A person's run of one stay's package: (the answer or None, the result code, the board key,
    the stay's last admission). Raises the refusals that ask nothing."""
    egress = bool(getattr(request.app.state, "tres_egress", False))
    if not egress:
        raise refusal(409, EGRESS_OFF).http()
    settings = await _settings(db, tenant_id)
    if settings is None or settings.mode == "off":
        raise refusal(409, TRES_OFF).http()
    account = account_of(settings)
    if account is None:
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http()
    if live_closed(settings.environment, account.base_url):
        raise refusal(409, TRES_LIVE_CLOSED).http()
    last = (await _stay(db, tenant_id, admission_id))[-1]
    # Plain values: a rollback below expires every object this session holds.
    key, last_id = await _key_of(db, last), last.id
    factory = getattr(request.app.state, "tres_client_factory", None) or partial(
        open_client, egress=egress, hosts=getattr(request.app.state, "tres_hosts", frozenset()))
    try:
        # Patient data: the factory's default, `patient_data=True`, keeps egress.open_client's own live
        # lock behind the check above (amendment 24, M10) — it would answer the same 409 `tres_live_closed`.
        client = factory(account)
    except TresEgressRefused as exc:
        raise refusal(409, exc.code).http() from None
    except ValueError:
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http() from None
    version, now = settings.updated_at, datetime.now(timezone.utc)
    sender = Sender(db, client, tenant_id=tenant_id, environment=settings.environment, mode=settings.mode,
                    now=now, enabled_types=settings.enabled_types or (), lock_timeout_ms=HAND_LOCK_TIMEOUT_MS)
    package = request.app.state.tres_source.package(db, settings, last_id, force=force)
    try:
        outcome = await package(sender)
    except LedgerBusy:
        await db.rollback()
        return None, TRES_BUSY, key, last_id
    except TresLoginRefused as exc:
        await db.rollback()
        await park(db, tenant_id=tenant_id, now=now, status=exc.status, version=version)
        return None, TRES_LOGIN_REFUSED, key, last_id
    except TresError:
        await db.rollback()
        return None, TRES_PLATFORM_UNAVAILABLE, key, last_id
    finally:
        await client.aclose()
    rows = [RowOut(resource_type=t, local_id=i, status=s, reason=r) for t, i, s, r in (outcome.rows if outcome else [])]
    return HandOut(admission_id=last_id, rows=rows, counts=outcome.counts() if outcome else {}), "sent", key, last_id


#: The status each result answers with.
_RESULT_STATUS = {TRES_BUSY: 409, TRES_LOGIN_REFUSED: 409, TRES_PLATFORM_UNAVAILABLE: 503}


async def _answer(request: Request, db: AsyncSession, tenant_id: uuid.UUID, event: str, payload: dict,
                  key: str, result: str, answer: HandOut | None) -> HandOut:
    hospital = await trail.hospital_of(db, tenant_id)
    await db.commit()
    payload = {**payload, "result": result, **({"counts": answer.counts} if answer is not None else {})}
    if event == "tres.send":
        trail.record(request, hospital, "tres.send", patient_id=key, payload=payload)
    else:
        trail.record(request, hospital, "tres.retry", patient_id=key, payload=payload)
    if answer is None:
        raise refusal(_RESULT_STATUS[result], result).http()
    return answer


@router.post("/admissions/{admission_id}/send", response_model=HandOut)
async def send_now(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> HandOut:
    actor = user.username
    answer, result, key, last_id = await _hand(request, db, caller_tenant, admission_id, force=False)
    return await _answer(request, db, caller_tenant, "tres.send", {"actor": actor, "admission_id": str(last_id)},
                         key, result, answer)


@router.post("/deliveries/{delivery_id}/retry", response_model=HandOut)
async def retry(
    delivery_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> HandOut:
    actor = user.username
    row = (await db.execute(select(TresDelivery.admission_id).where(
        TresDelivery.id == delivery_id, TresDelivery.tenant_id == caller_tenant))).first()
    if row is None or row.admission_id is None:
        raise refusal(404, TRES_STAY_UNKNOWN).http()
    answer, result, key, last_id = await _hand(request, db, caller_tenant, row.admission_id, force=True)
    return await _answer(request, db, caller_tenant, "tres.retry",
                         {"actor": actor, "delivery_id": str(delivery_id), "admission_id": str(last_id)},
                         key, result, answer)
```

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
    app.include_router(tres_maps_router)
    # G2-B1d (spec §5, D12): the bridge's patient query — the device token only, never proxied by
```
with
```python
    app.include_router(tres_maps_router)
    # TRƏS-01 F1: the ledger's list, a stay found by its key, its preview, «Şimdi gönder», «Yeniden dene».
    from homunculus.tres.deliveries import router as tres_deliveries_router
    app.include_router(tres_deliveries_router)
    # G2-B1d (spec §5, D12): the bridge's patient query — the device token only, never proxied by
```

A stay's id and a ledger row's never reach nginx's access log (amendment 22):

In `deploy/local/web/nginx.conf` replace
```
    # TRƏS-01 F1: a stay (its last admission), a ledger row, a practitioner's user — never a key in the log.
    ~^/admin/tres/practitioners/[^/]+$                       /admin/tres/practitioners/:id;
```
with
```
    # TRƏS-01 F1: a stay (its last admission), a ledger row, a practitioner's user — never a key in the log.
    ~^/admin/tres/admissions/[^/]+/(?<act>preview|send)$     /admin/tres/admissions/:id/$act;
    ~^/admin/tres/deliveries/[^/]+/retry$                    /admin/tres/deliveries/:id/retry;
    ~^/admin/tres/practitioners/[^/]+$                       /admin/tres/practitioners/:id;
```

In `deploy/local/web/nginx.conf` replace
```
    # Anything else below a prefix that carries a key or an id, whole: LAST.
    ~^/(?<pre>patients|clinical|scores/sofa|alerts|admissions|handovers|break-glass|scope|infinity-waves|tasks|admin/users|admin/groups|admin/ldap/group-mappings|admin/tres/practitioners|tenant/(?:beds|rooms|sites|tenants|units))/.   /$pre/:redacted;
}
```
with
```
    # Anything else below a prefix that carries a key or an id, whole: LAST.
    ~^/(?<pre>patients|clinical|scores/sofa|alerts|admissions|handovers|break-glass|scope|infinity-waves|tasks|admin/users|admin/groups|admin/ldap/group-mappings|admin/tres/(?:admissions|deliveries|practitioners)|tenant/(?:beds|rooms|sites|tenants|units))/.   /$pre/:redacted;
}
```

- [ ] **Step 5: The labels and the words on the dashboard (N5)**

In `dashboard/src/live/screens/denetim/denetim.js` replace
```js
  ["tres.map", "tresMap"], ["tres.identity", "tresIdentity"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));
```
with
```js
  ["tres.map", "tresMap"], ["tres.identity", "tresIdentity"],
  // TRƏS-01 F1 (spec D24, D25): a stay sent by hand, a delivery retried, a stay's preview read (tres/deliveries.py).
  ["tres.send", "tresSend"], ["tres.retry", "tresRetry"], ["tres.preview", "tresPreview"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresMap: "TRƏS bölüm eşlemesi değişti", tresIdentity: "TRƏS hekim kimliği değişti",
    },
```
with
```js
      tresMap: "TRƏS bölüm eşlemesi değişti", tresIdentity: "TRƏS hekim kimliği değişti",
      tresSend: "TRƏS: yatış elle gönderildi", tresRetry: "TRƏS: gönderim yeniden denendi", tresPreview: "TRƏS: gönderim önizlemesi açıldı",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresMap: "TRƏS şöbə uyğunlaşdırması dəyişdirildi", tresIdentity: "TRƏS həkim identifikasiyası dəyişdirildi",
    },
```
with
```js
      tresMap: "TRƏS şöbə uyğunlaşdırması dəyişdirildi", tresIdentity: "TRƏS həkim identifikasiyası dəyişdirildi",
      tresSend: "TRƏS: yatış əl ilə göndərildi", tresRetry: "TRƏS: göndəriş yenidən cəhd edildi", tresPreview: "TRƏS: göndərişin ilkin baxışı açıldı",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresMap: "Изменено сопоставление отделений TRƏS", tresIdentity: "Изменены данные врача для TRƏS",
    },
```
with
```js
      tresMap: "Изменено сопоставление отделений TRƏS", tresIdentity: "Изменены данные врача для TRƏS",
      tresSend: "TRƏS: госпитализация отправлена вручную", tresRetry: "TRƏS: отправка повторена", tresPreview: "TRƏS: открыт предпросмотр отправки",
    },
```

In `dashboard/src/live/i18n/strings/denetim.js` replace
```js
      tresMap: "TRƏS department map changed", tresIdentity: "TRƏS practitioner identity changed",
    },
```
with
```js
      tresMap: "TRƏS department map changed", tresIdentity: "TRƏS practitioner identity changed",
      tresSend: "TRƏS: a stay sent by hand", tresRetry: "TRƏS: a delivery retried", tresPreview: "TRƏS: a send preview opened",
    },
```

In `dashboard/src/live/screens/denetim/denetim.test.js` replace
```js
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(59);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings; + F1's tres.package, tres.map, tres.identity
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(59);
    expect(typeKey("tres.package")).toBe("denetim.type.tresPackage");     // TRƏS-01 F1
```
with
```js
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(62);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings; + F1's tres.package, tres.map, tres.identity, tres.send, tres.retry, tres.preview
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(62);
    expect(typeKey("tres.package")).toBe("denetim.type.tresPackage");     // TRƏS-01 F1
```

In `dashboard/src/live/screens/denetim/denetim.test.js` replace
```js
    expect(typeKey("tres.identity")).toBe("denetim.type.tresIdentity");
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
```
with
```js
    expect(typeKey("tres.identity")).toBe("denetim.type.tresIdentity");
    expect(typeKey("tres.send")).toBe("denetim.type.tresSend");
    expect(typeKey("tres.retry")).toBe("denetim.type.tresRetry");
    expect(typeKey("tres.preview")).toBe("denetim.type.tresPreview");
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
```

In `dashboard/src/live/apiErrors.js` replace
```js
  ["tres_name", "tres.err.name"],
]);
```
with
```js
  ["tres_name", "tres.err.name"],
  ["tres_filter", "tres.err.filter"],                   // F1: the ledger's list, a stay, the hand (tres/deliveries.py)
  ["tres_cursor", "tres.err.cursor"],
  ["tres_stay_unknown", "tres.err.stayUnknown"],
  ["tres_off", "tres.err.off"],
  ["tres_busy", "tres.err.busy"],
  ["tres_login_refused", "tres.err.loginRefused"],
  ["tres_platform_unavailable", "tres.err.platformUnavailable"],
]);
```

In `dashboard/src/live/apiErrors.test.js` replace
```js
    "tres_live_closed", "tres_unit_unknown", "tres_department_code", "tres_department_display", "tres_user_unknown",
    "tres_fin_format", "tres_name"];
```
with
```js
    "tres_live_closed", "tres_unit_unknown", "tres_department_code", "tres_department_display", "tres_user_unknown",
    "tres_fin_format", "tres_name", "tres_filter", "tres_cursor", "tres_stay_unknown", "tres_off", "tres_busy",
    "tres_login_refused", "tres_platform_unavailable"];
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      name: "Soyad ve ad gerekli, her biri en çok 100 karakter.",
    },
```
with
```js
      name: "Soyad ve ad gerekli, her biri en çok 100 karakter.",
      filter: "Süzgeçte bilinmeyen bir durum, kayıt türü ya da ortam var.",
      cursor: "Sayfa işareti geçersiz; listeyi yeniden açın.",
      stayUnknown: "Bu numarayla bu hastanede bir yatış yok.",
      off: "Bu hastanede gönderim kipi «Kapalı».",
      busy: "Bu yatış şu anda otomatik turda gönderiliyor; biraz sonra yeniden deneyin.",
      loginRefused: "Platform girişi reddetti; hesap kaydedilene ya da bağlantı sınaması başarılı olana kadar gönderim bekler.",
      platformUnavailable: "Platform yanıt vermedi ya da hata verdi; başka bir şey gönderilmedi.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      name: "Soyad və ad tələb olunur, hər biri ən çoxu 100 simvol.",
    },
```
with
```js
      name: "Soyad və ad tələb olunur, hər biri ən çoxu 100 simvol.",
      filter: "Filtrdə naməlum status, qeyd növü və ya mühit var.",
      cursor: "Səhifə nişanı etibarsızdır; siyahını yenidən açın.",
      stayUnknown: "Bu nömrə ilə bu xəstəxanada yatış yoxdur.",
      off: "Bu xəstəxanada göndəriş rejimi «Bağlı»dır.",
      busy: "Bu yatış hazırda avtomatik dövrədə göndərilir; bir azdan yenidən cəhd edin.",
      loginRefused: "Platforma girişi rədd etdi; hesab yadda saxlanılana və ya bağlantı yoxlaması uğurlu olana qədər göndəriş gözləyir.",
      platformUnavailable: "Platforma cavab vermədi və ya xəta qaytardı; başqa heç nə göndərilmədi.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      name: "Фамилия и имя обязательны, каждое не длиннее 100 символов.",
    },
```
with
```js
      name: "Фамилия и имя обязательны, каждое не длиннее 100 символов.",
      filter: "В фильтре неизвестный статус, вид записи или среда.",
      cursor: "Метка страницы недействительна; откройте список заново.",
      stayUnknown: "В этой больнице нет госпитализации с таким номером.",
      off: "Режим отправки в этой больнице — «Выключено».",
      busy: "Эта госпитализация сейчас отправляется автоматическим циклом; повторите чуть позже.",
      loginRefused: "Платформа отклонила вход; отправка ждёт, пока учётная запись не будет сохранена заново или проверка соединения не пройдёт успешно.",
      platformUnavailable: "Платформа не ответила или вернула ошибку; больше ничего не отправлено.",
    },
```

In `dashboard/src/live/i18n/strings/tres.js` replace
```js
      name: "The family and the given name are required, each at most 100 characters.",
    },
```
with
```js
      name: "The family and the given name are required, each at most 100 characters.",
      filter: "A filter names an unknown status, record type or environment.",
      cursor: "The page marker is not valid; open the list again.",
      stayUnknown: "This hospital has no stay with that number.",
      off: "The feed's mode is «Off» for this hospital.",
      busy: "An automatic round is sending this stay right now; try again in a moment.",
      loginRefused: "The platform refused the login; sending waits until the account is saved again or a connection test succeeds.",
      platformUnavailable: "The platform did not answer, or answered with an error; nothing more was sent.",
    },
```

- [ ] **Step 6: Run them to see them pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_route_permissions.py tests/test_tres_deliveries.py tests/test_access_log_redaction.py tests/test_nginx_routes.py 2>&1 | tail -3`
Expected: `73 passed, 16 skipped`.
Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_deliveries.py 2>&1 | tail -3`
Expected: `10 passed` (about 45 s).
Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/screens/denetim src/live/rawKeys.test.jsx 2>&1 | tail -4`
Expected: every file passed.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/deliveries.py homunculus-engine/src/homunculus/tres/errors.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tres_deliveries.py deploy/local/web/nginx.conf dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/tres.js && git commit -m "feat(tres-01): F1 — the ledger's list, a stay by its key, the audited preview, «Şimdi gönder» and «Yeniden dene» (busy, never waiting behind a round; a refused login parks); tres.send, tres.retry, tres.preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Engine gates (and the dashboard's, for the lines F1a touched)

- [ ] **Step 1: The feed's files, no database**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_codes.py tests/test_tres_az.py tests/test_tres_mapping.py tests/test_fake_tres.py tests/test_tres_client.py tests/test_tres_egress.py tests/test_tres_package.py tests/test_tres_source.py tests/test_tres_maps.py tests/test_tres_deliveries.py tests/test_tres_models.py tests/test_migration_0020_tres.py tests/test_tres_ledger.py tests/test_tres_worker.py tests/test_tres_settings.py tests/test_route_permissions.py tests/test_permissions.py 2>&1 | tail -3`
Expected: `364 passed, 161 skipped` (as first planned `299 passed, 152 skipped`; +46 passed from amendment 23's tests of Tasks 1–3; +19 passed / +9 skipped from amendment 24's tests and the one Task 10 adds; before F1: `220 passed, 116 skipped`).

- [ ] **Step 2: The whole no-DB suite** — Task 0, Step 4's six chunks. Expected: no `failed`; against the baseline **+144 passed and +45 skipped** (4343 passed / 1473 skipped: +79 / +36 as measured on the scratch copy, +46 passed from amendment 23's tests, +19 passed / +9 skipped from amendment 24's tests and the one Task 10 adds), nothing else moved. Write the numbers into the Gates block.

- [ ] **Step 3: Postgres, one file or chunk at a time** (one session at a time; tell the controller before a long wait). Each command's expected line:
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_migration_0020_tres.py tests/test_tres_models.py tests/test_route_permissions.py tests/test_migration_0010_schema_parity.py 2>&1 | tail -1` → `44 passed` (about 2 min)
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_worker.py 2>&1 | tail -1` → `40 passed` (about 2 min)
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_ledger.py -k "not (refusal_about_the_resource or sandbox_row or skip_is_a_row or carries_the_admission or mode_off or two_deliverers or search_that_cannot or server_error_about or read_again or lock_timeout or held_reads)" 2>&1 | tail -1` → `23 passed, 21 deselected`
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_ledger.py -k "refusal_about_the_resource or sandbox_row or skip_is_a_row or carries_the_admission or mode_off or two_deliverers or search_that_cannot or server_error_about or read_again or lock_timeout or held_reads" 2>&1 | tail -1` → `21 passed, 23 deselected`
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_settings.py -k "bad_value or changed_address or dead_line or field_too_many or mode_on_the_live or narrowed_install or password_left_out or parked_tenant" 2>&1 | tail -1` → `17 passed, 56 deselected` (about 90 s)
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_settings.py -k "not (bad_value or changed_address or dead_line or field_too_many or mode_on_the_live or narrowed_install or password_left_out or parked_tenant)" 2>&1 | tail -1` → `56 passed, 17 deselected` (about 65 s)
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_package.py tests/test_tres_source.py tests/test_tres_maps.py 2>&1 | tail -1` → `24 passed` (about 75 s)
- `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_tres_deliveries.py 2>&1 | tail -1` → `10 passed` (about 45 s)

- [ ] **Step 4: The dashboard** — `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -6`. Expected: no `failed`; the baseline's file and test counts unchanged (F1a changed assertions and lists, not the number of tests).

- [ ] **Step 5: Hand over to F1b.** Tell the controller the head sha, the gate numbers, and that F1b (`docs/superpowers/plans/2026-11-12-tres-f1b-hasta-yatis.md`) is next. No commit in this task unless a gate showed a fix was needed (each fix its own commit, both suites green again).

---

## Spec coverage — F1a's share (F1b's table covers the panels)

| Spec | Where | Left |
|---|---|---|
| N1 the source in `create_app`, audit reads in a thread | Task 9 | — |
| D9 automatic: discharged, `settle_hours`; by hand at any time, `in-progress` | Task 9 (`due_stays`), Task 12 (send) | amended: a week's reach (amendment 5) |
| D5 + O20 local ids | Task 1 | F2–F5 follow the rule |
| D20 Patient rules | Task 2, Task 3 | blood group (O23); address, citizenship (O10) |
| D16 Practitioner | Task 3, Task 5, Task 11 | staff identity proper (H4) |
| D17 department map, `unit_unmapped` | Task 3, Task 5, Task 11 | the code list search (F2) |
| D8 package order (F1's types) | Task 8 | Conditions, Procedures, Composition, labs (F2–F5) |
| D10 first and last vitals, weight, height, no monitor samples | Task 3 (`readings_of`, `first_and_last`), Task 9 | — |
| D12 codes checked | Task 1 | — |
| D22 local time with offset | Task 3 (`instant`), Task 9 (zone) | — |
| D21 nightly retry, «Yeniden dene» (O21, N14) | Task 9, Task 12 | — |
| D24 `tres.map`, `tres.identity`, `tres.send`, `tres.retry`, `tres.preview`, `tres.package` | Tasks 9, 11, 12 | the clinical records' events (F2–F5) |
| D25 preview audited; no body stored or listed | Task 8 (`PreviewSender`), Task 12 | — |
| §6 deliveries, retry, send, preview, departments, practitioners | Tasks 11, 12 | codes (F4), terminology (F2), clinical routes (F2–F5) |
| §9 the stand-in's profiles (N6) | Task 4 | F2–F5 add theirs |
| §7 nginx: the new parametrized routes redacted in the access log | Tasks 11, 12 | — |
| O14, O15, O5 guard, N2, N3, N12, N14, N15 | amendments 2, 6, 7, 3, 4, 9, 8, 10 | O15 and O5 await the owner |
