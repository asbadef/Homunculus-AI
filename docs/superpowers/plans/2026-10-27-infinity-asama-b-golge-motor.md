# Infinity · Aşama B — the shadow engine: monitor values reach the rules, every alarm stays off — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `INFINITY_CLINICAL_STAGE=rules`, one monitor sample per minute per allowed parameter reaches a **second** engine per hospital — the shadow engine — whose findings the ward sees as «gölge öneri · alarm kapalı» on the patient screen, the bed card and a 7-day list in Settings, while every clinical output of the real engine stays byte-identical to the stage `off`.

**Architecture:** `api/infinity_rules.py` is the lane's bridge: `pick` (which monitor cell feeds which engine code, with the ART→NBP and HR→PLS priority), `Sampler` (the 60 s clock per patient and code), `ShadowLane` (the shadow engines, the mirror of every clinical write, the samples, the `shadow_alert` audit rows, the findings with their relation to the real alerts). Samples persist in `monitor_samples` (migration 0013, 30 days); the shadow engine is rebuilt at start-up as a deep copy of the real engine plus the last 24 h of samples. The board gains one key, `shadow`; the dashboard draws it; the gate tests of Aşama A run a third time with the stage `rules`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy + Alembic (0013), pytest; React 18 + Vite + Vitest, four languages (az default, tr source, ru, en).

**Spec:** `docs/superpowers/specs/2026-10-27-infinity-asama-b-golge-motor-design.md` (decisions D1–D13, departures V1–V3, open items O1–O5). **Branch:** `feat/infinity-asama-b` at `/c/tmp/inf-b`, off `main` `377033f`. **Starts after** Lane B's B1a is on `main` (Task 0 merges it). Code references were read at `377033f`.

---

## Read this before Task 1

**What exists (at `377033f`).**
- `api/infinity_shadow.py`: `ShadowSettings` (stage `off|shadow`, `IMPLEMENTED = ("off", "shadow")`), `shadow_settings_from_env`, `ShadowStore` (`devices(now) -> dict[str, DeviceView]`, `feed(now)`), `DeviceView(source, group, port, status, status_age_s, packet_age_ms, parameters)` where each parameter dict is `{"parameter", "state": "value"|"invalid"|"old", "value", "unit", "age_s", "last_at", "evidence", "partial"}` and NBP's is the folded entry `{"parameter": "nbp", "state", "systolic", "diastolic", "mean", "unit", "age_s", "last_at", "changed_at", "measured_age_s", ...}`; `board_view(devices, feed, table, *, occupants, visible, patient_visible, show_unassigned, now)` builds the bed cards with `link: "one"` and `patient_id`.
- `api/app.py`: `create_app(..., shadow=ShadowSettings|None, shadow_clock, shadow_monotonic)`; `_ensure(hospital)` builds and rehydrates the real engine (`rehydrate(engine, store, iter_records(audit, tenant=hospital, page=REHYDRATE_PAGE))`, then retires tombstones); `_engine`, `_store`; `_occupants(hospital, now)` (bed id → admitted patient ids, cached 10 s; Lane B's B1a adds the `kabul` branch); `POST /infinity-shadow/readings` (the lane's token, `shadow_store.ingest`); `GET /infinity-shadow/board`; the clinical doors: `POST /ingest` (observation branch at ~`:810-862`, calls `engine.ingest(obs, now=min(obs.timestamp, wall_now))`), `POST /clinical/{patient_id}` (→ `chart_observations` in `api/clinical.py:196`), `PUT /clinical/{patient_id}/profile` (`engine.set_profile(profile)` at ~`:757`), `retire_and_publish` (→ `retire_patient` in `api/alert_lifecycle.py`, which calls `engine.forget`); `patient_board(...)` is called 9 times in `app.py`; the lifespan starts `_escalation_loop`.
- `api/board.py`: `patient_board(engine, patient_id, store, identity=None, bedmap=None, now=None) -> dict` with keys `patient_id, identity, risk, alerts, latest{..., news2, at, sofa}, sepsis, meds`; `_news2(state, now)`; `_PUBLISHED_SIGNALS`; `board_snapshot(engine, store, identities, hospital, bedmap, now)`.
- `pipeline.Engine`: `ingest(obs, now) -> list[Alert]`, `active_alerts(pid)`, `state(pid)`, `patient_ids()`, `forget(pid)`, `set_profile(profile)`, `profile(pid)`; private per-patient memory `_alerts`, `_recognized_at`, `_dropped_anchor`, `_held_news2_alert`, `_news2_judged_at`, `_profiles`, `_repo` (`InMemoryPatientRepository`: `_states`), `_scorer` (None unless a model is loaded).
- `state/timeline.PatientState`: `_history: dict[SignalCode, list[Observation]]`, `ingest`, `latest`, `history`, `window`, `sum_since`.
- `canonical.Observation(patient_id, code, value, unit, timestamp, source_device)`; `SignalCode.HEART_RATE/SBP/MAP/SPO2`.
- `reco.engine.Alert(patient_id, kind, severity, urgency, summary, clinical_reasoning, supporting_evidence, recommended_actions, confidence, source, downgraded, chronic_context, stale_inputs)`.
- `api/audit.py`: `AuditEvent(tenant, event_type, patient_id, subject, payload)`, `AuditLog.append/records(tenant=, patient_id=, event_type=, since=, limit=, newest=)`.
- `api/audit_postgres.PostgresAuditLog(url)` holds a sync SQLAlchemy engine (`self._engine`, `to_sync_url`); migrations in `homunculus-engine/alembic/versions/NNNN_*.py` (0011 is the newest released; **0012 is Lane B's**, unreleased).
- Gate tests: `tests/test_infinity_shadow_equivalence.py` (`_run(monkeypatch, tmp_path, *, stage, extra_ingest, probe)` builds an app with `ShadowSettings` and spies the broadcaster and the hub; compares every clinical output of two runs), `tests/test_infinity_shadow_isolation.py` (`FORBIDDEN` imports for the lane's modules; `test_rules_and_alarms_behave_as_off` parametrised over `rules`, `alarms`).
- Dashboard: `src/liveAdapters.js` `patientFromBoard(entry)` (maps `latest.*` to `vitals`, `measuredAt`, `news2`); `screens/common/vitals.js` `VITALS`/`measuredVitals`; `screens/patient/PatientScreen.jsx` (`Vitals`, the `MonitorStrip` for a linked patient, `Finding`, the boxes); `screens/beds/BedCard.jsx` (the strip slot at the card's foot); `screens/settings/SettingsScreen.jsx` (`Box`, `KVList`, tabs); `i18n/strings/*.js` (`tr/az/ru/en` blocks; `strings.test.js` placeholder parity, `AZ_SAME_AS_TR`, `NEUTRAL`); `ui/index.js` exports `Box, Note, Tag, Pill, StatusPill, KV, KVList, Table`.
- Deploy: `deploy/local/docker-compose.yml:75-78` passes the four `INFINITY_*` variables; `.env.example:132-153` explains them; `tests/test_local_compose_env.py:35` pins the set; `deploy/infinity/README.md` has the stage and rollback sections.

**Ground rules (the house rules, every task).**
- TDD: the failing test first, then the code. Gates in the foreground: engine `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files>` from `homunculus-engine/`; dashboard `npx vitest run <files>` from `dashboard/`; `npx vite build` at the end.
- Never run `tests/test_infinity_vm_pilot.py`. Never export `DATABASE_URL`; a DB test takes `TEST_DATABASE_URL` on the command line only, and its database name must contain `test`.
- CRLF: every touched file keeps its line endings (check `CR == LF` counts after a write). No PHI anywhere: tests use `bed-1`-style ids and synthetic values.
- Commit each task with a pathspec, message in the house style, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Push the branch; never merge to `main`.
- The lane never fails a clinical request: every call into it from a door is wrapped by `ShadowLane.guard(...)` (Task 4), which logs once per change of state and swallows.
- Nothing here changes `edge/` (the hub) or the worker.

**Vocabulary.** *Real engine* = `engines[hospital]` as today. *Shadow engine* = `lane.engines[hospital]`. *Sample* = one `Observation` made from a monitor cell. *Finding* = an `Alert` of the shadow engine. *Relation* = `same | shadow_only | level_differs` (spec D6).

---

## File map

| File | Task | Change |
|---|---|---|
| `homunculus-engine/src/homunculus/api/infinity_rules.py` | 1, 4 | new: `RulesSettings`, `rules_from_env`, `pick`, `Sampler`, `ShadowLane` |
| `homunculus-engine/src/homunculus/api/infinity_shadow.py` | 1 | `IMPLEMENTED` gains `rules`; `ShadowSettings.rules`; the allowlist problem code |
| `homunculus-engine/src/homunculus/state/timeline.py` | 2 | `PatientState.drop_source(prefix, before=None)` |
| `homunculus-engine/src/homunculus/pipeline.py` | 2 | `Engine.adopt(other, patient_id)`, `Engine.copy()` |
| `homunculus-engine/src/homunculus/api/monitor_samples.py` | 3 | new: `Sample`, `InMemorySamples`, `PostgresSamples` |
| `homunculus-engine/alembic/versions/0013_monitor_samples.py` | 3 | new |
| `homunculus-engine/src/homunculus/api/board.py` | 5 | `patient_board(..., shadow=None)` → the `shadow` key |
| `homunculus-engine/src/homunculus/api/app.py` | 6 | wiring: settings, mirror, sampler, restart, findings route, prune task, `feed.rules_state` |
| `homunculus-engine/src/homunculus/api/prodserver.py` | 6 | `samples=` from `DATABASE_URL`, `rules=` from the environment |
| `homunculus-engine/src/homunculus/db.py`, `api/audit_postgres.py`, `api/patient_identity_postgres.py` | 8 | `hide_parameters=True` |
| `homunculus-engine/tests/test_infinity_rules.py` | 1, 4 | new |
| `homunculus-engine/tests/test_engine_adopt.py` | 2 | new |
| `homunculus-engine/tests/test_monitor_samples.py` | 3 | new (in-memory always; Postgres under `requires_db`) |
| `homunculus-engine/tests/test_api_board_shadow.py` | 5, 6 | new |
| `homunculus-engine/tests/test_api_shadow_findings.py` | 6 | new |
| `homunculus-engine/tests/test_infinity_shadow_equivalence.py`, `test_infinity_shadow_isolation.py` | 7 | the third run; `rules` is on; `infinity_rules.py`'s own forbidden set |
| `homunculus-engine/tests/test_db_hide_parameters.py` | 8 | new |
| `dashboard/src/liveAdapters.js`, `liveAdapters.test.js` | 9 | `shadow` on the patient |
| `dashboard/src/live/i18n/strings/shadow.js` (new), `strings/index.js`, `strings.test.js` | 9 | the words, four languages |
| `dashboard/src/live/screens/patient/shadow/ShadowFindingsBox.jsx` + test | 9 | new |
| `dashboard/src/live/screens/patient/PatientScreen.jsx` + test, `screens/common/vitals.js` | 10 | the vitals tag, the box |
| `dashboard/src/live/screens/beds/BedCard.jsx` + test | 10 | the amber tag |
| `dashboard/src/live/screens/settings/SettingsScreen.jsx` + test, `data/shadowStore.js` | 10 | «Uyarsaydı — son 7 gün» |
| `deploy/local/docker-compose.yml`, `.env.example`, `tests/test_local_compose_env.py` | 11 | `INFINITY_RULES_PARAMETERS` |
| `deploy/infinity/README.md`, `docs/homunculus-rehber-TR.md`, the roadmap | 11 | the stage, the words for the ward, the row |

---

### Task 0: Baseline

- [ ] **Step 1: Wait for B1a, then merge main.** When Lane B says B1a is on `main`: `cd /c/tmp/inf-b && git fetch origin && git merge --no-edit origin/main`. Resolve nothing by hand without reading both sides; the spec expects `_occupants` with the `kabul` branch and migration 0012 present. Confirm: `ls homunculus-engine/alembic/versions | tail -2` shows `0012_*`.
- [ ] **Step 2: Gates green at the baseline.** Engine: `python -m pytest -p no:cacheprovider -q tests` (no DB; record the counts). Dashboard: `npx vitest run` (record files/tests). Both numbers go into the plan's fold at the end.
- [ ] **Step 3: Commit nothing.** The baseline is the merge commit.

---

### Task 1: The stage `rules`, the allowlist, and `pick`

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/infinity_shadow.py:29-83`
- Create: `homunculus-engine/src/homunculus/api/infinity_rules.py`
- Test: `homunculus-engine/tests/test_infinity_rules.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Aşama B's bridge: which monitor cell feeds which engine code (spec D2, D3), and the stage."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_rules import (
    DEFAULT_PARAMETERS, Candidate, RulesSettings, pick, rules_from_env,
)
from homunculus.api.infinity_shadow import DeviceView, shadow_settings_from_env
from homunculus.canonical import SignalCode

SHADOW = "s" * 40
HOSPITAL = "h1"
ENV = {"INFINITY_CLINICAL_STAGE": "rules", "INFINITY_SHADOW_TOKEN": SHADOW,
       "INFINITY_SHADOW_HOSPITAL": HOSPITAL, "INFINITY_DEVICE_BEDS_PATH": "/dev/null"}
T0 = 1_800_000_000.0


def _cell(name, state="value", value=80.0, unit="bpm", age=2.0, **extra):
    at = datetime.fromtimestamp(T0 - age, timezone.utc).isoformat()
    return {"parameter": name, "state": state, "value": value if state == "value" else None,
            "unit": unit, "age_s": age, "last_at": at, "evidence": "screen_match", "partial": False, **extra}


def _nbp(state="value", sys=120, dia=70, mean=87, measured_age=600.0, age=2.0):
    changed = datetime.fromtimestamp(T0 - measured_age, timezone.utc).isoformat()
    at = datetime.fromtimestamp(T0 - age, timezone.utc).isoformat()
    return {"parameter": "nbp", "state": state, "systolic": sys if state == "value" else None,
            "diastolic": dia if state == "value" else None, "mean": mean if state == "value" else None,
            "unit": "mmHg", "age_s": age, "last_at": at, "changed_at": changed,
            "measured_age_s": measured_age, "evidence": "screen_match", "partial": False}


def _view(*params):
    return DeviceView("10.0.0.5", "239.0.0.1", 2050, "streaming", 1.0, 100.0, tuple(params))


def test_the_stage_rules_is_implemented_and_shadow_is_still_shadow():
    settings = shadow_settings_from_env(ENV, {"d": HOSPITAL})
    assert settings.stage == "rules" and settings.on and settings.rules
    plain = shadow_settings_from_env({**ENV, "INFINITY_CLINICAL_STAGE": "shadow"}, {"d": HOSPITAL})
    assert plain.stage == "shadow" and plain.on and not plain.rules
    off = shadow_settings_from_env({**ENV, "INFINITY_CLINICAL_STAGE": "alarms"}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "stage_not_implemented"


def test_the_allowlist_defaults_and_refuses_an_unknown_name():
    assert rules_from_env({}).allowed == DEFAULT_PARAMETERS
    assert rules_from_env({"INFINITY_RULES_PARAMETERS": " hr, spo2 "}).allowed == ("hr", "spo2")
    with pytest.raises(ValueError, match="parameters_unknown"):
        rules_from_env({"INFINITY_RULES_PARAMETERS": "hr,respirations"})
    off = shadow_settings_from_env({**ENV, "INFINITY_RULES_PARAMETERS": "hr,bogus"}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "parameters_unknown"


def test_pick_hr_feeds_pulse_and_pls_only_when_hr_is_not_a_value():
    both = pick(_view(_cell("hr", value=88), _cell("pls", value=90)), DEFAULT_PARAMETERS, now=T0)
    assert [(c.code, c.value, c.via) for c in both] == [(SignalCode.HEART_RATE, 88.0, "hr")]
    pls = pick(_view(_cell("hr", state="invalid"), _cell("pls", value=90)), DEFAULT_PARAMETERS, now=T0)
    assert [(c.code, c.value, c.via) for c in pls] == [(SignalCode.HEART_RATE, 90.0, "pls")]
    assert pick(_view(_cell("hr", state="old"), _cell("pls", state="old")), DEFAULT_PARAMETERS, now=T0) == []


def test_pick_art_feeds_sbp_and_map_and_nbp_only_without_art_and_within_an_hour():
    art = pick(_view(_cell("art_systolic", value=130, unit="mmHg"), _cell("art_mean", value=95, unit="mmHg"),
                     _nbp(sys=110, mean=80)), DEFAULT_PARAMETERS, now=T0)
    assert {(c.code, c.value, c.via) for c in art} == {(SignalCode.SBP, 130.0, "art"), (SignalCode.MAP, 95.0, "art")}
    nbp = pick(_view(_cell("art_systolic", state="invalid", unit="mmHg"), _nbp(sys=110, mean=80, measured_age=3000)),
               DEFAULT_PARAMETERS, now=T0)
    assert {(c.code, c.value, c.via) for c in nbp} == {(SignalCode.SBP, 110.0, "nbp"), (SignalCode.MAP, 80.0, "nbp")}
    # NBP is stamped at the time its value last CHANGED, an upper bound of the cuff's time (D3).
    assert all(c.stamp == T0 - 3000 for c in nbp)
    too_old = pick(_view(_nbp(sys=110, mean=80, measured_age=3601)), DEFAULT_PARAMETERS, now=T0)
    assert too_old == []
    assert pick(_view(_nbp(state="invalid")), DEFAULT_PARAMETERS, now=T0) == []


def test_pick_honours_the_allowlist_and_the_units():
    only_spo2 = pick(_view(_cell("hr"), _cell("spo2", value=97, unit="%")), ("spo2",), now=T0)
    assert [(c.code, c.value, c.unit, c.via) for c in only_spo2] == [(SignalCode.SPO2, 97.0, "%", "spo2")]
    # RESP and temperature never feed, even when a misconfigured allowlist names them: the engine
    # mapping has no row for them (D2), and a name with no row is `parameters_unknown` upstream.
    assert pick(_view(_cell("respiration", unit="/min"), _cell("temperature", unit="C")), DEFAULT_PARAMETERS, now=T0) == []
    # A wire unit the engine does not expect feeds nothing (fed values carry the lane's units).
    assert pick(_view(_cell("hr", unit="/min")), DEFAULT_PARAMETERS, now=T0) == []


def test_a_candidate_is_stamped_at_the_cell_time_and_named_by_its_source():
    [c] = pick(_view(_cell("spo2", value=97, unit="%", age=4.0)), DEFAULT_PARAMETERS, now=T0)
    assert c.stamp == T0 - 4.0 and c.source == "10.0.0.5" and c.source_device == "infinity:10.0.0.5:spo2"
```

- [ ] **Step 2: Run them to see them fail** — `python -m pytest -p no:cacheprovider -q tests/test_infinity_rules.py` → `ImportError` (no `infinity_rules`), then attribute errors.

- [ ] **Step 3: The stage switch and the allowlist problem in `infinity_shadow.py`**

Replace lines 29–31 and the `ShadowSettings` class and `shadow_settings_from_env`:

```python
STAGES = ("off", "shadow", "rules", "alarms")   # the design's switch (§5)
IMPLEMENTED = ("off", "shadow", "rules")        # Aşama A and Aşama B; `alarms` is C
MIN_TOKEN = 32
DEFAULT_TABLE_PATH = "/etc/homunculus/infinity-shadow/device-beds.json"


@dataclass(frozen=True)
class ShadowSettings:
    stage: str = "off"                 # what runs: "off", "shadow" or "rules"
    configured: str = "off"            # what the environment asked for
    problem: str | None = None
    token: str = field(default="", repr=False)
    hospital: str = ""
    table_path: str = DEFAULT_TABLE_PATH
    parameters: tuple[str, ...] = ()   # Aşama B's allowlist (api/infinity_rules.py); () below `rules`

    def __post_init__(self) -> None:
        # compare_digest(b"", b"") is True: an "on" lane with an empty or short token would take a
        # POST carrying no credential. The env reader never builds one; nothing else may either.
        if self.stage in ("shadow", "rules") and len(self.token) < MIN_TOKEN:
            raise ValueError("a shadow stage needs a token of at least 32 characters")

    @property
    def on(self) -> bool:
        """The strip runs: Aşama A, or Aşama B which contains it."""
        return self.stage in ("shadow", "rules")

    @property
    def rules(self) -> bool:
        """Aşama B: the sampler, the mirror, the shadow board key and the findings route run."""
        return self.stage == "rules"


def shadow_settings_from_env(env: Mapping[str, str], tenants: Mapping[str, str]) -> ShadowSettings:
    configured = (env.get("INFINITY_CLINICAL_STAGE", "") or "").strip().lower() or "off"
    table_path = (env.get("INFINITY_DEVICE_BEDS_PATH", "") or "").strip() or DEFAULT_TABLE_PATH
    token = (env.get("INFINITY_SHADOW_TOKEN", "") or "").strip()
    hospital = (env.get("INFINITY_SHADOW_HOSPITAL", "") or "").strip()
    viewer = (env.get("INFINITY_VIEWER_TOKEN", "") or "").strip()

    def off(problem: str | None) -> ShadowSettings:
        if problem:
            # Names the stage and the problem, never a token.
            log.error("INFINITY_CLINICAL_STAGE=%s çalıştırılamıyor (%s); aşama off olarak çalışıyor",
                      configured, problem)
        return ShadowSettings("off", configured, problem, table_path=table_path)

    if configured == "off":
        return off(None)
    if configured not in STAGES:
        return off("stage_unknown")
    if configured not in IMPLEMENTED:
        return off("stage_not_implemented")
    if not token:
        return off("token_missing")
    if len(token) < MIN_TOKEN:
        return off("token_weak")
    if token in tenants or (viewer and token == viewer):
        return off("token_reused")
    if not hospital or hospital not in set(tenants.values()):
        return off("hospital_missing")
    parameters: tuple[str, ...] = ()
    if configured == "rules":
        # Imported here, not at the top: infinity_rules imports the engine, and this module must
        # keep importing nothing clinical (tests/test_infinity_shadow_isolation.py).
        from homunculus.api.infinity_rules import rules_from_env
        try:
            parameters = rules_from_env(env).allowed
        except ValueError as exc:
            return off(str(exc))
    return ShadowSettings(configured, configured, None, token, hospital, table_path, parameters)
```

- [ ] **Step 4: `infinity_rules.py` — the settings and `pick`**

```python
"""Aşama B: the bridge from the monitor strip to the SHADOW engine (spec 2026-10-27, D1–D5).

What this module is: the only code that turns a monitor cell into an `Observation`, and the only
code that feeds the shadow engine. What it is not: a path to the real engine. It imports the
engine's classes to drive a second instance of them; it never imports the notifier, the ack
store, the alert lifecycle or the alarm-quality counters (tests/test_infinity_shadow_isolation.py
holds it to that), and the real engine is handed to it read-only, for copying.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone

from homunculus.api.infinity_shadow import DeviceView, PARAMETERS
from homunculus.canonical import Observation, SignalCode

log = logging.getLogger(__name__)

SAMPLE_INTERVAL_S = 60.0            # D4: one sample per (patient, code) per minute
NBP_MAX_FOR_RULES_S = 3600.0        # D3: an NBP measured more than an hour ago feeds nothing
REPLAY_HOURS = 24                   # D9: what the shadow engine is rebuilt from at start-up
DEFAULT_PARAMETERS = ("hr", "pls", "spo2", "art_systolic", "art_mean", "nbp")   # D2 (S1)
SOURCE_PREFIX = "infinity:"
# Engine code -> the monitor cells that may feed it, in priority order (D3): the first cell that
# is a value wins; the rest are ignored for that sample. Names not here (respiration,
# temperature, art_diastolic, etco2) never feed, whatever the allowlist says.
FEEDS: dict[SignalCode, tuple[str, ...]] = {
    SignalCode.HEART_RATE: ("hr", "pls"),
    SignalCode.SPO2: ("spo2",),
    SignalCode.SBP: ("art_systolic", "nbp"),
    SignalCode.MAP: ("art_mean", "nbp"),
}
# The unit the engine's rules read for each code (rules/news2.py, rules/septic_shock.py read the
# raw number; the unit travels for the audit and the card). A wire unit that is not this one
# feeds nothing: the lane never converts.
ENGINE_UNIT: dict[SignalCode, str] = {
    SignalCode.HEART_RATE: "bpm", SignalCode.SPO2: "%", SignalCode.SBP: "mmHg", SignalCode.MAP: "mmHg",
}
_NBP_FIELD = {SignalCode.SBP: "systolic", SignalCode.MAP: "mean"}
_VIA = {"hr": "hr", "pls": "pls", "spo2": "spo2", "art_systolic": "art", "art_mean": "art", "nbp": "nbp"}
# Every name the allowlist may hold: the strip's parameters, NBP as one name.
ALLOWED_NAMES = frozenset(set(PARAMETERS) - {"nbp_systolic", "nbp_diastolic", "nbp_mean"}) | {"nbp"}


@dataclass(frozen=True)
class RulesSettings:
    allowed: tuple[str, ...] = DEFAULT_PARAMETERS


def rules_from_env(env: Mapping[str, str]) -> RulesSettings:
    """`INFINITY_RULES_PARAMETERS`: comma-separated strip parameter names; empty is the default
    list. A name that is not a strip parameter is `ValueError("parameters_unknown")` — the caller
    turns the stage off with that problem code rather than guessing."""
    raw = (env.get("INFINITY_RULES_PARAMETERS", "") or "").strip()
    if not raw:
        return RulesSettings()
    names = tuple(dict.fromkeys(n.strip().lower() for n in raw.split(",") if n.strip()))
    if any(n not in ALLOWED_NAMES for n in names):
        raise ValueError("parameters_unknown")
    return RulesSettings(names)


@dataclass(frozen=True)
class Candidate:
    """One monitor cell that may feed one engine code now."""
    code: SignalCode
    value: float
    unit: str
    stamp: float            # epoch seconds: the cell's `last_at`, or NBP's `changed_at`
    source: str             # the device's address
    via: str                # hr | pls | spo2 | art | nbp — what the card shows

    @property
    def source_device(self) -> str:
        return f"{SOURCE_PREFIX}{self.source}:{self.via}"

    def observation(self, patient_id: str) -> Observation:
        return Observation(patient_id, self.code, float(self.value), self.unit,
                           datetime.fromtimestamp(self.stamp, timezone.utc), self.source_device)


def _epoch(iso: str | None) -> float | None:
    if not iso:
        return None
    return datetime.fromisoformat(iso).timestamp()


def pick(view: DeviceView, allowed: tuple[str, ...], *, now: float) -> list[Candidate]:
    """The candidates one device offers now, one per engine code at most (D3). Pure."""
    cells = {p["parameter"]: p for p in view.parameters}
    out: list[Candidate] = []
    for code, names in FEEDS.items():
        for name in names:
            cell = cells.get(name)
            if name not in allowed or cell is None or cell.get("state") != "value":
                continue
            if name == "nbp":
                measured = cell.get("measured_age_s")
                changed = _epoch(cell.get("changed_at"))
                if measured is None or changed is None or measured > NBP_MAX_FOR_RULES_S:
                    continue
                value, stamp = cell.get(_NBP_FIELD[code]), changed
            else:
                value, stamp = cell.get("value"), _epoch(cell.get("last_at"))
            if value is None or stamp is None or cell.get("unit") != ENGINE_UNIT[code]:
                continue
            out.append(Candidate(code, float(value), cell["unit"], stamp, view.source, _VIA[name]))
            break           # the first value in priority order feeds; the others are ignored
    return out
```

- [ ] **Step 5: Run the tests** — all six pass. Also run `tests/test_infinity_shadow.py` and `tests/test_infinity_shadow_isolation.py` (the isolation test still passes: the import of `infinity_rules` is inside the `rules` branch only, and the isolation test's indirect-import check imports the lane with no environment).

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/api/infinity_shadow.py homunculus-engine/src/homunculus/api/infinity_rules.py homunculus-engine/tests/test_infinity_rules.py
git commit -m "feat(infinity): Aşama B — the stage rules, the parameter allowlist and pick(): which monitor cell feeds which engine code (D2, D3)"
```

---

### Task 2: `PatientState.drop_source`, `Engine.adopt` and `Engine.copy`

**Files:**
- Modify: `homunculus-engine/src/homunculus/state/timeline.py:12-50`
- Modify: `homunculus-engine/src/homunculus/pipeline.py` (after `forget`, ~`:275-290`)
- Test: `homunculus-engine/tests/test_engine_adopt.py`

- [ ] **Step 1: Write the failing tests**

```python
"""The shadow engine is a copy of the real one plus monitor samples (spec D5, D9): copying and
un-linking must move exactly the per-patient memory and nothing shared."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.profile import PatientProfile
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def _obs(pid, code, value, at, source="bridge"):
    return Observation(pid, code, value, "u", at, source)


def test_drop_source_removes_only_that_prefix_and_optionally_only_before():
    state = PatientState("bed-1")
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0, "bridge"))
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 80, T0 + timedelta(minutes=1), "infinity:10.0.0.5:hr"))
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 90, T0 + timedelta(minutes=2), "infinity:10.0.0.5:pls"))
    state.ingest(_obs("bed-1", SignalCode.SPO2, 97, T0 + timedelta(minutes=2), "infinity:10.0.0.5:spo2"))
    state.drop_source("infinity:", before=T0 + timedelta(minutes=2))
    assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [70, 90]
    assert state.latest(SignalCode.SPO2).value == 97
    state.drop_source("infinity:")
    assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [70]
    assert state.latest(SignalCode.SPO2) is None and SignalCode.SPO2 not in state._history


def test_copy_is_deep_and_independent():
    real = Engine()
    real.set_profile(PatientProfile(patient_id="bed-1"))
    real.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    shadow.ingest(_obs("bed-1", SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"), now=T0 + timedelta(minutes=1))
    assert real.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 150
    assert shadow.profile("bed-1") is not None and shadow.profile("bed-1") is not real.profile("bed-1")


def test_adopt_replaces_one_patient_from_the_other_engine_and_leaves_the_rest():
    real, shadow = Engine(), Engine()
    for pid in ("bed-1", "bed-2"):
        real.ingest(_obs(pid, SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    for pid in ("bed-1", "bed-2"):
        shadow.ingest(_obs(pid, SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"), now=T0 + timedelta(minutes=1))
    real.ingest(_obs("bed-1", SignalCode.SPO2, 92, T0 + timedelta(minutes=2)), now=T0 + timedelta(minutes=2))
    shadow.adopt(real, "bed-1")
    s1 = shadow.state("bed-1")
    assert s1.latest(SignalCode.HEART_RATE).value == 70 and s1.latest(SignalCode.SPO2).value == 92
    assert shadow.state("bed-2").latest(SignalCode.HEART_RATE).value == 150
    assert real.state("bed-1").latest(SignalCode.SPO2).value == 92      # the real engine is untouched
    assert [a.kind for a in shadow.active_alerts("bed-1")] == [a.kind for a in real.active_alerts("bed-1")]


def test_adopt_of_a_patient_the_other_engine_does_not_know_forgets_it():
    real, shadow = Engine(), Engine()
    shadow.ingest(_obs("bed-9", SignalCode.HEART_RATE, 150, T0, "infinity:x:hr"), now=T0)
    shadow.adopt(real, "bed-9")
    assert "bed-9" not in shadow.patient_ids() and shadow.active_alerts("bed-9") == []
```

- [ ] **Step 2: Run them to see them fail** — `AttributeError: drop_source`, `copy`, `adopt`.

- [ ] **Step 3: `PatientState.drop_source`** (after `ingest` in `timeline.py`)

```python
    def drop_source(self, prefix: str, before: datetime | None = None) -> None:
        """Forget the observations whose `source_device` starts with `prefix` — all of them, or
        only those stamped before `before` (Aşama B, D5 and D9: a monitor's samples leave a
        patient's shadow state when the bed's patient changes, and age out after a day). A code
        left with no observation is removed, so `latest()` answers None as for a code never seen."""
        for code in list(self._history):
            kept = [o for o in self._history[code]
                    if not (o.source_device.startswith(prefix) and (before is None or o.timestamp < before))]
            if kept:
                self._history[code] = kept
            else:
                del self._history[code]
```

- [ ] **Step 4: `Engine.copy` and `Engine.adopt`** (after `forget` in `pipeline.py`)

```python
    def copy(self) -> "Engine":
        """A deep, independent copy: every patient's readings, profile, alerts and the per-patient
        memory (Aşama B, D9 — the shadow engine starts as the real engine's copy). The optional
        model scorer is shared, not copied: it is read-only."""
        import copy as _copy
        twin = Engine()
        twin._repo = _copy.deepcopy(self._repo)
        twin._recognized_at = dict(self._recognized_at)
        twin._dropped_anchor = dict(self._dropped_anchor)
        twin._alerts = _copy.deepcopy(self._alerts)
        twin._held_news2_alert = _copy.deepcopy(self._held_news2_alert)
        twin._news2_judged_at = dict(self._news2_judged_at)
        twin._profiles = _copy.deepcopy(self._profiles)
        twin._scorer = self._scorer
        return twin

    def adopt(self, other: "Engine", patient_id: str) -> None:
        """Replace everything this engine holds for `patient_id` with a deep copy of what `other`
        holds (Aşama B, D5: un-linking a monitor returns the shadow patient to the real one's
        picture). A patient `other` does not know is forgotten here. `other` is read, never
        written."""
        import copy as _copy
        self.forget(patient_id)
        if patient_id not in other.patient_ids():
            return
        self._repo._states[patient_id] = _copy.deepcopy(other._repo.get_or_create(patient_id))  # noqa: SLF001
        for name in ("_recognized_at", "_dropped_anchor", "_alerts", "_held_news2_alert",
                     "_news2_judged_at", "_profiles"):
            theirs = getattr(other, name)
            if patient_id in theirs:
                getattr(self, name)[patient_id] = _copy.deepcopy(theirs[patient_id])
```

`forget` must clear the same six dicts (read it: it does — readings, alerts, anchors, held, judged-at, profile). If `InMemoryPatientRepository` is not the repository (`PatientRepository` protocol), `adopt` needs `_states`; the API only ever builds `Engine()` with the in-memory one, and the docstring says so.

- [ ] **Step 5: Run** `tests/test_engine_adopt.py`, then the engine's existing engine tests (`tests/test_engine_forget.py`, `tests/test_pipeline*.py`) — green.

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/state/timeline.py homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_engine_adopt.py
git commit -m "feat(engine): PatientState.drop_source, Engine.copy and Engine.adopt — what a second engine needs to start as a copy and to un-link one patient (Aşama B, D5, D9)"
```

---

### Task 3: `monitor_samples` — the 30-day table

**Files:**
- Create: `homunculus-engine/src/homunculus/api/monitor_samples.py`
- Create: `homunculus-engine/alembic/versions/0013_monitor_samples.py`
- Test: `homunculus-engine/tests/test_monitor_samples.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Monitor samples: bulk rows that expire (spec D8). In memory for the API's tests; Postgres under
TEST_DATABASE_URL, through the migration the server runs."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.monitor_samples import RETENTION_DAYS, InMemorySamples, PostgresSamples, Sample
from tests.conftest import TEST_DATABASE_URL, requires_db

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def _sample(i, pid="bed-1", at=None):
    at = at or (T0 + timedelta(minutes=i))
    return Sample(hospital="h1", patient_id=pid, bed_id="b-1", source="10.0.0.5", code="heart_rate",
                  via="hr", value=70.0 + i, unit="bpm", captured_at=at, received_at=at + timedelta(seconds=2))


def _exercise(store):
    for i in range(3):
        store.append(_sample(i))
    store.append(_sample(0, pid="bed-2"))
    rows = store.since("h1", T0 - timedelta(hours=1), now=T0 + timedelta(minutes=5))
    assert [(r.patient_id, r.value) for r in rows] == [("bed-1", 70.0), ("bed-2", 70.0), ("bed-1", 71.0), ("bed-1", 72.0)]
    assert store.since("h2", T0 - timedelta(hours=1), now=T0 + timedelta(minutes=5)) == []
    # Oldest first, and only what is newer than `since`.
    assert [r.value for r in store.since("h1", T0 + timedelta(minutes=1), now=T0 + timedelta(minutes=5))] == [71.0, 72.0]
    old = store.prune(before=T0 + timedelta(minutes=1, seconds=30))
    assert old == 2
    assert [r.value for r in store.since("h1", T0 - timedelta(hours=1), now=T0 + timedelta(minutes=5))] == [71.0, 72.0]


def test_in_memory_samples():
    _exercise(InMemorySamples())


def test_the_retention_is_thirty_days():
    assert RETENTION_DAYS == 30


@requires_db
def test_postgres_samples_through_the_migration():
    from sqlalchemy import text
    store = PostgresSamples(TEST_DATABASE_URL)
    with store._engine.begin() as conn:                           # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS monitor_samples"))
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util, pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0013_monitor_samples.py"
    spec = importlib.util.spec_from_file_location("m0013", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with store._engine.begin() as conn:                           # noqa: SLF001
        ctx = MigrationContext.configure(conn)
        module.op = Operations(ctx)
        module.upgrade()
    _exercise(store)
    with store._engine.begin() as conn:                           # noqa: SLF001
        conn.execute(text("DROP TABLE IF EXISTS monitor_samples"))
```

(The Postgres audit tests exercise migrations the same way: `tests/test_audit_postgres.py`'s `audit_log` fixture. Copy its exact `MigrationContext`/`Operations` incantation if the above differs from it.)

- [ ] **Step 2: Run** → `ImportError`.

- [ ] **Step 3: `monitor_samples.py`**

```python
"""Aşama B's monitor samples (spec D8): one row per sample the shadow engine was fed, kept
RETENTION_DAYS and then deleted. Bulk and expiring — the opposite of the audit, which is few
and for ever. Patient ids are the board's pseudonymous numbers, as in the audit; no name, no
free text. Read at start-up (the last 24 h, D9) and by nothing else in this slice (O3)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

RETENTION_DAYS = 30


@dataclass(frozen=True)
class Sample:
    hospital: str
    patient_id: str
    bed_id: str
    source: str
    code: str             # SignalCode.value
    via: str              # hr | pls | spo2 | art | nbp
    value: float
    unit: str
    captured_at: datetime
    received_at: datetime


class SampleStore(Protocol):
    def append(self, sample: Sample) -> None: ...
    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]: ...
    def prune(self, *, before: datetime) -> int: ...


class InMemorySamples:
    def __init__(self) -> None:
        self._rows: list[Sample] = []

    def append(self, sample: Sample) -> None:
        self._rows.append(sample)

    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]:
        """Oldest first by `captured_at`, ties by insertion; nothing stamped after `now`."""
        return sorted((r for r in self._rows if r.hospital == hospital and since <= r.captured_at <= now),
                      key=lambda r: r.captured_at)

    def prune(self, *, before: datetime) -> int:
        kept = [r for r in self._rows if r.received_at >= before]
        dropped = len(self._rows) - len(kept)
        self._rows = kept
        return dropped


class PostgresSamples:
    """The table of migration 0013, through a sync engine like the audit's (one small INSERT per
    sample at pilot volume: ≈6 rows/min/bed)."""

    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        from sqlalchemy import create_engine
        from homunculus.api.audit_postgres import to_sync_url
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
                                     connect_args={"sslmode": "require"} if ssl_required else {})

    def append(self, sample: Sample) -> None:
        from sqlalchemy import text
        with self._engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO monitor_samples (hospital, patient_id, bed_id, source, code, via, value, unit,"
                " captured_at, received_at) VALUES (:hospital, :patient_id, :bed_id, :source, :code, :via,"
                " :value, :unit, :captured_at, :received_at)"), sample.__dict__)

    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]:
        from sqlalchemy import text
        with self._engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT hospital, patient_id, bed_id, source, code, via, value, unit, captured_at, received_at"
                " FROM monitor_samples WHERE hospital = :hospital AND captured_at >= :since AND captured_at <= :now"
                " ORDER BY captured_at, id"), {"hospital": hospital, "since": since, "now": now}).mappings().all()
        return [Sample(**{**dict(r), "captured_at": _utc(r["captured_at"]), "received_at": _utc(r["received_at"])})
                for r in rows]

    def prune(self, *, before: datetime) -> int:
        from sqlalchemy import text
        with self._engine.begin() as conn:
            return conn.execute(text("DELETE FROM monitor_samples WHERE received_at < :before"),
                                {"before": before}).rowcount

    def dispose(self) -> None:
        self._engine.dispose()


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def retention_bound(now: datetime) -> datetime:
    return now - timedelta(days=RETENTION_DAYS)
```

- [ ] **Step 4: Migration `0013_monitor_samples.py`**

```python
# homunculus-engine/alembic/versions/0013_monitor_samples.py
"""monitor_samples: Aşama B's monitor samples, one row per sample the shadow engine was fed

Revision 0013, follows 0012 (Lane B's admissions identity digest; unreleased, like this one).

Bulk rows that expire: the API deletes rows older than RETENTION_DAYS (30) every hour
(api/monitor_samples.py). Not an audit table: no chain, no triggers, deletes allowed. Patient ids
are the board's pseudonymous numbers. Read at start-up for the last 24 hours.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-27
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "monitor_samples",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("hospital", sa.String(64), nullable=False),
        sa.Column("patient_id", sa.String(128), nullable=False),
        sa.Column("bed_id", sa.String(64), nullable=False),
        sa.Column("source", sa.String(45), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("via", sa.String(8), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(16), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitor_samples_hospital_patient_captured", "monitor_samples",
                    ["hospital", "patient_id", "captured_at"])
    op.create_index("ix_monitor_samples_received", "monitor_samples", ["received_at"])


def downgrade() -> None:
    op.drop_index("ix_monitor_samples_received", table_name="monitor_samples")
    op.drop_index("ix_monitor_samples_hospital_patient_captured", table_name="monitor_samples")
    op.drop_table("monitor_samples")
```

Check the migration-chain test in `tests/test_audit_postgres.py` (it walks `alembic/versions` and asserts every `down_revision` exists): 0013 → 0012 must resolve, which is why Task 0 waits for B1a.

- [ ] **Step 5: Run** `tests/test_monitor_samples.py` (the Postgres test skips without `TEST_DATABASE_URL`; run it once with the local test database: `TEST_DATABASE_URL=postgresql://...homunculus_test python -m pytest ... -q tests/test_monitor_samples.py`), and `tests/test_audit_postgres.py` (the chain test).

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/api/monitor_samples.py homunculus-engine/alembic/versions/0013_monitor_samples.py homunculus-engine/tests/test_monitor_samples.py
git commit -m "feat(infinity): monitor_samples — the 30-day table of the shadow engine's samples, migration 0013 (Aşama B, D8)"
```

---

### Task 4: `Sampler` and `ShadowLane`

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/infinity_rules.py`
- Test: `homunculus-engine/tests/test_infinity_rules.py` (append)

- [ ] **Step 1: Write the failing tests** (append to `test_infinity_rules.py`)

```python
from datetime import timedelta

from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.infinity_rules import (
    REPLAY_HOURS, SAMPLE_INTERVAL_S, Sampler, ShadowLane, relation,
)
from homunculus.api.monitor_samples import InMemorySamples
from homunculus.canonical import Observation
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert

DT0 = datetime.fromtimestamp(T0, timezone.utc)


def _alert(kind, severity="high"):
    return Alert("bed-1", kind, severity, "immediate", kind, "", [], [], "high")


def test_sampler_takes_one_per_minute_per_patient_and_code_and_never_back_fills():
    sampler = Sampler()
    cand = pick(_view(_cell("hr", value=88)), DEFAULT_PARAMETERS, now=T0)
    assert sampler.due("bed-1", cand[0], now=T0)
    sampler.taken("bed-1", cand[0], now=T0)
    assert not sampler.due("bed-1", cand[0], now=T0 + 59.0)
    assert sampler.due("bed-1", cand[0], now=T0 + SAMPLE_INTERVAL_S)
    assert sampler.due("bed-2", cand[0], now=T0 + 1.0)                     # another patient
    other = pick(_view(_cell("spo2", value=97, unit="%")), DEFAULT_PARAMETERS, now=T0)[0]
    assert sampler.due("bed-1", other, now=T0 + 1.0)                      # another code
    sampler.forget("bed-1")
    assert sampler.due("bed-1", cand[0], now=T0 + 1.0)


def test_relation_of_a_shadow_finding_to_the_real_alerts():
    real = {"news2": _alert("news2", "high")}
    assert relation(_alert("news2", "high"), real) == "same"
    assert relation(_alert("news2", "critical"), real) == "level_differs"
    assert relation(_alert("sepsis"), real) == "shadow_only"


def _lane(stage_rules=True):
    audit = InMemoryAuditLog()
    lane = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=InMemorySamples(), audit=audit,
                      enabled=stage_rules)
    real = Engine()
    return lane, real, audit


def test_the_lane_feeds_only_the_shadow_engine_and_writes_sample_rows_and_finding_rows():
    lane, real, audit = _lane()
    lane.install("h1", real)                                  # start-up: a copy of the real engine
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    changed = lane.sample("h1", views, cards, now=T0)
    assert changed == ["bed-1"]
    assert real.patient_ids() == []                              # the real engine never saw it
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).source_device == "infinity:10.0.0.5:hr"
    kinds = {a.kind for a in shadow.active_alerts("bed-1")}
    assert "news2" in kinds
    assert [(r.event_type, r.subject) for r in audit.records(tenant="h1", limit=50)] == [("shadow_alert", "news2")]
    assert [(s.code, s.via, s.value) for s in lane.samples.since("h1", DT0 - timedelta(hours=1), now=DT0)] == [
        ("heart_rate", "hr", 140.0), ("spo2", "spo2", 85.0)]
    # Within the minute nothing more is taken; after it, no new row for an unchanged finding.
    assert lane.sample("h1", views, cards, now=T0 + 30.0) == []
    lane.sample("h1", views, cards, now=T0 + 61.0)
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1


def test_findings_carry_the_relation_and_null_without_a_link():
    lane, real, _ = _lane()
    lane.install("h1", real)
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    lane.sample("h1", views, cards, now=T0)
    found = lane.findings("h1", "bed-1", real, now=DT0)
    assert found["news2"]["total"] >= 5 and found["vitals"]["heart_rate"]["source"] == "infinity:10.0.0.5:hr"
    assert found["vitals"]["heart_rate"]["via"] == "hr"
    assert [f["relation"] for f in found["findings"]] == ["shadow_only"] * len(found["findings"])
    assert lane.findings("h1", "bed-2", real, now=DT0) is None
    assert lane.findings("h1", "bed-1", real, now=DT0, linked=False) is None


def test_unlink_returns_the_patient_to_the_real_picture_and_clears_the_findings():
    lane, real, audit = _lane()
    real.ingest(Observation("bed-1", SignalCode.HEART_RATE, 70, "bpm", DT0, "bridge"), now=DT0)
    lane.install("h1", real)
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    lane.sample("h1", views, cards, now=T0)
    # The next cycle: the bed is empty (the patient was discharged or moved).
    assert lane.sample("h1", views, [{**cards[0], "link": "none", "patient_id": None}], now=T0 + 61.0) == ["bed-1"]
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert [r.event_type for r in audit.records(tenant="h1", limit=50)] == ["shadow_alert", "shadow_alert_cleared"]
    assert audit.records(tenant="h1", event_type="shadow_alert_cleared", limit=5)[0].payload["reason"] == "unlinked"


def test_mirror_reaches_the_shadow_engine_only_and_is_a_no_op_below_rules():
    lane, real, _ = _lane()
    lane.install("h1", real)
    obs = Observation("bed-1", SignalCode.SPO2, 90, "%", DT0, "bridge")
    real.ingest(obs, now=DT0)
    lane.mirror_observation("h1", obs, now=DT0)
    assert lane.engines["h1"].state("bed-1").latest(SignalCode.SPO2).value == 90
    off, real2, _ = _lane(stage_rules=False)
    off.install("h1", real2)
    off.mirror_observation("h1", obs, now=DT0)
    assert "h1" not in off.engines


def test_restart_replays_the_last_24_hours_of_samples_and_seeds_the_clock_and_the_open_findings():
    lane, real, audit = _lane()
    lane.install("h1", real)
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    lane.sample("h1", views, cards, now=T0)
    again = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=audit, enabled=True)
    again.install("h1", Engine(), now=DT0 + timedelta(seconds=30))
    shadow = again.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert not again.sampler.due("bed-1", pick(views["10.0.0.5"], DEFAULT_PARAMETERS, now=T0 + 30)[0], now=T0 + 30)
    # The finding is open from before: replaying does not open it twice.
    again.sample("h1", views, cards, now=T0 + 61.0)
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1
    # Samples older than the replay window are not replayed.
    stale = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=InMemoryAuditLog(), enabled=True)
    stale.install("h1", Engine(), now=DT0 + timedelta(hours=REPLAY_HOURS, minutes=1))
    assert "bed-1" not in stale.engines["h1"].patient_ids()


def test_a_lane_failure_is_swallowed_and_logged_once(caplog):
    lane, real, _ = _lane()
    lane.install("h1", real)
    calls = []
    def boom(): calls.append(1); raise RuntimeError("x")
    with caplog.at_level("ERROR"):
        assert lane.guard("sample", boom) is None
        assert lane.guard("sample", boom) is None
    assert len(calls) == 2 and sum("gölge motor" in r.message for r in caplog.records) == 1
    assert lane.state == "error"
    assert lane.guard("sample", lambda: 1) == 1 and lane.state == "ok"
```

- [ ] **Step 2: Run** → `ImportError` for `Sampler`, `ShadowLane`, `relation`.

- [ ] **Step 3: Append to `infinity_rules.py`**

```python
import copy as _copy
from collections.abc import Callable, Iterable
from datetime import timedelta
from typing import Any

from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.monitor_samples import Sample, SampleStore
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.news2 import score as news2_score

SHADOW_ALERT, SHADOW_CLEARED = "shadow_alert", "shadow_alert_cleared"
_SEVERITY = ("low", "moderate", "high", "critical")


class Sampler:
    """The 60 s clock per (patient, engine code) — D4. Monotonic in `now` per key; a sample is
    never back-filled."""

    def __init__(self) -> None:
        self._last: dict[tuple[str, SignalCode], float] = {}

    def due(self, patient_id: str, candidate: Candidate, *, now: float) -> bool:
        last = self._last.get((patient_id, candidate.code))
        return last is None or now - last >= SAMPLE_INTERVAL_S

    def taken(self, patient_id: str, candidate: Candidate, *, now: float) -> None:
        self._last[(patient_id, candidate.code)] = now

    def forget(self, patient_id: str) -> None:
        for key in [k for k in self._last if k[0] == patient_id]:
            del self._last[key]


def relation(finding: Alert, real: Mapping[str, Alert]) -> str:
    """D6: how a shadow finding stands to the real engine's alerts of the same patient."""
    twin = real.get(finding.kind)
    if twin is None:
        return "shadow_only"
    return "same" if twin.severity == finding.severity else "level_differs"


class ShadowLane:
    """The shadow engines, one per hospital, and everything that feeds them (D1).

    `enabled` is the stage `rules`; below it every method is a no-op and `engines` stays empty,
    so the stage `shadow` is Aşama A exactly. `install(hospital, real)` builds the hospital's
    shadow engine as `real.copy()` plus the last REPLAY_HOURS of samples (D9). The doors call
    `mirror_*` after the real engine; `sample` is called by the readings route; `findings` builds
    the board's `shadow` key. Every call from a door goes through `guard`: the lane never fails a
    clinical request."""

    def __init__(self, *, allowed: tuple[str, ...], samples: SampleStore, audit: AuditLog, enabled: bool) -> None:
        self.allowed = allowed
        self.samples = samples
        self.audit = audit
        self.enabled = enabled
        self.engines: dict[str, Engine] = {}
        self.sampler = Sampler()
        self.linked: dict[str, set[str]] = {}                 # hospital -> patient ids linked now
        self._open: dict[tuple[str, str], dict[str, Alert]] = {}  # (hospital, pid) -> last published findings
        self._open_ids: dict[tuple[str, str, str], int] = {}  # (hospital, pid, kind) -> the opening row's id
        self.state = "ok"                                     # ok | error — the device screen's word

    # --- the guard --------------------------------------------------------------------------
    def guard(self, what: str, call: Callable[[], Any]) -> Any:
        try:
            result = call()
        except Exception:                         # the lane must never fail a clinical request
            if self.state != "error":
                log.exception("gölge motor: %s başarısız; klinik yol etkilenmedi", what)
            self.state = "error"
            return None
        if self.state != "ok":
            log.warning("gölge motor: yeniden çalışıyor (%s)", what)
            self.state = "ok"
        return result

    # --- start-up ---------------------------------------------------------------------------
    def install(self, hospital: str, real: Engine, *, now: datetime | None = None) -> None:
        if not self.enabled:
            return
        now = now or datetime.now(timezone.utc)
        engine = real.copy()
        since = now - timedelta(hours=REPLAY_HOURS)
        for row in self.samples.since(hospital, since, now=now):
            code = SignalCode(row.code)
            obs = Observation(row.patient_id, code, row.value, row.unit, row.captured_at,
                              f"{SOURCE_PREFIX}{row.source}:{row.via}")
            engine.ingest(obs, now=min(obs.timestamp, now))
            self.sampler._last[(row.patient_id, code)] = row.captured_at.timestamp()   # noqa: SLF001
        self.engines[hospital] = engine
        self.linked[hospital] = set()
        # The findings open before the restart: the audit's last word per (patient, kind) in the
        # replay window, paired by the opening row's id. Seeded so a finding still open is not
        # opened twice (spec §5).
        opened: dict[tuple[str, str], dict[str, Alert]] = {}
        ids: dict[tuple[str, str, str], int] = {}
        rows = sorted(self.audit.records(tenant=hospital, since=since, limit=100_000), key=lambda r: r.id)
        for rec in rows:
            key = (hospital, rec.patient_id)
            if rec.event_type == SHADOW_ALERT:
                opened.setdefault(key, {})[rec.subject] = Alert(
                    rec.patient_id, rec.subject, rec.payload.get("severity", ""), rec.payload.get("urgency", ""),
                    rec.payload.get("summary", ""), "", list(rec.payload.get("evidence", [])), [], "")
                ids[(hospital, rec.patient_id, rec.subject)] = rec.id
            elif rec.event_type == SHADOW_CLEARED:
                opened.get(key, {}).pop(rec.subject, None)
                ids.pop((hospital, rec.patient_id, rec.subject), None)
        self._open.update({k: v for k, v in opened.items() if v})
        self._open_ids.update(ids)

    # --- the mirror (D1) ----------------------------------------------------------------------
    def mirror_observation(self, hospital: str, obs: Observation, *, now: datetime) -> None:
        engine = self.engines.get(hospital)
        if engine is None:
            return
        engine.ingest(obs, now=min(obs.timestamp, now))
        self._publish(hospital, obs.patient_id, now)

    def mirror_profile(self, hospital: str, profile) -> None:
        engine = self.engines.get(hospital)
        if engine is not None:
            engine.set_profile(profile)

    def forget(self, hospital: str, patient_id: str, *, now: datetime) -> None:
        engine = self.engines.get(hospital)
        if engine is None:
            return
        self._clear(hospital, patient_id, now, reason="discharged")
        engine.forget(patient_id)
        self.sampler.forget(patient_id)
        self.linked.get(hospital, set()).discard(patient_id)

    # --- the samples (D3, D4, D5) --------------------------------------------------------------
    def sample(self, hospital: str, views: Mapping[str, DeviceView], cards: Iterable[dict], *, now: float,
               real: Engine | None = None) -> list[str]:
        """One pass over the board's bed cards. Returns the patient ids whose shadow picture
        changed (a sample taken, or a link ended) — the caller republishes their frames."""
        engine = self.engines.get(hospital)
        if engine is None:
            return []
        wall = datetime.fromtimestamp(now, timezone.utc)
        linked_now = {c["patient_id"]: c for c in cards if c.get("link") == "one" and c.get("patient_id")}
        changed: list[str] = []
        # Links that ended since the last pass: back to the real picture (D5).
        for pid in sorted(self.linked.get(hospital, set()) - set(linked_now)):
            self._clear(hospital, pid, wall, reason="unlinked")
            if real is not None:
                engine.adopt(real, pid)
            else:
                engine.state(pid).drop_source(SOURCE_PREFIX)
            self.sampler.forget(pid)
            changed.append(pid)
        for pid, card in linked_now.items():
            view = views.get(card["source"])
            if view is None:
                continue
            taken = False
            for cand in pick(view, self.allowed, now=now):
                if not self.sampler.due(pid, cand, now=now):
                    continue
                obs = cand.observation(pid)
                engine.state(pid).drop_source(SOURCE_PREFIX, before=obs.timestamp - timedelta(hours=REPLAY_HOURS))
                engine.ingest(obs, now=min(obs.timestamp, wall))
                self.samples.append(Sample(hospital, pid, str(card.get("bed_id") or ""), cand.source,
                                           cand.code.value, cand.via, obs.value, obs.unit, obs.timestamp, wall))
                self.sampler.taken(pid, cand, now=now)
                taken = True
            if taken:
                self._publish(hospital, pid, wall)
                changed.append(pid)
        self.linked[hospital] = set(linked_now)
        return changed

    # --- the findings (D6) --------------------------------------------------------------------
    def findings(self, hospital: str, patient_id: str, real: Engine, *, now: datetime,
                 linked: bool | None = None) -> dict | None:
        engine = self.engines.get(hospital)
        if engine is None or patient_id not in engine.patient_ids():
            return None
        if linked is False or (linked is None and patient_id not in self.linked.get(hospital, set())):
            return None
        state = engine.state(patient_id)
        vitals = {}
        for code in FEEDS:
            obs = state.latest(code)
            if obs is not None and obs.source_device.startswith(SOURCE_PREFIX):
                vitals[code.value] = {"value": obs.value, "unit": obs.unit, "at": obs.timestamp.isoformat(),
                                      "source": obs.source_device, "via": obs.source_device.rsplit(":", 1)[-1]}
        result = news2_score(state, now)
        real_alerts = {a.kind: a for a in real.active_alerts(patient_id)}
        found = [{"kind": a.kind, "severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                  "evidence": list(a.supporting_evidence), "relation": relation(a, real_alerts),
                  "stale_inputs": list(a.stale_inputs), "downgraded": a.downgraded}
                 for a in sorted(engine.active_alerts(patient_id),
                                 key=lambda a: (-(_SEVERITY.index(a.severity) if a.severity in _SEVERITY else 0), a.kind))]
        return {"news2": {"total": result.total, "partial": result.partial, "missing": list(result.missing),
                          "stale": list(result.stale), "assumed": list(result.assumed),
                          "breakdown": dict(result.breakdown)},
                "vitals": vitals, "findings": found}

    def recent_findings(self, hospital: str, *, since: datetime) -> list[dict]:
        """The 7-day list (D7): every `shadow_alert` row since `since`, newest first, with its
        clearing row's time when it has one (paired by the opening row's id, `opened_id`)."""
        rows = self.audit.records(tenant=hospital, since=since, limit=100_000)
        cleared = {r.payload.get("opened_id"): r.ts for r in rows if r.event_type == SHADOW_CLEARED}
        out = []
        for r in sorted((r for r in rows if r.event_type == SHADOW_ALERT), key=lambda r: r.id, reverse=True):
            out.append({"patient_id": r.patient_id, "kind": r.subject, "opened_at": r.ts,
                        "cleared_at": cleared.get(r.id), **r.payload})
        return out

    # --- audit rows -------------------------------------------------------------------------
    def _open_row(self, hospital: str, patient_id: str, alert: Alert, now: datetime, sources: list[str]) -> None:
        rec = self.audit.append(AuditEvent(hospital, SHADOW_ALERT, patient_id, alert.kind,
                                           {"severity": alert.severity, "urgency": alert.urgency,
                                            "summary": alert.summary, "evidence": list(alert.supporting_evidence),
                                            "sources": sources, "at": now.isoformat()}))
        self._open_ids[(hospital, patient_id, alert.kind)] = rec.id

    def _cleared_row(self, hospital: str, patient_id: str, kind: str, now: datetime, reason: str) -> None:
        opened_id = self._open_ids.pop((hospital, patient_id, kind), None)
        self.audit.append(AuditEvent(hospital, SHADOW_CLEARED, patient_id, kind,
                                     {"reason": reason, "at": now.isoformat(), "opened_id": opened_id}))

    def _publish(self, hospital: str, patient_id: str, now: datetime) -> None:
        engine = self.engines[hospital]
        current = {a.kind: a for a in engine.active_alerts(patient_id)}
        key = (hospital, patient_id)
        before = self._open.get(key, {})
        sources = sorted({o.source_device for code in FEEDS
                          for o in [engine.state(patient_id).latest(code)]
                          if o is not None and o.source_device.startswith(SOURCE_PREFIX)})
        for kind, alert in current.items():
            prior = before.get(kind)
            if prior is None or prior.severity != alert.severity:
                if prior is not None:
                    self._cleared_row(hospital, patient_id, kind, now, "level_changed")
                self._open_row(hospital, patient_id, alert, now, sources)
        for kind in before:
            if kind not in current:
                self._cleared_row(hospital, patient_id, kind, now, "ended")
        if current:
            self._open[key] = current
        else:
            self._open.pop(key, None)

    def _clear(self, hospital: str, patient_id: str, now: datetime, *, reason: str) -> None:
        key = (hospital, patient_id)
        for kind in self._open.pop(key, {}):
            self._cleared_row(hospital, patient_id, kind, now, reason)

    def clear_all(self, hospital: str, *, now: datetime, reason: str = "stage") -> None:
        """D10: going back below `rules` ends every open finding with one row each."""
        for key in [k for k in self._open if k[0] == hospital]:
            self._clear(hospital, key[1], now, reason=reason)
```

(`_publish` is called for a mirrored clinical write too: a charted input can open or end a shadow finding, and the weekly list should say so.)

- [ ] **Step 4: Run** the whole `tests/test_infinity_rules.py` — green. The `findings` test's NEWS2 expectation: HR 140 (3 points) + SpO₂ 85 (3 points) = 6 with O₂ and consciousness assumed; the assertion `>= 5` holds.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/infinity_rules.py homunculus-engine/tests/test_infinity_rules.py
git commit -m "feat(infinity): Sampler and ShadowLane — the shadow engines, the mirror, the minute samples, the shadow_alert rows and the findings with their relation (Aşama B, D1, D4–D6, D8, D9)"
```

---

### Task 5: The board's `shadow` key

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/board.py:322-362` (`patient_board`), `:364-380` (`board_snapshot`)
- Test: `homunculus-engine/tests/test_api_board_shadow.py`

- [ ] **Step 1: Write the failing test**

```python
"""The board carries the shadow engine's picture under ONE key, `shadow`, and nothing else moves
(spec D6)."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def test_patient_board_has_shadow_null_by_default_and_passes_a_given_one_through():
    engine, store = Engine(), AckStore()
    engine.ingest(Observation("bed-1", SignalCode.HEART_RATE, 70, "bpm", T0, "bridge"), now=T0)
    plain = patient_board(engine, "bed-1", store, now=T0)
    assert plain["shadow"] is None
    given = {"news2": {"total": 6}, "vitals": {}, "findings": []}
    with_shadow = patient_board(engine, "bed-1", store, now=T0, shadow=given)
    assert with_shadow["shadow"] == given
    assert {k: v for k, v in with_shadow.items() if k != "shadow"} == {k: v for k, v in plain.items() if k != "shadow"}
```

- [ ] **Step 2: Run** → `TypeError: unexpected keyword 'shadow'`.

- [ ] **Step 3: `patient_board(..., shadow: dict | None = None)`** — add the parameter and `"shadow": shadow` as the last key of the returned dict, with the comment: `# Aşama B (D6): the shadow engine's picture for a monitor-linked patient; None otherwise and below the stage rules. Built by the lane, never here — this module holds no reference to it.` `board_snapshot(..., shadow_for: Callable[[str], dict | None] | None = None)` passes `shadow=shadow_for(pid) if shadow_for else None` to each `patient_board`.

- [ ] **Step 4: Run** the new test and `tests/test_api_board*.py`, `tests/test_board*.py` — green (every existing assertion on the board's keys that uses equality on the whole dict must gain `"shadow": None`; grep the tests for `== {` on board dicts and fix them).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_api_board_shadow.py homunculus-engine/tests/<fixed tests>
git commit -m "feat(board): the shadow key — the shadow engine's picture on the patient card, null by default (Aşama B, D6)"
```

---

### Task 6: Wiring in `app.py` and `prodserver.py`

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`create_app` signature and body; `_ensure`; `/ingest`; `/clinical/{id}`; the profile door; `retire_and_publish`; `shadow_readings`; `shadow_board`; a new route; the lifespan; every `patient_board(` and `board_snapshot(` call)
- Modify: `homunculus-engine/src/homunculus/api/clinical.py:196-234` (`chart_observations` gains `mirror=`)
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py:470-480`
- Test: `homunculus-engine/tests/test_api_shadow_findings.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Aşama B through the API: the stage `rules` feeds the shadow engine from the readings route,
the board carries `shadow`, the findings route lists the week, and below `rules` none of it
exists (spec D1, D6, D7, D10)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.infinity_shadow import shadow_settings_from_env
from homunculus.api.monitor_samples import InMemorySamples
from homunculus.api.patient_identity import InMemoryIdentityStore
from homunculus.tenant.bedmap import BedMap, BedRef

DEVICE, SHADOW, HOSPITAL = "device-token", "s" * 40, "h1"
HDR = {"Authorization": f"Bearer {DEVICE}"}
SHDR = {"Authorization": f"Bearer {SHADOW}"}
# The table's shape: copy TABLE from tests/test_infinity_shadow_isolation.py (one row, bed_id "bed-b1",
# unit_id "unit-1"); the bedmap below puts the encounter's location on that bed.
from tests.test_infinity_shadow_isolation import TABLE, _body as _strip_body   # noqa: E402


class Clock:
    t = 1_800_000_000.0


def _app(tmp_path, stage="rules"):
    table = tmp_path / "device-beds.json"
    table.write_text(json.dumps(TABLE), encoding="utf-8")
    settings = shadow_settings_from_env({"INFINITY_CLINICAL_STAGE": stage, "INFINITY_SHADOW_TOKEN": SHADOW,
                                         "INFINITY_SHADOW_HOSPITAL": HOSPITAL,
                                         "INFINITY_DEVICE_BEDS_PATH": str(table)}, {DEVICE: HOSPITAL})
    audit, samples = InMemoryAuditLog(), InMemorySamples()
    app = create_app({DEVICE: HOSPITAL}, run_escalation_loop=False, audit=audit, samples=samples,
                     identities=InMemoryIdentityStore(), bedmap=BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")}),
                     shadow=settings, shadow_clock=lambda: Clock.t)
    return TestClient(app), audit, samples


def _encounter(pid):
    # The Encounter shape the gateway parses: copy `_encounter` from tests/test_infinity_shadow_equivalence.py.
    from tests.test_infinity_shadow_equivalence import _encounter as enc
    return enc(pid)


def _body(now, hr=140.0, spo2=85.0):
    body = _strip_body(now)
    body["devices"][0]["readings"] = [
        {"parameter": "hr", "value": hr, "unit": "bpm", "valid": True, "captured_at": now - 1.0},
        {"parameter": "spo2", "value": spo2, "unit": "%", "valid": True, "captured_at": now - 1.0}]
    return body


def _post(client):
    Clock.t += 2.0
    return client.post("/infinity-shadow/readings", json=_body(Clock.t), headers=SHDR)


def _card(client, pid):
    return next(p for p in client.get("/patients", headers=HDR).json()["patients"] if p["patient_id"] == pid)


def test_rules_feeds_the_shadow_engine_and_the_board_carries_shadow(tmp_path):
    client, audit, samples = _app(tmp_path)
    with client:
        assert client.post("/ingest", json=_encounter("bed-1"), headers=HDR).status_code == 200
        assert _post(client).status_code == 200
        card = _card(client, "bed-1")
        assert card["shadow"]["vitals"]["heart_rate"]["value"] == 140.0
        assert card["shadow"]["vitals"]["heart_rate"]["via"] == "hr"
        assert card["shadow"]["news2"]["total"] >= 5
        assert any(f["kind"] == "news2" and f["relation"] == "shadow_only" for f in card["shadow"]["findings"])
        # The REAL picture is untouched: no alert, no risk, no reading in `latest`.
        assert card["alerts"] == [] and card["risk"] == "none" and card["latest"]["heart_rate"] is None
        assert client.get("/alerts/bed-1", headers=HDR).json()["alerts"] == []
        kinds = [r.event_type for r in audit.records(tenant=HOSPITAL, limit=100)]
        assert "shadow_alert" in kinds and "alert" not in kinds and "ingest" not in kinds
        assert len(samples.since(HOSPITAL, datetime.fromtimestamp(Clock.t - 3600, timezone.utc),
                                 now=datetime.fromtimestamp(Clock.t, timezone.utc))) == 2
        strip = client.get("/infinity-shadow/board", headers=HDR).json()
        assert strip["stage"] == "rules" and strip["feed"]["rules_state"] == "ok"


def test_the_findings_route_lists_the_week_and_is_409_below_rules(tmp_path):
    client, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _post(client)
        rows = client.get("/infinity-shadow/findings?days=7", headers=HDR).json()["findings"]
        assert rows and rows[0]["patient_id"] == "bed-1" and rows[0]["kind"] == "news2" and rows[0]["cleared_at"] is None
        assert client.get("/infinity-shadow/findings?days=8", headers=HDR).status_code == 400
    plain, _, _ = _app(tmp_path, stage="shadow")
    with plain:
        assert plain.get("/infinity-shadow/findings", headers=HDR).status_code == 409


def test_below_rules_nothing_of_it_exists(tmp_path):
    client, audit, samples = _app(tmp_path, stage="shadow")
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        assert _post(client).status_code == 200
        assert _card(client, "bed-1")["shadow"] is None
        assert [r.event_type for r in audit.records(tenant=HOSPITAL, limit=100)] == ["identity"]
        assert samples.since(HOSPITAL, datetime.fromtimestamp(0, timezone.utc),
                             now=datetime.fromtimestamp(Clock.t, timezone.utc)) == []
        assert "rules_state" not in client.get("/infinity-shadow/board", headers=HDR).json()["feed"]


def test_a_clinical_write_is_mirrored_and_a_discharge_forgets_in_both(tmp_path):
    from homunculus.canonical import SignalCode
    client, audit, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        _post(client)
        r = client.post("/clinical/bed-1", json={"entries": [{"code": "suspected_infection", "value": 1}]}, headers=HDR)
        assert r.status_code == 200
        lane = client.app.state.shadow_lane
        assert lane.engines[HOSPITAL].state("bed-1").latest(SignalCode.SUSPECTED_INFECTION).value == 1.0
        # A discharge made here (A-11) retires the patient from the shadow engine too: drive
        # `app.state.retire_patient` the way tests/test_api_discharge.py does.
        from tests.test_api_discharge import discharge as _discharge   # the fixture-free helper there
        _discharge(client, "bed-1")
        assert "bed-1" not in lane.engines[HOSPITAL].patient_ids()
        assert audit.records(tenant=HOSPITAL, event_type="shadow_alert_cleared", limit=5)[0].payload["reason"] == "discharged"


def test_a_lane_failure_never_fails_the_clinical_request(tmp_path, monkeypatch):
    client, _, _ = _app(tmp_path)
    with client:
        client.post("/ingest", json=_encounter("bed-1"), headers=HDR)
        lane = client.app.state.shadow_lane
        def boom(*a, **k): raise RuntimeError("x")
        monkeypatch.setattr(lane, "mirror_observation", boom)
        from tests.test_infinity_shadow_equivalence import load_scenario, SCEN
        _ts, fhir = load_scenario(SCEN / "news2_deterioration.yaml")[0]
        fhir["subject"]["reference"] = "Patient/bed-1"
        assert client.post("/ingest", json=fhir, headers=HDR).status_code == 200
        assert lane.state == "error"
```

(If `tests/test_api_discharge.py` has no reusable `discharge` helper, write the two calls it makes — the identity store's tombstone write and `await app.state.retire_patient(...)` through `anyio`/`asyncio.run` — inline.)

- [ ] **Step 2: Run** → failures on `samples=` and the rest.

- [ ] **Step 3: `create_app`** — add parameters `samples: SampleStore | None = None` (default `InMemorySamples()`), after `shadow_monotonic`. After `shadow_table`:

```python
    # Aşama B — the shadow engine (api/infinity_rules.py). Below the stage `rules` the lane is
    # disabled: `engines` stays empty and every method is a no-op, so Aşama A is unchanged.
    samples = samples if samples is not None else InMemorySamples()
    lane = ShadowLane(allowed=shadow.parameters, samples=samples, audit=audit, enabled=shadow.rules)
    if shadow.rules:
        log.info("Aşama B gölge motor açık (alarm kapalı): hastane %s, parametreler %s",
                 shadow.hospital, ",".join(shadow.parameters))
```

In `_ensure`, after `stores[hospital] = store`: `lane.guard("install", lambda: lane.install(hospital, engine))`.

Expose: `app.state.shadow_lane = lane`.

- [ ] **Step 4: The mirror at the four sites** (each wrapped in `lane.guard`):
  - `/ingest`, right after `alerts = engine.ingest(obs, now=min(obs.timestamp, wall_now))`: `lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=wall_now))`.
  - `chart_observations` (`api/clinical.py`): add a keyword `mirror: Callable[[Observation], None] | None = None`; after `alerts = engine.ingest(obs, ...)`: `if mirror is not None: mirror(obs)`. In `app.py`, `app.state.shadow_mirror = lambda hospital, obs, now: lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=now))`, and both calls of `chart_observations` in `app.py` pass `mirror=lambda o: app.state.shadow_mirror(hospital, o, now)`. Lane B's admission form calls `chart_observations` too — tell Lane B to pass `app.state.shadow_mirror` the same way (a one-line follow-up on their side; O-item in the fold).
  - The profile door, after `engine.set_profile(profile)`: `lane.guard("mirror", lambda: lane.mirror_profile(hospital, profile))`.
  - `retire_and_publish`, inside the `try`, after `retire_patient(...)`: `lane.guard("forget", lambda: lane.forget(hospital, patient_id, now=now or datetime.now(timezone.utc)))`.

- [ ] **Step 5: The sampler in `shadow_readings`** — after `result = shadow_store.ingest(json.loads(raw))` (bind the result before returning):

```python
        result = shadow_store.ingest(json.loads(raw))
        if shadow.rules:
            await _sample_and_publish()
        return result
```

with

```python
    async def _sample_and_publish() -> None:
        """Aşama B: one sampling pass per accepted body, then a frame per patient whose shadow
        picture changed. The cards come from `board_view` with the hospital's own occupants —
        the same link the strip shows — so a sample goes only where a card says `link: one`."""
        hospital = shadow.hospital
        engine = _engine(hospital)
        now = shadow_clock()
        view = board_view(shadow_store.devices(now), shadow_store.feed(now), shadow_table.current(),
                          occupants=_occupants(hospital, now), visible=lambda c: True,
                          patient_visible=lambda c: True, show_unassigned=False, now=now)
        changed = lane.guard("sample", lambda: lane.sample(hospital, shadow_store.devices(now), view["beds"],
                                                            now=now, real=engine)) or []
        for pid in changed:
            if pid in set(engine.patient_ids()) or identities.get(hospital, pid) is not None:
                await broadcaster.publish(hospital, _card(hospital, pid))
```

`_card(hospital, pid)` is a new helper used by **every** `patient_board(` call in `app.py` (9 sites) and by `board_snapshot(`:

```python
    def _shadow_for(hospital: str, patient_id: str, now: datetime | None = None) -> dict | None:
        if not shadow.rules or hospital != shadow.hospital:
            return None
        return lane.guard("findings", lambda: lane.findings(hospital, patient_id, _engine(hospital),
                                                            now=now or datetime.now(timezone.utc)))

    def _card(hospital: str, patient_id: str, identity=None, now: datetime | None = None) -> dict:
        return patient_board(_engine(hospital), patient_id, _store(hospital),
                             identity=identity if identity is not None else identities.get(hospital, patient_id),
                             bedmap=bedmap, now=now, shadow=_shadow_for(hospital, patient_id, now))
```

Each existing `patient_board(engine, pid, store, identity=..., bedmap=bedmap)` becomes `_card(hospital, pid, identity)` (keep each site's `identity` argument where it already has the record, so no second identity read is added); `board_snapshot(...)` gains `shadow_for=lambda pid: _shadow_for(hospital, pid, now)`.

- [ ] **Step 6: `shadow_board`'s `feed.rules_state`** — in the route, after `body = board_view(...)`: when `shadow.rules`: `body["feed"]["rules_state"] = lane.state; body["stage"] = "rules"`. (`board_view` keeps answering `"stage": "shadow"`; the route overwrites it with the running stage. The dashboard's `stripOn` accepts both — Task 10.)

- [ ] **Step 7: `GET /infinity-shadow/findings`**

```python
    @app.get("/infinity-shadow/findings")
    async def shadow_findings(days: int = 7, authorization: str | None = Header(default=None)):
        """Aşama B's «uyarsaydı» list: every shadow finding opened in the last `days` (1–7), newest
        first, with when it cleared. For `board.view`, scoped like the board; 409 below `rules`."""
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        if not shadow.rules or caller.hospital != shadow.hospital:
            raise HTTPException(status_code=409, detail={"reason": "stage_not_rules"})
        if not 1 <= days <= 7:
            raise HTTPException(status_code=400, detail="days: 1–7")
        scope = await _scope(authorization)
        since = datetime.now(timezone.utc) - timedelta(days=days)
        rows = lane.recent_findings(caller.hospital, since=since)
        # Scoped like the board: a row is shown when its patient's card would be (the same
        # `sees_patient` the /patients route applies, on the identity's bed and unit).
        visible = []
        for row in rows:
            record = identities.get(caller.hospital, row["patient_id"])
            card = {"patient_id": row["patient_id"],
                    "identity": {**record.as_board(), **_bed_resolution(record, bedmap)} if record else None}
            if scope.unrestricted or sees_patient(card, scope):
                visible.append(row)
        return {"days": days, "findings": visible}
```

(`_bed_resolution` is `board.py`'s; import it, or build the identity block the way `/patients` builds its cards — read `apply_scope`'s expectations in `homunculus/scope` first and match the card shape it reads.)

- [ ] **Step 8: The hourly prune** — in the lifespan, `prune = asyncio.create_task(_prune_loop()) if shadow.rules else None`:

```python
    async def _prune_loop() -> None:
        while True:
            try:
                dropped = await asyncio.to_thread(samples.prune, before=retention_bound(datetime.now(timezone.utc)))
                if dropped:
                    log.info("monitor_samples: %d satır silindi (%d gün)", dropped, RETENTION_DAYS)
            except Exception:
                log.exception("monitor_samples temizliği başarısız; bir saat sonra yeniden")
            await asyncio.sleep(3600)
```

Cancel it in the `finally`.

- [ ] **Step 9: `prodserver.py`** — `samples=PostgresSamples(_database_url(), ssl_required=<what the audit passes>)` when the configured stage is `rules`, else `InMemorySamples()`; nothing else changes (`shadow=` already reads the environment, and `shadow_settings_from_env` now reads the allowlist).

- [ ] **Step 10: Run** `tests/test_api_shadow_findings.py`, then `tests/test_api_*.py`, `tests/test_infinity_shadow*.py` — the isolation test fails on `test_rules_and_alarms_behave_as_off` (Task 7 fixes it) and on nothing else.

- [ ] **Step 11: Commit**

```bash
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_api_shadow_findings.py
git commit -m "feat(api): Aşama B wired — the lane installed per hospital, the mirror at the four clinical doors, the sampler on the readings route, the shadow key on every card, GET /infinity-shadow/findings, the hourly prune (D1, D4, D6, D7, D9, D10)"
```

---

### Task 7: The gate — nothing clinical changes with `rules`

**Files:**
- Modify: `homunculus-engine/tests/test_infinity_shadow_equivalence.py`
- Modify: `homunculus-engine/tests/test_infinity_shadow_isolation.py`

- [ ] **Step 1: The equivalence test's third run.** In `_run`, build the settings by stage: `ShadowSettings(stage, stage, None, SHADOW, HOSPITAL, str(table), parameters=DEFAULT_PARAMETERS if stage == "rules" else ())` for `stage in ("shadow", "rules")`; `shadow_step()` posts when `stage != "off"`. The comparison strips what the stage `rules` is allowed to add — **and nothing else**:

```python
def _clinical(run: dict) -> dict:
    """Everything a clinician, a notification or an auditor sees, minus what Aşama B is allowed to
    add: the `shadow` key on a card and the two `shadow_*` audit kinds. Nothing else is masked."""
    def strip(obj):
        if isinstance(obj, dict):
            return {k: strip(v) for k, v in obj.items() if k != "shadow"}
        if isinstance(obj, list):
            return [strip(v) for v in obj]
        return obj
    out = dict(run)
    out["audit"] = [row for row in run["audit"] if row[1] not in ("shadow_alert", "shadow_alert_cleared")]
    out["audit_count"] = len(out["audit"])
    for key, value in run.items():
        if key in ("frames", "patients", "alerts") or key.startswith("patients ") or key.startswith("alerts "):
            out[key] = [json.dumps(strip(json.loads(v)), sort_keys=True) for v in value]
    return out


@pytest.mark.anyio
async def test_every_clinical_output_is_identical_with_the_stage_rules(monkeypatch, tmp_path):
    off = await _run(monkeypatch, tmp_path, stage="off")
    rules = await _run(monkeypatch, tmp_path, stage="rules")
    assert _clinical(rules) == _clinical(off)


@pytest.mark.anyio
async def test_the_stage_rules_actually_fed_the_shadow_engine(monkeypatch, tmp_path):
    probe = {}
    await _run(monkeypatch, tmp_path, stage="rules", probe=probe)
    assert probe["board"]["stage"] == "rules" and probe["board"]["feed"]["rules_state"] == "ok"
    assert probe["shadow_findings"]            # at least one card carried a shadow picture
```

The `frames` entries are `[tenant, record]` JSON — `strip` drops the `shadow` key inside the record. `_run` records `probe["shadow_findings"] = [p["shadow"] for p in <the last /patients answer> if p.get("shadow")]` when `probe` is given. `chain_ok` (`verify_chain`) stays compared as is: the chain is valid in both runs (the report, not the hashes, is what `_run` returns — check; if the report carries row counts, compare only its `ok` flag). The existing fixture's device sits on `bed-b1` and the scenario's patient is admitted to `YB^1^1 → bed-b1`, so the shadow engine receives samples for `pid`; the `_shadow_body` already carries `hr` and `spo2` values.

- [ ] **Step 2: The isolation test.** (a) `test_rules_and_alarms_behave_as_off` → parametrise over `["alarms"]` only and rename `test_alarms_behaves_as_off`. (b) A new case: with the stage `rules` and no `INFINITY_RULES_PARAMETERS`, the lane is on (`POST` 200, board `stage: "rules"`), and with `INFINITY_RULES_PARAMETERS=hr,bogus` it is off with `problem: "parameters_unknown"`. (c) `infinity_rules.py`'s own forbidden set:

```python
RULES_FORBIDDEN = ("homunculus.api.notify", "homunculus.api.ackstore", "homunculus.api.alert_lifecycle",
                   "homunculus.api.alarm_quality", "homunculus.api.app")


def test_the_bridge_imports_nothing_that_rings():
    imported = _imports(SRC / "api" / "infinity_rules.py")
    assert not sorted(n for n in imported if any(n == f or n.startswith(f + ".") for f in RULES_FORBIDDEN))


def test_the_bridge_writes_only_the_two_shadow_audit_kinds():
    text = (SRC / "api" / "infinity_rules.py").read_text(encoding="utf-8")
    kinds = set(re.findall(r'AuditEvent\(\s*\w+,\s*(\w+)', text))
    assert kinds <= {"SHADOW_ALERT", "SHADOW_CLEARED"}, kinds
```

(d) `test_importing_the_lane_loads_nothing_clinical_even_indirectly` stays as is: importing `infinity_shadow` must still load no engine module — the `rules_from_env` import is inside the `rules` branch of `shadow_settings_from_env`, and the module-level import of `infinity_shadow` by `infinity_rules` is one-way.

- [ ] **Step 3: Run** both files; then the whole no-DB engine suite — green. Record the counts.

- [ ] **Step 4: Commit**

```bash
git add homunculus-engine/tests/test_infinity_shadow_equivalence.py homunculus-engine/tests/test_infinity_shadow_isolation.py
git commit -m "test(infinity): the gate for Aşama B — every clinical output identical with the stage rules; the bridge imports nothing that rings and writes only the two shadow audit kinds (D11)"
```

---

### Task 8: `hide_parameters=True` (D12)

**Files:**
- Modify: `homunculus-engine/src/homunculus/db.py:91`, `api/audit_postgres.py:48`, `api/patient_identity_postgres.py:36`
- Test: `homunculus-engine/tests/test_db_hide_parameters.py`

- [ ] **Step 1: The test**

```python
"""Lane B's finding of 2026-10-27 (spec D12): a 500 on an INSERT must not log bound parameters —
clinical free text among them. Every engine the service creates hides them."""
from pathlib import Path
import re

SRC = Path(__file__).resolve().parents[1] / "src" / "homunculus"
FILES = ("db.py", "api/audit_postgres.py", "api/patient_identity_postgres.py", "api/monitor_samples.py")


def test_every_engine_creation_hides_parameters():
    for rel in FILES:
        text = (SRC / rel).read_text(encoding="utf-8")
        calls = re.findall(r"create(?:_async)?_engine\((?:[^()]|\([^()]*\))*\)", text, re.S)
        assert calls, rel
        for call in calls:
            assert "hide_parameters=True" in call, f"{rel}: {call[:80]}"
```

- [ ] **Step 2: Run** → fails on the three files. **Step 3:** add `hide_parameters=True` to each `create_engine(`/`create_async_engine(` call. **Step 4:** run the test and `tests/test_audit_postgres.py` (skips without DB; with it, still green). **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/db.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/src/homunculus/api/patient_identity_postgres.py homunculus-engine/tests/test_db_hide_parameters.py
git commit -m "fix(db): hide_parameters=True on every engine — a failed INSERT no longer logs bound clinical text (Aşama B, D12; Lane B's finding of 27.10)"
```

---

### Task 9: Dashboard data and words, and the findings box

**Files:**
- Modify: `dashboard/src/liveAdapters.js:42-80`, `dashboard/src/liveAdapters.test.js`
- Create: `dashboard/src/live/i18n/strings/shadow.js`; modify `strings/index.js`, `strings.test.js`
- Create: `dashboard/src/live/screens/patient/shadow/ShadowFindingsBox.jsx`, `ShadowFindingsBox.test.jsx`

- [ ] **Step 1: The adapter.** `patientFromBoard` gains `shadow: entry?.shadow ?? null`. Test: a card with `shadow` keeps it; without, `null`.

- [ ] **Step 2: The words** — `strings/shadow.js`, four languages, tr source. Keys (every language has every key; placeholders identical; az ≠ tr unless listed). The tr block, in full:

```js
// src/live/i18n/strings/shadow.js — Aşama B's shadow findings: the rules' answer to the monitor's
// numbers, with every alarm off. Four things in every language: these are from the MONITOR's
// unvalidated numbers; they are advice to look, never an alarm; nothing rings, pages or counts;
// the bedside monitor is the primary alarm. AZ/RU/EN await a native-speaking clinician's review.
export default {
  tr: {
    title: "Gölge öneri",
    tag: "alarm kapalı",
    cardTag: "gölge öneri · NEWS2 {total}",
    cardNone: "gölge öneri yok",
    intro: "Monitörün doğrulanmamış değerleriyle kurallar şunu söylerdi. Zil çalmaz, bildirim gitmez, sayaçlara girmez; başucu monitörü birincil alarmdır.",
    news2: "Gölge NEWS2: {total}",
    news2Partial: "kısmi",
    inputs: "Girdiler",
    via: "monitör · {via}",
    viaHr: "HR", viaPls: "PLS", viaSpo2: "SpO₂", viaArt: "ART", viaNbp: "NBP",
    none: "Monitör girdileriyle açık bulgu yok.",
    relSame: "gerçek bulguyla aynı",
    relShadowOnly: "yalnız gölgede",
    relLevel: "düzey farklı",
    week: "Uyarsaydı — son 7 gün",
    weekHelp: "Yalnız gölgede açılan bulgular: monitör girdileri olmasaydı görünmeyecek olanlar. Haftalık değerlendirme için.",
    weekNone: "Son 7 günde gölge bulgu yok.",
    weekUnavailable: "Gölge liste okunamadı.",
    weekOpened: "açıldı", weekCleared: "kapandı", weekOpen: "açık",
    colPatient: "Hasta", colKind: "Bulgu", colSeverity: "Düzey", colOpened: "Açılış", colCleared: "Kapanış",
    laneError: "gölge motor: hata",
  },
  az: {
    title: "Kölgə tövsiyə",
    tag: "siqnal söndürülüb",
    cardTag: "kölgə tövsiyə · NEWS2 {total}",
    cardNone: "kölgə tövsiyə yoxdur",
    intro: "Monitorun təsdiqlənməmiş dəyərləri ilə qaydalar bunu deyərdi. Zəng çalmır, bildiriş getmir, sayğaclara daxil olmur; çarpayı monitoru əsas siqnaldır.",
    news2: "Kölgə NEWS2: {total}",
    news2Partial: "qismən",
    inputs: "Girişlər",
    via: "monitor · {via}",
    viaHr: "HR", viaPls: "PLS", viaSpo2: "SpO₂", viaArt: "ART", viaNbp: "NBP",
    none: "Monitor girişləri ilə açıq tapıntı yoxdur.",
    relSame: "həqiqi tapıntı ilə eyni",
    relShadowOnly: "yalnız kölgədə",
    relLevel: "səviyyə fərqlidir",
    week: "Xəbərdarlıq edərdi — son 7 gün",
    weekHelp: "Yalnız kölgədə açılan tapıntılar: monitor girişləri olmasaydı görünməyəcək olanlar. Həftəlik qiymətləndirmə üçün.",
    weekNone: "Son 7 gündə kölgə tapıntı yoxdur.",
    weekUnavailable: "Kölgə siyahı oxuna bilmədi.",
    weekOpened: "açıldı", weekCleared: "bağlandı", weekOpen: "açıq",
    colPatient: "Xəstə", colKind: "Tapıntı", colSeverity: "Səviyyə", colOpened: "Açılış", colCleared: "Bağlanış",
    laneError: "kölgə mühərrik: xəta",
  },
  ru: {
    title: "Теневая рекомендация",
    tag: "тревога выключена",
    cardTag: "теневая рекомендация · NEWS2 {total}",
    cardNone: "теневых рекомендаций нет",
    intro: "С невалидированными значениями монитора правила сказали бы следующее. Звонок не звучит, уведомление не уходит, в счётчики не попадает; прикроватный монитор — основная тревога.",
    news2: "Теневой NEWS2: {total}",
    news2Partial: "частично",
    inputs: "Входы",
    via: "монитор · {via}",
    viaHr: "HR", viaPls: "PLS", viaSpo2: "SpO₂", viaArt: "ART", viaNbp: "NBP",
    none: "По входам монитора открытых находок нет.",
    relSame: "совпадает с реальной",
    relShadowOnly: "только в тени",
    relLevel: "уровень отличается",
    week: "Предупредило бы — последние 7 дней",
    weekHelp: "Находки, открытые только в тени: те, которых не было бы без входов монитора. Для еженедельной оценки.",
    weekNone: "За 7 дней теневых находок нет.",
    weekUnavailable: "Теневой список не прочитан.",
    weekOpened: "открыта", weekCleared: "закрыта", weekOpen: "открыта",
    colPatient: "Пациент", colKind: "Находка", colSeverity: "Уровень", colOpened: "Открытие", colCleared: "Закрытие",
    laneError: "теневой движок: ошибка",
  },
  en: {
    title: "Shadow advice",
    tag: "alarm off",
    cardTag: "shadow advice · NEWS2 {total}",
    cardNone: "no shadow advice",
    intro: "With the monitor's unvalidated values the rules would say this. No bell, no notification, no counter; the bedside monitor is the primary alarm.",
    news2: "Shadow NEWS2: {total}",
    news2Partial: "partial",
    inputs: "Inputs",
    via: "monitor · {via}",
    viaHr: "HR", viaPls: "PLS", viaSpo2: "SpO₂", viaArt: "ART", viaNbp: "NBP",
    none: "No open finding on the monitor's inputs.",
    relSame: "same as the real finding",
    relShadowOnly: "shadow only",
    relLevel: "level differs",
    week: "Would have alerted — last 7 days",
    weekHelp: "Findings opened only in the shadow: the ones that would not appear without the monitor's inputs. For the weekly review.",
    weekNone: "No shadow finding in the last 7 days.",
    weekUnavailable: "The shadow list could not be read.",
    weekOpened: "opened", weekCleared: "cleared", weekOpen: "open",
    colPatient: "Patient", colKind: "Finding", colSeverity: "Level", colOpened: "Opened", colCleared: "Cleared",
    laneError: "shadow engine: error",
  },
};
```

`viaHr`/`viaPls`/`viaSpo2`/`viaArt`/`viaNbp` are the monitor's own labels → `NEUTRAL` and `AZ_SAME_AS_TR` in `strings.test.js` under a `// shadow (Aşama B) · neutral` / `· az = tr` heading of their own. Register the namespace in `strings/index.js` as `shadow`. (The ru `weekOpened`/`weekOpen` are both "открыта": fine — different keys, same word; az/ru/en await the native review as every namespace does.)

- [ ] **Step 3: `ShadowFindingsBox.jsx`** — test first (`ShadowFindingsBox.test.jsx`): renders nothing for `shadow === null`; with a shadow: the heading «Gölge öneri» with the amber `Tag` «alarm kapalı», the intro, «Gölge NEWS2: 6» (+ «kısmi» when partial), the inputs list (`heart_rate 140 bpm · monitör · HR · 09:01`), each finding as a `<li>` with its summary (`lang="en"`) and the relation `StatusPill` (`same` → neutral, `shadow_only` → `warn`, `level_differs` → `att`), the empty sentence when `findings` is empty; no live region, no button; four languages render the relation words. Then the component:

```jsx
// src/live/screens/patient/shadow/ShadowFindingsBox.jsx — Aşama B's «Gölge öneri · alarm kapalı».
// The shadow ENGINE's picture of a monitor-linked patient (api/infinity_rules.py `findings`):
// its NEWS2, the monitor inputs it read, its findings and how each stands to the real ones.
// Dressed as advice that cannot be vouched for: amber tag, no risk pill, no rail, no live region,
// nothing that could be mistaken for the Alarmlar screen's rows (spec D7).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Note, StatusPill, Tag } from "../../../ui/index.js";

const REL_TONE = { same: "neutral", shadow_only: "warn", level_differs: "att" };
const REL_KEY = { same: "shadow.relSame", shadow_only: "shadow.relShadowOnly", level_differs: "shadow.relLevel" };
const VIA_KEY = { hr: "shadow.viaHr", pls: "shadow.viaPls", spo2: "shadow.viaSpo2", art: "shadow.viaArt", nbp: "shadow.viaNbp" };
const CODE_LABEL = { heart_rate: "board.chHr", spo2: "board.chSpo2", sbp: "board.chSbp", map: "board.chMap" };

export function ShadowFindingsBox({ shadow, level = 2 }) {
  const { t } = useI18n();
  if (!shadow) return null;
  const inputs = Object.entries(shadow.vitals ?? {});
  const findings = shadow.findings ?? [];
  return (
    <div data-shadow-box="" className="rounded-box border border-dashed border-line2">
      <Box title={t("shadow.title")} icon="eye" level={level} right={<Tag tone="warn">{t("shadow.tag")}</Tag>}>
        <p className="m-0 text-12.5 text-mute">{t("shadow.intro")}</p>
        <p className="m-0 mt-2 text-13 font-semibold">
          {t("shadow.news2", { total: shadow.news2?.total ?? "—" })}
          {shadow.news2?.partial ? <StatusPill tone="neutral" className="ml-1">{t("shadow.news2Partial")}</StatusPill> : null}
        </p>
        {inputs.length > 0 ? (
          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 min-[641px]:grid-cols-4">
            {inputs.map(([code, v]) => (
              <div key={code} className="min-w-0">
                <dt className="font-text text-10 font-bold uppercase tracking-[.06em] text-mute">{t(CODE_LABEL[code] ?? code)}</dt>
                <dd className="m-0 font-data text-14 font-bold text-ink">
                  {v.value}<small className="ml-0.5 font-text text-10.5 font-semibold text-mute">{v.unit}</small>
                  <small className="ml-1 font-text text-10.5 text-mute">
                    {t("shadow.via", { via: t(VIA_KEY[v.via] ?? "shadow.viaHr") })} · {hhmm(Date.parse(v.at))}
                  </small>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {findings.length === 0 ? (
          <Note tone="info" className="mt-2">{t("shadow.none")}</Note>
        ) : (
          <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
            {findings.map((f) => (
              <li key={f.kind} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <StatusPill tone={REL_TONE[f.relation] ?? "neutral"}>{t(REL_KEY[f.relation] ?? "shadow.relShadowOnly")}</StatusPill>
                <span lang="en" className="min-w-0 flex-1 text-12.5 text-ink">{f.summary}</span>
                <span className="text-11 text-mute">{f.severity}</span>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}
```

(`Box` takes `right` — `SettingsScreen` uses it. If `StatusPill` has no `className`, drop it.)

- [ ] **Step 4: Run** `npx vitest run src/liveAdapters.test.js src/live/i18n/strings.test.js src/live/screens/patient/shadow` — green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js dashboard/src/live/i18n/strings/shadow.js dashboard/src/live/i18n/strings/index.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/patient/shadow
git commit -m "feat(dashboard): the shadow key on the patient, the shadow words in four languages, and the «Gölge öneri · alarm kapalı» box (Aşama B, D7)"
```

---

### Task 10: The screens — patient, bed card, Settings

**Files:**
- Modify: `dashboard/src/live/screens/common/MonitorStrip.jsx` (`stripOn`) + test; `screens/devices/DevicesScreen.jsx` + test
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx` (+ test)
- Modify: `dashboard/src/live/screens/beds/BedCard.jsx` (+ test)
- Modify: `dashboard/src/live/screens/settings/SettingsScreen.jsx` (+ test), `data/shadowStore.js` (+ test)

- [ ] **Step 1: `stripOn`** accepts `"shadow"` and `"rules"`: `export const stripOn = (data) => data?.stage === "shadow" || data?.stage === "rules";` (+ its test). The device screen shows `feed.rules_state === "error"` as `t("shadow.laneError")` beside the feed chip (one line + test).

- [ ] **Step 2: Patient screen.** `Vitals` takes `shadow`; after the measured cards it renders one card per `shadow.vitals` entry — the same card shape, the value in plain `text-ink` (never the vital colour), `<small>{t("shadow.via", { via: t(VIA_KEY[v.via]) })}</small>` under the value with `hhmm(v.at)`, `data-shadow-vital=""`. The box «Gölge öneri» goes **after** the `MonitorStrip` and before «Motorun bulguları»: `<ShadowFindingsBox shadow={patient.shadow} />`. Tests: a patient with `shadow` shows the box and two shadow vital cards; without, neither; the real `Finding` list is unchanged.

- [ ] **Step 3: Bed card.** Under the strip slot (inside `data-monitor-slot`, after the strip), when `patient?.shadow`: `<Tag tone="warn">{patient.shadow.findings.length ? t("shadow.cardTag", { total: patient.shadow.news2?.total ?? "—" }) : t("shadow.cardNone")}</Tag>`. Tests: tag text for both cases; nothing when `shadow` is null; the risk pill and the alarm rows are unaffected.

- [ ] **Step 4: Settings.** `shadowStore` gains `findings(days = 7)` — `GET /infinity-shadow/findings?days=7` with the same bearer and fetch helper the board poll uses, returning the parsed body or throwing. A new section «Uyarsaydı — son 7 gün» in the tab that holds the monitor legend, rendered only when `shadow.data?.stage === "rules"`: fetches on mount, shows `weekUnavailable` on failure, `weekNone` when empty, else a `Table` with the five columns (patient id, kind, severity, opened as `dd.MM hh:mm`, cleared the same or «açık»), newest first, with `weekHelp` under the heading. Tests: the three states.

- [ ] **Step 5: Run** the touched tests, then `npx vitest run` whole, then `npx vite build`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/live/screens/patient dashboard/src/live/screens/beds dashboard/src/live/screens/settings dashboard/src/live/screens/common dashboard/src/live/screens/devices dashboard/src/live/data/shadowStore.js dashboard/src/live/data/shadowStore.test.js
git commit -m "feat(dashboard): Aşama B on the screens — monitor-sourced vitals with their source, the shadow box, the bed card's amber tag, Settings' «Uyarsaydı — son 7 gün» (D7)"
```

---

### Task 11: Deploy configuration and documents

**Files:**
- Modify: `deploy/local/docker-compose.yml:75-78`, `deploy/local/.env.example:132-153`, `homunculus-engine/tests/test_local_compose_env.py:35`
- Modify: `deploy/infinity/README.md` (the stage and rollback sections), `docs/homunculus-rehber-TR.md` (§3.6, after the monitor strip paragraph), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (a row `Infinity-B`)

- [ ] **Step 1:** compose passes `INFINITY_RULES_PARAMETERS: ${INFINITY_RULES_PARAMETERS:-}`; `.env.example` documents `rules` (what it does, that `alarms` is still not in this build) and the allowlist with its default; the compose-env test pins the new name.
- [ ] **Step 2:** README: a section **Aşama B — `rules`**: the switch, the allowlist, migration 0013 (`alembic upgrade head` in the deploy blocks, as 0012's), the rollback tiers (G-1 unchanged; **G-2b** `INFINITY_CLINICAL_STAGE=shadow` → the samples stop, the findings end with `shadow_alert_cleared reason: stage`, the real board unchanged; G-2 `off` as before), what the ward sees, and that the hospital's written acceptance (parent §8.12) precedes switching it on.
- [ ] **Step 3:** the Turkish guide: a «Gölge öneri · alarm kapalı» paragraph for the ward (what it is: the rules' answer to the monitor's unvalidated numbers; what it is not: an alarm; where it appears; the source tags HR/PLS/ART/NBP; the weekly list; the monitor stays the primary alarm).
- [ ] **Step 4:** the roadmap row.
- [ ] **Step 5:** run `tests/test_local_compose_env.py`; commit:

```bash
git add deploy/local/docker-compose.yml deploy/local/.env.example homunculus-engine/tests/test_local_compose_env.py deploy/infinity/README.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git commit -m "docs(infinity): Aşama B — the stage rules and the allowlist in compose and .env, the README's stage and rollback, the ward's «Gölge öneri» paragraph, the roadmap row"
```

---

### Task 12: Final review, gates, fold

- [ ] **Step 1:** engine no-DB gate whole; DB gate for `tests/test_monitor_samples.py`, `tests/test_audit_postgres.py` with `TEST_DATABASE_URL`; dashboard whole; `vite build`; CRLF check on every touched file; no PHI (grep the tests for real-looking ids).
- [ ] **Step 2:** an opus final review of the whole branch against the spec (D1–D13): FIX FIRST on anything that lets a shadow finding reach the bell, the notifier, the ack store or an `alert`/`ingest` audit row; then quality.
- [ ] **Step 3:** fold: this plan's «Done on the branch» table (task → commit → what it pinned), the departures X1…, the open items O1… (carry the spec's O1–O5 and add: Lane B's admission chart passing `app.state.shadow_mirror`; the az/ru/en native review of `shadow.js`), the counts.
- [ ] **Step 4:** push; tell the user the branch is ready and that the VM deploy (migration 0013 + stage `rules` + the allowlist) is a separate block set after their word and the hospital's acceptance.

---

## Plan self-review

- **Spec coverage:** D1 (T4, T6), D2 (T1), D3 (T1), D4 (T4), D5 (T2, T4), D6 (T4, T5), D7 (T9, T10), D8 (T3, T4), D9 (T2, T4, T6), D10 (T1, T6, T11), D11 (T7), D12 (T8), D13 (out). §5's lane-failure case: T4's `guard` + T6's test. The restart's open-findings seeding: T4. `feed.rules_state`: T6, T10.
- **Placeholders:** none left — the four language blocks of `shadow.js` are written out; the FHIR shapes and the discharge helper in T6's tests are named existing helpers to import (`tests/test_infinity_shadow_isolation.py` `TABLE`/`_body`, `tests/test_infinity_shadow_equivalence.py` `_encounter`/`load_scenario`, `tests/test_api_discharge.py`), with the inline fallback stated.
- **Type consistency:** `pick(view, allowed, *, now)`, `Sampler.due/taken(pid, candidate, *, now)`, `ShadowLane(allowed, samples, audit, enabled)`, `install(hospital, real, *, now)`, `sample(hospital, views, cards, *, now, real)`, `findings(hospital, pid, real, *, now, linked)`, `patient_board(..., shadow=)`, `board_snapshot(..., shadow_for=)`, `SampleStore.append/since(hospital, since, *, now)/prune(*, before)`, `_card(hospital, pid, identity, now)`, `_shadow_for(hospital, pid, now)` — used with these shapes throughout.

## Done on the branch (fold, 2026-10-27)

The plan is the branch `feat/infinity-asama-b` at `3bd1913`, off `main` `b985810`, carrying `main` `ff5348a` (B1a) since `8fb27ac`.

| Task | Commit | What it pinned |
|---|---|---|
| 1 | `a3ef685`, review `9616665` | the stage `rules`, `INFINITY_RULES_PARAMETERS` (default, `parameters_unknown`, an empty list refused, a `rules` stage needs parameters), `pick` (hr→pls, art→nbp ≤ 1 h stamped at `changed_at`, wire units, names outside `FEEDS` never feed, naive stamps refused); 14 tests |
| 2 | `e39bdad`, review `9d25c0e` | `PatientState.drop_source/copy`, `Engine.copy/adopt` over `_PER_PATIENT`, `repository.put`; a profile-only patient survives `adopt`; D1 independence pinned (copy shares nothing; a shadow ingest leaves the real engine's six dicts unchanged); 11 tests |
| 3 | `f72958b`, `5bda27f` | `monitor_samples` (`InMemorySamples`, `PostgresSamples`, `append_many`, `durable`, 24 h in memory / 30 days durable); migration 0013 (after B1a's 0012) with the audit index `(tenant, event_type, id)`; the Postgres round trip incl. `downgrade` |
| 4 | `27516cc`, reviews `6427581`, `6fac4ba`, `18ef3a6` | `Sampler` (minute per (patient, code), stamp per (patient, code, source)), `ShadowLane` (`install` = copy + 24 h replay + unbounded seeding, `admitted=`, backoff 30→600 s, row guards; `Link(source, since, provisional, first_pass_at)` forward-only, provisional after a restart, ended by the device or a 120 s grace; `Open(alert, row_id, since)`; `relation` + `since`; `close_open`; the per-kind error window 300 s; adopt retries with the close reason; doors never retry an install; the lane clock); 48 tests |
| 5 | `e89587c` | `patient_board(shadow=)`, `board_snapshot(shadow_for=)`; 2 tests |
| 6 | `a3e039a`, `cb3ea75`, review `18d2070` | the lane per hospital in `_ensure` (+ `close_open` below `rules`), the mirror at the four doors (after `sync_alerts`), `forget` + occupancy reset in `retire_and_publish`'s `finally`, occupancy reset on every identity write, `_card`/`_identity_card`/`_shadow_for` (identity-only patients never created in the real engine; tombstones → `tombstone_board`; sampler frames through an uncounted bed map), `_sample_and_publish` fully guarded, `GET /infinity-shadow/findings` (scoped, `days` 1–7 as text), the prune loop at every stage (missing table logged hourly), `prodserver._samples`, `AuditLog.records(event_types=)` + `alarm_quality.EPISODE_KINDS`, `app.state.shadow_mirror/shadow_profile/shadow_occupancy_reset`; 20 tests |
| 7 | `857c16b`, `18ef3a6` | the gate: the third run (stage `rules` vs `off`: every clinical output identical after stripping `shadow` and the two shadow kinds; the sampler's republishes compared as republishes with the antibiotic-clock drift checked; `/alarm-quality?limit=20` recorded; a restart, a profile PUT and a link end in both runs; a negative control); isolation (`RULES_FORBIDDEN` + transitive subprocess check, the audit-kind regex, `rules` on, `alarms` off); config (`rules` is a stage) |
| 8 | `99555e3` | `hide_parameters=True` on every engine (grep test) |
| 9 | `e89eaff` | `patient.shadow`, `strings/shadow.js` (four languages), `ShadowFindingsBox` (27 tests) |
| 10 | `20e238a`, review `90e635e`, `68f1d20` | shadow vital cards (label/unit by code, `text-ink`, source tag, stamp + age), the box after the strip, the bed tag (`cardTag` with age / `cardNone` / `cardUnknown`), `stripOn` + `monitor.fullRules`, the device screen's lane error, Settings «Uyarsaydı — son 7 gün» (`shadow_only` only, `board.view` only, `min-w-0`), `shadowStore.findings` + `backendApi.shadowFindings` (1–7), `dayStamp`, the house `News2` with its caveats in the box, `alertsEqual` + the kept alerts array (no re-raise of a dismissed notification), `boundaries` + `monitorAlarmPath` gates |
| 11 | `6fa0730`, `3bd1913` | compose + `.env.example` + the compose-env test, README «Aşama B — rules» (switch, allowlist, 0013, rollback G-1/G-2b/G-2, the `/audit` and `/alarm-quality` notes, the prerequisite hooks), the guide's «Gölge öneri · alarm kapalı» bullet and corrections, the roadmap rows |
| merge | `8fb27ac`, `457a2bd` | `main` `ff5348a` (B1a) merged — Lane B's `_occupants` kept byte-identical, the wiring re-applied; BoardLink takes `mirror`, `mirror_profile`, `occupancy_reset`, `card`, `identity_card`; `chart_weight` mirrors, `apply_profile` mirrors, `put_identity` resets the occupancy cache after the identity write, every admission frame carries `shadow`; the discharged-number refusals run first, unchanged |
| aside | `5280667` (= `main` `b985810`) | the escalation-cycle discharge test was a date bomb (its tombstone crossed the 24 h retention on 27.10 08:30Z); stamped at the wall clock |

**Reviews.** Opus reviews of Tasks 1, 2, 4 (twice), 6, the dashboard (9+10) and the whole branch; every FIX FIRST was closed on the branch. The final review: APPROVE; 15 mutants killed by the gate and the unit tests together.

**Counts at `3bd1913`.** Engine no-DB: **2789 passed / 822 skipped / 0 failed**; DB-backed against the local `homunculus_test`: `test_monitor_samples` + `test_audit_postgres` + `test_audit_event_types` 23 passed, the migration tests 15 passed, `test_admission_api` 50 passed / 1 skipped, the admission/discharge/structure/workflow files 119 passed. Dashboard: **104 files / 2956 tests / 0 failed**; `vite build` ok (+11.6 kB raw, +3.3 kB gzip over the base). CRLF on every touched file; no PHI.

## Departures

| # | Where | What | Why |
|---|---|---|---|
| X1 | Task 4 | D5 "forward only" was missing from the plan's code: `Link.since` (set when a link is first seen or its device changes; a candidate stamped before it is skipped), provisional links after a restart (ended when the device reports elsewhere or after a 120 s grace), `install(admitted=)` skips non-admitted patients | the T4 review: a bed's new patient was fed the previous patient's cuff reading |
| X2 | Task 4 | the minute clock is per (patient, code) and the stamp memory per (patient, code, source); both seeded at a restart | one cuff measurement gave ten identical rows; NBP was re-sampled right after a restart |
| X3 | Task 4 | open findings are seeded from the lane's own two audit kinds without a time bound (newest-first, capped per kind, the clears read from the oldest opening); `close_open` replaces `clear_all` and runs below `rules` too (D10); `relation` and `since` travel in the payload and the findings | a finding open > 24 h was opened twice; D10's stage rollback never wrote a row; the weekly list needs `shadow_only` |
| X4 | Task 4 | install backoff 30→600 s with row-level guards; the per-kind error state with a 300 s window; adopt retries with the pending close reason; the doors never retry an install (only a pass does); `ShadowLane(clock=shadow_clock)` | the re-review: a failing install re-ran the 24 h replay on every POST; a stuck/flapping state; a failed adopt left old readings; two clocks |
| X5 | Task 2 | `PatientState.ingest` uses `bisect.insort` (same order as append + stable sort); `Engine.copy` copies series lists instead of deep-copying observations (2 ms vs 2.2 s for 13 × 20k); `_PER_PATIENT`; `repository.put` | the replay was O(n²); the copy doubled memory |
| X6 | Task 6 | the sampler publishes `_identity_card` (identity-only + `shadow`) for a patient the real engine never measured, `tombstone_board` for a tombstone, and its frames resolve beds through an uncounted bed map | `patient_board` would have created the patient in the real engine (D1); a retired number could have shown its name; the gate caught the discovery counter moving |
| X7 | Task 6 | the mirror sits after `sync_alerts`; `forget` and the occupancy reset in `retire_and_publish`'s `finally`; the occupancy cache is reset on every identity write (`/ingest`, the kabul form) via `app.state.shadow_occupancy_reset` | the lifecycle hook before any audit write; a transfer left the link stale ≤ 10 s |
| X8 | Task 6 | `AuditLog.records(event_types=)` on the three backends; `/alarm-quality` reads only `EPISODE_KINDS` at every stage (its figures may change at `off` too, more correct); the gate records `/alarm-quality?limit=20` | shadow rows consumed the report's read cap (D7: the counters must not move) |
| X9 | Task 10 | a frame that leaves the real alerts unchanged keeps the previous alerts array (`alertsEqual`) — a dismissed OS notification is not re-raised by the sampler's republishes; applies to real frames too; page-level changes still re-raise | D1/D7 on the dashboard side |
| X10 | Tasks 9–10 | `StatusPill` has no `warn` tone → `shadow_only`/`level_differs` use `att`; the house `News2` (missing/stale/assumed/red_param) in the box; «none» only from a live board (`noneUnknown`, `cardUnknown`); ages on the tag, the box and each shadow card; `monitor.fullRules` at `rules`; the week list filtered to `shadow_only` and gated on `board.view`; `shadow.since` = "açılış {time}" (suffix harmony); severity words via `riskStyle`; unknown values printed as sent | the dashboard review |
| X11 | Tasks 3, 6 | durable samples and the prune loop at every stage (a missing table is logged hourly until 0013 is applied); 24 h retention in memory; one write per sampling pass (`append_many`); `days` parsed as text → 400 | retention held after a rollback; latency; the docstring's 400 |
| X12 | merge | BoardLink takes the lane's hooks and the card builders as constructor arguments; migration 0013 carries the audit index | Lane B's form must feed the lane after its guards (final review); the lane's and `/alarm-quality`'s kind-filtered reads |
| X13 | aside | `tests/test_api_discharge.py`'s tombstone stamped at the wall clock (cherry-picked to `main` as `b985810`) | a date-dependent test found red on `main` |

## Open items

- **O1–O5** see the spec §8 (baselines on the card, the weekly acceptance figure before C, 72 h trend charts of samples, the NCE discharged-number note, PLS as a fallback).
- **O6** NEWS2 flaps near a threshold under monitor jitter (≈ 277 shadow rows/h for 13 beds in a synthetic probe): a hysteresis belongs before C; it also makes the weekly list noisy (O2).
- **O7** The start-up replay filters on `(hospital, captured_at)`; 0013's `(hospital, patient_id, captured_at)` index fits it only partly — add `(hospital, captured_at)` later if the first request after a restart is slow.
- **O8** 0013 builds the audit index inside its transaction at API start: read the VM's `audit` row count before the deploy and expect that build time once.
- **O9** Native az/ru/en review of `strings/shadow.js` and `monitor.fullRules` (as every namespace).
- **O10** An ADT `discharge_identity` does not reset the occupancy cache itself (the retire door does); the only gap is a retirement refused before that door.
- **O11** `open_critical` builds the shadow picture through `_card` and ignores it (harmless extra work).
- **O12** The DB-backed tests reset the shared local `homunculus_test` schema (run them alone).
- **O13** Lane B's review of the `admission/` hunks (`457a2bd`) is pending; the VM deploy of Aşama B (0013 + `INFINITY_CLINICAL_STAGE=rules` + the allowlist) is a separate block set after the user's word and the hospital's written acceptance (parent design §8.12).
- **O14** The device screen reads «gölge motor: hata» for up to 5 min after a failed install that has since succeeded (the 300 s window).
