# Group 2 · G2-A2 — engine debt: a NEWS2 reading counts only inside its window and an assumption is said out loud; audit reads say which end; an unreadable scope is 503; one patient-id rule at /ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board's NEWS2 and the NEWS2 alert are one score, judged at one instant, and honest about their inputs. A vital older than its window (RR, SpO2, SBP, HR 1 h; temperature 2 h) leaves the total, the score is partial, and the card names the input and its age — "eski veri: SpO2 · 2 sa önce" (az "köhnə məlumat: SpO2 · 2 saat əvvəl"); when a window closes with no new reading, the board is pushed again within one escalation cycle. Uncharted oxygen and consciousness are still scored as room air and Alert, but with a visible «varsayıldı» (az «fərz edildi») mark, not counted partial; a charted value speaks for 8 h, and once it has expired the mark names what it last read — «oda havası (son kayıt: oksijende, 9 sa önce)». A stale input may withhold a NEWS2 alert but cannot end a running one: the running alert is held — never up, down to the band its stale values still reach — and ends when those values are below the band, or 8 h after its input went stale (X9–X12). A reading is judged at its own time but never past the wall clock, live and after a restart (X9e, X10, X10b). The audit reads say which end they read: `/audit` and `/alarm-quality` the newest rows (the latter says `truncated`), a restart every row, a page at a time, installed only when it finished. A scope that cannot be read answers 503 «kapsam şu anda okunamıyor» everywhere it used to answer "not found" or "out of scope", and writes no false `scope_denied` row. `/ingest` keys readings and identity by one patient-id rule — stripped, non-blank, at most 128 characters — and answers 400, never 500.

**Architecture:** `rules/news2.py` `score(state, now=None)` gives a vital past its `_NEWS2_FRESHNESS` window 0 points and lists it in `stale` (`partial = missing or stale`), assumes an uncharted or 8 h-old (`_CHARTED_FRESHNESS`) air-or-oxygen or ACVPU and lists it in `assumed`, and returns each of the seven inputs' `measured_at` and `fresh_until`; without `now` nothing ages (the trend charts); every note names an input by `INPUT_LABEL`. `evaluate(state, now)` and `patient_relative.apply(…, now)` score at the instant `pipeline.py` judges NEWS2 at — the reading's own `now`, never earlier than the patient's last NEWS2 instant (D6, X9e) — and `Engine._held_news2` keeps a running NEWS2 alert while an input is stale or a chart expired: frozen as last scored, ended or stepped down by the **ageless** score judged `HOLD_MAX_S` (8 h) back (X9–X12). `api/board.py` judges the card at the wall clock (`patient_board`/`board_snapshot(now=None)`, one instant for the whole card), publishes `stale`, `assumed`, the stamps — never an age — and `last_charted` (X11), and `freshness_turned(state, since, until)` lets the escalation cycle republish, at its own `now`, a patient one of whose windows closed in `[since, until)` (since per hospital, seeded at start). Both doors judge a reading at `min(its stamp, the wall clock)`, the replay at `min(the stamp, the row's write time)` (X10, X10b). The dashboard's `News2` prints each stale input's age from the stamp against the screen's corrected clock and draws the «varsayıldı» pill, with the last charted value. The three audit backends take `newest=` and `after_id=`; `audit.iter_records` pages every row; `/audit` reads newest N (≤ 1000), `/alarm-quality` hands its window to the backend (≤ 20 000, `truncated`), the replay pages every row by 5000 into an engine installed only when it finished. `api/app.py` `_readable(scope)` answers 503 for `UNKNOWN` in `_require_patient`, `/patients`, `/audit` and `/alarm-quality`, and the dashboard's sentence for it names no route. `gateway/fhir.py` `patient_id_from` is the id rule, `PATIENT_ID_MAX` moves there, and the Observation, Patient and Encounter parsers use it. No migration; deploy the API and the dashboard in one release (O8, the deploy notes).

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, pytest, SQLite and Postgres (SQLAlchemy, psycopg2) audit logs; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`, `fireEvent`).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-25-g2a-motor-borcu-design.md` (D1–D15, §3–§8; the clinician-owner's decisions of 2026-10-25: **Q1** — a stale input leaves the total and the card says which input is how old; **Q2** — air and Alert are still assumed, with a visible mark, not partial; a charted O2/ACVPU expires after 8 h; D6 and D8 adopted on the controller's recommendation, the owner shown the consequence — to be confirmed before the VM, O2). Where the code made the spec's letter impossible, unsafe or merely unspecified, this plan departs from it; every departure is in the table below with its reason and its test. **X1–X8 are the planner's (the plan's first version, `477b2fa`). X9 is the Task 1 review's and X10 the Task 2 review's; X9b–X9e and X10b followed from their reviews; X11 and X12 are the final whole-branch review's.** The reviews' other fixes are in the table too, after X12, by the review that found them.

**How the numbers in this plan were obtained.** The plan's first version (`477b2fa`) was written by implementing every task in a scratch worktree from `e1d23d8` (the spec's commit) and replaying its own blocks onto `f5b3a8b` in a second one (`scratch/g2a-a2-replay` `12125c6`). The branch then implemented it task by task — Tasks 1–6 landed byte for byte as written — and the reviews added commits; **this version is the branch**. Each task names the commits it is and folds its review commits into its own blocks: a review commit that changed another task's file is folded into the task whose behaviour it changed (`0948068` into Tasks 1, 2 and 3; `328e529` into Tasks 5 and 6; `64271db` into Tasks 1, 2 and 7), and a task that edits a file an earlier task edited does so in branch order (`rehydrate.py` and `test_rehydrate.py` in Task 2 for X10b, then Task 4; `app.py` in Tasks 2, 4, 5 and 6). The blocks were derived from per-task end states built from those commits (each commit's patch applied in task order onto `f5b3a8b`; the last task to touch a file leaves it as the branch has it), keeping the first version's blocks wherever they still give that state. This version was then replayed onto `f5b3a8b` in a `git archive` export (no worktree, no git writes; its own `node_modules` junction): every Edit and Write applied in order by a script that asserts each old text occurs exactly once (`CR`/`LF` kept), every command of Tasks 1–7 run as written except the commit blocks (the commits are the branch's own) and the two that need git — Task 6's hunk count was taken with `diff -U0` against `f5b3a8b`'s file, Task 7's range filled by hand — and every red, green, count and line-end figure below is what that replay printed. Task 0's figures are the first version's baseline at `f5b3a8b`; its export figure and its per-file counts were measured again in the replay's export. After Task 6 the export's code and tests equal the branch at `64271db` in all 36 code and test files; after Task 7 its tree equals the branch in all 38 files the slice touches — at `64271db`, with the roadmap row as the commit carrying this version leaves it (its `<range>` filled as Task 7 says). **In the export the four tests that need a git checkout fail** (`test_infinity_release.py` ×3, `test_infinity_transport.py` ×1: they build a release from git); every engine count below is a checkout's — the export's passed + 4 — and Task 0's baseline and Task 8's gates are a checkout's own (the gates ran in the worktree at `64271db`). The reds recorded in the branch's commit bodies are quoted in each task's "Done on the branch" paragraph; the reds in the steps are the replay's, against the state the step is in. Task 8 records two runs of the gates and the acceptance — the first at `57c2d93`, when Tasks 1–7 were done, and the final one at `64271db`, the record. Finally this document itself — and, separately, the per-task files in order — were replayed whole onto fresh `git archive` exports of `f5b3a8b` (124 blocks, the roadmap's `<range>` filled): both trees are byte-identical to the branch in all 38 files. The code is kept beside the per-task files as `/c/tmp/homunculus-plans/g2a-a2/reference.patch` (`git diff f5b3a8b 64271db`, the plan file excluded: 38 files, 2185 insertions, 127 deletions) — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Spec | Code at `f5b3a8b` / what was found | This plan |
|---|---|---|---|
| X1 | D6: "The labels in `stale_inputs` and the reasoning note stay as they are" | `evaluate`'s partial note names `result.missing` only (`news2.py:212–217`). With D1 a score can be partial for a stale vital alone, and the note would read "This is a partial NEWS2:  not recently recorded". | The partial note names the missing **and** the stale inputs, in breakdown order ("partial NEWS2: SpO2, systolic BP, pulse, temperature not recently recorded"); `stale_inputs` is unchanged. Since X9's review every note names an input by one label (`news2.INPUT_LABEL`: the recency note's for the vitals, the patient-relative notes' for the two charted inputs), and the recency note says the stale value is "not counted in the score". Task 1, `test_the_partial_note_names_a_stale_vital_with_the_missing_ones`, `test_the_reasoning_names_every_input_by_one_label`, `test_the_recency_note_says_the_stale_value_is_not_in_the_score`, and `test_staleness_structured.py`'s extended assertion. |
| X2 | D3: `patient_board`/`board_snapshot` take `now` for NEWS2; D5: the freshness republish is "built at the cycle's `now`" | `patient_board` also builds the antibiotic clock (`_meds`, `board.py:83`, which already took `now` and defaulted to the wall clock), and the escalation cycle publishes a second kind of board — an escalation change (`app.py:280–283`) — at the wall clock. Two clocks on one card, and two on one cycle. | One instant for the whole card: `patient_board` hands its `now` to `_meds` too (identical for every caller that names no `now`), and the escalation-change publish is judged at the cycle's `now` like the freshness republish; a patient sent for an escalation change is not sent twice. Task 2, `test_a_patient_escalated_in_the_same_cycle_is_published_once_judged_at_the_cycle` (killed both mutants while planning: the board built at the wall clock, the second frame) and, since the Task 2 review, `test_the_meds_box_reads_the_antibiotic_clock_at_the_cards_instant`. |
| X3 | D10: seven new strings — `staleMark`, `staleHint`, `assumedMark`, `assumedHint`, `assumedNever`, `assumed.air_or_oxygen`, `assumed.consciousness`; "An expired chart shows 'son kayıt {age}'" | None of the seven names carries the spec's own text "son kayıt {age}"; `assumedNever` is its never-charted counterpart. | **Eight** keys ×4: the seven, and `assumedLast` = tr "son kayıt {age}" (az "son qeyd {age}", ru "последняя запись {age}", en "last charted {age}"). Since X11 **eleven**: `assumedLastValue` (tr "son kayıt: {value}, {age}") and `chartedOxygen.{air,oxygen}` (tr "oda havası", "oksijende"); `assumedLast` stays for a payload without the value. No new az text equals its tr source and every ru text has Cyrillic, so `strings.test.js` needs no reviewed entry; X11 adds one test there (a Lane B seam, lane-marked). Task 3. |
| X4 | D10: "The card prints `ageText(t, measured_at[name], useBoardNow())`"; §4 lists `BoardState.jsx`, `strings/news2.js`, `board.testutil.js` | `BedCard` is rendered without a `BoardProvider` (its tests, and the board screen, hand it `nowMs`); `useBoardNow` throws without one (`BoardProvider.jsx:17–19`). The bed list's row has no clock at all. | `News2` takes a `nowMs` prop; the bed card, the bed list (`BedList` gains `nowMs`) and the patient screen pass the clock each already reads with `useBoardNow`. Outside §4: `BedCard.jsx`, `BedsScreen.jsx`, `PatientScreen.jsx` (one line each, lane-marked) and a `BedsScreen.test.jsx` test for the list. Task 3. |
| X5 | D14: in the shared `api/patient_identity.py` "A2 touches only the two parse functions (Patient, Encounter), each by one helper call" | The module imports from `gateway/fhir.py` on one line (`:27`); the helper has to be named there. | Three hunks in that file: the import line and the two blank checks, each replaced by one `patient_id_from` call (Task 6 Step 5 and Task 8 Step 5 count them). |
| X6 | §4 Docs: the guide's NEWS2 note and the roadmap row | The guide's patient-screen passage says the screen cannot tell "no such record" from "out of scope" (`docs/homunculus-rehber-TR.md`, "Panoda olmayan bir hasta"); D13 adds a third answer the ward will see. | One sentence there: a scope that cannot be read is "kapsam şu anda okunamıyor", not "not found", and writes no violation (the living-guide rule). Task 7. |
| X7 | §6: the acceptance on the local stack, §6.4 by renaming `staff_scopes` on it | The local Docker stack's container names (`homunculus-postgres`, `-api`, `-web`) were held by another stack, and only that stack has the Postgres scope reader and a clinician sign-in. | §6.1, 6.2, 6.3 and 6.5 ran on the engine's dev server from `git archive` exports — of the first version's replay head, of `57c2d93`, and of `64271db` (the record) — each with a real stop and start (Task 8 Steps 6–8); §6.4 and the browser walk are written as commands (Steps 9–12) and were **not run** — for the walk with the user. |
| X8 | D11: memory `hits[-limit:]`; D12: `/alarm-quality` "clamps `limit` to 20 000" | `hits[-0:]` is every row, so a newest read of 0 rows would return the whole log; a `limit` of 0 or less on `/alarm-quality` would read nothing (SQLite `LIMIT -1` is no limit at all). | Memory cuts the newest by count (`hits[max(len(hits) - limit, 0):]`, pinned by `test_a_newest_read_of_no_rows_is_empty_not_everything`); both routes clamp from 1 (`/audit` 1…1000, `/alarm-quality` 1…20 000; `test_the_trail_is_capped_and_a_request_cannot_empty_it` and, since the Task 4 review, `test_the_alarm_reports_limit_is_clamped_up_to_one_row`). Task 4. |
| X9 | D6: the alert judges NEWS2 at the reading's own `now`, as the board does | **Found by the Task 1 review** (`ce436fb`). The bridge posts a vitals set one reading at a time, each stamped with the set's time. With D6, the first reading of a set taken more than 60 min after the last saw the rest stale, fell below the band and ended the alert; the next reading raised it again as a new episode — a new nurse notification, the acknowledgement gone. | Staleness may withhold a NEWS2 alert but cannot end a running one: when this evaluation's NEWS2 produced nothing while a vital is stale, the alert that was running is held, with a note naming what it is held on ("Held while inputs are stale: …") and those inputs in `stale_inputs`. A stale input still never raises a new alert (D6). Task 1, `test_a_vitals_set_posted_one_reading_at_a_time_neither_ends_nor_re_scores_the_running_alert`, `test_a_running_news2_alert_is_held_on_a_stale_pressure_until_a_fresh_one_scores_below_the_band`, `test_a_pressure_four_hours_old_does_not_raise_a_new_news2_alert`. |
| X9b | X9 as `ce436fb` had it: the held alert re-scored on each input's last reading | `b5925bb`. Re-scored on the stale readings, a held "NEWS2 6, soon" climbed to "NEWS2 7, immediate" on a 70-minute-old SBP 88 and a fresh temperature, while the score at `now` was 4 — a nurse notification and the escalation clock, on a value over an hour old. | The held alert is frozen: kept as last scored — total, severity, urgency, downgrade — and only its note and `stale_inputs` say it is held; it never climbs on a stale value. Task 1, `test_a_held_alert_does_not_climb_on_a_stale_value`, `test_a_hold_after_a_fresh_alert_freezes_the_fresh_one`. |
| X9c | X9b: a hold ends only when no vital is stale and the score is below the band | `e0f8687`. Frozen, a held alert could not see the patient improve: a red pulse of 140 back to 80 beside a 75-minute-old SBP 105 kept "NEWS2 4" on the board until the pressure was read again. | The **ageless** score — each input at its last reading — ends a hold when it is below the band (here 1). It is never shown; the held alert stays as last scored, so it still cannot climb. Task 1, `test_a_held_alert_ends_when_its_driver_is_normal_though_another_vital_is_stale`, `test_a_held_alert_ends_on_the_later_reading_that_takes_even_its_stale_values_below_the_band`. |
| X9d | X9b's freeze | `3a64e74`. Frozen as last scored, a held "NEWS2 8, immediate" stayed on the board, escalating, for as long as nobody measured the pressure again, though its stale values at their last reading scored 6, then 3. | The ageless score, after the patient-relative layer, is a floor the held alert never sits above: when its band (severity, urgency) is lower than the kept alert's, that alert is kept from then on — **band, not number**: within one band the held alert keeps its number, so a set arriving reading by reading does not move it; down, never up. A baseline charted mid-hold can step it down (the downgrade its stale values earn); a baseline withdrawn mid-hold, which would raise it, reaches it only when the hold ends. With the review minors: three mutant guards (the held note once over a three-reading hold; a hold after a fresh alert freezes the fresh one; the longest-stale vital named first) and the docstring's never-measured vital. Task 1, `test_a_held_alert_steps_down_to_the_band_its_stale_values_reach_and_never_back_up`, `test_a_held_alert_steps_down_to_the_downgrade_its_stale_values_earn`, `test_the_held_note_lists_the_longest_stale_vital_first`. |
| X9e | D6: "judged at the reading's own `now`" | `6676d5f`. The doors judge a reading at its own time, never past the wall clock (X10). A reading stamped 25 minutes in the past was judged at that past instant, where the later readings are fresh and a pressure stale at the wall clock was not yet: a held "NEWS2 6, soon" jumped to "NEWS2 7, immediate". | NEWS2, the patient-relative layer and the hold are judged at a per-patient instant that never goes back, `max(now, the patient's last NEWS2 instant)` (`Engine._news2_judged_at`); `now` is unchanged for the antibiotic anchor, sepsis, shock and the model; the replay, which ingests in id order, follows. Task 1, `test_a_back_dated_reading_cannot_undo_the_hold_or_raise_news2_on_a_stale_value`. |
| X10 | D3, D6: the doors evaluate at `obs.timestamp` (`app.py`, `/ingest`, `/clinical`) | **Found by the Task 2 review** (`d437600`). A reading stamped in the future — a device clock running ahead, a `recorded_at` typed wrong — aged every other input to that stamp: they were judged stale and left the score. | Both doors take one wall-clock instant per request (`/clinical` one for all its entries) and judge each reading at `min(its stamp, that instant)`. The audit row keeps the stamp. Task 2, `TestTheEvaluationInstant::test_a_chart_stamped_in_the_future_does_not_age_the_vitals` (`test_api_clinical.py`), `test_a_reading_stamped_in_the_future_does_not_age_the_others` (`test_api_ingest.py`). Ahead-of-clock stamps are not refused (O12). |
| X10b | X10 at the doors; the replay judged a reading at its stamp (`rehydrate._replay_ingest`) | `ea236ef`. After a restart, a reading stamped 30 minutes ahead aged every other input to it: the ward's "NEWS2 8, immediate" came back held on three stale vitals, sepsis gained a stale MAP and norepinephrine, and the antibiotic anchor moved 30 minutes on. | The replay judges at `min(the stamp, the row's write time)`; the write time stands for the door's wall clock to within the request, is parsed once and also feeds the lifecycle hook. A restart equals live: the alerts identical, the antibiotic anchor within 1 s ("the row is written after the judgement"). Task 2, `test_a_reading_stamped_in_the_future_is_replayed_at_the_instant_the_door_judged_it`. |
| X11 | D8: an expired O2/ACVPU is assumed air/Alert; X9 held on stale vitals only | **Found by the final review** (`0948068`). The hold counted only stale vitals, so a chart's expiry with the vitals fresh ended the alert it had raised: a NEWS2 5 on oxygen ended at 8 h 6 min, a 7 on oxygen and V ended outright, an expired U ended its red-parameter alert — though nobody had charted the patient off oxygen or awake. And the pill said «varsayıldı: uyanık (son kayıt 8 sa önce)» without saying the last chart was U. | An expired chart (in `assumed` with a stamp) holds the running alert like a stale vital: the X9 chain keeps it, the ageless floor counts the chart at its last value (X9d: it steps down as each chart is renewed, never up), and the held note names it — "supplemental oxygen charted more than 8 h ago" — also in `stale_inputs`. The board publishes `news2.last_charted` (oxygen 1/0, the ACVPU letter, None if never), and the pill names it: «oda havası (son kayıt: oksijende, 9 sa önce)», «uyanık (son kayıt: U, 9 sa önce)»; a payload without it still shows the age. **The 7 → 5 step at an expiry remains** when the fresh score reaches a band on its own: a fresh score that reaches a band is the alert, as for stale vitals. `strings.test.js` gains one lane-marked test (Task 8 Step 5 counts the seam). Tasks 1, 2, 3: `test_an_expired_oxygen_chart_holds_the_running_alert_as_a_stale_vital_does`, `test_an_expired_oxygen_and_acvpu_hold_a_news2_7_and_it_steps_down_as_each_is_charted_again`, `test_an_expired_u_holds_the_red_parameter_alert_it_raised`, `test_the_board_names_what_each_charted_input_last_read_whatever_its_age`, `test_a_charted_acvpu_is_named_by_its_letter`, and the bed card's and the patient screen's expired-chart tests. |
| X12 | X9–X11: a hold ends when its stale values are below the band | **Found by the final review** (`ecd5017`). A hold had no other end: one pressure of 88, then 48 h of normal, fresh vitals and no new pressure read "NEWS2 3, held" for ever while the card read 0. | `HOLD_MAX_S` = 8 h (one shift; `pipeline.py`, beside `ANCHOR_RESTORE_S`): the floor is judged at `now − 8 h`, so a stale reading keeps a hold only while it has been stale for at most 8 h from its `fresh_until` — a vital holds until 9 h after it was measured, a chart until 16 h after it was charted — and the alert ends at the first evaluation after that. The bound applies to the input that keeps the hold: a pulse that went stale since does not stretch a pressure's hold, though another input stale for less that reaches the band on its own keeps it; a re-measurement restarts the chain. The held note's last sentence says so. An operational default, not a clinical claim (O3). Task 1, `test_a_held_alert_ends_after_its_stale_input_has_gone_8_h_without_a_new_reading`, `test_a_pressure_re_measured_within_8_h_keeps_the_hold_going_from_its_new_reading`, `test_the_bound_is_on_the_input_that_keeps_the_hold_not_on_any_stale_input`, `test_an_expired_chart_holds_for_8_h_past_its_shift`. |
| Task 2 review | D5: `freshness_turned(state, since, now)` is "a `fresh_until` in (since, now]"; "the first cycle after a start republishes nothing" | `d437600`. The rule counts an age equal to the window as fresh, so a window ending exactly at a cycle's `now` was not stale at that cycle and outside the next one's interval: it was never pushed — **the spec's "(since, now]" was wrong**. One `since` served every hospital, and a window that closed between the start and the first cycle was never pushed. | `[since, until)` — fresh at `since`, stale at `until`; consecutive cycles leave no gap and no overlap, and each window end is pushed once. `since` is per hospital, advanced after that hospital's republish (a tenant whose republish fails does not hold the others back), and seeded at the app's start by the lifespan. X2's one instant is pinned by a test. Task 2, `test_a_window_that_closes_inside_the_interval_has_turned`, `test_the_first_cycle_after_a_start_pushes_a_window_that_closed_since_the_start`, `test_the_first_cycle_after_a_start_does_not_push_a_window_that_closed_before_it`, `test_a_tenant_whose_republish_fails_does_not_hold_back_the_others`, `test_the_meds_box_reads_the_antibiotic_clock_at_the_cards_instant`. |
| Task 3 review | D10: the «varsayıldı» pill, a `StatusPill` | `90b3ed9`. `StatusPill` is `nowrap` and upper case, and the bed card clips its overflow: on a 290 px card the pill cut off the assumed consciousness, the very mark D10 asks for. | The pill wraps (`!whitespace-normal`); its test reads the whole sentence — the assumed values, the screen-reader-only «heç qeyd edilməyib», the hint — and its tone. Task 3, the bed card's "marks the assumed inputs, and names an expired chart's last value and when it was made". |
| Task 4 review | D12: "`_ensure` replays every row, a page at a time" | `74e1a40`. `_ensure` marked the tenant rehydrated and installed its engine before replaying; a page read that failed midway left a half-replayed engine behind the next request — a believable, wrong board. | The replay runs into an engine and a store nothing else can see, installed — the tenant marked rehydrated — only when every page has been read; a failure installs nothing and the next request retries from the first row. And three pins: the alarm report's cut keeps the newest rows, its limit is clamped up to one row (X8), a Postgres newest read with room to spare returns the window's rows and none older. Task 4, `test_a_replay_that_fails_midway_installs_nothing_and_the_next_request_retries`, `test_the_alarm_report_asks_the_backend_for_its_window_and_says_when_it_was_cut`, `test_the_alarm_reports_limit_is_clamped_up_to_one_row`, `test_postgres_keeps_newest_to_the_window_and_the_filters`. |
| Task 5 review | D13: "the dashboard needs nothing" (`apiErrors.js:80` already maps the 503) | `1498489`, and the trends docstring of `328e529`. `errors.scopeUnreadable` read "…so the live stream did not start"; with D13 the acknowledge toast, the patient chart and the baseline profile form print it too. | Route-neutral in four languages (tr «Yetki kapsamınız şu anda okunamıyor; biraz sonra tekrar deneyin.»); `apiErrors.js`'s comment says where it is printed; the trends docstring says a second look-up would let a blip turn a readable scope into a 503. No test pins the wording; `apiErrors.test.js` and `strings.test.js` run green. Task 5. |
| Task 6 review | D14: a malformed subject is a `GatewayError` | `328e529` (the rest). The malformed-subject 400 echoed the feed's value (`malformed subject: {subject!r}`). | The detail names the type it got (`malformed subject: expected an object, got str`); the `PATIENT_ID_MAX` comment in `app.py` says bodies are not stripped; `edge/serialize.py`'s round-trip promise names the ids it holds for. Two other details still echo a value (O18). Task 6. |

Departures found while implementing go below (X13 …), each with its file and line.

## Open items

Numbered for this slice (G2-A2 O1 …); G2-A1's O1–O15 and the G2-01 plan's are other items, cited as "G2-A1's O15".

| # | Item | Owner | When |
|---|---|---|---|
| O1 | The az, ru and en texts of the eleven new strings (`news2.staleMark` … `news2.assumed.*`, `news2.assumedLastValue`, `news2.chartedOxygen.*`) and of the route-neutral `errors.scopeUnreadable` are the planner's and the reviews' and await a native reading; tr is the owner's wording («varsayıldı», "son kayıt") or the review's. | User | Before deploy |
| O2 | **Q2, D6 and D8 are to be confirmed by the owner before the VM deploy** (spec §7): air and Alert assumed with a mark and not partial; a stale reading can no longer lift NEWS2 into an alert band; an expired "on oxygen" takes 2 points off, an expired V/P/U 3 — though since X11 an alert they raised is held, not ended, by the expiry (for at most 8 h, X12). If the owner declines D6, the recorded alternative is the alert unchanged and the divergence an open item. | Owner | Before the VM |
| O3 | The windows (1 h; temperature 2 h), the 8 h and `HOLD_MAX_S` (8 h) are operational defaults, not clinical claims; a clinical review may change them (constants in `rules/news2.py` and `pipeline.py`; no vault change). | Clinical review | — |
| O4 | **No `(tenant, patient_id, id)` index.** Measured on a 1 000 000-row SQLite log (Task 4 Step 7): a patient with rows throughout, and the whole trail, answer in milliseconds; a patient with fewer rows than the limit, all old, walks the whole key in ~0.1–0.5 s — exactly as today's oldest-first read of that patient does. Revisit if a per-patient read on the VM's Postgres log is slow. | Engine | When measured on the VM |
| O5 | `/ingest` still answers 500 for other malformed Observation fields: a non-object `device` (`fhir.py`'s `.get` on it), a `valueQuantity` that is a string, a non-numeric `value` (`float("abc")` is a `ValueError` the door does not catch). Outside D14, which is about patient ids. | Engine (Lane A) | Next slice |
| O6 | **Rules run only on ingest** (G2-A1's O3): D5 republishes the board, not the rules. An alert raised while a reading was fresh stays until the next reading re-evaluates — and since X9 that reading holds a running NEWS2 alert, rather than dropping it, while its inputs are stale (X9–X12 say how far down and for how long). | — | — |
| O7 | An unreadable scope elsewhere: `/infinity-shadow/board` (shows an empty strip) and `/notifications`' token path; the ticket path is already 503. Spec §8. | — | — |
| O8 | **Deploy the API and the dashboard in one release** (spec §7; the deploy notes below). An old dashboard on the new API shows a lower «kısmi» total with no names, no ages and no «varsayıldı», and blames the live stream for every 503; a new dashboard on an old API finds no `stale`/`assumed`/`last_charted` and draws none of them. No migration. | Controller | At deploy |
| O9 | **Tell Lane B:** the D11 read contract for its B6 heat map — `records(tenant=, event_type=, since=, newest=True, limit=)` is "the newest N rows of the window, oldest first", no other order promised; and the shared seams this slice touched — `api/patient_identity.py` (three hunks, X5), `api/app.py`'s escalation cycle (`_republish_turned` and its two call lines sit before the retention block B1a edits; the merge rule is the spec's §8), and `dashboard/src/live/i18n/strings.test.js` (one lane-marked test, X11). | Controller | Before either lane merges |
| O10 | The bed card's NEWS2 line says when the **newest** reading arrived, not each input's; an input that is stale is named with its age, a fresh one never is. | Dashboard | — |
| O11 | `patient_relative._acute_changes` reads each baselined signal's last value whatever its age: a stale reading outside its charted baseline still raises `acute_change`. The safe direction (it can only warn more), and not NEWS2. | Engine | — |
| O12 | **No ahead-of-clock refusal** on `/ingest` and `/clinical`: X10 clamps the instant a reading is judged at, and the audit row keeps the future stamp (the replay clamps it again, X10b); nothing tells the device or the nurse that its clock is wrong. | Engine (Lane A) | Next slice |
| O13 | `news2.INPUT_LABEL` duplicates `patient_relative._PARAM_LABEL` for the two charted inputs ("supplemental oxygen", "consciousness"): one word per input today, two places to keep it so. | Engine | When either is next touched |
| O14 | Lane B's retention sweep, right after the freshness republish in the same cycle, may send a second frame for a patient (the comment at `freshness_since` in `api/app.py`). Harmless — the board replaces the card — but two frames. | Lane B | At the merge |
| O15 | **G2-A1's O15** (no repeat page for an alarm that stays unanswered for hours) covers a held alert too: a hold is the same running episode, so a NEWS2 alert held for up to 8 h past its input's window pages the doctor once. A repeat-page policy is the user's, for a later slice. | User | Later slice |
| O16 | `/alarm-quality`'s cap (`ALARM_QUALITY_LIMIT_MAX`, 20 000) counts every row of the window, ingest rows included: on a busy ward the newest 20 000 rows are about 8 h. The report says so (`truncated`, and `window_from` is the oldest episode it saw), but reading only the alarm event types would need a read of several event types at once — beyond D11's contract. | Engine, with Lane B (B6) | Before the report is used for a whole ward |
| O17 | **The uplink never drops an observation `/ingest` refused**: a patient id longer than 128 characters is a 400 for ever, and the bridge retries it, stalling every reading behind it. Validate the id in the edge parsers (the same rule) and consider dropping an observation after N 400s. | Edge (Lane A) | **Before the VM** |
| O18 | Two 400 details of `gateway/fhir.py` still echo the feed's value: `unparseable effectiveDateTime: {when!r}` (`:71`) and `missing or malformed subject.reference: {reference!r}` (`:80`). | Engine | Next slice |
| O19 | **An urgency dip inside one set:** when the first readings of a set give a fresh partial score that reaches a lower band, that fresh score is the alert (X9: a fresh score that reaches a band is the alert), and the next reading of the set raises it back. No new notification (the same episode), but the sound and the badge may flicker for a reading. | Engine | Watch on the pilot |
| O20 | **A held alert is unmarked on the bed card and the alarm list**: only the patient screen names its stale inputs, as «Bayat girdi: …» (`patient.recoStale`) — a second word beside the card's «eski veri». | Dashboard | Next slice |
| O21 | **After a restart the nurse is told again** about each running immediate alert at its next reading: the notifier's dedup is not replayed. Pre-existing (G2-A1). | Engine | — |

## Deploy notes

- **One release for the API and the dashboard; never roll the dashboard back alone.** An old dashboard on the new API shows a lower «kısmi» total without the stale inputs' names and ages and without «varsayıldı», and calls every 503 a failed live stream (O8).
- **The first start replays every row**, lazily, per tenant: the tenant's first request waits for its whole audit log (measured on synthetic SQLite, 24 beds: 100 000 rows 4.4 s, 400 000 rows 70 s — super-linear, through `PatientState.ingest`'s re-sort). The old 1 000 000-row cap is gone. **Count the VM's rows first:** `SELECT tenant, count(*) FROM audit GROUP BY tenant`.
- **Alerts the old rules raised on stale inputs, or on charts older than 8 h, vanish on the first start** with no `alert_cleared` row (the replay re-judges them under the new rules), so their alarm-quality episodes stay open. Tell the ward before the restart.
- **O17 before the VM:** a refused id stalls a bridge.
- A `/patients` 503 (an unreadable scope) lands on the dashboard's UNAVAILABLE strip, not an empty ward.
- **A rollback to the previous API** puts stale values back into the totals and the alerts (the pre-A2 behaviour: no hold, no «varsayıldı») and restores the oldest-first 1 000 000-row replay cap.
- No migration (`0011_users_must_change_password.py` stays the newest).

---

## Baseline at `f5b3a8b` (measured 2026-10-25)

- **Engine, no database** (`--ignore=tests/test_infinity_vm_pilot.py`, `PYTHONPATH=src`): **2272 passed, 650 skipped, 3 warnings** in ≈ 2 min 20 s in a checkout with the `node_modules` junction (in a `git archive` export, with the junction: `4 failed, 2268 passed, 650 skipped` — the four tests that build a release from git; measured again 2026-10-26).
- **Postgres** (`TEST_DATABASE_URL` on the command line): `test_audit_since.py`, `test_audit_postgres.py`, `test_patient_identity_postgres.py` → **34 passed**.
- **Dashboard:** `npx vitest run` → **89 files / 2432 tests**, all passing. `npx vite build` clean, `precache  20 entries (843.54 KiB)`.
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.

## Counts after each task (in plan order)

| After | Engine, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 2272 / 650 | 89 / 2432 | — |
| 1 | 2315 / 650 | — | `rules/test_news2.py` 65 → **86**, `rules/test_staleness_structured.py` 4 → **4**, `test_pipeline.py` 17 → **39** |
| 2 | 2338 / 650 | — | `test_api_board_news2.py` 11 → **23**; `test_board_freshness.py` new, **8**; `test_api_clinical.py` 26 → **27**; `test_api_ingest.py` 10 → **11**; `test_rehydrate.py` 12 → **13** |
| 3 | — | 89 / 2441 | `BedCard.test.jsx` 34 → **39**, `BedsScreen.test.jsx` 36 → **37**, `PatientScreen.test.jsx` 71 → **73**, `strings.test.js` 7 → **8** |
| 4 | 2361 / 654 | — | `test_audit_newest.py` new, **20** (4 need the database); `test_api_audit.py` 5 → **10**; `test_rehydrate.py` 13 → **15**; Postgres, Step 6's three files: **52** (the base's two audit files' 32 and this file's 20) |
| 5 | 2375 / 654 | 89 / 2441 | `test_api_scope.py` 42 → **56** (the dashboard's strings change, no test) |
| 6 | 2390 / 654 | — | `test_gateway_fhir.py` 10 → **24**, `test_api_patient_identity.py` 43 → **44** |
| 7 | docs only | — | — |
| 8 | 2390 / 654 (gate) | 89 / 2441 (gate), build 20 | Postgres **54**; Python 3.14, the thirteen engine files: **363 passed, 4 skipped** |

Engine arithmetic: 43 + 23 + 23 + 14 + 15 = **118** over the base; the 4 new skips are `test_audit_newest.py`'s Postgres tests. Dashboard: **9** tests, no new file. Measured in the replay onto `f5b3a8b`, 2026-10-26; every engine count is a checkout's (the export's passed + the 4 tests that need git), and the gates' are the worktree's own at `64271db`.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2a-a2`, branch `feat/g2a-a2` (at `f5b3a8b` + this plan as its next commit). If the controller gives you a parallel worktree branched from this one, every path below reads that worktree instead. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree. Never `git push`, never deploy, never change anything on a VM. **Never run `git stash`** — the stash is shared with every other worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd //c "rmdir C:\\tmp\\<worktree>\\dashboard\\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only on repo files — never `sed`, `python`, `node` or a shell heredoc** — with one exception: the two new test files (Tasks 2 and 4) are written with the Write tool and converted to **CRLF** by a one-line Python call that touches only that file (`python -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" <file>`). The tree checks out CRLF (`core.autocrlf=true`); every block here is LF; the Edit tool matches either way. Every Edit's old text is unique in its file at that moment (the replay asserted it). Each task ends by counting the line ends of the files it touched — `CR` must equal `LF`, and both must be the numbers the task gives (a mismatch means a line end was rewritten or an edit landed twice). After editing `strings/*.js` run `npx vitest run src/live/i18n/strings.test.js`: it fails if the Cyrillic or the `ə` was mangled.
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.** Messages are `type(scope): what, in words` and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this session; if the controller records a newer one by the time you commit, use that). The branch's own commits carry the trailers their sessions set (Opus 5.5, Sonnet 5.5, Fable 5.1); they are recorded as they are.
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it. One Bash call runs at most 10 minutes: the whole no-DB suite fits (≈ 2 min 20 s quiet; up to 4 min while other sessions run their suites). **If a gate runs past 8 minutes**, look for another session's pytest on the machine (`ps -ef | grep pytest`) before suspecting the code: the planner's one stalled run coincided with another session's suite. Stop only your own process. A Vitest file that times out under load is run once more alone before it counts as red.
- **Python commands** (always from the engine directory, always `PYTHONPATH=src` — one subprocess test of the whole suite needs it — always name files):
  ```bash
  cd /c/tmp/g2a-a2/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -1
  ```
  **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or in a bare `pytest tests/`. The whole no-DB suite: the same command with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. **Never set or export `DATABASE_URL`.** `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` goes on the command line of the steps that name it, and only there (Task 0 Step 4, Task 4 Step 6, Task 8 Step 2): the database is shared with Lane B and its conftest serialises runs with an advisory lock — a wait is the lock, not a hang (the replay's Task 4 run waited 5 min). Never print a token, a key or an env file's values.
- **Dashboard commands** run from `/c/tmp/g2a-a2/dashboard`. The suite and the build are **two separate commands**. The build must print `built in` and `precache  20 entries`, and no `larger than 500 kB`. A test run may print `Warning: An update to … inside a test was not wrapped in act(...)`; it is not a failure.
- **Line-end count:** each task gives its command (`tr -cd '\r' | wc -c` against `tr -cd '\n' | wc -c` per file).
- **No patient data, ever** (CLAUDE.md rule 6). Beds `bed-1`, `bed-3`, `p-a1`, `G2A-1`, `G2A2-1` …; every value is made up and says nothing about anyone.
- **The clinical rule lives in the engine.** Which input is stale, which is assumed, for how long a charted value speaks and for how long a stale input holds an alert are `rules/news2.py`'s and `pipeline.py`'s (`_NEWS2_FRESHNESS`, `_CHARTED_FRESHNESS`, `HOLD_MAX_S`); the dashboard decides nothing clinical — it prints the engine's `stale`, `assumed` and `last_charted` and states an age (`freshness.js`'s rule). The 8 h figure is never on the screen.
- **Lane B's seams are not touched:** `dashboard/src/live/i18n/catalog.js`, `routes.js` SCREENS, the permissions catalogue; `admission/`, `escalation/router.py`, `scope/`, `tenant/`, `auth/` (Task 8 Step 5 checks). `strings.test.js` gains exactly one lane-marked test (X11); nothing else in it changes. In the shared `api/patient_identity.py` only the import line and the two parse functions change (X5, D14). Every A2 block in a shared file is lane-marked — `# G2-A2` in Python, `// G2-A2` or `{/* G2-A2 … */}` in the dashboard (D15). If a review forces another seam, add a blank-separated block marked the same way and tidy nothing around it.
- **Four languages for every key** (`tr` is the source; `az` the default). An `az` text equal to `tr`, or an `ru` text with no Cyrillic, needs a reviewed entry in `strings.test.js` — none of this slice's does. Russian calls the engine "система", never "движок".
- **Test names:** `describe` names the thing, `it` is a sentence about its behaviour in the reader's terms.

---

## File map

**Create — engine:** `homunculus-engine/tests/test_board_freshness.py` (Task 2) · `homunculus-engine/tests/test_audit_newest.py` (Task 4).

**Modify — engine** (`homunculus-engine/`)

| File | Change | Task |
|---|---|---|
| `src/homunculus/rules/news2.py` | the `datetime` import moved up; `_INPUT_SIGNAL`; `News2Result.stale/assumed/measured_at/fresh_until`, `partial = missing or stale`; `score(state, now=None)`; `_CHARTED_FRESHNESS`; `INPUT_LABEL`; `_ASSUMED_AS`; `evaluate` scores at `now`, the partial note (X1), the recency note, the assumed note; `_val` removed (`score` was its only caller) | 1 |
| `src/homunculus/rules/patient_relative.py` | `apply(…, now=None)` (D6) | 1 |
| `src/homunculus/pipeline.py` | `HOLD_MAX_S`, `_level`; the per-patient NEWS2 instant (X9e); the hold, `_held_news2` (X9–X12); `patient_relative.apply` at that instant | 1 |
| `tests/rules/test_news2.py`, `tests/rules/test_staleness_structured.py`, `tests/test_pipeline.py` | freshness, assumed, the labels, the alert's same score, the hold and its bound | 1 |
| `src/homunculus/api/board.py` | `_iso`; `_news2(state, now)` with `stale`, `assumed`, `measured_at`, `fresh_until`, `last_charted` (X11); `freshness_turned` on `[since, until)`; `patient_board`/`board_snapshot(now=None)`, `_meds` at the same `now` (X2) | 2 |
| `src/homunculus/api/app.py` | `freshness_since` per hospital, `freshness_started`, `_republish_turned`, the escalation publish at the cycle's `now`, the lifespan's seed, the two doors' instant (X10) and their replay comments (Task 2); `iter_records`, `AUDIT_LIMIT_MAX`, `ALARM_QUALITY_LIMIT_MAX`, `REHYDRATE_PAGE`, `_ensure` installs on success, `/audit`, `/alarm-quality` (Task 4); `_readable`, `_require_patient`, `/patients`, trends and its docstring, the whole-trail routes (Task 5); `PATIENT_ID_MAX` imported, its comment (Task 6) | 2, 4, 5, 6 |
| `src/homunculus/api/rehydrate.py` | the write time parsed once, the replay judges at `min(ts, written)` (X10b, Task 2); `Iterable` records (Task 4) | 2, 4 |
| `tests/test_api_board_news2.py`, `tests/test_api_clinical.py`, `tests/test_api_ingest.py` | `_board(now=WHEN)`; the board's tests, the meds box, `last_charted`; the two doors' instant (X10) | 2 |
| `tests/test_rehydrate.py` | X10b's replay instant (Task 2); the paged restart and the replay that fails midway (Task 4) | 2, 4 |
| `src/homunculus/api/audit.py`, `src/homunculus/api/audit_postgres.py` | `newest=`, `after_id=`, `_one_order`, `iter_records` | 4 |
| `tests/test_api_audit.py` | the newest trail and its cap, the alarm report's window, cut, clamp and `truncated` | 4 |
| `tests/test_api_scope.py` | the class `TestJAnUnreadableScopeIsUnavailableNotNotFound` | 5 |
| `src/homunculus/gateway/fhir.py`, `src/homunculus/api/patient_identity.py`, `src/homunculus/edge/serialize.py` | `PATIENT_ID_MAX`, `patient_id_from`, the Observation's subject (its detail value-free); the two identity parsers (X5); the round trip's docstring | 6 |
| `tests/test_gateway_fhir.py`, `tests/test_api_patient_identity.py` | the id rule, the door's 400, the protocol number's cap | 6 |

**Modify — dashboard** (`dashboard/src/`)

| File | Change | Task |
|---|---|---|
| `live/screens/common/BoardState.jsx` | `News2({ news2, nowMs })`: the stale line with ages, the «varsayıldı» pill (wrapping) with the last charted value (D10, X11) | 3 |
| `live/i18n/strings/news2.js` | eleven keys ×4 (X3, X11) | 3 |
| `live/screens/beds/BedCard.jsx`, `live/screens/beds/BedsScreen.jsx`, `live/screens/patient/PatientScreen.jsx` | each passes its `nowMs` (X4) | 3 |
| `live/data/board.testutil.js` | the `news2` fixture's new keys | 3 |
| `live/screens/beds/BedCard.test.jsx`, `live/screens/beds/BedsScreen.test.jsx`, `live/screens/patient/PatientScreen.test.jsx`, `live/i18n/strings.test.js` | nine tests | 3 |
| `live/apiErrors.js`, `live/i18n/strings/errors.js` | the comment; `scopeUnreadable` route-neutral ×4 (the Task 5 review) | 5 |

**Modify — docs** (Task 7): `docs/homunculus-rehber-TR.md` (the NEWS2 note; one sentence in "Panoda olmayan bir hasta", X6), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A2). `Homunculus/wiki` is untouched (no clinical claim changes).

**Outside the repo:** `/c/tmp/homunculus-plans/g2a-a2/acceptance.py` (Task 8), `reference.patch`.

**How an edit reads in this plan:** a bold **Edit** with the file's path and "replace:", a fenced block with the exact old text, "with:", and a fenced block with the new text. Use the Edit tool with those two texts, in the order given. A bold **Write** gives a new file's whole text.

---

### Task 0: The worktree, the shared install and the baseline

Nothing is changed in the repo. The point is to know, before Task 1, that the tree is the plan's and that every gate is green with the numbers the counts table starts from.

**Files:** none in the repo; the junction `dashboard/node_modules` → `C:\tmp\homunculus-g1\dashboard\node_modules` (ignored by `dashboard/.gitignore`; already in place in `/c/tmp/g2a-a2` when this plan was written).

- [ ] **Step 1: The tree is the plan's**

```bash
cd /c/tmp/g2a-a2
git branch --show-current
git status --short
git log --oneline -3
```

Expected: `feat/g2a-a2`; no status line; the top commit is this plan (`docs(plan): G2-A2 — …`), then `f5b3a8b Merge branch 'main' into feat/g2a-a2`, then `312b1f9 merge: G2-A1 (alerts end with their rule; critical latch; escalation chain) into main, on top of the deployed NBP slice`. Anything else: stop and ask. (On `feat/g2a-a2` itself this plan's first version is `477b2fa` and the branch's own commits follow it; this version is committed after `64271db`.)

- [ ] **Step 2: The shared install, by junction (never reinstall)**

```bash
cd /c/tmp/g2a-a2
test -e dashboard/node_modules || cmd //c "mklink /J C:\tmp\g2a-a2\dashboard\node_modules C:\tmp\homunculus-g1\dashboard\node_modules"
ls dashboard/node_modules/.bin/vitest && git status --short
```

Expected: nothing from the first line (the junction is there) — or `Junction created for …`; then the `vitest` path, and still no status line. The junction also matters to the engine suite: `tests/test_infinity_transport.py:149` runs the dashboard under Node and skips without it (`Node and dashboard jsdom required`), which moves one test from passed to skipped.

- [ ] **Step 3: The engine, no database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected (≈ 2 min 20 s on a quiet machine): `2272 passed, 650 skipped, 3 warnings in …`. (In a `git archive` export, with the junction: `4 failed, 2268 passed, 650 skipped` — the four tests that build a release from git, `test_infinity_release.py` ×3 and `test_infinity_transport.py` ×1.)

- [ ] **Step 4: The Postgres-backed tests this slice touches** — the audit log's and the identity store's. The URL is set on this command line only, never exported; the database is `homunculus_test` in the container `homunculus-test-pg-56` (port 56432), shared with Lane B.

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep homunculus-test-pg-56
cd /c/tmp/g2a-a2/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py tests/test_audit_postgres.py tests/test_patient_identity_postgres.py 2>&1 | tail -1
```

Expected: `homunculus-test-pg-56 Up …`; then `34 passed in …` (21 + 11 + 2). `tests/conftest.py` holds a session advisory lock on that database: if Lane B is running its own database tests the run first prints `waiting for another test run on database 'homunculus_test' to finish (advisory lock 0x486f6d756e63)` and waits — that is the lock working, not a hang (the planner's run waited about ten minutes). If the container is not up, stop and ask; do not start one.

- [ ] **Step 5: The dashboard suite**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2432 passed (2432)`.

- [ ] **Step 6: The build**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …` and `precache  20 entries (843.54 KiB)` (the first version's replay); no `larger than`. (`dist/` is ignored.)

- [ ] **Step 7: The test files this slice touches, and which of them need a database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
for f in rules/test_news2 rules/test_staleness_structured test_pipeline test_api_board_news2 test_api_clinical test_api_ingest test_rehydrate test_api_audit test_api_scope test_gateway_fhir test_api_patient_identity; do printf "%s " $f; PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --co tests/$f.py 2>&1 | tail -1; done
grep -ln "TEST_DATABASE_URL\|requires_db" tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py tests/test_api_board_news2.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_rehydrate.py tests/test_api_audit.py tests/test_api_scope.py tests/test_gateway_fhir.py tests/test_api_patient_identity.py; echo "grep exit $?"
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✓ |^ +Tests "
```

Expected: `rules/test_news2 65`, `rules/test_staleness_structured 4`, `test_pipeline 17`, `test_api_board_news2 11`, `test_api_clinical 26`, `test_api_ingest 10`, `test_rehydrate 12`, `test_api_audit 5`, `test_api_scope 42`, `test_gateway_fhir 10`, `test_api_patient_identity 43` (`… tests collected in …`); `grep exit 1` (of the slice's two new engine files, only `test_audit_newest.py` reads the database, and it skips without it); then `strings.test.js (7 tests)`, `BedCard.test.jsx (34 tests)`, `BedsScreen.test.jsx (36 tests)`, `PatientScreen.test.jsx (71 tests)`, `Tests  148 passed (148)`.

No commit: Task 0 changes nothing in the repo.

---

### Task 1: The engine — a reading counts only inside its window; an uncharted input is assumed, out loud; a stale input cannot end a running alert

**Done on the branch** as `8c726fd` (the first version's Task 1, byte for byte; its body's red: `23 failed, 84 passed` — "score() took no `now`; News2Result had no stale/assumed/measured_at; the alert still fired on a four-hour-old SBP 88; the downgrade test saw ('news2', 'moderate', False)"), `ce436fb` (X9, the Task 1 review: the bridge posts a set one reading at a time, and the first reading of a set more than an hour after the last saw the rest stale and ended the alert, which came back one reading later as a new episode — a new notification, no acknowledgement; the reasoning notes name the inputs by the recency note's labels), `b5925bb` (X9b: re-scored on the stale readings, a held "NEWS2 6, soon" climbed to "NEWS2 7, immediate" on a 70-minute-old SBP 88 while the score at `now` was 4), `e0f8687` (X9c: a red pulse of 140 back to 80 beside a 75-minute-old SBP 105 kept "NEWS2 4" until the pressure was read again), `3a64e74` (X9d: a held "NEWS2 8, immediate" stayed so while its stale values scored 6, then 3; with the review minors folded in — three mutant guards: the held note appears once over a three-reading hold, a hold after a fresh alert freezes the fresh one, stale vitals are listed longest-stale first — the docstring's never-measured vital, and a baseline withdrawn mid-hold), `6676d5f` (X9e: a reading stamped 25 minutes in the past took a held "NEWS2 6, soon" to "NEWS2 7, immediate"), the engine half of `0948068` (X11, the final review: `pipeline.py` and `test_pipeline.py`; its body's red: "'Held while inputs are stale: pulse older than the expected refresh window; supplemental oxygen charted more than 8 h ago. ' not in the reasoning (stale_inputs=['pulse']); "the expiry does not end it" — None is not None; "ended on the RESP_RATE reading" — None is not None"), `ecd5017` (X12, the final review; its body's red: "ended at the first evaluation after 8 h stale, and not raised again on the old value" — held at every evaluation through 48 h; "ended 8 h after it went stale" — re-measured at +5 h, held past +14 h; "the pressure is past its 8 h; the stale pulse scores 1" — still held, `stale_inputs=['systolic BP', 'pulse']`; "16 h after the chart: ended" — an expired oxygen held past 16 h) and the test-section header of `64271db` (the held alert keeps its score or steps down, never up; X11 and X12 named). The blocks below are that code: replayed onto `f5b3a8b` they give the branch's `news2.py`, `patient_relative.py`, `pipeline.py`, `test_news2.py`, `test_staleness_structured.py` and `test_pipeline.py` byte for byte. (`0948068`'s board half is Task 2's, its dashboard half Task 3's.)

Spec D1, D2, D6, D7, D8, D9, with X1 and X9–X12. `score(state, now=None)` judges each input's age at `now`: a vital older than its `_NEWS2_FRESHNESS` window (RR, SpO2, SBP, HR 1 h; temperature 2 h) scores 0 and is listed in `stale`, and the score is partial (`partial = missing or stale`); an air-or-oxygen or ACVPU value charted more than `_CHARTED_FRESHNESS` (8 h) ago is assumed again, and every assumption — uncharted or expired — is listed in `assumed`, which does **not** make the score partial. An age equal to the window is fresh (`age > window`, as `_stale_vital_labels`); a reading stamped after `now` never ages. Without `now` nothing ages (D2: `api/trends.py:154` keeps calling it so). `measured_at` and `fresh_until` name all seven inputs either way. `evaluate(state, now)` scores at its `now` (D6) — a stale vital can no longer lift NEWS2 into an alert band — names a stale vital in its partial note with the missing ones (X1), and gains one line naming the assumed inputs (D7); every note names an input by one label, `news2.INPUT_LABEL` (the recency note's: "SpO2", "systolic BP"), and the recency note says the stale value is "not counted in the score". `patient_relative.apply` gets the same instant from `pipeline.py` (D6), so a stale vital is no "acute contributor" either. "New confusion" is not modelled (D9): any ACVPU ≥ 1 still scores 3 (`test_score_new_confusion_scores_three` is unchanged).

**The hold** (`Engine._held_news2`, X9–X12). Staleness may withhold a new NEWS2 alert but cannot end a running one. When this evaluation's NEWS2 produced nothing while a vital is stale or a chart expired (X11: an O2/ACVPU in `assumed` with a stamp), the alert that was running is kept as it was last scored — total, severity, urgency, downgrade (X9b) — with a note naming what it is held on ("Held while inputs are stale: systolic BP older than the expected refresh window; supplemental oxygen charted more than 8 h ago. …") and those inputs in `stale_inputs`. The **ageless** score — `evaluate(state, now − HOLD_MAX_S)`, each stale input at its last reading — ends the hold when it is below the band (X9c), and is a floor the held alert never sits above: when its band, after the patient-relative layer, is lower than the kept alert's, that alert is kept from then on — band, not number; down, never up (X9d). Judged 8 h back (`HOLD_MAX_S`, X12), a stale reading keeps a hold only while it has been stale for at most 8 h from its `fresh_until`: a vital holds until 9 h after it was measured, a chart until 16 h after it was charted, and the bound is on the input that keeps the hold. A fresh score that reaches a band is the alert again, a lower one included. NEWS2, the patient-relative layer and the hold are judged at a per-patient instant that never goes back, `max(now, last)` (X9e); the antibiotic anchor, sepsis, shock and the model keep `now`.

The rules, each held by a test below:
- SBP 88 measured 61 min before `now` scores 0, is `stale`, makes the score partial; a vital never measured stays in `missing`;
- 60:00 is fresh and 60:01 stale (RR, HR); the temperature is fresh at 2:00:00 and stale at 2:00:01; a reading three hours in the future is not stale;
- without `now` nothing ages, and a charted oxygen still scores 2 after 9 h;
- `measured_at`/`fresh_until` carry the breakdown's seven names in its order; `fresh_until` is the reading's time plus its window, None when never measured;
- charted oxygen scores 2 at 7 h 59 min and at 8 h 00 min, and is assumed air (0) at 8 h 01 min; ACVPU 3 charted 9 h ago is assumed Alert (0); `partial` stays false when only `assumed` is set;
- the alert scores what the board scores, raises no new alert on a four-hour-old SBP 88 (D6) and still fires without `now`; its partial note lists a stale vital with the missing ones in breakdown order, by label (X1); its reasoning names the assumptions (D7); the recency note says the stale value is not in the score;
- through the engine: with a charted RR baseline, a four-hour-old SBP 88 is no acute contributor, so the alert is downgraded (D6 in `patient_relative`);
- a vitals set posted one reading at a time neither ends nor re-scores the running alert, and the held note appears once (X9, X9b); a held alert does not climb on a stale value (X9b); it ends when a fresh pressure scores below the band, when its driver is normal beside another stale vital, or on the later reading that takes even its stale values below the band (X9c);
- a held "NEWS2 8, high, immediate" steps down to "NEWS2 6, moderate, soon" when its stale values reach only that band, and never back up; it steps down to the downgrade its stale values earn; a hold after a fresh alert freezes the fresh one; the longest-stale vital is named first (X9d);
- a reading stamped in the past cannot undo the hold or raise NEWS2 on a stale value (X9e); a held alert is still downgraded by the baseline that explains it, and one driven by a stale pressure outside its baseline is not;
- an expired oxygen chart holds the running alert as a stale vital does, and a fresh chart scoring below the band ends it; an expired oxygen and ACVPU hold a NEWS2 7 that steps down as each is charted again; an expired U holds the red-parameter alert it raised (X11);
- a held alert ends at the first evaluation after its stale input has gone 8 h without a new reading; a pressure re-measured within the 8 h keeps the hold going from its new reading; the bound is on the input that keeps the hold, not on any stale input; an expired chart holds for 8 h past its shift (X12).

Scenario cadence (spec §5, measured): `news2_deterioration.yaml` and `news2_partial_nce_only.yaml` read every vital each hour, so at each hourly evaluation the previous hour's readings are exactly 60:00 old — fresh by D1's own boundary — and `test_scenario_news2.py` scores without `now`; the sepsis scenarios (`septic_shock.yaml`, `under_resuscitated.yaml`, `stable_control.yaml`) assert sepsis-branch kinds. No scenario's timestamps change: Step 6 runs the three scenario files unchanged and green.

**Files:**
- Modify: `homunculus-engine/tests/rules/test_news2.py` (an import, one assertion pair, a section appended)
- Modify: `homunculus-engine/tests/rules/test_staleness_structured.py` (one test's assertions)
- Modify: `homunculus-engine/tests/test_pipeline.py` (its imports; the D6 section; the hold, X9–X11; the bound, X12)
- Modify: `homunculus-engine/src/homunculus/rules/news2.py` (the import moved up, `_INPUT_SIGNAL`, `News2Result`, `score`, `_CHARTED_FRESHNESS`, `INPUT_LABEL`, `_ASSUMED_AS`, `evaluate`; `_val` removed — `score` was its only caller)
- Modify: `homunculus-engine/src/homunculus/rules/patient_relative.py` (an import, `apply`'s `now`)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` (an import, `HOLD_MAX_S`, `_level`, the two per-patient maps, the instant NEWS2 is judged at, the hold, `_held_news2`)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/rules/test_news2.py` — replace:
```python
from datetime import datetime, timezone
```
with:
```python
from datetime import datetime, timedelta, timezone
```

**Edit** `homunculus-engine/tests/rules/test_news2.py` — replace:
```python
    assert "consciousness" not in r.missing

```
with:
```python
    assert "consciousness" not in r.missing
    # G2-A2 (D7): assumed, and said so — but not partial.
    assert r.assumed == ["air_or_oxygen", "consciousness"]
    assert r.partial is False

```

**Edit** `homunculus-engine/tests/rules/test_news2.py` — replace:
```python
    assert "partial" in findings[0].reasoning.lower()
```
with:
```python
    assert "partial" in findings[0].reasoning.lower()


# --- G2-A2: a reading counts only inside its window; an uncharted input is assumed, out loud ----
#
# score(state, now) judges each input's age at `now` (D1): a vital older than its window (1 h; the
# temperature 2 h) scores 0 and is `stale`, and the score is partial. An air-or-oxygen or ACVPU
# value speaks for 8 h after it was charted (D8); uncharted or expired it is assumed — air, Alert —
# and listed in `assumed`, which does not make the score partial (D7). Without `now` nothing ages.

FIVE = dict(RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=70, TEMPERATURE=37.0)


def _aged(ages: dict, **values):
    """A state measured at T0, except each signal in `ages` ({code: how long before T0})."""
    st = PatientState("bed-9")
    for code, value in values.items():
        at = T0 - ages.get(code, timedelta(0))
        st.ingest(Observation("bed-9", SignalCode[code], value, "u", at, "dev"))
    return st


def test_a_stale_vital_scores_nothing_and_makes_the_score_partial():
    # SBP 88 would score 3; measured 61 min before `now` it is outside its 1 h window.
    r = news2.score(_aged({"SBP": timedelta(minutes=61)}, **{**FIVE, "SBP": 88}), T0)
    assert r.breakdown["systolic_bp"] == 0
    assert r.stale == ["systolic_bp"]
    assert r.missing == []
    assert r.partial is True
    assert (r.total, r.red_param) == (0, False)


def test_a_vital_never_measured_stays_missing_not_stale():
    r = news2.score(_aged({"SBP": timedelta(minutes=61)}, RESP_RATE=16, SBP=120), T0)
    assert r.missing == ["spo2", "pulse", "temperature"]
    assert r.stale == ["systolic_bp"]


@pytest.mark.parametrize("code,name,age,stale", [
    ("RESP_RATE", "respiration_rate", timedelta(minutes=60), False),
    ("RESP_RATE", "respiration_rate", timedelta(minutes=60, seconds=1), True),
    ("HEART_RATE", "pulse", timedelta(minutes=60), False),
    ("HEART_RATE", "pulse", timedelta(minutes=60, seconds=1), True),
    ("TEMPERATURE", "temperature", timedelta(hours=1, minutes=59), False),
    ("TEMPERATURE", "temperature", timedelta(hours=2), False),
    ("TEMPERATURE", "temperature", timedelta(hours=2, seconds=1), True),
])
def test_an_age_equal_to_the_window_is_still_fresh(code, name, age, stale):
    r = news2.score(_aged({code: age}, **FIVE), T0)
    assert (name in r.stale) is stale
    assert r.stale == ([name] if stale else [])


def test_a_reading_stamped_after_now_is_never_stale():
    r = news2.score(_aged({"SBP": -timedelta(hours=3)}, **{**FIVE, "SBP": 88}), T0)
    assert r.stale == [] and r.breakdown["systolic_bp"] == 3


def test_without_now_nothing_ages():
    st = _aged({"SBP": timedelta(hours=4), "SUPPLEMENTAL_OXYGEN": timedelta(hours=9)},
               **{**FIVE, "SBP": 88}, SUPPLEMENTAL_OXYGEN=1.0)
    r = news2.score(st)
    assert r.stale == [] and r.breakdown["systolic_bp"] == 3
    assert r.breakdown["air_or_oxygen"] == 2 and r.assumed == ["consciousness"]


def test_measured_at_and_fresh_until_name_all_seven_inputs():
    st = _aged({"TEMPERATURE": timedelta(minutes=30)}, **FIVE, SUPPLEMENTAL_OXYGEN=1.0)
    r = news2.score(st, T0)
    assert list(r.measured_at) == list(r.breakdown) == list(r.fresh_until)
    assert r.measured_at["temperature"] == T0 - timedelta(minutes=30)
    assert r.fresh_until["temperature"] == T0 + timedelta(minutes=90)     # its 2 h window
    assert r.fresh_until["pulse"] == T0 + timedelta(hours=1)
    assert r.fresh_until["air_or_oxygen"] == T0 + timedelta(hours=8)
    assert (r.measured_at["consciousness"], r.fresh_until["consciousness"]) == (None, None)


@pytest.mark.parametrize("age,points,assumed", [
    (timedelta(hours=7, minutes=59), 2, []),
    (timedelta(hours=8), 2, []),
    (timedelta(hours=8, minutes=1), 0, ["air_or_oxygen"]),
])
def test_charted_oxygen_speaks_for_eight_hours_then_air_is_assumed_again(age, points, assumed):
    st = _aged({"SUPPLEMENTAL_OXYGEN": age}, **FIVE, SUPPLEMENTAL_OXYGEN=1.0, ACVPU=0)
    r = news2.score(st, T0)
    assert r.breakdown["air_or_oxygen"] == points
    assert r.assumed == assumed
    assert r.partial is False


def test_an_acvpu_charted_nine_hours_ago_is_assumed_alert():
    st = _aged({"ACVPU": timedelta(hours=9)}, **FIVE, ACVPU=3, SUPPLEMENTAL_OXYGEN=0)
    r = news2.score(st, T0)
    assert r.breakdown["consciousness"] == 0
    assert r.assumed == ["consciousness"]
    assert (r.partial, r.red_param) == (False, False)


def test_the_alert_scores_what_the_board_scores():
    # D6: SBP 88 four hours old would be a single red parameter; judged at `now` it is out.
    st = _aged({"SBP": timedelta(hours=4)}, **{**FIVE, "SBP": 88})
    assert news2.evaluate(st, T0) == []
    assert [f.kind for f in news2.evaluate(st)] == ["news2"]     # without `now`, as before


def test_the_partial_note_names_a_stale_vital_with_the_missing_ones():
    [f] = news2.evaluate(_aged({"SBP": timedelta(hours=4)}, RESP_RATE=28, SBP=120), T0)
    assert "partial NEWS2: SpO2, systolic BP, pulse, temperature not recently recorded" in f.reasoning


def test_the_alert_says_what_it_assumed_and_is_not_partial_for_it():
    [f] = news2.evaluate(_state(**{**FIVE, "RESP_RATE": 28}), T0)
    assert f.reasoning.endswith(
        " Assumed, nothing current charted: supplemental oxygen as room air, consciousness as Alert.")
    assert "partial" not in f.reasoning.lower()


def test_the_recency_note_says_the_stale_value_is_not_in_the_score():
    [f] = news2.evaluate(_aged({"SBP": timedelta(hours=4)}, RESP_RATE=28, SBP=88), T0)
    assert (" Data recency: systolic BP older than the expected refresh window; "
            "not counted in the score.") in f.reasoning
    assert f.summary.startswith("NEWS2 3 ")      # RR 28's 3: the stale SBP 88's 3 is not in it


def test_the_reasoning_names_every_input_by_one_label():
    # Review of G2-A2 Task 1: the notes said "systolic_bp" next to the recency note's "systolic BP".
    # Every note now uses the label the recency note uses; none uses a breakdown key.
    st = _aged({"SBP": timedelta(hours=4)}, RESP_RATE=28, SPO2=91, SBP=88, SUPPLEMENTAL_OXYGEN=1.0)
    [f] = news2.evaluate(st, T0)
    assert "Contributing: resp rate 3, SpO2 3, supplemental oxygen 2." in f.reasoning
    assert "partial NEWS2: systolic BP, pulse, temperature not recently recorded" in f.reasoning
    assert "Data recency: systolic BP " in f.reasoning
    assert f.reasoning.endswith(" Assumed, nothing current charted: consciousness as Alert.")
    for key in ("respiration_rate", "spo2", "systolic_bp", "air_or_oxygen"):
        assert key not in f.reasoning
    assert set(news2.INPUT_LABEL) == set(news2.score(st, T0).breakdown)
```

**Edit** `homunculus-engine/tests/rules/test_staleness_structured.py` — replace:
```python
    assert "recency" in n.reasoning.lower()

```
with:
```python
    assert "recency" in n.reasoning.lower()
    # G2-A2 (D6): the four-hour-old pressure is out of the total — RR's 3 alone still fires it (a
    # single parameter at the maximum) — and the score says it is partial for it.
    assert n.summary.startswith("NEWS2 3 ")
    assert "partial NEWS2: SpO2, systolic BP, pulse, temperature" in n.reasoning

```

**Edit** `homunculus-engine/tests/test_pipeline.py` — replace:
```python
from datetime import datetime, timezone, timedelta
```
with:
```python
from dataclasses import replace
from datetime import datetime, timezone, timedelta

import pytest

```

**Edit** `homunculus-engine/tests/test_pipeline.py` — replace:
```python
    assert {"septic_shock", "antibiotic_overdue"} <= _kinds(eng)
    assert eng.recognized_at("bed-3") == T0
```
with:
```python
    assert {"septic_shock", "antibiotic_overdue"} <= _kinds(eng)
    assert eng.recognized_at("bed-3") == T0


# --- G2-A2 (D6): the alert judges NEWS2 at the reading's own `now`, as the board does -------------

def test_a_pressure_four_hours_old_does_not_raise_a_new_news2_alert():
    # Kept by X9: staleness may withhold a NEW alert. The pressure is delivered four hours after it
    # was measured, so it is stale at the only `now` it is judged at, and no alert was running for
    # it to hold. (One that was running is held: the X9 tests below.)
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                 # 3 points, a single red parameter — measured at T0
    assert eng.ingest(o, now=T0 + timedelta(minutes=240)) == [], "out of the total at +4 h"
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    assert eng.ingest(o, now=o.timestamp) == [], "a fresh normal pulse does not bring it in"


def test_the_patient_relative_layer_judges_the_same_instant():
    # RR 26 inside the patient's charted 24-28 is chronic; the four-hour-old SBP 88 is no
    # contributor at `now`, so every point left is explained and the alert is downgraded. Judged
    # without `now`, the old pressure read as an acute contributor and kept the alert alarming.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.RESP_RATE: BaselineRange(24, 28)}))
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 26, minute=240)]:
        eng.ingest(o, now=o.timestamp)
    [alert] = eng.active_alerts("bed-3")
    assert (alert.kind, alert.severity, alert.downgraded) == ("news2", "low", True)


# --- G2-A2 (X9, X9b): a stale input may withhold a NEWS2 alert but cannot end a running one -------
#
# The bridge posts a vitals set one reading at a time, every reading stamped with the set's time.
# Judged at each reading, the first readings of a set taken more than an hour after the last saw the
# rest stale, fell below the band and ended the alert, which the next reading raised again as a new
# episode — a new nurse notification, the acknowledgement gone. A running alert the score at `now`
# no longer reaches is now held while a vital is stale, and says what it is held on. It keeps its
# last score (X9b) — re-scored on the stale readings it climbed a band on a value hours old — or
# steps down, never up, to the lower band its stale values still reach at their last reading
# (X9d); within one band it keeps its number. It ends when no vital is stale and the score is below
# the band, or when even the stale values, counted at their last reading, no longer reach the band
# (X9c). An expired chart holds like a stale vital (X11, the last tests here), and a hold has an
# end (X12, the section below). Synthetic values throughout.

_SPOT_CHECK = [(SignalCode.HEART_RATE, 105), (SignalCode.RESP_RATE, 22), (SignalCode.SPO2, 95),
               (SignalCode.SBP, 105), (SignalCode.TEMPERATURE, 38.5)]     # NEWS2 1+2+1+1+1 = 6


def _news2(eng, patient="bed-3"):
    return {a.kind: a for a in eng.active_alerts(patient)}.get("news2")


_HELD_ON = ["resp rate, SpO2, systolic BP ", "SpO2, systolic BP ", "systolic BP "]


@pytest.mark.parametrize("second_set,numbers,held", [
    # The same set again. From the SpO2 on the score at `now` reaches the band by itself — partial,
    # the pressure still stale — and that live score is the alert.
    (_SPOT_CHECK, ["6", "6", "5", "6", "6"], 2),
    # A better pulse first (1 point to 0). Re-scored on the stale readings the alert dropped to 5 on
    # the pulse alone; kept as last scored it reads 6 until the fresh score reaches the band, at 5.
    ([(SignalCode.HEART_RATE, 85)] + _SPOT_CHECK[1:], ["6", "6", "6", "5", "5"], 3),
], ids=["same-set", "better-pulse"])
def test_a_vitals_set_posted_one_reading_at_a_time_neither_ends_nor_re_scores_the_running_alert(
        second_set, numbers, held):
    eng = Engine()
    for code, value in _SPOT_CHECK:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert before.summary.startswith("NEWS2 6 ")
    seen = []
    for code, value in second_set:                    # the next set, 75 minutes later
        o = _obs(code, value, minute=75)
        eng.ingest(o, now=o.timestamp)
        alert = _news2(eng)
        assert alert is not None, f"news2 ended on the {code.name} reading of the second set"
        seen.append(alert)
    # The temperature's window is 2 h, so the first set's 38.5 still counts at +75 min.
    assert [a.summary.split()[1] for a in seen] == numbers
    assert {(a.severity, a.urgency) for a in seen} == {("moderate", "soon")}
    for alert, held_on in zip(seen[:held], _HELD_ON):
        assert "Held while inputs are stale: " + held_on in alert.clinical_reasoning
        assert alert.clinical_reasoning.count("Held while inputs are stale") == 1
        assert alert.clinical_reasoning.startswith(before.clinical_reasoning)
        assert replace(alert, clinical_reasoning=before.clinical_reasoning,
                       stale_inputs=before.stale_inputs) == before, "kept as it was last scored"
    assert seen[0].stale_inputs == ["resp rate", "SpO2", "systolic BP"]
    assert all("Held" not in a.clinical_reasoning for a in seen[held:])
    last = seen[-1]
    assert "partial" not in last.clinical_reasoning and last.stale_inputs == []


def test_a_held_alert_does_not_climb_on_a_stale_value():
    # Re-scored on each input's last reading (X9) this alert went to NEWS2 7, high risk, immediate —
    # a nurse notification and an escalation clock — on the fresh temperature plus a pressure 70
    # minutes old, while the score at `now` was 4. Kept as last scored (X9b), it does not move.
    eng = Engine()
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 22),
              _obs(SignalCode.HEART_RATE, 105)]:                             # 3 + 2 + 1 = 6
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert (before.summary.split()[1], before.severity, before.urgency) == ("6", "moderate", "soon")
    for code, value in [(SignalCode.RESP_RATE, 22), (SignalCode.HEART_RATE, 105),
                        (SignalCode.TEMPERATURE, 38.5)]:                     # fresh, one at a time
        o = _obs(code, value, minute=70)
        eng.ingest(o, now=o.timestamp)
        held = _news2(eng)
        assert (held.summary, held.severity, held.urgency) == (before.summary, "moderate", "soon"), \
            f"on the {code.name} reading"
        assert "Held while inputs are stale: systolic BP" in held.clinical_reasoning
    assert held.stale_inputs == ["systolic BP"]


def test_a_running_news2_alert_is_held_on_a_stale_pressure_until_a_fresh_one_scores_below_the_band():
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                      # 3 points, a single red parameter, at T0
    eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert held is not None, "a four-hour-old pressure cannot end the alert it raised"
    assert held.summary.startswith("NEWS2 3 "), "kept as last scored"
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    assert held.stale_inputs == ["systolic BP"]
    o = _obs(SignalCode.SBP, 120, minute=241)
    assert eng.ingest(o, now=o.timestamp) == []
    assert _news2(eng) is None, "a fresh pressure scoring nothing ends it"


def test_a_held_alert_ends_when_its_driver_is_normal_though_another_vital_is_stale():
    # X9c: the pulse that raised the alert is normal again and the pressure is stale. Counting the
    # pressure at its last reading (1 point) the score is 1, below the band: the patient has
    # improved even on the stale values, so there is nothing left to hold.
    eng = Engine()
    for o in [_obs(SignalCode.HEART_RATE, 140), _obs(SignalCode.SBP, 105)]:   # 3 + 1: a red pulse
        eng.ingest(o, now=o.timestamp)
    assert _news2(eng).summary.startswith("NEWS2 4 ")
    o = _obs(SignalCode.HEART_RATE, 80, minute=75)    # the pressure is stale by now
    assert eng.ingest(o, now=o.timestamp) == []
    assert _news2(eng) is None


def test_a_held_alert_ends_on_the_later_reading_that_takes_even_its_stale_values_below_the_band():
    eng = Engine()
    for code, value in _SPOT_CHECK:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    seen = []
    for code, value in [(SignalCode.HEART_RATE, 70), (SignalCode.RESP_RATE, 16),
                        (SignalCode.SPO2, 98), (SignalCode.SBP, 120),
                        (SignalCode.TEMPERATURE, 37.0)]:   # a normal set, 75 minutes later
        o = _obs(code, value, minute=75)
        eng.ingest(o, now=o.timestamp)
        seen.append(_news2(eng))
    # The pulse alone: counting the stale resp rate, SpO2 and pressure at their last reading the
    # score is 5, still a band — held, as last scored (6, not 5). The resp rate too: 3, below the
    # band — it ends there, though the SpO2 and the pressure are still stale.
    assert seen[0].summary == before.summary
    assert "Held while inputs are stale: resp rate, SpO2, systolic BP " in seen[0].clinical_reasoning
    assert seen[1:] == [None, None, None, None]


def test_a_held_alert_steps_down_to_the_band_its_stale_values_reach_and_never_back_up():
    # X9d. Kept as last scored, this "NEWS2 8, immediate" stayed — escalating — for as long as
    # nobody measured the pressure again, though on the pressure's last reading the score was 6,
    # then 3. A held alert is never above the band its stale values reach: it steps down to it.
    # Within one band it keeps its number (X9b: no dip inside a set).
    eng = Engine()
    for o in [_obs(SignalCode.RESP_RATE, 25), _obs(SignalCode.HEART_RATE, 120),
              _obs(SignalCode.SBP, 88)]:                                       # 3 + 2 + 3 = 8
        eng.ingest(o, now=o.timestamp)
    assert (_news2(eng).severity, _news2(eng).urgency) == ("high", "immediate")
    seen = []
    for code, value in [(SignalCode.HEART_RATE, 70), (SignalCode.RESP_RATE, 16),
                        (SignalCode.SPO2, 98), (SignalCode.TEMPERATURE, 37.0)]:   # no pressure
        o = _obs(code, value, minute=75)
        eng.ingest(o, now=o.timestamp)
        seen.append(_news2(eng))
    # The pulse: on the stale resp rate and pressure the score is 6, a band below — it steps down.
    # The resp rate: 3, the pressure a single parameter at 3 — the same band, so it stays at 6.
    assert [(a.summary.split()[1], a.severity, a.urgency) for a in seen] == [("6", "moderate", "soon")] * 4
    assert "Held while inputs are stale: resp rate, systolic BP " in seen[0].clinical_reasoning
    assert "Held while inputs are stale: systolic BP " in seen[-1].clinical_reasoning
    assert all(a.clinical_reasoning.count("Held while inputs are stale") == 1 for a in seen)


def test_a_held_alert_steps_down_to_the_downgrade_its_stale_values_earn():
    # The band is judged after the patient-relative layer, on the stale values at their last
    # reading: the resp rate is normal again and the stale pressure is inside its charted range.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.SBP: BaselineRange(85, 95)}))
    for o in [_obs(SignalCode.RESP_RATE, 22), _obs(SignalCode.SBP, 88)]:      # 2 + 3, RR acute
        eng.ingest(o, now=o.timestamp)
    assert (_news2(eng).severity, _news2(eng).downgraded) == ("moderate", False)
    o = _obs(SignalCode.RESP_RATE, 16, minute=75)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert (held.summary.split()[1], held.severity, held.urgency, held.downgraded) == \
        ("3", "low", "routine", True)
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning


def test_a_hold_after_a_fresh_alert_freezes_the_fresh_one():
    # A hold, then a fresh score that reaches the band (the alert again), then a hold again: the
    # second hold keeps the fresh alert, not the one the first hold kept.
    eng = Engine()
    for code, value in _SPOT_CHECK:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)                                   # NEWS2 6
    for code, value in _SPOT_CHECK[:3]:
        o = _obs(code, value, minute=75)
        eng.ingest(o, now=o.timestamp)       # held 6, held 6, then the fresh partial 5
    fresh = _news2(eng)
    assert fresh.summary.startswith("NEWS2 5 ") and "Held" not in fresh.clinical_reasoning
    o = _obs(SignalCode.HEART_RATE, 105, minute=140)                   # everything else stale
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert held.summary == fresh.summary and "Held while inputs are stale" in held.clinical_reasoning


def test_the_held_note_lists_the_longest_stale_vital_first():
    eng = Engine()
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 22, minute=30)]:   # 3, then 5
        eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.HEART_RATE, 70, minute=100)      # the pressure 100 min old, the RR 70
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert "Held while inputs are stale: systolic BP, resp rate " in held.clinical_reasoning
    assert held.stale_inputs == ["systolic BP", "resp rate"]


def test_a_back_dated_reading_cannot_undo_the_hold_or_raise_news2_on_a_stale_value():
    # X9e. The doors judge a reading at its own time, never past the wall clock (X10). Stamped 25
    # minutes in the past, a reading was judged at that past instant, where the later readings are
    # fresh and the pressure, stale at the wall clock, was not yet: NEWS2 jumped to 7, immediate.
    # NEWS2 is judged no earlier than this patient's last NEWS2 judgement.
    eng = Engine()
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 22),
              _obs(SignalCode.HEART_RATE, 105)]:                               # 3 + 2 + 1 = 6
        eng.ingest(o, now=o.timestamp)
    for code, value in [(SignalCode.RESP_RATE, 22), (SignalCode.HEART_RATE, 105)]:
        o = _obs(code, value, minute=70)
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert "Held while inputs are stale: systolic BP " in before.clinical_reasoning
    late = _obs(SignalCode.TEMPERATURE, 38.5, minute=45)   # arrives at +70, stamped 25 min earlier
    eng.ingest(late, now=late.timestamp)                   # the doors' clamp: min(stamp, wall)
    held = _news2(eng)
    assert (held.summary, held.severity, held.urgency) == (before.summary, "moderate", "soon")
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    fresh = _obs(SignalCode.SBP, 88, minute=71)            # a pressure measured now
    eng.ingest(fresh, now=fresh.timestamp)
    alert = _news2(eng)
    assert (alert.summary.split()[1], alert.severity, alert.urgency) == ("7", "high", "immediate"), \
        "a fresh 7 is the alert, as before"
    assert "Held" not in alert.clinical_reasoning


def test_a_held_alert_is_still_downgraded_by_the_baseline_that_explains_it():
    # Kept as last scored, the held alert keeps the downgrade it was scored with: the stale pressure
    # inside its charted range still explains it. Judged again at `now` the pressure would be no
    # contributor, nothing would be explained, and a chronic alert would start alarming because its
    # one input went stale.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.SBP: BaselineRange(85, 95)}))
    o = _obs(SignalCode.SBP, 88)
    eng.ingest(o, now=o.timestamp)
    assert (_news2(eng).severity, _news2(eng).downgraded) == ("low", True)
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    assert (held.severity, held.urgency, held.downgraded) == ("low", "routine", True)
    assert "systolic BP 88 within charted baseline 85-95" in held.chronic_context


def test_a_held_alert_driven_by_a_stale_pressure_outside_its_baseline_is_not_downgraded():
    # The other side of the same judgement. Judged again at `now` the stale pressure would be no
    # contributor, the pulse inside its charted range would explain every point left, and the held
    # alert would be downgraded on the strength of the one input that is as expected.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.HEART_RATE: BaselineRange(100, 115),
                                                       SignalCode.SBP: BaselineRange(110, 130)}))
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.HEART_RATE, 105)]:    # 3 + 1: a red pressure
        eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.HEART_RATE, 105, minute=75)
    alerts = eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    assert (held.severity, held.urgency, held.downgraded) == ("moderate", "soon", False)
    assert held.chronic_context.startswith("Acute contributor(s): ")
    assert [a.kind for a in alerts].count("acute_change") == 1, "the hold adds no second one"


def test_an_expired_oxygen_chart_holds_the_running_alert_as_a_stale_vital_does():
    # X11. A charted oxygen past its 8 h is assumed air (D8). Counted only as a stale vital was, the
    # expiry ended this alert once the vitals were fresh — nobody had re-charted the oxygen, and the
    # alert it raised was gone. An expired chart now holds the running alert like a stale vital.
    eng = Engine()
    for o in [_obs(SignalCode.SUPPLEMENTAL_OXYGEN, 1.0), _obs(SignalCode.RESP_RATE, 22),
              _obs(SignalCode.HEART_RATE, 105)]:                                # 2 + 2 + 1 = 5
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert before.summary.startswith("NEWS2 5 ")
    o = _obs(SignalCode.RESP_RATE, 22, minute=485)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert ("Held while inputs are stale: pulse older than the expected refresh window; "
            "supplemental oxygen charted more than 8 h ago. ") in held.clinical_reasoning
    assert held.summary == before.summary
    assert held.stale_inputs == ["pulse", "supplemental oxygen"]
    o = _obs(SignalCode.HEART_RATE, 105, minute=486)   # every vital fresh; the oxygen not charted
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert held is not None, "resp rate 2 + pulse 1, the oxygen assumed air, is 3: held, not ended"
    assert (held.summary, held.severity, held.urgency) == (before.summary, "moderate", "soon")
    assert ("Held while inputs are stale: supplemental oxygen charted more than 8 h ago. "
            in held.clinical_reasoning)
    assert held.stale_inputs == ["supplemental oxygen"]
    o = _obs(SignalCode.SUPPLEMENTAL_OXYGEN, 0.0, minute=487)    # charted again: room air
    assert eng.ingest(o, now=o.timestamp) == []
    assert _news2(eng) is None, "a fresh chart that scores below the band ends it"


def test_an_expired_oxygen_and_acvpu_hold_a_news2_7_and_it_steps_down_as_each_is_charted_again():
    # X11 with X9d. Oxygen and V charted at one assessment raise NEWS2 7, immediate. At 8 h both
    # expire together: the score at `now` is the resp rate's 2, below the band, and the alert ended.
    # Held now — at the 7 its charts still reach — and stepped down, never up, as each is charted.
    eng = Engine()
    for o in [_obs(SignalCode.SUPPLEMENTAL_OXYGEN, 1.0), _obs(SignalCode.ACVPU, 2.0),
              _obs(SignalCode.RESP_RATE, 22)]:                                  # 2 + 3 + 2 = 7
        eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.RESP_RATE, 22, minute=480)     # the charts exactly 8 h old: still current
    eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert (before.summary.split()[1], before.severity, before.urgency) == \
        ("7", "high", "immediate")
    o = _obs(SignalCode.RESP_RATE, 22, minute=481)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert held is not None, "the expiry does not end it"
    assert (held.summary, held.severity, held.urgency) == (before.summary, "high", "immediate")
    assert ("Held while inputs are stale: supplemental oxygen, consciousness charted more than "
            "8 h ago. ") in held.clinical_reasoning
    assert held.stale_inputs == ["supplemental oxygen", "consciousness"]
    o = _obs(SignalCode.SUPPLEMENTAL_OXYGEN, 0.0, minute=482)    # room air; the V still expired
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert (held.summary.split()[1], held.severity, held.urgency) == ("5", "moderate", "soon"), \
        "on the V's last reading the score is 2 + 3 = 5: a band lower"
    assert "Held while inputs are stale: consciousness charted more than 8 h ago. " in \
        held.clinical_reasoning
    o = _obs(SignalCode.ACVPU, 0.0, minute=483)                  # Alert
    assert eng.ingest(o, now=o.timestamp) == []
    assert _news2(eng) is None


def test_an_expired_u_holds_the_red_parameter_alert_it_raised():
    # X11. A U is a single parameter scoring 3. Expired, it was assumed Alert and the fresh, normal
    # vitals ended the alert — though nobody had charted the patient awake.
    eng = Engine()
    for o in [_obs(SignalCode.ACVPU, 4.0), _obs(SignalCode.RESP_RATE, 16, minute=450),
              _obs(SignalCode.HEART_RATE, 70, minute=450)]:
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert (before.summary.split()[1], before.severity, before.urgency) == ("3", "moderate", "soon")
    for code, value in [(SignalCode.RESP_RATE, 16), (SignalCode.HEART_RATE, 70)]:
        o = _obs(code, value, minute=481)
        eng.ingest(o, now=o.timestamp)
        held = _news2(eng)
        assert held is not None, f"ended on the {code.name} reading"
        assert (held.summary, held.severity, held.urgency) == (before.summary, "moderate", "soon")
        assert "Held while inputs are stale: consciousness charted more than 8 h ago. " in \
            held.clinical_reasoning
        assert held.stale_inputs == ["consciousness"]


# --- G2-A2 (X12): a hold has an end ---------------------------------------------------------------
#
# One pressure of 88, then two days of normal, fresh vitals and no new pressure: "NEWS2 3, held" for
# ever beside a card that read 0. A stale input keeps the hold for at most HOLD_MAX_S, 8 h (one
# shift) past its window; the alert ends at the first evaluation after that.

_BOUND = "or when they have not been re-measured within 8 h of going stale."


def _normal_vitals(eng, start, stop, every=30):
    """A normal resp rate and pulse every `every` minutes in [start, stop]; the NEWS2 alert after
    each evaluation, by the minute it was judged at."""
    seen = {}
    for minute in range(start, stop + 1, every):
        for code, value in [(SignalCode.RESP_RATE, 16), (SignalCode.HEART_RATE, 72)]:
            o = _obs(code, value, minute=minute)
            eng.ingest(o, now=o.timestamp)
        seen[minute] = _news2(eng)
    return seen


def test_a_held_alert_ends_after_its_stale_input_has_gone_8_h_without_a_new_reading():
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                      # 3 points, a single red parameter, at T0
    eng.ingest(o, now=o.timestamp)
    assert _news2(eng).summary.startswith("NEWS2 3 ")
    seen = _normal_vitals(eng, 30, 48 * 60)
    # The pressure is stale after 1 h; at +9 h it has been stale for exactly 8 h: still held.
    assert all(seen[m] is not None for m in range(30, 541, 30)), "held through its first 8 h stale"
    assert all(seen[m] is None for m in range(570, 48 * 60 + 1, 30)), \
        "ended at the first evaluation after 8 h stale, and not raised again on the old value"
    assert "Held while inputs are stale: systolic BP " in seen[540].clinical_reasoning
    assert seen[540].clinical_reasoning.endswith(_BOUND)


def test_a_pressure_re_measured_within_8_h_keeps_the_hold_going_from_its_new_reading():
    # Inside the bound the X9 behaviour is unchanged: a new reading of 88 at +5 h is the alert
    # again, stale from +6 h, and held until 8 h after that.
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)
    eng.ingest(o, now=o.timestamp)
    seen = _normal_vitals(eng, 30, 270)
    o = _obs(SignalCode.SBP, 88, minute=300)
    eng.ingest(o, now=o.timestamp)
    seen[300] = _news2(eng)
    assert "Held" not in seen[300].clinical_reasoning, "a fresh 88 is the alert, not a hold"
    seen.update(_normal_vitals(eng, 330, 960))
    assert all(seen[m] is not None for m in range(30, 841, 30)), "held to 8 h past +6 h"
    assert "Held while inputs are stale: systolic BP " in seen[840].clinical_reasoning
    assert all(seen[m] is None for m in range(870, 961, 30)), "ended 8 h after it went stale"


def test_the_bound_is_on_the_input_that_keeps_the_hold_not_on_any_stale_input():
    # The pressure keeps this hold. A pulse of 95 (1 point) went stale at +8 h, but on its own it
    # does not reach the band: once the pressure is past its 8 h the hold ends, the pulse's own
    # staleness notwithstanding.
    eng = Engine()
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.HEART_RATE, 95, minute=420)]:   # 3, then 4
        eng.ingest(o, now=o.timestamp)
    seen = {}
    for minute in (480, 540, 570):
        o = _obs(SignalCode.RESP_RATE, 16, minute=minute)
        eng.ingest(o, now=o.timestamp)
        seen[minute] = _news2(eng)
    assert "Held while inputs are stale: systolic BP " in seen[480].clinical_reasoning
    assert "systolic BP, pulse " in seen[540].clinical_reasoning, "both stale, the pressure 8 h"
    assert seen[570] is None, "the pressure is past its 8 h; the stale pulse scores 1"


def test_an_expired_chart_holds_for_8_h_past_its_shift():
    eng = Engine()
    for o in [_obs(SignalCode.SUPPLEMENTAL_OXYGEN, 1.0), _obs(SignalCode.RESP_RATE, 22),
              _obs(SignalCode.HEART_RATE, 105)]:                                # 2 + 2 + 1 = 5
        eng.ingest(o, now=o.timestamp)
    seen = {}
    for minute in range(30, 1021, 30):
        for code, value in [(SignalCode.RESP_RATE, 22), (SignalCode.HEART_RATE, 105)]:
            o = _obs(code, value, minute=minute)
            eng.ingest(o, now=o.timestamp)
        seen[minute] = _news2(eng)
    assert all(seen[m] is None for m in range(990, 1021, 30)), "16 h after the chart: ended"
    assert "supplemental oxygen charted more than 8 h ago" in seen[960].clinical_reasoning
    assert seen[960].clinical_reasoning.endswith(_BOUND)
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py 2>&1 | tail -1
```

Expected: `44 failed, 85 passed in …` — `score()` takes no `now` (`TypeError: score() takes 1 positional argument but 2 were given`) and `News2Result` has no `stale` or `assumed`; the notes name the breakdown's keys (`Contributing: respiration_rate 3, spo2 3, …`) and the recency note does not say the value is out of the score; through the engine the base scores the stale pressure itself, so no reasoning says `Held while inputs are stale`, a four-hour-old SBP 88 still raises NEWS2 ("out of the total at +4 h"), the downgrade test sees `('news2', 'moderate', False)`, the held number never steps down, and the bound tests find the alert still there ("ended at the first evaluation after 8 h stale, and not raised again on the old value", "16 h after the chart: ended"). `test_a_held_alert_ends_when_its_driver_is_normal_though_another_vital_is_stale` passes already — the base never holds — and guards X9c's end.

- [ ] **Step 3: The score**

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
from dataclasses import dataclass, field

```
with:
```python
from dataclasses import dataclass, field
from datetime import datetime, timedelta

```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
_CORE_VITALS = ("respiration_rate", "spo2", "systolic_bp", "pulse", "temperature")


@dataclass(frozen=True)
```
with:
```python
_CORE_VITALS = ("respiration_rate", "spo2", "systolic_bp", "pulse", "temperature")

# The seven inputs by the names score() puts in its breakdown, and the signal each reads (G2-A2):
# the five vitals, then the two a clinician charts.
_INPUT_SIGNAL: dict[str, SignalCode] = {
    "respiration_rate": SignalCode.RESP_RATE, "spo2": SignalCode.SPO2,
    "systolic_bp": SignalCode.SBP, "pulse": SignalCode.HEART_RATE,
    "temperature": SignalCode.TEMPERATURE,
    "air_or_oxygen": SignalCode.SUPPLEMENTAL_OXYGEN, "consciousness": SignalCode.ACVPU,
}


@dataclass(frozen=True)
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    red_param: bool = False        # any single parameter scored the maximum 3

```
with:
```python
    red_param: bool = False        # any single parameter scored the maximum 3
    # G2-A2 (D1, D4, D7). `stale`: core vitals whose last reading is older than its window at
    # `now`, scored 0 like a missing one. `assumed`: air-or-oxygen and consciousness scored as air
    # and Alert because nothing current is charted — not partial. `measured_at`: when each of the
    # seven inputs was last read, None if never; `fresh_until`: that instant plus the input's
    # window, None if never — in the past for a stale or expired input.
    stale: list[str] = field(default_factory=list)
    assumed: list[str] = field(default_factory=list)
    measured_at: dict[str, datetime | None] = field(default_factory=dict)
    fresh_until: dict[str, datetime | None] = field(default_factory=dict)

```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
        return bool(self.missing)


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def score(state: PatientState) -> News2Result:
```
with:
```python
        # A stale vital is as absent from the total as a missing one (G2-A2, D1): either way the
        # aggregate can only understate.
        return bool(self.missing or self.stale)


def score(state: PatientState, now: datetime | None = None) -> News2Result:
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    'missing' when absent, so a partial aggregate is never shown as complete.
    """
```
with:
```python
    'missing' when absent, so a partial aggregate is never shown as complete.

    G2-A2. With `now`, a reading speaks for the patient only inside its window (D1): a vital older
    than its `_NEWS2_FRESHNESS` window scores 0 and is listed in `stale`, so the score is partial;
    an air-or-oxygen or ACVPU value charted more than `_CHARTED_FRESHNESS` ago is assumed again
    (D8). Every default is listed in `assumed` and does not make the score partial (D7). An age
    equal to the window is still fresh, and a reading stamped after `now` never ages. Without
    `now` nothing ages (D2): the trend charts read what each value scores, not its share of the
    total. `measured_at` and `fresh_until` name all seven inputs either way (D4).
    """
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python

    def core(name: str, code: SignalCode, fn) -> None:
        v = _val(state, code)
```
with:
```python
    stale: list[str] = []
    assumed: list[str] = []
    measured_at: dict[str, datetime | None] = {}
    fresh_until: dict[str, datetime | None] = {}

    def latest(name: str, window: timedelta) -> tuple[float | None, bool]:
        """The input's last value (None if never), and whether it is older than `window` at `now`."""
        obs = state.latest(_INPUT_SIGNAL[name])
        measured_at[name] = None if obs is None else obs.timestamp
        fresh_until[name] = None if obs is None else obs.timestamp + window
        if obs is None:
            return None, False
        return obs.value, now is not None and now - obs.timestamp > window

    def core(name: str, fn) -> None:
        v, aged = latest(name, _NEWS2_FRESHNESS[_INPUT_SIGNAL[name]])
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
            missing.append(name)
        else:
```
with:
```python
            missing.append(name)
        elif aged:
            breakdown[name] = 0
            stale.append(name)
        else:
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    core("respiration_rate", SignalCode.RESP_RATE, resp_rate_points)
    core("spo2", SignalCode.SPO2, spo2_scale1_points)
    core("systolic_bp", SignalCode.SBP, systolic_bp_points)
    core("pulse", SignalCode.HEART_RATE, pulse_points)
    core("temperature", SignalCode.TEMPERATURE, temperature_points)

    breakdown["air_or_oxygen"] = air_or_oxygen_points(
        on_oxygen=(_val(state, SignalCode.SUPPLEMENTAL_OXYGEN) or 0.0) >= 1.0
    )
    breakdown["consciousness"] = consciousness_points(_val(state, SignalCode.ACVPU) or 0.0)
```
with:
```python
    def charted(name: str) -> float:
        v, aged = latest(name, _CHARTED_FRESHNESS[_INPUT_SIGNAL[name]])
        if v is None or aged:
            assumed.append(name)
            return 0.0
        return v

    core("respiration_rate", resp_rate_points)
    core("spo2", spo2_scale1_points)
    core("systolic_bp", systolic_bp_points)
    core("pulse", pulse_points)
    core("temperature", temperature_points)

    breakdown["air_or_oxygen"] = air_or_oxygen_points(on_oxygen=charted("air_or_oxygen") >= 1.0)
    breakdown["consciousness"] = consciousness_points(charted("consciousness"))
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    return News2Result(total=total, breakdown=breakdown, missing=missing, red_param=red_param)
```
with:
```python
    return News2Result(total=total, breakdown=breakdown, missing=missing, red_param=red_param,
                       stale=stale, assumed=assumed, measured_at=measured_at,
                       fresh_until=fresh_until)
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
from datetime import datetime, timedelta  # noqa: E402

```
with:
```python
# Since G2-A2 (D1) a vital older than its window leaves the total (`score(state, now)`).
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
}
_VITAL_LABEL: dict[SignalCode, str] = {
```
with:
```python
}
# The two inputs a clinician charts and no monitor sends (G2-A2, D8): a charted oxygen or ACVPU
# speaks for one nursing shift, then the input is assumed again (air, Alert) and says so.
# Operational defaults like the windows above, not clinical claims. The clock runs from the
# observation's own time — the chart's `recorded_at`.
_CHARTED_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.SUPPLEMENTAL_OXYGEN: timedelta(hours=8), SignalCode.ACVPU: timedelta(hours=8),
}
_VITAL_LABEL: dict[SignalCode, str] = {
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}


```
with:
```python
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}
#: How the reasoning names each of the seven inputs, keyed by the names `score()` puts in its
#: breakdown: the vitals as the recency note (and `stale_inputs`) names them, the two charted inputs
#: as the patient-relative notes do. One word per input in every note, a held alert's (pipeline,
#: G2-A2 X9) included; a breakdown key is never shown.
INPUT_LABEL: dict[str, str] = {
    **{name: _VITAL_LABEL[_INPUT_SIGNAL[name]] for name in _CORE_VITALS},
    "air_or_oxygen": "supplemental oxygen", "consciousness": "consciousness",
}
# What an assumed input was scored as, in the alert's reasoning (G2-A2, D7).
_ASSUMED_AS: dict[str, str] = {"air_or_oxygen": "room air", "consciousness": "Alert"}


```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    result = score(state)
```
with:
```python
    # The board's score, judged at the same instant (G2-A2, D6): a stale vital can no longer lift
    # the alert into a band the card's total does not reach — one NEWS2, one number.
    result = score(state, now)
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
        f"{name} {pts}" for name, pts in result.breakdown.items() if pts > 0
```
with:
```python
        f"{INPUT_LABEL[name]} {pts}" for name, pts in result.breakdown.items() if pts > 0
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
        partial_note = (
            f" This is a partial NEWS2: {', '.join(result.missing)} not recently recorded, "
```
with:
```python
        # Missing and stale alike, in breakdown order (G2-A2, X1): neither is in the total.
        absent = [INPUT_LABEL[name] for name in result.breakdown
                  if name in result.missing or name in result.stale]
        partial_note = (
            f" This is a partial NEWS2: {', '.join(absent)} not recently recorded, "
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
        stale_note = (f" Data recency: {', '.join(stale)} older than the expected refresh window; "
                      f"interpret the score with that in mind.")
```
with:
```python
        # Since G2-A2 (D1) a stale vital scores 0: the note says it is out, not to be borne in mind.
        stale_note = (f" Data recency: {', '.join(stale)} older than the expected refresh window; "
                      f"not counted in the score.")
    assumed_note = ""
    if result.assumed:
        # G2-A2 (D7): an assumption is said out loud, and is not counted as partial.
        assumed_note = (" Assumed, nothing current charted: "
                        + ", ".join(f"{INPUT_LABEL[name]} as {_ASSUMED_AS[name]}"
                                    for name in result.assumed) + ".")
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
        f"{partial_note}{stale_note}"
```
with:
```python
        f"{partial_note}{stale_note}{assumed_note}"
```

- [ ] **Step 4: The patient-relative layer at the same instant (D6)**

**Edit** `homunculus-engine/src/homunculus/rules/patient_relative.py` — replace:
```python
from dataclasses import replace

from homunculus.canonical import SignalCode
```
with:
```python
from dataclasses import replace
from datetime import datetime

from homunculus.canonical import SignalCode
```

**Edit** `homunculus-engine/src/homunculus/rules/patient_relative.py` — replace:
```python
def apply(findings: list[Finding], state: PatientState,
          profile: PatientProfile | None) -> list[Finding]:
    """Adjust population findings against the patient's baseline and append acute-change findings.
    A patient with no profile is left exactly as the population rules produced them."""
    if profile is None:
        return findings

    result = news2.score(state)
```
with:
```python
def apply(findings: list[Finding], state: PatientState,
          profile: PatientProfile | None, now: datetime | None = None) -> list[Finding]:
    """Adjust population findings against the patient's baseline and append acute-change findings.
    A patient with no profile is left exactly as the population rules produced them.

    `now` is the instant `news2.evaluate` judged the score at (G2-A2, D6): a vital that has gone
    stale is no contributor here either, as it is none in the total the finding reports."""
    if profile is None:
        return findings

    result = news2.score(state, now)
```

- [ ] **Step 5: The engine — one instant per patient (X9e), and the hold (X9–X12)**

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
from datetime import datetime
```
with:
```python
from datetime import datetime, timedelta
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
ANCHOR_RESTORE_S = 900


class Engine:
```
with:
```python
ANCHOR_RESTORE_S = 900

#: How long past its window a stale NEWS2 input can keep a running alert held (G2-A2, X12): one
#: nursing shift. A held alert waits for the input to be measured again; one pressure of 88 and
#: then two days of normal vitals, the pressure never re-taken, read "NEWS2 3, held" beside a card
#: at 0 for ever. Past this a stale reading no longer counts toward the hold — the alert ends at
#: the next evaluation unless another input, stale for less, still reaches the band on its own.
#: Runs from when the input went stale (its `fresh_until`), a vital's window or a chart's shift.
#: An operational default like the windows themselves, not a clinical claim.
HOLD_MAX_S = 8 * 3600


def _level(alert: Alert) -> tuple[Severity, Urgency]:
    """How loud an alert is — the order a held NEWS2 may step down in, never up (G2-A2, X9d)."""
    return Severity[alert.severity.upper()], Urgency[alert.urgency.upper()]


class Engine:
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        self._alerts: dict[str, dict[str, Alert]] = {}   # patient -> kind -> alert
        self._profiles: dict[str, PatientProfile] = {}
```
with:
```python
        self._alerts: dict[str, dict[str, Alert]] = {}   # patient -> kind -> alert
        # G2-A2 X9b: patient -> the NEWS2 alert a running hold keeps, as it was last scored.
        self._held_news2_alert: dict[str, Alert] = {}
        # G2-A2 X9e: patient -> the latest instant NEWS2 was judged at; it never goes back.
        self._news2_judged_at: dict[str, datetime] = {}
        self._profiles: dict[str, PatientProfile] = {}
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        findings += news2.evaluate(state, now)
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation.
        findings = patient_relative.apply(findings, state, profile)
```
with:
```python
        # NEWS2 — the rule, the patient-relative layer and the hold — is judged no earlier than this
        # patient's last NEWS2 judgement (G2-A2, X9e). The doors judge a reading at its own time,
        # never past the wall clock (X10); a reading stamped in the past was judged at that past
        # instant, where every later reading is fresh and a stale one not yet stale, and a vital
        # stale at the wall clock lifted NEWS2 again — or ended a hold. `now` is unchanged for
        # everything else: the antibiotic anchor, sepsis and shock, the model.
        judge_at = max(now, self._news2_judged_at.get(obs.patient_id, now))
        self._news2_judged_at[obs.patient_id] = judge_at
        news2_findings = news2.evaluate(state, judge_at)
        findings += news2_findings
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation. At the same
        # instant NEWS2 was judged at (G2-A2, D6).
        findings = patient_relative.apply(findings, state, profile, judge_at)
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        # The bucket IS this evaluation (G2-A1, D1): exactly the kinds the rules produced for this
        # reading. A kind they did not produce has stopped firing and is gone — no quiet time, no
        # hysteresis. What the API keeps of one (a critical nobody acknowledged) is the API's
        # business (api/alert_lifecycle.py), not the engine's.
        self._alerts[obs.patient_id] = {a.kind: a for a in alerts}
        return alerts
```
with:
```python
        # Staleness — a vital past its window, a chart past its shift (X11) — may withhold a new
        # NEWS2 alert but cannot end a running one (G2-A2, X9, X9b).
        held = self._held_news2(obs.patient_id, bool(news2_findings), state, profile, judge_at)
        if held is not None:
            alerts.append(held)
        # The bucket IS this evaluation (G2-A1, D1): exactly the kinds the rules produced for this
        # reading. A kind they did not produce has stopped firing and is gone — no quiet time, no
        # hysteresis — except a NEWS2 held while an input is stale (G2-A2, X9b, X9c, X11), which
        # goes with the first evaluation that has none stale and is below the band, or whose stale
        # values at their last reading are below it too — a reading counted for at most HOLD_MAX_S
        # past its window (X12). What the API keeps of one (a
        # critical nobody acknowledged) is the API's business (api/alert_lifecycle.py), not the
        # engine's.
        self._alerts[obs.patient_id] = {a.kind: a for a in alerts}
        return alerts

    def _held_news2(self, patient_id: str, fired: bool, state: PatientState,
                    profile: PatientProfile | None, now: datetime) -> Alert | None:
        """The running NEWS2 alert, held, when this evaluation's NEWS2 (`fired`) produced none while
        a vital is stale or a chart expired at `now` (G2-A2, X9, X9b, X9c, X9d, X11). None — the
        alert ends — when it fired, when none was running, when nothing is stale or expired (the
        score at `now` is below the band on current inputs; a vital never measured still leaves it
        partial, as it always did), or when even the stale values, counted at their last reading
        for at most HOLD_MAX_S past their window (X12), no longer reach a band.

        The bridge posts a vitals set one reading at a time, every reading stamped with the set's
        time. Judged at each, the first readings of a set taken more than a window after the last
        saw the rest stale, fell below the band and ended the alert, and the next reading raised it
        again as a new episode: a new nurse notification, the acknowledgement gone. So a running
        alert (the bucket, before this evaluation replaces it) is held while a vital is stale. It is
        kept as it was last scored — total, severity, urgency, downgrade — and says what it is held
        on (X9b): re-scored on the stale readings (X9) it could climb a band, to "immediate" and a
        nurse notification, on a value hours old. The score on the stale values at their last
        reading — "ageless" — ends a hold when it is below the band (X9c: a pulse back to normal
        beside a stale pressure scoring 1 is an improvement even on the stale values), and is a
        floor the held alert never sits above (X9d): when its band, after the patient-relative
        layer, is lower than the kept alert's, that ageless alert is kept from then on. It steps
        down, never up, and within one band keeps its number, so a set arriving reading by reading
        does not move it. A fresh score that reaches a band is the alert again, a lower one
        included. A stale input still never raises a new alert (D6), and a feed that stops entirely
        keeps the held alert, as before G2-A2.

        A charted oxygen or ACVPU past its shift is scored as air and Alert at `now` (D8) and held
        on like a stale vital (X11). Before, its expiry ended the alert an "on oxygen" or a U had
        raised, though nobody had charted the patient off oxygen or awake. The ageless score counts
        the chart at its last value, as it does a stale reading, and the held note names it with
        the shift it outlived. Charted again it is current, and room air or Alert below the band
        ends the alert.

        A hold has an end (X12). The ageless score counts a stale reading only while it has been
        stale for at most HOLD_MAX_S (8 h, a shift) — it is judged HOLD_MAX_S before `now` — so an
        input never measured again stops holding the alert, and the alert ends at the first
        evaluation after that unless another input, stale for less, reaches the band on its own.
        The bound is on the input that keeps the hold, not on any stale one: a pulse that went
        stale since does not stretch a pressure's hold. The held note says so in its last sentence.

        A profile charted during a hold reaches the held alert only through that floor: a baseline
        that now downgrades it steps it down, but one withdrawn mid-hold, which would raise it,
        reaches it only when the hold ends.
        """
        kept = self._held_news2_alert.pop(patient_id, None)    # spent unless the hold goes on
        running = self._alerts.get(patient_id, {}).get("news2")
        if fired or running is None:
            return None
        at_now = news2.score(state, now)
        # X11: a chart past its shift, assumed again though it was charted, holds as a stale vital.
        expired = [name for name in at_now.assumed if at_now.measured_at[name] is not None]
        # X12: the stale values at their last reading while stale for at most HOLD_MAX_S. Judged
        # HOLD_MAX_S ago, a reading inside its window then has been stale for no longer than that
        # now; an older one is out, and one stamped after that instant never ages.
        bound = now - timedelta(seconds=HOLD_MAX_S)
        ageless = news2.evaluate(state, bound)
        if not (at_now.stale or expired) or not ageless:
            return None
        kept = running if kept is None else kept
        # Judged as the kept alert was — after the patient-relative layer — on the ageless score.
        [floor] = [to_alert(f, patient_id)
                   for f in patient_relative.apply(ageless, state, profile, bound)
                   if f.kind == "news2"]
        if _level(floor) < _level(kept):
            kept = floor
        self._held_news2_alert[patient_id] = kept

        def oldest_first(names: list[str]) -> list[str]:    # longest stale first, as the recency note
            return sorted(names, key=lambda name: at_now.measured_at[name])

        vitals = [news2.INPUT_LABEL[name] for name in oldest_first(at_now.stale)]
        on = [f"{', '.join(vitals)} older than the expected refresh window"] if vitals else []
        charts: dict[str, list[str]] = {}       # X11: the expired charts, by the shift outlived
        for name in oldest_first(expired):
            shift = (at_now.fresh_until[name] - at_now.measured_at[name]) / timedelta(hours=1)
            charts.setdefault(f"{shift:g}", []).append(news2.INPUT_LABEL[name])
        on += [f"{', '.join(labels)} charted more than {shift} h ago"
               for shift, labels in charts.items()]
        note = (f" Held while inputs are stale: {'; '.join(on)}. The alert was already firing, "
                f"so it is not raised on a stale value: it keeps its last score, or the lower band "
                f"its stale values still reach at their last reading. It ends when those readings "
                f"are below the band, or when they have not been re-measured within "
                f"{HOLD_MAX_S // 3600:g} h of going stale.")
        stale = vitals + [label for labels in charts.values() for label in labels]
        return replace(kept, clinical_reasoning=kept.clinical_reasoning + note, stale_inputs=stale)
```

- [ ] **Step 6: Green, the neighbours, and the scenarios**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules tests/test_news2_bands.py tests/test_trends.py tests/test_trends_api.py tests/test_scenario_news2.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_api_patient_profile.py tests/test_api_board_news2.py tests/test_alert_lifecycle.py 2>&1 | tail -1
```

Expected: `129 passed in …`; then `325 passed, 3 warnings in …` (the scenarios among them, unchanged — see the cadence note above). The whole no-DB suite after this task: `2315 passed, 650 skipped`.

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/rules/news2.py homunculus-engine/src/homunculus/rules/patient_relative.py homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/rules/test_news2.py homunculus-engine/tests/rules/test_staleness_structured.py homunculus-engine/tests/test_pipeline.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `news2.py CR=311 LF=311`, `patient_relative.py CR=146 LF=146`, `pipeline.py CR=273 LF=273`, `test_news2.py CR=302 LF=302`, `test_staleness_structured.py CR=56 LF=56`, `test_pipeline.py CR=806 LF=806`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/rules/news2.py homunculus-engine/src/homunculus/rules/patient_relative.py homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/rules/test_news2.py homunculus-engine/tests/rules/test_staleness_structured.py homunculus-engine/tests/test_pipeline.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(engine): NEWS2 counts a reading only inside its window, says what it assumed, and a stale input cannot end a running alert (G2-A2)

score(state, now) gives a vital older than its window (1 h; temperature 2 h)
0 points and lists it in `stale`; the score is then partial (D1). An
air-or-oxygen or ACVPU value speaks for 8 h after it was charted (D8);
uncharted or expired it is assumed — air, Alert — and listed in `assumed`,
which does not make the score partial (D7). measured_at and fresh_until name
all seven inputs (D4). Without `now` nothing ages (D2). The NEWS2 alert and the
patient-relative layer judge the score at one per-patient instant that never
goes back (D6, X9e), so a stale vital can no longer lift the alert into a band
the card does not show; the partial note names a stale vital with the missing
ones (X1), every note names an input by one label, and the reasoning names the
assumptions. A running NEWS2 alert is held, not ended, while a vital is stale
or a chart expired (X9, X11): kept as last scored (X9b), ended when even its
stale values are below the band (X9c), stepped down — never up — to the band
they still reach (X9d), and for at most 8 h past the window of the input that
keeps it (X12).
On the branch: 8c726fd, ce436fb, b5925bb, e0f8687, 3a64e74, 6676d5f, 0948068 (engine), ecd5017, 64271db (a test comment).

red: 44 failed, 85 passed (score() took no `now`; News2Result had no
stale/assumed; the notes named breakdown keys; the base alert scored the stale
value itself, so nothing was held, stepped down or ended after 8 h)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 2: The board — judged at the wall clock, it names what is stale and assumed; a closing window is pushed; a reading is judged no later than the wall clock

**Done on the branch** as `cd2eaec` (the first version's Task 2, byte for byte; its body's red: `15 failed, 1 passed` — "patient_board() and board_snapshot() took no `now`; no `stale` on the board" — and `test_board_freshness.py`: "ImportError, no freshness_turned"), `d437600` (the Task 2 review and X10: `freshness_turned` takes `[since, until)` — the spec's "(since, now]" had the end wrong for a rule that counts an age equal to the window as fresh, so a window ending exactly at a cycle's `now` was never pushed; `since` is seeded when the app starts and kept per hospital, so the first cycle after a start pushes a window that closed since the start and a tenant whose republish fails does not hold the others back; the meds box and the republish are pinned to the board's instant by tests; both doors judge a reading at `min(its stamp, the wall clock)`), `ea236ef` (X10b: the replay judges at `min(the stamp, the row's write time)`; after a restart a reading stamped 30 minutes ahead had aged every other input to it — the ward's "NEWS2 8, immediate" came back held on three stale vitals and the antibiotic anchor moved 30 minutes on), the board half of `0948068` (X11, the final review: `news2.last_charted`; its body's red: "KeyError: 'last_charted' (6 tests)") and the two replay comments of `64271db` (`/clinical` and `/ingest/fhir` say the replay judges at `min(the stamp, the row's write time)`). The blocks below are that code: replayed onto Task 1 they give the branch's `board.py`, `test_api_board_news2.py`, `test_board_freshness.py`, `test_api_clinical.py` and `test_api_ingest.py` byte for byte, and `app.py`, `rehydrate.py` and `test_rehydrate.py` as Task 4 finds them. **`rehydrate.py` and `test_rehydrate.py` are edited again in Task 4** (the paged replay, branch order): X10b's test sits at the end of `test_rehydrate.py`, and Task 4 adds its tests above it.

Spec D3, D4, D5, with X2, X10, X10b and X11's board field. `patient_board(…, now=None)` and `board_snapshot(…, now=None)` judge the card at `now`, the wall clock unless the caller names one — never `obs.timestamp`, the rule's own time at ingest, at which a board would never age (D3). One instant serves the whole card: `_meds` gets the same `now`, which is what it already defaulted to (X2). `latest.news2` gains `stale`, `assumed`, `measured_at` and `fresh_until` — the stamps, never an age (D4) — and `last_charted` (X11): what the oxygen and the ACVPU were last charted as, whatever their age (oxygen 1 or 0, consciousness its ACVPU letter, None if never), so the pill can name an expired chart's value. `board.freshness_turned(state, since, until)` is the pure test: did one of the patient's seven `fresh_until` instants fall in `[since, until)` — fresh at `since`, stale at `until`? Consecutive cycles' intervals leave no gap and no overlap: each window end is pushed once. The escalation cycle (every 20 s) keeps each hospital's previous `now` and republishes, judged at its own `now`, each measured patient whose answer is yes; a hospital no cycle has reached yet counts from the app's start (the lifespan seeds it), and without a lifespan there is nothing to count from and nothing is republished; a patient the cycle already published for an escalation change is not sent twice, and that publish is judged at the cycle's `now` too (X2). The helper and its two call lines are marked `# G2-A2` (D15); they sit before the retention block Lane B's B1a edits (spec §8), whose sweep may send a second frame for a patient in one cycle (O14).

**The evaluation instant** (X10, X10b). `/ingest` and `/clinical` take one wall-clock instant per request and judge each reading at `min(its stamp, that instant)`: judged at a stamp in the future, every other input was aged to it. The audit row keeps the stamp. The replay (`rehydrate._replay_ingest`) judges at `min(the stamp, the row's write time)`, which stands for the door's wall clock to within the request, so a restart rebuilds the alerts the doors raised and the antibiotic anchor within a second of the live one.

**Files:**
- Modify: `homunculus-engine/tests/test_api_board_news2.py` (`_board` passes `now`; tests appended — the board, the meds box at the card's instant, `last_charted`)
- Create: `homunculus-engine/tests/test_board_freshness.py`
- Modify: `homunculus-engine/tests/test_api_clinical.py` (the class `TestTheEvaluationInstant`), `homunculus-engine/tests/test_api_ingest.py` (one test), `homunculus-engine/tests/test_rehydrate.py` (one test appended)
- Modify: `homunculus-engine/src/homunculus/api/board.py` (`_iso`, `_news2`, `_last_charted`, `freshness_turned`, `patient_board`, `board_snapshot`)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (an import; `freshness_since`, `freshness_started`, `_republish_turned`; the cycle; the lifespan's seed; the two doors' instant)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py` (the write time parsed once; `_replay_ingest` judges at `min(ts, written)`)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_api_board_news2.py` — replace:
```python
def _board(engine: Engine) -> dict:
    return patient_board(engine, "bed-1", AckStore())
```
with:
```python
def _board(engine: Engine, now: datetime = WHEN) -> dict:
    # G2-A2 (D3): the board judges freshness at `now`, the wall clock unless named; these
    # readings are stamped WHEN.
    return patient_board(engine, "bed-1", AckStore(), now=now)
```

**Edit** `homunculus-engine/tests/test_api_board_news2.py` — replace:
```python
        assert state.latest(code).value == value
```
with:
```python
        assert state.latest(code).value == value


# --- G2-A2: what the card is told about each input's age, and what was assumed -------------------

STALE_AT_61_MIN = ["respiration_rate", "spo2", "systolic_bp", "pulse"]


def test_a_vital_past_its_window_leaves_the_boards_total_and_is_named():
    news2 = _board(_engine(DETERIORATING), now=WHEN + timedelta(minutes=61))["latest"]["news2"]
    assert news2["stale"] == STALE_AT_61_MIN
    assert news2["total"] == 2                 # the temperature's 2 h window is still open
    assert (news2["partial"], news2["missing"]) == (True, [])
    assert sum(news2["breakdown"].values()) == news2["total"]


def test_the_board_sends_each_inputs_stamp_and_window_end_never_an_age():
    news2 = _board(_engine(DETERIORATING))["latest"]["news2"]
    names = ["respiration_rate", "spo2", "systolic_bp", "pulse", "temperature",
             "air_or_oxygen", "consciousness"]
    assert list(news2["measured_at"]) == list(news2["fresh_until"]) == names
    assert news2["measured_at"]["spo2"] == WHEN.isoformat()
    assert news2["fresh_until"]["spo2"] == (WHEN + timedelta(hours=1)).isoformat()
    assert news2["fresh_until"]["temperature"] == (WHEN + timedelta(hours=2)).isoformat()
    assert (news2["measured_at"]["air_or_oxygen"], news2["fresh_until"]["consciousness"]) == (None, None)
    assert news2["stale"] == []


def test_air_and_alert_are_assumed_on_the_board_and_the_breakdown_still_sums():
    news2 = _board(_engine(DETERIORATING))["latest"]["news2"]
    assert news2["assumed"] == ["air_or_oxygen", "consciousness"]
    assert news2["partial"] is False
    assert sum(news2["breakdown"].values()) == news2["total"] == 14


def test_the_board_names_what_each_charted_input_last_read_whatever_its_age():
    """X11: an expired chart is assumed again, and the card says what it last read — "room air
    (last charted: on oxygen, 9 h ago)". Oxygen as charted, 0 or 1; consciousness as its letter."""
    charted = {**DETERIORATING, SignalCode.SUPPLEMENTAL_OXYGEN: (1.0, ""),
               SignalCode.ACVPU: (4.0, "")}
    news2 = _board(_engine(charted), now=WHEN + timedelta(hours=9))["latest"]["news2"]
    assert news2["assumed"] == ["air_or_oxygen", "consciousness"]
    assert news2["last_charted"] == {"air_or_oxygen": 1, "consciousness": "U"}
    never = _board(_engine(DETERIORATING))["latest"]["news2"]
    assert never["last_charted"] == {"air_or_oxygen": None, "consciousness": None}


@pytest.mark.parametrize("ordinal,letter", [(0.0, "A"), (1.0, "C"), (2.0, "V"), (3.0, "P"),
                                            (4.0, "U")])
def test_a_charted_acvpu_is_named_by_its_letter(ordinal, letter):
    engine = _engine({SignalCode.ACVPU: (ordinal, ""), SignalCode.SUPPLEMENTAL_OXYGEN: (0.0, "")})
    assert _board(engine)["latest"]["news2"]["last_charted"] == \
        {"air_or_oxygen": 0, "consciousness": letter}


def test_a_board_built_without_now_judges_at_the_wall_clock(monkeypatch):
    """D3: `obs.timestamp` is the rule's own time at ingest; a board judged at it never ages."""
    import homunculus.api.board as board_module

    class Frozen(datetime):
        at = WHEN

        @classmethod
        def now(cls, tz=None):
            return cls.at

    engine = _engine(DETERIORATING)
    monkeypatch.setattr(board_module, "datetime", Frozen)
    Frozen.at = WHEN + timedelta(minutes=30)
    assert patient_board(engine, "bed-1", AckStore())["latest"]["news2"]["stale"] == []
    Frozen.at = WHEN + timedelta(minutes=61)
    assert patient_board(engine, "bed-1", AckStore())["latest"]["news2"]["stale"] == STALE_AT_61_MIN


def test_the_snapshot_judges_every_card_at_one_instant():
    from homunculus.api.board import board_snapshot
    [card] = board_snapshot(_engine(DETERIORATING), AckStore(), now=WHEN + timedelta(minutes=61))
    assert card["latest"]["news2"]["stale"] == STALE_AT_61_MIN


def test_the_meds_box_reads_the_antibiotic_clock_at_the_cards_instant():
    """X2: one instant for the whole card — the antibiotic clock as well as NEWS2, never the wall
    clock when the caller names a moment (Task 2 review)."""
    # Platelets 80 is SOFA 2 on its own; charting suspected infection then recognises sepsis.
    engine = _engine({SignalCode.PLATELETS: (80.0, "10^3/uL"),
                      SignalCode.SUSPECTED_INFECTION: (1.0, "")})
    assert engine.recognized_at("bed-1") == WHEN
    clock = _board(engine, now=WHEN + timedelta(minutes=25))["meds"]["antibiotic_clock"]
    assert (clock["elapsed_sec"], clock["remaining_sec"]) == (25 * 60, 35 * 60)
```

**Edit** `homunculus-engine/tests/test_api_clinical.py` — replace:
```python
        assert "antibiotic_due" not in given.json()["alerts"]

```
with:
```python
        assert "antibiotic_due" not in given.json()["alerts"]


class TestTheEvaluationInstant:
    """G2-A2 (X10): this door evaluates at min(recorded_at, wall clock), as /ingest does — a chart
    stamped in the future cannot age the readings beside it. The audit row keeps the stamp."""

    def test_a_chart_stamped_in_the_future_does_not_age_the_vitals(self, client):
        wall = datetime.now(timezone.utc)
        taken = (wall - timedelta(minutes=45)).isoformat()
        for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):     # NEWS2 9: high
            fhir = {"resourceType": "Observation",
                    "code": {"coding": [{"system": "x", "code": code}]},
                    "subject": {"reference": "Patient/bed-3"}, "effectiveDateTime": taken,
                    "valueQuantity": {"value": value, "unit": ""}}
            assert client.post("/ingest", json=fhir, headers=AUTH).status_code == 200
        ahead = wall + timedelta(minutes=30)
        r = _chart(client, "bed-3", [{"code": "weight_kg", "value": 78}], at=ahead)
        assert r.status_code == 200
        (board,) = client.get("/patients", headers=AUTH).json()["patients"]
        assert board["latest"]["news2"]["stale"] == []
        news2 = next(a for a in board["alerts"] if a["kind"] == "news2")
        assert (news2["severity"], news2["stale_inputs"]) == ("high", [])
        assert "Held while inputs are stale" not in news2["clinical_reasoning"]
        (row,) = [r for r in client.get("/audit", headers=AUTH).json()["records"]
                  if r["event_type"] == "chart"]
        assert row["payload"]["obs_ts"] == ahead.isoformat()

```

**Edit** `homunculus-engine/tests/test_api_ingest.py` — replace:
```python
# tests/test_api_ingest.py
from pathlib import Path
```
with:
```python
# tests/test_api_ingest.py
from datetime import datetime, timedelta, timezone
from pathlib import Path
```

**Edit** `homunculus-engine/tests/test_api_ingest.py` — replace:
```python

def test_an_ingest_row_that_fails_to_audit_does_not_take_a_critical_off_the_board():
```
with:
```python

def test_a_reading_stamped_in_the_future_does_not_age_the_others():
    """G2-A2 (X10): /ingest evaluates at min(observation time, wall clock). Judged at a heart rate
    stamped 30 min ahead, vitals taken 45 min ago would be 75 min old — stale — and the running
    NEWS2 alert held on them; at the wall clock they are fresh and it is scored as before. The
    audit row still carries the reading's own stamp: only the evaluation instant changes."""
    c = TestClient(create_app(TENANTS, run_escalation_loop=False))
    wall = datetime.now(timezone.utc)
    taken = (wall - timedelta(minutes=45)).isoformat()
    for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):     # NEWS2 9: high
        assert c.post("/ingest", json=_fhir(code, value, when=taken),
                      headers=_hdr("tok-hosp1")).status_code == 200
    ahead = wall + timedelta(minutes=30)
    r = c.post("/ingest", json=_fhir("heart_rate", 80, "/min", when=ahead.isoformat()),
               headers=_hdr("tok-hosp1"))
    assert r.status_code == 200
    (board,) = [b for b in c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
                if b["patient_id"] == "bed-3"]
    assert board["latest"]["news2"]["stale"] == []
    news2 = next(a for a in board["alerts"] if a["kind"] == "news2")
    assert (news2["severity"], news2["stale_inputs"]) == ("high", [])
    assert "Held while inputs are stale" not in news2["clinical_reasoning"]
    assert len(_rows(c, "news2", "first_seen")) == 1, "the running episode, not a new one"
    (row,) = _rows(c, "heart_rate", "ingest")
    assert row["payload"]["obs_ts"] == ahead.isoformat()


def test_an_ingest_row_that_fails_to_audit_does_not_take_a_critical_off_the_board():
```

**Edit** `homunculus-engine/tests/test_rehydrate.py` — replace:
```python
        "the latch is episode 3's: its own stamp, and no answer inherited from episode 2"
```
with:
```python
        "the latch is episode 3's: its own stamp, and no answer inherited from episode 2"


def test_a_reading_stamped_in_the_future_is_replayed_at_the_instant_the_door_judged_it():
    """G2-A2 (X10b). The doors judge a reading at its own stamp but never past the wall clock (X10);
    the replay judged it at its stamp. A device clock 30 minutes ahead, then a restart: the replay
    aged the resp rate, pulse and pressure to the future stamp, so the ward's NEWS2 8 came back
    held, and it moved the antibiotic anchor 30 minutes on. The replay judges at the earlier of the
    stamp and the row's write time — the door's wall clock, to within the request. Synthetic."""
    import json
    audit = InMemoryAuditLog()
    hdr = {"Authorization": "Bearer tok"}
    wall = datetime.now(timezone.utc)

    def boot():
        return TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit))

    def reading(client, code, value, at):
        fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
                "subject": {"reference": "Patient/bed-3"}, "effectiveDateTime": at.isoformat(),
                "valueQuantity": {"value": value, "unit": ""}}
        assert client.post("/ingest", json=fhir, headers=hdr).status_code == 200

    def board(client):
        return json.loads(json.dumps(next(b for b in client.get("/patients", headers=hdr).json()["patients"]
                                          if b["patient_id"] == "bed-3")))

    def alerts(b):
        return [{**a, "resolved_at": a["resolved_at"] is not None} for a in b["alerts"]]

    live = boot()
    for code, value in [("resp_rate", 25), ("heart_rate", 120), ("sbp", 88)] + _SHOCK[1:]:
        reading(live, code, value, wall - timedelta(minutes=50))          # NEWS2 8, and a shock
    reading(live, "suspected_infection", 1.0, wall + timedelta(minutes=30))   # a clock 30 min ahead
    before = board(live)
    news2 = next(a for a in before["alerts"] if a["kind"] == "news2")
    assert (news2["severity"], news2["urgency"]) == ("high", "immediate")
    assert "Held" not in news2["clinical_reasoning"]

    after = board(boot())                                                  # the restart
    assert alerts(after) == alerts(before)
    anchors = [datetime.fromisoformat(b["meds"]["antibiotic_clock"]["recognized_at"])
               for b in (before, after)]
    assert abs(anchors[1] - anchors[0]) < timedelta(seconds=1), "the row is written after the judgement"
```

**Write** `homunculus-engine/tests/test_board_freshness.py` (new file):
```python
"""G2-A2 (D5): when a NEWS2 input stops counting, the board is pushed again.

A reading's window closes with no frame to say so — a feed that stops is exactly when nothing else
arrives — so without a push the card would read fresh until a reload. `board.freshness_turned` is
the pure test the escalation cycle (every 20 s) asks of each measured patient: did one of its
`fresh_until` instants fall in [the previous cycle, this one) — fresh then, stale now? The board it
then publishes is judged at the cycle's own instant. A hospital's first cycle counts from the app's
start, so a window that closes before the first cycle is still pushed; one that closed before the
start is not: `/patients` on (re)connect is judged at its own moment.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.board import freshness_turned
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

WHEN = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)
TOKEN = {"Authorization": "Bearer tok"}
PATIENT = "G2A-1"   # synthetic


def _state(code: SignalCode, at: datetime) -> PatientState:
    st = PatientState(PATIENT)
    st.ingest(Observation(PATIENT, code, 1.0, "", at, "dev"))
    return st


def test_a_window_that_closes_inside_the_interval_has_turned():
    # [since, until): an age equal to the window is still fresh (rules/news2.py), so at `closes`
    # the reading still counts and it is stale only after — the cycle at `closes` has not seen it
    # turn, the next one has (Task 2 review).
    st = _state(SignalCode.SPO2, WHEN)                   # SpO2's window closes at WHEN + 1 h
    closes = WHEN + timedelta(hours=1)
    assert freshness_turned(st, closes - timedelta(seconds=20), closes) is False    # until is not
    assert freshness_turned(st, closes, closes + timedelta(seconds=20)) is True     # since is in
    assert freshness_turned(st, WHEN, closes - timedelta(seconds=1)) is False


def test_a_charted_oxygen_turns_at_eight_hours():
    st = _state(SignalCode.SUPPLEMENTAL_OXYGEN, WHEN)
    expires = WHEN + timedelta(hours=8)
    assert freshness_turned(st, expires - timedelta(seconds=20), expires) is False
    assert freshness_turned(st, expires, expires + timedelta(seconds=20)) is True
    assert freshness_turned(st, WHEN + timedelta(hours=1), WHEN + timedelta(hours=7)) is False


def test_a_patient_with_nothing_measured_never_turns():
    assert freshness_turned(PatientState(PATIENT), WHEN, WHEN + timedelta(days=1)) is False


def _ingest(client: TestClient, code: str, value: float, at: datetime,
            headers: dict = TOKEN) -> None:
    r = client.post("/ingest", headers=headers, json={
        "resourceType": "Observation", "code": {"coding": [{"code": code}]},
        "subject": {"reference": f"Patient/{PATIENT}"}, "effectiveDateTime": at.isoformat(),
        "valueQuantity": {"value": value, "unit": ""}})
    assert r.status_code == 200, r.text


def test_the_cycle_republishes_a_board_once_when_a_window_closes():
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)
        # Its 2 h window is open at the cycle below and long closed at the wall clock: a board
        # judged at the wall clock would name it stale too (X2, Task 2 review).
        _ingest(client, "temperature", 37.0, WHEN)
        queue = app.state.broadcaster.subscribe("h1")

        def cycle(at: datetime) -> None:
            client.portal.call(app.state.escalation_cycle, at)

        cycle(WHEN + timedelta(minutes=59, seconds=30))
        cycle(WHEN + timedelta(minutes=59, seconds=50))      # the window is still open
        assert queue.empty()
        cycle(WHEN + timedelta(hours=1, seconds=10))         # it closed at +1 h, in this interval
        board = queue.get_nowait()
        assert board["patient_id"] == PATIENT
        assert board["latest"]["news2"]["stale"] == ["spo2"]    # judged at the cycle's instant
        assert queue.empty()
        cycle(WHEN + timedelta(hours=1, seconds=30))         # nothing else closed
        assert queue.empty()


def test_the_first_cycle_after_a_start_pushes_a_window_that_closed_since_the_start():
    # The restart hole (Task 2 review): `since` is seeded when the app starts, so the first cycle
    # covers [start, first cycle) — a window closing in between is pushed, not left until a reload.
    before = datetime.now(timezone.utc)
    closes = before + timedelta(seconds=30)              # after the start, before the first cycle
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, closes - timedelta(hours=1))
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, closes + timedelta(seconds=30))
        assert queue.get_nowait()["latest"]["news2"]["stale"] == ["spo2"]
        assert queue.empty()


def test_the_first_cycle_after_a_start_does_not_push_a_window_that_closed_before_it():
    # `/patients` on (re)connect is judged after it: there is nothing to push.
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)                # closed at WHEN + 1 h, before the start
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, datetime.now(timezone.utc))
        assert queue.empty()


def test_a_tenant_whose_republish_fails_does_not_hold_back_the_others(monkeypatch):
    # `since` is kept per hospital and advanced after each one's republish (Task 2 review): with one
    # `since` for all, a tenant failing in its republish would leave every other tenant's window
    # ends to be pushed again, cycle after cycle, until it recovered.
    app = create_app({"tok": "h1", "tok2": "h2"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)                                        # h1, cycled first
        _ingest(client, "spo2", 97, WHEN, headers={"Authorization": "Bearer tok2"})
        queue, queue2 = (app.state.broadcaster.subscribe(h) for h in ("h1", "h2"))
        publish = app.state.broadcaster.publish
        failing = {"h2"}

        async def failing_for_h2(hospital: str, message: dict) -> None:
            if hospital in failing:
                raise RuntimeError("synthetic: h2's push fails")
            await publish(hospital, message)

        monkeypatch.setattr(app.state.broadcaster, "publish", failing_for_h2)

        def cycle(at: datetime) -> None:
            client.portal.call(app.state.escalation_cycle, at)

        cycle(WHEN + timedelta(minutes=59, seconds=50))
        with pytest.raises(RuntimeError):
            cycle(WHEN + timedelta(hours=1, seconds=10))     # both windows close; h2's push fails
        assert queue.get_nowait()["patient_id"] == PATIENT
        failing.clear()                                      # h2 recovers
        cycle(WHEN + timedelta(hours=1, seconds=30))
        assert queue.empty(), "h1's since moved on: its window end is not pushed a second time"
        assert queue2.get_nowait()["latest"]["news2"]["stale"] == ["spo2"], \
            "h2's since did not: the push it failed is made now"
        assert queue2.empty()


def test_a_patient_escalated_in_the_same_cycle_is_published_once_judged_at_the_cycle():
    # NEWS2 9 is HIGH and immediate; it escalates an hour after it was first seen (the wall clock),
    # in the cycle in which its readings' windows close. One frame, not two — and that frame is
    # judged at the cycle's instant too, so it already says the readings are stale (X2).
    start = datetime.now(timezone.utc)
    app = create_app({"tok": "h1"}, run_escalation_loop=False, escalate_after=timedelta(hours=1))
    with TestClient(app) as client:
        for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):
            _ingest(client, code, value, start)
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, start + timedelta(minutes=59, seconds=30))
        assert queue.empty()
        client.portal.call(app.state.escalation_cycle, start + timedelta(hours=1, seconds=10))
        board = queue.get_nowait()
        assert queue.empty(), "escalated and turned in one cycle: one frame"
        assert next(a for a in board["alerts"] if a["kind"] == "news2")["escalated"] is True
        assert board["latest"]["news2"]["stale"] == ["respiration_rate", "spo2", "systolic_bp"]
```

Then convert it to CRLF — the ground rules' one exception, touching only this file:

```bash
cd /c/tmp/g2a-a2
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_board_freshness.py
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_board_news2.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_rehydrate.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board_freshness.py 2>&1 | tail -1
```

Expected: `25 failed, 49 passed, 3 warnings in …` — `patient_board()` and `board_snapshot()` take no `now` (`TypeError: … got an unexpected keyword argument 'now'`, 21 tests: `_board` passes it now), the wall-clock test and the two doors' instant tests find no `stale` (`KeyError: 'stale'`), and the replay test's live board already carries the future stamp's damage (`assert 'Held' not in 'NEWS2 8 (hi…going stale.'` — the door judged the reading at its stamp, 30 minutes ahead); then `1 warning, 1 error in …` — the new file stops at its import (`ImportError: cannot import name 'freshness_turned' from 'homunculus.api.board'`). Run separately because a collection error stops the whole run.

- [ ] **Step 3: The board**

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
def _news2(state) -> dict:
```
with:
```python
def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.isoformat()


#: ACVPU's letters, by the ordinal the engine records (canonical.py: 0 = Alert … 4 = Unresponsive).
_ACVPU_LETTERS = "ACVPU"


def _last_charted(state) -> dict:
    """What the two charted NEWS2 inputs last read, whatever its age; None if never charted
    (G2-A2, X11). An expired chart is scored as air or Alert and named in `assumed`; the card then
    says what it last read, so «assumed: room air» does not hide that the patient was charted on
    oxygen. Oxygen as charted — 1 on oxygen, 0 room air, as the score reads it; consciousness as
    its ACVPU letter (an ordinal that is not a whole 0–4, which the door allows, as its number)."""
    oxygen = state.latest(SignalCode.SUPPLEMENTAL_OXYGEN)
    acvpu = state.latest(SignalCode.ACVPU)
    letter = None
    if acvpu is not None:
        v = acvpu.value
        letter = _ACVPU_LETTERS[int(v)] if v.is_integer() and 0 <= v <= 4 else f"{v:g}"
    return {"air_or_oxygen": None if oxygen is None else int(oxygen.value >= 1.0),
            "consciousness": letter}


def _news2(state, now: datetime) -> dict:
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
    """
    result = news2_score(state)
```
with:
```python

    G2-A2. Judged at `now` (D3): a vital past its window is out of the total and named in `stale`
    (D1); `assumed` names the inputs scored as air and Alert because nothing current is charted
    (D7). `measured_at` and `fresh_until` carry each of the seven inputs' last reading and the end
    of its window, ISO-8601 or None (D4). The API sends the stamp, never an age — an age baked into
    a payload is wrong a minute after it was published — and "too old" is `stale`, never a
    comparison the screen makes with `fresh_until`. `last_charted` is what the two charted inputs
    last read (X11), for the card to name beside an expired chart.
    """
    result = news2_score(state, now)
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
        "breakdown": dict(result.breakdown),
    }

```
with:
```python
        "breakdown": dict(result.breakdown),
        "stale": list(result.stale),
        "assumed": list(result.assumed),
        "measured_at": {name: _iso(at) for name, at in result.measured_at.items()},
        "fresh_until": {name: _iso(at) for name, at in result.fresh_until.items()},
        "last_charted": _last_charted(state),
    }


def freshness_turned(state, since: datetime, until: datetime) -> bool:
    """Whether one of this patient's NEWS2 inputs stopped counting in [since, until) — fresh at
    `since`, stale at `until`: a reading's window closed, or a charted value expired (G2-A2, D5).
    The rule counts an age equal to the window as fresh, so a window ending at `at` is stale only
    after `at`; the spec's "(since, now]" had that end wrong (Task 2 review). Consecutive cycles'
    intervals [t0, t1), [t1, t2) leave no gap and no overlap: each window end is pushed once.
    Pure: the escalation cycle asks it of every measured patient and republishes the board when
    the answer is yes, because nothing else would — a feed that stops is exactly when no further
    frame arrives."""
    return any(at is not None and since <= at < until
               for at in news2_score(state).fresh_until.values())

```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
                  bedmap: BedMap | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
```
with:
```python
                  bedmap: BedMap | None = None, now: datetime | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    # One instant for the whole card (G2-A2, D3, X2): NEWS2's freshness and the antibiotic clock
    # are judged at the wall clock unless the caller names a moment (the escalation cycle, tests).
    # Never `obs.timestamp`: that is the rule's own time at ingest, and a board judged at it would
    # never age.
    now = now or datetime.now(timezone.utc)
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
            "news2": _news2(state),
```
with:
```python
            "news2": _news2(state, now),
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
        "meds": _meds(engine, state, patient_id),
```
with:
```python
        "meds": _meds(engine, state, patient_id, now),
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
                   bedmap: BedMap | None = None) -> list[dict]:
    measured = engine.patient_ids()
    boards = [patient_board(engine, pid, store,
                            identity=identities.get(hospital, pid) if identities else None,
                            bedmap=bedmap)
```
with:
```python
                   bedmap: BedMap | None = None, now: datetime | None = None) -> list[dict]:
    measured = engine.patient_ids()
    now = now or datetime.now(timezone.utc)      # every card judged at one instant (G2-A2, D3)
    boards = [patient_board(engine, pid, store,
                            identity=identities.get(hospital, pid) if identities else None,
                            bedmap=bedmap, now=now)
```

- [ ] **Step 4: The cycle republishes what turned; the doors judge no later than the wall clock**

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
```
with:
```python
from homunculus.api.board import (
    board_snapshot, freshness_turned, identity_only_board, patient_board,
)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python

    async def _escalation_cycle(now: datetime) -> None:
```
with:
```python

    # G2-A2 (D5): each hospital's previous escalation-cycle `now`, advanced after that hospital's
    # republish, so a tenant failing in its own does not hold the others' back (Task 2 review).
    # A hospital no cycle has reached yet counts from the app's start, seeded by the lifespan: the
    # first cycle covers [start, first cycle), at worst one frame a fresh `/patients` already had.
    # Lane B's retention sweep right after the republish may send a second frame per cycle for a
    # patient (A2's O14).
    freshness_since: dict[str, datetime] = {}
    freshness_started: list[datetime | None] = [None]

    async def _republish_turned(hospital: str, engine: Engine, store: AckStore, now: datetime,
                                published: set[str]) -> None:
        """G2-A2 (D5): republish, judged at `now`, each measured patient one of whose NEWS2 inputs
        stopped counting since this hospital's previous cycle (`board.freshness_turned`). A
        reading's window closes with no frame to say so — a feed that stops is exactly when no
        further frame arrives — and without this the card would read fresh until a reload. Its
        first cycle counts from the app's start; without a lifespan there is nothing to count from
        and it republishes nothing. `published` are the patients this cycle has already sent."""
        since = freshness_since.get(hospital, freshness_started[0])
        if since is None:
            return
        for pid in engine.patient_ids():
            if pid not in published and freshness_turned(engine.state(pid), since, now):
                await broadcaster.publish(hospital, patient_board(
                    engine, pid, store, identity=identities.get(hospital, pid), bedmap=bedmap,
                    now=now))

    async def _escalation_cycle(now: datetime) -> None:
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
            newly = escalate(alerts, store.acks, store.clock_from, now, escalate_after)
            if newly != store.escalated:
```
with:
```python
            newly = escalate(alerts, store.acks, store.clock_from, now, escalate_after)
            changed: set[str] = set()
            if newly != store.escalated:
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
                    await broadcaster.publish(hospital, patient_board(
                        engine, pid, store, identity=identities.get(hospital, pid),
                        bedmap=bedmap))
```
with:
```python
                    # Judged at the cycle's instant, as the freshness republish below (G2-A2, X2).
                    await broadcaster.publish(hospital, patient_board(
                        engine, pid, store, identity=identities.get(hospital, pid),
                        bedmap=bedmap, now=now))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
                                                {"audience": note.audience, "trigger": note.trigger}))

```
with:
```python
                                                {"audience": note.audience, "trigger": note.trigger}))
            await _republish_turned(hospital, engine, store, now, changed)   # G2-A2 (D5)
            freshness_since[hospital] = now                                  # G2-A2 (D5)

```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
    async def lifespan(app: FastAPI):
        if on_startup_check is not None:
```
with:
```python
    async def lifespan(app: FastAPI):
        freshness_started[0] = datetime.now(timezone.utc)   # G2-A2 (D5): the first cycle's `since`
        if on_startup_check is not None:
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        store = _store(hospital)
        alerts: list = []
```
with:
```python
        store = _store(hospital)
        # One wall-clock instant per request, as in /ingest: each entry is judged at its charted
        # time but never past the wall clock (G2-A2, X10) — a `recorded_at` in the future would
        # age every other input to it. The audit row keeps the stamp; the replay judges at
        # min(the stamp, the row's write time) (rehydrate, X10b).
        now = datetime.now(timezone.utc)
        alerts: list = []
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
            alerts = engine.ingest(obs, now=obs.timestamp)
```
with:
```python
            alerts = engine.ingest(obs, now=min(obs.timestamp, now))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
            # fails from here on, an unacknowledged critical is still on the board. `charted` is
            # never empty (build_entries refuses that), so `now` is set for the stamps below.
            now = datetime.now(timezone.utc)
```
with:
```python
            # fails from here on, an unacknowledged critical is still on the board.
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        alerts = engine.ingest(obs, now=obs.timestamp)
```
with:
```python
        # One wall-clock instant per request. The rules judge at the reading's own time but never
        # past the wall clock (G2-A2, X10): judged at a stamp in the future, every other input
        # would be aged to it. The audit row keeps the stamp; the replay judges at min(the stamp,
        # the row's write time) (rehydrate, X10b).
        wall_now = datetime.now(timezone.utc)
        alerts = engine.ingest(obs, now=min(obs.timestamp, wall_now))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        wall_now = datetime.now(timezone.utc)
        cleared = sync_alerts(engine, store, obs.patient_id, wall_now)
```
with:
```python
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        cleared = sync_alerts(engine, store, obs.patient_id, wall_now)
```

- [ ] **Step 5: The replay judges where the door did (X10b)**

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
            if _replay_ingest(engine, rec):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, _written_at(rec))
```
with:
```python
            written = _written_at(rec)
            if _replay_ingest(engine, rec, written):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, written)
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
def _replay_ingest(engine: Engine, rec: AuditRecord) -> bool:
    """Replay one observation; False when its signal is unknown and it was skipped."""
```
with:
```python
def _replay_ingest(engine: Engine, rec: AuditRecord, written: datetime) -> bool:
    """Replay one observation; False when its signal is unknown and it was skipped.

    Judged where the door judged it (G2-A2, X10b): at the reading's own stamp, never past the wall
    clock (X10), with the row's write time standing for that wall clock, to within the request.
    Judged at a stamp in the future, as the replay did, every other input was aged to it — a NEWS2
    the ward saw firing came back held, and the antibiotic anchor moved to the future stamp."""
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
    engine.ingest(obs, now=ts)
```
with:
```python
    engine.ingest(obs, now=min(ts, written))
```

- [ ] **Step 6: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_board_news2.py tests/test_board_freshness.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_rehydrate.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board.py tests/test_api_ack.py tests/test_escalation_workflow.py tests/test_api_identity_ingest.py tests/test_api_notifications.py tests/test_first_seen_persistence.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py tests/test_api_board_bedmap.py tests/test_api_board_identity.py tests/test_api_audit.py tests/test_alert_lifecycle.py tests/test_trends_api.py 2>&1 | tail -1
```

Expected: `82 passed, 3 warnings in …`; then `137 passed, 14 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2338 passed, 650 skipped`.

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/tests/test_api_board_news2.py homunculus-engine/tests/test_board_freshness.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_rehydrate.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `board.py CR=356 LF=356`, `app.py CR=1222 LF=1222`, `rehydrate.py CR=120 LF=120`, `test_api_board_news2.py CR=205 LF=205`, `test_board_freshness.py CR=164 LF=164`, `test_api_clinical.py CR=342 LF=342`, `test_api_ingest.py CR=194 LF=194`, `test_rehydrate.py CR=279 LF=279`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/tests/test_api_board_news2.py homunculus-engine/tests/test_board_freshness.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_rehydrate.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): the board judges NEWS2 at the wall clock, names what is stale and assumed, is pushed when a window closes, and a reading is judged no later than the wall clock (G2-A2)

patient_board and board_snapshot take `now` and default to the wall clock,
never the reading's own time, at which a board never ages (D3); one instant
serves the whole card, the antibiotic clock included (X2). latest.news2 gains
stale, assumed, and each input's measured_at and fresh_until — the stamps,
never an age (D4) — and last_charted, what an expired chart last read (X11).
The escalation cycle republishes, judged at its own now, a measured patient
one of whose windows closed in [the hospital's previous cycle, now)
(board.freshness_turned), counting a first cycle from the app's start; a
patient already sent for an escalation change is sent once (D5). Both doors
judge a reading at min(its stamp, the wall clock) (X10), and the replay at
min(the stamp, the row's write time) (X10b), so a reading stamped in the
future ages nothing, live or after a restart.
On the branch: cd2eaec, d437600, ea236ef, 0948068 (board), 64271db (two comments).

red: 25 failed, 49 passed (patient_board() and board_snapshot() took no `now`;
no `stale` on the board; the doors judged a future stamp, so the replay test's
live NEWS2 8 was already held); test_board_freshness.py: ImportError, no
freshness_turned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 3: The dashboard — the card names each stale input with its age, and marks what was assumed

**Done on the branch** as `a8d97c6` (the first version's Task 3, byte for byte; its body's red: "Tests 4 failed | 142 passed (146) — no stale line, no «varsayıldı» pill"), `90b3ed9` (the Task 3 review: the «varsayıldı» pill wraps on a narrow bed card — `StatusPill` is `nowrap` and upper case and the card clips its overflow, so on a 290 px card the assumed consciousness, the very mark D10 asks for, was cut off — and its test reads the whole sentence, the screen-reader-only «heç qeyd edilməyib» and the hint included; the new import is lane-marked) and the dashboard half of `0948068` (X11, the final review: the pill names what an expired chart last read; its body's red: "no element «fərz edildi: otaq havası (son qeyd: oksigendə, 9 saat əvvəl), oyaq», «varsayıldı: oda havası (son kayıt: oksijende, 9 sa önce), uyanık (son kayıt: U, 9 sa önce)», «fərz edildi: oyaq (son qeyd: U, 9 saat əvvəl)»; tr news2.assumedLastValue undefined"). The blocks below are that code: replayed onto Task 2 they give the branch's ten dashboard files byte for byte.

Spec D10 (with X3, X4 and X11). `News2` (`live/screens/common/BoardState.jsx`) keeps the total, the partial pill and the red-parameter pill, and adds two things, both drawn only from what the engine sent: a visible line naming each `stale` input with its age — "köhnə məlumat: SpO2 · 2 saat əvvəl" (tr "eski veri: SpO2 · 2 sa önce") — and a neutral «fərz edildi» pill (tr «varsayıldı») naming the `assumed` inputs, which wraps (`!whitespace-normal`). An expired chart adds what it last read and when — "son qeyd: oksigendə, 9 saat əvvəl" (tr "son kayıt: oksijende, 9 sa önce"), "son qeyd: U, 9 saat əvvəl" — from the board's `last_charted` (X11: oxygen 1/0 in the reader's words, the ACVPU letter as the engine sent it); a payload without the value still shows the age, "son qeyd 9 saat əvvəl" (`assumedLast`, X3). A never-charted input says so to a screen reader. The age is `ageText(t, measured_at[name], nowMs)`: the server's stamp against the screen's corrected clock. `nowMs` is a prop, passed by the three screens that draw `News2` from the clock each already reads with `useBoardNow` — the bed card is rendered without a `BoardProvider` (its tests, and the card itself, take `nowMs` from the board screen), so `News2` cannot call the hook itself (X4). The screen never compares `fresh_until` with a clock: "too old" is the engine's `stale` (`freshness.js:3–9`). The 8 h figure is not on the screen. Eleven strings ×4 in `strings/news2.js` — the spec's seven, `assumedLast`, which carries the spec's own "son kayıt {age}" (X3), and X11's `assumedLastValue` and `chartedOxygen.{air,oxygen}`; the az, ru and en texts await a native reading (O1). `liveAdapters.js:67` passes `news2` through unchanged, so it is not touched. **`strings.test.js` gains one test** (X11, lane-marked `// G2-A2 X11`, beside Lane B's own): the owner's Turkish for the new keys, and the value and age placeholders in every language. No new az text equals its tr source, and every ru text has Cyrillic, so no reviewed entry is needed.

**Files:**
- Modify: `dashboard/src/live/i18n/strings/news2.js` (its header; eleven keys ×4)
- Modify: `dashboard/src/live/data/board.testutil.js` (the `news2` fixture's new keys, `last_charted` among them)
- Modify: `dashboard/src/live/screens/common/BoardState.jsx` (an import; `News2`)
- Modify: `dashboard/src/live/screens/beds/BedCard.jsx`, `dashboard/src/live/screens/beds/BedsScreen.jsx`, `dashboard/src/live/screens/patient/PatientScreen.jsx` (each passes its `nowMs`)
- Modify: `dashboard/src/live/screens/beds/BedCard.test.jsx`, `dashboard/src/live/screens/beds/BedsScreen.test.jsx`, `dashboard/src/live/screens/patient/PatientScreen.test.jsx` (tests appended), `dashboard/src/live/i18n/strings.test.js` (one test, X11)

- [ ] **Step 1: Write the failing tests**

**Edit** `dashboard/src/live/data/board.testutil.js` — replace:
```js
 *  number is the whole story. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {}, ...over,
```
with:
```js
 *  number is the whole story. G2-A2: `stale`, `assumed` and the stamps default to empty — a test
 *  that is about them states them. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {},
  stale: [], assumed: [], measured_at: {}, fresh_until: {},
  last_charted: { air_or_oxygen: null, consciousness: null }, ...over,
```

**Edit** `dashboard/src/live/i18n/strings.test.js` — replace:
```js

  it("names keys <namespace>.<key>, nested keys joined with dots", () => {
```
with:
```js

  // G2-A2 X11: an expired chart's pill names what it last read — «varsayıldı: oda havası (son kayıt:
  // oksijende, 9 sa önce)». The owner's Turkish, and the value and the age in every language.
  it("the assumed pill can name an expired chart's last value and its age, in every language", () => {
    expect(DICTIONARIES.tr["news2.assumedLastValue"]).toBe("son kayıt: {value}, {age}");
    expect(DICTIONARIES.tr["news2.chartedOxygen.oxygen"]).toBe("oksijende");
    expect(DICTIONARIES.tr["news2.chartedOxygen.air"]).toBe("oda havası");
    for (const lang of LANG_CODES) {
      expect(placeholders(DICTIONARIES[lang]["news2.assumedLastValue"]), lang).toEqual(["age", "value"]);
    }
  });

  it("names keys <namespace>.<key>, nested keys joined with dots", () => {
```

**Edit** `dashboard/src/live/screens/beds/BedCard.test.jsx` — replace:
```jsx
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });
  });

```
with:
```jsx
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });

    // G2-A2 (D10): the engine names what it left out of the total (`stale`) and what it scored as
    // room air and Alert (`assumed`). The card prints each stale input's age from the engine's
    // stamp (`measured_at`) and judges nothing itself.
    it("names a stale input with its age, from the engine's stamp", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ total: 4, partial: true, stale: ["spo2", "temperature"],
          measured_at: { spo2: ago(7200), temperature: ago(7500) } }),
      }));
      expect(screen.getByText("köhnə məlumat: SpO2 · 2 saat əvvəl, temperatur · 3 saat əvvəl")).toBeInTheDocument();
      expect(screen.getByText(/Pəncərəsini keçmiş ölçmə bala daxil edilmir/)).toBeInTheDocument();
    });

    it("marks the assumed inputs, and names an expired chart's last value and when it was made", () => {
      // X11: «assumed: room air» alone hid that the patient was last charted on oxygen.
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ assumed: ["air_or_oxygen", "consciousness"], measured_at: { air_or_oxygen: ago(9 * 3600) },
          last_charted: { air_or_oxygen: 1, consciousness: null } }),
      }));
      const pill = screen.getByText("fərz edildi: otaq havası (son qeyd: oksigendə, 9 saat əvvəl), oyaq");
      expect(screen.getByText("(heç qeyd edilməyib)")).toBeInTheDocument();   // consciousness, read out
      // The whole sentence as a reader gets it: the assumed values, the screen-reader-only «never
      // charted», and the hint that says why this is not a warning.
      expect(pill).toHaveTextContent(
        "fərz edildi: otaq havası (son qeyd: oksigendə, 9 saat əvvəl), oyaq (heç qeyd edilməyib) · "
        + "Cari qeyd yoxdur; bal bu girişi standart dəyərlə hesabladı və bunu qismən saymır.",
      );
      expect(pill).toHaveAttribute("data-tone", "neutral");
      // StatusPill is nowrap + uppercase and the bed card clips its overflow: on a 290 px card an
      // unwrapped pill cuts off the assumed consciousness, the very mark D10 asks for.
      expect(pill).toHaveClass("!whitespace-normal");
      expect(screen.queryByText("qismən")).toBeNull();                         // an assumption is not partial
    });

    it("names an expired ACVPU by its letter — in Turkish, the owner's wording", () => {
      localStorage.setItem("hmc.lang", "tr");
      try {
        card(entry("S-001", [], {
          at: measured(30),
          score: news2({ assumed: ["air_or_oxygen", "consciousness"],
            measured_at: { air_or_oxygen: ago(9 * 3600), consciousness: ago(9 * 3600) },
            last_charted: { air_or_oxygen: 1, consciousness: "U" } }),
        }));
        expect(screen.getByText(
          "varsayıldı: oda havası (son kayıt: oksijende, 9 sa önce), uyanık (son kayıt: U, 9 sa önce)",
        )).toBeInTheDocument();
      } finally {
        localStorage.removeItem("hmc.lang");
      }
    });

    it("an expired chart whose last value the payload lacks still says when it was made", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ assumed: ["air_or_oxygen"], measured_at: { air_or_oxygen: ago(9 * 3600) },
          last_charted: undefined }),
      }));
      expect(screen.getByText("fərz edildi: otaq havası (son qeyd 9 saat əvvəl)")).toBeInTheDocument();
    });

    it("says nothing more when nothing is stale or assumed", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 2 }) }));
      expect(screen.queryByText(/köhnə məlumat/)).toBeNull();
      expect(screen.queryByText(/fərz edildi/)).toBeNull();
    });
  });

```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.test.jsx` — replace:
```jsx
    it("keeps the chosen view in this browser", async () => {
```
with:
```jsx
    // G2-A2 (D10): the list's NEWS2 cell says what the card says, against the same clock.
    it("the list names a stale NEWS2 input with its age", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...CARD, score: news2({ total: 3, partial: true, stale: ["pulse"], measured_at: { pulse: ago(4000) } }),
      })]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      const row = screen.getByRole("table").querySelector("tbody tr");
      expect(within(row).getByText("köhnə məlumat: nəbz · 67 dəq əvvəl")).toBeInTheDocument();
    });

    it("keeps the chosen view in this browser", async () => {
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.test.jsx` — replace:
```jsx
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
    });
```
with:
```jsx
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
    });

    // G2-A2 (D10): the heading's NEWS2 says what the card says, against the screen's clock.
    it("names a stale NEWS2 input with its age and marks what the engine assumed", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL,
        score: news2({ total: 6, partial: true, stale: ["systolic_bp"], assumed: ["consciousness"],
          measured_at: { systolic_bp: ago(5400) } }),
      })]) });
      expect(screen.getByText("köhnə məlumat: sistolik AT · 90 dəq əvvəl")).toBeInTheDocument();
      expect(screen.getByText("fərz edildi: oyaq")).toBeInTheDocument();
    });

    // G2-A2 X11: an expired chart says what it last read, as the card does.
    it("names an expired chart's last value and its age", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL,
        score: news2({ total: 3, red_param: false, assumed: ["consciousness"],
          measured_at: { consciousness: ago(9 * 3600) },
          last_charted: { air_or_oxygen: 0, consciousness: "U" } }),
      })]) });
      expect(screen.getByText("fərz edildi: oyaq (son qeyd: U, 9 saat əvvəl)")).toBeInTheDocument();
    });
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
```

Expected: `      Tests  8 failed | 149 passed (157)` — the card draws neither the line nor the pill (`Unable to find an element with the text: köhnə məlumat: SpO2 · 2 saat əvvəl, temperatur · 3 saat əvvəl` / `fərz edildi: otaq havası (son qeyd: oksigendə, 9 saat əvvəl), oyaq`), nor do the list and the patient screen, and `news2.assumedLastValue` does not exist (`expected undefined to be 'son kayıt: {value}, {age}'`). "says nothing more when nothing is stale or assumed" passes already: it guards that nothing more is drawn.

- [ ] **Step 3: The strings, ×4**

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
// parameter names (news2.missing[]).
export default {
```
with:
```js
// parameter names (news2.missing[]).
// G2-A2 (D10): staleMark … assumed.* say what the engine left out of the total (news2.stale[],
// named with missing.*) and what it scored as room air and Alert (news2.assumed[]). TR is the
// owner's wording («varsayıldı», "son kayıt {age}"); AZ/RU/EN await a native reading.
// G2-A2 X11: assumedLastValue and chartedOxygen.* name what an expired chart last read
// (news2.last_charted: oxygen 1/0, consciousness its ACVPU letter, printed as sent) —
// «varsayıldı: oda havası (son kayıt: oksijende, 8 sa önce)». TR as the review wrote it.
export default {
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
  },
```
with:
```js
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
    staleMark: "eski veri",
    staleHint: "Penceresini aşan ölçüm skora girmez; gerçek toplam daha yüksek olabilir.",
    assumedMark: "varsayıldı",
    assumedHint: "Güncel kayıt yok; skor bu girdiyi varsayılan değerle hesapladı ve bunu kısmi saymaz.",
    assumedNever: "hiç kaydedilmedi",
    assumedLast: "son kayıt {age}",
    assumedLastValue: "son kayıt: {value}, {age}",
    assumed: { air_or_oxygen: "oda havası", consciousness: "uyanık" },
    chartedOxygen: { air: "oda havası", oxygen: "oksijende" },
  },
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
  },
```
with:
```js
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
    staleMark: "köhnə məlumat",
    staleHint: "Pəncərəsini keçmiş ölçmə bala daxil edilmir; həqiqi cəm daha yüksək ola bilər.",
    assumedMark: "fərz edildi",
    assumedHint: "Cari qeyd yoxdur; bal bu girişi standart dəyərlə hesabladı və bunu qismən saymır.",
    assumedNever: "heç qeyd edilməyib",
    assumedLast: "son qeyd {age}",
    assumedLastValue: "son qeyd: {value}, {age}",
    assumed: { air_or_oxygen: "otaq havası", consciousness: "oyaq" },
    chartedOxygen: { air: "otaq havası", oxygen: "oksigendə" },
  },
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
  },
```
with:
```js
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
    staleMark: "устаревшие данные",
    staleHint: "Измерение старше своего окна в балл не входит; истинная сумма может быть выше.",
    assumedMark: "по умолчанию",
    assumedHint: "Текущей записи нет; балл учёл значение по умолчанию и не считает себя из-за этого неполным.",
    assumedNever: "не записывалось",
    assumedLast: "последняя запись {age}",
    assumedLastValue: "последняя запись: {value}, {age}",
    assumed: { air_or_oxygen: "комнатный воздух", consciousness: "в сознании" },
    chartedOxygen: { air: "комнатный воздух", oxygen: "на кислороде" },
  },
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
  },
```
with:
```js
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
    staleMark: "stale",
    staleHint: "A reading older than its window is left out of the score; the true total may be higher.",
    assumedMark: "assumed",
    assumedHint: "Nothing current is charted; the score used the default and does not count that as partial.",
    assumedNever: "never charted",
    assumedLast: "last charted {age}",
    assumedLastValue: "last charted: {value}, {age}",
    assumed: { air_or_oxygen: "room air", consciousness: "alert" },
    chartedOxygen: { air: "room air", oxygen: "on oxygen" },
  },
```

- [ ] **Step 4: The component, and the clock its three screens hand it**

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
import { neverMeasured, oldestMeasurement } from "./freshness.js";
import { wardFeedHealth } from "./feedHealth.js";
```
with:
```jsx
import { neverMeasured, oldestMeasurement } from "./freshness.js";
import { ageText } from "../patient/ageText.js";   // G2-A2
import { wardFeedHealth } from "./feedHealth.js";
```

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
 *  patient screen all draw it, and those are built on separate branches. */
export function News2({ news2, className = "" }) {
```
with:
```jsx
 *  patient screen all draw it, and those are built on separate branches.
 *
 *  G2-A2 (D10). The engine also says which inputs it left out of the total because they are older
 *  than their window (`stale`), and which it scored as room air and Alert because nothing current
 *  is charted (`assumed` — not partial, so not drawn as a warning). Each stale input is printed
 *  with its age: the server's stamp (`measured_at`) against `nowMs`, the clock the screen read with
 *  `useBoardNow`. The age is the screen's to state; "too old" is the engine's (freshness.js), and
 *  `fresh_until` is never compared with a clock here. An expired chart also names what it last read
 *  (`last_charted`, X11): «assumed: room air (last charted: on oxygen, 9 h ago)». */
export function News2({ news2, nowMs, className = "" }) {
```

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
  const names = missing.map((m) => t(`news2.missing.${m}`)).join(", ");
  return (
```
with:
```jsx
  const names = missing.map((m) => t(`news2.missing.${m}`)).join(", ");
  // G2-A2 (D10): what the engine left out of the total, and what it assumed.
  const stale = Array.isArray(news2.stale) ? news2.stale : [];
  const assumed = Array.isArray(news2.assumed) ? news2.assumed : [];
  const at = news2.measured_at && typeof news2.measured_at === "object" ? news2.measured_at : {};
  const ageOfInput = (name) => ageText(t, at[name], nowMs);
  // G2-A2 X11: what an expired chart last read — oxygen 1/0 in the reader's words, the ACVPU
  // letter as the engine sent it. Null when the payload does not say: then only its age is shown.
  const last = news2.last_charted && typeof news2.last_charted === "object" ? news2.last_charted : {};
  const lastValue = (name) => {
    const v = last[name];
    if (name !== "air_or_oxygen") return typeof v === "string" && v ? v : null;
    if (v !== 0 && v !== 1) return null;
    return t(`news2.chartedOxygen.${v === 1 ? "oxygen" : "air"}`);
  };
  return (
```

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
      {news2.red_param ? <StatusPill tone="att" icon="alert">{t("board.news2Red")}</StatusPill> : null}
    </span>
```
with:
```jsx
      {news2.red_param ? <StatusPill tone="att" icon="alert">{t("board.news2Red")}</StatusPill> : null}
      {/* G2-A2 (D10): each input the total left out, with how old its last reading is. */}
      {stale.length > 0 ? (
        <span className="basis-full text-11 font-semibold text-att-ink">
          {`${t("news2.staleMark")}: `}
          {stale.map((name) => [t(`news2.missing.${name}`), ageOfInput(name)].filter(Boolean).join(" · ")).join(", ")}
          <span className="sr-only">{` · ${t("news2.staleHint")}`}</span>
        </span>
      ) : null}
      {/* G2-A2 (D10): what was scored as room air and Alert; an expired chart says when it was made
          and (X11) what it last read. */}
      {assumed.length > 0 ? (
        <StatusPill tone="neutral" icon="edit" className="!whitespace-normal">
          {`${t("news2.assumedMark")}: `}
          {assumed.map((name, i) => {
            const age = at[name] ? ageOfInput(name) : null;
            const value = age ? lastValue(name) : null;
            return (
              <React.Fragment key={name}>
                {i > 0 ? ", " : null}
                {t(`news2.assumed.${name}`)}
                {age ? ` (${value ? t("news2.assumedLastValue", { value, age }) : t("news2.assumedLast", { age })})` : null}
                {at[name] ? null : <span className="sr-only">{` (${t("news2.assumedNever")})`}</span>}
              </React.Fragment>
            );
          })}
          <span className="sr-only">{` · ${t("news2.assumedHint")}`}</span>
        </StatusPill>
      ) : null}
    </span>
```

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` — replace:
```jsx
          <News2 news2={patient?.news2} />
```
with:
```jsx
          {/* G2-A2 (D10): the card's clock, so a stale input's age is the server's. */}
          <News2 news2={patient?.news2} nowMs={nowMs} />
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table). */
function BedList({ patients, alertsOf, monitored }) {
```
with:
```jsx
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table).
 *  `nowMs` (G2-A2, D10): the screen's clock, for the NEWS2 cell's ages. */
function BedList({ patients, alertsOf, monitored, nowMs }) {
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
              <td><News2 news2={p.news2} /></td>
```
with:
```jsx
              <td><News2 news2={p.news2} nowMs={nowMs} /></td>
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
        <BedList patients={shown} alertsOf={alertsOf} monitored={linked} />
```
with:
```jsx
        <BedList patients={shown} alertsOf={alertsOf} monitored={linked} nowMs={nowMs} />
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` — replace:
```jsx
              <News2 news2={patient.news2} />
```
with:
```jsx
              {/* G2-A2 (D10): the screen's clock, so a stale input's age is the server's. */}
              <News2 news2={patient.news2} nowMs={nowMs} />
```

- [ ] **Step 5: Green, the dictionaries, the suite and the build**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `      Tests  157 passed (157)`; then ` Test Files  89 passed (89)` and `      Tests  2441 passed (2441)`; then `✓ built in …` and `precache  20 entries (846.85 KiB)` (in the replay's export, whose build has no commit to name; a checkout's differs by the commit's characters), no `larger than`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in dashboard/src/live/i18n/strings/news2.js dashboard/src/live/data/board.testutil.js dashboard/src/live/screens/common/BoardState.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.test.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings.test.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `news2.js CR=74 LF=74`, `board.testutil.js CR=167 LF=167`, `BoardState.jsx CR=354 LF=354`, `BedCard.jsx CR=172 LF=172`, `BedsScreen.jsx CR=364 LF=364`, `PatientScreen.jsx CR=424 LF=424`, `BedCard.test.jsx CR=369 LF=369`, `BedsScreen.test.jsx CR=424 LF=424`, `PatientScreen.test.jsx CR=924 LF=924`, `strings.test.js CR=229 LF=229`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-a2
git add dashboard/src/live/i18n/strings/news2.js dashboard/src/live/data/board.testutil.js dashboard/src/live/screens/common/BoardState.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.test.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings.test.js
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): the NEWS2 card names each stale input with its age and marks what was assumed, with what an expired chart last read (G2-A2)

News2 keeps the total and its two pills and adds a line naming each input the
engine left out of the total, with its age from the server's stamp against the
screen's corrected clock ("eski veri: SpO2 · 2 sa önce"), and a neutral
«varsayıldı» pill, which wraps on a narrow card, naming what was scored as
room air and Alert — an expired chart adds what it last read and when, "son
kayıt: oksijende, 9 sa önce" (D10, X11), or only "son kayıt {age}" when the
payload does not say. The bed card, the bed list and the patient screen hand it
the clock each reads with useBoardNow (X4). Eleven strings ×4 in
strings/news2.js (X3, X11); az/ru/en await a native reading. strings.test.js
gains one lane-marked test for the new keys.
On the branch: a8d97c6, 90b3ed9, 0948068 (dashboard).

red: Tests 8 failed | 149 passed (157) — no stale line, no «varsayıldı» pill,
no last charted value; news2.assumedLastValue undefined

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 4: The audit reads — the newest N, and every row a page at a time

**Done on the branch** as `b418759` (the first version's Task 4, byte for byte; its body's red: "test_audit_newest.py: ImportError, no iter_records; test_api_audit.py + test_rehydrate.py: 5 failed, 17 passed (/audit answered rows 0… not 50…; no AUDIT_LIMIT_MAX / ALARM_QUALITY_LIMIT_MAX; /alarm-quality read with no `since`; no REHYDRATE_PAGE)") and `74e1a40` (the Task 4 review: a page read that failed mid-replay left a half-replayed engine behind the next request — a believable, wrong board; the replay now installs the tenant only after every page was read, pinned by `test_a_replay_that_fails_midway_installs_nothing_and_the_next_request_retries`; and three pins on the reads — the alarm report's cut keeps the newest rows (`test_the_alarm_report_asks_the_backend_for_its_window_and_says_when_it_was_cut`, rewritten), its limit is clamped up to one row (`test_the_alarm_reports_limit_is_clamped_up_to_one_row`), and a Postgres newest read with room to spare returns the window's rows and none older (`test_postgres_keeps_newest_to_the_window_and_the_filters`, two lines)). The blocks below are that code: replayed onto Task 3 they give the branch's `audit.py`, `audit_postgres.py`, `rehydrate.py`, `test_audit_newest.py`, `test_api_audit.py` and `test_rehydrate.py` byte for byte, and `app.py` as Task 5 finds it. `rehydrate.py` and `test_rehydrate.py` already carry Task 2's X10b; this task's two tests go above X10b's, after the G2-A1 tests.

Spec D11, D12. One read surface, three backends: `records(…, newest=False, after_id=None)`. `newest=True` is the newest `limit` matching rows, handed back in ascending id order (SQL `ORDER BY id DESC LIMIT n`, reversed; memory sliced from the end by count, so a limit of 0 is empty, not everything); `after_id=n` is the rows with `id > n`, oldest first; both at once is a `ValueError`; neither keeps today's oldest-first. **The contract for Lane B's heat map (B6):** `records(tenant=, event_type=, since=, newest=True, limit=)` means "the newest N rows of the window, oldest first" — no other order is promised. `audit.iter_records(log, tenant=, page=)` reads every row by `after_id`, a page at a time, the next page when the last is consumed. The callers: `/audit` reads the newest N, `limit` clamped to 1…`AUDIT_LIMIT_MAX` (1000); `/alarm-quality` hands `since=` to the backend instead of filtering in Python, reads newest, clamps `limit` to 1…`ALARM_QUALITY_LIMIT_MAX` (20 000), and says `truncated` from a limit + 1 read (the trends pattern, `trends.py:122–124`); the replay (`_ensure`) pages every row with `REHYDRATE_PAGE` (5000) and never reads newest N — the 1 000 000 cap goes; `rehydrate()` accepts any iterable. **The replay installs only what it finished** (the Task 4 review): `_ensure` builds the tenant's engine and store aside and installs them — the tenant marked rehydrated — only when every page has been read; a page read that fails midway installs nothing, the error goes up, and the next request replays again, instead of serving a believable, half-replayed board. `/audit/verify` stays oldest-first: a hash chain is verified from genesis. No migration: the reads walk the `id` primary key (measured in Step 7).

**Files:**
- Create: `homunculus-engine/tests/test_audit_newest.py`
- Modify: `homunculus-engine/tests/test_api_audit.py` (an import; five tests appended), `homunculus-engine/tests/test_rehydrate.py` (two tests, above X10b's)
- Modify: `homunculus-engine/src/homunculus/api/audit.py` (an import; the Protocol; `_one_order`; `iter_records`; memory and SQLite `records`)
- Modify: `homunculus-engine/src/homunculus/api/audit_postgres.py` (an import; `records`)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py` (an import; the signature)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (an import; three constants; `_ensure` builds aside and installs on success; `/audit`; `/alarm-quality`)

- [ ] **Step 1: Write the failing tests**

**Write** `homunculus-engine/tests/test_audit_newest.py` (new file):
```python
"""`records(…, newest=, after_id=)`: the newest N, and every row a page at a time (G2-A2, D11, D12).

Without either, a read is the OLDEST `limit` rows (`ORDER BY id ASC LIMIT n`). `/audit` asked that
and answered with the first 200 rows ever written; `/alarm-quality` read the first 20 000 and then
filtered by time in Python; a restart replayed the first million. `newest=True` is the newest N
matching rows, handed back oldest first; `after_id=n` is the rows after id n, oldest first — one
page of a read that must see every row (`iter_records`). Both at once is refused. Modelled on
test_audit_since.py: memory and SQLite here, Postgres when TEST_DATABASE_URL is set.
"""
from __future__ import annotations

import inspect
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from homunculus.api.audit import (
    AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog, iter_records,
)
from homunculus.api.audit_postgres import PostgresAuditLog
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration


def _event(n: int, **over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="ingest", patient_id="S-001", subject="heart_rate",
                payload={"n": n})
    return AuditEvent(**{**base, **over})


def _fill(log, count: int = 7) -> list:
    return [log.append(_event(n)) for n in range(count)]


def _after_last(log) -> datetime:
    """An instant strictly after every row written so far: on Windows the clock can tick at
    ~15.6 ms, and two rows a moment apart may share one `ts`."""
    last = max(datetime.fromisoformat(r.ts) for r in log.records(limit=10_000))
    while datetime.now(timezone.utc) <= last:
        time.sleep(0.001)
    return datetime.now(timezone.utc)


# --- the contract -------------------------------------------------------------------------------

@pytest.mark.parametrize("cls", [AuditLog, InMemoryAuditLog, SqliteAuditLog, PostgresAuditLog],
                         ids=lambda c: c.__name__)
def test_every_audit_log_takes_newest_and_after_id_as_keywords(cls):
    params = inspect.signature(cls.records).parameters
    assert params["newest"].kind is inspect.Parameter.KEYWORD_ONLY and params["newest"].default is False
    assert params["after_id"].kind is inspect.Parameter.KEYWORD_ONLY and params["after_id"].default is None


# --- in memory and SQLite -----------------------------------------------------------------------

@pytest.fixture(params=["memory", "sqlite"])
def log(request):
    return InMemoryAuditLog() if request.param == "memory" else SqliteAuditLog(":memory:")


def test_newest_is_the_last_rows_oldest_first(log):
    rows = _fill(log)
    assert [r.id for r in log.records(newest=True, limit=3)] == [r.id for r in rows[-3:]]
    assert [r.id for r in log.records(newest=True, limit=100)] == [r.id for r in rows]
    assert [r.id for r in log.records(limit=3)] == [r.id for r in rows[:3]]   # without it: as before


def test_newest_keeps_to_the_window_and_the_filters(log):
    _fill(log, 3)
    bound = _after_last(log)
    kept = [log.append(_event(n)) for n in (10, 11, 12)]
    log.append(_event(13, patient_id="S-002"))
    log.append(_event(14, tenant="HOSP2"))
    rows = log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=2)
    assert [r.id for r in rows] == [r.id for r in kept[-2:]]
    rows = log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=10)
    assert [r.id for r in rows] == [r.id for r in kept]          # the window's rows, none older


def test_a_newest_read_of_no_rows_is_empty_not_everything(log):
    _fill(log, 3)
    assert log.records(newest=True, limit=0) == []


def test_after_id_reads_the_rows_after_it_oldest_first(log):
    rows = _fill(log)
    assert [r.id for r in log.records(after_id=rows[2].id, limit=2)] == [rows[3].id, rows[4].id]
    assert log.records(after_id=rows[-1].id) == []


def test_newest_and_after_id_together_are_refused(log):
    _fill(log, 1)
    with pytest.raises(ValueError, match="newest and after_id"):
        log.records(newest=True, after_id=0)


def test_iter_records_reads_every_row_a_page_at_a_time(log):
    rows = _fill(log, 7)
    log.append(_event(99, tenant="HOSP2"))
    assert [r.id for r in iter_records(log, tenant="HOSP1", page=3)] == [r.id for r in rows]
    assert [r.id for r in iter_records(log, tenant="HOSP1", page=7)] == [r.id for r in rows]
    with pytest.raises(ValueError, match="page"):
        list(iter_records(log, page=0))


# --- Postgres -----------------------------------------------------------------------------------

@pytest.fixture
def pg_log():
    log = PostgresAuditLog(TEST_DATABASE_URL)
    with log._engine.begin() as conn:                      # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        for revision in ("0004", "0008"):
            migration, _ = _load_migration(revision)
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
    yield log
    with log._engine.begin() as conn:                      # noqa: SLF001
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
    log.dispose()


@requires_db
def test_postgres_reads_the_newest_rows_oldest_first(pg_log):
    rows = _fill(pg_log)
    assert [r.id for r in pg_log.records(newest=True, limit=3)] == [r.id for r in rows[-3:]]
    assert [r.id for r in pg_log.records(limit=3)] == [r.id for r in rows[:3]]
    assert pg_log.records(newest=True, limit=0) == []


@requires_db
def test_postgres_keeps_newest_to_the_window_and_the_filters(pg_log):
    _fill(pg_log, 3)
    bound = _after_last(pg_log)
    kept = [pg_log.append(_event(n)) for n in (10, 11, 12)]
    pg_log.append(_event(13, patient_id="S-002"))
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=2)
    assert [r.id for r in rows] == [r.id for r in kept[-2:]]
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=10)
    assert [r.id for r in rows] == [r.id for r in kept]          # the window's rows, none older


@requires_db
def test_postgres_pages_by_id(pg_log):
    rows = _fill(pg_log, 7)
    assert [r.id for r in pg_log.records(after_id=rows[2].id, limit=2)] == [rows[3].id, rows[4].id]
    assert [r.id for r in iter_records(pg_log, tenant="HOSP1", page=3)] == [r.id for r in rows]


@requires_db
def test_postgres_refuses_newest_with_after_id(pg_log):
    with pytest.raises(ValueError, match="newest and after_id"):
        pg_log.records(newest=True, after_id=0)
```

Then convert it to CRLF — the ground rules' one exception, touching only this file:

```bash
cd /c/tmp/g2a-a2
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_audit_newest.py
```

**Edit** `homunculus-engine/tests/test_api_audit.py` — replace:
```python
from homunculus.api.audit import InMemoryAuditLog
```
with:
```python
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
```

**Edit** `homunculus-engine/tests/test_api_audit.py` — replace:
```python
    assert views[0].patient_id == "bed-3" and views[0].payload["role"] == "doctor"
```
with:
```python
    assert views[0].patient_id == "bed-3" and views[0].payload["role"] == "doctor"


# --- G2-A2 (D12): the newest rows, at most AUDIT_LIMIT_MAX; the alarm report reads its window ----

HDR = {"Authorization": "Bearer tok"}


def _views(audit, count):
    for n in range(count):
        audit.append(AuditEvent("HOSP1", "view", f"bed-{n}", "", {"n": n}))


def test_the_trail_is_the_newest_rows_oldest_first():
    audit = InMemoryAuditLog()
    _views(audit, 250)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    body = client.get("/audit", headers=HDR).json()["records"]
    assert [r["payload"]["n"] for r in body] == list(range(50, 250))


def test_the_trail_is_capped_and_a_request_cannot_empty_it():
    from homunculus.api.app import AUDIT_LIMIT_MAX
    audit = InMemoryAuditLog()
    _views(audit, AUDIT_LIMIT_MAX + 5)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    capped = client.get("/audit", params={"limit": 100000}, headers=HDR).json()["records"]
    assert len(capped) == AUDIT_LIMIT_MAX
    assert capped[-1]["payload"]["n"] == AUDIT_LIMIT_MAX + 4
    one = client.get("/audit", params={"limit": 0}, headers=HDR).json()["records"]
    assert [r["payload"]["n"] for r in one] == [AUDIT_LIMIT_MAX + 4]


class _Spy(InMemoryAuditLog):
    def __init__(self):
        super().__init__()
        self.reads: list[dict] = []

    def records(self, **kw):
        self.reads.append(kw)
        return super().records(**kw)


def _first_seens(audit, count):
    """One alarm episode per bed, bed-0 the oldest row and bed-(count-1) the newest."""
    for n in range(count):
        audit.append(AuditEvent("HOSP1", "first_seen", f"bed-{n}", "news2",
                                {"at": datetime.now(timezone.utc).isoformat()}))


def test_the_alarm_report_asks_the_backend_for_its_window_and_says_when_it_was_cut():
    audit = _Spy()
    _first_seens(audit, 5)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    body = client.get("/alarm-quality", params={"limit": 3}, headers=HDR).json()
    [read] = [r for r in audit.reads if "since" in r]
    assert (read["newest"], read["limit"]) == (True, 4)       # the cap, and one more to know
    assert read["since"].tzinfo is not None
    assert (body["truncated"], body["episodes"]) == (True, 3)
    assert {b["patient_id"] for b in body["noisiest_beds"]} == {"bed-2", "bed-3", "bed-4"},         "the cut keeps the newest rows: the oldest one — the extra row read to know — is dropped"
    body = client.get("/alarm-quality", params={"limit": 5}, headers=HDR).json()
    assert (body["truncated"], body["episodes"]) == (False, 5)


def test_the_alarm_reports_read_is_capped():
    from homunculus.api.app import ALARM_QUALITY_LIMIT_MAX
    audit = _Spy()
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    client.get("/alarm-quality", params={"limit": 10**9}, headers=HDR)
    [read] = [r for r in audit.reads if "since" in r]
    assert read["limit"] == ALARM_QUALITY_LIMIT_MAX + 1


def test_the_alarm_reports_limit_is_clamped_up_to_one_row():
    """`limit=0` or a negative one is one row — the newest — like /audit's, not an empty read and not
    a slice from the wrong end."""
    audit = _Spy()
    _first_seens(audit, 3)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    for limit in (0, -5):
        audit.reads.clear()
        body = client.get("/alarm-quality", params={"limit": limit}, headers=HDR).json()
        [read] = [r for r in audit.reads if "since" in r]
        assert (read["newest"], read["limit"]) == (True, 2), limit      # a cap of 1, and one more
        assert (body["truncated"], body["episodes"]) == (True, 1), limit
        assert [b["patient_id"] for b in body["noisiest_beds"]] == ["bed-2"], limit
```

**Edit** `homunculus-engine/tests/test_rehydrate.py` — replace:
```python

def test_a_reading_stamped_in_the_future_is_replayed_at_the_instant_the_door_judged_it():
```
with:
```python

def test_a_restart_replays_every_row_a_page_at_a_time(monkeypatch):
    """G2-A2 (D12): the replay read the first 1 000 000 rows in one go, and on a large tenant the rows
    it dropped were the newest — the current state. It reads every row by id now, a page at a time;
    a page of 5 here stands for the real 5000."""
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "REHYDRATE_PAGE", 5)
    reads: list[dict] = []

    class Counting(InMemoryAuditLog):
        def records(self, **kw):
            reads.append(kw)
            return super().records(**kw)

    audit = Counting()
    for minute, rate in enumerate([80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 140]):
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "heart_rate", {
            "value": rate, "unit": "/min", "obs_ts": f"2026-07-14T10:{minute:02d}:00+00:00",
            "device": "mon"}))
    client = TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit))
    [card] = client.get("/patients", headers={"Authorization": "Bearer tok"}).json()["patients"]
    assert card["latest"]["heart_rate"] == 140, "the newest row is the board's"
    assert {a["kind"] for a in card["alerts"]} == {"news2"}
    replay = [r for r in reads if r.get("tenant") == "HOSP1" and "after_id" in r]
    assert [(r["after_id"], r["limit"]) for r in replay] == [(None, 5), (5, 5), (10, 5)]


def test_a_replay_that_fails_midway_installs_nothing_and_the_next_request_retries(monkeypatch):
    """G2-A2, Task 4 review: the tenant was marked rehydrated, and its engine built, BEFORE the replay
    ran — so a page read that failed (a database hiccup; ~200 reads at a million rows) answered 500
    once and the next request served the half-replayed engine as the board: an old heart rate and
    the NEWS2 alert gone — believable, and wrong. A failed replay installs nothing; the next request
    reads the log again, from the first row."""
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "REHYDRATE_PAGE", 5)

    class FailsOnce(InMemoryAuditLog):
        def __init__(self):
            super().__init__()
            self.after_ids: list = []
            self.failed = False

        def records(self, **kw):
            self.after_ids.append(kw.get("after_id"))
            if kw.get("after_id") == 5 and not self.failed:      # the second page, once
                self.failed = True
                raise RuntimeError("page read failed")
            return super().records(**kw)

    audit = FailsOnce()
    for minute, rate in enumerate([80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 140]):
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "heart_rate", {
            "value": rate, "unit": "/min", "obs_ts": f"2026-07-14T10:{minute:02d}:00+00:00",
            "device": "mon"}))
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit)
    client = TestClient(app, raise_server_exceptions=False)
    hdr = {"Authorization": "Bearer tok"}

    assert client.get("/patients", headers=hdr).status_code == 500
    assert "HOSP1" not in app.state.ack_stores, "a replay that did not finish installed its store"

    again = client.get("/patients", headers=hdr)
    assert again.status_code == 200
    [card] = again.json()["patients"]
    assert card["latest"]["heart_rate"] == 140, "the retry replayed every row, the newest included"
    assert {a["kind"] for a in card["alerts"]} == {"news2"}
    assert audit.after_ids == [None, 5, None, 5, 10], "the retry reads the log from the first row"


def test_a_reading_stamped_in_the_future_is_replayed_at_the_instant_the_door_judged_it():
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_audit.py tests/test_rehydrate.py 2>&1 | tail -1
```

Expected: `1 error in …` — the new file stops at its import (`ImportError: cannot import name 'iter_records'`); then `7 failed, 18 passed, 3 warnings in …` — `/audit` answers the first 200 rows (`[0, 1, 2, …] == [50, 51, 52, …]`), `AUDIT_LIMIT_MAX`/`ALARM_QUALITY_LIMIT_MAX` do not exist (`ImportError`), `/alarm-quality` reads with no `since` (`ValueError: not enough values to unpack`), and the module has no `REHYDRATE_PAGE` (`AttributeError`, both replay tests).

- [ ] **Step 3: The three backends and the pager**

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
```
with:
```python
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    # `since` (zone-aware) keeps the rows written at or after it. Without it a read is the OLDEST
    # `limit` rows — the right end for a replay, the wrong one for "what happened in this window".
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200) -> list[AuditRecord]: ...
```
with:
```python
def _one_order(newest: bool, after_id: int | None) -> None:
    """Refuse `newest` with `after_id` (G2-A2, D11): the newest N rows and the rows after an id are
    different questions, and a read asked both would have to drop one of them silently."""
    if newest and after_id is not None:
        raise ValueError("newest and after_id are different reads: pass one")


class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    # `since` (zone-aware) keeps the rows written at or after it. Without `newest` or `after_id` a
    # read is the OLDEST `limit` rows. G2-A2 (D11): `newest=True` is the NEWEST `limit` matching
    # rows, still in ascending id order — "what happened lately" (/audit, /alarm-quality, the heat
    # map); `after_id=n` is the rows with `id > n`, oldest first — one page of "every row"
    # (`iter_records`, the replay). Both at once is a ValueError. No other order is promised.
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200, newest: bool = False,
                after_id: int | None = None) -> list[AuditRecord]: ...


def iter_records(log: AuditLog, *, tenant: str | None = None,
                 page: int) -> Iterator[AuditRecord]:
    """Every row, oldest first, read `page` rows at a time by id (G2-A2, D12) — the replay's read.

    A replay needs every row: one read capped at N drops the rows past N, and on a large tenant
    those are the newest — the current state. The next page is read when the last one has been
    consumed; a page shorter than `page` is the end."""
    if page < 1:
        raise ValueError("page must be at least 1")
    after: int | None = None
    while True:
        rows = log.records(tenant=tenant, limit=page, after_id=after)
        yield from rows
        if len(rows) < page:
            return
        after = rows[-1].id
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200):
        bound = since_utc(since)
        hits = [r for r in self._rows if _matches(r, tenant, patient_id, event_type, bound)]
        return hits[:limit]
```
with:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200,
                newest=False, after_id=None):
        _one_order(newest, after_id)
        bound = since_utc(since)
        hits = [r for r in self._rows if (after_id is None or r.id > after_id)
                and _matches(r, tenant, patient_id, event_type, bound)]
        # The newest `limit`, still oldest first (D11) — cut from the end by count: `hits[-0:]`
        # would be every row.
        return hits[max(len(hits) - limit, 0):] if newest else hits[:limit]
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200):
        clauses, params = [], []
```
with:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200,
                newest=False, after_id=None):
        _one_order(newest, after_id)
        clauses, params = [], []
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        rows = self.connection.execute(
            f"SELECT * FROM audit {where} ORDER BY id ASC LIMIT ?", params
        ).fetchall()
```
with:
```python
        if after_id is not None:
            clauses.append("id > ?")
            params.append(after_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        # The newest N are read from the id end and handed back oldest first (G2-A2, D11): the
        # INTEGER PRIMARY KEY, walked backwards — no index of its own.
        order = "DESC" if newest else "ASC"
        rows = self.connection.execute(
            f"SELECT * FROM audit {where} ORDER BY id {order} LIMIT ?", params
        ).fetchall()
        if newest:
            rows.reverse()
```

**Edit** `homunculus-engine/src/homunculus/api/audit_postgres.py` — replace:
```python
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, _now_iso, chain_hash, since_utc)
```
with:
```python
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, _now_iso, _one_order, chain_hash, since_utc)
```

**Edit** `homunculus-engine/src/homunculus/api/audit_postgres.py` — replace:
```python
                limit: int = 200) -> list[AuditRecord]:
        clauses, params = [], {"limit": limit}
```
with:
```python
                limit: int = 200, newest: bool = False,
                after_id: int | None = None) -> list[AuditRecord]:
        _one_order(newest, after_id)
        clauses, params = [], {"limit": limit}
```

**Edit** `homunculus-engine/src/homunculus/api/audit_postgres.py` — replace:
```python
            params["since"] = bound.isoformat()
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, ts, tenant, event_type, patient_id, subject, payload,"
                     f" prev_hash, hash FROM audit {where} ORDER BY id ASC LIMIT :limit"),
                params,
            ).mappings().all()
```
with:
```python
            params["since"] = bound.isoformat()
        if after_id is not None:
            clauses.append("id > :after_id")
            params["after_id"] = after_id
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        # The newest N from the id end, handed back oldest first (G2-A2, D11): `id` is the BIGSERIAL
        # primary key (migration 0004), walked backwards — no new index, no migration.
        order = "DESC" if newest else "ASC"

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, ts, tenant, event_type, patient_id, subject, payload,"
                     f" prev_hash, hash FROM audit {where} ORDER BY id {order} LIMIT :limit"),
                params,
            ).mappings().all()
        if newest:
            rows = list(reversed(rows))
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
from datetime import datetime

from homunculus.api.ackstore import AckStore
```
with:
```python
from collections.abc import Iterable
from datetime import datetime

from homunculus.api.ackstore import AckStore
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
def rehydrate(engine: Engine, store: AckStore, records: list[AuditRecord]) -> None:
    for rec in records:
```
with:
```python
def rehydrate(engine: Engine, store: AckStore, records: Iterable[AuditRecord]) -> None:
    # Any iterable, read once, in id order (G2-A2, D12): the API hands it `audit.iter_records`,
    # which reads the log a page at a time, so no cap can drop the newest rows.
    for rec in records:
```

- [ ] **Step 4: The callers — and a tenant installed only after its replay**

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, verify_chain
```
with:
```python
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, iter_records, verify_chain
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
TREND_WINDOWS_TEXT = frozenset(str(h) for h in TRENDS_HOURS)

```
with:
```python
TREND_WINDOWS_TEXT = frozenset(str(h) for h in TRENDS_HOURS)

#: G2-A2 (D12): the most rows one `/audit` answer carries — the newest; the most `/alarm-quality`
#: reads for its window (it says `truncated` when the window held more); and the rows a restart
#: replays per read — every row is replayed, a page at a time.
AUDIT_LIMIT_MAX = 1000
ALARM_QUALITY_LIMIT_MAX = 20000
REHYDRATE_PAGE = 5000

```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        """Build a tenant's engine + store, rehydrating once from the audit log (event sourcing)."""
        if hospital in rehydrated:
            return
        rehydrated.add(hospital)
        engine = engines.setdefault(hospital, Engine())
        store = stores.setdefault(hospital, AckStore())
        rehydrate(engine, store, audit.records(tenant=hospital, limit=1_000_000))
```
with:
```python
        """Build a tenant's engine + store, rehydrating once from the audit log (event sourcing).

        The replay runs into an engine and a store nothing else can see yet, and they are installed
        — the tenant marked rehydrated — only when every page has been read (G2-A2, Task 4 review).
        A page read that fails midway installs nothing and the error goes up; the next request
        replays again, instead of serving the half-replayed board of a replay that never finished."""
        if hospital in rehydrated:
            return
        engine = Engine()
        store = AckStore()
        # Every row, oldest first, a page at a time (G2-A2, D12) — never the newest N, and no cap.
        rehydrate(engine, store, iter_records(audit, tenant=hospital, page=REHYDRATE_PAGE))
        engines[hospital] = engine
        stores[hospital] = store
        rehydrated.add(hospital)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        recs = audit.records(tenant=hospital, patient_id=patient_id,
                             event_type=event_type, limit=limit)
```
with:
```python
        # The NEWEST rows, oldest first, at most AUDIT_LIMIT_MAX (G2-A2, D12): an auditor asking
        # about recent activity gets recent rows, not the first ones ever written.
        recs = audit.records(tenant=hospital, patient_id=patient_id, event_type=event_type,
                             limit=max(1, min(limit, AUDIT_LIMIT_MAX)), newest=True)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        recs = [r for r in audit.records(tenant=hospital, limit=limit)
                if (r.ts or "") >= since.isoformat()]
        report = alarm_quality(recs, now)
        return {**report.as_dict(), "days": days}
```
with:
```python
        # The window is the backend's to read (G2-A2, D12): its newest rows, at most `cap`, and one
        # more to know whether it held more — then the report says `truncated` rather than reading
        # as the whole window (the trends pattern, api/trends.py `_markers`).
        cap = max(1, min(limit, ALARM_QUALITY_LIMIT_MAX))
        recs = audit.records(tenant=hospital, since=since, limit=cap + 1, newest=True)
        truncated = len(recs) > cap
        report = alarm_quality(recs[1:] if truncated else recs, now)
        return {**report.as_dict(), "days": days, "truncated": truncated}
```

- [ ] **Step 5: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py tests/test_api_audit.py tests/test_rehydrate.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py tests/test_audit_memory.py tests/test_audit_sqlite.py tests/test_audit_chain.py tests/test_alarm_quality.py tests/test_board_permissions.py tests/test_api_ack.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_trends_api.py tests/test_tenant_isolation.py tests/test_first_seen_persistence.py 2>&1 | tail -1
```

Expected: `41 passed, 4 skipped, 3 warnings in …` (the four Postgres tests skip without the database: Step 6 runs them); then `211 passed, 114 skipped, 3 warnings in …` (`test_board_permissions.py`'s `[-1]` is the newest ack, as it reads; `/audit/verify` and the chain tests are unchanged). The whole no-DB suite after this task: `2361 passed, 654 skipped` (the four new Postgres tests among the skipped).

- [ ] **Step 6: The Postgres backend, against the test database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py tests/test_audit_since.py tests/test_audit_postgres.py 2>&1 | tail -1
```

The variable is set on this one command line only — never exported. The container is `homunculus-test-pg-56` (port 56432), shared with Lane B; `tests/conftest.py` takes a session advisory lock, so a run of the other lane's waits rather than colliding. Expected: `52 passed in …` — this file's 20 and the two neighbours' 32 (the replay's run waited 5 min for the lock). If it prints `waiting for another test run on database 'homunculus_test' to finish`, the other lane holds the lock: it waits, then runs.

- [ ] **Step 7: A newest read on a large log — measured, not assumed** (spec §7). A throwaway SQLite file of 1 000 000 rows in the scratchpad, written straight into the table (no chain: the read does not look at it), then the two per-patient reads the routes make. Nothing of the repo; the file is deleted at the end.

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe - <<'PY'
import os, tempfile, time
from homunculus.api.audit import SqliteAuditLog
path = os.path.join(tempfile.mkdtemp(), "audit-1m.db")
log = SqliteAuditLog(path)
rows = (("2026-10-25T09:00:00+00:00", "HOSP1", "ingest", "rare" if n < 100 else f"bed-{n % 40}",
         "heart_rate", "{}") for n in range(1_000_000))
log.connection.executemany("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
                           " VALUES (?, ?, ?, ?, ?, ?)", rows)
log.connection.commit()
for who, newest in (("bed-7", True), ("rare", True), ("bed-7", False), ("rare", False), (None, True)):
    t = time.perf_counter(); got = log.records(tenant="HOSP1", patient_id=who, newest=newest, limit=200)
    print(f"{who} newest={newest}: {len(got)} rows in {(time.perf_counter() - t) * 1000:.0f} ms")
log.connection.close(); os.remove(path)
PY
```

Expected (the replay's run, 2026-10-26; the milliseconds are this machine's — the first version's run printed 6, 462, 7, 452 and 5 ms):
```
bed-7 newest=True: 200 rows in 2 ms
rare newest=True: 100 rows in 113 ms
bed-7 newest=False: 200 rows in 1 ms
rare newest=False: 100 rows in 107 ms
None newest=True: 200 rows in 1 ms
```
A patient with rows throughout the log, and the whole trail, are answered in milliseconds. The worst case — a patient with fewer rows than the limit, all of them old (`rare`: the first 100 of a million) — walks the whole key, **and today's oldest-first read of that patient walks it too**, for the same reason (it looks for a 101st row): the newest read adds no cost. No `(tenant, patient_id, id)` index in this slice (O4).

- [ ] **Step 8: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_audit_newest.py homunculus-engine/tests/test_api_audit.py homunculus-engine/tests/test_rehydrate.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `audit.py CR=333 LF=333`, `audit_postgres.py CR=143 LF=143`, `rehydrate.py CR=123 LF=123`, `app.py CR=1243 LF=1243`, `test_audit_newest.py CR=157 LF=157`, `test_api_audit.py CR=174 LF=174`, `test_rehydrate.py CR=347 LF=347`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_audit_newest.py homunculus-engine/tests/test_api_audit.py homunculus-engine/tests/test_rehydrate.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(audit): reads say which end — the newest N for /audit and the alarm report, every row a page at a time for the replay, installed only when it finished (G2-A2)

records(…, newest=, after_id=) in the memory, SQLite and Postgres logs:
newest=True is the newest `limit` matching rows, oldest first; after_id=n the
rows after id n, oldest first; both at once is a ValueError (D11).
iter_records pages every row by id. /audit reads the newest N, capped at
AUDIT_LIMIT_MAX; /alarm-quality hands its window to the backend, reads newest,
clamps its limit from 1 and says `truncated`; a restart replays every row,
REHYDRATE_PAGE at a time, with no cap, into an engine and a store installed
only when every page was read — a replay that fails installs nothing and the
next request retries (D12). /audit/verify stays oldest-first. No migration:
the reads walk the id primary key.
On the branch: b418759, 74e1a40.

red: test_audit_newest.py: ImportError, no iter_records; test_api_audit.py +
test_rehydrate.py: 7 failed, 18 passed (/audit answered rows 0… not 50…; no
AUDIT_LIMIT_MAX / ALARM_QUALITY_LIMIT_MAX; /alarm-quality read with no `since`;
no REHYDRATE_PAGE)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 5: An unreadable scope — 503, not "not found", and no false denial on the record

**Done on the branch** as `a697a4f` (the first version's Task 5, byte for byte; its body's red: "11 failed, 45 passed (the eight single-patient routes answered 404 «hasta bulunamadı» and wrote scope_denied; /audit and /alarm-quality 403; /patients 200)"), `1498489` (the Task 5 review: the dashboard's `errors.scopeUnreadable` said "…so the live stream did not start", but with D13 the server sends that one sentence for the acknowledge, the chart and the profile writes too — the text is now route-neutral in all four languages, and `apiErrors.js`'s comment says where it is printed) and the trends docstring hunk of `328e529` (the review minors: a second look-up would let a blip "turn a scope that was readable into a 503", no longer "answer 404"). The blocks below are that code: replayed onto Task 4 they give the branch's `test_api_scope.py`, `apiErrors.js` and `strings/errors.js` byte for byte, and `app.py` as Task 6 finds it.

Spec D13, D13b. `scope/resolver.py` returns `UNKNOWN` when it could not find out what a caller may see (a token it cannot decode, a database that did not answer, no membership). Every single-patient route goes through `_require_patient`, which read that as out of scope: 404 «hasta bulunamadı» and a `scope_denied` row nobody committed; `/patients` answered 200 with an empty board and the blind note blamed the assignment; the two whole-trail routes called it «kapsam dışı». One helper, `_readable(scope)` (lane-marked `# G2-A2`), answers 503 «kapsam şu anda okunamıyor» — the stream ticket's own answer, already mapped by the dashboard (`apiErrors.js:80`) — and it is called: in `_require_patient` right after the scope is resolved, before `sees_patient` and the audit row; in `/patients` before `apply_scope`; and in `/audit` (no patient id) and `/alarm-quality` before their restricted-scope 403 (D13b), which a readable restricted scope keeps. The routes whose answer changes for `UNKNOWN`: POST `/clinical/{id}`, PUT `/clinical/{id}/profile`, `/ack`, `/view`, `/alerts/{id}`, `/audit?patient_id`, GET and POST `/scores/sofa/{id}` (from 404 and a false row), `/audit` and `/alarm-quality` (from 403), `/patients` (from 200 empty). Trends' own two-line check becomes redundant and goes; it still resolves the scope once and hands it over, so its answers are unchanged (`test_trends_api.py:189–194`, `:237–245`). The order is unchanged: the 403 for a missing permission and the 400 for a malformed body come first. The device token is unscoped and gets its answer. `scope/` is Lane B's and is not touched; the blind note (`scope/rules.py:210–213`) stays right for a readable scope that matches nothing (`test_api_scope.py:120–127`). A failed `/patients` load is already UNAVAILABLE on the dashboard (`boardStore.js:129–159`); what the dashboard needs is the message's wording: `errors.scopeUnreadable` named the live stream, and the acknowledge toast, the patient chart and the baseline profile form now print it too (the Task 5 review). tr «Yetki kapsamınız şu anda okunamıyor; biraz sonra tekrar deneyin.», az «Giriş əhatəniz hazırda oxuna bilmir; bir az sonra yenidən cəhd edin.»; the az, ru and en texts await a native reading (O1).

**Files:**
- Modify: `homunculus-engine/tests/test_api_scope.py` (a class appended)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`_readable`; `_require_patient`; `/patients`; trends and its docstring; `/audit`; `/alarm-quality`)
- Modify: `dashboard/src/live/apiErrors.js` (a comment), `dashboard/src/live/i18n/strings/errors.js` (`scopeUnreadable` ×4)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_api_scope.py` — replace:
```python
    def test_a_128_character_id_is_still_an_id(self, adult_nurse):
        _app, client = adult_nurse
        assert client.post("/view", headers=TOKEN,
                           json={"patient_id": "p" * 128}).status_code == 200
```
with:
```python
    def test_a_128_character_id_is_still_an_id(self, adult_nurse):
        _app, client = adult_nurse
        assert client.post("/view", headers=TOKEN,
                           json={"patient_id": "p" * 128}).status_code == 200


class TestJAnUnreadableScopeIsUnavailableNotNotFound:
    """G2-A2 (D13, D13b). A scope the resolver could not read — a database blip, no membership it
    could find — answered 404 «hasta bulunamadı» on every single-patient route and wrote a
    `scope_denied` row nobody committed; the whole-trail routes called it «kapsam dışı». It is 503
    now, the stream ticket's own answer, with no row; the device token, which is unscoped, still
    gets its answer."""

    PERMS = NURSE_PERMS | {"audit.view", "scores.sign"}
    ROUTES = [
        ("POST", "/clinical/p-a1", {"entries": [{"code": "suspected_infection", "value": 1}]}, 200),
        ("PUT", "/clinical/p-a1/profile", {"comorbidities": ["copd"]}, 200),
        ("POST", "/ack", {"patient_id": "p-a1", "kind": "news2"}, 200),
        ("POST", "/view", {"patient_id": "p-a1"}, 200),
        ("GET", "/alerts/p-a1", None, 200),
        ("GET", "/audit?patient_id=p-a1", None, 200),
        ("GET", "/scores/sofa/p-a1", None, 200),
        ("POST", "/scores/sofa/p-a1", {}, 403),          # a device never signs: its own refusal
        ("GET", "/audit", None, 200),                    # D13b: the whole trail
        ("GET", "/alarm-quality", None, 200),            # D13b
    ]

    @pytest.mark.parametrize("method,path,body,device", ROUTES,
                             ids=[f"{m} {p}" for m, p, _b, _d in ROUTES])
    def test_an_unreadable_scope_is_503_and_writes_no_denial(self, method, path, body, device):
        from homunculus.scope.resolver import UNKNOWN
        app = app_with(UNKNOWN, perms=self.PERMS)
        with TestClient(app) as client:
            _admit_everyone(client)
            _reading(client, "p-a1", spo2=85.0)          # a live NEWS2 alert, for the ack
            r = client.request(method, path, headers=NURSE, json=body)
            assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
            assert not _rows(app, "scope_denied")
            answered = client.request(method, path, headers=TOKEN, json=body)
        assert answered.status_code == device, answered.text

    def test_the_board_is_503_before_it_is_narrowed(self):
        from homunculus.scope.resolver import UNKNOWN
        app = app_with(UNKNOWN)
        with TestClient(app) as client:
            _admit_everyone(client)
            r = client.get("/patients", headers=NURSE)
            device = client.get("/patients", headers=TOKEN)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert device.status_code == 200 and len(device.json()["patients"]) == 3

    @pytest.mark.parametrize("path,detail", [
        ("/audit", "denetim kaydının tamamı kapsam dışı; bir patient_id verin"),
        ("/alarm-quality", "alarm kalitesi raporunun tamamı kapsam dışı"),
    ])
    def test_a_readable_restricted_scope_keeps_its_403_on_the_whole_trail(self, path, detail):
        app = app_with(ADULT, perms=self.PERMS)
        with TestClient(app) as client:
            r = client.get(path, headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, detail)

    def test_a_missing_permission_and_a_malformed_body_still_come_first(self):
        from homunculus.scope.resolver import UNKNOWN
        with TestClient(app_with(UNKNOWN, perms=frozenset())) as client:
            r = client.get("/alerts/p-a1", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        with TestClient(app_with(UNKNOWN)) as client:
            r = client.post("/ack", headers=NURSE, json={"patient_id": {"x": 1}, "kind": "news2"})
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz patient_id")
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_scope.py 2>&1 | tail -1
```

Expected: `11 failed, 45 passed, 3 warnings in …` — the eight single-patient routes answer `(404, 'hasta bulunamadı')`, `/audit` and `/alarm-quality` `(403, … kapsam dışı …)`, `/patients` 200 with no `detail` (`KeyError: 'detail'`); the 403-keeps test and the order test pass already.

- [ ] **Step 3: One helper, called where the scope is first read**

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python

    async def _require_patient(caller: Caller, authorization: str | None,
```
with:
```python

    def _readable(scope: Scope) -> Scope:   # G2-A2 (D13)
        """Refuse a scope that could not be read, before anything takes it for an answer: 503, the
        stream ticket's own answer (G2-A2, D13). A look-up that failed — a database blip, no
        membership the resolver could find — is not "out of scope": a 404 would tell a ward its
        patient is gone, a `scope_denied` row would record an access violation nobody committed,
        and an empty board would read as a quiet ward. The dashboard maps the detail
        (`apiErrors.js`), and a failed `/patients` load already shows UNAVAILABLE."""
        if scope.reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        return scope

    async def _require_patient(caller: Caller, authorization: str | None,
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        `scope` is the caller's scope when the route has already resolved it (the trends route
        needs it first, to answer 503 for one that cannot be read). Passing it spares a second
        look-up, and a second chance for a blip to turn a readable scope into "not found". Every
        other route leaves it out and the scope is resolved here.
```
with:
```python
        A scope that cannot be read is 503 here, right after it is resolved and before the check
        and the audit row (`_readable`, G2-A2, D13): "we could not find out" is not "not yours".

        `scope` is the caller's scope when the route has already resolved it (the trends route,
        which polls every minute). Passing it spares a second look-up, and a second chance for a
        blip to turn a readable scope into an unreadable one. Every other route leaves it out and
        the scope is resolved here.
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        scope = scope if scope is not None else await _scope(authorization)
```
with:
```python
        scope = _readable(scope if scope is not None else await _scope(authorization))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        hospital = caller.hospital
        scope = await _scope(authorization)
        result = apply_scope(
```
with:
```python
        hospital = caller.hospital
        # 503 before the board is narrowed (G2-A2, D13): an unreadable scope is not an empty one.
        scope = _readable(await _scope(authorization))
        result = apply_scope(
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        ticket answers it: `_require_patient` would call it "not found", which tells a screen the
        patient is gone when only the look-up failed. Out of scope and unknown stay one 404.
```
with:
```python
        ticket answers it — `_require_patient` answers so for every single-patient route since
        G2-A2 (D13). Out of scope and unknown stay one 404.
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        to answer 404 for a patient who is in scope.
```
with:
```python
        to turn a scope that was readable into a 503.
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        scope = await _scope(authorization)
        if scope.reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        await _require_patient(caller, authorization, patient_id, scope=scope)
```
with:
```python
        scope = await _scope(authorization)
        await _require_patient(caller, authorization, patient_id, scope=scope)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        elif not (await _scope(authorization)).unrestricted:
```
with:
```python
        elif not _readable(await _scope(authorization)).unrestricted:   # G2-A2 (D13b): 503 first
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        if not (await _scope(authorization)).unrestricted:
```
with:
```python
        if not _readable(await _scope(authorization)).unrestricted:   # G2-A2 (D13b): 503 first
```

- [ ] **Step 4: The dashboard's sentence names no route** (the Task 5 review)

**Edit** `dashboard/src/live/apiErrors.js` — replace:
```js
 *  look-up of what the caller may see failed. NOTE: the `scopeUnreadable` text currently names the
 *  live stream ("…so the live stream did not start"); the server sends the one sentence for both
 *  routes, and no screen prints it for the trends route today. */
```
with:
```js
 *  look-up of what the caller may see failed. The server also sends it for the acknowledge,
 *  clinical and profile writes, so the `scopeUnreadable` text is route-neutral (it names no live
 *  stream). Besides the live stream it is printed by the alarms acknowledge toast, the patient
 *  chart and the baseline profile form. */
```

**Edit** `dashboard/src/live/i18n/strings/errors.js` — replace:
```js
    scopeUnreadable: "Kapsamınız şu anda okunamıyor; canlı akış başlatılamadı. Biraz sonra tekrar deneyin.",
```
with:
```js
    scopeUnreadable: "Yetki kapsamınız şu anda okunamıyor; biraz sonra tekrar deneyin.",
```

**Edit** `dashboard/src/live/i18n/strings/errors.js` — replace:
```js
    scopeUnreadable: "Əhatəniz hazırda oxunmur; canlı axın başladıla bilmədi. Bir az sonra yenidən cəhd edin.",
```
with:
```js
    scopeUnreadable: "Giriş əhatəniz hazırda oxuna bilmir; bir az sonra yenidən cəhd edin.",
```

**Edit** `dashboard/src/live/i18n/strings/errors.js` — replace:
```js
    scopeUnreadable: "Вашу область доступа сейчас не удаётся прочитать; прямой поток не запущен. Повторите позже.",
```
with:
```js
    scopeUnreadable: "Вашу область доступа сейчас не удаётся прочитать; повторите попытку чуть позже.",
```

**Edit** `dashboard/src/live/i18n/strings/errors.js` — replace:
```js
    scopeUnreadable: "Your scope cannot be read at the moment, so the live stream did not start. Try again shortly.",
```
with:
```js
    scopeUnreadable: "Your access scope cannot be read right now; try again shortly.",
```

- [ ] **Step 5: Green, the neighbours, the dictionaries**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_scope.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends_api.py tests/test_scope_resolver.py tests/test_scope_rules.py tests/test_board_permissions.py tests/test_dual_credentials.py tests/test_tenant_isolation.py tests/test_api_patient_profile.py tests/test_alarm_quality.py 2>&1 | tail -1
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/i18n/strings.test.js src/live/apiErrors.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✓ |^ +Tests |^ FAIL "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: `56 passed, 3 warnings in …`; then `230 passed, 108 skipped, 3 warnings in …`; then `apiErrors.test.js (144 tests)`, `strings.test.js (8 tests)`, `Tests  152 passed (152)` — the Cyrillic and the `ə` intact, and no test pins the old wording; then ` Test Files  89 passed (89)` and `      Tests  2441 passed (2441)` (the dashboard's count is Task 3's: this task adds no dashboard test). The whole no-DB suite after this task: `2375 passed, 654 skipped`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_scope.py dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `app.py CR=1256 LF=1256`, `test_api_scope.py CR=479 LF=479`, `apiErrors.js CR=299 LF=299`, `errors.js CR=369 LF=369`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_scope.py dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
fix(api): a scope that cannot be read is 503 — not "not found", and no false scope_denied row; the dashboard's sentence names no route (G2-A2)

_readable(scope) answers 503 «kapsam şu anda okunamıyor», the stream ticket's
own answer, when the resolver could not find out what a caller may see. It runs
in _require_patient right after the scope is resolved, before the check and the
audit row (D13), in /patients before the board is narrowed, and in /audit and
/alarm-quality before their restricted-scope 403, which a readable restricted
scope keeps (D13b). Trends' own check goes; its answers are unchanged. The 403
for a missing permission and the 400 for a malformed body still come first;
the device token is unscoped and gets its answer. The dashboard prints the 503
on acknowledge, chart and profile too, so errors.scopeUnreadable no longer says
the live stream did not start (×4).
On the branch: a697a4f, 1498489, 328e529 (the trends docstring).

red: 11 failed, 45 passed (the eight single-patient routes answered 404 «hasta
bulunamadı» and wrote scope_denied; /audit and /alarm-quality 403; /patients 200)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 6: `/ingest` patient ids — one rule for readings and identity

**Done on the branch** as `071f39e` (the first version's Task 6, byte for byte; its body's red: "15 failed, 53 passed (blank, whitespace and 129-character ids parsed; a non-object subject or non-string reference raised AttributeError; a padded id stayed padded; /ingest answered 200 to "Patient/" and 500 to subject "x"; a 129-digit protocol number was accepted)") and the rest of `328e529` (the Task 6 review's minors: the malformed-subject detail names the type it got, not the value — a 400 detail carries no value from the feed; the `PATIENT_ID_MAX` comment in `api/app.py` says bodies are not stripped; `edge/serialize.py`'s docstring says the round trip is lossless for ids that already meet D14). The blocks below are that code: replayed onto Task 5 they give the branch's `fhir.py`, `patient_identity.py`, `serialize.py`, `app.py`, `test_gateway_fhir.py` and `test_api_patient_identity.py` byte for byte. Two other details of `fhir.py` still echo a value (O18).

Spec D14 (with X5). `patient_id_from(value, *, what)` in `gateway/fhir.py`: the value must be a string; it is stripped; it must be non-blank and at most `PATIENT_ID_MAX` (128) characters; anything else is a `GatewayError` naming `what`, which `/ingest` already turns into a 400. `PATIENT_ID_MAX` moves here from `api/app.py:81`, which imports it for `_body_patient_id` (request bodies, unchanged: they are not stripped). A subject that is not an object is refused by its type, never its value (`malformed subject: expected an object, got str`; the Task 6 review), and `edge/serialize.py`'s round-trip promise names the ids it holds for. The callers: the Observation parser — where a non-object `subject` or a non-string `reference` is now a `GatewayError` too, not an `AttributeError` that `/ingest` answered with 500 (it catches only `GatewayError`) — and the Patient and Encounter parsers in `api/patient_identity.py`, each by one helper call in place of its own blank check; their messages keep naming the protocol number (`test_api_patient_identity.py:104`), and a protocol number past the cap is now refused by name. Observation ids are now stripped, as Patient and Encounter ids already were. **Shared ground with Lane B (B1a):** in `api/patient_identity.py` A2 changes only the two parse functions, one helper call each — and the module's import line, which has to name the helper (X5). History is not rewritten: old audit rows with padded ids replay as written. Path parameters are out of scope (spec §8). If Lane B asks A2 to cap only the Observation path (D14's fallback), drop the two `patient_identity.py` edits and the identity test; nothing else in this task depends on them.

**Files:**
- Modify: `homunculus-engine/tests/test_gateway_fhir.py` (tests appended), `homunculus-engine/tests/test_api_patient_identity.py` (one test)
- Modify: `homunculus-engine/src/homunculus/gateway/fhir.py` (`PATIENT_ID_MAX`, `patient_id_from`; the Observation's subject)
- Modify: `homunculus-engine/src/homunculus/api/patient_identity.py` (the import line; `parse_fhir_patient`'s and `parse_fhir_encounter`'s blank checks)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import; the constant leaves, a comment in its place)
- Modify: `homunculus-engine/src/homunculus/edge/serialize.py` (its docstring)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_gateway_fhir.py` — replace:
```python
        r = client.post("/ingest", content=body, headers=auth)
        assert r.status_code == 400 and "finite" in r.json()["detail"]
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []
```
with:
```python
        r = client.post("/ingest", content=body, headers=auth)
        assert r.status_code == 400 and "finite" in r.json()["detail"]
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []


# --- G2-A2 (D14): one patient-id rule for every resource /ingest takes ------------------------
#
# A blank id merged every reading that carried one into one pseudo-patient; a 129-character id is a
# feed error; a subject that is not an object raised AttributeError, which /ingest answered with
# 500. Each is a GatewayError now, and so a 400.

BAD_SUBJECTS = {
    "blank": {"reference": "Patient/"},
    "whitespace": {"reference": "Patient/   "},
    "129 characters": {"reference": "Patient/" + "p" * 129},
    "a number": {"reference": 7},
    "a null reference": {"reference": None},
    "a string subject": "x",
    "a list subject": ["Patient/bed-3"],
    "a null subject": None,
}


@pytest.mark.parametrize("subject", list(BAD_SUBJECTS.values()), ids=list(BAD_SUBJECTS))
def test_a_patient_id_that_is_not_one_raises_gateway_error(subject):
    bad = {**_fhir("lactate", 3.1), "subject": subject}
    with pytest.raises(GatewayError):
        parse_fhir_observation(bad)


def test_a_128_character_id_is_still_an_id_and_an_id_is_stripped():
    assert parse_fhir_observation(_fhir("lactate", 3.1, patient="p" * 128)).patient_id == "p" * 128
    assert parse_fhir_observation(_fhir("lactate", 3.1, patient="  bed-3 ")).patient_id == "bed-3"


def test_patient_id_from_is_the_one_rule():
    from homunculus.gateway.fhir import PATIENT_ID_MAX, patient_id_from
    assert PATIENT_ID_MAX == 128
    assert patient_id_from("  p-1 ", what="the id") == "p-1"
    with pytest.raises(GatewayError, match="missing the id"):
        patient_id_from("   ", what="the id")
    with pytest.raises(GatewayError, match="the id is longer than 128 characters"):
        patient_id_from("p" * 129, what="the id")
    with pytest.raises(GatewayError, match="the id is not a string"):
        patient_id_from(7, what="the id")


@pytest.mark.parametrize("name", ["blank", "129 characters", "a string subject", "a number"])
def test_the_ingest_door_answers_400_not_500_and_records_nothing(name):
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app

    auth = {"Authorization": "Bearer tok"}
    bad = {**_fhir("lactate", 3.1), "subject": BAD_SUBJECTS[name]}
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ingest", json=bad, headers=auth)
        assert r.status_code == 400, r.text
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []
        assert client.get("/patients", headers=auth).json()["patients"] == []
```

**Edit** `homunculus-engine/tests/test_api_patient_identity.py` — replace:
```python
def test_a_resource_of_the_wrong_type_is_refused():
```
with:
```python
def test_a_protocol_number_past_the_cap_is_refused_by_name():
    """G2-A2 (D14): readings and identity key alike — the Observation's cap is the identity's."""
    long = [{"system": "http://homunculus.local/protocol-no", "value": "9" * 129}]
    with pytest.raises(GatewayError, match=r"protocol number .* longer than 128"):
        parse_fhir_patient({**PATIENT, "identifier": long})
    with pytest.raises(GatewayError, match=r"protocol number .* longer than 128"):
        parse_fhir_encounter({**ENCOUNTER, "subject": {"reference": "Patient/" + "9" * 129}})
    longest = [{"system": "http://homunculus.local/protocol-no", "value": "9" * 128}]
    assert parse_fhir_patient({**PATIENT, "identifier": longest}).patient_id == "9" * 128


def test_a_resource_of_the_wrong_type_is_refused():
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_fhir.py tests/test_api_patient_identity.py 2>&1 | tail -1
```

Expected: `15 failed, 53 passed, 3 warnings in …` — the blank, whitespace and 129-character ids parse (`DID NOT RAISE GatewayError`), the number, null, string, list and null subjects raise `AttributeError`, the padded id is kept padded (`'  bed-3 ' == 'bed-3'`), `PATIENT_ID_MAX` is not the gateway's (`ImportError`), `/ingest` answers 200 to `"Patient/"` and to 129 characters and 500 (`Internal Server Error`) to a string subject, and a 129-digit protocol number is accepted.

- [ ] **Step 3: The rule, and its three callers**

**Edit** `homunculus-engine/src/homunculus/gateway/fhir.py` — replace:
```python
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""

```
with:
```python
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""


#: The longest patient id a door accepts (G2-A2, D14) — a device's id or the protocol number the
#: HIS keys a patient by. Here since G2-A2 so readings and identity key alike; `api/app.py` applies
#: it to request bodies too (`_body_patient_id`).
PATIENT_ID_MAX = 128


def patient_id_from(value: object, *, what: str) -> str:
    """The patient id `value` carries, stripped: a non-blank string of at most PATIENT_ID_MAX
    characters, else a GatewayError naming `what` (G2-A2, D14). A blank id merges every reading
    that carries one into one pseudo-patient, and an id past the cap is a feed error: neither may
    reach the engine, and neither may surface as a 500."""
    if not isinstance(value, str):
        raise GatewayError(f"{what} is not a string")
    patient_id = value.strip()
    if not patient_id:
        raise GatewayError(f"missing {what}")
    if len(patient_id) > PATIENT_ID_MAX:
        raise GatewayError(f"{what} is longer than {PATIENT_ID_MAX} characters")
    return patient_id

```

**Edit** `homunculus-engine/src/homunculus/gateway/fhir.py` — replace:
```python
    subject = resource.get("subject", {}).get("reference", "")
    if not subject.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {subject!r}")
    patient_id = subject.split("/", 1)[1]
```
with:
```python
    # G2-A2 (D14): a subject that is not an object, or a reference that is not a string, is the
    # feed's error (400), not an AttributeError (500); the id itself is `patient_id_from`'s.
    subject = resource.get("subject")
    if subject is not None and not isinstance(subject, dict):
        raise GatewayError(f"malformed subject: expected an object, got {type(subject).__name__}")
    reference = (subject or {}).get("reference", "")
    if not isinstance(reference, str) or not reference.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {reference!r}")
    patient_id = patient_id_from(reference.split("/", 1)[1], what="patient id in subject.reference")
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` — replace:
```python
from homunculus.gateway.fhir import GatewayError, to_utc
```
with:
```python
from homunculus.gateway.fhir import GatewayError, patient_id_from, to_utc
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` — replace:
```python
    if not patient_id:
        raise GatewayError(f"missing protocol number (identifier with system {PROTOCOL_SYSTEM})")
```
with:
```python
    patient_id = patient_id_from(   # G2-A2 (D14): the one rule /ingest keys by
        patient_id, what=f"protocol number (identifier with system {PROTOCOL_SYSTEM})")
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` — replace:
```python
    if not patient_id:
        raise GatewayError("missing protocol number (subject.reference)")
```
with:
```python
    patient_id = patient_id_from(   # G2-A2 (D14): the one rule /ingest keys by
        patient_id, what="protocol number (subject.reference)")
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
```
with:
```python
from homunculus.gateway.fhir import PATIENT_ID_MAX, GatewayError, parse_fhir_observation
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
PATIENT_ID_MAX = 128
```
with:
```python
# PATIENT_ID_MAX is the gateway's since G2-A2 (D14): a body's id and an ingested one are capped alike (bodies are not stripped).
```

**Edit** `homunculus-engine/src/homunculus/edge/serialize.py` — replace:
```python
accepts them unchanged. Round-trip is lossless: parse_fhir_observation(observation_to_fhir(o)) == o.
```
with:
```python
accepts them unchanged. Round-trip is lossless: parse_fhir_observation(observation_to_fhir(o)) == o,
for patient ids that already meet D14 (stripped, non-blank, ≤ 128).
```

- [ ] **Step 4: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_fhir.py tests/test_api_patient_identity.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_identity_ingest.py tests/test_api_ingest.py tests/test_api_scope.py tests/test_gateway_hl7.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_scenario_news2.py tests/test_patient_identity_postgres.py tests/test_edge_bridge.py tests/test_integration_e2e.py 2>&1 | tail -1
```

Expected: `68 passed, 3 warnings in …`; then `139 passed, 1 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2390 passed, 654 skipped` — every code and test file of the slice is now the branch's.

- [ ] **Step 5: Line ends, and Lane B's shared file**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/gateway/fhir.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/edge/serialize.py homunculus-engine/tests/test_gateway_fhir.py homunculus-engine/tests/test_api_patient_identity.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
git diff -U0 -- homunculus-engine/src/homunculus/api/patient_identity.py | grep -c '^@@'
```

Expected: `fhir.py CR=96 LF=96`, `patient_identity.py CR=436 LF=436`, `app.py CR=1256 LF=1256`, `serialize.py CR=25 LF=25`, `test_gateway_fhir.py CR=136 LF=136`, `test_api_patient_identity.py CR=271 LF=271`; and `3` hunks in `patient_identity.py` — the import line and the two parse functions, nothing else of Lane B's shared file (D14).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/gateway/fhir.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/edge/serialize.py homunculus-engine/tests/test_gateway_fhir.py homunculus-engine/tests/test_api_patient_identity.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
fix(ingest): one patient-id rule for readings and identity — stripped, non-blank, at most 128 characters, a 400 otherwise (G2-A2)

gateway/fhir.py patient_id_from(value, what=) is the rule and PATIENT_ID_MAX
moves there from api/app.py, which imports it for request bodies (D14). The
Observation parser uses it — a subject that is not an object or a reference
that is not a string is a GatewayError too, so /ingest answers 400 where it
answered 500, and the malformed-subject detail names the type, not the value
— and the Patient and Encounter parsers use it in place of their own blank
checks, keeping the protocol number in their messages. Observation ids are now
stripped, as identity ids were. In Lane B's shared patient_identity.py only the
import line and the two parse functions change.
On the branch: 071f39e, 328e529 (the rest).

red: 15 failed, 53 passed (blank, whitespace and 129-character ids parsed; a
non-object subject or non-string reference raised AttributeError; a padded id
stayed padded; /ingest answered 200 to "Patient/" and 500 to subject "x"; a
129-digit protocol number was accepted)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 7: The docs — the guide's NEWS2 note and unreadable scope, the roadmap row G2-A2

**Done on the branch** as `57c2d93` (the first version's Task 7, with the roadmap row's figures, its range `8c726fd..328e529`, X1–X10 and O1–O18 written in by the implementer, and the guide's sentence for X9 — a running alert is not ended by stale inputs) and the guide sentences of `64271db` (the final review: the held alert steps down to the lower band its stale values reach, never up; an expired oxygen or consciousness chart holds it like an old vital, and the pill names the last charted value; a hold ends when the input is not re-measured within 8 h of going stale; a device clock running ahead does not age the other readings); the roadmap row was brought up to date at the end of the slice (its range, the final counts, X1–X12, O1–O21, the acceptance at `64271db`), in the commit that carries this plan's second version. The blocks below give both documents byte for byte, the row's range left as `<range>`.

Spec §4 "Docs" (with X6). The guide is Turkish, so it quotes the tr texts («varsayıldı», "eski veri: SpO2 · 2 sa önce", «oda havası (son kayıt: oksijende, 9 sa önce)»); the board's default language says «fərz edildi» and "köhnə məlumat". The NEWS2 note (`docs/homunculus-rehber-TR.md`, "NEWS2 motorun") gains "eski veri skora girmez", the push, the alert's same score, the hold (X9–X12: not ended by a stale input, never up, down to the band its stale values reach, an expired chart holds too, at most 8 h after the input went stale), a device clock ahead (X10), «varsayıldı» with the last charted value (X11) and the 8 h; the patient-screen passage "Panoda olmayan bir hasta" gains one sentence for D13 — a scope that cannot be read is said so, not "not found" — which §4 did not list (X6). The roadmap's Group 2 table gains the row G2-A2 after G2-A1, with the slice's code range filled in Step 3. `Homunculus/wiki` is untouched: the windows, the 8 h and `HOLD_MAX_S` are operational defaults, not clinical claims (spec §4, adopted).

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (two passages)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A2)

- [ ] **Step 1: The guide**

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
    parametre 3 puan aldı" hapı motorun bildirdiği bir olgudur ve düzeyi değiştirmez.
  - **Motorun metinleri İngilizce.** Bulgu özetleri, gerekçe, öneriler ve kesinlik motorun yazdığı
```
with:
```markdown
    parametre 3 puan aldı" hapı motorun bildirdiği bir olgudur ve düzeyi değiştirmez.
    **Eski veri skora girmez** (G2-A2): penceresini aşmış bir ölçüm — solunum, SpO2, sistolik
    basınç ve nabız için 1 saat, ateş için 2 saat — toplama girmez, skor "kısmi" olur ve kartta
    hangi girdinin ne kadar eski olduğu yazar ("eski veri: SpO2 · 2 sa önce"; yaşı ekran söyler,
    "eski"ye motor karar verir). Yeni ölçüm gelmese de kart güncellenir: pencere kapanınca pano en
    geç ~20 saniye içinde yeniden gönderilir. Alarm da aynı skoru kullanır: eski bir ölçüm artık
    NEWS2'yi alarm bandına çıkaramaz. Çalışan bir NEWS2 alarmını da eski girdi bitiremez: alarm
    son puanlandığı gibi kalır, eski bir değerle yükselmez; eski değerlerin hâlâ ulaştığı daha
    düşük banda iner, hiç yukarı çıkmaz; okumalar — eskiler son değerleriyle sayılarak — bandın
    altına inince biter. Süresi dolan bir oksijen ya da bilinç kaydı da alarmı eski bir vital gibi
    tutar; tutma sınırsız değildir: girdi eskidikten sonra 8 saat içinde yeniden ölçülmezse alarm
    biter. Saati ileri giden bir cihazın ölçümü öbür okumaları eskitmez.
    **Oksijen ve bilinç kaydedilmemişse varsayılır, söylenerek:**
    oda havası ve uyanık sayılır, kartta «varsayıldı: oda havası, uyanık» hapı çıkar; skor bunun
    için "kısmi" sayılmaz. Kaydedilmiş bir oksijen ya da ACVPU değeri 8 saat (bir vardiya) geçerlidir;
    sonra yeniden varsayılır ve hap son kaydı değeriyle söyler («oda havası (son kayıt: oksijende,
    9 sa önce)», «uyanık (son kayıt: U, 9 sa önce)») — süresi dolan "oksijen alıyor" toplamdan 2
    puan, V/P/U 3 puan düşürür. Pencereler ve 8 saat işletme varsayılanıdır, klinik iddia değildir;
    bir klinik değerlendirme değiştirene kadar böyledir. "Yeni konfüzyon" ayrıca modellenmez:
    ACVPU'da uyanık dışındaki her değer 3 puandır.
  - **Motorun metinleri İngilizce.** Bulgu özetleri, gerekçe, öneriler ve kesinlik motorun yazdığı
```

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
  okunamadıysa bunu söyler. Açılan her hasta denetim kaydına bir "görüntüleme" satırı bırakır;
  gösterilemeyen bir hasta için hiçbir şey yazılmaz.
```
with:
```markdown
  okunamadıysa bunu söyler. Kapsamınız o an okunamıyorsa (veritabanı yanıt vermiyor) sunucu
  "bulunamadı" demez, "kapsam şu anda okunamıyor" der ve denetim kaydına bir kapsam ihlali yazmaz
  (G2-A2); pano da "Sunucuya bağlantı yok" şeridini gösterir. Açılan her hasta denetim kaydına bir
  "görüntüleme" satırı bırakır; gösterilemeyen bir hasta için hiçbir şey yazılmaz.
```

- [ ] **Step 2: The roadmap row**

**Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — replace:
```markdown
X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |
```
with:
```markdown
X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |
| G2-A2 | Motor borcu: NEWS2 tazeliği — penceresini aşan ölçüm (vital 1 sa, ateş 2 sa) skora girmez, skor kısmi olur, kart hangi girdinin ne kadar eski olduğunu yazar, pencere kapanınca pano yeniden gönderilir; kaydedilmemiş oksijen ve bilinç «varsayıldı» diye işaretlenir (kısmi sayılmaz; kayıt 8 sa geçerli; süresi dolan kaydın son değeri hapta yazar); alarm da aynı skoru kullanır ve çalışan bir NEWS2 alarmını eski girdi bitiremez (tutulur, yalnız aşağı iner, girdi eskidikten en geç 8 sa sonra biter); bir okuma hiçbir kapıda duvar saatinden ileride değerlendirilmez, yeniden başlatmada da; denetim okumaları en yeni satırlardan (`/audit` en çok 1000, `/alarm-quality` penceresini veritabanına sorar ve `truncated` der), yeniden başlatma her satırı sayfa sayfa okur ve yalnız bitince kurulur; okunamayan kapsam 503 (sahte `scope_denied` satırı yok); `/ingest` hasta kimliği tek kural (kırpılır, boş olamaz, en çok 128, aksi 400) · spec: [2026-10-25](../specs/2026-10-25-g2a-motor-borcu-design.md) · plan: [G2-A2](2026-10-25-g2a-motor-borcu.md) | Kod ✅ 2026-10-26 · <range> · **VM'de değil** (spec §7: grubun kapısı ve sahibin Q2/D6/D8 onayı; api ve web aynı sürümde, web tek başına geri alınmaz; göç yok; ilk açılışta tenant'ın ilk isteği tüm denetim kaydının yeniden oynatılmasını bekler — VM'de önce satırlar sayılır; VM'den önce O17). Backend 2390 / 654 (DB'siz), Postgres denetim ve kimlik testleri 54; Python 3.14 dilimi 363 (13 test dosyası); dashboard 89 dosya / 2441 test; derleme 20 öğe. Kabul (spec §6.1, 6.2, 6.3, 6.5) `64271db`'nin geliştirme sunucusunda geçti — SQLite denetim, gerçek yeniden başlatma (5214 satır, iki sayfa; pano aynı), sentetik yataklar, iki itme pencere kapandıktan 9 sn sonra; §6.4 (okunamayan kapsam) ve tarayıcı yürüyüşü Docker yığınında kullanıcıyla. **Açık:** X1–X12 (plandaki X1–X8 ve incelemelerde bulunanlar — X1: kısmi notu eski girdiyi de sayar; X2: kartın tamamı tek anda, antibiyotik saati ve eskalasyon yayını dahil; X3: sekizinci metin `assumedLast`; X4: kart saati üç ekrandan alır; X5: `patient_identity.py`'de içe aktarma satırı da; X6: rehberde kapsam cümlesi; X7: kabulün §6.4'ü Docker yığınında kullanıcıyla; X8: en yeni N bellekte sayıyla kesilir, sınırlar 1'den; X9: eski girdi çalışan NEWS2 alarmını bitiremez; X9b: tutulan alarm eski değerle yükselmez; X9c: eski değerler son hâlleriyle bile bandın altına inince biter; X9d: eski değerlerin ulaştığı alt banda iner, hiç çıkmaz; X9e: NEWS2 hasta başına geri gitmeyen bir anda değerlendirilir; X10: kapılar okumayı min(damga, duvar saati) anında değerlendirir; X10b: yeniden başlatma min(damga, satırın yazıldığı an) anında; X11: süresi dolan oksijen/ACVPU kaydı alarmı eski vital gibi tutar, hap son değeri yazar; X12: tutma, girdi eskidikten en çok 8 sa sürer) ve O1–O21 (O2: Q2/D6/D8 VM'den önce sahibin onayı; O5: `/ingest`'in hasta kimliği dışındaki bozuk alanları hâlâ 500; O17: reddedilen bir gözlem köprüyü durdurabilir — VM'den önce; O20: tutulan alarm kartta ve alarm listesinde işaretsiz; O21: yeniden başlatmadan sonra çalışan acil alarm hemşireye bir kez daha bildirilir); az/ru/en metinleri yerel okuma bekliyor |
```

- [ ] **Step 3: The range**

```bash
cd /c/tmp/g2a-a2
git log --reverse --format=%h f5b3a8b..HEAD -- homunculus-engine dashboard | sed -n '1p;$p'
```

It prints two short hashes: Task 1's and the last commit that touched the code (Task 6's, when the tasks are committed as written). The range starts at `f5b3a8b`, the merge of main: from the spec's `e1d23d8` it would also list main's merged commits (the NBP slice, G2-A1), and the first hash would be `cbda9ff`, not Task 1's. **Edit** the roadmap: replace `<range>` with `<first>..<last>`. On the branch the range is `8c726fd..64271db` (the last code commit is the final review's `64271db`, which also carries two comments of `api/app.py`). If a review changed the counts, write the counts Task 8 measures instead of the ones in the row.

- [ ] **Step 4: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
grep -c "^| G2-A2 " docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; grep -c "<range>" docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
```

Expected: `homunculus-rehber-TR.md CR=1197 LF=1197`, `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md CR=1295 LF=1295`; then `1` and `0`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g2a-a2
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
docs(guide): old data stays out of NEWS2, a running alert is held, not ended, by it, what was assumed is marked, an unreadable scope is said so; the roadmap row G2-A2

The guide's NEWS2 note: a reading past its window is out of the total and the
card says how old it is; the board is pushed when a window closes; the alert
uses the same score, and a running alert is not ended by stale inputs — it
keeps its score or steps down, never up, to the band its stale values reach,
an expired oxygen or consciousness chart holds it too, and it ends when the
input is not re-measured within 8 h of going stale; a device clock running
ahead ages nothing; room air and Alert are assumed with a «varsayıldı» mark,
not counted partial, a charted value speaks for 8 h and the pill names the last
charted value. The patient-screen passage: a scope that cannot be read is
"kapsam şu anda okunamıyor", not "not found", and writes no violation (X6). The
roadmap's Group 2 table gains G2-A2.
On the branch: 57c2d93, 64271db (the guide), and the row's final state with this plan.

red: none (docs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 8: The gates, and the acceptance

Everything runs once more, in full, at the branch head; then the spec's §6 acceptance. **As run (X7):** §6.1, 6.2, 6.3 and 6.5 on the engine's own dev server, from a `git archive` export of the head, with a real stop and start between the two phases — Steps 6–8 below. §6.4 forces an unreadable scope by renaming the `staff_scopes` table, which needs the Postgres scope reader and a signed-in clinician: only the local synthetic Docker stack has both, and its container names (`homunculus-postgres`, `-api`, `-web`) were held by another stack — Steps 9–12 stay for the walk with the user and were **not run**. Never on the VM: the deploy and the VM acceptance with the user are a later, separate step (spec §7, O2, O8, the deploy notes). No repo file changes in this task.

**The record, twice.** The gates and the acceptance ran first at `57c2d93`, when the branch's Tasks 1–7 were done: engine `2372 passed, 654 skipped`; Postgres `54 passed`; Python 3.14, the first version's eleven files, `307 passed, 4 skipped`; dashboard `89` files / `2437` tests; build `precache  20 entries (846.08 KiB)`; `git diff --stat 477b2fa 57c2d93` `37 files changed, 1683 insertions(+), 121 deletions(-)`; `lane B seams touched: 0`; `patient_identity.py hunks: 3`; and the acceptance on the dev server at port 18182, with a real restart at 5214 audit rows:
```
1 stale: total=2 partial=True stale=['temperature'] temperature points=0 measured 2 h 05 min ago
1 fresh at ingest: total=2 stale=[] fresh_until in 60 s
2 assumed: total=0 assumed=['air_or_oxygen', 'consciousness']; oxygen charted 7 h 55 min ago -> total=2 assumed=['consciousness']
5 ingest ids: 'Patient/' -> 400, 129 characters -> 400, subject "x" -> 400
3 audit: 200 rows, the tail of the newest 1000: True; the newest ingest row is the last reading: True
1 pushed: stale=['spo2'] total=0 8 s after its window closed
2 pushed: assumed=['air_or_oxygen', 'consciousness'] total=0 8 s after the 8 h boundary
3 digest of 4 beds written; readings posted for G2A2-4: 2600
audit rows: 5214
3 after restart: the board is identical: True
```
§6.4 and the browser walk were not run (X7). The final review then added `3a64e74`, `6676d5f`, `ea236ef`, `0948068`, `ecd5017` and `64271db`, and everything was **measured again at `64271db`** — the gates in the worktree (a checkout), the acceptance from an export on a free port (18183), with a real restart. **The figures in the steps below are that second run, the record.**

- [ ] **Step 1: The engine, no database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2390 passed, 654 skipped, 3 warnings in …` (2 min 11 s at `64271db`) — the base's 2272 plus this slice's 118; the 4 new skips are `test_audit_newest.py`'s Postgres tests (Step 2 runs them). In a `git archive` export: `4 failed, 2386 passed` — the four tests that build a release from git.

- [ ] **Step 2: The Postgres-backed tests** (the command line only — never export the variable; the lock may make it wait, Task 0 Step 4)

```bash
cd /c/tmp/g2a-a2/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py tests/test_audit_since.py tests/test_audit_postgres.py tests/test_patient_identity_postgres.py 2>&1 | tail -1
ls alembic/versions/*.py | tail -1
```

Expected: `54 passed in …` (the base's 34 and `test_audit_newest.py`'s 20); then `alembic/versions/0011_users_must_change_password.py`, the base's newest migration — this slice adds none (spec §7). (The `*.py` keeps an ignored `__pycache__` out of the listing.)

- [ ] **Step 3: Python 3.14, the thirteen touched engine test files**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py tests/test_api_board_news2.py tests/test_board_freshness.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_audit_newest.py tests/test_api_audit.py tests/test_rehydrate.py tests/test_api_scope.py tests/test_gateway_fhir.py tests/test_api_patient_identity.py 2>&1 | tail -1
```

Expected: `363 passed, 4 skipped, 3 warnings in …` (the first version's eleven files alone: `325 passed, 4 skipped`; at `57c2d93` they were `307`).

- [ ] **Step 4: The dashboard suite and build**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2441 passed (2441)`; then `✓ built in …`, `precache  20 entries (846.78 KiB)` at `64271db` (in an export, whose build has no commit to name: 846.85 KiB), no `larger than`.

- [ ] **Step 5: The slice's size, and Lane B's seams**

```bash
cd /c/tmp/g2a-a2
git diff --stat f5b3a8b HEAD -- . ':!docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md' | tail -1
S="homunculus-engine/src/homunculus/admission homunculus-engine/src/homunculus/escalation homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/tenant homunculus-engine/src/homunculus/auth dashboard/src/live/i18n/catalog.js dashboard/src/live/shell/routes.js dashboard/src/live/i18n/strings.test.js"
echo "lane B seams touched: $(git diff --name-only f5b3a8b HEAD -- $S | wc -l) $(git diff --name-only f5b3a8b HEAD -- $S)"
echo "patient_identity.py hunks: $(git diff -U0 f5b3a8b HEAD -- homunculus-engine/src/homunculus/api/patient_identity.py | grep -c '^@@')"
git status --short
```

Expected: `38 files changed, 2185 insertions(+), 127 deletions(-)` — the slice's code, test and doc files, this plan excluded (at `57c2d93` it was 37 files, `+1683/−121`); then `lane B seams touched: 1 dashboard/src/live/i18n/strings.test.js` — X11's one lane-marked test (`// G2-A2 X11`, beside Lane B's own; the controller tells Lane B, O9); `patient_identity.py hunks: 3`; and no status line.

- [ ] **Step 6: The acceptance script** — `/c/tmp/homunculus-plans/g2a-a2/acceptance.py` (outside the repo, standard library only; read it before running it). It writes made-up readings for four synthetic beds through `/ingest` — `G2A2-1` (five fresh readings and a temperature 2 h 05 min old), `G2A2-2` (an SpO2 59 min old), `G2A2-3` (fresh vitals, then oxygen charted through `/clinical` 7 h 55 min ago), `G2A2-4` (2600 readings: more audit rows than one replay page) — plus three `/ingest` bodies whose patient id is not one; it listens to `/stream` for the two pushes and reads `/patients` and `/audit`. The token comes from `HOMUNCULUS_TOKEN` and is printed nowhere. **Never point it at the VM or any stack holding a real patient.** The first phase takes about five minutes: it waits for the oxygen's 8 h boundary.

- [ ] **Step 7: The dev server, from an export of the head, and the first phase** (X7). The export keeps the worktree untouched; the dev server's SQLite audit lives in its own folder, synthetic, deleted afterwards. Any free port will do: the record ran on 18183.

```bash
EXP=/c/tmp/g2a-a2-accept && mkdir -p $EXP/srv
git -C /c/tmp/g2a-a2 archive HEAD homunculus-engine | tar -x -C $EXP
cd $EXP/srv
PYTHONPATH=$EXP/homunculus-engine/src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 18183 --log-level warning
```

(in the background: it is a server, not a gate; its token is the dev server's own `dev-token`; its escalation cycle runs every 20 s, which is what pushes). When `curl -s http://127.0.0.1:18183/health` answers `{"status":"ok"}`:

```bash
cd /c/tmp/homunculus-plans/g2a-a2
HOMUNCULUS_TOKEN=dev-token PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18183 before-restart
```

Expected — the record, from an export of `64271db` (2026-10-26, 5 min 12 s):
```
1 stale: total=2 partial=True stale=['temperature'] temperature points=0 measured 2 h 05 min ago
1 fresh at ingest: total=2 stale=[] fresh_until in 60 s
2 assumed: total=0 assumed=['air_or_oxygen', 'consciousness']; oxygen charted 7 h 55 min ago -> total=2 assumed=['consciousness']
5 ingest ids: 'Patient/' -> 400, 129 characters -> 400, subject "x" -> 400
3 audit: 200 rows, the tail of the newest 1000: True; the newest ingest row is the last reading: True
1 pushed: stale=['spo2'] total=0 9 s after its window closed
2 pushed: assumed=['air_or_oxygen', 'consciousness'] total=0 9 s after the 8 h boundary
3 digest of 4 beds written; readings posted for G2A2-4: 2600 (an ingest and an alert row each)
```
— §6.1: the temperature's point is out of the total, the score partial, the input named with its age; the 59-minute reading turned stale on the stream with no reading of ours to carry it, within one cycle (≤ 20 s) of its window closing (D5); §6.2: room air and Alert assumed and named; oxygen charted 7 h 55 min ago adds 2 and the mark goes; at 8 h it is pushed back, the 2 points gone (D8); §6.5: each bad id is a 400; §6.3's first half: `/audit` answers the newest rows. The seconds after a boundary vary between 0 and 20 with where the cycle falls (8 s at `57c2d93`, 15 s in the first version's run).

- [ ] **Step 8: Stop the server, start it again in the same folder, the second phase.** Stop it (the background task), confirm the log holds more than one replay page, start the same command again from `$EXP/srv` (the SQLite audit is the restart's event log), and when `/health` answers:

```bash
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import sqlite3; c = sqlite3.connect('C:/tmp/g2a-a2-accept/srv/homunculus-audit.db'); print('audit rows:', c.execute('select count(*) from audit').fetchone()[0])"
cd /c/tmp/homunculus-plans/g2a-a2
HOMUNCULUS_TOKEN=dev-token PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18183 after-restart
```

Expected — the record: `audit rows: 5214` (more than `REHYDRATE_PAGE`, 5000: the restart read two pages), then `3 after restart: the board is identical: True` — §6.3's second half: every bed's risk, alerts (kind, acknowledgement, first-seen, latch), values and NEWS2 stamps rebuilt as they were. Stop the server; delete `/c/tmp/g2a-a2-accept` (an export and a synthetic audit — nothing of the repo) and `/c/tmp/homunculus-plans/g2a-a2/acceptance-digest.json`.

- [ ] **Step 9: With the Docker stack, when its names are free — not run (X7).** G1-15's synthetic stack files, as the G2-01 walk used them (`/c/tmp/g115plan/stack/{local.env, compose.g115.yml}`). The containers are named by the compose file, so no other such stack may be up:

```bash
cd /c/tmp/g2a-a2
ls /c/tmp/g115plan/stack/local.env /c/tmp/g115plan/stack/compose.g115.yml
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"
```

Expected: both files; `no stack containers`. **If a container is listed, stop and ask** — it is another session's. Then:

```bash
cd /c/tmp/g2a-a2
C="docker compose -p g2a2 -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py
```

Expected: `Image g2a2-api Built`, `precache  20 entries …`, `Image g2a2-web Built`; three containers started; `docker inspect -f '{{.State.Health.Status}}' homunculus-api` → `healthy`; the seed prints its synthetic accounts (none of them a person). Steps 7 and 8's two phases run against `http://127.0.0.1:18080` with `HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-)` and `$C restart api` between them; they print the same lines.

- [ ] **Step 10: §6.4, an unreadable scope — the Docker stack only, never the VM — not run (X7).** Rename the table only the scope reader reads (`read_scope_for_user` → `read_grants`), so the clinician's token still resolves but the scope does not; the resolver then logs `scope lookup failed … refusing rather than widening` and returns UNKNOWN (`scope/resolver.py:64–73`). The clinician's token goes into a shell variable and is printed nowhere.

```bash
docker exec homunculus-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER TABLE staff_scopes RENAME TO staff_scopes_off"'
CLIN=$(/c/tmp/f7-py312/venv/Scripts/python.exe -c "import json, urllib.request; r = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18080/auth/login', data=json.dumps({'login': 'test.hemsire', 'password': 'G115-Sentetik-Parola-1'}).encode(), headers={'Content-Type': 'application/json'})); print(json.load(r)['access_token'])")
cd /c/tmp/homunculus-plans/g2a-a2
HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-) HOMUNCULUS_CLINICIAN_TOKEN=$CLIN PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18080 unreadable-scope
docker logs homunculus-api 2>&1 | grep -c "refusing rather than widening"
docker exec homunculus-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER TABLE staff_scopes_off RENAME TO staff_scopes"'
```

Expected: `ALTER TABLE`; then `4 unreadable scope: /patients -> 503 'kapsam şu anda okunamıyor'; /alerts/G2A2-1 -> 503 'kapsam şu anda okunamıyor'; device /patients -> 200; scope_denied rows: 0`; a count of at least 1; `ALTER TABLE`. **Rename it back even if a line fails.** An undecodable token does not reach this path on the real stack — it is a 401 earlier, in the caller's own resolver — which is why the table is renamed rather than the token spoiled (spec §6.4).

- [ ] **Step 11: By eye, in a browser — not run (X7).** Open `http://127.0.0.1:18080`, sign in as `test.hemsire` (the seed's password). **Çarpayılar**: `G2A2-1`'s card reads `NEWS2: 2` with «QISMƏN» and the line "köhnə məlumat: temperatur · 2 saat əvvəl" (the age goes on counting); `G2A2-3`'s pill reads "fərz edildi: otaq havası (son qeyd: oksigendə, 8 saat əvvəl), oyaq" (the pill writes upper case, and wraps on the card, X11 and the Task 3 review). Run Step 7's first phase again and watch `G2A2-2` turn stale with no reload, about a minute after the post. With Step 10's table renamed, reload: the strip says "Serverlə bağlantı yoxdur — xəstə siyahısı göstərilmir …" (UNAVAILABLE), not an empty ward; an acknowledge on the alarms screen then says "Giriş əhatəniz hazırda oxuna bilmir; bir az sonra yenidən cəhd edin." (the Task 5 review). Dil: tr, ru, en — «varsayıldı: oda havası, uyanık», «по умолчанию: комнатный воздух, в сознании», «assumed: room air, alert».

- [ ] **Step 12: Tear it down.** `$C down -v` → the three containers and the `g2a2` volumes removed; `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`.

No commit: nothing in the repo changed.

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 0 worktree, junction, baseline | — | — | — |
| 1 the engine: NEWS2 counts a reading only inside its window, says what it assumed; the alert scores the same; a running alert is held, not ended, by a stale input (D1, D2, D6–D9, X1, X9–X12) — **done** (`8c726fd`, `ce436fb`, `b5925bb`, `e0f8687`, `3a64e74`, `6676d5f`, `0948068` engine, `ecd5017`, `64271db` a comment) | 0 | 3 | — |
| 2 the board: judged at the wall clock, `stale`/`assumed`/stamps/`last_charted`, the cycle's push; the doors' and the replay's instant (D3–D5, X2, X10, X10b) — **done** (`cd2eaec`, `d437600`, `ea236ef`, `0948068` board, `64271db` comments) | 1 (`score(state, now)`, `fresh_until`; the X10b test reads the hold) | 3 | `api/app.py` (4, 5, 6); `rehydrate.py`, `test_rehydrate.py` (4) |
| 3 the dashboard: the stale line with ages, the «varsayıldı» pill with the last charted value (D10, X3, X4, X11) — **done** (`a8d97c6`, `90b3ed9`, `0948068` dashboard) | 0 (it reads only the payload's shape: `stale`, `assumed`, `measured_at`, `last_charted`) | 1, 2, 4, 5, 6 | — |
| 4 the audit reads: newest N, every row a page at a time, installed when it finished (D11, D12, X8) — **done** (`b418759`, `74e1a40`) | 2 (`api/app.py`, `rehydrate.py`, `test_rehydrate.py`, serially) | 3 | `api/app.py` (5, 6) |
| 5 an unreadable scope is 503; the dashboard's sentence names no route (D13, D13b) — **done** (`a697a4f`, `1498489`, `328e529` the trends docstring) | 4 (`api/app.py`, serially) | 3 | `api/app.py` (6) |
| 6 `/ingest` patient ids (D14, X5) — **done** (`071f39e`, `328e529` the rest) | 5 (`api/app.py`, serially) | 3 | — |
| 7 docs: the guide, the roadmap row (X6) — **done** (`57c2d93`, `64271db` the guide; the roadmap row's final state with this plan) | 1–6 (the range and the counts it quotes) | — | — |
| 8 gates, the acceptance (X7) — **done** at `57c2d93` and, the record, at `64271db` | 1–7 | — | — |

**Why this order.** The engine before the board: the board publishes what `score(state, now)` returns, and Task 2's tests read `stale` and `fresh_until` (and its replay test reads Task 1's hold). The dashboard depends on the payload's shape only, so it can be built beside the engine tasks. Tasks 2, 4, 5 and 6 all edit `api/app.py`, each in its own functions (the escalation cycle and the doors' instant; the audit routes and `_ensure`; `_require_patient`, `/patients`, trends and the whole-trail routes; the import and the constant), and Tasks 2 and 4 both edit `rehydrate.py` and `test_rehydrate.py` — but neighbouring lines (the import lines of `api.board` and `api.audit`; X10b's test at the end of `test_rehydrate.py`, Task 4's above it) would have to be resolved by hand in a merge of two parallel branches, and every block's old text was asserted unique against the file **as the earlier tasks left it**. So they run serially; the engine's other files are not shared between tasks.

**Waves, if run in parallel:** A = {1 → 2 → 4 → 5 → 6} beside B = {3}; then 7, 8. The plan was measured in the serial order 0 → 8; a parallel merge must re-run Task 8's gates on the merged head.
