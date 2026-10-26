# G2-A11 Taburcu kancaları — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A patient discharged through a Homunculus admission (`source = "kabul"`, a tombstone in the identity store) leaves the alert world: readings for the number are dropped before the engine with an audit row, the discharge retires every alert with an `alert_cleared` row (reason `discharged`), the escalation cycle never pages for such a patient, a restart agrees with the identity store, and the `/clinical` loop becomes an importable function (X62).

**Architecture:** Nothing new is stored. `Engine.forget` and `AckStore.forget_patient` remove a patient's in-memory state; `alert_lifecycle.retire_state`/`retire_patient` end the alerts and (the latter) write the audit rows; `app.py` wires the drop at the two doors, the identity refusals, the self-healing escalation cycle, the start-up sweep and `app.state.retire_patient`; `rehydrate` applies the `discharged` rows. The tombstone predicate lives in `alert_lifecycle` on this branch (`main` has no `KABUL`); the merge with B1a unifies it (spec O1).

**Tech Stack:** Python 3.12, FastAPI, pytest (no database needed: every test here runs with the in-memory stores). Spec: `docs/superpowers/specs/2026-10-26-g2a-taburcu-kancalari-design.md` (6acd666, D8 amended by X1 below).

---

## Ground rules (every task)

- Worktree `/c/tmp/g2a-a11`, branch `feat/g2a-a11` off `main` `1bc5b34`. Never touch `c:\Users\User\Desktop\Project\Homunculus AI`. Never `git stash`.
- Every file here is CRLF in the working tree (`git ls-files --eol` → `w/crlf`). Edit with a tool that keeps CRLF, or convert back before committing; verify with `python -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'),b.count(b'\n'))" <file>` — the two numbers must be equal.
- Run tests from `/c/tmp/g2a-a11/homunculus-engine` as `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files>`. Never run `tests/test_infinity_vm_pilot.py`. Do not set `DATABASE_URL`. The full no-DB gate is `-q --ignore=tests/test_infinity_vm_pilot.py tests` (expect 2390 passed / 654 skipped at `1bc5b34`, plus this slice's tests).
- Synthetic ids and values only (`H-1`, `bed-3`, `140 bpm`); no names of real people (CLAUDE.md rule 6).
- Commit with an explicit pathspec, message `feat(...)`/`test(...)`/`refactor(...)`/`docs(...)` + ` (G2-A11)`, body says what changed and why, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Comments in the code explain *why*, in the register of the files around them (see `api/alert_lifecycle.py`'s module docstring). Tag new lines `G2-A11` with the decision (`D1`…`D9`) they implement.
- Report back: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the commit sha, the test counts, and anything you departed from.

## File map

| File | Change |
|---|---|
| `homunculus-engine/src/homunculus/state/repository.py` | `remove(patient_id)` on the protocol and the in-memory repository (Task 1) |
| `homunculus-engine/src/homunculus/pipeline.py` | `Engine.forget(patient_id)` (Task 1) |
| `homunculus-engine/src/homunculus/api/ackstore.py` | `AckStore.forget_patient(patient_id)` (Task 2) |
| `homunculus-engine/src/homunculus/api/alert_lifecycle.py` | `DISCHARGED`, `READING_DROPPED`, `KABUL_SOURCE`, `is_tombstone`, `retire_state`, `retire_patient` (Task 2) |
| `homunculus-engine/src/homunculus/api/rehydrate.py` | the `alert_cleared`/`discharged` branch (Task 3) |
| `homunculus-engine/src/homunculus/api/clinical.py` | `chart_observations(...)` (Task 4) |
| `homunculus-engine/src/homunculus/api/app.py` | `/clinical` uses `chart_observations` (Task 4); drops and identity refusals (Task 5); `retire_and_publish`, cycle guard, `_ensure` sweep (Task 6) |
| `homunculus-engine/tests/test_engine_forget.py` | new (Task 1) |
| `homunculus-engine/tests/test_alert_lifecycle.py` | retire + forget tests (Task 2) |
| `homunculus-engine/tests/test_rehydrate.py` | replay of a `discharged` row (Task 3) |
| `homunculus-engine/tests/test_api_discharge.py` | new: doors, identity refusals, retire, cycle, sweep (Tasks 5, 6) |
| `homunculus-engine/README.md`, `docs/homunculus-rehber-TR.md`, roadmap | docs (Task 7) |

---

### Task 1: The engine can forget a patient

**Files:**
- Modify: `homunculus-engine/src/homunculus/state/repository.py`
- Modify: `homunculus-engine/src/homunculus/pipeline.py` (the `Engine` class; `patient_ids`/`state` are at the end of the file)
- Create: `homunculus-engine/tests/test_engine_forget.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_engine_forget.py
"""G2-A11 (D9): the engine forgets a discharged patient — state, alerts, anchors, held NEWS2, profile.
Synthetic bed and made-up values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.profile import PatientProfile

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)

# Suspected infection, 100 kg, 30 mL/kg given, MAP 60 on noradrenaline 0.12, lactate 3.1: septic
# shock (CRITICAL), sepsis (HIGH) and the antibiotic clock — the same bed as test_alert_lifecycle.
SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
         (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
         (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]


def _reading(engine, code, value, minute=0, patient="bed-3"):
    o = Observation(patient, code, value, "u", T0 + timedelta(minutes=minute), "dev")
    return engine.ingest(o, now=o.timestamp)


def _shock(engine, patient="bed-3"):
    for code, value in SHOCK:
        _reading(engine, code, value, patient=patient)
    assert {a.kind for a in engine.active_alerts(patient)} >= {"septic_shock", "sepsis"}


def test_forget_drops_state_alerts_anchor_and_profile():
    engine = Engine()
    _shock(engine)
    engine.set_profile(PatientProfile(patient_id="bed-3"))
    assert engine.recognized_at("bed-3") is not None

    engine.forget("bed-3")

    assert "bed-3" not in engine.patient_ids()
    assert engine.active_alerts("bed-3") == []
    assert engine.recognized_at("bed-3") is None
    assert engine.profile("bed-3") is None


def test_forget_is_idempotent_and_leaves_other_patients_alone():
    engine = Engine()
    _shock(engine, patient="bed-3")
    _reading(engine, SignalCode.HEART_RATE, 140, patient="bed-4")      # NEWS2 on another bed
    engine.forget("bed-3")
    engine.forget("bed-3")                                              # nothing to drop: no error
    assert engine.patient_ids() == ["bed-4"]
    assert {a.kind for a in engine.active_alerts("bed-4")} == {"news2"}


def test_a_reading_after_forget_starts_a_fresh_patient():
    engine = Engine()
    _shock(engine)
    engine.forget("bed-3")
    # Infection absent and the anchor dropped: a recognition inside ANCHOR_RESTORE_S would have
    # restored the old anchor (X12). Forgotten, there is no anchor to restore: a new patient.
    alerts = _reading(engine, SignalCode.HEART_RATE, 80, minute=1)
    assert alerts == []
    assert engine.state("bed-3").latest(SignalCode.MAP) is None, "the old readings are gone"
    assert engine.recognized_at("bed-3") is None
```

- [ ] **Step 2: Run them, expect failure**

Run: `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_engine_forget.py`
Expected: 3 failed — `AttributeError: 'Engine' object has no attribute 'forget'`.

(If `PatientState.latest(code)` is not the method's name, read `src/homunculus/state/timeline.py` and use the accessor that returns the latest observation or None; `pipeline.py:123` uses `state.latest(SignalCode.SUSPECTED_INFECTION)`. If `PatientProfile` needs more than `patient_id`, read `src/homunculus/state/profile.py` and build the smallest valid one.)

- [ ] **Step 3: Implement**

`state/repository.py`:

```python
class PatientRepository(Protocol):
    def get_or_create(self, patient_id: str) -> PatientState: ...
    def patient_ids(self) -> list[str]: ...
    def remove(self, patient_id: str) -> None: ...


class InMemoryPatientRepository:
    def __init__(self) -> None:
        self._states: dict[str, PatientState] = {}

    def get_or_create(self, patient_id: str) -> PatientState:
        if patient_id not in self._states:
            self._states[patient_id] = PatientState(patient_id)
        return self._states[patient_id]

    def patient_ids(self) -> list[str]:
        return list(self._states)

    def remove(self, patient_id: str) -> None:
        """Forget a patient's readings (G2-A11, D9). Nothing to forget is not an error."""
        self._states.pop(patient_id, None)
```

`pipeline.py`, after `state()` at the end of the class:

```python
    def forget(self, patient_id: str) -> None:
        """Drop everything the engine holds for one patient (G2-A11, D9): readings, the alerts
        of the last evaluation, the antibiotic anchor and a dropped anchor's memory, a held NEWS2
        alert, the NEWS2 judge-at and the charted profile. The API calls it when an admission made
        here is discharged: the number is retired, and a reading that still arrives for it is
        dropped at the door, so nothing would ever end these alerts otherwise. A profile is the
        admission's — a readmission is a new number and a new profile. Idempotent."""
        self._repo.remove(patient_id)
        for mapping in (self._recognized_at, self._dropped_anchor, self._alerts,
                        self._held_news2_alert, self._news2_judged_at, self._profiles):
            mapping.pop(patient_id, None)
```

- [ ] **Step 4: Run the tests, expect pass**

Run the same command. Expected: 3 passed. Then `tests/test_pipeline*.py tests/test_alert_lifecycle.py` (unchanged, green).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/state/repository.py homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_engine_forget.py
git commit -m "feat(engine): the engine forgets a patient — readings, alerts, anchors, held NEWS2, profile (G2-A11 D9)" -- <same paths>
```

---

### Task 2: The store forgets a patient; retire ends the alerts

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/ackstore.py`
- Modify: `homunculus-engine/src/homunculus/api/alert_lifecycle.py`
- Modify: `homunculus-engine/tests/test_alert_lifecycle.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `tests/test_alert_lifecycle.py`; extend the import of `alert_lifecycle` with `DISCHARGED, is_tombstone, retire_patient, retire_state` and add `from homunculus.api.audit import InMemoryAuditLog` and `from homunculus.api.patient_identity import IdentityRecord`)

```python
# ---------------------------------------------------------------- G2-A11: a discharge retires the patient
def test_the_store_forgets_one_patient_and_keeps_the_others():
    store = AckStore()
    for pid in ("bed-3", "bed-4"):
        store.acks[(pid, "news2")] = {"by": "ayse", "at": WALL}
        store.first_seen[(pid, "news2")] = WALL
        store.clock_from[(pid, "news2")] = WALL
        store.escalated.add((pid, "news2"))
        store.paged.add((pid, "news2"))
        store.resolved[(pid, "septic_shock")] = {"alert": {"severity": "critical"}, "resolved_at": WALL, "first_seen": WALL}
        store.recent[(pid, "sepsis")] = Chain(WALL, WALL, True)
    store.forget_patient("bed-3")
    for mapping in (store.acks, store.first_seen, store.clock_from, store.resolved, store.firing, store.recent):
        assert all(k[0] == "bed-4" for k in mapping), mapping
    assert store.escalated == {("bed-4", "news2")} and store.paged == {("bed-4", "news2")}


def test_retire_ends_firing_and_latched_alerts_with_the_discharged_reason():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)         # the critical latches
    assert SHOCK_KEY in store.resolved
    cleared = retire_state(engine, store, "bed-3")
    assert {(c.kind, c.severity, c.reason) for c in cleared} == {
        ("septic_shock", "critical", DISCHARGED), ("sepsis", "high", DISCHARGED),
        ("antibiotic_due", "high", DISCHARGED)}
    assert all(c.first_seen == WALL for c in cleared), "each end carries its episode's first-seen"
    assert "bed-3" not in engine.patient_ids() and engine.active_alerts("bed-3") == []
    assert store.resolved == {} and store.first_seen == {} and store.firing == {}
    assert live_keys(engine, store) == set()


def test_retire_on_a_patient_the_engine_does_not_know_clears_nothing():
    engine, store = Engine(), AckStore()
    assert retire_state(engine, store, "bed-9") == []


def test_retire_patient_writes_one_alert_cleared_row_per_alert():
    engine, store = _shock()
    audit = InMemoryAuditLog()
    at = WALL + timedelta(minutes=5)
    cleared = retire_patient(engine, store, audit, "h1", "bed-3", at)
    rows = audit.records(tenant="h1", event_type="alert_cleared")
    assert {r.subject for r in rows} == {c.kind for c in cleared} == {"septic_shock", "sepsis", "antibiotic_due"}
    assert all(r.payload["reason"] == DISCHARGED and r.payload["at"] == at.isoformat() for r in rows)
    assert all(r.patient_id == "bed-3" for r in rows)


def test_is_tombstone_is_a_discharged_kabul_record_and_nothing_else():
    assert is_tombstone(IdentityRecord("H-1", state="discharged", source="kabul"))
    assert not is_tombstone(IdentityRecord("H-1", state="admitted", source="kabul"))
    assert not is_tombstone(IdentityRecord("20239121", state="discharged", source="comed"))
    assert not is_tombstone(None)
```

- [ ] **Step 2: Run, expect failure** — `ImportError` on the new names.

- [ ] **Step 3: Implement**

`ackstore.py`, after `prune()`:

```python
    def forget_patient(self, patient_id: str) -> None:
        """Drop every entry of one patient — ack, first-seen, clock, escalation, page, latch, the
        hook's last view and any remembered chain (G2-A11, D9). A discharge ends the patient's
        every episode at once (`alert_lifecycle.retire_state`); nothing of them may answer a later
        number, and nothing is left for the escalation cycle to page."""
        for mapping in (self.acks, self.first_seen, self.clock_from, self.resolved, self.firing,
                        self.recent):
            for key in [k for k in mapping if k[0] == patient_id]:
                del mapping[key]
        self.escalated = {k for k in self.escalated if k[0] != patient_id}
        self.paged = {k for k in self.paged if k[0] != patient_id}
```

`alert_lifecycle.py`: add `from homunculus.api.audit import AuditEvent, AuditLog` (`api/audit.py` imports nothing from `alert_lifecycle`), extend the module docstring with one paragraph:

```
* A discharge made here ends every episode of the patient at once (G2-A11, D1): each firing and
  each latched alert is cleared with the reason `discharged`, the store and the engine forget the
  patient, and the ward is told once with a removal frame (app.py). Readings that still arrive
  for the number are dropped at the doors (D3), so nothing else would ever end these alerts.
```

and after `ACKED_AFTER_RESOLVE`:

```python
DISCHARGED = "discharged"                     # the patient was discharged here (G2-A11, D1)

#: The audit row a reading for a discharged number leaves (G2-A11, D3): subject = the signal code,
#: payload {patient_id, code}, no value. How the ward learns a monitor still carries the number.
READING_DROPPED = "reading_dropped_discharged"

#: The identity source of an admission made in Homunculus (Lane B's B1a, `patient_identity.KABUL`
#: on its branch). Here until the merge unifies the two (spec O1).
KABUL_SOURCE = "kabul"


def is_tombstone(record) -> bool:
    """A discharged `kabul` record (G2-A11, D4): the patient left, the record stays so that a
    reading still arriving for the number never brings the patient back. A HIS discharge is not
    one: its card keeps today's 24-hour retention, and its readings are still evaluated."""
    return record is not None and record.state == "discharged" and record.source == KABUL_SOURCE
```

and after `acknowledge_latched`:

```python
def retire_state(engine: Engine, store: AckStore, patient_id: str) -> list[Cleared]:
    """End every episode of a discharged patient and forget the patient (G2-A11, D1): one
    `Cleared` per firing alert and per latched one, each with its episode's first-seen, reason
    `discharged`; then the store and the engine drop the patient. Writes no audit row — the replay
    and the start-up sweep run it as it is; `retire_patient` is the audited door."""
    cleared: list[Cleared] = []
    for alert in engine.active_alerts(patient_id):
        key = (patient_id, alert.kind)
        cleared.append(Cleared(patient_id, alert.kind, alert.severity, store.first_seen.get(key),
                               DISCHARGED))
    for key, entry in [(k, e) for k, e in store.resolved.items() if k[0] == patient_id]:
        seen = store.first_seen.get(key, entry.get("first_seen"))
        cleared.append(Cleared(patient_id, key[1], entry["alert"]["severity"], seen, DISCHARGED))
    store.forget_patient(patient_id)
    engine.forget(patient_id)
    return cleared


def retire_patient(engine: Engine, store: AckStore, audit: AuditLog, hospital: str,
                   patient_id: str, now: datetime) -> list[Cleared]:
    """`retire_state`, audited: an `alert_cleared` row per ended episode, written after the
    in-memory end as the doors write theirs (an audit that fails must not leave the alerts on the
    board). Lane B's discharge path reaches it through `app.state.retire_patient`."""
    cleared = retire_state(engine, store, patient_id)
    for item in cleared:
        audit.append(AuditEvent(hospital, "alert_cleared", item.patient_id, item.kind,
                                item.payload(now)))
    return cleared
```

- [ ] **Step 4: Run** `tests/test_alert_lifecycle.py tests/test_engine_forget.py tests/test_rehydrate.py tests/test_api_ack.py` — all green.

- [ ] **Step 5: Commit** — `feat(api): a discharge retires the patient from the alert world — retire_state/retire_patient, AckStore.forget_patient, is_tombstone (G2-A11 D1, D4, D9)`.

---

### Task 3: The replay applies a `discharged` row

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py`
- Modify: `homunculus-engine/tests/test_rehydrate.py` (append)

- [ ] **Step 1: Failing test** (read the file's helpers first — it builds `AuditEvent` rows and calls `rehydrate(engine, store, records)`; reuse its way of writing an `ingest` row that raises an alert, e.g. the one `test_rehydrate_replays_ingests_into_alerts` uses)

```python
def test_an_alert_cleared_row_with_reason_discharged_retires_the_patient_on_replay():
    """G2-A11 (D7a): the discharge ended the alerts live; the replay ends them at the same point."""
    audit = InMemoryAuditLog()
    <write the same ingest rows the first test writes for "bed-3", so that an alert fires>
    <write the same rows for "bed-4">
    audit.append(AuditEvent("h1", "alert_cleared", "bed-3", "news2",
                            {"first_seen": None, "at": "2026-07-14T11:00:00+00:00",
                             "reason": "discharged", "severity": "moderate"}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="h1", limit=1000))
    assert "bed-3" not in engine.patient_ids() and engine.active_alerts("bed-3") == []
    assert all(k[0] != "bed-3" for k in store.first_seen) and all(k[0] != "bed-3" for k in store.firing)
    assert engine.active_alerts("bed-4"), "the other patient is untouched"


def test_other_alert_cleared_rows_are_still_ignored_by_the_replay():
    audit = InMemoryAuditLog()
    <ingest rows for "bed-3" that raise an alert>
    audit.append(AuditEvent("h1", "alert_cleared", "bed-3", "news2",
                            {"first_seen": None, "at": "2026-07-14T11:00:00+00:00",
                             "reason": "resolved", "severity": "moderate"}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="h1", limit=1000))
    assert engine.active_alerts("bed-3"), "a `resolved` row follows from the readings and is not applied"
```

- [ ] **Step 2: Run, expect the first to fail** (the patient is still there).

- [ ] **Step 3: Implement** — in `rehydrate()`'s branch chain, before the closing comment:

```python
        elif rec.event_type == "alert_cleared" and rec.payload.get("reason") == DISCHARGED:
            # G2-A11 (D7a): a discharge retired the patient live, at this point of the log; the
            # replay retires it here. Every other `alert_cleared` row follows from the rows the
            # replay runs through the hook and stays ignored (D7 of A1).
            retire_state(engine, store, rec.patient_id)
```

Import `DISCHARGED, retire_state` from `alert_lifecycle`; update the module docstring's sentence "The `alert_cleared` rows follow from those and are not replayed." to say: except a row whose reason is `discharged`, which retires the patient as the discharge did.

- [ ] **Step 4: Run** `tests/test_rehydrate.py` — green. **Step 5: Commit** — `feat(api): the replay retires a patient at its discharged alert_cleared row (G2-A11 D7a)`.

---

### Task 4: `chart_observations` — the `/clinical` loop becomes a function (X62)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/clinical.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`/clinical`, lines ~663–707 at `1bc5b34`)
- Tests: `tests/test_api_clinical.py`, `tests/test_api_board_sepsis.py`, `tests/test_rehydrate.py`, `tests/test_api_ack.py` must stay green (pure refactor — no new test)

- [ ] **Step 1: Read** `app.py:638–713` and `clinical.py`'s imports. Check import cycles: `clinical.py` will import `alert_lifecycle` (which imports `ackstore`, `pipeline`, `audit`), `audit`, `notify`, `reco.engine`; none of those imports `clinical`. (`rehydrate` imports both `clinical` and `alert_lifecycle` — fine.)

- [ ] **Step 2: Implement** — in `clinical.py`, after `build_entries`:

```python
def chart_observations(engine: Engine, store: AckStore, audit: AuditLog, notifier: Notifier,
                       hospital: str, patient_id: str, charted: list[ChartedEntry],
                       now: datetime, escalate_after: timedelta) -> list[Alert]:
    """Run charted entries through the engine as the `/clinical` door does, and return the last
    evaluation's alerts (G2-A11, D8 — X62). One function so the admission form can chart through
    it too; the door keeps parsing, the discharged-number drop, the final dedup prune, the frame
    and the answer.

    `now` is the request's one wall-clock instant: each entry is judged at its charted time but
    never past it (G2-A2, X10). After every entry: the lifecycle hook (G2-A1, D4, D7 — charting is
    often what ends an alert), the nurse's dedup re-armed (D5: `[norepinephrine 0, dopamine 5]`
    ends an acknowledged shock and starts a new one inside this loop), the `chart` row and the
    `alert_cleared` rows — the hook before any audit write, so an audit that fails leaves an
    unacknowledged critical on the board. Then the `alert` rows, and a first-seen stamp with its
    row for every firing kind (wall-clock time; audited so a restart keeps the escalation clock;
    a latched kind keeps its episode's stamp and is not stamped anew)."""
    alerts: list[Alert] = []
    for item in charted:
        obs = item.observation
        alerts = engine.ingest(obs, now=min(obs.timestamp, now))
        cleared = sync_alerts(engine, store, obs.patient_id, now)
        notifier.prune(hospital, live_keys(engine, store))
        audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(),
                                 "charted_by": item.charted_by}))
        for ended in cleared:
            audit.append(AuditEvent(hospital, "alert_cleared", ended.patient_id, ended.kind,
                                    ended.payload(now)))
    for a in alerts:
        audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                {"severity": a.severity, "urgency": a.urgency,
                                 "summary": a.summary, "source": a.source,
                                 "evidence": a.supporting_evidence}))
    for a in engine.active_alerts(patient_id):
        if store.stamp_first_seen(patient_id, a.kind, now, chain_gap=escalate_after):
            audit.append(AuditEvent(hospital, "first_seen", patient_id, a.kind,
                                    {"at": now.isoformat()}))
    return alerts
```

Keep the original comments' substance in the docstring (as above) rather than inline; the body is the former `app.py:670–705` with `_audit_cleared` inlined. Imports: `from homunculus.api.ackstore import AckStore`, `from homunculus.api.alert_lifecycle import live_keys, sync_alerts`, `from homunculus.api.audit import AuditEvent, AuditLog`, `from homunculus.api.notify import Notifier`, `from homunculus.pipeline import Engine`, `from homunculus.reco.engine import Alert`, `timedelta` from datetime.

In `app.py`'s `chart`, replace lines 663–707 with:

```python
        engine = _engine(hospital)
        store = _store(hospital)
        # One wall-clock instant per request, as in /ingest (G2-A2, X10); the loop itself is
        # `chart_observations` (G2-A11, D8 — X62), shared with the admission form.
        now = datetime.now(timezone.utc)
        alerts = chart_observations(engine, store, audit, notifier, hospital, patient_id, charted,
                                    now, escalate_after)
        # A kind charting ended has left the live keys: a nurse is told again if it returns (D5).
        notifier.prune(hospital, live_keys(engine, store))
```

followed by the unchanged frame and answer. Import `chart_observations` from `homunculus.api.clinical` (the existing import line of that module).

- [ ] **Step 3: Run** `tests/test_api_clinical.py tests/test_api_board_sepsis.py tests/test_api_board_meds.py tests/test_rehydrate.py tests/test_api_ack.py tests/test_alarm_quality*.py` — all green, counts unchanged. **Step 4: Commit** — `refactor(api): the /clinical loop is chart_observations in api/clinical.py, importable by the admission form (G2-A11 D8, X62)`.

---

### Task 5: The doors drop a discharged number; `/ingest` refuses kabul identities

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`/ingest` ~749–822, `/clinical` after `build_entries`)
- Create: `homunculus-engine/tests/test_api_discharge.py`

- [ ] **Step 1: Failing tests**

```python
# tests/test_api_discharge.py
"""G2-A11: a patient discharged through a Homunculus admission (a `kabul` tombstone in the identity
store) leaves the alert world. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc)


def _obs(code, value, patient, when=WHEN):
    return {"resourceType": "Observation", "status": "final",
            "code": {"coding": [{"system": "http://homunculus.local/obs", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"},
            "effectiveDateTime": when.isoformat(),
            "valueQuantity": {"value": value, "unit": "u"}, "device": {"display": "nce"}}


def _his_patient(patient, source="comed", active=True):
    return {"resourceType": "Patient",
            "identifier": [{"system": "http://homunculus.local/protocol-no", "value": patient}],
            "name": [{"family": "TEST", "given": ["SYNTH"]}],
            "birthDate": "1980-01-15", "gender": "female", "active": active,
            "meta": {"lastUpdated": WHEN.isoformat(), "source": source}}


def _kabul(store, patient, state="admitted"):
    """What Lane B's admission writes: a record whose source is `kabul`; discharged, a tombstone."""
    store.apply("h1", IdentityRecord(patient, family="TEST", given="SYNTH", state=state,
                                     source="kabul", updated_at=WHEN))


@pytest.fixture
def app():
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    application = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit,
                             identities=identities)
    application.state.test_identities = identities
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def _rows(app, event_type, patient=None):
    return app.state.audit.records(tenant="h1", event_type=event_type, patient_id=patient, limit=1000)


class TestAReadingForADischargedNumber:
    def test_is_dropped_before_the_engine_with_one_audit_row(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        queue = app.state.broadcaster.subscribe("h1")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-1"), headers=HEAD)
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        [row] = _rows(app, "reading_dropped_discharged")
        assert row.patient_id == "H-1" and row.subject == "heart_rate"
        assert row.payload == {"patient_id": "H-1", "code": "heart_rate"}
        assert _rows(app, "ingest", "H-1") == [] and _rows(app, "alert", "H-1") == []
        assert queue.empty(), "nothing is published for a dropped reading"
        assert client.get("/alerts/H-1", headers=HEAD).json()["alerts"] == []
        cards = client.get("/patients", headers=HEAD).json()["patients"]
        assert all(c["latest"]["heart_rate"] is None for c in cards if c["patient_id"] == "H-1")

    def test_is_dropped_at_clinical_too_one_row_per_entry(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.post("/clinical/H-1", headers=HEAD, json={"entries": [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.1}],
            "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        assert {row.subject for row in _rows(app, "reading_dropped_discharged")} == {"suspected_infection", "lactate"}
        assert _rows(app, "chart", "H-1") == []

    def test_a_malformed_chart_for_a_discharged_number_is_still_400(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.post("/clinical/H-1", headers=HEAD, json={"entries": [{"code": "nope", "value": 1}]})
        assert r.status_code == 400
        assert _rows(app, "reading_dropped_discharged") == []

    def test_a_his_discharged_patient_is_still_evaluated(self, app, client):
        client.post("/ingest", json=_his_patient("20239121", active=False), headers=HEAD)
        r = client.post("/ingest", json=_obs("heart_rate", 140, "20239121"), headers=HEAD)
        assert r.status_code == 200 and "alerts" in r.json()
        assert len(_rows(app, "ingest", "20239121")) == 1

    def test_an_admitted_kabul_patient_is_evaluated_as_any_other(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)
        assert r.status_code == 200 and [a["kind"] for a in r.json()["alerts"]] == ["news2"]


class TestIdentityResourcesAndKabul:
    def test_an_identity_resource_whose_source_is_kabul_is_refused(self, app, client):
        r = client.post("/ingest", json=_his_patient("H-3", source="kabul"), headers=HEAD)
        assert r.status_code == 400 and "kabul" in r.json()["detail"]
        assert app.state.test_identities.get("h1", "H-3") is None
        assert _rows(app, "identity") == []

    def test_a_his_resource_for_a_kabul_record_is_refused_and_changes_nothing(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        before = app.state.test_identities.get("h1", "H-2")
        r = client.post("/ingest", json=_his_patient("H-2", active=False), headers=HEAD)
        assert r.status_code == 200
        assert r.json() == {"patient_id": "H-2", "identity": "refused", "reason": "kabul"}
        assert app.state.test_identities.get("h1", "H-2") == before
        assert _rows(app, "identity") == []
```

- [ ] **Step 2: Run** `tests/test_api_discharge.py` — the drop and refusal tests fail (200 with `alerts`, 400 absent); the two negatives pass already.

- [ ] **Step 3: Implement** in `app.py`:

Import line 30 becomes `from homunculus.api.alert_lifecycle import (Cleared, DISCHARGED, KABUL_SOURCE, READING_DROPPED, acknowledge_latched, is_tombstone, live_keys, sync_alerts)` (Task 6 adds `retire_patient, retire_state`).

`/ingest`, identity branch, after the `except` clauses and before `identities.apply`:

```python
            # G2-A11 (D5): only the admission writes a `kabul` record. A feed naming that source
            # is refused outright; a feed writing onto a `kabul` record is refused before `apply`,
            # so `_merge`'s None keeps meaning "older" here, and the card below is never built
            # for a discharged admission.
            if incoming.source == KABUL_SOURCE:
                raise HTTPException(status_code=400,
                                    detail="identity source 'kabul' is reserved for the admission")
            existing = identities.get(hospital, incoming.patient_id)
            if existing is not None and existing.source == KABUL_SOURCE:
                return {"patient_id": incoming.patient_id, "identity": "refused", "reason": "kabul"}
```

`/ingest`, observation branch, right after `parse_fhir_observation` and before `engine = _engine(hospital)`:

```python
        # G2-A11 (D3): a reading for a number whose admission here was discharged is dropped
        # before the engine — one audit row, no evaluation, no hook, no stamp, no frame, no
        # notification. The owner's decision (2026-10-26): no alert and no page may come of it.
        # 200, not 4xx: the input is well-formed and the server chose not to apply it, and a
        # per-reading 4xx on a monitor that keeps the old number would read as rejections in the
        # hub's counters. The one identity read a reading costs is reused for the frame below.
        record = identities.get(hospital, obs.patient_id)
        if is_tombstone(record):
            audit.append(AuditEvent(hospital, READING_DROPPED, obs.patient_id, obs.code.value,
                                    {"patient_id": obs.patient_id, "code": obs.code.value}))
            return {"patient_id": obs.patient_id, "dropped": DISCHARGED}
```

and the frame at the end uses `identity=record` instead of `identities.get(hospital, obs.patient_id)`.

`/clinical`, after `build_entries` (a malformed body is 400 first) and before `engine = _engine(hospital)`:

```python
        # G2-A11 (D3): as at /ingest — a discharged admission's number takes no chart either.
        record = identities.get(hospital, patient_id)
        if is_tombstone(record):
            for item in charted:
                code = item.observation.code.value
                audit.append(AuditEvent(hospital, READING_DROPPED, patient_id, code,
                                        {"patient_id": patient_id, "code": code}))
            return {"patient_id": patient_id, "dropped": DISCHARGED}
```

and the frame uses `identity=record`.

- [ ] **Step 4: Run** `tests/test_api_discharge.py tests/test_api_ingest.py tests/test_api_identity_ingest.py tests/test_api_clinical.py tests/test_api_board_identity.py` — green. **Step 5: Commit** — `feat(api): a reading for a discharged admission is dropped at the doors with an audit row; /ingest refuses kabul identities (G2-A11 D3, D5)`.

---

### Task 6: Retire-and-publish, the self-healing cycle, the start-up sweep

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`_ensure` ~251–266, `_audit_cleared` ~276, `_escalation_cycle` ~309–345, `app.state` block ~437)
- Modify: `homunculus-engine/tests/test_api_discharge.py` (append)

- [ ] **Step 1: Failing tests** (append; `wall` is not needed — the cycle takes `now`)

```python
class TestTheDischargeRetiresThePatient:
    def test_retire_ends_the_alerts_audits_them_and_publishes_one_removal(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        client.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)     # news2 fires
        queue = app.state.broadcaster.subscribe("h1")
        _kabul(app.state.test_identities, "H-2", state="discharged")                   # Lane B's tombstone write
        cleared = client.portal.call(app.state.retire_patient, "h1", "H-2")
        assert [(c.kind, c.reason) for c in cleared] == [("news2", "discharged")]
        [row] = _rows(app, "alert_cleared", "H-2")
        assert row.subject == "news2" and row.payload["reason"] == "discharged"
        frame = queue.get_nowait()
        assert frame["patient_id"] == "H-2" and frame["removed"] is True
        assert queue.empty(), "exactly one frame"
        assert client.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
        assert all(c["latest"]["heart_rate"] is None
                   for c in client.get("/patients", headers=HEAD).json()["patients"] if c["patient_id"] == "H-2")

    def test_retire_publishes_the_frame_it_is_given(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.retire_patient, "h1", "H-2", {"patient_id": "H-2", "removed": True, "identity": {"unit_id": "u-1"}})
        assert queue.get_nowait()["identity"] == {"unit_id": "u-1"}

    def test_the_escalation_cycle_retires_an_alerting_tombstone_instead_of_paging(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        client.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)
        _kabul(app.state.test_identities, "H-2", state="discharged")      # the retire call never came
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, WHEN + timedelta(minutes=30))
        assert _rows(app, "escalation", "H-2") == [] and _rows(app, "notification", "H-2") == []
        [row] = _rows(app, "alert_cleared", "H-2")
        assert row.payload["reason"] == "discharged"
        assert queue.get_nowait()["removed"] is True
        assert client.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
        # a second cycle finds nothing to retire and writes nothing
        client.portal.call(app.state.escalation_cycle, WHEN + timedelta(minutes=31))
        assert len(_rows(app, "alert_cleared", "H-2")) == 1

    def test_a_restart_retires_an_engine_patient_whose_identity_is_a_tombstone(self):
        """G2-A11 (D7b): the audit rows of a discharge were never written (a crash between the
        tombstone write and the retire call); the restart still agrees with the identity store."""
        audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
        first = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
        with TestClient(first) as c:
            _kabul(identities, "H-2")
            c.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)
            _kabul(identities, "H-2", state="discharged")
        second = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
        with TestClient(second) as c:
            assert c.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
            assert all(card["latest"]["heart_rate"] is None
                       for card in c.get("/patients", headers=HEAD).json()["patients"] if card["patient_id"] == "H-2")
            assert audit.records(tenant="h1", event_type="alert_cleared", limit=100) == [], "the replay writes nothing"
```

- [ ] **Step 2: Run** — the four fail (`app.state.retire_patient` missing; the cycle pages; the restart keeps the alert).

- [ ] **Step 3: Implement**

`_ensure`, after `rehydrate(...)` and before `engines[hospital] = engine`:

```python
        # G2-A11 (D7b): the restart agrees with the identity store. A patient whose admission here
        # was discharged is retired, whether or not the discharge's rows were written (a crash
        # between the tombstone write and the retire call; an audit that failed after the
        # in-memory retire). The replay writes nothing, so neither does this.
        for pid in engine.patient_ids():
            if is_tombstone(identities.get(hospital, pid)):
                retire_state(engine, store, pid)
```

After `_audit_cleared`:

```python
    async def retire_and_publish(hospital: str, patient_id: str, frame: dict | None = None,
                                 now: datetime | None = None) -> list[Cleared]:
        """G2-A11 (D1, D2): a discharge made here retires the patient from the alert world — every
        episode ended with an `alert_cleared` row (reason `discharged`), the store and the engine
        forget the patient, the nurse's dedup is re-armed — and the ward is told once, with
        `frame` (Lane B's tombstone board) or the minimal removal the retention sweep sends.
        Lane B's discharge path calls it through `app.state.retire_patient`, after the identity
        store's tombstone write; the escalation cycle calls it for a tombstone whose call never
        came (D6)."""
        engine, store = _engine(hospital), _store(hospital)
        cleared = retire_patient(engine, store, audit, hospital, patient_id,
                                 now or datetime.now(timezone.utc))
        notifier.prune(hospital, live_keys(engine, store))
        await broadcaster.publish(hospital, frame if frame is not None else
                                  {"patient_id": patient_id, "removed": True, "identity": None})
        return cleared
```

`_escalation_cycle`, right after `alerts = [...]`:

```python
            # G2-A11 (D6): an alerting patient whose admission here was discharged is retired,
            # not escalated — the guard for a discharge whose retire call never came. Read only
            # for patients with a firing alert: one identity read per alerting patient, not per bed.
            gone = {pid for pid in {p for p, _a in alerts}
                    if is_tombstone(identities.get(hospital, pid))}
            for pid in sorted(gone):
                await retire_and_publish(hospital, pid, now=now)
            alerts = [(pid, a) for pid, a in alerts if pid not in gone]
```

`app.state` block: `app.state.retire_patient = retire_and_publish`. Extend the `alert_lifecycle` import with `retire_patient, retire_state`.

- [ ] **Step 4: Run** `tests/test_api_discharge.py tests/test_api_ack.py tests/test_api_identity_ingest.py tests/test_rehydrate.py tests/test_escalation_chain.py tests/test_api_notifications.py` — green; then the full no-DB gate.
- [ ] **Step 5: Commit** — `feat(api): retire_and_publish on app.state; the escalation cycle retires an alerting tombstone; the restart sweeps the engine against the identity store (G2-A11 D1, D2, D6, D7b)`.

---

### Task 7: Docs

**Files:**
- Modify: `homunculus-engine/README.md` — the alert-episodes material around lines 960–980 (`alert_cleared`, G2-A1, X13): one new numbered point (Turkish, the file's register): a Homunculus admission's discharge retires the patient (every alert closes with `alert_cleared` reason `discharged`, the number's later readings are dropped at `/ingest` and `/clinical` with a `reading_dropped_discharged` row, the escalation cycle never pages for it, a restart agrees with the identity store); `/ingest`'s answers for identity resources (`kabul` source → 400; a HIS message for a kabul record → `identity: refused`).
- Modify: `docs/homunculus-rehber-TR.md` — in the alarm section (grep `G2-A1`, lines ~575–590 and ~1004): two sentences for the clinician: a patient discharged from the kabul screen leaves every panel at once, its alarms close as «taburcu», and a monitor still sending for that number raises nothing — the audit shows the dropped readings.
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — a `G2-A11` row after `G2-A2`, in the table's format (read the G2-A2 row first): slice, branch `feat/g2a-a11`, spec, plan, status «kodda, main'e alınmadı», deploy «B1a ile birlikte kararlaştırılır».

- [ ] Keep CRLF. No test. Commit — `docs: G2-A11 taburcu kancaları in the README, the Turkish guide and the roadmap`.

---

### Task 8: Final review and fold (controller)

- Final whole-branch review (opus): spec compliance D1–D9, the tests of §6, no PHI, CRLF, comments.
- Full no-DB gate; `tests/test_api_persistence.py` and the Postgres suites are untouched (no DB schema change).
- Plan fold: departures table (X…), open items (O…), counts; push `feat/g2a-a11`; tell Lane B the sha; the merge waits for the user's word.

## Departures

| # | Where | What | Why |
|---|---|---|---|
| X1 | Task 4 | `chart_observations` takes `patient_id` explicitly (the spec's D8 signature lacked it; spec amended) | the first-seen loop stamps the route's patient, which an empty `charted` list cannot name |
| X2 | Task 6 tests | `/alerts/{id}` after a retire answers an empty list, not 404 (the spec §6 said 404) | the handler never 404s for a patient the engine does not know; the board has no card with readings, which is the observable fact |

## Open items

- O1–O3: see the spec §8.
