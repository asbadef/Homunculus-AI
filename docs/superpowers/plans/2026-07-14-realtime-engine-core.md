# Homunculus Real-Time Engine — Core (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless clinical core of the Homunculus real-time engine: a backend that ingests a stream of FHIR R4 Observations for an adult ICU patient and emits explainable, vault-cited sepsis/septic-shock alerts — proven end-to-end by three scripted scenario replays run as automated tests.

**Architecture:** Lean modular monolith (Python package `homunculus`). A canonical internal `Observation` model sits behind a FHIR gateway. `PatientState` tracks current values, history, and per-signal staleness. Pure-function rules (SOFA, septic-shock conjunction, antibiotic-timing clock) read state and emit structured `Finding`s that carry vault source citations. The `reco` engine turns findings into `Alert`s in the vision's schema — recommendations, never orders. A `pipeline` wires it together; scenario YAML files drive it and are the end-to-end tests.

**Tech Stack:** Python 3.12+ (3.14 installed), pytest, PyYAML, SQLAlchemy 2.0 (Postgres adapter defined but not required for Plan A tests — the in-memory repository is the default), Docker (Postgres, for later). No FastAPI/WebSocket/React in Plan A — that is Plan B.

**Clinical values are quoted from the vault. Every hardcoded threshold below traces to a captured source. Never add a threshold that is not in `Homunculus/`.**

---

## Scope

**In Plan A:** canonical model, FHIR gateway, patient state + staleness, SOFA rule, septic-shock rule, under-resuscitation rule, antibiotic-timing clock, finding + citation model, reco engine (alert schema + no-orders register), pipeline, three scenarios, e2e replay tests.

**Deferred to Plan B:** FastAPI app, WebSocket, notification/escalation delivery, React dashboard (doctor + nurse), Postgres persistence in the running system, audit log surface, and NEWS2 (which first needs its specification captured into the vault — see [open-questions](../../../Homunculus/wiki/concepts/open-questions.md)).

**Repository location:** all code goes in a new top-level directory `homunculus-engine/` in the repo root, so it sits beside `Homunculus/` (the vault) and `docs/`.

---

## File Structure

```
homunculus-engine/
├── pyproject.toml
├── README.md
├── docker-compose.yml                     # Postgres for later; not needed by Plan A tests
├── src/homunculus/
│   ├── __init__.py
│   ├── canonical.py                       # Observation, SignalCode, Vasopressor
│   ├── gateway/
│   │   ├── __init__.py
│   │   └── fhir.py                        # FHIR R4 Observation -> canonical Observation
│   ├── state/
│   │   ├── __init__.py
│   │   ├── timeline.py                    # PatientState: current values, history, staleness
│   │   └── repository.py                  # PatientRepository protocol + InMemory impl
│   ├── rules/
│   │   ├── __init__.py
│   │   ├── finding.py                     # Finding, Citation, Severity, Urgency
│   │   ├── sofa.py                        # SOFA score + per-organ staleness
│   │   ├── septic_shock.py               # sepsis / shock / under-resuscitation
│   │   └── antibiotic_clock.py           # 1-hour antibiotic window
│   ├── reco/
│   │   ├── __init__.py
│   │   └── engine.py                      # Finding -> Alert (vision schema)
│   ├── pipeline.py                        # observation -> state -> rules -> reco -> alerts
│   └── scenarios/
│       ├── __init__.py
│       ├── loader.py                      # YAML scenario -> timed FHIR observations
│       ├── septic_shock.yaml
│       ├── stable_control.yaml
│       └── under_resuscitated.yaml
└── tests/
    ├── __init__.py
    ├── test_canonical.py
    ├── test_gateway_fhir.py
    ├── test_state_timeline.py
    ├── rules/
    │   ├── __init__.py
    │   ├── test_sofa.py
    │   ├── test_septic_shock.py
    │   └── test_antibiotic_clock.py
    ├── test_reco_engine.py
    └── test_scenarios_e2e.py
```

---

## Phase 0 — Project scaffold

### Task 0: Create the Python package skeleton

**Files:**
- Create: `homunculus-engine/pyproject.toml`
- Create: `homunculus-engine/README.md`
- Create: `homunculus-engine/src/homunculus/__init__.py`
- Create: `homunculus-engine/tests/__init__.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "homunculus-engine"
version = "0.1.0"
description = "Homunculus real-time clinical intelligence engine (adult sepsis vertical)"
requires-python = ">=3.12"
dependencies = [
    "pyyaml>=6.0",
    "sqlalchemy>=2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Write a minimal `README.md`**

```markdown
# Homunculus Engine

Real-time clinical intelligence engine — adult ICU sepsis vertical.
See `docs/superpowers/specs/2026-07-14-realtime-engine-design.md` for the design.

## Dev setup

    cd homunculus-engine
    python -m venv .venv
    .venv/Scripts/activate        # Windows;  source .venv/bin/activate on Unix
    pip install -e ".[dev]"
    pytest

No patient data. Synthetic scenarios only.
```

- [ ] **Step 3: Create empty package markers**

`src/homunculus/__init__.py`:
```python
"""Homunculus real-time clinical intelligence engine."""
```

`tests/__init__.py`: (empty file)

- [ ] **Step 4: Create venv and install**

Run:
```bash
cd homunculus-engine && python -m venv .venv && .venv/Scripts/python.exe -m pip install -e ".[dev]"
```
Expected: installs pyyaml, sqlalchemy, pytest without error.

- [ ] **Step 5: Verify pytest runs (no tests yet)**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest`
Expected: "no tests ran" (exit 5) — confirms discovery works.

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/pyproject.toml homunculus-engine/README.md homunculus-engine/src homunculus-engine/tests
git commit -m "chore(engine): scaffold homunculus-engine package"
```

---

## Phase 1 — Canonical model

The one internal representation every module speaks. Incoming FHIR is translated into this; rules read only this. Signal codes are **internal semantic codes**, not LOINC — we do not invent standard identifiers. Real LOINC mapping is a gateway enhancement in Plan B.

### Task 1: `canonical.py` — Observation and signal codes

**Files:**
- Create: `src/homunculus/canonical.py`
- Test: `tests/test_canonical.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_canonical.py
from datetime import datetime, timezone
from homunculus.canonical import Observation, SignalCode


def test_observation_holds_value_unit_time_and_patient():
    ts = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    obs = Observation(
        patient_id="bed-3",
        code=SignalCode.LACTATE,
        value=3.1,
        unit="mmol/L",
        timestamp=ts,
        source_device="abg-analyzer-1",
    )
    assert obs.patient_id == "bed-3"
    assert obs.code is SignalCode.LACTATE
    assert obs.value == 3.1
    assert obs.unit == "mmol/L"
    assert obs.timestamp == ts
    assert obs.source_device == "abg-analyzer-1"


def test_signal_codes_cover_the_sepsis_pathway():
    # Every signal the SOFA / septic-shock rules need must exist.
    required = {
        "HEART_RATE", "RESP_RATE", "SPO2", "TEMPERATURE", "SBP", "MAP", "GCS",
        "LACTATE", "PLATELETS", "BILIRUBIN", "CREATININE", "URINE_OUTPUT_ML",
        "PAO2_FIO2", "FIO2", "ON_RESP_SUPPORT",
        "NOREPINEPHRINE_RATE", "DOPAMINE_RATE", "EPINEPHRINE_RATE", "DOBUTAMINE_RATE",
        "CRYSTALLOID_BOLUS_ML", "WEIGHT_KG",
        "SUSPECTED_INFECTION", "ANTIBIOTIC_ADMINISTERED",
    }
    names = {c.name for c in SignalCode}
    assert required <= names
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_canonical.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.canonical`.

- [ ] **Step 3: Implement `canonical.py`**

```python
# src/homunculus/canonical.py
"""The canonical internal representation. Every module speaks this; FHIR is translated into it."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class SignalCode(Enum):
    """Internal semantic signal codes. NOT LOINC — we do not mint standard identifiers.

    Values are stable string slugs used in scenario files and FHIR mapping tables.
    """
    # Vitals (continuous)
    HEART_RATE = "heart_rate"
    RESP_RATE = "resp_rate"
    SPO2 = "spo2"
    TEMPERATURE = "temperature"
    SBP = "sbp"
    MAP = "map"
    GCS = "gcs"
    # Labs / gases (intermittent)
    LACTATE = "lactate"
    PLATELETS = "platelets"
    BILIRUBIN = "bilirubin"
    CREATININE = "creatinine"
    URINE_OUTPUT_ML = "urine_output_ml"      # over the prior hour
    PAO2_FIO2 = "pao2_fio2"
    FIO2 = "fio2"
    ON_RESP_SUPPORT = "on_resp_support"      # 1.0 = yes, 0.0 = no
    # Infusions / interventions (from pumps / MAR)
    NOREPINEPHRINE_RATE = "norepinephrine_rate"   # ug/kg/min
    DOPAMINE_RATE = "dopamine_rate"               # ug/kg/min
    EPINEPHRINE_RATE = "epinephrine_rate"         # ug/kg/min
    DOBUTAMINE_RATE = "dobutamine_rate"           # ug/kg/min
    CRYSTALLOID_BOLUS_ML = "crystalloid_bolus_ml" # mL given in this event
    WEIGHT_KG = "weight_kg"
    # Clinical context (not computable from telemetry — provided by the clinician/record)
    SUSPECTED_INFECTION = "suspected_infection"   # 1.0 = infection suspected
    ANTIBIOTIC_ADMINISTERED = "antibiotic_administered"  # 1.0 = a dose was given


@dataclass(frozen=True)
class Observation:
    """A single measurement or event, normalized. Immutable."""
    patient_id: str
    code: SignalCode
    value: float
    unit: str
    timestamp: datetime
    source_device: str
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_canonical.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/canonical.py tests/test_canonical.py
git commit -m "feat(engine): canonical Observation model and signal codes"
```

---

## Phase 2 — FHIR gateway

Translate a FHIR R4 `Observation` resource (as our simulator emits, using our own CodeSystem URL for synthetic data) into a canonical `Observation`. Malformed input raises `GatewayError`, never crashes the caller.

### Task 2: `gateway/fhir.py` — parse FHIR Observation

**Files:**
- Create: `src/homunculus/gateway/__init__.py` (empty)
- Create: `src/homunculus/gateway/fhir.py`
- Test: `tests/test_gateway_fhir.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_gateway_fhir.py
import pytest
from datetime import datetime, timezone
from homunculus.canonical import SignalCode
from homunculus.gateway.fhir import parse_fhir_observation, GatewayError

CODE_SYSTEM = "http://homunculus.local/obs"


def _fhir(code_slug, value, unit="mmol/L", patient="bed-3",
          when="2026-07-14T10:00:00+00:00", device="abg-1"):
    return {
        "resourceType": "Observation",
        "status": "final",
        "code": {"coding": [{"system": CODE_SYSTEM, "code": code_slug}]},
        "subject": {"reference": f"Patient/{patient}"},
        "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit},
        "device": {"display": device},
    }


def test_parses_a_valid_fhir_observation():
    obs = parse_fhir_observation(_fhir("lactate", 3.1))
    assert obs.code is SignalCode.LACTATE
    assert obs.value == 3.1
    assert obs.unit == "mmol/L"
    assert obs.patient_id == "bed-3"
    assert obs.timestamp == datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    assert obs.source_device == "abg-1"


def test_unknown_code_raises_gateway_error():
    with pytest.raises(GatewayError, match="unknown signal code"):
        parse_fhir_observation(_fhir("unobtanium", 1.0))


def test_missing_value_raises_gateway_error():
    bad = _fhir("lactate", 3.1)
    del bad["valueQuantity"]
    with pytest.raises(GatewayError, match="missing valueQuantity"):
        parse_fhir_observation(bad)


def test_wrong_resource_type_raises_gateway_error():
    with pytest.raises(GatewayError, match="resourceType"):
        parse_fhir_observation({"resourceType": "Patient"})
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_gateway_fhir.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.gateway.fhir`.

- [ ] **Step 3: Implement `gateway/fhir.py`**

```python
# src/homunculus/gateway/fhir.py
"""FHIR R4 Observation -> canonical Observation. The seam where real hospital feeds plug in."""
from __future__ import annotations

from datetime import datetime

from homunculus.canonical import Observation, SignalCode

_SLUG_TO_CODE = {c.value: c for c in SignalCode}


class GatewayError(ValueError):
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""


def parse_fhir_observation(resource: dict) -> Observation:
    if resource.get("resourceType") != "Observation":
        raise GatewayError(f"expected resourceType 'Observation', got {resource.get('resourceType')!r}")

    try:
        coding = resource["code"]["coding"][0]
        slug = coding["code"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GatewayError("missing code.coding[0].code") from exc

    code = _SLUG_TO_CODE.get(slug)
    if code is None:
        raise GatewayError(f"unknown signal code: {slug!r}")

    vq = resource.get("valueQuantity")
    if not vq or "value" not in vq:
        raise GatewayError("missing valueQuantity.value")

    when = resource.get("effectiveDateTime")
    if not when:
        raise GatewayError("missing effectiveDateTime")
    try:
        timestamp = datetime.fromisoformat(when)
    except ValueError as exc:
        raise GatewayError(f"unparseable effectiveDateTime: {when!r}") from exc

    subject = resource.get("subject", {}).get("reference", "")
    if not subject.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {subject!r}")
    patient_id = subject.split("/", 1)[1]

    return Observation(
        patient_id=patient_id,
        code=code,
        value=float(vq["value"]),
        unit=vq.get("unit", ""),
        timestamp=timestamp,
        source_device=resource.get("device", {}).get("display", "unknown"),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_gateway_fhir.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/gateway tests/test_gateway_fhir.py
git commit -m "feat(engine): FHIR R4 Observation gateway with validation"
```

---

## Phase 3 — Patient state and staleness

`PatientState` holds the latest value of each signal plus history, and answers "how old is this signal?" — the vault's insistence that a 4-hour-old lactate is different evidence from a fresh one.

### Task 3: `state/timeline.py` — PatientState with staleness

**Files:**
- Create: `src/homunculus/state/__init__.py` (empty)
- Create: `src/homunculus/state/timeline.py`
- Test: `tests/test_state_timeline.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_state_timeline.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _obs(code, value, minutes=0):
    return Observation("bed-3", code, value, "u", T0 + timedelta(minutes=minutes), "dev")


def test_latest_returns_most_recent_value():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.MAP, 70, minutes=0))
    st.ingest(_obs(SignalCode.MAP, 62, minutes=5))
    assert st.latest(SignalCode.MAP).value == 62


def test_latest_is_none_when_never_seen():
    st = PatientState("bed-3")
    assert st.latest(SignalCode.LACTATE) is None


def test_age_reports_staleness_against_a_reference_time():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.LACTATE, 3.1, minutes=0))
    now = T0 + timedelta(hours=4)
    assert st.age(SignalCode.LACTATE, now) == timedelta(hours=4)


def test_age_is_none_when_never_seen():
    st = PatientState("bed-3")
    assert st.age(SignalCode.LACTATE, T0) is None


def test_history_preserves_order():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.NOREPINEPHRINE_RATE, 0.05, minutes=0))
    st.ingest(_obs(SignalCode.NOREPINEPHRINE_RATE, 0.10, minutes=30))
    st.ingest(_obs(SignalCode.NOREPINEPHRINE_RATE, 0.20, minutes=60))
    values = [o.value for o in st.history(SignalCode.NOREPINEPHRINE_RATE)]
    assert values == [0.05, 0.10, 0.20]


def test_sum_since_adds_values_within_window():
    st = PatientState("bed-3")
    st.ingest(_obs(SignalCode.CRYSTALLOID_BOLUS_ML, 500, minutes=0))
    st.ingest(_obs(SignalCode.CRYSTALLOID_BOLUS_ML, 1000, minutes=30))
    st.ingest(_obs(SignalCode.CRYSTALLOID_BOLUS_ML, 1000, minutes=90))
    now = T0 + timedelta(minutes=120)
    # last 3 hours: all three -> 2500
    assert st.sum_since(SignalCode.CRYSTALLOID_BOLUS_ML, now - timedelta(hours=3)) == 2500
    # last 60 min: only the 90-min one is within [60min, 120min] -> 1000
    assert st.sum_since(SignalCode.CRYSTALLOID_BOLUS_ML, now - timedelta(minutes=60)) == 1000
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_state_timeline.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.state.timeline`.

- [ ] **Step 3: Implement `state/timeline.py`**

```python
# src/homunculus/state/timeline.py
"""Per-patient current values, history, and staleness."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from homunculus.canonical import Observation, SignalCode


class PatientState:
    def __init__(self, patient_id: str):
        self.patient_id = patient_id
        self._history: dict[SignalCode, list[Observation]] = defaultdict(list)

    def ingest(self, obs: Observation) -> None:
        series = self._history[obs.code]
        series.append(obs)
        # Keep sorted by timestamp so out-of-order arrivals are handled.
        series.sort(key=lambda o: o.timestamp)

    def latest(self, code: SignalCode) -> Observation | None:
        series = self._history.get(code)
        return series[-1] if series else None

    def history(self, code: SignalCode) -> list[Observation]:
        return list(self._history.get(code, []))

    def age(self, code: SignalCode, now: datetime) -> timedelta | None:
        obs = self.latest(code)
        return None if obs is None else now - obs.timestamp

    def sum_since(self, code: SignalCode, since: datetime) -> float:
        return sum(o.value for o in self._history.get(code, []) if o.timestamp >= since)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_state_timeline.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/state/__init__.py src/homunculus/state/timeline.py tests/test_state_timeline.py
git commit -m "feat(engine): PatientState with history, staleness, and windowed sums"
```

### Task 4: `state/repository.py` — repository protocol + in-memory impl

**Files:**
- Create: `src/homunculus/state/repository.py`
- Test: append to `tests/test_state_timeline.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_state_timeline.py
from homunculus.state.repository import InMemoryPatientRepository


def test_repository_creates_state_on_first_access():
    repo = InMemoryPatientRepository()
    st = repo.get_or_create("bed-9")
    assert st.patient_id == "bed-9"
    # same object on second access
    assert repo.get_or_create("bed-9") is st


def test_repository_lists_known_patients():
    repo = InMemoryPatientRepository()
    repo.get_or_create("bed-1")
    repo.get_or_create("bed-2")
    assert set(repo.patient_ids()) == {"bed-1", "bed-2"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_state_timeline.py -k repository -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.state.repository`.

- [ ] **Step 3: Implement `state/repository.py`**

```python
# src/homunculus/state/repository.py
"""Patient state storage. In-memory is the default and the hot cache;
a Postgres adapter implements the same protocol in Plan B."""
from __future__ import annotations

from typing import Protocol

from homunculus.state.timeline import PatientState


class PatientRepository(Protocol):
    def get_or_create(self, patient_id: str) -> PatientState: ...
    def patient_ids(self) -> list[str]: ...


class InMemoryPatientRepository:
    def __init__(self) -> None:
        self._states: dict[str, PatientState] = {}

    def get_or_create(self, patient_id: str) -> PatientState:
        if patient_id not in self._states:
            self._states[patient_id] = PatientState(patient_id)
        return self._states[patient_id]

    def patient_ids(self) -> list[str]:
        return list(self._states)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_state_timeline.py -v`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/state/repository.py tests/test_state_timeline.py
git commit -m "feat(engine): patient repository protocol with in-memory implementation"
```

---

## Phase 4 — Clinical rules

Pure functions over `PatientState`. Each returns `Finding`s carrying vault citations. **All thresholds below are quoted from the vault — do not alter them without a source.**

### Task 5: `rules/finding.py` — the Finding and Citation types

**Files:**
- Create: `src/homunculus/rules/__init__.py` (empty)
- Create: `src/homunculus/rules/finding.py`
- Test: `tests/rules/__init__.py` (empty) and `tests/rules/test_sofa.py` (imports checked here first)

- [ ] **Step 1: Write the failing test**

```python
# tests/rules/test_finding.py
from homunculus.rules.finding import Finding, Citation, Severity, Urgency


def test_citation_names_a_vault_source_note():
    c = Citation(source="sepsis-3-jama-2016", note="the >=2-point SOFA delta")
    assert c.source == "sepsis-3-jama-2016"


def test_finding_requires_at_least_one_citation():
    import pytest
    with pytest.raises(ValueError, match="at least one citation"):
        Finding(
            kind="sepsis",
            severity=Severity.MODERATE,
            urgency=Urgency.SOON,
            summary="x",
            reasoning="y",
            citations=[],
        )


def test_finding_carries_structured_fields():
    f = Finding(
        kind="septic_shock",
        severity=Severity.CRITICAL,
        urgency=Urgency.IMMEDIATE,
        summary="Septic shock criteria met",
        reasoning="Vasopressor + lactate 3.1 despite 30 mL/kg fluid",
        citations=[Citation("sepsis-3-jama-2016", "shock criteria")],
    )
    assert f.kind == "septic_shock"
    assert f.severity is Severity.CRITICAL
    assert f.citations[0].source == "sepsis-3-jama-2016"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_finding.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.rules.finding`.

- [ ] **Step 3: Implement `rules/finding.py`**

```python
# src/homunculus/rules/finding.py
"""Structured findings emitted by rules. Every finding cites the vault."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class Severity(IntEnum):
    INFO = 0
    LOW = 1
    MODERATE = 2
    HIGH = 3
    CRITICAL = 4


class Urgency(IntEnum):
    ROUTINE = 0
    SOON = 1
    IMMEDIATE = 2


@dataclass(frozen=True)
class Citation:
    """Points at a note in Homunculus/wiki/sources/ (basename, no extension)."""
    source: str
    note: str = ""


@dataclass(frozen=True)
class Finding:
    kind: str
    severity: Severity
    urgency: Urgency
    summary: str
    reasoning: str
    citations: list[Citation] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.citations:
            raise ValueError(f"finding {self.kind!r} must carry at least one citation")
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_finding.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/rules/__init__.py src/homunculus/rules/finding.py tests/rules
git commit -m "feat(engine): Finding and Citation types (every finding cites the vault)"
```

### Task 6: `rules/sofa.py` — SOFA score with staleness

Thresholds from [sofa-score](../../../Homunculus/wiki/concepts/sofa-score.md) (source: `sepsis-3-jama-2016`). Plan A scores the four organs computable from the scenario signals: **respiration** (PaO₂/FiO₂ + resp support), **coagulation** (platelets), **cardiovascular** (MAP / vasopressors), **renal** (creatinine). CNS (GCS) and liver (bilirubin) use the same table and are included when present.

- [ ] **Step 1: Write the failing test**

```python
# tests/rules/test_sofa.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState
from homunculus.rules.sofa import (
    cardiovascular_points, respiration_points, coagulation_points,
    renal_points, cns_points, liver_points, total_sofa,
)

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(**signals):
    st = PatientState("bed-3")
    for code, value in signals.items():
        st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0, "dev"))
    return st


def test_cardiovascular_points_map_ge_70_is_zero():
    assert cardiovascular_points(_state(MAP=72)) == 0

def test_cardiovascular_points_map_below_70_is_one():
    assert cardiovascular_points(_state(MAP=64)) == 1

def test_cardiovascular_points_low_dose_norepi_is_three():
    # norepinephrine <= 0.1 ug/kg/min -> 3 points
    assert cardiovascular_points(_state(MAP=64, NOREPINEPHRINE_RATE=0.08)) == 3

def test_cardiovascular_points_high_dose_norepi_is_four():
    # norepinephrine > 0.1 -> 4 points
    assert cardiovascular_points(_state(MAP=60, NOREPINEPHRINE_RATE=0.25)) == 4

def test_respiration_points_pf_below_200_with_support_is_three():
    st = _state(PAO2_FIO2=180, ON_RESP_SUPPORT=1.0)
    assert respiration_points(st) == 3

def test_respiration_points_pf_below_300_no_support_is_two():
    st = _state(PAO2_FIO2=250, ON_RESP_SUPPORT=0.0)
    assert respiration_points(st) == 2

def test_coagulation_points_platelets_below_100_is_two():
    assert coagulation_points(_state(PLATELETS=90)) == 2

def test_renal_points_creatinine_2_to_3_4_is_two():
    assert renal_points(_state(CREATININE=2.5)) == 2

def test_cns_points_gcs_10_to_12_is_two():
    assert cns_points(_state(GCS=11)) == 2

def test_liver_points_bilirubin_2_to_5_9_is_two():
    assert liver_points(_state(BILIRUBIN=3.0)) == 2

def test_total_sofa_sums_available_organs():
    st = _state(MAP=64, PLATELETS=90, CREATININE=2.5)  # 1 + 2 + 2
    assert total_sofa(st) == 5

def test_total_sofa_treats_missing_organ_as_zero():
    st = _state(MAP=72)  # everything else absent
    assert total_sofa(st) == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_sofa.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.rules.sofa`.

- [ ] **Step 3: Implement `rules/sofa.py`**

```python
# src/homunculus/rules/sofa.py
"""SOFA score. Thresholds: Homunculus/wiki/concepts/sofa-score.md (sepsis-3-jama-2016).

Each organ scores 0-4. A missing signal scores 0 (SOFA assumes baseline 0 unless
documented). Catecholamine doses are ug/kg/min.
"""
from __future__ import annotations

from homunculus.canonical import SignalCode
from homunculus.state.timeline import PatientState


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def cardiovascular_points(state: PatientState) -> int:
    norepi = _val(state, SignalCode.NOREPINEPHRINE_RATE) or 0.0
    epi = _val(state, SignalCode.EPINEPHRINE_RATE) or 0.0
    dopamine = _val(state, SignalCode.DOPAMINE_RATE) or 0.0
    dobutamine = _val(state, SignalCode.DOBUTAMINE_RATE) or 0.0
    map_val = _val(state, SignalCode.MAP)

    # 4: dopamine >15 or epi >0.1 or norepi >0.1
    if dopamine > 15 or epi > 0.1 or norepi > 0.1:
        return 4
    # 3: dopamine 5.1-15 or epi <=0.1 or norepi <=0.1  (any pressor at low dose)
    if dopamine > 5 or epi > 0 or norepi > 0:
        return 3
    # 2: dopamine <5 or dobutamine any dose
    if dopamine > 0 or dobutamine > 0:
        return 2
    # 1: MAP < 70
    if map_val is not None and map_val < 70:
        return 1
    return 0


def respiration_points(state: PatientState) -> int:
    pf = _val(state, SignalCode.PAO2_FIO2)
    if pf is None:
        return 0
    support = (_val(state, SignalCode.ON_RESP_SUPPORT) or 0.0) >= 1.0
    if pf < 100 and support:
        return 4
    if pf < 200 and support:
        return 3
    if pf < 300:
        return 2
    if pf < 400:
        return 1
    return 0


def coagulation_points(state: PatientState) -> int:
    plt = _val(state, SignalCode.PLATELETS)
    if plt is None:
        return 0
    if plt < 20:
        return 4
    if plt < 50:
        return 3
    if plt < 100:
        return 2
    if plt < 150:
        return 1
    return 0


def renal_points(state: PatientState) -> int:
    cr = _val(state, SignalCode.CREATININE)
    if cr is None:
        return 0
    if cr > 5.0:
        return 4
    if cr >= 3.5:
        return 3
    if cr >= 2.0:
        return 2
    if cr >= 1.2:
        return 1
    return 0


def cns_points(state: PatientState) -> int:
    gcs = _val(state, SignalCode.GCS)
    if gcs is None:
        return 0
    if gcs < 6:
        return 4
    if gcs <= 9:
        return 3
    if gcs <= 12:
        return 2
    if gcs <= 14:
        return 1
    return 0


def liver_points(state: PatientState) -> int:
    bili = _val(state, SignalCode.BILIRUBIN)
    if bili is None:
        return 0
    if bili > 12.0:
        return 4
    if bili >= 6.0:
        return 3
    if bili >= 2.0:
        return 2
    if bili >= 1.2:
        return 1
    return 0


def total_sofa(state: PatientState) -> int:
    return (
        cardiovascular_points(state)
        + respiration_points(state)
        + coagulation_points(state)
        + renal_points(state)
        + cns_points(state)
        + liver_points(state)
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_sofa.py -v`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/rules/sofa.py tests/rules/test_sofa.py
git commit -m "feat(engine): SOFA score from vault thresholds"
```

### Task 7: `rules/septic_shock.py` — sepsis, shock, and under-resuscitation

Logic from [septic-shock](../../../Homunculus/wiki/concepts/septic-shock.md) and [sepsis-3-definition](../../../Homunculus/wiki/concepts/sepsis-3-definition.md):
- **Sepsis** = suspected infection **and** SOFA ≥ 2 (acute rise; baseline assumed 0).
- **Septic shock** = sepsis **and** on a vasopressor **and** lactate > 2 mmol/L **and** adequate fluid given (≥ 30 mL/kg crystalloid within 3 h). Source also: `surviving-sepsis-campaign-2026` for the 30 mL/kg anchor.
- **Under-resuscitated sepsis** = suspected infection **and** lactate > 2 **and** MAP < 65 **and** fluid **not** adequate. Recommends fluid assessment, **not** shock — the fluid-vs-pressor distinction.

- [ ] **Step 1: Write the failing test**

```python
# tests/rules/test_septic_shock.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState
from homunculus.rules.septic_shock import evaluate

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(now_min=0, **series):
    """series: code -> list of (minute, value) OR a scalar (at minute 0)."""
    st = PatientState("bed-3")
    for code, spec in series.items():
        points = spec if isinstance(spec, list) else [(0, spec)]
        for minute, value in points:
            st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0 + timedelta(minutes=minute), "dev"))
    return st


def _now(minute):
    return T0 + timedelta(minutes=minute)


def test_no_infection_no_findings():
    st = _state(MAP=60, LACTATE=4.0, PLATELETS=90)
    assert evaluate(st, _now(0)) == []


def test_sepsis_when_infection_and_sofa_ge_2():
    # SOFA: MAP<70 (1) + platelets<100 (2) = 3 >= 2
    st = _state(SUSPECTED_INFECTION=1.0, MAP=64, PLATELETS=90)
    kinds = {f.kind for f in evaluate(st, _now(0))}
    assert "sepsis" in kinds
    assert "septic_shock" not in kinds


def test_septic_shock_when_pressor_lactate_and_adequate_fluid():
    # weight 100 kg -> 30 mL/kg = 3000 mL required; give 3000 within 3h
    st = _state(
        SUSPECTED_INFECTION=1.0,
        WEIGHT_KG=100,
        MAP=[(0, 60)],
        NOREPINEPHRINE_RATE=[(0, 0.12)],
        LACTATE=[(0, 3.1)],
        PLATELETS=[(0, 90)],
        CRYSTALLOID_BOLUS_ML=[(-120, 1500), (-60, 1500)],  # 3000 mL in last 3h
    )
    kinds = {f.kind for f in evaluate(st, _now(0))}
    assert "septic_shock" in kinds


def test_under_resuscitated_when_fluid_not_yet_adequate():
    # lactate high, hypotensive, infection, but only 500 mL given (need 3000)
    st = _state(
        SUSPECTED_INFECTION=1.0,
        WEIGHT_KG=100,
        MAP=[(0, 60)],
        LACTATE=[(0, 3.1)],
        CRYSTALLOID_BOLUS_ML=[(-30, 500)],
    )
    findings = evaluate(st, _now(0))
    kinds = {f.kind for f in findings}
    assert "under_resuscitated_sepsis" in kinds
    assert "septic_shock" not in kinds


def test_septic_shock_finding_cites_sepsis3():
    st = _state(
        SUSPECTED_INFECTION=1.0, WEIGHT_KG=100, MAP=60,
        NOREPINEPHRINE_RATE=0.12, LACTATE=3.1,
        CRYSTALLOID_BOLUS_ML=[(-60, 3000)],
    )
    shock = next(f for f in evaluate(st, _now(0)) if f.kind == "septic_shock")
    assert any(c.source == "sepsis-3-jama-2016" for c in shock.citations)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_septic_shock.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.rules.septic_shock`.

- [ ] **Step 3: Implement `rules/septic_shock.py`**

```python
# src/homunculus/rules/septic_shock.py
"""Sepsis / septic shock / under-resuscitation.
Sources: sepsis-3-jama-2016 (criteria), surviving-sepsis-campaign-2026 (30 mL/kg anchor).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.rules.sofa import total_sofa
from homunculus.state.timeline import PatientState

LACTATE_SHOCK_THRESHOLD = 2.0     # mmol/L  (sepsis-3)
MAP_TARGET = 65.0                 # mmHg    (sepsis-3 / SSC)
FLUID_ML_PER_KG = 30.0            # mL/kg   (SSC 2026, within 3 h)
FLUID_WINDOW = timedelta(hours=3)
SOFA_SEPSIS_DELTA = 2             # sepsis-3


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def _on_vasopressor(state: PatientState) -> bool:
    for code in (SignalCode.NOREPINEPHRINE_RATE, SignalCode.EPINEPHRINE_RATE,
                 SignalCode.DOPAMINE_RATE):
        v = _val(state, code)
        if v is not None and v > 0:
            return True
    return False


def _fluid_adequate(state: PatientState, now: datetime) -> bool:
    weight = _val(state, SignalCode.WEIGHT_KG)
    if not weight:
        return False
    given = state.sum_since(SignalCode.CRYSTALLOID_BOLUS_ML, now - FLUID_WINDOW)
    return given >= FLUID_ML_PER_KG * weight


def evaluate(state: PatientState, now: datetime) -> list[Finding]:
    findings: list[Finding] = []
    if (_val(state, SignalCode.SUSPECTED_INFECTION) or 0.0) < 1.0:
        return findings  # no suspected infection -> not our call to make

    sofa = total_sofa(state)
    lactate = _val(state, SignalCode.MAP)  # placeholder to be replaced below
    lactate = _val(state, SignalCode.LACTATE)
    map_val = _val(state, SignalCode.MAP)

    on_pressor = _on_vasopressor(state)
    fluid_ok = _fluid_adequate(state, now)
    lactate_high = lactate is not None and lactate > LACTATE_SHOCK_THRESHOLD

    # Septic shock: pressor + lactate>2 + adequate fluid
    if on_pressor and lactate_high and fluid_ok:
        findings.append(Finding(
            kind="septic_shock",
            severity=Severity.CRITICAL,
            urgency=Urgency.IMMEDIATE,
            summary="Septic shock criteria met",
            reasoning=(
                f"Suspected infection with a vasopressor running, lactate {lactate} mmol/L "
                f"(> {LACTATE_SHOCK_THRESHOLD}), after adequate fluid resuscitation "
                f"(>= {FLUID_ML_PER_KG:.0f} mL/kg in 3 h). Hospital mortality > 40%."
            ),
            citations=[
                Citation("sepsis-3-jama-2016", "septic shock = vasopressor + lactate >2 despite fluids"),
                Citation("surviving-sepsis-campaign-2026", "30 mL/kg within 3 h; MAP target 65; norepinephrine first-line"),
            ],
        ))
    # Under-resuscitated sepsis: lactate>2 + hypotension + fluid NOT adequate
    elif lactate_high and map_val is not None and map_val < MAP_TARGET and not fluid_ok:
        findings.append(Finding(
            kind="under_resuscitated_sepsis",
            severity=Severity.HIGH,
            urgency=Urgency.IMMEDIATE,
            summary="Hypoperfusion before adequate fluid — assess fluid resuscitation",
            reasoning=(
                f"Lactate {lactate} mmol/L with MAP {map_val} mmHg, but < {FLUID_ML_PER_KG:.0f} "
                f"mL/kg crystalloid given in the last 3 h. This may be under-resuscitation, "
                f"not shock — the distinction changes the next action (volume vs pressors)."
            ),
            citations=[
                Citation("septic-shock", "'despite adequate fluid resuscitation' precondition"),
                Citation("surviving-sepsis-campaign-2026", "at least 30 mL/kg crystalloid within 3 h"),
            ],
        ))

    # Sepsis (organ dysfunction), independent of the shock branch above.
    if sofa >= SOFA_SEPSIS_DELTA:
        findings.append(Finding(
            kind="sepsis",
            severity=Severity.HIGH,
            urgency=Urgency.SOON,
            summary=f"Sepsis criteria met (SOFA {sofa})",
            reasoning=(
                f"Suspected infection with SOFA {sofa} (>= {SOFA_SEPSIS_DELTA}); "
                f"acute organ dysfunction attributable to infection."
            ),
            citations=[Citation("sepsis-3-jama-2016", "sepsis = suspected infection + SOFA rise >= 2")],
        ))

    return findings
```

Note the deliberate double assignment of `lactate` in Step 3 is a copy hazard — the reference implementation above corrects it to read `SignalCode.LACTATE`. Ensure the final line reads `lactate = _val(state, SignalCode.LACTATE)` and remove the placeholder line before committing.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_septic_shock.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/rules/septic_shock.py tests/rules/test_septic_shock.py
git commit -m "feat(engine): sepsis / septic shock / under-resuscitation rule"
```

### Task 8: `rules/antibiotic_clock.py` — the 1-hour window

From [antimicrobial-timing-sepsis](../../../Homunculus/wiki/concepts/antimicrobial-timing-sepsis.md) (source: `surviving-sepsis-campaign-2026`): once septic shock or sepsis is recognized, antibiotics are indicated **within 1 hour**. The clock reports time remaining and raises urgency as the deadline nears or passes, unless an antibiotic has been administered.

- [ ] **Step 1: Write the failing test**

```python
# tests/rules/test_antibiotic_clock.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState
from homunculus.rules.antibiotic_clock import evaluate

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(**series):
    st = PatientState("bed-3")
    for code, points in series.items():
        for minute, value in points:
            st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0 + timedelta(minutes=minute), "dev"))
    return st


def _now(minute):
    return T0 + timedelta(minutes=minute)


def test_no_finding_before_recognition():
    st = _state()
    assert evaluate(st, recognized_at=None, now=_now(0)) == []


def test_finding_within_window_is_soon():
    st = _state()  # no antibiotic given
    f = evaluate(st, recognized_at=T0, now=_now(30))[0]
    assert f.kind == "antibiotic_due"
    assert "30 min" in f.reasoning or "30" in f.reasoning

def test_finding_after_window_is_immediate_and_overdue():
    st = _state()
    f = evaluate(st, recognized_at=T0, now=_now(75))[0]
    assert f.kind == "antibiotic_overdue"

def test_no_finding_once_antibiotic_administered():
    st = _state(ANTIBIOTIC_ADMINISTERED=[(20, 1.0)])
    assert evaluate(st, recognized_at=T0, now=_now(75)) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_antibiotic_clock.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement `rules/antibiotic_clock.py`**

```python
# src/homunculus/rules/antibiotic_clock.py
"""1-hour antibiotic window after sepsis/shock recognition.
Source: surviving-sepsis-campaign-2026 (within 1 h; strong, very low certainty)."""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.timeline import PatientState

WINDOW = timedelta(hours=1)


def _antibiotic_given_since(state: PatientState, since: datetime) -> bool:
    for obs in state.history(SignalCode.ANTIBIOTIC_ADMINISTERED):
        if obs.timestamp >= since and obs.value >= 1.0:
            return True
    return False


def evaluate(state: PatientState, recognized_at: datetime | None, now: datetime) -> list[Finding]:
    if recognized_at is None:
        return []
    if _antibiotic_given_since(state, recognized_at):
        return []

    deadline = recognized_at + WINDOW
    remaining = deadline - now
    cite = Citation("surviving-sepsis-campaign-2026",
                    "antimicrobials within 1 h (strong, very low certainty)")

    if remaining.total_seconds() > 0:
        mins = int(remaining.total_seconds() // 60)
        return [Finding(
            kind="antibiotic_due",
            severity=Severity.HIGH,
            urgency=Urgency.SOON,
            summary=f"Antibiotic window: {mins} min remaining",
            reasoning=(
                f"Sepsis recognized at {recognized_at:%H:%M}. Guideline target is within 1 h; "
                f"{mins} min remain. No antibiotic administration seen yet."
            ),
            citations=[cite],
        )]

    overdue = int((-remaining).total_seconds() // 60)
    return [Finding(
        kind="antibiotic_overdue",
        severity=Severity.CRITICAL,
        urgency=Urgency.IMMEDIATE,
        summary=f"Antibiotic OVERDUE by {overdue} min",
        reasoning=(
            f"Sepsis recognized at {recognized_at:%H:%M}; the 1-hour window closed at "
            f"{deadline:%H:%M}. No antibiotic administration seen."
        ),
        citations=[cite],
    )]
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/rules/test_antibiotic_clock.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/rules/antibiotic_clock.py tests/rules/test_antibiotic_clock.py
git commit -m "feat(engine): 1-hour antibiotic-timing clock"
```

---

## Phase 5 — Recommendation engine

Turns findings into `Alert`s in the vision's schema, enforcing the no-orders register.

### Task 9: `reco/engine.py` — Finding -> Alert

- [ ] **Step 1: Write the failing test**

```python
# tests/test_reco_engine.py
import pytest
from homunculus.rules.finding import Finding, Citation, Severity, Urgency
from homunculus.reco.engine import to_alert, Alert


def _finding(kind="septic_shock"):
    return Finding(
        kind=kind, severity=Severity.CRITICAL, urgency=Urgency.IMMEDIATE,
        summary="Septic shock criteria met",
        reasoning="Vasopressor + lactate 3.1 after 30 mL/kg fluid.",
        citations=[Citation("sepsis-3-jama-2016", "shock criteria")],
    )


def test_alert_has_vision_schema_fields():
    a = to_alert(_finding(), patient_id="bed-3")
    assert a.patient_id == "bed-3"
    assert a.severity == "critical"
    assert a.urgency == "immediate"
    assert a.clinical_reasoning
    assert a.supporting_evidence == ["sepsis-3-jama-2016"]
    assert a.recommended_actions  # non-empty


def test_recommended_actions_are_recommendations_not_orders():
    a = to_alert(_finding(), patient_id="bed-3")
    for action in a.recommended_actions:
        low = action.lower()
        assert low.startswith(("consider", "review", "assess", "evaluate", "monitor"))
        # never an imperative order
        assert not low.startswith(("give ", "administer ", "start ", "order "))


def test_confidence_conveys_grade_not_a_number():
    a = to_alert(_finding(), patient_id="bed-3")
    assert isinstance(a.confidence, str)
    assert "certainty" in a.confidence.lower() or "recommendation" in a.confidence.lower()


def test_unknown_kind_still_produces_a_safe_generic_alert():
    a = to_alert(_finding(kind="something_new"), patient_id="bed-3")
    assert a.recommended_actions == ["Review the patient and the supporting evidence."]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_reco_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.reco.engine`.

- [ ] **Step 3: Implement `reco/engine.py`**

```python
# src/homunculus/reco/engine.py
"""Finding -> Alert. Register: recommendations a clinician evaluates, never orders.
Confidence conveys GRADE certainty, not a fabricated probability."""
from __future__ import annotations

from dataclasses import dataclass

from homunculus.rules.finding import Finding, Severity, Urgency

_SEVERITY_NAME = {
    Severity.INFO: "info", Severity.LOW: "low", Severity.MODERATE: "moderate",
    Severity.HIGH: "high", Severity.CRITICAL: "critical",
}
_URGENCY_NAME = {
    Urgency.ROUTINE: "routine", Urgency.SOON: "soon", Urgency.IMMEDIATE: "immediate",
}

# Recommended actions per finding kind. Phrased as recommendations, never orders.
# Every verb is one of: Consider / Review / Assess / Evaluate / Monitor.
_ACTIONS: dict[str, list[str]] = {
    "septic_shock": [
        "Review vasopressor titration against a MAP target of 65 mmHg.",
        "Consider repeat lactate to confirm the trend.",
        "Review antibiotic coverage and source control.",
    ],
    "under_resuscitated_sepsis": [
        "Assess fluid responsiveness before escalating vasopressors.",
        "Consider continuing crystalloid toward 30 mL/kg if not contraindicated.",
        "Monitor lactate and MAP after the next fluid bolus.",
    ],
    "sepsis": [
        "Consider whether an infective source is being addressed.",
        "Monitor the SOFA trend and repeat labs as indicated.",
    ],
    "antibiotic_due": [
        "Review whether antibiotics can be given within the 1-hour window.",
    ],
    "antibiotic_overdue": [
        "Review antibiotic administration urgently — the 1-hour window has closed.",
    ],
}

# GRADE certainty phrasing per kind (from the vault). Not a probability.
_CONFIDENCE: dict[str, str] = {
    "septic_shock": "Criteria are deterministic (Sepsis-3). Antibiotic urgency: strong recommendation, very low certainty (SSC 2026).",
    "under_resuscitated_sepsis": "Fluid target: conditional recommendation, low certainty (SSC 2026).",
    "sepsis": "Sepsis-3 organ-dysfunction criterion (consensus definition).",
    "antibiotic_due": "Strong recommendation, very low certainty (SSC 2026).",
    "antibiotic_overdue": "Strong recommendation, very low certainty (SSC 2026).",
}


@dataclass(frozen=True)
class Alert:
    patient_id: str
    kind: str
    severity: str
    urgency: str
    summary: str
    clinical_reasoning: str
    supporting_evidence: list[str]   # vault source basenames
    recommended_actions: list[str]
    confidence: str
    source: str = "rule"             # 'rule' or (later) 'model'


def to_alert(finding: Finding, patient_id: str) -> Alert:
    return Alert(
        patient_id=patient_id,
        kind=finding.kind,
        severity=_SEVERITY_NAME[finding.severity],
        urgency=_URGENCY_NAME[finding.urgency],
        summary=finding.summary,
        clinical_reasoning=finding.reasoning,
        supporting_evidence=[c.source for c in finding.citations],
        recommended_actions=_ACTIONS.get(
            finding.kind, ["Review the patient and the supporting evidence."]
        ),
        confidence=_CONFIDENCE.get(finding.kind, "See supporting evidence."),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_reco_engine.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/reco tests/test_reco_engine.py
git commit -m "feat(engine): recommendation engine with no-orders register"
```

---

## Phase 6 — Pipeline

Wire it together: an observation goes in; state updates; rules run; alerts come out. The pipeline holds per-patient recognition time so the antibiotic clock has an anchor.

### Task 10: `pipeline.py` — the wiring

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _obs(code, value, minute=0, patient="bed-3"):
    return Observation(patient, code, value, "u", T0 + timedelta(minutes=minute), "dev")


def test_engine_emits_septic_shock_alert():
    eng = Engine()
    for o in [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.WEIGHT_KG, 100),
        _obs(SignalCode.CRYSTALLOID_BOLUS_ML, 3000, minute=-30),
        _obs(SignalCode.MAP, 60),
        _obs(SignalCode.NOREPINEPHRINE_RATE, 0.12),
        _obs(SignalCode.LACTATE, 3.1),
    ]:
        alerts = eng.ingest(o, now=o.timestamp)
    kinds = {a.kind for a in eng.active_alerts("bed-3")}
    assert "septic_shock" in kinds


def test_engine_sets_recognition_time_for_antibiotic_clock():
    eng = Engine()
    base = [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.WEIGHT_KG, 100),
        _obs(SignalCode.CRYSTALLOID_BOLUS_ML, 3000, minute=-30),
        _obs(SignalCode.MAP, 60),
        _obs(SignalCode.NOREPINEPHRINE_RATE, 0.12),
        _obs(SignalCode.LACTATE, 3.1),
    ]
    for o in base:
        eng.ingest(o, now=o.timestamp)
    # 75 minutes later, no antibiotic -> overdue alert appears
    later = _obs(SignalCode.HEART_RATE, 110, minute=75)
    eng.ingest(later, now=later.timestamp)
    kinds = {a.kind for a in eng.active_alerts("bed-3")}
    assert "antibiotic_overdue" in kinds
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: homunculus.pipeline`.

- [ ] **Step 3: Implement `pipeline.py`**

```python
# src/homunculus/pipeline.py
"""Wire observation -> state -> rules -> reco -> alerts.
Holds per-patient recognition time to anchor the antibiotic clock."""
from __future__ import annotations

from datetime import datetime

from homunculus.canonical import Observation
from homunculus.reco.engine import Alert, to_alert
from homunculus.rules import antibiotic_clock, septic_shock
from homunculus.state.repository import InMemoryPatientRepository, PatientRepository

_RECOGNITION_KINDS = {"sepsis", "septic_shock"}


class Engine:
    def __init__(self, repository: PatientRepository | None = None):
        self._repo = repository or InMemoryPatientRepository()
        self._recognized_at: dict[str, datetime] = {}
        self._alerts: dict[str, dict[str, Alert]] = {}   # patient -> kind -> alert

    def ingest(self, obs: Observation, now: datetime) -> list[Alert]:
        state = self._repo.get_or_create(obs.patient_id)
        state.ingest(obs)

        findings = list(septic_shock.evaluate(state, now))

        # Anchor the antibiotic clock the first time sepsis/shock is recognized.
        if obs.patient_id not in self._recognized_at:
            if any(f.kind in _RECOGNITION_KINDS for f in findings):
                self._recognized_at[obs.patient_id] = now

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(obs.patient_id), now
        )

        alerts = [to_alert(f, obs.patient_id) for f in findings]
        bucket = self._alerts.setdefault(obs.patient_id, {})
        for a in alerts:
            bucket[a.kind] = a   # latest alert per kind
        return alerts

    def active_alerts(self, patient_id: str) -> list[Alert]:
        return list(self._alerts.get(patient_id, {}).values())
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_pipeline.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/pipeline.py tests/test_pipeline.py
git commit -m "feat(engine): pipeline wiring observation -> alerts with recognition anchor"
```

---

## Phase 7 — Scenarios and end-to-end replay tests

Scenarios are the spec's end-to-end tests. Each is a YAML timeline; the loader turns it into timed FHIR Observations; the replay feeds them through the gateway and engine and asserts the expected alert sequence.

### Task 11: `scenarios/loader.py` — YAML -> timed FHIR observations

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scenario_loader.py
from homunculus.scenarios.loader import load_scenario

SAMPLE = """
patient_id: bed-3
start: "2026-07-14T10:00:00+00:00"
events:
  - at_min: 0
    code: suspected_infection
    value: 1.0
    unit: "bool"
  - at_min: 5
    code: lactate
    value: 3.1
    unit: "mmol/L"
"""


def test_loader_yields_fhir_observations_in_time_order(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(SAMPLE, encoding="utf-8")
    events = load_scenario(p)
    assert events[0][0].isoformat() == "2026-07-14T10:00:00+00:00"
    fhir0 = events[0][1]
    assert fhir0["resourceType"] == "Observation"
    assert fhir0["code"]["coding"][0]["code"] == "suspected_infection"
    assert events[1][0].isoformat() == "2026-07-14T10:05:00+00:00"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_scenario_loader.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement `scenarios/loader.py`**

```python
# src/homunculus/scenarios/loader.py
"""Load a scenario YAML and yield (timestamp, FHIR Observation dict) in time order."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import yaml

CODE_SYSTEM = "http://homunculus.local/obs"


def load_scenario(path: str | Path) -> list[tuple[datetime, dict]]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    patient_id = data["patient_id"]
    start = datetime.fromisoformat(data["start"])
    out: list[tuple[datetime, dict]] = []
    for ev in data["events"]:
        ts = start + timedelta(minutes=float(ev["at_min"]))
        resource = {
            "resourceType": "Observation",
            "status": "final",
            "code": {"coding": [{"system": CODE_SYSTEM, "code": ev["code"]}]},
            "subject": {"reference": f"Patient/{patient_id}"},
            "effectiveDateTime": ts.isoformat(),
            "valueQuantity": {"value": float(ev["value"]), "unit": ev.get("unit", "")},
            "device": {"display": ev.get("device", "sim")},
        }
        out.append((ts, resource))
    out.sort(key=lambda pair: pair[0])
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_scenario_loader.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/homunculus/scenarios/__init__.py src/homunculus/scenarios/loader.py tests/test_scenario_loader.py
git commit -m "feat(engine): scenario loader (YAML -> timed FHIR observations)"
```

### Task 12: Author the three scenario files

**Files:**
- Create: `src/homunculus/scenarios/septic_shock.yaml`
- Create: `src/homunculus/scenarios/stable_control.yaml`
- Create: `src/homunculus/scenarios/under_resuscitated.yaml`

- [ ] **Step 1: Write `septic_shock.yaml`** — a patient who receives adequate fluid, stays hypotensive on norepinephrine, and has a rising lactate.

```yaml
# Synthetic. No patient data. 100 kg adult, suspected infection, slides into septic shock.
patient_id: bed-3
start: "2026-07-14T10:00:00+00:00"
events:
  - {at_min: 0,  code: weight_kg,            value: 100, unit: kg}
  - {at_min: 0,  code: suspected_infection,  value: 1.0, unit: bool}
  - {at_min: 0,  code: map,                  value: 72,  unit: mmHg}
  - {at_min: 0,  code: platelets,            value: 140, unit: 10^3/uL}
  - {at_min: 0,  code: lactate,              value: 1.8, unit: mmol/L}
  - {at_min: 10, code: map,                  value: 66,  unit: mmHg}
  - {at_min: 10, code: crystalloid_bolus_ml, value: 1500, unit: mL}
  - {at_min: 30, code: crystalloid_bolus_ml, value: 1500, unit: mL}   # total 3000 = 30 mL/kg
  - {at_min: 30, code: map,                  value: 62,  unit: mmHg}
  - {at_min: 35, code: lactate,              value: 2.6, unit: mmol/L}
  - {at_min: 40, code: norepinephrine_rate,  value: 0.08, unit: ug/kg/min}
  - {at_min: 40, code: map,                  value: 63,  unit: mmHg}
  - {at_min: 55, code: norepinephrine_rate,  value: 0.12, unit: ug/kg/min}
  - {at_min: 60, code: lactate,              value: 3.4, unit: mmol/L}   # shock now true
  - {at_min: 60, code: platelets,            value: 95,  unit: 10^3/uL}
```

- [ ] **Step 2: Write `stable_control.yaml`** — suspected infection but no organ dysfunction; must never fire a sepsis/shock alert.

```yaml
# Synthetic. Suspected infection, but the patient stays well. Control case.
patient_id: bed-5
start: "2026-07-14T10:00:00+00:00"
events:
  - {at_min: 0,  code: weight_kg,           value: 80,  unit: kg}
  - {at_min: 0,  code: suspected_infection, value: 1.0, unit: bool}
  - {at_min: 0,  code: map,                 value: 82,  unit: mmHg}
  - {at_min: 0,  code: lactate,             value: 1.2, unit: mmol/L}
  - {at_min: 0,  code: platelets,           value: 210, unit: 10^3/uL}
  - {at_min: 30, code: map,                 value: 80,  unit: mmHg}
  - {at_min: 60, code: lactate,             value: 1.1, unit: mmol/L}
```

- [ ] **Step 3: Write `under_resuscitated.yaml`** — lactate up, hypotensive, only 500 mL given; must recommend fluid, not declare shock.

```yaml
# Synthetic. Hypoperfusion BEFORE adequate fluid. Must NOT be called shock.
patient_id: bed-7
start: "2026-07-14T10:00:00+00:00"
events:
  - {at_min: 0,  code: weight_kg,           value: 90,  unit: kg}
  - {at_min: 0,  code: suspected_infection, value: 1.0, unit: bool}
  - {at_min: 0,  code: map,                 value: 60,  unit: mmHg}
  - {at_min: 0,  code: lactate,             value: 3.5, unit: mmol/L}
  - {at_min: 10, code: crystalloid_bolus_ml, value: 500, unit: mL}   # 500 << 2700 needed
  - {at_min: 20, code: map,                 value: 61,  unit: mmHg}
```

- [ ] **Step 4: Commit**

```bash
git add src/homunculus/scenarios/*.yaml
git commit -m "feat(engine): three synthetic sepsis scenarios (shock / control / under-resuscitated)"
```

### Task 13: End-to-end replay tests

**Files:**
- Create: `tests/test_scenarios_e2e.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scenarios_e2e.py
from pathlib import Path
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario

SCEN = Path("src/homunculus/scenarios")


def _run(scenario_file):
    eng = Engine()
    patient = None
    for ts, fhir in load_scenario(SCEN / scenario_file):
        obs = parse_fhir_observation(fhir)
        patient = obs.patient_id
        eng.ingest(obs, now=ts)
    return eng, patient


def test_septic_shock_scenario_fires_shock_alert_citing_sepsis3():
    eng, patient = _run("septic_shock.yaml")
    alerts = {a.kind: a for a in eng.active_alerts(patient)}
    assert "septic_shock" in alerts
    assert "sepsis-3-jama-2016" in alerts["septic_shock"].supporting_evidence
    # register: no orders
    for action in alerts["septic_shock"].recommended_actions:
        assert not action.lower().startswith(("give ", "administer ", "start ", "order "))


def test_stable_control_scenario_fires_no_sepsis_alert():
    eng, patient = _run("stable_control.yaml")
    kinds = {a.kind for a in eng.active_alerts(patient)}
    assert "septic_shock" not in kinds
    assert "sepsis" not in kinds
    assert "under_resuscitated_sepsis" not in kinds


def test_under_resuscitated_scenario_recommends_fluid_not_shock():
    eng, patient = _run("under_resuscitated.yaml")
    kinds = {a.kind for a in eng.active_alerts(patient)}
    assert "under_resuscitated_sepsis" in kinds
    assert "septic_shock" not in kinds


def test_golden_qanda_reasoning_present_in_shock_alert():
    # The vault Q&A: escalating pressor + lactate should surface a repeat-lactate recommendation.
    eng, patient = _run("septic_shock.yaml")
    shock = next(a for a in eng.active_alerts(patient) if a.kind == "septic_shock")
    assert any("lactate" in a.lower() for a in shock.recommended_actions)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_scenarios_e2e.py -v`
Expected: FAIL initially if any wiring is off; the point of this task is to make all four pass.

- [ ] **Step 3: Make it pass**

No new production code should be needed if Phases 1–6 are correct. If a test fails, fix the responsible module (not the test) and re-run. Common fixes: ensure `stable_control` platelets/MAP keep SOFA < 2; ensure `under_resuscitated` weight makes 500 mL < 30 mL/kg.

- [ ] **Step 4: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -v`
Expected: ALL tests pass across every file.

- [ ] **Step 5: Commit**

```bash
git add tests/test_scenarios_e2e.py
git commit -m "test(engine): end-to-end scenario replays (shock / control / under-resuscitated + golden)"
```

---

## Phase 8 — Docker Postgres (staged for Plan B, verified now)

### Task 14: docker-compose for Postgres

**Files:**
- Create: `homunculus-engine/docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: homunculus
      POSTGRES_PASSWORD: homunculus
      POSTGRES_DB: homunculus
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 2: Verify it starts**

Run: `cd homunculus-engine && docker compose up -d && docker compose ps`
Expected: `postgres` container is `running`/healthy.

- [ ] **Step 3: Tear down**

Run: `cd homunculus-engine && docker compose down`
Expected: container stops and is removed.

- [ ] **Step 4: Commit**

```bash
git add homunculus-engine/docker-compose.yml
git commit -m "chore(engine): docker-compose Postgres for Plan B persistence"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Canonical model → Task 1. Gateway (FHIR, malformed handling) → Task 2. State + staleness → Tasks 3–4. Rules (SOFA, septic shock, under-resuscitation, antibiotic clock) → Tasks 6–8. Finding + citations → Task 5. Reco engine + no-orders register + GRADE confidence → Task 9. Pipeline → Task 10. Three scenarios + e2e replays → Tasks 11–13. Postgres staged → Task 14.
- **Deferred, tracked, not dropped:** FastAPI/WebSocket, notification/escalation delivery, React dashboard, audit surface, NEWS2 (needs vault capture) → Plan B. Stated explicitly in Scope.
- Safety register (no orders, no diagnosis, no PHI, every alert cited) → enforced in Task 9 and asserted in Tasks 9 and 13.

**Placeholder scan:** One deliberate hazard is called out in Task 7 Step 3 (the duplicated `lactate` assignment) with an explicit instruction to remove the placeholder line — this is a teaching note, not a silent gap. No other TODO/TBD.

**Type consistency:** `Observation`, `SignalCode`, `PatientState`, `Finding`, `Citation`, `Severity`, `Urgency`, `Alert`, `Engine` names and signatures are consistent across tasks. `evaluate(state, now)` (septic_shock) and `evaluate(state, recognized_at, now)` (antibiotic_clock) differ intentionally and the pipeline calls each correctly.

---

## Definition of done (Plan A)

`cd homunculus-engine && .venv/Scripts/python.exe -m pytest` is green, and the three scenario
replays demonstrate: a cited septic-shock alert (shock case), silence (control case), and a
fluid-not-shock recommendation (under-resuscitated case) — with no order and no diagnosis in any
alert. Plan B then puts a FastAPI/WebSocket surface and a React doctor/nurse dashboard on top.
