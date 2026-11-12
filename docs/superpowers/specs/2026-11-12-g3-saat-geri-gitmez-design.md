# G3-06 · Saat geri gitmez — time-based rules never go backwards on a back-dated reading — design

**Date:** 2026-11-12 · **Branch:** `feat/g3-saat-geri-gitmez` (from main `88f6544c`) · **Migration:** none
**Status:** the owner approved the design on 2026-11-12 (§2 D1–D7; D2's anchor «ölçüm saatinden»). This written
spec waits for the owner's «evet»; the implementation plan follows it. Group 3, slice 6 (the number is free on the
roadmap, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`). Code references were read at
`88f6544c`.
**Amends:** G2-A2 X9e (and the wording of X10 and X10b), G3-01 D10 and D12, G2-A1 X12's restore test. Closes G3-05
§11.5 open item (a) and most of (c). G3-01 D7 (the 24 h back-dating bound) and G3-05 D12 as amended (a link is
judged at the wall clock) stay as they are.

## 1. Why

A reading can reach the engine hours after it was measured: a Connex round the device buffered and sends late to
`/ingest`, a set charted at its own time at the bedside, or the corrected value «Düzelt» charts at the reading's
time after a «hatalı giriş» (G3-05 D13). Reviewers reproduced the harm twice. Here is the timeline:

- At +0 sepsis is recognised and the antibiotic hour starts. At +120 the board shows `antibiotic_overdue`.
- A reading stamped −240 then arrives. It is judged at −240, and the clock reads `antibiotic_due` «300 min
  remaining» (`antibiotic_clock.py:28–29`: the deadline +60 minus a "now" of −240). The overdue recommendation is
  replaced by false reassurance.
- The lifecycle hook (`alert_lifecycle.sync_alerts`, `:96–126`) then ends the `antibiotic_overdue` episode. If the
  episode was acknowledged, its acknowledgement and first-sight stamp are pruned with it (`:124–125`). The next
  current reading raises it again as a **new** episode: a new first sight, a new nurse notification and a new
  escalation chain.

What main does today:

- **Each door hands the engine `min(stamp, wall clock)` (G2-A2 X10).** `/ingest` does it through `_apply_reading`
  (`api/app.py:1859`) and `/clinical` through `chart_observations` (`api/clinical.py:373`). The replay hands it
  `min(stamp, the row's write time)` (`api/rehydrate.py:124`, X10b). A linked reading is the exception: it is judged
  at the link's wall clock (`app.py:962–967`, G3-05 D12 as amended).
- **`Engine.ingest` floors only NEWS2** (`pipeline.py:88–178`). NEWS2, the patient-relative layer and the hold are
  judged at `max(now, the last NEWS2 judgement)` (`:97–109`, `:166`; X9e, `_news2_judged_at`, `:60–61`). Everything
  else takes `now` as given (the comment at `:101–102` says so):
  - septic shock, sepsis and the 3 h fluid window (`:96`; `septic_shock.py:37–42`, `:136–138`);
  - the antibiotic anchor's set, drop and restore (`:130–138`);
  - the antibiotic clock (`:140–142`);
  - the model (`:145–146`; `model/scorer.py:32–38`).
- **A withdrawal leaves the alerts as of the last remaining row.** «Hatalı giriş» (`retract_entry`,
  `app.py:1451–1587`) rebuilds the patient into a scratch engine (`:1534–1535`, `rehydrate.rebuild_patient`,
  `:351–367`). It hands that engine over (`_adopt_rebuilt`, `:1409–1430`: `engine.adopt` `:1416`, then the hook at
  the request's instant `:1417`). The alerts the hook compares are the scratch engine's last evaluation, so they are
  judged at the last remaining row's instant.
  - The reviewers' scenario: a MAP at −90 completes sepsis and starts the hour, a temperature at −5 is judged
    overdue, and the temperature is withdrawn. The rebuild ends on the MAP row («60 min remaining»), and the overdue
    ends or latches.
- **A latent bug sits in the anchor's restore test** (`_new_anchor`, `pipeline.py:266–272`). It compares the
  requested instants of the drop and of the new recognition: `(now - dropped_at) <= ANCHOR_RESTORE_S` (`:270`).
  - A recognition requested before the drop's instant gives a negative difference. A negative difference passes the
    900 s test, so the dropped anchor is restored however long ago the rule-out was.
  - The result: a new infection inherits the old episode's anchor and the doses given since it. That is the outcome
    G2-A1 X12's review ruled out (`test_pipeline.py:235–250`).
- **The shadow lane** (`api/infinity_rules.py`) judges a mirrored reading at `min(stamp, wall)` in its own engine
  (`:486`). It only had NEWS2's floor, copied from the real engine (G3-05 §11.5 (c)).

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One floor per patient for every rule.** At the top of each evaluation the engine computes `at = max(now, self._judged_at.get(pid, now))` and stores `at`. Every rule that takes an instant gets `at`: septic shock, sepsis and the 3 h fluid window, the anchor's drop and restore test (D2), the antibiotic clock and the model. NEWS2, the patient-relative layer and the hold already do. `_news2_judged_at` is renamed `_judged_at` and stays in `_PER_PATIENT`, so `forget`, `copy` and `adopt` carry it. **The values keep their own timestamps**: the state stores a reading at its stamp, freshness is measured from each reading's stamp, and trends, the readings record, the vital task and the audit's `obs_ts` are untouched. The engine never reads a clock. `at` is only ever an instant a caller asked for, so a back-dated reading is judged at the patient's last judged instant, not at the wall clock. | One instant per patient, so no rule can disagree with another about "now". X9e already proved the pattern on NEWS2. A late value is information about the past; it is no reason to judge the present as if it were the past. |
| D2 | **Anchor of a recognition that a back-dated reading completes: the measurement time (owner: «ölçüm saatinden»).** The anchor is the *requested* instant, the `now` the caller passed before flooring. At the doors that is the reading's stamp (`min(stamp, wall)`). The clock is judged at `at`. A recognition completed by a reading measured 6 h ago, on a patient judged up to now, shows `antibiotic_overdue` at once. A patient's first evaluation has no floor (`at` = the requested instant), so a fresh patient is judged exactly as today. **The restore rule, exactly:** (1) a drop is remembered with the dropping evaluation's floored instant, `_dropped_anchor[pid] = (anchor, at)`; (2) a recognition restores the dropped anchor if and only if `0 <= (at - dropped_at).total_seconds() <= ANCHOR_RESTORE_S`, where `at` is the recognising evaluation's floored instant; (3) otherwise its anchor is its requested instant, and the remembered drop is spent either way, as today. Within one engine the floor never goes back, and `forget`, `copy` and `adopt` move `_judged_at` and `_dropped_anchor` together, so the difference is never negative. The `0 <=` is written out as a guard. | The owner's choice. The engine's anchor is already the requested instant (`pipeline.py:134`); what changes is the instant the clock is read at. Time zero is an open question in the vault (`Homunculus/wiki/concepts/antimicrobial-timing-sepsis.md`, «Time-zero must be defined and defensible»), so this is an operational rule, not a clinical claim. The restore window measures how far apart a toggle and its correction were (X12). Floored instants measure that in the engine's own one-way time. Requested instants do not, which is the latent bug (§1). |
| D3 | **A withdrawal re-judges at its own instant.** There is a new method `Engine.rejudge(patient_id, now)`. It runs the same evaluation as `ingest`, adds no reading, uses the instant `max(now, floor)` and returns the alerts. A patient the engine does not hold answers `[]` and is not created. `_adopt_rebuilt` calls it right after `engine.adopt` and before the hook, with no `await` in between (`app.py:1416–1417`). This is what makes the restart agree (D4): **the trail-replayers re-judge at every `chart_retract` row.** `rehydrate` rejudges there at the row's write time and runs the hook at that same write time. `rebuild_patient` rejudges at the patient's earlier withdrawals: the route already reads them (`app.py:1512–1513`). G3-01 D10's «as if never charted» still holds for the state, the anchor and the profile. **The alerts are judged at the withdrawal's instant.** So a withdrawal can bring up an alert the clock has reached since the last reading: an `antibiotic_due` whose hour has run out is `antibiotic_overdue` after the withdrawal. It is stamped and told to the nurse like any alert a withdrawal uncovers (G3-01 X3, `_stamp_uncovered`, `_tell_uncovered`). | The reviewers' scenario: without this the rebuild ends at «60 min remaining» and the overdue ends or latches. Without the replay's half, a restart after the withdrawal would bring the «60 min remaining» back. |
| D4 | **The doors do not change.** X10's `min(stamp, wall)` at `/ingest` and `/clinical` stays as it is; it is now the *requested* instant, and the engine floors it. The link's `judge_at=wall_now` (G3-05 D12 as amended) stays too: a recognition that a linked reading completes is anchored at the link's time, as today. The replay (`rehydrate._replay_ingest`, in id order) hands each row its requested instant: `min(stamp, written)`, or `written` for a linked row (X10b). The floor therefore rises in the replay as it rose live, and with D3 a restart equals live to within the request. The hook's instant does not change anywhere: the request's wall clock at the doors and the withdrawal, and the row's write time in the replay. | The floor belongs to the engine. The doors keep saying what they ask for, and the trail keeps recording it. |
| D5 | **Shadow lane: no code change.** `Engine.copy` carries `_judged_at` (the install starts the shadow engine from the real engine's floor, `infinity_rules.py:395`), so `mirror_observation` (`:486`) and `sample` (`:611`) can no longer go back. `_settle`'s `adopt` (`:640–644`) resets an unlinked patient to the real engine's floor, which is right: the patient goes back to the real picture. The lane never writes the real engine (`adopt` only reads `other`). One difference remains: the mirror's requested instant for a linked reading is `min(stamp, wall)`. So a recognition that a **linked** reading completes is anchored at the reading's measurement in the shadow engine and at the link's time in the real one. `retract_observation` still does not re-judge (the lane judges at its next sample, `:500–509`). | This closes G3-05 open item (c) except for that one difference. The lane is non-clinical (Aşama B D1), and that difference is left as it is. |
| D6 | **The floor is never set more than 2 min past the wall clock.** The doors cannot set it there (`min(stamp, wall)`), and neither can the link (wall) or the lane (`min(stamp, lane wall)`; the install uses `min(captured_at, now)` over samples stamped `<= now`, `:399–410`). The replay can, in two ways: `_written_at` falls back to the row's `obs_ts` when its `ts` cannot be read (`rehydrate.py:161–167`), and a row written while the server's clock ran ahead carries a `ts` past the restart. **So the replay caps the instant it hands the engine** (ingest and rejudge) **at its `now` + `REPLAY_SKEW`** (`= BEDSIDE_SKEW`, 2 min, `clinical.py:170`). `rehydrate` uses the `now` it already has (`:61`). `rebuild_patient` gains a keyword `now` (default: the clock), and the route passes its own, read before the rebuild: `app.py:1543` moves above `:1534`. **The instant handed to the lifecycle hook (`written`) is not capped** (§7). | With D1, a floor in the future would age every later reading of that patient to it, and keep doing so. That is X10's harm, made permanent. |
| D7 | **No migration, no route, no permission, no UI change, no new audit type.** No pin moves (route and board permission lists, `SPEC_KEYS`, nginx `API_PATHS`, `denetim.js` `EVENT_TYPES`). | It changes when a rule is judged, nothing stored or shown by its shape. |

## 3. The evaluation, exactly (`pipeline.py`)

`ingest` keeps its signature. Its `now` parameter keeps its name, and the docstring calls it the requested instant.
The body after `state.ingest(obs)` moves into `_evaluate`, which `rejudge` shares:

```python
def ingest(self, obs, now):                      # `now`: the instant the caller asks for
    state = self._repo.get_or_create(obs.patient_id)
    state.ingest(obs)
    return self._evaluate(obs.patient_id, state, now)

def rejudge(self, patient_id, now):              # D3: the state as it is, no reading added
    if patient_id not in self._repo.patient_ids():
        return []                                # never creates the patient
    return self._evaluate(patient_id, self._repo.get_or_create(patient_id), now)

def _evaluate(self, patient_id, state, requested):
    at = max(requested, self._judged_at.get(patient_id, requested))     # D1
    self._judged_at[patient_id] = at
    # today's body, in today's order, every `now` and `judge_at` replaced by `at`, except:
    #   anchor set:  self._recognized_at[pid] = self._new_anchor(pid, requested, at)   (D2)
    #   anchor drop: self._dropped_anchor[pid] = (dropped, at)                          (D2)

def _new_anchor(self, patient_id, requested, at):
    dropped = self._dropped_anchor.pop(patient_id, None)
    if dropped is not None and 0 <= (at - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
        return dropped[0]
    return requested
```

The rule modules do not change: `rules/septic_shock.py`, `rules/antibiotic_clock.py`, `rules/news2.py`,
`rules/patient_relative.py` and `model/scorer.py` already take the instant as a parameter, and the engine now hands
each of them `at`. No threshold, window or citation changes. The 1 h window (`antibiotic_clock.py`, SSC 2026) and
the 3 h fluid window (`septic_shock.py`, Sepsis-3 and SSC 2026) keep their sources. The vault is untouched.

## 4. Changes by file

- `src/homunculus/pipeline.py`:
  - `_evaluate`, `rejudge` and `_new_anchor(pid, requested, at)` (§3);
  - `_judged_at` in `_PER_PATIENT` (`:49–50`) and `__init__` (`:60–61`);
  - the comment at `:97–102` and the `forget` docstring (`:283–289`) reworded.
- `src/homunculus/api/rehydrate.py`:
  - `REPLAY_SKEW` (D6);
  - `_replay_ingest(engine, rec, written, ceiling)` hands the engine `min(requested, ceiling)` (`:107–125`);
  - `rehydrate` gains a `chart_retract` branch: when the row's `ts` reads and the engine holds the patient, it calls
    `engine.rejudge(pid, min(ts, ceiling))`, then `sync_alerts(engine, store, pid, ts)`. A row whose `ts` cannot be
    read is passed over: `_written_at`'s `obs_ts` fallback is not used for it, and the withdrawal still applies
    through `skip`;
  - `rebuild_patient(…, now=None)` rejudges the same way at the patient's `chart_retract` rows. It runs no hook there:
    the rebuild is engine-only, as today. `REBUILD_EVENTS` stays `{"ingest", "chart", "profile"}`
    (`test_bedside_rebuild.py` pins it), and `chart_retract` rows are handled beside it;
  - the module docstring names the new replayed kind.
- `src/homunculus/api/app.py`:
  - `_adopt_rebuilt` calls `engine.rejudge(patient_id, now)` between `:1416` and `:1417`;
  - `retract_entry` reads `now` before the rebuild and passes it to `rebuild_patient` (D6);
  - docstrings only: `_apply_reading`'s «WHEN THE RULES JUDGE» (`:1831–1839`), the instant comment (`:1856–1858`),
    the link comment (`:962–964`, which says the shadow lane «still judges a linked reading at its measurement time»).
  - `/ingest` and `/clinical` change no code.
- `src/homunculus/api/clinical.py`: the `chart_observations` docstring (`:355–356`). No code change.
- `src/homunculus/api/infinity_rules.py`: the `mirror_observation` docstring (`:480–482`: `now` is the door's wall
  clock, and the engine floors it). No code change.
- Docs, at implementation: a short section of `docs/homunculus-rehber-TR.md`; the roadmap row; G3-05's §11.5 (a) and
  (c) marked as closed by this slice.

## 5. What this amends

- **G2-A2 X9e.** «`now` is unchanged for everything else: the antibiotic anchor, sepsis and shock, the model»
  (`pipeline.py:101–102`) no longer holds: every rule is floored (D1). The dict is renamed.
- **G2-A2 X10 / X10b.** The values do not change. The doors' `min(stamp, wall)` and the replay's
  `min(stamp, written)` are now the *requested* instant, and the instant the rules judge at is its floor. X10b gains
  D6's cap.
- **G2-A1 X12.** `ANCHOR_RESTORE_S` is measured between floored instants, and a negative difference never restores
  (D2). For readings in time order, which covers every X12 test, nothing moves.
- **G3-01 D10.** «Every score as if the value had never arrived» holds for the state. The alerts are judged at the
  withdrawal's instant (D3).
- **G3-01 D12.** The restart scores as the live rebuild did, now including the rejudge at each `chart_retract` row.
- **G3-05 §11.5.** (a) is closed. (c) is closed except for D5's remaining difference.
- **Unchanged:** G3-01 D7 (24 h back-dating, 2 min skew), G3-05 D12 as amended (a link is judged at the wall
  clock), G2-A2 D3 (the board judges freshness at the wall clock), and G2-A2 O12 (no ahead-of-clock refusal at the
  doors; X10 still clamps).

## 6. Clocks that are not the wall clock

The engine reads no clock, so a simulated or replayed clock reaches the floor only through the instants its caller
passes.

- **`scripts/replay.py`** posts a scenario through `/ingest`, in event order.
  - The stamps rise, and the floor follows them: nothing changes for one run.
  - Without `--now` the scenarios are dated 2026-07-14, so a second run into the same running API repeats the first
    run's stamps. Its readings are judged at the first run's last stamp, which means the antibiotic clock reads
    overdue from the second run's first reading.
  - Today NEWS2 already behaves this way (X9e), and the first run's anchor already persists while infection stays
    charted. For a clean demo: a fresh API per run, or `--now`.
- **`scripts/dev_seed_ward.py`** charts each bed in time order (95 → 55 min ago), **`scripts/record_demo.py`**
  ingests a scenario in order at its stamps, and **`scripts/hl7_simulator.py`** stamps the moment it sends. None of
  them changes.
- **`tests/test_infinity_shadow_equivalence.py`** freezes the clinical clock at `FROZEN`, the septic-shock scenario's
  start (2026-07-14 10:00).
  - Every later stamp is clamped to `FROZEN` by the doors, and the restart's write times are frozen too
    (`_now_iso`). So the real engine's floor is `FROZEN` throughout, the same in both apps.
  - The lane's engine runs on `lane["t"]` (epoch 1.8e9). Its floor goes there, now for sepsis, the antibiotic clock
    and the model as well as NEWS2. `_clinical` takes the lane's outputs out, and the lane never writes the real
    engine. The test stays as it is and is on the run list.
- **The 60x simulation clock** (memory note «live-mode alarm bugs») was the dashboard's old workspace clock
  (`clinicalDemo.js`). `dashboard/src/liveAdapters.js:173–176` now ages a real alarm by `firstSeenAtMs` and keeps
  `firedAtSec` null. That clock never reaches the engine, and this slice neither touches it nor relies on it.
- **`escalation_cycle(now)`**, which tests drive with a moved clock, republishes boards and runs no rule (G2-A2
  §8). It is unaffected.
- **A test that reuses one engine over two timelines** (later calls with earlier `now`s) now sees those calls judged
  at the first timeline's floor. The test's premise moves: give it a fresh engine or ordered instants. The floor is
  never weakened (§8.2).

## 7. The restart and the stale-acknowledgement risk

The recorded risk (an old acknowledgement silencing a re-raised alert's escalation after a restart) is the owner's
to decide, and this slice does not change it.

**Unchanged.** These are not touched:

- `_replay_ack` (`rehydrate.py:188–202`);
- the `first_seen` branch and its `setdefault` (`:83–91`);
- `store.recent.clear()` (`:101`) and `expire_snoozes` (`:104`);
- the hook itself (`alert_lifecycle.sync_alerts`);
- the instant the replay hands the hook: `written`, the row's write time. D6's cap applies to the engine's instant
  only.

**What changes, exactly:**

1. **Each replayed row is judged at its floored instant (D1).** The replay sees an episode end or continue where
   live did under this slice: restart equals live.
2. **A `chart_retract` row now runs the rejudge and the hook (D3), where the live withdrawal ran them.**
   - The hook there ends or latches whatever the rejudge no longer finds firing, and prunes those episodes'
     acknowledgements and stamps, as live did.
   - It adds no acknowledgement and no stamp.
3. **A trail written before this slice is replayed under the new rule on the first restart after the deploy.** An
   episode that the old code ended on a back-dated reading and later raised again is replayed as **one** episode.
   - An acknowledgement given before the back-dated reading stands for the whole episode. The pre-deploy board
     showed the return as unacknowledged and escalating; after the restart it shows it acknowledged, and it does
     not escalate.
   - The return's `first_seen` row is passed over (`setdefault` keeps the episode's first stamp), so an
     unacknowledged episode escalates no later than before.
   - This has the shape of the recorded risk: an old acknowledgement on what the ward saw as a new alert. Under D1
     it is one episode. It can only touch patients with a back-dated reading after a recognition. Block A-1 (§9)
     gives an upper bound.
4. **The reverse can also happen on such a trail.** A `due` the old board showed may be replayed as `overdue`. No
   `first_seen` row stands behind it, so it is stamped and told at the patient's next reading (the stamp loop of
   `_apply_reading`, `app.py:1886–1889`, and `notifier.for_new`).

## 8. Testing

### 8.1 New tests (written first)

**Engine** (`tests/test_pipeline.py`, or a new `tests/test_engine_floor.py`):

- **Overdue stays overdue.** Sepsis at +0, `antibiotic_overdue` at +120. A reading stamped −240 then gives
  `antibiotic_overdue` («OVERDUE by 60 min», judged at +120) and no `antibiotic_due`. Run with an `AckStore` and
  `sync_alerts`: an acknowledged overdue keeps its acknowledgement and first sight, and its episode does not end.
- **A late recognition is overdue at once.** On a patient judged up to +360, a reading stamped +0 that completes
  SOFA gives `recognized_at == +0` and `antibiotic_overdue` at once («OVERDUE by 300 min»).
  - A fresh patient whose first reading is stamped 6 h back is judged at that stamp, as today («60 min
    remaining»).
- **The restore test.**
  - Old episode: anchor +0, the antibiotic given at +20, a rule-out at +71. New infection: charted at +126 with SOFA
    not met. A back-dated reading stamped +60, of a code with no newer reading, then completes SOFA.
  - Today the +0 anchor is restored (a negative difference) and the +20 dose silences the clock.
  - Under this slice the recognition is not a restore (`at - dropped_at` = 55 min). Its anchor is +60, the dose does
    not count, and the clock reads overdue.
  - Companion: a corrected toggle whose completing reading is back-dated, within 15 floored minutes of the drop,
    restores the anchor.
- **`rejudge`.** It answers the evaluation's alerts and moves the floor. It is a no-op that creates nothing for an
  unknown patient. A `due` whose hour has passed by `now` becomes `overdue`.
- **`_PER_PATIENT`** lists `_judged_at` (the existing pin, `test_engine_adopt.py:66`), and `forget`, `copy` and
  `adopt` carry it.

**API:**

- **The `/ingest` buffered round.** Overdue is running and acknowledged. A Connex set stamped 4 h back changes
  neither the alert, nor its acknowledgement, nor its first sight. It writes no `alert_cleared` row and sends no new
  notification. The values are stored and audited at their stamp.
- **`/clinical` back-dated.** The same with a bedside set whose `recorded_at` is 3 h back.
- **«Düzelt».** A device value is withdrawn, then the corrected value is charted at the reading's own time. The
  overdue stays overdue and stays acknowledged.
- **The withdrawal re-judges** (the reviewers' scenario). MAP at −90, temperature at −5 (overdue), the temperature
  withdrawn: the answer's `alerts` and the card show `antibiotic_overdue`, never «60 min remaining».
- **Restart equals live** after each API case above, by a second app on the same audit. Alerts are compared by
  kind, severity, urgency and anchor; a summary's minute count can differ by the request's own duration.
- **The future floor (D6).** Two trails are replayed: one with a row whose `ts` cannot be read and whose `obs_ts` is
  1 h past the restart, one with a row whose `ts` is 1 h past the restart. Afterwards the patient's `_judged_at` is
  at most the restart's `now` + 2 min, and the hook's instant for that row is unchanged.

**Shadow lane** (`tests/test_infinity_rules.py`): a shadow engine copied from a real engine with an overdue keeps
the overdue on a mirrored reading stamped 4 h back.

### 8.2 Existing tests whose premise moves

These are known at design time. Each is fixed by moving its instants or its helper, never by weakening the floor.

- **`test_bedside_retract.py`:**
  - `_internals` (`:108–120`) reads `_judged_at`;
  - `_equal_to_never_charted` (`:131–150`): the fresh app's engine is re-judged at the live engine's `_judged_at`
    (the withdrawal's instant) before it is read, so `got == want` (`:685`, `:695`) still means «state as if never
    charted, alerts at the withdrawal's instant».
- **`test_bedside_rebuild.py`:**
  - `_withdraw_live` (`:68–76`) re-judges after `adopt`, as the route does, at the `chart_retract` row's own `ts`.
    The helpers simulate the wall clock at `EARLY` (4 h back, `:23–24`) while the audit stamps rows with the real
    clock.
  - With the replay re-judging at that row's `ts`, `_SHOCK`'s bolus falls outside the 3 h fluid window. So the
    instants of `test_a_withdrawn_value_that_ended_a_critical_leaves_no_latch_after_a_restart` (`:212–227`) move
    inside it.
- **`test_engine_adopt.py`** (`:153`, `:184`, `:191`) and **`test_engine_forget.py`** (`:37–39`): the rename.
- **`test_readings_api.py`:**
  - `test_the_door_still_judges_a_back_dated_reading_at_its_own_time` (`:692–700`): its premise is a patient the
    engine has not judged yet. The premise holds and the test stays; the docstring says so.
  - A sibling test: the same set at the door for a patient already judged is judged at the floor, so it is stale
    for NEWS2.
- **`test_pipeline.py`:** the X9e test (`:576–600`) keeps its assertions; its comment says the floor is no longer
  NEWS2's only.

### 8.3 Downstream readers that must stay green

- the board `_meds` (`api/board.py:153–199`), `test_api_board_meds.py`, `test_board.py`, `test_api_board_news2.py`;
- the pharmacy (`api/pharmacy.py`), `test_pharmacy.py`, `test_pharmacy_api.py`;
- the lifecycle (`api/alert_lifecycle.py`), `test_alert_lifecycle.py`;
- alarm quality and the quality indicators: `test_alarm_quality.py`, `test_quality_api.py`,
  `test_quality_indicators.py`;
- notify and escalation: `test_notify.py`, `test_escalation_chain.py`, `test_first_seen_persistence.py`;
- the shadow lane: `test_infinity_shadow_equivalence.py`, `test_infinity_rules.py` and the other
  `test_infinity_shadow_*.py` and `test_api_*shadow*.py` files;
- the pipeline and the rules: `test_pipeline.py`, `test_pipeline_model.py`, `rules/test_antibiotic_clock.py`;
- the scenarios: `test_scenarios_e2e.py`, `test_scenarios_hl7_parity.py`, `test_scenario_news2.py`;
- the doors: `test_api_ingest.py` (X10, `:152–175`), `test_api_clinical.py` (X10, `:129–152`);
- the replay and the withdrawal: `test_rehydrate.py` (X10b, `:316–356`), `test_bedside_retract.py`,
  `test_bedside_rebuild.py`;
- the engine pins: `test_engine_adopt.py`, `test_engine_forget.py`;
- the readings: `test_readings_api.py`.

### 8.4 Gates

- **The whole no-DB engine suite.** Every file under `homunculus-engine/tests`: no `-k`, no subset.
- **The Postgres-marked audit and rehydrate tests** on a throwaway container. The replay parses the Postgres
  audit's `ts` (a `TEXT` column, `alembic/versions/0004_audit_log.py:58`).
- **Dashboard:** no file changes, so it is not a gate.

**Local walk** (synthetic only: «Test Hasta», local stack):

1. Chart suspected infection and labs so sepsis is recognised with the hour running, then let it pass to overdue
   with a current reading.
2. Post a device reading stamped 4 h back: the card stays «gecikti».
3. «Düzelt» that value: still «gecikti».
4. Withdraw a hand value: the alerts read as of now.
5. Restart the API: the same picture.

## 9. Deploy

Main and the VM are the owner's word, through Lane A, which writes the blocks. What they must say:

- **Images: api only.** There is no migration and no web change.
- **Block A-1 (before the deploy) prints one number:** an upper bound on the patients whose antibiotic picture the
  first restart can move (§7, items 3–4). It never prints a patient id:
  `select count(distinct patient_id) from audit where event_type = 'alert' and subject in ('antibiotic_due',
  'antibiotic_overdue') and ts::timestamptz > now() - interval '48 hours'`. In a pasted heredoc the `psql` call
  takes `</dev/null`.
- **The first restart replays the old trail under the new rule** (§7).
  - For a patient with a back-dated reading after a recognition, the board may differ from the pre-deploy board.
  - An overdue the old code turned into «due» is overdue again, as one episode, with its earlier acknowledgement.
  - A «due» may now read overdue; it is stamped and told at the patient's next reading.
- **The ward is told beforehand:**
  - a late reading (a device round sent late, a set charted at its own time) never turns «gecikti» back into «kalan
    süre»;
  - when a late reading shows that the sepsis criteria were met hours ago, «gecikti» appears at once, because the
    hour runs from the measurement (the owner's choice);
  - after «hatalı giriş» or «Düzelt», the alerts are judged as of that moment, so an antibiotic hour that ran out
    since the last reading reads «gecikti».
- **Rollback:** the previous api image. Nothing stored changes. Under the old image a back-dated reading is judged at
  its own time again (the false «kalan süre» comes back), and the next restart replays the trail under the old rules.

## 10. Not in this slice

- **Re-evaluation on the wall clock without a new reading.** An `antibiotic_due` turns overdue at the patient's next
  reading or withdrawal, not on its own (G2-A2 §8: «a time-based re-evaluation of alerts without new data»). The
  board's meds countdown (`board.py:174–185`) and
  the pharmacy already count down at the wall clock.
- **SOFA's "latest by stamp".** A back-dated value enters SOFA only when it is the newest of its code
  (`PatientState.latest`); otherwise it triggers an evaluation at the floor and changes no SOFA input.
- **The anchor's own time.** By D2 the anchor is the requested instant, including when the completing reading is
  stamped before the suspected-infection entry that the recognition needs, or before a rule-out (§8.1's restore
  case: +60). The engine does not fold the infection entry's own time into the anchor. Such a recognition reads
  overdue from that stamp: an earlier «gecikti», never a later one. Time zero stays a vault open question.
- **The preview** (`POST /clinical/{id}/preview`, `app.py:1317–1347`): it scores a copy of the state at the request's
  instant and never goes through the engine.
- **D5's remaining difference in the shadow lane**, and the lane's not re-judging after a withdrawal.
- **An ahead-of-clock refusal at the doors** (G2-A2 O12).

## 11. Open items

None for the owner beyond this spec's «evet». The one visible consequence, ward staff seeing an immediate «gecikti»
when a late reading reveals sepsis hours ago, is the owner's choice (D2), and §9 tells the ward. The test fallout
beyond §8.2 is known only when the plan runs. It is fixed as §8.2 says (as G3-05 O1).
