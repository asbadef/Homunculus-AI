# G2-A2 · Engine debt: NEWS2 freshness, assumed inputs, audit reads, unreadable scope, ingest ids — design

**Date:** 2026-10-25 · **Lane:** A (patient & engine) · **Branch:** `feat/g2a-a2`, created off `feat/g2a-o17`
at A1's final head (the A1 plan-fold commit; the plan fills in the sha). A2 builds on A1 because both touch `api/app.py`,
`api/board.py` and the audit modules. Code references below were read at `46a282d`, not at the code map's base (`03daac4`).
A1's later commits (X12–X14) moved a few `api/app.py` lines; the plan re-reads them.
**Code map:** `C:\tmp\homunculus-plans\g2a-a2\map.md`. Items 1, 2, 3, 5, 7 are in this slice. Item 4 moved to Lane B (B1a),
and item 6's function was deleted, so it goes to the audit-screen slice.
**Clinician-owner decisions (2026-10-25):** **Q1** = option 1: a stale input drops out of the total, the score
becomes partial, and the card says which input is how old. The windows are the rule's existing operational defaults
until a clinical review changes them. **Q2** = the controller's recommendation, adopted (the owner was shown the consequence and did not object, 2026-10-25): still assume
air and Alert, show a visible «varsayıldı» mark, and do not count the score partial for it. A charted O2/ACVPU value
expires after 8 h. "New confusion" is not modelled.

## 1. The problem

- **The board's NEWS2 ignores age.** `api/board.py:59–72` calls `rules/news2.py:131–163` `score(state)`, which
  takes `state.latest()` whatever its age. The freshness windows `_NEWS2_FRESHNESS` (`news2.py:181–185`: RR, SpO2,
  SBP and HR 1 h, temperature 2 h) are only used by `evaluate()`, and only for the reasoning's `stale_inputs`
  text (`:192–199`, `:218–222`). The card can therefore show a four-hour-old pressure inside a "complete" score.
- **Air and Alert are assumed silently.** When nothing is charted, `news2.py:156–159` scores air (0) and Alert (0).
  `missing` covers only `_CORE_VITALS` (`:111`, `:142–148`), so nothing says the two inputs were assumed. A charted
  value never expires. No dashboard screen sends either one on the pilot: the `/clinical` door accepts them
  (`api/clinical.py:50–52`, `:91–92`), but nothing calls it with them.
- **Audit reads return the oldest N rows.** All three backends read `ORDER BY id ASC LIMIT` (`api/audit.py:283`,
  `api/audit_postgres.py:118`) or `hits[:limit]` (`audit.py:175`). The callers that suffer:
  - `/audit` returns the first 200 rows ever, with no cap (`api/app.py:1024–1043`).
  - `/alarm-quality` reads the first 20 000 rows and then filters by `ts` in Python (`:1155–1156`), although every
    backend already takes `since=` (`audit.py:142–148`).
  - `rehydrate` reads the first 1 000 000 rows (`:249`). On a large tenant the rows it drops are the newest ones,
    which are the current state.
- **An unreadable scope answers "not found".** `scope/resolver.py:23,59–76` returns `UNKNOWN` when the token does
  not decode, the database fails or there is no membership. Trends and `/stream-ticket` answer 503 for it
  (`app.py:853–854`, `:972–976`). Every other single-patient route goes through `_require_patient`
  (`:494–537`), which answers 404 and appends a false `scope_denied` row (`:533`). `/patients` answers 200
  with an empty board, and the "blind" note (`scope/rules.py:210–213`) wrongly blames the assignment.
- **`/ingest` does not validate patient ids.** The Observation parser does not strip, check for blank or cap the
  id (`gateway/fhir.py:52–55`). `"Patient/"` gives the id `""`. A non-dict `subject` or a non-string `reference`
  raises AttributeError, and that becomes a 500 because only `GatewayError` is caught (`app.py:712–715`).
  `PATIENT_ID_MAX = 128` (`app.py:79`) applies only to request bodies (`_body_patient_id`, `:554–561`).

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A stale input leaves the total (Q1).** `score(state, now)` gives an input older than its `_NEWS2_FRESHNESS` window 0 in `breakdown` and lists it in a new `stale` list (breakdown names, the same order as `missing`). `partial = bool(missing or stale)`. The windows stay as they are, as operational defaults: they are not a clinical claim, and no vault change is needed. Age equal to the window is still fresh (`age > window`, as `:196`). A future-stamped reading (negative age) is never stale. | Owner decision. A score built on an old reading must not read as current. Points are never negative, so the partial total stays a lower bound, and the existing "the true total may be higher" wording is still true. |
| D2 | **One scoring function.** `score(state, now: datetime \| None = None)`. With `now`, it applies D1 and D6. Without it, it behaves as today. `api/trends.py:154` keeps calling it without `now`. | Trends reads the points of each value, not the value's share of the total. A stale value still scores what it scores. |
| D3 | **Freshness is judged on the wall clock at board time, not at `obs.timestamp`.** `patient_board(…, now=None)` and `board_snapshot(…, now=None)` default to `datetime.now(timezone.utc)`, as `_meds` already does (`board.py:83`, `:107`). Tests pass `now`. | `obs.timestamp` is the rule's own time at ingest (`app.py:603`, `:718`). A board judged at that time never ages. |
| D4 | **Payload.** `latest.news2` gains `stale: [name]`, `assumed: [name]`, `measured_at: {name: iso\|null}` and `fresh_until: {name: iso\|null}` for all seven inputs. `fresh_until` is the reading's time plus its window, so it is in the past for a stale input. It is null when the input was never measured or charted. **The API sends the stamp, not the age.** An age baked into the payload is frozen at publish time and wrong a minute later. The card prints `ageText(t, measured_at[name], useBoardNow())` (`patient/ageText.js:12`, `BoardState.jsx:299`). `freshness.js:3–9` allows the screen to state an age. "Too old" is the API's `stale`, and the screen never compares `fresh_until` with a clock. | Respects the rule in `freshness.js`, and the age shown follows the server's clock. The stamps are keyed by NEWS2 names, so the screen needs no table mapping them to `latest.at`'s signal keys. |
| D5 | **Freshness changes are pushed.** `_escalation_cycle` (`app.py:266–309`, every 20 s: `:164`) republishes a measured patient's board, built at the cycle's `now`, when any `fresh_until` falls in (previous cycle, now]. The test lives in a pure helper, `board.freshness_turned(state, since, until)`. The first cycle after a start has no `since` and republishes nothing; `/patients` on (re)connect is already fresh. The code goes in a lane-marked `# G2-A2` helper. | A feed that stops is exactly when no further frame arrives. Without the push, the card keeps its fresh look until a reload. |
| D6 | **The NEWS2 alert uses the same score. Adopted: the controller's recommendation; the owner was shown the consequence and did not object (2026-10-25).** `news2.evaluate(state, now)` passes its `now` to `score()`. `patient_relative.apply` (`pipeline.py:71`, `patient_relative.py:72`) gets `now` too. The labels in `stale_inputs` and the reasoning note stay as they are. **Consequence:** a stale input can no longer lift NEWS2 into an alert band. **Fallback, kept as the recorded alternative:** if the owner declines, the alert stays unchanged, and the divergence is recorded as an open item. | Otherwise the card can read "NEWS2 4 · kısmi" next to an alert "NEWS2 7": two numbers under one name, which `board.py:270–273` exists to prevent. |
| D7 | **Room air and Alert are assumed, with a mark (Q2, adopted).** An uncharted `air_or_oxygen` or `consciousness` still scores 0 (air, Alert) and is listed in `assumed`. It does **not** make the score partial. The alert's reasoning gains one line naming the assumed inputs. | The pilot charts neither. Counting them as partial would mark every pilot score partial forever, and the mark would stop meaning anything. A visible mark keeps the assumption honest without that. |
| D8 | **A charted O2/ACVPU value expires after 8 h (one nursing shift).** The clock runs from the observation's own timestamp, set by the chart's `recorded_at`. After that the input falls back to assumed-with-mark. The windows go in `_CHARTED_FRESHNESS` beside `_NEWS2_FRESHNESS`, as configurable operational defaults. With `now=None` nothing expires. **Adopted like D6 (the owner was shown the consequence and did not object, 2026-10-25):** an expired "on oxygen" takes 2 points off the total, and an expired V/P/U takes 3. The mark says why. | An old chart must not speak for the current shift. Whether the total should then drop or hold was put to the owner, who did not object to the drop. |
| D9 | **"New confusion" is not modelled.** Any ACVPU ≥ 1 scores 3, as today (`news2.py:104–106`). | Telling new confusion from chronic confusion needs a baseline: vault `news2.md` says "ACVPU's 'new confusion' already assumes a baseline". |
| D10 | **The card** (`News2`, `BoardState.jsx:153–178`) keeps the total, the partial pill and the red-parameter pill. It adds a visible line with each stale input and its age ("SpO2 · 2 sa önce") and a «varsayıldı» pill naming the assumed inputs. An expired chart shows "son kayıt {age}". New strings in `strings/news2.js`, ×4 languages: `staleMark`, `staleHint`, `assumedMark`, `assumedHint`, `assumedNever`, `assumed.air_or_oxygen`, `assumed.consciousness`. az/ru/en await native reading (O32-style open item). Block marked `// G2-A2`. `liveAdapters.js:67` passes `news2` through unchanged. | The owner asked that the card say which input is how old. The 8 h figure is not repeated on screen: it is the engine's. |
| D11 | **Audit reads: one surface, three backends.** `records(…, newest: bool = False, after_id: int \| None = None)`. `newest=True` returns the newest `limit` matching rows in ascending id order (SQL `ORDER BY id DESC LIMIT n`, reversed; memory `hits[-limit:]`). `after_id=n` returns rows with `id > n`, oldest first. Passing both raises ValueError. Passing neither keeps today's oldest-first. **Contract for Lane B (B6 heat map):** `records(tenant=, event_type=, since=, newest=True, limit=)` means "the newest N rows of the window, oldest first". No other order is promised. | One API, no migration (D-deploy). "Newest" and "every row" are different questions, and each gets its own parameter. |
| D12 | **Callers.** `/audit` reads newest N, with `limit` clamped to 1…`AUDIT_LIMIT_MAX` (`AUDIT_LIMIT_MAX = 1000`). `/alarm-quality` passes `since=` to the backend instead of filtering in Python, sets `newest=True`, clamps `limit` to 20 000, and adds `truncated` using a limit+1 read (the trends pattern, `trends.py:122–124`); `truncated` on `/alarm-quality` is adopted. `rehydrate` pages every row by `after_id` (page size 5000); it never reads newest N, and the 1 000 000 cap goes. `rehydrate()` accepts an Iterable. `/audit/verify` stays oldest-first (`:1173`). | An auditor asking about recent activity gets recent rows. A replay needs every row. A hash chain can only be verified from genesis. |
| D13 | **An unreadable scope is 503 in `_require_patient`.** The check comes right after the scope is resolved (`:524`), before `sees_patient` and the `scope_denied` append (`:533`). The detail is `"kapsam şu anda okunamıyor"`, already mapped by the dashboard (`apiErrors.js:80`). **Routes whose answer changes** to 503 with no row. From 404 plus a false row: POST `/clinical/{id}` (`:584`), PUT `/clinical/{id}/profile` (`:660`), `/ack` (`:763`), `/view` (`:791`), `/alerts/{id}` (`:955`), `/audit?patient_id` (`:1034`), GET and POST `/scores/sofa/{id}` (`:1062`, `:1102`). From 403 «kapsam dışı» (D13b): `/audit` without a patient id (`:1035`) and `/alarm-quality` (`:1147`). Trends' own check (`:853–854`) becomes redundant and is removed, with the same behaviour. `/patients` (`:803–829`) answers 503 before `apply_scope`. The order is unchanged: the 403 for a missing permission and the 400 for a bad body come first. | A database blip must not tell a ward its patient is gone, or write an access-violation row nobody committed. A failed `/patients` load already shows UNAVAILABLE (`boardStore.js:129–159`), so the dashboard needs no change. |
| D13b | **The whole-trail routes (adopted).** `/audit` without a patient id (`:1035`) and `/alarm-quality` (`:1147`) answer 403 "kapsam dışı" for UNKNOWN today. They answer the same one-line 503 as D13; a readable restricted scope keeps its 403. | The same reason as D13: an unreadable scope is not a restricted one. It is outside the map's fix, and the controller adopted it on 2026-10-25. |
| D14 | **One patient-id validator for `/ingest`.** `patient_id_from(value, *, what)` goes in `gateway/fhir.py`: the value must be a str, it is stripped, and it must be non-blank and ≤ `PATIENT_ID_MAX`. `PATIENT_ID_MAX` (128) moves from `app.py:79` to `gateway/fhir.py`, and `app.py` imports it for `_body_patient_id`. Anything else raises `GatewayError`, which becomes a 400. **Callers:** Observation (`fhir.py:52–55`, where a non-dict `subject` or a non-string `reference` is also a `GatewayError`), Patient (`api/patient_identity.py:130–142`) and Encounter (`:199–206`). Their messages keep naming the protocol number (`test_api_patient_identity.py:104`). Observation ids are now stripped, as Patient and Encounter ids already are. Path parameters are out of scope. **Shared ground:** `api/patient_identity.py` is shared with Lane B, whose B1a adds columns and fields to it. A2 touches only the two parse functions (Patient, Encounter), each by one helper call. **Fallback:** Lane B was asked and may ask A2 to cap only the Observation path; A2 then leaves `patient_identity.py` to B1a. **History:** old audit rows with padded ids replay as written (no migration, no rewrite of history). | A blank id merges readings into a pseudo-patient. A 129-character id is a feed error. A 500 hides both. Readings and identity have to key alike. |
| D15 | **Lane-marked seams.** Every dashboard block is wrapped `// G2-A2 …`, and backend helpers carry `# G2-A2` comments. Lane B's files are not edited. | Both lanes touch `api/app.py`, `BoardState.jsx` and `api/patient_identity.py`. The marks show whoever resolves a merge, and the other lane's reviewer, which lines are A2's (the merge rule is in §8). |

## 3. Data flow (D1–D8)

```
reading/chart ─► Engine.ingest(obs, now=obs.timestamp) ─► news2.evaluate(state, now)
                     score(state, now): core vital older than window → 0, `stale`; never seen → `missing`
                                        O2/ACVPU uncharted or > 8 h → air/Alert (0), `assumed` (not partial)
                     alert total == the card's total for the same instant (D6)
board build (ingest/chart/ack/escalation/GET /patients) ─► patient_board(…, now=wall clock)
                     _news2(state, now) → {total, partial, missing, stale, assumed, red_param, breakdown,
                                           measured_at{7}, fresh_until{7}}
escalation cycle every 20 s ─► freshness_turned(state, prev, now)? → republish board(now) over SSE
card ─► total + «kısmi» + "SpO2 · 2 sa önce" (ageText on measured_at, server-corrected clock) + «varsayıldı»
```

## 4. Files

**Engine (Lane A):** `rules/news2.py`:
- `News2Result` gains `stale`, `assumed`, `measured_at` and `fresh_until`; `partial` becomes `missing or stale`.
- `score(state, now=None)` (`:131–163`) and `_CHARTED_FRESHNESS`.
- `evaluate` passes `now` and adds the assumed note (`:202–236`).

D6 only: `rules/patient_relative.py:65–78` gets `now`, and `pipeline.py:69–71` passes it.

**API (Lane A):** `api/board.py`:
- `_news2(state, now)` (`:59–72`).
- `patient_board` and `board_snapshot` take `now` (`:247`, `:284`).
- `freshness_turned`.

`api/app.py`:
- The cycle's republish helper (`:266–309`).
- `_require_patient` (`:494–537`) and `/patients` (`:803–829`).
- Remove trends' own 503 check (`:852–854`).
- `/audit` (`:1024–1043`) and `/alarm-quality` (`:1136–1158`).
- `_ensure` paging (`:249`).
- Import `PATIENT_ID_MAX` (`:79`).

Audit backends:
- `api/audit.py`: the Protocol (`:142–148`), memory (`:172–175`), SQLite (`:266–287`) and a paging helper `iter_records`.
- `api/audit_postgres.py:97–129`.
- `api/rehydrate.py:29`: accept an Iterable.

Gateway: `gateway/fhir.py` (the validator and the constant) and `api/patient_identity.py:130`, `:199` (shared ground with Lane B's B1a: only the two parse functions, one helper call each; D14).

**Dashboard (shared seam, `// G2-A2`):** `live/screens/common/BoardState.jsx` (`News2`), `live/i18n/strings/news2.js`
(7 keys ×4), and `live/data/board.testutil.js:116–119` (the fixture gains the new keys).

**Docs:**
- `docs/homunculus-rehber-TR.md:833–835`: the NEWS2 note gains "eski veri skora girmez" and «varsayıldı».
- The roadmap row G2-A2 in `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`.
- `Homunculus/wiki` is untouched: the windows and the 8 h are operational defaults, not clinical claims (adopted).

## 5. Tests (TDD, red first)

1. **Freshness (D1–D6).**
   - `tests/rules/test_news2.py`: a stale input gives breakdown 0, is listed in `stale` and makes the score partial. Never-seen stays in `missing`. Boundaries: 60:00 fresh and 60:01 stale; temperature at 2 h. `now=None` is unchanged.
   - `tests/rules/test_staleness_structured.py:36–52`: the alert still fires, `systolic` is listed, and under D6 the reasoning says partial.
   - `tests/test_api_board_news2.py`: `_board` passes `now=WHEN` (`:40–41`); `stale`, `measured_at` and `fresh_until` on the board; without `now` the board uses the wall clock (frozen clock).
   - New `tests/test_board_freshness.py`: `app.state.escalation_cycle(now)` republishes once when a window passes, and does not republish before it.
   - Re-run `test_scenario_news2.py`, `test_scenarios_e2e.py` and `test_scenarios_hl7_parity.py` under D6. The plan measures the scenarios' hourly cadence against the windows; if a scenario's cadence exceeds a window, the scenario's timestamps are tightened, not the window.
2. **Assumed (D7–D8).**
   - `tests/rules/test_news2.py:101–107`: also asserts `assumed == ["air_or_oxygen", "consciousness"]`.
   - Charted O2=1 at 7 h 59 min scores 2 and is not assumed; at 8 h 01 min it scores 0 and is assumed. ACVPU 3 at 9 h is assumed Alert. `partial` stays false when only `assumed` is set. `now=None` never expires.
   - `tests/test_api_board_news2.py:74–91`: the breakdown still sums to the total, and `assumed` is on the board.
   - Dashboard: `BedCard.test.jsx` and `PatientScreen.test.jsx` (stale line with age, «varsayıldı» pill, nothing when both lists are empty); `live/i18n/strings.test.js` (key and placeholder parity ×4).
3. **Audit reads (D11–D12).**
   - New `tests/test_audit_newest.py`, modelled on `test_audit_since.py`: memory, SQLite, and Postgres via `requires_db`. Covers newest N ascending, newest with `since`, `after_id` paging, and both parameters raising ValueError.
   - `test_api_audit.py`: 250 rows return the newest 200; the cap.
   - `/alarm-quality`: `since` is passed and `truncated` is set.
   - `test_rehydrate.py`: more rows than a page rebuild the newest state.
   - `test_board_permissions.py:98–101` (`[-1]` is the newest) stays green. `test_audit_chain.py` and verify are unchanged.
4. **Unreadable scope (D13).** In `tests/test_api_scope.py`, a new class parametrised over every D13 route (the whole-trail routes of D13b included, where a readable restricted scope keeps its 403) asserts 503 and no `scope_denied` row; the device token still gets 200; `/patients` with UNKNOWN is 503. The blind test (`:120–127`) stays. `test_trends_api.py:189–194` and `:237–245` stay green.
5. **Ingest ids (D14).** `tests/test_gateway_fhir.py`: blank, whitespace-only, 129 characters, a non-string `reference` and a non-dict `subject` each raise `GatewayError`; 128 characters passes; the id is stripped. `/ingest` answers 400, not 500 (in the style of `test_api_scope.py:388–420`). `test_api_patient_identity.py:104` is unchanged, plus a refusal of a 129-character protocol number.

**Gates:** the engine suite without a database, the Postgres audit tests (`TEST_DATABASE_URL`), the dashboard suite and the build. Record the counts in the plan.

## 6. Acceptance (local stack; the VM later, with the owner)

1. On a synthetic patient, post five fresh vitals and a temperature stamped 2 h 05 min ago. The card shows NEWS2 without the temperature's points, «kısmi» and "ateş · 2 sa önce". A reading stamped 59 min ago turns stale on screen within about 1 min plus 20 s, with no reload (D5).
2. A patient with nothing charted shows «varsayıldı: oda havası, uyanık». Chart `supplemental_oxygen=1` with `recorded_at` 7 h 55 min ago: the total rises by 2 and the mark disappears. Within about 20 s of the 8 h boundary the mark returns and the 2 points go.
3. With more than 200 audit rows, `/audit` returns the newest. Restart the API with more rows than one rehydrate page: the board is identical.
4. Force the scope resolver to UNKNOWN with a scope-only database failure: on the local stack, rename the `staff_scopes` table (`ALTER TABLE staff_scopes RENAME TO staff_scopes_off`), and rename it back afterwards. Only the scope reader uses that table (`read_scope_for_user` → `read_grants`), so the clinician's token still resolves, and the resolver logs "scope lookup failed … refusing rather than widening" and returns UNKNOWN (`scope/resolver.py:64–73`). Then `/patients` and `/alerts/{id}` answer 503, the board shows UNAVAILABLE, no `scope_denied` row is written, and the device token still answers 200. An undecodable token does not do this on the real stack: it fails earlier, as a 401, in the caller's own resolver (`api/prodserver.py:273–276`, `api/app.py:444–455`), and stopping Postgres fails that same resolver's lookup before the scope is read. The automated tests force UNKNOWN with a resolver stub (`app_with(UNKNOWN)`, `tests/test_api_scope.py:55–68`, used at `:371`; the resolver's own cases are in `tests/test_scope_resolver.py:51–72`).
5. `/ingest` with `"Patient/"`, with 129 characters, and with `subject: "x"` each answer 400.

## 7. Deploy notes

- **No migration.** There is no schema change. The new reads use the `id` primary key (`alembic/versions/0004_audit_log.py:58`,
  `BIGSERIAL PRIMARY KEY`; SQLite `INTEGER PRIMARY KEY`). A per-patient newest read on a large log scans the primary
  key backwards; the plan measures it on a 1 M-row SQLite log. The `(tenant, patient_id, id)` index is a later migration only if the measurement says so.
- **Ordering.** The new fields are additive and read defensively. An old dashboard on the new API shows «kısmi» for
  a stale input but no ages. Ship the API and the dashboard in one release. A 503 on `/patients` lands on the
  existing UNAVAILABLE path, so no screen breaks.
- Not on the VM until the group's gate is passed (the vm-deploy-only-when-complete rule) and the owner has
  confirmed Q2, D6 and D8 (owner to confirm before the VM deploy; they were shown the consequence on 2026-10-25 and did not object).

## 8. Out of scope / moved

- SSE `removed` frames for scoped subscribers: Lane B's B1a. Its retention-block edits sit near D5's helper in
  `_escalation_cycle` (`app.py:296–308`). Merge rule (agreed): whichever slice reaches main second merges main into itself and resolves; the other lane reviews every resolution inside its own functions.
- `auditRowFromRecord`: deleted in `2ba255c`; it goes to the audit-screen slice.
- The notification cool-down: A1's D13.
- Deriving air or oxygen from FiO2 or `on_resp_support`.
- NEWS2 Scale 2.
- An unreadable scope on `/infinity-shadow/board` (`app.py:934`), which today shows an empty strip.
- Validating path parameters.
- A time-based re-evaluation of alerts without new data (A1's D13). D5 republishes the board only; it does not re-run the rules.
