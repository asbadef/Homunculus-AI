# Group 2 · Lane B — G2-B1d · Protokol (the visit number, its barcode label, the Connex Spot patient query) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Homunculus issues a twelve-digit protocol number to every new admission (none until the administrator sets the start number), makes it the admission's card key, prints it on a 50×30 mm Code 128-C label, and answers the Welch Allyn Connex Spot's patient query (`QBP^Q22` through NCE) from the admission itself — the name for a known number, «not found» for an unknown or discharged one, the bridge's mirror when the API cannot answer.

**Architecture:** Migration `0015` adds `protocol_settings` (one row per tenant: `next_no`, `last_issued`, the label size and dpi) and `admissions.protocol_no` (12 digits, partial unique per tenant, a CHECK). A new package `homunculus/protocol/` holds the model, the counter (`next_protocol_no`: one `UPDATE … RETURNING` inside the admission's transaction, as `admission/numbers.py`), the barcode-fit rule and `GET|PUT /admin/protocol-settings`. `admission/boardkey.py` is the one rule `board_key(protocol_no, patient_number) = protocol_no or patient_number`, and every place that ties an admission to the board calls it: the admission route and its resend paths, sign-off, discharge, the lists, the refusal extras, the bed release's card check (`tenant/router.py`), the care team's own patients and break-glass. `POST /admissions/{id}/label` returns the label's fields and audits the print. `api/edge_query.py` answers the bridge's `POST /edge/patient-query` (device token only, exact number, never proxied by nginx). On the bridge, `edge/pdq.py` gains a «not found» outcome, `edge/pdq_client.py` asks the API (2 s), `EdgeBridge.answer_query` goes API → mirror → echo, and `serve_mllp` runs the responder off the event loop. The dashboard gains a Code 128-C encoder and the label's layout and print window (`screens/kabul/label/`), Yönetim › Protokol ve etiket, the admit box's protocol and print button, the board-key match in the Kabul screens, and the patient screen's reprint.

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, pytest with Postgres 16, the bridge's stdlib `urllib` and `sqlite3`; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`, `fireEvent`; no user-event), Tailwind on the live tokens.

**Spec (authoritative):** `docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md` at `e86835c`, the branch head before this plan (`c09950c` + the lanes' answers of 2026-11-01, `da9c95b` and `e86835c`: the store-exception 503 of §5.1; the editor's `_open_admission_number` among §4's call sites — not `_patient_of`, which only picks the audit row's id and stays). Decisions D1–D12 are the owner's and the controller's and are not reopened here. Where this plan departs from the spec, the departure is in the table below with its reason.

**How the numbers in this plan were obtained.** This plan was NOT replayed while it was written: no scratch worktree ran its code. Every code block was written against the files as they stand at `e86835c` (main `ec66a57` underneath; the two spec commits after `c09950c` change no code), and every file:line below was read there. Each task's "Expected" red names the failure the code at that point must give; counts of passed tests are given only where the task's own tests fix them. The implementer records the real red and green in each commit body, and Task 18 records the suite totals. Where a code block meets a line that moved, the task's prose says what the line does: match on that, never on the number.

---

## Departures from the spec (read before Task 1)

| # | Spec | Found in the code | This plan |
|---|---|---|---|
| E1 | §9 (and the controller's brief) name the chain `0013_monitor_samples` → `0014_device_beds` | The revision ids are the bare numbers: `revision = "0013"` (`alembic/versions/0013_monitor_samples.py:46`), and the editor's `revision = "0014"`, `down_revision = "0013"` (`/c/tmp/g2b-esleme-be/homunculus-engine/alembic/versions/0014_device_beds.py:34-35`, read only) | `0015_protocol.py`: `revision = "0015"`, `down_revision = "0013"`. Task 22 repoints it to `"0014"` (or renames it `0014` if the owner calls this slice first). Done in Task 22 (`a20ad06`): `down_revision = "0014"`. |
| E2 | §5.1: `api/edge_query.py` "mounted in `app.py`", beside the research router (§9) | The device check is `_caller`, a closure defined inside `create_app` (`api/app.py:690`) after the router includes (`:611-621`); a module-level router cannot reach it | `edge_query.py` is a factory, `edge_query_router(*, caller, identities)`. `app.py` includes it beside `infinity_research_router` with `caller=lambda authorization: _caller(authorization)`: the name is read when a request arrives, after `create_app` has defined it. One include line (Task 7, Lane A review). |
| E3 | §4's call sites omit the bed release | `tenant/router.py` `_last_card_off` (`:557-574`) reads `Patient.patient_number` to find a discharged patient's card still on the board and take it off before the bed is freed | It reads the board key (Task 5). Left as it is, a protocol card whose discharge step failed would never be found, the bed would be freed under it, and a nameless H-number tombstone would be written. |
| E4 | §4: "the `admission.admit` audit row gains `protocol_no`" | Every admission audit row's `patient_id` is `Patient.patient_number` today (`router.py:537, 740, 906, 967, 981`, `tenant/router.py:567`) — which is the card key, so the trail's `patient_id` of an admission and of that patient's engine rows (`chart`, `profile`, alerts, acks, all under the card key) is one value | The `patient_id` of every admission row is the **board key** (the H-number for a legacy admission, as before). The admit row's payload gains `protocol_no` **and** `patient_number`, so the H-number stays on record beside the key. One card, one `patient_id` in the trail. Router log lines name the board key too. |
| E5 | §4: "the admission list and detail responses gain `protocol_no` and `board_key`" | `GET /admissions/{id}` answers the ORM row as `AdmissionResponse` (`router.py:615-621`), which carries no patient number | Every `AdmissionResponse` gains `protocol_no`; `AdmitResponse` and `AdmissionRow` gain `board_key`; the detail route answers a new `AdmissionDetail` (`AdmissionResponse` + `patient_number` + `board_key`). |
| E6 | — (the brief's "the duplicate/'earlier' answer") | `request_conflict` and `duplicate_open_admission` (`router.py:293, 407`) and `board_not_cleared` (`tenant/router.py:574`) carry `patient_number` beside the code; the screen shows it as the number to look for (`apiErrors.js:237`) | They carry `board_key` beside `patient_number` (kept, unchanged). `backendApi.js` puts `board_key`, else `patient_number`, on `err.patientNumber`: the number the screens show is the card's. |
| E7 | D12: `/edge` is not proxied | `tests/test_nginx_routes.py:52-58` derives every OpenAPI prefix of the app and requires nginx to proxy it; `tests/test_tenant_isolation.py:798-812` requires every unscoped route that is not `homunculus.api.app`'s to be in `NOT_THE_BOARD` | `test_nginx_routes.py` gains `NOT_PROXIED = {"/edge"}` (left out of the drift check) and a test that no API location matches `/edge/patient-query`; `test_tenant_isolation.py` gains a set `DEVICE_ONLY = {("POST", "/edge/patient-query")}` (Task 7). |
| E8 | §5.3: the responder through `asyncio.to_thread` | `IdentityMirror` holds one sqlite connection opened `check_same_thread=False` (`edge/identity.py:43`); `handle_message` writes it on the loop thread (`bridge.py:129-134`) while queries would read and write it from worker threads | The mirror gains a `threading.Lock` around each of its statements (Task 8). |
| E9 | D5: no admission until the start number is set | Two test worlds admit through the route: `tests/kabul_world.py` `build_ward` and `tests/test_tenant_isolation.py` `_hospital` (its `201` controls, `:326-328, :393`) | Both worlds get a `protocol_settings` row (`next_no = 202600000001`). The B1a route tests' card-key uses move from `patient_number` to `board_key` by the rule in Tasks 4 and 5. |
| E10 | §3: CHECK `protocol_no ~ '^[0-9]{12}$'` | `scripts/dev_local.py:75-85` builds the models on SQLite with `create_all`, which cannot parse `~` | The model's `CheckConstraint` is `.ddl_if(dialect="postgresql")`; the migration creates it unconditionally (Postgres only). `dev_local.py` imports `homunculus.protocol.models`. |
| E11 | §3 names the PUT rules, not their order | — | `protocol_format` (422) → `label_dpi` → `label_size` → `label_too_narrow` (422) → `protocol_not_forward` (409): the body is read, then held against the stored row. The width is whole millimetres, so the narrowest accepted width is 49 mm at 203 dpi (48 < 48.42) and 44 mm at 300 dpi (43 < 43.98). |
| E12 | §4: "every match … uses `board_key`" | The B1a dashboard tests build admission rows without it (`kabul.testutil.js:58-65` `row()`) | `screens/kabul/boardKey.js` `boardKeyOf(row)`: `row.board_key`, else `row.patient_number` — an answer without the field (those rows, or an API one release behind the web) keyed its card by the H-number. Every match goes through it. |
| E13 | §6: "the fixed width of 121 modules for 12 digits"; §3: "one table of cases" | 121 counts the two 10-module quiet zones: START-C 11 + 6×11 + check 11 + STOP 13 = 101, + 20 | `homunculus-engine/tests/label_fit_cases.json`, read by `tests/test_protocol_settings.py` and by the dashboard's `protocolLabel.test.js` (Tasks 3 and 13). |
| E14 | §5.1: any store exception → 503 | SQLAlchemy's `OperationalError` text carries the statement's parameters — the queried number | The route logs the exception's class only, never `log.exception` (Task 7). |
| E15 | §7: the codes in their own `# G2-B1d` block | The editor's block (`# G2 monitor→bed editor`) sits inside `CODES` (`/c/tmp/g2b-esleme-be/…/admission/errors.py:34-48`, read only) | The B1d block comes after `CODES` and rebinds it, `CODES = CODES | frozenset({…})`: two hunks with untouched lines between them merge without a conflict. |
| E16 | Task 2's test helpers: `_tenant` returns the `Tenant` ORM row, and `_row` and the rollback test read its `.id` after `db.expire_all()` / `rollback()` | `tests/test_protocol_numbers.py`: reading an expired ORM row's attribute lazy-loads outside the greenlet — `MissingGreenlet` (4 failed with the plan's code, all in the helper) | `_tenant` returns the tenant's id and the tests pass the id; `numbers.py` and `errors.py` are unchanged. (commit `bb00546`) |
| E17 | Task 14: one `protokol.invalid.nextNo` text, «12 rakam girin», for every refused start number | A-1 refuses `000000000000`; «enter 12 digits» would be wrong for a number of twelve zeros | `strings/protokol.js` gains `invalid.nextNoZero` in tr/az/ru/en («Başlangıç numarası en az 000000000001 olmalı.»). (commit `9cfbb71`, as `E16` in its body) |
| E18 | Task 14: `rawKeys.test.jsx` is not touched | `openAt` leaves `protocolSettings` unstubbed, so it resolves `undefined` and the raw-key sweep walked a form on the defaults | `rawKeys.test.jsx` stubs `protocolSettings` in `openAt` and gains one anchor test for the tab. (commit `9cfbb71`, as `E17` in its body) |
| E19 | Task 14: a failed first read shows the red refusal above the form on the defaults (50×30 mm, 203 dpi) | Saving the defaults over stored values because one read failed is a write nobody chose | While no read has answered, the tab shows the refusal and a retry, not the form, a field or the save button; the retry reads again. Pinned by `ee053a3` (F-12). (commit `9cfbb71`, as `E18` in its body) |
| E20 | Task 13: the label's text scale is `h/30` | A-3's «never cut» cannot hold on the tall narrow sizes the settings allow: at 49×80 mm the twelve-digit protocol alone is wider than the paper | The text scale is `min(h/30, w/50)`; the bars and the frame keep scaling with the height. (commit `9d0bb9f`) |
| E21 | Task 4's `test_without_a_start_number_no_admission_is_written` reads `w.beds["1"].id` and `form(w)` after `db_session.expire_all()` | The same cause as E16: the ward's ORM rows are expired and the read raises `MissingGreenlet` | The test takes `bed_id`, `tenant_id` and the form body as plain values before the first commit and posts that body twice. No product code is involved. (commit `2a43c2f`, as `E17` in its body) |
| E22 | Task 7 names two route walks: `test_nginx_routes.py` and `test_tenant_isolation.py`'s `DEVICE_ONLY` | A third walk, `tests/test_route_inventory.py::test_every_route_is_guarded_or_explicitly_exempt`, requires every route outside `homunculus.api.app` to reach `get_principal`; the device route does not (its caller is the app's `_caller`) | A one-entry exemption for `(homunculus.api.edge_query, /edge/patient-query)`; after `c11bce0` it is keyed by module, method and path, and a route is exempt only when every one of its methods is named, so a GET or PUT added later at that path is not waved through. (commit `d484edd`) |
| E23 | Task 9: `pdq_client.ask` turns `urllib.error.HTTPError` and `(URLError, TimeoutError, OSError)` into «unavailable» | A connection cut mid-answer raises `http.client.HTTPException` (`IncompleteRead`, `BadStatusLine`), which urllib does not wrap in `URLError` or `OSError` | `ask` also turns `HTTPException` into `QueryUnavailable`, as the module's contract says («anything untrustworthy»); two parametrised cases added. (commit `3ec307a`) |
| E24 | Task 9: `EdgeBridge._mirror` logs a mirror fault with `_log.exception` | A store error's words may carry the statement's parameters — the number (E14's reason) | It logs the exception's class only, no traceback; one test (a mirror whose errors name the number). (commit `3ec307a`) |
| E25 | Task 10: `answer_query` runs through `asyncio.to_thread`, and its counters stay plain integers | One worker thread per connection: several `answer_query` calls run at once and touch `queries`, `queries_not_found` and `queries_api_failed`, and `+= 1` is a read and a write another thread can slip between | `BridgeStats` gains a lock and `bump(name)`, and the three counters go through it; the others stay plain (`handle_message` runs on the loop thread, the report only reads). Not shown red: CPython 3.12 does not switch threads between the read and the write, so the stress test (8 threads × 600 answers) is a guard. (commit `05b19b3`) |
| E26 | Task 10's no-stall test closes the server in `finally` with `await server.wait_closed()` | Without first closing its client writers, and with the loop held (the red), that cleanup waited forever on the open connections: the test hung instead of failing | A shared `_shut()` helper closes the writers first and bounds `wait_closed` at 5 s. (commit `05b19b3`) |
| E27 | Task 22, A1: rebase the slice onto main | A rebase rewrites the reviewed commits, so Lane A's read hunks would no longer name them, and the conflicts would be resolved commit by commit | Main was merged into the slice instead (`fc1b703`): the reviewed commits keep their hashes and each conflict was resolved once. (commit `fc1b703`, as `E27` in its message) |

Departures found while implementing go below E15 (E16 …), each with its file and line.

## Open items

Numbered from O70 (B1a holds O39–O53, the editor O60–O66).

| # | Item | Owner | When |
|---|---|---|---|
| O70 | The spec takes any 12 digits as the start number, `000000000000` included — the number the test label prints. Not refused here (spec §3); the owner may want the start to be at least 1. | Owner | Before the deploy |
| O71 | The owner's NCE session, spec §12 O1–O6 (Host1 still at `.72:2575` and the feed alive; the scanner reads Code 128-C; what `NF` shows; the name in `PID-5`; QPD-3 exact; the Zebra stock at 100 %). Block E-2 lists them. | Owner | After block D |
| O72 | Lane A reviews: `api/app.py` (two include lines, Tasks 3 and 7), `api/edge_query.py` (whole, Task 7); and is told of `edge/pdq.py`, `edge/identity.py`, `edge/pdq_client.py`, `edge/bridge.py`, `edge/mllp.py`, `scripts/run_bridge.py` (Tasks 8–10). No Infinity file is touched. | Lane A | Before each merge to the slice |
| O73 | Native reading of the `protokol` namespace's az, ru and en (the planner's). | Owner | Before the deploy |
| O74 | The editor's `devicebeds/service.py` `_open_admission_number` (≈ `:208` on `feat/g2b-esleme-be` @ `2e311e9`, read only) returns `Patient.patient_number` as the bed's occupant; it reaches the `bed_occupied` refusal's `occupied[].patient_id`, which the dialog uses to find the card. It reads the board key after B1d; `_patient_of` (the audit row's id) stays. Whichever slice lands on main second adapts it and tests `occupied[].patient_id` for a kabul patient admitted after B1d (Task 22). Lane A's `app.py` `_occupants` (`:1170-1195`) lists the identity store's own keys by `bed_id`: the key IS the card key, nothing to change — pinned by Task 5's test. | Lane B / controller | Task 22 |
| O75 | `tests/test_route_permissions.py` counts 59 → 62 here; the editor counts 59 → 62 too; merged, 65. `tests/conftest.py` becomes the editor's `walk_packages` loop after its merge, which picks `homunculus.protocol.models` up by itself (this slice's import line goes). | Controller | Task 22 |
| O76 | A label can be printed for a discharged admission (the spec is silent); the screens offer the button only for an open one. | Owner | Later |
| O77 | A name the API answered stays in the bridge mirror (state admitted) until a later query answers `NF`; while the API is unreachable the mirror answers it, for a patient discharged since (D8 accepts this). | — | Settled (D8) |
| O78 | This plan was not replayed (see above): the implementer's red/green and Task 18's totals are the first measured numbers. | Controller | Task 18 |

---

## Environment and gates (binding)

- **Worktrees.** The slice branch `feat/g2b-protokol` lives at `/c/tmp/g2b-protokol`. The backend lane works in `/c/tmp/g2b-b1d-be` (branch `feat/g2b-b1d-be`), the dashboard lane in `/c/tmp/g2b-b1d-fe` (branch `feat/g2b-b1d-fe`), both cut from the slice branch at this plan's commit (`deps.md`). Paths in tasks are relative to the repository root of the task's worktree. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's checkout) or `main`, nor any other session's worktree (`/c/tmp/g2b-esleme*`, `/c/tmp/g2a-*`, `/c/tmp/inf-*`, `/c/tmp/homunculus-tasarim`). The editor's files are read there, never written.
- **Test database.** `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test`, the container `homunculus-test-pg-56` (`docker start homunculus-test-pg-56` if `docker ps` does not list it). Shared with Lane A and the editor behind `conftest.py`'s advisory lock: a run may print "waiting for another test run …" — wait, then run again. Give it on each command line, **never export it. Never set `DATABASE_URL`.**
- **Python.** `/c/tmp/f7-py312/venv/Scripts/python.exe` (3.12); the 3.14 check uses `/c/tmp/g115-py314/Scripts/python.exe`. Always from `homunculus-engine`, always naming files:
  ```bash
  cd /c/tmp/g2b-b1d-be/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -5
  ```
  With the database: prefix `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test`. **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or through a bare `pytest tests/`; the whole no-DB suite is the command above with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. The repo has no ruff or other linter configured (`pyproject.toml`): the gates are the tests and the build.
- **Dashboard.** `dashboard/node_modules` is a junction to `/c/tmp/homunculus-g1/dashboard/node_modules`. **Never `npm install`, never search it** (give Grep/Glob a path under `dashboard/src`). Commands from `<worktree>/dashboard`, the suite and the build as two separate calls:
  ```bash
  npx vitest run <files or folder/> 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
  npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
  ```
  The build prints `built in` and `precache  20 entries` and no `larger than 500 kB`. After editing a `strings/*.js` file run `npx vitest run src/live/i18n/strings.test.js` (it fails on a mangled `ə` or Cyrillic). A task that creates a product module runs `npx vitest run src/reachable.test.js` before its commit.
- **Foreground, short.** Every suite and build in the foreground, at most 10 minutes per call, no `sleep`; never background a gate and wait on it. Name the files.
- **Edits.** Write and Edit tools only on repo files — never `sed`, `python`, `node` or a heredoc onto a repo file. The tree checks out CRLF (`core.autocrlf=true`); every block here is LF; the Edit tool keeps a file's CRLF; a new file lands LF and git normalises it on commit.
- **TDD.** Write the test, run it, see it red **for the reason the task names**, then the code, then green. The red goes in the commit body (`red: 3 failed — ModuleNotFoundError: homunculus.protocol`).
- **Git.** Never `git stash`. Before each commit `git status --short` and `git diff --cached --stat`; commit with a pathspec (`git commit -F - -- <paths>`); a staged path the task does not list: stop and ask. **Never push**, alone or inside a compound command. Messages `type(scope): what` ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **No PHI, anywhere** (CLAUDE.md rule 6): tests, fixtures, docs, blocks and screenshots use synthetic names («Test Hasta», «Sentetik Hasta») and made-up numbers (`202600000001`, `H2600042`). No block prints a patient's name, number or value; the bridge logs no id.
- **Lane A review.** Lane A reviews every hunk in its files: `api/app.py` (Tasks 3 and 7: one include line each) and the new `api/edge_query.py` (Task 7). The NCE path (`edge/pdq.py`, `edge/identity.py`, `edge/pdq_client.py`, `edge/bridge.py`, `edge/mllp.py`, `scripts/run_bridge.py`) is shared `edge/`: Lane A is told (O72). A task touching one carries a **Lane A review hunk** note listing the exact lines; send the diff of those paths to the controller before the task's commit is merged to the slice branch.
- **Deploy.** One VM deploy at a time across every lane. This slice's deploy waits for the owner's «main'e al» and then «onay»; Task 21 writes the blocks, it never runs them. In a pasted `bash <<'BLOK'`, every stdin consumer (`docker compose exec|run`, `psql`, `ssh`, `scp`, `docker exec`) takes `</dev/null`.
- **Codes, not words; no UUID; four languages** (az default, tr source, ru, en), as B1a §5.7: refusals mapped by `err.apiCode`; a test of every new surface asserts no UUID in `document.body.textContent`; an `az` text equal to `tr` or an `ru` text without Cyrillic needs a reviewed entry in `strings.test.js`.
- **Reachability** (`src/reachable.test.js`): every new dashboard module is imported from `main.jsx`'s tree in the commit that creates it; nothing under `src/live/` imports outside it but `backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js` (`boundaries.test.js`).

---

## File map

**Create — engine** (`homunculus-engine/`)

| File | Responsibility | Task |
|---|---|---|
| `alembic/versions/0015_protocol.py` | `protocol_settings`; `admissions.protocol_no`, its CHECK and its partial unique index; downgrade | 1 |
| `src/homunculus/protocol/__init__.py` | the package | 1 |
| `src/homunculus/protocol/models.py` | `ProtocolSettings` on `Base` | 1 |
| `src/homunculus/protocol/numbers.py` | `format_protocol_no`, `parse_protocol_no`, `next_protocol_no` | 2 |
| `src/homunculus/protocol/fit.py` | the barcode-fit rule: `module_mm`, `min_width_mm`, `label_refusal` | 3 |
| `src/homunculus/protocol/schemas.py` | `ProtocolSettingsIn`, `ProtocolSettingsOut` | 3 |
| `src/homunculus/protocol/router.py` | `GET|PUT /admin/protocol-settings`, audit `protocol.settings` | 3 |
| `src/homunculus/admission/boardkey.py` | `board_key(protocol_no, patient_number)` | 4 |
| `src/homunculus/api/edge_query.py` **(Lane A review)** | `edge_query_router(caller=, identities=)`: `POST /edge/patient-query` | 7 |
| `src/homunculus/edge/pdq_client.py` | `PatientQueryClient.ask`, `QueryUnavailable`, `query_url` | 9 |
| `scripts/pdq_probe.py` | one synthetic `QBP^Q22` over MLLP, the reply summarised (the walk) | 10 |
| `tests/label_fit_cases.json` | the fit-case table both sides read | 3 |
| `tests/test_migration_0015_protocol.py` | the chain, the CHECKs, the partial unique index, parity, round trip | 1 |
| `tests/test_protocol_numbers.py` | the counter on Postgres | 2 |
| `tests/test_protocol_settings.py` | the fit rule and the settings routes | 3 |
| `tests/test_protocol_admission.py` | the admit path under the protocol | 4 |
| `tests/test_protocol_board_key.py` | sign-off, discharge, lists, release, own patients, break-glass | 5 |
| `tests/test_admission_label.py` | the label route | 6 |
| `tests/test_edge_patient_query.py` | the device route | 7 |
| `tests/test_edge_pdq_client.py` | the bridge's API client | 9 |
| `tests/test_edge_bridge_query.py` | API first, mirror, echo, forget, counters, the no-stall test | 9, 10 |
| `tests/test_pdq_probe.py` | the probe's query and its name-free summary | 10 |

**Modify — engine**

| File | Change | Task |
|---|---|---|
| `src/homunculus/admission/models.py` | `Admission.protocol_no`, `PROTOCOL_INDEX`, the CHECK | 1 |
| `alembic/env.py`, `tests/conftest.py`, `scripts/dev_local.py` | import `homunculus.protocol.models` | 1 |
| `src/homunculus/admission/errors.py`, `tests/test_admission_form.py` | the `# G2-B1d` block; the `CODES` pin | 2 |
| `src/homunculus/api/app.py` **(Lane A review)** | two include lines beside `infinity_research_router` | 3, 7 |
| `tests/test_route_permissions.py` | `homunculus.protocol.router` guarded; three rows; 59 → 62 | 3, 6 |
| `src/homunculus/admission/schemas.py` | `protocol_no`; `board_key`; `AdmissionDetail`; `LabelAsk`, `LabelResponse` | 4, 5, 6 |
| `src/homunculus/admission/service.py` | `create_draft_admission(…, protocol_no=)` | 4 |
| `src/homunculus/admission/router.py` | the protocol issued; every board call under the key; the label route | 4, 5, 6 |
| `tests/kabul_world.py`, `tests/test_tenant_isolation.py` | a `protocol_settings` row per world; `BY_ID` label row; `DEVICE_ONLY` | 4, 6, 7 |
| `tests/test_admission_api.py`, `tests/test_discharge_api.py` | card-key uses read `board_key` | 4, 5 |
| `src/homunculus/tenant/router.py` | `_last_card_off` under the key (E3) | 5 |
| `src/homunculus/scope/service.py`, `scope/resolver.py`, `tests/test_scope_role_from_groups.py` | own patients and break-glass by the key (D9) | 5 |
| `tests/test_kabul_boardlink.py` | the strip links a protocol-keyed card | 5 |
| `tests/test_nginx_routes.py` | `/edge` not proxied | 7 |
| `src/homunculus/edge/pdq.py`, `tests/test_edge_pdq.py` | `NOT_FOUND`: `QAK … NF`, no PID | 8 |
| `src/homunculus/edge/identity.py`, `tests/test_edge_identity_mirror.py` | `forget`; the lock | 8 |
| `src/homunculus/edge/bridge.py` | `query`; `answer_query` API → mirror → echo; three counters | 9 |
| `src/homunculus/edge/mllp.py`, `tests/test_edge_mllp.py` | the responder through `asyncio.to_thread` | 10 |
| `scripts/run_bridge.py`, `tests/test_run_bridge_identity.py` | the client from `--cloud-url` + `--token`; the report line | 10 |

**Create — dashboard** (`dashboard/src/live/`)

| File | Responsibility | Task |
|---|---|---|
| `i18n/strings/protokol.js` | every text of the slice, four languages | 12 |
| `screens/kabul/boardKey.js` (+ test) | `boardKeyOf(row)` | 13 |
| `screens/kabul/label/code128c.js` (+ test) | Code 128-C values, bars, SVG | 13 |
| `screens/kabul/label/protocolLabel.js` (+ test) | the fit rule, the lines, the HTML, the print | 13 |
| `screens/kabul/label/PrintLabelButton.jsx` (+ test) | «Etiketi yazdır» / «yeniden yazdır»: window first, then the route | 13, 16 |
| `screens/admin/ProtocolTab.jsx` (+ test) | Yönetim › Protokol ve etiket | 14 |
| `screens/kabul/label/LabelReprint.jsx` (+ test) | the patient screen's reprint | 16 |

**Modify — dashboard**

| File | Change | Task |
|---|---|---|
| `src/live/i18n/catalog.js`, `src/live/i18n/strings.test.js` | the `protokol` namespace; reviewed entries | 12 |
| `src/live/apiErrors.js` (+ test) | the eight codes | 12 |
| `src/backendApi.js` (+ test), `src/live/session/testTokens.testutil.js` | three methods; `board_key` on `err.patientNumber` | 12 |
| `src/live/screens/kabul/AdmitTab.jsx` (+ test) | the protocol box; the print button; the key | 13 |
| `src/live/screens/admin/AdminScreen.jsx` (+ test) | the TABS seam `// G2-B1d` | 14 |
| `src/live/screens/beds/BedsScreen.jsx`, `kabul/DischargeTab.jsx`, `kabul/SignOffStrip.jsx` (+ tests) | `boardKeyOf` | 15 |
| `src/live/screens/patient/PatientScreen.jsx` (+ test) | `<LabelReprint>` under the sign-off strip | 16 |

**Docs** (Task 19): `docs/homunculus-rehber-TR.md`, `docs/EDGE-BRIDGE-LOCAL.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md` §10, this slice's spec "as built" notes. **Outside the repo** (Task 21): `/c/tmp/infinity-a-releases/G2B-B1D-bloklari.txt`, the bundle.

---

## Task order, lanes and parallel work

| Task | Lane | Needs | May run beside | Lane A review |
|---|---|---|---|---|
| 1 migration 0015 and the models | backend | — | 12 | — |
| 2 the `# G2-B1d` codes and `next_protocol_no` | backend | 1 | 12 | — |
| 3 the fit rule, `GET|PUT /admin/protocol-settings` | backend | 2 | 12 | **yes** (`app.py`: one include line) |
| 4 `board_key` and the admit path | backend | 2 | 3, 12 | — |
| 5 every other board call site; E3; D9; the strip | backend | 4 | 12–14 | — |
| 6 `POST /admissions/{id}/label` | backend | 3, 4 | 5, 12–14 | — |
| 7 `POST /edge/patient-query` | backend | — | 1–6, 12–16 | **yes** (`app.py`: one include line; `api/edge_query.py` whole) |
| 8 pdq «not found»; the mirror's `forget` and lock | backend | — | 1–7, 12–16 | told (O72) |
| 9 `pdq_client.py`; `answer_query` API → mirror → echo | backend | 7, 8 | 12–16 | told |
| 10 `serve_mllp` off the loop; `run_bridge` wiring; the probe | backend | 9 | 12–16 | told |
| 11 the backend lane's gate | backend | 1–10 | 12–16 | — |
| 12 strings, the eight codes, the API client | dashboard | **2 on the slice branch** (`apiErrors.test.js` reads `admission/errors.py`) | 3–11 | — |
| 13 `boardKey.js`, Code 128-C, the label, the admit box | dashboard | 12; **3 on the slice branch** (`tests/label_fit_cases.json`) | 4–11 | — |
| 14 Yönetim › Protokol ve etiket | dashboard | 13 | 4–11, 15 | — |
| 15 the key in Yataklar, Taburcu, the sign-off strip | dashboard | 13 | 4–11, 14 | — |
| 16 the patient screen's reprint; the dashboard lane's gate | dashboard | 13–15 | 5–11 | — |
| 17 merge the lanes | — | 11, 16 | — | — |
| 18 gates on the merged branch; the final review | — | 17 | — | — |
| 19 docs | — | 18 (the counts it quotes) | 20 | — |
| 20 the local walk | — | 18 | 19 | — |
| 21 the VM blocks | — | 19, 20 | — | — |
| 22 (conditional) rebase onto main; repoint 0015 | — | the editor on main, or the owner's call | — | — |

**Continuation files.** A file named `task-NN-<part>.md` is NOT a task of its own: it is one step of Task NN, split out of `task-NN.md` for length, and the step in `task-NN.md` names it. Any `-<part>` file says whose step it is in its first line. A task is done when all its files' steps are; it has one commit. The tasks are numbered 1–22, as the table above.

**Why this order.** The schema (1) comes before every reader and writer of it; the codes (2) before every route that refuses with them, and before the dashboard's map, which reads `errors.py`. The settings routes (3) and the admit path (4) both need the counter (2); the admit path comes before the other call sites (5), which reuse its `board_key` and its tests' worlds; the label route (6) needs the settings row (3) and an admission with a protocol (4). The device route (7) needs nothing of 1–6 (it reads the identity store, which the admission already writes under the card key) and comes before the bridge's client (9), whose stub mirrors its answers; the pdq outcome and the mirror's `forget` (8) come before the bridge that uses them (9), and the bridge before `serve_mllp`'s thread and its no-stall test (10). On the dashboard, the strings and the codes come first (every test reads them), the encoder and the label with their first consumer, the admit box (13 — a module lands with the module that imports it, `reachable.test.js`), then the admin tab (14), the key matching (15) and the reprint (16).

## The shapes the dashboard builds against (pinned; Tasks 4–7 make them true)

```text
POST /admissions                     201 (or 200: the same form again, A-19)
  → { …AdmissionResponse, protocol_no: "202600000001", patient_number: "H2600042",
      board_key: "202600000001", engine: {weight, profile, board} }
GET /admissions                      → [ { …AdmissionResponse, protocol_no, patient_number, board_key,
                                           display_name, bed_label, room_name, unit_name } ]
GET /admissions/{id}                 → { …AdmissionResponse, patient_number, board_key }
(every AdmissionResponse)            gains protocol_no: "202600000001" | null  (null: a legacy admission;
                                     its board_key is its patient_number)
refusal detail (request_conflict, duplicate_open_admission, board_not_cleared)
                                     → { code, message, patient_number?, board_key? }  (both or neither)
GET  /admin/protocol-settings        → { configured: bool, next_no: "202600000001" | null,
                                         last_issued: "202600000000" | null, label_width_mm: 50,
                                         label_height_mm: 30, printer_dpi: 203, updated_at: iso | null }
PUT  /admin/protocol-settings        body { next_no: "202600000001", label_width_mm: 50,
                                            label_height_mm: 30, printer_dpi: 203 } → as GET
                                     refusals: 422 protocol_format | label_dpi | label_size |
                                               label_too_narrow; 409 protocol_not_forward
POST /admissions                     refusals gain 409 protocol_not_configured | protocol_exhausted
POST /admissions/{id}/label          body { reprint: bool } → { protocol_no, display_name,
                                       date_of_birth: "1970-05-05", sex: "female" | "male" | "other" |
                                       "unknown", unit_name, bed_label,
                                       label: { width_mm, height_mm, printer_dpi } }
                                     refusals: 409 no_protocol; 403 out_of_scope; 404
```

## Lane worktrees

**The base.** The slice branch is `feat/g2b-protokol` at this plan's commit, on main `ec66a57` (the spec `c09950c`, its amendments `da9c95b` and `e86835c`, this plan). Check before cutting:

```bash
cd /c/tmp/g2b-protokol
git status --short                                   # clean
git merge-base --is-ancestor ec66a57 HEAD && echo "on ec66a57"   # must print it; else stop and ask
git log --oneline ec66a57..HEAD | cat                # the spec, its amendment, this plan — nothing else
```

```bash
# backend lane (Tasks 1–11)
cd /c/tmp/g2b-protokol
git worktree add -b feat/g2b-b1d-be /c/tmp/g2b-b1d-be feat/g2b-protokol
cmd //c "mklink /J C:\\tmp\\g2b-b1d-be\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
```

```bash
# dashboard lane (Tasks 12–16). Task 12 needs Task 2 on the slice branch, Task 13 Task 3: after
# each has landed on feat/g2b-b1d-be, fast-forward the slice branch to it, then merge the slice
# branch into the dashboard lane.
cd /c/tmp/g2b-protokol
git worktree add -b feat/g2b-b1d-fe /c/tmp/g2b-b1d-fe feat/g2b-protokol
cmd //c "mklink /J C:\\tmp\\g2b-b1d-fe\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
# after Task 2 (and again after Task 3):
git -C /c/tmp/g2b-protokol merge --ff-only feat/g2b-b1d-be
git -C /c/tmp/g2b-b1d-fe merge --no-edit feat/g2b-protokol
```

**The baseline** (once, in each lane worktree before its first task; write the numbers into the first commit body of the lane):

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no failure in either (main `ec66a57`: engine 2830 passed / 823 skipped, dashboard 104 files / 2972 tests). A failure here is not this slice's: stop and report it before Task 1 or 12.

**Who touches what.** The dashboard lane touches no engine file; the backend lane touches no dashboard file. `tests/test_route_permissions.py`, `tests/test_tenant_isolation.py` and `tests/test_nginx_routes.py` are the backend lane's alone. Shared seams that a later slice extends are blank-separated blocks marked `// G2-B1d` (`i18n/catalog.js`, `strings.test.js`'s sets, `AdminScreen.jsx`'s import, `TABS` and `TAB_SCREENS`, `testTokens.testutil.js`) and `# G2-B1d` (`admission/errors.py`), as B1a's `// G2-B1a` blocks: do not tidy the gaps away.

**Merge order.** The backend lane first (`git -C /c/tmp/g2b-protokol merge --ff-only feat/g2b-b1d-be`), then the dashboard lane (`git -C /c/tmp/g2b-protokol merge --no-ff feat/g2b-b1d-fe -m "merge: G2-B1d protokol, dashboard lane"`). Tasks 18–21 run on the merged `feat/g2b-protokol` in `/c/tmp/g2b-protokol`. Removing a lane worktree: **unlink the junction first** (`cmd //c "rmdir C:\\tmp\\g2b-b1d-fe\\dashboard\\node_modules"`), then `git worktree remove --force /c/tmp/g2b-b1d-fe`, then `git branch -d feat/g2b-b1d-fe` — a recursive delete that follows the junction empties the shared install. The same for `g2b-b1d-be`.

## Lane A coordination (the agreed regions)

| File | This slice's change | Lane A's own, untouched |
|---|---|---|
| `api/app.py` | the import of `protocol.router` and of `edge_query_router`, and two `include_router` lines, after `app.include_router(infinity_research_router)` (`:621`) — beside the editor's `device_beds_router` line once both are on main (Lane B's answer 4). A4 edits the SOFA routes (~`:1440-1660`), the bounds slice the lifespan's `finally`: no overlap (Lane A's answer 8) | every route, `_caller`, `_occupants` |
| `api/edge_query.py` | new; reads `patient_identity.is_tombstone` and the store's `get`, changes neither; any exception of either → 503 (Lane A's answer 7) | `api/patient_identity.py` |
| `edge/*` (NCE path) | `pdq.py`, `identity.py`, `bridge.py`, `mllp.py`, new `pdq_client.py`; `scripts/run_bridge.py` | every `edge/infinity_*` file |

---

### Task 1: Migration 0015 `protocol`, `ProtocolSettings` and `Admission.protocol_no`

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** nothing.

Spec §3 (data), D1, D5, D7, E1, E10. Purely additive: one table (`protocol_settings`, one row per tenant, none written here — D5: no number until the administrator sets one), one nullable column on `admissions` with a CHECK and a partial unique index. Rows already in `admissions` stay NULL: a legacy admission keeps its H-number key (D7). The tests run the real chain (`clean_db`, never `create_all`), as `test_migration_0012_kabul.py`.

**Files:**
- Create: `homunculus-engine/tests/test_migration_0015_protocol.py`
- Create: `homunculus-engine/src/homunculus/protocol/__init__.py`
- Create: `homunculus-engine/src/homunculus/protocol/models.py`
- Modify: `homunculus-engine/src/homunculus/admission/models.py`
- Create: `homunculus-engine/alembic/versions/0015_protocol.py`
- Modify: `homunculus-engine/alembic/env.py`
- Modify: `homunculus-engine/tests/conftest.py`
- Modify: `homunculus-engine/scripts/dev_local.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_migration_0015_protocol.py`:

```python
# homunculus-engine/tests/test_migration_0015_protocol.py
"""Migration 0015 (G2-B1d, spec §3) on the real chain (`clean_db`, never `create_all`): purely
additive — `protocol_settings` (one row per tenant, none written by the migration: no admission
until the administrator sets the start number, D5) and `admissions.protocol_no`, which every row
written before it keeps NULL (D7: a legacy admission keeps its H-number key). Twelve ASCII digits
or NULL (a CHECK); one number per tenant, NULLs never colliding (a partial unique index); the dpi
203 or 300; the settings go with their tenant. The model agrees with the migration; 0013 → 0015 →
0013 → 0015 runs. Synthetic rows only."""
from __future__ import annotations

import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
SETTINGS = "protocol_settings"
INDEX = "uq_admissions_tenant_protocol"
CHECK = "ck_admissions_protocol_no"


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    return bed


def _admission(conn, tenant: uuid.UUID, bed: uuid.UUID, number: str, **columns) -> uuid.UUID:
    """A patient with its H-number and one DISCHARGED admission on `bed` (a closed state: the bed
    holds any number of them), with the other columns named."""
    patient, admission = uuid.uuid4(), uuid.uuid4()
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                      "patient_number, created_at) VALUES (:id, :t, 'x', 'x', 'x', :n, now())"),
                 {"id": patient, "t": tenant, "n": number})
    names = "".join(f", {name}" for name in columns)
    values = "".join(f", :{name}" for name in columns)
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
        f"admitting_unit_id, bed_id, admission_diagnosis_free_text{names}) "
        f"SELECT :id, :p, :t, 'DISCHARGED', now(), r.unit_id, b.id, 'Sentetik tanı'{values} "
        "FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = :b"),
        {"id": admission, "p": patient, "t": tenant, "b": bed, **columns})
    return admission


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_0015_adds_the_settings_and_the_column_and_writes_no_row(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0013")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        legacy = _admission(conn, tenant, _bed(conn, tenant), "H2600001")
    command.upgrade(cfg, "0015")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT protocol_no FROM admissions WHERE id = :id"),
                            {"id": legacy}).scalar_one() is None              # D7: legacy stays
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0   # D5
    assert "protocol_no" in _columns(engine, "admissions")
    command.downgrade(cfg, "0013")
    assert "protocol_no" not in _columns(engine, "admissions")
    assert SETTINGS not in inspect(engine).get_table_names()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"
        assert conn.execute(text("SELECT count(*) FROM admissions")).scalar_one() == 1


def test_one_protocol_number_per_tenant_and_nulls_never_collide(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        bed_a, bed_b = _bed(conn, a), _bed(conn, b)
        _admission(conn, a, bed_a, "H2600001", protocol_no="202600000001")
        _admission(conn, a, bed_a, "H2600002")                      # NULL
        _admission(conn, a, bed_a, "H2600003")                      # NULL again: no collision
        _admission(conn, b, bed_b, "H2600001", protocol_no="202600000001")   # another tenant
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _admission(conn, a, bed_a, "H2600004", protocol_no="202600000001")


@pytest.mark.parametrize("value", [
    "20260000001",            # eleven digits
    "20260000000A",           # a letter
    "2026 0000001",           # a space
    "２０２６００００００１",  # twelve full-width digits: digits to Unicode, not to the device
    "",
])
def test_a_protocol_number_is_twelve_ascii_digits(clean_db, value):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        bed = _bed(conn, tenant)
    with pytest.raises(DBAPIError, match=CHECK), engine.begin() as conn:
        _admission(conn, tenant, bed, "H2600001", protocol_no=value)


def test_settings_default_to_a_50_by_30_label_at_203_dpi_and_take_no_other_dpi(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        conn.execute(text(f"INSERT INTO {SETTINGS} (tenant_id) VALUES (:t)"), {"t": tenant})
        row = conn.execute(text(f"SELECT next_no, last_issued, label_width_mm, label_height_mm, "
                                f"printer_dpi, updated_at IS NOT NULL FROM {SETTINGS}")).one()
    assert tuple(row) == (None, None, 50, 30, 203, True)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text(f"UPDATE {SETTINGS} SET printer_dpi = 600"))
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE {SETTINGS} SET printer_dpi = 300, next_no = 202600000001"))
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant})
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0   # CASCADE


def test_the_model_and_the_migration_agree_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0013")
    command.upgrade(cfg, "0015")

    def only_0015(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in {SETTINGS, "admissions"}
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == SETTINGS or (table == "admissions" and name == "protocol_no")
        if type_ == "index":
            return name == INDEX
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0015})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: both are read here, by name.
        checks = set(conn.execute(text(
            "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname IN "
            "('ck_admissions_protocol_no', 'ck_protocol_settings_dpi')")).scalars())
    assert checks == {CHECK, "ck_protocol_settings_dpi"}
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0015_protocol.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.protocol'` (collection error).

- [ ] **Step 3: The models.** **Write** `homunculus-engine/src/homunculus/protocol/__init__.py`:

```python
"""The protocol number Homunculus issues each admission, and its label (Group 2 · B1d; spec
2026-11-01-g2b-b1d-protokol-barkod-design.md)."""
```

**Write** `homunculus-engine/src/homunculus/protocol/models.py`:

```python
# homunculus-engine/src/homunculus/protocol/models.py
"""`protocol_settings` (migration 0015): per tenant, the next protocol number and the label.

* `next_no`      the number the next admission receives; NULL = not configured (spec D5): every
                 admission is refused `protocol_not_configured` until the administrator sets it.
* `last_issued`  the last number given out; NULL = none yet. `next_protocol_no` moves both in one
                 UPDATE inside the admission's transaction (protocol/numbers.py).
* the label      width and height in whole millimetres, the printer's resolution (203 or 300 dpi).

No patient data. The numbers are BIGINT; their text form is twelve zero-padded digits."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, SmallInteger, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.db import Base

#: The printer resolutions a label is drawn for (spec D6, D10).
PRINTER_DPIS = (203, 300)


class ProtocolSettings(Base):
    __tablename__ = "protocol_settings"
    __table_args__ = (
        CheckConstraint("printer_dpi IN (203, 300)", name="ck_protocol_settings_dpi"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    next_no: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_issued: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    label_width_mm: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50,
                                                server_default=text("50"))
    label_height_mm: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=30,
                                                 server_default=text("30"))
    printer_dpi: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=203,
                                             server_default=text("203"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (1) — replace:

```python
from sqlalchemy import (
    Boolean, Date, DateTime, Enum, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
```

with:

```python
from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Enum, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (2) — replace:

```python
_OPEN_STATE = text("state IN ({})".format(", ".join(
    f"'{state.value}'" for state in AdmissionState if state in OPEN_ADMISSION_STATES)))
```

with:

```python
_OPEN_STATE = text("state IN ({})".format(", ".join(
    f"'{state.value}'" for state in AdmissionState if state in OPEN_ADMISSION_STATES)))

#: G2-B1d (migration 0015): one protocol number per tenant; the admissions before 0015 (NULL) never
#: collide. Twelve ASCII digits — `[0-9]`, never `\d`, which takes any script's digits.
PROTOCOL_INDEX = "uq_admissions_tenant_protocol"
_HAS_PROTOCOL = text("protocol_no IS NOT NULL")
PROTOCOL_FORMAT_CHECK = "protocol_no ~ '^[0-9]{12}$'"
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (3) — replace:

```python
    identity_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # --- Workflow bookkeeping ---
```

with:

```python
    identity_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Group 2 · B1d (spec D1, D7, §3): the protocol number Homunculus issued this admission — the
    # board key of a new admission (`admission/boardkey.py`), what the nurse enters or scans on the
    # bedside device, what the label prints. In the clear: it is a key, as `Patient.patient_number`
    # is. NULL on an admission opened before 0015, which keeps its H-number key until discharge.
    protocol_no: Mapped[str | None] = mapped_column(String(12), nullable=True)

    # --- Workflow bookkeeping ---
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (4) — replace:

```python
        Index(OPEN_IDENTITY_INDEX, "tenant_id", "identity_digest", unique=True,
              postgresql_where=_OPEN_STATE, sqlite_where=_OPEN_STATE),
    )
```

with:

```python
        Index(OPEN_IDENTITY_INDEX, "tenant_id", "identity_digest", unique=True,
              postgresql_where=_OPEN_STATE, sqlite_where=_OPEN_STATE),
        Index(PROTOCOL_INDEX, "tenant_id", "protocol_no", unique=True,
              postgresql_where=_HAS_PROTOCOL, sqlite_where=_HAS_PROTOCOL),
        # Postgres's `~`: scripts/dev_local.py builds these models on SQLite, which cannot parse it
        # (E10). The migration creates it unconditionally.
        CheckConstraint(PROTOCOL_FORMAT_CHECK,
                        name="ck_admissions_protocol_no").ddl_if(dialect="postgresql"),
    )
```

(Check the replaced text is the `Admission.__table_args__` tuple: `grep -n "OPEN_IDENTITY_INDEX, \"tenant_id\"" src/homunculus/admission/models.py` gives one line.)

- [ ] **Step 4: Register the model where the schema is built.**

**Edit** `homunculus-engine/tests/conftest.py` — replace:

```python
import homunculus.escalation.models  # noqa: E402,F401
from homunculus.db import Base  # noqa: E402
```

with:

```python
import homunculus.escalation.models  # noqa: E402,F401
import homunculus.protocol.models  # noqa: E402,F401  (G2-B1d: protocol_settings)
from homunculus.db import Base  # noqa: E402
```

**Edit** `homunculus-engine/alembic/env.py` — replace:

```python
import homunculus.scope.models  # noqa: F401
```

with:

```python
import homunculus.scope.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401  (G2-B1d, migration 0015)
```

**Edit** `homunculus-engine/scripts/dev_local.py` — replace:

```python
    import homunculus.escalation.models         # noqa: F401
    import homunculus.tenant.models             # noqa: F401
```

with:

```python
    import homunculus.escalation.models         # noqa: F401
    import homunculus.protocol.models           # noqa: F401  (G2-B1d: protocol_settings)
    import homunculus.tenant.models             # noqa: F401
```

- [ ] **Step 5: Red again, for the migration:** the Step 2 command — `Can't locate revision identified by '0015'` (or `KeyError: '0015'`).

- [ ] **Step 6: The migration.** **Write** `homunculus-engine/alembic/versions/0015_protocol.py`:

```python
# homunculus-engine/alembic/versions/0015_protocol.py
"""G2-B1d (spec 2026-11-01 §3): `protocol_settings`, and `admissions.protocol_no`

Revision 0015, follows 0013 (E1: the editor's 0014 is not on main yet; when it lands, this file's
`down_revision` becomes "0014" before main or the VM — never a fork in the chain).

* `protocol_settings`: one row per tenant (FK tenants ON DELETE CASCADE) — `next_no` and
  `last_issued` (BIGINT, NULL = not configured / none issued), `label_width_mm` 50,
  `label_height_mm` 30, `printer_dpi` 203 (CHECK 203 or 300), `updated_at`, `updated_by`. NO ROW
  is written: no admission is possible until the administrator sets the start number (D5).
* `admissions.protocol_no`: VARCHAR(12) NULL, CHECK twelve ASCII digits, and the partial unique
  index `uq_admissions_tenant_protocol` on (tenant_id, protocol_no) WHERE NOT NULL. Every row
  already written stays NULL: a legacy admission keeps its H-number key (D7).

PURELY ADDITIVE: an image from before this revision serves against it (it never reads the new
objects); only its start command's `alembic upgrade head` refuses the unknown revision.
Downgrade drops exactly this — and with it every protocol number issued (spec §11: clean only
before the first protocol admission).

Revision ID: 0015
Revises: 0013
Create Date: 2026-11-01
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0015"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "protocol_settings"
INDEX = "uq_admissions_tenant_protocol"
CHECK = "ck_admissions_protocol_no"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("next_no", sa.BigInteger(), nullable=True),
        sa.Column("last_issued", sa.BigInteger(), nullable=True),
        sa.Column("label_width_mm", sa.SmallInteger(), nullable=False, server_default=sa.text("50")),
        sa.Column("label_height_mm", sa.SmallInteger(), nullable=False, server_default=sa.text("30")),
        sa.Column("printer_dpi", sa.SmallInteger(), nullable=False, server_default=sa.text("203")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("printer_dpi IN (203, 300)", name="ck_protocol_settings_dpi"),
    )
    op.add_column("admissions", sa.Column("protocol_no", sa.String(12), nullable=True))
    op.create_check_constraint(CHECK, "admissions", "protocol_no ~ '^[0-9]{12}$'")
    op.create_index(INDEX, "admissions", ["tenant_id", "protocol_no"], unique=True,
                    postgresql_where=sa.text("protocol_no IS NOT NULL"))


def downgrade() -> None:
    op.drop_index(INDEX, table_name="admissions")
    op.drop_constraint(CHECK, "admissions", type_="check")
    op.drop_column("admissions", "protocol_no")
    op.drop_table(TABLE)
```

- [ ] **Step 7: Green**, with the one-statement check and 0012's parity test beside it (0012's test runs `upgrade head` and must not see 0015's objects as its own):

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0015_protocol.py tests/test_migration_0012_kabul.py tests/test_audit_postgres.py::test_no_migration_passes_multiple_statements_to_one_execute tests/test_auth_models.py tests/test_seed_test_users.py 2>&1 | tail -3
```

Expected: all passed — the new file's 9 (5 parametrised), 0012's, the one-statement check. If `compare_metadata` reports the partial index's `postgresql_where` as a difference, read the diff: it must be text only (`protocol_no IS NOT NULL` vs `(protocol_no IS NOT NULL)`); then compare that index by `pg_indexes.indexdef` in the test instead, and record it as E16.

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_migration_0015_protocol.py homunculus-engine/src/homunculus/protocol/__init__.py homunculus-engine/src/homunculus/protocol/models.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/alembic/versions/0015_protocol.py homunculus-engine/alembic/env.py homunculus-engine/tests/conftest.py homunculus-engine/scripts/dev_local.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_migration_0015_protocol.py homunculus-engine/src/homunculus/protocol/__init__.py homunculus-engine/src/homunculus/protocol/models.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/alembic/versions/0015_protocol.py homunculus-engine/alembic/env.py homunculus-engine/tests/conftest.py homunculus-engine/scripts/dev_local.py <<'EOF'
feat(protocol): migration 0015 — protocol_settings per tenant and admissions.protocol_no, twelve digits, one per tenant

Purely additive (spec §3): the settings table writes no row (D5: no admission until the start
number is set); every admission already written keeps a NULL protocol and its H-number key (D7).
The CHECK is Postgres's `~`, kept out of SQLite's create_all (E10). down_revision "0013" until the
editor's 0014 reaches main (E1).

red: collection error — No module named 'homunculus.protocol'; then Can't locate revision '0015'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The `# G2-B1d` codes and `next_protocol_no`

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Task 1. **Unblocks:** Task 12 (the dashboard's map reads `errors.py`): after this commit, fast-forward the slice branch to the backend lane (`deps.md`).

Spec §3 (issuing), §7, D1, D3, D5, E15. The counter is `admission/numbers.py`'s pattern: one `UPDATE … RETURNING` inside the admission's own transaction, so the row lock lasts until the admission commits or rolls back — two admissions never share a number, a refused one gives its number back, the sequence has no gaps. `UPDATE protocol_settings SET last_issued = next_no, next_no = next_no + 1` reads both right-hand sides from the row as it was (Postgres evaluates every `SET` against the old row), so `last_issued` becomes the number issued.

**Files:**
- Modify: `homunculus-engine/tests/test_admission_form.py`
- Modify: `homunculus-engine/src/homunculus/admission/errors.py`
- Create: `homunculus-engine/tests/test_protocol_numbers.py`
- Create: `homunculus-engine/src/homunculus/protocol/numbers.py`

- [ ] **Step 1: Write the failing tests.**

**Edit** `homunculus-engine/tests/test_admission_form.py` — replace:

```python
                     "bed_label_taken", "request_conflict", "board_not_cleared",
                     "transfer_unavailable", "duplicate_open_admission"}
```

with:

```python
                     "bed_label_taken", "request_conflict", "board_not_cleared",
                     "transfer_unavailable", "duplicate_open_admission",
                     # G2-B1d (spec §7)
                     "protocol_not_configured", "protocol_exhausted", "protocol_format",
                     "protocol_not_forward", "label_size", "label_too_narrow", "label_dpi",
                     "no_protocol"}
```

**Write** `homunculus-engine/tests/test_protocol_numbers.py`:

```python
# homunculus-engine/tests/test_protocol_numbers.py
"""The protocol number (G2-B1d, spec §3, D1, D3, D5): twelve digits, all of them sequence, taken
under the settings row's lock inside the admission's transaction — two admissions at once get two
consecutive numbers, a rolled-back one gives its number back, a tenant with no start number is
refused `protocol_not_configured`, and past 999 999 999 999 `protocol_exhausted`. The format
tests need no database; the rest run on Postgres (`db_session`). Synthetic tenants only."""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.errors import PROTOCOL_EXHAUSTED, PROTOCOL_NOT_CONFIGURED, Refusal
from homunculus.protocol.models import ProtocolSettings
from homunculus.protocol.numbers import (
    PROTOCOL_MAX, format_protocol_no, next_protocol_no, parse_protocol_no,
)
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db


def test_a_protocol_number_is_twelve_zero_padded_digits():
    assert format_protocol_no(202600000001) == "202600000001"
    assert format_protocol_no(1) == "000000000001"
    assert format_protocol_no(PROTOCOL_MAX) == "999999999999"


@pytest.mark.parametrize("text, number", [("202600000001", 202600000001), ("000000000000", 0)])
def test_twelve_ascii_digits_read_as_their_number(text, number):
    assert parse_protocol_no(text) == number


@pytest.mark.parametrize("text", ["20260000001", "2026000000012", "20260000000A", " 202600000001",
                                  "２０２６００００００１", "", None, 202600000001])
def test_anything_else_is_not_a_protocol_number(text):
    assert parse_protocol_no(text) is None


async def _tenant(db, slug: str, next_no: int | None = None, *, settings: bool = True) -> Tenant:
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
    db.add(tenant)
    await db.flush()
    if settings:
        db.add(ProtocolSettings(tenant_id=tenant.id, next_no=next_no))
    await db.commit()
    return tenant


async def _row(db, tenant: Tenant) -> tuple[int | None, int | None]:
    db.expire_all()
    row = (await db.execute(select(ProtocolSettings.next_no, ProtocolSettings.last_issued)
                            .where(ProtocolSettings.tenant_id == tenant.id))).one()
    return tuple(row)


@requires_db
async def test_numbers_follow_each_other_from_the_start_the_administrator_set(db_session):
    a = await _tenant(db_session, "hastane-a", 202600000001)
    got = [await next_protocol_no(db_session, a.id) for _ in range(3)]
    assert got == ["202600000001", "202600000002", "202600000003"]
    await db_session.commit()
    assert await _row(db_session, a) == (202600000004, 202600000003)


@requires_db
async def test_each_tenant_has_its_own_sequence(db_session):
    a = await _tenant(db_session, "hastane-a", 202600000001)
    b = await _tenant(db_session, "hastane-b", 500000000000)
    assert await next_protocol_no(db_session, a.id) == "202600000001"
    assert await next_protocol_no(db_session, b.id) == "500000000000"
    assert await next_protocol_no(db_session, a.id) == "202600000002"


@requires_db
@pytest.mark.parametrize("settings", [False, True], ids=["no row", "next_no NULL"])
async def test_without_a_start_number_no_admission_takes_one(db_session, settings):
    """D5: a number range Homunculus picked by itself could collide with the old HBYS's."""
    a = await _tenant(db_session, "hastane-a", None, settings=settings)
    with pytest.raises(Refusal) as refused:
        await next_protocol_no(db_session, a.id)
    assert (refused.value.status, refused.value.code) == (409, PROTOCOL_NOT_CONFIGURED)


@requires_db
async def test_past_the_last_twelve_digit_number_the_admission_is_refused_and_gives_it_back(db_session):
    a = await _tenant(db_session, "hastane-a", PROTOCOL_MAX)
    assert await next_protocol_no(db_session, a.id) == "999999999999"
    await db_session.commit()
    with pytest.raises(Refusal) as refused:
        await next_protocol_no(db_session, a.id)
    assert (refused.value.status, refused.value.code) == (409, PROTOCOL_EXHAUSTED)
    await db_session.rollback()        # what the route's session does with a refused admission
    assert await _row(db_session, a) == (PROTOCOL_MAX + 1, PROTOCOL_MAX)


@requires_db
async def test_a_rolled_back_admission_gives_its_number_back(db_session):
    a = await _tenant(db_session, "hastane-a", 202600000001)
    assert await next_protocol_no(db_session, a.id) == "202600000001"
    await db_session.rollback()
    assert await next_protocol_no(db_session, a.id) == "202600000001"


@requires_db
async def test_two_admissions_at_once_get_two_consecutive_numbers(db_session):
    """Two sessions, two connections: the second waits on the settings row until the first
    commits, then takes the next number — never the same one."""
    a = await _tenant(db_session, "hastane-a", 202600000041)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    first_has_one = asyncio.Event()

    async def first():
        async with maker() as db:
            number = await next_protocol_no(db, a.id)
            first_has_one.set()
            await asyncio.sleep(0.3)        # hold the row lock while the second one asks
            await db.commit()
            return number

    async def second():
        await first_has_one.wait()
        async with maker() as db:
            number = await next_protocol_no(db, a.id)
            await db.commit()
            return number

    assert sorted(await asyncio.gather(first(), second())) == ["202600000041", "202600000042"]
    assert await _row(db_session, a) == (202600000043, 202600000042)
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_numbers.py tests/test_admission_form.py::test_every_other_refusal_has_a_stable_code 2>&1 | tail -3
```

Expected: `ImportError: cannot import name 'PROTOCOL_EXHAUSTED' from 'homunculus.admission.errors'` (collection error of the new file) and `FAILED …test_every_other_refusal_has_a_stable_code`.

- [ ] **Step 3: The codes.** **Edit** `homunculus-engine/src/homunculus/admission/errors.py` — replace:

```python
    BED_LABEL_TAKEN, REQUEST_CONFLICT, BOARD_NOT_CLEARED, TRANSFER_UNAVAILABLE,
    DUPLICATE_OPEN_ADMISSION,
})
```

with:

```python
    BED_LABEL_TAKEN, REQUEST_CONFLICT, BOARD_NOT_CLEARED, TRANSFER_UNAVAILABLE,
    DUPLICATE_OPEN_ADMISSION,
})

# G2-B1d — the protocol number and its label (spec 2026-11-01 §7). Its own block AFTER `CODES`,
# which it widens: the monitor→bed editor's block sits inside `CODES`, and two hunks with untouched
# lines between them merge without a conflict (E15).
PROTOCOL_NOT_CONFIGURED = "protocol_not_configured"   # no start number set: no admission (D5)
PROTOCOL_EXHAUSTED = "protocol_exhausted"             # the sequence passed 999 999 999 999
PROTOCOL_FORMAT = "protocol_format"                   # a start number that is not twelve digits
PROTOCOL_NOT_FORWARD = "protocol_not_forward"         # a start number not above the last issued
LABEL_SIZE = "label_size"                             # width 30–110 mm, height 20–80 mm
LABEL_TOO_NARROW = "label_too_narrow"                 # the barcode does not fit that width
LABEL_DPI = "label_dpi"                               # the printer is 203 or 300 dpi
NO_PROTOCOL = "no_protocol"                           # an admission without a protocol: no label

CODES = CODES | frozenset({
    PROTOCOL_NOT_CONFIGURED, PROTOCOL_EXHAUSTED, PROTOCOL_FORMAT, PROTOCOL_NOT_FORWARD,
    LABEL_SIZE, LABEL_TOO_NARROW, LABEL_DPI, NO_PROTOCOL,
})
```

- [ ] **Step 4: The counter.** **Write** `homunculus-engine/src/homunculus/protocol/numbers.py`:

```python
# homunculus-engine/src/homunculus/protocol/numbers.py
"""The protocol number (Group 2 · B1d, spec D1, D3, D5 and §3).

Twelve digits, all of them sequence, no check digit (D3): a single mistyped digit can give a
neighbour's valid number, so the name the device shows is the only safeguard — a found number is
always answered with the name (api/edge_query.py). One sequence per tenant, started where the
administrator says (`protocol_settings.next_no`, D5) and only ever moved forward.

It is taken with one UPDATE … RETURNING inside the admission's own transaction, as
admission/numbers.py takes the H-number: the settings row stays locked until that transaction ends,
so two admissions never share a number, and an admission that is refused or rolled back gives its
number back — the sequence has no gaps. Every admission takes this lock BEFORE the H-number's
counter, in that one order, so two admissions never wait on each other in a circle.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import PROTOCOL_EXHAUSTED, PROTOCOL_NOT_CONFIGURED, Refusal
from homunculus.protocol.models import ProtocolSettings

PROTOCOL_MAX = 999_999_999_999
#: Twelve ASCII digits — never `\d`, which takes any script's digits; the device sends ASCII.
_TWELVE = re.compile(r"[0-9]{12}")


def format_protocol_no(number: int) -> str:
    """The number on twelve digits, zero-padded."""
    return f"{number:012d}"


def parse_protocol_no(text: object) -> int | None:
    """The number twelve ASCII digits spell, or None for anything else (a string of another length,
    another script's digits, white space, not a string at all)."""
    if not isinstance(text, str) or not _TWELVE.fullmatch(text):
        return None
    return int(text)


async def next_protocol_no(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The tenant's next protocol number. Call it inside the transaction that writes the admission:
    the settings row stays locked until that transaction commits or rolls back.

    No row, or no start number (`next_no` NULL): 409 `protocol_not_configured` (D5). A number past
    `PROTOCOL_MAX`: 409 `protocol_exhausted`, and the caller's rollback gives the row back as it
    was."""
    issued = (await db.execute(
        update(ProtocolSettings)
        .where(ProtocolSettings.tenant_id == tenant_id, ProtocolSettings.next_no.is_not(None))
        .values(last_issued=ProtocolSettings.next_no, next_no=ProtocolSettings.next_no + 1)
        .returning(ProtocolSettings.last_issued)
        .execution_options(synchronize_session=False)
    )).scalar_one_or_none()
    if issued is None:
        raise Refusal(409, PROTOCOL_NOT_CONFIGURED,
                      "No protocol number start is set: the administrator sets it in "
                      "Administration › Protocol and label before the first admission.")
    if issued > PROTOCOL_MAX:
        raise Refusal(409, PROTOCOL_EXHAUSTED,
                      f"No protocol number is left: {PROTOCOL_MAX} has been issued.")
    return format_protocol_no(issued)
```

- [ ] **Step 5: Green**, with the form tests and the routes' refusal map beside it:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_numbers.py tests/test_admission_form.py tests/test_patient_numbers.py 2>&1 | tail -3
```

Expected: all passed — the new file's 18 (with its parametrised cases).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_admission_form.py homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_protocol_numbers.py homunculus-engine/src/homunculus/protocol/numbers.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_admission_form.py homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_protocol_numbers.py homunculus-engine/src/homunculus/protocol/numbers.py <<'EOF'
feat(protocol): the eight G2-B1d codes and next_protocol_no — twelve digits under the settings row's lock

The counter takes the number inside the admission's transaction (spec §3): two at once get two
consecutive numbers, a refused one gives it back, no start number is protocol_not_configured (D5),
past 999 999 999 999 protocol_exhausted. The codes are a block after CODES (E15).

red: ImportError PROTOCOL_EXHAUSTED; test_every_other_refusal_has_a_stable_code failed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The barcode-fit rule and `GET|PUT /admin/protocol-settings`

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Task 2. **Unblocks:** Task 13 (it reads `tests/label_fit_cases.json`): after this commit, fast-forward the slice branch again. **Lane A review hunk:** `api/app.py`, the three lines Step 6 adds after `app.include_router(infinity_research_router)` — send them to the controller before the merge.

Spec §3 (the setting), D5, D6, D10, D11, E11, E13. `structure.manage`, own tenant (D11). The PUT reads the body first — `protocol_format`, then `label_dpi`, `label_size`, `label_too_narrow` (422) — and only then locks the row and holds `next_no` against `last_issued` (`protocol_not_forward`, 409; lowering towards `last_issued + 1` is allowed, no number is reused either way). The lock makes the forward rule hold against an admission issuing a number at that moment. A tenant's first PUT makes its row (`INSERT … ON CONFLICT DO NOTHING`, then the locked read). Every change is audited `protocol.settings` (who, old/new `next_no`, old/new size and dpi; no patient). The fit rule is ONE function and one case table; the dashboard mirrors it on the same table (Task 13).

**Files:**
- Create: `homunculus-engine/tests/label_fit_cases.json`
- Create: `homunculus-engine/tests/test_protocol_settings.py`
- Create: `homunculus-engine/src/homunculus/protocol/fit.py`
- Create: `homunculus-engine/src/homunculus/protocol/schemas.py`
- Create: `homunculus-engine/src/homunculus/protocol/router.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` **(Lane A review)**
- Modify: `homunculus-engine/tests/test_route_permissions.py`

- [ ] **Step 1: The case table.** **Write** `homunculus-engine/tests/label_fit_cases.json`:

```json
{
  "_about": "G2-B1d spec §3 and E13: the label-size cases, read by homunculus-engine/tests/test_protocol_settings.py and by dashboard/src/live/screens/kabul/label/protocolLabel.test.js. answer null = accepted, else the refusal code, checked in the order label_dpi, label_size, label_too_narrow. The barcode is 121 modules (Code 128-C of 12 digits with its two 10-module quiet zones); a module is 3 dots at 203 dpi and 4 at 300; the width must hold 121 modules and 1.5 mm on each side.",
  "min_width_mm": {"203": 48.4197, "300": 43.9787},
  "cases": [
    {"width_mm": 50, "height_mm": 30, "printer_dpi": 203, "answer": null},
    {"width_mm": 49, "height_mm": 30, "printer_dpi": 203, "answer": null},
    {"width_mm": 48, "height_mm": 30, "printer_dpi": 203, "answer": "label_too_narrow"},
    {"width_mm": 44, "height_mm": 30, "printer_dpi": 300, "answer": null},
    {"width_mm": 43, "height_mm": 30, "printer_dpi": 300, "answer": "label_too_narrow"},
    {"width_mm": 30, "height_mm": 20, "printer_dpi": 203, "answer": "label_too_narrow"},
    {"width_mm": 110, "height_mm": 80, "printer_dpi": 300, "answer": null},
    {"width_mm": 29, "height_mm": 30, "printer_dpi": 203, "answer": "label_size"},
    {"width_mm": 111, "height_mm": 30, "printer_dpi": 203, "answer": "label_size"},
    {"width_mm": 50, "height_mm": 19, "printer_dpi": 203, "answer": "label_size"},
    {"width_mm": 50, "height_mm": 81, "printer_dpi": 203, "answer": "label_size"},
    {"width_mm": 50, "height_mm": 30, "printer_dpi": 600, "answer": "label_dpi"},
    {"width_mm": 50, "height_mm": 30, "printer_dpi": 200, "answer": "label_dpi"},
    {"width_mm": 29, "height_mm": 30, "printer_dpi": 600, "answer": "label_dpi"}
  ]
}
```

- [ ] **Step 2: Write the failing test.** **Write** `homunculus-engine/tests/test_protocol_settings.py`:

```python
# homunculus-engine/tests/test_protocol_settings.py
"""Yönetim › Protokol ve etiket (G2-B1d, spec §3, D5, D6, D10, D11): the barcode-fit rule on the
shared case table (tests/label_fit_cases.json — the dashboard reads the same file), and
GET|PUT /admin/protocol-settings: `structure.manage` in the caller's tenant; twelve digits; the
size, the dpi and the fit refused with their codes; the start number only ever forward of the last
issued; every change audited `protocol.settings` with no patient in it. The rule needs no
database; the routes run on Postgres (tests/kabul_world.py). Synthetic ward only."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update

from homunculus.protocol.fit import label_refusal, min_width_mm, module_mm
from homunculus.protocol.models import ProtocolSettings
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client

TABLE = json.loads((Path(__file__).parent / "label_fit_cases.json").read_text(encoding="utf-8"))
URL = "/admin/protocol-settings"


def body(next_no: str = "202600000001", width: int = 50, height: int = 30, dpi: int = 203) -> dict:
    return {"next_no": next_no, "label_width_mm": width, "label_height_mm": height, "printer_dpi": dpi}


# ---------------------------------------------------------------- the rule (no database)
@pytest.mark.parametrize("case", TABLE["cases"], ids=lambda c: f"{c['width_mm']}x{c['height_mm']}@{c['printer_dpi']}")
def test_every_case_of_the_shared_table(case):
    assert label_refusal(case["width_mm"], case["height_mm"], case["printer_dpi"]) == case["answer"]


def test_a_module_is_whole_printer_dots_and_the_barcode_fits_a_50_mm_label_at_either_dpi():
    """D10: 3 dots at 203 dpi (0.375 mm), 4 at 300 (0.339 mm) — a bar on a dot boundary prints
    crisp. 121 modules and 1.5 mm each side: ≈48.4 mm at 203 dpi, ≈44 mm at 300."""
    assert module_mm(203) == pytest.approx(3 * 25.4 / 203)
    assert module_mm(300) == pytest.approx(4 * 25.4 / 300)
    for dpi, expected in TABLE["min_width_mm"].items():
        assert min_width_mm(int(dpi)) == pytest.approx(expected, abs=1e-3)
    assert min_width_mm(203) < 50 and min_width_mm(300) < 50


# ---------------------------------------------------------------- the routes
@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    # The ward's own row (Task 4 gives every ward a start number) is removed: these tests begin
    # where a tenant begins, with nothing set.
    await db_session.execute(delete(ProtocolSettings))
    await db_session.commit()
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _issued(db_session, w, last: int) -> None:
    """As if admissions had issued numbers up to `last`."""
    await db_session.execute(update(ProtocolSettings).where(ProtocolSettings.tenant_id == w.tenant.id)
                             .values(last_issued=last, next_no=last + 1))
    await db_session.commit()


def _settings_rows(app) -> list:
    return app.state.audit.records(tenant=SLUG, event_type="protocol.settings", limit=50)


@requires_db
async def test_a_tenant_starts_unconfigured_with_a_50_by_30_label_at_203_dpi(ward):
    w, client, _ = ward
    r = await client.get(URL, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {k: v for k, v in r.json().items() if k != "updated_at"} == {
        "configured": False, "next_no": None, "last_issued": None,
        "label_width_mm": 50, "label_height_mm": 30, "printer_dpi": 203}


@requires_db
async def test_the_administrator_sets_the_start_and_the_label_and_it_is_audited(ward, db_session):
    w, client, app = ward
    r = await client.put(URL, json=body(width=60, height=40, dpi=300), headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {k: v for k, v in r.json().items() if k != "updated_at"} == {
        "configured": True, "next_no": "202600000001", "last_issued": None,
        "label_width_mm": 60, "label_height_mm": 40, "printer_dpi": 300}
    assert (await client.get(URL, headers=w.auth["admin"])).json()["next_no"] == "202600000001"
    (row,) = (await db_session.execute(select(ProtocolSettings))).scalars()
    assert (row.tenant_id, row.next_no, row.updated_by) == (w.tenant.id, 202600000001,
                                                             w.users["admin"].id)
    (audit,) = _settings_rows(app)
    assert audit.patient_id == ""
    assert audit.payload == {"actor": "admin@kabul.example.com",
                             "next_no": [None, "202600000001"],
                             "label": [[50, 30, 203], [60, 40, 300]]}


@requires_db
async def test_the_start_moves_only_forward_of_the_last_number_issued(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(), headers=w.auth["admin"])).status_code == 200
    await _issued(db_session, w, 202600000041)
    for back in ("202600000041", "202600000040", "000000000000"):
        r = await client.put(URL, json=body(back), headers=w.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "protocol_not_forward"), back
    db_session.expire_all()
    (row,) = (await db_session.execute(select(ProtocolSettings))).scalars()
    assert (row.next_no, row.last_issued) == (202600000042, 202600000041)       # unchanged
    for ahead in ("300000000000", "202600000042"):          # forward, and back to last + 1
        r = await client.put(URL, json=body(ahead), headers=w.auth["admin"])
        assert (r.status_code, r.json()["next_no"]) == (200, ahead), r.text
    assert len(_settings_rows(app)) == 3                     # the refusals wrote nothing


@requires_db
@pytest.mark.parametrize("sent, code", [
    (body("20260000001"), "protocol_format"),
    (body("20260000000A"), "protocol_format"),
    (body("２０２６００００００１"), "protocol_format"),
    (body("2026000000 1"), "protocol_format"),
    (body(dpi=600), "label_dpi"),
    (body(width=111), "label_size"),
    (body(height=19), "label_size"),
    (body(width=48), "label_too_narrow"),
    (body("x", dpi=600), "protocol_format"),               # the number first (E11)
])
async def test_a_bad_value_is_refused_with_its_code_and_writes_nothing(ward, db_session, sent, code):
    w, client, app = ward
    r = await client.put(URL, json=sent, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, code), r.text
    assert (await db_session.execute(select(func.count()).select_from(ProtocolSettings))).scalar_one() == 0
    assert _settings_rows(app) == []


@requires_db
async def test_a_field_too_many_or_of_the_wrong_type_is_refused(ward):
    w, client, _ = ward
    for sent in ({**body(), "last_issued": "202600000000"}, {**body(), "printer_dpi": "203"},
                 {**body(), "next_no": 202600000001}):
        assert (await client.put(URL, json=sent, headers=w.auth["admin"])).status_code == 422


@requires_db
async def test_only_structure_manage_reads_or_writes_them(ward):
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor"):
        assert (await client.get(URL, headers=w.auth[who])).status_code == 403
        assert (await client.put(URL, json=body(), headers=w.auth[who])).status_code == 403
```

- [ ] **Step 3: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_settings.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.protocol.fit'` (collection error).

- [ ] **Step 4: The rule.** **Write** `homunculus-engine/src/homunculus/protocol/fit.py`:

```python
# homunculus-engine/src/homunculus/protocol/fit.py
"""Whether a label of this size holds the protocol's barcode (G2-B1d, spec §3, D6, D10).

Code 128-C encodes digit pairs: twelve digits are START-C (11 modules), six data symbols (66), the
check symbol (11) and STOP (13) — 101 modules — and a quiet zone of 10 modules on each side: 121
(E13). A module is whole printer dots, so every bar edge falls on a dot: 3 dots at 203 dpi
(0.375 mm), 4 at 300 dpi (0.339 mm). The width must hold the 121 modules and 1.5 mm on each side.

The dashboard mirrors this exactly (screens/kabul/label/protocolLabel.js); one case table pins both
(tests/label_fit_cases.json). The refusals are checked in one order: dpi, size, fit (E11)."""
from __future__ import annotations

from homunculus.admission.errors import LABEL_DPI, LABEL_SIZE, LABEL_TOO_NARROW

MM_PER_INCH = 25.4
DOTS_PER_MODULE = {203: 3, 300: 4}
BARCODE_MODULES = 121
SIDE_MARGIN_MM = 1.5
WIDTH_MM = (30, 110)
HEIGHT_MM = (20, 80)


def module_mm(dpi: int) -> float:
    """One bar module at this resolution, in millimetres."""
    return DOTS_PER_MODULE[dpi] * MM_PER_INCH / dpi


def min_width_mm(dpi: int) -> float:
    """The narrowest label that holds the barcode at this resolution."""
    return BARCODE_MODULES * module_mm(dpi) + 2 * SIDE_MARGIN_MM


def label_refusal(width_mm: int, height_mm: int, dpi: int) -> str | None:
    """None when the label is accepted, else the refusal's code."""
    if isinstance(dpi, bool) or dpi not in DOTS_PER_MODULE:
        return LABEL_DPI
    if not (WIDTH_MM[0] <= width_mm <= WIDTH_MM[1] and HEIGHT_MM[0] <= height_mm <= HEIGHT_MM[1]):
        return LABEL_SIZE
    if width_mm < min_width_mm(dpi):
        return LABEL_TOO_NARROW
    return None
```

- [ ] **Step 5: The routes.** **Write** `homunculus-engine/src/homunculus/protocol/schemas.py`:

```python
# homunculus-engine/src/homunculus/protocol/schemas.py
"""GET|PUT /admin/protocol-settings (G2-B1d, spec §3). The numbers travel as their twelve-digit
text; the label as whole millimetres and the printer's dpi. A field too many, or of the wrong
type, is FastAPI's own 422 (the screen sends whole bodies); a value of the right type that the
rules refuse is a coded 422 or 409 (protocol/router.py)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr


class ProtocolSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    next_no: StrictStr
    label_width_mm: StrictInt
    label_height_mm: StrictInt
    printer_dpi: StrictInt


class ProtocolSettingsOut(BaseModel):
    configured: bool                 # a start number is set: admissions may be made (D5)
    next_no: str | None
    last_issued: str | None
    label_width_mm: int
    label_height_mm: int
    printer_dpi: int
    updated_at: datetime | None
```

**Write** `homunculus-engine/src/homunculus/protocol/router.py`:

```python
# homunculus-engine/src/homunculus/protocol/router.py
"""Yönetim › Protokol ve etiket (G2-B1d, spec §3, D5, D6, D11): the next protocol number and the
label, per tenant. `structure.manage`, the caller's tenant only.

PUT reads the body first — twelve digits (`protocol_format`), then the dpi, the size and the fit
(`label_dpi`, `label_size`, `label_too_narrow`; protocol/fit.py) — all 422, nothing written. Then
it makes the tenant's row if there is none and LOCKS it (the lock an admission's counter takes,
protocol/numbers.py), and refuses a start number that is not greater than the last one issued
(`protocol_not_forward`, 409): lowering it back towards `last_issued + 1` is allowed, no number is
reused either way. Under the lock, an admission issuing a number at that moment is waited for.
The change is audited `protocol.settings` after the commit — who, the old and new start number,
the old and new label (A-26: never a 500 for a committed change). No patient data."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.errors import PROTOCOL_FORMAT, PROTOCOL_NOT_FORWARD, Refusal
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.protocol.fit import label_refusal
from homunculus.protocol.models import ProtocolSettings
from homunculus.protocol.numbers import format_protocol_no, parse_protocol_no
from homunculus.protocol.schemas import ProtocolSettingsIn, ProtocolSettingsOut

router = APIRouter(prefix="/admin/protocol-settings", tags=["protocol"])

#: What a tenant with no row reads: no start number, the default label (spec D6).
_DEFAULT_LABEL = (50, 30, 203)
_WORDS = {
    "label_dpi": "The printer resolution is 203 or 300 dpi.",
    "label_size": "The label is 30–110 mm wide and 20–80 mm high.",
    "label_too_narrow": "The barcode does not fit a label this narrow at this resolution.",
}


def _text(number: int | None) -> str | None:
    return None if number is None else format_protocol_no(number)


def _label(row: ProtocolSettings | None) -> tuple[int, int, int]:
    if row is None:
        return _DEFAULT_LABEL
    return row.label_width_mm, row.label_height_mm, row.printer_dpi


def _out(row: ProtocolSettings | None) -> ProtocolSettingsOut:
    width, height, dpi = _label(row)
    return ProtocolSettingsOut(
        configured=row is not None and row.next_no is not None,
        next_no=_text(row.next_no) if row is not None else None,
        last_issued=_text(row.last_issued) if row is not None else None,
        label_width_mm=width, label_height_mm=height, printer_dpi=dpi,
        updated_at=row.updated_at if row is not None else None)


@router.get("", response_model=ProtocolSettingsOut)
async def read_settings(
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("structure.manage")),
) -> ProtocolSettingsOut:
    return _out(await db.get(ProtocolSettings, caller_tenant))


@router.put("", response_model=ProtocolSettingsOut)
async def write_settings(
    payload: ProtocolSettingsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("structure.manage")),
) -> ProtocolSettingsOut:
    start = parse_protocol_no(payload.next_no)
    if start is None:
        raise Refusal(422, PROTOCOL_FORMAT, "The protocol number is exactly twelve digits.").http()
    refused = label_refusal(payload.label_width_mm, payload.label_height_mm, payload.printer_dpi)
    if refused is not None:
        raise Refusal(422, refused, _WORDS[refused]).http()

    actor, user_id = user.username, user.id
    await db.execute(insert(ProtocolSettings).values(tenant_id=caller_tenant)
                     .on_conflict_do_nothing(index_elements=["tenant_id"]))
    row = (await db.execute(
        select(ProtocolSettings).where(ProtocolSettings.tenant_id == caller_tenant)
        .with_for_update().execution_options(populate_existing=True))).scalar_one()
    if row.last_issued is not None and start <= row.last_issued:
        await db.rollback()
        raise Refusal(409, PROTOCOL_NOT_FORWARD, "The next protocol number must be greater than "
                      "the last one issued.").http()
    before = (_text(row.next_no), list(_label(row)))
    row.next_no = start
    row.label_width_mm, row.label_height_mm = payload.label_width_mm, payload.label_height_mm
    row.printer_dpi = payload.printer_dpi
    row.updated_at, row.updated_by = datetime.now(timezone.utc), user_id
    answer = _out(row)
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    trail.record(request, hospital, "protocol.settings", payload={
        "actor": actor, "next_no": [before[0], answer.next_no],
        "label": [before[1], [answer.label_width_mm, answer.label_height_mm, answer.printer_dpi]]})
    return answer
```

- [ ] **Step 6: Mount it — the Lane A hunk.** **Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:

```python
    app.include_router(infinity_research_router)

    app.state.broadcaster = broadcaster
```

with:

```python
    app.include_router(infinity_research_router)
    # G2-B1d: Yönetim › Protokol ve etiket (`structure.manage`, the caller's tenant).
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)

    app.state.broadcaster = broadcaster
```

- [ ] **Step 7: The route-permission table.** **Edit** `homunculus-engine/tests/test_route_permissions.py` (1) — replace:

```python
    "homunculus.escalation.router",
    "homunculus.tenant.router",
}
```

with:

```python
    "homunculus.escalation.router",
    "homunculus.tenant.router",
    "homunculus.protocol.router",       # G2-B1d
}
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` (2) — replace:

```python
    ("DELETE", "/admin/ldap/group-mappings/{mapping_id}"): ANY(_U),
}
```

with:

```python
    ("DELETE", "/admin/ldap/group-mappings/{mapping_id}"): ANY(_U),
    # protocol/router.py — G2-B1d (spec D11): Yönetim › Protokol ve etiket
    ("GET", "/admin/protocol-settings"): ANY(_S),
    ("PUT", "/admin/protocol-settings"): ANY(_S),
}
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` (3) — replace:

```python
    assert len(EXPECTED) == 59
```

with:

```python
    assert len(EXPECTED) == 61
```

- [ ] **Step 8: Green**, with the walks that read every route:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_settings.py tests/test_route_permissions.py tests/test_nginx_routes.py tests/test_tenant_isolation.py::test_every_route_resolves_the_callers_tenant_unless_unscoped_by_design 2>&1 | tail -3
```

Expected: all passed — the new file's 29 (14 table cases, 9 refusal cases). `/admin` is already proxied by nginx; the two routes resolve the caller's tenant.

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/label_fit_cases.json homunculus-engine/tests/test_protocol_settings.py homunculus-engine/src/homunculus/protocol/fit.py homunculus-engine/src/homunculus/protocol/schemas.py homunculus-engine/src/homunculus/protocol/router.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_permissions.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/label_fit_cases.json homunculus-engine/tests/test_protocol_settings.py homunculus-engine/src/homunculus/protocol/fit.py homunculus-engine/src/homunculus/protocol/schemas.py homunculus-engine/src/homunculus/protocol/router.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_permissions.py <<'EOF'
feat(protocol): GET|PUT /admin/protocol-settings — the start number only forward, the label's size and dpi, the barcode-fit rule on one case table

structure.manage, the caller's tenant (D11). The body is read first (protocol_format, label_dpi,
label_size, label_too_narrow — 422), then the locked row holds the start against the last number
issued (protocol_not_forward — 409). Audited protocol.settings, no patient. The fit rule's case
table is tests/label_fit_cases.json, which the dashboard reads too (E13). app.py: one include
line (Lane A review).

red: collection error — No module named 'homunculus.protocol.fit'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `board_key` and the admit path — the protocol issued inside the admission, the card under it

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Task 2 (Task 3 may run beside it).

Spec §4 (the card key), D1, D5, D7, E4, E6, E9. `admission/boardkey.py` is the one rule; the admission route issues the protocol inside its own transaction — after every check that refuses without writing, BEFORE the H-number (one lock order, protocol/numbers.py) — and everything that reaches the board after the commit goes under the key: the card (`kabul_record`), the weight, the comorbidities, the resend's retry (`_board_again`), the resend's wait (`_engine_of`). The answers gain `protocol_no` (every `AdmissionResponse`) and `board_key` (`AdmitResponse`). The audit row's `patient_id` is the key and its payload gains `protocol_no` and `patient_number` (E4); the refusals that name an admission gain `board_key` beside `patient_number` (E6). Router log lines name the key.

The two test worlds that admit through the route get a start number (E9), and B1a's own route tests read the card under `board_key` where they read it under `patient_number` — Step 7's table, line by line.

**Files:**
- Create: `homunculus-engine/tests/test_protocol_admission.py`
- Create: `homunculus-engine/src/homunculus/admission/boardkey.py`
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/tests/kabul_world.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`
- Modify: `homunculus-engine/tests/test_admission_api.py`

- [ ] **Step 1: The worlds get a start number (E9).**

**Edit** `homunculus-engine/tests/kabul_world.py` (1) — replace:

```python
from homunculus.db import get_db
from homunculus.scope.models import StaffScope
```

with:

```python
from homunculus.db import get_db
from homunculus.protocol.models import ProtocolSettings
from homunculus.scope.models import StaffScope
```

**Edit** `homunculus-engine/tests/kabul_world.py` (2) — replace:

```python
SLUG = "kabul-hastane"
DEVICE = "kabul-device-token"
```

with:

```python
SLUG = "kabul-hastane"
DEVICE = "kabul-device-token"
#: G2-B1d (spec D5): the ward's start number, set as the administrator sets it — no admission is
#: possible without one. The first admission's protocol, its card key.
FIRST_PROTOCOL = "202600000001"
```

**Edit** `homunculus-engine/tests/kabul_world.py` (3) — replace:

```python
    db.add_all(beds.values())
    await db.flush()

    staff = {"admin": ("hospital_admin", None), "nurse": ("nurse", "rea"),
```

with:

```python
    db.add_all(beds.values())
    db.add(ProtocolSettings(tenant_id=tenant.id, next_no=int(FIRST_PROTOCOL)))
    await db.flush()

    staff = {"admin": ("hospital_admin", None), "nurse": ("nurse", "rea"),
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (1) — after the line `from homunculus.admission.numbers import next_patient_number` add the line:

```python
from homunculus.protocol.models import ProtocolSettings
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (2) — replace:

```python
    groups = await ensure_default_groups(db, tenant.id)
    admin = await add_user(db, username=f"admin@{slug}.example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
```

with:

```python
    groups = await ensure_default_groups(db, tenant.id)
    # G2-B1d (spec D5): the controls admit through the route, which needs a start number (E9).
    db.add(ProtocolSettings(tenant_id=tenant.id, next_no=202600000001))
    admin = await add_user(db, username=f"admin@{slug}.example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
```

- [ ] **Step 2: Write the failing test.** **Write** `homunculus-engine/tests/test_protocol_admission.py`:

```python
# homunculus-engine/tests/test_protocol_admission.py
"""The admit path under the protocol (G2-B1d, spec §3, §4, D1, D5, D7): the admission takes the
tenant's next protocol number inside its own transaction; its card, weight and comorbidities go
under it — the number on the device, the label and the card are one (D7); the answer carries
`protocol_no` and `board_key`; the audit row names the key, with the protocol and the H-number in
its payload and never a name. No start number: nothing is written (D5). A refused admission gives
its number back. A resend is answered with the same protocol; a duplicate names the open
admission's key. Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update

from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, Patient
from homunculus.protocol.models import ProtocolSettings
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form

SECOND_PROTOCOL = "202600000002"


def test_the_key_is_the_protocol_and_a_legacy_admissions_is_its_h_number():
    assert board_key("202600000001", "H2600042") == "202600000001"
    assert board_key(None, "H2600042") == "H2600042"
    assert board_key("", "H2600042") == "H2600042"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _settings(db) -> tuple[int | None, int | None]:
    db.expire_all()
    return tuple((await db.execute(select(ProtocolSettings.next_no, ProtocolSettings.last_issued))).one())


@requires_db
async def test_an_admission_takes_the_next_protocol_and_its_card_goes_under_it(ward, db_session):
    w, client, app = ward
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["protocol_no"], body["board_key"]) == (FIRST_PROTOCOL, FIRST_PROTOCOL)
    assert body["patient_number"].startswith("H")                       # D2: still issued, apart
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.protocol_no))).scalar_one() == FIRST_PROTOCOL
    assert await _settings(db_session) == (int(SECOND_PROTOCOL), int(FIRST_PROTOCOL))

    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert card["patient_id"] == FIRST_PROTOCOL                         # D7: the card's key
    assert card["identity"]["display_name"] == "Sentetik Hasta"
    assert card["meds"]["weight_kg"] == 72.5                            # the weight under the key
    engine = app.state.board_link._engine(SLUG)
    assert engine.profile(FIRST_PROTOCOL).comorbidities == frozenset({"copd"})
    assert body["patient_number"] not in set(engine.patient_ids())     # nothing under the H-number


@requires_db
async def test_the_next_admission_takes_the_next_protocol(ward):
    w, client, _ = ward
    first = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    second = (await client.post("/admissions", json=form(w, "2"), headers=w.auth["charge"])).json()
    assert (first["protocol_no"], second["protocol_no"]) == (FIRST_PROTOCOL, SECOND_PROTOCOL)


@requires_db
@pytest.mark.parametrize("unset", ["no row", "next_no NULL"])
async def test_without_a_start_number_no_admission_is_written(ward, db_session, unset):
    """D5: refused `protocol_not_configured`, and nothing at all is written — not the patient, not
    the bed, not an H-number."""
    w, client, app = ward
    if unset == "no row":
        await db_session.execute(delete(ProtocolSettings))
    else:
        await db_session.execute(update(ProtocolSettings).values(next_no=None))
    await db_session.commit()
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "protocol_not_configured"), r.text
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (0, 0)
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == w.beds["1"].id))).scalar_one() \
        == BedState.AVAILABLE
    assert [x for x in app.state.audit.records(tenant=SLUG, limit=50)
            if x.event_type == "admission.admit"] == []
    # Once it is set, the first admission takes the first H-number: none was spent above.
    if unset == "no row":
        db_session.add(ProtocolSettings(tenant_id=w.tenant.id, next_no=int(FIRST_PROTOCOL)))
    else:
        await db_session.execute(update(ProtocolSettings).values(next_no=int(FIRST_PROTOCOL)))
    await db_session.commit()
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["patient_number"].endswith("00001")


@requires_db
async def test_past_the_last_twelve_digit_number_the_admission_is_refused(ward, db_session):
    w, client, _ = ward
    await db_session.execute(update(ProtocolSettings).values(next_no=1_000_000_000_000))
    await db_session.commit()
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "protocol_exhausted"), r.text
    assert await _count(db_session, Admission) == 0
    assert await _settings(db_session) == (1_000_000_000_000, None)        # rolled back


@requires_db
async def test_an_admission_refused_after_its_number_gives_the_number_back(ward, db_session):
    """The bed is taken by the service's own check, after both numbers were taken: the whole
    transaction rolls back, and the next admission gets the number — no gap."""
    w, client, _ = ward
    assert (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).status_code == 201
    taken = form(w, "1", patient={"display_name": "Sentetik Başqa"})
    r = await client.post("/admissions", json=taken, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available"), r.text
    nxt = await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])
    assert nxt.json()["protocol_no"] == SECOND_PROTOCOL


@requires_db
async def test_the_audit_row_is_the_cards_and_names_both_numbers_never_the_name(ward):
    w, client, app = ward
    body = (await client.post("/admissions", json=form(w), headers=w.auth["nurse"])).json()
    (row,) = [x for x in app.state.audit.records(tenant=SLUG, limit=50)
              if x.event_type == "admission.admit"]
    assert row.patient_id == FIRST_PROTOCOL                             # E4: the card's key
    assert row.payload == {"admission_id": body["id"], "bed_id": str(w.beds["1"].id),
                           "unit_id": str(w.units["rea"].id), "actor": "nurse@kabul.example.com",
                           "protocol_no": FIRST_PROTOCOL, "patient_number": body["patient_number"]}
    assert "Sentetik" not in repr([x.payload for x in app.state.audit.records(tenant=SLUG, limit=50)])


@requires_db
async def test_a_resend_of_the_form_is_answered_with_the_same_protocol(ward, db_session):
    w, client, _ = ward
    body = form(w, request_id=uuid.uuid4())
    first = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert (first.status_code, again.status_code) == (201, 200), again.text
    assert (again.json()["protocol_no"], again.json()["board_key"]) == (FIRST_PROTOCOL, FIRST_PROTOCOL)
    assert await _settings(db_session) == (int(SECOND_PROTOCOL), int(FIRST_PROTOCOL))   # one taken


@requires_db
async def test_a_duplicate_and_a_request_conflict_name_the_open_admissions_key(ward):
    """E6: the number the screen sends the nurse to look for is the card's."""
    w, client, _ = ward
    request_id = uuid.uuid4()
    first = (await client.post("/admissions", json=form(w, "1", request_id=request_id),
                               headers=w.auth["nurse"])).json()
    dup = await client.post("/admissions", json=form(w, "2", patient={"display_name": "Sentetik Hasta"}),
                            headers=w.auth["nurse"])
    assert dup.json()["detail"]["code"] == "duplicate_open_admission"
    other = await client.post("/admissions", json=form(w, "2", request_id=request_id),
                              headers=w.auth["nurse"])
    assert other.json()["detail"]["code"] == "request_conflict"
    for refused in (dup, other):
        detail = refused.json()["detail"]
        assert (detail["board_key"], detail["patient_number"]) == (FIRST_PROTOCOL, first["patient_number"])
```

- [ ] **Step 3: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_admission.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.admission.boardkey'` (collection error).

- [ ] **Step 4: The rule and the answers.** **Write** `homunculus-engine/src/homunculus/admission/boardkey.py`:

```python
# homunculus-engine/src/homunculus/admission/boardkey.py
"""The card key of an admission (Group 2 · B1d, spec §4, D7) — one rule, in one place.

The board world (the engine, the identity store, alerts, acks, trends, the Infinity strip, the
audit's `patient_id`) keys a patient by one string. An admission made since 0015 is keyed by its
protocol number: the number on the device, the label and the card are the same (D7). An admission
opened before it keeps its H-number key (`Patient.patient_number`) until it is discharged.

Every place that ties an admission to the board calls this; none of them reads
`Patient.patient_number` for that purpose any more."""
from __future__ import annotations


def board_key(protocol_no: str | None, patient_number: str) -> str:
    """The admission's card key: its protocol number, else (a legacy admission) its H-number."""
    return protocol_no or patient_number
```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (1) — replace:

```python
    discharge_at: datetime | None = None
    discharge_note: str | None = None

    model_config = {"from_attributes": True}


# What did not reach the engine after an admission or a discharge was written (spec §3.1 step 3):
```

with:

```python
    discharge_at: datetime | None = None
    discharge_note: str | None = None
    # Group 2 · B1d: the protocol number, the card key of a new admission; None on a legacy one.
    protocol_no: str | None = None

    model_config = {"from_attributes": True}


# What did not reach the engine after an admission or a discharge was written (spec §3.1 step 3):
```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (2) — replace:

```python
class AdmitResponse(AdmissionResponse):
    """POST /admissions: the admission, the patient number the nurse enters on the device, and
    which of the engine writes landed."""
    patient_number: str
    engine: EngineWrites
```

with:

```python
class AdmitResponse(AdmissionResponse):
    """POST /admissions: the admission, its numbers — `board_key` is the card's and what the nurse
    enters or scans on the device (the protocol number, G2-B1d; `patient_number` is the H-number,
    issued apart, D2) — and which of the engine writes landed."""
    patient_number: str
    board_key: str
    engine: EngineWrites
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (1) — replace:

```python
    request_id: uuid.UUID | None = None,
    request_digest: str | None = None,
    identity_digest: str | None = None,
) -> Admission:
```

with:

```python
    request_id: uuid.UUID | None = None,
    request_digest: str | None = None,
    identity_digest: str | None = None,
    protocol_no: str | None = None,
) -> Admission:
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (2) — replace:

```python
        request_digest=request_digest,
        identity_digest=identity_digest,
        **note_fields,
    )
```

with:

```python
        request_digest=request_digest,
        identity_digest=identity_digest,
        protocol_no=protocol_no,             # G2-B1d: issued by the route, in this transaction
        **note_fields,
    )
```

(The first replaced block is `create_draft_admission`'s signature: `grep -n "identity_digest: str | None = None," src/homunculus/admission/service.py` gives one line.)

- [ ] **Step 5: The route.** Every edit is in `homunculus-engine/src/homunculus/admission/router.py`; each old text occurs once.

**Edit** (1) the imports — replace:

```python
from homunculus.admission.numbers import next_patient_number
```

with:

```python
from homunculus.admission.numbers import next_patient_number
from homunculus.admission.boardkey import board_key
from homunculus.protocol.numbers import next_protocol_no
```

**Edit** (2) `_card` — replace:

```python
def _card(*, number: str, display_name: str, date_of_birth: str, sex: str, bed_label: str,
          bed_id: uuid.UUID, unit_id: uuid.UUID) -> IdentityRecord:
    """The admission's board identity: the card on its bed (`kabul_record`)."""
    return kabul_record(patient_number=number, display_name=display_name,
```

with:

```python
def _card(*, key: str, display_name: str, date_of_birth: str, sex: str, bed_label: str,
          bed_id: uuid.UUID, unit_id: uuid.UUID) -> IdentityRecord:
    """The admission's board identity: the card on its bed (`kabul_record`), under its board key
    (`board_key`: the protocol number; a legacy admission's H-number)."""
    return kabul_record(patient_number=key, display_name=display_name,
```

**Edit** (3) `_to_board`'s body — replace:

```python
    number = card["number"]
    link = board_link_of(request)
    if link is None:
        log.error("admission %s: this app has no BoardLink; the card, the weight and the "
                  "comorbidities did not reach the engine", number)
        return _not_reached(weight_asked=note.weight_kg is not None,
                            profile_asked=bool(note.comorbidity_codes))
    board = await _attempt(number, "identity",
                           lambda: link.put_identity(hospital, _card(**card)))
    weight = ("skipped" if note.weight_kg is None else await _attempt(
        number, "weight", lambda: link.chart_weight(hospital, number, note.weight_kg,
                                                    actor=actor)))
    profile = ("skipped" if not note.comorbidity_codes else await _attempt(
        number, "profile", lambda: link.apply_profile(hospital, number, note.comorbidity_codes,
                                                      actor=actor)))
    return EngineWrites(weight=weight, profile=profile, board=board)
```

with:

```python
    key = card["key"]
    link = board_link_of(request)
    if link is None:
        log.error("admission %s: this app has no BoardLink; the card, the weight and the "
                  "comorbidities did not reach the engine", key)
        return _not_reached(weight_asked=note.weight_kg is not None,
                            profile_asked=bool(note.comorbidity_codes))
    board = await _attempt(key, "identity",
                           lambda: link.put_identity(hospital, _card(**card)))
    weight = ("skipped" if note.weight_kg is None else await _attempt(
        key, "weight", lambda: link.chart_weight(hospital, key, note.weight_kg, actor=actor)))
    profile = ("skipped" if not note.comorbidity_codes else await _attempt(
        key, "profile", lambda: link.apply_profile(hospital, key, note.comorbidity_codes,
                                                   actor=actor)))
    return EngineWrites(weight=weight, profile=profile, board=board)
```

and in `_to_board`'s docstring replace `Logged with the patient
    number, never a name.` with `Logged with the board key, never a name.` (the two lines that end the paragraph beginning "After the admission is committed").

**Edit** (4) `_open_admission_of` — replace:

```python
    """The patient number, bed and unit (the bed's room's, A-12) of the open admission of the
    person `identity` names (`form.identity_digest`) in the tenant, if she has one (A-37)."""
    return (await db.execute(
        select(Patient.patient_number, Admission.bed_id, Room.unit_id)
```

with:

```python
    """The patient number, protocol, bed and unit (the bed's room's, A-12) of the open admission
    of the person `identity` names (`form.identity_digest`) in the tenant, if she has one (A-37)."""
    return (await db.execute(
        select(Patient.patient_number, Admission.protocol_no, Admission.bed_id, Room.unit_id)
```

**Edit** (5) `_duplicate` — replace:

```python
    return Refusal(409, DUPLICATE_OPEN_ADMISSION, "This person already has an open admission: "
                   "it is discharged before another is opened.",
                   extra={"patient_number": found.patient_number} if known else None)
```

with:

```python
    return Refusal(409, DUPLICATE_OPEN_ADMISSION, "This person already has an open admission: "
                   "it is discharged before another is opened.",
                   extra=_numbers(found.patient_number, found.protocol_no) if known else None)


def _numbers(patient_number: str, protocol_no: str | None) -> dict:
    """What a refusal names an admission by, beside its code (E6): its H-number and its board key
    — the number the screen sends the nurse to look for. Never a name."""
    return {"patient_number": patient_number, "board_key": board_key(protocol_no, patient_number)}
```

**Edit** (6) `_board_again` — replace:

```python
    row = (await db.execute(
        select(Admission.state, Admission.comorbidity_codes, Patient.patient_number,
               Patient.display_name, Patient.date_of_birth, Patient.sex, Bed.id, Bed.label,
               Room.unit_id)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .where(Admission.id == admission_id))).one()
    await db.commit()
    state, codes, number, display_name, date_of_birth, sex, bed_id, bed_label, unit_id = row
    link = board_link_of(request)
    if state not in OPEN_ADMISSION_STATES or link is None:
        log.error("admission %s (%s): its board writes are not known and are not written again "
                  "(%s)", number, state.value, "no BoardLink" if link is None else "not open")
        return _not_reached(weight_asked=weight_asked, profile_asked=bool(codes))
    log.warning("admission %s: its first send stopped before the board; the card and the "
                "comorbidities are written again, the weight is not", number)
    board = await _attempt(number, "identity (again)", lambda: link.put_identity(hospital, _card(
        number=number, display_name=display_name, date_of_birth=date_of_birth, sex=sex,
        bed_label=bed_label, bed_id=bed_id, unit_id=unit_id)))
    profile = ("skipped" if not codes else await _attempt(
        number, "profile (again)", lambda: link.apply_profile(hospital, number, codes,
                                                              actor=actor)))
```

with:

```python
    row = (await db.execute(
        select(Admission.state, Admission.comorbidity_codes, Admission.protocol_no,
               Patient.patient_number, Patient.display_name, Patient.date_of_birth, Patient.sex,
               Bed.id, Bed.label, Room.unit_id)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .where(Admission.id == admission_id))).one()
    await db.commit()
    (state, codes, protocol_no, number, display_name, date_of_birth, sex, bed_id, bed_label,
     unit_id) = row
    key = board_key(protocol_no, number)
    link = board_link_of(request)
    if state not in OPEN_ADMISSION_STATES or link is None:
        log.error("admission %s (%s): its board writes are not known and are not written again "
                  "(%s)", key, state.value, "no BoardLink" if link is None else "not open")
        return _not_reached(weight_asked=weight_asked, profile_asked=bool(codes))
    log.warning("admission %s: its first send stopped before the board; the card and the "
                "comorbidities are written again, the weight is not", key)
    board = await _attempt(key, "identity (again)", lambda: link.put_identity(hospital, _card(
        key=key, display_name=display_name, date_of_birth=date_of_birth, sex=sex,
        bed_label=bed_label, bed_id=bed_id, unit_id=unit_id)))
    profile = ("skipped" if not codes else await _attempt(
        key, "profile (again)", lambda: link.apply_profile(hospital, key, codes, actor=actor)))
```

**Edit** (7) `_answer_again` — replace:

```python
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == earlier.patient_id))).scalar_one()
    if earlier.request_digest != digest:
        unit_id = (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                                    .where(Bed.id == earlier.bed_id))).scalar_one()
        known = unitscope.reaches(reach, unit_id=unit_id, bed_id=earlier.bed_id)
        raise Refusal(409, REQUEST_CONFLICT, "This request id came before with another admission "
                      "form.", extra={"patient_number": number} if known else None).http()
    first = AdmissionResponse.model_validate(earlier)
    admission_id, weight_asked = earlier.id, earlier.weight_kg is not None
    profile_asked = bool(earlier.comorbidity_codes)
    await db.commit()                  # no transaction, and no pooled connection, while it waits
    engine = await _engine_of(db, request, hospital, admission_id, number,
                              weight_asked=weight_asked, profile_asked=profile_asked, actor=actor)
    log.info("admission %s: the same form sent again, answered with its admission", number)
    response.status_code = status.HTTP_200_OK
    return AdmitResponse(**first.model_dump(), patient_number=number, engine=engine)
```

with:

```python
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == earlier.patient_id))).scalar_one()
    if earlier.request_digest != digest:
        unit_id = (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                                    .where(Bed.id == earlier.bed_id))).scalar_one()
        known = unitscope.reaches(reach, unit_id=unit_id, bed_id=earlier.bed_id)
        raise Refusal(409, REQUEST_CONFLICT, "This request id came before with another admission "
                      "form.", extra=_numbers(number, earlier.protocol_no) if known else None).http()
    first = AdmissionResponse.model_validate(earlier)
    key = board_key(earlier.protocol_no, number)
    admission_id, weight_asked = earlier.id, earlier.weight_kg is not None
    profile_asked = bool(earlier.comorbidity_codes)
    await db.commit()                  # no transaction, and no pooled connection, while it waits
    engine = await _engine_of(db, request, hospital, admission_id, key,
                              weight_asked=weight_asked, profile_asked=profile_asked, actor=actor)
    log.info("admission %s: the same form sent again, answered with its admission", key)
    response.status_code = status.HTTP_200_OK
    return AdmitResponse(**first.model_dump(), patient_number=number, board_key=key, engine=engine)
```

**Edit** (8) `create_admission`: the numbers — replace:

```python
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
        number = await next_patient_number(db, caller_tenant, now=now)
```

with:

```python
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
        # G2-B1d (spec §3, D1, D5): the protocol first, then the H-number — one lock order for
        # every admission. No start number set: `protocol_not_configured`, nothing written.
        protocol_no = await next_protocol_no(db, caller_tenant)
        number = await next_patient_number(db, caller_tenant, now=now)
```

**Edit** (9) `create_admission`: the service call — replace:

```python
            request_id=payload.request_id, request_digest=digest, identity_digest=identity,
        )
    except WorkflowError as exc:
        raise _wf(exc)
```

with:

```python
            request_id=payload.request_id, request_digest=digest, identity_digest=identity,
            protocol_no=protocol_no,
        )
    except WorkflowError as exc:
        raise _wf(exc)
```

**Edit** (10) `create_admission`: after the commit — replace:

```python
    admission_id, written = admission.id, AdmissionResponse.model_validate(admission)
    card = {"number": number, "display_name": patient.display_name,
            "date_of_birth": patient.date_of_birth, "sex": patient.sex, "bed_label": bed.label,
            "bed_id": bed.id, "unit_id": unit.id}
    # Registered before the commit, so a send of the same form that sees this admission sees it.
    answered = _ANSWERING[admission_id] = asyncio.Event()
    try:
        await db.commit()
        trail.record(request, hospital, "admission.admit", patient_id=number,
                     payload={"admission_id": str(admission_id), "bed_id": str(card["bed_id"]),
                              "unit_id": str(card["unit_id"]), "actor": actor})
        try:
            # Read back, so this answer and a resend's (read from the row) are the same body.
            await db.refresh(admission)
            written = AdmissionResponse.model_validate(admission)
            await db.commit()        # no transaction held across the board writes
        except Exception:  # noqa: BLE001 — the admission and its audit row are written already
            log.exception("admission %s: committed, but not read back; answered as written",
                          number)
            with suppress(Exception):
                await db.rollback()
        engine = await _to_board(request, hospital, card=card, note=payload.note, actor=actor)
        answer = AdmitResponse(**written.model_dump(), patient_number=number, engine=engine)
```

with:

```python
    admission_id, written = admission.id, AdmissionResponse.model_validate(admission)
    key = board_key(protocol_no, number)
    card = {"key": key, "display_name": patient.display_name,
            "date_of_birth": patient.date_of_birth, "sex": patient.sex, "bed_label": bed.label,
            "bed_id": bed.id, "unit_id": unit.id}
    # Registered before the commit, so a send of the same form that sees this admission sees it.
    answered = _ANSWERING[admission_id] = asyncio.Event()
    try:
        await db.commit()
        # E4: the row's patient is the card's key; both numbers stay on record, never a name.
        trail.record(request, hospital, "admission.admit", patient_id=key,
                     payload={"admission_id": str(admission_id), "bed_id": str(card["bed_id"]),
                              "unit_id": str(card["unit_id"]), "actor": actor,
                              "protocol_no": protocol_no, "patient_number": number})
        try:
            # Read back, so this answer and a resend's (read from the row) are the same body.
            await db.refresh(admission)
            written = AdmissionResponse.model_validate(admission)
            await db.commit()        # no transaction held across the board writes
        except Exception:  # noqa: BLE001 — the admission and its audit row are written already
            log.exception("admission %s: committed, but not read back; answered as written", key)
            with suppress(Exception):
                await db.rollback()
        engine = await _to_board(request, hospital, card=card, note=payload.note, actor=actor)
        answer = AdmitResponse(**written.model_dump(), patient_number=number, board_key=key,
                               engine=engine)
```

**Edit** (11) `create_admission`'s docstring — replace:

```python
    unit the form names, in the caller's units, open and AVAILABLE; the patient gets a fresh
    number (admission/numbers.py); the admission is DRAFT and the bed OCCUPIED. After the commit
    the board gets its card and the engine the weight and the comorbidities (`_to_board`); the
    answer says which of those landed.
```

with:

```python
    unit the form names, in the caller's units, open and AVAILABLE; the admission takes the
    tenant's next protocol number (protocol/numbers.py — none set: `protocol_not_configured`,
    G2-B1d D5) and the patient a fresh H-number (admission/numbers.py); the admission is DRAFT and
    the bed OCCUPIED. After the commit the board gets its card under the admission's board key
    (the protocol, `board_key`) and the engine the weight and the comorbidities (`_to_board`); the
    answer says which of those landed.
```

- [ ] **Step 6: Green for the new file**, the Step 3 command: `10 passed` (with its parametrised cases).

- [ ] **Step 7: B1a's route tests read the card under its key.** Run them first and see which fail:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)"
```

Expected: the tests that compare a card, the engine, an audit row's `patient_id` or a log line with `patient_number` fail — the card is the protocol's now. **The rule:** a value used as the card key, the engine key, an audit row's `patient_id` or the number a router log line names is `board_key`; the H-number's own format and sequence (`[3:]`, `f"H…"`), a list row's `patient_number`, and a refusal's `detail["patient_number"]` compared with an answer's `patient_number` stay `patient_number`. In `homunculus-engine/tests/test_admission_api.py`, each line found by its text (the numbers are at `da9c95b`):

| Line | Old text | New text |
|---|---|---|
| 91 | `assert card["patient_id"] == body["patient_number"]` | `assert card["patient_id"] == body["board_key"]` |
| 96 | `assert engine.profile(body["patient_number"]).comorbidities` | `assert engine.profile(body["board_key"]).comorbidities` |
| 99 | `assert [r.patient_id for r in rows] == [body["patient_number"]]` | `assert [r.patient_id for r in rows] == [body["board_key"]]` |
| 100-101 | `"unit_id": str(unit_id), "actor": "nurse@kabul.example.com"}` | `"unit_id": str(unit_id), "actor": "nurse@kabul.example.com",` and a next line `"protocol_no": body["protocol_no"], "patient_number": body["patient_number"]}` (aligned under `"unit_id"`) |
| 320 | `assert r.json()["patient_number"] in message and "nurse@kabul.example.com" in message, message` | `assert r.json()["board_key"] in message and "nurse@kabul.example.com" in message, message` |
| 342 | `== (r.json()["patient_number"], r.json()["id"])` | `== (r.json()["board_key"], r.json()["id"])` |
| 345 | `assert any(r.json()["patient_number"] in rec.getMessage() for rec in caplog.records` | `assert any(r.json()["board_key"] in rec.getMessage() for rec in caplog.records` |
| 366 | `assert len(errors) == 2 and r.json()["patient_number"] in errors[1], errors` | `assert len(errors) == 2 and r.json()["board_key"] in errors[1], errors` |
| 463 | `(number,) = (await db_session.execute(select(Patient.patient_number))).scalars()` | `(number,) = (await db_session.execute(select(Admission.protocol_no))).scalars()` |
| 468 | `assert again.json()["patient_number"] == number` | `assert again.json()["board_key"] == number` |
| 525 | `(number,) = (await db_session.execute(select(Patient.patient_number))).scalars()` | `(number,) = (await db_session.execute(select(Admission.protocol_no))).scalars()` |
| 573 | `assert frame["patient_id"] == r.json()["patient_number"]` | `assert frame["patient_id"] == r.json()["board_key"]` |
| 682 | `assert any(first.json()["patient_number"] in m for m in warned), warned` | `assert any(first.json()["board_key"] in m for m in warned), warned` |
| 737 | `assert first.json()["patient_number"] not in r.text` | the same line, then `assert first.json()["board_key"] not in r.text` and `assert "board_key" not in r.json()["detail"]` |
| 875 | `assert first.json()["patient_number"] not in r.text` | the same line, then the same two lines |

(463 and 525 occur twice as the same text: Edit each with enough of the following line to be unique — 463 is followed by `assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []`, 525 by a blank line and `reached, gate = asyncio.Event(), asyncio.Event()`. 737 and 875 likewise: 737 follows `assert "patient_number" not in r.json()["detail"]` after a `request_conflict` assert, 875 after a `duplicate_open_admission` one. `Patient` stays imported: line 295's statement check and others read it.)

A test that still fails after these is NOT covered by the rule: stop and report it (with its assertion) before changing anything else.

- [ ] **Step 8: Green on everything the admit path touches:**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_admission.py tests/test_admission_api.py tests/test_tenant_isolation.py tests/test_structure_api.py tests/test_admission_trail.py tests/test_admission_workflow.py tests/test_kabul_boardlink.py tests/test_admission_form.py 2>&1 | tail -3
```

Expected: all passed. `tests/test_discharge_api.py` is Task 5's (it fails here on the card key: do not touch it in this task).

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_protocol_admission.py homunculus-engine/src/homunculus/admission/boardkey.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/kabul_world.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_admission_api.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_protocol_admission.py homunculus-engine/src/homunculus/admission/boardkey.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/kabul_world.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_admission_api.py <<'EOF'
feat(admission): the protocol issued inside the admission; the card, weight and profile under board_key

admission/boardkey.py is the one rule (protocol, else a legacy H-number; spec §4, D7). The route
takes the protocol before the H-number, in its own transaction (D5: none set is
protocol_not_configured, nothing written); the card, the weight, the comorbidities, the resend's
retry and wait go under the key; the answers gain protocol_no and board_key; the admit audit row's
patient is the key, its payload both numbers (E4); duplicate and request_conflict name the key
(E6). The two test worlds get a start number (E9); B1a's route tests read the card by board_key.

red: collection error — No module named 'homunculus.admission.boardkey'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Every other board call site — sign-off, discharge, the lists, the bed release, own patients, break-glass

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Task 4.

Spec §4, D7, D9, E3, E4, E5, E6. After this task no route ties an admission to the board through `Patient.patient_number`: sign-off, discharge start and confirm (the open-critical count, the tombstone, the retirement, their audit rows) act on `_key_of` (the old `_number_of`, now the board key); the list rows and the detail carry `protocol_no` and `board_key`; the bed release's card check (`tenant/router.py` `_last_card_off`, E3) finds a discharged card under its key; the care team's own patients and break-glass (D9) name the key. A legacy admission (protocol NULL) keeps the H-number at every one of them. Lane A's monitor strip links a bed to whatever key the identity store holds, so a protocol-keyed card is linked with no change (O74): a test pins it.

**Files:**
- Create: `homunculus-engine/tests/test_protocol_board_key.py`
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/src/homunculus/tenant/router.py`
- Modify: `homunculus-engine/src/homunculus/scope/service.py`
- Modify: `homunculus-engine/src/homunculus/scope/resolver.py`
- Modify: `homunculus-engine/tests/test_kabul_boardlink.py`
- Modify: `homunculus-engine/tests/test_discharge_api.py`

- [ ] **Step 1: Write the failing tests.** **Write** `homunculus-engine/tests/test_protocol_board_key.py`:

```python
# homunculus-engine/tests/test_protocol_board_key.py
"""The board key everywhere an admission meets the board (G2-B1d, spec §4, D7, D9; E3, E4, E5):
sign-off and discharge act on the protocol-keyed card (its critical alarm holds the start, its
tombstone and retirement are under the protocol, the audit rows name it); the lists and the detail
answer `protocol_no` and `board_key`; the bed release finds a discharged card under its key and
refuses `board_not_cleared` naming it; the care team's own patients and break-glass name the key.
A legacy admission (no protocol, opened before 0015) keeps its H-number at each. Postgres.
Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from homunculus.admission import service
from homunculus.admission.boardlink import BoardLink, kabul_record
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.escalation.models import BreakGlassReason, BreakGlassSession
from homunculus.scope.resolver import break_glass_in_tenant
from homunculus.scope.service import read_own_patient_ids
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_discharge_api import acknowledged, admit, audited, septic_shock, signed, started

pytestmark = [requires_db]
LEGACY = "H9900042"           # a fixture's H-number, far from the live range (test_unit_scope.py)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _legacy(db_session, app, w, bed: str = "2") -> Admission:
    """An admission opened before 0015: no protocol, its card under its H-number on its bed."""
    patient = Patient(tenant_id=w.tenant.id, display_name="Sentetik Eski", date_of_birth="1960-01-01",
                      sex="male", patient_number=LEGACY)
    db_session.add(patient)
    await db_session.flush()
    admission = await service.create_draft_admission(
        db_session, tenant_id=w.tenant.id, patient=patient,
        note_fields={"admitting_unit_id": w.units["rea"].id, "bed_id": w.beds[bed].id,
                     "admission_diagnosis_free_text": "Sentetik tanı"})
    await db_session.commit()
    await app.state.board_link.put_identity(SLUG, kabul_record(
        patient_number=LEGACY, display_name="Sentetik Eski", birth_date=date(1960, 1, 1), sex="male",
        bed_label=bed, bed_id=str(w.beds[bed].id), unit_id=str(w.units["rea"].id),
        at=datetime.now(timezone.utc)))
    return admission


async def _cards(client) -> list[str]:
    return [c["patient_id"] for c in (await client.get("/patients", headers=BOARD)).json()["patients"]]


async def test_sign_off_and_discharge_act_on_the_protocol_card(ward):
    w, client, app = ward
    admission = await started(w, client)
    assert admission["board_key"] == FIRST_PROTOCOL
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm", headers=w.auth["charge"])
    assert (r.status_code, r.json()["board"], r.json()["alerts"]) == (200, "ok", "ok"), r.text
    assert r.json()["protocol_no"] == FIRST_PROTOCOL
    link = app.state.board_link
    assert link.is_discharged(SLUG, FIRST_PROTOCOL)
    assert link._identities.get(SLUG, admission["patient_number"]) is None    # nothing under the H
    assert await _cards(client) == []
    for event in ("admission.sign_off", "admission.discharge_start", "admission.discharge_confirm"):
        assert [row.patient_id for row in audited(app, event)] == [FIRST_PROTOCOL], event


async def test_the_protocol_cards_critical_alarm_holds_the_discharge(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    await septic_shock(client, FIRST_PROTOCOL)
    start = f"/admissions/{admission['id']}/discharge/initiate"
    r = await client.post(start, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")
    await acknowledged(client, FIRST_PROTOCOL)
    r = await client.post(start, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text


async def test_the_list_and_the_detail_carry_the_protocol_and_the_key(ward, db_session):
    w, client, app = ward
    admitted = await admit(w, client)
    legacy = await _legacy(db_session, app, w)
    rows = (await client.get("/admissions", headers=w.auth["nurse"])).json()
    got = {r["id"]: (r["protocol_no"], r["board_key"], r["patient_number"]) for r in rows}
    assert got == {admitted["id"]: (FIRST_PROTOCOL, FIRST_PROTOCOL, admitted["patient_number"]),
                   str(legacy.id): (None, LEGACY, LEGACY)}
    for admission_id, key in ((admitted["id"], FIRST_PROTOCOL), (str(legacy.id), LEGACY)):
        detail = (await client.get(f"/admissions/{admission_id}", headers=w.auth["nurse"])).json()
        assert detail["board_key"] == key and "display_name" not in detail


async def test_a_legacy_admission_is_signed_and_discharged_under_its_h_number(ward, db_session):
    w, client, app = ward
    legacy = await _legacy(db_session, app, w)
    base = f"/admissions/{legacy.id}"
    for path, body, who in (("/sign-off", None, "doctor"),
                            ("/discharge/initiate", {"disposition": "HOME"}, "doctor"),
                            ("/discharge/confirm", None, "charge")):
        r = await client.post(base + path, json=body, headers=w.auth[who])
        assert r.status_code == 200, r.text
    assert r.json()["protocol_no"] is None
    assert app.state.board_link.is_discharged(SLUG, LEGACY)
    assert [row.patient_id for row in audited(app, "admission.discharge_confirm")] == [LEGACY]


async def test_the_bed_release_finds_the_protocol_card_still_standing(ward, monkeypatch):
    """E3: a discharge whose board step failed leaves the protocol card on its bed; the release
    looks for it under its key, takes it off, and until that lands refuses naming it."""
    w, client, app = ward
    admission = await started(w, client)
    release = f"/tenant/beds/{w.beds['1'].id}/release"
    with monkeypatch.context() as patched:
        async def refused(self, tenant, patient_number):
            raise RuntimeError(f"the discharge of {patient_number} was refused")

        patched.setattr(BoardLink, "discharge_identity", refused)
        r = await client.post(f"/admissions/{admission['id']}/discharge/confirm", headers=w.auth["charge"])
        assert r.json()["board"] == "failed"
        r = await client.post(release, headers=w.auth["nurse"])
        detail = r.json()["detail"]
        assert (r.status_code, detail["code"], detail["board_key"], detail["patient_number"]) == \
            (409, "board_not_cleared", FIRST_PROTOCOL, admission["patient_number"])
        assert await _cards(client) == [FIRST_PROTOCOL]
    r = await client.post(release, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE"), r.text
    assert await _cards(client) == []
    assert [row.patient_id for row in audited(app, "admission.discharge_board_retry")] == \
        [FIRST_PROTOCOL, FIRST_PROTOCOL]
    assert app.state.board_link._identities.get(SLUG, admission["patient_number"]) is None


async def test_the_care_teams_own_patients_and_break_glass_name_the_key(ward, db_session):
    """§4 and D9: the board shows a care team member her patients, and a break-glass session its
    patient, by the key the card carries — the protocol, or a legacy admission's H-number. A HIS
    reference stays beside it, as before."""
    w, client, app = ward
    admitted = await admit(w, client)
    legacy = await _legacy(db_session, app, w)
    doctor = w.users["doctor"]
    rows = (await db_session.execute(select(Admission))).scalars().all()
    for row in rows:
        db_session.add(CareTeamMember(admission_id=row.id, user_id=doctor.id, role=CareTeamRole.ATTENDING))
    await db_session.commit()
    assert sorted(await read_own_patient_ids(db_session, doctor.id, w.tenant.id)) == \
        sorted([FIRST_PROTOCOL, LEGACY])

    new_patient = (await db_session.execute(select(Admission.patient_id)
                                            .where(Admission.protocol_no == FIRST_PROTOCOL))).scalar_one()
    nurse = w.users["nurse"]
    for patient_id in (new_patient, legacy.patient_id):
        db_session.add(BreakGlassSession(
            tenant_id=w.tenant.id, user_id=nurse.id, patient_id=patient_id,
            reason=BreakGlassReason.CARDIAC_ARREST,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)))
    await db_session.commit()
    assert sorted(await break_glass_in_tenant(db_session, nurse.id, w.tenant.id)) == \
        sorted([FIRST_PROTOCOL, LEGACY])
    assert admitted["patient_number"] not in await break_glass_in_tenant(db_session, nurse.id, w.tenant.id)
```

**Edit** `homunculus-engine/tests/test_kabul_boardlink.py` — replace:

```python
# Aşama B × B1a: the app's link is handed the shadow lane's hooks and card builders, by reference.
```

with:

```python
def test_the_monitor_strip_links_a_device_to_a_protocol_keyed_card(tmp_path):
    """G2-B1d (spec §4, O74): a new admission's card is keyed by its protocol number. The strip's
    occupants are the identity store's own keys by `bed_id`, so the monitor on its bed feeds that
    card with no change to Lane A's code."""
    identities = InMemoryIdentityStore()
    identities.apply(SHADOW_HOSPITAL, record(number="202600000001", bed_id="bed-b2", unit_id="unit-2"))
    client, clock, _ = shadow_app(tmp_path, identities=identities)
    shadow_post(client, clock)
    beds = {b["bed_label"]: b for b in shadow_board(client)["beds"]}
    assert (beds["B-2"]["link"], beds["B-2"]["patient_id"]) == ("one", "202600000001")


# Aşama B × B1a: the app's link is handed the shadow lane's hooks and card builders, by reference.
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_board_key.py tests/test_kabul_boardlink.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)"
```

Expected: the six new DB tests fail — the discharge's board steps run under the H-number (`is_discharged(SLUG, '202600000001')` False), the rows have no `board_key` (`KeyError`), the release's detail has no `board_key`, own patients and break-glass name the H-number. The strip test PASSES already (it pins O74: nothing to change there); the rest of `test_kabul_boardlink.py` passes.

- [ ] **Step 3: The answers.** **Edit** `homunculus-engine/src/homunculus/admission/schemas.py` — replace:

```python
    (never a UUID). `display_name` is PHI, as on the board, for holders of admissions.view."""
    patient_number: str
    display_name: str
```

with:

```python
    (never a UUID). `display_name` is PHI, as on the board, for holders of admissions.view.
    `board_key` (G2-B1d) is the card's key: what a screen matches the board with."""
    patient_number: str
    board_key: str
    display_name: str
```

and after the class `AdmissionRow` (before the line `#: The patient's retirement from the alert world at a discharge`) add:

```python
class AdmissionDetail(AdmissionResponse):
    """GET /admissions/{id} (G2-B1d, E5): the admission with its two numbers — never a name (the
    patient's identity is `/patient`'s)."""
    patient_number: str
    board_key: str


```

- [ ] **Step 4: The admission router.** Every edit in `homunculus-engine/src/homunculus/admission/router.py`.

**Edit** (1) the schema import — replace:

```python
    AdmissionCreate, AdmissionNoteFields, AdmissionResponse, AdmissionRow, AdmitResponse,
```

with:

```python
    AdmissionCreate, AdmissionDetail, AdmissionNoteFields, AdmissionResponse, AdmissionRow,
    AdmitResponse,
```

**Edit** (2) the list's rows — replace:

```python
    return [AdmissionRow(**AdmissionResponse.model_validate(a).model_dump(),
                         patient_number=number, display_name=name, bed_label=label,
                         room_name=room, unit_name=unit)
            for a, number, name, label, room, unit in rows]
```

with:

```python
    return [AdmissionRow(**AdmissionResponse.model_validate(a).model_dump(),
                         patient_number=number, board_key=board_key(a.protocol_no, number),
                         display_name=name, bed_label=label, room_name=room, unit_name=unit)
            for a, number, name, label, room, unit in rows]
```

**Edit** (3) the detail — replace:

```python
@router.get("/{admission_id}", response_model=AdmissionResponse,
            dependencies=[Depends(require_permission("admissions.view"))])
async def get_admission(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    return await _get_admission_or_404(db, admission_id, caller_tenant)
```

with:

```python
@router.get("/{admission_id}", response_model=AdmissionDetail,
            dependencies=[Depends(require_permission("admissions.view"))])
async def get_admission(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    """The admission, its H-number and its board key (G2-B1d, E5)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == admission.patient_id))).scalar_one()
    return AdmissionDetail(**AdmissionResponse.model_validate(admission).model_dump(),
                           patient_number=number,
                           board_key=board_key(admission.protocol_no, number))
```

**Edit** (4) `_number_of` — replace:

```python
async def _number_of(db: AsyncSession, admission: Admission) -> str:
    """The admission's patient number: its board key, and the audit row's patient."""
    return (await db.execute(select(Patient.patient_number)
                             .where(Patient.id == admission.patient_id))).scalar_one()
```

with:

```python
async def _key_of(db: AsyncSession, admission: Admission) -> str:
    """The admission's board key (`board_key`: its protocol, a legacy admission's H-number) — the
    card the board steps act on, the number they log, and the audit row's patient (E4)."""
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == admission.patient_id))).scalar_one()
    return board_key(admission.protocol_no, number)
```

**Edit** (5) its three callers — replace every `number = await _number_of(db, admission)` with `number = await _key_of(db, admission)` (`replace_all`: three occurrences — `sign_off`, `discharge_initiate`, `discharge_confirm`). `grep -n "_number_of" src/homunculus/admission/router.py` then gives nothing.

- [ ] **Step 5: The bed release (E3).** **Edit** `homunculus-engine/src/homunculus/tenant/router.py` (1) — replace:

```python
from homunculus.admission.boardlink import board_link_of
```

with:

```python
from homunculus.admission.boardkey import board_key
from homunculus.admission.boardlink import board_link_of
```

**Edit** `homunculus-engine/src/homunculus/tenant/router.py` (2) — replace:

```python
    discharged = (await db.execute(
        select(Admission.id, Patient.patient_number)
        .join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.bed_id == bed_id, Admission.state == AdmissionState.DISCHARGED)
        .order_by(Admission.updated_at.desc()))).all()
    standing = None
    for admission_id, number in discharged:
        if link.is_discharged(hospital, number):
            continue
        board, alerts = await link.take_off(hospital, number)
        trail.record(request, hospital, "admission.discharge_board_retry", patient_id=number,
                     payload={"admission_id": str(admission_id), "bed_id": str(bed_id),
                              "board": board, "alerts": alerts, "via": via, "actor": actor})
        if board != "ok" and standing is None:
            standing = number
    if standing is not None:
        raise Refusal(409, BOARD_NOT_CLEARED, "A patient of this bed is still on the board: the "
                      "board refused the discharge.", extra={"patient_number": standing})
```

with:

```python
    discharged = (await db.execute(
        select(Admission.id, Admission.protocol_no, Patient.patient_number)
        .join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.bed_id == bed_id, Admission.state == AdmissionState.DISCHARGED)
        .order_by(Admission.updated_at.desc()))).all()
    standing = None
    for admission_id, protocol_no, number in discharged:
        key = board_key(protocol_no, number)          # G2-B1d: the card is under its key (E3)
        if link.is_discharged(hospital, key):
            continue
        board, alerts = await link.take_off(hospital, key)
        trail.record(request, hospital, "admission.discharge_board_retry", patient_id=key,
                     payload={"admission_id": str(admission_id), "bed_id": str(bed_id),
                              "board": board, "alerts": alerts, "via": via, "actor": actor})
        if board != "ok" and standing is None:
            standing = {"patient_number": number, "board_key": key}
    if standing is not None:
        raise Refusal(409, BOARD_NOT_CLEARED, "A patient of this bed is still on the board: the "
                      "board refused the discharge.", extra=standing)
```

and in `_last_card_off`'s docstring replace `\`board_not_cleared\` with that patient's number` with `` `board_not_cleared` with that patient's number and board key``.

- [ ] **Step 6: Own patients and break-glass (D9).** **Edit** `homunculus-engine/src/homunculus/scope/service.py` — replace:

```python
    Since Group 2 · B1a a patient admitted here is on the board under its Homunculus patient
    number (`Patient.patient_number`, in the clear), so both identifiers are returned: the number
    reaches the card a `kabul` admission made, the HIS reference the card the HIS feed made. A
    patient with both is two identifiers, and `own_patients` counts identifiers.
```

with:

```python
    A patient admitted here is on the board under the admission's board key
    (`admission/boardkey.py`: its protocol number since G2-B1d, a legacy admission's H-number), so
    both identifiers are returned: the key reaches the card a `kabul` admission made, the HIS
    reference the card the HIS feed made. A patient with both is two identifiers, and
    `own_patients` counts identifiers.
```

and replace:

```python
    from homunculus.admission.models import Patient

    moment = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(Patient.his_patient_reference, Patient.patient_number,
               CareTeamMember.window_start, CareTeamMember.window_end)
```

with:

```python
    from homunculus.admission.boardkey import board_key
    from homunculus.admission.models import Patient

    moment = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(Patient.his_patient_reference, Patient.patient_number, Admission.protocol_no,
               CareTeamMember.window_start, CareTeamMember.window_end)
```

and replace:

```python
    for his, number, start, end in result.all():
        if _window_open(start, end, moment):
            own.extend(ref for ref in (his, number) if ref and ref not in own)
```

with:

```python
    for his, number, protocol_no, start, end in result.all():
        if _window_open(start, end, moment):
            key = board_key(protocol_no, number)
            own.extend(ref for ref in (his, key) if ref and ref not in own)
```

**Edit** `homunculus-engine/src/homunculus/scope/resolver.py` — replace:

```python
async def break_glass_in_tenant(session, user_id, tenant_id) -> list[str]:
    """Open break-glass patients of this user, restricted to one tenant (session and patient)."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from homunculus.admission.models import Patient
    from homunculus.escalation.models import BreakGlassSession

    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(Patient.his_patient_reference)
        .select_from(BreakGlassSession)
        .join(Patient, BreakGlassSession.patient_id == Patient.id)
        .where(
            BreakGlassSession.user_id == user_id,
            BreakGlassSession.tenant_id == tenant_id,
            Patient.tenant_id == tenant_id,
            BreakGlassSession.expires_at > now,
            BreakGlassSession.closed_at.is_(None),
        )
    )
    return [row[0] for row in result.all() if row[0]]
```

with:

```python
async def break_glass_in_tenant(session, user_id, tenant_id) -> list[str]:
    """Open break-glass patients of this user, restricted to one tenant (session and patient), in
    the identifiers the board uses: the HIS reference, and the board key of each of the patient's
    admissions here (G2-B1d D9: the protocol, a legacy admission's H-number) — without the key a
    session about a patient admitted in Homunculus granted nothing."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from homunculus.admission.boardkey import board_key
    from homunculus.admission.models import Admission, Patient
    from homunculus.escalation.models import BreakGlassSession

    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(Patient.his_patient_reference, Patient.patient_number, Admission.protocol_no,
               Admission.id)
        .select_from(BreakGlassSession)
        .join(Patient, BreakGlassSession.patient_id == Patient.id)
        .outerjoin(Admission, (Admission.patient_id == Patient.id)
                   & (Admission.tenant_id == tenant_id))
        .where(
            BreakGlassSession.user_id == user_id,
            BreakGlassSession.tenant_id == tenant_id,
            Patient.tenant_id == tenant_id,
            BreakGlassSession.expires_at > now,
            BreakGlassSession.closed_at.is_(None),
        )
    )
    out: list[str] = []
    for his, number, protocol_no, admission_id in result.all():
        key = board_key(protocol_no, number) if admission_id is not None else None
        out.extend(ref for ref in (his, key) if ref and ref not in out)
    return out
```

(`tests/test_scope_role_from_groups.py::test_break_glass_in_another_tenant_does_not_reach_this_one` keeps passing unchanged: its patient has no admission, so only its HIS reference is named.)

- [ ] **Step 7: B1a's discharge tests read the card under its key.** In `homunculus-engine/tests/test_discharge_api.py` every `["patient_number"]` names the card, the engine, an audit row's patient, a log line's number or a refusal's number: **Edit** with `replace_all`, old `["patient_number"]`, new `["board_key"]` (about 24 occurrences; the function parameters named `patient_number` are not subscripts and do not change). Then:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
grep -c '\["patient_number"\]' tests/test_discharge_api.py     # 0
```

- [ ] **Step 8: Green.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_board_key.py tests/test_discharge_api.py tests/test_kabul_boardlink.py tests/test_admission_api.py tests/test_protocol_admission.py tests/test_unit_scope.py tests/test_scope_role_from_groups.py tests/test_tenant_isolation.py tests/test_structure_api.py tests/test_api_scope.py 2>&1 | tail -3
```

Expected: all passed. A `test_discharge_api.py` failure that is not a card-key read (Step 7's rule): stop and report it.

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_protocol_board_key.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/src/homunculus/scope/service.py homunculus-engine/src/homunculus/scope/resolver.py homunculus-engine/tests/test_kabul_boardlink.py homunculus-engine/tests/test_discharge_api.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_protocol_board_key.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/src/homunculus/scope/service.py homunculus-engine/src/homunculus/scope/resolver.py homunculus-engine/tests/test_kabul_boardlink.py homunculus-engine/tests/test_discharge_api.py <<'EOF'
feat(admission): sign-off, discharge, the lists, the bed release, own patients and break-glass under board_key

Spec §4: nothing ties an admission to the board through the H-number any more. The discharge's
critical hold, tombstone, retirement and audit rows act on the key; the list and the detail answer
protocol_no and board_key (E5); the bed release finds a standing discharged card under its key and
names it in board_not_cleared (E3, E6); the care team's own patients and break-glass name the key
(D9). A legacy admission keeps its H-number at each. The monitor strip links a protocol-keyed card
unchanged (O74). B1a's discharge tests read the card by board_key.

red: 6 failed — the discharge under the H-number; no board_key on the rows; own patients and
break-glass named the H-number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `POST /admissions/{id}/label` — the label's fields, audited without a name

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Tasks 3, 4.

Spec §6 (printing: who, where, data), D11. `admissions.admit`, the admission's bed in the caller's units (the admission router's own scope refusals: 404 for another tenant's, 403 `out_of_scope`). The answer is exactly the label's fields — the protocol, the full name (never masked: a label is paper, D-§6), birth date, sex, the bed's room's unit name, the bed label — and the tenant's label settings (the defaults when the tenant has no row). POST because every print is an audited act: `admission.label_print` (who, the admission, its protocol, `reprint`; **no name**), after the read. An admission without a protocol has no label: 409 `no_protocol`.

**Files:**
- Create: `homunculus-engine/tests/test_admission_label.py`
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_admission_label.py`:

```python
# homunculus-engine/tests/test_admission_label.py
"""The protocol label's data (G2-B1d, spec §6, D11): `admissions.admit` in the caller's units; the
answer is exactly the label's fields and the tenant's label settings; every print is audited
`admission.label_print` — who, the admission, its protocol, a reprint or not — and never the name;
an admission without a protocol has no label (409 `no_protocol`). Postgres. Synthetic ward."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import delete, update

from homunculus.protocol.models import ProtocolSettings
from tests.conftest import requires_db
from tests.kabul_world import FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form
from tests.test_protocol_board_key import _legacy

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def printed(app) -> list:
    return app.state.audit.records(tenant=SLUG, event_type="admission.label_print", limit=50)


async def _admitted(w, client) -> dict:
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_label_carries_its_fields_and_the_tenants_settings(ward, db_session):
    w, client, _ = ward
    await db_session.execute(update(ProtocolSettings).values(label_width_mm=60, label_height_mm=40,
                                                             printer_dpi=300))
    await db_session.commit()
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": False},
                          headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    assert r.json() == {"protocol_no": FIRST_PROTOCOL, "display_name": "Sentetik Hasta",
                        "date_of_birth": "1970-05-05", "sex": "female", "unit_name": "Reanimasiya",
                        "bed_label": "1", "label": {"width_mm": 60, "height_mm": 40, "printer_dpi": 300}}


async def test_without_a_settings_row_the_label_is_the_default_50_by_30(ward, db_session):
    w, client, _ = ward
    admission = await _admitted(w, client)
    await db_session.execute(delete(ProtocolSettings))
    await db_session.commit()
    r = await client.post(f"/admissions/{admission['id']}/label", headers=w.auth["nurse"])
    assert r.json()["label"] == {"width_mm": 50, "height_mm": 30, "printer_dpi": 203}


async def test_every_print_is_audited_with_its_protocol_and_never_the_name(ward):
    w, client, app = ward
    admission = await _admitted(w, client)
    for reprint in (False, True):
        r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": reprint},
                              headers=w.auth["nurse"])
        assert r.status_code == 200, r.text
    rows = printed(app)
    assert [(row.patient_id, row.payload) for row in rows] == [
        (FIRST_PROTOCOL, {"admission_id": admission["id"], "protocol_no": FIRST_PROTOCOL,
                          "reprint": reprint, "actor": "nurse@kabul.example.com"})
        for reprint in (False, True)]
    assert "Sentetik" not in repr([row.payload for row in rows])


async def test_an_admission_without_a_protocol_has_no_label(ward, db_session):
    w, client, app = ward
    legacy = await _legacy(db_session, app, w)
    r = await client.post(f"/admissions/{legacy.id}/label", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "no_protocol")
    assert printed(app) == []


@pytest.mark.parametrize("who, status", [("nurse_b", 403), ("doctor", 403), ("auditor", 403)])
async def test_only_admissions_admit_within_the_beds_units_prints(ward, who, status):
    """nurse_b holds admissions.admit for Neonatal only: the bed is Reanimasiya's (out_of_scope);
    the physician and the auditor hold no admissions.admit."""
    w, client, app = ward
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", headers=w.auth[who])
    assert r.status_code == status, r.text
    assert printed(app) == []


async def test_a_body_field_it_does_not_know_is_refused(ward):
    w, client, _ = ward
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": "evet"},
                          headers=w.auth["nurse"])
    assert r.status_code == 422
    r = await client.post(f"/admissions/{admission['id']}/label", json={"copies": 2},
                          headers=w.auth["nurse"])
    assert r.status_code == 422
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_label.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)"
```

Expected: every test fails on `405 Method Not Allowed` or `404` (no such route) — e.g. `assert 405 == 200`.

- [ ] **Step 3: The schemas.** **Edit** `homunculus-engine/src/homunculus/admission/schemas.py` — after the class `AdmissionDetail` (Task 5) add:

```python
class LabelAsk(BaseModel):
    """POST /admissions/{id}/label (G2-B1d, spec §6): a first print or a reprint."""
    model_config = ConfigDict(extra="forbid")

    reprint: bool = Field(default=False, strict=True)


class LabelSettings(BaseModel):
    width_mm: int
    height_mm: int
    printer_dpi: int


class LabelResponse(BaseModel):
    """Exactly what the label prints (spec §6): the protocol, the FULL name — paper is never
    masked — birth date, sex, the unit and the bed; and the tenant's label settings."""
    protocol_no: str
    display_name: str
    date_of_birth: str
    sex: str
    unit_name: str
    bed_label: str
    label: LabelSettings


```

- [ ] **Step 4: The route.** Every edit in `homunculus-engine/src/homunculus/admission/router.py`.

**Edit** (1) the schema import — replace:

```python
    EngineWrite, EngineWrites, HandoverOpen, HandoverResponse, HandoverSign,
```

with:

```python
    EngineWrite, EngineWrites, HandoverOpen, HandoverResponse, HandoverSign, LabelAsk,
    LabelResponse, LabelSettings,
```

**Edit** (2) the errors import — replace:

```python
    BED_CLOSED, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, REQUEST_CONFLICT,
    TRANSFER_UNAVAILABLE, Refusal, field_invalid,
```

with:

```python
    BED_CLOSED, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, NO_PROTOCOL, REQUEST_CONFLICT,
    TRANSFER_UNAVAILABLE, Refusal, field_invalid,
```

**Edit** (3) the models import — after the line `from homunculus.protocol.numbers import next_protocol_no` (Task 4) add:

```python
from homunculus.protocol.models import ProtocolSettings
```

**Edit** (4) the route, before the care-team section — replace:

```python
# ---------------------------------------------------------------------------
# Care team (§4.2–4.3)
# ---------------------------------------------------------------------------
```

with:

```python
# ---------------------------------------------------------------------------
# The protocol label (Group 2 · B1d, spec §6)
# ---------------------------------------------------------------------------
#: The label a tenant with no settings row prints (spec D6): 50×30 mm, 203 dpi.
_DEFAULT_LABEL = LabelSettings(width_mm=50, height_mm=30, printer_dpi=203)


@router.post("/{admission_id}/label", response_model=LabelResponse)
async def admission_label(
    admission_id: uuid.UUID,
    request: Request,
    payload: LabelAsk | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.admit")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1d (spec §6, D11): the label's fields, for a holder of `admissions.admit` whose units
    hold the admission's bed (the unit is the bed's room's, A-12). An admission without a protocol
    (one opened before 0015) has no label: 409 `no_protocol`. Every print is audited
    `admission.label_print` — who, the admission, its protocol, `reprint` — never the name, after
    the read (it never raises, A-26). Nothing is written in the database."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    if admission.protocol_no is None:
        raise Refusal(409, NO_PROTOCOL, "This admission has no protocol number, so no label.").http()
    name, born, sex, bed_label, unit_name = (await db.execute(
        select(Patient.display_name, Patient.date_of_birth, Patient.sex, Bed.label, Unit.name)
        .select_from(Admission)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .join(Unit, Unit.id == Room.unit_id)
        .where(Admission.id == admission.id))).one()
    settings = await db.get(ProtocolSettings, caller_tenant)
    label = _DEFAULT_LABEL if settings is None else LabelSettings(
        width_mm=settings.label_width_mm, height_mm=settings.label_height_mm,
        printer_dpi=settings.printer_dpi)
    answer = LabelResponse(protocol_no=admission.protocol_no, display_name=name,
                           date_of_birth=born, sex=sex, unit_name=unit_name, bed_label=bed_label,
                           label=label)
    hospital = await trail.hospital_of(db, caller_tenant)
    reprint, actor = bool(payload and payload.reprint), user.username
    await db.commit()
    trail.record(request, hospital, "admission.label_print", patient_id=answer.protocol_no,
                 payload={"admission_id": str(admission.id), "protocol_no": answer.protocol_no,
                          "reprint": reprint, "actor": actor})
    return answer


# ---------------------------------------------------------------------------
# Care team (§4.2–4.3)
# ---------------------------------------------------------------------------
```

Also add `* admissions.admit           print an admission's protocol label (G2-B1d)` under the module docstring's permission list, after the line `  * admissions.admit           open an admission`.

- [ ] **Step 5: The tables that walk every route.** **Edit** `homunculus-engine/tests/test_route_permissions.py` (1) — replace:

```python
    ("POST", "/admissions/{admission_id}/sign-off"): ANY("admissions.sign_off"),
```

with:

```python
    ("POST", "/admissions/{admission_id}/sign-off"): ANY("admissions.sign_off"),
    ("POST", "/admissions/{admission_id}/label"): ANY("admissions.admit"),     # G2-B1d
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` (2) — replace `assert len(EXPECTED) == 61` with `assert len(EXPECTED) == 62`.

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` — replace:

```python
    "sign-off": ById("POST", lambda s: f"/admissions/{s.admission}/sign-off", control=409),
```

with:

```python
    "sign-off": ById("POST", lambda s: f"/admissions/{s.admission}/sign-off", control=409),
    # G2-B1d: the side's admission is a legacy one (made by the service, no protocol) — the
    # caller's own gets past the tenant and unit checks to the 409 `no_protocol`.
    "label": ById("POST", lambda s: f"/admissions/{s.admission}/label", lambda a: {"reprint": False}, 409),
```

- [ ] **Step 6: Green.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_label.py tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_admission_api.py 2>&1 | tail -3
```

Expected: all passed — the new file's 8 (3 parametrised).

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_admission_label.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_admission_label.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py <<'EOF'
feat(admission): POST /admissions/{id}/label — the label's fields and settings, every print audited without a name

admissions.admit within the bed's units (D11); exactly the protocol, the full name, birth date,
sex, unit and bed, and the tenant's label size and dpi (the 50x30 / 203 default without a row).
admission.label_print names the admission, its protocol and reprint — never the name. No protocol,
no label: 409 no_protocol. Route permissions 61 → 62; the isolation walk's BY_ID gains it.

red: 8 failed — no such route (405)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: `POST /edge/patient-query` — the device's one read: one exact number, the name or «not found»

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** nothing of Tasks 1–6 (it reads the identity store, which the admission writes under the card key). **Lane A review hunk:** `api/app.py`, the three lines Step 5 adds after Task 3's `app.include_router(protocol_router)`; and `api/edge_query.py` whole — send both to the controller before the merge.

Spec §5.1 (as amended `da9c95b`; branch head `e86835c`), D3, D4, D12, E2, E7, E14. The route is the bridge's: only a device credential (`_caller` → `Caller.is_device`, else 403), the device's own hospital, the body `{"id": "<number>"}` (POST keeps the number out of access logs), one exact match — no list, no prefix, no search. It reads the board identity record (`identities.get(hospital, id)`: the record the admission wrote under the card key, or a Comed-fed one): none, a tombstone, or a HIS record in state discharged → `{"found": false}` (D4); else `{"found": true, family, given, birth_date, sex}` — always the name (D3). **Any exception** of the store or of `is_tombstone` → 503, never `found: false` (Lane A, 2026-11-01): after Lane A's bounds slice the Postgres store raises within a few seconds on a stalled database, and "we cannot answer" must not read as "patient unknown". Logged by class only (E14). nginx never proxies `/edge` (D12): the API publishes no port, the bridge reaches it on the compose network (`http://api:8000`).

**Files:**
- Create: `homunculus-engine/tests/test_edge_patient_query.py`
- Create: `homunculus-engine/src/homunculus/api/edge_query.py` **(Lane A review)**
- Modify: `homunculus-engine/src/homunculus/api/app.py` **(Lane A review)**
- Modify: `homunculus-engine/tests/test_nginx_routes.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_edge_patient_query.py`:

```python
# homunculus-engine/tests/test_edge_patient_query.py
"""The bridge's patient query (G2-B1d, spec §5.1 as amended, D3, D4, D12): POST /edge/patient-query
takes one exact number from the device credential and answers the board identity's name, birth
date and sex — always the name (D3) — or `found: false` for no record, a `kabul` tombstone or a
HIS record discharged (D4). A clinician's JWT is refused (403), a bad body is 400, and a store that
raises is 503 — never `found: false`, and never logged with the number (E14). No database: the
app's in-memory identity store. Synthetic numbers and names only."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.admission.boardlink import kabul_record
from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore

HOSPITAL = "HOSP1"
DEVICE = {"Authorization": "Bearer device-token"}
NURSE = {"Authorization": "Bearer jwt-nurse"}
URL = "/edge/patient-query"
NUMBER = "202600000001"
T0 = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


async def _resolve_jwt(credential: str) -> Caller | None:
    if credential == "jwt-nurse":
        return Caller(hospital=HOSPITAL, actor="hemsire", perms=frozenset({"board.view"}))
    return None


def _client(identities) -> TestClient:
    app = create_app({"device-token": HOSPITAL, "other-device": "HOSP2"}, run_escalation_loop=False,
                     identities=identities, resolve_jwt=_resolve_jwt)
    return TestClient(app)


def _admitted(number: str = NUMBER) -> IdentityRecord:
    return kabul_record(patient_number=number, display_name="Test Hasta", birth_date=date(1970, 5, 5),
                        sex="female", bed_label="1", bed_id="bed-1", unit_id="unit-1", at=T0)


@pytest.fixture
def store() -> InMemoryIdentityStore:
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _admitted())
    return identities


def test_a_known_number_is_answered_with_the_name_birth_date_and_sex(store):
    r = _client(store).post(URL, json={"id": NUMBER}, headers=DEVICE)
    assert r.status_code == 200, r.text
    assert r.json() == {"found": True, "family": "", "given": "Test Hasta",
                        "birth_date": "1970-05-05", "sex": "female"}


def test_a_comed_fed_record_is_answered_the_same_way():
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="20239121", family="HASTA", given="TEST",
                                              birth_date="1980-01-15", sex="male", state="admitted",
                                              source="comed", updated_at=T0))
    r = _client(identities).post(URL, json={"id": "20239121"}, headers=DEVICE)
    assert r.json() == {"found": True, "family": "HASTA", "given": "TEST",
                        "birth_date": "1980-01-15", "sex": "male"}


@pytest.mark.parametrize("asked", ["202600000002", "20260000000", NUMBER + "0", " " + NUMBER,
                                   "2026000000"])
def test_any_other_number_is_not_found_exact_match_only(store, asked):
    r = _client(store).post(URL, json={"id": asked}, headers=DEVICE)
    assert (r.status_code, r.json()) == (200, {"found": False})


def test_a_discharged_admission_is_not_found(store):
    """D4: a tombstone keeps the name (A-16) — the device must never be shown it."""
    store.apply(HOSPITAL, IdentityRecord(patient_id=NUMBER, state="discharged", source=KABUL,
                                         updated_at=T0 + timedelta(hours=1)))
    r = _client(store).post(URL, json={"id": NUMBER}, headers=DEVICE)
    assert r.json() == {"found": False}


def test_a_his_discharged_record_is_not_found():
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="20239121", family="HASTA", given="TEST",
                                              state="discharged", source="comed", updated_at=T0))
    r = _client(identities).post(URL, json={"id": "20239121"}, headers=DEVICE)
    assert r.json() == {"found": False}


def test_another_hospitals_device_never_sees_this_hospitals_patient(store):
    r = _client(store).post(URL, json={"id": NUMBER}, headers={"Authorization": "Bearer other-device"})
    assert r.json() == {"found": False}


def test_only_a_device_asks(store):
    client = _client(store)
    assert client.post(URL, json={"id": NUMBER}, headers=NURSE).status_code == 403
    assert client.post(URL, json={"id": NUMBER}).status_code == 401
    assert client.post(URL, json={"id": NUMBER}, headers={"Authorization": "Bearer nope"}).status_code == 401


@pytest.mark.parametrize("sent", [{}, {"id": ""}, {"id": 202600000001}, {"id": None},
                                  {"id": "9" * 65}, ["202600000001"], "202600000001"])
def test_a_body_that_is_not_one_number_is_400(store, sent):
    r = _client(store).post(URL, json=sent, headers=DEVICE)
    assert r.status_code == 400, r.text


def test_a_body_that_is_not_json_is_400(store):
    r = _client(store).post(URL, content=b"id=202600000001", headers={**DEVICE, "Content-Type": "text/plain"})
    assert r.status_code == 400


class _Stalled(InMemoryIdentityStore):
    """A store whose read fails as Lane A's bounded Postgres store does on a stalled database,
    the number in its words as SQLAlchemy puts the statement's parameters there."""

    def get(self, hospital, patient_id):
        raise RuntimeError(f"OperationalError: canceling statement [parameters: ('{patient_id}',)]")


def test_a_store_that_raises_is_503_never_not_found_and_the_number_is_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    r = _client(_Stalled()).post(URL, json={"id": NUMBER}, headers=DEVICE)
    assert r.status_code == 503, r.text
    assert "found" not in r.text
    assert not any(NUMBER in rec.getMessage() or (rec.exc_text and NUMBER in rec.exc_text)
                   for rec in caplog.records)
    assert any("RuntimeError" in rec.getMessage() for rec in caplog.records)


def test_a_tombstone_check_that_raises_is_503_too(store, monkeypatch):
    import homunculus.api.edge_query as edge_query

    def broken(record):
        raise ValueError("a record the predicate cannot read")

    monkeypatch.setattr(edge_query, "is_tombstone", broken)
    assert _client(store).post(URL, json={"id": NUMBER}, headers=DEVICE).status_code == 503
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_patient_query.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)" | tail -5
```

Expected: every test fails on `404` (no such route), the last one with `ModuleNotFoundError: No module named 'homunculus.api.edge_query'`.

- [ ] **Step 3: The route.** **Write** `homunculus-engine/src/homunculus/api/edge_query.py`:

```python
# homunculus-engine/src/homunculus/api/edge_query.py
"""The bridge's patient query (Group 2 · B1d, spec §5.1, D3, D4, D12).

A Connex Spot's typed or scanned id reaches NCE, which asks its patient-query host — our bridge —
with a QBP^Q22; the bridge asks this route. It is the device credential's first READ: the name,
birth date and sex of one exact number. That credential already writes vitals and identities
(/ingest); the route stays closed to the outside all the same (nginx never proxies /edge, D12),
takes the number in a POST body (never in a URL, so never in an access log) and never logs it.

    POST /edge/patient-query   {"id": "<number>"}
      → 200 {"found": true, "family", "given", "birth_date", "sex"}   always the name (D3)
      → 200 {"found": false}       no record, a `kabul` tombstone, a HIS record discharged (D4)
      → 400 a body that is not one non-empty string of at most 64 characters
      → 401 / 403 no credential / not a device
      → 503 the identity store (or the tombstone check) raised: "we cannot answer" is never
            "patient unknown" — the bridge then answers from its own mirror (D8)

`create_app` builds it with its own `_caller` and identity store (a factory: `_caller` is a
closure of `create_app`, E2). Reading the sync store from this async route is the app's own
pattern (/ingest does it); Lane A's bounds slice makes a stalled Postgres store raise within
seconds, and the bridge's own 2 s timeout covers the rest.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Header, HTTPException, Request

from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityStore, is_tombstone

log = logging.getLogger(__name__)

#: The longest id a query may carry: a protocol number is 12, a Comed one shorter; 64 is the board
#: key's own bound and keeps a hostile body small.
MAX_ID = 64
_DISCHARGED = "discharged"


def edge_query_router(*, caller: Callable[[str | None], Awaitable[Caller]],
                      identities: IdentityStore) -> APIRouter:
    """The route, bound to the app's caller resolver and identity store."""
    router = APIRouter()

    @router.post("/edge/patient-query", tags=["edge"])
    async def patient_query(request: Request, authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        if not who.is_device:
            raise HTTPException(status_code=403, detail="the patient query requires a device token")
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(status_code=400, detail="the body is one JSON object") from None
        asked = body.get("id") if isinstance(body, dict) else None
        if not isinstance(asked, str) or not asked or len(asked) > MAX_ID:
            raise HTTPException(status_code=400, detail="id: one non-empty string of at most 64")
        try:
            record = identities.get(who.hospital, asked)
            gone = record is None or is_tombstone(record) or record.state == _DISCHARGED
        except Exception as exc:  # noqa: BLE001 — any failure is "cannot answer", never "unknown"
            # The class only: a database error's words carry the statement's parameters — the
            # number asked (E14).
            log.error("patient query: the identity store did not answer (%s); answered 503",
                      type(exc).__name__)
            raise HTTPException(status_code=503, detail="the identity store did not answer") from None
        if gone:
            return {"found": False}
        return {"found": True, "family": record.family, "given": record.given,
                "birth_date": record.birth_date, "sex": record.sex}

    return router
```

- [ ] **Step 4: Red again, for the mount:** the Step 2 command — the module imports now; every route test still fails on `404`.

- [ ] **Step 5: Mount it — the Lane A hunk.** **Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:

```python
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
```

with:

```python
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
    # G2-B1d (spec §5, D12): the bridge's patient query — the device token only, never proxied by
    # nginx. `_caller` is defined below; the lambda reads it when a request arrives (E2).
    from homunculus.api.edge_query import edge_query_router
    app.include_router(edge_query_router(caller=lambda authorization: _caller(authorization),
                                         identities=identities))
```

- [ ] **Step 6: The two walks that read every route (E7).**

**Edit** `homunculus-engine/tests/test_nginx_routes.py` (1) — replace:

```python
# Paths that must stay with the single-page app.
SPA_PATHS = ["/", "/index.html", "/assets/index-abc.js", "/administrator-guide"]
```

with:

```python
# Paths that must stay with the single-page app.
SPA_PATHS = ["/", "/index.html", "/assets/index-abc.js", "/administrator-guide"]
# API prefixes nginx must NOT proxy: the bridge reaches them on the compose network only
# (G2-B1d, spec D12 — the device's patient query).
NOT_PROXIED = {"/edge"}
```

**Edit** `homunculus-engine/tests/test_nginx_routes.py` (2) — replace:

```python
    missing = sorted(p for p in prefixes if not any(loc.search(p) for loc in _api_locations()))
    assert not missing, f"routers not proxied by nginx: {missing}"
```

with:

```python
    missing = sorted(p for p in prefixes - NOT_PROXIED
                     if not any(loc.search(p) for loc in _api_locations()))
    assert not missing, f"routers not proxied by nginx: {missing}"


def test_the_bridges_patient_query_is_never_proxied() -> None:
    """D12: /edge/patient-query is in the app (the bridge calls it on the compose network) and in
    no location that hands a path to the API — from outside, it is the single-page app's."""
    assert NOT_PROXIED <= _app_prefixes()
    for path in ("/edge", "/edge/patient-query"):
        assert not any(loc.search(path) for loc in _api_locations()), path
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (1) — replace:

```python
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | {
    ("GET", "/health"),
```

with:

```python
# G2-B1d (spec D12): the bridge's patient query — the device credential's own hospital, through
# the app's `_caller`, outside `homunculus.api.app` (api/edge_query.py, E2).
DEVICE_ONLY = {("POST", "/edge/patient-query")}
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | DEVICE_ONLY | {
    ("GET", "/health"),
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (2) — replace:

```python
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD == board
```

with:

```python
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD - DEVICE_ONLY == board
```

- [ ] **Step 7: Green.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_patient_query.py tests/test_nginx_routes.py tests/test_tenant_isolation.py::test_every_route_resolves_the_callers_tenant_unless_unscoped_by_design tests/test_route_permissions.py tests/test_api_identity_ingest.py 2>&1 | tail -3
```

Expected: all passed — the new file's 21 (with its parametrised cases).

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_edge_patient_query.py homunculus-engine/src/homunculus/api/edge_query.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_nginx_routes.py homunculus-engine/tests/test_tenant_isolation.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_edge_patient_query.py homunculus-engine/src/homunculus/api/edge_query.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_nginx_routes.py homunculus-engine/tests/test_tenant_isolation.py <<'EOF'
feat(api): POST /edge/patient-query — the device's one exact number, the name or not found, 503 when the store cannot answer

The device credential only, its own hospital, one exact number in a POST body (spec §5.1, D12):
the board identity's name, birth date and sex — always the name (D3) — or found false for none,
a tombstone or a HIS discharge (D4). Any exception of the store or the tombstone check is 503,
never found false (Lane A's bounds slice), logged by class only (E14). A factory bound to the app's
_caller (E2); nginx never proxies /edge (E7). app.py: one include line (Lane A review).

red: 21 failed — no such route (404); no module homunculus.api.edge_query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: The pdq «not found» outcome; the mirror's `forget` and its lock

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** nothing. **Lane A:** told (O72) — `edge/pdq.py` and `edge/identity.py` are the NCE path's, no Infinity file.

Spec §5 (the last paragraph and point 2), D4, D8, E8. `pdq.patient_query_response`'s lookup answers one of three: a record (found — the name always, D3), `pdq.NOT_FOUND` (the API said no: `MSA|AA`, `QAK|…|NF`, **no PID**, D4), or None (unknown: today's echo of the id without a name, D8). The mirror gains `forget(id)` — a not-found answer removes the row, so a discharged patient's name does not stay on the bridge's disk after the next query for that number (§8) — and a lock around each statement: Task 10 runs the responder on worker threads while `handle_message` writes the mirror on the loop (E8).

**Files:**
- Modify: `homunculus-engine/tests/test_edge_pdq.py`
- Modify: `homunculus-engine/src/homunculus/edge/pdq.py`
- Modify: `homunculus-engine/tests/test_edge_identity_mirror.py`
- Modify: `homunculus-engine/src/homunculus/edge/identity.py`

- [ ] **Step 1: Write the failing tests.**

**Edit** `homunculus-engine/tests/test_edge_pdq.py` (1) — replace:

```python
from homunculus.edge.mllp import CR, FS, VT, serve_mllp
from homunculus.edge.pdq import patient_query_response
```

with:

```python
from homunculus.edge.mllp import CR, FS, VT, serve_mllp
from homunculus.edge.pdq import NOT_FOUND, patient_query_response
```

**Edit** `homunculus-engine/tests/test_edge_pdq.py` (2) — replace:

```python
def test_a_lookup_that_raises_degrades_to_the_id_only_answer():
```

with:

```python
def test_a_number_known_not_to_exist_is_answered_not_found_without_a_pid():
    """G2-B1d D4: the API said the number is not one of ours, or has left. The device cannot
    validate it, so the nurse corrects it at the bedside — and no PID means no name to trust."""
    reply = patient_query_response(QBP, lookup=lambda _pid: NOT_FOUND)
    seg = segments(reply)
    assert seg["MSH"][8].startswith("RSP^K22")
    assert seg["MSA"][1:3] == ["AA", "20260903160900123"]     # the query itself was understood
    assert seg["QAK"][1:3] == ["20260903160900123", "NF"]
    assert seg["QPD"][3] == "@PID.3.1^123456A"
    assert "PID" not in seg


def test_not_found_is_the_lookups_answer_only_none_still_echoes_the_id():
    """Three outcomes, three replies: found (the name), NOT_FOUND (NF), None (unknown: the id
    echoed with no name, as before G2-B1d — D8's 'we do not know')."""
    found = segments(patient_query_response(QBP, lookup=known_lookup()))
    unknown = segments(patient_query_response(QBP, lookup=lambda _pid: None))
    assert (found["QAK"][2], found["PID"][5]) == ("OK", "YILMAZ^AYSE")
    assert (unknown["QAK"][2], unknown["PID"][3], unknown["PID"][5]) == ("OK", "123456A", "")
    assert repr(NOT_FOUND) == "NOT_FOUND"


def test_a_lookup_that_raises_degrades_to_the_id_only_answer():
```

**Edit** `homunculus-engine/tests/test_edge_identity_mirror.py` — at the end of the file, add:

```python


# ---------------------------------------------------------------- G2-B1d
def test_a_forgotten_number_is_gone_and_forgetting_twice_is_harmless(tmp_path):
    """Spec §8: an API's 'not found' removes the row, so a discharged patient's name does not
    stay on the bridge's disk after the next query for that number."""
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    mirror.upsert(record(patient_id="20239122"))
    assert mirror.forget("20239121") is True
    assert mirror.get("20239121") is None
    assert mirror.forget("20239121") is False
    assert mirror.get("20239122") is not None and mirror.count() == 1
    mirror.close()


def test_the_mirror_takes_reads_and_writes_from_several_threads_at_once(tmp_path):
    """E8: the patient query runs on worker threads (edge/mllp.py) while the ADT handler writes on
    the event loop: one connection, its statements one at a time."""
    import threading

    mirror = IdentityMirror(tmp_path / "identity.db")
    failures: list[BaseException] = []

    def work(n: int) -> None:
        try:
            for i in range(60):
                pid = f"9{n}{i:03d}"
                mirror.upsert(record(patient_id=pid))
                assert mirror.get(pid) is not None
                if i % 2:
                    mirror.forget(pid)
                mirror.count()
        except BaseException as exc:  # noqa: BLE001 — collected, asserted below
            failures.append(exc)

    threads = [threading.Thread(target=work, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert failures == []
    assert mirror.count() == 4 * 30
    mirror.close()
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_pdq.py tests/test_edge_identity_mirror.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)|Error" | head
```

Expected: `ImportError: cannot import name 'NOT_FOUND' from 'homunculus.edge.pdq'` (test_edge_pdq.py, collection error) and `FAILED …forgotten_number…` and `FAILED …several_threads…` with `AttributeError: 'IdentityMirror' object has no attribute 'forget'`.

- [ ] **Step 3: The three outcomes.** Every edit in `homunculus-engine/src/homunculus/edge/pdq.py`.

**Edit** (1) the module docstring — replace:

```python
An optional `lookup` (typically `IdentityMirror.get`) supplies what the HIS said about that id —
name, date of birth, sex — so the device can show the clinician the patient and let them confirm
the bed. Without a hit, or without a `lookup` at all, only the id comes back; nothing is guessed.
```

with:

```python
An optional `lookup` answers one of three (G2-B1d, spec §5): a record — name, date of birth, sex,
what the admission or the HIS said about that id — so the device can show the clinician the
patient and let them confirm the bed; `NOT_FOUND` — the API said the number is not one of ours,
or has left (D4): `QAK … NF` and no PID, and the nurse corrects the number at the bedside; or
None — nobody could say (no lookup, a mirror miss, the API unreachable, D8): only the id comes
back, as before. Nothing is guessed.
```

**Edit** (2) — replace:

```python
# FHIR AdministrativeGender -> HL7 table 0001, for the answer we hand back to the device.
_FHIR_SEX_TO_HL7 = {"male": "M", "female": "F", "other": "O", "unknown": "U"}
```

with:

```python
# FHIR AdministrativeGender -> HL7 table 0001, for the answer we hand back to the device.
_FHIR_SEX_TO_HL7 = {"male": "M", "female": "F", "other": "O", "unknown": "U"}


class _NotFound:
    """The lookup's definite «not one of ours» (G2-B1d D4) — distinct from None, «nobody knows»."""

    def __repr__(self) -> str:
        return "NOT_FOUND"


NOT_FOUND = _NotFound()
```

**Edit** (3) the lookup's signature and docstring — replace:

```python
    lookup: Callable[[str], "PatientIdentity | None"] | None = None,
) -> str | None:
    """An RSP^K22 for a QBP^Q22 query; None for any other message (the caller's handler runs).

    `lookup` maps a protocol number to what the HIS said about it. With a hit, the device shows
    the patient's name and the nurse can confirm they are at the right bed; without one, the id
    is echoed and the reading still flows. A lookup that fails is treated as a miss: a broken
    mirror must never stop a measurement.
    """
```

with:

```python
    lookup: Callable[[str], "PatientIdentity | _NotFound | None"] | None = None,
) -> str | None:
    """An RSP^K22 for a QBP^Q22 query; None for any other message (the caller's handler runs).

    `lookup` maps a number to a record (the device shows the patient's name and the nurse can
    confirm they are at the right bed), to `NOT_FOUND` (`MSA|AA`, `QAK|…|NF`, no PID), or to None
    (the id is echoed and the reading still flows). A lookup that fails is treated as None: a
    broken mirror must never stop a measurement.
    """
```

**Edit** (4) the body — replace:

```python
    name = dob = sex = ""
    if patient_id and lookup is not None:
        try:
            known = lookup(patient_id)
            if known is not None:
                family, given = _safe_text(known.family), _safe_text(known.given)
                name = f"{family}^{given}" if (family or given) else ""
                dob = _hl7_date(known.birth_date)
                sex = _FHIR_SEX_TO_HL7.get(known.sex, "")
        except Exception:                      # a mirror fault degrades, never blocks
            name = dob = sex = ""

    out = [
        "|".join(["MSH", "^~\\&", _at(msh, 4) or "HOMUNCULUS", _at(msh, 5), _at(msh, 2), _at(msh, 3),
                  stamp, "", "RSP^K22^RSP_K21", stamp, "P", _at(msh, 11) or "2.5"]),
        "|".join(["MSA", "AA" if patient_id else "AE", control_id]),
        "|".join(["QAK", query_tag, "OK" if patient_id else "NF"]),
        "|".join(["QPD", _at(qpd, 1), query_tag, f"@PID.3.1^{patient_id}" if patient_id else ""]),
    ]
    if patient_id:
```

with:

```python
    name = dob = sex = ""
    not_found = False
    if patient_id and lookup is not None:
        try:
            known = lookup(patient_id)
            if known is NOT_FOUND:
                not_found = True
            elif known is not None:
                family, given = _safe_text(known.family), _safe_text(known.given)
                name = f"{family}^{given}" if (family or given) else ""
                dob = _hl7_date(known.birth_date)
                sex = _FHIR_SEX_TO_HL7.get(known.sex, "")
        except Exception:                      # a mirror fault degrades, never blocks
            name = dob = sex = ""
            not_found = False
    found = bool(patient_id) and not not_found

    out = [
        "|".join(["MSH", "^~\\&", _at(msh, 4) or "HOMUNCULUS", _at(msh, 5), _at(msh, 2), _at(msh, 3),
                  stamp, "", "RSP^K22^RSP_K21", stamp, "P", _at(msh, 11) or "2.5"]),
        "|".join(["MSA", "AA" if patient_id else "AE", control_id]),
        "|".join(["QAK", query_tag, "OK" if found else "NF"]),
        "|".join(["QPD", _at(qpd, 1), query_tag, f"@PID.3.1^{patient_id}" if patient_id else ""]),
    ]
    if found:
```

- [ ] **Step 4: `forget` and the lock.** Every edit in `homunculus-engine/src/homunculus/edge/identity.py`.

**Edit** (1) — replace:

```python
import logging
import sqlite3
```

with:

```python
import logging
import sqlite3
import threading
```

**Edit** (2) — replace:

```python
        # check_same_thread=False: the runner may write from a worker thread, as the buffer does.
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
```

with:

```python
        # check_same_thread=False: the runner may write from a worker thread, as the buffer does.
        # G2-B1d (E8): the patient query runs on worker threads (edge/mllp.py) while the ADT
        # handler writes on the event loop, so every statement and its commit take this lock.
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._lock = threading.Lock()
```

**Edit** (3) — replace:

```python
    def upsert(self, identity: PatientIdentity) -> bool:
```

with:

```python
    def _write(self, sql: str, params: object = ()) -> sqlite3.Cursor:
        """One statement and its commit, under the lock."""
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def _read_one(self, sql: str, params: object = ()) -> tuple | None:
        """One row of one statement, under the lock."""
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def upsert(self, identity: PatientIdentity) -> bool:
```

**Edit** (4) — replace:

```python
        cur = self._conn.execute(
            "INSERT INTO identity (patient_id, family, given, birth_date, sex,"
```

with:

```python
        cur = self._write(
            "INSERT INTO identity (patient_id, family, given, birth_date, sex,"
```

**Edit** (5) — replace:

```python
            params,
        )
        self._conn.commit()
        if cur.rowcount > 0:
```

with:

```python
            params,
        )
        if cur.rowcount > 0:
```

**Edit** (6) — replace:

```python
    def get(self, patient_id: str) -> PatientIdentity | None:
        row = self._conn.execute(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, at"
            " FROM identity WHERE patient_id = ?", (patient_id,)).fetchone()
```

with:

```python
    def get(self, patient_id: str) -> PatientIdentity | None:
        row = self._read_one(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, at"
            " FROM identity WHERE patient_id = ?", (patient_id,))
```

**Edit** (7) — replace:

```python
    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        """Drop discharged rows older than `ttl`. Returns how many went."""
        cutoff = (to_utc(now) - ttl).isoformat()
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = 'discharged' AND at < ?", (cutoff,))
        self._conn.commit()
        return cur.rowcount

    def count(self) -> int:
        (total,) = self._conn.execute("SELECT count(*) FROM identity").fetchone()
        return int(total)

    def close(self) -> None:
        self._conn.close()
```

with:

```python
    def forget(self, patient_id: str) -> bool:
        """Drop the number's row (G2-B1d, spec §5 point 2, §8): the API answered «not found», so
        the name it had here — a discharged patient's, a mistyped neighbour's — does not stay on
        this disk. True when a row went. The number is never logged."""
        return self._write("DELETE FROM identity WHERE patient_id = ?", (patient_id,)).rowcount > 0

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        """Drop discharged rows older than `ttl`. Returns how many went."""
        cutoff = (to_utc(now) - ttl).isoformat()
        cur = self._write(
            "DELETE FROM identity WHERE state = 'discharged' AND at < ?", (cutoff,))
        return cur.rowcount

    def count(self) -> int:
        (total,) = self._read_one("SELECT count(*) FROM identity")
        return int(total)

    def close(self) -> None:
        with self._lock:
            self._conn.close()
```

- [ ] **Step 5: Green**, with every test of the mirror's users:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_pdq.py tests/test_edge_identity_mirror.py tests/test_edge_bridge_adt.py tests/test_edge_identity_e2e.py tests/test_run_bridge_identity.py tests/test_edge_bridge.py 2>&1 | tail -3
```

Expected: all passed.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_edge_pdq.py homunculus-engine/src/homunculus/edge/pdq.py homunculus-engine/tests/test_edge_identity_mirror.py homunculus-engine/src/homunculus/edge/identity.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_edge_pdq.py homunculus-engine/src/homunculus/edge/pdq.py homunculus-engine/tests/test_edge_identity_mirror.py homunculus-engine/src/homunculus/edge/identity.py <<'EOF'
feat(edge): the patient query's «not found» (QAK NF, no PID) apart from «unknown»; the mirror's forget and its lock

pdq's lookup answers a record, NOT_FOUND or None (spec §5, D4, D8): found carries the name, not
found is MSA AA, QAK NF and no PID, None echoes the id as before. IdentityMirror.forget drops a
number the API said is not ours (§8); every statement and its commit take one lock, as the query
runs on worker threads beside the loop's ADT writes (E8).

red: ImportError NOT_FOUND; AttributeError IdentityMirror.forget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: `edge/pdq_client.py` and `answer_query` — the API first, then the mirror, then the echo

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Tasks 7 (the route's answer, which the client reads), 8 (`NOT_FOUND`, `forget`). **Lane A:** told (O72).

Spec §5.2, D3, D4, D8, §8. The client asks `POST <cloud-url>/edge/patient-query` with the bridge's own `--token` (the device credential `/ingest` already uses), 2 s at most, stdlib `urllib` like `edge/uplink.py`. It answers a `PatientIdentity` (found), `NOT_FOUND`, or raises `QueryUnavailable` (unreachable, timeout, any non-200 — the route's 503 included —, a body that is not the route's answer). `EdgeBridge.answer_query` asks it first: found → the reply with the name, and the answer upserted into the mirror (encrypted, state admitted); not found → `NF` and the number forgotten by the mirror; unavailable → the mirror's answer if it has one, else today's echo without a name. Three counters, and no id in any log line. The 2 s bound is the bridge's own: it protects the device's 10 s even against an API whose store blocks (Lane A's answer 7).

**Files:**
- Create: `homunculus-engine/tests/test_edge_pdq_client.py`
- Create: `homunculus-engine/src/homunculus/edge/pdq_client.py`
- Create: `homunculus-engine/tests/test_edge_bridge_query.py`
- Modify: `homunculus-engine/src/homunculus/edge/bridge.py`

- [ ] **Step 1: Write the failing tests.** **Write** `homunculus-engine/tests/test_edge_pdq_client.py`:

```python
# homunculus-engine/tests/test_edge_pdq_client.py
"""The bridge's client of POST /edge/patient-query (G2-B1d, spec §5.2, D8): the derived URL, the
device token, a JSON body with the one id, 2 s; the three answers — a record, NOT_FOUND, or
QueryUnavailable for anything the bridge cannot trust (no route, a timeout, a non-200, a body that
is not the route's); and no id in the words of a failure. No network: an injected opener."""
from __future__ import annotations

import io
import json
import urllib.error
from datetime import datetime, timezone

import pytest

from homunculus.edge.adt import PatientIdentity
from homunculus.edge.pdq import NOT_FOUND
from homunculus.edge.pdq_client import TIMEOUT_S, PatientQueryClient, QueryUnavailable, query_url

NUMBER = "202600000001"
NOW = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


class _Response(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200) -> None:
        super().__init__(body)
        self.status = status


def _opener(answer=None, *, raises: BaseException | None = None, status: int = 200, raw: bytes | None = None):
    sent: list = []

    def open_(request, timeout):
        sent.append((request, timeout))
        if raises is not None:
            raise raises
        return _Response(raw if raw is not None else json.dumps(answer).encode(), status)

    open_.sent = sent
    return open_


def _client(opener) -> PatientQueryClient:
    return PatientQueryClient("http://api:8000/edge/patient-query", "device-token", opener=opener,
                              clock=lambda: NOW)


def test_the_url_is_the_cloud_url_and_the_route():
    assert query_url("http://api:8000") == "http://api:8000/edge/patient-query"
    assert query_url("https://host/api/") == "https://host/api/edge/patient-query"


def test_a_found_answer_is_a_record_with_the_name_and_the_request_is_the_routes():
    opener = _opener({"found": True, "family": "", "given": "Test Hasta", "birth_date": "1970-05-05",
                      "sex": "female"})
    got = _client(opener).ask(NUMBER)
    assert got == PatientIdentity(patient_id=NUMBER, family="", given="Test Hasta",
                                  birth_date="1970-05-05", sex="female", state="admitted", at=NOW)
    ((request, timeout),) = opener.sent
    assert (request.full_url, request.get_method(), timeout) == (
        "http://api:8000/edge/patient-query", "POST", TIMEOUT_S)
    assert TIMEOUT_S == 2.0
    assert request.get_header("Authorization") == "Bearer device-token"
    assert request.get_header("Content-type") == "application/json"
    assert json.loads(request.data) == {"id": NUMBER}


def test_a_not_found_answer_is_not_found():
    assert _client(_opener({"found": False})).ask(NUMBER) is NOT_FOUND


@pytest.mark.parametrize("opener", [
    _opener(raises=urllib.error.HTTPError("http://api:8000/edge/patient-query", 503, "x", {}, None)),
    _opener(raises=urllib.error.HTTPError("http://api:8000/edge/patient-query", 401, "x", {}, None)),
    _opener(raises=urllib.error.HTTPError("http://api:8000/edge/patient-query", 404, "x", {}, None)),
    _opener(raises=urllib.error.URLError("connection refused")),
    _opener(raises=TimeoutError("timed out")),
    _opener(raises=ConnectionResetError("reset")),
    _opener({"found": True}, status=204),
    _opener(raw=b"<html>not json</html>"),
    _opener(["found"]),
    _opener({"found": "yes"}),
    _opener({"found": True, "family": "", "given": 7, "birth_date": "", "sex": ""}),
    _opener({"found": True, "given": "Test Hasta"}),
], ids=["503", "401", "404", "refused", "timeout", "reset", "204", "html", "list", "found-text",
        "given-int", "fields-missing"])
def test_anything_the_bridge_cannot_trust_is_unavailable_and_never_names_the_id(opener):
    with pytest.raises(QueryUnavailable) as failed:
        _client(opener).ask(NUMBER)
    assert NUMBER not in str(failed.value)
```

**Write** `homunculus-engine/tests/test_edge_bridge_query.py`:

```python
# homunculus-engine/tests/test_edge_bridge_query.py
"""The bridge's answer to a Connex Spot's patient query (G2-B1d, spec §5.2, D3, D4, D8, §8): the
API first — found is the name (and the mirror keeps it, encrypted), not found is QAK NF with no PID
(and the mirror forgets the number) —; the API unable to answer: the mirror's answer, else the id
echoed without a name. Counted apart; no id ever logged; a broken mirror never costs the reply.
No network: a stub in place of PatientQueryClient.ask. Synthetic numbers and names only."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import pytest

from homunculus.crypto import decrypt_phi
from homunculus.edge.adt import PatientIdentity
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.pdq import NOT_FOUND
from homunculus.edge.pdq_client import QueryUnavailable

NUMBER = "202600000001"
NOW = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


def qbp(number: str = NUMBER) -> str:
    """The shape NCE sent on the ward (tests/test_edge_pdq.py), for a synthetic number."""
    return ("MSH|^~\\&|NCE|HOSP|EMR|HIS|20261101080000||QBP^Q22^QBP_Q21|Q1|P|2.6|||AL|NE\r"
            f"QPD|IHE PDQ Query|Q1|@PID.3.1^{number}~@PID3.4^X\r"
            "RCP|I|1^RD\r")


def segments(message: str) -> dict[str, list[str]]:
    return {seg.split("|", 1)[0]: seg.split("|") for seg in message.split("\r") if seg}


def found(number: str = NUMBER) -> PatientIdentity:
    return PatientIdentity(patient_id=number, given="Test Hasta", birth_date="1970-05-05",
                           sex="female", state="admitted", at=NOW)


def asking(answer=None, *, raises: BaseException | None = None):
    asked: list[str] = []

    def ask(number: str):
        asked.append(number)
        if raises is not None:
            raise raises
        return answer

    ask.asked = asked
    return ask


@pytest.fixture
def mirror(tmp_path):
    m = IdentityMirror(tmp_path / "identity.db")
    yield m
    m.close()


def test_a_found_number_is_answered_with_the_name_and_mirrored(mirror):
    ask = asking(found())
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=ask)
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["MSA"][1], seg["QAK"][2], seg["PID"][3], seg["PID"][5]) == ("AA", "OK", NUMBER, "^Test Hasta")
    assert (seg["PID"][7], seg["PID"][8]) == ("19700505", "F")
    assert ask.asked == [NUMBER]
    kept = mirror.get(NUMBER)
    assert (kept.given, kept.state) == ("Test Hasta", "admitted")
    raw = mirror._conn.execute("SELECT given FROM identity").fetchone()[0]
    assert raw != "Test Hasta" and decrypt_phi(raw) == "Test Hasta"           # encrypted at rest
    assert (bridge.stats.queries, bridge.stats.queries_not_found, bridge.stats.queries_api_failed) == (1, 0, 0)


def test_a_number_the_api_does_not_know_is_not_found_and_the_mirror_forgets_it(mirror):
    """D4 and §8: a name the mirror kept from before (a discharged patient's) leaves the disk."""
    mirror.upsert(found())
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=asking(NOT_FOUND))
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["MSA"][1], seg["QAK"][2]) == ("AA", "NF") and "PID" not in seg
    assert mirror.get(NUMBER) is None
    assert (bridge.stats.queries, bridge.stats.queries_not_found, bridge.stats.queries_api_failed) == (1, 1, 0)


def test_the_api_unable_to_answer_is_answered_from_the_mirror(mirror):
    mirror.upsert(found())
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror,
                        query=asking(raises=QueryUnavailable("the API answered 503")))
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["QAK"][2], seg["PID"][5]) == ("OK", "^Test Hasta")
    assert (bridge.stats.queries_not_found, bridge.stats.queries_api_failed) == (0, 1)


@pytest.mark.parametrize("failure", [QueryUnavailable("timeout"), RuntimeError("anything else")])
def test_the_api_unable_to_answer_and_a_mirror_miss_echo_the_id_without_a_name(mirror, failure):
    """D8: 'we do not know' stays distinct from 'not found' — the reading is not lost."""
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=asking(raises=failure))
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["QAK"][2], seg["PID"][3], seg["PID"][5]) == ("OK", NUMBER, "")
    assert bridge.stats.queries_api_failed == 1


def test_without_an_api_the_bridge_answers_as_before(mirror):
    """Capture-only (no --cloud-url): the mirror's answer, else the echo — today's behaviour."""
    mirror.upsert(found("20239121"))
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror)
    assert segments(bridge.answer_query(qbp("20239121")))["PID"][5] == "^Test Hasta"
    assert segments(bridge.answer_query(qbp()))["PID"][5] == ""
    assert segments(EdgeBridge(send=lambda _p: None).answer_query(qbp()))["PID"][3] == NUMBER


def test_a_broken_mirror_never_costs_the_reply():
    class Broken:
        def get(self, _number):
            raise OSError("disk gone")

        def upsert(self, _identity):
            raise OSError("disk gone")

        def forget(self, _number):
            raise OSError("disk gone")

    for answer, qak in ((found(), "OK"), (NOT_FOUND, "NF")):
        bridge = EdgeBridge(send=lambda _p: None, identity=Broken(), query=asking(answer))
        assert segments(bridge.answer_query(qbp()))["QAK"][2] == qak
    bridge = EdgeBridge(send=lambda _p: None, identity=Broken(), query=asking(raises=QueryUnavailable("x")))
    assert segments(bridge.answer_query(qbp()))["PID"][3] == NUMBER


def test_no_id_is_ever_logged(mirror, caplog):
    caplog.set_level(logging.DEBUG)
    for ask in (asking(found()), asking(NOT_FOUND), asking(raises=QueryUnavailable("the API answered 503"))):
        EdgeBridge(send=lambda _p: None, identity=mirror, query=ask).answer_query(qbp())
    assert caplog.records, "the API failure is logged"
    assert not any(NUMBER in rec.getMessage() for rec in caplog.records)
    assert not any("Test Hasta" in rec.getMessage() for rec in caplog.records)
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_pdq_client.py tests/test_edge_bridge_query.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.edge.pdq_client'` (collection errors in both).

- [ ] **Step 3: The client.** **Write** `homunculus-engine/src/homunculus/edge/pdq_client.py`:

```python
# src/homunculus/edge/pdq_client.py
"""The bridge asks the API who a queried number is (Group 2 · B1d, spec §5.2, D8).

    POST <cloud-url>/edge/patient-query   {"id": "<number>"}   Bearer <the bridge's --token>

The same credential the bridge's /ingest uses (a device token); the route is reachable only on the
compose network (D12). Two seconds at most: NCE gives its patient-query host ten, and the bridge
must still answer from its mirror after a slow API. The bound is this client's own, so it holds
even against an API whose store blocks.

`ask` answers a `PatientIdentity` (found: the name always, D3), `pdq.NOT_FOUND` (D4), or raises
`QueryUnavailable` for anything the bridge cannot trust — no route, no answer in time, a status
that is not 200 (the route's 503 included: its store could not answer), a body that is not the
route's. The bridge then answers from its mirror (D8). Stdlib only, as edge/uplink.py.

PHI: the answer holds a name; nothing here logs, and a failure's words never name the id.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone

from homunculus.edge.adt import ADMITTED, PatientIdentity
from homunculus.edge.pdq import NOT_FOUND

QUERY_PATH = "/edge/patient-query"
TIMEOUT_S = 2.0
_FIELDS = ("family", "given", "birth_date", "sex")


class QueryUnavailable(Exception):
    """The API could not answer the query, or answered something the bridge cannot trust. Its
    words name the reason, never the id."""


def query_url(cloud_url: str) -> str:
    """The route's address, derived from the bridge's `--cloud-url` (as `/ingest`'s is)."""
    return cloud_url.rstrip("/") + QUERY_PATH


class PatientQueryClient:
    """`ask(number)`. `opener` and `clock` are injected by the tests."""

    def __init__(self, url: str, token: str, *, timeout: float = TIMEOUT_S,
                 opener: Callable = urllib.request.urlopen,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self.url = url
        self._token = token
        self.timeout = timeout
        self._open = opener
        self._clock = clock

    def ask(self, patient_id: str) -> PatientIdentity | object:
        request = urllib.request.Request(
            self.url, data=json.dumps({"id": patient_id}).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"})
        try:
            with self._open(request, timeout=self.timeout) as response:
                status, body = response.status, response.read()
        except urllib.error.HTTPError as exc:
            raise QueryUnavailable(f"the API answered {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise QueryUnavailable(f"the API could not be reached ({type(exc).__name__})") from None
        if status != 200:
            raise QueryUnavailable(f"the API answered {status}")
        try:
            answer = json.loads(body)
        except ValueError:
            raise QueryUnavailable("the API's answer is not JSON") from None
        if not isinstance(answer, dict) or not isinstance(answer.get("found"), bool):
            raise QueryUnavailable("the API's answer is not a patient-query answer")
        if not answer["found"]:
            return NOT_FOUND
        fields = {name: answer.get(name) for name in _FIELDS}
        if not all(isinstance(value, str) for value in fields.values()):
            raise QueryUnavailable("the API's answer is missing a field")
        return PatientIdentity(patient_id=patient_id, family=fields["family"],
                               given=fields["given"], birth_date=fields["birth_date"],
                               sex=fields["sex"] or "unknown", state=ADMITTED, at=self._clock())
```

- [ ] **Step 4: The bridge.** Every edit in `homunculus-engine/src/homunculus/edge/bridge.py`.

**Edit** (1) — replace:

```python
from homunculus.edge.pdq import patient_query_response
```

with:

```python
from homunculus.edge.pdq import NOT_FOUND, patient_query_response
```

**Edit** (2) — replace:

```python
    queries: int = 0            # QBP^Q22 patient lookups answered (id echoed, nothing invented)
```

with:

```python
    queries: int = 0            # QBP^Q22 patient lookups answered (id echoed, nothing invented)
    queries_not_found: int = 0  # G2-B1d: the API said the number is not ours (QAK NF, D4)
    queries_api_failed: int = 0  # the API could not answer: the mirror's answer, else the echo (D8)
```

**Edit** (3) — replace:

```python
    identity: IdentityMirror | None = None
    identity_source: str = "comed"
    stats: BridgeStats = field(default_factory=BridgeStats)
```

with:

```python
    identity: IdentityMirror | None = None
    identity_source: str = "comed"
    stats: BridgeStats = field(default_factory=BridgeStats)
    #: G2-B1d: who a queried number is, asked of the API first (`PatientQueryClient.ask`); None in
    #: capture-only mode, where the mirror alone answers, as before.
    query: Callable[[str], object] | None = None
```

**Edit** (4) — replace:

```python
    def answer_query(self, message: str) -> str | None:
        """Reply to a patient lookup (QBP^Q22) ourselves; everything else goes to handle_message.

        A Welch Allyn NCE asks its patient-query host to validate the id typed on the device
        before it will put that id into the reading's PID-3. Echoing the id back is what makes a
        manually entered identifier survive into the observation; when Comed has told us who that
        id is, the answer carries the name too and the device shows the patient.
        """
        reply = patient_query_response(
            message, lookup=self.identity.get if self.identity is not None else None)
        if reply is not None:
            self.stats.queries += 1
        return reply
```

with:

```python
    def answer_query(self, message: str) -> str | None:
        """Reply to a patient lookup (QBP^Q22) ourselves; everything else goes to handle_message.

        A Welch Allyn NCE asks its patient-query host to validate the id typed on the device
        before it will put that id into the reading's PID-3. Echoing the id back is what makes a
        manually entered identifier survive into the observation. G2-B1d (spec §5.2): the API is
        asked first — a found number is answered with the name (D3), a number it does not know or
        that has left with QAK NF (D4) —; when it cannot answer, the mirror does, else the id is
        echoed without a name (D8). Called on a worker thread (edge/mllp.py): it may wait up to
        the client's 2 s.
        """
        lookup = self._lookup if (self.query is not None or self.identity is not None) else None
        reply = patient_query_response(message, lookup=lookup)
        if reply is not None:
            self.stats.queries += 1
        return reply

    def _lookup(self, patient_id: str):
        """The API's answer — kept by the mirror when found, forgotten by it when not —, else the
        mirror's. Counted; never logged with the id."""
        if self.query is not None:
            try:
                answer = self.query(patient_id)
            except Exception as exc:  # noqa: BLE001 — "cannot answer" is the mirror's turn (D8)
                self.stats.queries_api_failed += 1
                _log.warning("patient query: the API could not answer (%s); the mirror answers "
                             "(id not logged)", type(exc).__name__)
            else:
                if answer is NOT_FOUND:
                    self.stats.queries_not_found += 1
                    self._mirror("forget", patient_id)
                    return NOT_FOUND
                self._mirror("upsert", answer)
                return answer
        return self.identity.get(patient_id) if self.identity is not None else None

    def _mirror(self, method: str, value: object) -> None:
        """Write the API's answer into the mirror; a mirror fault costs the next offline answer,
        never this reply."""
        if self.identity is None:
            return
        try:
            getattr(self.identity, method)(value)
        except Exception:  # noqa: BLE001
            _log.exception("could not %s in the identity mirror (content not logged)", method)
```

- [ ] **Step 5: Green**, with the bridge's other tests:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_pdq_client.py tests/test_edge_bridge_query.py tests/test_edge_pdq.py tests/test_edge_bridge.py tests/test_edge_bridge_adt.py tests/test_edge_bridge_mllp.py tests/test_edge_bridge_reasons.py tests/test_edge_identity_e2e.py 2>&1 | tail -3
```

Expected: all passed — the two new files' 15 and 8 (with their parametrised cases).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_edge_pdq_client.py homunculus-engine/src/homunculus/edge/pdq_client.py homunculus-engine/tests/test_edge_bridge_query.py homunculus-engine/src/homunculus/edge/bridge.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_edge_pdq_client.py homunculus-engine/src/homunculus/edge/pdq_client.py homunculus-engine/tests/test_edge_bridge_query.py homunculus-engine/src/homunculus/edge/bridge.py <<'EOF'
feat(edge): the patient query asks the API first — the name, or NF and the mirror forgets; the mirror, else the echo, when it cannot answer

pdq_client.py: POST <cloud-url>/edge/patient-query with the bridge's token, 2 s, stdlib urllib;
a record, NOT_FOUND, or QueryUnavailable for anything untrustworthy (spec §5.2). answer_query:
found → the name, mirrored (encrypted); not found → QAK NF, forgotten (§8); unavailable → the
mirror, else the id echoed without a name (D8). queries, queries_not_found, queries_api_failed;
no id logged.

red: collection errors — No module named 'homunculus.edge.pdq_client'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: `serve_mllp` runs the responder off the loop; `run_bridge` wires the client; the walk's probe

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Task 9. **Lane A:** told (O72).

Spec §5.3, §5.2 (the derived URL, the token), §10 (the local walk). `serve_mllp` calls the responder through `asyncio.to_thread`: a 2 s wait on the API holds only its own connection — the ORU traffic of every other connection goes on (NCE waits 10 s for its answer: 8 s of margin). Per connection the messages stay in order (each is awaited before the next is read). The runner builds `PatientQueryClient(query_url(--cloud-url), --token)` — nothing in capture-only mode — and its report line gains the two counters. `scripts/pdq_probe.py` sends one synthetic `QBP^Q22` over MLLP and summarises the reply without the name (unless `--show-name`, for synthetic data on the local walk only).

**Files:**
- Modify: `homunculus-engine/tests/test_edge_bridge_query.py`
- Modify: `homunculus-engine/src/homunculus/edge/mllp.py`
- Modify: `homunculus-engine/tests/test_run_bridge_identity.py`
- Modify: `homunculus-engine/scripts/run_bridge.py`
- Create: `homunculus-engine/tests/test_pdq_probe.py`
- Create: `homunculus-engine/scripts/pdq_probe.py`

- [ ] **Step 1: Write the failing tests.**

**Edit** `homunculus-engine/tests/test_edge_bridge_query.py` (1) — replace:

```python
import logging
from datetime import datetime, timezone

import pytest
```

with:

```python
import asyncio
import logging
import threading
from datetime import datetime, timezone

import pytest

from homunculus.edge.mllp import CR, FS, VT
```

**Edit** `homunculus-engine/tests/test_edge_bridge_query.py` (2) — at the end of the file, add:

```python


# ---------------------------------------------------------------- spec §5.3: no stall
ORU = ("MSH|^~\\&|NCE|HOSP|EMR|HIS|20261101080100||ORU^R01^ORU_R01|R1|P|2.5\r"
       f"PID|||{NUMBER}\r"
       "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F\r")


def frame(message: str) -> bytes:
    return VT + message.encode() + FS + CR


async def test_a_slow_api_holds_its_own_query_and_never_a_reading_on_another_connection(mirror):
    """The API takes its time (up to the client's 2 s in life; here until the test releases it).
    Meanwhile a reading arrives on another connection: it is acknowledged at once, and the query
    is still waiting — the responder runs on a worker thread, not on the event loop."""
    entered, release = threading.Event(), threading.Event()

    def slow(number: str):
        entered.set()
        release.wait(5)
        return found(number)

    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=slow)
    server = await bridge.serve(host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]
    try:
        query_reader, query_writer = await asyncio.open_connection("127.0.0.1", port)
        query_writer.write(frame(qbp()))
        await query_writer.drain()
        assert await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)   # at the API now

        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(frame(ORU))
        await writer.drain()
        ack = await asyncio.wait_for(reader.read(4096), timeout=2)
        assert b"MSA|AA|R1" in ack
        with pytest.raises(TimeoutError):                    # the query has no answer yet
            await asyncio.wait_for(query_reader.read(1), timeout=0.2)

        release.set()
        reply = (await asyncio.wait_for(query_reader.read(4096), timeout=5))[1:-2].decode()
        assert f"PID|||{NUMBER}||^Test Hasta" in reply
        assert (bridge.stats.messages, bridge.stats.queries) == (1, 1)
        for w in (writer, query_writer):
            w.close()
            await w.wait_closed()
    finally:
        release.set()
        server.close()
        await server.wait_closed()
```

**Edit** `homunculus-engine/tests/test_run_bridge_identity.py` — at the end of the file, add:

```python


# ---------------------------------------------------------------- G2-B1d
def test_the_patient_query_asks_the_cloud_url_with_the_bridges_token():
    args = run_bridge.build_parser().parse_args(
        ["--db", "/data/bridge.db", "--cloud-url", "http://api:8000/", "--token", "device-token"])
    ask = run_bridge.query_client(args)
    client = ask.__self__
    assert (client.url, client.timeout) == ("http://api:8000/edge/patient-query", 2.0)
    assert client._token == "device-token"


def test_capture_only_asks_no_api():
    args = run_bridge.build_parser().parse_args(["--db", "/data/bridge.db"])
    assert run_bridge.query_client(args) is None
```

**Write** `homunculus-engine/tests/test_pdq_probe.py`:

```python
# homunculus-engine/tests/test_pdq_probe.py
"""scripts/pdq_probe.py (G2-B1d, the local walk): one synthetic QBP^Q22 in NCE's own shape, and a
summary of the reply that names no patient unless asked (`--show-name`, synthetic data only).
Loaded by path, as tests/test_run_bridge_identity.py loads run_bridge."""
import importlib.util
import pathlib

from homunculus.edge.pdq import NOT_FOUND, patient_query_response, queried_patient_id

_spec = importlib.util.spec_from_file_location(
    "pdq_probe", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "pdq_probe.py")
pdq_probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pdq_probe)


def _known(number):
    from homunculus.edge.adt import PatientIdentity
    return PatientIdentity(patient_id=number, given="Test Hasta", birth_date="1970-05-05", sex="female")


def test_the_query_is_ncess_shape_for_the_number():
    message = pdq_probe.build_qbp("202600000001", control_id="P1")
    qpd = next(s.split("|") for s in message.split("\r") if s.startswith("QPD|"))
    assert queried_patient_id(qpd) == "202600000001"
    assert patient_query_response(message) is not None


def test_the_summary_names_no_patient_unless_asked():
    reply = patient_query_response(pdq_probe.build_qbp("202600000001"), lookup=_known)
    line = pdq_probe.summarise(reply)
    assert line == "MSA=AA QAK=OK PID=evet ad=evet doğum=evet cinsiyet=F"
    assert "Test Hasta" not in line and "202600000001" not in line
    assert "ad=Test Hasta" in pdq_probe.summarise(reply, show_name=True)


def test_not_found_and_the_echo_are_told_apart():
    nf = patient_query_response(pdq_probe.build_qbp("202600000009"), lookup=lambda _n: NOT_FOUND)
    echo = patient_query_response(pdq_probe.build_qbp("202600000009"), lookup=lambda _n: None)
    assert pdq_probe.summarise(nf) == "MSA=AA QAK=NF PID=yok"
    assert pdq_probe.summarise(echo) == "MSA=AA QAK=OK PID=evet ad=yok doğum=yok cinsiyet=-"
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_bridge_query.py tests/test_run_bridge_identity.py tests/test_pdq_probe.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)|Error" | head
```

Expected (it takes ~5 s: the slow stub blocks the loop until its own timeout): `FAILED …a_slow_api_holds_its_own_query…` — `DID NOT RAISE` (the query's reply came before the reading's ack: the loop was held); `FAILED …asks_the_cloud_url…` and `…capture_only…` with `AttributeError: module 'run_bridge' has no attribute 'query_client'`; `test_pdq_probe.py` a collection error (`FileNotFoundError` … `pdq_probe.py`).

- [ ] **Step 3: Off the loop.** **Edit** `homunculus-engine/src/homunculus/edge/mllp.py` (1) — replace:

```python
    `responder`, when given, sees every message first. If it returns a message, that reply is
    sent instead of an ACK and the handler is not called — this is how a query (a QBP^Q22 patient
    lookup) gets an RSP rather than being mistaken for a result and rejected.
    """
```

with:

```python
    `responder`, when given, sees every message first. If it returns a message, that reply is
    sent instead of an ACK and the handler is not called — this is how a query (a QBP^Q22 patient
    lookup) gets an RSP rather than being mistaken for a result and rejected. It runs on a worker
    thread (`asyncio.to_thread`, G2-B1d spec §5.3): a query may wait up to 2 s on the API, and the
    messages of every other connection must not wait with it. One connection's messages stay in
    order — each is answered before the next is read.
    """
```

**Edit** `homunculus-engine/src/homunculus/edge/mllp.py` (2) — replace:

```python
                            reply = responder(message)
```

with:

```python
                            reply = await asyncio.to_thread(responder, message)
```

- [ ] **Step 4: The runner.** Every edit in `homunculus-engine/scripts/run_bridge.py`.

**Edit** (1) — replace:

```python
import sys
from datetime import datetime, timezone
from pathlib import Path
```

with:

```python
import sys
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
```

**Edit** (2) — replace:

```python
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.uplink import UplinkStats, flush_loop
```

with:

```python
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.pdq_client import PatientQueryClient, query_url
from homunculus.edge.uplink import UplinkStats, flush_loop
```

**Edit** (3) — replace:

```python
async def report_loop(bridge: EdgeBridge, buffer: SqliteBuffer, interval: float,
```

with:

```python
def query_client(args: argparse.Namespace) -> Callable[[str], object] | None:
    """G2-B1d (spec §5.2): who a queried number is, asked of the API at `--cloud-url` +
    /edge/patient-query with the `--token` /ingest uses, 2 s at most. None in capture-only mode:
    the mirror alone answers, as before."""
    if not args.cloud_url:
        return None
    return PatientQueryClient(query_url(args.cloud_url), args.token).ask


async def report_loop(bridge: EdgeBridge, buffer: SqliteBuffer, interval: float,
```

**Edit** (4) — replace:

```python
        _log.info("mesaj=%s gözlem=%s reddedilen=%s sorgu=%s adt=%s yoksayılan=%s bayat=%s "
                  "kimlik=%s kimlik_düşen=%s kimlik_bekleyen=%s kuyruk=%s",
                  stats.messages, stats.observations, stats.rejected, stats.queries,
                  stats.adt, stats.adt_ignored, stats.adt_stale, kimlik,
                  up.identity_dropped, up.identity_held, buffer.depth())
```

with:

```python
        _log.info("mesaj=%s gözlem=%s reddedilen=%s sorgu=%s sorgu_NF=%s sorgu_api_hata=%s "
                  "adt=%s yoksayılan=%s bayat=%s kimlik=%s kimlik_düşen=%s kimlik_bekleyen=%s "
                  "kuyruk=%s",
                  stats.messages, stats.observations, stats.rejected, stats.queries,
                  stats.queries_not_found, stats.queries_api_failed,
                  stats.adt, stats.adt_ignored, stats.adt_stale, kimlik,
                  up.identity_dropped, up.identity_held, buffer.depth())
```

**Edit** (5) — replace:

```python
    identity = open_identity_mirror(identity_path(args))
    bridge = EdgeBridge(send=send, mapping=load_mapping(args.mapping), identity=identity)
```

with:

```python
    identity = open_identity_mirror(identity_path(args))
    bridge = EdgeBridge(send=send, mapping=load_mapping(args.mapping), identity=identity,
                        query=query_client(args))
```

- [ ] **Step 5: The probe.** **Write** `homunculus-engine/scripts/pdq_probe.py`:

```python
"""Send one patient query (QBP^Q22) to the bridge, as NCE does, and say what came back.

For the local walk and a bench check (G2-B1d). SYNTHETIC NUMBERS ONLY — never a real patient's:

    python scripts/pdq_probe.py --host 127.0.0.1 --port 2575 --id 202600000001

prints one line, e.g. `MSA=AA QAK=OK PID=evet ad=evet doğum=evet cinsiyet=F`: whether the device
would be shown a name, never the name — unless `--show-name`, which is for synthetic data on a
local stack only. QAK=NF is «not found» (no PID: the nurse corrects the number); PID with ad=yok
is the echo of a bridge that could not ask the API (D8).
"""
from __future__ import annotations

import argparse
import socket
import sys
from datetime import datetime, timezone

VT, FS, CR = b"\x0b", b"\x1c", b"\x0d"


def build_qbp(number: str, control_id: str = "PROBE1") -> str:
    """A QBP^Q22 in the shape NCE sent on the ward (QPD-3 = @PID.3.1^<id>~@PID3.4^X)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return (f"MSH|^~\\&|NCE|HOSP|EMR|HIS|{stamp}||QBP^Q22^QBP_Q21|{control_id}|P|2.6|||AL|NE\r"
            f"QPD|IHE PDQ Query|{control_id}|@PID.3.1^{number}~@PID3.4^X\r"
            "RCP|I|1^RD\r")


def summarise(reply: str, *, show_name: bool = False) -> str:
    """The reply as one line that names no patient (`show_name`: the name, synthetic data only)."""
    seg = {s.split("|", 1)[0]: s.split("|") for s in reply.split("\r") if s}
    at = lambda name, i: seg.get(name, [])[i] if i < len(seg.get(name, [])) else ""  # noqa: E731
    parts = [f"MSA={at('MSA', 1)}", f"QAK={at('QAK', 2)}"]
    if "PID" not in seg:
        return " ".join([*parts, "PID=yok"])
    name = at("PID", 5)
    named = (f"ad={name.replace('^', ' ').strip()}" if show_name and name
             else f"ad={'evet' if name else 'yok'}")
    return " ".join([*parts, "PID=evet", named, f"doğum={'evet' if at('PID', 7) else 'yok'}",
                     f"cinsiyet={at('PID', 8) or '-'}"])


def send(host: str, port: int, message: str, timeout: float = 12.0) -> str:
    """One framed message, one framed answer (NCE waits 10 s; this waits a little longer)."""
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(VT + message.encode("utf-8") + FS + CR)
        data = b""
        while not data.endswith(FS + CR):
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
    return data.lstrip(VT).rstrip(CR).rstrip(FS).decode("utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="One synthetic patient query to the bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2575)
    parser.add_argument("--id", required=True, help="a SYNTHETIC number, e.g. 202600000001")
    parser.add_argument("--show-name", action="store_true",
                        help="print the name too — synthetic data on a local stack only")
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    print(summarise(send(args.host, args.port, build_qbp(args.id)), show_name=args.show_name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Green**, with every MLLP and runner test:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_edge_bridge_query.py tests/test_run_bridge_identity.py tests/test_pdq_probe.py tests/test_edge_mllp.py tests/test_edge_pdq.py tests/test_edge_bridge_mllp.py tests/test_edge_discovery.py tests/test_bridge_import_chain.py 2>&1 | tail -3
```

Expected: all passed, in about a second (the slow stub is released by the test).

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-b1d-be
git add -- homunculus-engine/tests/test_edge_bridge_query.py homunculus-engine/src/homunculus/edge/mllp.py homunculus-engine/tests/test_run_bridge_identity.py homunculus-engine/scripts/run_bridge.py homunculus-engine/tests/test_pdq_probe.py homunculus-engine/scripts/pdq_probe.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_edge_bridge_query.py homunculus-engine/src/homunculus/edge/mllp.py homunculus-engine/tests/test_run_bridge_identity.py homunculus-engine/scripts/run_bridge.py homunculus-engine/tests/test_pdq_probe.py homunculus-engine/scripts/pdq_probe.py <<'EOF'
feat(edge): the MLLP responder runs off the event loop; run_bridge asks the API; a synthetic patient-query probe

serve_mllp calls the responder through asyncio.to_thread (spec §5.3): a 2 s API wait holds its
own connection only — a reading on another is acknowledged at once (pinned). run_bridge builds the
patient-query client from --cloud-url and --token, none in capture-only mode; the report line
gains sorgu_NF and sorgu_api_hata. scripts/pdq_probe.py sends one QBP^Q22 and names no patient
unless --show-name (synthetic data only).

red: the query's reply came before the reading's ack (the loop held); no query_client; no probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: The backend lane's gate

**Lane:** backend (`/c/tmp/g2b-b1d-be`). **Needs:** Tasks 1–10. No code: the lane's suites, the Lane A hunks sent, and the counts written down for Task 18.

- [ ] **Step 1: The no-database suite on 3.12.**

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: no failure. The passed count is the baseline's (2830) plus this lane's no-database tests; the skipped count grows by this lane's database tests.

- [ ] **Step 2: The database suite, in parts** (each call under 10 minutes; the shared database waits for another run's lock by itself):

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
for part in "tests/test_migration_0015_protocol.py tests/test_migration_0012_kabul.py tests/test_migration_0010_schema_parity.py tests/test_audit_postgres.py tests/test_monitor_samples.py" \
            "tests/test_protocol_numbers.py tests/test_protocol_settings.py tests/test_protocol_admission.py tests/test_protocol_board_key.py tests/test_admission_label.py" \
            "tests/test_admission_api.py tests/test_discharge_api.py tests/test_structure_api.py" \
            "tests/test_tenant_isolation.py tests/test_route_permissions.py tests/test_unit_scope.py tests/test_scope_role_from_groups.py tests/test_patient_numbers.py tests/test_admission_workflow.py tests/test_admission_trail.py tests/test_api_discharge.py"; do
  TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $part 2>&1 | tail -1
done
```

Expected: four lines, no `failed`, no `error`. Then the rest of the database tests, those the four parts did not name, in two halves of the remaining `tests/test_*.py` files (list them with `ls tests/test_*.py`, leave out `test_infinity_vm_pilot.py` and the files above) — the whole suite against the database must be green before the merge, as B1a's gate did it.

- [ ] **Step 3: The 3.14 check** — this slice's own files:

```bash
cd /c/tmp/g2b-b1d-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_protocol_numbers.py tests/test_protocol_settings.py tests/test_edge_patient_query.py tests/test_edge_pdq.py tests/test_edge_pdq_client.py tests/test_edge_bridge_query.py tests/test_edge_identity_mirror.py tests/test_edge_mllp.py tests/test_pdq_probe.py tests/test_run_bridge_identity.py tests/test_nginx_routes.py 2>&1 | tail -1
```

Expected: no failure (the database tests skip without `TEST_DATABASE_URL`).

- [ ] **Step 4: Nothing outside the lane's files changed, and no secret or name went in.**

```bash
cd /c/tmp/g2b-b1d-be
git diff --stat feat/g2b-protokol..HEAD | tail -1
git diff --name-only feat/g2b-protokol..HEAD | grep -v '^homunculus-engine/' || echo "engine only"
git diff feat/g2b-protokol..HEAD | grep -nE '^\+.*(Bearer [A-Za-z0-9]{20,}|PHI_ENCRYPTION_KEY=|password=)' || echo "no secret"
```

Expected: `engine only`, `no secret`. Every name in the diff is synthetic («Test Hasta», «Sentetik …»); every number is a made-up one (`202600000001`, `H26…`, `H99…`, `20239121`).

- [ ] **Step 5: The Lane A hunks.** Send the controller:

```bash
cd /c/tmp/g2b-b1d-be
git diff feat/g2b-protokol..HEAD -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/edge_query.py > /c/tmp/homunculus-plans/g2b-b1d/lane-a-review.patch
git diff --stat feat/g2b-protokol..HEAD -- homunculus-engine/src/homunculus/edge homunculus-engine/scripts/run_bridge.py
```

The patch is `app.py`'s two include blocks (Tasks 3, 7) and `edge_query.py`; the stat lists the NCE-path files Lane A is told of (O72). Wait for the controller's word before Task 17 merges the lane.

- [ ] **Step 6: Record.** No commit: write the four counts (Step 1, Step 2's lines, Step 3) into the message to the controller; Task 18 quotes them.

---

### Task 12: The `protokol` strings, the eight codes, and the API client

**Lane:** dashboard (`/c/tmp/g2b-b1d-fe`). **Needs:** Task 2 on the slice branch, merged into this lane (`apiErrors.test.js` reads `admission/errors.py`; `deps.md`).

Spec §4 (screens), §6, §7, E6. A new namespace `protokol` holds every text of the slice in four languages (tr source, az default; az, ru, en are the planner's, O73). The eight refusal codes map to `protokol.err.*` in `ADMISSION_CODE_KEYS` (the test that reads `errors.py` widens its key prefix and its count). The client gains `protocolSettings`, `saveProtocolSettings` and `admissionLabel`, and a refusal's number is its `board_key` when the detail carries one (E6) — the number the card shows.

**Files:**
- Create: `dashboard/src/live/i18n/strings/protokol.js`
- Modify: `dashboard/src/live/i18n/catalog.js`
- Modify: `dashboard/src/live/apiErrors.test.js`
- Modify: `dashboard/src/live/apiErrors.js`
- Modify: `dashboard/src/backendApi.test.js`
- Modify: `dashboard/src/backendApi.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`

- [ ] **Step 1: Write the failing tests.**

**Edit** `dashboard/src/live/apiErrors.test.js` (1) — replace:

```js
    // `duplicate_open_admission` (A-37, the final review).
    expect(CODES).toHaveLength(16);
```

with:

```js
    // `duplicate_open_admission` (A-37, the final review); G2-B1d's eight (its own block).
    expect(CODES).toHaveLength(24);
```

**Edit** `dashboard/src/live/apiErrors.test.js` (2) — replace:

```js
    expect(hit.key).toMatch(/^kabul\.err\./);
```

with:

```js
    expect(hit.key).toMatch(/^(kabul|protokol)\.err\./);   // G2-B1d's codes speak in `protokol`
```

**Edit** `dashboard/src/backendApi.test.js` — replace:

```js
  it("a refusal without a code has none, as before", async () => {
```

with:

```js
  // G2-B1d (E6): the number a screen shows beside a refusal is the card's — `board_key` when the
  // detail carries it (a protocol number), else `patient_number` (an API before the protocol).
  it("a refusal's number is its board key when the detail carries one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: {
      code: "duplicate_open_admission", message: "This person already has an open admission.",
      patient_number: "H2600042", board_key: "202600000001",
    } }, { ok: false, status: 409 }));
    const err = await signedIn(fetchMock).admit({ patient: {}, note: {} }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, apiCode: "duplicate_open_admission", patientNumber: "202600000001" });
  });

  it("reads and writes the protocol settings, and asks an admission's label by its own route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    const settings = { next_no: "202600000001", label_width_mm: 50, label_height_mm: 30, printer_dpi: 203 };
    await api.protocolSettings();
    await api.saveProtocolSettings(settings);
    await api.admissionLabel("a 1");
    await api.admissionLabel("a-1", true);
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["GET", "/admin/protocol-settings"], ["PUT", "/admin/protocol-settings"],
      ["POST", "/admissions/a%201/label"], ["POST", "/admissions/a-1/label"],
    ]);
    expect(sent(fetchMock, 1).body).toEqual(settings);
    expect([sent(fetchMock, 2).body, sent(fetchMock, 3).body]).toEqual([{ reprint: false }, { reprint: true }]);
  });

  it("a refusal without a code has none, as before", async () => {
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/apiErrors.test.js src/backendApi.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |AssertionError|TypeError" | head
```

Expected: `FAIL` in both — the map lacks the eight codes (`the map holds every code errors.py raises`), `protocol_not_configured has a text` … (no key), `patientNumber` is `H2600042`, `api.protocolSettings is not a function`.

- [ ] **Step 3: The strings.** **Write** `dashboard/src/live/i18n/strings/protokol.js`:

```js
// Group 2 · B1d — Protokol: the protocol number Homunculus issues every admission, its barcode label
// (screens/kabul/label/), Yönetim › Protokol ve etiket (screens/admin/ProtocolTab.jsx), the admit
// box's protocol and print button, the patient screen's reprint, and the words of the slice's coded
// refusals (apiErrors.js `ADMISSION_CODE_KEYS`).
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading
// before the pilot (O73). No text here is clinical advice.
export default {
  tr: {
    tab: "Protokol ve etiket",
    title: "Protokol numarası ve etiket",
    sub: "Her yeni kabule Homunculus bir protokol numarası verir: cihaza girilen, barkodu basılan ve kartta görünen numara budur.",
    loading: "Yükleniyor…",
    readFailed: "Ayarlar okunamadı: {reason}",
    notConfigured: "Başlangıç numarası girilmedi: girilene dek hiçbir kabul yapılamaz.",
    configured: "Sıradaki kabul bu numarayı alır.",
    lastIssued: "Verilen son numara: {number}",
    noneIssued: "Henüz numara verilmedi.",
    nextNo: "Sıradaki protokol numarası",
    nextNoHint: "12 rakam, ör. 202600000001. Yalnız ileri alınabilir: verilen son numaradan büyük olmalı.",
    width: "Etiket genişliği (mm)",
    height: "Etiket yüksekliği (mm)",
    dpi: "Yazıcı çözünürlüğü",
    fits: "Barkod sığar: bu çözünürlükte en az {min} mm genişlik gerekir.",
    setupNote: "Zebra sürücüsünde bu boyutta etiket stoku tanımlı olmalı ve ölçek %100 olmalı.",
    save: "Kaydet",
    saved: "Protokol ve etiket ayarları kaydedildi.",
    testPrint: "Deneme etiketi yazdır",
    testName: "DENEME ETİKETİ",
    invalid: {
      nextNo: "12 rakam girin.",
      size: "Genişlik 30–110 mm, yükseklik 20–80 mm olmalı.",
      tooNarrow: "Barkod bu genişliğe sığmaz: en az {min} mm gerekir.",
    },
    print: "Etiketi yazdır",
    reprint: "Etiketi yeniden yazdır",
    popupBlocked: "Yazdırma penceresi açılamadı; tarayıcıda bu sitenin açılır pencerelerine izin verin.",
    printFailed: "Etiket alınamadı: {reason}",
    protocolNo: "Protokol no",
    enterOrScan: "Cihaza bu numarayı girin veya barkodu okutun",
    admitted: "kabul edildi, protokol no {number}",
    earlierAdmitted: "daha önce gönderilen kabul kaydedilmiş, protokol no {number} — formdaki hastanın değil",
    label: {
      bed: "Yatak",
      sex: { female: "Kadın", male: "Erkek", other: "Diğer", unknown: "Bilinmiyor" },
    },
    err: {
      notConfigured: "Protokol numarası ayarlanmadı: Yönetim › Protokol ve etiket bölümünden başlangıç numarasını girin. Kabul yazılmadı.",
      exhausted: "Protokol numarası kalmadı; sistem yöneticisine bildirin. Kabul yazılmadı.",
      format: "Protokol numarası tam 12 rakam olmalı.",
      notForward: "Bu numara geri gidiyor: verilen son numaradan büyük olmalı. Ayarlar yeniden okundu.",
      size: "Etiket genişliği 30–110 mm, yüksekliği 20–80 mm olmalı.",
      tooNarrow: "Barkod bu genişliğe sığmaz; etiketi genişletin ya da 300 dpi seçin.",
      dpi: "Yazıcı çözünürlüğü 203 ya da 300 dpi olmalı.",
      noProtocol: "Bu kabulün protokol numarası yok: etiket basılamaz.",
      requestConflictNumber: "Bu formla daha önce bir kabul kaydedilmiş (protokol no {number}); form yeniden gönderilmedi. «Taburcu › Yatan hastalar» listesine bakın.",
      boardNotClearedNumber: "Bu yatağın son hastasının kartı (protokol no {number}) hâlâ panoda; yatak boşaltılmadı. Biraz sonra yeniden deneyin; sürerse sistem yöneticisine bildirin.",
      duplicateOpenAdmissionNumber: "Bu hastanın açık bir kabulü zaten var (protokol no {number}); önce taburcu edilmeli. Form gönderilmedi.",
    },
  },
  az: {
    tab: "Protokol və etiket",
    title: "Protokol nömrəsi və etiket",
    sub: "Homunculus hər yeni qəbula protokol nömrəsi verir: cihaza daxil edilən, barkodu çap olunan və kartda görünən nömrə budur.",
    loading: "Yüklənir…",
    readFailed: "Ayarlar oxunmadı: {reason}",
    notConfigured: "Başlanğıc nömrəsi daxil edilməyib: daxil edilənədək heç bir qəbul aparıla bilməz.",
    configured: "Növbəti qəbul bu nömrəni alır.",
    lastIssued: "Verilən son nömrə: {number}",
    noneIssued: "Hələ nömrə verilməyib.",
    nextNo: "Növbəti protokol nömrəsi",
    nextNoHint: "12 rəqəm, məs. 202600000001. Yalnız irəli çəkilə bilər: verilən son nömrədən böyük olmalıdır.",
    width: "Etiketin eni (mm)",
    height: "Etiketin hündürlüyü (mm)",
    dpi: "Printerin ayırdetməsi",
    fits: "Barkod sığır: bu ayırdetmədə ən azı {min} mm en lazımdır.",
    setupNote: "Zebra sürücüsündə bu ölçüdə etiket kağızı təyin olunmalı, miqyas 100% olmalıdır.",
    save: "Yadda saxla",
    saved: "Protokol və etiket ayarları yadda saxlanıldı.",
    testPrint: "Sınaq etiketi çap et",
    testName: "SINAQ ETİKETİ",
    invalid: {
      nextNo: "12 rəqəm daxil edin.",
      size: "En 30–110 mm, hündürlük 20–80 mm olmalıdır.",
      tooNarrow: "Barkod bu enə sığmır: ən azı {min} mm lazımdır.",
    },
    print: "Etiketi çap et",
    reprint: "Etiketi yenidən çap et",
    popupBlocked: "Çap pəncərəsi açılmadı; brauzerdə bu saytın açılan pəncərələrinə icazə verin.",
    printFailed: "Etiket alınmadı: {reason}",
    protocolNo: "Protokol nömrəsi",
    enterOrScan: "Bu nömrəni cihaza daxil edin və ya barkodu oxudun",
    admitted: "qəbul edildi, protokol nömrəsi {number}",
    earlierAdmitted: "əvvəl göndərilən qəbul yazılıb, protokol nömrəsi {number} — formadakı xəstənin deyil",
    label: {
      bed: "Çarpayı",
      sex: { female: "Qadın", male: "Kişi", other: "Digər", unknown: "Məlum deyil" },
    },
    err: {
      notConfigured: "Protokol nömrəsi təyin olunmayıb: İdarə › Protokol və etiket bölməsində başlanğıc nömrəsini daxil edin. Qəbul yazılmadı.",
      exhausted: "Protokol nömrəsi qalmayıb; sistem administratoruna bildirin. Qəbul yazılmadı.",
      format: "Protokol nömrəsi düz 12 rəqəm olmalıdır.",
      notForward: "Bu nömrə geri gedir: verilən son nömrədən böyük olmalıdır. Ayarlar yenidən oxundu.",
      size: "Etiketin eni 30–110 mm, hündürlüyü 20–80 mm olmalıdır.",
      tooNarrow: "Barkod bu enə sığmır; etiketi genişləndirin və ya 300 dpi seçin.",
      dpi: "Printerin ayırdetməsi 203 və ya 300 dpi olmalıdır.",
      noProtocol: "Bu qəbulun protokol nömrəsi yoxdur: etiket çap oluna bilməz.",
      requestConflictNumber: "Bu forma ilə artıq qəbul yazılıb (protokol nömrəsi {number}); forma yenidən göndərilmədi. «Evə yazılma › Yatan xəstələr» siyahısına baxın.",
      boardNotClearedNumber: "Bu çarpayının son xəstəsinin kartı (protokol nömrəsi {number}) hələ paneldədir; çarpayı boşaldılmadı. Bir az sonra yenidən cəhd edin; davam edərsə sistem administratoruna bildirin.",
      duplicateOpenAdmissionNumber: "Bu xəstənin artıq açıq qəbulu var (protokol nömrəsi {number}); əvvəlcə evə yazılmalıdır. Forma göndərilmədi.",
    },
  },
  ru: {
    tab: "Протокол и этикетка",
    title: "Номер протокола и этикетка",
    sub: "Homunculus выдаёт каждому новому приёму номер протокола: его вводят на приборе, его штрихкод печатают, он виден на карточке.",
    loading: "Загрузка…",
    readFailed: "Не удалось прочитать настройки: {reason}",
    notConfigured: "Начальный номер не задан: пока он не задан, ни один приём невозможен.",
    configured: "Следующий приём получит этот номер.",
    lastIssued: "Последний выданный номер: {number}",
    noneIssued: "Номера ещё не выдавались.",
    nextNo: "Следующий номер протокола",
    nextNoHint: "12 цифр, напр. 202600000001. Только вперёд: больше последнего выданного номера.",
    width: "Ширина этикетки (мм)",
    height: "Высота этикетки (мм)",
    dpi: "Разрешение принтера",
    fits: "Штрихкод помещается: при этом разрешении нужна ширина не менее {min} мм.",
    setupNote: "В драйвере Zebra должен быть задан носитель этого размера, масштаб 100 %.",
    save: "Сохранить",
    saved: "Настройки протокола и этикетки сохранены.",
    testPrint: "Напечатать пробную этикетку",
    testName: "ПРОБНАЯ ЭТИКЕТКА",
    invalid: {
      nextNo: "Введите 12 цифр.",
      size: "Ширина 30–110 мм, высота 20–80 мм.",
      tooNarrow: "Штрихкод не помещается в эту ширину: нужно не менее {min} мм.",
    },
    print: "Напечатать этикетку",
    reprint: "Напечатать этикетку повторно",
    popupBlocked: "Не удалось открыть окно печати; разрешите всплывающие окна для этого сайта.",
    printFailed: "Этикетку получить не удалось: {reason}",
    protocolNo: "№ протокола",
    enterOrScan: "Введите этот номер на приборе или отсканируйте штрихкод",
    admitted: "приём оформлен, № протокола {number}",
    earlierAdmitted: "оформлен приём, отправленный ранее, № протокола {number} — это не пациент из формы",
    label: {
      bed: "Койка",
      sex: { female: "Женский", male: "Мужской", other: "Другой", unknown: "Неизвестно" },
    },
    err: {
      notConfigured: "Номер протокола не настроен: задайте начальный номер в разделе Управление › Протокол и этикетка. Приём не записан.",
      exhausted: "Номера протокола закончились; сообщите администратору системы. Приём не записан.",
      format: "Номер протокола — ровно 12 цифр.",
      notForward: "Этот номер идёт назад: он должен быть больше последнего выданного. Настройки прочитаны заново.",
      size: "Ширина этикетки 30–110 мм, высота 20–80 мм.",
      tooNarrow: "Штрихкод не помещается в эту ширину; расширьте этикетку или выберите 300 dpi.",
      dpi: "Разрешение принтера — 203 или 300 dpi.",
      noProtocol: "У этого приёма нет номера протокола: этикетку напечатать нельзя.",
      requestConflictNumber: "По этой форме приём уже оформлен (№ протокола {number}); форма повторно не отправлена. Проверьте список «Выписка › Госпитализированные пациенты».",
      boardNotClearedNumber: "Карточка последнего пациента этой койки (№ протокола {number}) всё ещё на панели; койка не освобождена. Повторите чуть позже; если не поможет — сообщите администратору системы.",
      duplicateOpenAdmissionNumber: "У этого пациента уже есть открытый приём (№ протокола {number}); сначала его нужно выписать. Форма не отправлена.",
    },
  },
  en: {
    tab: "Protocol and label",
    title: "Protocol number and label",
    sub: "Homunculus gives every new admission a protocol number: the number entered on the device, printed as the barcode and shown on the card.",
    loading: "Loading…",
    readFailed: "The settings could not be read: {reason}",
    notConfigured: "No start number is set: no admission can be made until it is.",
    configured: "The next admission takes this number.",
    lastIssued: "Last number issued: {number}",
    noneIssued: "No number issued yet.",
    nextNo: "Next protocol number",
    nextNoHint: "12 digits, e.g. 202600000001. Forward only: greater than the last number issued.",
    width: "Label width (mm)",
    height: "Label height (mm)",
    dpi: "Printer resolution",
    fits: "The barcode fits: this resolution needs a width of at least {min} mm.",
    setupNote: "The Zebra driver must hold label stock of this size, at 100 % scale.",
    save: "Save",
    saved: "Protocol and label settings saved.",
    testPrint: "Print a test label",
    testName: "TEST LABEL",
    invalid: {
      nextNo: "Enter 12 digits.",
      size: "Width 30–110 mm, height 20–80 mm.",
      tooNarrow: "The barcode does not fit this width: at least {min} mm is needed.",
    },
    print: "Print label",
    reprint: "Print label again",
    popupBlocked: "The print window could not open; allow pop-ups for this site in the browser.",
    printFailed: "The label could not be fetched: {reason}",
    protocolNo: "Protocol no.",
    enterOrScan: "Enter this number on the device or scan the barcode",
    admitted: "admitted, protocol no. {number}",
    earlierAdmitted: "an admission sent earlier was recorded, protocol no. {number} — not the form's patient",
    label: {
      bed: "Bed",
      sex: { female: "Female", male: "Male", other: "Other", unknown: "Unknown" },
    },
    err: {
      notConfigured: "No protocol number is set up: enter the start number in Admin › Protocol and label. The admission was not written.",
      exhausted: "No protocol number is left; tell the system administrator. The admission was not written.",
      format: "A protocol number is exactly 12 digits.",
      notForward: "This number goes backwards: it must be greater than the last one issued. The settings were read again.",
      size: "The label is 30–110 mm wide and 20–80 mm high.",
      tooNarrow: "The barcode does not fit this width; widen the label or choose 300 dpi.",
      dpi: "The printer resolution is 203 or 300 dpi.",
      noProtocol: "This admission has no protocol number: no label can be printed.",
      requestConflictNumber: "An admission was already recorded under this form (protocol no. {number}); the form was not sent again. Check «Discharge › Inpatients».",
      boardNotClearedNumber: "This bed's last patient's card (protocol no. {number}) is still on the board; the bed was not freed. Try again shortly; if it persists, tell the system administrator.",
      duplicateOpenAdmissionNumber: "This patient already has an open admission (protocol no. {number}); discharge it first. The form was not sent.",
    },
  },
};
```

**Edit** `dashboard/src/live/i18n/catalog.js` (1) — replace:

```js
// G2-B1a: Hasta Kabul (screens/kabul, the admin's Yapı tab, the unit names, the coded refusals).
import kabul from "./strings/kabul.js";
```

with:

```js
// G2-B1a: Hasta Kabul (screens/kabul, the admin's Yapı tab, the unit names, the coded refusals).
import kabul from "./strings/kabul.js";

// G2-B1d: Protokol — the protocol number, its label, Yönetim › Protokol ve etiket.
import protokol from "./strings/protokol.js";
```

**Edit** `dashboard/src/live/i18n/catalog.js` (2) — replace:

```js
  kabul, // G2-B1a
};
```

with:

```js
  kabul, // G2-B1a

  protokol, // G2-B1d
};
```

- [ ] **Step 4: The codes.** **Edit** `dashboard/src/live/apiErrors.js` — replace:

```js
  // A-37: a second open admission of the same person (name and birth date); with the open
  // admission's number when the detail carries it, `kabul.err.duplicateOpenAdmissionNumber`.
  ["duplicate_open_admission", "kabul.err.duplicateOpenAdmission"],
]);
```

with:

```js
  // A-37: a second open admission of the same person (name and birth date); with the open
  // admission's number when the detail carries it, `kabul.err.duplicateOpenAdmissionNumber`.
  ["duplicate_open_admission", "kabul.err.duplicateOpenAdmission"],

  // G2-B1d — the protocol number and its label (admission/errors.py's own block, spec §7).
  ["protocol_not_configured", "protokol.err.notConfigured"],
  ["protocol_exhausted", "protokol.err.exhausted"],
  ["protocol_format", "protokol.err.format"],
  ["protocol_not_forward", "protokol.err.notForward"],
  ["label_size", "protokol.err.size"],
  ["label_too_narrow", "protokol.err.tooNarrow"],
  ["label_dpi", "protokol.err.dpi"],
  ["no_protocol", "protokol.err.noProtocol"],
]);
```

and replace:

```js
/** The coded refusals whose detail names a patient's number, each with the sentence that says it.
 *  A number beside any other code is not shown. */
const WITH_NUMBER = new Map([
```

with:

```js
/** G2-B1d (E6): the same three sentences when the number is a protocol — twelve digits, the card
 *  key of an admission made since migration 0015 — so a protocol is never called a patient number. */
const WITH_PROTOCOL = new Map([
  ["request_conflict", "protokol.err.requestConflictNumber"],
  ["board_not_cleared", "protokol.err.boardNotClearedNumber"],
  ["duplicate_open_admission", "protokol.err.duplicateOpenAdmissionNumber"],
]);
const PROTOCOL_NO = /^[0-9]{12}$/;

/** The coded refusals whose detail names a patient's number, each with the sentence that says it.
 *  A number beside any other code is not shown. */
const WITH_NUMBER = new Map([
```

and replace:

```js
  if (number && WITH_NUMBER.has(code)) return { key: WITH_NUMBER.get(code), vars: { number } };
```

with:

```js
  if (number && WITH_NUMBER.has(code)) {
    return { key: (PROTOCOL_NO.test(number) ? WITH_PROTOCOL : WITH_NUMBER).get(code), vars: { number } };
  }
```

**Edit** `dashboard/src/live/apiErrors.test.js` (3) — replace:

```js
  it("the map holds every code errors.py raises, and nothing else", () => {
```

with:

```js
  // G2-B1d (E6): a protocol beside a refusal is called a protocol, an H-number a patient number.
  it.each(["request_conflict", "board_not_cleared", "duplicate_open_admission"])(
    "%s names a protocol as a protocol and an H-number as a patient number", (code) => {
      const az = createTranslator("az", DICTIONARIES);
      const protocol = apiErrorText(az, Object.assign(coded(code), { patientNumber: "202600000001" }));
      const legacy = apiErrorText(az, Object.assign(coded(code), { patientNumber: "H2600042" }));
      expect(protocol).toContain("protokol nömrəsi 202600000001");
      expect(legacy).toContain("xəstə nömrəsi H2600042");
    });

  it("the map holds every code errors.py raises, and nothing else", () => {
```

- [ ] **Step 5: The client.** **Edit** `dashboard/src/backendApi.js` (1) — replace:

```js
        // `request_conflict` names the earlier admission's number, `board_not_cleared` the bed's last
        // patient's (admission/errors.py `Refusal.extra`): the one extra a screen shows. Nothing else
        // of the detail is kept — never a name.
        if (typeof body.detail.patient_number === "string") patientNumber = body.detail.patient_number;
```

with:

```js
        // `request_conflict` names the earlier admission's number, `board_not_cleared` the bed's last
        // patient's (admission/errors.py `Refusal.extra`): the one extra a screen shows. Nothing else
        // of the detail is kept — never a name. G2-B1d (E6): the card's own number, `board_key` (a
        // protocol number), when the detail carries it; else the H-number of an API before it.
        if (typeof body.detail.board_key === "string") patientNumber = body.detail.board_key;
        else if (typeof body.detail.patient_number === "string") patientNumber = body.detail.patient_number;
```

**Edit** `dashboard/src/backendApi.js` (2) — replace:

```js
    releaseBed(id) { return authed(`/tenant/beds/${seg(id)}/release`, { method: "POST" }); },
```

with:

```js
    releaseBed(id) { return authed(`/tenant/beds/${seg(id)}/release`, { method: "POST" }); },
    // G2-B1d — Yönetim › Protokol ve etiket, and an admission's label (spec §3, §6).
    /** {configured, next_no, last_issued, label_width_mm, label_height_mm, printer_dpi, updated_at} */
    protocolSettings() { return authed("/admin/protocol-settings"); },
    /** {next_no, label_width_mm, label_height_mm, printer_dpi} → as protocolSettings() */
    saveProtocolSettings(body) { return authed("/admin/protocol-settings", { method: "PUT", body }); },
    /** {protocol_no, display_name, date_of_birth, sex, unit_name, bed_label, label: {width_mm,
     *  height_mm, printer_dpi}} — every call is an audited print (`reprint`: not the first). */
    admissionLabel(id, reprint = false) {
      return authed(`/admissions/${seg(id)}/label`, { method: "POST", body: { reprint: Boolean(reprint) } });
    },
```

**Edit** `dashboard/src/live/session/testTokens.testutil.js` — replace:

```js
    patchBed: vi.fn(),

    // the users and units screen (G1-12)
```

with:

```js
    patchBed: vi.fn(),

    // G2-B1d: Protokol — the admin tab, the label
    protocolSettings: vi.fn(),
    saveProtocolSettings: vi.fn(),
    admissionLabel: vi.fn(),

    // the users and units screen (G1-12)
```

- [ ] **Step 6: Green.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/apiErrors.test.js src/backendApi.test.js src/live/i18n/ src/live/screens/kabul/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no `FAIL`. If `strings.test.js` names an `az` text equal to `tr` or a `ru` text without Cyrillic, rewrite that text (none is expected: each az text above differs from its tr, each ru one is Cyrillic) — do not add a reviewed entry without the controller.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-b1d-fe
git add -- dashboard/src/live/i18n/strings/protokol.js dashboard/src/live/i18n/catalog.js dashboard/src/live/apiErrors.test.js dashboard/src/live/apiErrors.js dashboard/src/backendApi.test.js dashboard/src/backendApi.js dashboard/src/live/session/testTokens.testutil.js
git status --short && git diff --cached --stat
git commit -F - -- dashboard/src/live/i18n/strings/protokol.js dashboard/src/live/i18n/catalog.js dashboard/src/live/apiErrors.test.js dashboard/src/live/apiErrors.js dashboard/src/backendApi.test.js dashboard/src/backendApi.js dashboard/src/live/session/testTokens.testutil.js <<'EOF'
feat(dashboard): the protokol strings in four languages, the eight G2-B1d codes, and the protocol client

The namespace protokol (tr source; az, ru, en await a native reading, O73); the slice's eight
refusal codes map to protokol.err.* (apiErrors.test.js reads errors.py: 24 codes). The client
reads and writes /admin/protocol-settings and asks POST /admissions/{id}/label; a refusal's
number is its board_key when the detail carries one (E6).

red: the map lacked the eight codes; patientNumber H2600042; protocolSettings is not a function

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: `boardKey.js`, the Code 128-C encoder, the label, and the admit box's protocol and print button

**Lane:** dashboard (`/c/tmp/g2b-b1d-fe`). **Needs:** Task 12; Task 3 on the slice branch, merged into this lane (`protocolLabel.test.js` reads `homunculus-engine/tests/label_fit_cases.json`). **Continuation files:** `task-13-encoder.md` (Step 2), `task-13-label.md` (Step 3).

Spec §4 (Screens), §6, D3, D7, D10, E12, E13. The encoder and the label land with their first consumer, the admit box (`reachable.test.js`: a module is imported from `main.jsx`'s tree in the commit that creates it). The box shows the board key — the protocol, large, under «Protokol nömrəsi» — with «Cihaza bu numarayı girin veya barkodu okutun», links the card by it, and offers **Etiketi yazdır** (a first print). An answer without a protocol (an API before 0015, the B1a tests' answers) shows its H-number as before and offers no label. An earlier patient's admission found after a send got no answer offers no label either: the box says it is not the form's.

**Files:**
- Create: `dashboard/src/live/screens/kabul/boardKey.js`, `dashboard/src/live/screens/kabul/boardKey.test.js`
- Create: `dashboard/src/live/screens/kabul/label/code128c.js`, `…/label/code128c.test.js` (Step 2)
- Create: `dashboard/src/live/screens/kabul/label/protocolLabel.js`, `…/label/protocolLabel.test.js` (Step 3)
- Create: `dashboard/src/live/screens/kabul/label/PrintLabelButton.jsx`, `…/label/PrintLabelButton.test.jsx` (Step 3)
- Modify: `dashboard/src/live/screens/kabul/AdmitTab.jsx`, `dashboard/src/live/screens/kabul/AdmitTab.test.jsx`

- [ ] **Step 1: The key.** **Write** `dashboard/src/live/screens/kabul/boardKey.test.js`:

```js
// The card key of an admission row (G2-B1d, spec §4, E12): the server's `board_key` — the protocol
// number of an admission made since 0015 — else the H-number an answer without the field keyed its
// card by.
import { describe, it, expect } from "vitest";
import { boardKeyOf } from "./boardKey.js";

describe("boardKeyOf", () => {
  it("is the server's board key", () => {
    expect(boardKeyOf({ board_key: "202600000001", patient_number: "H2600042" })).toBe("202600000001");
  });

  it("is the H-number for an answer without one, and nothing for no row", () => {
    expect(boardKeyOf({ patient_number: "H2600042" })).toBe("H2600042");
    expect(boardKeyOf({ board_key: "", patient_number: "H2600042" })).toBe("H2600042");
    expect(boardKeyOf(null)).toBeNull();
    expect(boardKeyOf({})).toBeNull();
  });
});
```

**Write** `dashboard/src/live/screens/kabul/boardKey.js`:

```js
// src/live/screens/kabul/boardKey.js — the card key of an admission row (Group 2 · B1d, spec §4).
//
// The board keys a patient by one string. An admission made since migration 0015 is keyed by its
// protocol number (D7: the number on the device, the label and the card are one); one opened before
// keeps its H-number. The server answers it as `board_key` on every row and every admit answer;
// EVERY match between an admission and a card goes through this one function (E12). An answer
// without the field — an API one release behind, the B1a tests' rows — keyed its card by
// `patient_number`.
export function boardKeyOf(row) {
  if (typeof row?.board_key === "string" && row.board_key) return row.board_key;
  return typeof row?.patient_number === "string" ? row.patient_number : null;
}
```

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/boardKey.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

(Write the test first and see `Failed to resolve import "./boardKey.js"`, then the module: 2 tests pass.)

- [ ] **Step 2: The encoder** — `task-13-encoder.md`.

- [ ] **Step 3: The label and its button** — `task-13-label.md`.

- [ ] **Step 4: The admit box's failing tests.** **Edit** `dashboard/src/live/screens/kabul/AdmitTab.test.jsx` (1) — replace:

```js
import { describe, it, expect, afterEach } from "vitest";
```

with:

```js
import { describe, it, expect, afterEach, vi } from "vitest";
```

**Edit** `dashboard/src/live/screens/kabul/AdmitTab.test.jsx` (2) — at the end of the file, add:

```jsx

// G2-B1d — the protocol box (spec §4 Screens, §6): the board key large, what to do with it, the card
// linked by it, and the label offered; an answer without a protocol keeps B1a's box.
describe("AdmitTab · the protocol (G2-B1d)", () => {
  const withProtocol = (over = {}) => ({ ...admitted(), protocol_no: "202600000001", board_key: "202600000001", ...over });

  it("shows the protocol large with what to do with it, links the card by it, and offers its label", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockResolvedValue(withProtocol()) });
    fillRequired();
    await press();
    expect(screen.getByText("202600000001")).toBeTruthy();
    expect(screen.queryByText("H2600042")).toBeNull();                       // D2: not the visit's number
    expect(screen.getByText("Protokol nömrəsi")).toBeTruthy();
    expect(screen.getByText("Bu nömrəni cihaza daxil edin və ya barkodu oxudun")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Paneldə bax" }).getAttribute("href")).toBe("#/patients/202600000001");
    expect(toasts().getAllByText(`${BED1} · qəbul edildi, protokol nömrəsi 202600000001`).length).toBeGreaterThan(0);
    const open = vi.spyOn(window, "open").mockReturnValue(null);              // a blocked window: nothing asked
    try {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
      await settle();
      expect(open).toHaveBeenCalledTimes(1);
      expect(api.admissionLabel).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("prints the admission's own label, a first print", async () => {
    const popup = { document: { open() {}, write() {}, close() {} }, focus() {}, print() {}, close() {} };
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => {
        a.admit.mockResolvedValue(withProtocol({ id: "a-7" }));
        a.admissionLabel.mockResolvedValue({ protocol_no: "202600000001", display_name: "Sentetik Hasta",
          date_of_birth: "1970-05-05", sex: "female", unit_name: "Reanimasiya", bed_label: "1",
          label: { width_mm: 50, height_mm: 30, printer_dpi: 203 } });
      },
    });
    fillRequired();
    await press();
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    try {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
      await settle();
      expect(api.admissionLabel).toHaveBeenCalledWith("a-7", false);
    } finally {
      open.mockRestore();
    }
  });

  it("keeps B1a's box for an answer without a protocol: the H-number, no label", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockResolvedValue(admitted()) });
    fillRequired();
    await press();
    expect(screen.getByText("H2600042")).toBeTruthy();
    expect(screen.getByText("Çarpayı yanındakı cihaza bu nömrəni daxil edin.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Etiketi çap et" })).toBeNull();
    expect(screen.queryByText("Protokol nömrəsi")).toBeNull();
  });
});
```

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/AdmitTab.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |Unable to find" | head
```

Expected: the first two new tests fail (`Unable to find an element with the text: 202600000001` — the box shows `patient_number`); the third passes; every B1a test passes.

- [ ] **Step 5: The box.** Every edit in `dashboard/src/live/screens/kabul/AdmitTab.jsx`.

**Edit** (1) — replace:

```js
import { BedPicker } from "./BedPicker.jsx";
```

with:

```js
import { BedPicker } from "./BedPicker.jsx";
import { boardKeyOf } from "./boardKey.js"; //                    G2-B1d: the card key (E12)
import { PrintLabelButton } from "./label/PrintLabelButton.jsx"; // G2-B1d: the protocol label (§6)
```

**Edit** (2) — replace:

```js
      <p className="m-0 text-13 text-mute">{t("kabul.doneBed", { bed: done.bed })}</p>
      <p className="m-0 my-2 font-data text-34 font-bold tracking-[.06em] text-ink">{done.number}</p>
      <p className="m-0 text-14 font-semibold">{t("kabul.enterOnDevice")}</p>
```

with:

```js
      <p className="m-0 text-13 text-mute">{t("kabul.doneBed", { bed: done.bed })}</p>
      {/* G2-B1d: the number is the card's — the protocol of an admission made since 0015 (D7), the
          one the nurse enters or scans; an answer without one keeps B1a's H-number and words. */}
      {protocol ? <p className="m-0 mt-2 text-12 font-semibold uppercase tracking-[.08em] text-mute">{t("protokol.protocolNo")}</p> : null}
      <p className="m-0 my-2 font-data text-34 font-bold tracking-[.06em] text-ink">{done.number}</p>
      <p className="m-0 text-14 font-semibold">{t(protocol ? "protokol.enterOrScan" : "kabul.enterOnDevice")}</p>
```

**Edit** (3) — replace:

```js
  const failed = PARTS.filter((part) => done.engine?.[part] === "failed");
  const whose = done.earlier ? t("kabul.earlierSend", { name: done.earlier, bed: done.bed }) : null;
```

with:

```js
  const failed = PARTS.filter((part) => done.engine?.[part] === "failed");
  const whose = done.earlier ? t("kabul.earlierSend", { name: done.earlier, bed: done.bed }) : null;
  const protocol = Boolean(done.protocolNo);
```

**Edit** (4) — replace:

```js
        <Button onClick={onNext}>{done.earlier ? t("kabul.backToForm") : t("kabul.next")}</Button>
```

with:

```js
        {/* G2-B1d (§6): the first print — the form's own admission only, never an earlier patient's. */}
        {protocol && !done.earlier && done.admissionId ? <PrintLabelButton admissionId={done.admissionId} /> : null}
        <Button onClick={onNext}>{done.earlier ? t("kabul.backToForm") : t("kabul.next")}</Button>
```

**Edit** (5) — replace:

```js
    toast(doneFor(t, next.bed, t("kabul.admitted", { number: next.number })));
```

with:

```js
    toast(doneFor(t, next.bed, t(next.protocolNo ? "protokol.admitted" : "kabul.admitted", { number: next.number })));
```

**Edit** (6) — replace:

```js
    const next = { number: row.patient_number, bed: send.bed, engine: null, recovered: true };
```

with:

```js
    const next = { number: boardKeyOf(row), protocolNo: row.protocol_no ?? null, admissionId: row.id ?? null,
      bed: send.bed, engine: null, recovered: true };
```

**Edit** (7) — replace:

```js
    toast(doneFor(t, send.bed, t("kabul.earlierAdmitted", { number: row.patient_number })), "warn");
```

with:

```js
    toast(doneFor(t, send.bed, t(row.protocol_no ? "protokol.earlierAdmitted" : "kabul.earlierAdmitted",
      { number: boardKeyOf(row) })), "warn");
```

**Edit** (8) — replace:

```js
      admitted({ number: answer.patient_number, bed: sent.bed, engine: answer.engine }, sent.name);
```

with:

```js
      admitted({ number: boardKeyOf(answer), protocolNo: answer.protocol_no ?? null, admissionId: answer.id ?? null,
        bed: sent.bed, engine: answer.engine }, sent.name);
```

**Edit** (9) the header comment — replace:

```js
// One request writes the admission (POST /admissions). The answer's patient number is shown large,
// with what the nurse does with it — she enters it on the bedside device — and any part of the
```

with:

```js
// One request writes the admission (POST /admissions). The answer's card number is shown large — the
// protocol since G2-B1d, with «Etiketi yazdır» beside it; the H-number of an answer without one —
// with what the nurse does with it — she enters or scans it on the bedside device — and any part of the
```

- [ ] **Step 6: Green**, with the reachability walk and the boundaries:

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/ src/reachable.test.js src/live/boundaries.test.js src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: no `FAIL`; the build prints `built in` and `precache  20 entries`, no `larger than`. (If `boundaries.test.js` is elsewhere, `ls src/live/*.test.js` finds it.)

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-b1d-fe
git add -- dashboard/src/live/screens/kabul/boardKey.js dashboard/src/live/screens/kabul/boardKey.test.js dashboard/src/live/screens/kabul/label/code128c.js dashboard/src/live/screens/kabul/label/code128c.test.js dashboard/src/live/screens/kabul/label/protocolLabel.js dashboard/src/live/screens/kabul/label/protocolLabel.test.js dashboard/src/live/screens/kabul/label/PrintLabelButton.jsx dashboard/src/live/screens/kabul/label/PrintLabelButton.test.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx
git status --short && git diff --cached --stat
git commit -F - -- dashboard/src/live/screens/kabul/boardKey.js dashboard/src/live/screens/kabul/boardKey.test.js dashboard/src/live/screens/kabul/label/code128c.js dashboard/src/live/screens/kabul/label/code128c.test.js dashboard/src/live/screens/kabul/label/protocolLabel.js dashboard/src/live/screens/kabul/label/protocolLabel.test.js dashboard/src/live/screens/kabul/label/PrintLabelButton.jsx dashboard/src/live/screens/kabul/label/PrintLabelButton.test.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx <<'EOF'
feat(kabul): the protocol label — Code 128-C, the 50x30 page, the print — and the admit box shows the protocol and prints it

code128c.js: digit pairs, 121 modules for twelve digits, decoded back by a geometry-only decoder in
its test (D10). protocolLabel.js: the engine's fit rule on the engine's case table (E13), the lines
dropped when empty and the name in full, @page in the configured size, a module of whole printer
dots. PrintLabelButton opens the window in the click, then asks the audited label route. The admit
box shows the board key large with «enter or scan» and «Etiketi yazdır»; an answer without a
protocol keeps B1a's box (E12).

red: no ./boardKey.js, ./code128c.js, ./protocolLabel.js, ./PrintLabelButton.jsx; the box showed H2600042

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13 · Step 2 (continuation): `label/code128c.js` and its test

*This file is Step 2 of Task 13 (`task-13.md`); it has no commit of its own.*

Spec D10, §6, E13. A pure function from a string of an even number of ASCII digits to the symbol values `[105 START-C, …pairs, check, 106 STOP]`; anything else is null and nothing is drawn (a wrong barcode is worse than none). The 107-row pattern table is the prototype's (`/c/tmp/homunculus-tasarim/dashboard/src/patientLabel.js` `CODE128_PATTERNS`, read only), copied value for value. The test checks the table's structure, a hand-computed checksum, the fixed 121 modules, and decodes the drawn bars back to the digits with a decoder that reads only the SVG's geometry.

- [ ] **Step 2a: Write the failing test.** **Write** `dashboard/src/live/screens/kabul/label/code128c.test.js`:

```js
// The protocol number's barcode (G2-B1d, spec D10, §6): Code 128-C — digit pairs, so twelve digits
// are six data symbols and 121 modules with the two quiet zones. A table is data and cannot be read
// by eye; Code 128's own invariants catch a typo in it (every pattern 11 modules, STOP 13, no two
// alike), a hand-computed checksum pins the arithmetic, and the drawn bars are decoded back to the
// digits by a decoder that reads only the SVG's rectangles.
import { describe, it, expect } from "vitest";
import {
  PATTERNS, QUIET_MODULES, START_C, STOP, bars, code128cSvg, code128cValues, moduleCount,
} from "./code128c.js";

const sum = (pattern) => [...pattern].reduce((a, c) => a + Number(c), 0);

/** The SVG back to its digits, from its geometry alone: the bars' x and width, the gaps between
 *  them, the quiet zones; then six elements a symbol (STOP seven), each looked up, START-C first,
 *  the checksum held to the rule. Throws on anything that is not a clean Code 128-C. */
function decode(svg) {
  const total = Number(svg.match(/viewBox="0 0 (\d+) 1"/)[1]);
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="1"\/>/g)]
    .map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
  const elements = [];
  rects.forEach((r, i) => {
    elements.push(r.w);
    if (i + 1 < rects.length) elements.push(rects[i + 1].x - (r.x + r.w));
  });
  const quiet = [rects[0].x, total - (rects.at(-1).x + rects.at(-1).w)];
  const symbols = [];
  for (let at = 0; at < elements.length - 7; at += 6) symbols.push(elements.slice(at, at + 6).join(""));
  symbols.push(elements.slice(-7).join(""));
  const valueOf = new Map(PATTERNS.map((p, v) => [p, v]));
  const values = symbols.map((s) => {
    if (!valueOf.has(s)) throw new Error(`no symbol ${s}`);
    return valueOf.get(s);
  });
  if (values[0] !== START_C || values.at(-1) !== STOP) throw new Error("not START-C … STOP");
  const data = values.slice(1, -2);
  const check = data.reduce((acc, v, i) => acc + v * (i + 1), START_C) % 103;
  if (check !== values.at(-2)) throw new Error("checksum");
  return { digits: data.map((v) => String(v).padStart(2, "0")).join(""), quiet, total };
}

describe("the Code 128 table", () => {
  it("holds 107 patterns: 0–102 data, 103–105 the starts, 106 STOP", () => {
    expect(PATTERNS).toHaveLength(107);
    expect(Object.isFrozen(PATTERNS)).toBe(true);
  });

  it("every pattern is six elements of 11 modules; STOP is seven of 13", () => {
    PATTERNS.forEach((pattern, value) => {
      const want = value === STOP ? { modules: 13, elements: 7 } : { modules: 11, elements: 6 };
      expect({ value, modules: sum(pattern), elements: pattern.length }).toEqual({ value, ...want });
    });
  });

  it("no two patterns are alike, and START-C, STOP and two data symbols are the standard's", () => {
    expect(new Set(PATTERNS).size).toBe(PATTERNS.length);
    expect([PATTERNS[START_C], PATTERNS[STOP], PATTERNS[0], PATTERNS[20]]).toEqual(["211232", "2331112", "212222", "221231"]);
  });
});

describe("code128cValues", () => {
  it("encodes digit pairs after START-C, then the checksum and STOP", () => {
    // 105 + 20·1 + 26·2 + 0·3 + 0·4 + 0·5 + 1·6 = 183; 183 mod 103 = 80 — by hand.
    expect(code128cValues("202600000001")).toEqual([105, 20, 26, 0, 0, 0, 1, 80, 106]);
    expect(code128cValues("000000000000")).toEqual([105, 0, 0, 0, 0, 0, 0, 105 % 103, 106]);
  });

  it.each([["12345"], ["20260000000A"], [""], [" 202600000001"], ["２０２６"], [null], [202600000001], ["H2600042"]])(
    "draws nothing for %j — a wrong barcode is worse than none", (input) => {
      expect(code128cValues(input)).toBeNull();
      expect(code128cSvg(input, { moduleMm: 0.375, heightMm: 10 })).toBeNull();
    });

  it("twelve digits are 121 modules, the two quiet zones of 10 counted (E13)", () => {
    expect(moduleCount(code128cValues("202600000001"))).toBe(121);
    expect(moduleCount(code128cValues("20"))).toBe(10 + 11 + 11 + 11 + 13 + 10);
    expect(bars(code128cValues("202600000001"))[0].x).toBe(QUIET_MODULES);
  });
});

describe("code128cSvg", () => {
  it("is decoded back to the same twelve digits, with its quiet zones, from the drawing alone", () => {
    for (const digits of ["202600000001", "999999999999", "000000000000", "123456789012"]) {
      const got = decode(code128cSvg(digits, { moduleMm: 0.375, heightMm: 10 }));
      expect(got).toEqual({ digits, quiet: [QUIET_MODULES, QUIET_MODULES], total: 121 });
    }
  });

  it("a bar out of place is no barcode at all", () => {
    const svg = code128cSvg("202600000001", { moduleMm: 0.375, heightMm: 10 });
    const broken = svg.replace(/<rect x="(\d+)" y="0" width="1"/, (m, x) => `<rect x="${Number(x) + 1}" y="0" width="1"`);
    expect(broken).not.toBe(svg);
    expect(() => decode(broken)).toThrow();
  });

  it("sizes itself in millimetres: 121 modules at the dpi's module, crisp, the number its name", () => {
    const svg = code128cSvg("202600000001", { moduleMm: (3 * 25.4) / 203, heightMm: 10 });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('width="45.420mm"');
    expect(svg).toContain('height="10mm"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('aria-label="202600000001"');
  });
});
```

- [ ] **Step 2b: Red.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/label/code128c.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |Error" | head -5
```

Expected: `FAIL … Failed to resolve import "./code128c.js"`.

- [ ] **Step 2c: The encoder.** **Write** `dashboard/src/live/screens/kabul/label/code128c.js`:

```js
// src/live/screens/kabul/label/code128c.js — the protocol number as a Code 128-C barcode (Group 2 ·
// B1d, spec D10, §6).
//
// Code 128-C encodes digit PAIRS: the twelve-digit protocol is six data symbols, 121 modules with
// its two 10-module quiet zones (Code 128-B, the prototype's, would need 187 and would not fit a
// 50 mm label at 3 printer dots a module). Input that is not an even number of ASCII digits is
// null, and nothing is drawn: a barcode that scans as another number is worse than none.
//
// The table is the prototype's (tasarim/prototip dashboard/src/patientLabel.js CODE128_PATTERNS),
// value for value: each pattern is six element widths — bar, space, bar, space, bar, space — of 11
// modules; STOP (106) is seven of 13. code128c.test.js checks every row and decodes the drawing back.

export const PATTERNS = Object.freeze([
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
]);

export const START_C = 105;
export const STOP = 106;
export const QUIET_MODULES = 10;

/** `digits` — a string of an even number of ASCII digits — as its symbol values
 *  [START-C, …pairs, checksum, STOP]; null for anything else. */
export function code128cValues(digits) {
  if (typeof digits !== "string" || !/^(?:[0-9]{2})+$/.test(digits)) return null;
  const pairs = [];
  for (let at = 0; at < digits.length; at += 2) pairs.push(Number(digits.slice(at, at + 2)));
  const check = pairs.reduce((acc, value, i) => acc + value * (i + 1), START_C) % 103;
  return [START_C, ...pairs, check, STOP];
}

/** The element widths of the symbols, bar first and alternating, one digit each. */
function widths(values) {
  return values.map((value) => PATTERNS[value]).join("");
}

/** The whole symbol's width in modules, both quiet zones counted (twelve digits: 121). */
export function moduleCount(values) {
  return QUIET_MODULES * 2 + [...widths(values)].reduce((acc, w) => acc + Number(w), 0);
}

/** The bars, in modules from the left edge: [{x, w}], the first right after the quiet zone. */
export function bars(values) {
  const out = [];
  let x = QUIET_MODULES;
  let bar = true;
  for (const w of widths(values)) {
    if (bar) out.push({ x, w: Number(w) });
    x += Number(w);
    bar = !bar;
  }
  return out;
}

/** The barcode as an SVG `moduleMm` millimetres a module and `heightMm` high — crisp edges, in
 *  module units inside — or null when `digits` cannot be encoded. */
export function code128cSvg(digits, { moduleMm, heightMm }) {
  const values = code128cValues(digits);
  if (!values) return null;
  const total = moduleCount(values);
  const rects = bars(values).map(({ x, w }) => `<rect x="${x}" y="0" width="${w}" height="1"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(total * moduleMm).toFixed(3)}mm" `
    + `height="${heightMm}mm" viewBox="0 0 ${total} 1" preserveAspectRatio="none" `
    + `shape-rendering="crispEdges" role="img" aria-label="${digits}">`
    + `<rect width="${total}" height="1" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
```

(The white background is a `<rect width=… height="1" fill="#fff"/>` with no `x`: the decoder's pattern reads only `<rect x="…" y="0" …/>`, so it never counts it as a bar.)

- [ ] **Step 2d: Green**, the Step 2b command: no `FAIL` — 16 tests (8 of them parametrised). Continue with Step 3 in `task-13.md`.

---

### Task 13 · Step 3 (continuation): `label/protocolLabel.js`, `label/PrintLabelButton.jsx` and their tests

*This file is Step 3 of Task 13 (`task-13.md`); it has no commit of its own.*

Spec §3 (the client mirrors the fit formula on the same case table), §6 (layout, printing), D6, D10, E13. `protocolLabel.js` is pure but for its two window functions: the fit rule (`labelRefusal`, the engine's `protocol/fit.py` line for line), the lines (dropped when empty, never «—»; the full name — paper is never masked), the page (`@page { size: <w>mm <h>mm; margin: 0 }`; a module of 3 dots at 203 dpi, 4 at 300; ≈10 mm of bars; a larger size prints the same lines larger), and the print (`window.print()` a moment after the page is written). `PrintLabelButton` opens the window IN the click — a window opened after an `await` is a pop-up the browser blocks — then asks `POST /admissions/{id}/label` and writes the page; a refusal closes the window and says why.

- [ ] **Step 3a: Write the failing tests.** **Write** `dashboard/src/live/screens/kabul/label/protocolLabel.test.js`:

```js
// The protocol label (G2-B1d, spec §3, §6): the barcode-fit rule on the ENGINE's case table
// (homunculus-engine/tests/label_fit_cases.json — one table pins both sides, E13), the lines in
// their order with the empty ones dropped and the name in full, the page in the configured size
// with a module of whole printer dots, and the print. Synthetic labels only.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DICTIONARIES } from "../../../i18n/catalog.js";
import { createTranslator } from "../../../i18n/translate.js";
import {
  TEST_PROTOCOL, birthText, labelHtml, labelLines, labelRefusal, minWidthMm, moduleMm,
  openLabelWindow, printLabel, testLabel,
} from "./protocolLabel.js";

// (Paths built with node:path: under jsdom the global URL is jsdom's — apiErrors.test.js.)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(fs.readFileSync(
  path.resolve(HERE, "../../../../../../homunculus-engine/tests/label_fit_cases.json"), "utf8"));
const t = createTranslator("az", DICTIONARIES);

const LABEL = {
  protocol_no: "202600000001", display_name: "Test Hasta", date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "1", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 },
};

describe("the fit rule — the engine's own case table", () => {
  it.each(TABLE.cases.map((c) => [`${c.width_mm}x${c.height_mm}@${c.printer_dpi}`, c]))("%s", (_name, c) => {
    expect(labelRefusal(c.width_mm, c.height_mm, c.printer_dpi)).toBe(c.answer);
  });

  it("a module is whole printer dots, and the narrowest label is the table's", () => {
    expect(moduleMm(203)).toBeCloseTo((3 * 25.4) / 203, 9);
    expect(moduleMm(300)).toBeCloseTo((4 * 25.4) / 300, 9);
    for (const [dpi, min] of Object.entries(TABLE.min_width_mm)) expect(minWidthMm(Number(dpi))).toBeCloseTo(min, 3);
  });

  it("refuses what the server's types refuse: a dpi as text, a size not a whole millimetre", () => {
    expect(labelRefusal(50, 30, "203")).toBe("label_dpi");
    expect(labelRefusal(50.5, 30, 203)).toBe("label_size");
    expect(labelRefusal(Number.NaN, 30, 203)).toBe("label_size");
  });
});

describe("the lines", () => {
  it("are the protocol, the full name, birth date · sex, unit · bed — in that order", () => {
    expect(labelLines(LABEL, t)).toEqual([
      { kind: "protocol", text: "202600000001" }, { kind: "name", text: "Test Hasta" },
      { kind: "born", text: "05.05.1970 · Qadın" }, { kind: "place", text: "Reanimasiya · Çarpayı 1" },
    ]);
  });

  it("drop what is empty — never «—» — and keep what is left of a line", () => {
    const lines = labelLines({ ...LABEL, date_of_birth: null, sex: "", unit_name: "  ", bed_label: "1" }, t);
    expect(lines.map((l) => l.kind)).toEqual(["protocol", "name", "place"]);
    expect(lines.at(-1).text).toBe("Çarpayı 1");
    expect(JSON.stringify(labelLines({ ...LABEL, sex: "x", date_of_birth: "05/05/1970", unit_name: null, bed_label: null }, t)))
      .not.toMatch(/—|undefined|null/);
  });

  it("print a birth date only when it is a whole ISO date — a wrong date is worse than none", () => {
    expect(birthText("1970-05-05")).toBe("05.05.1970");
    for (const bad of ["1970-5-5", "05.05.1970", "", null, "1970-05-05T00:00:00Z"]) expect(birthText(bad)).toBeNull();
  });
});

describe("the page", () => {
  it("is the configured size, margin-free, its bars whole printer dots, the name in full", () => {
    const html = labelHtml(LABEL, { t, lang: "az" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("@page { size: 50mm 30mm; margin: 0; }");
    expect(html).toContain('width="45.420mm"');                 // 121 × 3 dots at 203 dpi
    expect(html).toContain('height="10mm"');
    expect(html).toContain("Test Hasta");
    expect(html).toContain('<html lang="az">');
    const at300 = labelHtml({ ...LABEL, label: { width_mm: 60, height_mm: 60, printer_dpi: 300 } }, { t, lang: "az" });
    expect(at300).toContain("@page { size: 60mm 60mm; margin: 0; }");
    expect(at300).toContain('width="40.979mm"');                // 121 × 4 dots at 300 dpi
    expect(at300).toContain('height="20mm"');                   // a larger label, the same lines larger
  });

  it("writes every text as text", () => {
    const html = labelHtml({ ...LABEL, display_name: "Test <b>Hasta</b> & \"O'Brien\"" }, { t, lang: "az" });
    expect(html).toContain("Test &lt;b&gt;Hasta&lt;/b&gt; &amp; &quot;O&#39;Brien&quot;");
    expect(html).not.toContain("<b>Hasta</b>");
  });

  it("prints a moment after it is written, and a blocked window is no window", () => {
    let written = "";
    const popup = { document: { open: vi.fn(), write: (s) => { written += s; }, close: vi.fn() },
      focus: vi.fn(), print: vi.fn() };
    printLabel(popup, LABEL, { t, lang: "az", schedule: (fn) => fn() });
    expect(written).toContain("202600000001");
    expect(popup.document.close).toHaveBeenCalled();
    expect(popup.print).toHaveBeenCalledTimes(1);
    expect(openLabelWindow({ open: () => null })).toBeNull();
    expect(openLabelWindow({ open: () => { throw new Error("blocked"); } })).toBeNull();
  });

  it("the test label is synthetic: the zero protocol, the words «test label», nothing else", () => {
    const label = testLabel(t, { width_mm: 50, height_mm: 30, printer_dpi: 300 });
    expect(label.protocol_no).toBe(TEST_PROTOCOL);
    expect(TEST_PROTOCOL).toBe("000000000000");
    expect(labelLines(label, t)).toEqual([{ kind: "protocol", text: "000000000000" }, { kind: "name", text: "SINAQ ETİKETİ" }]);
    expect(label.label).toEqual({ width_mm: 50, height_mm: 30, printer_dpi: 300 });
  });
});
```

**Write** `dashboard/src/live/screens/kabul/label/PrintLabelButton.test.jsx`:

```jsx
// «Etiketi çap et» (G2-B1d, spec §6): the window opens in the click, before the request — a window
// opened after an await is a pop-up the browser blocks — then the label's route is asked, a first
// print or a reprint, and the page written into it. A blocked window or a refusal says so on the
// toast; a refused label closes its window. Synthetic data only.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NURSE, settle, toasts } from "../kabul.testutil.js";
import { PrintLabelButton } from "./PrintLabelButton.jsx";

const LABEL = {
  protocol_no: "202600000001", display_name: "Test Hasta", date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "1", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 },
};

function fakeWindow() {
  const popup = { html: "", document: { open: vi.fn(), write(s) { popup.html += s; }, close: vi.fn() },
    focus: vi.fn(), print: vi.fn(), close: vi.fn() };
  return { popup, win: { open: vi.fn(() => popup) } };
}

async function mounted(ui, setup) {
  const m = await mount(ui, { access: token({ perms: NURSE }), me: profile({ perms: NURSE }), setup });
  await settle();
  return m;
}

describe("PrintLabelButton", () => {
  it("opens the window first, asks the label, and prints it", async () => {
    const { popup, win } = fakeWindow();
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" win={win} />,
      (a) => a.admissionLabel.mockResolvedValue(LABEL));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(win.open).toHaveBeenCalledTimes(1);
    expect(win.open.mock.invocationCallOrder[0]).toBeLessThan(api.admissionLabel.mock.invocationCallOrder[0]);
    expect(api.admissionLabel).toHaveBeenCalledWith("a-1", false);
    expect(popup.html).toContain("Test Hasta");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(popup.print).toHaveBeenCalledTimes(1);
  });

  it("a reprint says so, to the reader and to the route", async () => {
    const { win } = fakeWindow();
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" reprint win={win} />,
      (a) => a.admissionLabel.mockResolvedValue(LABEL));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi yenidən çap et" })); });
    await settle();
    expect(api.admissionLabel).toHaveBeenCalledWith("a-1", true);
  });

  it("a blocked window asks nothing and says how to allow it", async () => {
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" win={{ open: () => null }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(api.admissionLabel).not.toHaveBeenCalled();
    expect(toasts().getAllByText("Çap pəncərəsi açılmadı; brauzerdə bu saytın açılan pəncərələrinə icazə verin.").length)
      .toBeGreaterThan(0);
  });

  it("a refused label closes its window and says why, in the reader's words", async () => {
    const { popup, win } = fakeWindow();
    await mounted(<PrintLabelButton admissionId="a-1" win={win} />, (a) => a.admissionLabel.mockRejectedValue(
      refusal(409, "This admission has no protocol number, so no label.", { apiCode: "no_protocol" })));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(popup.close).toHaveBeenCalled();
    expect(toasts().getAllByText("Etiket alınmadı: Bu qəbulun protokol nömrəsi yoxdur: etiket çap oluna bilməz.").length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/no protocol number/);
  });
});
```

- [ ] **Step 3b: Red.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/label/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |Error" | head -6
```

Expected: `FAIL … Failed to resolve import "./protocolLabel.js"` and `… "./PrintLabelButton.jsx"`; `code128c.test.js` passes.

- [ ] **Step 3c: The label.** **Write** `dashboard/src/live/screens/kabul/label/protocolLabel.js`:

```js
// src/live/screens/kabul/label/protocolLabel.js — the protocol label (Group 2 · B1d, spec §3, §6,
// D6, D10): whether a size holds its barcode, its lines, its page and its print.
//
// THE FIT RULE IS THE ENGINE'S (protocol/fit.py), line for line, and one case table pins both
// (homunculus-engine/tests/label_fit_cases.json): 121 modules of whole printer dots — 3 at 203 dpi,
// 4 at 300 — and 1.5 mm each side; dpi, then size, then fit (E11).
//
// THE LINES: the barcode, the protocol large, the FULL name (a label is paper: the screen's masking
// does not apply), birth date · sex, unit · bed. A line with nothing to say is dropped, never written
// as «—»: an empty field printed as a dash reads as "none", and "not told" is not "none". The words
// on it are the printing user's language. A larger configured size prints the same lines larger.
import { code128cSvg } from "./code128c.js";

export const MM_PER_INCH = 25.4;
export const DOTS_PER_MODULE = Object.freeze({ 203: 3, 300: 4 });
export const BARCODE_MODULES = 121;
export const SIDE_MARGIN_MM = 1.5;
export const WIDTH_MM = Object.freeze([30, 110]);
export const HEIGHT_MM = Object.freeze([20, 80]);
/** The test label's protocol (spec §6): synthetic, and never a number the counter issues first. */
export const TEST_PROTOCOL = "000000000000";
const SEXES = new Set(["female", "male", "other", "unknown"]);

const knownDpi = (dpi) => Number.isInteger(dpi) && Object.hasOwn(DOTS_PER_MODULE, dpi);
const within = (value, [lo, hi]) => Number.isInteger(value) && value >= lo && value <= hi;

/** One bar module at this resolution, in millimetres. */
export function moduleMm(dpi) {
  return (DOTS_PER_MODULE[dpi] * MM_PER_INCH) / dpi;
}

/** The narrowest label that holds the barcode at this resolution. */
export function minWidthMm(dpi) {
  return BARCODE_MODULES * moduleMm(dpi) + 2 * SIDE_MARGIN_MM;
}

/** null when the label is accepted, else the refusal's code — the server's, in its order. */
export function labelRefusal(widthMm, heightMm, dpi) {
  if (!knownDpi(dpi)) return "label_dpi";
  if (!within(widthMm, WIDTH_MM) || !within(heightMm, HEIGHT_MM)) return "label_size";
  if (widthMm < minWidthMm(dpi)) return "label_too_narrow";
  return null;
}

/** "1970-05-05" → "05.05.1970"; anything else null — a wrong date printed is worse than none. Read
 *  from the text, never through Date: a date has no time zone to shift it a day. */
export function birthText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso : "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

const filled = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const joined = (parts) => parts.filter(Boolean).join(" · ") || null;

/** The label's lines in order, each {kind, text}; a line with nothing to say is not there. */
export function labelLines(label, t) {
  const sex = SEXES.has(label?.sex) ? t(`protokol.label.sex.${label.sex}`) : null;
  const bed = filled(label?.bed_label);
  return [
    { kind: "protocol", text: filled(label?.protocol_no) },
    { kind: "name", text: filled(label?.display_name) },
    { kind: "born", text: joined([birthText(label?.date_of_birth), sex]) },
    { kind: "place", text: joined([filled(label?.unit_name), bed ? `${t("protokol.label.bed")} ${bed}` : null]) },
  ].filter((line) => line.text);
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const mm = (value) => `${Math.round(value * 100) / 100}mm`;

/** The whole print page: `@page` in the label's size, margin-free; the bars ≈10 mm high at 30 mm,
 *  every size in proportion to the height. */
export function labelHtml(label, { t, lang }) {
  const { width_mm: w, height_mm: h, printer_dpi: dpi } = label.label;
  const k = h / 30;
  const svg = code128cSvg(label.protocol_no, { moduleMm: moduleMm(dpi), heightMm: Math.round(10 * k * 100) / 100 }) ?? "";
  const lines = labelLines(label, t)
    .map(({ kind, text }) => `<div class="line ${kind}">${escapeHtml(text)}</div>`).join("");
  return "<!doctype html>"
    + `<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(label.protocol_no ?? "")}</title><style>`
    + `@page { size: ${w}mm ${h}mm; margin: 0; }`
    + "html, body { margin: 0; padding: 0; background: #fff; color: #000; }"
    + `body { width: ${w}mm; height: ${h}mm; overflow: hidden; font-family: Arial, Helvetica, sans-serif; }`
    + `.label { box-sizing: border-box; width: ${w}mm; height: ${h}mm; padding: ${mm(k)} ${SIDE_MARGIN_MM}mm 0;`
    + " display: flex; flex-direction: column; align-items: center; }"
    + ".code svg { display: block; }"
    + ".line { width: 100%; text-align: center; line-height: 1.15; white-space: nowrap; overflow: hidden; }"
    + `.protocol { font-size: ${mm(3.6 * k)}; font-weight: 700; letter-spacing: .04em; }`
    + `.name { font-size: ${mm(2.9 * k)}; font-weight: 700; white-space: normal; overflow-wrap: anywhere;`
    + " display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }"
    + `.born, .place { font-size: ${mm(2.4 * k)}; }`
    + `</style></head><body><div class="label"><div class="code">${svg}</div>${lines}</div></body></html>`;
}

/** A window to print in, or null when the browser refused one. Called IN the click: a window
 *  opened after an await is a pop-up the browser blocks. */
export function openLabelWindow(win = window) {
  try {
    return win.open("", "_blank", "width=480,height=360") ?? null;
  } catch {
    return null;
  }
}

/** The page written into `popup`, then printed a moment later (the page must lay out first). */
export function printLabel(popup, label, { t, lang, schedule = (fn) => setTimeout(fn, 250) }) {
  const doc = popup.document;
  doc.open();
  doc.write(labelHtml(label, { t, lang }));
  doc.close();
  popup.focus?.();
  schedule(() => {
    try {
      popup.print();
    } catch {
      /* the reader may close it first */
    }
  });
}

/** The admin tab's test label (spec §6): synthetic only — the zero protocol and the words «test
 *  label» in the reader's language — in the size and resolution given. No request is made. */
export function testLabel(t, { width_mm, height_mm, printer_dpi }) {
  return { protocol_no: TEST_PROTOCOL, display_name: t("protokol.testName"), date_of_birth: null, sex: null,
    unit_name: null, bed_label: null, label: { width_mm, height_mm, printer_dpi } };
}
```

**Write** `dashboard/src/live/screens/kabul/label/PrintLabelButton.jsx`:

```jsx
// src/live/screens/kabul/label/PrintLabelButton.jsx — «Etiketi yazdır» / «Etiketi yeniden yazdır»
// (Group 2 · B1d, spec §6). The admit box (the first print) and the patient screen (a reprint) show
// it, for an admission with a protocol, to a holder of `admissions.admit`.
//
// THE WINDOW OPENS IN THE CLICK, before the request: a window opened after an await is a pop-up the
// browser blocks. Then POST /admissions/{id}/label — every print is an audited act — and the page
// is written into it. A blocked window asks nothing; a refused label closes its window; both say so
// on the toast, by code, never the server's words.
import React, { useState } from "react";
import { apiErrorText } from "../../../apiErrors.js";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { Button, useToast } from "../../../ui/index.js";
import { reasonOf } from "../../admin/refusal.js";
import { openLabelWindow, printLabel } from "./protocolLabel.js";

/** `win`: the window to open the print page from (a test's stand-in); the page's own by default. */
export function PrintLabelButton({ admissionId, reprint = false, win }) {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function print() {
    if (busy) return;
    const popup = openLabelWindow(win ?? window);
    if (!popup) {
      toast(t("protokol.popupBlocked"), "error");
      return;
    }
    setBusy(true);
    try {
      const label = await store.track(() => store.api.admissionLabel(admissionId, reprint));
      printLabel(popup, label, { t, lang });
    } catch (err) {
      try {
        popup.close();
      } catch {
        /* gone already */
      }
      // `reasonOf` turns an uncoded 404 into the reader's words; `apiErrorText` maps a code.
      toast(t("protokol.printFailed", { reason: apiErrorText(t, reasonOf(t, err)) }), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button icon="print" busy={busy} onClick={print}>{t(reprint ? "protokol.reprint" : "protokol.print")}</Button>
  );
}
```

- [ ] **Step 3d: Green**, the Step 3b command: no `FAIL` (the module's tests run; `reachable.test.js` is Step 6's, once the admit box imports the button). Continue with Step 4 in `task-13.md`.

---

### Task 14: Yönetim › Protokol ve etiket — the start number, the label, the test print

**Lane:** dashboard (`/c/tmp/g2b-b1d-fe`). **Needs:** Task 13 (`protocolLabel.js`).

Spec §3 (the setting), §6 (the test label), D5, D6, D11, E11. The tab reads `GET /admin/protocol-settings`, says whether a start number is set (none: no admission can be made) and the last number issued, and writes `PUT` with the four values. The client holds the same rules the server does before it sends — twelve ASCII digits; the size and the barcode's fit by the engine's own rule (`labelRefusal`), the narrowest width shown in whole millimetres — and a refusal the server still makes (`protocol_not_forward`: a number was issued meanwhile) goes on the toast by its code, and the settings are read again. **Deneme etiketi yazdır** prints the synthetic test label (`000000000000`, «DENEME ETİKETİ») in the size on screen, with no request. `structure.manage`, beside Yapı, through the TABS seam `// G2-B1d`.

**Files:**
- Create: `dashboard/src/live/screens/admin/ProtocolTab.test.jsx`
- Create: `dashboard/src/live/screens/admin/ProtocolTab.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.test.jsx`

- [ ] **Step 1: Write the failing tests.** **Write** `dashboard/src/live/screens/admin/ProtocolTab.test.jsx`:

```jsx
// Yönetim › Protokol ve etiket (G2-B1d, spec §3, §6, D5): the start number set, forward only; the
// label's size and dpi held to the barcode's fit before anything is sent; a refusal said by its
// code and the settings read again; the test label synthetic and sent nowhere. Synthetic data only.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ADMIN, UUID_TEXT, settle, toasts } from "../kabul/kabul.testutil.js";
import { ProtocolTab } from "./ProtocolTab.jsx";

const UNSET = { configured: false, next_no: null, last_issued: null, label_width_mm: 50, label_height_mm: 30,
  printer_dpi: 203, updated_at: null };
const SET = { ...UNSET, configured: true, next_no: "202600000042", last_issued: "202600000041",
  updated_at: "2026-11-01T08:00:00Z" };

async function mounted(setup, props = {}) {
  const m = await mount(<ProtocolTab {...props} />, {
    access: token({ perms: ADMIN }), me: profile({ perms: ADMIN }), setup,
  });
  await settle();
  return m;
}

const nextNo = () => screen.getByLabelText(/^Növbəti protokol nömrəsi/);
const width = () => screen.getByLabelText(/^Etiketin eni/);
const save = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); });
  await settle();
};

describe("ProtocolTab", () => {
  it("says no admission can be made until a start number is set", async () => {
    await mounted((a) => a.protocolSettings.mockResolvedValue(UNSET));
    expect(screen.getByText("Başlanğıc nömrəsi daxil edilməyib: daxil edilənədək heç bir qəbul aparıla bilməz.")).toBeTruthy();
    expect(screen.getByText("Hələ nömrə verilməyib.")).toBeTruthy();
    expect(nextNo().value).toBe("");
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("sets the start number and the label, and says so", async () => {
    const { api } = await mounted((a) => {
      a.protocolSettings.mockResolvedValue(UNSET);
      a.saveProtocolSettings.mockResolvedValue({ ...UNSET, configured: true, next_no: "202600000001" });
    });
    fireEvent.change(nextNo(), { target: { value: "202600000001" } });
    await save();
    expect(api.saveProtocolSettings).toHaveBeenCalledWith(
      { next_no: "202600000001", label_width_mm: 50, label_height_mm: 30, printer_dpi: 203 });
    expect(toasts().getAllByText("Protokol və etiket ayarları yadda saxlanıldı.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Başlanğıc nömrəsi daxil edilməyib/)).toBeNull();
  });

  it("shows the last number issued and the number the next admission takes", async () => {
    await mounted((a) => a.protocolSettings.mockResolvedValue(SET));
    expect(screen.getByText("Verilən son nömrə: 202600000041")).toBeTruthy();
    expect(nextNo().value).toBe("202600000042");
  });

  it("sends nothing until the number is twelve digits, and says what it takes", async () => {
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(UNSET));
    for (const typed of ["2026", "20260000000A", "２０２６００００００１"]) {
      fireEvent.change(nextNo(), { target: { value: typed } });
      await save();
    }
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
    expect(screen.getByText("12 rəqəm daxil edin.")).toBeTruthy();
  });

  it("holds a label the barcode does not fit, by the engine's own rule, and names the narrowest", async () => {
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(SET));
    expect(screen.getByText("Barkod sığır: bu ayırdetmədə ən azı 49 mm en lazımdır.")).toBeTruthy();
    fireEvent.change(width(), { target: { value: "48" } });
    expect(screen.getByText("Barkod bu enə sığmır: ən azı 49 mm lazımdır.")).toBeTruthy();
    await save();
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Printerin ayırdetməsi/), { target: { value: "300" } });
    expect(screen.getByText("Barkod sığır: bu ayırdetmədə ən azı 44 mm en lazımdır.")).toBeTruthy();
  });

  it("says a forward-only refusal by its code and reads the settings again", async () => {
    const { api } = await mounted((a) => {
      a.protocolSettings.mockResolvedValue(SET);
      a.saveProtocolSettings.mockRejectedValue(refusal(409, "The next protocol number must be greater than the last one issued.",
        { apiCode: "protocol_not_forward" }));
    });
    fireEvent.change(nextNo(), { target: { value: "202600000040" } });
    await save();
    expect(toasts().getAllByText(/Bu nömrə geri gedir: verilən son nömrədən böyük olmalıdır/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/must be greater/);
    expect(api.protocolSettings).toHaveBeenCalledTimes(2);
    expect(nextNo().value).toBe("202600000042");
  });

  it("prints a synthetic test label in the size on screen, and asks the server nothing", async () => {
    let html = "";
    const popup = { document: { open() {}, write(s) { html += s; }, close() {} }, focus() {}, print: vi.fn() };
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(SET), { win: { open: () => popup } });
    fireEvent.change(width(), { target: { value: "60" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sınaq etiketi çap et" })); });
    await settle();
    expect(html).toContain("000000000000");
    expect(html).toContain("SINAQ ETİKETİ");
    expect(html).toContain("@page { size: 60mm 30mm; margin: 0; }");
    expect(api.admissionLabel).not.toHaveBeenCalled();
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
  });

  it("says the settings could not be read, in the reader's words", async () => {
    await mounted((a) => a.protocolSettings.mockRejectedValue(refusal(503, "Service Unavailable")));
    expect(screen.getByText(/^Ayarlar oxunmadı: /)).toBeTruthy();
  });
});
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.test.jsx` (1) — replace:

```js
import { StructureTab } from "./StructureTab.jsx"; // G2-B1a
```

with:

```js
import { StructureTab } from "./StructureTab.jsx"; // G2-B1a
import { ProtocolTab } from "./ProtocolTab.jsx"; // G2-B1d
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.test.jsx` (2) — replace:

```js
      ["structure", "structure.manage"], // G2-B1a
    ]);
```

with:

```js
      ["structure", "structure.manage"], // G2-B1a
      ["protocol", "structure.manage"], // G2-B1d
    ]);
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.test.jsx` (3) — replace:

```js
    expect(openTabs(["structure.manage"]).map((x) => x.id)).toEqual(["structure"]);
    expect(tabScreenOf(openTabs(["structure.manage"])[0])).toBe(StructureTab);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).not.toContain("structure");
  });
```

with:

```js
    expect(openTabs(["structure.manage"]).map((x) => x.id)).toEqual(["structure", "protocol"]);
    expect(tabScreenOf(openTabs(["structure.manage"])[0])).toBe(StructureTab);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).not.toContain("structure");
  });

  // G2-B1d — Protokol ve etiket is built, and `structure.manage` alone opens it (spec D11).
  it("offers the protocol tab to structure.manage, and to no other right", () => {
    expect(tabScreenOf(openTabs(["structure.manage"])[1])).toBe(ProtocolTab);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).not.toContain("protocol");
  });
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/admin/ProtocolTab.test.jsx src/live/screens/admin/AdminScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |Error" | head -5
```

Expected: `FAIL … Failed to resolve import "./ProtocolTab.jsx"` in both files.

- [ ] **Step 3: The tab.** **Write** `dashboard/src/live/screens/admin/ProtocolTab.jsx`:

```jsx
// src/live/screens/admin/ProtocolTab.jsx — Yönetim › Protokol ve etiket (Group 2 · B1d, spec §3,
// §6, D5, D6, D11): the protocol number the next admission takes, and the label it prints on.
// `structure.manage`.
//
// NO ADMISSION UNTIL A START NUMBER IS SET (D5): a range Homunculus picked by itself could collide
// with the old HBYS's protocols, so the tab says so while none is set. The number moves FORWARD only:
// the server refuses one not above the last issued (`protocol_not_forward`) — said on the toast by its
// code, and the settings read again (a number may have been issued since this screen read them).
//
// THE CLIENT HOLDS THE SERVER'S RULES BEFORE IT SENDS: twelve ASCII digits; the size and the fit by
// the engine's own rule (`labelRefusal`, one case table pins both), the narrowest width named in whole
// millimetres — the width is whole millimetres too. «Deneme etiketi yazdır» prints the synthetic test
// label in the size on screen (the saved one while the screen's does not fit): no request, no patient.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Field, Input, Note, Select, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import {
  DOTS_PER_MODULE, labelRefusal, minWidthMm, openLabelWindow, printLabel, testLabel,
} from "../kabul/label/protocolLabel.js";

const DPIS = Object.keys(DOTS_PER_MODULE).map(Number);
const TWELVE = /^[0-9]{12}$/;
/** What the fit paragraph says for each of the rule's answers (`label_dpi` cannot be chosen here). */
const UNFIT = Object.freeze({
  label_size: "protokol.invalid.size", label_too_narrow: "protokol.invalid.tooNarrow", label_dpi: "protokol.err.dpi",
});

const formOf = (s) => ({
  nextNo: s?.next_no ?? "", width: String(s?.label_width_mm ?? 50), height: String(s?.label_height_mm ?? 30),
  dpi: s?.printer_dpi ?? 203,
});

/** `win`: the window to open the test print from (a test's stand-in); the page's own by default. */
export function ProtocolTab({ win }) {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => formOf(null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.protocolSettings());
      setSettings(got);
      setForm(formOf(got));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const width = Number(form.width);
  const height = Number(form.height);
  const dpi = Number(form.dpi);
  const fit = labelRefusal(width, height, dpi);
  const badNumber = !TWELVE.test(form.nextNo);
  const narrowest = DPIS.includes(dpi) ? Math.ceil(minWidthMm(dpi)) : null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (badNumber || fit) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const got = await store.track(() => store.api.saveProtocolSettings({
        next_no: form.nextNo, label_width_mm: width, label_height_mm: height, printer_dpi: dpi,
      }));
      setSettings(got);
      setForm(formOf(got));
      setTried(false);
      toast(t("protokol.saved"));
    } catch (err) {
      toast(refusedFor(t, t("protokol.tab"), err), "error");
      await read();
    } finally {
      setBusy(false);
    }
  }

  function testPrint() {
    const popup = openLabelWindow(win ?? window);
    if (!popup) {
      toast(t("protokol.popupBlocked"), "error");
      return;
    }
    const size = fit
      ? { width_mm: settings?.label_width_mm ?? 50, height_mm: settings?.label_height_mm ?? 30,
        printer_dpi: settings?.printer_dpi ?? 203 }
      : { width_mm: width, height_mm: height, printer_dpi: dpi };
    printLabel(popup, testLabel(t, size), { t, lang });
  }

  if (settings === null && error === null) {
    return <Box><p className="m-0 text-13 text-mute">{t("protokol.loading")}</p></Box>;
  }
  return (
    <div className="grid max-w-[720px] gap-3">
      {error ? <Alert tone="crit">{t("protokol.readFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      <Box title={t("protokol.title")} icon="qr" level={2}>
        <p className="m-0 mb-3 text-13 text-mute">{t("protokol.sub")}</p>
        {settings && !settings.configured ? (
          <Note tone="warn" icon="alert" className="mb-3">{t("protokol.notConfigured")}</Note>
        ) : null}
        <p className="m-0 mb-3 text-13">
          {settings?.last_issued ? t("protokol.lastIssued", { number: settings.last_issued }) : t("protokol.noneIssued")}
        </p>
        <form noValidate autoComplete="off" onSubmit={save}>
          <Field label={t("protokol.nextNo")} hint={t("protokol.nextNoHint")} required
            error={tried && badNumber ? t("protokol.invalid.nextNo") : undefined}>
            <Input value={form.nextNo} inputMode="numeric" maxLength={12} className="font-data"
              onChange={(e) => set({ nextNo: e.target.value })} />
          </Field>
          <Field label={t("protokol.width")}>
            <Input type="number" min={30} max={110} step={1} value={form.width}
              onChange={(e) => set({ width: e.target.value })} />
          </Field>
          <Field label={t("protokol.height")}>
            <Input type="number" min={20} max={80} step={1} value={form.height}
              onChange={(e) => set({ height: e.target.value })} />
          </Field>
          <Field label={t("protokol.dpi")}>
            <Select value={String(form.dpi)} onChange={(e) => set({ dpi: Number(e.target.value) })}>
              {DPIS.map((d) => <option key={d} value={String(d)}>{`${d} dpi`}</option>)}
            </Select>
          </Field>
          <p className={`m-0 mb-2 text-13 font-semibold ${fit ? "text-crit-ink" : "text-mute"}`}>
            {fit ? t(UNFIT[fit], { min: narrowest ?? "" }) : t("protokol.fits", { min: narrowest })}
          </p>
          <Note tone="info" icon="print" className="mb-3">{t("protokol.setupNote")}</Note>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>{t("protokol.save")}</Button>
            <Button icon="print" onClick={testPrint}>{t("protokol.testPrint")}</Button>
          </div>
        </form>
      </Box>
    </div>
  );
}
```

- [ ] **Step 4: The seam.** Every edit in `dashboard/src/live/screens/admin/AdminScreen.jsx`.

**Edit** (1) — replace:

```js
//   Structure        G2-B1a  `structure.manage`                  /tenant/structure, /tenant/*
```

with:

```js
//   Structure        G2-B1a  `structure.manage`                  /tenant/structure, /tenant/*
//   Protocol, label  G2-B1d  `structure.manage`                  /admin/protocol-settings
```

**Edit** (2) — replace:

```js
import { StructureTab } from "./StructureTab.jsx"; // G2-B1a
```

with:

```js
import { StructureTab } from "./StructureTab.jsx"; // G2-B1a

import { ProtocolTab } from "./ProtocolTab.jsx"; // G2-B1d
```

**Edit** (3) — replace:

```js
  Object.freeze({ id: "structure", perm: "structure.manage", labelKey: "kabul.structureTab" }),
]);
```

with:

```js
  Object.freeze({ id: "structure", perm: "structure.manage", labelKey: "kabul.structureTab" }),

  // G2-B1d — Yönetim › Protokol ve etiket: the next protocol number and the label (spec D11)
  Object.freeze({ id: "protocol", perm: "structure.manage", labelKey: "protokol.tab" }),
]);
```

**Edit** (4) — replace:

```js
  structure: StructureTab, // G2-B1a
});
```

with:

```js
  structure: StructureTab, // G2-B1a

  protocol: ProtocolTab, // G2-B1d
});
```

- [ ] **Step 5: Green**, with the admin screen's other tests and the reachability walk:

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/admin/ src/reachable.test.js src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no `FAIL` — the new file's 8.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-b1d-fe
git add -- dashboard/src/live/screens/admin/ProtocolTab.test.jsx dashboard/src/live/screens/admin/ProtocolTab.jsx dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx
git status --short && git diff --cached --stat
git commit -F - -- dashboard/src/live/screens/admin/ProtocolTab.test.jsx dashboard/src/live/screens/admin/ProtocolTab.jsx dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx <<'EOF'
feat(admin): Yönetim › Protokol ve etiket — the start number forward only, the label's size and dpi, a synthetic test print

structure.manage beside Yapı, through the TABS seam (D11). It says no admission can be made until a
start number is set (D5), shows the last number issued, holds twelve digits and the barcode's fit
by the engine's rule before it sends (the narrowest width in whole mm), says protocol_not_forward by
its code and reads the settings again. The test label is 000000000000 and «test label», in the size
on screen, with no request (spec §6).

red: no ./ProtocolTab.jsx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 15: The card key in Yataklar, Taburcu and the sign-off strip

**Lane:** dashboard (`/c/tmp/g2b-b1d-fe`). **Needs:** Task 13 (`boardKey.js`).

Spec §4 (Dashboard: «every match between an admission and a card uses `board_key`»), D7, E12. Three matches read `patient_number` today: the bed board's «Hekim imzası bekliyor» badge (`BedsScreen.jsx` `draftNumbers`), the Taburcu tab's critical-alarm hold and its rows' number (`DischargeTab.jsx`), and the sign-off strip on the patient screen (`SignOffStrip.jsx`). Each goes through `boardKeyOf`. A legacy row (no `board_key`) keeps matching by its H-number, so every B1a test stays as it is.

**Files:**
- Modify: `dashboard/src/live/screens/kabul/SignOffStrip.test.jsx`
- Modify: `dashboard/src/live/screens/kabul/DischargeTab.test.jsx`
- Modify: `dashboard/src/live/screens/beds/BedsScreen.jsx`
- Modify: `dashboard/src/live/screens/kabul/SignOffStrip.jsx`
- Modify: `dashboard/src/live/screens/kabul/DischargeTab.jsx`

- [ ] **Step 1: Write the failing tests.**

**Edit** `dashboard/src/live/screens/kabul/SignOffStrip.test.jsx` — at the end of the file, add:

```jsx

// G2-B1d (spec §4, E12): an admission made since 0015 is on the board under its protocol number.
describe("the protocol-keyed card (G2-B1d)", () => {
  const PROTOCOL = "202600000007";
  const KEYED = [row({ id: "a-7", patient_number: "H2600007", protocol_no: PROTOCOL, board_key: PROTOCOL, state: "DRAFT" })];

  it("finds its admission under the protocol, never under the H-number", async () => {
    await mountKabul(<SignOffStrip patientId={PROTOCOL} />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(KEYED) });
    expect(screen.getByText(WAITS)).toBeTruthy();
    cleanup();
    await mountKabul(<SignOffStrip patientId="H2600007" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(KEYED) });
    expect(screen.queryByText(WAITS)).toBeNull();
  });

  it("marks the protocol-keyed card on the bed board, and no other", async () => {
    const mounted = await mountKabul(<BedsScreen />, {
      perms: ["board.view", "admissions.view"],
      shell: { units: [] },
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([kabulCard(PROTOCOL, "2"), kabulCard("H2600001", "1")]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.admissions.mockResolvedValue(KEYED);
      },
    });
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
    expect(screen.getByRole("link", { name: `2 xəstəsini aç · ${BADGE}` })).toBeTruthy();
    expect(screen.getAllByText(BADGE)).toHaveLength(1);
    expectNoUuid();
  });
});
```

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.test.jsx` — at the end of the file, add:

```jsx

// G2-B1d (spec §4, E12): the row says the card's number, and the hold reads the card's alarms.
describe("DischargeTab · the protocol (G2-B1d)", () => {
  const KEYED = [row({ id: "a-1", patient_number: "H2600001", protocol_no: "202600000001", board_key: "202600000001",
    bed_label: "2", state: "ACTIVE" })];

  it("names the row by its card's number and holds its start for the protocol card's critical alarm", async () => {
    const { api } = await open(DOCTOR, (a) => {
      a.admissions.mockResolvedValue(KEYED);
      a.boardPatients.mockResolvedValue(board([entry("202600000001", [alarm("septic_shock", "critical")])]));
    });
    expect(screen.getByText("202600000001")).toBeTruthy();
    expect(screen.queryByText("H2600001")).toBeNull();
    expectHeld(api, "Təsdiqlənməmiş kritik siqnal var: əvvəlcə siqnala baxın.");
  });

  it("is not held by an alarm under the H-number: that is not this admission's card", async () => {
    await open(DOCTOR, (a) => {
      a.admissions.mockResolvedValue(KEYED);
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [alarm("septic_shock", "critical")])]));
    });
    expect(startAllowed()).toBe(true);
  });
});
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/SignOffStrip.test.jsx src/live/screens/kabul/DischargeTab.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL " | head
```

Expected: the four new tests fail — the strip and the badge look for `H2600007`, the row shows `H2600001` and its start is held by the H-number's alarm, not the protocol's; every B1a test passes.

- [ ] **Step 3: The matches.**

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (1) — replace:

```js
import { useAdmissions } from "../kabul/useAdmissions.js";          // G2-B1a
```

with:

```js
import { useAdmissions } from "../kabul/useAdmissions.js";          // G2-B1a
import { boardKeyOf } from "../kabul/boardKey.js";                  // G2-B1d: the card key
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (2) — replace:

```js
  const draftNumbers = useMemo(() => new Set((drafts.rows ?? []).map((r) => r.patient_number)), [drafts.rows]);
```

with:

```js
  const draftNumbers = useMemo(() => new Set((drafts.rows ?? []).map(boardKeyOf)), [drafts.rows]);
```

**Edit** `dashboard/src/live/screens/kabul/SignOffStrip.jsx` (1) — replace:

```js
/** `patientId`: the board's key — for a `kabul` patient, the patient number. */
```

with:

```js
/** `patientId`: the board's key — for a `kabul` patient, its admission's `board_key` (the protocol
 *  since G2-B1d; a legacy admission's H-number). */
```

**Edit** `dashboard/src/live/screens/kabul/SignOffStrip.jsx` (2) — replace:

```js
  const row = rows?.find((r) => r.patient_number === patientId) ?? null;
```

with:

```js
  const row = rows?.find((r) => boardKeyOf(r) === patientId) ?? null;
```

and add the import line `import { boardKeyOf } from "./boardKey.js"; // G2-B1d` after the file's last `import` line (`grep -n "^import" src/live/screens/kabul/SignOffStrip.jsx | tail -1`).

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (1) — add the import line `import { boardKeyOf } from "./boardKey.js"; // G2-B1d` after the file's last `import` line.

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (2) — replace:

```js
          {row.display_name} · <span className="font-data">{row.patient_number}</span>
```

with:

```js
          {row.display_name} · <span className="font-data">{boardKeyOf(row)}</span>
```

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (3) — replace:

```js
  const leavingHold = leaving ? holdOf(leaving.patient_number, "confirm") : null;
```

with:

```js
  const leavingHold = leaving ? holdOf(boardKeyOf(leaving), "confirm") : null;
```

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (4) — replace every `holdOf(row.patient_number, ` with `holdOf(boardKeyOf(row), ` (`replace_all`: two occurrences, `"confirm"` and `"start"`).

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (5) — replace:

```js
{t("kabul.confirmLeftBody", { bed: bedOf(leaving), number: leaving.patient_number })}
```

with:

```js
{t("kabul.confirmLeftBody", { bed: bedOf(leaving), number: boardKeyOf(leaving) })}
```

Then `grep -n "patient_number" src/live/screens/kabul/DischargeTab.jsx src/live/screens/kabul/SignOffStrip.jsx src/live/screens/beds/BedsScreen.jsx` prints nothing.

- [ ] **Step 4: Green**, with every screen that shows a `kabul` card:

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/ src/live/screens/beds/ src/live/screens/patient/PatientScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no `FAIL`.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2b-b1d-fe
git add -- dashboard/src/live/screens/kabul/SignOffStrip.test.jsx dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx
git status --short && git diff --cached --stat
git commit -F - -- dashboard/src/live/screens/kabul/SignOffStrip.test.jsx dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx <<'EOF'
feat(kabul): the bed board's badge, the Taburcu tab and the sign-off strip match a card by its board key

Spec §4: the «Hekim imzası bekliyor» badge, the Taburcu rows' number and their critical-alarm
hold, and the patient screen's sign-off strip read boardKeyOf (the protocol since G2-B1d, a legacy
admission's H-number). B1a's rows, without board_key, match as before (E12).

red: 4 failed — the matches looked for the H-number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 16: The patient screen's reprint; the dashboard lane's gate

**Lane:** dashboard (`/c/tmp/g2b-b1d-fe`). **Needs:** Tasks 13–15.

Spec §6 (who and where: the patient screen reprints, for a holder of `admissions.admit` whose units hold the bed; an admission without a protocol has no label and no button). `label/LabelReprint.jsx` renders nothing for a session without `admissions.admit` (and asks nothing); otherwise it reads the open admissions (`useAdmissions`: the caller's units only — the server's scope), finds the one whose `board_key` is the patient screen's card, and offers **Etiketi yeniden yazdır** when it has a protocol. The patient screen mounts it under the sign-off strip, one line marked `// G2-B1d`.

**Files:**
- Create: `dashboard/src/live/screens/kabul/label/LabelReprint.test.jsx`
- Create: `dashboard/src/live/screens/kabul/label/LabelReprint.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx`

- [ ] **Step 1: Write the failing test.** **Write** `dashboard/src/live/screens/kabul/label/LabelReprint.test.jsx`:

```jsx
// The patient screen's reprint (G2-B1d, spec §6): only for `admissions.admit`, only for an open
// admission of the caller's units whose card this is, only when it has a protocol — a reprint, said
// so to the route. Synthetic data only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { board, entry, identity, measured } from "../../../data/board.testutil.js";
import { answering } from "../../patient/trends/trends.testutil.js";
import { PatientScreen } from "../../patient/PatientScreen.jsx";
import { BED, DOCTOR, NURSE, REA, expectNoUuid, mountKabul, row, settle } from "../kabul.testutil.js";
import { LabelReprint } from "./LabelReprint.jsx";

const PROTOCOL = "202600000007";
const OPEN = [row({ id: "a-7", patient_number: "H2600007", protocol_no: PROTOCOL, board_key: PROTOCOL, state: "ACTIVE" })];
const LEGACY = [row({ id: "a-8", patient_number: "H2600008", state: "ACTIVE" })];
const REPRINT = "Etiketi yenidən çap et";
const LABEL = { protocol_no: PROTOCOL, display_name: "Sentetik Hasta", date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "2", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 } };

function fakeWindow() {
  const popup = { document: { open() {}, write() {}, close() {} }, focus() {}, print() {}, close() {} };
  return { open: () => popup };
}

describe("LabelReprint", () => {
  it("offers the reprint of the card's own open admission, and asks for it as a reprint", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} win={fakeWindow()} />, {
      perms: NURSE,
      setup: (a) => { a.admissions.mockResolvedValue(OPEN); a.admissionLabel.mockResolvedValue(LABEL); },
    });
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: REPRINT })); });
    await settle();
    expect(api.admissionLabel).toHaveBeenCalledWith("a-7", true);
  });

  it("offers nothing for an admission without a protocol, nor for another card", async () => {
    await mountKabul(<LabelReprint patientId="H2600008" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(LEGACY) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    await mountKabul(<LabelReprint patientId="202600000099" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(OPEN) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
  });

  it("asks nothing and offers nothing to a session without admissions.admit", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} />, {
      perms: DOCTOR, setup: (a) => a.admissions.mockResolvedValue(OPEN) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(api.admissions.mock.calls.some(([states]) => states?.includes("PENDING_DISCHARGE"))).toBe(false);
  });

  it("stands on the patient screen of a protocol-keyed card", async () => {
    const card = entry(PROTOCOL, [], {
      identity: identity({ patient_id: PROTOCOL, display_name: "Sentetik Hasta", bed_label: "2", source: "kabul",
        bed_id: BED(2), unit_id: REA, bed_key: null }),
      at: measured(30),
    });
    const mounted = await mountKabul(<PatientScreen params={{ id: PROTOCOL }} />, {
      perms: NURSE,
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([card]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.view.mockResolvedValue({ ok: true });
        api.patientTrends.mockImplementation(answering());
        api.admissions.mockResolvedValue(OPEN);
      },
    });
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Sentetik Hasta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: REPRINT })).toBeTruthy();
    expectNoUuid();
  });
});
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run src/live/screens/kabul/label/LabelReprint.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |Error" | head -4
```

Expected: `FAIL … Failed to resolve import "./LabelReprint.jsx"`.

- [ ] **Step 3: The reprint.** **Write** `dashboard/src/live/screens/kabul/label/LabelReprint.jsx`:

```jsx
// src/live/screens/kabul/label/LabelReprint.jsx — the patient screen's «Etiketi yeniden yazdır»
// (Group 2 · B1d, spec §6).
//
// Only for a session holding `admissions.admit` — without it nothing is read and nothing shown. The
// open admissions are the caller's units' (GET /admissions scopes them; the label route scopes the
// print again), the one shown is the one whose card this screen is (`boardKeyOf`), and only an
// admission with a protocol has a label: one opened before G2-B1d has neither label nor button.
import React from "react";
import { useSession } from "../../../session/SessionProvider.jsx";
import { useAdmissions } from "../useAdmissions.js";
import { boardKeyOf } from "../boardKey.js";
import { PrintLabelButton } from "./PrintLabelButton.jsx";

const OPEN = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];

/** `patientId`: the patient screen's card key. `win`: a test's stand-in for the print window. */
export function LabelReprint({ patientId, win }) {
  const { user } = useSession();
  if (!(user?.perms?.includes("admissions.admit") ?? false)) return null;
  return <Reprint patientId={patientId} win={win} />;
}

function Reprint({ patientId, win }) {
  const { rows } = useAdmissions(OPEN);
  const row = rows?.find((r) => boardKeyOf(r) === patientId && r.protocol_no) ?? null;
  if (!row) return null;
  return (
    <div className="flex justify-end">
      <PrintLabelButton admissionId={row.id} reprint win={win} />
    </div>
  );
}
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` (1) — replace:

```js
import { SignOffStrip } from "../kabul/SignOffStrip.jsx"; // G2-B1a: a DRAFT admission waits for the physician's signature
```

with:

```js
import { SignOffStrip } from "../kabul/SignOffStrip.jsx"; // G2-B1a: a DRAFT admission waits for the physician's signature
import { LabelReprint } from "../kabul/label/LabelReprint.jsx"; // G2-B1d: the protocol label, again
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` (2) — replace:

```js
          <SignOffStrip key={id} patientId={id} />{/* G2-B1a (screens/kabul); keyed: a sign in flight stays with its patient */}
```

with:

```js
          <SignOffStrip key={id} patientId={id} />{/* G2-B1a (screens/kabul); keyed: a sign in flight stays with its patient */}
          <LabelReprint key={`label-${id}`} patientId={id} />{/* G2-B1d (spec §6): an open admission's protocol label, again */}
```

- [ ] **Step 4: Green**, the Step 2 command: no `FAIL` — 4 tests.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2b-b1d-fe
git add -- dashboard/src/live/screens/kabul/label/LabelReprint.test.jsx dashboard/src/live/screens/kabul/label/LabelReprint.jsx dashboard/src/live/screens/patient/PatientScreen.jsx
git status --short && git diff --cached --stat
git commit -F - -- dashboard/src/live/screens/kabul/label/LabelReprint.test.jsx dashboard/src/live/screens/kabul/label/LabelReprint.jsx dashboard/src/live/screens/patient/PatientScreen.jsx <<'EOF'
feat(patient): «Etiketi yeniden yazdır» on the patient screen — admissions.admit, the card's own open admission, a protocol

Spec §6: nothing is read or shown without admissions.admit; the open admissions are the caller's
units'; the one whose board_key is the screen's card, with a protocol, offers the reprint, which
the route audits as one. A legacy admission has neither label nor button.

red: no ./LabelReprint.jsx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: The dashboard lane's gate** (no commit).

```bash
cd /c/tmp/g2b-b1d-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
cd ..
git diff --name-only feat/g2b-protokol..HEAD | grep -v '^dashboard/' || echo "dashboard only"
```

Expected: no `FAIL` (104 files before this lane, 110 after: `protokol.js` has no test of its own; `boardKey`, `code128c`, `protocolLabel`, `PrintLabelButton`, `ProtocolTab`, `LabelReprint` add six, and the edited ones stay); the build prints `built in` and `precache  20 entries`, no `larger than 500 kB`; `dashboard only` — but for the slice branch's own engine commits merged in by `deps.md` (Tasks 2 and 3), which `feat/g2b-protokol..HEAD` already excludes. Write the counts into the message to the controller; Task 18 quotes them.

---

### Task 17: Merge the lanes into the slice branch

**Where:** `/c/tmp/g2b-protokol` (`feat/g2b-protokol`). **Needs:** Task 11 (and the controller's word on its Lane A hunks), Task 16.

- [ ] **Step 1: The state before.**

```bash
cd /c/tmp/g2b-protokol
git status --short                                                    # clean
git log --oneline -1 | cat
git -C /c/tmp/g2b-b1d-be status --short; git -C /c/tmp/g2b-b1d-fe status --short    # both clean
git merge-base --is-ancestor feat/g2b-protokol feat/g2b-b1d-be && echo "be on the slice"
git merge-base --is-ancestor feat/g2b-protokol feat/g2b-b1d-fe && echo "fe on the slice"
```

Expected: both lines print. If the slice branch was fast-forwarded past a lane's base (Tasks 2 and 3 merged into the dashboard lane), the dashboard lane already contains those commits: the merge below brings only its own.

- [ ] **Step 2: The backend lane, fast-forward only.**

```bash
cd /c/tmp/g2b-protokol
git merge --ff-only feat/g2b-b1d-be
git log --oneline ec66a57..HEAD | cat                                  # the spec, its amendment, the plan, Tasks 1–10
```

- [ ] **Step 3: The dashboard lane, one merge commit.**

```bash
cd /c/tmp/g2b-protokol
git merge --no-ff feat/g2b-b1d-fe -m "merge: G2-B1d protokol, dashboard lane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short && git log --oneline -3 | cat
```

Expected: no conflict (the lanes touch disjoint files; the engine commits the dashboard lane merged in are already on the slice). A conflict: stop and report it — never resolve one by taking a side wholesale.

- [ ] **Step 4: Remove the lane worktrees** — junction first:

```bash
cmd //c "rmdir C:\\tmp\\g2b-b1d-fe\\dashboard\\node_modules"
git -C /c/tmp/g2b-protokol worktree remove --force /c/tmp/g2b-b1d-fe
git -C /c/tmp/g2b-protokol branch -d feat/g2b-b1d-fe
cmd //c "rmdir C:\\tmp\\g2b-b1d-be\\dashboard\\node_modules"
git -C /c/tmp/g2b-protokol worktree remove --force /c/tmp/g2b-b1d-be
git -C /c/tmp/g2b-protokol branch -d feat/g2b-b1d-be
ls /c/tmp/homunculus-g1/dashboard/node_modules | head -3              # the shared install is intact
```

(`branch -d` refuses a branch not merged: then stop and report.) Nothing is pushed.

---

### Task 18: Gates on the merged branch; the final review

**Where:** `/c/tmp/g2b-protokol`, after Task 17. The slice's worktree needs the dashboard's install: `cmd //c "mklink /J C:\\tmp\\g2b-protokol\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"` if `ls dashboard/node_modules` fails (and `rmdir` it the same way when the slice is done). The numbers measured here are the ones Task 19 writes into the docs (O78).

- [ ] **Step 1: Engine, no database (3.12).**

```bash
cd /c/tmp/g2b-protokol/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

- [ ] **Step 2: Engine, Postgres** — every `tests/test_*.py` but `test_infinity_vm_pilot.py`, in parts of at most 10 minutes each (Task 11's four parts, then the rest in halves), `TEST_DATABASE_URL=…` on each line. Record each part's last line.

- [ ] **Step 3: Engine, 3.14** — Task 11 Step 3's command, from this worktree.

- [ ] **Step 4: The chain has one head.**

```bash
cd /c/tmp/g2b-protokol/homunculus-engine
PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; c = Config('alembic.ini'); c.set_main_option('script_location', 'alembic'); print(ScriptDirectory.from_config(c).get_heads())"
```

Expected: `['0015']` — one head. Two heads is a fork: stop (the HARD RULE of Task 22).

- [ ] **Step 5: Dashboard, the suite and the build.**

```bash
cd /c/tmp/g2b-protokol/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: no `FAIL`; `built in`, `precache  20 entries`, no `larger than 500 kB`.

- [ ] **Step 6: The slice's own range, checked by eye.**

```bash
cd /c/tmp/g2b-protokol
git diff --stat ec66a57..HEAD | tail -1
git diff ec66a57..HEAD | grep -nE '^\+.*(Bearer [A-Za-z0-9]{20,}|PHI_ENCRYPTION_KEY=|password=)' || echo "no secret"
git diff ec66a57..HEAD -- '*.py' '*.js' '*.jsx' | grep -nE '^\+' | grep -niE 'patient_number' | grep -viE 'board_key|boardKeyOf|# |// |patient_number=number|"patient_number"|patient_number:|\.patient_number,|Patient\.patient_number' | head -20
```

The last command lists added lines that read `patient_number` outside the known safe forms: each must be an H-number use (its format, the Patient row, a payload's `patient_number`), never a card match. Anything else is a finding for the review.

- [ ] **Step 7: The final review** (the controller dispatches it; `fable`). Brief: the spec (`e86835c`), this plan, `git diff ec66a57..HEAD`. Ask for: every board call site under `board_key` (spec §4 and E3, including `_board_again`, `_answer_again`, `_last_card_off`, own patients, break-glass); the counter's lock order (protocol, then H-number, every admission); the PUT's forward rule under the row lock; `/edge/patient-query`'s 503 on any store exception and its silence about the number; the bridge's three outcomes and that no id is logged; `serve_mllp`'s thread and the mirror's lock; the label's fit rule on the shared table on both sides; no PHI anywhere. Findings are fixed as follow-up commits on the slice branch (`fix(…): … (final review)`), each with its test, and the gates of Steps 1–5 run again after the last.

- [ ] **Step 8: Record.** No commit here: the counts of Steps 1–5 and the review's outcome go into the message to the controller, and Task 19 writes them into the roadmap row.

---

### Task 19: Docs — the Turkish guide, the bridge runbook, the roadmap row, B1a's open item closed, the spec as built

**Where:** `/c/tmp/g2b-protokol`, after Task 18 (it quotes the counts). Docs only; synthetic numbers only (`202600000001`, «Test Hasta»).

**Files:**
- Modify: `docs/homunculus-rehber-TR.md`
- Modify: `docs/EDGE-BRIDGE-LOCAL.md`
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`
- Modify: `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md`
- Modify: `docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md`

- [ ] **Step 1: The Turkish guide.** **Edit** `docs/homunculus-rehber-TR.md` — replace:

```markdown
---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

with:

```markdown
---

### 3.9 Protokol numarası, etiket ve cihaz sorgusu (Grup 2 · B1d)

Hastanenin kendi numaralandırmasında bir kişinin ömür boyu tek **hasta numarası**, her gelişinin
(her yatışın) ise yeni bir **protokol numarası** vardır. Homunculus'ta bir kabul bir geliştir: her
yeni kabul bir protokol numarası alır ve o numara her şeydir — hemşirenin başucu cihazına girdiği,
etiketin barkodunda basılan ve kartta görünen numara aynıdır.

- **Numara.** On iki rakam, hepsi sıra (`202600000001`, `202600000002` …); kontrol hanesi yok. Bu
  yüzden tek hane yanlış yazılırsa komşu hastanın geçerli numarası çıkabilir: cihaz bulunan her
  numarayı **adıyla** gösterir, ve hemşirenin tek güvencesi o addır.
- **Başlangıç numarasını yönetici girer** (Yönetim › Protokol ve etiket). Girilene dek **hiçbir
  kabul yapılamaz** (409 `protocol_not_configured`): Homunculus'un kendi seçtiği bir aralık eski
  HBYS'nin protokolleriyle çakışabilirdi. Numara yalnız **ileri** alınır: verilen son numaradan
  büyük olmalı (`protocol_not_forward`).
- **H-numarası** (`H26…`, B1a) olduğu gibi verilmeye devam eder, ama etikete basılmaz ve yeni
  kabulün kartının anahtarı değildir. Bu dilimden önce açılmış kabuller H-numarasıyla kalır.
- **Etiket.** Varsayılan 50×30 mm, Zebra için; genişlik, yükseklik ve yazıcı çözünürlüğü (203 ya da
  300 dpi) aynı sekmede. Barkod **Code 128-C**: rakam çiftlerini kodlar, 12 hane 121 modül eder
  (sessiz alanlar dahil); bir modül 203 dpi'de 3, 300 dpi'de 4 yazıcı noktası. 203 dpi'de etiket en
  az 49 mm genişlikte olmalı. Satırlar: barkod, protokol (büyük), **tam ad** (kâğıtta ad hiç
  maskelenmez), doğum tarihi · cinsiyet, birim · yatak; boş satır «—» diye yazılmaz, düşer. Kabul
  kutusu «Etiketi yazdır»ı, hasta ekranı «Etiketi yeniden yazdır»ı gösterir; her basım denetim
  kaydına düşer (`admission.label_print`, adsız). «Deneme etiketi yazdır» yalnız sentetik
  `000000000000` ve «DENEME ETİKETİ» basar, sunucuya hiçbir şey sormaz. Zebra sürücüsünde etiket
  stoku bu boyutta, ölçek %100 olmalı.
- **Cihaz sorgusu.** Connex Spot'a numara girilince NCE köprüye `QBP^Q22` sorar; köprü önce API'ye
  sorar (`POST /edge/patient-query`, en çok 2 sn, yalnız cihaz jetonu, nginx dışarı açmaz):
  - **bulundu** → cihaz adı, doğum tarihini ve cinsiyeti gösterir;
  - **bulunamadı** (bilinmeyen ya da taburcu edilmiş numara) → `NF`: cihaz numarayı doğrulayamaz,
    hemşire yatak başında düzeltir. Yine de kaydederse ölçüm bugünkü gibi adsız «kimlik kaydı yok»
    kartına düşer;
  - **API cevap vermedi** → köprü kendi aynasından cevaplar; aynada da yoksa numarayı adsız geri
    yollar. Ölçüm kaybolmaz; «bilmiyoruz» ile «bulunamadı» ayrı kalır.
  Köprünün rapor satırı `sorgu`, `sorgu_NF` ve `sorgu_api_hata` sayar; hiçbir numara loglanmaz.
- **Geri dönüş** yalnız ilk protokollü kabulden önce temizdir: sonrasında açık kabullerin kartları
  protokolle anahtarlıdır ve eski API onları eşleştiremez — geri dönüş ileri bir düzeltme demektir.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 2: The bridge runbook.** **Edit** `docs/EDGE-BRIDGE-LOCAL.md` — append at the end of the file (an Edit whose old text is the file's last paragraph, `Comed IT before connecting the live feed. Hardware acceptance still requires an actual admission,` … `device query and subsequent observation at the hospital.`, and whose new text is that paragraph followed by):

```markdown

## The device's patient query: the API first (G2-B1d)

Since G2-B1d the bridge no longer answers a Connex Spot's `QBP^Q22` from the ADT mirror alone. It
asks the API first — `POST <--cloud-url>/edge/patient-query` with the bridge's own `--token` (the
device token `/ingest` uses), at most 2 seconds — and answers:

| The API says | The device gets | The mirror |
|---|---|---|
| found | `RSP^K22`, `QAK … OK`, `PID|||id||family^given||dob|sex` — always the name | keeps it (encrypted) |
| not found (unknown, or discharged) | `QAK … NF`, no `PID`: the nurse corrects the number | forgets the number |
| nothing in time, a non-200, a body it cannot read | the mirror's answer, else the id echoed without a name | unchanged |

The route is reachable on the compose network only (`http://api:8000`): the API publishes no port
and nginx does not proxy `/edge`. It answers one exact number at a time, from the board's identity
record (the admission's, or a Comed one). A database the API cannot read is a 503 — "cannot
answer", never "not found". In capture-only mode (no `--cloud-url`) the bridge answers from the
mirror as before.

The report line gains two counters: `sorgu_NF` (the API said not found) and `sorgu_api_hata` (the
API could not answer and the mirror did). No number is logged.

A bench check with a synthetic number, from inside the bridge container (it prints whether the
device would see a name, never the name):

    docker exec homunculus-bridge python scripts/pdq_probe.py --id 000000000000

`000000000000` is never issued by the counter unless an administrator starts there (O70): on a
configured ward it answers `MSA=AA QAK=NF PID=yok`, which proves the bridge reached the API.
```

- [ ] **Step 3: The roadmap row.** **Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — the row of G2-B1a is one long line beginning `| G2-B1a | Hasta Kabul (Lane B):`; after it (before the blank line and `---`) add the line:

```markdown
| G2-B1d | Protokol (Lane B, B1 listesinin B1d'si): Homunculus her yeni kabule 12 haneli bir protokol numarası verir — başlangıcı yönetici Yönetim › Protokol ve etiket'te girer, girilene dek kabul yok, numara yalnız ileri; protokol yeni kabulün kart anahtarıdır (cihaz, etiket ve kart aynı numara; eski kabuller H-numarasıyla); 50×30 mm Code 128-C etiket (Zebra, 203/300 dpi, kabul kutusunda ilk basım, hasta ekranında yeniden basım, her basım adsız denetim satırı); Connex Spot hasta sorgusu kabulden cevaplanır — bulundu: ad; bulunamadı/taburcu: `NF`; API yoksa köprünün aynası, o da yoksa adsız yankı; göç `0015` · spec: [2026-11-01](../specs/2026-11-01-g2b-b1d-protokol-barkod-design.md) · plan: [G2-B1d](2026-11-01-g2b-b1d-protokol-barkod.md) | Kod «…» (Task 18'in sayıları: motor «…», dashboard «…», derleme «…») · **VM'de değil** — blok dosyası `G2B-B1D-bloklari.txt`, sahibin sözüyle · **Açık:** O70–O78 (plan) ve sahibin NCE testi O1–O6 (spec §12) |
```

(Fill each «…» with Task 18's measured counts and the slice's head commit; never leave a «…» in the committed text.)

- [ ] **Step 4: B1a's open item closed.** **Edit** `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md` — replace:

```markdown
- The device showing the patient's name for a `kabul` patient (the edge PDQ mirror is fed by ADT
  only).
```

with:

```markdown
- ~~The device showing the patient's name for a `kabul` patient (the edge PDQ mirror is fed by ADT
  only).~~ Closed by G2-B1d (2026-11-01 spec §5): the bridge asks the API first, which answers
  from the admission's own identity record.
```

- [ ] **Step 5: The spec as built.** **Edit** `docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md` — at the end of the file, add:

```markdown

## As built (plan 2026-11-01-g2b-b1d-protokol-barkod.md)

The plan's departures E1–E15 are what the code does where this spec was silent or the code
differed: the revision ids are bare numbers (`0015` follows `0013`; E1); the device route is a
factory bound to the app's `_caller` (E2); the bed release's card check reads the board key too
(E3); every admission audit row's `patient_id` is the board key, the admit row carrying both
numbers (E4); the detail answers `AdmissionDetail` (E5); the refusals name `board_key` beside
`patient_number` (E6); `/edge` is left out of nginx's drift check by name (E7); the bridge mirror
takes a lock (E8); both test worlds set a start number (E9); the CHECK is Postgres-only in the
model (E10); the PUT refuses in the order format, dpi, size, fit, forward — the narrowest width is
49 mm at 203 dpi (E11); the dashboard matches by `boardKeyOf` (E12); the fit cases are
`homunculus-engine/tests/label_fit_cases.json` (E13); the device route logs a store failure by
class only (E14); the codes' block rebinds `CODES` (E15). Departures found while implementing:
«list E16 … here, or "none"».
```

(Replace the «…» sentence with the plan's E16+ rows, one clause each, or the word «none».)

- [ ] **Step 6: Check and commit.**

```bash
cd /c/tmp/g2b-protokol
grep -n "…\|«…»" docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md | grep "G2-B1d" || echo "row filled"
git add -- docs/homunculus-rehber-TR.md docs/EDGE-BRIDGE-LOCAL.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md
git status --short && git diff --cached --stat
git commit -F - -- docs/homunculus-rehber-TR.md docs/EDGE-BRIDGE-LOCAL.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md <<'EOF'
docs(g2b-b1d): the protocol, its label and the device query — the Turkish guide, the bridge runbook, the roadmap row, the spec as built

The guide's §3.9 (the number, the start the administrator sets, the label, the three answers of
the device query, the rollback's limit); EDGE-BRIDGE-LOCAL's API-first query and its counters; the
roadmap row with Task 18's counts; B1a's open item on the device's name closed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: `row filled`.

---

### Task 20: The local walk — compose, a synthetic patient query and reading, discharge, the API stopped

**Where:** `/c/tmp/g2b-protokol`, after Task 18 (it may run beside Task 19). The agent drives the dashboard in headless Chrome, as B1a's and the editor's walks did; **synthetic data only** — the tenant `protokol-yuruyus`, the patient «Test Hasta» born 1970-05-05, the numbers `202600000001` … Nothing is committed: the outcome is `/c/tmp/homunculus-plans/g2b-b1d/walk/notes.md` (pass or finding per item, in the screen's own words) and screenshots beside it. Spec §10 "Local walk" 1–6.

- [ ] **Step 1: No other stack, and the MLLP port free.** The compose file names its containers (`homunculus-postgres`, `-api`, `-web`, `-bridge`), so one such stack runs at a time:

```bash
docker ps -a --format '{{.Names}} {{.Ports}} {{.Label "com.docker.compose.project"}}' | grep -E '^homunculus-(postgres|api|web|bridge|nce) ' || echo "no stack containers"
netstat -ano | grep -E "[:.]2575 .*LISTEN" || echo "2575 free"
```

If a container is listed or 2575 is taken: **stop and ask the controller** whose it is and whether it may go down. Never `down -v` a stack this task did not start.

- [ ] **Step 2: The three images, from the slice's head.**

```bash
cd /c/tmp/g2b-protokol
docker build -q -t g2b-b1d-api:new -f homunculus-engine/Dockerfile.api homunculus-engine
docker build -q -t g2b-b1d-web:new -f deploy/local/web/Dockerfile .
docker build -q -t g2b-b1d-bridge:new -f homunculus-engine/Dockerfile homunculus-engine
docker run --rm --entrypoint python g2b-b1d-bridge:new -c "from homunculus.edge.pdq_client import query_url; from homunculus.edge.pdq import NOT_FOUND; print(query_url('http://api:8000'), NOT_FOUND)"
```

Expected: three image ids; `http://api:8000/edge/patient-query NOT_FOUND`. (The web image's build context is the repository root, as `deploy/local/docker-compose.yml`'s `web.build` says; if it says otherwise, build with that context.)

- [ ] **Step 3: The stack's scratch** (outside the repo):

```bash
S=/c/tmp/homunculus-plans/g2b-b1d/stack
mkdir -p $S /c/tmp/homunculus-plans/g2b-b1d/walk
grep -vE '^(WEB_PORT|WEB_TLS_PORT|TENANT_SLUG)=' /c/tmp/g115plan/stack/local.env > $S/local.env
printf 'WEB_PORT=18195\nWEB_TLS_PORT=18558\nTENANT_SLUG=protokol-yuruyus\n' >> $S/local.env
grep -c PHI_ENCRYPTION_KEY $S/local.env                                    # 1: the bridge's mirror needs it
```

**Write** `/c/tmp/homunculus-plans/g2b-b1d/stack/compose.b1d.yml`:

```yaml
# G2-B1d's walk: the three services run the slice's images, never a build or a pull. Used with
# deploy/local/docker-compose.yml and G1-15's compose.g115.yml (the bind mounts in scratch).
services:
  api:
    image: g2b-b1d-api:new
    pull_policy: never
  web:
    image: g2b-b1d-web:new
    pull_policy: never
  bridge:
    image: g2b-b1d-bridge:new
    pull_policy: never
```

In every command below, `C` is:

```bash
C="docker compose -p g2bb1d -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml -f /c/tmp/homunculus-plans/g2b-b1d/stack/compose.b1d.yml --env-file /c/tmp/homunculus-plans/g2b-b1d/stack/local.env"
```

- [ ] **Step 4: Up, at 0015, with no start number.**

```bash
cd /c/tmp/g2b-protokol
$C up -d --no-build postgres api web bridge 2>&1 | tail -4
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version" </dev/null
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select count(*) from protocol_settings" </dev/null
docker logs homunculus-bridge 2>&1 | grep -E "uplink|MLLP" | tail -2
```

Expected: `0015`; `0`; the bridge says `uplink: http://api:8000`. Wait for the API's health (`curl -s http://127.0.0.1:18195/health`) before the browser.

- [ ] **Step 5: The walk.** Each item: what was done, what the screen or the probe said, pass or finding. Screenshots at 1440 px, and at 390 px for items c and d.

  a. **The ward.** Sign in as the seed admin (`SEED_ADMIN_EMAIL` of `local.env`). Yönetim › Yapı: unit «Reanimasiya» (Erişkin YBÜ), room «Otaq 1», beds «1» and «2» (as B1a's walk).
  b. **D5: no admission before the start number.** Hasta Kabul › Kabul: fill «Test Hasta», 1970-05-05, Qadın, the rest required, bed 1 → «Qəbul et». Expected: the toast «Protokol nömrəsi təyin olunmayıb: İdarə › Protokol və etiket bölməsində başlanğıc nömrəsini daxil edin. Qəbul yazılmadı.»; the bed still free.
  c. **The admin tab.** Yönetim › Protokol və etiket: the warning that no admission can be made; set `202600000001`, 50 × 30, 203 dpi → «Yadda saxla». Width 48 → the fit sentence names 49 mm and «Yadda saxla» sends nothing. «Sınaq etiketi çap et»: the print window's preview shows `000000000000` and «SINAQ ETİKETİ», 50 × 30 (screenshot of the preview).
  d. **Admit → the protocol → print preview.** Admit «Test Hasta» into bed 1: the box shows `202600000001` large under «Protokol nömrəsi», «Bu nömrəni cihaza daxil edin və ya barkodu oxudun», «Etiketi çap et» → the preview shows the barcode, `202600000001`, the full name, «05.05.1970 · Qadın», «Reanimasiya · Çarpayı 1» (screenshot). The card on Yataklar is `202600000001`. In psql: `select protocol_no from admissions` → `202600000001`; `select next_no, last_issued from protocol_settings` → `202600000002|202600000001`.
  e. **A synthetic QBP^Q22 → the name.**

     ```bash
     docker exec homunculus-bridge python scripts/pdq_probe.py --id 202600000001 --show-name
     ```

     Expected: `MSA=AA QAK=OK PID=evet ad=Test Hasta doğum=evet cinsiyet=F` (synthetic: `--show-name` is for this stack only).
  f. **A synthetic ORU → the card updates.**

     ```bash
     /c/tmp/f7-py312/venv/Scripts/python.exe homunculus-engine/scripts/hl7_simulator.py --host 127.0.0.1 --port 2575 --patients 202600000001 --count 3 --interval 1
     ```

     Expected: three `AA` acks; the card `202600000001` on Yataklar shows the readings within seconds (screenshot); `docker logs homunculus-bridge | grep "sorgu=" | tail -1` shows `gözlem=` grown and `sorgu=1`.
  g. **Discharge → the same query → NF.** Sign the admission (a physician account, or the admin), start and confirm the discharge. Then the Step e probe: `MSA=AA QAK=NF PID=yok`. The report line's `sorgu_NF=1`. Back in Yönetim › Protokol və etiket: «Verilən son nömrə: 202600000001»; setting `202600000001` again is refused on the toast («Bu nömrə geri gedir …», `protocol_not_forward`) and the settings are read again.
  h. **The API stopped → mirror, else the echo.** Admit «Test Hasta İki» into bed 2 (`202600000002`), probe it once (`ad=evet`: the mirror now holds it), then `$C stop api`, then:

     ```bash
     docker exec homunculus-bridge python scripts/pdq_probe.py --id 202600000002          # the mirror: ad=evet
     docker exec homunculus-bridge python scripts/pdq_probe.py --id 202600000001          # forgotten at g: ad=yok
     docker exec homunculus-bridge python scripts/pdq_probe.py --id 202600000099          # unknown: ad=yok
     $C start api
     ```

     Expected as commented, each within 2–3 s (the client's 2 s bound); `sorgu_api_hata=3`. The second line proves the discharged name left the bridge's disk (spec §8).
  i. **No number in a log.** `docker logs homunculus-bridge 2>&1 | grep -cE "2026000000(01|02|99)"` → `0`; the same for `homunculus-api`.

- [ ] **Step 6: Down** — only this stack, with its volumes (synthetic data):

```bash
cd /c/tmp/g2b-protokol
$C down -v 2>&1 | tail -2
docker image rm g2b-b1d-api:new g2b-b1d-web:new g2b-b1d-bridge:new
```

- [ ] **Step 7: Notes.** **Write** `/c/tmp/homunculus-plans/g2b-b1d/walk/notes.md`: each item a–i, its outcome and screenshot names; every finding numbered W-1 … with what the screen said. A finding that is a defect is fixed on the slice branch as its own commit (`fix(…): … (walk W-n)`, with a test) and Task 18's gates run again; a finding that is a question goes to the controller.

---

### Task 21: The VM blocks — `/c/tmp/infinity-a-releases/G2B-B1D-bloklari.txt`

**Where:** the workstation; writes ONE file outside the repo and builds the bundle. **Needs:** Tasks 19, 20; **the slice on main** (the owner's «main'e al», then Task 22's rebase or swap, so the chain has one head and the release commit is main's). **Nobody runs a block without the owner's «onay».** Spec §11, D5, D12; the deploy rules of the header (one VM deploy at a time; `</dev/null` on every stdin consumer inside a heredoc; no block prints a name, a patient number or a value — only counts, structure names, revision ids and the synthetic `000000000000`).

The file follows `G2B1a-bloklari.txt`'s form (read it first: `/c/tmp/infinity-a-releases/G2B1a-bloklari.txt`): a header (values, order, what changes, the rollback's limit), then blocks `--- X-n (where, who): what ---`, each `bash -eu -o pipefail <<'BLOK'` … `echo "X-n TAMAM"` / `BLOK`, then «Beklenen:» and «Geri alma:». Values not known when the file is written are «…» and every block that uses one first checks it was filled (`case "$X" in *«*) echo "«…» DOLDURULMAMIŞ: durdum"; exit 1;; esac`).

- [ ] **Step 1: The bundle.**

```bash
cd /c/tmp/g2b-protokol
R=$(git rev-parse main)                                  # the release: main after the slice's merge
V="«VM'NİN ŞU ANKİ UCU»"                                 # from the last deploy's record (B-1 confirms it)
git merge-base --is-ancestor "$V" "$R" && echo "VM ucu atası"
git bundle create /c/tmp/infinity-a-releases/g2b1d-$(git rev-parse --short=7 $R).bundle "$V"..main
git bundle verify /c/tmp/infinity-a-releases/g2b1d-$(git rev-parse --short=7 $R).bundle
sha256sum /c/tmp/infinity-a-releases/g2b1d-$(git rev-parse --short=7 $R).bundle
```

Write the commit, the bundle's name, its sha256 and its prerequisite commits into the file's DEĞERLER.

- [ ] **Step 2: The header.** **Write** `/c/tmp/infinity-a-releases/G2B-B1D-bloklari.txt` beginning:

```text
=====================================================================================================
 G2-B1d · PROTOKOL (protokol numarası, 50×30 etiket, Connex Spot hasta sorgusu) — VM'YE ÇIKIŞ BLOKLARI
 Kod ucu «R» (main) · göç 0015 · spec 2026-11-01-g2b-b1d-protokol-barkod-design.md §11 · plan task-21
=====================================================================================================
!!! İLK SATIR: D-2'den sonra, E-1'de yönetici BAŞLANGIÇ NUMARASINI girene dek HİÇBİR KABUL YAPILAMAZ
!!! (409 protocol_not_configured). Servis önceden bilgilendirilir; E-1, D-2'nin hemen ardından yapılır.

Her VM bloğunu kullanıcı yapıştırır. "İş istasyonu" blokları Git Bash'te, "VM" blokları
  ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72
içinde koşar. Ajan yalnız "ajan" yazan salt okunur kontrolleri kendisi koşar; VM'de hiçbir şey yazmaz.
"durdum" diyen bir satır = hiçbir şey değişmedi (aksi yazmıyorsa). Her bloğun son satırı "… TAMAM"dır.
Heredoc içindeki her psql / docker compose exec·run / docker exec / ssh / scp `</dev/null` taşır.
Hiçbir blok bir hastanın adını, numarasını ya da bir değerini basmaz: yalnız SAYILAR, yapı adları, göç
numaraları ve sentetik 000000000000. Hiçbir token basılmaz.

SIRA: A-1 → A-2 (ajan) → B-1 → B-2 → B-3 → D-1 → D-2 → D-3 (ajan) → E-1 (yönetici, tarayıcı) → E-2 →
      F-1 → F-2 → G (sahibin NCE oturumu). Tek dağıtım: bu sırada başka bir dilim VM'ye bir şey göndermez.

DEĞERLER
  Kod ucu (main)          : «R» — «kısa»
  Bundle                  : «g2b1d-….bundle» · sha256 «…» · «V»..main · ön koşul «…»
  VM'de beklenen uç       : «V»
  VM'deki göç             : «0015_DOWN» = 0015_protocol.py'nin down_revision'ı («R»'de; 0013, ya da editör
                            main'e önce girdiyse 0014) — B-1 VM'nin göçünün BUNA EŞİT olduğunu denetler (çatal yok)
  Geri dönüş etiketleri   : homunculus-rollback/api:pre-g2b1d · web:pre-g2b1d · bridge:pre-g2b1d (B-3)
  Veritabanı dökümü       : ~/g2b1d/before-0015.sql.gz (B-2)
  Köprü imajı             : VM'de bundle'dan derlenir (VM'deki GHCR jetonu ölü): ghcr.io/asbadef/homunculus-bridge:latest
                            yeniden etiketlenir; nce servisi YENİDEN BAŞLATILMAZ (aynı imajı kullanır, değişmeden kalır)
  Hub, işçi, cihaz→yatak tablosu: DEĞİŞMEZ

NE DEĞİŞİYOR (api + web BİRLİKTE, sonra köprü)
- GÖÇ 0015 (API açılışta `alembic upgrade head` ile): protocol_settings tablosu (SATIR YOK) ve
  admissions.protocol_no (mevcut kabullerde NULL — onlar H-numarasıyla kalır). Saf ek.
- Her yeni kabul 12 haneli protokol numarası alır; numara cihaza girilen, etikete basılan ve kartta
  görünen numaradır. Başlangıç numarası yoksa kabul reddedilir (D5).
- Yönetim › Protokol ve etiket (structure.manage); kabul kutusunda «Etiketi yazdır», hasta ekranında
  «Etiketi yeniden yazdır»; her basım adsız denetim satırı.
- Köprü: hasta sorgusu önce API'ye (POST /edge/patient-query, compose ağı, 2 sn) — bulundu: ad;
  bulunamadı/taburcu: NF; API yoksa ayna, o da yoksa adsız yankı. Rapor satırında sorgu_NF, sorgu_api_hata.
GERİ DÖNÜŞ YALNIZ İLK PROTOKOLLÜ KABULDEN ÖNCE TEMİZDİR (spec §11): sonrasında açık kabullerin kartları
protokolle anahtarlıdır, eski API onları eşleştiremez → geri dönüş ileri bir düzeltmedir. R-2 bunu
kendisi denetler ve protokollü bir kabul varsa durur.
```

- [ ] **Step 3: The blocks.** Write each into the file, in order, with its «Beklenen» and «Geri alma». The bodies:

**A-1 (iş istasyonu, kullanıcı): VM'ye erişim, bundle'ı doğrula, ~/g2b1d'ye kopyala** — as B1a's A-1 with `~/g2b1d` and this bundle: `ssh -n … 'echo "VM erişilebilir: …"'` (else "VM'YE ULAŞILAMADI: durdum"); `sha256sum -c`; `git bundle verify`; `~/g2b1d` empty or stop; `scp`; the VM's sha256. «Beklenen»: the four lines and "A-1 TAMAM". «Geri alma»: `rm -r ~/g2b1d` on the VM.

**A-2 (iş istasyonu, ajan — salt okunur): gölge hattı ÖNCE** — B1a's A-2 with the script pinned by commit (O63): `git -C /c/tmp/g2b-protokol show ade8da8:deploy/infinity/shadow_check.py | ssh … 'python3 - --window 60 --table-version «TABLO_SURUM» --table-sha «TABLO_SHA»'` → `G2B1D-P-once.txt` (refuses to overwrite). «Beklenen»: six KABUL, "SONUÇ: KABUL", PANO_OZET.

**B-1 (VM, salt okunur): ön kontrol**

```bash
bash -eu -o pipefail <<'BLOK'
umask 077
cd /opt/homunculus/deploy/local
A=$HOME/g2b1d
PSQL="sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc"
test "$(git -C /opt/homunculus rev-parse HEAD)" = «V» || { echo "VM UCU «V» DEĞİL: durdum"; exit 1; }
echo "göç: $($PSQL "select version_num from alembic_version" </dev/null)" | tee $A/alembic-before.txt
test "$(cut -d' ' -f2 $A/alembic-before.txt)" = «0015_DOWN» || { echo "ÇATAL: VM'nin göçü «0015_DOWN» DEĞİL — 0015 buna bağlanmıyor; durdum, ajana sorun"; exit 1; }
echo "zincir tek baş: 0015 → «0015_DOWN»"
for c in homunculus-api homunculus-web homunculus-bridge; do echo "$c $(sudo docker inspect -f '{{.Image}} {{.Config.Image}}' $c)"; done | tee $A/image-ids-before.txt
echo "açık kabul: $($PSQL "select count(*) from admissions where state in ('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER')" </dev/null)"
echo "protocol_settings var mı: $($PSQL "select to_regclass('public.protocol_settings') is not null" </dev/null)"
sudo docker compose ps --format '{{.Name}} {{.Status}}' </dev/null
df -h / | tail -1
echo "B-1 TAMAM"
BLOK
```

«Beklenen»: the migration (`0013` or `0014`), "zincir tek baş: 0015 → <that>", three image lines, open admissions' COUNT, `f`, the services up, ≥ 3 GiB free. A fork stops here and nothing changed.

**B-2 (VM): veritabanı dökümü** — B1a's B-2 into `~/g2b1d/before-0015.sql.gz` (refuses to overwrite; `pg_dump … </dev/null | gzip`; size > 0).

**B-3 (VM): geri dönüş etiketleri** — `sudo docker tag <api image id> homunculus-rollback/api:pre-g2b1d`, the same for web and **bridge** from `image-ids-before.txt`; list the three.

**D-1 (VM): kodu al** — B1a's D-1 with «V» → «R»: HEAD «V», branch main, B-2 and B-3 done, tree clean; `git fetch $B main`; FETCH_HEAD = «R»; ancestor; `git merge --ff-only`; HEAD = «R»; `ls homunculus-engine/alembic/versions | tail -1` = `0015_protocol.py`; `grep -E '^down_revision' homunculus-engine/alembic/versions/0015_protocol.py` names exactly the migration in `~/g2b1d/alembic-before.txt` (else "ÇATAL: durdum" — and D-1's own «Geri alma» runs before anything is built); "deploy/ altında değişen dosya: <n>" (expected 1 — `deploy/local/docker-compose.yml`, comment lines only: the api's no-`ports` note, F-25). «Geri alma»: `git checkout -B main «V»`.

**D-2 (VM): api + web'i derle, BİRLİKTE başlat — göç 0015 açılışta** — B1a's D-2 with this slice's names: compose config; `docker compose build api web`; both images new; `up -d --no-build api web`; api healthy; `/health` 200 through nginx; `alembic_version` = `0015`; `select count(*) from protocol_settings` = `0`; `select count(*) from admissions where protocol_no is not null` = `0`; one uvicorn worker. On any failure: "SORUN — G-1'e bakın", exit 1. «Beklenen» … "D-2 TAMAM". Then at once E-1.

**D-3 (iş istasyonu, ajan — salt okunur): gölge hattı SONRA** — A-2's command → `G2B1D-P-sonra.txt`, then `diff` of the PANO_OZET lines' `cards` and `alerts` with `G2B1D-P-once.txt`: equal (existing cards keep their shape). And nginx does not proxy `/edge`: `curl -s -o /dev/null -w "%{http_code}" -X POST http://172.100.101.72:8080/edge/patient-query -H 'Content-Type: application/json' -d '{"id":"000000000000"}'` prints a code that is NOT 200 with a JSON body from the API (the SPA's 405 or its HTML): the route is closed to the outside (D12).

**E-1 (tarayıcı, yönetici): başlangıç numarası** — no bash. The administrator signs in (`admin.lbys`), Yönetim › Protokol ve etiket: the warning says no admission can be made; enters the **start number the owner gives** (12 digits; the agent never chooses it — O70: not `000000000000`), 50 × 30, 203 dpi (or the stock and printer the owner names), «Kaydet» → «kaydedildi». Then «Deneme etiketi yazdır» on the ward's Zebra: the owner looks at it (O6 is G's). «Beklenen»: the warning gone; «Henüz numara verilmedi».

**E-2 (VM, salt okunur): ayar yazıldı**

```bash
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
PSQL="sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc"
echo "ayar satırı: $($PSQL "select count(*) from protocol_settings where next_no is not null" </dev/null)"
echo "başlangıç 12 hane mi: $($PSQL "select bool_and(length(next_no::text) <= 12 and next_no > 0) from protocol_settings" </dev/null)"
echo "verilen: $($PSQL "select count(*) from protocol_settings where last_issued is not null" </dev/null)"
echo "etiket: $($PSQL "select label_width_mm || 'x' || label_height_mm || '@' || printer_dpi from protocol_settings" </dev/null)"
echo "denetim protocol.settings: $($PSQL "select count(*) from audit where event_type = 'protocol.settings'" </dev/null)"
echo "E-2 TAMAM"
BLOK
```

«Beklenen»: `ayar satırı: 1`; `t`; `verilen: 0`; the label; `denetim protocol.settings: 1`. (The start number itself is not a patient datum; it is not printed all the same.)

**F-1 (VM): köprüyü bundle'dan derle, yalnız köprüyü yeniden başlat**

```bash
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus
A=$HOME/g2b1d
test "$(git rev-parse HEAD)" = «R» || { echo "UÇ «R» DEĞİL: durdum"; exit 1; }
sudo docker image inspect homunculus-rollback/bridge:pre-g2b1d >/dev/null 2>&1 || { echo "B-3 KOŞMAMIŞ (bridge etiketi yok): durdum"; exit 1; }
sudo docker build -q -t ghcr.io/asbadef/homunculus-bridge:latest -f homunculus-engine/Dockerfile homunculus-engine </dev/null > $A/bridge-build.txt 2>&1 || { echo "KÖPRÜ DERLENEMEDİ: durdum (çalışan köprü değişmedi)"; tail -20 $A/bridge-build.txt; exit 1; }
sudo docker run --rm --entrypoint python ghcr.io/asbadef/homunculus-bridge:latest -c "from homunculus.edge.pdq_client import query_url; from homunculus.edge.bridge import EdgeBridge; print('ok', query_url('http://api:8000'))" </dev/null
cd deploy/local
sudo docker compose up -d --no-build bridge </dev/null 2>&1 | tail -2
sleep 5
sudo docker ps --format '{{.Names}} {{.Image}} {{.Status}}' | grep -E 'homunculus-(bridge|nce) '
sudo docker logs --since 1m homunculus-bridge 2>&1 | grep -E "uplink|MLLP dinleniyor" | tail -2
sudo docker logs --since 1m homunculus-bridge 2>&1 | grep -ciE "traceback|error" || true
echo "F-1 TAMAM"
BLOK
```

«Beklenen»: `ok http://api:8000/edge/patient-query`; the bridge "Up N seconds", the nce container's uptime UNCHANGED (not recreated); `uplink: http://api:8000`; `0` errors. «Geri alma»: R-1.

**F-2 (VM, salt okunur): köprü API'ye ulaşıyor — sentetik sorgu**

```bash
bash -eu -o pipefail <<'BLOK'
sudo docker exec homunculus-bridge python scripts/pdq_probe.py --id 000000000000 </dev/null
sudo docker logs --since 2m homunculus-bridge 2>&1 | grep -c "patient query: the API could not answer" || true
echo "F-2 TAMAM"
BLOK
```

«Beklenen»: `MSA=AA QAK=NF PID=yok` — the API answered «not found» for a number nobody has (the counter never issued it: E-1 did not start at 0); `0` API failures. `QAK=OK … ad=yok` instead means the bridge could not reach the API (the echo): stop, ask the agent. The next report line (30 s) shows `sorgu=1 sorgu_NF=1 sorgu_api_hata=0`.

**G (sahip, servis — NCE test oturumu, spec §12).** No bash. The owner, with a synthetic test admission he makes himself («Test Hasta» or the hospital's test patient), on a Connex Spot: **O1** NCE Host1 still at `172.100.101.72:2575` and readings arrive (the report line's `mesaj=` grows); **O2** the scanner reads the label's Code 128-C; **O3** what the device shows on `NF` (a mistyped number) and whether it lets the nurse save; **O4** how the name appears (`PID-5` `^given`: the whole name in «given»); **O5** the queried value is exactly the number, no trailing `_`; **O6** the Zebra prints 50×30 at 100 %, the bars crisp. The agent writes the owner's answers into the slice's record; a discharge of the test admission ends it (its card leaves; a query for it is `NF`).

**R-1 (VM): köprü geri** — `sudo docker tag homunculus-rollback/bridge:pre-g2b1d ghcr.io/asbadef/homunculus-bridge:latest && cd /opt/homunculus/deploy/local && sudo docker compose up -d --no-build bridge </dev/null`; the bridge answers as before (mirror or echo). Always clean: the bridge holds no schema.

**R-2 (VM): api + web geri — YALNIZ protokollü kabul yoksa**

```bash
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
PSQL="sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc"
n=$($PSQL "select count(*) from admissions where protocol_no is not null" </dev/null)
test "$n" = 0 || { echo "PROTOKOLLÜ KABUL VAR ($n): geri dönüş TEMİZ DEĞİL — durdum; ileri düzeltme, ajana sorun"; exit 1; }
for s in api web; do sudo docker image inspect homunculus-rollback/$s:pre-g2b1d >/dev/null 2>&1 || { echo "$s etiketi yok: durdum"; exit 1; }; done
sudo docker compose run --rm --no-deps api alembic downgrade «0015_DOWN» </dev/null 2>&1 | tail -2
test "$($PSQL "select version_num from alembic_version" </dev/null)" = «0015_DOWN» || { echo "GÖÇ GERİ ALINAMADI: durdum, ajana sorun"; exit 1; }
api_img=$(awk '$1=="homunculus-api" {print $3}' $HOME/g2b1d/image-ids-before.txt)
web_img=$(awk '$1=="homunculus-web" {print $3}' $HOME/g2b1d/image-ids-before.txt)
sudo docker tag homunculus-rollback/api:pre-g2b1d "$api_img"
sudo docker tag homunculus-rollback/web:pre-g2b1d "$web_img"
sudo docker compose up -d --no-build api web </dev/null 2>&1 | tail -2
for i in $(seq 1 36); do h=$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api || true); [ "$h" = healthy ] && break; sleep 5; done
echo "api health: $h"
echo "R-2 TAMAM"
BLOK
```

(The downgrade runs with the NEW image, which knows 0015; the old image then starts against a database at its own head. Then R-3: `git -C /opt/homunculus checkout -B main «V»` — code only.) If R-2 stops on protocol admissions: the dump `before-0015.sql.gz` is NOT a rollback any more (it predates real admissions); the way is a forward fix.

- [ ] **Step 4: Check the file.**

```bash
F=/c/tmp/infinity-a-releases/G2B-B1D-bloklari.txt
grep -c "^--- " $F                                      # the blocks: A-1 A-2 B-1 B-2 B-3 D-1 D-2 D-3 E-1 E-2 F-1 F-2 G R-1 R-2 R-3
grep -n "TAMAM\"" $F | wc -l
grep -nE "docker (compose )?(exec|run)|psql|ssh |scp " $F | grep -v "</dev/null" | grep -v "^.*#" || echo "every stdin consumer redirected"
grep -nE "[0-9]{12}" $F | grep -v "000000000000" || echo "no number but the synthetic one"
```

Expected: 16 blocks; a TAMAM line per bash block; `every stdin consumer redirected` (a line printed means a missing `</dev/null`: fix it); `no number but the synthetic one`. The file is not committed (outside the repo); tell the controller its path, the bundle's name and sha256.

---

### Task 22 (conditional): Onto main — the editor's `0014` and this slice's `0015` in one chain

**Where:** `/c/tmp/g2b-protokol`. **When:** the owner's «main'e al» for this slice, with the editor (`feat/g2b-monitor-esleme`, migration `0014_device_beds`) either already on main (case A) or not (case B — the owner calls B1d first). **Never by itself:** the controller names the case.

**THE HARD RULE (Lane B, 2026-11-01): never ship a fork.** Whichever slice lands second points its `down_revision` at the other BEFORE main or the VM. Task 18 Step 4's one-head check runs after this task, on the result, and Task 21's B-1 checks the VM's migration against `0015`'s `down_revision`.

The overlap with the editor (spec §9, Lane B's answers): `admission/errors.py` (two blocks), `api/app.py` (include lines beside the research router), `tests/conftest.py` (the editor replaces the model imports with a `walk_packages` loop pinned by `tests/test_conftest_tables.py`), `tests/test_route_permissions.py` (each slice 59 → 62; merged 65), `dashboard/src/live/apiErrors.test.js` (codes 16 → 21 with the editor, → 24 with this slice; merged 29), `i18n/catalog.js` (two namespaces), `testTokens.testutil.js` (two blocks), `tests/test_tenant_isolation.py`, `test_admission_form.py`'s `CODES` pin, and one call site: the editor's `devicebeds/service.py` `_open_admission_number`, which returns `Patient.patient_number` as a bed's occupant for its dialog and its audit (O74).

#### Case A — the editor is on main: rebase this slice onto it, `0015` follows `0014`

- [ ] **A1: Rebase.**

```bash
cd /c/tmp/g2b-protokol
git status --short                                         # clean
git log --oneline -1 main | cat                            # main holds the editor's merge (local ref; nothing is pulled)
git log --oneline main -- homunculus-engine/alembic/versions/0014_device_beds.py | head -1   # must print a commit
git rebase main
```

At each conflict, keep BOTH sides — never one wholesale:
- `admission/errors.py`: the editor's block inside `CODES` and this slice's block after it (E15) — usually no conflict at all;
- `api/app.py`: the editor's `device_beds_router` import and include, then this slice's two (protocol, edge query), all after `infinity_research_router`;
- `tests/conftest.py`: the editor's `walk_packages` loop; DROP this slice's `import homunculus.protocol.models` line (the loop imports every `homunculus.*.models`, `protocol.models` included — check `tests/test_conftest_tables.py` passes and lists `protocol_settings`, or extend its expected list if it pins one);
- `tests/test_route_permissions.py`: both `GUARDED_MODULES` entries, all rows, `len(EXPECTED) == 65`;
- `apiErrors.test.js`: `toHaveLength(29)`, the prefix `/^(kabul|protokol)\.err\./` (the editor's codes map to `kabul.err.*` or its own namespace: widen the pattern to whatever both use);
- `test_admission_form.py`: the pinned set holds both slices' codes;
- `catalog.js`, `testTokens.testutil.js`, `strings.test.js`: both blocks, each blank-separated.

`git rebase --continue` after each; a conflict outside this list: `git rebase --abort` and report.

- [ ] **A2: Repoint `0015` to `0014`.** **Edit** `homunculus-engine/alembic/versions/0015_protocol.py`: `down_revision: Union[str, None] = "0013"` → `"0014"`; in its docstring `Revision 0015, follows 0013 (E1: …)` → `Revision 0015, follows the editor's 0014 (device_beds).` and `Revises: 0013` → `Revises: 0014`. **Edit** `homunculus-engine/tests/test_migration_0015_protocol.py`: every `"0013"` (the upgrade target before 0015, the downgrade target, the version asserted after it) → `"0014"`; the docstring's `0013 → 0015 → 0013 → 0015` → `0014 → 0015 → 0014 → 0015`.

- [ ] **A3: The editor's occupant reads the board key (O74; Lane B's correction, spec `e86835c`).** The call site is `_open_admission_number` in `homunculus-engine/src/homunculus/devicebeds/service.py` (≈ `:208` at `2e311e9`) — NOT `_patient_of`, which only picks the audit row's id from what `_open_admission_number` (and the board's occupants) answered, and stays as it is. **Edit** `_open_admission_number`: its select becomes `select(Patient.patient_number, Admission.protocol_no)` (same join, same condition) and it returns `board_key(protocol_no, number)` for the row it finds (None for none), with `from homunculus.admission.boardkey import board_key`; its docstring says "the board key of an open admission on the bed (G2-B1d: the protocol; a legacy admission's H-number)". **The test point** (Lane B): in the editor's occupancy tests (`tests/test_device_beds_occupied.py`) add a test — a kabul patient admitted through the route AFTER B1d (the ward has a start number, so the admission's protocol is `202600000001`) lies on the bed; a bind of a monitor to that bed without `confirm_occupied` is refused `bed_occupied`, and the refusal's `occupied[].patient_id` is `202600000001`, not the H-number; with `confirm_occupied` the bind's audit row's `patient_id` (picked by `_patient_of`) is the same `202600000001`. The editor's own tests that read `patient_number` as that id switch to `board_key` by Task 5 Step 7's rule. Lane A's `_occupants` needs nothing (Task 5's strip test pins it).

- [ ] **A4: Gates** — Task 18 Steps 1–5 on the rebased branch (Step 4 must print `['0015']`), and `alembic heads` on the chain `0013 → 0014 → 0015`. Commit A2–A3 as `fix(protocol): 0015 follows the editor's 0014; its bed occupant is the board key` (with the Co-Authored-By line). Then main is fast-forwarded to `feat/g2b-protokol` by the controller on the owner's «main'e al» — not by this task (this plan never touches `main`, which is checked out in the user's own repository); never a push without the owner's word.

#### Case B — the owner calls B1d to main first: this slice becomes `0014`

- [ ] **B1: Rename.** `git mv homunculus-engine/alembic/versions/0015_protocol.py homunculus-engine/alembic/versions/0014_protocol.py` and `git mv homunculus-engine/tests/test_migration_0015_protocol.py homunculus-engine/tests/test_migration_0014_protocol.py`; in the migration `revision = "0014"`, `down_revision = "0013"`, docstring `Revision 0014, follows 0013` / `Revision ID: 0014`; in the test every `"0015"` → `"0014"` (the targets `"0013"` stay); in the plan's and the docs' text `0015` → `0014` where it names this migration (`grep -rn "0015" docs homunculus-engine/src homunculus-engine/tests homunculus-engine/alembic | grep -v "^Binary"`), and the blocks' «0015_DOWN» is `0013`.

- [ ] **B2: Tell Lane B** (through the controller): its `0014_device_beds` becomes `0015_device_beds` with `down_revision = "0014"` before it reaches main or the VM; its `_open_admission_number` (not `_patient_of`) reads `board_key`, tested on `occupied[].patient_id` (A3's change and test, on its side); `conftest.py` drops `import homunculus.protocol.models` when its loop arrives; the counts become 65 and 29.

- [ ] **B3: Gates** — Task 18 Steps 1–5 (Step 4 prints `['0014']`). Commit `refactor(protocol): the protocol migration is 0014 — B1d reaches main before the editor` (with the Co-Authored-By line). Then the owner's «main'e al» as A4.

---

## Amendments

Changes to this plan made while it is executed go here, each dated, with its reason and the task it changes (A-1 …).
