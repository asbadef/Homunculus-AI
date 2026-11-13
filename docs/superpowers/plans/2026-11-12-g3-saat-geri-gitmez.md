# G3-06 Saat geri gitmez Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reading that reaches the engine late — a device round sent late, a set charted at its own time, «Düzelt»'s corrected value, a set linked from the unmatched list — never turns a time-based rule backwards: an overdue antibiotic stays overdue, its episode and acknowledgement survive, a withdrawal judges the alerts as of its own instant, and a restart agrees.

**Architecture:** Spec `docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md` (`b3e57312`, approved by the owner 2026-11-12; D1–D7 are final, the link case included) — read it whole before your first task. The engine keeps one floor per patient, `_judged_at` (today's `_news2_judged_at`, renamed), and judges EVERY rule at `at = max(requested, floor)`; the reading keeps its own stamp. `Engine.ingest` gains a keyword `anchor_at` (the anchor of a recognition the reading completes) and the body moves into `_evaluate`, which a new `Engine.rejudge` shares. The anchor's restore test compares floored instants. The doors change no code; the link passes two instants (judged at the link, anchored at the measurement), so does the shadow mirror; the replay asks for the same two instants, caps every instant at its clock plus 2 min, and re-judges at each `chart_retract` row, as the live withdrawal now re-judges at its own instant. No migration, no route, no permission, no UI change.

**Tech Stack:** Python 3.12 / FastAPI / pytest (no-DB suite; three Postgres-marked files on a throwaway container). No dashboard change.

---

## Ground rules

Read these before Task 0. They are the rules of `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md` «Ground rules», restated for this worktree.

- **Worktree:** `C:\tmp\g3-saat` (Git Bash `/c/tmp/g3-saat`), branch `feat/g3-saat-geri-gitmez`, head `b3e57312` plus this plan's commit. Work ONLY here. Never touch `c:\Users\User\Desktop\Project\Homunculus AI` (the main checkout) or any other worktree under `/c/tmp`. Pushing this feature branch is allowed (`git push origin feat/g3-saat-geri-gitmez`). **Nothing in this plan pushes to `main` or touches the hospital VM:** both are the owner's word, through Lane A.
- **Do not change** anything under `dashboard/`, `alembic/`, `deploy/`, or the rule modules `src/homunculus/rules/*.py`, `src/homunculus/model/scorer.py` (spec §3: they already take the instant as a parameter; no threshold, window or citation changes). If a step seems to need one of them, stop and report.
- **Code exploration:** there is no `graphify-out/` in this worktree: read the files with Grep and Read. If you do find `graphify-out/graph.json` inside `/c/tmp/g3-saat`, run `graphify query "<question>"` before your first grep.
- **Engine tests** run in the FOREGROUND, on a bounded selection (the files a step names), written out in full each time (shell variables do not persist between tool calls):
  ```
  cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  An implementer never runs the whole suite and never a command longer than 180 s (every command below was timed on the scratch copy; the longest about 60 s, twice that on a loaded machine): the controller runs the whole suite (Task G1). **Never run `tests/test_infinity_vm_pilot.py`** (it hangs). **Never background a test run and wait on it**; if something must wait, report first.
- **Never export or set `DATABASE_URL`.** A DB-backed test runs only with `TEST_DATABASE_URL=…` written on the command line itself, against a database whose name contains `test` (`tests/conftest.py` refuses any other), and only on this slice's throwaway Postgres (below). **Never the shared `56432`.**
- **The throwaway Postgres** (`saat-pg`, port 56454; the DB tests drop every table). Each line is one foreground call:
  ```bash
  docker run -d --rm --name saat-pg -p 127.0.0.1:56454:5432 -e POSTGRES_PASSWORD=saat -e POSTGRES_DB=saat postgres:16
  timeout 90 bash -c 'until docker exec saat-pg pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done' && docker exec saat-pg createdb -U postgres saat_test
  cd /c/tmp/g3-saat/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:saat@127.0.0.1:56454/saat_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  docker stop saat-pg
  ```
  `pg_isready -h 127.0.0.1` on purpose: the image's first start runs a temporary server on the socket only, and a check without `-h` answers «ready» seconds before that server is shut down again. One pytest at a time against it. Always `docker stop saat-pg` at the end; `--rm` then deletes it.
- **Python scripts** that print Turkish run with `python -I -X utf8` (`-I` ignores `PYTHONIOENCODING`, and cp1252 cannot print «ğ»).
- **Git:** never `git stash`; never `git add -A`, never `git commit -a`. Every commit names its paths and carries the trailer — each task's last step gives the exact command, in this shape:
  ```
  cd /c/tmp/g3-saat && git add -- <paths> && git commit -m "<subject>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- <paths>
  ```
  The pathspec matters: another lane may have files staged at the same moment. If `.git/index.lock` exists, another process is committing: wait a few seconds and retry; never delete it.
- **Line endings.** `core.autocrlf=true` here: every tracked text file is CRLF in the working tree and LF in the repository. Every block in this plan is LF; the Edit tool matches either way and keeps the file's endings. Edit existing files with the **Edit** tool; create new files with the **Write** tool. **Never write code with a Bash heredoc or `sed -i`** — the Bash tool collapses backslashes inside heredocs, and Git Bash's `sed -i` rewrites CRLF files as LF. After editing an existing file, `git diff --stat -- <file>` must show only the lines you meant (a whole-file diff means the endings were rewritten: restore the file with `git checkout -- <file>` and redo the edit).
- **Find blocks.** Every «find» block below occurs **exactly once** in its file at that point of the plan, and the line numbers printed beside it are the file's at that point: each was applied, in order, to a scratch copy of the tree at `b3e57312` when the plan was written (a script applied every block of this file and checked each count and each line range), and every «Expected» line was seen there. If a block does not match, stop and report; do not guess.
- **Style.** Every new Python file starts with its `# homunculus-engine/…` path comment and a docstring that says what and why. Comments and docstrings name the decision they carry out (`G3-06, D1` …), as the files around them do.
- **No patient data anywhere** (CLAUDE.md rule 6): synthetic keys only (`bed-3`, the readings tests' `202600000001`), synthetic values, made-up device names (`CONNEX-3A`, `POC-7`).
- **Clinical register (hard rules 1 and 5).** This slice changes **when** a rule is judged, never a rule: no threshold, no window, no score, no citation, no wording a clinician reads. The 1 h antibiotic window (SSC 2026), the 3 h fluid window (Sepsis-3, SSC 2026), the 15 min restore window (G2-A1 X12) and the 24 h back-dating bound (G3-01 D7) stay as they are. Its one new number is an engineering bound: the replay's 2 min ceiling, which is the bedside door's existing clock skew (`BEDSIDE_SKEW`). Time zero stays a vault open question (spec D2). If a step seems to need a threshold, a judgement on a value or an instruction to a clinician, stop and report.

### Order and file ownership

One lane (the engine), in this order — each task depends on the one before it:

1. **Task 0** (the implementer): preflight. The controller records the baseline (Step 3).
2. **Task 1** → **Task 2** → **Task 3** → **Task 4** → **Task 5** → **Task 6**.
3. **Closing (controller):** G1 (gates) → G2 (the local walk) → D1 (docs).

| Lane | Tasks | Files (only these) |
|---|---|---|
| Engine | 1–6 | `homunculus-engine/src/homunculus/pipeline.py`, `api/rehydrate.py`, `api/app.py`, `api/clinical.py` (a docstring), `api/infinity_rules.py`; `homunculus-engine/tests/` — new: `test_engine_floor.py`, `test_saat_api.py`, `test_saat_replay.py`; edited: `test_engine_adopt.py`, `test_engine_forget.py`, `test_bedside_retract.py`, `test_bedside_rebuild.py`, `test_pipeline.py` (a comment), `test_readings_api.py`, `test_infinity_rules.py` |
| Controller | G1, G2, D1 | `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md` (one dated amendment), `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (§11.5 (a), (c)), the spec's «As built», this plan's «As run»; the walk's notes outside the repo |

Files other lanes edit often — keep these diffs minimal and expect a late, trivial merge: `api/app.py` (every lane), `tests/test_readings_api.py` and `tests/test_infinity_rules.py` (one test each, appended or inserted at one place), the guide's § number and the roadmap's G3 table (G3-07 «Kabul zamanı» is specced on another branch).

**No pin moves** (spec D7): `EXPECTED` (`test_route_permissions.py`), `BOARD_EXPECTED`, `CALLER_RESOLVED_ROUTES`, `UNSCOPED_BY_DESIGN`, `SPEC_KEYS`, nginx `API_PATHS`, the dashboard's `EVENT_TYPES`, the alembic head. The gate (Task G1) holds them by running their files unchanged.

### Interfaces (the names every task uses — defined once, here)

**The engine** — `homunculus.pipeline.Engine`:

```python
def ingest(self, obs: Observation, now: datetime, *, anchor_at: datetime | None = None) -> list[Alert]
    # `now`: the REQUESTED instant (the name stays). `anchor_at`: the anchor of a recognition this reading
    # completes; None is `now` (the doors' one instant). Task 1 adds the floor; Task 2 adds `anchor_at`.
def rejudge(self, patient_id: str, now: datetime) -> list[Alert]              # Task 3
    # The evaluation on the state as it stands, no reading added, at max(now, floor). A patient the engine
    # holds no reading for answers [] and is not created (`patient_ids()` is the test).
def _evaluate(self, patient_id: str, state: PatientState, requested: datetime,
              anchor_at: datetime) -> list[Alert]                                # Task 1 (3 params), Task 2 (4)
    # at = max(requested, self._judged_at.get(patient_id, requested)); self._judged_at[patient_id] = at
def _new_anchor(self, patient_id: str, anchor: datetime, at: datetime) -> datetime   # Task 2
    # restores iff 0 <= (at - dropped_at).total_seconds() <= ANCHOR_RESTORE_S; else `anchor`; the drop is spent
```

`_judged_at: dict[str, datetime]` replaces `_news2_judged_at` and stays in `_PER_PATIENT` (so `forget`, `copy`, `adopt` carry it). `_dropped_anchor[pid] = (anchor, at)` — the drop's FLOORED instant (Task 2). The anchor set by a recognition is `self._new_anchor(pid, min(anchor_at, at), at)` (Task 2; Task 1 keeps today's `self._new_anchor(pid, requested)`).

**The replay** — `homunculus.api.rehydrate`:

```python
REPLAY_SKEW = BEDSIDE_SKEW                       # 2 min (api/clinical.py), Task 4
def _replay_ingest(engine: Engine, rec: AuditRecord, written: datetime, ceiling: datetime) -> bool   # Task 4
def rehydrate(engine, store, records, *, skip=frozenset(), skip_device=frozenset(), now=None) -> None
    # unchanged signature; ceiling = now + REPLAY_SKEW (Task 4); a `chart_retract` branch (Task 5)
def rebuild_patient(engine, patient_id, records, *, skip, skip_device=frozenset(), now=None) -> None
    # `now` (default: the clock) caps at now + REPLAY_SKEW (Task 4); rejudges at `chart_retract` rows (Task 5)
def _retracted_at(rec: AuditRecord) -> datetime | None    # Task 5: the row's `ts`, or None (unreadable, no zone)
```

**The instants each caller passes** (spec §3, as built):

| Caller | `now` (judged at, floored) | `anchor_at` |
|---|---|---|
| `/ingest` (`_apply_reading`, `judge_at=None`), `/clinical` (`chart_observations`), the admission weight | `min(stamp, wall)` | the same (passed explicitly by `_apply_reading`, defaulted by `chart_observations`) |
| the link (`_apply_reading`, `judge_at=wall_now`) | `wall_now` | `min(stamp, wall_now)` |
| the shadow mirror (`mirror_observation`, `judge_at`) | `min(stamp, now)`, or `judge_at` | `min(stamp, now)` |
| the replay, an ordinary row | `min(stamp, written, ceiling)` | the same |
| the replay, a linked row (`payload.reading`) | `min(written, ceiling)` | `min(stamp, written, ceiling)` |
| `rejudge`: the withdrawal (`_adopt_rebuilt`) / the replay and the rebuild at a `chart_retract` row | the request's `now` / `min(ts, ceiling)` | — |

The lifecycle hook's instant does not change anywhere: the request's wall clock at the doors, the link and the withdrawal; the row's write time (`written`, or the `chart_retract` row's `ts`) in the replay — never capped.

**The API** — closures of `create_app` (`api/app.py`), signatures unchanged: `_apply_reading(hospital, obs, record, wall_now, *, reading=None, judge_at=None, linked_by=None, on_written=None)` computes `requested = min(obs.timestamp, wall_now)` and calls `engine.ingest(obs, now=requested if judge_at is None else judge_at, anchor_at=requested)` and `lane.mirror_observation(hospital, obs, now=wall_now, real=engine, judge_at=judge_at)` (Task 6); `_adopt_rebuilt(...)` calls `engine.rejudge(patient_id, now)` right after `engine.adopt(scratch, patient_id)` (Task 5); `retract_entry` reads `now` before the rebuild and calls `rebuild_patient(..., now=now)` (Task 5).

**The shadow lane** — `ShadowLane.mirror_observation(self, hospital, obs, *, now, real, judge_at=None)` (Task 6).

**Test helpers** (new files; later tasks use them by these names):

- `tests/test_engine_floor.py` (Task 1): `T0` (2026-07-14 10:00 UTC), `PID = "bed-3"`, `_at(minute)`, `_obs(code, value, minute, patient=PID)`, `_door(eng, code, value, minute, *, wall=None, patient=PID)` (requested at `min(stamp, wall)`), `_sepsis(eng, minute, *, wall=None)`, `_kinds(eng, patient=PID)`, `_summary(eng, kind, patient=PID)`.
- `tests/test_saat_api.py` (Task 1): `TOKEN`, `DEVICE`, `NURSE`, `PID`, `WHY`, `CONNEX`, `_app(audit)`, `_chart(c, entries, at) -> {code: entry}`, `_device(c, code, value, at)`, `_card(c)`, `_firing(card) -> {kind: alert}`, `_anchor(card)`, `_count(audit, kind)`, `_overdue(c, now, *, ack=True) -> (overdue, temperature entry)`, `_same_after_a_restart(audit, live)`; Task 6 adds `_linking_app(tmp_path, audit, store, identities)`.
- `tests/test_saat_replay.py` (Task 4): `NOW` (2026-11-12 12:00 UTC, the restart's clock), `PID`, `_row(id_, kind, code, value, stamp, ts, patient=PID, **extra)`, `_linked_sepsis(written) -> (rows, stamp)`, `_summary(engine, kind)`, `_hooks(monkeypatch)`; Task 5 adds `_withdrawal(id_, entry, ts, patient=PID)` and `_overdue_trail(withdrawn_at)`.

### File structure — what each new file is for

| File | Its one responsibility |
|---|---|
| `tests/test_engine_floor.py` | the engine alone: the floor for every rule (D1), the anchor and the restore rule (D2), `rejudge` (D3) |
| `tests/test_saat_api.py` | through the API: the doors, «Düzelt», the withdrawal, the link — each with a restart by a second app on the same audit |
| `tests/test_saat_replay.py` | the replay and the rebuild on rows built by hand, so every write time is exact: a linked row's two instants (D4), the ceiling (D6), the `chart_retract` row (D3) |

Modified files and their line ranges are listed under each task's **Files**.

### Departures from the spec (E-n: what the spec says · what the code is · what the plan does)

- **E-1 · Three new test files.** Spec §8.1 names `tests/test_pipeline.py` «or a new `tests/test_engine_floor.py`» for the engine and gives the API tests no file. The plan: `tests/test_engine_floor.py` (the engine), `tests/test_saat_api.py` (through the API), `tests/test_saat_replay.py` (the replay and the rebuild on rows built by hand, so each write time is exact — the in-memory audit stamps rows with the real clock). `tests/test_rehydrate.py`, `test_api_ingest.py` and `test_api_clinical.py` are not edited; they are on the run list.
- **E-2 · The link's shadow check runs without a monitor linked.** Spec §8.1: «The shadow engine (stage `rules`, the patient linked to a monitor) holds the same anchor and the same antibiotic finding.» `mirror_observation` feeds every patient's reading to the shadow engine; a monitor link only decides whether a finding is published (`_publish`, for a non-provisional link) and adds monitor samples, which carry no SOFA or antibiotic input. The API test runs the app at stage `rules` (the readings harness has no monitor strip) and reads the shadow engine's anchor and antibiotic finding; a unit test in `test_infinity_rules.py` pins `judge_at` on the lane itself.
- **E-3 · A fourth premise moves.** Spec §8.2 names `_equal_to_never_charted`, `_withdraw_live` and the shock test's instants. Running the plan moved one more: `test_bedside_rebuild.py::TestRestartEqualsTheLiveRebuild::test_the_next_real_reading_after_the_restart_starts_its_own_clock`. Its «next real reading» at `EARLY + 3 h` is earlier than the restart's floor — the withdrawal row's write time, the real clock — so the hour it starts is already over. The reading moves to the clock (Task 5 Step 6); the floor is not weakened (spec §11: fallout beyond §8.2 is fixed as §8.2 says).
- **E-4 · A `chart_retract` `ts` with no zone counts as unreadable.** Spec D3/§4: «A row whose `ts` cannot be read is passed over.» A zone-less time cannot be compared with the clock — `min(at, ceiling)` would raise and fail the whole tenant's replay — so `_retracted_at` answers None for it too. The audit always writes UTC; the case is defensive.
- **E-5 · A Postgres-marked replay test.** Spec §8.4 gates «the Postgres-marked audit and rehydrate tests»; none replayed a Postgres trail. The plan adds `test_saat_replay.py::test_a_postgres_trail_is_rejudged_at_its_withdrawal_row` (the withdrawal's write time read from the `TEXT` column), on `test_bedside_trail_stores.py`'s `pg_log` fixture, run in G1 Step 2.
- **E-6 · F-1: after a restart, the first sight and the acknowledgement of an alert the withdrawn reading's own evaluation raised are lost (found while this plan was written).** D3 says «With D3, a restart equals live». It holds for what §8.1 compares — kind, severity, urgency and anchor — and not for the acknowledgement store in one case: the reviewers' scenario with the overdue acknowledged. Live, the overdue the temperature found stays one episode across the temperature's withdrawal (the rejudge keeps it firing): acknowledged, first seen at the temperature's request. The replay skips the temperature row, so at the `first_seen` and `ack` rows that follow it no overdue is firing, and `rehydrate` passes both over (G3-01 D12's guard; `_replay_ack`); the `chart_retract` row's rejudge then raises the overdue unstamped and unacknowledged. After a restart it is stamped at the patient's next reading and escalates from there, though the nurse had acknowledged it. Before this slice live ended that episode too (rebuilt to the last remaining row, «due»), so live and restart agreed — wrongly, but alike. The plan builds the spec as written and pins the gap as a strict `xfail` (`test_saat_api.py::TestAWithdrawal::test_an_acknowledged_overdue_whose_finding_reading_is_withdrawn_keeps_both_after_a_restart`): a fix turns it into an `XPASS(strict)` failure, and the mark goes with the fix. A fix needs a replay rule the spec does not have — for example, replay a withdrawn row as a rejudge at its own requested instant, without its value — so it is the owner's decision; the «As built», the guide and the deploy notes say so.

---

## The tasks

### Task 0: Preflight — the baseline is green before anything changes (the implementer, once; the controller records the numbers)

**Files:** none.

- [ ] **Step 1: The worktree**

Run: `cd /c/tmp/g3-saat && git status --short && git log --oneline -2 && git rev-parse --abbrev-ref HEAD`
Expected: no changes listed; the head is this plan's commit, its parent `b3e57312 docs(spec): G3-06 — a linked set is judged at the link and anchored at its measurement (owner, 2026-11-12)`; branch `feat/g3-saat-geri-gitmez`.

- [ ] **Step 2: pytest imports the worktree's code, and the files this plan edits are green**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "import homunculus; print(homunculus.__file__)"`
Expected: a path under `C:\tmp\g3-saat\homunculus-engine\src`. Anything else: stop and report.

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_pipeline.py tests/test_engine_adopt.py tests/test_engine_forget.py tests/test_bedside_retract.py tests/test_bedside_rebuild.py tests/test_readings_api.py tests/test_infinity_rules.py 2>&1 | tail -3`
Expected: `308 passed` — measured per file at `b3e57312`: `test_pipeline.py` 39, `test_engine_adopt.py` 11, `test_engine_forget.py` 3, `test_bedside_retract.py` 49, `test_bedside_rebuild.py` 33, `test_readings_api.py` 111, `test_infinity_rules.py` 62 (about 40 s). **If a number differs, another lane has merged since:** tell the controller, and shift this plan's counts for that file by the difference — the edits themselves do not change.

- [ ] **Step 3 (controller only): the baseline of the whole no-DB suite**

Run Task G1 Step 1's three chunks at this plan's commit and keep the numbers; G1's expected totals are these plus the additions it states. Measured when the plan was written, at `b3e57312` (on a scratch copy that is a git repository: `test_dev_waves_*` and `test_infinity_release.py` need one):

- `tests/test_[a-d]*.py`: **1369 passed, 827 skipped**;
- `tests/test_[e-l]*.py` without `test_infinity_vm_pilot.py` (G1's file list, not `--ignore`: see G1 Step 1): **1719 passed, 115 skipped**;
- `tests/test_[m-z]*.py tests/rules tests/scoring tests/tenant`: **1382 passed, 586 skipped**;
- **4470 passed, 1528 skipped**, no failure.

---

### Task 1: One floor per patient for every rule (D1) — the engine, the doors, the shadow copy

**Files:**
- Test: `homunculus-engine/tests/test_engine_floor.py` (new)
- Test: `homunculus-engine/tests/test_saat_api.py` (new)
- Test: `homunculus-engine/tests/test_readings_api.py` — lines 692–700 (as the step finds the file)
- Test: `homunculus-engine/tests/test_infinity_rules.py` — after line 1094 (the end of the file)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` — lines 49–50, 60–61, 89–110, 139–155, 171–175, 185–187, 294–295 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` — lines 355–356 (a docstring)
- Test: `homunculus-engine/tests/test_engine_adopt.py` — lines 153, 184, 191 · `test_engine_forget.py` — lines 38–39 · `test_bedside_retract.py` — line 120 · `test_pipeline.py` — lines 579–580 (the rename, a comment)

Every rule the engine runs judges a patient at `at = max(requested, the patient's floor)`: septic shock, sepsis and the 3 h fluid window, the antibiotic clock, the model — as NEWS2, the patient-relative layer and the hold already do (G2-A2 X9e). `_news2_judged_at` becomes `_judged_at`, and the body of `ingest` moves into `_evaluate`, which Task 3's `rejudge` shares. The anchor of a recognition stays the requested instant, and the restore test stays on requested instants: Task 2 changes both. The doors change no code — `min(stamp, wall)` is now the instant they ASK for — so the API tests of this task pass on the engine change alone. The shadow lane's engine is a copy of the real one, the floor with it.

- [ ] **Step 1: The engine's failing tests**

Create `homunculus-engine/tests/test_engine_floor.py`:

```python
# homunculus-engine/tests/test_engine_floor.py
"""G3-06 «Saat geri gitmez» (spec D1–D3): every rule judges a patient no earlier than the patient's last
judgement. A reading stamped in the past keeps its stamp — the state, freshness and the trail hold it there —
but it is judged at the patient's floor, so no time-based rule goes backwards: an overdue antibiotic stays
overdue, the 3 h fluid window and the model read the same instant, and an acknowledged episode does not end
on a late value. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import sync_alerts
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
PID = "bed-3"


def _at(minute: float) -> datetime:
    return T0 + timedelta(minutes=minute)


def _obs(code, value, minute, patient=PID):
    return Observation(patient, code, value, "u", _at(minute), "dev")


def _door(eng, code, value, minute, *, wall=None, patient=PID):
    """One reading as a door hands it on: requested at min(its stamp, the wall clock) (G2-A2, X10). `wall`
    defaults to the stamp — a reading that arrives as it is measured."""
    o = _obs(code, value, minute, patient)
    return eng.ingest(o, now=min(o.timestamp, _at(minute if wall is None else wall)))


def _sepsis(eng, minute, *, wall=None):
    """Suspected infection, platelets 80 and creatinine 3.5: SOFA 5 over an assumed baseline of 0 — `sepsis`,
    and the antibiotic hour from the recognition (tests/test_pipeline.py `_sepsis_charted`)."""
    for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5),
                        (SignalCode.SUSPECTED_INFECTION, 1.0)]:
        _door(eng, code, value, minute, wall=wall)


def _kinds(eng, patient=PID):
    return {a.kind for a in eng.active_alerts(patient)}


def _summary(eng, kind, patient=PID):
    return next(a.summary for a in eng.active_alerts(patient) if a.kind == kind)


class TestOverdueStaysOverdue:
    def test_a_reading_stamped_four_hours_back_leaves_an_overdue_antibiotic_overdue(self):
        # The reviewers' timeline (spec §1): sepsis at +0, overdue at +120, then a reading stamped -240. Judged
        # at its stamp it read «Antibiotic window: 300 min remaining» — false reassurance.
        eng = Engine()
        _sepsis(eng, 0)
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min"
        alerts = _door(eng, SignalCode.SPO2, 97, -240, wall=130)
        assert "antibiotic_due" not in {a.kind for a in alerts}
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min", "judged at +120, the floor"
        assert eng.state(PID).latest(SignalCode.SPO2).timestamp == _at(-240), "the value keeps its own stamp"
        assert eng._judged_at[PID] == _at(120)

    def test_an_acknowledged_overdue_keeps_its_acknowledgement_first_sight_and_episode(self):
        # The lifecycle hook (api/alert_lifecycle.py) ended the episode the back-dated reading's «due» replaced,
        # pruning its acknowledgement and first sight; the next current reading raised it as a NEW episode.
        eng, store = Engine(), AckStore()
        key = (PID, "antibiotic_overdue")

        def door(code, value, minute, wall):
            _door(eng, code, value, minute, wall=wall)
            cleared = sync_alerts(eng, store, PID, _at(wall))
            for a in eng.active_alerts(PID):
                store.stamp_first_seen(PID, a.kind, _at(wall))
            return cleared

        for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5),
                            (SignalCode.SUSPECTED_INFECTION, 1.0)]:
            door(code, value, 0, 0)
        door(SignalCode.HEART_RATE, 80, 120, 120)
        first = store.first_seen[key]
        store.acknowledge(PID, "antibiotic_overdue", "nurse", _at(125))
        assert door(SignalCode.SPO2, 97, -240, 130) == [], "no episode ends"
        assert key in store.acks and key in store.firing
        assert store.first_seen[key] == first == _at(120)
        door(SignalCode.HEART_RATE, 82, 140, 140)
        assert store.first_seen[key] == first and key in store.acks, "the next reading continues the episode"


class TestEveryRuleJudgesAtTheFloor:
    def test_a_late_reading_that_completes_sepsis_on_a_judged_patient_is_overdue_at_once(self):
        # Infection charted at +0, the patient judged up to +360; a bilirubin of 3.0 (2 SOFA points) measured at
        # +0 arrives at +360. Its recognition is anchored at its requested instant, +0, and the clock is read at
        # +360: the hour ran out five hours ago.
        eng = Engine()
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, 0)
        _door(eng, SignalCode.HEART_RATE, 80, 360)
        assert "sepsis" not in _kinds(eng)
        _door(eng, SignalCode.BILIRUBIN, 3.0, 0, wall=360)
        assert eng.recognized_at(PID) == _at(0)
        assert "antibiotic_due" not in _kinds(eng)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 300 min"

    def test_a_fresh_patients_first_reading_is_judged_at_its_own_stamp_as_before(self):
        # No floor yet: a patient the engine has never judged is judged at the requested instant itself.
        eng = Engine()
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, -360, wall=0)
        _door(eng, SignalCode.BILIRUBIN, 3.0, -360, wall=0)
        assert eng.recognized_at(PID) == _at(-360)
        assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining"
        assert eng._judged_at[PID] == _at(-360)

    def test_the_three_hour_fluid_window_is_read_at_the_floor(self):
        # Septic shock at +0 on a bolus given at -30. At +200 the bolus is outside the 3 h window: the shock
        # criterion's «adequate fluid» no longer holds. A reading stamped +10 used to be judged at +10, where the
        # bolus counted again, and brought the shock back.
        eng = Engine()
        for code, value, minute in [(SignalCode.SUSPECTED_INFECTION, 1.0, 0), (SignalCode.WEIGHT_KG, 100, 0),
                                    (SignalCode.CRYSTALLOID_BOLUS_ML, 3000, -30), (SignalCode.MAP, 60, 0),
                                    (SignalCode.NOREPINEPHRINE_RATE, 0.12, 0), (SignalCode.LACTATE, 3.1, 0)]:
            _door(eng, code, value, minute, wall=0)
        assert "septic_shock" in _kinds(eng)
        _door(eng, SignalCode.HEART_RATE, 80, 200)
        assert "septic_shock" not in _kinds(eng)
        _door(eng, SignalCode.SPO2, 97, 10, wall=205)
        assert "septic_shock" not in _kinds(eng), "judged at +200: the bolus is still outside the window"
        assert "under_resuscitated_sepsis" in _kinds(eng)

    def test_the_model_is_scored_at_the_floor(self):
        # The optional model seam (`Engine.set_model`) takes the instant as a parameter too; a stand-in records
        # the instants it is asked at and never fires.
        class _Spy:
            threshold = 2.0

            def __init__(self):
                self.seen = []

            def score(self, state, now):
                self.seen.append(now)
                return 0.0, []

        eng, spy = Engine(), _Spy()
        eng._scorer = spy
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        _door(eng, SignalCode.SPO2, 97, -240, wall=130)
        assert spy.seen == [_at(120), _at(120)]


class TestTheFloorIsPerPatientMemory:
    def test_it_is_listed_with_the_engines_per_patient_dicts(self):
        assert "_judged_at" in Engine._PER_PATIENT and "_news2_judged_at" not in Engine._PER_PATIENT

    def test_another_patients_floor_is_its_own(self):
        eng = Engine()
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        _door(eng, SignalCode.HEART_RATE, 80, -240, patient="bed-4", wall=130)
        assert (eng._judged_at[PID], eng._judged_at["bed-4"]) == (_at(120), _at(-240))

    def test_copy_adopt_and_forget_move_it(self):
        real = Engine()
        _sepsis(real, 0)
        _door(real, SignalCode.HEART_RATE, 80, 120)
        twin = real.copy()
        assert twin._judged_at == real._judged_at
        _door(twin, SignalCode.SPO2, 97, -240, wall=130)
        assert _summary(twin, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min", "the copy's floor is +120"
        other = Engine()
        other.adopt(real, PID)
        assert other._judged_at[PID] == _at(120)
        other.forget(PID)
        assert PID not in other._judged_at
```

- [ ] **Step 2: The doors' failing tests — `/ingest`, `/clinical`, «Düzelt», each with a restart; the door's sibling of the link test; the shadow copy**

Create `homunculus-engine/tests/test_saat_api.py`:

```python
# homunculus-engine/tests/test_saat_api.py
"""G3-06 «Saat geri gitmez» through the API (spec §8.1): a late reading — a device round sent late, a set charted
at its own time, the corrected value «Düzelt» charts at the reading's time, a set linked from the unmatched list —
never turns an overdue antibiotic back into a running hour or ends its episode and acknowledgement; a withdrawal
judges the alerts as of its own instant; and a restart (a second app on the same audit) agrees. Synthetic patients
and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.canonical import SignalCode
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
PID = "bed-3"
WHY = "cihaz yanlış hastaya ölçmüş, yeniden ölçüldü"
#: A Connex round: the four values a ward device sends (no respiration rate, no consciousness).
CONNEX = [("spo2", 97), ("heart_rate", 88), ("temperature", 37.2), ("sbp", 118)]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit) -> TestClient:
    return TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit))


def _chart(c, entries, at) -> dict[str, int]:
    """Chart as the nurse at `at`; the answer's entry ids by code."""
    r = c.post(f"/clinical/{PID}", json={"entries": entries, "recorded_at": at.isoformat()}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _device(c, code, value, at) -> dict:
    r = c.post("/ingest", json=obs(code, value, PID, at), headers=DEVICE)
    assert r.status_code == 200 and "alerts" in r.json(), r.text
    return r.json()


def _card(c) -> dict:
    return next(p for p in c.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == PID)


def _firing(card) -> dict[str, dict]:
    """The alerts firing now, by kind (a latched one carries `resolved_at`)."""
    return {a["kind"]: a for a in card["alerts"] if a["resolved_at"] is None}


def _anchor(card) -> str | None:
    clock = (card.get("meds") or {}).get("antibiotic_clock") or {}
    return clock.get("recognized_at")


def _count(audit, kind) -> int:
    return len(audit.records(tenant="h1", patient_id=PID, event_type=kind, limit=1000))


def _overdue(c, now, *, ack=True) -> tuple[dict, int]:
    """Suspected infection with platelets 120 is SOFA 1; a MAP of 60 measured at -90 min makes it sepsis there and
    starts the antibiotic hour; a temperature measured at -5 min finds the hour gone with no antibiotic given:
    «OVERDUE by 25 min» (tests/test_readings_api.py `_overdue`). Acknowledged unless `ack` is False. Answers the
    overdue as the card shows it, and the temperature's entry."""
    _chart(c, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
           now - timedelta(minutes=90))
    _chart(c, [{"code": "map", "value": 60}], now - timedelta(minutes=90))
    entry = _chart(c, [{"code": "temperature", "value": 37.0}], now - timedelta(minutes=5))["temperature"]
    if ack:
        r = c.post("/ack", json={"patient_id": PID, "kind": "antibiotic_overdue", "role": "nurse"}, headers=DEVICE)
        assert r.status_code == 200, r.text
    overdue = _firing(_card(c))["antibiotic_overdue"]
    assert overdue["summary"] == "Antibiotic OVERDUE by 25 min"
    return overdue, entry


def _same_after_a_restart(audit, live: dict) -> dict:
    """A second app on the same audit — the restart — shows the same firing alerts by kind, severity, urgency and
    acknowledgement, and the same anchor. A summary's minute count may differ by the request's own duration."""
    with _app(audit) as again:
        card = _card(again)
    want = {k: (a["severity"], a["urgency"], a["acknowledged"]) for k, a in _firing(live).items()}
    assert {k: (a["severity"], a["urgency"], a["acknowledged"]) for k, a in _firing(card).items()} == want
    assert _anchor(card) == _anchor(live)
    return card


class TestALateReadingAtTheDoors:
    def test_a_device_round_sent_four_hours_late_leaves_an_acknowledged_overdue_as_it_was(self):
        """A Connex round the device buffered reaches `/ingest` four hours after it was measured. Judged at its
        stamp, the clock read «210 min remaining» and the overdue's episode ended — its acknowledgement and first
        sight pruned, the next reading raising it anew, a new page."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        late = now - timedelta(hours=4)
        with _app(audit) as c:
            before, _ = _overdue(c, now)
            cleared, told = _count(audit, "alert_cleared"), _count(audit, "notification")
            for code, value in CONNEX:
                assert "antibiotic_due" not in [a["kind"] for a in _device(c, code, value, late)["alerts"]]
            live = _card(c)
            after = _firing(live)
            assert "antibiotic_due" not in after
            assert {k: after["antibiotic_overdue"][k] for k in ("summary", "acknowledged", "first_seen_at")} == \
                {k: before[k] for k in ("summary", "acknowledged", "first_seen_at")}
            assert (_count(audit, "alert_cleared"), _count(audit, "notification")) == (cleared, told)
            # The values are kept and audited at their own stamp.
            rows = audit.records(tenant="h1", patient_id=PID, event_type="ingest", limit=10)
            assert sorted(r.subject for r in rows) == sorted(code for code, _ in CONNEX)
            assert {r.payload["obs_ts"] for r in rows} == {late.isoformat()}
            state = c.app.state.board_link._engine("h1").state(PID)
            assert state.latest(SignalCode.SPO2).timestamp == late
        _same_after_a_restart(audit, live)

    def test_a_bedside_set_charted_three_hours_back_leaves_an_acknowledged_overdue_as_it_was(self):
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            before, _ = _overdue(c, now)
            cleared = _count(audit, "alert_cleared")
            _chart(c, [{"code": "resp_rate", "value": 18}, {"code": "spo2", "value": 96},
                       {"code": "sbp", "value": 120}, {"code": "heart_rate", "value": 84}], now - timedelta(hours=3))
            live = _card(c)
            after = _firing(live)
            assert "antibiotic_due" not in after
            assert {k: after["antibiotic_overdue"][k] for k in ("summary", "acknowledged", "first_seen_at")} == \
                {k: before[k] for k in ("summary", "acknowledged", "first_seen_at")}
            assert _count(audit, "alert_cleared") == cleared
        _same_after_a_restart(audit, live)

    def test_duzelt_charts_the_corrected_value_at_the_readings_time_and_the_overdue_stays(self):
        """«Düzelt» (G3-05 D13): a device SpO2 measured at -40 min is withdrawn, then the right value is charted at
        that same time. Judged at -40 min the corrected value read «10 min remaining» and ended the acknowledged
        overdue."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _chart(c, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
                   now - timedelta(minutes=90))
            _chart(c, [{"code": "map", "value": 60}], now - timedelta(minutes=90))
            _device(c, "spo2", 93, now - timedelta(minutes=40))
            [wrong] = audit.records(tenant="h1", patient_id=PID, event_type="ingest", limit=10)
            _chart(c, [{"code": "temperature", "value": 37.0}], now - timedelta(minutes=5))
            r = c.post("/ack", json={"patient_id": PID, "kind": "antibiotic_overdue", "role": "nurse"},
                       headers=DEVICE)
            assert r.status_code == 200, r.text
            before = _firing(_card(c))["antibiotic_overdue"]
            cleared = _count(audit, "alert_cleared")
            r = c.post(f"/clinical/{PID}/entries/{wrong.id}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            _chart(c, [{"code": "spo2", "value": 96}], now - timedelta(minutes=40))
            live = _card(c)
            after = _firing(live)
            assert "antibiotic_due" not in after
            assert (after["antibiotic_overdue"]["acknowledged"], after["antibiotic_overdue"]["first_seen_at"]) == \
                (True, before["first_seen_at"])
            assert _count(audit, "alert_cleared") == cleared
        _same_after_a_restart(audit, live)
```

In `homunculus-engine/tests/test_readings_api.py`, find (lines 692–700):

```python
    def test_the_door_still_judges_a_back_dated_reading_at_its_own_time(self, world):
        """B6 review: only the link changed. The same set the test above links and finds stale is, sent to `/ingest`
        by the device, judged at the time it was measured, as ever."""
        client, _, _ = world
        old = _ago(hours=6)
        for code, value in IMMEDIATE:
            r = client.post("/ingest", json=obs(code, value, KEY, old), headers=DEVICE)
            assert r.status_code == 200 and "alerts" in r.json(), r.text
        assert [a["kind"] for a in r.json()["alerts"]] == ["news2"]
```

Replace with:

```python
    def test_the_door_still_judges_a_back_dated_reading_at_its_own_time(self, world):
        """B6 review: only the link changed. The same set the test above links and finds stale is, sent to `/ingest`
        by the device, judged at the time it was measured, as ever. G3-06 (D1, D2): its premise is a patient the
        engine has not judged yet — the first evaluation has no floor; the test below is the judged patient."""
        client, _, _ = world
        old = _ago(hours=6)
        for code, value in IMMEDIATE:
            r = client.post("/ingest", json=obs(code, value, KEY, old), headers=DEVICE)
            assert r.status_code == 200 and "alerts" in r.json(), r.text
        assert [a["kind"] for a in r.json()["alerts"]] == ["news2"]

    def test_the_door_judges_a_back_dated_set_at_the_floor_of_a_patient_it_has_judged(self, world):
        """G3-06 (D1): the same six-hour-old set at the door, for a patient the engine judged a minute ago, is judged
        at that patient's last instant — stale for NEWS2's freshness, as the link finds it. Its values keep their own
        time."""
        client, _, _ = world
        r = client.post("/ingest", json=obs("heart_rate", 80, KEY, _ago(minutes=1)), headers=DEVICE)
        assert r.status_code == 200 and r.json()["alerts"] == [], r.text
        old = _ago(hours=6)
        for code, value in IMMEDIATE:
            r = client.post("/ingest", json=obs(code, value, KEY, old), headers=DEVICE)
            assert r.status_code == 200 and r.json()["alerts"] == [], r.text
        assert _firing(_card(client)) == []
        state = client.app.state.board_link._engine("h1").state(KEY)
        assert state.latest(SignalCode.RESP_RATE).timestamp == old
```

Append to the end of `homunculus-engine/tests/test_infinity_rules.py` (after line 1094), after two blank lines:

```python
def _sepsis_then(engine, minutes):
    """Suspected infection, platelets 80 and creatinine 3.5 at DT0 — sepsis, the antibiotic hour from DT0 — then a
    pulse `minutes` later, as a door hands them on (requested at their stamps)."""
    for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5), (SignalCode.SUSPECTED_INFECTION, 1.0)]:
        engine.ingest(Observation("bed-1", code, value, "u", DT0, "bridge"), now=DT0)
    later = DT0 + timedelta(minutes=minutes)
    engine.ingest(Observation("bed-1", SignalCode.HEART_RATE, 80, "bpm", later, "bridge"), now=later)


def test_a_shadow_copy_keeps_an_overdue_on_a_mirrored_reading_stamped_four_hours_back():
    """G3-06 (D1, D5): the shadow engine starts as the real engine's copy, the floor with it, so a reading stamped
    four hours back is judged at the patient's last instant in the shadow too — never «remaining» again."""
    lane, real, _ = _lane()
    _sepsis_then(real, 120)
    lane.install("h1", real, now=DT0 + timedelta(minutes=120))
    late = Observation("bed-1", SignalCode.SPO2, 97, "%", DT0 - timedelta(minutes=240), "bridge")
    real.ingest(late, now=late.timestamp)                     # the door first, then the mirror (D1)
    lane.mirror_observation("h1", late, now=DT0 + timedelta(minutes=125), real=real)
    shadow = lane.engines["h1"]
    kinds = {a.kind for a in shadow.active_alerts("bed-1")}
    assert "antibiotic_overdue" in kinds and "antibiotic_due" not in kinds
    assert shadow._judged_at["bed-1"] == real._judged_at["bed-1"] == DT0 + timedelta(minutes=120)
```

- [ ] **Step 3: Run them — they fail**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py tests/test_saat_api.py tests/test_readings_api.py tests/test_infinity_rules.py 2>&1 | tail -3`
Expected: `13 failed, 174 passed`. The failures: the nine of `test_engine_floor.py` (six on their assertions — `antibiotic_due` where `antibiotic_overdue` belongs, a cleared episode, `septic_shock` back on a bolus outside its window, the model asked at -240, `_judged_at` not in `_PER_PATIENT` — and three on `AttributeError: 'Engine' object has no attribute '_judged_at'`), the three of `test_saat_api.py` (`'antibiotic_due' not in …`), and `test_a_shadow_copy_keeps_an_overdue_on_a_mirrored_reading_stamped_four_hours_back`. **`test_the_door_judges_a_back_dated_set_at_the_floor_of_a_patient_it_has_judged` passes already:** NEWS2 has had its floor since X9e; the test pins the door's half of the link test above it (spec §8.2).

- [ ] **Step 4: The engine — one floor, every rule**

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 49–50):

```python
    _PER_PATIENT = ("_recognized_at", "_dropped_anchor", "_alerts", "_held_news2_alert",
                    "_news2_judged_at", "_profiles")
```

Replace with:

```python
    _PER_PATIENT = ("_recognized_at", "_dropped_anchor", "_alerts", "_held_news2_alert",
                    "_judged_at", "_profiles")
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 60–61):

```python
        # G2-A2 X9e: patient -> the latest instant NEWS2 was judged at; it never goes back.
        self._news2_judged_at: dict[str, datetime] = {}
```

Replace with:

```python
        # G3-06 (D1; NEWS2's since G2-A2 X9e): patient -> the latest instant the rules judged the patient
        # at. It never goes back, and every rule of an evaluation judges at it (`_evaluate`).
        self._judged_at: dict[str, datetime] = {}
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 89–110):

```python
    def ingest(self, obs: Observation, now: datetime) -> list[Alert]:
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)

        profile = self._profiles.get(obs.patient_id)
        # The profile reaches septic_shock directly, not through patient_relative: a charted
        # baseline SOFA is part of the Sepsis-3 criterion itself, not a downgrade applied after
        # the fact. Getting it there late would mean the alert had already been raised.
        findings = list(septic_shock.evaluate(state, now, profile))
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

Replace with:

```python
    def ingest(self, obs: Observation, now: datetime) -> list[Alert]:
        """Add one reading and evaluate its patient. `now` is the REQUESTED instant — the doors'
        min(stamp, wall clock) (G2-A2, X10), the replay's min(stamp, the row's write time) (X10b) —
        and the rules judge at its floor (`_evaluate`, G3-06 D1). The reading keeps its own stamp."""
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)
        return self._evaluate(obs.patient_id, state, now)

    def _evaluate(self, patient_id: str, state: PatientState, requested: datetime) -> list[Alert]:
        """One evaluation of `patient_id` as its state stands. Every rule judges at `at`, the
        requested instant floored at the patient's last judgement (G3-06, D1; NEWS2's since G2-A2,
        X9e): a reading stamped in the past is information about the past, not a reason to judge the
        present as if it were the past. Judged at its stamp, a reading from four hours ago turned an
        overdue antibiotic into «300 min remaining» and ended the overdue's episode, and a vital stale
        at the wall clock lifted NEWS2 again or ended a hold. The values keep their own stamps: the
        state, freshness, trends and the audit's `obs_ts` do not move. The engine reads no clock — `at`
        is only ever an instant a caller asked for."""
        at = max(requested, self._judged_at.get(patient_id, requested))
        self._judged_at[patient_id] = at

        profile = self._profiles.get(patient_id)
        # The profile reaches septic_shock directly, not through patient_relative: a charted
        # baseline SOFA is part of the Sepsis-3 criterion itself, not a downgrade applied after
        # the fact. Getting it there late would mean the alert had already been raised.
        findings = list(septic_shock.evaluate(state, at, profile))
        news2_findings = news2.evaluate(state, at)
        findings += news2_findings
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation. At the same
        # instant NEWS2 was judged at (G2-A2, D6).
        findings = patient_relative.apply(findings, state, profile, at)
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 139–155):

```python
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if obs.patient_id not in self._recognized_at:
                self._recognized_at[obs.patient_id] = self._new_anchor(obs.patient_id, now)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(obs.patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[obs.patient_id] = (dropped, now)

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(obs.patient_id) if recognizing else None, now
        )

        # Optional ML seam: an additive early-warning signal that NEVER overrides the rules.
        if self._scorer is not None:
            risk, top = self._scorer.score(state, now)
```

Replace with:

```python
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if patient_id not in self._recognized_at:
                self._recognized_at[patient_id] = self._new_anchor(patient_id, requested)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[patient_id] = (dropped, requested)

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(patient_id) if recognizing else None, at
        )

        # Optional ML seam: an additive early-warning signal that NEVER overrides the rules.
        if self._scorer is not None:
            risk, top = self._scorer.score(state, at)
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 171–175):

```python
        alerts = [to_alert(f, obs.patient_id) for f in findings]
        alerts = [replace(a, source="model") if a.kind == "sepsis_watch" else a for a in alerts]
        # Staleness — a vital past its window, a chart past its shift (X11) — may withhold a new
        # NEWS2 alert but cannot end a running one (G2-A2, X9, X9b).
        held = self._held_news2(obs.patient_id, bool(news2_findings), state, profile, judge_at)
```

Replace with:

```python
        alerts = [to_alert(f, patient_id) for f in findings]
        alerts = [replace(a, source="model") if a.kind == "sepsis_watch" else a for a in alerts]
        # Staleness — a vital past its window, a chart past its shift (X11) — may withhold a new
        # NEWS2 alert but cannot end a running one (G2-A2, X9, X9b).
        held = self._held_news2(patient_id, bool(news2_findings), state, profile, at)
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 185–187):

```python
        # engine's.
        self._alerts[obs.patient_id] = {a.kind: a for a in alerts}
        return alerts
```

Replace with:

```python
        # engine's.
        self._alerts[patient_id] = {a.kind: a for a in alerts}
        return alerts
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 294–295):

```python
        of the last evaluation, the antibiotic anchor and a dropped anchor's memory, a held NEWS2
        alert, the NEWS2 judge-at and the charted profile.
```

Replace with:

```python
        of the last evaluation, the antibiotic anchor and a dropped anchor's memory, a held NEWS2
        alert, the instant the rules last judged it at (G3-06, D1) and the charted profile.
```

Check: `cd /c/tmp/g3-saat/homunculus-engine && grep -n "obs.patient_id\|judge_at\|_news2_judged_at" src/homunculus/pipeline.py` prints only lines 93 and 95 (`ingest`'s two `obs.patient_id`).

- [ ] **Step 5: The rename in the tests that read the dict, the X9e comment, the door's docstring**

In `homunculus-engine/tests/test_engine_adopt.py`, find (line 153):

```python
    assert shadow._alerts != real._alerts and shadow._news2_judged_at != real._news2_judged_at
```

Replace with:

```python
    assert shadow._alerts != real._alerts and shadow._judged_at != real._judged_at
```

In `homunculus-engine/tests/test_engine_adopt.py`, find (line 184):

```python
    judged_before = real._news2_judged_at.get("bed-1")
```

Replace with:

```python
    judged_before = real._judged_at.get("bed-1")
```

In `homunculus-engine/tests/test_engine_adopt.py`, find (line 191):

```python
    assert real._news2_judged_at.get("bed-1") == judged_before
```

Replace with:

```python
    assert real._judged_at.get("bed-1") == judged_before
```

In `homunculus-engine/tests/test_engine_forget.py`, find (lines 38–39):

```python
            engine._held_news2_alert, engine._news2_judged_at, engine._profiles)
    assert all("bed-3" in m for m in (engine._news2_judged_at, engine._alerts,
```

Replace with:

```python
            engine._held_news2_alert, engine._judged_at, engine._profiles)
    assert all("bed-3" in m for m in (engine._judged_at, engine._alerts,
```

In `homunculus-engine/tests/test_bedside_retract.py`, find (line 120):

```python
            "held": held and held.summary, "judged": e._news2_judged_at.get(pid), "profile": e._profiles.get(pid)}
```

Replace with:

```python
            "held": held and held.summary, "judged": e._judged_at.get(pid), "profile": e._profiles.get(pid)}
```

In `homunculus-engine/tests/test_pipeline.py`, find (lines 579–580):

```python
    # fresh and the pressure, stale at the wall clock, was not yet: NEWS2 jumped to 7, immediate.
    # NEWS2 is judged no earlier than this patient's last NEWS2 judgement.
```

Replace with:

```python
    # fresh and the pressure, stale at the wall clock, was not yet: NEWS2 jumped to 7, immediate.
    # NEWS2 is judged no earlier than this patient's last judgement — since G3-06 (D1) every rule
    # is, not NEWS2 alone (tests/test_engine_floor.py).
```

In `homunculus-engine/src/homunculus/api/clinical.py`, find (lines 355–356):

```python
    `now` is the request's one wall-clock instant: each entry is judged at its charted time but
    never past it (G2-A2, X10). After every entry: the lifecycle hook (G2-A1, D4, D7 — charting is
```

Replace with:

```python
    `now` is the request's one wall-clock instant: each entry asks to be judged at its charted time
    but never past it (G2-A2, X10). The engine judges at that instant's floor — never before the
    patient's last judgement — and anchors a recognition the entry completes at the instant itself
    (G3-06, D1, D2). After every entry: the lifecycle hook (G2-A1, D4, D7 — charting is
```

Check: `cd /c/tmp/g3-saat/homunculus-engine && grep -rn "_news2_judged_at" src tests` prints one line only: `tests/test_engine_floor.py`'s assertion that the old name is gone from `_PER_PATIENT`.

- [ ] **Step 6: Run them — they pass**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py tests/test_saat_api.py tests/test_readings_api.py tests/test_infinity_rules.py tests/test_pipeline.py tests/test_engine_adopt.py tests/test_engine_forget.py tests/test_bedside_retract.py 2>&1 | tail -3`
Expected: `289 passed` (9 + 3 + 112 + 63 + 39 + 11 + 3 + 49; about 55 s).

- [ ] **Step 7: The downstream readers stay green (spec §8.3)**

The readers spec §8.3 names, in four foreground commands (none of these files changes in this plan, so the counts are the same after Tasks 1, 5 and 6):

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_alert_lifecycle.py tests/test_api_board_meds.py tests/test_board.py tests/test_api_board_news2.py tests/test_pharmacy.py tests/test_pharmacy_api.py tests/test_alarm_quality.py tests/test_quality_api.py tests/test_quality_indicators.py tests/test_notify.py tests/test_escalation_chain.py tests/test_first_seen_persistence.py 2>&1 | tail -3`
Expected: `196 passed, 15 skipped` (about 20 s).

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_equivalence.py tests/test_api_board_shadow.py tests/test_api_shadow_findings.py 2>&1 | tail -3`
Expected: `35 passed` (about 30 s). The equivalence test stays as it is (spec §6): the real engine's floor is the frozen clock in both apps, and the lane's engine runs on its own clock.

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_api.py tests/test_infinity_shadow_check.py tests/test_infinity_shadow_config.py tests/test_infinity_shadow_forwarder.py tests/test_infinity_shadow_isolation.py tests/test_infinity_shadow_ledger.py tests/test_infinity_shadow_ledger_api.py tests/test_infinity_shadow_store.py 2>&1 | tail -3`
Expected: `299 passed` (about 40 s).

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_pipeline_model.py tests/rules/test_antibiotic_clock.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_scenario_news2.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py tests/test_device_retract.py tests/test_readings_patient.py tests/test_readings_reconcile.py 2>&1 | tail -3`
Expected: `261 passed, 1 skipped` (about 50 s; twice that on a loaded machine). The doors' X10 tests (`test_api_ingest.py`, `test_api_clinical.py`) and the replay's X10b test (`test_rehydrate.py`) keep their assertions: the requested instants are unchanged, only the judgement is floored.

If anything here fails: stop and report the test and its assertion — do not change a test outside this task's **Files**.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g3-saat && git add -- homunculus-engine/src/homunculus/pipeline.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/tests/test_engine_floor.py homunculus-engine/tests/test_saat_api.py homunculus-engine/tests/test_readings_api.py homunculus-engine/tests/test_infinity_rules.py homunculus-engine/tests/test_engine_adopt.py homunculus-engine/tests/test_engine_forget.py homunculus-engine/tests/test_bedside_retract.py homunculus-engine/tests/test_pipeline.py && git commit -m "feat(engine): one floor per patient for every rule — a late reading never turns a clock back (G3-06 D1)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/pipeline.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/tests/test_engine_floor.py homunculus-engine/tests/test_saat_api.py homunculus-engine/tests/test_readings_api.py homunculus-engine/tests/test_infinity_rules.py homunculus-engine/tests/test_engine_adopt.py homunculus-engine/tests/test_engine_forget.py homunculus-engine/tests/test_bedside_retract.py homunculus-engine/tests/test_pipeline.py
```

---

### Task 2: The anchor — `anchor_at`, and the restore rule on floored instants (D2)

**Files:**
- Test: `homunculus-engine/tests/test_engine_floor.py` — after line 172 (the end of the file)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` — lines 55, 90–98, 136–152, 283–289 (as each step finds the file)

`Engine.ingest` gains the keyword `anchor_at` (default: its `now`), and `_evaluate` takes it. A recognition's anchor is `min(anchor_at, at)` — a guard: every caller passes `anchor_at <= now <= at`. A drop is remembered at the dropping evaluation's FLOORED instant, and a recognition restores the dropped anchor if and only if `0 <= (at - dropped_at) <= ANCHOR_RESTORE_S`, `at` its own floored instant. Compared on requested instants, a back-dated recognition "before" the drop gave a negative difference, which passed the 900 s test: a new infection inherited a ruled-out episode's anchor and the doses given since it (the latent bug of spec §1). No caller passes `anchor_at` yet: the doors keep one instant (the default), and Task 6 gives the link its two.

- [ ] **Step 1: The failing tests**

Append to the end of `homunculus-engine/tests/test_engine_floor.py` (after line 172), after two blank lines:

```python
class TestTheAnchor:
    def test_anchor_at_is_the_anchor_of_a_recognition_the_reading_completes(self):
        # The link's two instants (D2, D4): judged at the link, +360, anchored at the measurement, +0. Infection
        # was charted at -60; the linked bilirubin of 3.0 completes sepsis.
        eng = Engine()
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, -60)
        eng.ingest(_obs(SignalCode.BILIRUBIN, 3.0, 0), now=_at(360), anchor_at=_at(0))
        assert eng.recognized_at(PID) == _at(0)
        assert eng._judged_at[PID] == _at(360)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 300 min"

    def test_an_anchor_at_later_than_the_judgement_is_held_to_it(self):
        # `min(anchor_at, at)`: a guard — every caller passes anchor_at <= now.
        eng = Engine()
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, 0)
        eng.ingest(_obs(SignalCode.BILIRUBIN, 3.0, 0), now=_at(10), anchor_at=_at(30))
        assert eng.recognized_at(PID) == _at(10)

    def test_anchor_at_is_not_a_judgement_instant(self):
        # A reading whose anchor_at is far back judges nothing there: the floor is `now`'s.
        eng = Engine()
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        eng.ingest(_obs(SignalCode.SPO2, 97, -240), now=_at(130), anchor_at=_at(-240))
        assert eng._judged_at[PID] == _at(130)
        assert eng.recognized_at(PID) is None


class TestTheRestoreRule:
    """G2-A1 X12, measured between floored instants (D2): a recognition restores a dropped anchor only within
    ANCHOR_RESTORE_S after the drop, in the engine's own one-way time; a negative difference never restores."""

    def test_a_back_dated_recognition_after_a_rule_out_does_not_inherit_the_old_episodes_doses(self):
        # The old episode: anchored at +0, the antibiotic given at +20, ruled out at +71. SOFA back to normal at
        # +100; a new infection charted at +126 with SOFA not met. A bilirubin measured at +60 — the only one —
        # arrives at +130 and completes SOFA. Compared on requested instants, +60 - +71 is negative and "within"
        # the window: the +0 anchor came back, and the dose of +20 silenced the new episode's clock.
        eng = Engine()
        _sepsis(eng, 0)
        _door(eng, SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 20)
        _door(eng, SignalCode.SUSPECTED_INFECTION, 0.0, 71)
        assert eng.recognized_at(PID) is None and eng._dropped_anchor[PID] == (_at(0), _at(71))
        for code, value in [(SignalCode.PLATELETS, 200), (SignalCode.CREATININE, 0.8)]:
            _door(eng, code, value, 100)
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, 126)
        assert "sepsis" not in _kinds(eng)
        _door(eng, SignalCode.BILIRUBIN, 3.0, 60, wall=130)
        assert "sepsis" in _kinds(eng)
        assert eng.recognized_at(PID) == _at(60), "55 floored minutes after the drop: a new episode's own anchor"
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 6 min", \
            "judged at +126; the dose of +20 was before the new anchor"
        assert PID not in eng._dropped_anchor, "the remembered drop is spent"

    def test_a_corrected_toggle_whose_completing_mark_is_back_dated_restores_the_anchor(self):
        # Overdue by 10 at +70; infection charted absent at +71, a pulse at +78, and the correction — present
        # again — stamped +72 arrives at +80. Seven floored minutes after the drop: the same episode.
        eng = Engine()
        _sepsis(eng, 0)
        _door(eng, SignalCode.PLATELETS, 80, 70)
        _door(eng, SignalCode.SUSPECTED_INFECTION, 0.0, 71)
        _door(eng, SignalCode.HEART_RATE, 80, 78)
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, 72, wall=80)
        assert eng.recognized_at(PID) == _at(0)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 18 min"

    def test_a_drop_is_remembered_at_its_floored_instant(self):
        # The rule-out itself back-dated: infection charted absent at +50 arrives at +71, on a patient judged up to
        # +71. The drop is remembered at +71, and a recognition at +80 is nine minutes after it — a correction.
        # Remembered at its stamp, +50, it was thirty minutes before, and the overdue hour started again.
        eng = Engine()
        _sepsis(eng, 0)
        _door(eng, SignalCode.HEART_RATE, 80, 71)
        _door(eng, SignalCode.SUSPECTED_INFECTION, 0.0, 50, wall=71)
        assert eng._dropped_anchor[PID] == (_at(0), _at(71))
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, 80)
        assert eng.recognized_at(PID) == _at(0)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 20 min"
```

- [ ] **Step 2: Run them — they fail**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py 2>&1 | tail -3`
Expected: `5 failed, 10 passed`. The three `TestTheAnchor` tests on `TypeError: Engine.ingest() got an unexpected keyword argument 'anchor_at'`; `test_a_back_dated_recognition_after_a_rule_out_does_not_inherit_the_old_episodes_doses` on `recognized_at` +0 for +60 (the restored anchor); `test_a_drop_is_remembered_at_its_floored_instant` on the drop remembered at +50. **`test_a_corrected_toggle_whose_completing_mark_is_back_dated_restores_the_anchor` passes already** (one minute apart on requested instants, seven on floored ones): it pins that the floored rule still restores a correction.

- [ ] **Step 3: The engine**

In `homunculus-engine/src/homunculus/pipeline.py`, find (line 55):

```python
        # X12: an anchor dropped by infection charted absent -> (anchor, when it was dropped).
```

Replace with:

```python
        # X12: an anchor dropped by infection charted absent -> (anchor, the floored instant it was
        # dropped at; G3-06 D2).
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 90–98):

```python
    def ingest(self, obs: Observation, now: datetime) -> list[Alert]:
        """Add one reading and evaluate its patient. `now` is the REQUESTED instant — the doors'
        min(stamp, wall clock) (G2-A2, X10), the replay's min(stamp, the row's write time) (X10b) —
        and the rules judge at its floor (`_evaluate`, G3-06 D1). The reading keeps its own stamp."""
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)
        return self._evaluate(obs.patient_id, state, now)

    def _evaluate(self, patient_id: str, state: PatientState, requested: datetime) -> list[Alert]:
```

Replace with:

```python
    def ingest(self, obs: Observation, now: datetime, *, anchor_at: datetime | None = None) -> list[Alert]:
        """Add one reading and evaluate its patient. `now` is the REQUESTED instant — the doors'
        min(stamp, wall clock) (G2-A2, X10), the replay's min(stamp, the row's write time) (X10b) —
        and the rules judge at its floor (`_evaluate`, G3-06 D1). The reading keeps its own stamp.
        `anchor_at` is the anchor of a recognition this reading completes (D2): None is `now`, the
        doors' one instant; a linked reading is judged at the link and anchored at its measurement
        (D4)."""
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)
        return self._evaluate(obs.patient_id, state, now, now if anchor_at is None else anchor_at)

    def _evaluate(self, patient_id: str, state: PatientState, requested: datetime,
                  anchor_at: datetime) -> list[Alert]:
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 136–152):

```python
        #  - A dropped anchor is remembered with the time of its drop (X12). A recognition within
        #    ANCHOR_RESTORE_S (15 min) of the drop restores the old anchor: infection charted absent
        #    and present again is a corrected toggle, the same episode, and an antibiotic charted in
        #    the gap counts against the restored hour. A later recognition gets its own anchor,
        #    `now`.
        #  - The antibiotic findings are emitted only while a recognition kind fires in THIS
        #    evaluation, so they leave the board with the sepsis alert (D9); the clock keeps
        #    counting underneath, and a sepsis that fires again shows the true elapsed time.
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if patient_id not in self._recognized_at:
                self._recognized_at[patient_id] = self._new_anchor(patient_id, requested)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[patient_id] = (dropped, requested)
```

Replace with:

```python
        #  - A dropped anchor is remembered with the floored instant of its drop (X12; G3-06, D2). A
        #    recognition within ANCHOR_RESTORE_S (15 min) after the drop, floored instant to floored
        #    instant, restores the old anchor: infection charted absent and present again is a
        #    corrected toggle, the same episode, and an antibiotic charted in the gap counts against
        #    the restored hour. A later recognition gets its own anchor: `anchor_at` — the requested
        #    instant at the doors, the reading's measurement at the link (D4) — never after `at`.
        #    Requested instants can run backwards; compared on them, a back-dated recognition
        #    "before" the drop restored the anchor however long ago the rule-out was.
        #  - The antibiotic findings are emitted only while a recognition kind fires in THIS
        #    evaluation, so they leave the board with the sepsis alert (D9); the clock keeps
        #    counting underneath, and a sepsis that fires again shows the true elapsed time.
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if patient_id not in self._recognized_at:
                self._recognized_at[patient_id] = self._new_anchor(patient_id, min(anchor_at, at), at)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[patient_id] = (dropped, at)
```

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 283–289):

```python
    def _new_anchor(self, patient_id: str, now: datetime) -> datetime:
        """The anchor of a recognition with none running (X12): the anchor dropped at most
        ANCHOR_RESTORE_S ago, restored, or else `now`. Either way the remembered drop is spent."""
        dropped = self._dropped_anchor.pop(patient_id, None)
        if dropped is not None and (now - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
            return dropped[0]
        return now
```

Replace with:

```python
    def _new_anchor(self, patient_id: str, anchor: datetime, at: datetime) -> datetime:
        """The anchor of a recognition with none running (X12; G3-06, D2): the anchor dropped at
        most ANCHOR_RESTORE_S before `at`, restored, or else `anchor`. `at` is the recognising
        evaluation's floored instant and the drop is remembered at its own, so the difference is
        measured in the engine's one-way time; within one engine the floor never goes back, and
        `forget`, `copy` and `adopt` move `_judged_at` and `_dropped_anchor` together, so it is
        never negative — the `0 <=` is a guard. Either way the remembered drop is spent."""
        dropped = self._dropped_anchor.pop(patient_id, None)
        if dropped is not None and 0 <= (at - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
            return dropped[0]
        return anchor
```

- [ ] **Step 4: Run them — they pass, and so does every X12 test**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py tests/test_pipeline.py tests/test_engine_adopt.py tests/test_engine_forget.py tests/test_bedside_retract.py tests/test_saat_api.py 2>&1 | tail -3`
Expected: `120 passed` (15 + 39 + 11 + 3 + 49 + 3). `test_pipeline.py`'s X12 tests feed readings in time order, so requested and floored instants agree and nothing moves for them (spec §5).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-saat && git add -- homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_engine_floor.py && git commit -m "feat(engine): a recognition's anchor_at, and the restore window measured on floored instants (G3-06 D2)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_engine_floor.py
```

---

### Task 3: `Engine.rejudge` — the evaluation with no reading added (D3, the engine's half)

**Files:**
- Test: `homunculus-engine/tests/test_engine_floor.py` — after line 250 (the end of the file)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` — lines 97–99 (as the step finds the file)

`rejudge(patient_id, now)` runs `_evaluate` on the state as it stands, at `max(now, floor)`, and answers the alerts. A patient the engine holds no reading for — unknown, or only a profile (a restart sets a profile before any reading) — answers `[]` and is not created: `patient_ids()` is the test, never `state()`, which would create it. Task 5 calls it from the withdrawal and the replay.

- [ ] **Step 1: The failing tests**

Append to the end of `homunculus-engine/tests/test_engine_floor.py` (after line 250), after two blank lines:

```python
class TestRejudge:
    """D3: `Engine.rejudge(patient_id, now)` runs the evaluation on the state as it stands — no reading added — at
    max(now, the floor), and answers its alerts. A withdrawal calls it; so does the replay at a `chart_retract`
    row."""

    def test_it_answers_the_evaluation_and_moves_the_floor(self):
        eng = Engine()
        _sepsis(eng, 0)
        assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining"
        alerts = eng.rejudge(PID, _at(75))
        assert {a.kind for a in alerts} == _kinds(eng) == {"sepsis", "antibiotic_overdue"}
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 15 min", "the hour ran out by +75"
        assert eng._judged_at[PID] == _at(75)

    def test_it_adds_no_reading(self):
        eng = Engine()
        _sepsis(eng, 0)
        before = {code: eng.state(PID).history(code) for code in SignalCode}
        eng.rejudge(PID, _at(75))
        assert {code: eng.state(PID).history(code) for code in SignalCode} == before

    def test_it_never_goes_back(self):
        eng = Engine()
        _sepsis(eng, 0)
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        eng.rejudge(PID, _at(-240))
        assert eng._judged_at[PID] == _at(120)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min"

    def test_an_unknown_patient_answers_nothing_and_is_not_created(self):
        eng = Engine()
        _door(eng, SignalCode.HEART_RATE, 80, 0)
        assert eng.rejudge("bed-9", _at(10)) == []
        assert "bed-9" not in eng.patient_ids() and "bed-9" not in eng._judged_at

    def test_a_patient_with_a_profile_and_no_reading_is_not_created(self):
        # After a restart the replay may set a profile before any reading (Engine.adopt's docstring).
        from homunculus.state.profile import PatientProfile
        eng = Engine()
        eng.set_profile(PatientProfile(patient_id="bed-6"))
        assert eng.rejudge("bed-6", _at(10)) == []
        assert "bed-6" not in eng.patient_ids() and "bed-6" not in eng._judged_at
```

- [ ] **Step 2: Run them — they fail**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py 2>&1 | tail -3`
Expected: `5 failed, 15 passed` — each of `TestRejudge` on `AttributeError: 'Engine' object has no attribute 'rejudge'`.

- [ ] **Step 3: The method**

In `homunculus-engine/src/homunculus/pipeline.py`, find (lines 97–99):

```python
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)
        return self._evaluate(obs.patient_id, state, now, now if anchor_at is None else anchor_at)
```

Replace with:

```python
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)
        return self._evaluate(obs.patient_id, state, now, now if anchor_at is None else anchor_at)

    def rejudge(self, patient_id: str, now: datetime) -> list[Alert]:
        """Evaluate `patient_id` again as its state stands — no reading added — at max(now, its
        floor), and answer the alerts (G3-06, D3). «Hatalı giriş» calls it right after `adopt`, so
        the alerts are judged at the withdrawal's instant, not at the last remaining reading's; the
        replay calls it at each `chart_retract` row. A patient the engine holds no reading for
        answers [] and is not created."""
        if patient_id not in self._repo.patient_ids():
            return []
        return self._evaluate(patient_id, self._repo.get_or_create(patient_id), now, now)
```

- [ ] **Step 4: Run them — they pass**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py tests/test_engine_adopt.py tests/test_engine_forget.py 2>&1 | tail -3`
Expected: `34 passed` (20 + 11 + 3).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-saat && git add -- homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_engine_floor.py && git commit -m "feat(engine): Engine.rejudge — the evaluation as the state stands, at the caller's instant (G3-06 D3)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_engine_floor.py
```

---

### Task 4: The replay's instants — a linked row's two, and the ceiling (D4's replay half, D6)

**Files:**
- Test: `homunculus-engine/tests/test_saat_replay.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py` — lines 41, 45–49, 69–79, 116–134, 366–382 (as each step finds the file)

The replay asks the engine for what the live door asked: an ordinary row `min(stamp, written)`, one instant; a LINKED row (its `ingest` payload names a `reading`) is judged at `written` — as G3-05 does today — and now anchored at `min(stamp, written)`, the measurement, as Task 6 makes the live link anchor it. **Both instants are capped at the replay's `now` + `REPLAY_SKEW`** (2 min, the bedside door's `BEDSIDE_SKEW`): with every rule floored (Task 1), a row whose write time cannot be read (`_written_at` falls back to its `obs_ts`) or one written while the server's clock ran ahead would set the patient's floor in the future, and every later reading would be judged there — X10's harm, made permanent. The instant handed to the lifecycle hook (`written`) is not capped (spec §7). `rebuild_patient` gains the keyword `now` (default: the clock) for the same cap; Task 5 makes the route pass its own.

- [ ] **Step 1: The failing tests**

Create `homunculus-engine/tests/test_saat_replay.py`:

```python
# homunculus-engine/tests/test_saat_replay.py
"""G3-06 «Saat geri gitmez» on replay (spec D3, D4, D6): the instants the restart and the withdrawal's rebuild
hand the engine. An ordinary row asks for min(its stamp, its write time); a LINKED row (its `ingest` payload names
the `reading` it was linked from) is judged at its write time and anchored at min(its stamp, its write time); a
`chart_retract` row re-judges its patient at its write time; and no instant is later than the
restart's clock plus REPLAY_SKEW — a row written while the server's clock ran ahead, or one whose write time cannot
be read, never puts a patient's floor in the future. The lifecycle hook still runs at the row's own write time.
Rows are built by hand so each write time is exact. Synthetic values only."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import homunculus.api.rehydrate as rehydrate_module
from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditRecord
from homunculus.api.clinical import BEDSIDE_SKEW
from homunculus.api.rehydrate import REPLAY_SKEW, rebuild_patient, rehydrate
from homunculus.pipeline import Engine

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)      # the restart's clock
PID = "bed-3"


def _row(id_, kind, code, value, stamp, ts, patient=PID, **extra) -> AuditRecord:
    """An `ingest` or `chart` row as the doors write it, with its write time `ts` (a datetime, or text as read)."""
    payload = {"value": value, "unit": "u", "obs_ts": stamp.isoformat(), **extra}
    if kind == "ingest":
        payload.setdefault("device", "POC-7")
    else:
        payload["charted_by"] = "hem.ayse"
    return AuditRecord(id=id_, ts=ts.isoformat() if isinstance(ts, datetime) else ts, tenant="h1",
                       event_type=kind, patient_id=patient, subject=code, payload=payload)


def _linked_sepsis(written):
    """Suspected infection charted 7 h before the restart; then a set measured 6 h before it — MAP 60 and platelets
    120, two SOFA points — linked from the unmatched list and written at `written`."""
    stamp = NOW - timedelta(hours=6)
    charted = NOW - timedelta(hours=7)
    return [_row(1, "chart", "suspected_infection", 1.0, charted, charted),
            _row(2, "ingest", "map", 60.0, stamp, written, reading=11),
            _row(3, "ingest", "platelets", 120.0, stamp, written, reading=12)], stamp


def _summary(engine, kind):
    return next(a.summary for a in engine.active_alerts(PID) if a.kind == kind)


def _hooks(monkeypatch):
    """The instants the replay hands the lifecycle hook, per patient, in order — the real hook still runs."""
    seen = []
    real = rehydrate_module.sync_alerts

    def spy(engine, store, patient_id, now):
        seen.append((patient_id, now))
        return real(engine, store, patient_id, now)
    monkeypatch.setattr(rehydrate_module, "sync_alerts", spy)
    return seen


def test_the_replays_skew_is_the_bedside_doors():
    assert REPLAY_SKEW == BEDSIDE_SKEW == timedelta(minutes=2)


class TestALinkedRow:
    def test_it_is_judged_at_its_write_time_and_anchored_at_its_stamp(self):
        written = NOW - timedelta(minutes=10)
        rows, stamp = _linked_sepsis(written)
        engine = Engine()
        rehydrate(engine, AckStore(), rows, now=NOW)
        assert engine.recognized_at(PID) == stamp
        assert engine._judged_at[PID] == written
        assert _summary(engine, "antibiotic_overdue") == "Antibiotic OVERDUE by 290 min"

    def test_one_written_past_the_restart_is_judged_no_later_than_the_ceiling(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        written = NOW + timedelta(hours=1)
        rows, stamp = _linked_sepsis(written)
        engine = Engine()
        rehydrate(engine, AckStore(), rows, now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert engine.recognized_at(PID) == stamp
        assert hooks[-1] == (PID, written), "the hook still runs at the row's own write time"

    def test_the_rebuild_replays_it_the_same_way(self):
        written = NOW - timedelta(minutes=10)
        rows, stamp = _linked_sepsis(written)
        engine = Engine()
        rebuild_patient(engine, PID, rows, skip=frozenset(), now=NOW)
        assert (engine.recognized_at(PID), engine._judged_at[PID]) == (stamp, written)


class TestAnOrdinaryRow:
    def test_it_asks_for_the_earlier_of_its_stamp_and_its_write_time(self):
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, NOW - timedelta(minutes=30),
                                            NOW - timedelta(minutes=20))], now=NOW)
        assert engine._judged_at[PID] == NOW - timedelta(minutes=30)


class TestTheFloorNeverGoesPastTheCeiling:
    """D6: the two ways a replayed instant can lie past the restart."""

    def test_a_row_whose_write_time_cannot_be_read_falls_back_to_a_future_stamp_and_is_capped(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, ahead, "not a time")], now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert hooks == [(PID, ahead)], "the hook's instant is the row's (its stamp, as `_written_at` reads it)"

    def test_a_row_written_while_the_servers_clock_ran_ahead_is_capped(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, ahead, ahead)], now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert hooks == [(PID, ahead)]

    def test_a_later_reading_is_judged_at_its_own_time_not_hours_ahead(self):
        # The harm the cap prevents: one row two hours ahead, then a reading measured now. Uncapped, the second was
        # judged two hours ahead — every vital stale, the antibiotic clock two hours on.
        ahead = NOW + timedelta(hours=2)
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, ahead, ahead),
                                       _row(2, "ingest", "resp_rate", 26.0, NOW, NOW)], now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert [a.kind for a in engine.active_alerts(PID)] == ["news2"], "RR 26 is fresh two minutes on"

    def test_the_rebuild_is_capped_at_its_callers_clock(self):
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rebuild_patient(engine, PID, [_row(1, "ingest", "heart_rate", 80.0, ahead, ahead)], skip=frozenset(),
                        now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
```

- [ ] **Step 2: Run them — they fail**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_replay.py 2>&1 | tail -3`
Expected: `1 error` — collection stops on `ImportError: cannot import name 'REPLAY_SKEW' from 'homunculus.api.rehydrate'`.

- [ ] **Step 3: The replay**

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (line 41):

```python
from homunculus.api.clinical import RETRACT, profile_from_payload
```

Replace with:

```python
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT, profile_from_payload
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 45–49):

```python
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def rehydrate(
```

Replace with:

```python
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

#: G3-06 (D6): no instant the replay hands the engine is later than the restart's clock plus this — the bedside
#: door's own clock skew (api/clinical.py BEDSIDE_SKEW, 2 min). The doors never ask past the wall clock (G2-A2,
#: X10), but a row written while the server's clock ran ahead carries a write time past the restart, and a row
#: whose write time cannot be read falls back to its measurement's (`_written_at`). The engine judges every rule
#: at a floor that never goes back (pipeline.py `_judged_at`): unclamped, either would put that patient's floor
#: in the future, and every later reading would be judged there for good.
REPLAY_SKEW = BEDSIDE_SKEW


def rehydrate(
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 69–79):

```python
    now = now if now is not None else datetime.now(timezone.utc)
    for rec in records:
        if rec.event_type in ("ingest", "chart") and _withdrawn(rec, skip, skip_device):
            continue
        if rec.event_type in ("ingest", "chart"):
            # `chart` is a clinician's observation and replays exactly like a device's. It has
            # to: a charted `suspected_infection` that a restart forgot would take the sepsis,
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            written = _written_at(rec)
            if _replay_ingest(engine, rec, written):
```

Replace with:

```python
    now = now if now is not None else datetime.now(timezone.utc)
    ceiling = now + REPLAY_SKEW          # G3-06 (D6): no instant handed to the engine is later than this
    for rec in records:
        if rec.event_type in ("ingest", "chart") and _withdrawn(rec, skip, skip_device):
            continue
        if rec.event_type in ("ingest", "chart"):
            # `chart` is a clinician's observation and replays exactly like a device's. It has
            # to: a charted `suspected_infection` that a restart forgot would take the sepsis,
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            written = _written_at(rec)
            if _replay_ingest(engine, rec, written, ceiling):
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 116–134):

```python
def _replay_ingest(engine: Engine, rec: AuditRecord, written: datetime) -> bool:
    """Replay one observation; False when its signal is unknown or its value unreadable (`observation_of`) and
    it was skipped.

    Judged where the door judged it (G2-A2, X10b): at the reading's own stamp, never past the wall
    clock (X10), with the row's write time standing for that wall clock, to within the request.
    Judged at a stamp in the future, as the replay did, every other input was aged to it — a NEWS2
    the ward saw firing came back held, and the antibiotic anchor moved to the future stamp.

    A LINKED reading (G3-05; its `ingest` row names the `reading` it was linked from) was judged where the link
    ran, at the wall clock: back-dated up to 24 h, judged at its measurement it would have replaced an overdue
    antibiotic alert with a due one. It is replayed at the row's write time, so a restart agrees with the live
    board."""
    obs = observation_of(rec)
    if obs is None:
        return False  # unknown signal slug — skip rather than fail the whole replay
    linked = rec.event_type == "ingest" and "reading" in rec.payload
    engine.ingest(obs, now=written if linked else min(obs.timestamp, written))
    return True
```

Replace with:

```python
def _replay_ingest(engine: Engine, rec: AuditRecord, written: datetime, ceiling: datetime) -> bool:
    """Replay one observation; False when its signal is unknown or its value unreadable (`observation_of`) and
    it was skipped.

    Asked for where the door asked (G2-A2, X10b): at the reading's own stamp, never past the wall
    clock (X10), with the row's write time standing for that wall clock, to within the request.
    Judged at a stamp in the future, as the replay did, every other input was aged to it — a NEWS2
    the ward saw firing came back held, and the antibiotic anchor moved to the future stamp. The
    engine judges at that instant's floor and anchors a recognition the reading completes at the
    instant itself (G3-06, D1, D2), as it did live.

    A LINKED reading (G3-05; its `ingest` row names the `reading` it was linked from) was judged where the link
    ran, at the wall clock: back-dated up to 24 h, judged at its measurement it would have replaced an overdue
    antibiotic alert with a due one. It is replayed at the row's write time, so a restart agrees with the live
    board — and a recognition it completed is anchored at its measurement, min(its stamp, the write time), as
    the link anchored it (G3-06, D4).

    Neither instant is later than `ceiling`, the restart's clock plus REPLAY_SKEW (G3-06, D6)."""
    obs = observation_of(rec)
    if obs is None:
        return False  # unknown signal slug — skip rather than fail the whole replay
    requested = min(obs.timestamp, written, ceiling)
    linked = rec.event_type == "ingest" and "reading" in rec.payload
    engine.ingest(obs, now=min(written, ceiling) if linked else requested, anchor_at=requested)
    return True
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 366–382):

```python
def rebuild_patient(engine: Engine, patient_id: str, records: Iterable[AuditRecord], *,
                    skip: frozenset[int], skip_device: frozenset[tuple] = frozenset()) -> None:
    """One patient's engine state from the trail, without the rows in `skip` and the device readings in
    `skip_device` (G3-01, D10, X4; G3-05, D13: a device reading can be withdrawn too, and every `ingest` row of
    it): first everything the engine holds for the patient is dropped (`Engine.forget`), then that patient's
    `ingest`, `chart` and `profile` rows are replayed in id order with the restart's own helpers — each reading
    judged where the door judged it. Engine only: no store and no lifecycle hook; the caller runs the hook once,
    at its own instant. Rows of another patient or kind are passed over, so the caller may hand it a wider
    read."""
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id or rec.event_type not in REBUILD_EVENTS:
            continue
        if rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif not _withdrawn(rec, skip, skip_device):
            _replay_ingest(engine, rec, _written_at(rec))
```

Replace with:

```python
def rebuild_patient(engine: Engine, patient_id: str, records: Iterable[AuditRecord], *,
                    skip: frozenset[int], skip_device: frozenset[tuple] = frozenset(),
                    now: datetime | None = None) -> None:
    """One patient's engine state from the trail, without the rows in `skip` and the device readings in
    `skip_device` (G3-01, D10, X4; G3-05, D13: a device reading can be withdrawn too, and every `ingest` row of
    it): first everything the engine holds for the patient is dropped (`Engine.forget`), then that patient's
    `ingest`, `chart` and `profile` rows are replayed in id order with the restart's own helpers — each reading
    judged where the door judged it. Engine only: no store and no lifecycle hook; the caller runs the hook once,
    at its own instant. Rows of another patient or kind are passed over, so the caller may hand it a wider
    read. `now` is the caller's clock (default: the clock): no instant handed to the engine is later than it
    plus REPLAY_SKEW (G3-06, D6)."""
    ceiling = (now if now is not None else datetime.now(timezone.utc)) + REPLAY_SKEW
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id or rec.event_type not in REBUILD_EVENTS:
            continue
        if rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif not _withdrawn(rec, skip, skip_device):
            _replay_ingest(engine, rec, _written_at(rec), ceiling)
```

- [ ] **Step 4: Run them — they pass, and so does every replay test**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_replay.py tests/test_rehydrate.py tests/test_bedside_rebuild.py tests/test_bedside_retract.py tests/test_device_retract.py tests/test_readings_api.py tests/test_saat_api.py 2>&1 | tail -3`
Expected: `272 passed` (9 + 19 + 33 + 49 + 47 + 112 + 3; about 60 s). `test_readings_api.py`'s `test_a_restart_replays_the_same_picture` and `test_a_back_dated_link_is_judged_now_and_leaves_an_overdue_antibiotic_overdue` replay linked rows: their links complete no recognition, so the new anchor moves nothing there (spec §8.2).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-saat && git add -- homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/tests/test_saat_replay.py && git commit -m "feat(replay): a linked row anchored at its measurement, every instant capped at the restart + 2 min (G3-06 D4, D6)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/tests/test_saat_replay.py
```

---

### Task 5: A withdrawal re-judges at its own instant — live, on restart, in the rebuild (D3; D6's route half)

**Files:**
- Test: `homunculus-engine/tests/test_saat_replay.py` — lines 13–18, after line 138 (the end of the file)
- Test: `homunculus-engine/tests/test_saat_api.py` — lines 9–11, after line 165 (the end of the file)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py` — lines 25–26, 85–89, 191–194, 300–301, 399–405 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 1414–1417, 1471–1473, 1540–1552 (as each step finds the file)
- Test: `homunculus-engine/tests/test_bedside_retract.py` — lines 146–150; `homunculus-engine/tests/test_bedside_rebuild.py` — lines 68–76, 218–224, 303–306 (the premises that move, spec §8.2)

«Hatalı giriş» rebuilds the patient into a scratch engine and adopts it; the alerts the hook then compared were the scratch engine's last evaluation, judged at the last remaining row. Now `_adopt_rebuilt` calls `engine.rejudge(patient_id, now)` right after `engine.adopt` and before the hook, with no `await` in between: the state as if the value had never arrived, the alerts as of the withdrawal. An alert the clock has reached since the last reading (an antibiotic hour run out) is one the withdrawal uncovers: stamped and told (G3-01 X3, `_stamp_uncovered`, `_tell_uncovered`). So that a restart agrees, the trail-replayers re-judge at every `chart_retract` row: `rehydrate` at the row's write time (capped by D6), then the hook at that same write time; `rebuild_patient` at the patient's earlier withdrawals (the route already reads them with the rebuild's rows), with no hook. A row whose `ts` cannot be read is passed over — the observation's fallback of `_written_at` is no withdrawal instant — and the withdrawal still applies through `skip`. The route reads its `now` before the rebuild and hands it to `rebuild_patient` (D6).

- [ ] **Step 1: The failing tests**

In `homunculus-engine/tests/test_saat_replay.py`, find (lines 13–18):

```python
import homunculus.api.rehydrate as rehydrate_module
from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditRecord
from homunculus.api.clinical import BEDSIDE_SKEW
from homunculus.api.rehydrate import REPLAY_SKEW, rebuild_patient, rehydrate
from homunculus.pipeline import Engine
```

Replace with:

```python
import homunculus.api.rehydrate as rehydrate_module
from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, AuditRecord, iter_records
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT
from homunculus.api.rehydrate import REPLAY_SKEW, rebuild_patient, rehydrate, retracted_entries
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from tests.conftest import requires_db
from tests.test_bedside_trail_stores import pg_log  # noqa: F401 — the Postgres audit, migrations 0004 and 0008
```

Append to the end of `homunculus-engine/tests/test_saat_replay.py` (after line 138), after two blank lines:

```python
def _withdrawal(id_, entry, ts, patient=PID) -> AuditRecord:
    """A `chart_retract` row as «hatalı giriş» writes it (G3-01 D10), withdrawing row `entry`, written at `ts`."""
    return AuditRecord(id=id_, ts=ts.isoformat() if isinstance(ts, datetime) else ts, tenant="h1",
                       event_type=RETRACT, patient_id=patient, subject="temperature",
                       payload={"entry": entry, "code": "temperature", "value": 37.0, "obs_ts": NOW.isoformat(),
                                "reason": "yanlış hastaya girilmiş", "retracted_by": "hem.ayse"})


def _overdue_trail(withdrawn_at):
    """Infection, platelets 120 and a MAP of 60 charted at -90 min — sepsis, the hour from -90 — then a temperature
    at -5 min that finds it overdue, withdrawn at `withdrawn_at`."""
    then, late = NOW - timedelta(minutes=90), NOW - timedelta(minutes=5)
    return [_row(1, "chart", "suspected_infection", 1.0, then, then),
            _row(2, "chart", "platelets", 120.0, then, then),
            _row(3, "chart", "map", 60.0, then, then),
            _row(4, "chart", "temperature", 37.0, late, late),
            _withdrawal(5, 4, withdrawn_at)]


class TestAWithdrawalRow:
    """D3: a `chart_retract` row re-judges its patient at the row's write time — capped at the ceiling — and runs
    the hook there; the withdrawn row itself is skipped as before."""

    def test_the_restart_rejudges_there_and_runs_the_hook_there(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        rows = _overdue_trail(NOW - timedelta(minutes=1))
        engine, store = Engine(), AckStore()
        rehydrate(engine, store, rows, skip=frozenset({4}), now=NOW)
        assert engine.state(PID).latest(SignalCode.TEMPERATURE) is None
        assert engine._judged_at[PID] == NOW - timedelta(minutes=1)
        assert _summary(engine, "antibiotic_overdue") == "Antibiotic OVERDUE by 29 min"
        assert (PID, "antibiotic_overdue") in store.firing and (PID, "antibiotic_due") not in store.firing
        assert hooks[-1] == (PID, NOW - timedelta(minutes=1))

    def test_a_row_whose_time_cannot_be_read_is_passed_over(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        rows = _overdue_trail("not a time")
        engine, store = Engine(), AckStore()
        rehydrate(engine, store, rows, skip=frozenset({4}), now=NOW)
        assert engine.state(PID).latest(SignalCode.TEMPERATURE) is None, "the withdrawal still applies"
        assert engine._judged_at[PID] == NOW - timedelta(minutes=90)
        assert _summary(engine, "antibiotic_due") == "Antibiotic window: 60 min remaining"
        assert len(hooks) == 3, "no hook for the unreadable row"

    def test_a_row_written_past_the_restart_rejudges_at_the_ceiling(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rehydrate(engine, AckStore(), _overdue_trail(ahead), skip=frozenset({4}), now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert hooks[-1] == (PID, ahead), "the hook's instant is the row's own"

    def test_a_withdrawal_for_a_patient_the_engine_does_not_hold_creates_nothing(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        engine = Engine()
        rehydrate(engine, AckStore(), [_withdrawal(1, 99, NOW, patient="bed-9")], now=NOW)
        assert engine.patient_ids() == [] and hooks == []

    def test_the_rebuild_rejudges_at_an_earlier_withdrawal_as_the_restart_does(self):
        rows = _overdue_trail(NOW - timedelta(minutes=1))
        rebuilt, restarted = Engine(), Engine()
        rebuild_patient(rebuilt, PID, rows, skip=frozenset({4}), now=NOW)
        rehydrate(restarted, AckStore(), rows, skip=frozenset({4}), now=NOW)
        assert rebuilt._judged_at[PID] == restarted._judged_at[PID] == NOW - timedelta(minutes=1)
        assert [a.summary for a in rebuilt.active_alerts(PID)] == [a.summary for a in restarted.active_alerts(PID)]
        assert "antibiotic_overdue" in {a.kind for a in rebuilt.active_alerts(PID)}


@requires_db
def test_a_postgres_trail_is_rejudged_at_its_withdrawal_row(pg_log):  # noqa: F811 — the fixture
    """The Postgres audit keeps `ts` as TEXT (migration 0004): the replay reads the withdrawal row's write time from
    it and re-judges there, as on the in-memory log."""
    now = datetime.now(timezone.utc)
    then, late = now - timedelta(minutes=90), now - timedelta(minutes=5)
    for code, value, at in [("suspected_infection", 1.0, then), ("platelets", 120.0, then), ("map", 60.0, then),
                            ("temperature", 37.0, late)]:
        last = pg_log.append(AuditEvent("h1", "chart", PID, code, {
            "value": value, "unit": "u", "obs_ts": at.isoformat(), "charted_by": "hem.ayse"}))
    withdrawal = pg_log.append(AuditEvent("h1", RETRACT, PID, "temperature", {
        "entry": last.id, "code": "temperature", "value": 37.0, "obs_ts": late.isoformat(),
        "reason": "yanlış hastaya girilmiş", "retracted_by": "hem.ayse"}))
    rows = list(iter_records(pg_log, tenant="h1", page=100))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, rows, skip=retracted_entries(rows), now=datetime.now(timezone.utc))
    assert engine._judged_at[PID] == datetime.fromisoformat(withdrawal.ts)
    assert (PID, "antibiotic_overdue") in store.firing
```

In `homunculus-engine/tests/test_saat_api.py`, find (lines 9–11):

```python
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
```

Replace with:

```python
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
```

Append to the end of `homunculus-engine/tests/test_saat_api.py` (after line 165), after two blank lines:

```python
class TestAWithdrawal:
    """D3: «hatalı giriş» re-judges the patient at the withdrawal's own instant — the state as if the value had
    never arrived, the alerts as of now."""

    def test_withdrawing_the_reading_that_found_the_hour_gone_leaves_the_overdue(self):
        """The reviewers' scenario: a MAP at -90 min completes sepsis and starts the hour, a temperature at -5 min
        finds it overdue, and the temperature is withdrawn. Rebuilt to the MAP row, the board read «60 min
        remaining» and the overdue latched — an hour that ran out at -30 min."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _, temperature = _overdue(c, now, ack=False)
            r = c.post(f"/clinical/{PID}/entries/{temperature}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            assert "antibiotic_overdue" in r.json()["alerts"] and "antibiotic_due" not in r.json()["alerts"]
            live = _card(c)
            assert "antibiotic_overdue" in _firing(live) and "antibiotic_due" not in _firing(live)
            assert all(a["resolved_at"] is None for a in live["alerts"]), "nothing latched"
            assert c.app.state.board_link._engine("h1").state(PID).latest(SignalCode.TEMPERATURE) is None
        _same_after_a_restart(audit, live)

    @pytest.mark.xfail(strict=True, reason="plan E-6 (F-1): the replay passes over the first sight and the "
                       "acknowledgement given while the withdrawn reading's evaluation had the overdue firing")
    def test_an_acknowledged_overdue_whose_finding_reading_is_withdrawn_keeps_both_after_a_restart(self):
        """Live, the overdue the temperature found stays one episode across its withdrawal (D3), acknowledged and
        first seen at the temperature's request. The restart skips the temperature row, so at the `first_seen` and
        `ack` rows the replay has no overdue firing and passes both over; the `chart_retract` row's rejudge then
        raises it unstamped and unacknowledged. Kept red on purpose: the owner decides (plan E-6)."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _, temperature = _overdue(c, now)
            r = c.post(f"/clinical/{PID}/entries/{temperature}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            live = _firing(_card(c))["antibiotic_overdue"]
            assert live["acknowledged"] and live["first_seen_at"] is not None
        with _app(audit) as again:
            after = _firing(_card(again))["antibiotic_overdue"]
        assert (after["acknowledged"], after["first_seen_at"]) == (True, live["first_seen_at"])

    def test_a_withdrawal_after_the_hour_ran_out_uncovers_the_overdue_and_tells_the_nurse(self):
        """The hour ran out at -30 min with no reading since but a wrong one at -80 min (a respiration rate that
        should have been 16). Withdrawn now, the patient is judged now: «antibiotic_overdue», a new alert — stamped
        and told to the nurse like any alert a withdrawal uncovers (G3-01 X3)."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _chart(c, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
                   now - timedelta(minutes=90))
            _chart(c, [{"code": "map", "value": 60}], now - timedelta(minutes=90))
            wrong = _chart(c, [{"code": "resp_rate", "value": 61}], now - timedelta(minutes=80))["resp_rate"]
            assert "antibiotic_due" in _firing(_card(c))
            seen, told = _count(audit, "first_seen"), _count(audit, "notification")
            r = c.post(f"/clinical/{PID}/entries/{wrong}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            assert "antibiotic_overdue" in r.json()["alerts"]
            stamped = audit.records(tenant="h1", patient_id=PID, event_type="first_seen", limit=100)[seen:]
            assert [row.subject for row in stamped] == ["antibiotic_overdue"]
            notes = audit.records(tenant="h1", patient_id=PID, event_type="notification", limit=100)[told:]
            assert [(n.subject, n.payload["audience"]) for n in notes] == [("antibiotic_overdue", "nurse")]
            live = _card(c)
        _same_after_a_restart(audit, live)
```

- [ ] **Step 2: Run them — they fail**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_replay.py tests/test_saat_api.py 2>&1 | tail -3`
Expected: `5 failed, 14 passed, 1 skipped, 1 xfailed`. Failing: `test_the_restart_rejudges_there_and_runs_the_hook_there`, `test_a_row_written_past_the_restart_rejudges_at_the_ceiling`, `test_the_rebuild_rejudges_at_an_earlier_withdrawal_as_the_restart_does` (the replay passes the withdrawal row over: `antibiotic_due`, judged at -90 min), `test_withdrawing_the_reading_that_found_the_hour_gone_leaves_the_overdue` and `test_a_withdrawal_after_the_hour_ran_out_uncovers_the_overdue_and_tells_the_nurse` (`antibiotic_due` in the answer). Passing already: the two guards (`test_a_row_whose_time_cannot_be_read_is_passed_over`, `test_a_withdrawal_for_a_patient_the_engine_does_not_hold_creates_nothing`). Skipped: the Postgres test (Task G1 Step 2 runs it). The xfail is departure E-6: it fails before and after this task, on purpose.

- [ ] **Step 3: The replay and the rebuild re-judge at a `chart_retract` row**

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 25–26):

```python
`alert_snooze` rows (G2-B5b) replay a snooze under the live door's rules, for an alarm firing and unanswered at
that point of the log. A later `ack` row, the episode's end, a worse reading or a discharge ends it, as live.
```

Replace with:

```python
A `chart_retract` row (G3-01's «hatalı giriş») takes its row out of the replay (`skip`), and since G3-06 (D3) it
also re-judges its patient at the row's write time and runs the hook there, as the live withdrawal re-judged at
its own instant (`Engine.rejudge`): a time-based alert the clock reached since the last reading is on the board
after a restart as it was live.

`alert_snooze` rows (G2-B5b) replay a snooze under the live door's rules, for an alarm firing and unanswered at
that point of the log. A later `ack` row, the episode's end, a worse reading or a discharge ends it, as live.
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 85–89):

```python
            if _replay_ingest(engine, rec, written, ceiling):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, written)
        elif rec.event_type == "profile":
```

Replace with:

```python
            if _replay_ingest(engine, rec, written, ceiling):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, written)
        elif rec.event_type == RETRACT:
            # G3-06 (D3): the withdrawal re-judged the patient at its instant, then ran the hook there. A row
            # whose time cannot be read is passed over (the withdrawal itself still applies, through `skip`).
            at = _retracted_at(rec)
            if at is not None and rec.patient_id in engine.patient_ids():
                engine.rejudge(rec.patient_id, min(at, ceiling))
                sync_alerts(engine, store, rec.patient_id, at)
        elif rec.event_type == "profile":
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 191–194):

```python
    try:
        return datetime.fromisoformat(rec.ts)
    except (TypeError, ValueError):
        return datetime.fromisoformat(rec.payload["obs_ts"])
```

Replace with:

```python
    try:
        return datetime.fromisoformat(rec.ts)
    except (TypeError, ValueError):
        return datetime.fromisoformat(rec.payload["obs_ts"])


def _retracted_at(rec: AuditRecord) -> datetime | None:
    """When a `chart_retract` row was written — the instant the withdrawal re-judged at (G3-06, D3) — or None when
    it cannot be read, or carries no zone to compare with the clock. Unlike `_written_at` there is no fallback: the
    row's `obs_ts` is the withdrawn reading's measurement, not the withdrawal's instant."""
    try:
        at = datetime.fromisoformat(rec.ts)
    except (TypeError, ValueError):
        return None
    return at if at.utcoffset() is not None else None
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 300–301):

```python
#: withdrawal route refuses a discharged number before any rebuild, or the rebuild would bring its readings back.
REBUILD_EVENTS = frozenset({"ingest", "chart", "profile"})
```

Replace with:

```python
#: withdrawal route refuses a discharged number before any rebuild, or the rebuild would bring its readings back.
#: G3-06 (D3): a `chart_retract` row handed to `rebuild_patient` beside these re-judges the patient there.
REBUILD_EVENTS = frozenset({"ingest", "chart", "profile"})
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 399–405):

```python
    read. `now` is the caller's clock (default: the clock): no instant handed to the engine is later than it
    plus REPLAY_SKEW (G3-06, D6)."""
    ceiling = (now if now is not None else datetime.now(timezone.utc)) + REPLAY_SKEW
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id or rec.event_type not in REBUILD_EVENTS:
            continue
```

Replace with:

```python
    read. `now` is the caller's clock (default: the clock): no instant handed to the engine is later than it
    plus REPLAY_SKEW (G3-06, D6). The patient's `chart_retract` rows among them re-judge it at their write time,
    as `rehydrate` does (G3-06, D3; no hook here); the withdrawal route reads them with the rest."""
    ceiling = (now if now is not None else datetime.now(timezone.utc)) + REPLAY_SKEW
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id:
            continue
        if rec.event_type == RETRACT:
            at = _retracted_at(rec)
            if at is not None:
                engine.rejudge(patient_id, min(at, ceiling))     # answers [] while it holds no reading
            continue
        if rec.event_type not in REBUILD_EVENTS:
            continue
```

`REBUILD_EVENTS` stays `{"ingest", "chart", "profile"}`: `test_bedside_rebuild.py` pins it, and the route reads `REBUILD_EVENTS | {RETRACT}` already.

- [ ] **Step 4: The route re-judges after `adopt`, and reads its clock before the rebuild**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 1414–1417):

```python
        `copies` (G3-05, D13): how many `ingest` rows the withdrawal took — one reading written twice is removed
        from the shadow engine twice, a removal dropping one equal reading."""
        engine.adopt(scratch, patient_id)
        cleared = sync_alerts(engine, store, patient_id, now)
```

Replace with:

```python
        `copies` (G3-05, D13): how many `ingest` rows the withdrawal took — one reading written twice is removed
        from the shadow engine twice, a removal dropping one equal reading.

        G3-06 (D3): the adopted patient is re-judged at `now` before the hook — its state as if the value had never
        arrived, its alerts as of the withdrawal, not of the last remaining reading — with no `await` in between.
        An alert the clock has reached since that reading (an antibiotic hour run out) is one the withdrawal
        uncovers: stamped and told below."""
        engine.adopt(scratch, patient_id)
        engine.rejudge(patient_id, now)
        cleared = sync_alerts(engine, store, patient_id, now)
```

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 1471–1473):

```python
        Then the lifecycle hook runs once, at the request's instant. An alert that no longer fires ends — or,
        critical and unacknowledged, latches (G2-A1, D3). An alert the withdrawal uncovers is a new one, so it
        is stamped and, if immediate, told to the nurse (X3).
```

Replace with:

```python
        Then the patient is re-judged at the request's instant (G3-06, D3: the alerts as of the withdrawal, not of
        the last remaining reading) and the lifecycle hook runs once, at that instant. An alert that no longer
        fires ends — or, critical and unacknowledged, latches (G2-A1, D3). An alert the withdrawal uncovers — an
        antibiotic hour that ran out since the last reading among them — is a new one, so it
        is stamped and, if immediate, told to the nurse (X3).
```

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 1540–1552):

```python
        already = target.id in withdrawn or (own is not None and own in withdrawn_device)
        skip_device = withdrawn_device if own is None else withdrawn_device | {own}
        scratch = Engine()
        rebuild_patient(scratch, patient_id, rows, skip=withdrawn | {target.id}, skip_device=skip_device)
        observation = observation_of(target)
        # Every row the withdrawal takes (the named one alone, for a hand entry). The shadow engine took one reading
        # per `/ingest` and a removal drops one, so it is removed once per copy; the record's one table row may be
        # filed under either copy's id, so each is marked.
        taken = [target.id] if own is None else [r.id for r in rows if r.event_type == "ingest"
                                                 and device_key_of(r) == own]
        copies = len(taken)
        now = datetime.now(timezone.utc)
        if already:
```

Replace with:

```python
        already = target.id in withdrawn or (own is not None and own in withdrawn_device)
        skip_device = withdrawn_device if own is None else withdrawn_device | {own}
        # The request's one instant, read before the rebuild (G3-06, D6): no instant the rebuild hands the scratch
        # engine is later than it plus the replay's skew, and the rejudge, the hook and the rows below use it.
        now = datetime.now(timezone.utc)
        scratch = Engine()
        rebuild_patient(scratch, patient_id, rows, skip=withdrawn | {target.id}, skip_device=skip_device, now=now)
        observation = observation_of(target)
        # Every row the withdrawal takes (the named one alone, for a hand entry). The shadow engine took one reading
        # per `/ingest` and a removal drops one, so it is removed once per copy; the record's one table row may be
        # filed under either copy's id, so each is marked.
        taken = [target.id] if own is None else [r.id for r in rows if r.event_type == "ingest"
                                                 and device_key_of(r) == own]
        copies = len(taken)
        if already:
```

The «already» branch's repair (`_adopt_rebuilt` when memory still counts the value) re-judges through the same function; its other branch re-runs only the idempotent tail and judges nothing anew, as before.

- [ ] **Step 5: Run them — the new tests pass, and four premises move**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_replay.py tests/test_saat_api.py tests/test_bedside_retract.py tests/test_bedside_rebuild.py 2>&1 | tail -8`
Expected: `4 failed, 97 passed, 1 skipped, 1 xfailed`. The four are the premises spec §8.2 names (and one it did not, departure E-3):
- `test_bedside_retract.py::TestEqualToNeverCharted::test_an_older_value_withdrawn_while_a_newer_one_of_its_code_exists` and `…::test_a_map_withdrawn_after_the_anchor_it_set_was_dropped` — the live engine is now judged at the withdrawal's instant (`judged`), the fresh one at its last chart;
- `test_bedside_rebuild.py::TestRehydrateSkips::test_a_withdrawn_value_that_ended_a_critical_leaves_no_latch_after_a_restart` — the restart re-judges at the withdrawal row's write time, the real clock, four hours after the helpers' `EARLY`: the bolus is outside the 3 h window and the shock is `under_resuscitated_sepsis`;
- `test_bedside_rebuild.py::TestRestartEqualsTheLiveRebuild::test_the_next_real_reading_after_the_restart_starts_its_own_clock` — after that rejudge the restarted engine never judges before the real clock again, so a «next reading» at `EARLY + 3 h` finds its own hour already over (`KeyError: ('bed-3', 'antibiotic_due')`).

- [ ] **Step 6: The premises, moved — never the floor weakened**

In `homunculus-engine/tests/test_bedside_retract.py`, find (lines 146–150):

```python
    with _app() as fresh:
        for entries, minutes in never:
            _chart(fresh, entries, at(minutes))
        want = (_internals(fresh), _view(_card(fresh)))
    return before, got, want
```

Replace with:

```python
    with _app() as fresh:
        for entries, minutes in never:
            _chart(fresh, entries, at(minutes))
        # G3-06 (D3): the live withdrawal re-judged the patient at its own instant. The fresh engine is re-judged at
        # that instant too, so `got == want` still says «the state as if never charted, the alerts as of the
        # withdrawal».
        _engine(fresh).rejudge("bed-3", got[0]["judged"])
        want = (_internals(fresh), _view(_card(fresh)))
    return before, got, want
```

In `homunculus-engine/tests/test_bedside_rebuild.py`, find (lines 68–76):

```python
def _withdraw_live(engine, store, log, pid, row, at):
    """A «hatalı giriş» in the order X4 fixes: the patient rebuilt into a scratch engine without every
    withdrawn row, the `chart_retract` row, the scratch patient adopted, then the lifecycle hook once."""
    skip = retracted_entries(log.records(tenant=H, limit=1000)) | {row.id}
    scratch = Engine()
    rebuild_patient(scratch, pid, log.records(tenant=H, patient_id=pid, limit=1000), skip=frozenset(skip))
    _withdrawn(log, pid, row)
    engine.adopt(scratch, pid)
    sync_alerts(engine, store, pid, at)
```

Replace with:

```python
def _withdraw_live(engine, store, log, pid, row, at):
    """A «hatalı giriş» in the order X4 fixes: the patient rebuilt into a scratch engine without every
    withdrawn row, the `chart_retract` row, the scratch patient adopted and re-judged (G3-06, D3) — at the
    row's own write time, as the restart re-judges it: the audit stamps rows with the real clock, while these
    helpers simulate the wall clock with `at` — then the lifecycle hook once."""
    skip = retracted_entries(log.records(tenant=H, limit=1000)) | {row.id}
    scratch = Engine()
    rebuild_patient(scratch, pid, log.records(tenant=H, patient_id=pid, limit=1000), skip=frozenset(skip))
    withdrawal = _withdrawn(log, pid, row)
    engine.adopt(scratch, pid)
    engine.rejudge(pid, datetime.fromisoformat(withdrawal.ts))
    sync_alerts(engine, store, pid, at)
```

In `homunculus-engine/tests/test_bedside_rebuild.py`, find (lines 218–224):

```python
        # shock is firing and nothing is latched, as live. Replayed with the row, the latch would return.
        engine, store, log = Engine(), AckStore(), InMemoryAuditLog()
        for code, value in _SHOCK:
            _door(engine, store, log, "bed-3", code, value, EARLY)
        wrong = _door(engine, store, log, "bed-3", "lactate", 1.5, EARLY + timedelta(minutes=1))
        assert _keys(store.resolved, "bed-3") == ["septic_shock"]
        _withdraw_live(engine, store, log, "bed-3", wrong, EARLY + timedelta(minutes=2))
```

Replace with:

```python
        # shock is firing and nothing is latched, as live. Replayed with the row, the latch would return.
        # G3-06 (D3): the withdrawal is re-judged at its row's write time — now — so the shock is charted at T0,
        # half an hour back, where its bolus is inside the 3 h fluid window then; at EARLY it would be outside.
        engine, store, log = Engine(), AckStore(), InMemoryAuditLog()
        for code, value in _SHOCK:
            _door(engine, store, log, "bed-3", code, value, T0)
        wrong = _door(engine, store, log, "bed-3", "lactate", 1.5, T0 + timedelta(minutes=1))
        assert _keys(store.resolved, "bed-3") == ["septic_shock"]
        _withdraw_live(engine, store, log, "bed-3", wrong, T0 + timedelta(minutes=2))
```

In `homunculus-engine/tests/test_bedside_rebuild.py`, find (lines 303–306):

```python
        _, log = self._wrong_map_withdrawn()
        engine, store = _restart(log)
        later = EARLY + timedelta(hours=3)
        _door(engine, store, log, "bed-3", "map", 60, later)
```

Replace with:

```python
        _, log = self._wrong_map_withdrawn()
        engine, store = _restart(log)
        # G3-06 (D3): the restart re-judged the patient at the withdrawal row's write time — the real clock, not
        # the helpers' EARLY — and the engine never judges before it again. The next real reading is measured
        # after it, so its hour runs from its own time and is not already over.
        later = datetime.now(timezone.utc)
        _door(engine, store, log, "bed-3", "map", 60, later)
```

- [ ] **Step 7: Run them — they pass**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_replay.py tests/test_saat_api.py tests/test_bedside_retract.py tests/test_bedside_rebuild.py tests/test_device_retract.py tests/test_rehydrate.py tests/test_engine_floor.py 2>&1 | tail -3`
Expected: `187 passed, 1 skipped, 1 xfailed` (14 + 5 + 49 + 33 + 47 + 19 + 20 passed; about 40 s).

- [ ] **Step 8: The downstream readers stay green**

Run the three commands of Task 1 Step 7. Expected: the same three lines.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/g3-saat && git add -- homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_saat_replay.py homunculus-engine/tests/test_saat_api.py homunculus-engine/tests/test_bedside_retract.py homunculus-engine/tests/test_bedside_rebuild.py && git commit -m "feat(retract): a withdrawal re-judges at its own instant, and the replay at each chart_retract row (G3-06 D3)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_saat_replay.py homunculus-engine/tests/test_saat_api.py homunculus-engine/tests/test_bedside_retract.py homunculus-engine/tests/test_bedside_rebuild.py
```

---

### Task 6: The link — judged at the link, anchored at the measurement, live and in the shadow lane (D4, D5)

**Files:**
- Test: `homunculus-engine/tests/test_saat_api.py` — lines 9–18, after line 238 (the end of the file)
- Test: `homunculus-engine/tests/test_infinity_rules.py` — after line 1118 (the end of the file)
- Test: `homunculus-engine/tests/test_readings_api.py` — lines 648–649 (a docstring)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 962–964, 1841–1849, 1869–1872, 1883–1886 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/infinity_rules.py` — lines 479–486 (as the step finds the file)

The owner's «Bağlama anında değerlendir, saat ölçümden»: `_apply_reading` keeps `judge_at` (the link is its only caller) and computes `requested = min(obs.timestamp, wall_now)`; the engine call becomes `engine.ingest(obs, now=requested if judge_at is None else judge_at, anchor_at=requested)`. A door's reading is unchanged (one instant, passed twice); a linked set is judged at the link — a six-hour-old set is stale for NEWS2 there, as G3-05 pinned — and a recognition it completes runs its hour from the measurement, so an hour already past reads overdue at once. The shadow mirror is handed the same two instants: `mirror_observation(…, judge_at=None)` (G3-05 §11.5 (c), closed). The restart already agrees since Task 4: a linked row is judged at its write time and anchored at its stamp.

- [ ] **Step 1: The failing tests**

In `homunculus-engine/tests/test_saat_api.py`, find (lines 9–18):

```python
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.canonical import SignalCode
from tests.test_ingest_apply import obs
```

Replace with:

```python
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.infinity_shadow import shadow_settings_from_env
from homunculus.api.monitor_samples import InMemorySamples
from homunculus.api.readings import POLICY_UNMATCHED
from homunculus.canonical import SignalCode
from tests.test_infinity_shadow_isolation import TABLE
from tests.test_ingest_apply import obs
from tests.test_readings_api import (
    ADMISSION, KEY, _ago, _assign, _identities, _ids, _resolve_scope, _send,
)
from tests.test_readings_api import _card as _key_card
from tests.test_readings_api import _chart as _key_chart
from tests.test_readings_api import _resolve as _readings_resolve
from tests.test_readings_ingest import _Flaky
```

Append to the end of `homunculus-engine/tests/test_saat_api.py` (after line 238), after two blank lines:

```python
def _linking_app(tmp_path, audit, store, identities) -> TestClient:
    """The unmatched list's app (tests/test_readings_api.py `_app`: KEY admitted, the policy that lists an unknown
    number) with the shadow lane at stage `rules`, so the link's mirror reaches a shadow engine (Aşama B)."""
    table = tmp_path / "device-beds.json"
    table.write_text(json.dumps(TABLE), encoding="utf-8")
    shadow = shadow_settings_from_env({"INFINITY_CLINICAL_STAGE": "rules", "INFINITY_SHADOW_TOKEN": "s" * 40,
                                       "INFINITY_SHADOW_HOSPITAL": "h1", "INFINITY_DEVICE_BEDS_PATH": str(table)},
                                      {TOKEN: "h1"})
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_readings_resolve,
                     resolve_scope=_resolve_scope, audit=audit, identities=identities, readings=store,
                     unknown_readings=POLICY_UNMATCHED, samples=InMemorySamples(), shadow=shadow)
    return TestClient(app)


class TestALinkedSet:
    """D4, D5: a set linked from «Eşleşmeyen ölçümler» is judged at the link and a recognition it completes is
    anchored at its measurement — in the real engine, in the shadow engine and after a restart."""

    @pytest.mark.parametrize("judged_up_to_now", [True, False], ids=["judged-up-to-now", "infection-only"])
    def test_a_set_measured_six_hours_ago_that_completes_sepsis_is_overdue_at_once(self, tmp_path,
                                                                                    judged_up_to_now):
        audit, identities = InMemoryAuditLog(), _identities()
        store = _Flaky(admitted={("h1", KEY): ADMISSION})
        stamp = _ago(hours=6)
        with _linking_app(tmp_path, audit, store, identities) as c:
            _key_chart(c, [{"code": "suspected_infection", "value": 1}], _ago(hours=7))
            if judged_up_to_now:
                _key_chart(c, [{"code": "temperature", "value": 37.0}], _ago(minutes=1))
            # MAP 60 and platelets 120 — two SOFA points — from a point-of-care device, under a mistyped number.
            _send(c, [("map", 60), ("platelets", 120)], when=stamp, device="POC-7")
            r = _assign(c, _ids(c))
            assert r.status_code == 200, r.text
            assert "antibiotic_overdue" in r.json()["alerts"] and "antibiotic_due" not in r.json()["alerts"]
            live = _key_card(c)
            assert "antibiotic_overdue" in _firing(live) and "antibiotic_due" not in _firing(live)
            assert datetime.fromisoformat(_anchor(live)) == stamp
            real = c.app.state.board_link._engine("h1")
            assert real.recognized_at(KEY) == stamp
            shadow = c.app.state.shadow_lane.engines["h1"]
            assert shadow.recognized_at(KEY) == stamp
            assert {a.kind for a in shadow.active_alerts(KEY)} & {"antibiotic_due", "antibiotic_overdue"} == \
                {"antibiotic_overdue"}
            alerts = sorted((a.kind, a.severity, a.urgency) for a in real.active_alerts(KEY))
        with _linking_app(tmp_path, audit, store, identities) as again:
            restarted = again.app.state.board_link._engine("h1")
            assert restarted.recognized_at(KEY) == stamp, "the same anchor exactly"
            assert sorted((a.kind, a.severity, a.urgency) for a in restarted.active_alerts(KEY)) == alerts
```

Append to the end of `homunculus-engine/tests/test_infinity_rules.py` (after line 1118), after two blank lines:

```python
def test_the_mirror_judges_a_linked_reading_at_the_link_and_anchors_it_at_its_measurement():
    """G3-06 (D5; G3-05 §11.5 (c)): `mirror_observation` hands the shadow engine the real engine's two instants.
    Infection charted seven hours back; a set measured six hours back — MAP 60 and platelets 120 — linked now.
    The shadow engine judges it at the link and anchors the sepsis it completes at the measurement, as the real
    engine does: overdue at once in both, never «60 min remaining» in either."""
    lane, real, _ = _lane()
    lane.install("h1", real, now=DT0)
    infection = Observation("bed-1", SignalCode.SUSPECTED_INFECTION, 1.0, "", DT0 - timedelta(hours=7), "clinician")
    real.ingest(infection, now=infection.timestamp)
    lane.mirror_observation("h1", infection, now=DT0, real=real)
    stamp = DT0 - timedelta(hours=6)
    for code, value in [(SignalCode.MAP, 60), (SignalCode.PLATELETS, 120)]:
        linked = Observation("bed-1", code, value, "u", stamp, "POC-7")
        real.ingest(linked, now=DT0, anchor_at=stamp)                    # as `_apply_reading` does for a link
        lane.mirror_observation("h1", linked, now=DT0, real=real, judge_at=DT0)
    shadow = lane.engines["h1"]
    assert shadow.recognized_at("bed-1") == real.recognized_at("bed-1") == stamp
    assert shadow._judged_at["bed-1"] == real._judged_at["bed-1"] == DT0
    for engine in (shadow, real):
        kinds = {a.kind for a in engine.active_alerts("bed-1")}
        assert "antibiotic_overdue" in kinds and "antibiotic_due" not in kinds
```

In `homunculus-engine/tests/test_readings_api.py`, find (lines 648–649):

```python
        reassurance) and, acknowledged, ended its episode. A link is judged at the wall clock; the value keeps its
        own time. A restart agrees: the replay judges a linked `ingest` row where the link did."""
```

Replace with:

```python
        reassurance) and, acknowledged, ended its episode. A link is judged at the wall clock and anchored at its
        measurement (G3-06, D4: here the anchor was set by `_overdue`'s charted MAP, not by the link); the value
        keeps its own time. A restart agrees: the replay judges a linked `ingest` row where the link did."""
```

- [ ] **Step 2: Run them — they fail**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_api.py tests/test_infinity_rules.py 2>&1 | tail -3`
Expected: `3 failed, 68 passed, 1 xfailed`. Both cases of `test_a_set_measured_six_hours_ago_that_completes_sepsis_is_overdue_at_once` on `assert ('antibiotic_overdue' in ['sepsis', 'antibiotic_due'])` (anchored at the link: «60 min remaining»); `test_the_mirror_judges_a_linked_reading_at_the_link_and_anchors_it_at_its_measurement` on `TypeError: ShadowLane.mirror_observation() got an unexpected keyword argument 'judge_at'`.

- [ ] **Step 3: The link's two instants, and the mirror's**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 962–964):

```python
        # A link is judged NOW (`judge_at=now`, see `_apply_reading`). Not covered: the shadow lane's
        # `mirror_observation` still judges a linked reading at its measurement time, inside its own engine — the
        # shadow lane is non-clinical, and that is left as it is (B6 re-review).
```

Replace with:

```python
        # A link is judged NOW (`judge_at=now`) and a recognition it completes is anchored at the reading's
        # measurement (G3-06, D4; see `_apply_reading`). The shadow lane's mirror is handed the same two instants
        # (D5), so the shadow engine judges and anchors a linked set where the real one does.
```

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 1841–1849):

```python
        WHEN THE RULES JUDGE. `judge_at` None (the door, as ever): at the reading's own time, never past the wall
        clock. A LINKED reading passes `judge_at=wall_now` (B6 review): it is judged NOW and keeps its own
        timestamp — stored, audited as `obs_ts`, drawn at its time in the trends. A link is always back-dated
        (up to 24 h), and the antibiotic clock, the sepsis and shock rules and the alerts' episodes all measure
        from the evaluation's `now`: judged at the old measurement time, a linked SpO₂ from six hours ago would
        replace an `antibiotic_overdue` with an `antibiotic_due` («300 min remaining» — false reassurance) and
        end an acknowledged overdue's episode. Judged now, a stale value simply does not count for NEWS2's
        freshness, and no clock goes backwards. The replay agrees: an `ingest` row naming a `reading` is
        replayed at the row's write time (rehydrate `_replay_ingest`).
```

Replace with:

```python
        WHEN THE RULES JUDGE. `judge_at` None (the door, as ever): the door asks for the reading's own time, never
        past the wall clock — one instant, which the engine floors at the patient's last judgement for every rule
        (G3-06, D1) and at which it anchors a recognition the reading completes (D2). A LINKED reading passes
        `judge_at=wall_now` (B6 review): it is judged NOW, floored like every judgement, and keeps its own
        timestamp — stored, audited as `obs_ts`, drawn at its time in the trends. Judged at the old measurement
        time, a linked SpO₂ from six hours ago would replace an `antibiotic_overdue` with an `antibiotic_due`
        («300 min remaining» — false reassurance); judged now, a stale value simply does not count for NEWS2's
        freshness. A recognition a linked reading completes is anchored at its measurement, min(stamp, wall
        clock) (G3-06, D4, the owner: «Bağlama anında değerlendir, saat ölçümden»): the hour runs from when the
        criteria were met, so an hour already past reads overdue at once. The replay agrees: an `ingest` row
        naming a `reading` is judged at the row's write time and anchored at its stamp (rehydrate
        `_replay_ingest`). The shadow lane's mirror is handed the same two instants (D5).
```

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 1869–1872):

```python
        # The rules judge at the reading's own time but never past the wall clock (G2-A2, X10): judged at a
        # stamp in the future, every other input would be aged to it. The audit row keeps the stamp; the replay
        # judges at min(the stamp, the row's write time) (rehydrate, X10b). A linked reading: at `judge_at`.
        alerts = engine.ingest(obs, now=min(obs.timestamp, wall_now) if judge_at is None else judge_at)
```

Replace with:

```python
        # The door asks for the reading's own time but never past the wall clock (G2-A2, X10): judged at a stamp
        # in the future, every other input would be aged to it. The engine judges at that instant's floor (G3-06,
        # D1) and anchors a recognition at the instant itself (D2). The audit row keeps the stamp; the replay asks
        # for min(the stamp, the row's write time) (rehydrate, X10b). A linked reading: judged at `judge_at`,
        # anchored at the same min(stamp, wall clock) — its measurement (D4).
        requested = min(obs.timestamp, wall_now)
        alerts = engine.ingest(obs, now=requested if judge_at is None else judge_at, anchor_at=requested)
```

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 1883–1886):

```python
        # Aşama B (D1): the same observation into the shadow engine, after the real evaluation and
        # its lifecycle hook — guarded, so nothing the lane does can fail this request.
        lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=wall_now, real=engine))
        payload = {"value": obs.value, "unit": obs.unit,
```

Replace with:

```python
        # Aşama B (D1): the same observation into the shadow engine, after the real evaluation and
        # its lifecycle hook — guarded, so nothing the lane does can fail this request. A linked reading's
        # `judge_at` goes with it (G3-06, D5).
        lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=wall_now, real=engine,
                                                            judge_at=judge_at))
        payload = {"value": obs.value, "unit": obs.unit,
```

In `homunculus-engine/src/homunculus/api/infinity_rules.py`, find (lines 479–486):

```python
    def mirror_observation(self, hospital: str, obs: Observation, *, now: datetime, real: Engine) -> None:
        """`now` is the door's: the instant the real engine judged `obs` at. With the install
        pending this does nothing (`_installed`): the install, when the next pass runs it, copies a
        real engine that holds `obs` already."""
        engine = self._installed(hospital)
        if engine is None:
            return
        engine.ingest(obs, now=min(obs.timestamp, now))
```

Replace with:

```python
    def mirror_observation(self, hospital: str, obs: Observation, *, now: datetime, real: Engine,
                           judge_at: datetime | None = None) -> None:
        """`now` is the door's wall clock. The shadow engine is handed the real engine's two
        instants (G3-06, D5): judged at min(the stamp, `now`) — or, for a linked reading, at
        `judge_at`, the link's wall clock — and a recognition the reading completes anchored at
        min(the stamp, `now`), its measurement. Its own floor does the rest: the copy the install
        makes carries the real engine's (D1). With the install pending this does nothing
        (`_installed`): the install, when the next pass runs it, copies a real engine that holds
        `obs` already."""
        engine = self._installed(hospital)
        if engine is None:
            return
        requested = min(obs.timestamp, now)
        engine.ingest(obs, now=requested if judge_at is None else judge_at, anchor_at=requested)
```

`app.state.shadow_mirror` (the `/clinical` door's mirror) passes no `judge_at`, so a charted entry keeps one instant in the shadow engine as in the real one. `retract_observation` still does not re-judge (spec D5, §10).

- [ ] **Step 4: Run them — they pass, and the readings and the shadow lane stay green**

Run: `cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_api.py tests/test_infinity_rules.py tests/test_readings_api.py tests/test_ingest_apply.py tests/test_readings_ingest.py tests/test_readings_unmatched.py tests/test_api_shadow_findings.py 2>&1 | tail -3`
Expected: `265 passed, 1 xfailed` (about 50 s).

- [ ] **Step 5: The downstream readers stay green**

Run the three commands of Task 1 Step 7. Expected: the same three lines.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g3-saat && git add -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/infinity_rules.py homunculus-engine/tests/test_saat_api.py homunculus-engine/tests/test_infinity_rules.py homunculus-engine/tests/test_readings_api.py && git commit -m "feat(readings): a linked set is judged at the link and anchored at its measurement, in the shadow lane too (G3-06 D4, D5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/infinity_rules.py homunculus-engine/tests/test_saat_api.py homunculus-engine/tests/test_infinity_rules.py homunculus-engine/tests/test_readings_api.py
```

---

## Closing (controller)

### Task G1: The gates

**Files:** none. A gate failure goes back to its task as a fix commit (pathspec, trailer); then the failed chunk is run again. Every command is one foreground call.

- [ ] **Step 1: The whole no-DB engine suite, in three foreground chunks** (spec §8.4: every file under `tests`, no `-k`)

`test_infinity_vm_pilot.py` is left out by building the file list without it. **`--ignore=tests/test_infinity_vm_pilot.py`, which earlier gates used, does not exclude a file the glob itself names**: on the scratch copy the second chunk collected its 13 tests with it (they passed once and failed once — a multicast join after the machine had slept — and the rule is never to run it):

```bash
cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[a-d]*.py 2>&1 | tail -3
cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $(ls tests/test_[e-l]*.py | grep -v test_infinity_vm_pilot) 2>&1 | tail -3
cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[m-z]*.py tests/rules tests/scoring tests/tenant 2>&1 | tail -3
```

Expected: no failure, no error. Against Task 0's baseline (**4470 passed, 1528 skipped** with these three commands) the slice adds **44 passed, 1 skipped, 1 xfailed** — **4514 passed, 1529 skipped, 1 xfailed**:

| Chunk | Baseline | After the slice | What was added |
|---|---|---|---|
| `test_[a-d]*` | 1369 / 827 | 1369 / 827 | nothing new (`test_bedside_*`, `test_engine_*` edits keep their counts) |
| `test_[e-l]*` without `test_infinity_vm_pilot.py` | 1719 / 115 | 1741 / 115 | `test_engine_floor.py` 20, `test_infinity_rules.py` +2 |
| `test_[m-z]*` + `rules`, `scoring`, `tenant` | 1382 / 586 | 1404 / 587, 1 xfailed | `test_readings_api.py` +1, `test_saat_api.py` 7 (+1 xfailed: E-6), `test_saat_replay.py` 14 (+1 skipped: its Postgres test) |

The `xfailed` is departure E-6, red on purpose: an `XPASS(strict)` failure there means someone fixed F-1 — remove the mark in the same commit. These numbers were seen on the scratch copy; the chunks take about four, five and six minutes. **No pin moved** (spec D7): `test_route_permissions.py`, `test_board_permissions.py`, `test_route_inventory.py`, `test_permissions.py`, `test_nginx_routes.py` and `test_tenant_isolation.py` are in the first and third chunks, unchanged.

- [ ] **Step 2: The Postgres-marked audit and replay tests, on the throwaway database** (spec §8.4: the replay parses the Postgres audit's `ts`, a `TEXT` column)

Start `saat-pg` («Ground rules»), then, one call:

`cd /c/tmp/g3-saat/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:saat@127.0.0.1:56454/saat_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_saat_replay.py tests/test_audit_postgres.py tests/test_bedside_trail_stores.py tests/test_readings_postgres.py 2>&1 | tail -3`

Expected: `86 passed` — nothing skipped (`test_saat_replay.py` 15, its `test_a_postgres_trail_is_rejudged_at_its_withdrawal_row` among them; `test_audit_postgres.py` 12; `test_bedside_trail_stores.py` 3; `test_readings_postgres.py` 56; about 130 s on the scratch copy). Stop the container: `docker stop saat-pg`.

- [ ] **Step 3: The slice's files under Python 3.14**

`cd /c/tmp/g3-saat/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_floor.py tests/test_saat_api.py tests/test_saat_replay.py tests/test_pipeline.py tests/test_engine_adopt.py tests/test_engine_forget.py tests/test_bedside_retract.py tests/test_bedside_rebuild.py tests/test_infinity_rules.py 2>&1 | tail -3`

Expected: `240 passed, 1 skipped, 1 xfailed` (20 + 7 + 14 + 39 + 11 + 3 + 49 + 33 + 64; seen on the scratch copy, about 25 s).

- [ ] **Step 4: The dashboard is not a gate** (spec §8.4): `cd /c/tmp/g3-saat && git diff --stat b3e57312 -- dashboard deploy homunculus-engine/alembic` prints nothing.

- [ ] **Step 5: Record the gates** — the lines as printed, the date and the head's sha — in this plan's «As run» block and the spec's «As built» (Task D1). Commit with Task D1.

---

### Task G2: The local walk (spec §8.4 «Local walk»; synthetic only)

**Where:** `/c/tmp/g3-saat`, after Task G1. The agent drives the dashboard in headless Chrome, as G3-05's walk did, on a local stack whose api image is this branch's — **synthetic data only**: the tenant `saat-yuruyus`, the patient «Test Hasta» born 1970-05-05. Nothing is committed by this task: its outcome is `/c/tmp/homunculus-plans/g3-saat/walk/notes.md` (each item: what was done, what the screen said, pass or finding) and the screenshots beside it (1440 px).

**Unlike every other task of this plan, these commands were not run when the plan was written** (another lane's stack was up on the fixed container names): they follow `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md` Task G2, whose stack scratch (`/c/tmp/g115plan/stack/`) this walk reuses. Where a line does not behave as written, write down what it did, adapt it, and go on — the five items and their expected pictures are what is binding.

- [ ] **Step 1: No other stack.** `docker ps -a --format '{{.Names}} {{.Ports}}' | grep -E '^homunculus-(postgres|api|web|bridge|nce) ' || echo "no stack containers"`. If a container is listed: **stop and ask the controller** whose it is. Never `down -v` a stack this task did not start.

- [ ] **Step 2: The api image from this branch's head; the web image unchanged from main's** (no dashboard change):

```bash
cd /c/tmp/g3-saat
docker build -q -t g3-saat-api:new -f homunculus-engine/Dockerfile.api homunculus-engine
docker build -q -t g3-saat-web:new --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -f deploy/local/web/Dockerfile .
docker run --rm --entrypoint python g3-saat-api:new -c "from homunculus.api.rehydrate import REPLAY_SKEW; from homunculus.pipeline import Engine; print(REPLAY_SKEW, hasattr(Engine, 'rejudge'))"
```

Expected: two image ids; `0:02:00 True`.

- [ ] **Step 3: The stack** — as G3-05's Task G2 Steps 3–4, with `S=/c/tmp/homunculus-plans/g3-saat/stack`, `WEB_PORT=18206`, `WEB_TLS_PORT=18569`, `TENANT_SLUG=saat-yuruyus`, the compose override naming `g3-saat-api:new` and `g3-saat-web:new` (`pull_policy: never`; no bridge), and the project `-p g3saat`. Up: `postgres api web`. Wait for `curl -s http://127.0.0.1:18206/health`.

- [ ] **Step 4: The walk** (sign in as the seed admin of `local.env`; admit «Test Hasta» to a bed as G3-05's walk did, and use its protocol number below as `KEY`):

  1. **Sepsis recognised, the hour running, then overdue on a current reading.** On the patient screen, «Ölçüm gir» / the sepsis panel: suspected infection, platelets 120 and a MAP of 60, all with the time set 90 minutes back. The card shows sepsis and the antibiotic clock «kalan …». Then a temperature at the current time: the card reads «gecikti» (`antibiotic_overdue`). Acknowledge it on «Alarmlar».
  2. **A device reading stamped four hours back: the card stays «gecikti».** Post one device round through `/ingest` with the device token of `local.env` (G3-05's Task G2 item 4 gives the `curl` loop), `effectiveDateTime` four hours back. Expected: «gecikti» stays, acknowledged; no new notification; «Ölçüm kaydı» shows the set at its own time with «alındı …».
  3. **«Düzelt» that device value: still «gecikti».** On «Ölçüm kaydı», «Düzelt» on the device SpO₂ with a reason and a right value. Expected: the value struck through, the corrected value «elle» at the same time, «gecikti» stays acknowledged.
  4. **Withdraw a hand value: the alerts read as of now.** On the vital trend table, «Hatalı giriş» on the temperature of item 1. Expected: the answer and the card keep `antibiotic_overdue` — never «kalan 60 dk» — and nothing latches.
  5. **Restart the API: the same picture.** `docker compose -p g3saat … restart api`; after the health check the card shows the same alerts and the same antibiotic anchor (`meds.antibiotic_clock.recognized_at`). Item 1's acknowledgement is not expected to survive a restart after item 4's withdrawal of the very value that found the hour gone: that is departure E-6 — write down what the card shows.

- [ ] **Step 5: Down, and the notes.** `$C down -v` (this task's stack only). Write `notes.md`: the date, the head's sha, the image ids, each item's pass or finding. A finding goes back to its task as a fix commit, and the item is walked again. Do not commit the notes or the screenshots.

---

### Task D1: The guide, the roadmap, the amended plans and specs, «As built», the deploy notes for Lane A

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` — lines 2876–2881, 1740–1741, 2818–2820, 2868–2871 (as each step finds the file)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — line 58
- Modify: `docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md` — line 33 (the X9e row)
- Modify: `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` — lines 414, 419–420 (§11.5 (a), (c))
- Modify: `docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md` — after line 430 (the end of the file)

Docs are the controller's. `docs/homunculus-rehber-TR.md` is the owner's living guide: plain Turkish, no jargon without its meaning. The edits below were applied to a scratch copy at `b3e57312`; if another lane's merge moved a find block, the text is the same and only its place changed.

- [ ] **Step 1: The guide — a new section, and three sentences that are no longer true**

The next free number after §3.27 is **§3.28**. Other lanes are adding sections now (G3-07 «Kabul zamanı» among them): **fix the number at the merge**, and with it the cross-references written here («3.28»).

In `docs/homunculus-rehber-TR.md`, find (lines 2876–2881):

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (§11 «As built»); plan
  `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

Replace with:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (§11 «As built»); plan
  `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`.

### 3.28 Saat geri gitmez: geç gelen bir ölçüm saati geri çevirmez (Grup 3 · G3-06)

- **Ne:** Bir ölçüm motora ölçüldüğünden saatler sonra ulaşabilir: cihazın bekletip geç gönderdiği bir tur, yatak
  başında kendi saatine girilen bir set, «Düzelt»in ölçüm saatine yazdığı doğru değer, «Eşleşmeyen ölçümler»den
  bağlanan bir set. Bu dilimden önce böyle bir değer **kendi ölçüm saatinde** değerlendiriliyordu: dört saat önceki
  bir değer, süresi çoktan dolmuş bir antibiyotik saatini «gecikti»den «kalan süre»ye çevirebiliyor, onaylanmış bir
  «gecikti» uyarısını kapatıp bir sonraki ölçümde **yeni** bir uyarı (yeni bildirim, yeni yükseltme) olarak geri
  getirebiliyordu. Artık motor bir hastayı, o hastayı en son değerlendirdiği andan **geriye** değerlendirmez.
  **Durum:** kodda (`feat/g3-saat-geri-gitmez`); main'de ve hastane sunucusunda değil — ikisi de sahibin sözüyle.
  Göç yoktur. Örneklerdeki değerler uydurmadır.
- **Sözcükler.**
  - *Değerlendirme anı:* motorun kurallarını (NEWS2, sepsis, septik şok, 3 saatlik sıvı penceresi, antibiyotik saati,
    model) çalıştırdığı an. Geç gelen değer bu anda değerlendirilir; **değerin kendi saati değişmez**: grafikte,
    «Ölçüm kaydı»nda ve denetim kaydında ölçüldüğü saatte durur, tazeliği de o saatten sayılır.
  - *Taban:* hastanın en son değerlendirildiği an; hiç geri gitmez. NEWS2 için G2-A2'den beri böyleydi; artık her
    kural için böyledir.
- **Ne değişir.**
  - **«Gecikti» geri dönmez.** Geç gelen bir tur ya da geriye tarihli bir giriş antibiyotik saatini geri çevirmez.
    Açık ve onaylanmış bir «gecikti» uyarısı onayıyla ve ilk görülme saatiyle aynı uyarı olarak kalır; yeni bildirim
    gitmez.
  - **Geç gelen değer sepsis kriterlerinin saatler önce karşılandığını gösterirse «gecikti» hemen görünür.**
    Antibiyotik saati, kriterleri tamamlayan ölçümün saatinden işler (sahibin kararı: «ölçüm saatinden»). Örnek:
    şüpheli enfeksiyon işaretli bir hastada 6 saat önce ölçülmüş bir değer sepsis kriterini tamamlarsa saat 6 saat
    önceden başlar ve «gecikti» hemen çıkar. «Sıfır anı»nın nasıl tanımlanacağı bilgi tabanında açık bir sorudur; bu
    bir işletme kuralıdır, klinik bir iddia değildir.
  - **«Hatalı giriş» ve «Düzelt»ten sonra uyarılar o ana göre değerlendirilir.** Hasta yine geri alınan değer hiç
    girilmemiş gibi kurulur (3.12); ama uyarılar artık kalan son ölçümün saatine göre değil, geri alma anına göre
    okunur. Son ölçümden beri süresi dolan bir antibiyotik saati «gecikti» olur; bu, geri almanın ortaya çıkardığı
    yeni bir uyarı gibi işaretlenir ve hemşireye bildirilir.
  - **Listeden bağlanan set bağlandığı an değerlendirilir, saati ölçümden işler** (sahibin kararı: «Bağlama anında
    değerlendir, saat ölçümden»). Saatler önceki bir set NEWS2'ye eski değer olarak girmez (3.27); ama sepsis
    kriterini tamamlarsa antibiyotik saati ölçümden başlar.
  - **Yeniden başlatma aynı resmi verir.** Denetim kaydı yeniden oynatılırken her satır canlıdaki anlarla
    değerlendirilir, her «hatalı giriş» satırında hasta o satırın saatinde yeniden değerlendirilir, ve oynatma hiçbir
    hastayı sunucu saatinin 2 dakika ötesinde değerlendirmez: saati ileri gitmiş bir sunucunun ya da saati okunamayan
    bir satırın hastanın tabanını geleceğe taşıması böylece önlenir.
- **Ne değişmez.** Kurallar, eşikler ve pencereler (1 saatlik antibiyotik, 3 saatlik sıvı, 15 dakikalık işaret
  düzeltme penceresi, 24 saatlik geriye tarih sınırı) aynıdır. Kayıt kapıları aynı değerleri aynı saatlerle kaydeder.
  Yeni ekran, yetki, rol ya da göç yoktur. Gölge motor (Aşama B) da aynı anları alır.
- **Sınırlar.**
  - Yeni bir ölçüm gelmeden motorda zaman ilerlemez: bir «antibiyotik zamanı» uyarısı, süresi dolunca kendiliğinden
    «gecikti» olmaz; hastanın bir sonraki ölçümünde ya da bir geri almada olur. Panodaki ve «Eczane»deki geri sayım ise
    duvar saatiyle işler (bu dilimden önce de böyleydi).
  - Geç gelen bir değer, ancak kendi kodunun en yeni ölçümüyse SOFA'ya girer; daha eskisi yalnız bir değerlendirmeyi
    tetikler.
  - **Açık (sahibin kararı):** «gecikti»yi bulan ölçüm onaylandıktan sonra geri alınırsa, canlı panoda uyarı onaylı
    kalır; ama API yeniden başlatılırsa uyarı onaysız ve «ilk görülme» saati olmadan geri gelir, hastanın bir sonraki
    ölçümünde yeniden işaretlenir ve oradan yükseltilebilir (planın E-6'sı).
  - Kurulumdan sonraki ilk yeniden başlatma eski kaydı yeni kurala göre oynatır: geriye tarihli ölçüm almış
    hastalarda pano kurulumdan önceki panodan farklı olabilir — bir «zamanı» uyarısı «gecikti» olabilir, ya da
    eskiden ikiye bölünmüş bir «gecikti» tek bir uyarı olarak eski onayıyla geri gelebilir.
- **Arka planda.** Motor her hasta için bir taban tutar (`_judged_at`); her değerlendirme «istenen an» ile tabanın
  geç olanında yapılır. Geri alma, hastayı denetim kaydından kurduktan sonra onu o anda yeniden değerlendirir
  (`Engine.rejudge`).
- **Kaynak:** `docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md` (§12 «As built»); plan
  `docs/superpowers/plans/2026-11-12-g3-saat-geri-gitmez.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

In `docs/homunculus-rehber-TR.md`, find (lines 1740–1741):

```markdown
  - hastanın motor durumu denetim kaydından, o değer **hiç girilmemiş gibi** yeniden kurulur
    (NEWS2, canlı SOFA, sepsis, antibiyotik saati, alarmlar); yeniden başlatmada da geri gelmez.
```

Replace with:

```markdown
  - hastanın motor durumu denetim kaydından, o değer **hiç girilmemiş gibi** yeniden kurulur
    (NEWS2, canlı SOFA, sepsis, antibiyotik saati, alarmlar); yeniden başlatmada da geri gelmez.
    G3-06'dan beri uyarılar geri alma anında değerlendirilir: son ölçümden beri süresi dolan bir
    antibiyotik saati «gecikti» olur ve yeni bir uyarı gibi hemşireye bildirilir (3.28).
```

In `docs/homunculus-rehber-TR.md`, find (lines 2818–2820):

```markdown
    Skorlar ve uyarılar onu bağlandığı an, geç gelmiş bir değer olarak değerlendirir: 3.12'deki tazelik kuralıyla
    eski bir değer NEWS2'ye girmez, ve hiçbir saat (antibiyotik süresi, bir alarmın başlangıcı) onun için geriye
    işlemez.
```

Replace with:

```markdown
    Skorlar ve uyarılar onu bağlandığı an, geç gelmiş bir değer olarak değerlendirir: 3.12'deki tazelik kuralıyla
    eski bir değer NEWS2'ye girmez, ve hiçbir saat (antibiyotik süresi, bir alarmın başlangıcı) onun için geriye
    işlemez. G3-06'dan beri bağlanan set bir sepsis tanısını tamamlarsa antibiyotik saati **ölçüm saatinden**
    işler: saat çoktan dolmuşsa «gecikti» hemen görünür (3.28).
```

In `docs/homunculus-rehber-TR.md`, find (lines 2868–2871):

```markdown
  - Geç gelen bir ölçüm — cihazın beklettiği bir tur ya da «Düzelt»in ölçüm saatine yazdığı doğru değer — kendi ölçüm
    saatinde değerlendirilir; bu, açık bir «antibiyotik gecikti» uyarısını «antibiyotik zamanı» uyarısına
    çevirebilir. Bu dilimden önce de böyleydi (geriye tarihli her elle girişte de); düzeltmesi sahibin kararını
    bekliyor. Listeden bağlanan ölçümde bu olmaz (yukarıda).
```

Replace with:

```markdown
  - **Kapandı (G3-06, 3.28):** geç gelen bir ölçüm — cihazın beklettiği bir tur ya da «Düzelt»in ölçüm saatine
    yazdığı doğru değer — artık hastanın en son değerlendirildiği andan geriye değerlendirilmez; açık bir
    «antibiyotik gecikti» uyarısı «antibiyotik zamanı»na dönmez.
```

- [ ] **Step 2: The roadmap — the row of G3-06**

The find block is the end of the G3-05 row (it begins with a space: it is the tail of a long line). Fill the `…` of the status cell from Task G1's and G2's records before committing (the head's sha, the engine numbers, the Postgres count, the walk).

In `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, find (line 58):

```markdown
 AZ/RU/EN metinler ana dili okumasını bekliyor; NCE akışı (B1d O1–O6) — yalnız yerel kurulumda denendi |
```

Replace with:

```markdown
 AZ/RU/EN metinler ana dili okumasını bekliyor; NCE akışı (B1d O1–O6) — yalnız yerel kurulumda denendi |
| G3-06 | Saat geri gitmez (Lane A): geç gelen bir ölçüm (cihazın beklettiği tur, kendi saatine girilen set, «Düzelt»in doğru değeri, listeden bağlanan set) zamana bağlı hiçbir kuralı geri çevirmez — motor her hastayı en son değerlendirdiği andan geriye değerlendirmez (`_judged_at`, NEWS2'nin X9e tabanı artık her kuralın: sepsis, şok, 3 sa sıvı penceresi, antibiyotik saati, model); değer kendi saatinde kalır; sepsisi tamamlayan geç ölçümün antibiyotik saati ölçümden işler (sahibin kararı «ölçüm saatinden»; bağlanan set bağlandığı an değerlendirilir, saati ölçümden); «hatalı giriş»/«Düzelt» uyarıları geri alma anında değerlendirir (`Engine.rejudge`), yeniden oynatma her `chart_retract` satırında da; oynatmanın her anı sunucu saati + 2 dk ile sınırlı; dönüştürme penceresi (X12) taban anlarla ölçülür; gölge hat aynı iki anı alır (G3-05 §11.5 (a), (c) kapandı); göç, yol, yetki, ekran değişikliği yok · spec: [2026-11-12](../specs/2026-11-12-g3-saat-geri-gitmez-design.md) · plan: [2026-11-12](2026-11-12-g3-saat-geri-gitmez.md) | Kod ✅ … · dal `feat/g3-saat-geri-gitmez` @ `…` · kapılar: motor veritabanısız … geçti / … atlandı / 1 xfail (E-6); Postgres … · yerel yürüyüş: … · **main'de değil, VM'de değil** (sahibin sözü; kurulum notları planın sonunda) · açık: E-6 — «gecikti»yi bulan ölçüm onaydan sonra geri alınırsa yeniden başlatmada onay ve ilk görülme düşer (sahibin kararı) |
```

- [ ] **Step 3: The amended decisions, where they were made**

In `docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md`, find (line 33):

```markdown
`now` is unchanged for the antibiotic anchor, sepsis, shock and the model; the replay, which ingests in id order, follows. Task 1, `test_a_back_dated_reading_cannot_undo_the_hold_or_raise_news2_on_a_stale_value`. |
```

Replace with:

```markdown
`now` is unchanged for the antibiotic anchor, sepsis, shock and the model; the replay, which ingests in id order, follows. Task 1, `test_a_back_dated_reading_cannot_undo_the_hold_or_raise_news2_on_a_stale_value`. **Amended 2026-11-12 (G3-06 D1, `docs/superpowers/plans/2026-11-12-g3-saat-geri-gitmez.md`):** every rule — the antibiotic anchor's drop and restore test, sepsis, shock and the 3 h fluid window, the antibiotic clock, the model — now judges at that per-patient instant, renamed `Engine._judged_at`; «`now` is unchanged for …» no longer holds. |
```

In `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md`, find (line 414):

```markdown
  D12 amendment removed for links only. The fix touches G2-A2 X10 and G3-01 D7: the owner's decision.
```

Replace with:

```markdown
  D12 amendment removed for links only. The fix touches G2-A2 X10 and G3-01 D7: the owner's decision.
  **Closed by G3-06** (`docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md`, D1): every rule judges
  at the patient's floor; X10 and D7 stand as they were.
```

In `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md`, find (lines 419–420):

```markdown
- **(c) The shadow lane** (`mirror_observation`) still judges a linked reading at its measurement time, inside its own
  engine. Non-clinical; left as it is.
```

Replace with:

```markdown
- **(c) The shadow lane** (`mirror_observation`) still judges a linked reading at its measurement time, inside its own
  engine. Non-clinical; left as it is. **Closed by G3-06** (D5): the mirror is handed the real engine's two
  instants (`judge_at`), and the shadow engine's copy carries the floor.
```

- [ ] **Step 4: The spec — «As built»**

Append to the end of `docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md` (after line 430), after one blank line, and fill each `…` from Tasks G1 and G2:

```markdown
## 12. As built

Plan: `docs/superpowers/plans/2026-11-12-g3-saat-geri-gitmez.md`. Built on `feat/g3-saat-geri-gitmez`; head `…`; gates run … (the lines are in the plan's «As run» block).

What differs from the design above (the plan's departures, E-1 … E-6):

- **§8.1 files.** The engine's tests are `tests/test_engine_floor.py`; the API's `tests/test_saat_api.py`; the replay's `tests/test_saat_replay.py`, on rows built by hand (E-1). The link's shadow check reads the shadow engine at stage `rules` with no monitor linked: a link only decides publication and adds monitor samples, which carry no SOFA or antibiotic input (E-2).
- **§8.2.** One more premise moved than listed: `test_the_next_real_reading_after_the_restart_starts_its_own_clock` — its «next reading» now comes after the restart's floor (E-3).
- **D3.** A `chart_retract` row whose `ts` has no zone is passed over like an unreadable one (E-4). A Postgres-marked replay test reads the withdrawal's write time from the `TEXT` column (E-5).
- **D3, «a restart equals live» — open (E-6, F-1).** It holds for kind, severity, urgency and anchor. It does not hold for the first sight and the acknowledgement of an alert the withdrawn reading's own evaluation raised: live keeps both across the withdrawal; the replay, skipping that reading, passes its `first_seen` and `ack` rows over, and the `chart_retract` row's rejudge raises the alert unstamped and unacknowledged — stamped at the next reading, escalating from there. Pinned as a strict `xfail`. A fix needs a replay rule this spec does not have (for example: replay a withdrawn row as a rejudge at its own requested instant, without its value): **the owner's decision.**

Local walk (§8.4): … (date, head, the five items: pass or finding).
```

- [ ] **Step 5: The plan's «As run» block, and the commit**

Fill the «As run» block at the end of this plan (below) with Task G1's results and Task G2's outcome, then:

```bash
cd /c/tmp/g3-saat && git add -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md docs/superpowers/plans/2026-11-12-g3-saat-geri-gitmez.md && git commit -m "docs(rehber, roadmap, specs): G3-06 Saat geri gitmez — §3.28, the roadmap row, X9e and §11.5 amended, as built, the gates as run" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/plans/2026-10-25-g2a-motor-borcu.md docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md docs/superpowers/specs/2026-11-12-g3-saat-geri-gitmez-design.md docs/superpowers/plans/2026-11-12-g3-saat-geri-gitmez.md
git push origin feat/g3-saat-geri-gitmez
```

Then report to Lane A that the branch is ready for the owner's «main'e al», with the deploy notes below and E-6 as the one open item. **Do not merge and do not touch the VM.**

---

## Deploy notes for Lane A (spec §9 — what the blocks must say; Lane A writes them, the owner's «onay» runs them)

> **As built (2026-11-13):** the spec's §12 «Deploy notes for the controller lane» supersede this list where they
> differ — block A-1's first number is there the patients with an `antibiotic_overdue` episode that ended and was
> raised again.

- **Images: api only.** No migration, no web change, no bridge change. `alembic heads` is unchanged by this slice.
- **Block A-1 (before the deploy) prints two numbers and never a patient id.** In a pasted heredoc the `psql` call takes `</dev/null`:
  - an upper bound on the patients whose antibiotic picture the first restart can move (spec §7, items 3–4):
    `select count(distinct patient_id) from audit where event_type = 'alert' and subject in ('antibiotic_due', 'antibiotic_overdue') and ts::timestamptz > now() - interval '48 hours'`;
  - the linked readings whose recognition, if they completed one, the first restart anchors at their measurement instead of their write time (§7, item 5):
    `select count(*) from audit where event_type = 'ingest' and payload->>'reading' is not null`.
- **The first restart replays the old trail under the new rule** (§7): for a patient with a back-dated reading after a recognition the board may differ from the pre-deploy board — an overdue the old code turned into «due» is overdue again, as one episode, with its earlier acknowledgement; a «due» may now read overdue, stamped and told at the patient's next reading. `_replay_ack`, the `first_seen` branch, `store.recent.clear()` and `expire_snoozes` are untouched; the hook still runs at each row's write time.
- **The ward is told beforehand** (spec §9, in the ward's words):
  - a late reading (a device round sent late, a set charted at its own time) never turns «gecikti» back into «kalan süre»;
  - when a late reading shows that the sepsis criteria were met hours ago, «gecikti» appears at once, because the hour runs from the measurement (the owner's choice);
  - after «hatalı giriş» or «Düzelt», the alerts are judged as of that moment, so an antibiotic hour that ran out since the last reading reads «gecikti» — and is told to the nurse;
  - a set linked from «Eşleşmeyen ölçümler» is scored at the moment it is linked, so an hours-old set is too old to count in the NEWS2 score; but if it completes the sepsis criteria, the antibiotic hour runs from its measurement, and «gecikti» can appear at once.
- **Open (E-6):** if the reading that found an antibiotic hour gone is acknowledged and then withdrawn, the live board keeps the acknowledgement; after an API restart the overdue comes back unacknowledged and is stamped at the patient's next reading, from which it escalates. The owner decides whether to fix it before the deploy; the block need not change for it.
- **Rollback:** the previous api image. Nothing stored changes. Under the old image a back-dated reading is judged at its own time again (the false «kalan süre» comes back), and the next restart replays the trail under the old rules.

---

## As run (filled by the controller in Tasks G1, G2 and D1)

- Head: `786ff4e1` (code; Tasks 1–6, the owner's anchor refinement `18261d11`, review commits `e1471b87`,
  `786ff4e1`) · date: 2026-11-13. The chunks ran about 1.8× slower than on the scratch copy (the first took 445 s), so
  the second and third were each run as two calls to stay under 600 s; the file sets are the plan's.
- G1 Step 1 (engine, no database): `test_[a-d]*` `1369 passed, 827 skipped` · `test_[e-l]*` without vm_pilot
  `431 passed, 85 skipped` (`[e-h]`) + `1316 passed, 30 skipped` (`[i-l]`) = 1747 / 115 · `test_[m-z]*` + `rules`,
  `scoring`, `tenant` `737 passed, 242 skipped` (`[m-r]`) + `667 passed, 345 skipped, 1 xfailed` = 1404 / 587 / 1.
  **Total 4520 passed, 1529 skipped, 1 xfailed** — six more than expected above: the owner's refinement added five
  tests to `test_engine_floor.py` (`18261d11`), the review one (`e1471b87`); 26 there instead of 20.
- G1 Step 2 (Postgres, `saat-pg`): `test_saat_replay.py test_rehydrate.py test_audit_postgres.py test_audit_since.py
  test_bedside_trail_stores.py` `81 passed`; `test_tasks_postgres.py` `10 passed`; `test_readings_postgres.py`
  `56 passed in 133.17s` — **147 passed, none skipped**. `alembic heads`: `0021 (head)`, one head. `saat-pg`
  stopped.
- G1 Step 3 (Python 3.14): `246 passed, 1 skipped, 1 xfailed` (240 + the six above).
- G1 Step 4 (no dashboard, deploy or alembic change): `git diff --stat 88f6544c HEAD -- dashboard deploy
  homunculus-engine/alembic` prints nothing.
- G2 (the walk): 2026-11-13, images from `786ff4e1`, compose project `g3saat`, tenant `saat-yuruyus`, API-driven —
  all five items PASS, no finding; item 5 (restart) shows E-6 exactly as accepted (A's overdue unacknowledged,
  `first_seen_at` null, and a second notification at the next reading) — notes at
  `/c/tmp/homunculus-plans/g3-saat/walk/notes.md`

---

## Spec coverage

**Decisions (spec §2):**

| # | Decision | Task(s) |
|---|---|---|
| D1 | one floor per patient for every rule; `_judged_at` renamed, in `_PER_PATIENT`; values keep their stamps; the engine reads no clock | 1 (`_evaluate`, the rename, `TestEveryRuleJudgesAtTheFloor`, `TestTheFloorIsPerPatientMemory`), 2 (`_judged_at` and `_dropped_anchor` move together) |
| D2 | `anchor_at`; anchor `min(anchor_at, at)`; the restore rule on floored instants with the `0 <=` guard; a fresh patient judged at the doors as today | 2 (`TestTheAnchor`, `TestTheRestoreRule`), 1 (`test_a_fresh_patients_first_reading_is_judged_at_its_own_stamp_as_before`) |
| D3 | `Engine.rejudge`; `_adopt_rebuilt` rejudges before the hook; `rehydrate` and `rebuild_patient` rejudge at `chart_retract` rows; an unreadable `ts` passed over; an uncovered alert stamped and told | 3 (`TestRejudge`), 5 (both halves, `TestAWithdrawal`, `TestAWithdrawalRow`) |
| D4 | the doors keep one instant; the link judged at `wall_now`, anchored at `min(stamp, wall_now)`; the replay's two instants; restart equals live | 1 (the doors, no code), 4 (the replay), 6 (the link, `TestALinkedSet` with its restart) |
| D5 | the shadow lane: `copy` carries the floor; `mirror_observation(…, judge_at=None)` | 1 (`test_a_shadow_copy_keeps_an_overdue_on_a_mirrored_reading_stamped_four_hours_back`), 6 (`mirror_observation`, its unit test, the API test's shadow engine — E-2) |
| D6 | `REPLAY_SKEW` = `BEDSIDE_SKEW`; ingest's `now`/`anchor_at` and rejudge's `now` capped; `rebuild_patient(now=…)`, the route reads `now` first; the hook's instant not capped | 4 (`TestTheFloorNeverGoesPastTheCeiling`), 5 (the route, `test_a_row_written_past_the_restart_rejudges_at_the_ceiling`) |
| D7 | no migration, route, permission, UI change or audit type; no pin moves | «Ground rules», G1 Steps 1 and 4 |

**Testing (spec §8), bullet by bullet:**

| Spec §8 | Where |
|---|---|
| §8.1 overdue stays overdue, with `AckStore` and `sync_alerts` | 1, `TestOverdueStaysOverdue` |
| §8.1 a late recognition overdue at once; a fresh patient as today | 1, `TestEveryRuleJudgesAtTheFloor` |
| §8.1 the restore test and its companion | 2, `TestTheRestoreRule` |
| §8.1 `rejudge` | 3, `TestRejudge` |
| §8.1 `_PER_PATIENT`; `forget`, `copy`, `adopt` | 1, `TestTheFloorIsPerPatientMemory`; the existing pin `test_engine_adopt.py::test_per_patient_names_list_every_dict_the_engine_keeps` |
| §8.1 the `/ingest` buffered round; `/clinical` back-dated; «Düzelt» — each with a restart | 1, `TestALateReadingAtTheDoors` |
| §8.1 a link judged at the link, anchored at the measurement — twice; the shadow engine; a second app | 6, `TestALinkedSet` (E-2), `test_the_mirror_judges_a_linked_reading_at_the_link_and_anchors_it_at_its_measurement` |
| §8.1 a replayed linked row; one written 1 h past the restart | 4, `TestALinkedRow` |
| §8.1 the withdrawal re-judges (the reviewers' scenario), with a restart | 5, `test_withdrawing_the_reading_that_found_the_hour_gone_leaves_the_overdue`; and E-6's xfail |
| §8.1 the future floor, two trails, the hook's instant unchanged | 4, `TestTheFloorNeverGoesPastTheCeiling` |
| §8.1 the shadow lane test | 1, `test_infinity_rules.py::test_a_shadow_copy_keeps_an_overdue_on_a_mirrored_reading_stamped_four_hours_back` |
| §8.2 `test_bedside_retract.py` `_internals`, `_equal_to_never_charted` | 1 (the rename), 5 Step 6 |
| §8.2 `test_bedside_rebuild.py` `_withdraw_live`, the shock test's instants | 5 Step 6 (and E-3's fourth premise) |
| §8.2 `test_engine_adopt.py`, `test_engine_forget.py` | 1 Step 5 |
| §8.2 `test_readings_api.py`: the door's docstring and its sibling; the G3-05 link tests unchanged but one docstring | 1 Step 2, 6 Step 1 |
| §8.2 `test_pipeline.py` X9e comment | 1 Step 5 |
| §8.3 downstream readers | 1 Step 7, 5 Step 8, 6 Step 5 (four commands) |
| §8.4 gates; the local walk | G1, G2 |

**Spec §4** (changes by file) → Tasks 1–6 (code), D1 (docs: the guide, the roadmap row, G3-05 §11.5). **§5** (what this amends) → D1 Step 3 (X9e, §11.5) and the spec's «As built». **§6** (other clocks) → nothing to build: `scripts/` untouched; `test_infinity_shadow_equivalence.py` on the run list (Task 1 Step 7). **§7** (the restart) → Tasks 4, 5; «Deploy notes». **§9** → «Deploy notes for Lane A». **§10** (not in this slice) → no task; the guide's «Sınırlar».

**Self-review notes.** No step says «TBD» or «similar to Task N»; every function, constant and helper a task uses is defined in an earlier task or in «Interfaces», with one signature throughout (`ingest(obs, now, *, anchor_at=None)`, `rejudge(patient_id, now)`, `_evaluate(patient_id, state, requested, anchor_at)`, `_new_anchor(patient_id, anchor, at)`, `_replay_ingest(engine, rec, written, ceiling)`, `rebuild_patient(…, now=None)`, `mirror_observation(…, judge_at=None)`, `REPLAY_SKEW`, `_retracted_at`). The only blanks left are the controller's records (`…`: the head's sha, the gate lines, the walk's outcome), which do not exist until G1 and G2 have run. Task G2's commands are the one part of the plan that was not executed while it was written.
