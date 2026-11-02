# G2-A4 SOFA formu — the severity form filled, completed, previewed and signed from the patient screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The patient screen gets a «SOFA formu» box (the form's total, how many organs it has no measurement for, the last signature or «imzalanmadı») and a «Formu aç» dialog that shows the engine's six organ rows in the source's order, lets a `clinical.chart` holder complete a missing input through `/clinical`, lets a `scores.sign` holder correct a measured value with a reason, and signs only after the engine has previewed exactly that.

**Architecture:** The engine already builds, re-scores and signs the form (`scoring/sofa_form.py`, `scoring/signing.py`, `api/app.py`); it gains one chartable flag and four slip bounds at the door (`api/clinical.py`), `last_signed` and `min_reason_chars` on `GET /scores/sofa/{id}`, `preview: true` on the POST (same parsing, same refusals, no audit row), and the door's slip bounds on a correction (`parse_overrides(..., bounds=PLAUSIBLE)`, for a preview and a signature alike). The dashboard gets `preview` on `backendApi.signSeverityForm`, three store methods (`sofaForm`, `sofaPreview`, `sofaSign`), a `sofa` strings namespace in four languages, and a new folder `live/screens/patient/sofa/`: `sofaFields.js` (tables and pure rules), `SofaEditors.jsx` (the completion and correction editors), `SofaFormModal.jsx` (the dialog), `SofaBox.jsx` (the box), each with its tests; `PatientScreen.jsx` mounts the box where the «formlar yakında» note stood.

**Tech Stack:** Python 3.12 / FastAPI / pytest (engine); React 18, Vite, Vitest + Testing Library (dashboard).

**Spec (authoritative):** `docs/superpowers/specs/2026-11-01-g2a-a4-sofa-formu-design.md` (D1–D11, O1 closed: mg/dL; commits `ae1dcaa`, `9303a07`). The contract decisions the controller took on 2026-11-01 (the `CHARTABLE`/`PLAUSIBLE` additions, the shape of `last_signed`, the shape of the preview answer, the three store methods, the folder and its files) are written into the tasks as given, and so is the coordinator's later change of the same day: O6 moves into this slice — the server holds a correction to the door's bounds (Task 3b). Where the code made the spec's letter impossible, unsafe or merely unspecified, this plan departs from it; every departure is numbered below and tagged in the code.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Spec / contract | Code at `9303a07` / what was found | This plan |
|---|---|---|---|
| X1 | §3: strings in `patient.js` **or** a new `sofa.js` namespace | `patient.js` is 638 lines; `i18n/catalog.js`'s header asks a new namespace for one import and one entry, each with a blank line either side | A new namespace `sofa` (`strings/sofa.js`, keys `sofa.*`) and its two lines in `catalog.js`, lane-marked `G2-A4`. `patient.js` changes only for `onlyWrite` and the removed `formsSoon` (Task 10) |
| X2 | Contract: "if the body has `preview: true`" | `sign_sofa_form` takes `body: dict`; read by truthiness, `"false"` would **preview** and `0`, `""` or `null` would **sign** (`bool("true")` and `bool("false")` are both true — reworded after the engine review) | Only a real boolean: a flag whose meaning depends on its spelling is refused, not guessed. `preview` must be a JSON boolean; anything else is 400 `preview true ya da false olmalı`, checked after the permission and device refusals, before anything is read. *Superseded after the final review by X19: the preview is its own route and the flag is gone.* |
| X3 | Contract: preview "keeps every refusal" | `sign_score` refuses an unnamed signer (`signing.py:146–149`) | The preview path runs `sign_score` too and discards its result, so that refusal holds for a preview as well |
| X4 | D10: "the refusal in text as well as the toast" | `admin/refusal.js:8–13`: a refusal goes on the toast, "never ALSO as an inline `Alert`" (one `role="alert"` each would announce it twice); A3 resolved the same tension as toast-only (its X7) | Both: the toast (named after the bed) is the one announcement; the dialog's footer repeats the sentence as **plain text** (`<p>`, not a live region, not an `Alert`) |
| X5 | D1: «İmzalandı · {who} · {HH:MM} · toplam {n}» | The house `dayStamp` (`i18n/dates.js:28`) adds `dd.MM` for a stamp that is not today's (A3 X4) | The signature time, every measured time and the window bounds use `dayStamp`: a signature from yesterday must not read as this morning's |
| X6 | §3 lists no change to the screen's "what this screen writes" sentence | `patient.onlyWrite` says "three things", and `PatientScreen.jsx:1–6` says so too | `onlyWrite` (four languages) and the header comment name the fourth write (the SOFA form's measurements) and the signature (`scores.sign`, a row in the audit chain) |
| X7 | D5: a correction replaces the value | `parse_overrides` (`signing.py:85–136`) had no plausibility bound; the door's are in `clinical.py:139–153` | The server holds a correction to the door's bounds (Task 3b: `parse_overrides(..., bounds=PLAUSIBLE)`, preview and signature alike — O6, moved into this slice); the browser **mirrors** that bound for the six inputs and the pressors (MAP has none at the door; its correction is held to the engine's 0–300 mmHg, `CORRECTION_BOUNDS`, which the browser mirrors since review 3, M-4) so a slip is held before it is sent. The server is the guard; the browser is a courtesy |
| X8 | D3: the measurement time is "now by default" | A3's form follows the clock until touched and reads it again at the press (its X3, final review I2) | The same: an untouched time is the moment Save is pressed |
| X9 | D1/D7: the box shows the form's total and signature | The box reads once per patient; an open dialog may be used an hour later | The dialog reads the form itself when it opens (one more `score` audit row per opening — spec O4 accepted) rather than reusing the box's read |
| X10 | D3/D5/D6: the controls for their right's holders | — | «Formu aç» is offered to every holder of `board.view` (the form read-only without the rights); an absent control is explained in a sentence (`sofa.chartNoRightNote`, `sofa.signNoRightNote`), never a disabled button |
| X11 | D6: «İmzala» sends the same corrections | The engine re-scores at signing from the record as it is then (`app.py:1509–1516`); another desk may have charted since the preview | When the signed total differs from the previewed one the toast says so (`sofa.signedDiffers`, warn). The engine's number stands |
| X12 | D6: «Önizle», then «İmzala» | — | «İmzala» is offered only on a preview of exactly the corrections held now (`correctionsKey`); with no correction too — a preview of none comes first. The box prints the read's time (`window_to`) |
| X13 | — | An engine older than this slice ignores `preview` and **signs**; it also sends no `min_reason_chars` | No correction, preview or signature is offered on a form without `min_reason_chars`; the footer says why (`sofa.signOldEngine`). A web of this slice on an older API cannot sign by accident |
| X14 | D3: support "yes/no" | `sofa_form.py:141–148`: any support "yes" in the window counts the whole window as supported, else the latest; a charted "no" never cancels an in-window "yes" on the form. `rules/sofa.py:195` reads the latest | The support editor's hint says exactly that; the form has no support state to print (O5). *Superseded after the final review by X21: support is taken as of the worst reading and printed on the row.* |
| X15 | D7: `last_signed` or null | An engine older than this slice sends no `last_signed` key | The box prints no signature line at all then — not «İmzalanmadı», which would be a claim |
| X16 | D4: `ON_RESP_SUPPORT` chartable | `clinical.py:15–17` (rule 1: "Device channels are not writable here") and `_code` (:131–135, "bu alan cihazdan gelir"); the MEDIBUS bridge derives the flag (`medibus/medibus-mapping.example.json:10,21`, `medibus/src/medibus/bridge.py:81`; `tests/test_scenario_news2.py:123–124` lists it among the bridges' signals) | D4 is followed; the `CHARTABLE` comment says why a device-derived flag becomes chartable: the bridge only infers it and only ever says yes, no ventilator feeds the ward, and whether a patient is supported is seen at the bedside |
| X17 | Tasks 6–9: each commit leaves the suite green | `src/reachable.test.js` names any production module the page cannot reach, and the sofa modules are reachable only once Task 10 mounts the box | Accepted red on that one guard from Task 6 (`b70d031`) to Task 9 (`044becc`), A3's precedent (`40f97b8`); each commit message says so; green from Task 10 (`a172271`) on |
| X18 | D4: PLATELETS 0–2000 ×10³/µL, CREATININE 0–30 mg/dL | The engine review (2026-11-01): `PLAUSIBLE`'s header promises bounds "deliberately far outside any survivable value", but rare survivable values exist above platelets 2000 and creatinine 30; above those the points do not change (platelets 0, creatinine 4), so refusing them only forces a false entry | D4's bounds raised after the engine review: platelets 5000, creatinine 40 (the header's 'far outside any survivable value'); the browser mirror follows in the dashboard fix-up. A creatinine typed in µmol/L above 40 is refused; one below 40 is not — the printed unit is the guard (reworded after the final review: no claim about which µmol/L values are normal; O12); 18000 stays the tests' slipped platelet count |
| X19 | D6: `preview: true` on `POST /scores/sofa/{id}` (X2) | Final review (S3): one route for two acts — a sign route that previews on a flag signs for any client whose flag is lost or misspelled; X2's strict boolean only narrowed that | The preview is its own route, `POST /scores/sofa/{id}/preview` (spec D12; `hours` as the sign route, body `{overrides}`): the same permission (`scores.sign`), device refusal, `_require_patient`, `parse_overrides(..., bounds=...)` and unnamed-signer refusal, through one helper both routes call (`api/app.py` `_sofa_to_sign`); no audit row; it answers `{preview: true, signed: false, total, auto_total, overrides, form, expect}`. The sign route refuses a body with a `preview` key, any value: 400 `önizleme imza yolundan istenemez — önizleme yolunu kullanın`, nothing written — an older screen never signs by asking for a preview. `preview true ya da false olmalı` is gone. On the sign route the helper's refusals (403, 404, 503, a correction's 400) come first, then the `preview` key, then `expect` (X20) |
| X20 | D6 / X11: «İmzala» sends the same corrections; the engine re-scores at the press and its number stands | Final review (S2): a chart landing between the preview and the press was sealed without anyone having seen it; X11 only said so afterwards | A signature is `{overrides, expect}`, `expect` being the preview's fingerprint (`scoring/signing.py` `form_digest`: SHA-256 hex of `{patient_id, window_hours, covers_full_window, total, points, cells, support, corrections}` — whose form it is, the window's length and whether the stay covers it, the total, every row's points, every cell's `[value, at, points, outside_window]`, the respiration row's support basis, each correction's `[value, original, reason]`, the reason trimmed as the engine keeps it). No `expect`, or not 64 lowercase hex: 400 `imza bir önizlemenin parmak izini ister — önce önizleyin`. The rebuilt form's fingerprint not `expect`: 409 `form önizlemeden sonra değişti (yeni kayıt ya da pencere kayması) — formu yeniden önizleyin`, no audit row; a signature that passes seals its `expect` in the `score_signed` row. Not in the fingerprint: the window's bounds (they move every second, so no signature would match its preview), a cell's `source` (the reading is fixed by its value and its time, which are in) and `considered` (not printed; every better reading charted since would move it). *Widened after review 3 (M-1, M-5, M-9): the contract's first recipe left out the patient, `hours`, `covers_full_window`, `outside_window` and the reasons — two empty forms of two patients shared one fingerprint, and a signature sent with another `hours` or another reason than its preview signed; both are 409s now. None of the added fields moves with the clock. The 409 said only «kayıt önizlemeden sonra değişti»; the `score_signed` row did not carry `expect`.* |
| X21 | X14 / O5: support "any «evet» in the window, else the latest"; no support state on the form | Final review (S5, O5): the code contradicted its own docstring ("taken as of the worst reading"), and a «hayır» timed before the reading could not take effect | Spec D13: the window's worst SCORE, each reading on its own support state. Every reading the row considers (`scoring/worst.py` `readings_considered`: the window's, or the fallback before it, as for every cell) carries the support in force at its own time — the latest `ON_RESP_SUPPORT` at or before it, over the whole record (`sofa_form.py` `_support_as_of`) — and is scored on it; the row's reading has the most points, then the lower ratio, then the later time (180 on support, 3, outranks 150 off it, 2); a correction is scored on the support of the reading it corrects; the row answers `support: {on_support, at}` for its reading, null with no ratio. *Corrected 2026-11-01 (coordinator): the first version chose the lowest ratio without the support and scored only it, so a higher ratio scored on support (180, 3) lost to a lower one off it (150, 2) and the row under-scored the day.* Not fixed by the contract, decided here: a ratio typed over an unmeasured cell has no reading time, so it is scored off support and the row says `{on_support: false, at: null}`. `rules/sofa.py` (the alerting SOFA) still reads the latest |
| X22 | — | Final review (S1): `api/rehydrate.py` replayed a `chart` row (it carries `charted_by`, never `device`) with the source "replay", so after a restart the form called a hand-charted value "replay" | The replay takes the row's `device`, else "clinician" for a `chart` row (what `build_entries` stamps), else "replay" as before |
| X23 | D3 / X8: the measurement time is now until touched, and an untouched one is the server's clock (review 2); D13: a support entry counts only for readings at or after its time | Review 3 (S-2): the natural workflow — chart the ratio, then «evet», both untouched — stamps the support after the reading, which is then scored off support | When the entry is `on_resp_support` and the respiration row has a measured reading, the time field starts at that reading's time (`sofaFields.js` `readingAtOf`, read from the record's form; `SofaEditors.jsx` `ChartEntry` `defaultAt`), says so in a line under the field (`sofa.supportAtHint`) and, untouched, is sent as that instant (`checkInstant`, to the millisecond); it stays editable and is held to the 24-hour rule — decided as the editor opens (a reading older than 24 h, or none, leaves the clock's time, sent as none) and checked again at the press (a reading that aged past 24 h meanwhile is refused under the field). Every other entry's untouched time is still the server's clock. The basis line under the row says the basis, not a current state (`sofa.supportBasis*`: scored on / off support with the entry's time, or no entry at or before the reading, naming the reading's time) |

## Where the code and the spec or the contract do not say the same thing (found while planning)

- `scoring/sofa_form.py:133–138` — the respiration row's docstring says support "is taken as of the worst reading", but the code (`:141–148`) takes **any** support observation in the window, else the latest. Not changed here (out of scope); the screen states the code's rule (X14). *Fixed after the final review: X21.*
- `scoring/sofa_form.py:200–206` builds the rows respiration, cardiovascular, coagulation, liver, cns, renal; D2 wants the source table's order (respiration, coagulation, liver, cardiovascular, cns, renal) — the screen reorders (`sofaFields.js` `ORGANS`).
- `scoring/sofa_form.py:78–80` / `scoring/worst.py:227–239` — the form's answer carries no support state, so the respiration row cannot say whether its points were scored on support (O5). *Closed after the final review: X21.*
- `scoring/signing.py:85–136` — no plausibility bounds on a correction, unlike the charting door's `_value` (`clinical.py:139–153`). Task 3b adds them (O6 closed, X7).
- `api/app.py:1467–1470` — every GET appends a `score` audit row; the box and the dialog read once each per opening (O4, X9).
- `dashboard/src/live/screens/patient/PatientScreen.jsx:434` — the comment calls the SOFA form "Group 3's"; the spec makes it G2-A4. The note itself is at `:435`; both go in Task 10.
- `dashboard/src/live/session/testTokens.testutil.js:47–109` — `fakeApi` lists every call the live UI makes, but not `severityForm` / `signSeverityForm` (nothing used them since G1-16). Task 4 adds them.
- `docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md` (ground rules) listed `i18n/catalog.js` as a Lane B seam for A2's time; the file's own header invites exactly the two lines X1 adds.

## Open items

- **O1–O4:** the spec's §6 (O1 closed: mg/dL).
- **O5** The form says nothing of the support state the respiration row was scored on; a `support` field on the row (`sofa_form.py`) would let the screen print it. Engine change, not this slice's. *Closed after the final review (X21): the row carries `support`.*
- **O6 — closed in this slice (Task 3b, 2026-11-01):** `parse_overrides` takes `bounds`, and the API passes the door's `PLAUSIBLE`, so a correction outside a code's bound is refused 400 in the door's words for a preview and a signature alike (X7).
- **O7** `last_signed` reads the newest `score_signed` row without the score's name: correct while SOFA is the only signed form; when APACHE/PRISM sign, the read filters on `subject`.
- **O8** A native Azerbaijani and Russian reader reviews the `sofa.*` strings with the rest of the pilot's texts (units `mq/dl`, `×10³/mkl`, `мг/дл`; the formal register).
- **O9** The box does not re-read on board frames (each read is an audit row, O4); the time of its read is printed (X12), and the dialog reads afresh.
- **O10** What counts as «solunum desteği» — which of invasive ventilation, non-invasive ventilation, CPAP or high-flow oxygen opens the 3- and 4-point bands — is the clinician's to fix, with a source to capture into the vault; until then the flag means what the charting clinician means by it.
- **O11** `last_signed` reads the patient's newest `score_signed` row on every form read (`audit.records(..., limit=1, newest=True)`); its cost on the VM's Postgres audit is to be measured.
- **O12** A PaO₂/FiO₂ worked out in kPa and a creatinine typed in µmol/L below 40 can pass the slip bounds; the printed unit is the guard (D11).
- **O13** The vault's SOFA table puts urine output < 500 mL/d in the renal limb's 2-point column; the published score has it at 3. The form does not score urine output (D8), but the table needs a fresh capture before that limb is built on it.
- **O14** The organ-failure mark (≥ 3 points for a system) is the convention of the hospital's printed form's footnote, kept as the engine's `failure` flag (`sofa_form.py` `ORGAN_FAILURE_POINTS`); neither the vault's Sepsis-3 extract nor its wiki holds it, and its source is to be captured. The screen labels the mark only «≥3 puan».
- **O15** (review 3, M-7) Once a high-rate signal (a monitor's PaO₂/FiO₂ or MAP) feeds the real engine, the tie-break to the latest reading moves a cell's `at` with every new reading of the same worst value, and the fingerprint will refuse (409) a signature over a form whose numbers did not change; revisit which of a cell's fields the digest takes then.
- **O16** (review 3, M-8) A correction replaces only the chosen cell — the worst reading's value — and the row is re-scored on it; the window's next-worst reading is not re-ranked, so a correction that turns the worst reading into a better value leaves the row scored on it even when another reading of the window, uncorrected, would score more points. Whether a corrected row should re-rank is open.

## Deploy notes

- **The API before or with the web.** A web of this slice on an older API: the box shows the total but no signature line (X15), the dialog offers no correction, preview or signature (X13), the support flag is refused at the door (`'on_resp_support' elle girilemez`, on the toast) and the four labs pass unbounded. An older web on this API is unaffected (the new keys are ignored; `preview` is never sent).
- **A correction outside the door's bound is now refused** (400, `platelets: 18000 beklenen aralığın (0–2000) dışında — …`) where the old API signed it. No live screen signed before this slice, so no ward workflow loses anything.
- **After the final review, this round's API and web go together, the API first** (X19, X20). A G2-A4 web built before this round sends `preview: true` to the sign route: refused 400, so it can neither preview nor sign — never sign by accident. This round's web previews on `/preview`, which an older API answers 404, and is offered «İmzala» only on a preview (X12). A correction of MAP outside 0–300 is now refused (400, `map: … beklenen aralığın (0–300) dışında — …`), and a non-integer GCS at the door (`GCS tam sayı olmalı`).
- **Review 3: the API and the web go together again, the API first.** A preview taken before the API is updated fails its signature with 409 after it (the fingerprint's recipe changed): she re-previews. A web of round 2 on this API shows the new 409 sentence untranslated (in Turkish); a web of this round on a round-2 API shows the old one untranslated. Neither web offers a correction of an unmeasured cell, which this API now refuses (M-2). The `score_signed` row gains `expect`; `last_signed` reads none of it.
- No migration; no new audit event type (`score_signed` is read, `score` is written as before).
- VM deploy with the next deploy, on the owner's word (spec §5).

---

## Baseline at `9303a07` (measured 2026-11-01)

- **Engine, no database:** **2831 passed, 822 skipped** (≈ 2 min 20 s).
- **Dashboard:** `npx vitest run` → **104 files / 2972 tests**, all passing. `npx vite build` → `precache  20 entries (1004.11 KiB)`.
- The two engine files this plan extends: `tests/test_api_clinical.py` **27** tests, `tests/scoring/test_signing.py` **17**.

## Counts after each task (in plan order)

| After | Engine, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 2831 / 822 | 104 / 2972 | — |
| 1 | 2839 / 822 | — | `test_api_clinical.py` 27 → **35** |
| 2 | 2843 / 822 | — | `scoring/test_signing.py` 17 → **21** |
| 3 | 2849 / 822 | — | `scoring/test_signing.py` 21 → **27** |
| 3b | 2854 / 822 | — | `scoring/test_signing.py` 27 → **32** |
| 4 | — | 104 / 2975 | `backendApi.test.js` +1, `boardStore.test.js` +2 |
| 5 | — | 104 / 2975 | `strings.test.js` (unchanged, green) |
| 6 | — | 105 / 2982 | `sofaFields.test.js` new, **7** |
| 7 | — | 106 / 2987 | `SofaEditors.test.jsx` new, **5** |
| 8 | — | 107 / 3005 | `SofaFormModal.test.jsx` new, **18** |
| 9 | — | 108 / 3011 | `SofaBox.test.jsx` new, **6** |
| 10 | — | 108 / 3011 | `PatientScreen.test.jsx`: one test replaced, one changed |
| 11 | docs only | — | — |
| 12 | 2854 / 822 (gate) | 108 / 3011 (gate), build 20 | — |

These are the plan's arithmetic (engine +23, dashboard +39 in 4 new files), not a measurement: the gates' own numbers are the record. If a total differs, the task's own file count is what to check first.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2a-a4`, branch `feat/g2a-a4-sofa` (off `main` `ec66a57`; the spec at `ae1dcaa`, `9303a07`; this plan is the next commit). **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree. Never `git push`, never deploy, never change anything on a VM. **Never run `git stash`** — the stash is shared with every other worktree and session.
- **The knowledge graph.** `graphify-out/` does not exist in this worktree (checked 2026-11-01). If it appears, the project rule applies: `graphify query "<question>"` before the first grep or source read for a codebase question.
- **Write and Edit tools only on repo files — never `sed`, `python`, `node` or a shell heredoc to change them** — with one exception: a NEW file is written with the Write tool and converted to **CRLF** by a one-line call that touches only that file:
  ```bash
  /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" <file>
  ```
  The tree checks out CRLF (`core.autocrlf=true`); every block in this plan is LF; the Edit tool matches either way. Every Edit's old text below is unique in its file at `9303a07` (checked). Each task ends by counting the line ends of the files it touched — CR must equal LF:
  ```bash
  for f in <files>; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
  ```
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add --` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.** Messages are `type(scope): what, in words (G2-A4, Dn)`, the body says what and why and the red that was seen, and they end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this session; if the controller records a newer one by the time you commit, use that).
- **Foreground gates.** Run every suite and build in the foreground, and report before waiting on anything; never background a gate and wait on it. One Bash call runs at most 10 minutes: the whole no-DB suite fits (≈ 2 min 20 s quiet; up to 4 min while other sessions run theirs). A Vitest file that times out under load is run once more alone before it counts as red.
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/g2a-a4/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  The whole no-DB suite: `... -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`. **Never run `tests/test_infinity_vm_pilot.py`** (it hangs). **Never set or export `DATABASE_URL`.**
- **Dashboard commands** run from `/c/tmp/g2a-a4/dashboard`: `npx vitest run <paths>`; the whole suite `npx vitest run`; the build `npx vite build` (a separate command; it must print `precache  20 entries` and no `larger than 500 kB`). A run may print `Warning: An update to … inside a test was not wrapped in act(...)`; it is not a failure.
- **No patient data, ever** (CLAUDE.md rule 6). Patients `S-001`, `S-002`, `yatak-1`, `bed-3`; names `Ayşe Sentetik`; accounts `dr.elif`, `hem.ayse`; every value is made up.
- **The clinical rule lives in the engine.** Bands, points, totals, the failure mark, the worst value and the window are the engine's (`rules/sofa.py`, `scoring/`); the browser prints them and decides nothing clinical (Decision 1). It mirrors the door's plausibility bounds only to hold a slipped digit back.
- **Four languages for every key** (`tr` is the source; `az` the default and the tests' language). An `az` text equal to `tr`, or an `ru` text with no Cyrillic, needs a reviewed entry in `strings.test.js` — none of this slice's does; if the test reports one, change the wording, do not list it. Russian calls the engine «система», never «движок».
- **Comments explain why**, in the register of the file (read `meds/MedsChartForm.jsx`'s header before writing a component). New lines are tagged `G2-A4` with the decision (`D1`…`D11`) or the departure (`X1`…`X16`).
- **Report back:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the commit sha, the test counts, any deviation.

---

## File map

| File | Change | Task |
|---|---|---|
| `homunculus-engine/src/homunculus/api/clinical.py` | `CHARTABLE[ON_RESP_SUPPORT] = "bool"`, `_BOOLEAN`, four `PLAUSIBLE` bounds (D4, X16) | 1 |
| `homunculus-engine/tests/test_api_clinical.py` | `TestTheSofaFormsInputs` (8) | 1 |
| `homunculus-engine/src/homunculus/api/app.py` | import `MIN_REASON_CHARS`; `_last_signed`; GET adds `last_signed`, `min_reason_chars` (D7); POST `preview` (D6, X2, X3); import `PLAUSIBLE`, `parse_overrides(..., bounds=PLAUSIBLE)` (O6) | 2, 3, 3b |
| `homunculus-engine/src/homunculus/scoring/signing.py` | `parse_overrides(payload, form, *, bounds=None)` (O6) | 3b |
| `homunculus-engine/tests/scoring/test_signing.py` | `_resolve_person`, `_AsPeople`, `TestTheFormKnowsItsLastSignature` (4), `TestPreviewSignsNothing` (6), `TestTheServerBoundsACorrection` (3), `TestTheRouteBoundsACorrection` (2) | 2, 3, 3b |
| `dashboard/src/backendApi.js`, `backendApi.test.js` | `signSeverityForm` gains `preview` | 4 |
| `dashboard/src/live/data/boardStore.js`, `boardStore.test.js` | `sofaForm`, `sofaPreview`, `sofaSign` | 4 |
| `dashboard/src/live/session/testTokens.testutil.js` | `fakeApi` lists `severityForm`, `signSeverityForm` | 4 |
| `dashboard/src/live/i18n/strings/sofa.js` (new), `i18n/catalog.js` | the `sofa` namespace, four languages (X1) | 5 |
| `dashboard/src/live/screens/patient/sofa/sofa.testutil.js` (new) | the engine's answers, synthetic | 6 |
| `dashboard/src/live/screens/patient/sofa/sofaFields.js` (new), `sofaFields.test.js` (new) | organs, inputs, bounds, the value/time/reason rules (D2, D3, D5, D11) | 6 |
| `dashboard/src/live/screens/patient/sofa/SofaEditors.jsx` (new), `SofaEditors.test.jsx` (new) | `ChartEntry`, `CorrectionEntry` (D3, D5, X8) | 7 |
| `dashboard/src/live/screens/patient/sofa/SofaFormModal.jsx` (new), `SofaFormModal.test.jsx` (new) | the dialog (D2, D3, D5, D6, D8, D9, X4, X11–X14) | 8 |
| `dashboard/src/live/screens/patient/sofa/SofaBox.jsx` (new), `SofaBox.test.jsx` (new) | the box (D1, D7, X5, X9, X10, X15) | 9 |
| `dashboard/src/live/screens/patient/PatientScreen.jsx`, `PatientScreen.test.jsx`, `i18n/strings/patient.js` | the box in place of the note; `onlyWrite`; `formsSoon` removed (X6) | 10 |
| `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` | the guide's bullet, the roadmap row | 11 |

---

### Task 0: The worktree, the shared install and the baseline

**Files:** none changed.

- [ ] **Step 1: The worktree and the branch**

```bash
cd /c/tmp/g2a-a4 && git status --short && git rev-parse --abbrev-ref HEAD && git log --oneline -3
```

Expected: no status output; `feat/g2a-a4-sofa`; this plan's commit on top of `9303a07` and `ae1dcaa`.

- [ ] **Step 2: The `node_modules` junction**

```powershell
Get-Item C:\tmp\g2a-a4\dashboard\node_modules | Select-Object LinkType, Target | Format-List
```

Expected: `LinkType : Junction`, `Target : {C:\tmp\homunculus-g1\dashboard\node_modules}` (it exists at `9303a07`). If the item is missing, create it from Git Bash:

```bash
cmd //c mklink /J "C:\tmp\g2a-a4\dashboard\node_modules" "C:\tmp\homunculus-g1\dashboard\node_modules"
```

Expected: `Junction created for C:\tmp\g2a-a4\dashboard\node_modules <<===>> C:\tmp\homunculus-g1\dashboard\node_modules`. **The junction is the shared install: never delete through it, never reinstall into it.** Before this worktree is ever removed, unlink it first — `cmd //c rmdir "C:\tmp\g2a-a4\dashboard\node_modules"` removes the link only — and only then `git worktree remove`; a removal that follows the link deletes every other worktree's install.

- [ ] **Step 3: The engine baseline**

```bash
cd /c/tmp/g2a-a4/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: `2831 passed, 822 skipped`.

- [ ] **Step 4: The dashboard baseline**

```bash
cd /c/tmp/g2a-a4/dashboard && npx vitest run 2>&1 | tail -5
cd /c/tmp/g2a-a4/dashboard && npx vite build 2>&1 | tail -6
```

Expected: `Test Files  104 passed (104)`, `Tests  2972 passed (2972)`; the build prints `precache  20 entries`.

---

### Task 1: The door — respiratory support is a chartable flag, and the form's four labs get slip bounds (D4)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` (`CHARTABLE` ~line 42–74, `PLAUSIBLE` ~79–95, `_BOOLEAN` ~98–99)
- Test: `homunculus-engine/tests/test_api_clinical.py` (append a class; the module's `client` fixture, `_chart(client, patient_id, entries, at=WHEN)`, `AUTH`, `WHEN`, `build_entries`, `SignalCode` exist)

- [ ] **Step 1: Write the failing tests** — append to `tests/test_api_clinical.py`:

```python


class TestTheSofaFormsInputs:
    """G2-A4 (D4): the SOFA form completes its organ rows through this door. Whether the patient is on
    respiratory support becomes a flag a clinician can chart — without it the 3- and 4-point PaO2/FiO2
    bands could not be reached from charting at all — and the four labs the form takes get the kind of
    bound the others have: one that catches a slipped digit or a unit, never a clinical threshold."""

    def test_respiratory_support_is_charted_as_yes_or_no(self, client):
        assert _chart(client, "bed-3", [{"code": "on_resp_support", "value": 1}]).status_code == 200
        assert _chart(client, "bed-3", [{"code": "on_resp_support", "value": 0}]).status_code == 200
        r = _chart(client, "bed-3", [{"code": "on_resp_support", "value": 2}])
        assert r.status_code == 400
        assert "yalnız 0 veya 1" in r.json()["detail"]

    def test_support_is_recorded_as_a_flag_a_person_charted(self):
        [entry] = build_entries("bed-1", [{"code": "on_resp_support", "value": 1}],
                                charted_by="dr-elif", recorded_at=WHEN)
        assert entry.observation.code is SignalCode.ON_RESP_SUPPORT
        assert entry.observation.unit == "bool"
        assert entry.observation.source_device == "clinician"

    @pytest.mark.parametrize(("code", "low", "high", "slipped"), [
        ("platelets", 0.0, 2000.0, 15000),    # 150 typed with two zeros too many
        ("bilirubin", 0.0, 60.0, 120),        # far past any bilirubin in mg/dL
        ("creatinine", 0.0, 30.0, 177),       # a creatinine typed in µmol/L (D11)
        ("pao2_fio2", 20.0, 700.0, 4),        # a ratio worked out with FiO2 as a percentage
    ])
    def test_the_four_labs_refuse_a_slip_and_take_their_bounds(self, client, code, low, high, slipped):
        assert _chart(client, "bed-3", [{"code": code, "value": low}]).status_code == 200
        assert _chart(client, "bed-3", [{"code": code, "value": high}]).status_code == 200
        r = _chart(client, "bed-3", [{"code": code, "value": slipped}])
        assert r.status_code == 400
        assert "aralığın" in r.json()["detail"]

    def test_charted_support_reaches_the_alerting_sofa_too(self, client):
        """rules/sofa.py reads the same code: a ratio of 150 scores 2 off support and 3 on it."""
        _chart(client, "bed-3", [{"code": "pao2_fio2", "value": 150}])
        before = client.get("/patients", headers=AUTH).json()["patients"][0]["latest"]["sofa"]
        _chart(client, "bed-3", [{"code": "on_resp_support", "value": 1}], at=WHEN + timedelta(minutes=5))
        after = client.get("/patients", headers=AUTH).json()["patients"][0]["latest"]["sofa"]
        assert (before, after) == (2, 3)

    def test_charted_support_opens_the_three_and_four_point_bands_on_the_form(self, client):
        """And on the SOFA form (scoring/sofa_form.py): a ratio of 150 scores 2 off support, 3 once
        support is charted, 4 at 80."""
        now = datetime.now(timezone.utc)

        def respiration():
            rows = client.get("/scores/sofa/bed-3", headers=AUTH).json()["rows"]
            return next(r for r in rows if r["organ"] == "respiration")["points"]

        assert _chart(client, "bed-3", [{"code": "pao2_fio2", "value": 150}],
                      at=now - timedelta(minutes=90)).status_code == 200
        assert respiration() == 2
        assert _chart(client, "bed-3", [{"code": "on_resp_support", "value": 1}],
                      at=now - timedelta(minutes=60)).status_code == 200
        assert respiration() == 3
        assert _chart(client, "bed-3", [{"code": "pao2_fio2", "value": 80}],
                      at=now - timedelta(minutes=30)).status_code == 200
        assert respiration() == 4
```

- [ ] **Step 2: Run them and see them red**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_clinical.py 2>&1 | tail -3`

Expected: `8 failed, 27 passed` — the support tests with `400` / `ClinicalEntryError: 'on_resp_support' elle girilemez — bu alan cihazdan gelir`, the four bounds tests at the slipped value (`assert 200 == 400`), the alerting-SOFA test at `(2, 2) == (2, 3)`.

- [ ] **Step 3: Make support chartable** — in `api/clinical.py`, Edit:

old:
```python
    SignalCode.SUPPLEMENTAL_OXYGEN: "bool",
```
new:
```python
    SignalCode.SUPPLEMENTAL_OXYGEN: "bool",
    # G2-A4 (D4, X16): whether the patient is on respiratory support — the fact the 3- and 4-point
    # PaO2/FiO2 bands turn on (rules/sofa.py `respiration_points_of`). The ventilator bridge infers it
    # (medibus: a ventilator answering its poll is support, and it only ever says yes); no ventilator
    # feeds the ward, and whether a patient is supported is seen at the bedside, so this is a clinician's
    # observation as much as a device's. Charted here it reaches both SOFAs: the form's
    # (scoring/sofa_form.py — any yes in the window counts) and the alerting one (rules/sofa.py reads the
    # latest). A flag, 1 or 0 (`_BOOLEAN`).
    SignalCode.ON_RESP_SUPPORT: "bool",
```

- [ ] **Step 4: The four bounds** — Edit:

old:
```python
    SignalCode.HAEMATOCRIT: (5.0, 75.0),
```
new:
```python
    SignalCode.HAEMATOCRIT: (5.0, 75.0),
    # G2-A4 (D4): the SOFA form's labs, in the units CHARTABLE fixes. Engineering bounds against a slipped
    # digit or a unit — a creatinine typed in µmol/L lands far above 30 mg/dL; a PaO2/FiO2 worked out with
    # FiO2 as a percentage lands far below 20 — never clinical thresholds: the band tables in rules/sofa.py
    # stay the only place a value is judged. A bilirubin typed in µmol/L can still fall inside 0–60; the
    # unit printed beside the field is the guard there (D11).
    SignalCode.PLATELETS: (0.0, 2000.0),          # ×10³/µL
    SignalCode.BILIRUBIN: (0.0, 60.0),            # mg/dL
    SignalCode.CREATININE: (0.0, 30.0),           # mg/dL
    SignalCode.PAO2_FIO2: (20.0, 700.0),          # mmHg
```

- [ ] **Step 5: The flag is a flag** — Edit:

old:
```python
_BOOLEAN = {SignalCode.SUSPECTED_INFECTION, SignalCode.ANTIBIOTIC_ADMINISTERED,
            SignalCode.SUPPLEMENTAL_OXYGEN}
```
new:
```python
_BOOLEAN = {SignalCode.SUSPECTED_INFECTION, SignalCode.ANTIBIOTIC_ADMINISTERED,
            SignalCode.SUPPLEMENTAL_OXYGEN, SignalCode.ON_RESP_SUPPORT}   # G2-A4 (D4)
```

- [ ] **Step 6: Run the file and its neighbours green**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_clinical.py tests/scoring tests/rules/test_sofa.py tests/test_rehydrate.py tests/test_api_board_meds.py tests/test_api_board_sepsis.py tests/test_scenario_news2.py 2>&1 | tail -3`

Expected: all passed, 0 failed (`test_api_clinical.py` now 35).

- [ ] **Step 7: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/tests/test_api_clinical.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/tests/test_api_clinical.py
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(api): respiratory support is a chartable flag, and the SOFA form's four labs have slip bounds at the door (G2-A4, D4)

ON_RESP_SUPPORT joins CHARTABLE as "bool" and _BOOLEAN: with no ventilator feed on the ward the 3- and
4-point PaO2/FiO2 bands could not be reached from charting at all. It reaches the form's SOFA and the
alerting SOFA alike. PLAUSIBLE gains PLATELETS 0-2000, BILIRUBIN 0-60, CREATININE 0-30, PAO2_FIO2 20-700:
engineering bounds against a slipped digit or a unit, not clinical thresholds.

Red first: 8 failed (the flag refused as a device channel, the slipped values accepted).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 2: The form carries its last signature and the engine's reason length (D7)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the `scoring.signing` import ~line 64–66; a helper before `_body_patient_id` ~line 842; `sofa_severity_form` ~1442–1471)
- Test: `homunculus-engine/tests/scoring/test_signing.py` (append; `TOKEN`, `AUTH`, `WHY`, `DOCTOR`, `PHYSICIAN_PERMS`, `MIN_REASON_CHARS`, `Caller`, `DEFAULT_GROUPS`, `create_app`, `TestClient` are already imported or defined in the file)

- [ ] **Step 1: Write the failing tests** — append to `tests/scoring/test_signing.py`:

```python


NURSE = {"Authorization": "Bearer nurse-jwt"}
NURSE_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "nurse"))


async def _resolve_person(credential: str) -> Caller:
    """A signed-in physician (the default group holds `scores.sign`) or, for `nurse-jwt`, a nurse — who
    sees and charts the patient (`board.view`, `clinical.chart`) but does not sign."""
    if credential == "nurse-jwt":
        return Caller(hospital="h1", actor="hem.ayse", groups=("nurse",), perms=NURSE_PERMS)
    return Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=PHYSICIAN_PERMS)


class _AsPeople:
    """G2-A4: the app with a physician and a nurse behind their tokens; the bridge's token charts."""

    @pytest.fixture()
    def client(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve_person)
        with TestClient(app) as c:
            yield c

    def _chart(self, client, patient_id, code, value, minutes_ago=60):
        at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
        r = client.post(f"/clinical/{patient_id}",
                        json={"entries": [{"code": code, "value": value}], "recorded_at": at},
                        headers=AUTH)
        assert r.status_code == 200, r.text

    def _signed_rows(self, client):
        return client.get("/audit?event_type=score_signed", headers=AUTH).json()["records"]


class TestTheFormKnowsItsLastSignature(_AsPeople):
    """G2-A4 (D7): the form's own answer says who signed it last, when, and to what total — read with the
    form's permission from this patient's `score_signed` rows only — and how long a correction's reason
    must be, so the screen counts against the engine's number rather than a copy of it."""

    def test_an_unsigned_form_has_no_last_signature_and_states_the_reason_length(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        body = client.get("/scores/sofa/yatak-1", headers=NURSE).json()
        assert body["last_signed"] is None
        assert body["min_reason_chars"] == MIN_REASON_CHARS == 20
        assert body["total"] == 3 and body["signed"] is False      # the form itself is unchanged

    def test_the_newest_signature_is_the_one_in_the_form(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        assert client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={}).status_code == 200
        assert client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 180, "reason": WHY}]}).status_code == 200
        last = client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"]
        assert last == {"total": 0, "auto_total": 3, "signed_by": "dr.elif",
                        "at": last["at"], "corrections": 1}
        assert datetime.fromisoformat(last["at"]).tzinfo is not None

    def test_another_patients_signature_is_not_this_ones(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        self._chart(client, "yatak-2", "platelets", 45)
        assert client.post("/scores/sofa/yatak-2", headers=DOCTOR, json={}).status_code == 200
        assert client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"] is None
        assert client.get("/scores/sofa/yatak-2", headers=NURSE).json()["last_signed"]["total"] == 3

    def test_a_nurse_reads_the_signature_without_the_audit_permission(self, client):
        """The form's permission is `board.view`; the trail itself stays `audit.view`'s."""
        self._chart(client, "yatak-1", "platelets", 45)
        assert client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={}).status_code == 200
        last = client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"]
        assert last["signed_by"] == "dr.elif"
        assert client.get("/audit?patient_id=yatak-1", headers=NURSE).status_code == 403
```

- [ ] **Step 2: Run them and see them red**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/scoring/test_signing.py 2>&1 | tail -3`

Expected: `4 failed, 17 passed`, each with `KeyError: 'last_signed'` (or `'min_reason_chars'`).

- [ ] **Step 3: The import** — in `api/app.py`, Edit:

old:
```python
from homunculus.scoring.signing import (
    ScoreSigningError, parse_overrides, sign as sign_score,
)
```
new:
```python
from homunculus.scoring.signing import (
    MIN_REASON_CHARS, ScoreSigningError, parse_overrides, sign as sign_score,
)
```

- [ ] **Step 4: The helper** — Edit (it goes after `_score_state`, before `_body_patient_id`):

old:
```python
    def _body_patient_id(body: dict) -> str:
```
new:
```python
    def _last_signed(hospital: str, patient_id: str) -> dict | None:
        """The patient's newest `score_signed` row as the SOFA box prints it (G2-A4, D7), or None.

        This patient's signing rows and nothing else of the trail: the box needs who, when and what
        total, and a ward doctor reading it holds `board.view`, not `audit.view`. `corrections` is the
        COUNT of the cells corrected — the reasons stay in the trail, for whoever may read it. Every
        signing row today is a SOFA form's; when another score signs, this read names the score (O7).
        """
        rows = audit.records(tenant=hospital, patient_id=patient_id, event_type="score_signed",
                             limit=1, newest=True)
        if not rows:
            return None
        signed = rows[-1].payload
        return {"total": signed.get("total"), "auto_total": signed.get("auto_total"),
                "signed_by": signed.get("signed_by"), "at": signed.get("at"),
                "corrections": len(signed.get("overrides") or [])}

    def _body_patient_id(body: dict) -> str:
```

(`audit.records(..., limit=1, newest=True)` is the newest matching row, handed back in a list oldest first — `api/audit.py` `AuditLog.records`, the in-memory and SQLite logs at `:213–221`/`:312ff`, the Postgres log at `api/audit_postgres.py:99–140`: all take `tenant`, `patient_id`, `event_type`, `limit`, `newest`.)

- [ ] **Step 5: The answer** — in `sofa_severity_form`, Edit:

old:
```python
                                 "unmeasured": form.unmeasured_organs,
                                 "read_by": _charted_by(caller)}))
        return form.as_dict()
```
new:
```python
                                 "unmeasured": form.unmeasured_organs,
                                 "read_by": _charted_by(caller)}))
        # G2-A4 (D7): the patient's newest signature and the engine's own reason length travel with the
        # form, under this route's permission — `board.view` and the patient's scope — so the SOFA box can
        # say «signed by whom, when, to what total» without a ward doctor holding `audit.view`, and the
        # correction's counter counts against the number the engine enforces, not a copy of it.
        return {**form.as_dict(), "last_signed": _last_signed(hospital, patient_id),
                "min_reason_chars": MIN_REASON_CHARS}
```

- [ ] **Step 6: Run green**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/scoring tests/test_api_clinical.py tests/test_api_scope.py tests/test_audit_chain.py 2>&1 | tail -3`

Expected: all passed, 0 failed (`test_signing.py` now 21).

- [ ] **Step 7: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/scoring/test_signing.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/scoring/test_signing.py
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(api): the SOFA form carries its last signature and the engine's reason length (G2-A4, D7)

GET /scores/sofa/{id} adds last_signed — {total, auto_total, signed_by, at, corrections} from this
patient's newest score_signed row, or null — and min_reason_chars. Read under the form's own permission
(board.view, patient scope): the box can name the last signature without audit.view, and the screen
counts a correction's reason against the engine's number.

Red first: 4 failed with KeyError 'last_signed'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 3: Preview a signature — the same parsing, re-scoring and refusals, no audit row (D6)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`sign_sofa_form` ~1473–1531)
- Test: `homunculus-engine/tests/scoring/test_signing.py` (append; `_AsPeople`, `NURSE` from Task 2)

- [ ] **Step 1: Write the failing tests** — append to `tests/scoring/test_signing.py`:

```python


class TestPreviewSignsNothing(_AsPeople):
    """G2-A4 (D6): `preview: true` answers with the form a signature would seal — re-scored by the engine
    from the same corrections — and writes nothing, so a clinician sees the exact number before she puts
    her name to it and the server stays the only scorer. Every refusal of signing holds for it."""

    def test_the_preview_is_the_rebuilt_form_and_no_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "preview": True, "overrides": [{"code": "platelets", "value": 180, "reason": WHY}]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["preview"] is True and body["signed"] is False
        assert body["total"] == 0 and body["auto_total"] == 3
        assert body["overrides"] == [{"code": "platelets", "value": 180, "reason": WHY, "original": 45}]
        assert body["form"]["auto_total"] == 3 and body["form"]["signed"] is False
        assert body["form"]["corrected_cells"] == ["platelets"]
        assert self._signed_rows(client) == []

    def test_signing_the_same_corrections_seals_the_previewed_total(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        overrides = [{"code": "platelets", "value": 80, "reason": WHY}]
        previewed = client.post("/scores/sofa/yatak-1", headers=DOCTOR,
                                json={"preview": True, "overrides": overrides}).json()
        signed = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={"overrides": overrides}).json()
        assert signed["signed"] is True and signed["total"] == previewed["total"] == 2
        rows = self._signed_rows(client)
        assert len(rows) == 1 and rows[0]["payload"]["total"] == 2

    def test_a_short_reason_is_refused_for_a_preview_as_for_a_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "preview": True, "overrides": [{"code": "platelets", "value": 180, "reason": "yanlis"}]})
        assert r.status_code == 400
        assert "gerekçe" in r.json()["detail"]
        assert self._signed_rows(client) == []

    def test_the_bridge_token_cannot_preview(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=AUTH, json={"preview": True})
        assert r.status_code == 403
        assert r.json()["detail"] == "skor formunu yalnız bir kişi imzalayabilir"

    def test_a_nurse_without_scores_sign_cannot_preview(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=NURSE, json={"preview": True})
        assert r.status_code == 403
        assert r.json()["detail"] == "permission required: scores.sign"

    def test_preview_must_be_a_real_yes_or_no(self, client):
        """X2: a "true" string read as false would SIGN a form its sender meant only to look at."""
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={"preview": "true"})
        assert r.status_code == 400
        assert "preview" in r.json()["detail"]
        assert self._signed_rows(client) == []
```

- [ ] **Step 2: Run them and see the right three red**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/scoring/test_signing.py 2>&1 | tail -3`

Expected: `3 failed, 24 passed`. Red: `test_the_preview_is_the_rebuilt_form_and_no_signature` (`KeyError: 'preview'` — the route signed), `test_signing_the_same_corrections_seals_the_previewed_total` (`assert 2 == 1` rows — the "preview" signed too), `test_preview_must_be_a_real_yes_or_no` (`assert 200 == 400`). The short-reason, bridge and nurse tests pass from the start: they pin that the preview keeps signing's refusals.

- [ ] **Step 3: The flag, read before anything is built** — in `sign_sofa_form`, Edit:

old:
```python
        if caller.is_device:
            raise HTTPException(status_code=403,
                                detail="skor formunu yalnız bir kişi imzalayabilir")
        hospital = caller.hospital
```
new:
```python
        if caller.is_device:
            raise HTTPException(status_code=403,
                                detail="skor formunu yalnız bir kişi imzalayabilir")
        # G2-A4 (D6, X2): `preview: true` asks what a signature WOULD seal. Only a real boolean: a "true"
        # string read as false would sign a form its sender meant only to look at — refused here, after
        # the permission and the device refusals and before anything is read.
        preview = body.get("preview", False)
        if not isinstance(preview, bool):
            raise HTTPException(status_code=400, detail="preview true ya da false olmalı")
        hospital = caller.hospital
```

- [ ] **Step 4: The answer without the audit row** — Edit:

old:
```python
        try:
            signed = sign_score(auto, rebuilt, signed_by=signed_by, overrides=overrides, now=now)
        except ScoreSigningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        audit.append(AuditEvent(hospital, "score_signed", patient_id, "SOFA", {
```
new:
```python
        try:
            signed = sign_score(auto, rebuilt, signed_by=signed_by, overrides=overrides, now=now)
        except ScoreSigningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        if preview:
            # G2-A4 (D6, X3): the form a signature would seal — the same parsing, the same re-scoring and
            # every refusal above, `sign_score`'s unnamed signer included — and NO audit row, because
            # nothing was signed. The screen shows this number, then signs with the same corrections;
            # the engine stays the only scorer.
            return {"preview": True, "signed": False, "total": rebuilt.total,
                    "auto_total": auto.total, "overrides": [o.as_dict() for o in overrides],
                    "form": {**rebuilt.as_dict(), "auto_total": auto.total}}

        audit.append(AuditEvent(hospital, "score_signed", patient_id, "SOFA", {
```

- [ ] **Step 5: Run green, then the whole engine suite**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/scoring tests/test_api_clinical.py 2>&1 | tail -3`

Expected: all passed (`test_signing.py` 27).

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`

Expected: `2849 passed, 822 skipped` (2831 + 18). (Task 3b runs it again; its line is the one Task 11 quotes.)

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/scoring/test_signing.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/scoring/test_signing.py
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(api): preview a SOFA signature — the same parsing, re-scoring and refusals, no audit row (G2-A4, D6)

POST /scores/sofa/{id} with preview: true parses the corrections, rebuilds the form and runs every
refusal of signing (scores.sign, the device, a short reason, an unnamed signer), then answers
{preview: true, signed: false, total, auto_total, overrides, form} and writes no score_signed row.
preview must be a JSON boolean (X2): a "true" string would otherwise sign.

Red first: 3 failed (the "preview" signed; the string flag signed); the three refusal tests were green
from the start and pin that the preview keeps them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 3b: The server holds a correction to the door's bounds — for a preview and a signature alike (O6, X7)

**Files:**
- Modify: `homunculus-engine/src/homunculus/scoring/signing.py` (imports ~line 33–37; `parse_overrides` ~85–136)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the `api.clinical` import ~line 43–45; the `parse_overrides` call in `sign_sofa_form` ~1511)
- Test: `homunculus-engine/tests/scoring/test_signing.py` (append; `_form`, `_state`, `T0`, `WHY`, `DOCTOR`, `_AsPeople` exist)

The engine is the only scorer, so the bound that catches a slipped digit cannot live only in the browser: a corrected value is typed by the same hand as a charted one and slips the same way. `scoring` must not import `api`, so the bounds are passed in; the route passes the door's `PLAUSIBLE`, which after Task 1 holds the four labs, GCS and the pressors. Preview and signing parse through the same call, so one change covers both.

- [ ] **Step 1: Write the failing tests** — append to `tests/scoring/test_signing.py`:

```python


class TestTheServerBoundsACorrection:
    """G2-A4 (O6): a corrected value is held to the same slip bounds the charting door holds a charted
    one to, in the door's words (api/clinical.py `_value`). `scoring` does not import `api`: the bounds
    are passed in, and without them only a finite number is required, as before."""

    BOUNDS = {SignalCode.PLATELETS: (0.0, 2000.0)}

    def test_without_bounds_any_finite_value_is_a_correction(self):
        [override] = parse_overrides([{"code": "platelets", "value": 18000, "reason": WHY}], _form())
        assert override.value == 18000

    def test_a_value_outside_its_bound_is_refused_in_the_doors_words(self):
        with pytest.raises(ScoreSigningError) as caught:
            parse_overrides([{"code": "platelets", "value": 18000, "reason": WHY}], _form(),
                            bounds=self.BOUNDS)
        assert str(caught.value) == ("platelets: 18000 beklenen aralığın (0–2000) dışında — "
                                     "birim veya ondalık hatası olabilir")

    def test_a_value_inside_its_bound_and_a_code_with_none_are_corrections(self):
        form = sofa_form.build(_state([(SignalCode.PLATELETS, 45, 6), (SignalCode.MAP, 60, 2)]), T0)
        overrides = parse_overrides([{"code": "platelets", "value": 2000, "reason": WHY},
                                     {"code": "map", "value": 900, "reason": WHY}],
                                    form, bounds=self.BOUNDS)
        assert [o.value for o in overrides] == [2000, 900]


class TestTheRouteBoundsACorrection(_AsPeople):
    """G2-A4 (O6): the route passes the door's PLAUSIBLE, so a slipped correction is refused for a preview
    and for a signature alike — both go through the same parse — and nothing is signed."""

    SLIPPED = [{"code": "platelets", "value": 18000, "reason": WHY}]
    SAID = "platelets: 18000 beklenen aralığın (0–2000) dışında — birim veya ondalık hatası olabilir"

    def test_a_slipped_correction_is_refused_for_a_preview_and_for_a_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        for body in ({"preview": True, "overrides": self.SLIPPED}, {"overrides": self.SLIPPED}):
            r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json=body)
            assert r.status_code == 400, body
            assert r.json()["detail"] == self.SAID
        assert self._signed_rows(client) == []

    def test_a_correction_inside_the_bound_still_previews_and_signs(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        inside = [{"code": "platelets", "value": 2000, "reason": WHY}]
        previewed = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={"preview": True, "overrides": inside})
        assert previewed.status_code == 200 and previewed.json()["total"] == 0
        signed = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={"overrides": inside})
        assert signed.status_code == 200 and signed.json()["total"] == 0
        assert len(self._signed_rows(client)) == 1
```

- [ ] **Step 2: Run them and see the right three red**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/scoring/test_signing.py 2>&1 | tail -3`

Expected: `3 failed, 29 passed`. Red: the two unit tests that pass `bounds=` (`TypeError: parse_overrides() got an unexpected keyword argument 'bounds'`) and `test_a_slipped_correction_is_refused_for_a_preview_and_for_a_signature` (`assert 200 == 400` — the preview took 18000). Green from the start, and kept as guards: no bounds means any finite value (the old behaviour), and a correction inside the bound previews and signs.

- [ ] **Step 3: `bounds` in `parse_overrides`** — in `scoring/signing.py`, three Edits:

old:
```python
from dataclasses import dataclass, field
from datetime import datetime, timezone
```
new:
```python
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
```

old:
```python
def parse_overrides(payload: object, form: SofaForm) -> list[Override]:
    """Read the corrections out of a signing request, refusing the ones that are not corrections.

    Each entry is `{code, value, reason}`. The original value is looked up from the form rather
    than taken from the caller — a client that could state both would be free to state a false
    "original" and make an override look like agreement.
    """
```
new:
```python
def parse_overrides(payload: object, form: SofaForm, *,
                    bounds: Mapping[SignalCode, tuple[float, float]] | None = None) -> list[Override]:
    """Read the corrections out of a signing request, refusing the ones that are not corrections.

    Each entry is `{code, value, reason}`. The original value is looked up from the form rather
    than taken from the caller — a client that could state both would be free to state a false
    "original" and make an override look like agreement.

    `bounds` (G2-A4, O6) are the slip bounds a value of each code is held to, `{code: (low, high)}`.
    A corrected value is typed by the same hand as a charted one and slips the same way, and the
    engine is the only scorer, so the bound cannot live only in a browser. The caller passes them —
    the API passes the charting door's `PLAUSIBLE` — because this module does not import the API.
    Without them only a finite number is required, as before.
    """
```

old:
```python
        if value != value or value in (float("inf"), float("-inf")):
            raise ScoreSigningError(f"{raw_code}: geçersiz sayı")
```
new:
```python
        if value != value or value in (float("inf"), float("-inf")):
            raise ScoreSigningError(f"{raw_code}: geçersiz sayı")
        # G2-A4 (O6): the door's slip bound, in the door's words (api/clinical.py `_value`) — a platelet
        # count corrected to 18000 is the same slipped digit whether it was charted or typed over the record.
        span = (bounds or {}).get(code)
        if span is not None and not span[0] <= value <= span[1]:
            low, high = span
            raise ScoreSigningError(
                f"{raw_code}: {value:g} beklenen aralığın ({low:g}–{high:g}) dışında — "
                f"birim veya ondalık hatası olabilir")
```

- [ ] **Step 4: The route passes the door's bounds** — in `api/app.py`, two Edits:

old:
```python
from homunculus.api.clinical import (
    ClinicalEntryError, build_entries, chart_observations, profile_from_payload, profile_to_payload,
)
```
new:
```python
from homunculus.api.clinical import (
    PLAUSIBLE, ClinicalEntryError, build_entries, chart_observations, profile_from_payload,
    profile_to_payload,
)
```

old:
```python
            overrides = parse_overrides(body.get("overrides"), auto)
```
new:
```python
            # G2-A4 (O6): a correction is held to the door's slip bounds, as a charted value is — for a
            # preview and a signature alike, both parsed here. The dashboard mirrors them (X7); this is
            # the guard.
            overrides = parse_overrides(body.get("overrides"), auto, bounds=PLAUSIBLE)
```

- [ ] **Step 5: Run green, then the whole engine suite**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/scoring tests/test_api_clinical.py 2>&1 | tail -3`

Expected: all passed (`test_signing.py` 32).

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`

Expected: `2854 passed, 822 skipped` (2831 + 23). Write the line down: Task 11 quotes it.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in homunculus-engine/src/homunculus/scoring/signing.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/scoring/test_signing.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/scoring/signing.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/scoring/test_signing.py
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(api): a SOFA correction is held to the door's slip bounds, for a preview and a signature alike (G2-A4, O6)

parse_overrides takes bounds={code: (low, high)} and refuses a value outside its code's bound in the
door's words ("platelets: 18000 beklenen aralığın (0–2000) dışında — birim veya ondalık hatası
olabilir"); sign_sofa_form passes api/clinical.py's PLAUSIBLE. The engine is the only scorer, so the
bound cannot live only in the browser (which mirrors it, X7). scoring still imports nothing from api.

Red first: 3 failed (the bounds keyword unknown; the preview took 18000); the no-bounds and
inside-the-bound tests were green from the start and stay as guards.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 4: The API client sends `preview`; the store reads, previews and signs (D6, D7)

**Files:**
- Modify: `dashboard/src/backendApi.js` (`signSeverityForm` ~line 774–784)
- Modify: `dashboard/src/backendApi.test.js` (the "what the work screens call" describe)
- Modify: `dashboard/src/live/data/boardStore.js` (after `chart` ~line 362–368)
- Modify: `dashboard/src/live/data/boardStore.test.js` (the "the board store" describe)
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (`fakeApi`)

- [ ] **Step 1: The failing API-client test** — in `backendApi.test.js`, Edit:

old:
```js
  it("lifts an account's directory sign-in throttle with the administrator's reason", async () => {
```
new:
```js
  // G2-A4 (D6): the SOFA form is read, previewed with `preview: true`, and signed without it — the same
  // corrections both times, so what is signed is what was previewed.
  it("reads the SOFA form, previews the corrections with preview: true and signs them without", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 3 }));
    const api = signedIn(fetchMock);
    const overrides = [{ code: "platelets", value: 38, reason: "Laboratuvar sonucu esas alındı, cihaz değil" }];
    await api.severityForm("S-001");
    await api.signSeverityForm("S-001", { overrides, preview: true });
    await api.signSeverityForm("S-001", { overrides });
    const [[readUrl, readInit], [previewUrl, previewInit], [signUrl, signInit]] = fetchMock.mock.calls;
    expect(readUrl).toBe("/scores/sofa/S-001?hours=24");
    expect(readInit.method || "GET").toBe("GET");
    expect(previewUrl).toBe("/scores/sofa/S-001?hours=24");
    expect(previewInit.method).toBe("POST");
    expect(JSON.parse(previewInit.body)).toEqual({ overrides, preview: true });
    expect(signUrl).toBe("/scores/sofa/S-001?hours=24");
    expect(JSON.parse(signInit.body)).toEqual({ overrides });
  });

  it("lifts an account's directory sign-in throttle with the administrator's reason", async () => {
```

- [ ] **Step 2: The failing store tests** — in `boardStore.test.js`, Edit:

old:
```js
    expect(api.chart).toHaveBeenLastCalledWith("S-001", [{ code: "weight_kg", value: 81 }], null);
  });
```
new:
```js
    expect(api.chart).toHaveBeenLastCalledWith("S-001", [{ code: "weight_kg", value: 81 }], null);
  });

  // G2-A4: the SOFA box and form read, preview and sign through the store, the only door to the API.
  // A signature changes no card, so nothing reloads the board; an answer after clear() is dropped.
  it("reads the SOFA form, previews corrections and signs them, and drops an answer that lands after clear()", async () => {
    const { api, store } = setup();
    const overrides = [{ code: "platelets", value: 38, reason: "Laboratuvar sonucu esas alındı" }];
    api.severityForm = vi.fn().mockResolvedValue({ total: 3, last_signed: null });
    api.signSeverityForm = vi.fn().mockResolvedValue({ preview: true, signed: false, total: 2 });
    expect(await store.sofaForm("S-001")).toEqual({ total: 3, last_signed: null });
    expect(api.severityForm).toHaveBeenCalledWith("S-001");
    expect(await store.sofaPreview("S-001", overrides)).toMatchObject({ preview: true, total: 2 });
    expect(api.signSeverityForm).toHaveBeenLastCalledWith("S-001", { overrides, preview: true });
    await store.sofaSign("S-001", overrides);
    expect(api.signSeverityForm).toHaveBeenLastCalledWith("S-001", { overrides });
    expect(api.boardPatients).not.toHaveBeenCalled();
    let answer;
    api.severityForm.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const late = store.sofaForm("S-001");
    store.clear();
    answer({ total: 9 });
    expect(await late).toBeNull();
  });

  it("a refused SOFA call rejects with the API's own error, having changed nothing", async () => {
    const { api, store, state } = setup();
    api.signSeverityForm = vi.fn().mockRejectedValue(Object.assign(new Error("permission required: scores.sign"), { status: 403 }));
    await expect(store.sofaSign("S-001", [])).rejects.toMatchObject({ status: 403 });
    expect(state().patients).toEqual([]);
  });
```

- [ ] **Step 3: Run them and see them red**

Run: `npx vitest run src/backendApi.test.js src/live/data/boardStore.test.js`

Expected: 3 failed — the API test at `toEqual({ overrides, preview: true })` (the body has `overrides` only), the two store tests with `TypeError: store.sofaForm is not a function` / `store.sofaSign is not a function`.

- [ ] **Step 4: `preview` in the client** — in `backendApi.js`, Edit:

old:
```js
     * reporting unbanded. The reason is mandatory and the engine enforces its length.
     */
    signSeverityForm(patientId, { score = "sofa", hours = 24, overrides = [] } = {}) {
      return authed(`/scores/${score}/${encodeURIComponent(patientId)}?hours=${hours}`, {
        method: "POST", body: { overrides },
      });
    },
```
new:
```js
     * reporting unbanded. The reason is mandatory and the engine enforces its length.
     *
     * `preview: true` (G2-A4, D6) asks for the form a signature WOULD seal — the same parsing, re-scoring
     * and refusals — and signs nothing (no audit row). The key is sent only then: an engine older than
     * G2-A4 ignores it and would sign, which is why the screen never previews against one (X13).
     */
    signSeverityForm(patientId, { score = "sofa", hours = 24, overrides = [], preview = false } = {}) {
      return authed(`/scores/${score}/${encodeURIComponent(patientId)}?hours=${hours}`, {
        method: "POST", body: { overrides, ...(preview ? { preview: true } : {}) },
      });
    },
```

- [ ] **Step 5: The store's three methods** — in `boardStore.js`, Edit:

old:
```js
    /** Load, then stream (LIVE once the stream has opened and its reload landed). Resolves once
```
new:
```js
    /**
     * The SOFA severity form of one patient (G2-A4, `GET /scores/sofa/{id}`, permission `board.view`):
     * the engine's filled form with its `last_signed` and `min_reason_chars` (D7). A read — the engine
     * writes a `score` row in its audit (spec O4) and nothing on the board — so nothing is applied here.
     * Through `track`, as every call the board makes; an answer that arrives after `clear()` (the session
     * ended) is dropped: it resolves to null, as `chart`'s does.
     */
    async sofaForm(patientId) {
      const mine = generation;
      const form = await track(() => api.severityForm(patientId));
      return mine === generation ? form : null;
    },
    /** The form a signature would seal with these corrections, signed by nobody (D6: `preview: true`,
     *  permission `scores.sign`, no audit row). `overrides` is `[{code, value, reason}]`. Rejects with the
     *  API's own error. */
    async sofaPreview(patientId, overrides) {
      const mine = generation;
      const answer = await track(() => api.signSeverityForm(patientId, { overrides, preview: true }));
      return mine === generation ? answer : null;
    },
    /** Sign the form with these corrections (D6, permission `scores.sign`): the engine re-scores and seals
     *  it into the audit chain. Rejects with the API's own error, having changed nothing here. The board
     *  is not reloaded — a signature changes no card; the SOFA box reads its form again for the new line. */
    async sofaSign(patientId, overrides) {
      const mine = generation;
      const answer = await track(() => api.signSeverityForm(patientId, { overrides }));
      return mine === generation ? answer : null;
    },
    /** Load, then stream (LIVE once the stream has opened and its reload landed). Resolves once
```

- [ ] **Step 6: The fake API lists the two calls** — in `live/session/testTokens.testutil.js`, Edit:

old:
```js
    putPatientProfile: vi.fn(),
```
new:
```js
    putPatientProfile: vi.fn(),
    // G2-A4: the patient screen's SOFA box and form (screens/patient/sofa)
    severityForm: vi.fn(),
    signSeverityForm: vi.fn(),
```

- [ ] **Step 7: Run green**

Run: `npx vitest run src/backendApi.test.js src/live/data/boardStore.test.js src/live/screens/patient`

Expected: all passed, 0 failed.

- [ ] **Step 8: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/session/testTokens.testutil.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/session/testTokens.testutil.js
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(dashboard): the store reads, previews and signs the SOFA form; the API client sends preview (G2-A4, D6, D7)

backendApi.signSeverityForm takes preview and sends {overrides, preview: true} only then. boardStore
gains sofaForm, sofaPreview and sofaSign, through track like every board call, an answer after clear()
dropped; a signature reloads nothing. fakeApi lists severityForm and signSeverityForm.

Red first: 3 failed (the body had no preview; the store had no such methods).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 5: The strings, four languages, in a namespace of their own (X1)

**Files:**
- Create: `dashboard/src/live/i18n/strings/sofa.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (one import, one entry, each with a blank line either side)

- [ ] **Step 1: Write `strings/sofa.js`** (Write tool, then the CRLF call):

```js
// src/live/i18n/strings/sofa.js — the patient screen's SOFA box and form (G2-A4, screens/patient/sofa/).
// What every language must keep: the form is the engine's, filled from the WORST values of 24 hours, and it
// is not the alerting SOFA of the Sepsis-3 box; an organ with no measurement is «not measured», never a 0;
// the form raises no alert; completing is a measurement (no reason), correcting replaces a value (a reason
// of at least {min} characters, the engine's number) and the points are always the engine's; creatinine and
// bilirubin are mg/dL (D11); urine output is not scored here (D8); MAP is not entered here (D9). A refusal
// names its subject first, as every write's does (admin/refusal.js). Russian calls the engine «система».
// AZ/RU/EN await a native-speaking clinician's review before the pilot (O8).
export default {
  tr: {
    // SofaBox (D1, D7)
    title: "SOFA formu",
    open: "Formu aç",
    boxTotal: "Form toplamı",
    boxUnmeasured: "{count} / 6 organda ölçüm yok",
    boxAllMeasured: "Altı organın hepsinde ölçüm var",
    boxIntro: "Son 24 saatin en kötü değerleriyle doldurulur. Sepsis-3 kutusundaki SOFA son değerlerle hesaplanır; ikisi aynı sayı değildir.",
    boxReadAt: "{time} okuması.",
    signed: "İmzalandı · {who} · {time} · toplam {total}",
    signedCorrected: "İmzalandı · {who} · {time} · toplam {total} · {count} düzeltmeyle",
    unsigned: "İmzalanmadı.",
    reading: "SOFA formu okunuyor…",
    unreadable: "SOFA formu okunamadı: {reason}",
    noForm: "Motor bu hasta için SOFA formu göndermedi.",
    retry: "Yeniden dene",
    // SofaFormModal — the form (D2, D8, D9)
    intro: "Form motorun kaydından doldurulur: her organ penceredeki en kötü değeriyle puanlanır. Ölçümü olmayan organda «ölçülmedi» yazar — skor onu 0 sayar, ama ekran 0 yazmaz. Form alarm üretmez; imzalanana kadar kimsenin onaylamadığı bir sayıdır.",
    windowFull: "Pencere: son {hours} saat · {from} – {to}",
    windowShort: "Pencere: hasta {hours} saatten kısa süredir burada — form yatıştan bu yana geçen süreye dayanır · {to} itibarıyla",
    total: "Toplam: {total}",
    totalPreview: "Önizleme: toplam {total} (kayıttan: {auto}) — henüz imzalanmadı",
    organRespiration: "Solunum",
    organCoagulation: "Pıhtılaşma",
    organLiver: "Karaciğer",
    organCardiovascular: "Kardiyovasküler",
    organCns: "Merkezi sinir sistemi",
    organRenal: "Böbrek",
    points: "{points} puan",
    unmeasured: "ölçülmedi",
    failure: "organ yetmezliği",
    // the inputs (D3, D11)
    inPf: "PaO₂/FiO₂ oranı",
    inSupport: "Solunum desteği",
    inPlatelets: "Trombosit sayısı",
    inBilirubin: "Bilirubin düzeyi",
    inCreatinine: "Kreatinin düzeyi",
    inGcs: "GCS (Glasgow koma skalası)",
    unitPlatelets: "×10³/µL",
    unitMgdl: "mg/dL",
    unitGcs: "puan",
    supportNone: "Seçilmedi",
    supportYes: "evet",
    supportNo: "hayır",
    supportHint: "Bu formda son 24 saatteki tek bir «evet» kaydı PaO₂/FiO₂'yi destekte sayar; «hayır» o kaydı geri almaz.",
    supportChart: "Destek durumunu kaydet",
    srcClinician: "klinisyen kaydı",
    srcCorrection: "hekim düzeltmesi",
    outsideWindow: "Pencerede ölçüm yok: bu, pencereden önceki en yakın ölçüm.",
    corrected: "Düzeltildi — kayıttaki değer: {original}",
    heldLine: "Bekleyen düzeltme: {value} {unit} — önizlemede puanlanır",
    respNote: "PaO₂/FiO₂'nin 3 ve 4 puanlık bantları yalnız solunum desteğinde geçerlidir.",
    cardioNote: "MAP kayıttan gelir, bu formdan girilmez; vazopressörler İlaç ve antibiyotik kutusundan kaydedilir.",
    renalNote: "İdrar çıkışı bu formda puana katılmıyor.",
    // completing a row (D3)
    enter: "Ölçüm gir",
    enterFor: "Ölçüm gir: {input}",
    enterTitle: "{input} — yeni ölçüm",
    at: "Ölçüm saati",
    atHint: "En çok 24 saat geriye; ileri saat kabul edilmez.",
    atInvalid: "Ölçüm saati geçerli bir tarih ve saat olmalı.",
    atFuture: "Ölçüm saati ileride olamaz.",
    atTooOld: "Ölçüm saati 24 saatten eski olamaz.",
    valueEmpty: "Bir değer yazın.",
    notNumber: "Düz bir ondalık sayı olmalı.",
    outOfRange: "Beklenen aralığın ({low}–{high}) dışında — birim veya ondalık hatası olabilir.",
    supportEmpty: "Evet ya da hayır seçin.",
    saving: "Kaydediliyor…",
    chartSaved: "{subject}: {input} kaydedildi; form yeniden okunuyor.",
    chartRefused: "{subject} için ölçüm reddedildi: {reason}",
    chartNoRight: "Bu hesabın kayıt yetkisi yok.",
    chartDropped: "{subject} taburcu edilmiş; ölçüm alınmadı.",
    chartMayHaveLanded: "{subject} için ölçüm yanıt alamadı; kaydedilmiş olabilir — form yeniden okunuyor.",
    chartNoRightNote: "Ölçüm girmek clinical.chart yetkisi ister.",
    // correcting a measured value (D5)
    correct: "Düzelt",
    correctFor: "Düzelt: {input}",
    correctEdit: "Düzeltmeyi değiştir",
    correctEditFor: "Düzeltmeyi değiştir: {input}",
    correctTitle: "{input} — düzeltme",
    correctIntro: "Kayıttaki değer: {value} {unit}. Doğru değeri ve nedenini yazın; puanı motor yeniden hesaplar.",
    correctValue: "Doğru değer",
    reason: "Gerekçe",
    reasonHint: "En az {min} karakter; imzayla birlikte denetim kaydına girer.",
    reasonCount: "{count} / {min} karakter",
    reasonShort: "Gerekçe en az {min} karakter olmalı.",
    keep: "Düzeltmeyi tut",
    drop: "Düzeltmeyi kaldır",
    dropFor: "Düzeltmeyi kaldır: {input}",
    held: "{input} için düzeltme tutuldu; önizlemede puanlanır.",
    heldTitle: "Bekleyen düzeltmeler",
    heldItem: "{input}: {original} → {value} · gerekçe: «{reason}»",
    // preview, then sign (D6)
    preview: "Önizle",
    previewing: "Önizleme hazırlanıyor…",
    previewFirst: "İmzalamadan önce önizleyin: imzalayacağınız toplamı motor hesaplar.",
    previewStale: "Düzeltmeler önizlemeden sonra değişti; imzalamadan önce yeniden önizleyin.",
    previewed: "Önizleme hazır: toplam {total}. Bu sayıyı imzalamak için «İmzala».",
    previewRefused: "{subject} için önizleme alınamadı: {reason}",
    sign: "İmzala",
    signing: "İmzalanıyor…",
    signedToast: "{subject}: SOFA formu imzalandı · toplam {total}.",
    signedDiffers: "{subject}: SOFA formu toplam {total} ile imzalandı — önizlemede {previewed} idi; kayıt arada değişti.",
    signRefused: "{subject} için imza reddedildi: {reason}",
    signNoRight: "Bu hesabın imza yetkisi yok.",
    signMayHaveLanded: "{subject} için imza yanıt alamadı; atılmış olabilir — SOFA kutusundaki son imza satırına bakın.",
    signNoRightNote: "Düzeltmek ve imzalamak scores.sign yetkisi ister.",
    signOldEngine: "Bu motor sürümü önizlemeyi bilmiyor: düzeltme ve imza bu ekrandan kapalı.",
    rereadFailed: "Form yeniden okunamadı: {reason}. Gösterilen, önceki okuma.",
  },
  az: {
    // SofaBox (D1, D7)
    title: "SOFA forması",
    open: "Formanı açın",
    boxTotal: "Forma cəmi",
    boxUnmeasured: "{count} / 6 orqanda ölçmə yoxdur",
    boxAllMeasured: "Altı orqanın hamısında ölçmə var",
    boxIntro: "Son 24 saatın ən pis dəyərləri ilə doldurulur. Sepsis-3 qutusundakı SOFA son dəyərlərlə hesablanır; ikisi eyni ədəd deyil.",
    boxReadAt: "{time} oxunuşu.",
    signed: "İmzalanıb · {who} · {time} · cəmi {total}",
    signedCorrected: "İmzalanıb · {who} · {time} · cəmi {total} · {count} düzəlişlə",
    unsigned: "İmzalanmayıb.",
    reading: "SOFA forması oxunur…",
    unreadable: "SOFA forması oxuna bilmədi: {reason}",
    noForm: "Mühərrik bu xəstə üçün SOFA forması göndərmədi.",
    retry: "Yenidən cəhd edin",
    // SofaFormModal — the form (D2, D8, D9)
    intro: "Forma mühərrikin qeydindən doldurulur: hər orqan pəncərədəki ən pis dəyəri ilə qiymətləndirilir. Ölçməsi olmayan orqanda «ölçülməyib» yazılır — şkala onu 0 sayır, amma ekran 0 yazmır. Forma siqnal yaratmır; imzalanana qədər heç kimin təsdiqləmədiyi bir ədəddir.",
    windowFull: "Pəncərə: son {hours} saat · {from} – {to}",
    windowShort: "Pəncərə: xəstə {hours} saatdan az müddətdir buradadır — forma qəbuldan bəri keçən müddətə əsaslanır · {to} vəziyyətinə",
    total: "Cəmi: {total}",
    totalPreview: "Öncədən baxış: cəmi {total} (qeyddən: {auto}) — hələ imzalanmayıb",
    organRespiration: "Tənəffüs",
    organCoagulation: "Laxtalanma",
    organLiver: "Qaraciyər",
    organCardiovascular: "Ürək-damar",
    organCns: "Mərkəzi sinir sistemi",
    organRenal: "Böyrək",
    points: "{points} bal",
    unmeasured: "ölçülməyib",
    failure: "orqan çatışmazlığı",
    // the inputs (D3, D11)
    inPf: "PaO₂/FiO₂ nisbəti",
    inSupport: "Tənəffüs dəstəyi",
    inPlatelets: "Trombosit sayı",
    inBilirubin: "Bilirubin səviyyəsi",
    inCreatinine: "Kreatinin səviyyəsi",
    inGcs: "GCS (Qlazqo koma şkalası)",
    unitPlatelets: "×10³/mkl",
    unitMgdl: "mq/dl",
    unitGcs: "bal",
    supportNone: "Seçilməyib",
    supportYes: "bəli",
    supportNo: "xeyr",
    supportHint: "Bu formada son 24 saatda bir «bəli» qeydi PaO₂/FiO₂-ni dəstəkdə sayır; «xeyr» həmin qeydi geri almır.",
    supportChart: "Dəstək vəziyyətini qeyd edin",
    srcClinician: "klinisist qeydi",
    srcCorrection: "həkim düzəlişi",
    outsideWindow: "Pəncərədə ölçmə yoxdur: bu, pəncərədən əvvəlki ən yaxın ölçmədir.",
    corrected: "Düzəldilib — qeyddəki dəyər: {original}",
    heldLine: "Gözləyən düzəliş: {value} {unit} — öncədən baxışda qiymətləndirilir",
    respNote: "PaO₂/FiO₂-nin 3 və 4 ballıq zolaqları yalnız tənəffüs dəstəyində keçərlidir.",
    cardioNote: "MAP qeyddən gəlir, bu formadan daxil edilmir; vazopressorlar Dərman və antibiotik qutusundan qeyd olunur.",
    renalNote: "Sidik ifrazı bu formada bala daxil edilmir.",
    // completing a row (D3)
    enter: "Ölçmə daxil edin",
    enterFor: "Ölçmə daxil edin: {input}",
    enterTitle: "{input} — yeni ölçmə",
    at: "Ölçmə saatı",
    atHint: "Ən çoxu 24 saat geriyə; irəli saat qəbul edilmir.",
    atInvalid: "Ölçmə saatı düzgün tarix və saat olmalıdır.",
    atFuture: "Ölçmə saatı gələcəkdə ola bilməz.",
    atTooOld: "Ölçmə saatı 24 saatdan köhnə ola bilməz.",
    valueEmpty: "Dəyər yazın.",
    notNumber: "Sadə onluq ədəd olmalıdır.",
    outOfRange: "Gözlənilən aralıqdan ({low}–{high}) kənardadır — vahid və ya onluq vergül səhvi ola bilər.",
    supportEmpty: "Bəli və ya xeyr seçin.",
    saving: "Yadda saxlanılır…",
    chartSaved: "{subject}: {input} qeyd olundu; forma yenidən oxunur.",
    chartRefused: "{subject} üçün ölçmə rədd edildi: {reason}",
    chartNoRight: "Bu hesabın qeyd etmə səlahiyyəti yoxdur.",
    chartDropped: "{subject} tərxis edilib; ölçmə qəbul edilmədi.",
    chartMayHaveLanded: "{subject} üçün ölçmə cavab almadı; yadda saxlanılmış ola bilər — forma yenidən oxunur.",
    chartNoRightNote: "Ölçmə daxil etmək clinical.chart səlahiyyəti tələb edir.",
    // correcting a measured value (D5)
    correct: "Düzəldin",
    correctFor: "Düzəldin: {input}",
    correctEdit: "Düzəlişi dəyişin",
    correctEditFor: "Düzəlişi dəyişin: {input}",
    correctTitle: "{input} — düzəliş",
    correctIntro: "Qeyddəki dəyər: {value} {unit}. Düzgün dəyəri və səbəbini yazın; balı mühərrik yenidən hesablayır.",
    correctValue: "Düzgün dəyər",
    reason: "Əsaslandırma",
    reasonHint: "Ən azı {min} simvol; imza ilə birlikdə audit qeydinə düşür.",
    reasonCount: "{count} / {min} simvol",
    reasonShort: "Əsaslandırma ən azı {min} simvol olmalıdır.",
    keep: "Düzəlişi saxlayın",
    drop: "Düzəlişi götürün",
    dropFor: "Düzəlişi götürün: {input}",
    held: "{input} üçün düzəliş saxlanıldı; öncədən baxışda qiymətləndirilir.",
    heldTitle: "Gözləyən düzəlişlər",
    heldItem: "{input}: {original} → {value} · əsaslandırma: «{reason}»",
    // preview, then sign (D6)
    preview: "Öncədən baxın",
    previewing: "Öncədən baxış hazırlanır…",
    previewFirst: "İmzalamazdan əvvəl öncədən baxın: imzalayacağınız cəmi mühərrik hesablayır.",
    previewStale: "Düzəlişlər öncədən baxışdan sonra dəyişib; imzalamazdan əvvəl yenidən baxın.",
    previewed: "Öncədən baxış hazırdır: cəmi {total}. Bu ədədi imzalamaq üçün «İmzalayın».",
    previewRefused: "{subject} üçün öncədən baxış alınmadı: {reason}",
    sign: "İmzalayın",
    signing: "İmzalanır…",
    signedToast: "{subject}: SOFA forması imzalandı · cəmi {total}.",
    signedDiffers: "{subject}: SOFA forması cəmi {total} ilə imzalandı — öncədən baxışda {previewed} idi; qeyd arada dəyişib.",
    signRefused: "{subject} üçün imza rədd edildi: {reason}",
    signNoRight: "Bu hesabın imza səlahiyyəti yoxdur.",
    signMayHaveLanded: "{subject} üçün imza cavab almadı; atılmış ola bilər — SOFA qutusundakı son imza sətrinə baxın.",
    signNoRightNote: "Düzəltmək və imzalamaq scores.sign səlahiyyəti tələb edir.",
    signOldEngine: "Mühərrikin bu versiyası öncədən baxışı bilmir: düzəliş və imza bu ekrandan bağlıdır.",
    rereadFailed: "Forma yenidən oxuna bilmədi: {reason}. Göstərilən əvvəlki oxunuşdur.",
  },
  ru: {
    // SofaBox (D1, D7)
    title: "Форма SOFA",
    open: "Открыть форму",
    boxTotal: "Сумма формы",
    boxUnmeasured: "Нет измерений у {count} из 6 органов",
    boxAllMeasured: "Измерения есть по всем шести органам",
    boxIntro: "Заполняется по худшим значениям за последние 24 часа. SOFA в блоке Sepsis-3 считается по последним значениям; это разные числа.",
    boxReadAt: "Прочитано в {time}.",
    signed: "Подписано · {who} · {time} · сумма {total}",
    signedCorrected: "Подписано · {who} · {time} · сумма {total} · исправлений: {count}",
    unsigned: "Не подписано.",
    reading: "Форма SOFA читается…",
    unreadable: "Форму SOFA прочитать не удалось: {reason}",
    noForm: "Система не передала форму SOFA для этого пациента.",
    retry: "Повторить",
    // SofaFormModal — the form (D2, D8, D9)
    intro: "Форма заполняется из записи системы: каждый орган оценивается по худшему значению в окне. У органа без измерения написано «не измерено» — шкала считает его за 0, но экран 0 не пишет. Форма не создаёт тревог; пока она не подписана, это число, которое никто не подтвердил.",
    windowFull: "Окно: последние {hours} ч · {from} – {to}",
    windowShort: "Окно: пациент здесь меньше {hours} ч — форма опирается на время с момента поступления · на {to}",
    total: "Сумма: {total}",
    totalPreview: "Предпросмотр: сумма {total} (по записи: {auto}) — ещё не подписано",
    organRespiration: "Дыхание",
    organCoagulation: "Свёртывание",
    organLiver: "Печень",
    organCardiovascular: "Сердечно-сосудистая система",
    organCns: "Центральная нервная система",
    organRenal: "Почки",
    points: "баллы: {points}",
    unmeasured: "не измерено",
    failure: "органная недостаточность",
    // the inputs (D3, D11)
    inPf: "Отношение PaO₂/FiO₂",
    inSupport: "Респираторная поддержка",
    inPlatelets: "Тромбоциты",
    inBilirubin: "Билирубин",
    inCreatinine: "Креатинин",
    inGcs: "Шкала комы Глазго (GCS)",
    unitPlatelets: "×10³/мкл",
    unitMgdl: "мг/дл",
    unitGcs: "баллов",
    supportNone: "Не выбрано",
    supportYes: "да",
    supportNo: "нет",
    supportHint: "В этой форме одна запись «да» за последние 24 часа засчитывает PaO₂/FiO₂ как на поддержке; «нет» её не отменяет.",
    supportChart: "Записать статус поддержки",
    srcClinician: "запись клинициста",
    srcCorrection: "исправление врача",
    outsideWindow: "В окне измерений нет: это ближайшее измерение до окна.",
    corrected: "Исправлено — в записи было: {original}",
    heldLine: "Исправление ожидает: {value} {unit} — оценивается в предпросмотре",
    respNote: "Полосы PaO₂/FiO₂ на 3 и 4 балла действуют только при респираторной поддержке.",
    cardioNote: "MAP берётся из записи и здесь не вводится; вазопрессоры записываются в блоке «Препараты и антибиотик».",
    renalNote: "Диурез в этой форме не оценивается.",
    // completing a row (D3)
    enter: "Ввести измерение",
    enterFor: "Ввести измерение: {input}",
    enterTitle: "{input} — новое измерение",
    at: "Время измерения",
    atHint: "Не более 24 часов назад; время в будущем не принимается.",
    atInvalid: "Время измерения должно быть корректной датой и временем.",
    atFuture: "Время измерения не может быть в будущем.",
    atTooOld: "Время измерения не может быть старше 24 часов.",
    valueEmpty: "Введите значение.",
    notNumber: "Нужно простое десятичное число.",
    outOfRange: "Вне ожидаемого диапазона ({low}–{high}) — возможна ошибка единицы измерения или запятой.",
    supportEmpty: "Выберите «да» или «нет».",
    saving: "Сохраняется…",
    chartSaved: "{subject}: {input} записано; форма читается заново.",
    chartRefused: "Измерение для {subject} отклонено: {reason}",
    chartNoRight: "У этой учётной записи нет права вносить записи.",
    chartDropped: "{subject}: пациент выписан; измерение не принято.",
    chartMayHaveLanded: "Ответа на измерение для {subject} нет; возможно, оно сохранено — форма читается заново.",
    chartNoRightNote: "Для ввода измерений нужно право clinical.chart.",
    // correcting a measured value (D5)
    correct: "Исправить",
    correctFor: "Исправить: {input}",
    correctEdit: "Изменить исправление",
    correctEditFor: "Изменить исправление: {input}",
    correctTitle: "{input} — исправление",
    correctIntro: "В записи: {value} {unit}. Укажите верное значение и причину; балл пересчитает система.",
    correctValue: "Верное значение",
    reason: "Обоснование",
    reasonHint: "Не менее {min} символов; попадает в журнал аудита вместе с подписью.",
    reasonCount: "{count} / {min} символов",
    reasonShort: "Обоснование должно быть не короче {min} символов.",
    keep: "Сохранить исправление",
    drop: "Убрать исправление",
    dropFor: "Убрать исправление: {input}",
    held: "Исправление для {input} сохранено; оно оценивается в предпросмотре.",
    heldTitle: "Ожидающие исправления",
    heldItem: "{input}: {original} → {value} · обоснование: «{reason}»",
    // preview, then sign (D6)
    preview: "Предпросмотр",
    previewing: "Готовится предпросмотр…",
    previewFirst: "Перед подписью сделайте предпросмотр: сумму, которую вы подпишете, считает система.",
    previewStale: "Исправления изменились после предпросмотра; перед подписью сделайте его снова.",
    previewed: "Предпросмотр готов: сумма {total}. «Подписать» подписывает это число.",
    previewRefused: "Предпросмотр для {subject} не получен: {reason}",
    sign: "Подписать",
    signing: "Подписывается…",
    signedToast: "{subject}: форма SOFA подписана · сумма {total}.",
    signedDiffers: "{subject}: форма SOFA подписана с суммой {total} — в предпросмотре было {previewed}; запись за это время изменилась.",
    signRefused: "Подпись для {subject} отклонена: {reason}",
    signNoRight: "У этой учётной записи нет права подписи.",
    signMayHaveLanded: "Ответа на подпись для {subject} нет; возможно, она прошла — проверьте строку последней подписи в блоке SOFA.",
    signNoRightNote: "Для исправления и подписи нужно право scores.sign.",
    signOldEngine: "Эта версия системы не умеет делать предпросмотр: исправление и подпись с этого экрана закрыты.",
    rereadFailed: "Форму не удалось прочитать заново: {reason}. Показано предыдущее чтение.",
  },
  en: {
    // SofaBox (D1, D7)
    title: "SOFA form",
    open: "Open the form",
    boxTotal: "Form total",
    boxUnmeasured: "{count} of 6 organs have no measurement",
    boxAllMeasured: "All six organs have a measurement",
    boxIntro: "Filled from the worst values of the last 24 hours. The SOFA in the Sepsis-3 box is computed from the latest values; the two are not the same number.",
    boxReadAt: "Read at {time}.",
    signed: "Signed · {who} · {time} · total {total}",
    signedCorrected: "Signed · {who} · {time} · total {total} · with {count} correction(s)",
    unsigned: "Not signed.",
    reading: "Reading the SOFA form…",
    unreadable: "The SOFA form could not be read: {reason}",
    noForm: "The engine sent no SOFA form for this patient.",
    retry: "Try again",
    // SofaFormModal — the form (D2, D8, D9)
    intro: "The form is filled from the engine's record: each organ is scored on its worst value in the window. An organ with no measurement reads «not measured» — the score counts it as 0, but the screen does not print a 0. The form raises no alert; until it is signed it is a number nobody has confirmed.",
    windowFull: "Window: last {hours} hours · {from} – {to}",
    windowShort: "Window: the patient has been here for less than {hours} hours — the form rests on the time since admission · as of {to}",
    total: "Total: {total}",
    totalPreview: "Preview: total {total} (from the record: {auto}) — not signed yet",
    organRespiration: "Respiration",
    organCoagulation: "Coagulation",
    organLiver: "Liver",
    organCardiovascular: "Cardiovascular",
    organCns: "Central nervous system",
    organRenal: "Renal",
    points: "score {points}",
    unmeasured: "not measured",
    failure: "organ failure",
    // the inputs (D3, D11)
    inPf: "PaO₂/FiO₂ ratio",
    inSupport: "Respiratory support",
    inPlatelets: "Platelet count",
    inBilirubin: "Bilirubin",
    inCreatinine: "Creatinine",
    inGcs: "GCS (Glasgow Coma Scale)",
    unitPlatelets: "×10³/µL",
    unitMgdl: "mg/dL",
    unitGcs: "points",
    supportNone: "Not selected",
    supportYes: "yes",
    supportNo: "no",
    supportHint: "On this form a single «yes» in the last 24 hours counts the PaO₂/FiO₂ as on support; a «no» does not undo it.",
    supportChart: "Chart the support status",
    srcClinician: "charted by a clinician",
    srcCorrection: "physician's correction",
    outsideWindow: "No measurement in the window: this is the nearest one before it.",
    corrected: "Corrected — the record held: {original}",
    heldLine: "Correction held: {value} {unit} — scored in the preview",
    respNote: "The 3- and 4-point PaO₂/FiO₂ bands apply only on respiratory support.",
    cardioNote: "MAP comes from the record and is not entered here; vasopressors are charted from the Medication and antibiotic box.",
    renalNote: "Urine output is not scored on this form.",
    // completing a row (D3)
    enter: "Enter a measurement",
    enterFor: "Enter a measurement: {input}",
    enterTitle: "{input} — new measurement",
    at: "Measurement time",
    atHint: "Up to 24 hours back; a time in the future is not accepted.",
    atInvalid: "The measurement time must be a valid date and time.",
    atFuture: "The measurement time cannot be in the future.",
    atTooOld: "The measurement time cannot be older than 24 hours.",
    valueEmpty: "Enter a value.",
    notNumber: "Must be a plain decimal number.",
    outOfRange: "Outside the expected range ({low}–{high}) — possibly a unit or decimal-point error.",
    supportEmpty: "Choose yes or no.",
    saving: "Saving…",
    chartSaved: "{subject}: {input} charted; the form is being read again.",
    chartRefused: "The measurement for {subject} was refused: {reason}",
    chartNoRight: "This account has no right to chart.",
    chartDropped: "{subject} has been discharged; the measurement was not taken.",
    chartMayHaveLanded: "The measurement for {subject} got no answer; it may have been saved — the form is being read again.",
    chartNoRightNote: "Entering a measurement needs clinical.chart.",
    // correcting a measured value (D5)
    correct: "Correct",
    correctFor: "Correct: {input}",
    correctEdit: "Change the correction",
    correctEditFor: "Change the correction: {input}",
    correctTitle: "{input} — correction",
    correctIntro: "The record holds {value} {unit}. Enter the right value and why; the engine scores it again.",
    correctValue: "Right value",
    reason: "Reason",
    reasonHint: "At least {min} characters; it goes into the audit trail with the signature.",
    reasonCount: "{count} / {min} characters",
    reasonShort: "The reason must be at least {min} characters.",
    keep: "Keep the correction",
    drop: "Remove the correction",
    dropFor: "Remove the correction: {input}",
    held: "Correction kept for {input}; it is scored in the preview.",
    heldTitle: "Corrections held",
    heldItem: "{input}: {original} → {value} · reason: «{reason}»",
    // preview, then sign (D6)
    preview: "Preview",
    previewing: "Preparing the preview…",
    previewFirst: "Preview before signing: the engine computes the total you will sign.",
    previewStale: "The corrections changed after the preview; preview again before signing.",
    previewed: "Preview ready: total {total}. «Sign» signs this number.",
    previewRefused: "The preview for {subject} could not be made: {reason}",
    sign: "Sign",
    signing: "Signing…",
    signedToast: "{subject}: SOFA form signed · total {total}.",
    signedDiffers: "{subject}: SOFA form signed with total {total} — the preview said {previewed}; the record changed in between.",
    signRefused: "The signature for {subject} was refused: {reason}",
    signNoRight: "This account has no right to sign.",
    signMayHaveLanded: "The signature for {subject} got no answer; it may have gone through — check the last signature line in the SOFA box.",
    signNoRightNote: "Correcting and signing need scores.sign.",
    signOldEngine: "This engine version cannot preview: correcting and signing are closed on this screen.",
    rereadFailed: "The form could not be read again: {reason}. What is shown is the previous read.",
  },
};
```

```bash
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" /c/tmp/g2a-a4/dashboard/src/live/i18n/strings/sofa.js
```

- [ ] **Step 2: Register the namespace** — in `i18n/catalog.js`, two Edits:

old:
```js
import kabul from "./strings/kabul.js";
```
new:
```js
import kabul from "./strings/kabul.js";

// G2-A4: the patient screen's SOFA box and form (screens/patient/sofa).
import sofa from "./strings/sofa.js";
```

old:
```js
  kabul, // G2-B1a
};
```
new:
```js
  kabul, // G2-B1a

  sofa, // G2-A4
};
```

- [ ] **Step 3: Run the dictionaries' test**

Run: `npx vitest run src/live/i18n/strings.test.js`

Expected: all passed — the four languages with the Turkish source's keys and placeholders, no `az` = `tr`, Cyrillic in every Russian text, «система». If it names an `az` text equal to `tr`, change the Azerbaijani wording (do not list it).

- [ ] **Step 4: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/live/i18n/strings/sofa.js dashboard/src/live/i18n/catalog.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/i18n/strings/sofa.js dashboard/src/live/i18n/catalog.js
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(i18n): the SOFA box's and form's strings in four languages, a namespace of their own (G2-A4, X1)

strings/sofa.js (tr source, az default, ru, en) and its two lines in catalog.js, each with a blank line
either side as the file asks. No az = tr identity, Cyrillic in every Russian text.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 6: `sofaFields.js` — the organs in the source's order, the inputs and their bounds, the rules (D2, D3, D5, D11)

**Files:**
- Create: `dashboard/src/live/screens/patient/sofa/sofa.testutil.js`
- Create: `dashboard/src/live/screens/patient/sofa/sofaFields.js`
- Test: `dashboard/src/live/screens/patient/sofa/sofaFields.test.js`

- [ ] **Step 1: The test utility** (Write, then the CRLF call) — `sofa.testutil.js`:

```js
// src/live/screens/patient/sofa/sofa.testutil.js — test-only: the SOFA form as the engine answers it
// (GET /scores/sofa/{id}: scoring/sofa_form.py `as_dict` with G2-A4's `last_signed` and `min_reason_chars`;
// the POST with `preview: true`; the signing POST), with synthetic values. The rows come in the ENGINE's
// build order (respiration, cardiovascular, then coagulation, liver, cns, renal), which the screen must put
// in the source's. Times are against data/board.testutil.js's NOW (2026-10-08T10:00Z): measured 2 h 30 min
// before it, signed 2 min before.
export const MEASURED_AT = "2026-10-08T07:30:00+00:00";
export const SIGNED_AT = "2026-10-08T09:58:00+00:00";
/** A reason long enough for the engine's 20 characters. */
export const WHY = "Laboratuvar sonucu esas alındı, cihaz değeri hatalı";

/** One input cell (scoring/worst.py `WorstValue.as_dict`); a `value` of null is an unmeasured one. */
export function cell(code, value, over = {}) {
  const measured = value !== null;
  return {
    code, value, at: measured ? MEASURED_AT : null, points: 0, source: measured ? "clinician" : "",
    considered: measured ? 1 : 0, measured, outside_window: false, overridden: false, original: null,
    ...over,
  };
}

/** The form: respiration 2 (PaO₂/FiO₂ 250), coagulation 3 (platelets 45, organ failure), the other four
 *  organs unmeasured — total 5. */
export function sofaForm(over = {}) {
  return {
    patient_id: "S-001", score: "SOFA", source: "sepsis-3-jama-2016", total: 5,
    rows: [
      { organ: "respiration", points: 2, measured: true, failure: false, inputs: [cell("pao2_fio2", 250, { points: 2 })] },
      { organ: "cardiovascular", points: 0, measured: false, failure: false, inputs: [cell("map", null)] },
      { organ: "coagulation", points: 3, measured: true, failure: true, inputs: [cell("platelets", 45, { points: 3 })] },
      { organ: "liver", points: 0, measured: false, failure: false, inputs: [cell("bilirubin", null)] },
      { organ: "cns", points: 0, measured: false, failure: false, inputs: [cell("gcs", null)] },
      { organ: "renal", points: 0, measured: false, failure: false, inputs: [cell("creatinine", null)] },
    ],
    window_hours: 24, window_from: "2026-10-07T10:00:00+00:00", window_to: "2026-10-08T10:00:00+00:00",
    unmeasured_organs: ["cardiovascular", "liver", "cns", "renal"], covers_full_window: true,
    organ_failures: ["coagulation"], corrected_cells: [], signed: false,
    last_signed: null, min_reason_chars: 20,
    ...over,
  };
}

/** The engine's answer to `preview: true` with the platelet count corrected from 45 to 80: coagulation
 *  re-scored to 2, the total 4 (api/app.py `sign_sofa_form`, G2-A4). */
export function previewAnswer() {
  const { last_signed: _signed, min_reason_chars: _min, ...base } = sofaForm();   // the preview's form is `rebuilt.as_dict()`
  const rows = base.rows.map((row) => (row.organ !== "coagulation" ? row : {
    ...row, points: 2, failure: false,
    inputs: [cell("platelets", 80, { points: 2, at: null, source: "hekim", overridden: true, original: 45 })],
  }));
  return {
    preview: true, signed: false, total: 4, auto_total: 5,
    overrides: [{ code: "platelets", value: 80, reason: WHY, original: 45 }],
    form: { ...base, rows, total: 4, organ_failures: [], corrected_cells: ["platelets"], auto_total: 5 },
  };
}

/** The signing answer (scoring/signing.py `SignedScore.as_dict`) for the same correction, `total` as given. */
export function signedAnswer({ total = 4 } = {}) {
  const { form, overrides } = previewAnswer();
  return {
    patient_id: "S-001", score: "SOFA", total, signed_by: "dr.elif", signed_at: SIGNED_AT, signed: true,
    overrides, form: { ...form, total, signed: true },
  };
}

/** The box's last signature (D7) after that signature. */
export const LAST_SIGNED = Object.freeze({ total: 4, auto_total: 5, signed_by: "dr.elif", at: SIGNED_AT, corrections: 1 });
```

- [ ] **Step 2: Write the failing tests** (Write, then the CRLF call) — `sofaFields.test.js`:

```js
// sofaFields.test.js — the rows in the source's order, the door's bounds for the six inputs the form
// completes, the 24-hour time rule, the engine's way of counting a reason, and one list of corrections for the
// preview and the signature (G2-A4). Pure functions; synthetic values.
import { describe, it, expect } from "vitest";
import { NOW } from "../../../data/board.testutil.js";
import {
  ORGANS, checkTime, checkValue, correctionsKey, isEnterable, labelOf, overridesOf, reasonCount, recordedOf,
  rowsInOrder, sourceText, stampOf, toLocalInput,
} from "./sofaFields.js";
import { WHY, previewAnswer, sofaForm } from "./sofa.testutil.js";

const t = (key) => key;

describe("sofaFields", () => {
  it("puts the engine's rows in the source table's order, and draws no row the engine did not send", () => {
    expect(rowsInOrder(sofaForm()).map((entry) => entry.organ))
      .toEqual(["respiration", "coagulation", "liver", "cardiovascular", "cns", "renal"]);
    expect(rowsInOrder(null)).toEqual([]);
    expect(rowsInOrder({ rows: [{ organ: "renal", inputs: [] }, { organ: "spleen", inputs: [] }] }).map((e) => e.organ)).toEqual(["renal"]);
    expect(ORGANS.find((o) => o.organ === "renal").noteKey).toBe("sofa.renalNote");
    expect(ORGANS.find((o) => o.organ === "cardiovascular").noteKey).toBe("sofa.cardioNote");
  });

  it("holds a slipped digit back with the door's bounds, and a correction of the pressors by theirs", () => {
    expect(checkValue("platelets", "2000")).toEqual({ value: 2000 });
    expect(checkValue("platelets", "2001")).toEqual({ error: { key: "sofa.outOfRange", params: { low: 0, high: 2000 } } });
    expect(checkValue("bilirubin", "2,4")).toEqual({ value: 2.4 });
    expect(checkValue("bilirubin", "61").error.key).toBe("sofa.outOfRange");
    expect(checkValue("creatinine", "150").error.params).toEqual({ low: 0, high: 30 });      // a µmol/L creatinine
    expect(checkValue("gcs", "2").error.params).toEqual({ low: 3, high: 15 });
    expect(checkValue("pao2_fio2", "19").error.params).toEqual({ low: 20, high: 700 });
    expect(checkValue("pao2_fio2", "700")).toEqual({ value: 700 });
    expect(checkValue("norepinephrine_rate", "25").error.params).toEqual({ low: 0, high: 20 });
    expect(checkValue("map", "250")).toEqual({ value: 250 });                                  // the door bounds no MAP; nor does this
    expect(checkValue("platelets", "").error.key).toBe("sofa.valueEmpty");
    expect(checkValue("platelets", "1e3").error.key).toBe("sofa.notNumber");
    expect(checkValue("platelets", "-5").error.key).toBe("sofa.notNumber");
  });

  it("takes the support flag as 1 or 0 and nothing else", () => {
    expect(checkValue("on_resp_support", "1")).toEqual({ value: 1 });
    expect(checkValue("on_resp_support", "0")).toEqual({ value: 0 });
    expect(checkValue("on_resp_support", "").error.key).toBe("sofa.supportEmpty");
    expect(checkValue("on_resp_support", "2").error.key).toBe("sofa.supportEmpty");
    expect(isEnterable("on_resp_support")).toBe(true);
    expect(isEnterable("map")).toBe(false);                                                    // D9: MAP is not entered here
    expect(isEnterable("constructor")).toBe(false);
  });

  it("dates a measurement up to 24 h back and never ahead, a minute of skew aside", () => {
    expect(checkTime(toLocalInput(NOW), NOW)).toEqual({ recordedAt: new Date(NOW).toISOString() });
    expect(checkTime(toLocalInput(NOW + 10 * 60_000), NOW).error.key).toBe("sofa.atFuture");
    expect(checkTime(toLocalInput(NOW + 30_000), NOW).error).toBeUndefined();
    expect(checkTime(toLocalInput(NOW - 25 * 3600_000), NOW).error.key).toBe("sofa.atTooOld");
    expect(checkTime("", NOW).error.key).toBe("sofa.atInvalid");
  });

  it("counts a reason as the engine does — trimmed, in characters — and reads what the record holds", () => {
    expect(reasonCount("  qısa  ")).toBe(4);
    expect(reasonCount(null)).toBe(0);
    expect(recordedOf(sofaForm(), "platelets")).toBe(45);
    expect(recordedOf(previewAnswer().form, "platelets")).toBe(45);                           // a corrected cell's original
    expect(recordedOf(sofaForm(), "bilirubin")).toBeNull();
    expect(recordedOf(sofaForm(), "lactate")).toBeNull();
  });

  it("sends one list of corrections for the preview and the signature, keyed so that a change shows", () => {
    const held = { platelets: { value: 80, reason: ` ${WHY} ` } };
    expect(overridesOf(held)).toEqual([{ code: "platelets", value: 80, reason: WHY }]);
    expect(correctionsKey(held)).not.toBe(correctionsKey({ platelets: { value: 81, reason: WHY } }));
    expect(correctionsKey({})).toBe("[]");
  });

  it("names a source and an input in the reader's words, and an unknown one by the engine's own code", () => {
    expect(sourceText(t, "clinician")).toBe("sofa.srcClinician");
    expect(sourceText(t, "hekim")).toBe("sofa.srcCorrection");
    expect(sourceText(t, "nce")).toBe("nce");
    expect(sourceText(t, "")).toBe("");
    expect(labelOf(t, "creatinine")).toEqual({ label: "sofa.inCreatinine", unit: "sofa.unitMgdl" });   // D11: mg/dL
    expect(labelOf(t, "map")).toEqual({ label: "board.chMap", unit: "board.unitMmhg" });
    expect(labelOf(t, "dopamine_rate")).toEqual({ label: "patient.medsDrugDopamine", unit: "patient.medsRateUnit" });
    expect(labelOf(t, "constructor")).toEqual({ label: "constructor", unit: "" });
    expect(stampOf(null, NOW)).toBe("");
  });
});
```

- [ ] **Step 3: Run it and see it red**

Run: `npx vitest run src/live/screens/patient/sofa/sofaFields.test.js`

Expected: the file fails with `Failed to resolve import "./sofaFields.js"`.

- [ ] **Step 4: Write `sofaFields.js`** (Write, then the CRLF call):

```js
// src/live/screens/patient/sofa/sofaFields.js — what the SOFA form shows and what it may write (G2-A4).
//
// THE ROWS IN THE SOURCE'S ORDER (D2) — respiration, coagulation, liver, cardiovascular, CNS, renal, as the
// table in Homunculus/wiki/concepts/sofa-score.md lists them — not the order the engine builds them in
// (scoring/sofa_form.py builds respiration and cardiovascular first, because those two are not one value).
// A clinician checks the form against the table she knows; the order is the table's.
//
// THE INPUTS, by the engine's code: the label and the unit every cell is printed with and, for the six the
// form completes (D3), the door's bounds — api/clinical.py PLAUSIBLE, mirrored only to hold a slipped digit
// back before it is sent; the server stays authoritative. Creatinine and bilirubin are mg/dL, the unit the
// laboratory reports and the engine reads (D11): the unit is printed beside the value and in the field's
// label, and nothing converts. No band, no threshold, no point lives here: the browser scores nothing
// (Decision 1), and every point on the form is the engine's.
//
// The number rule and the time rule are the Meds form's (meds/medsFields.js), imported rather than copied:
// one "plain decimal" and one "up to 24 h back, never ahead" across the patient screen's charting.
import { dayStamp } from "../../../i18n/dates.js";
import { BACKDATE_MS, PRESSORS, fromLocalInput, number } from "../meds/medsFields.js";

export { BACKDATE_MS, toLocalInput } from "../meds/medsFields.js";

/** Own properties only: an engine code such as "constructor" is not an input this build knows. */
const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null);

/** The six organs in the source table's order, each with its name and the note printed under its row:
 *  what charted support changes (respiration), MAP not entered here (D9), urine output not scored (D8). */
export const ORGANS = Object.freeze([
  Object.freeze({ organ: "respiration", labelKey: "sofa.organRespiration", noteKey: "sofa.respNote" }),
  Object.freeze({ organ: "coagulation", labelKey: "sofa.organCoagulation", noteKey: null }),
  Object.freeze({ organ: "liver", labelKey: "sofa.organLiver", noteKey: null }),
  Object.freeze({ organ: "cardiovascular", labelKey: "sofa.organCardiovascular", noteKey: "sofa.cardioNote" }),
  Object.freeze({ organ: "cns", labelKey: "sofa.organCns", noteKey: null }),
  Object.freeze({ organ: "renal", labelKey: "sofa.organRenal", noteKey: "sofa.renalNote" }),
]);

/** The six inputs the form completes through POST /clinical/{id} (D3, D4), with the door's bounds.
 *  `on_resp_support` is a flag the door takes as 1 or 0; it is no cell of the form — it decides which
 *  PaO₂/FiO₂ bands apply — so it is charted from under the respiration row. */
export const ENTERABLE = Object.freeze({
  pao2_fio2: Object.freeze({ labelKey: "sofa.inPf", unitKey: "board.unitMmhg", min: 20, max: 700 }),
  on_resp_support: Object.freeze({ labelKey: "sofa.inSupport", flag: true }),
  platelets: Object.freeze({ labelKey: "sofa.inPlatelets", unitKey: "sofa.unitPlatelets", min: 0, max: 2000 }),
  bilirubin: Object.freeze({ labelKey: "sofa.inBilirubin", unitKey: "sofa.unitMgdl", min: 0, max: 60 }),
  gcs: Object.freeze({ labelKey: "sofa.inGcs", unitKey: "sofa.unitGcs", min: 3, max: 15 }),
  creatinine: Object.freeze({ labelKey: "sofa.inCreatinine", unitKey: "sofa.unitMgdl", min: 0, max: 30 }),
});

/** The cardiovascular row's inputs, which the form shows and may correct but never completes (D9: MAP comes
 *  from the record, the pressors from the Meds box): the board's MAP words, and the Meds form's drug names,
 *  unit and bounds. MAP has no bound at the door and has none here. */
const OTHER_INPUTS = Object.freeze({
  map: Object.freeze({ labelKey: "board.chMap", unitKey: "board.unitMmhg" }),
  ...Object.fromEntries(PRESSORS.map((p) => [
    p.code, Object.freeze({ labelKey: p.labelKey, unitKey: "patient.medsRateUnit", min: p.min, max: p.max }),
  ])),
});

const specOf = (code) => own(ENTERABLE, code) ?? own(OTHER_INPUTS, code);

/** Is this an input the form completes (D3)? */
export const isEnterable = (code) => own(ENTERABLE, code) !== null;

/** Is this input the support flag, charted as yes or no? */
export const isFlag = (code) => own(ENTERABLE, code)?.flag === true;

/** An input's label and unit in the reader's words. A code this build does not know is printed as the
 *  engine's own code, with no unit — never a guess. */
export function labelOf(t, code) {
  const spec = specOf(code);
  return { label: spec ? t(spec.labelKey) : String(code ?? "—"), unit: spec?.unitKey ? t(spec.unitKey) : "" };
}

/** The engine's rows in the source's order. A row the engine did not send is left out, never drawn empty;
 *  an organ this build does not know is not drawn. */
export function rowsInOrder(form) {
  const rows = Array.isArray(form?.rows) ? form.rows : [];
  return ORGANS
    .map((o) => ({ ...o, row: rows.find((r) => r?.organ === o.organ) ?? null }))
    .filter((o) => o.row !== null);
}

/** What the RECORD holds for an input — the value a correction replaces (D5) — as the engine last sent the
 *  form: a corrected cell's original, else the cell's value; null when the form has no such cell. Read at
 *  each render, so a held correction always names the record's current value. */
export function recordedOf(form, code) {
  for (const row of Array.isArray(form?.rows) ? form.rows : []) {
    for (const c of Array.isArray(row?.inputs) ? row.inputs : []) {
      if (c?.code === code) return c.overridden ? c.original : c.value;
    }
  }
  return null;
}

/** A typed value for `code`, checked as the door checks it: `{ value }` or `{ error: { key, params? } }`. One
 *  check for completing (D3) and correcting (D5, X7): a slipped digit is the same slip whether it is charted
 *  or typed over a recorded value. The flag takes the select's "1" or "0". */
export function checkValue(code, raw) {
  const spec = specOf(code);
  if (spec?.flag) return raw === "1" || raw === "0" ? { value: Number(raw) } : { error: { key: "sofa.supportEmpty" } };
  const n = number(raw);
  if (n === "") return { error: { key: "sofa.valueEmpty" } };
  if (Number.isNaN(n)) return { error: { key: "sofa.notNumber" } };
  if (spec && Number.isFinite(spec.min) && (n < spec.min || n > spec.max)) {
    return { error: { key: "sofa.outOfRange", params: { low: spec.min, high: spec.max } } };
  }
  return { value: n };
}

/** A minute of skew between this browser's clock and the server's is not "ahead" (the Meds form's minute). */
const SKEW_MS = 60_000;

/** A completion's measurement time (D3): `{ recordedAt }` — a UTC instant, which carries a zone (the door
 *  refuses a stamp without one) — or `{ error }`: up to 24 h back, never ahead. `local` is the
 *  `datetime-local` value in the browser's zone; `now` the browser's clock in ms. */
export function checkTime(local, now) {
  const at = fromLocalInput(local);
  if (!Number.isFinite(at)) return { error: { key: "sofa.atInvalid" } };
  if (at > now + SKEW_MS) return { error: { key: "sofa.atFuture" } };
  if (at < now - BACKDATE_MS) return { error: { key: "sofa.atTooOld" } };
  return { recordedAt: new Date(at).toISOString() };
}

/** A correction's reason counted as the engine counts it (scoring/signing.py: the stripped text's `len`) —
 *  in characters, not UTF-16 units. */
export const reasonCount = (reason) => [...String(reason ?? "").trim()].length;

/** The corrections as the engine takes them, `[{code, value, reason}]` in the order they were made — ONE list
 *  for the preview and the signature, so what is signed is what was previewed (D6). */
export function overridesOf(corrections) {
  return Object.entries(corrections).map(([code, c]) => ({ code, value: c.value, reason: String(c.reason).trim() }));
}

/** A set of corrections as one string: a preview is the signature's only while this is unchanged (X12). */
export const correctionsKey = (corrections) => JSON.stringify(overridesOf(corrections));

/** Where a cell's value came from, in the reader's words: a clinician's charting (`clinician`, the door's
 *  provenance), a correction (`hekim`, the engine's mark on a re-scored cell), or the device's id as the
 *  engine wrote it. Nothing for an unmeasured cell. */
export function sourceText(t, source) {
  if (!source) return "";
  if (source === "clinician") return t("sofa.srcClinician");
  if (source === "hekim") return t("sofa.srcCorrection");
  return String(source);
}

/** An engine stamp as `dayStamp` writes it — the reader's clock time, with its day and month when it is not
 *  `nowMs`'s day: a signature from yesterday must not read as this morning's (X5) — or "" when it does not
 *  parse. */
export function stampOf(iso, nowMs) {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? dayStamp(ms, nowMs) : "";
}
```

- [ ] **Step 5: Run green**

Run: `npx vitest run src/live/screens/patient/sofa/sofaFields.test.js src/live/screens/patient/meds`

Expected: all passed (`sofaFields.test.js` 7).

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/live/screens/patient/sofa/sofa.testutil.js dashboard/src/live/screens/patient/sofa/sofaFields.js dashboard/src/live/screens/patient/sofa/sofaFields.test.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/sofa/sofa.testutil.js dashboard/src/live/screens/patient/sofa/sofaFields.js dashboard/src/live/screens/patient/sofa/sofaFields.test.js
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(dashboard): sofaFields — the organs in the source's order, the six inputs with the door's bounds, the time and reason rules (G2-A4, D2, D3, D5, D11)

The engine's rows reordered to the source table's; the six inputs the form completes with PLAUSIBLE's
bounds (mg/dL for creatinine and bilirubin), the cardiovascular row's MAP and pressors by their labels;
the value check shared by completing and correcting (X7); the Meds form's number and 24-hour rules
imported; a reason counted as the engine counts it; one list of corrections for preview and signature.
sofa.testutil.js holds the engine's answers, synthetic.

Red first: the test file failed to resolve ./sofaFields.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 7: The two editors — a measurement with its time, a correction with its reason (D3, D5, X8)

**Files:**
- Create: `dashboard/src/live/screens/patient/sofa/SofaEditors.jsx`
- Test: `dashboard/src/live/screens/patient/sofa/SofaEditors.test.jsx`

Read first: `meds/MedsChartForm.jsx` (the record-time rule, `flushSync` focus, the `Field`/`Input`/`Select` use) and `meds/MedsChartForm.test.jsx` (the fake-timer recipe).

- [ ] **Step 1: Write the failing tests** (Write, then the CRLF call) — `SofaEditors.test.jsx`:

```jsx
// SofaEditors.test.jsx — a completion's time is the clock's until she edits it and is read again at the press
// (the Meds form's rule, its final review I2); a correction's reason is counted live against the engine's
// length, trimmed, and a value outside the door's bounds is held with the focus on it (G2-A4, D3, D5, X7, X8).
// Synthetic values; the az texts.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { ChartEntry, CorrectionEntry } from "./SofaEditors.jsx";
import { toLocalInput } from "./sofaFields.js";
import { WHY } from "./sofa.testutil.js";

const MIN = 60_000;
// The fake-timer recipe of the earlier waves (meds/MedsChartForm.test.jsx): installed BEFORE the mount, `Date`
// faked with them, nothing advancing on its own; `settle` yields one turn of the REAL event loop.
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

describe("ChartEntry (D3)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open() {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(NOW);
    const onSave = vi.fn();
    await mount(<ChartEntry code="gcs" busy={false} onSave={onSave} onCancel={vi.fn()} />, { access: token(), me: profile() });
    return { onSave };
  }
  const entry = () => screen.getByRole("form", { name: "GCS (Qlazqo koma şkalası) — yeni ölçmə" });
  const time = () => within(entry()).getByLabelText("Ölçmə saatı");
  const value = (v) => fireEvent.change(within(entry()).getByLabelText(/GCS/), { target: { value: v } });
  const save = () => act(async () => { fireEvent.click(within(entry()).getByRole("button", { name: "Yadda saxla" })); await settle(); });

  it("untouched, the time is the moment of saving: opened at NOW and saved 90 min later, it charts the save time", async () => {
    const { onSave } = await open();
    value("11");
    act(() => { vi.setSystemTime(NOW + 90 * MIN); });          // the clock moved; no tick has run yet
    await save();
    expect(onSave).toHaveBeenCalledWith(11, new Date(NOW + 90 * MIN).toISOString());
  });

  it("untouched, the field shows the clock's minute as it moves; typed, it is hers and nothing moves it", async () => {
    const { onSave } = await open();
    expect(time()).toHaveValue(toLocalInput(NOW));
    act(() => { vi.advanceTimersByTime(MIN); });
    expect(time()).toHaveValue(toLocalInput(NOW + MIN));
    fireEvent.change(time(), { target: { value: toLocalInput(NOW - 120 * MIN) } });
    act(() => { vi.setSystemTime(NOW + 90 * MIN); vi.advanceTimersByTime(MIN); });
    expect(time()).toHaveValue(toLocalInput(NOW - 120 * MIN));
    value("11");
    await save();
    expect(onSave).toHaveBeenCalledWith(11, new Date(NOW - 120 * MIN).toISOString());
  });
});

describe("CorrectionEntry (D5)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open({ initial = null } = {}) {
    vi.setSystemTime(NOW);
    const onKeep = vi.fn();
    await mount(
      <CorrectionEntry code="platelets" recorded={45} minReason={20} initial={initial} onKeep={onKeep} onCancel={vi.fn()} />,
      { access: token(), me: profile() });
    return { onKeep };
  }
  const entry = () => screen.getByRole("form", { name: "Trombosit sayı — düzəliş" });
  const valueField = () => within(entry()).getByLabelText(/Düzgün dəyər/);
  const reasonField = () => within(entry()).getByLabelText("Əsaslandırma");
  const keep = () => act(async () => { fireEvent.click(within(entry()).getByRole("button", { name: "Düzəlişi saxlayın" })); await settle(); });

  it("says the recorded value, counts the trimmed reason against the engine's length, and keeps the trimmed reason", async () => {
    const { onKeep } = await open();
    expect(entry()).toHaveTextContent("Qeyddəki dəyər: 45 ×10³/mkl.");
    fireEvent.change(reasonField(), { target: { value: "   " } });
    expect(within(entry()).getByText("0 / 20 simvol")).toBeInTheDocument();
    expect(reasonField()).toHaveAccessibleDescription(/0 \/ 20 simvol/);
    fireEvent.change(valueField(), { target: { value: "38" } });
    fireEvent.change(reasonField(), { target: { value: "qısa" } });
    await keep();
    expect(onKeep).not.toHaveBeenCalled();
    expect(within(entry()).getByText("Əsaslandırma ən azı 20 simvol olmalıdır.")).toBeInTheDocument();
    expect(document.activeElement).toBe(reasonField());
    fireEvent.change(reasonField(), { target: { value: `  ${WHY}  ` } });
    expect(within(entry()).getByText(`${[...WHY].length} / 20 simvol`)).toBeInTheDocument();
    await keep();
    expect(onKeep).toHaveBeenCalledWith({ value: 38, reason: WHY });
  });

  it("holds a value outside the door's bounds, with the focus on it (X7)", async () => {
    const { onKeep } = await open();
    fireEvent.change(valueField(), { target: { value: "4500" } });
    fireEvent.change(reasonField(), { target: { value: WHY } });
    await keep();
    expect(onKeep).not.toHaveBeenCalled();
    expect(within(entry()).getByText("Gözlənilən aralıqdan (0–2000) kənardadır — vahid və ya onluq vergül səhvi ola bilər.")).toBeInTheDocument();
    expect(document.activeElement).toBe(valueField());
  });

  it("opens a correction already held with its value and its reason", async () => {
    await open({ initial: { value: 80, reason: WHY } });
    expect(valueField()).toHaveValue("80");
    expect(reasonField()).toHaveValue(WHY);
    expect(within(entry()).getByText(`${[...WHY].length} / 20 simvol`)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and see it red**

Run: `npx vitest run src/live/screens/patient/sofa/SofaEditors.test.jsx`

Expected: the file fails with `Failed to resolve import "./SofaEditors.jsx"`.

- [ ] **Step 3: Write `SofaEditors.jsx`** (Write, then the CRLF call):

```jsx
// src/live/screens/patient/sofa/SofaEditors.jsx — the SOFA form's two small editors, each opened under the row
// it belongs to (G2-A4). They hold a draft and say what is wrong with it, in the reader's words under the
// field, with the focus taken there; the WRITE is the form's (SofaFormModal.jsx), which owns the request, the
// toast and the read that follows.
//
// COMPLETING (D3) — `ChartEntry`, for a `clinical.chart` holder: one new measurement of an input the form
// takes, with its measurement time. It is a measurement, not a correction, so it asks for no reason; it goes
// through the door every charted value goes through (POST /clinical/{id}), and the engine scores it. The time
// is the Meds form's rule (meds/MedsChartForm.jsx, final review I2; X8): it is NOW until she edits it — the
// field follows the clock (`useNow`, once a minute) and the press reads the clock again — up to 24 h back,
// never ahead.
//
// CORRECTING (D5) — `CorrectionEntry`, for a `scores.sign` holder and a MEASURED input only: the value it
// should have been, and why. The reason is counted live against the engine's own `min_reason_chars`, so the
// bar is seen before it is reached; the count is read with the field, not announced on every key. Nothing is
// sent: the form holds the correction until «Önizle», where the engine re-scores the row. Points are never
// asked for — a clinician corrects the value, never the score.
//
// Both mirror the door's bounds only to hold a slipped digit back (sofaFields.js); anything they let through
// is the engine's to refuse, in its own words.
import React, { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Button, Field, Input, Select } from "../../../ui/index.js";
import { useNow } from "../../common/useNow.js";
import { BACKDATE_MS, checkTime, checkValue, isFlag, labelOf, reasonCount, toLocalInput } from "./sofaFields.js";

/** How often an untouched measurement time is moved on to the clock: the field shows minutes. */
const CLOCK_MS = 60_000;
const PANEL = "mt-2 rounded-ctl border border-line2 bg-card2 px-3 py-2.5";

/** A label with its unit in brackets (D11: the unit is in the label as well as beside the value). */
const withUnit = (label, unit) => (unit ? <>{label} <span className="font-normal">({unit})</span></> : label);

/** One new measurement of `code` (D3). `onSave(value, recordedAt)` is the form's write: the form closes this
 *  editor once the write is settled as a save and leaves it open — the draft kept — on a refusal. `busy` is
 *  the form's: a write is in flight, and the fields are held still. */
export function ChartEntry({ code, busy, onSave, onCancel }) {
  const { t } = useI18n();
  const { label, unit } = labelOf(t, code);
  const flag = isFlag(code);
  const [value, setValue] = useState("");
  const [at, setAt] = useState("");
  // False until she edits the time: until then the time is the clock's, not a value of the draft.
  const [atTouched, setAtTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const valueRef = useRef(null);
  const atRef = useRef(null);
  useNow(CLOCK_MS);                         // re-rendered on the clock, so an untouched time moves on
  const now = Date.now();
  const shownAt = atTouched ? at : toLocalInput(now);
  const say = (error) => (error ? t(error.key, error.params) : undefined);
  const valueError = tried ? say(checkValue(code, value).error) : undefined;
  const atError = tried ? say(checkTime(shownAt, now).error) : undefined;

  function save(event) {
    event.preventDefault();
    if (busy) return;
    // Checked again at the press: an untouched time is the moment of saving, not the last render's minute.
    const pressed = Date.now();
    const checked = checkValue(code, value);
    const timed = checkTime(atTouched ? at : toLocalInput(pressed), pressed);
    if (checked.error || timed.error) {
      // The error is in the DOM, tied to its field, when the focus arrives there.
      flushSync(() => setTried(true));
      (checked.error ? valueRef : atRef).current?.focus();
      return;
    }
    onSave(checked.value, timed.recordedAt);
  }

  return (
    <form noValidate onSubmit={save} aria-label={t("sofa.enterTitle", { input: label })} className={PANEL}>
      {flag ? (
        <Field label={label} hint={t("sofa.supportHint")} layout="col" error={valueError}>
          {/* A select cannot be read-only: it is disabled while the write is in flight, as the Meds form's is. */}
          <Select ref={valueRef} autoFocus value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}>
            <option value="">{t("sofa.supportNone")}</option>
            <option value="1">{t("sofa.supportYes")}</option>
            <option value="0">{t("sofa.supportNo")}</option>
          </Select>
        </Field>
      ) : (
        <Field label={withUnit(label, unit)} layout="col" error={valueError}>
          <Input ref={valueRef} autoFocus inputMode="decimal" autoComplete="off" value={value}
            onChange={(e) => setValue(e.target.value)} readOnly={busy} />
        </Field>
      )}
      <Field label={t("sofa.at")} hint={t("sofa.atHint")} layout="col" error={atError}>
        <Input
          ref={atRef} type="datetime-local" min={toLocalInput(now - BACKDATE_MS)} max={toLocalInput(now)}
          value={shownAt} onChange={(e) => { setAtTouched(true); setAt(e.target.value); }} readOnly={busy}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} busy={busy}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" size="sm" busy={busy}>{t("common.save")}</Button>
      </div>
    </form>
  );
}

/** A correction of a measured input (D5): the value the record should have held and why, kept by the form
 *  until the preview. `recorded` is what the record holds (sofaFields.js `recordedOf`); `minReason` the
 *  engine's `min_reason_chars`; `initial` a correction already held for this input, to change.
 *  `onKeep({ value, reason })` receives the trimmed reason. */
export function CorrectionEntry({ code, recorded, minReason, initial, onKeep, onCancel }) {
  const { t } = useI18n();
  const { label, unit } = labelOf(t, code);
  const [value, setValue] = useState(initial ? String(initial.value) : "");
  const [reason, setReason] = useState(initial ? initial.reason : "");
  const [tried, setTried] = useState(false);
  const valueRef = useRef(null);
  const reasonRef = useRef(null);
  const counterId = useId();
  const count = reasonCount(reason);
  const short = count < minReason;
  const checked = checkValue(code, value);
  const valueError = tried && checked.error ? t(checked.error.key, checked.error.params) : undefined;

  function keep(event) {
    event.preventDefault();
    // Checked again at the press, from the draft as it is now.
    const pressed = checkValue(code, value);
    if (pressed.error || reasonCount(reason) < minReason) {
      flushSync(() => setTried(true));
      (pressed.error ? valueRef : reasonRef).current?.focus();
      return;
    }
    onKeep({ value: pressed.value, reason: reason.trim() });
  }

  return (
    <form noValidate onSubmit={keep} aria-label={t("sofa.correctTitle", { input: label })} className={PANEL}>
      <p className="m-0 mb-2 text-12 text-mute">{t("sofa.correctIntro", { value: recorded ?? "—", unit })}</p>
      <Field label={withUnit(t("sofa.correctValue"), unit)} layout="col" error={valueError}>
        <Input ref={valueRef} autoFocus inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label={t("sofa.reason")} hint={t("sofa.reasonHint", { min: minReason })} layout="col"
        error={tried && short ? t("sofa.reasonShort", { min: minReason }) : undefined}>
        {/* The count is read with the field (aria-describedby), not announced on every key: a live region
            counting keystrokes would talk over the clinician typing her reason. */}
        <Input ref={reasonRef} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={counterId} />
      </Field>
      <p id={counterId} className={`m-0 -mt-1 mb-2.5 text-12 font-semibold ${short ? "text-att-ink" : "text-mute"}`}>
        {t("sofa.reasonCount", { count, min: minReason })}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" size="sm">{t("sofa.keep")}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run green**

Run: `npx vitest run src/live/screens/patient/sofa/`

Expected: all passed (`SofaEditors.test.jsx` 5, `sofaFields.test.js` 7).

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/live/screens/patient/sofa/SofaEditors.jsx dashboard/src/live/screens/patient/sofa/SofaEditors.test.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/sofa/SofaEditors.jsx dashboard/src/live/screens/patient/sofa/SofaEditors.test.jsx
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(dashboard): the SOFA form's two editors — a measurement with its time, a correction with its reason (G2-A4, D3, D5)

ChartEntry: one value (or yes/no for support) with a measurement time that follows the clock until
touched and is read again at the press (X8), up to 24 h back, never ahead. CorrectionEntry: the right
value and a reason counted live against the engine's min_reason_chars, read with the field; held, never
sent. Both hold a slip to the door's bounds with the focus on the field.

Red first: the test file failed to resolve ./SofaEditors.jsx.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 8: The dialog — the engine's rows, completing, correcting, preview then sign (D2, D3, D5, D6, D8, D9)

**Files:**
- Create: `dashboard/src/live/screens/patient/sofa/SofaFormModal.jsx`
- Test: `dashboard/src/live/screens/patient/sofa/SofaFormModal.test.jsx`

Read first: `meds/MedsChartForm.jsx` (the `Modal` footer, `mayHaveLanded`, the toast after the `try`), `admin/refusal.js`, `ui/Modal.jsx`'s header (focus, `busy`).

- [ ] **Step 1: Write the failing tests** (Write, then the CRLF call) — `SofaFormModal.test.jsx`:

```jsx
// SofaFormModal.test.jsx — the SOFA form prints the engine's form in the source's order and never a 0 for an
// organ it has no measurement for (D2); a clinical.chart holder completes a row through the door and the form is
// read again (D3); a scores.sign holder corrects a measured value with a reason counted against the engine's
// length (D5), previews and then signs exactly that (D6). Every control is absent without its right, and every
// refusal is said on the toast, named after the bed, and in the footer (X4). Synthetic values; the az texts.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { dayStamp } from "../../../i18n/dates.js";
import { SofaFormModal } from "./SofaFormModal.jsx";
import { toLocalInput } from "./sofaFields.js";
import { MEASURED_AT, WHY, cell, previewAnswer, signedAnswer, sofaForm } from "./sofa.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const BED = "REA-01 · 2";
const ALL = ["board.view", "alerts.ack", "clinical.chart", "scores.sign"];
const AT = () => dayStamp(Date.parse(MEASURED_AT), NOW);

async function open({ canChart = true, canSign = true, form = sofaForm(), api: over = {} } = {}) {
  vi.setSystemTime(NOW);
  const api = {
    read: vi.fn(() => Promise.resolve(form)),
    chart: vi.fn(() => Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [] })),
    preview: vi.fn(() => Promise.resolve(previewAnswer())),
    sign: vi.fn(() => Promise.resolve(signedAnswer())),
    ...over,
  };
  const onClose = vi.fn();
  await mount(
    <SofaFormModal bed={BED} nowMs={NOW} canChart={canChart} canSign={canSign} api={api} onClose={onClose} />,
    { access: token({ perms: ALL }), me: profile({ perms: ALL }) });
  await act(async () => { await settle(); });
  return { api, onClose };
}
const dialog = () => screen.getByRole("dialog", { name: `SOFA forması · ${BED}` });
const organ = (name) => within(dialog()).getByRole("heading", { level: 3, name }).closest("li");
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const button = (name) => within(dialog()).getByRole("button", { name });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const footer = () => dialog().querySelector("[data-sofa-footer]");

async function correctPlatelets(value = "80") {
  await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
  const entry = within(dialog()).getByRole("form", { name: "Trombosit sayı — düzəliş" });
  fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value } });
  fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: WHY } });
  await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
}

describe("the SOFA form (D2)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("lists the six organs in the source's order, not the engine's", async () => {
    await open();
    const names = within(dialog()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names.slice(0, 6)).toEqual(["Tənəffüs", "Laxtalanma", "Qaraciyər", "Ürək-damar", "Mərkəzi sinir sistemi", "Böyrək"]);
  });

  it("prints the engine's points, «ölçülməyib» — never a 0 — for an organ with no measurement, and the failure mark", async () => {
    await open();
    expect(organ("Laxtalanma")).toHaveTextContent("3 bal");
    expect(within(organ("Laxtalanma")).getByText("orqan çatışmazlığı")).toBeInTheDocument();
    expect(organ("Tənəffüs")).toHaveTextContent("2 bal");
    expect(within(organ("Tənəffüs")).queryByText("orqan çatışmazlığı")).toBeNull();
    for (const name of ["Qaraciyər", "Ürək-damar", "Mərkəzi sinir sistemi", "Böyrək"]) {
      expect(organ(name)).toHaveTextContent("ölçülməyib");
      expect(organ(name)).not.toHaveTextContent(/\b0 bal/);
    }
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();
  });

  it("gives each value its unit, its time and where it came from; one from before the window says so", async () => {
    const form = sofaForm();
    form.rows[2] = { ...form.rows[2], inputs: [cell("platelets", 45, { points: 3, outside_window: true, source: "nce" })] };
    await open({ form });
    expect(organ("Laxtalanma")).toHaveTextContent(`Trombosit sayı: 45 ×10³/mkl · ${AT()} · nce`);
    expect(organ("Laxtalanma")).toHaveTextContent("Pəncərədə ölçmə yoxdur: bu, pəncərədən əvvəlki ən yaxın ölçmədir.");
    expect(organ("Tənəffüs")).toHaveTextContent(`PaO₂/FiO₂ nisbəti: 250 mmHg · ${AT()} · klinisist qeydi`);
  });

  it("says the window and a stay shorter than it, and the renal, cardiovascular and respiratory notes (D8, D9)", async () => {
    await open();
    expect(within(dialog()).getByText(/^Pəncərə: son 24 saat · /)).toBeInTheDocument();
    expect(organ("Böyrək")).toHaveTextContent("Sidik ifrazı bu formada bala daxil edilmir.");
    expect(organ("Ürək-damar")).toHaveTextContent("MAP qeyddən gəlir, bu formadan daxil edilmir");
    expect(organ("Tənəffüs")).toHaveTextContent("yalnız tənəffüs dəstəyində keçərlidir");
    cleanup();
    await open({ form: sofaForm({ covers_full_window: false }) });
    expect(within(dialog()).getByText(/xəstə 24 saatdan az müddətdir buradadır/)).toBeInTheDocument();
  });

  it("a form that cannot be read says so, and is asked again", async () => {
    const read = vi.fn().mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor")).mockResolvedValueOnce(sofaForm());
    const { api } = await open({ api: { read } });
    expect(within(dialog()).getByText(/^SOFA forması oxuna bilmədi: /)).toBeInTheDocument();
    await press(button("Yenidən cəhd edin"));
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();
  });
});

describe("completing a row (clinical.chart, D3)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const entryFor = (input) => within(dialog()).getByRole("form", { name: `${input} — yeni ölçmə` });
  const save = (entry) => press(within(entry).getByRole("button", { name: "Yadda saxla" }));

  it("enters a bilirubin with its time, charts it through the door, and reads the form again", async () => {
    const { api } = await open();
    await press(within(organ("Qaraciyər")).getByRole("button", { name: "Ölçmə daxil edin: Bilirubin səviyyəsi" }));
    const entry = entryFor("Bilirubin səviyyəsi");
    fireEvent.change(within(entry).getByLabelText(/Bilirubin səviyyəsi/), { target: { value: "2,4" } });
    await save(entry);
    expect(api.chart).toHaveBeenCalledWith([{ code: "bilirubin", value: 2.4 }], new Date(NOW).toISOString());
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(toasted(`${BED}: Bilirubin səviyyəsi qeyd olundu; forma yenidən oxunur.`).length).toBeGreaterThan(0);
    expect(within(dialog()).queryByRole("form", { name: /yeni ölçmə$/ })).toBeNull();
  });

  it("charts respiratory support as 1 or 0, from under the respiration row", async () => {
    const { api } = await open();
    await press(within(organ("Tənəffüs")).getByRole("button", { name: "Dəstək vəziyyətini qeyd edin" }));
    const entry = entryFor("Tənəffüs dəstəyi");
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Bəli və ya xeyr seçin.")).toBeInTheDocument();
    fireEvent.change(within(entry).getByLabelText("Tənəffüs dəstəyi"), { target: { value: "1" } });
    await save(entry);
    expect(api.chart).toHaveBeenCalledWith([{ code: "on_resp_support", value: 1 }], new Date(NOW).toISOString());
  });

  it("holds a slipped digit or a time ahead before anything is sent, and takes the focus there", async () => {
    const { api } = await open();
    await press(within(organ("Böyrək")).getByRole("button", { name: "Ölçmə daxil edin: Kreatinin səviyyəsi" }));
    const entry = entryFor("Kreatinin səviyyəsi");
    const value = within(entry).getByLabelText(/Kreatinin səviyyəsi/);
    fireEvent.change(value, { target: { value: "150" } });                  // a µmol/L creatinine (D11)
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Gözlənilən aralıqdan (0–30) kənardadır — vahid və ya onluq vergül səhvi ola bilər.")).toBeInTheDocument();
    expect(document.activeElement).toBe(value);
    fireEvent.change(value, { target: { value: "1.4" } });
    const time = within(entry).getByLabelText("Ölçmə saatı");
    fireEvent.change(time, { target: { value: toLocalInput(NOW + 10 * 60_000) } });
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Ölçmə saatı gələcəkdə ola bilməz.")).toBeInTheDocument();
    expect(document.activeElement).toBe(time);
  });

  it("a refusal is said on the toast, named after the bed, and in the footer; the entry and its draft stay", async () => {
    const { api } = await open({ api: { chart: vi.fn(() => Promise.reject(refusal(400, "platelets: geçersiz sayı"))) } });
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Ölçmə daxil edin: Trombosit sayı" }));
    const entry = entryFor("Trombosit sayı");
    fireEvent.change(within(entry).getByLabelText(/Trombosit sayı/), { target: { value: "150" } });
    await save(entry);
    const said = `${BED} üçün ölçmə rədd edildi: platelets: geçersiz sayı`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(footer()).toHaveTextContent(said);
    expect(within(entryFor("Trombosit sayı")).getByLabelText(/Trombosit sayı/)).toHaveValue("150");
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it("a measurement with no answer may have landed: said so, and the form is read again", async () => {
    const { api } = await open({ api: { chart: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) } });
    await press(within(organ("Mərkəzi sinir sistemi")).getByRole("button", { name: "Ölçmə daxil edin: GCS (Qlazqo koma şkalası)" }));
    const entry = entryFor("GCS (Qlazqo koma şkalası)");
    fireEvent.change(within(entry).getByLabelText(/GCS/), { target: { value: "11" } });
    await save(entry);
    expect(toasted(`${BED} üçün ölçmə cavab almadı; yadda saxlanılmış ola bilər — forma yenidən oxunur.`).length).toBeGreaterThan(0);
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it("without clinical.chart there is no way to enter a measurement, and the form says why", async () => {
    await open({ canChart: false });
    expect(within(dialog()).queryAllByRole("button", { name: /^Ölçmə daxil edin/ })).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: "Dəstək vəziyyətini qeyd edin" })).toBeNull();
    expect(within(dialog()).getByText("Ölçmə daxil etmək clinical.chart səlahiyyəti tələb edir.")).toBeInTheDocument();
  });
});

describe("correcting a measured value (scores.sign, D5)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("is offered for a measured value only, counts the reason, and holds the correction without sending it", async () => {
    const { api } = await open();
    expect(within(organ("Qaraciyər")).queryByRole("button", { name: /^Düzəldin/ })).toBeNull();   // unmeasured: completed, not corrected
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
    const entry = within(dialog()).getByRole("form", { name: "Trombosit sayı — düzəliş" });
    expect(entry).toHaveTextContent("Qeyddəki dəyər: 45 ×10³/mkl.");
    fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value: "80" } });
    fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: "qısa" } });
    expect(within(entry).getByText("4 / 20 simvol")).toBeInTheDocument();
    fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: WHY } });
    await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
    expect(within(dialog()).queryByRole("form", { name: /düzəliş$/ })).toBeNull();
    expect(organ("Laxtalanma")).toHaveTextContent("Gözləyən düzəliş: 80 ×10³/mkl");
    expect(within(dialog()).getByText(`Trombosit sayı: 45 → 80 · əsaslandırma: «${WHY}»`)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəlişi dəyişin: Trombosit sayı" }));
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.sign).not.toHaveBeenCalled();
  });
});

describe("preview, then sign (D6)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("previews the held corrections, shows the engine's total and rows, and signs exactly the same list", async () => {
    const { api, onClose } = await open();
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();          // never before a preview
    expect(footer()).toHaveTextContent("İmzalamazdan əvvəl öncədən baxın");
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    const overrides = [{ code: "platelets", value: 80, reason: WHY }];
    expect(api.preview).toHaveBeenCalledWith(overrides);
    expect(within(dialog()).getByText("Öncədən baxış: cəmi 4 (qeyddən: 5) — hələ imzalanmayıb")).toBeInTheDocument();
    expect(organ("Laxtalanma")).toHaveTextContent("2 bal");
    expect(organ("Laxtalanma")).toHaveTextContent("Düzəldilib — qeyddəki dəyər: 45");
    await press(button("İmzalayın"));
    expect(api.sign).toHaveBeenCalledWith(overrides);
    expect(toasted(`${BED}: SOFA forması imzalandı · cəmi 4.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("a correction changed after the preview makes it stale: no «İmzalayın» until it is previewed again", async () => {
    await open();
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    expect(button("İmzalayın")).toBeInTheDocument();
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəlişi götürün: Trombosit sayı" }));
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(footer()).toHaveTextContent("Düzəlişlər öncədən baxışdan sonra dəyişib; imzalamazdan əvvəl yenidən baxın.");
  });

  it("says so when the signed total is not the previewed one: the record moved in between (X11)", async () => {
    await open({ api: { sign: vi.fn(() => Promise.resolve(signedAnswer({ total: 6 }))) } });
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    await press(button("İmzalayın"));
    expect(toasted(`${BED}: SOFA forması cəmi 6 ilə imzalandı — öncədən baxışda 4 idi; qeyd arada dəyişib.`).length).toBeGreaterThan(0);
  });

  it("a refused signature is said on the toast and in the footer, and the form stays open with its corrections", async () => {
    const reason = "platelets: düzeltme gerekçesi en az 20 karakter olmalı — bu sayı hastane raporlamasına giriyor ve neden değiştirildiği kayda geçmeli";
    const { onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(400, reason))) } });
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    await press(button("İmzalayın"));
    const said = `${BED} üçün imza rədd edildi: ${reason}`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(footer()).toHaveTextContent(said);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(`Trombosit sayı: 45 → 80 · əsaslandırma: «${WHY}»`)).toBeInTheDocument();
  });

  it("a right taken away (403) closes the form; a signature with no answer may have gone through, and closes it too", async () => {
    let { onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(403, "permission required: scores.sign"))) } });
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    await press(button("İmzalayın"));
    expect(toasted(`${BED} üçün imza rədd edildi: Bu hesabın imza səlahiyyəti yoxdur.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(false);
    cleanup();
    ({ onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) } }));
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    await press(button("İmzalayın"));
    expect(toasted(`${BED} üçün imza cavab almadı; atılmış ola bilər — SOFA qutusundakı son imza sətrinə baxın.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("without scores.sign — or against an engine that cannot preview — no correction, no preview, no signature, and the footer says why", async () => {
    await open({ canSign: false });
    expect(within(dialog()).queryAllByRole("button", { name: /^Düzəldin/ })).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(footer()).toHaveTextContent("Düzəltmək və imzalamaq scores.sign səlahiyyəti tələb edir.");
    cleanup();
    const { min_reason_chars: _min, ...older } = sofaForm();      // an engine older than G2-A4 (X13)
    await open({ form: older });
    expect(within(dialog()).queryAllByRole("button", { name: /^Düzəldin/ })).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(footer()).toHaveTextContent("Mühərrikin bu versiyası öncədən baxışı bilmir: düzəliş və imza bu ekrandan bağlıdır.");
  });
});
```

- [ ] **Step 2: Run it and see it red**

Run: `npx vitest run src/live/screens/patient/sofa/SofaFormModal.test.jsx`

Expected: the file fails with `Failed to resolve import "./SofaFormModal.jsx"`.

- [ ] **Step 3: Write `SofaFormModal.jsx`** (Write, then the CRLF call):

```jsx
// src/live/screens/patient/sofa/SofaFormModal.jsx — the SOFA severity form, read from the engine, completed,
// corrected, previewed and signed (G2-A4, D2, D3, D5, D6).
//
// WHAT IT SHOWS (D2) is the engine's form, word for word: six organ rows in the source table's order, each with
// the worst value of the window, its unit, when it was measured (the reader's clock, with its day when it is not
// today's, X5), where it came from and its points; «ölçülmedi» for an organ with no measurement — never a 0,
// although the score counts it as one; the organ-failure mark where the engine says `failure`; the window, and,
// when the patient has been here for less than it (`covers_full_window` false), that the form rests on the
// shorter stay. Under the renal row: urine output is not scored here (D8). Under the cardiovascular row: MAP
// comes from the record and is not entered here, the pressors come from the Meds box (D9). Under the
// respiration row: what charted support changes. The browser scores nothing (Decision 1): every point, total
// and failure mark is the engine's.
//
// WHAT IT WRITES. A `clinical.chart` holder completes a row (D3, SofaEditors.jsx `ChartEntry`): one measurement
// through POST /clinical/{id}, and the form is read again — the engine re-scores, never this screen. A
// `scores.sign` holder corrects a measured value (D5, `CorrectionEntry`); the corrections are held here, unsent,
// until «Önizle» asks the engine what a signature would seal (D6, `preview: true`, no audit row). «İmzala» is
// offered only on a preview of exactly the corrections held now — change one and the preview is stale until it
// is asked again (X12) — and sends the same list. If the record moved between the two, the signed total is the
// engine's and the screen says it differed from the preview (X11). Against an engine that sends no
// `min_reason_chars` — one older than G2-A4, which ignores `preview` and would SIGN — nothing is corrected,
// previewed or signed (X13). Each control is ABSENT without its right, never disabled, and a sentence says why.
//
// THE REFUSALS are the house's (admin/refusal.js, meds/MedsChartForm.jsx): on the toast, named after the bed —
// and, D10, the same sentence in the footer as plain text, which is no live region, so the refusal is announced
// once (X4). A write with no answer may have landed (`mayHaveLanded`): a measurement reads the form again, a
// signature closes the form and the box reads its last signature again. A preview writes nothing, so its failure
// is a read's (`readErrorText`). Nothing here alerts, rings or notifies (D10).
//
// THE PATIENT IS FIXED AT OPENING: `api` is bound to it by the box (SofaBox.jsx), so a write in flight stays with
// its patient when the screen moves on; the box closes this dialog for another patient.
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { apiErrorText, readErrorText } from "../../../apiErrors.js";
import { Announce, Button, Modal, Note, StatusPill, useToast } from "../../../ui/index.js";
import { mayHaveLanded } from "../../admin/refusal.js";
import { ChartEntry, CorrectionEntry } from "./SofaEditors.jsx";
import {
  correctionsKey, isEnterable, labelOf, overridesOf, recordedOf, rowsInOrder, sourceText, stampOf,
} from "./sofaFields.js";

/** The window line (D2): the engine's hours and bounds — or, when the patient has been here for less than the
 *  window (`covers_full_window` false), that the form rests on the shorter stay. */
function windowLine(t, form, nowMs) {
  const stamp = (iso) => stampOf(iso, nowMs) || "—";
  return form.covers_full_window === false
    ? t("sofa.windowShort", { hours: form.window_hours, to: stamp(form.window_to) })
    : t("sofa.windowFull", { hours: form.window_hours, from: stamp(form.window_from), to: stamp(form.window_to) });
}

/** One input as the engine sent it: the value or «ölçülmedi», the unit, the time and the source, and what is
 *  unusual about it — a value from before the window, a value corrected in a preview, a correction held here.
 *  `children` are the controls her rights give her. */
function Cell({ cell, nowMs, held, children }) {
  const { t } = useI18n();
  const { label, unit } = labelOf(t, cell.code);
  const meta = [cell.measured ? stampOf(cell.at, nowMs) : "", sourceText(t, cell.source)].filter(Boolean).join(" · ");
  return (
    <div data-sofa-cell={cell.code} className="mt-1.5">
      <p className="m-0 text-13">
        <span className="font-semibold">{label}</span>{": "}
        {cell.measured ? (
          <><b className="font-data">{String(cell.value)}</b>{unit ? ` ${unit}` : ""}</>
        ) : (
          <span className="italic text-mute">{t("sofa.unmeasured")}</span>
        )}
        {meta ? <span className="text-11.5 text-mute">{` · ${meta}`}</span> : null}
      </p>
      {cell.outside_window ? <p className="m-0 text-11.5 font-semibold text-att-ink">{t("sofa.outsideWindow")}</p> : null}
      {cell.overridden ? <p className="m-0 text-11.5 font-semibold text-att-ink">{t("sofa.corrected", { original: cell.original ?? "—" })}</p> : null}
      {held ? <p className="m-0 text-11.5 font-semibold text-att-ink">{t("sofa.heldLine", { value: held.value, unit })}</p> : null}
      {children}
    </div>
  );
}

/** One organ: its name as a heading, the engine's points or «ölçülmedi», and the failure mark where the engine
 *  set it (D2) — never computed here from the points. */
function OrganRow({ entry, children }) {
  const { t } = useI18n();
  const { row } = entry;
  return (
    <li data-sofa-organ={entry.organ} className="rounded-box border border-line bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-text text-13.5 font-bold">{t(entry.labelKey)}</h3>
        <span className="font-data text-13 font-bold">{row.measured ? t("sofa.points", { points: row.points }) : t("sofa.unmeasured")}</span>
        {row.failure ? <StatusPill tone="crit" icon="alert">{t("sofa.failure")}</StatusPill> : null}
      </div>
      {children}
    </li>
  );
}

/** `bed` names the patient in the title and on every toast; `api` is `{ read, chart, preview, sign }`, bound to
 *  the patient by the box; `canChart` / `canSign` are her rights; `nowMs` the screen's clock (the reader's
 *  "today"). `onClose(changed)` — `changed` says that something was written, so the box reads its form again. */
export function SofaFormModal({ bed, nowMs = Date.now(), canChart, canSign, api, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState(null);              // the engine's form as last read
  const [readError, setReadError] = useState(null);
  const [reading, setReading] = useState(true);
  const [corrections, setCorrections] = useState({});  // code -> { value, reason }: held until the preview (D5)
  const [preview, setPreview] = useState(null);        // { key, answer }: the engine's answer to `preview: true`
  const [editing, setEditing] = useState(null);        // { kind: "chart" | "correct", code }: one editor at a time
  const [busy, setBusy] = useState(null);              // "chart" | "preview" | "sign": the request in flight
  const [said, setSaid] = useState(null);              // { text, warn }: the footer's sentence for the last outcome
  const footerId = useId();
  const changed = useRef(false);                       // something was written: the box reads its form again
  const sending = useRef(false);                       // a second press that beats the re-render is ignored
  const reads = useRef(0);                             // only the newest read lands
  const buttons = useRef({});                          // `${kind}:${code}` -> the button an editor gives focus back to
  const mounted = useRef(false);
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function read() {
    const mine = ++reads.current;
    setReading(true);
    try {
      const answer = await api.read();
      if (!mounted.current || mine !== reads.current) return;
      setForm(answer ?? null);
      setReadError(null);
    } catch (err) {
      if (err?.superseded || !mounted.current || mine !== reads.current) return;
      setReadError(err);
    } finally {
      if (mounted.current && mine === reads.current) setReading(false);
    }
  }
  // Read once per opening (X9): the box keys this dialog by its opening, so a new opening is a new read.
  useEffect(() => { read(); }, []);

  const key = correctionsKey(corrections);
  const fresh = preview !== null && preview.key === key;
  const shown = fresh ? preview.answer.form : form;
  // The engine's reason length. An engine older than G2-A4 sends none — and it ignores `preview`, so a
  // «preview» sent to it would SIGN: no correction, preview or signature is offered against it (X13).
  const minReason = Number.isInteger(form?.min_reason_chars) ? form.min_reason_chars : null;
  const signable = canSign && minReason !== null;
  const label = (code) => labelOf(t, code).label;
  const heldOf = (code) => (Object.prototype.hasOwnProperty.call(corrections, code) ? corrections[code] : null);
  const close = () => onClose(changed.current);
  const keepButton = (kind, code) => (el) => { buttons.current[`${kind}:${code}`] = el; };

  function openEditor(next) {
    setSaid(null);
    setEditing(next);
  }
  /** Close the editor and give the focus back to the button that opened it, which stays on the row. */
  function closeEditor(kind, code) {
    setEditing(null);
    buttons.current[`${kind}:${code}`]?.focus();
  }

  /** Complete a row (D3): one measurement through the door, then the form again — the engine re-scores it. A
   *  preview of the old record is let go: it is no longer what a signature would seal. */
  async function chartOne(code, value, recordedAt) {
    if (sending.current) return;
    sending.current = true;
    setBusy("chart");
    let done;
    try {
      const answer = await api.chart([{ code, value }], recordedAt);
      changed.current = true;
      done = answer?.dropped
        ? { text: t("sofa.chartDropped", { subject: bed }), tone: "warn", close: true, reread: false }
        : { text: t("sofa.chartSaved", { subject: bed, input: label(code) }), tone: "ok", close: true, reread: true };
    } catch (err) {
      // A superseded session is gone: nothing is said about it into the one that replaced it.
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        changed.current = true;
        done = { text: t("sofa.chartMayHaveLanded", { subject: bed }), tone: "warn", close: true, reread: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("sofa.chartNoRight") : apiErrorText(t, err);
        done = { text: t("sofa.chartRefused", { subject: bed, reason }), tone: "error", close: forbidden, reread: false };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    // Out of the `try`: the toast outlives this dialog, and is said whatever the screen does next.
    toast(done.text, done.tone);
    if (!mounted.current) return;
    setSaid({ text: done.text, warn: done.tone !== "ok" });
    if (done.close) closeEditor("chart", code);
    if (done.reread) {
      setPreview(null);
      await read();
    }
  }

  /** Hold a correction (D5). Nothing is sent; the preview scores it. */
  function keep(code, correction) {
    setCorrections((current) => ({ ...current, [code]: correction }));
    closeEditor("correct", code);
    setSaid({ text: t("sofa.held", { input: label(code) }), warn: false });
  }
  /** Let a held correction go. The button that removed it goes with it: the focus goes to «Düzelt» on the
   *  same input. */
  function drop(code) {
    setCorrections((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
    setEditing((current) => (current?.code === code ? null : current));
    setSaid(null);
    buttons.current[`correct:${code}`]?.focus();
  }

  /** «Önizle» (D6): the engine's answer to the corrections held now, signed by nobody and written nowhere. A
   *  failure is a read's: nothing was written, so nothing "may have landed". */
  async function previewIt() {
    if (sending.current) return;
    sending.current = true;
    setBusy("preview");
    const asked = corrections;
    try {
      const answer = await api.preview(overridesOf(asked));
      if (!mounted.current || !answer) return;
      setPreview({ key: correctionsKey(asked), answer });
      setSaid({ text: t("sofa.previewed", { total: answer.total }), warn: false });
    } catch (err) {
      if (err?.superseded) return;
      const reason = err?.status === 403 ? t("sofa.signNoRight") : readErrorText(t, err);
      const text = t("sofa.previewRefused", { subject: bed, reason });
      toast(text, "error");
      if (mounted.current) setSaid({ text, warn: true });
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  /** «İmzala» (D6): the same corrections the fresh preview was asked with. The total the engine signs is the
   *  engine's: if the record moved since the preview (another desk charted), it is said, not hidden (X11). */
  async function signIt() {
    if (sending.current || !fresh) return;
    sending.current = true;
    setBusy("sign");
    const previewed = preview.answer.total;
    let done;
    try {
      const answer = await api.sign(overridesOf(corrections));
      changed.current = true;
      const total = answer?.total ?? previewed;
      done = total === previewed
        ? { text: t("sofa.signedToast", { subject: bed, total }), tone: "ok", close: true }
        : { text: t("sofa.signedDiffers", { subject: bed, total, previewed }), tone: "warn", close: true };
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        changed.current = true;
        done = { text: t("sofa.signMayHaveLanded", { subject: bed }), tone: "warn", close: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("sofa.signNoRight") : apiErrorText(t, err);
        done = { text: t("sofa.signRefused", { subject: bed, reason }), tone: "error", close: forbidden };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    toast(done.text, done.tone);
    if (done.close) onClose(changed.current);
    else if (mounted.current) setSaid({ text: done.text, warn: true });
  }

  /** The controls her rights give her on one cell: «Ölçüm gir» for the six inputs the form takes (D3; MAP and
   *  the pressors are not entered here, D9), «Düzelt» for a measured value (D5), and «Düzeltmeyi kaldır» for a
   *  correction held. They stay on the row while an editor is open under it, so the focus can come back. */
  function actionsFor(cell) {
    const { code } = cell;
    const kind = editing?.code === code ? editing.kind : null;
    const held = heldOf(code);
    const enterable = canChart && isEnterable(code);
    const correctable = signable && cell.measured === true;
    const name = label(code);
    return (
      <>
        {enterable || correctable ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {enterable ? (
              <Button ref={keepButton("chart", code)} size="sm" icon="plus" aria-expanded={kind === "chart"}
                aria-label={t("sofa.enterFor", { input: name })} onClick={() => openEditor({ kind: "chart", code })}>
                {t("sofa.enter")}
              </Button>
            ) : null}
            {correctable ? (
              <Button ref={keepButton("correct", code)} size="sm" icon="edit" aria-expanded={kind === "correct"}
                aria-label={t(held ? "sofa.correctEditFor" : "sofa.correctFor", { input: name })}
                onClick={() => openEditor({ kind: "correct", code })}>
                {t(held ? "sofa.correctEdit" : "sofa.correct")}
              </Button>
            ) : null}
            {held ? (
              <Button size="sm" variant="ghost" icon="x" aria-label={t("sofa.dropFor", { input: name })} onClick={() => drop(code)}>
                {t("sofa.drop")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {kind === "chart" ? (
          <ChartEntry code={code} busy={busy === "chart"} onCancel={() => closeEditor("chart", code)}
            onSave={(value, recordedAt) => chartOne(code, value, recordedAt)} />
        ) : null}
        {kind === "correct" ? (
          <CorrectionEntry code={code} recorded={recordedOf(form, code)} minReason={minReason} initial={held}
            onCancel={() => closeEditor("correct", code)} onKeep={(correction) => keep(code, correction)} />
        ) : null}
      </>
    );
  }

  // Respiratory support (D4) is no cell of the form — it decides which PaO₂/FiO₂ bands apply — so it is charted
  // from under the respiration row, by a `clinical.chart` holder only.
  const supportOpen = editing?.code === "on_resp_support";
  const support = canChart ? (
    <div data-sofa-cell="on_resp_support" className="mt-1.5">
      <p className="m-0 text-13 font-semibold">{label("on_resp_support")}</p>
      <Button ref={keepButton("chart", "on_resp_support")} size="sm" icon="plus" className="mt-1" aria-expanded={supportOpen}
        onClick={() => openEditor({ kind: "chart", code: "on_resp_support" })}>
        {t("sofa.supportChart")}
      </Button>
      {supportOpen ? (
        <ChartEntry code="on_resp_support" busy={busy === "chart"} onCancel={() => closeEditor("chart", "on_resp_support")}
          onSave={(value, recordedAt) => chartOne("on_resp_support", value, recordedAt)} />
      ) : null}
    </div>
  ) : null;

  const heldCodes = Object.keys(corrections);
  let body;
  if (shown) {
    body = (
      <>
        <Note tone="info" icon="clip">{t("sofa.intro")}</Note>
        {readError ? <Note tone="warn" icon="alert" className="mt-2">{t("sofa.rereadFailed", { reason: readErrorText(t, readError) })}</Note> : null}
        <p className="m-0 mt-2 text-12.5 text-mute">{windowLine(t, shown, nowMs)}</p>
        <p className="m-0 mt-1 font-display text-17 font-bold">
          {fresh
            ? t("sofa.totalPreview", { total: preview.answer.total, auto: preview.answer.auto_total })
            : t("sofa.total", { total: shown.total })}
        </p>
        {!canChart ? <p className="m-0 mt-1 text-12 text-mute">{t("sofa.chartNoRightNote")}</p> : null}
        {/* role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver. */}
        <ol role="list" className="m-0 mt-2.5 grid list-none gap-2 p-0">
          {rowsInOrder(shown).map((entry) => (
            <OrganRow key={entry.organ} entry={entry}>
              {(Array.isArray(entry.row.inputs) ? entry.row.inputs : []).map((cell) => (
                <Cell key={cell.code} cell={cell} nowMs={nowMs} held={heldOf(cell.code)}>{actionsFor(cell)}</Cell>
              ))}
              {entry.organ === "respiration" ? support : null}
              {entry.noteKey ? <p className="m-0 mt-1.5 text-11.5 text-mute">{t(entry.noteKey)}</p> : null}
            </OrganRow>
          ))}
        </ol>
        {heldCodes.length > 0 ? (
          <section className="mt-3">
            <h3 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("sofa.heldTitle")}</h3>
            <ul role="list" className="m-0 mt-1 list-none p-0 text-12.5">
              {heldCodes.map((code) => (
                <li key={code}>
                  {t("sofa.heldItem", { input: label(code), original: recordedOf(form, code) ?? "—", value: corrections[code].value, reason: corrections[code].reason })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    );
  } else if (reading) {
    body = <p className="m-0 text-13 text-mute">{t("sofa.reading")}</p>;
  } else {
    body = (
      <div>
        <p className="m-0 text-13 font-semibold text-att-ink">
          {readError ? t("sofa.unreadable", { reason: readErrorText(t, readError) }) : t("sofa.noForm")}
        </p>
        <Button size="sm" className="mt-2" onClick={read}>{t("sofa.retry")}</Button>
      </div>
    );
  }

  // The footer's sentence: the last outcome when there is one; else why she cannot sign, or what signing needs
  // first. Plain text, not a live region (X4): the toast is what announces.
  let footer = said;
  if (!footer && shown) {
    if (!canSign) footer = { text: t("sofa.signNoRightNote"), warn: false };
    else if (minReason === null) footer = { text: t("sofa.signOldEngine"), warn: true };
    else if (preview !== null && !fresh) footer = { text: t("sofa.previewStale"), warn: true };
    else if (!fresh) footer = { text: t("sofa.previewFirst"), warn: false };
  }

  return (
    <Modal
      open title={`${t("sofa.title")} · ${bed}`} onClose={close} busy={busy !== null}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {footer ? (
            <p id={footerId} data-sofa-footer=""
              className={`m-0 mr-auto min-w-0 flex-[1_1_14rem] text-12 font-semibold ${footer.warn ? "text-att-ink" : "text-mute"}`}>
              {footer.text}
            </p>
          ) : null}
          {/* The buttons are one flex item: on a phone they wrap as a group, under the sentence. */}
          <div className="ml-auto flex shrink-0 flex-wrap gap-2">
            <Button variant="ghost" onClick={close} busy={busy !== null}>{t("common.close")}</Button>
            {signable && shown ? (
              <Button icon="eye" onClick={previewIt} busy={busy === "preview"} aria-describedby={footer ? footerId : undefined}>
                {t("sofa.preview")}
              </Button>
            ) : null}
            {signable && fresh ? (
              <Button variant="primary" icon="ok" onClick={signIt} busy={busy === "sign"} aria-describedby={footer ? footerId : undefined}>
                {t("sofa.sign")}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    >
      {body}
      {/* A busy Button reads only "unavailable" to a screen reader; what is happening is said once, here. */}
      <Announce text={busy === "chart" ? t("sofa.saving") : busy === "preview" ? t("sofa.previewing") : busy === "sign" ? t("sofa.signing") : ""} />
    </Modal>
  );
}
```

- [ ] **Step 4: Run green**

Run: `npx vitest run src/live/screens/patient/sofa/`

Expected: all passed (`SofaFormModal.test.jsx` 18, `SofaEditors.test.jsx` 5, `sofaFields.test.js` 7).

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/live/screens/patient/sofa/SofaFormModal.jsx dashboard/src/live/screens/patient/sofa/SofaFormModal.test.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/sofa/SofaFormModal.jsx dashboard/src/live/screens/patient/sofa/SofaFormModal.test.jsx
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(dashboard): the SOFA form — the engine's rows, completing, correcting, preview then sign (G2-A4, D2, D3, D5, D6, D8, D9)

A dialog over the engine's form: six rows in the source's order with value, unit, time, source and
points, «ölçülmedi» never 0, the failure mark, the window, the renal (D8), cardiovascular (D9) and
support notes. clinical.chart completes a row through the door and re-reads; scores.sign corrects a
measured value (held, unsent) and signs only on a fresh preview of exactly those corrections (X12),
saying when the signed total differs (X11); nothing is signed against an engine without
min_reason_chars (X13). Refusals on the toast and in the footer as plain text (X4).

Red first: the test file failed to resolve ./SofaFormModal.jsx.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 9: The box — total, organs with no measurement, last signature, «Formu aç» (D1, D7)

**Files:**
- Create: `dashboard/src/live/screens/patient/sofa/SofaBox.jsx`
- Test: `dashboard/src/live/screens/patient/sofa/SofaBox.test.jsx`

Read first: `meds/MedsBox.jsx` (the `editing {id, opening}` rule).

- [ ] **Step 1: Write the failing tests** (Write, then the CRLF call) — `SofaBox.test.jsx`:

```jsx
// SofaBox.test.jsx — the patient screen's SOFA box (G2-A4, D1, D7): the form's total, the organs it has no
// measurement for and the last signature, read through the board store for the patient shown; «Formanı açın»
// opens the form for THIS patient, and a signature is followed by a read that shows it. Synthetic values; the
// az texts.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { dayStamp } from "../../../i18n/dates.js";
import { SofaBox } from "./SofaBox.jsx";
import { LAST_SIGNED, WHY, previewAnswer, signedAnswer, sofaForm } from "./sofa.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ALL = ["board.view", "alerts.ack", "clinical.chart", "scores.sign"];
const SIGNED_AT = () => dayStamp(Date.parse(LAST_SIGNED.at), NOW);

async function open({ perms = ALL, setup, ui } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(ui ?? <SofaBox patientId="S-001" bed="REA-01 · 2" nowMs={NOW} />,
    { access: token({ perms }), me: profile({ perms }), setup });
  await act(async () => { await settle(); });
  return mounted;
}
const box = () => screen.getByRole("heading", { level: 2, name: "SOFA forması" }).closest(".rounded-box");
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });

describe("the SOFA box (D1)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows the form's total, the organs with no measurement and «İmzalanmayıb», and says it is not the Sepsis-3 SOFA", async () => {
    const { api } = await open({ setup: (a) => a.severityForm.mockResolvedValue(sofaForm()) });
    expect(api.severityForm).toHaveBeenCalledWith("S-001");
    expect(box()).toHaveTextContent("Forma cəmi 5 · 4 / 6 orqanda ölçmə yoxdur");
    expect(box()).toHaveTextContent("İmzalanmayıb.");
    expect(box()).toHaveTextContent("Sepsis-3 qutusundakı SOFA son dəyərlərlə hesablanır");
    expect(box()).toHaveTextContent(`${dayStamp(Date.parse("2026-10-08T10:00:00+00:00"), NOW)} oxunuşu.`);
  });

  it("names the last signature: who, when, the total, and how many corrections (D7)", async () => {
    await open({ setup: (a) => a.severityForm.mockResolvedValue(sofaForm({ last_signed: LAST_SIGNED })) });
    expect(box()).toHaveTextContent(`İmzalanıb · dr.elif · ${SIGNED_AT()} · cəmi 4 · 1 düzəlişlə`);
    cleanup();
    await open({ setup: (a) => a.severityForm.mockResolvedValue(sofaForm({ last_signed: { ...LAST_SIGNED, corrections: 0 } })) });
    expect(box()).toHaveTextContent(`İmzalanıb · dr.elif · ${SIGNED_AT()} · cəmi 4`);
    expect(box()).not.toHaveTextContent("düzəlişlə");
    cleanup();
    const { last_signed: _signed, ...older } = sofaForm();            // an engine older than G2-A4 (X15)
    await open({ setup: (a) => a.severityForm.mockResolvedValue(older) });
    expect(box()).not.toHaveTextContent("İmzalanmayıb");
    expect(box()).not.toHaveTextContent("İmzalanıb");
  });

  it("says when the engine sent no form and when it could not be read, and reads again on «Yenidən cəhd edin»", async () => {
    await open();                                                     // severityForm set up by nobody: it answers nothing
    expect(box()).toHaveTextContent("Mühərrik bu xəstə üçün SOFA forması göndərmədi.");
    cleanup();
    const { api } = await open({ setup: (a) => a.severityForm.mockRejectedValueOnce(refusal(500, "boom")).mockResolvedValueOnce(sofaForm()) });
    expect(box()).toHaveTextContent(/SOFA forması oxuna bilmədi: /);
    await press(within(box()).getByRole("button", { name: "Yenidən cəhd edin" }));
    expect(api.severityForm).toHaveBeenCalledTimes(2);
    expect(box()).toHaveTextContent("Forma cəmi 5");
  });

  it("opens the form for this patient, titled with the bed — for a board.view holder too, read-only (X10)", async () => {
    const { api } = await open({ perms: ["board.view", "alerts.ack"], setup: (a) => a.severityForm.mockResolvedValue(sofaForm()) });
    await press(within(box()).getByRole("button", { name: "Formanı açın" }));
    const dialog = screen.getByRole("dialog", { name: "SOFA forması · REA-01 · 2" });
    expect(api.severityForm).toHaveBeenCalledTimes(2);               // the box's read and the form's own (X9)
    expect(within(dialog).queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(within(dialog).queryAllByRole("button", { name: /^Ölçmə daxil edin/ })).toHaveLength(0);
  });

  it("after a signature the box reads its form again and shows the new line", async () => {
    const { api } = await open({
      setup: (a) => {
        a.severityForm.mockResolvedValueOnce(sofaForm()).mockResolvedValueOnce(sofaForm())
          .mockResolvedValue(sofaForm({ last_signed: LAST_SIGNED }));
        a.signSeverityForm.mockImplementation((_id, { preview }) => Promise.resolve(preview ? previewAnswer() : signedAnswer()));
      },
    });
    await press(within(box()).getByRole("button", { name: "Formanı açın" }));
    const dialog = screen.getByRole("dialog", { name: "SOFA forması · REA-01 · 2" });
    await press(within(dialog).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
    const entry = within(dialog).getByRole("form", { name: "Trombosit sayı — düzəliş" });
    fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value: "80" } });
    fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: WHY } });
    await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
    await press(within(dialog).getByRole("button", { name: "Öncədən baxın" }));
    await press(within(dialog).getByRole("button", { name: "İmzalayın" }));
    expect(api.signSeverityForm).toHaveBeenLastCalledWith("S-001", { overrides: [{ code: "platelets", value: 80, reason: WHY }] });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.severityForm).toHaveBeenCalledTimes(3);
    expect(box()).toHaveTextContent(`İmzalanıb · dr.elif · ${SIGNED_AT()} · cəmi 4`);
  });

  it("follows the patient shown: a form open on one is gone on the next, and a late read never lands on it", async () => {
    let go;
    function Harness() {
      const [id, setId] = React.useState("S-001");
      go = setId;
      return <SofaBox patientId={id} bed={id === "S-001" ? "REA-01 · 2" : "REA-01 · 3"} nowMs={NOW} />;
    }
    const late = [];
    await open({
      ui: <Harness />,
      setup: (a) => a.severityForm.mockImplementation((id) => (id === "S-001"
        ? new Promise((resolve) => { late.push(() => resolve(sofaForm({ total: 9 }))); })
        : Promise.resolve(sofaForm({ patient_id: "S-002", total: 2 })))),
    });
    await press(within(box()).getByRole("button", { name: "Formanı açın" }));
    expect(screen.getByRole("dialog", { name: "SOFA forması · REA-01 · 2" })).toBeInTheDocument();
    await act(async () => { go("S-002"); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box()).toHaveTextContent("Forma cəmi 2");
    await act(async () => { late.forEach((release) => release()); await settle(); });
    expect(box()).toHaveTextContent("Forma cəmi 2");
    expect(box()).not.toHaveTextContent("Forma cəmi 9");
  });
});
```

- [ ] **Step 2: Run it and see it red**

Run: `npx vitest run src/live/screens/patient/sofa/SofaBox.test.jsx`

Expected: the file fails with `Failed to resolve import "./SofaBox.jsx"`.

- [ ] **Step 3: Write `SofaBox.jsx`** (Write, then the CRLF call):

```jsx
// src/live/screens/patient/sofa/SofaBox.jsx — the patient screen's SOFA box (G2-A4, D1), where the "forms come
// later" note stood: the severity form's total, how many organs it has no measurement for, and its last
// signature — «İmzalandı · {who} · {time} · toplam {n}», with the corrections' count when there were any — or
// «İmzalanmadı»; and «Formu aç».
//
// IT IS NOT THE SOFA OF THE SEPSIS-3 BOX BESIDE IT, and says so: that one is the alerting SOFA, read from the
// latest values; this one is the form's, read from the WORST values of the last 24 hours. Both are the
// engine's and correct, and they are not the same number. The box prints the engine's total and counts; it
// computes nothing (Decision 1).
//
// IT READS ONCE (spec O4: every read is a `score` row in the audit): when the patient is shown, after the form
// closes on a write, and when asked again after a failed read — not on a timer and not on every board frame
// (O9). The read's time is printed (X12), so an old total is never taken for a fresh one. The signature comes
// with the form (`last_signed`, D7), under the form's own permission: no audit right is needed to see it. An
// engine older than G2-A4 sends no `last_signed`; then no signature line is printed at all (X15).
//
// THE FORM IS A DIALOG (D1, A3's pattern). «Formu aç» is offered to every holder of `board.view` — the form is
// read-only without `clinical.chart` and `scores.sign` (X10). The shell keeps this screen mounted across a move
// to another patient (no `key`), so the box remembers WHOSE form it opened and binds the dialog's writes to that
// patient at the opening; a form opened on one patient is never shown on the next; a read that answers for an
// earlier patient is dropped; and an old opening's close closes nothing of a new one (MedsBox's rule).
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { readErrorText } from "../../../apiErrors.js";
import { useBoard } from "../../../data/BoardProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { Box, Button, Icon, Note } from "../../../ui/index.js";
import { SofaFormModal } from "./SofaFormModal.jsx";
import { stampOf } from "./sofaFields.js";

/** The last signature as the box says it (D1, D7): who, when — with its day and month when it is not today's
 *  (X5) — and the total; how many cells were corrected, when any were. «İmzalanmadı» when the engine has none. */
function SignedLine({ last, nowMs }) {
  const { t } = useI18n();
  if (last === null) return <p className="m-0 mt-1 text-13 text-mute">{t("sofa.unsigned")}</p>;
  const corrected = Number.isInteger(last.corrections) && last.corrections > 0;
  const params = { who: last.signed_by ?? "—", time: stampOf(last.at, nowMs) || "—", total: last.total ?? "—", count: last.corrections };
  return (
    <p className="m-0 mt-1 flex items-start gap-1.5 text-13">
      <Icon name="ok" size={14} className="mt-0.5 shrink-0 text-ok-ink" />
      <span>{t(corrected ? "sofa.signedCorrected" : "sofa.signed", params)}</span>
    </p>
  );
}

/** `patientId` is whose form this is; `bed` names the patient in the dialog's title and on its toasts (never
 *  the patient's name, Decision 14); `nowMs` is the screen's clock, which says which stamps are today's. */
export function SofaBox({ patientId, bed, nowMs = Date.now() }) {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const canChart = user?.perms?.includes("clinical.chart") ?? false;
  const canSign = user?.perms?.includes("scores.sign") ?? false;
  // The last read and WHOSE it was: a read for an earlier patient is never shown for this one, not even for the
  // one render before the move's effect runs.
  const [read, setRead] = useState({ forId: null, form: null, error: null, reading: true });
  // `{ id, opening, api }`: the patient the form was opened FOR, which opening this is, and the writes bound to
  // that patient at the opening — a write in flight stays its patient's whatever the screen shows next.
  const [editing, setEditing] = useState(null);
  const openings = useRef(0);
  const reads = useRef(0);
  const shownFor = useRef(patientId);
  shownFor.current = patientId;
  const mounted = useRef(false);
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function load(id) {
    const mine = ++reads.current;
    setRead((r) => (r.forId === id ? { ...r, reading: true } : { forId: id, form: null, error: null, reading: true }));
    try {
      const form = await board.store.sofaForm(id);
      if (!mounted.current || mine !== reads.current) return;
      setRead({ forId: id, form: form ?? null, error: null, reading: false });
    } catch (err) {
      if (err?.superseded || !mounted.current || mine !== reads.current) return;
      // A failed read keeps what was read before for this patient, and says it could not read again.
      setRead((r) => ({ forId: id, form: r.forId === id ? r.form : null, error: err, reading: false }));
    }
  }
  // The patient shown, read; a form opened for the one before is forgotten.
  useEffect(() => {
    setEditing(null);
    load(patientId);
  }, [patientId]);

  function openForm() {
    openings.current += 1;
    const id = patientId;
    setEditing({
      id, opening: openings.current,
      api: {
        read: () => board.store.sofaForm(id),
        chart: (entries, recordedAt) => board.store.chart(id, entries, recordedAt),
        preview: (overrides) => board.store.sofaPreview(id, overrides),
        sign: (overrides) => board.store.sofaSign(id, overrides),
      },
    });
  }
  function closed(opening, id, changed) {
    // An old opening's close closes nothing of a new one …
    setEditing((current) => (current?.opening === opening ? null : current));
    // … and a write it made is read back only while its patient is still the one shown.
    if (changed && id === shownFor.current) load(id);
  }

  const mine = read.forId === patientId ? read : { form: null, error: null, reading: true };
  const { form } = mine;
  const unmeasured = Array.isArray(form?.unmeasured_organs) ? form.unmeasured_organs.length : null;
  const right = <Button size="sm" icon="clip" onClick={openForm}>{t("sofa.open")}</Button>;
  return (
    <Box title={t("sofa.title")} icon="clip" level={2} right={right}>
      {mine.error ? (
        <div className="mb-2">
          <Note tone="warn" icon="alert">{t("sofa.unreadable", { reason: readErrorText(t, mine.error) })}</Note>
          <Button size="sm" className="mt-1.5" onClick={() => load(patientId)} busy={mine.reading}>{t("sofa.retry")}</Button>
        </div>
      ) : null}
      {form ? (
        <>
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-13">
            <span className="text-mute">{t("sofa.boxTotal")}</span>{" "}
            <b className="font-data text-20 font-bold text-ink">{form.total ?? "—"}</b>
            {unmeasured !== null ? (
              <span className="text-mute">{` · ${unmeasured === 0 ? t("sofa.boxAllMeasured") : t("sofa.boxUnmeasured", { count: unmeasured })}`}</span>
            ) : null}
          </p>
          {"last_signed" in form ? <SignedLine last={form.last_signed ?? null} nowMs={nowMs} /> : null}
          <p className="m-0 mt-1.5 text-11.5 text-mute">
            {t("sofa.boxIntro")} {t("sofa.boxReadAt", { time: stampOf(form.window_to, nowMs) || "—" })}
          </p>
        </>
      ) : mine.error ? null : mine.reading ? (
        <p className="m-0 text-13 text-mute">{t("sofa.reading")}</p>
      ) : (
        <div>
          <p className="m-0 text-13 text-mute">{t("sofa.noForm")}</p>
          <Button size="sm" className="mt-1.5" onClick={() => load(patientId)}>{t("sofa.retry")}</Button>
        </div>
      )}
      {/* The dialog is the box's last child whatever the box shows, so a read that lands while it is open does
          not remount it. */}
      {editing && editing.id === patientId ? (
        <SofaFormModal
          key={editing.opening} bed={bed} nowMs={nowMs} canChart={canChart} canSign={canSign} api={editing.api}
          onClose={(changed) => closed(editing.opening, editing.id, changed)}
        />
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run green**

Run: `npx vitest run src/live/screens/patient/sofa/`

Expected: all passed (`SofaBox.test.jsx` 6 and the three files before it).

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/live/screens/patient/sofa/SofaBox.jsx dashboard/src/live/screens/patient/sofa/SofaBox.test.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/sofa/SofaBox.jsx dashboard/src/live/screens/patient/sofa/SofaBox.test.jsx
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(dashboard): the SOFA box — total, organs with no measurement, last signature, «Formu aç» (G2-A4, D1, D7)

The box reads the form through the store for the patient shown and prints the engine's total, the count
of organs with no measurement, the last signature (dayStamp, X5) or «İmzalanmadı», the read's time and
that this is not the Sepsis-3 box's SOFA. «Formu aç» opens the dialog for every board.view holder (X10),
its writes bound to the patient at the opening; a write reads the box again; a move to another patient
drops the dialog and any late read.

Red first: the test file failed to resolve ./SofaBox.jsx.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 10: The patient screen shows the box where the note stood, and says what it writes (D1, X6)

**Files:**
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx` (header lines 1–6; imports ~line 60; the note ~434–435)
- Modify: `dashboard/src/live/screens/patient/PatientScreen.test.jsx` (the first test ~58–66; the seam test ~357–363; one import)
- Modify: `dashboard/src/live/i18n/strings/patient.js` (`onlyWrite` ×4, `formsSoon` ×4)

- [ ] **Step 1: The failing tests** — in `PatientScreen.test.jsx`, three Edits:

old:
```js
import { answering, channel, point, trends } from "./trends/trends.testutil.js";
```
new:
```js
import { answering, channel, point, trends } from "./trends/trends.testutil.js";
import { sofaForm } from "./sofa/sofa.testutil.js";
```

old:
```js
  it("names the bed and the patient, and says the three things it writes", async () => {
```
new:
```js
  it("names the bed and the patient, and says the four things it writes and that the SOFA form is signed too", async () => {
```

old:
```js
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/üç şey yazır/);
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi, xəstənin norması və dərman \/ maye qeydi/);
```
new:
```js
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/dörd şey yazır/);
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi, xəstənin norması, dərman \/ maye qeydi və SOFA formasından daxil edilən ölçmələr/);
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/scores\.sign/);
```

and the seam test — Edit:

old:
```js
    it("keep the forms seam as one note, which no longer promises the patient's normal", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const seam = screen.getByText(/növbəti qrupda əlavə olunacaq/).closest("[role='note']");
      expect(seam).not.toBeNull();
      expect(seam).toHaveTextContent(/SOFA/);
      expect(seam).not.toHaveTextContent(/norma/);
    });
```
new:
```js
    // G2-A4 (D1): the forms seam is gone; the SOFA box stands where it stood and reads THIS patient's form.
    it("the SOFA box stands where the forms note stood: after the Sepsis and medication row, before the trends", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), setup: (a) => a.severityForm.mockResolvedValue(sofaForm()) });
      const sofa = screen.getByRole("heading", { level: 2, name: "SOFA forması" });
      const meds = screen.getByRole("heading", { level: 2, name: /Dərman/ });
      const trends = screen.getByRole("heading", { level: 2, name: "Vital qrafikləri" });
      expect(meds.compareDocumentPosition(sofa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(sofa.compareDocumentPosition(trends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText(/növbəti qrupda əlavə olunacaq/)).toBeNull();
      expect(api.severityForm).toHaveBeenCalledWith("S-001");
    });
```

- [ ] **Step 2: Run them and see them red**

Run: `npx vitest run src/live/screens/patient/PatientScreen.test.jsx`

Expected: 2 failed — the first test at `/dörd şey yazır/` (the sentence says «üç şey»), the box test at `Unable to find role="heading" … name "SOFA forması"`.

- [ ] **Step 3: Mount the box** — in `PatientScreen.jsx`, two Edits:

old:
```jsx
import { MedsBox } from "./meds/MedsBox.jsx";
```
new:
```jsx
import { MedsBox } from "./meds/MedsBox.jsx";
import { SofaBox } from "./sofa/SofaBox.jsx"; // G2-A4 (D1)
```

old:
```jsx
          {/* The one seam left: the SOFA form is Group 3's, and the screen says so where it will go. */}
          <Note tone="info" icon="clock">{t("patient.formsSoon")}</Note>
```
new:
```jsx
          {/* G2-A4 (D1): the SOFA form's box, where the "forms come later" note stood. It reads the form of the
              patient shown and follows a move to another one itself (sofa/SofaBox.jsx). */}
          <SofaBox patientId={id} bed={bed} nowMs={nowMs} />
```

- [ ] **Step 4: The header says four things and the signature** — Edit:

old:
```jsx
// It writes THREE things, and says so in as many words (`patient.onlyWrite`), each only for a
// `clinical.chart` holder: whether an infection is suspected (Task 15B, Decision 27); since Group 2 ·
// slice 1, from the trends box, the patient's own normal ranges; and since G2-A3, from the Meds box
// (`meds/MedsBox.jsx`, D4), the medication and fluid entries — a pressor rate, a bolus, the weight,
// "antibiotic given". Nothing else here reaches the record.
```
new:
```jsx
// It writes FOUR things, and says so in as many words (`patient.onlyWrite`), each only for a
// `clinical.chart` holder: whether an infection is suspected (Task 15B, Decision 27); since Group 2 ·
// slice 1, from the trends box, the patient's own normal ranges; since G2-A3, from the Meds box
// (`meds/MedsBox.jsx`, D4), the medication and fluid entries — a pressor rate, a bolus, the weight,
// "antibiotic given"; and since G2-A4, from the SOFA form (`sofa/SofaBox.jsx`, D3), the measurements that
// complete its organ rows. A `scores.sign` holder also SIGNS that form there (D6) — a sealed row in the
// audit chain, not an observation — and the sentence says so (X6). Nothing else here reaches the record.
```

- [ ] **Step 5: The strings** — in `i18n/strings/patient.js`, eight Edits (one `onlyWrite` and one `formsSoon` per language; the `formsSoon` lines are removed — nothing else reads the key, `grep -rn formsSoon dashboard/src` shows only these four and the screen line Step 3 removed):

old (tr):
```js
    onlyWrite: "Bu ekran hasta kaydına üç şey yazar, üçü de yalnız clinical.chart yetkisiyle: şüpheli enfeksiyon işareti, hastanın normali ve ilaç / sıvı kaydı; başka hiçbir şey buradan yazılmaz.",
```
new:
```js
    onlyWrite: "Bu ekran hasta kaydına dört şey yazar, dördü de yalnız clinical.chart yetkisiyle: şüpheli enfeksiyon işareti, hastanın normali, ilaç / sıvı kaydı ve SOFA formundan girilen ölçümler. SOFA formunun imzası ayrıca scores.sign yetkisi ister ve denetim kaydına geçer; başka hiçbir şey buradan yazılmaz.",
```

old (az):
```js
    onlyWrite: "Bu ekran xəstə qeydinə üç şey yazır, hər üçü yalnız clinical.chart səlahiyyəti ilə: şübhəli infeksiya işarəsi, xəstənin norması və dərman / maye qeydi; buradan başqa heç nə yazılmır.",
```
new:
```js
    onlyWrite: "Bu ekran xəstə qeydinə dörd şey yazır, hər dördü yalnız clinical.chart səlahiyyəti ilə: şübhəli infeksiya işarəsi, xəstənin norması, dərman / maye qeydi və SOFA formasından daxil edilən ölçmələr. SOFA formasının imzası əlavə olaraq scores.sign səlahiyyəti tələb edir və audit qeydinə düşür; buradan başqa heç nə yazılmır.",
```

old (ru):
```js
    onlyWrite: "Этот экран записывает в карту пациента три вещи, все только с правом clinical.chart: отметку о подозрении на инфекцию, норму пациента и запись о препарате / жидкости; больше отсюда ничего не записывается.",
```
new:
```js
    onlyWrite: "Этот экран записывает в карту пациента четыре вещи, все только с правом clinical.chart: отметку о подозрении на инфекцию, норму пациента, запись о препарате / жидкости и измерения, введённые в форме SOFA. Подпись формы SOFA требует ещё права scores.sign и попадает в журнал аудита; больше отсюда ничего не записывается.",
```

old (en):
```js
    onlyWrite: "This screen writes three things to the patient's record, all only with clinical.chart: the suspected-infection charting, the patient's normal and the medication / fluid entry; nothing else is written from here.",
```
new:
```js
    onlyWrite: "This screen writes four things to the patient's record, all only with clinical.chart: the suspected-infection charting, the patient's normal, the medication / fluid entry and the measurements entered on the SOFA form. Signing the SOFA form also needs scores.sign and goes into the audit trail; nothing else is written from here.",
```

The four `formsSoon` removals — each Edit takes the `formsSoon` line and the line after it (`strings/patient.js:62–63`, `:220–221`, `:376–377`, `:532–533` at `9303a07`) and keeps the second line alone:

old (tr):
```js
    formsSoon: "SOFA formunu doldurma ve imzalama bu ekrana sonraki grupta eklenecek.",
    // Group 2 · slice 1 — the trend charts and the patient's own normal (spec §9, plus the
```
new:
```js
    // Group 2 · slice 1 — the trend charts and the patient's own normal (spec §9, plus the
```

old (az):
```js
    formsSoon: "SOFA formasının doldurulması və imzalanması bu ekrana növbəti qrupda əlavə olunacaq.",
    trendsNote: "NEWS2 · yetkin zolaqları; xəstənin norması, daxil edilibsə",
```
new:
```js
    trendsNote: "NEWS2 · yetkin zolaqları; xəstənin norması, daxil edilibsə",
```

old (ru):
```js
    formsSoon: "Заполнение и подпись формы SOFA будут добавлены на этот экран в следующей группе.",
    trendsNote: "Полосы NEWS2 · для взрослых; норма пациента — если введена",
```
new:
```js
    trendsNote: "Полосы NEWS2 · для взрослых; норма пациента — если введена",
```

old (en):
```js
    formsSoon: "Filling in and signing the SOFA form comes to this screen in the next group.",
    trendsNote: "NEWS2 · adult bands; the patient's normal, if one was entered",
```
new:
```js
    trendsNote: "NEWS2 · adult bands; the patient's normal, if one was entered",
```

After the four: `grep -rn "formsSoon" dashboard/src` prints nothing.

- [ ] **Step 6: Run the screen, the strings and the patient folder green; then the whole suite and the build**

Run: `npx vitest run src/live/screens/patient src/live/i18n/strings.test.js src/live/screens/kabul/SignOffStrip.test.jsx`

Expected: all passed.

Run: `npx vitest run 2>&1 | tail -5`

Expected: `Test Files  108 passed (108)`, `Tests  3011 passed (3011)`. Write the two numbers down: Task 11 quotes them.

Run: `npx vite build 2>&1 | tail -6`

Expected: `precache  20 entries`, no `larger than 500 kB`.

- [ ] **Step 7: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
feat(dashboard): the patient screen shows the SOFA box where the forms note stood, and says what it writes (G2-A4, D1, X6)

SofaBox replaces the «formlar yakında» note, between the Sepsis/medication row and the trends;
patient.formsSoon goes in four languages. patient.onlyWrite and the screen's header name the fourth write
(the SOFA form's measurements, clinical.chart) and the signature (scores.sign, a row in the audit chain).

Red first: 2 failed («üç şey» where «dörd şey» was expected; no SOFA heading).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 11: The docs — the Turkish guide and the roadmap row

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (lines 942, 950–951, before 969)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (after the G2-A3 row, line 39)

- [ ] **Step 1: The guide's three edits**

old:
```
- *Şüpheli enfeksiyon — ekranın yazdığı üç şeyden biri* (ötekiler hastanın normali, 3.7, ve aşağıdaki vazopressör/sıvı kaydı): Motorun sepsis kuralı yalnız şüpheli enfeksiyonu
```
new:
```
- *Şüpheli enfeksiyon — ekranın yazdığı dört şeyden biri* (ötekiler hastanın normali, 3.7, aşağıdaki vazopressör/sıvı kaydı ve SOFA formundan girilen ölçümler): Motorun sepsis kuralı yalnız şüpheli enfeksiyonu
```

old:
```
  ekran onun yeni hâlini gösterir. Yetkisi olmayana düğme çizilmez, nedeni yazılır. SOFA formunu
  doldurup imzalamak sonraki grupta.
```
new:
```
  ekran onun yeni hâlini gösterir. Yetkisi olmayana düğme çizilmez, nedeni yazılır.
```

old:
```
- *Göstermedikleri:* yaş, vücut yüzey alanı, hasta kimliğinden uydurulmuş hastane ya da protokol
```
new:
```
- *SOFA formu — ekranın yazdığı dördüncü şey* (G2-A4): İlaç ve antibiyotik kutusunun altındaki **SOFA formu** kutusu
  formun toplamını, kaç organda ölçüm olmadığını ve son imzayı gösterir («İmzalandı · dr.elif · 14:05 · toplam 7»;
  düzeltme yapılmışsa sayısı da yazar; bugünden önceki bir imzada saatin önünde gün ve ay yazar) ya da «İmzalanmadı».
  **Bu sayı Sepsis-3 kutusundaki SOFA değildir:** o, son değerlerle hesaplanan alarm SOFA'sıdır; form son 24 saatin
  **en kötü** değerleriyle doldurulur — ikisi aynı sayı olmak zorunda değil. «Formu aç» altı organı kaynaktaki sırayla
  gösterir (solunum, pıhtılaşma, karaciğer, kardiyovasküler, merkezi sinir sistemi, böbrek): her girdinin en kötü
  değeri, birimi, ölçüm saati, kaynağı ve puanı; ölçümü olmayan organda «ölçülmedi» (skor onu 0 sayar, ekran 0
  yazmaz); 3 ve üstü puanda «organ yetmezliği». Hasta 24 saatten kısa süredir buradaysa form bunu söyler.
  **Tamamlama** (`clinical.chart`): trombosit (×10³/µL), bilirubin ve kreatinin (**mg/dL**, laboratuvarın birimi —
  ekran çevirmez; µmol/L yazılmış bir kreatinin 30'un üstünde kalır ve reddedilir, µmol/L bir bilirubin ise
  reddedilmeyebilir: birimi alanın yanından okuyun), GCS, PaO₂/FiO₂ ve «solunum desteği» (evet/hayır) formdan
  girilir. Bu bir ölçümdür, gerekçe istemez; ölçüm saati siz değiştirene kadar şimdidir, en çok 24 saat geriye
  gider, ileri gitmez; kayıttan sonra form yeniden okunur, puanı motor hesaplar. Formda son 24 saatteki tek bir
  «evet» PaO₂/FiO₂'yi destekte sayar, «hayır» onu geri almaz (alarm SOFA'sı ise son kaydı okur). **Düzeltme**
  (`scores.sign`): yalnız ölçülmüş bir değere, doğru değer ve en az 20 karakterlik bir gerekçeyle (sayaç gösterir);
  puan yazılmaz, motor yeniden hesaplar, kayıttaki değer de saklanır; kayıt kapısının yazım hatası sınırları düzeltmede
  de geçerlidir (18000 yazılmış bir trombosit hem önizlemede hem imzada reddedilir). **Önizle, sonra imzala:** «Önizle» motordan
  imzalanacak formu ister ve hiçbir şey yazmaz; «İmzala» yalnız o önizlemeden sonra ve aynı düzeltmelerle çıkar
  (bir düzeltme değişirse yeniden önizlenir), imza adınızla denetim zincirine mühürlenir. Kayıt arada değiştiyse
  (başka biri ölçüm girdiyse) ekran imzalanan toplamın önizlemedekinden farklı olduğunu söyler. Formu `board.view`
  yetkisi olan herkes açabilir; yetkisi olmayana düğme çizilmez, nedeni yazılır. **Yapmadıkları:** alarm,
  bildirim ya da zil yok; idrar çıkışı böbrek puanına katılmaz (eksik kaydedilmiş bir günün toplamı oligüri gibi
  okunurdu); MAP formdan girilmez (kayıttan gelir — monitör henüz gerçek motoru beslemediği için çoğu hastada
  «ölçülmedi»); vazopressörler İlaç kutusundan girilir; pencere 24 saattir; dünle karşılaştırma ve skor geçmişi
  yok; APACHE, PRISM ve SNAP tabloları kaynağıyla gelene kadar yok. Formun her okunuşu denetim kaydına bir satır düşer.
- *Göstermedikleri:* yaş, vücut yüzey alanı, hasta kimliğinden uydurulmuş hastane ya da protokol
```

- [ ] **Step 2: The roadmap row** — first collect the three values the row quotes:

```bash
cd /c/tmp/g2a-a4 && git rev-parse --short HEAD
```

`{HEAD}` = that sha (the head after Task 10); `{ENGINE}` = Task 3b Step 5's whole-suite line (`2854 / 822` if it matched); `{DASH}` = Task 10 Step 6's numbers (`108 dosya / 3011 test` if they matched). Then Edit (replace the three braces with those values):

old:
```
| G2-B1a | Hasta Kabul (Lane B): Yönetim › Yapı
```
new:
```
| G2-A4 | SOFA formu: hasta ekranında İlaç kutusunun altında «SOFA formu» kutusu — formun toplamı, ölçümü olmayan organ sayısı, son imza («İmzalandı · {kim} · {saat} · toplam {n}», düzeltme sayısıyla) ya da «İmzalanmadı»; Sepsis-3 kutusundaki alarm SOFA'sından ayrı olduğunu söyler — ve «Formu aç» penceresi: altı organ kaynaktaki sırayla, her girdinin en kötü değeri, birimi, ölçüm saati, kaynağı ve puanı, «ölçülmedi» (0 yazılmaz), organ yetmezliği işareti, pencere (yatış 24 saatten kısaysa söyler), böbrekte idrar çıkışı puanlanmaz (D8), MAP formdan girilmez (D9); **tamamlama** (`clinical.chart`, `/clinical` kapısından, gerekçesiz): trombosit, bilirubin ve kreatinin (mg/dL, D11), GCS, PaO₂/FiO₂, solunum desteği evet/hayır, ölçüm saati en çok 24 sa geriye; **düzeltme** (`scores.sign`, ölçülmüş değere, ≥ 20 karakter gerekçe, puanı motor hesaplar); **«Önizle»** (`preview: true`, denetim satırı yok) **sonra «İmzala»** (aynı düzeltmeler); motor: `ON_RESP_SUPPORT` kaydedilebilir bayrak, PLATELETS/BILIRUBIN/CREATININE/PAO2_FIO2 için yazım hatası sınırları — düzeltmede de, önizleme ve imzada (`parse_overrides(..., bounds=PLAUSIBLE)`, O6) —, GET formu `last_signed` + `min_reason_chars` taşır · dal `feat/g2a-a4-sofa` (main `ec66a57`'den) · spec: [2026-11-01](../specs/2026-11-01-g2a-a4-sofa-formu-design.md) · plan: [G2-A4](2026-11-01-g2a-a4-sofa-formu.md) | Kodda, VM'de değil (`{HEAD}`; kapılar motor {ENGINE}, pano {DASH} / 0, derleme ✅); api ve web birlikte, önce api (planın dağıtım notları: eski api'ye karşı yeni web düzeltme/önizleme/imza sunmaz). **Açık:** X1–X16 · O1–O5, O7–O9 (plan; O6 bu dilimde kapandı) |
| G2-B1a | Hasta Kabul (Lane B): Yönetim › Yapı
```

- [ ] **Step 3: Line ends, then commit**

```bash
cd /c/tmp/g2a-a4 && for f in docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -F - <<'MSG'
docs: G2-A4 SOFA formu in the Turkish guide and the roadmap

The guide's patient-screen section gains the SOFA form bullet (the box, the rows, completing,
correcting, preview then sign, what it does not do) and drops "SOFA formunu doldurup imzalamak sonraki
grupta"; the suspected-infection bullet counts four writes. The roadmap gains the G2-A4 row after
G2-A3: kodda, VM'de değil.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 12: The gates, the final review and the fold (controller)

- [ ] **Step 1: The gates on the branch's head** — the engine's whole no-DB suite (`2854 passed, 822 skipped`), the dashboard's whole suite (`108 files / 3011 tests`, 0 failed) and `npx vite build` (`precache  20 entries`), each in the foreground. Optionally the dashboard suite again under `TZ=Pacific/Chatham` and `TZ=America/New_York` (A3 ran five zones): every time in the tests is computed with `dayStamp`/`toLocalInput`, so none may depend on the zone.
- [ ] **Step 2: The final whole-branch review (opus)** against the spec D1–D11, this plan's X1–X16, Decision 1 (no clinical arithmetic in the browser), accessibility (labels, the focus after each editor, keyboard-only, a 390 px dialog), the four languages, CRLF on every touched file, no PHI. Fix-first findings are fixed in their task's files with `fix(...)` commits.
- [ ] **Step 3: The fold.** Append to this plan a "Done on the branch (fold, date)" section — the table task → commit → what it pinned, the final review's findings and their fixes, the counts at the head, any departure the review added (X17…), the open items carried — and update the roadmap row's sha and counts to the folded head. Commit `docs(plan): G2-A4 — the fold: commits, the final review, the counts`.
- [ ] **Step 4:** Push `feat/g2a-a4-sofa` only on the user's word; the merge waits for the user; the VM deploy goes with the next deploy, API before or with the web (Deploy notes).

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 0 worktree, junction, baseline | — | — | — |
| 1 the door: `ON_RESP_SUPPORT`, four bounds (D4) | 0 | 4, 5, 6 | — |
| 2 GET `last_signed`, `min_reason_chars` (D7) | 1 (its tests chart through the same door; serially, for the counts) | 4, 5, 6 | `api/app.py`, `tests/scoring/test_signing.py` (3) |
| 3 POST `preview` (D6) | 2 (`_AsPeople`, `NURSE`; `api/app.py`, serially) | 4, 5, 6 | `api/app.py`, `tests/scoring/test_signing.py` (3b) |
| 3b the server bounds a correction (O6) | 1 (the four lab bounds in `PLAUSIBLE`), 3 (`api/app.py`, `test_signing.py`, serially) | 4, 5, 6 | — |
| 4 client `preview`, store methods, `fakeApi` | 0 (the contract's shape only) | 1–3b, 5, 6 | `testTokens.testutil.js` is read by 9, 10 |
| 5 strings `sofa.*` (X1) | 0 | 1–4, 6 | `catalog.js` — Lane B's next slice may add its own namespace there: blank lines either side |
| 6 `sofaFields.js`, `sofa.testutil.js` | 0 (the strings are keys only; the tests use an identity `t`) | 1–5 | — |
| 7 the editors | 5 (az texts), 6 | 1–3 | — |
| 8 the dialog | 7 | 1–3 | — |
| 9 the box | 4 (store), 8 | 1–3 | — |
| 10 the screen, `onlyWrite`, `formsSoon` | 9 | 1–3 | `strings/patient.js` |
| 11 docs | 3b, 10 (the counts and the head it quotes) | — | — |
| 12 gates, review, fold | 1–11 | — | — |

**Why this order.** The engine first in plan order because the dashboard's deploy safety (X13) leans on the engine's answer, but the dashboard tasks depend only on the answer's shape, which the contract fixed, so they can be built beside the engine. Tasks 2, 3 and 3b all edit `api/app.py` and `tests/scoring/test_signing.py` (Task 3's and 3b's API classes extend Task 2's base; 3b's route test needs Task 1's platelet bound in `PLAUSIBLE`), and every Edit's old text was checked unique against the file as the earlier task left it: they run serially. On the dashboard, each layer's tests mount the layer below it (the box mounts the dialog, the dialog the editors, the editors read `sofaFields`), and the az texts the tests assert come from Task 5.

**Waves, if run in parallel:** A = {1 → 2 → 3 → 3b} beside B = {4, 5, 6 → 7 → 8 → 9 → 10}; then 11, 12. The counts in this plan assume the serial order 0 → 12; a parallel merge re-runs Task 12's gates on the merged head.

## Done on the branch (2026-11-01)

Built subagent-driven in two lanes (engine in `/c/tmp/g2a-a4`, dashboard in `/c/tmp/g2a-a4-fe`), merged twice
(`f608721`, `4df4ba3`); then one review round on the merged slice. Nothing on main, nothing on the VM.

| Phase | Commits | Review |
|---|---|---|
| Spec, plan | `ae1dcaa`, `9303a07` (O1 = mg/dL), `6faba6d`, `d5c2dc9` (Task 3b, O6 into the slice) | — |
| Engine Tasks 1–3b | `b6fbb18`, `09b495a`, `6dda49c`, `0a8ee87` | APPROVE + minors → `e6bf796` (support freshness 8 h, preview's promises pinned, bounds 5000/40 = X18) |
| Dashboard Tasks 4–10 | `3b466a7`, `7527489`, `b70d031`, `f67f639`, `d655efc`, `044becc`, `a172271` | 4–6 APPROVE + minors; 7–8 CHANGES (a preview must be one; a moved record) → `2205a90`, `2fe2621`, `63fdfd2`, `1abcc13`, `bd5ac3b` (+ the arming window, Lane B's double-click finding) |
| Merge, docs (Task 11) | `f608721`, `7543729`, `4f28a36` | final review: APPROVE WITH MINORS, six SHOULD |
| Round 2 (S1–S6) | `ebfd36f`, `f5cdd6a`, `7082711`, `a0a9475`, `8470c33`, `859612c` (worst SCORE, X21 corrected); `379bfc6`, `a9afd0a`, `9e1123f`, `2cbeeb6`, `a684279`; merge `4df4ba3`; `049cf5a` | re-review: APPROVE WITH MINORS (two strings SHOULD) |
| Round 3 | `4f718cc`, `2db9e0c`, `9c210be` | — (the re-review's own findings) |

**Gates at `9c210be`:** engine, no database — 2931 passed, 822 skipped; dashboard — 108 files / 3059 tests; `vite build`
✅. The plan's predicted 2854 / 3011 were before the review rounds.

**Deploy (owner's word):** api and web together, api first (deploy notes above); no migration; the hub is untouched.
