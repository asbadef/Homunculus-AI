# G3-06 · Saat geri gitmez — time-based rules never go backwards on a back-dated reading — design

**Date:** 2026-11-12 · **Branch:** `feat/g3-saat-geri-gitmez` (from main `88f6544c`) · **Migration:** none
**Status:** Approved by the owner 2026-11-12 («İkisine de evet»; link anchoring: «Ölçüm saatinden»; a linked set:
«Bağlama anında değerlendir, saat ölçümden»; the anchor's lower bound: «Şüpheden önceye gitmesin»). The owner made
two changes to the first draft:
- a LINKED set is **judged at the link moment**, and a recognition it completes is **anchored at the reading's
  measurement time** (D2, D4);
- an anchor is **never earlier than the start of the current suspicion** (the first suspected-infection mark
  charted present since the last absent one) **or the last rule-out** (D2).

The implementation plan follows. Group 3, slice 6 (the number is free on the roadmap,
`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`). Code references were read at `88f6544c`.
**Amends:** G2-A2 X9e (and the wording of X10 and X10b), G3-01 D10 and D12, G2-A1 X12's restore test, and G3-05's
D12 amendment **for anchoring only**: a linked set is still judged at the link, and its recognition is now anchored
at its measurement. Closes G3-05 §11.5 open items (a) and (c). G3-01 D7 (the 24 h back-dating bound) stays as it
is.

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
| D2 | **Anchor of a recognition that a back-dated reading completes: the measurement time (owner: «ölçüm saatinden»).** **…but never before the suspicion or the last rule-out (owner: «Şüpheden önceye gitmesin»).** `Engine.ingest` gains a keyword `anchor_at` (default: its `now`). **At the doors** `anchor_at` is the requested instant itself, `min(stamp, wall)`: one instant for both. **At the link** (D4) it is `min(stamp, wall_now)`, while the set is judged at `wall_now`. **The rule, exactly, for a recognition with no anchor running:** (1) a drop is remembered with the dropping evaluation's floored instant, `_dropped_anchor[pid] = (anchor, at)`. (2) A recognition restores the dropped anchor if and only if `0 <= (at - dropped_at).total_seconds() <= ANCHOR_RESTORE_S`, where `at` is the recognising evaluation's floored instant: a corrected toggle keeps the old episode's anchor (X12). (3) Otherwise its anchor is `min(max(anchor_at, infection_at, dropped_at), at)`. Here `infection_at` is **when the current suspicion began**: the stamp of the first `suspected_infection` reading charted present (≥ 1) since the last one charted absent (< 1), in the state's stamp order (`state.history`). With no absent mark, it is the first present mark. A recognition always finds the latest mark present, since both recognition kinds need it ≥ 1 (`septic_shock.py:48`), so the current suspicion exists. A present mark charted again within the same suspicion does not move `infection_at`: pushing the hour later would be false reassurance (the owner: the hour never runs from before the suspicion *began*). `dropped_at` is the remembered drop's instant from (1), and it is left out when no drop is remembered. The outer `min(…, at)` keeps the anchor from passing the instant the clock is judged at; an infection mark stamped ahead of the clock could otherwise do so. (4) The remembered drop is spent either way, as today. The clock is judged at `at`. A recognition completed by a reading measured 6 h ago, after the suspicion was charted, shows `antibiotic_overdue` at once, on a patient judged up to now and on a linked set alike. One completed by a reading older than the suspicion runs from the suspicion. A patient's first evaluation at a door has no floor (`at` = the requested instant), so a fresh patient is judged at the doors exactly as today. Within one engine the floor never goes back, and `forget`, `copy` and `adopt` move `_judged_at` and `_dropped_anchor` together, so the difference in (2) is never negative. The `0 <=` is written out as a guard. | The owner's choices. At the doors the engine's anchor was already the requested instant (`pipeline.py:134`). What changes there is the instant the clock is read at and the two lower bounds; at the link the anchor moves from the link to the measurement. The lower bounds answer two cases the Tasks 1–2 reviewer reproduced. **Without the suspicion bound:** infection charted at +300, then a bilirubin stamped +0 completed sepsis and read «OVERDUE by 240 min» at once, although suspicion began at +300. **Without the rule-out bound (and with requested instants in the restore test):** a rule-out at +71, a new infection at +126, then a bilirubin drawn at +60 arriving at +130 restored the old episode's dose and silenced the clock. Time zero is an open question in the vault (`Homunculus/wiki/concepts/antimicrobial-timing-sepsis.md`, «Time-zero must be defined and defensible»), so this is an operational rule, not a clinical claim. The restore window measures how far apart a toggle and its correction were (X12). Floored instants measure that in the engine's own one-way time. Requested instants do not, which is the latent bug (§1). |
| D3 | **A withdrawal re-judges at its own instant.** There is a new method `Engine.rejudge(patient_id, now)`. It runs the same evaluation as `ingest`, adds no reading, uses the instant `max(now, floor)` and returns the alerts. A patient the engine does not hold answers `[]` and is not created. `_adopt_rebuilt` calls it right after `engine.adopt` and before the hook, with no `await` in between (`app.py:1416–1417`). This is what makes the restart agree (D4): **the trail-replayers re-judge at every `chart_retract` row.** `rehydrate` rejudges there at the row's write time and runs the hook at that same write time. `rebuild_patient` rejudges at the patient's earlier withdrawals: the route already reads them (`app.py:1512–1513`). G3-01 D10's «as if never charted» still holds for the state, the anchor and the profile. **The alerts are judged at the withdrawal's instant.** So a withdrawal can bring up an alert the clock has reached since the last reading: an `antibiotic_due` whose hour has run out is `antibiotic_overdue` after the withdrawal. It is stamped and told to the nurse like any alert a withdrawal uncovers (G3-01 X3, `_stamp_uncovered`, `_tell_uncovered`). | The reviewers' scenario: without this the rebuild ends at «60 min remaining» and the overdue ends or latches. Without the replay's half, a restart after the withdrawal would bring the «60 min remaining» back. |
| D4 | **The doors keep one instant; the link passes two (owner: «Bağlama anında değerlendir, saat ölçümden»).** **Doors:** X10's `min(stamp, wall)` at `/ingest` and `/clinical` stays as it is. It is now the *requested* instant: the engine floors it for the judgement and uses it unfloored as the anchor (D2). **Link:** `_apply_reading` keeps `judge_at` (the link is its only caller, `app.py:966`) and calls `engine.ingest(obs, now=judge_at, anchor_at=min(obs.timestamp, wall_now))`. The link judges at `wall_now`, floored like everything else (G3-05 D12 as amended, kept for the judgement), and anchors at the reading's stamp. A set measured 6 h ago is therefore not current at the link: NEWS2 finds it stale and it cannot raise NEWS2 by itself, on a patient the engine has never judged too. A recognition it completes runs its hour from the measurement, so an hour already past shows «gecikti» at once. **Replay:** `rehydrate._replay_ingest` hands an ordinary row `now = min(stamp, written)`. A linked row (`payload.reading` present) gets `now = written`, as G3-05 does today, and `anchor_at = min(stamp, written)`. Both instants are capped by D6, in id order. **Restart equals live for a link.** The anchor is exactly equal: a linked reading is at most 24 h old (G3-05 D12's bound), so its stamp is earlier than both `wall_now` and the row's `ts`, written after it. Both sides anchor at the stamp, and D6's cap never bites on it, since the stamp is before the restart. The judgement instant is equal to within the request: `wall_now` live, the row's `ts` in the replay. That is G3-05's own tolerance, and the floor follows both alike. With D3, a restart equals live. The hook's instant does not change anywhere: the request's wall clock at the doors, the link and the withdrawal, and the row's write time in the replay. | The owner's decision. A late set's values are old by the time it is linked, and judging them as current would page on stale data. Its measurement is still when the criteria were met. The floor belongs to the engine; the doors keep saying what they ask for, and the trail keeps recording it. |
| D5 | **Shadow lane: the mirror passes the real engine's two instants.** `Engine.copy` carries `_judged_at` (the install starts the shadow engine from the real engine's floor, `infinity_rules.py:395`), so `mirror_observation` (`:486`) and `sample` (`:611`) can no longer go back. `mirror_observation` gains a keyword `judge_at` (default None) and calls `engine.ingest(obs, now=min(obs.timestamp, now) if judge_at is None else judge_at, anchor_at=min(obs.timestamp, now))`. `_apply_reading` hands it the link's `judge_at` (`app.py:1869`). A linked set is then judged at the link and anchored at its stamp in the shadow engine too, while a door's reading keeps one instant there as well. `_settle`'s `adopt` (`:640–644`) resets an unlinked patient to the real engine's floor, which is right: the patient goes back to the real picture. The lane never writes the real engine (`adopt` only reads `other`). `retract_observation` still does not re-judge (the lane judges at its next sample, `:500–509`). | This closes G3-05 open item (c): the shadow engine judges and anchors every reading where the real one does. The lane is non-clinical (Aşama B D1). |
| D6 | **The floor is never set more than 2 min past the wall clock.** The doors cannot set it there (`min(stamp, wall)`), and neither can the link (wall) or the lane (`min(stamp, lane wall)`; the install uses `min(captured_at, now)` over samples stamped `<= now`, `:399–410`). The replay can, in two ways: `_written_at` falls back to the row's `obs_ts` when its `ts` cannot be read (`rehydrate.py:161–167`), and a row written while the server's clock ran ahead carries a `ts` past the restart. **So the replay caps every instant it hands the engine** (ingest's `now` and `anchor_at`, and rejudge's `now`) **at its `now` + `REPLAY_SKEW`** (`= BEDSIDE_SKEW`, 2 min, `clinical.py:170`). `rehydrate` uses the `now` it already has (`:61`). `rebuild_patient` gains a keyword `now` (default: the clock), and the route passes its own, read before the rebuild: `app.py:1543` moves above `:1534`. **The instant handed to the lifecycle hook (`written`) is not capped** (§7). | With D1, a floor in the future would age every later reading of that patient to it, and keep doing so. That is X10's harm, made permanent. |
| D7 | **No migration, no route, no permission, no UI change, no new audit type.** No pin moves (route and board permission lists, `SPEC_KEYS`, nginx `API_PATHS`, `denetim.js` `EVENT_TYPES`). | It changes when a rule is judged, nothing stored or shown by its shape. |

## 3. The evaluation, exactly (`pipeline.py`)

`ingest` keeps its positional signature and gains one keyword, `anchor_at`. Its `now` parameter keeps its name, and
the docstring calls it the requested instant. The body after `state.ingest(obs)` moves into `_evaluate`, which
`rejudge` shares:

```python
def ingest(self, obs, now, *, anchor_at=None):   # `now`: the instant the caller asks the rules to judge at
    state = self._repo.get_or_create(obs.patient_id)   # `anchor_at`: the anchor of a recognition it completes
    state.ingest(obs)                                   #   (None: `now` — the doors' one instant)
    return self._evaluate(obs.patient_id, state, now, now if anchor_at is None else anchor_at)

def rejudge(self, patient_id, now):              # D3: the state as it is, no reading added
    if patient_id not in self._repo.patient_ids():
        return []                                # never creates the patient
    return self._evaluate(patient_id, self._repo.get_or_create(patient_id), now, now)

def _evaluate(self, patient_id, state, requested, anchor_at):
    at = max(requested, self._judged_at.get(patient_id, requested))     # D1
    self._judged_at[patient_id] = at
    # today's body, in today's order, every `now` and `judge_at` replaced by `at`, except:
    #   anchor set:  self._recognized_at[pid] = self._new_anchor(pid, anchor_at, at, _suspicion_began(state))  (D2)
    #   anchor drop: self._dropped_anchor[pid] = (dropped, at)                                                  (D2)

def _suspicion_began(state):                     # D2: the first present mark of the current suspicion
    began = None
    for obs in reversed(state.history(SignalCode.SUSPECTED_INFECTION)):    # newest stamp first
        if obs.value < 1.0:
            break                                # the last absent mark ends the walk
        began = obs.timestamp
    return began                                 # never None at a recognition: the latest mark is present

def _new_anchor(self, patient_id, anchor_at, at, infection_at):
    dropped = self._dropped_anchor.pop(patient_id, None)
    if dropped is not None and 0 <= (at - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
        return dropped[0]                              # a corrected toggle: the old episode's anchor (X12)
    bounds = [anchor_at, infection_at] + ([dropped[1]] if dropped is not None else [])
    return min(max(bounds), at)                        # «Şüpheden önceye gitmesin»
```

The instants each caller passes:

| Caller | `now` (judged at, floored) | `anchor_at` |
|---|---|---|
| `/ingest`, `/clinical` (`_apply_reading` without `judge_at`, `chart_observations`), the admission weight | `min(stamp, wall)` | the same (default) |
| the link (`_apply_reading` with `judge_at=wall_now`) | `wall_now` | `min(stamp, wall_now)` |
| the shadow mirror (D5) | as the real engine's caller | as the real engine's caller |
| the replay, an ordinary row | `min(stamp, written, ceiling)` | the same (default) |
| the replay, a linked row (`payload.reading`) | `min(written, ceiling)` | `min(stamp, written, ceiling)` |
| `rejudge` (the withdrawal; the replay at a `chart_retract` row) | the withdrawal's `now` / `min(ts, ceiling)` | the same |

The rule modules do not change: `rules/septic_shock.py`, `rules/antibiotic_clock.py`, `rules/news2.py`,
`rules/patient_relative.py` and `model/scorer.py` already take the instant as a parameter, and the engine now hands
each of them `at`. No threshold, window or citation changes. The 1 h window (`antibiotic_clock.py`, SSC 2026) and
the 3 h fluid window (`septic_shock.py`, Sepsis-3 and SSC 2026) keep their sources. The vault is untouched.

## 4. Changes by file

- `src/homunculus/pipeline.py`:
  - `ingest`'s keyword `anchor_at`, `_evaluate`, `rejudge` and `_new_anchor(pid, anchor_at, at, infection_at)`
    (§3);
  - `_judged_at` in `_PER_PATIENT` (`:49–50`) and `__init__` (`:60–61`);
  - the comment at `:97–102` and the `forget` docstring (`:283–289`) reworded.
- `src/homunculus/api/rehydrate.py`:
  - `REPLAY_SKEW` (D6);
  - `_replay_ingest(engine, rec, written, ceiling)` (`:107–125`): an ordinary row is judged at
    `min(obs.timestamp, written, ceiling)`. A linked row (the `linked` test at `:123` stays) is judged at
    `min(written, ceiling)` and anchored at `min(obs.timestamp, written, ceiling)` (D4). The docstring paragraph at
    `:116–119` gains the anchor;
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
  - the link path (D4): `_apply_reading` keeps `judge_at` (`:1821`). Its engine call (`:1859`) becomes
    `requested = min(obs.timestamp, wall_now)`, then
    `engine.ingest(obs, now=requested if judge_at is None else judge_at, anchor_at=requested)`. Its mirror call
    (`:1869`) hands `judge_at` to `lane.mirror_observation` (D5). The readings router's `apply` lambda keeps
    `judge_at=now` (`:965–967`); its comment (`:962–964`, where the shadow lane is «not covered») is rewritten;
  - docstrings: `_apply_reading`'s «WHEN THE RULES JUDGE» (`:1831–1839`) and the instant comment (`:1856–1858`)
    say the link is judged at the link and anchored at the measurement.
  - `/ingest` and `/clinical` change no code.
- `src/homunculus/api/clinical.py`: the `chart_observations` docstring (`:355–356`). No code change.
- `src/homunculus/api/infinity_rules.py`: `mirror_observation(hospital, obs, *, now, real, judge_at=None)`
  (`:479–491`). It passes the real engine's two instants (D5), and its docstring (`:480–482`) says so.
- Docs, at implementation: a short section of `docs/homunculus-rehber-TR.md`; the roadmap row; G3-05's §11.5 (a) and
  (c) marked as closed by this slice.

## 5. What this amends

- **G2-A2 X9e.** «`now` is unchanged for everything else: the antibiotic anchor, sepsis and shock, the model»
  (`pipeline.py:101–102`) no longer holds: every rule is floored (D1). The dict is renamed.
- **G2-A2 X10 / X10b.** The values do not change. The doors' `min(stamp, wall)` and the replay's
  `min(stamp, written)` are now the *requested* instant, and the instant the rules judge at is its floor. X10b gains
  D6's cap.
- **G2-A1 X12.** `ANCHOR_RESTORE_S` is measured between floored instants, and a negative difference never restores
  (D2). A new anchor is never earlier than the start of the current suspicion or the remembered drop (D2 (3)). In
  the X12
  tests every anchor is set by the reading that charts the suspicion, or after it, in time order, so nothing moves.
- **G3-01 D10.** «Every score as if the value had never arrived» holds for the state. The alerts are judged at the
  withdrawal's instant (D3).
- **G3-01 D12.** The restart scores as the live rebuild did, now including the rejudge at each `chart_retract` row.
- **G3-05 D12 as amended (B6 review, `95a305b1`; G3-05 spec §11.2) — kept for the judgement, amended for the
  anchor only** (owner, 2026-11-12: «Bağlama anında değerlendir, saat ölçümden»).
  - **Kept:** «a LINKED reading is judged at the wall clock», and the restart replays a linked `ingest` row's
    judgement at the row's write time. Now floored like every judgement and capped by D6.
  - **Amended:** a recognition that a linked reading completes is anchored at the reading's measurement
    (`min(stamp, wall_now)`, replayed as `min(stamp, written)`), not at the link.
  - **Also unchanged:** the reading keeps its own stamp (state, trail, trends, record, vital task), and the
    record's «alındı» is the link's time (`resolved_at`).
- **G3-05 §11.5.** (a) and (c) are closed.
- **Unchanged:** G3-01 D7 (24 h back-dating, 2 min skew), G3-05 D12's 24 h link bound, G2-A2 D3 (the board judges
  freshness at the wall clock), and G2-A2 O12 (no ahead-of-clock refusal at the doors; X10 still clamps).

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
5. **A linked row on such a trail is still judged at its write time, but anchored at its measurement (D4).**
   - A recognition it completed gets an earlier anchor than on the old board, so the antibiotic recommendation reads
     «gecikti» sooner. As in item 4, an overdue the old board did not have is stamped and told at the patient's next
     reading.
   - Its judgement is unchanged, so it raises no NEWS2 alert the old board did not show.
   - Block A-1 counts the linked rows in the trail.

## 8. Testing

### 8.1 New tests (written first)

**Engine** (`tests/test_pipeline.py`, or a new `tests/test_engine_floor.py`):

- **Overdue stays overdue.** Sepsis at +0, `antibiotic_overdue` at +120. A reading stamped −240 then gives
  `antibiotic_overdue` («OVERDUE by 60 min», judged at +120) and no `antibiotic_due`. Run with an `AckStore` and
  `sync_alerts`: an acknowledged overdue keeps its acknowledgement and first sight, and its episode does not end.
- **A late recognition is overdue at once.** Suspected infection is charted at −30. On a patient judged up to +360,
  a reading stamped +0 that completes SOFA gives `recognized_at == +0` and `antibiotic_overdue` at once («OVERDUE by
  300 min»).
  - A fresh patient whose first reading is stamped 6 h back is judged at that stamp, as today («60 min
    remaining»).
- **The anchor never precedes the suspicion** (the reviewer's first case). Infection is charted at +300 (the
  patient is judged up to +300). A bilirubin stamped +0, a code with no newer reading, then arrives and completes
  sepsis. The anchor is +300, not +0, and the clock reads `antibiotic_due` «60 min remaining», not «OVERDUE by
  240 min».
- **The anchor never precedes the last rule-out, and it does not restore across it** (the reviewer's second case).
  - Old episode: anchor +0, the antibiotic given at +20, a rule-out at +71. New infection: charted at +126 with
    SOFA not met. A bilirubin drawn at +60, a code with no newer reading, arrives at +130 and completes SOFA.
  - Today the +0 anchor is restored (a negative difference) and the +20 dose silences the clock.
  - Under this slice the recognition is not a restore: judged at the floor +126, `at - dropped_at` is 55 min. Its
    anchor is `max(+60, +126, +71)` = +126, the +20 dose does not count, and the clock reads `antibiotic_due` «60
    min remaining».
- **The drop bounds a back-dated re-chart.** The patient is judged up to +100. A rule-out is charted then,
  back-dated to +71, and dropped at the floor +100. A device reading at +125 moves the floor to +125. Suspicion is
  re-charted present at wall +130, back-dated to +80, and that completes sepsis.
  - It is judged at +125, 25 floored minutes after the drop, so this is a new hour, not a restore.
  - Its anchor is `max(+80, +80, +100)` = +100: never before the engine registered the rule-out.
  - Companion: with no reading between, the same re-chart is judged at the floor +100, 0 floored minutes after the
    drop, and the old anchor is restored. The window is measured on the patient's judged time, which moves with
    the patient's evaluations, not with the wall clock (D1: the engine reads no clock).
- **The restore still works.** A corrected toggle whose completing reading is back-dated, within 15 floored
  minutes of the drop, restores the old anchor; the bounds do not apply to a restore.
- **A repeat present mark does not move the bound.** Suspicion is charted present at +0 and again at +200, with
  no absent mark between and no recognition yet. A recognition then completed by a reading stamped +100 has its
  anchor at +100, not +200: `infection_at` is +0, when the current suspicion began.
- **An absent mark starts a new suspicion.** Present at +0, absent at +71, present at +126: `infection_at` is +126.
  The reviewer's second case above relies on this.
- **The anchor never passes `at`.** A suspicion mark stamped ahead of the floor gives an anchor of `at` exactly.
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
- **A link is judged at the link and anchored at the measurement** (D4). Infection is charted 7 h back. A set
  measured 6 h ago, linked from the list, completes sepsis. The answer and the card show `antibiotic_overdue` at once, never
  `antibiotic_due`, and `recognized_at` equals the set's stamp. The case runs twice: on a patient judged up to now,
  and on one whose only entry before the link is the suspected-infection chart, 7 h back. A patient the engine has
  never judged cannot have sepsis completed by a link: the criterion needs infection charted. The never-judged case
  is NEWS2's, pinned by G3-05's test (§8.2).
  - The shadow engine (stage `rules`, the patient linked to a monitor) holds the same anchor and the same
    antibiotic finding.
  - A second app on the same audit holds the same anchor exactly, and the same alerts.
- **A replayed linked row** (`rehydrate`, unit level): it is judged at its write time and anchored at its stamp. A
  linked row whose `ts` is 1 h past the restart is judged at the restart's `now` + 2 min at most (D6), and its anchor
  is its stamp.
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
- **`test_readings_api.py`, the G3-05 tests that pin «a link is judged at the wall clock»:** they keep their premise
  and their assertions. D4 keeps the link's judgement, and none of them completes a recognition through a link, so
  the new anchor touches none of them.
  - `test_a_back_dated_link_is_judged_now_and_leaves_an_overdue_antibiotic_overdue` (`:644–672`). The anchor was
    set by `_overdue`'s charted MAP, not by the link. Only its docstring gains «and anchored at its measurement».
  - `test_a_stale_linked_set_does_not_score_by_itself_but_a_fresh_one_does` (`:674–690`) is unchanged. On `KEY`,
    which the engine has not judged before the link, the 6 h-old set is judged at the link and answers `[]`. This is
    the owner's «Bağlama anında değerlendir» pinned.
  - `test_a_linked_set_enters_the_engine_at_its_own_time_with_the_device_as_its_source` (`:338–370`) and
    `test_a_restart_replays_the_same_picture` (`:629–642`) are unchanged.
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
- the readings: `test_readings_api.py`, `test_readings_patient.py`, `test_readings_reconcile.py` (linked rows; the
  record's «alındı» stays the link's time).

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
- **Block A-1 (before the deploy) prints two numbers** and never a patient id:
  - an upper bound on the patients whose antibiotic picture the first restart can move (§7, items 3–4):
    `select count(distinct patient_id) from audit where event_type = 'alert' and subject in ('antibiotic_due',
    'antibiotic_overdue') and ts::timestamptz > now() - interval '48 hours'`;
  - the linked readings whose recognition, if they completed one, the first restart anchors at their measurement
    instead of their write time (§7, item 5):
    `select count(*) from audit where event_type = 'ingest' and payload->>'reading' is not null`.
  In a pasted heredoc the `psql` call takes `</dev/null`.
- **The first restart replays the old trail under the new rule** (§7).
  - For a patient with a back-dated reading after a recognition, the board may differ from the pre-deploy board.
  - An overdue the old code turned into «due» is overdue again, as one episode, with its earlier acknowledgement.
  - A «due» may now read overdue; it is stamped and told at the patient's next reading.
- **The ward is told beforehand:**
  - a late reading (a device round sent late, a set charted at its own time) never turns «gecikti» back into «kalan
    süre»;
  - when a late reading shows that the sepsis criteria were met hours ago, the hour runs from the measurement (the
    owner's choice), never from before the infection suspicion was charted or from before a rule-out. At a door
    the alert reads «gecikti» at once **only on a patient the engine has evaluated after the measurement** (a later
    reading, a withdrawal); a set linked from the list is judged at the link, so it always does. On a patient not
    evaluated since, the late value is judged at its own measurement time and the alert can read «60 min
    remaining» while the hour is long gone; until the patient's next reading the board's antibiotic countdown,
    which runs on the wall clock, is the truth (final review I-1, 2026-11-13; §12, open item 6);
  - a suspicion charted present again more than 15 min after it was ruled out starts a new hour, even if its time
    is set back to just after the rule-out. The 15 min are counted on the patient's readings, not the wall clock;
  - after «hatalı giriş» or «Düzelt», the alerts are judged as of that moment, so an antibiotic hour that ran out
    since the last reading reads «gecikti»;
  - a set linked from «Eşleşmeyen ölçümler» is scored at the moment it is linked, so an hours-old set is too old to
    count in the NEWS2 score; but if it completes the sepsis criteria, the antibiotic hour runs from its
    measurement, and «gecikti» can appear at once.
- **Rollback:** the previous api image. Nothing stored changes. Under the old image a back-dated reading is judged at
  its own time again (the false «kalan süre» comes back), and the next restart replays the trail under the old rules.

## 10. Not in this slice

- **Re-evaluation on the wall clock without a new reading.** An `antibiotic_due` turns overdue at the patient's next
  reading or withdrawal, not on its own (G2-A2 §8: «a time-based re-evaluation of alerts without new data»). The
  board's meds countdown (`board.py:174–185`) and
  the pharmacy already count down at the wall clock.
- **SOFA's "latest by stamp".** A back-dated value enters SOFA only when it is the newest of its code
  (`PatientState.latest`); otherwise it triggers an evaluation at the floor and changes no SOFA input.
- **Time zero.** D2 anchors at the measurement, bounded below by the start of the current suspicion and the last
  rule-out.
  That is an operational rule; the vault's open question («Time-zero must be defined and defensible») stands.
- **Open item for the owner: a mistaken rule-out corrected late** (the Tasks 1–2 reviewer's note). A suspicion re-charted
  present more than 15 floored minutes after a rule-out is now a new hour, even when its time is set back to just
  after the rule-out. It starts no earlier than the drop (§8.1). The 15 minutes are counted on the patient's judged
  time, which the patient's readings move; with no reading between, a late re-chart still restores. Before this
  slice, a re-chart back-dated to within 15 min of the rule-out's *requested* instant restored the old anchor,
  whatever the wall clock.
  - The reviewer named «hatalı giriş» as the tool for a mistaken rule-out. **In the code it is not:**
    `retract_entry` refuses a `suspected_infection` row with 409 `RETRACT_NOT_BEDSIDE`, because the code is not in
    `RETRACTABLE_CODES` (G3-01 X22; `clinical.py:191–198`, `app.py:1518–1524`). The sepsis panel tells the user
    the mark «geri alınmaz».
  - Today, then, a rule-out corrected after 15 min has no undo, and the new hour stands. Opening «hatalı giriş» to
    the suspicion mark is a separate decision.
- **The start of the current suspicion is read in stamp order.** An absent mark back-dated between two present marks
  ends the suspicion there. The present mark after it then begins the current one, as D2 defines it.
- **The preview** (`POST /clinical/{id}/preview`, `app.py:1317–1347`): it scores a copy of the state at the request's
  instant and never goes through the engine.
- **The shadow lane's not re-judging after a withdrawal** (D5).
- **An ahead-of-clock refusal at the doors** (G2-A2 O12).

## 11. Open items

One, for the owner, in §10: a rule-out corrected more than 15 floored minutes later has no undo, because «hatalı
giriş» refuses the suspicion mark. The new hour stands until the owner decides otherwise. The one visible
consequence, ward staff seeing an immediate «gecikti»
when a late reading reveals sepsis hours ago, is the owner's choice (D2), and §9 tells the ward. The test fallout
beyond §8.2 is known only when the plan runs. It is fixed as §8.2 says (as G3-05 O1).

## 12. As built

Plan: `docs/superpowers/plans/2026-11-12-g3-saat-geri-gitmez.md`. Built on `feat/g3-saat-geri-gitmez` (from main
`88f6544c`); code head `b537224b` (after the final review's fixes), this record on top; gates run 2026-11-13 (the
lines are in the plan's «As run» block). No migration, no environment variable, no route, permission, audit type or
screen.

**Commits, by task.**

| Task | Commit | What |
|---|---|---|
| 1 (D1) | `9dfa044d` | one floor per patient for every rule; `_news2_judged_at` → `_judged_at`; `_evaluate` |
| 2 (D2) | `072095a2` | `ingest(…, anchor_at=…)`; the restore window measured on floored instants, with the `0 <=` guard |
| D2, the owner's refinement | `90a5a1b7`, `9947ba77` (spec), `18261d11` (code) | «Şüpheden önceye gitmesin»: the anchor never precedes the start of the current suspicion or the last rule-out, and never passes `at` |
| 3 (D3) | `320632f9` | `Engine.rejudge` |
| 4 (D4, D6) | `75c2e886` | the replay: a linked row's two instants; every instant capped at the restart + `REPLAY_SKEW` (2 min) |
| 5 (D3, D6) | `4cdaa407` | a withdrawal re-judges at its own instant; the replay and the rebuild at each `chart_retract` row; the route reads `now` before the rebuild |
| 6 (D4, D5) | `18962228` | the link judged at the link and anchored at the measurement; the shadow mirror's `judge_at` |
| review | `e1471b87` | E-6's xfail takes `raises=AssertionError` (an overdue missing after the restart is a real failure); §8.1 «the anchor never passes `at`» on a suspicion mark stamped ahead of the floor |
| review | `786ff4e1` | `_suspicion_start` → `_suspicion_began` (§3's name); its unreachable `or anchor_at` fallback dropped — `septic_shock.evaluate` returns before either recognition kind unless the latest mark is present, which is the first mark `_suspicion_began` reads |
| final review I-2 | `19a59406` | the replay stamps an alert a `chart_retract` row's rejudge has firing with no stamp, at the row's write time (the live withdrawal's `_stamp_uncovered`); a later `first_seen` row of the same episode replaces that stamp; E-6's strict xfail now pins the acknowledgement only (owner, 2026-11-13: «Küçük önlemi ekle») |
| final review minors | `b537224b` | comments only: a rejudge can end an episode by the clock alone; `adopt` can lower the floor until the rejudge |

**What differs from the design above** (the plan's departures, E-1 … E-6):

- **§8.1 files (E-1, E-2).** The engine's tests are `tests/test_engine_floor.py`; the API's `tests/test_saat_api.py`;
  the replay's `tests/test_saat_replay.py`, on rows built by hand. The link's shadow check reads the shadow engine at
  stage `rules` with no monitor linked: a link only decides publication and adds monitor samples, which carry no
  SOFA or antibiotic input.
- **§8.2 (E-3).** One more premise moved than listed: `test_the_next_real_reading_after_the_restart_starts_its_own_clock`
  — its «next reading» now comes after the restart's floor.
- **D3 (E-4, E-5).** A `chart_retract` row whose `ts` has no zone is passed over like an unreadable one. A
  Postgres-marked replay test reads the withdrawal's write time from the `TEXT` column.
- **D3, «a restart equals live» (E-6, F-1) — accepted by the owner, narrowed by the final review's I-2.** It holds
  for kind, severity, urgency and anchor. It does not hold exactly for an alert the withdrawn reading's own
  evaluation raised: live keeps its acknowledgement and first sight across the withdrawal; the replay, skipping
  that reading, passes its `first_seen` and `ack` rows over, and the `chart_retract` row's rejudge raises the alert
  with neither. Since `19a59406` the replay stamps it there, at the withdrawal row's write time (before that, an
  unacknowledged overdue had no escalation clock until the patient's next reading — the reviewer's finding); the
  acknowledgement stays lost. The acknowledgement is pinned by a strict `xfail` with `raises=AssertionError`
  (`test_saat_api.py::TestAWithdrawal::test_an_acknowledged_overdue_whose_finding_reading_is_withdrawn_keeps_its_acknowledgement_after_a_restart`),
  the stamp by `test_an_unacknowledged_overdue_whose_finding_reading_is_withdrawn_still_escalates_after_a_restart`
  and `test_saat_replay.py::TestAWithdrawalRowStampsWhatItRaises`.
- **D2 as built** is §3's refined rule (`90a5a1b7`, `9947ba77`); the plan, written before it, has Task 2's
  `min(anchor_at, at)` only.

**Gates (2026-11-13).**

- Engine, no database, every file under `tests` but `test_infinity_vm_pilot.py` (never run; left out of the file
  list), at `b537224b`: **4523 passed, 1529 skipped, 1 xfailed** — `test_[a-d]*` 1369 / 827; `test_[e-l]*` 1747 /
  115; `test_[m-z]*` + `rules`, `scoring`, `tenant` 1407 / 587 / 1 xfailed. Against the baseline at `b3e57312`
  (4470 / 1528, without the 13 vm_pilot tests): +53 passed, +1 skipped (the Postgres test of `test_saat_replay.py`),
  +1 xfailed (E-6). The plan expected 4514; the nine more are the owner's refinement (5 tests, `18261d11`), the
  review's anchor test (1) and I-2's three (`19a59406`). The first run, at `786ff4e1`, gave 4520 / 1529 / 1.
- Postgres (`saat-pg`, throwaway), at `786ff4e1`: **147 passed, 0 skipped** — `test_saat_replay.py` 15,
  `test_rehydrate.py` 19, `test_audit_postgres.py` 12, `test_audit_since.py` 32, `test_bedside_trail_stores.py` 3
  (81, one call); `test_tasks_postgres.py` 10; `test_readings_postgres.py` 56 (133 s, one call). At `b537224b` the
  replay's files again: `test_saat_replay.py` (17) `test_rehydrate.py` `test_audit_postgres.py`
  `test_bedside_trail_stores.py` — 51 passed, 0 skipped. `alembic heads`: one head, `0021`.
- Python 3.14, the slice's nine files, at `b537224b`: 249 passed, 1 skipped, 1 xfailed.
- Dashboard: `git diff --stat 88f6544c HEAD -- dashboard deploy homunculus-engine/alembic` is empty; no dashboard
  run.

**Local walk (§8.4), 2026-11-13: all five items PASS, no finding.** Notes:
`/c/tmp/homunculus-plans/g3-saat/walk/notes.md` (outside the repo). Images built from `786ff4e1`, compose project
`g3saat`, synthetic tenant `saat-yuruyus`, five synthetic patients (A–E), driven through the API.

1. A late device round (stamped 4 h back, three `/ingest` calls) answered `antibiotic_overdue` each time, never
   `antibiotic_due`; the card kept the overdue acknowledged with the same first sight; no notification,
   `first_seen` or `alert_cleared` row.
2. A late value completing sepsis on a patient judged up to now read «OVERDUE by 60 min» at once, anchored at its
   stamp; one measured before the suspicion was anchored at the suspicion («30 min remaining»).
3. «Düzelt» on the device SpO₂ and «hatalı giriş» on the temperature that found the hour gone both left
   `antibiotic_overdue`, acknowledged, judged at the withdrawal; nothing latched; no new notification.
4. Restart: four patients identical (alerts, acknowledgements, first sights, summaries, anchors); on A, E-6 exactly
   as accepted then (open item 1 below): the overdue unacknowledged, `first_seen_at` null; the next reading wrote
   a new `first_seen` row and a second notification. The restart wrote no trail row. (The walk ran before I-2,
   which now stamps A's overdue at the withdrawal row; the second notification is not E-6's — open item 1.)
5. A 6 h-old linked set: on a patient with no reading before, NEWS2-high values answered `alerts: []`; on one with
   infection charted before, it answered `antibiotic_overdue` «OVERDUE by 300 min» at once, anchored at the set's
   stamp, with no NEWS2 alert.

Observations, none of them this slice's to change: the engine's summary counts its minutes at the patient's last
judged instant, not the wall clock (after the 4 h round A read «OVERDUE by 25 min» while the card's `remaining_sec`
was −1801; §10); the screens print the engine's English summaries («Antibiotic OVERDUE by 32 min»), not «gecikti» /
«kalan»; the patient page's age labels read high («5 sa önce» for 4 h 05 min, «7 sa önce» for 6 h 03 min) — the
dashboard is unchanged by this slice.

**Open items for the owner.**

1. **E-6 (accepted; narrowed by I-2).** After a restart, an overdue whose finding reading was withdrawn returns
   **unacknowledged** even if the nurse had acknowledged it, with its first sight at the withdrawal (since
   `19a59406`; before, it had none until the next reading, and an unacknowledged one did not escalate until then).
   **Its escalation is preserved; only the acknowledgement is lost**, so the overdue the nurse acknowledged
   escalates to the doctor `escalate_after` after the withdrawal unless acknowledged again. **What the ward sees:**
   the card shows the overdue unacknowledged. The walk (patient A, at `786ff4e1`, before I-2) showed
   `acknowledged: false`, `first_seen_at: null`, and at the next reading a new `first_seen` row and a **second
   notification** for the same episode. Of these, only the missing stamp was E-6's, and I-2 removed it. The second
   notification is pre-existing and not this slice's: the notifier's dedup (`Notifier._notified_new`) is not
   replayed, so after any API restart the first reading of a patient with an immediate alert tells the nurse again —
   an acknowledged overdue never withdrawn included (checked on `b537224b`: one notification, no `first_seen` row).
   It is worth its own decision.
2. **Its mirror image (from the review).** A wrong value whose evaluation ended an acknowledged episode prunes the
   acknowledgement live (the hook), and the withdrawal's rejudge raises the alert again as a new, unacknowledged
   episode. After a restart the wrong row is skipped, the episode never ended, and the old acknowledgement stands:
   acknowledged and not escalating — the shape of the recorded stale-acknowledgement risk (§7).
3. **The «already» repair (rare).** A withdrawal whose `chart_retract` row committed while its append raised is
   finished by the retry, which re-judges at the retry's instant. The replay re-judges at the row's own `ts`. If the
   antibiotic hour ran out between the two, live shows the overdue (stamped and told at the retry) and a restart
   shows «due» until the patient's next reading. It needs all four: a committed-then-raised append, a retry, the
   hour running out between them, a restart.
4. **No undo for a rule-out corrected after 15 floored minutes** (§10). «Hatalı giriş» refuses the suspicion mark
   (`RETRACT_NOT_BEDSIDE`), so the new hour stands; opening it to the mark is a separate decision.
5. **The 15-minute restore window counts judged time**, which the patient's readings move, not the wall clock: with
   no reading between, a late re-chart still restores; with readings past 15 min it starts a new hour, from the drop
   at the earliest.
6. **Antibiyotik saatinin gerçek saate göre değerlendirilmesi — ayrı küçük dilim (sahip kararı 2026-11-13: «Belgeyi
   düzelt, sonra düzelt»; final review I-1).** The floor only stops a clock going back. A late value stamped
   *later* than the patient's last evaluation is still judged at its own stamp, so on a patient not evaluated since,
   the antibiotic alert can read «60 min remaining» (`antibiotic_due`, HIGH/SOON: no nurse notification, no
   escalation) while the board's countdown, on the wall clock, is negative. The reviewer's probes: suspicion charted
   7 h ago with no reading since, then a MAP of 60 charted at −6 h → `antibiotic_due` «60 min remaining»; a lab
   drawn 2 h ago charted now on a patient last evaluated 3 h ago → «60 min remaining», the board −3600 s.
   Pre-existing (before this slice every late value was judged at its stamp), not a regression. **Proposed fix**
   (the reviewer's): the doors pass the wall clock as a third instant, used only by the antibiotic clock; the replay
   passes the row's write time. Until then §9's ward note says the board's countdown is the truth.

**Deploy notes for the controller lane** (Lane A writes the blocks; the owner's «onay» runs them):

- **Images: api only** — the engine change. No migration, no environment variable, no web or bridge change.
- **Block A-1 (before the deploy) prints two numbers, never a patient id** (in a pasted heredoc `psql` takes
  `</dev/null`):
  - patients with an `antibiotic_overdue` episode that ended and was raised again — the episodes the first restart
    may replay as one, with an earlier acknowledgement (§7, item 3); an upper bound, since an episode can also end on
    a real reading:
    `select count(distinct (c.tenant, c.patient_id)) from audit c where c.event_type = 'alert_cleared' and c.subject
    = 'antibiotic_overdue' and exists (select 1 from audit f where f.tenant = c.tenant and f.patient_id =
    c.patient_id and f.event_type = 'first_seen' and f.subject = 'antibiotic_overdue' and f.id > c.id)`;
  - linked readings, whose recognition, if they completed one, the first restart anchors at their measurement (§7,
    item 5): `select count(*) from audit where event_type = 'ingest' and payload->>'reading' is not null`.
- **The first restart replays the old trail under the new rule** (§7): such a patient's board may differ from the
  pre-deploy board.
- **The ward is told beforehand** (§9 in full), first of all: a late reading never turns «gecikti» back into «süre
  var»; a sepsis completed by a late reading can show «gecikti» at once (the hour runs from the measurement, never
  from before the suspicion was charted or a rule-out) — at once only on a patient evaluated after the
  measurement; otherwise the alert can read «60 min remaining» until the next reading, and the board's countdown is
  the truth (open item 6).
- **E-6 after a restart** (open item 1): an acknowledged overdue whose finding reading was withdrawn comes back
  unacknowledged, escalating from the withdrawal; its escalation is not lost. The block need not change for it.
- **Rollback:** the previous api image; nothing stored changes (§9).
