# Comed ADT identity — Implementation Plan

## Execution status — 2026-09-05

Tasks 1–5 were already implemented on `feat/comed-adt-identity`. Tasks 6–13 are now implemented
in the working tree and locally verified. The original step-by-step text below is retained as
the design record; its commit commands and hardware/deployment acceptance steps have not been run.

- Patient identity lives in `api/patient_identity.py`; existing `api/identity.py` continues to
  resolve hospital membership. Production uses `patient_identity_postgres.py` and migration
  `0005`; local development uses encrypted SQLite.
- `/ingest` accepts Patient/Encounter/Observation, and the durable-queue regression test proves
  an ADT followed by an ORU drains successfully. Tenant isolation, stale updates, encryption,
  restart durability and discharge retention are covered.
- Web and mobile show names/beds/source/discharge state. Expired identity-only cards are
  removed over SSE; measured cards keep readings while losing the expired identity.
- Manual entry script, shared encryption-key configuration, diagnostics and runbook are added.
- Review follow-up: MEDIBUS CAN during initialization now returns to a retryable state.
- Validation: engine suite exercised against an isolated PostgreSQL 16 container; the existing
  audit-test SQL splitting bug was corrected and all affected database tests passed. Dashboard,
  mobile and MEDIBUS suites passed; final focused regressions, web build and mobile typecheck passed.

Remaining external acceptance: deploy API/migration and the updated bridge, configure the
hospital encryption key, then verify Comed ADT → device query → real observation at the site.
- Review follow-up (2026-09-05): a PHI key that no longer matches the stored rows (rotation, or
  the dev fallback replaced by a real `PHI_ENCRYPTION_KEY` after the first admissions) degrades
  to an empty name on that card instead of a 500 on `/patients`; retention reads one constant
  (`DISCHARGED_TTL`).

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A patient's name and bed reach the board and the bedside device from the hospital's HIS (Comed) ADT feed, keyed on the protocol number the nurse already types into the Connex Spot.

**Architecture:** The existing MLLP bridge gains a third message class. It already splits `QBP` queries (answered by `edge/pdq.py`) from `ORU` results (`EdgeBridge.handle_message`); ADT messages now become `PatientIdentity` records that go two ways — into a small mirror inside the bridge, so the device's patient query is answered with the name without a network hop, and onward as FHIR `Patient` + `Encounter` through the same durable buffer the observations use. The API keeps identity records in an encrypted store beside the audit log and hangs an `identity` block on every board entry.

**Tech Stack:** Python 3.14 (engine, stdlib + FastAPI), pytest; SQLite for the bridge mirror and the API store; `homunculus.crypto.encrypt_phi` (Fernet) for names at rest; React/Vitest (dashboard); React Native/Jest (mobile).

**Spec:** `docs/superpowers/specs/2026-09-04-comed-adt-identity-design.md`

**Run tests:** from `homunculus-engine/`: `.venv/Scripts/python.exe -m pytest -q`. Full suite is currently **432 passed, 40 skipped**.

**Scope note:** the spec's "panelde elle giriş formu" is implemented in Task 9 as an operator **script** (`scripts/set_identity.py`) rather than a form inside `dashboard/src/ClinicalDemo.jsx` (3971 lines, owned by the design collaborator). Same effect for the pilot — an identity can be entered without Comed — at a fraction of the risk. A panel form remains a follow-up slice.

---

### Task 1: ADT parser — HL7 in, `PatientIdentity` out

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/adt.py`
- Test: `homunculus-engine/tests/test_edge_adt.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_adt.py`:

```python
"""HL7 ADT -> PatientIdentity, and its FHIR rendering for the uplink.

All names here are synthetic. Comed sends A01/A02/A03/A08 keyed on the protocol number the
nurse also types into the Connex Spot; that number is PID-3.1 and the join key everywhere.
"""
from datetime import datetime, timezone

import pytest

from homunculus.edge.adt import PatientIdentity, identity_to_fhir, parse_hl7_adt
from homunculus.gateway.fhir import GatewayError

A01 = (
    "MSH|^~\\&|COMED|HOSP|HOMUNCULUS|HOSP|20260904143000||ADT^A01|MSG1|P|2.5\r"
    "EVN|A01|20260904143000\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE^N||19800115|F\r"
    "PV1|1|I|YB^304^2||||||||||||||||V1\r"
)
ORU = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143525||ORU^R01^ORU_R01|X1|P|2.6\r"
    "PID|1||20239121^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F\r"
)


def test_an_admit_carries_id_name_birth_sex_and_bed():
    identity = parse_hl7_adt(A01)
    assert identity == PatientIdentity(
        patient_id="20239121",
        family="YILMAZ",
        given="AYSE",
        birth_date="1980-01-15",
        sex="female",
        unit="YB",
        room="304",
        bed="2",
        state="admitted",
        at=datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc),
    )


def test_a_transfer_changes_only_the_location():
    a02 = A01.replace("ADT^A01", "ADT^A02").replace("YB^304^2", "YB^301^1")
    identity = parse_hl7_adt(a02)
    assert (identity.room, identity.bed, identity.state) == ("301", "1", "admitted")


def test_a_discharge_marks_the_record_discharged():
    a03 = A01.replace("ADT^A01", "ADT^A03")
    assert parse_hl7_adt(a03).state == "discharged"
    a13 = A01.replace("ADT^A01", "ADT^A13")      # discharge cancelled -> back to admitted
    assert parse_hl7_adt(a13).state == "admitted"
    a11 = A01.replace("ADT^A01", "ADT^A11")      # admit cancelled -> discharged
    assert parse_hl7_adt(a11).state == "discharged"


def test_a_message_that_is_not_adt_is_not_ours():
    assert parse_hl7_adt(ORU) is None
    assert parse_hl7_adt("garbage") is None


def test_an_unhandled_adt_type_is_ignored_rather_than_guessed():
    a31 = A01.replace("ADT^A01", "ADT^A31")
    assert parse_hl7_adt(a31) is None


def test_an_adt_without_a_protocol_number_is_refused_by_name():
    empty = A01.replace("20239121^^^COMED^PI", "^^^COMED^PI")
    with pytest.raises(GatewayError, match="PID-3"):
        parse_hl7_adt(empty)


def test_the_identity_renders_as_a_fhir_patient_and_encounter():
    patient, encounter = identity_to_fhir(parse_hl7_adt(A01), source="comed")
    assert patient["resourceType"] == "Patient"
    assert patient["identifier"][0]["value"] == "20239121"
    assert patient["name"][0] == {"family": "YILMAZ", "given": ["AYSE"]}
    assert patient["birthDate"] == "1980-01-15"
    assert patient["gender"] == "female"
    assert patient["active"] is True
    assert patient["meta"] == {"lastUpdated": "2026-09-04T14:30:00+00:00", "source": "comed"}

    assert encounter["resourceType"] == "Encounter"
    assert encounter["status"] == "in-progress"
    assert encounter["subject"] == {"reference": "Patient/20239121"}
    assert encounter["location"][0]["location"]["display"] == "YB^304^2"
    assert encounter["meta"]["lastUpdated"] == "2026-09-04T14:30:00+00:00"


def test_a_discharged_identity_renders_as_inactive_and_finished():
    a03 = A01.replace("ADT^A01", "ADT^A03")
    patient, encounter = identity_to_fhir(parse_hl7_adt(a03), source="comed")
    assert patient["active"] is False
    assert encounter["status"] == "finished"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_adt.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.edge.adt'`

- [ ] **Step 3: Write minimal implementation**

Create `homunculus-engine/src/homunculus/edge/adt.py`:

```python
# src/homunculus/edge/adt.py
"""HL7v2 ADT -> PatientIdentity -> FHIR Patient + Encounter.

Comed (the hospital's HIS) is the source of a patient's name and bed. The device never carries
them: a Connex Spot discards whatever a nurse typed once its patient query is answered, so
PID-5/PV1-3 on the reading arrive empty (ward, 2026-09-04). The join key is the **protocol
number** — PID-3.1 here, the same number the nurse types on the device.

This module is pure: HL7 text in, records out. No network, no state, no clock.

PHI: raising is by reason, never by content. Callers log the reason and drop the message.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from homunculus.gateway.fhir import GatewayError
from homunculus.gateway.hl7 import _at, _fields, _parse_hl7_ts  # shared HL7 primitives

# Which trigger events we act on, and what each one means for the record's state. An event that
# is not here is not guessed at: it is ignored (the caller still ACKs it).
_ADMITTED = "admitted"
_DISCHARGED = "discharged"
_EVENTS = {
    "A01": _ADMITTED,    # admit
    "A04": _ADMITTED,    # register
    "A02": _ADMITTED,    # transfer  (location changes, patient stays)
    "A08": _ADMITTED,    # update    (demographics change)
    "A13": _ADMITTED,    # discharge cancelled
    "A03": _DISCHARGED,  # discharge
    "A11": _DISCHARGED,  # admit cancelled
}

# HL7 table 0001 -> FHIR AdministrativeGender. Anything else is "unknown": a sex we cannot read
# is not a sex we invent.
_SEX = {"M": "male", "F": "female", "O": "other", "U": "unknown", "A": "other", "N": "other"}


@dataclass(frozen=True)
class PatientIdentity:
    """Who a protocol number belongs to, and where they are, at one moment in time."""
    patient_id: str          # PID-3.1 — the Comed protocol number
    family: str = ""
    given: str = ""
    birth_date: str = ""     # ISO date, "" when absent
    sex: str = "unknown"
    unit: str = ""
    room: str = ""
    bed: str = ""
    state: str = _ADMITTED
    at: datetime | None = None   # MSH-7: how two messages about one patient are ordered

    @property
    def bed_label(self) -> str:
        """"YB^304^2" -> "YB 304-2". Empty parts fall away rather than leaving punctuation."""
        parts = [p for p in (self.unit, self.room, self.bed) if p]
        if not parts:
            return ""
        return parts[0] if len(parts) == 1 else f"{parts[0]} {'-'.join(parts[1:])}"


def _component(field: str, index: int) -> str:
    """One `^`-separated component of an HL7 field, 1-based, "" when absent."""
    parts = field.split("^")
    return parts[index - 1].strip() if len(parts) >= index else ""


def _protocol_number(pid: list[str]) -> str:
    """PID-3.1..3 only. CX.4/CX.5 are the assigning authority and the id-type code — HL7
    code-table values, never identifiers (taking CX.4 once merged a whole ward into one card)."""
    for component in _at(pid, 3).split("^")[:3]:
        if component.strip():
            return component.strip()
    return ""


def _iso_date(hl7_date: str) -> str:
    digits = "".join(c for c in hl7_date if c.isdigit())[:8]
    if len(digits) != 8:
        return ""
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"


def parse_hl7_adt(message: str) -> PatientIdentity | None:
    """A `PatientIdentity` for an ADT we act on; None for anything else (the caller carries on).

    Raises GatewayError when the message IS an ADT we act on but carries no protocol number —
    an identity with no key is unusable, and guessing one would attach a name to the wrong card.
    """
    segments = [s for s in message.replace("\r\n", "\r").replace("\n", "\r").split("\r") if s]
    if not segments or not segments[0].startswith("MSH"):
        return None
    msh = _fields(segments[0])
    message_type = _at(msh, 8)
    if not message_type.startswith("ADT"):
        return None
    state = _EVENTS.get(_component(message_type, 2))
    if state is None:
        return None

    pid = next((_fields(s) for s in segments if s.startswith("PID")), [])
    patient_id = _protocol_number(pid)
    if not patient_id:
        raise GatewayError("missing or empty PID-3 patient identifier in an ADT message")

    name = _at(pid, 5)
    pv1 = next((_fields(s) for s in segments if s.startswith("PV1")), [])
    location = _at(pv1, 3)

    return PatientIdentity(
        patient_id=patient_id,
        family=_component(name, 1),
        given=_component(name, 2),
        birth_date=_iso_date(_at(pid, 7)),
        sex=_SEX.get(_at(pid, 8).strip().upper(), "unknown"),
        unit=_component(location, 1),
        room=_component(location, 2),
        bed=_component(location, 3),
        state=state,
        at=_parse_hl7_ts(_at(msh, 6)),
    )


def identity_to_fhir(identity: PatientIdentity, source: str) -> tuple[dict, dict]:
    """(Patient, Encounter) for the uplink, in that order — the Encounter references the Patient.

    `meta.lastUpdated` carries MSH-7 so the receiving store can refuse a message that arrives out
    of order, and `meta.source` says which feed it came from ("comed" | "manuel").
    """
    stamp = identity.at.isoformat() if identity.at else ""
    meta = {"lastUpdated": stamp, "source": source}
    admitted = identity.state == _ADMITTED

    patient = {
        "resourceType": "Patient",
        "identifier": [{"system": "http://homunculus.local/protocol-no",
                        "value": identity.patient_id}],
        "name": [{"family": identity.family, "given": [identity.given]}],
        "birthDate": identity.birth_date,
        "gender": identity.sex,
        "active": admitted,
        "meta": meta,
    }
    encounter = {
        "resourceType": "Encounter",
        "status": "in-progress" if admitted else "finished",
        "subject": {"reference": f"Patient/{identity.patient_id}"},
        "location": [{"location": {"display": "^".join([identity.unit, identity.room, identity.bed])}}],
        "period": {"start": stamp},
        "meta": meta,
    }
    return patient, encounter
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_adt.py -q`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/adt.py homunculus-engine/tests/test_edge_adt.py
git commit -m "feat(edge): parse Comed ADT into a patient identity, render it as FHIR

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The bridge's identity mirror

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/identity.py`
- Test: `homunculus-engine/tests/test_edge_identity_mirror.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_identity_mirror.py`:

```python
"""The bridge's local mirror: the only thing that can answer a device query in milliseconds.

Names here are synthetic. The mirror exists because the device waits: NCE gives the host ten
seconds, and a round trip to the cloud on every patient lookup would be a bet on the uplink.
"""
from datetime import datetime, timedelta, timezone

from homunculus.crypto import decrypt_phi
from homunculus.edge.adt import PatientIdentity
from homunculus.edge.identity import IdentityMirror

WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)


def record(**over) -> PatientIdentity:
    base = dict(patient_id="20239121", family="YILMAZ", given="AYSE", birth_date="1980-01-15",
                sex="female", unit="YB", room="304", bed="2", state="admitted", at=WHEN)
    return PatientIdentity(**{**base, **over})


def test_an_identity_written_can_be_read_back(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    got = mirror.get("20239121")
    assert (got.family, got.given, got.birth_date, got.sex) == ("YILMAZ", "AYSE", "1980-01-15", "female")
    assert mirror.get("nobody") is None
    mirror.close()


def test_the_name_is_encrypted_on_disk(tmp_path):
    """A grep of the file must not turn up a patient. The engine's PHI helper does the work."""
    path = tmp_path / "identity.db"
    mirror = IdentityMirror(path)
    mirror.upsert(record())
    mirror.close()
    blob = path.read_bytes()
    assert b"YILMAZ" not in blob and b"AYSE" not in blob
    assert b"20239121" in blob            # the key itself is not encrypted: it is the lookup


def test_an_older_message_does_not_overwrite_a_newer_record(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record(family="YENI", at=WHEN))
    mirror.upsert(record(family="ESKI", at=WHEN - timedelta(minutes=5)))
    assert mirror.get("20239121").family == "YENI"
    mirror.close()


def test_a_repeated_message_is_harmless(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    mirror.upsert(record())
    assert mirror.count() == 1
    mirror.close()


def test_a_discharged_record_survives_24_hours_then_is_pruned(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record(state="discharged"))
    assert mirror.prune(now=WHEN + timedelta(hours=23)) == 0
    assert mirror.get("20239121") is not None
    assert mirror.prune(now=WHEN + timedelta(hours=25)) == 1
    assert mirror.get("20239121") is None
    mirror.close()


def test_an_admitted_record_is_never_pruned(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    assert mirror.prune(now=WHEN + timedelta(days=30)) == 0
    mirror.close()


def test_the_record_survives_a_restart(tmp_path):
    path = tmp_path / "identity.db"
    first = IdentityMirror(path)
    first.upsert(record())
    first.close()
    second = IdentityMirror(path)
    assert second.get("20239121").given == "AYSE"
    second.close()


def test_decryption_round_trips_through_the_engine_helper(tmp_path):
    """Pinned so a change of crypto helper cannot silently write plaintext."""
    mirror = IdentityMirror(tmp_path / "identity.db")
    mirror.upsert(record())
    row = mirror._conn.execute("SELECT family FROM identity").fetchone()
    assert decrypt_phi(row[0]) == "YILMAZ"
    mirror.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_identity_mirror.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.edge.identity'`

- [ ] **Step 3: Write minimal implementation**

Create `homunculus-engine/src/homunculus/edge/identity.py`:

```python
# src/homunculus/edge/identity.py
"""The bridge's identity mirror: protocol number -> who that is, on local disk.

Why it exists: NCE gives its patient-query host ten seconds, and the answer decides whether the
nurse sees the right patient on the device. Asking the cloud on every lookup would put that
answer behind the uplink. The mirror is fed by the same ADT messages that go upstream, so it is
never a second source of truth — only a faster copy of one.

PHI: names, dates of birth and sex are encrypted at rest with the engine's PHI helper. The
protocol number is stored in the clear because it IS the lookup key. Discharged rows are dropped
24 hours later; nothing else is kept.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from homunculus.crypto import decrypt_phi, encrypt_phi
from homunculus.edge.adt import PatientIdentity

DISCHARGED_TTL = timedelta(hours=24)


def _iso(value: datetime | None) -> str:
    return (value or datetime.now(tz=timezone.utc)).isoformat()


class IdentityMirror:
    """Upsert-by-protocol-number, newest message wins."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        # check_same_thread=False: the runner may write from a worker thread, as the buffer does.
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS identity ("
            " patient_id TEXT PRIMARY KEY,"
            " family TEXT, given TEXT, birth_date TEXT, sex TEXT,"
            " unit TEXT, room TEXT, bed TEXT,"
            " state TEXT NOT NULL, at TEXT NOT NULL)"
        )
        self._conn.commit()

    def upsert(self, identity: PatientIdentity) -> bool:
        """Write the record. Returns False when an OLDER message was refused."""
        row = self._conn.execute(
            "SELECT at FROM identity WHERE patient_id = ?", (identity.patient_id,)).fetchone()
        stamp = _iso(identity.at)
        if row is not None and row[0] > stamp:
            return False
        self._conn.execute(
            "INSERT INTO identity (patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, at) VALUES (?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(patient_id) DO UPDATE SET family=excluded.family, given=excluded.given,"
            " birth_date=excluded.birth_date, sex=excluded.sex, unit=excluded.unit,"
            " room=excluded.room, bed=excluded.bed, state=excluded.state, at=excluded.at",
            (identity.patient_id, encrypt_phi(identity.family), encrypt_phi(identity.given),
             encrypt_phi(identity.birth_date), encrypt_phi(identity.sex),
             identity.unit, identity.room, identity.bed, identity.state, stamp),
        )
        self._conn.commit()
        return True

    def get(self, patient_id: str) -> PatientIdentity | None:
        row = self._conn.execute(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, at"
            " FROM identity WHERE patient_id = ?", (patient_id,)).fetchone()
        if row is None:
            return None
        return PatientIdentity(
            patient_id=row[0],
            family=decrypt_phi(row[1]) or "",
            given=decrypt_phi(row[2]) or "",
            birth_date=decrypt_phi(row[3]) or "",
            sex=decrypt_phi(row[4]) or "unknown",
            unit=row[5] or "", room=row[6] or "", bed=row[7] or "",
            state=row[8], at=datetime.fromisoformat(row[9]),
        )

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        """Drop discharged rows older than `ttl`. Returns how many went."""
        cutoff = (now - ttl).isoformat()
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_identity_mirror.py -q`
Expected: PASS — 8 passed. (If `crypto` warns "PHI_ENCRYPTION_KEY not set — using an insecure development key", that is the intended dev fallback and the test still passes.)

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/identity.py homunculus-engine/tests/test_edge_identity_mirror.py
git commit -m "feat(edge): encrypted identity mirror so the device query is answered locally

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The patient query answers with the name

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/pdq.py:38-63` (the `patient_query_response` function)
- Test: `homunculus-engine/tests/test_edge_pdq.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_pdq.py`:

```python
def test_a_known_patient_is_answered_with_name_birth_date_and_sex():
    """The vendor's own sample is PID|||id||Family^Given||dob|sex (Connex CSK IDS 60059617 §5.4.2).
    Field positions matter: NCE's sheets slice with substring-before(...,'|')."""
    from datetime import datetime, timezone

    from homunculus.edge.adt import PatientIdentity

    known = PatientIdentity(patient_id="123456A", family="YILMAZ", given="AYSE",
                            birth_date="1980-01-15", sex="female",
                            at=datetime(2026, 9, 4, tzinfo=timezone.utc))
    reply = patient_query_response(QBP, lookup=lambda pid: known if pid == "123456A" else None)
    pid_fields = segments(reply)["PID"]
    assert pid_fields[3] == "123456A"
    assert pid_fields[5] == "YILMAZ^AYSE"
    assert pid_fields[7] == "19800115"          # HL7 date, not ISO
    assert pid_fields[8] == "F"
    assert len(pid_fields) == 9


def test_an_unknown_patient_still_gets_the_id_only_answer():
    """A patient Comed has not sent us must not block a reading: the id is echoed, nothing else."""
    reply = patient_query_response(QBP, lookup=lambda _pid: None)
    pid_fields = segments(reply)["PID"]
    assert pid_fields[3] == "123456A"
    assert pid_fields[5:] == ["", "", "", ""]


def test_a_lookup_that_raises_degrades_to_the_id_only_answer():
    """A broken mirror must not take the device down."""
    def boom(_pid):
        raise sqlite3.OperationalError("database is locked")

    reply = patient_query_response(QBP, lookup=boom)
    assert segments(reply)["PID"][3] == "123456A"
    assert "MSA|AA" in reply
```

Add `import sqlite3` to the file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_pdq.py -q`
Expected: FAIL — `TypeError: patient_query_response() got an unexpected keyword argument 'lookup'`

- [ ] **Step 3: Write minimal implementation**

In `homunculus-engine/src/homunculus/edge/pdq.py`, add the import and replace the function's signature and its PID line. The whole function becomes:

```python
def patient_query_response(
    message: str,
    lookup: Callable[[str], "PatientIdentity | None"] | None = None,
) -> str | None:
    """An RSP^K22 for a QBP^Q22 query; None for any other message (the caller's handler runs).

    `lookup` maps a protocol number to what the HIS said about it. With a hit, the device shows
    the patient's name and the nurse can confirm they are at the right bed; without one, the id
    is echoed and the reading still flows. A lookup that fails is treated as a miss: a broken
    mirror must never stop a measurement.
    """
    segs = [s for s in message.split("\r") if s]
    if not segs or not segs[0].startswith("MSH|"):
        return None
    msh = _fields(segs[0])
    if not any(_at(msh, 8).startswith(t) for t in _QUERY_TYPES):
        return None

    qpd = next((_fields(s) for s in segs if s.startswith("QPD|")), ["QPD"])
    patient_id = queried_patient_id(qpd)
    control_id = _at(msh, 9)
    query_tag = _at(qpd, 2) or control_id
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    known = None
    if patient_id and lookup is not None:
        try:
            known = lookup(patient_id)
        except Exception:                      # a mirror fault degrades, never blocks
            known = None

    out = [
        "|".join(["MSH", "^~\\&", _at(msh, 4) or "HOMUNCULUS", _at(msh, 5), _at(msh, 2), _at(msh, 3),
                  stamp, "", "RSP^K22^RSP_K21", stamp, "P", _at(msh, 11) or "2.5"]),
        "|".join(["MSA", "AA" if patient_id else "AE", control_id]),
        "|".join(["QAK", query_tag, "OK" if patient_id else "NF"]),
        "|".join(["QPD", _at(qpd, 1), query_tag, f"@PID.3.1^{patient_id}" if patient_id else ""]),
    ]
    if patient_id:
        # Field-complete like the vendor's sample (PID|||id||name||dob|sex), with unknown
        # demographics present but EMPTY. NCE's transform sheets slice fields with
        # substring-before(…,'|'), which yields "" when no delimiter follows — a PID that ended
        # right after the id came back to the device with no id at all (ward, 2026-09-04).
        name = f"{known.family}^{known.given}" if known else ""
        dob = known.birth_date.replace("-", "") if known else ""
        sex = _FHIR_SEX_TO_HL7.get(known.sex, "") if known else ""
        out.append("|".join(["PID", "", "", patient_id, "", name, "", dob, sex]))
    return "\r".join(out) + "\r"
```

Add above the function, after `_ID_TAGS`:

```python
# FHIR AdministrativeGender -> HL7 table 0001, for the answer we hand back to the device.
_FHIR_SEX_TO_HL7 = {"male": "M", "female": "F", "other": "O", "unknown": "U"}
```

And at the top of the file, with the other imports:

```python
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:                    # import only for typing: pdq stays free of edge-layer deps
    from homunculus.edge.adt import PatientIdentity
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_pdq.py -q`
Expected: PASS — 10 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/pdq.py homunculus-engine/tests/test_edge_pdq.py
git commit -m "feat(edge): answer the device's patient query with the name when the HIS sent one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire ADT into the bridge

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/bridge.py` (imports, `BridgeStats`, `EdgeBridge.__init__`, `handle_message`, `answer_query`)
- Test: `homunculus-engine/tests/test_edge_bridge_adt.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_bridge_adt.py`:

```python
"""ADT reaching the bridge: mirrored locally, forwarded upstream, counted separately.

Synthetic names throughout.
"""
import pytest

from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.identity import IdentityMirror
from homunculus.gateway.fhir import GatewayError

A01 = (
    "MSH|^~\\&|COMED|HOSP|HOMUNCULUS|HOSP|20260904143000||ADT^A01|MSG1|P|2.5\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE^N||19800115|F\r"
    "PV1|1|I|YB^304^2\r"
)
ORU = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143525||ORU^R01^ORU_R01|X1|P|2.6\r"
    "PID|1||20239121^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F|||20260904143525\r"
)
QBP = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143000||QBP^Q22^QBP_Q21|C1|P|2.6\r"
    "QPD|IHE PDQ Query|C1|@PID.3.1^20239121~@PID3.4^EMR\r"
    "RCP|I|1^RD\r"
)


def make(tmp_path):
    sent: list[dict] = []
    mirror = IdentityMirror(tmp_path / "identity.db")
    bridge = EdgeBridge(send=sent.append, mapping={"150456": __import__(
        "homunculus.canonical", fromlist=["SignalCode"]).SignalCode.SPO2}, identity=mirror)
    return bridge, sent, mirror


def test_an_adt_is_forwarded_as_two_resources_and_counted_apart_from_readings(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    assert bridge.handle_message(A01) == []          # an ADT yields no observations
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter"]
    assert sent[0]["identifier"][0]["value"] == "20239121"
    assert (bridge.stats.adt, bridge.stats.messages, bridge.stats.rejected) == (1, 1, 0)
    mirror.close()


def test_an_adt_lands_in_the_mirror_so_the_next_query_carries_the_name(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    bridge.handle_message(A01)
    reply = bridge.answer_query(QBP)
    assert "PID|||20239121||YILMAZ^AYSE||19800115|F" in reply
    assert bridge.stats.queries == 1
    mirror.close()


def test_readings_still_flow_and_are_unaffected(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    observations = bridge.handle_message(ORU)
    assert len(observations) == 1 and observations[0].patient_id == "20239121"
    assert bridge.stats.adt == 0
    mirror.close()


def test_an_adt_without_an_id_is_rejected_and_nothing_is_forwarded(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    with pytest.raises(GatewayError, match="PID-3"):
        bridge.handle_message(A01.replace("20239121^^^COMED^PI", "^^^COMED^PI"))
    assert sent == [] and bridge.stats.rejected == 1
    mirror.close()


def test_a_bridge_without_a_mirror_still_forwards_the_adt(tmp_path):
    """The mirror is an optimisation for the device; the upstream record is the point."""
    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append)
    bridge.handle_message(A01)
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter"]
    assert bridge.answer_query(QBP).count("PID|||20239121|||||") == 1


def test_a_mirror_that_cannot_be_written_does_not_stop_the_record(tmp_path):
    """A local disk fault must cost the device its name, never the board its patient."""
    class Broken:
        def upsert(self, _identity):
            raise sqlite3.OperationalError("attempt to write a readonly database")

        def get(self, _patient_id):
            return None

    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append, identity=Broken())
    bridge.handle_message(A01)
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter"]
    assert bridge.stats.adt == 1
```

Add `import sqlite3` to this test file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_bridge_adt.py -q`
Expected: FAIL — `TypeError: EdgeBridge.__init__() got an unexpected keyword argument 'identity'`

- [ ] **Step 3: Write minimal implementation**

In `homunculus-engine/src/homunculus/edge/bridge.py`:

Add to the imports:

```python
from homunculus.edge.adt import identity_to_fhir, parse_hl7_adt
from homunculus.edge.identity import IdentityMirror
```

Add to `BridgeStats` (after `queries`):

```python
    adt: int = 0                # ADT messages accepted (identity records, not readings)
```

`EdgeBridge` is a dataclass; add the field after `mapping` (keep it optional so every existing
call site and test keeps working):

```python
    identity: IdentityMirror | None = None
    identity_source: str = "comed"
```

Replace `handle_message` with:

```python
    def handle_message(self, message: str) -> list[Observation]:
        """Parse one HL7 message and forward what it carries.

        Three kinds arrive on this port: ADT (who a protocol number is), ORU (readings), and
        QBP queries — the last are answered by `answer_query` before they ever reach here.
        """
        self.stats.messages += 1
        try:
            identity = parse_hl7_adt(message)
        except GatewayError as exc:
            self.stats.rejected += 1
            _log.warning("rejected an unusable ADT message: %s (content not logged)", exc)
            raise
        if identity is not None:
            self._record_identity(identity)
            return []

        try:
            observations = parse_hl7_oru(message, self.mapping)
        except GatewayError as exc:
            # Count it and name the reason; never log the content (PHI). GatewayError texts are
            # static strings or message metadata by construction, never a value — and a
            # rejection that does not say why costs a blind diagnosis round (ward, 2026-09-04:
            # every ORU from NCE was "unparseable" because PID-3 carried no id).
            self.stats.rejected += 1
            _log.warning("rejected an unusable HL7 message: %s (content not logged)", exc)
            raise

        self._record_unmapped(message)

        for obs in observations:
            self.send(observation_to_fhir(obs))
        self.stats.observations += len(observations)
        return observations

    def _record_identity(self, identity) -> None:
        """Mirror it for the device, then forward it upstream for the board."""
        if self.identity is not None:
            try:
                self.identity.upsert(identity)
            except Exception:       # a mirror fault must not stop the upstream record
                _log.exception("could not write the identity mirror (content not logged)")
        for resource in identity_to_fhir(identity, source=self.identity_source):
            self.send(resource)
        self.stats.adt += 1
```

Replace the body of `answer_query` so it passes the mirror in:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_bridge_adt.py tests/test_edge_bridge_mllp.py tests/test_edge_pdq.py -q`
Expected: PASS — all green

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/bridge.py homunculus-engine/tests/test_edge_bridge_adt.py
git commit -m "feat(edge): the bridge mirrors ADT locally and forwards it as FHIR

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The runner opens the mirror and reports it

**Files:**
- Modify: `homunculus-engine/scripts/run_bridge.py` (imports, `report_loop`, `main_async`, `main`)
- Test: `homunculus-engine/tests/test_run_bridge_identity.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_run_bridge_identity.py`:

```python
"""The runner's identity wiring: a default path beside the buffer, and a counter in the report."""
import run_bridge


def test_the_identity_database_defaults_to_a_sibling_of_the_buffer():
    args = run_bridge.build_parser().parse_args(["--db", "/data/bridge.db"])
    assert run_bridge.identity_path(args) == "/data/bridge.db.identity"


def test_an_explicit_identity_path_wins():
    args = run_bridge.build_parser().parse_args(
        ["--db", "/data/bridge.db", "--identity-db", "/data/other.db"])
    assert run_bridge.identity_path(args) == "/data/other.db"


def test_identity_can_be_switched_off_for_a_site_with_no_his():
    args = run_bridge.build_parser().parse_args(["--db", "/data/bridge.db", "--no-identity"])
    assert run_bridge.identity_path(args) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_run_bridge_identity.py -q`
Expected: FAIL — `AttributeError: module 'run_bridge' has no attribute 'build_parser'`

- [ ] **Step 3: Write minimal implementation**

In `homunculus-engine/scripts/run_bridge.py`:

Add to the imports:

```python
from homunculus.edge.identity import IdentityMirror
```

Add after `load_mapping`:

```python
def identity_path(args: argparse.Namespace) -> str | None:
    """Where the identity mirror lives: beside the buffer unless told otherwise, or nowhere.

    A site with no HIS feed has nothing to mirror, and `--no-identity` says so out loud rather
    than leaving an empty database to puzzle over.
    """
    if getattr(args, "no_identity", False):
        return None
    return args.identity_db or f"{args.db}.identity"
```

The runner currently builds its parser inline in `main`. Extract it so the tests (and any other
caller) can reach it: replace the parser construction in `main` with a call to a new
`build_parser()` that contains exactly the existing arguments plus the two new ones:

```python
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Homunculus edge bridge")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=2575)
    parser.add_argument("--db", default="bridge-buffer.db", help="durable buffer file")
    parser.add_argument("--mapping", default=None, help="site-mapping.json")
    parser.add_argument("--cloud-url", default="", help="e.g. http://api:8000 (empty = discovery)")
    parser.add_argument("--token", default="", help="tenant bearer token")
    parser.add_argument("--flush-interval", type=float, default=2.0)
    parser.add_argument("--report-interval", type=float, default=30.0)
    parser.add_argument("--max-buffer", type=int, default=200_000)
    parser.add_argument("--identity-db", default="", help="identity mirror (default: <db>.identity)")
    parser.add_argument("--no-identity", action="store_true",
                        help="no HIS feed at this site: do not keep an identity mirror")
    return parser
```

Keep every flag the file already declares; if this list and the file disagree, the file wins —
add `--identity-db` and `--no-identity` to what is there rather than replacing the flags.

In `main`, replace the inline parser with:

```python
    args = build_parser().parse_args(argv)
```

In `main_async`, open the mirror and hand it to the bridge:

```python
    path = identity_path(args)
    identity = IdentityMirror(path) if path else None
    bridge = EdgeBridge(send=send, mapping=load_mapping(args.mapping), identity=identity)
```

and in the `finally:` block, next to `buffer.close()`:

```python
        if identity is not None:
            identity.close()
```

In `report_loop`, extend the counter line and prune spent records:

```python
async def report_loop(bridge: EdgeBridge, buffer: SqliteBuffer, interval: float) -> None:
    """Periodic operator report: throughput, buffer depth, and unmapped identifiers."""
    while True:
        await asyncio.sleep(interval)
        stats = bridge.stats
        kimlik = bridge.identity.count() if bridge.identity is not None else 0
        _log.info("mesaj=%s gözlem=%s reddedilen=%s sorgu=%s adt=%s kimlik=%s kuyruk=%s",
                  stats.messages, stats.observations, stats.rejected, stats.queries,
                  stats.adt, kimlik, buffer.depth())
        if bridge.identity is not None:
            bridge.identity.prune(now=datetime.now(tz=timezone.utc))
        report = bridge.discovery_report()
        if report:
            _log.warning("%s", report)
```

Add `from datetime import datetime, timezone` to the imports if the file does not already have it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_run_bridge_identity.py -q`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/scripts/run_bridge.py homunculus-engine/tests/test_run_bridge_identity.py
git commit -m "feat(edge): runner opens the identity mirror, reports adt= and kimlik=

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The API's identity record and store

**Files:**
- Create: `homunculus-engine/src/homunculus/api/identity.py`
- Test: `homunculus-engine/tests/test_api_identity.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_api_identity.py`:

```python
"""Identity records behind /ingest: FHIR in, board-shaped records out, names encrypted at rest.

Synthetic names. The store follows the AuditLog pattern — a protocol plus an in-memory
implementation for tests and a SQLite one for the server.
"""
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.identity import (
    InMemoryIdentityStore, SqliteIdentityStore, parse_fhir_encounter, parse_fhir_patient,
)
from homunculus.crypto import decrypt_phi
from homunculus.gateway.fhir import GatewayError

WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)
PATIENT = {
    "resourceType": "Patient",
    "identifier": [{"system": "http://homunculus.local/protocol-no", "value": "20239121"}],
    "name": [{"family": "YILMAZ", "given": ["AYSE"]}],
    "birthDate": "1980-01-15",
    "gender": "female",
    "active": True,
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}
ENCOUNTER = {
    "resourceType": "Encounter",
    "status": "in-progress",
    "subject": {"reference": "Patient/20239121"},
    "location": [{"location": {"display": "YB^304^2"}}],
    "period": {"start": WHEN.isoformat()},
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path):
    made = (InMemoryIdentityStore() if request.param == "memory"
            else SqliteIdentityStore(tmp_path / "identity.db"))
    yield made
    made.close()


def test_a_patient_resource_becomes_a_record(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    record = store.get("h1", "20239121")
    assert (record.family, record.given, record.birth_date) == ("YILMAZ", "AYSE", "1980-01-15")
    assert (record.sex, record.state, record.source) == ("female", "admitted", "comed")
    assert record.display_name == "AYSE YILMAZ"


def test_an_encounter_adds_the_bed_without_erasing_the_name(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    record = store.get("h1", "20239121")
    assert record.family == "YILMAZ"
    assert (record.unit, record.room, record.bed) == ("YB", "304", "2")
    assert record.bed_label == "YB 304-2"


def test_an_encounter_alone_is_a_record_with_a_bed_and_no_name(store):
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    record = store.get("h1", "20239121")
    assert record.display_name == "" and record.bed_label == "YB 304-2"


def test_one_hospital_never_sees_another(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    assert store.get("h2", "20239121") is None
    assert store.admitted_ids("h2") == []


def test_an_older_message_does_not_overwrite_a_newer_record(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    stale = {**PATIENT, "name": [{"family": "ESKI", "given": ["X"]}],
             "meta": {"lastUpdated": (WHEN - timedelta(minutes=5)).isoformat(), "source": "comed"}}
    store.apply("h1", parse_fhir_patient(stale))
    assert store.get("h1", "20239121").family == "YILMAZ"


def test_a_discharge_flips_the_state_and_frees_the_bed(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    done = {**ENCOUNTER, "status": "finished",
            "meta": {"lastUpdated": (WHEN + timedelta(hours=2)).isoformat(), "source": "comed"}}
    store.apply("h1", parse_fhir_encounter(done))
    record = store.get("h1", "20239121")
    assert record.state == "discharged"
    assert store.admitted_ids("h1") == []


def test_a_discharged_record_is_pruned_after_24_hours(store):
    store.apply("h1", parse_fhir_patient({**PATIENT, "active": False}))
    assert store.prune(WHEN + timedelta(hours=23)) == 0
    assert store.prune(WHEN + timedelta(hours=25)) == 1
    assert store.get("h1", "20239121") is None


def test_admitted_ids_lists_the_patients_a_board_must_show(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    assert store.admitted_ids("h1") == ["20239121"]


def test_a_resource_without_a_protocol_number_is_refused_by_name():
    with pytest.raises(GatewayError, match="protocol number"):
        parse_fhir_patient({**PATIENT, "identifier": []})
    with pytest.raises(GatewayError, match="protocol number"):
        parse_fhir_encounter({**ENCOUNTER, "subject": {"reference": "Patient/"}})


def test_a_resource_of_the_wrong_type_is_refused():
    with pytest.raises(GatewayError, match="Patient"):
        parse_fhir_patient(ENCOUNTER)
    with pytest.raises(GatewayError, match="Encounter"):
        parse_fhir_encounter(PATIENT)


def test_the_sqlite_store_encrypts_the_name_at_rest(tmp_path):
    path = tmp_path / "identity.db"
    store = SqliteIdentityStore(path)
    store.apply("h1", parse_fhir_patient(PATIENT))
    row = store._conn.execute("SELECT family FROM identity").fetchone()
    assert decrypt_phi(row[0]) == "YILMAZ"
    store.close()
    assert b"YILMAZ" not in path.read_bytes()


def test_the_sqlite_store_survives_a_restart(tmp_path):
    path = tmp_path / "identity.db"
    first = SqliteIdentityStore(path)
    first.apply("h1", parse_fhir_patient(PATIENT))
    first.close()
    second = SqliteIdentityStore(path)
    assert second.get("h1", "20239121").given == "AYSE"
    second.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_api_identity.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.identity'`

- [ ] **Step 3: Write minimal implementation**

Create `homunculus-engine/src/homunculus/api/identity.py`:

```python
# src/homunculus/api/identity.py
"""Who a protocol number belongs to — the board's side of the HIS feed.

The bridge turns Comed's ADT into FHIR `Patient` and `Encounter` resources and sends them through
the same /ingest the readings use. This module accepts them, keeps one record per protocol number
per hospital, and hands the board a name and a bed.

Two implementations behind one protocol, exactly as the audit log does it: in-memory for tests,
SQLite for the server. Identity is NOT rehydrated from the audit log — the audit deliberately
carries no name, so the record's durability has to live here instead.

PHI: name, date of birth and sex are encrypted at rest. The protocol number is the key and stays
in the clear. Discharged records are dropped 24 hours later.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from homunculus.crypto import decrypt_phi, encrypt_phi
from homunculus.gateway.fhir import GatewayError

PROTOCOL_SYSTEM = "http://homunculus.local/protocol-no"
DISCHARGED_TTL = timedelta(hours=24)
_ADMITTED = "admitted"
_DISCHARGED = "discharged"


@dataclass(frozen=True)
class IdentityRecord:
    """One patient as the HIS describes them. Fields not yet known stay empty, never invented."""
    patient_id: str
    family: str = ""
    given: str = ""
    birth_date: str = ""
    sex: str = "unknown"
    unit: str = ""
    room: str = ""
    bed: str = ""
    state: str = _ADMITTED
    source: str = ""
    updated_at: datetime | None = None

    @property
    def display_name(self) -> str:
        return " ".join(p for p in (self.given, self.family) if p)

    @property
    def bed_label(self) -> str:
        parts = [p for p in (self.unit, self.room, self.bed) if p]
        if not parts:
            return ""
        return parts[0] if len(parts) == 1 else f"{parts[0]} {'-'.join(parts[1:])}"

    def as_board(self) -> dict:
        return {
            "patient_id": self.patient_id,
            "display_name": self.display_name,
            "bed_label": self.bed_label,
            "state": self.state,
            "source": self.source,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


def _meta(resource: dict) -> tuple[datetime | None, str]:
    meta = resource.get("meta") or {}
    stamp = meta.get("lastUpdated") or ""
    try:
        when = datetime.fromisoformat(stamp) if stamp else None
    except ValueError:
        when = None
    return when, str(meta.get("source", ""))


def parse_fhir_patient(resource: dict) -> IdentityRecord:
    """FHIR Patient -> the demographic half of a record."""
    if resource.get("resourceType") != "Patient":
        raise GatewayError(f"expected resourceType 'Patient', got {resource.get('resourceType')!r}")
    patient_id = ""
    for ident in resource.get("identifier") or []:
        if ident.get("system") == PROTOCOL_SYSTEM and str(ident.get("value", "")).strip():
            patient_id = str(ident["value"]).strip()
            break
    if not patient_id:
        raise GatewayError(f"missing protocol number (identifier with system {PROTOCOL_SYSTEM})")

    names = resource.get("name") or [{}]
    given = (names[0].get("given") or [""])[0]
    when, source = _meta(resource)
    return IdentityRecord(
        patient_id=patient_id,
        family=str(names[0].get("family", "")),
        given=str(given),
        birth_date=str(resource.get("birthDate", "")),
        sex=str(resource.get("gender", "unknown")),
        state=_ADMITTED if resource.get("active", True) else _DISCHARGED,
        source=source,
        updated_at=when,
    )


def parse_fhir_encounter(resource: dict) -> IdentityRecord:
    """FHIR Encounter -> the location half of a record."""
    if resource.get("resourceType") != "Encounter":
        raise GatewayError(
            f"expected resourceType 'Encounter', got {resource.get('resourceType')!r}")
    reference = (resource.get("subject") or {}).get("reference", "")
    patient_id = reference.split("/", 1)[1].strip() if "/" in reference else ""
    if not patient_id:
        raise GatewayError("missing protocol number (subject.reference)")

    locations = resource.get("location") or [{}]
    display = ((locations[0].get("location") or {}).get("display", ""))
    parts = (display.split("^") + ["", "", ""])[:3]
    when, source = _meta(resource)
    return IdentityRecord(
        patient_id=patient_id,
        unit=parts[0], room=parts[1], bed=parts[2],
        state=_ADMITTED if resource.get("status") == "in-progress" else _DISCHARGED,
        source=source,
        updated_at=when,
    )


def _merge(existing: IdentityRecord | None, incoming: IdentityRecord) -> IdentityRecord | None:
    """Fold `incoming` into `existing`. None means "refused: this message is older".

    A Patient carries demographics, an Encounter a location; neither erases what the other knows.
    """
    if existing is None:
        return incoming
    if (existing.updated_at and incoming.updated_at
            and incoming.updated_at < existing.updated_at):
        return None
    changed = {k: v for k, v in (
        ("family", incoming.family), ("given", incoming.given),
        ("birth_date", incoming.birth_date), ("unit", incoming.unit),
        ("room", incoming.room), ("bed", incoming.bed),
    ) if v}
    if incoming.sex != "unknown":
        changed["sex"] = incoming.sex
    return replace(existing, state=incoming.state, source=incoming.source or existing.source,
                   updated_at=incoming.updated_at or existing.updated_at, **changed)


class IdentityStore(Protocol):
    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None: ...
    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None: ...
    def admitted_ids(self, hospital: str) -> list[str]: ...
    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int: ...
    def close(self) -> None: ...


class InMemoryIdentityStore:
    """For tests and for a deployment that accepts losing identities on restart."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], IdentityRecord] = {}

    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None:
        key = (hospital, incoming.patient_id)
        merged = _merge(self._rows.get(key), incoming)
        if merged is None:
            return None
        self._rows[key] = merged
        return merged

    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None:
        return self._rows.get((hospital, patient_id))

    def admitted_ids(self, hospital: str) -> list[str]:
        return sorted(pid for (h, pid), r in self._rows.items()
                      if h == hospital and r.state == _ADMITTED)

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        cutoff = now - ttl
        gone = [k for k, r in self._rows.items()
                if r.state == _DISCHARGED and r.updated_at and r.updated_at < cutoff]
        for key in gone:
            del self._rows[key]
        return len(gone)

    def close(self) -> None:
        pass


class SqliteIdentityStore:
    """Durable and encrypted. Same file family as the audit database."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS identity ("
            " tenant TEXT NOT NULL, patient_id TEXT NOT NULL,"
            " family TEXT, given TEXT, birth_date TEXT, sex TEXT,"
            " unit TEXT, room TEXT, bed TEXT,"
            " state TEXT NOT NULL, source TEXT, updated_at TEXT,"
            " PRIMARY KEY (tenant, patient_id))"
        )
        self._conn.commit()

    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None:
        merged = _merge(self.get(hospital, incoming.patient_id), incoming)
        if merged is None:
            return None
        self._conn.execute(
            "INSERT INTO identity (tenant, patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, source, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(tenant, patient_id) DO UPDATE SET family=excluded.family,"
            " given=excluded.given, birth_date=excluded.birth_date, sex=excluded.sex,"
            " unit=excluded.unit, room=excluded.room, bed=excluded.bed, state=excluded.state,"
            " source=excluded.source, updated_at=excluded.updated_at",
            (hospital, merged.patient_id, encrypt_phi(merged.family), encrypt_phi(merged.given),
             encrypt_phi(merged.birth_date), encrypt_phi(merged.sex),
             merged.unit, merged.room, merged.bed, merged.state, merged.source,
             merged.updated_at.isoformat() if merged.updated_at else None),
        )
        self._conn.commit()
        return merged

    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None:
        row = self._conn.execute(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, source,"
            " updated_at FROM identity WHERE tenant = ? AND patient_id = ?",
            (hospital, patient_id)).fetchone()
        if row is None:
            return None
        return IdentityRecord(
            patient_id=row[0],
            family=decrypt_phi(row[1]) or "", given=decrypt_phi(row[2]) or "",
            birth_date=decrypt_phi(row[3]) or "", sex=decrypt_phi(row[4]) or "unknown",
            unit=row[5] or "", room=row[6] or "", bed=row[7] or "",
            state=row[8], source=row[9] or "",
            updated_at=datetime.fromisoformat(row[10]) if row[10] else None,
        )

    def admitted_ids(self, hospital: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT patient_id FROM identity WHERE tenant = ? AND state = ? ORDER BY patient_id",
            (hospital, _ADMITTED)).fetchall()
        return [r[0] for r in rows]

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        cutoff = (now - ttl).isoformat()
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = ? AND updated_at IS NOT NULL AND updated_at < ?",
            (_DISCHARGED, cutoff))
        self._conn.commit()
        return cur.rowcount

    def close(self) -> None:
        self._conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_api_identity.py -q`
Expected: PASS — 20 passed (11 tests, two of them parametrised over both stores)

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/identity.py homunculus-engine/tests/test_api_identity.py
git commit -m "feat(api): identity records behind /ingest, encrypted at rest, tenant-scoped

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `/ingest` accepts identity resources

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (imports, `create_app` signature, `/ingest`, escalation cycle)
- Test: `homunculus-engine/tests/test_api_identity_ingest.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_api_identity_ingest.py`:

```python
"""Identity through the API: /ingest accepts it, the board carries it, the audit does not.

Synthetic names. Mirrors the style of the other API tests: create_app with the escalation loop
off so nothing is timing-dependent.
"""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import InMemoryIdentityStore

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)
PATIENT = {
    "resourceType": "Patient",
    "identifier": [{"system": "http://homunculus.local/protocol-no", "value": "20239121"}],
    "name": [{"family": "YILMAZ", "given": ["AYSE"]}],
    "birthDate": "1980-01-15", "gender": "female", "active": True,
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}
ENCOUNTER = {
    "resourceType": "Encounter", "status": "in-progress",
    "subject": {"reference": "Patient/20239121"},
    "location": [{"location": {"display": "YB^304^2"}}],
    "period": {"start": WHEN.isoformat()},
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}
OBSERVATION = {
    "resourceType": "Observation", "status": "final",
    "code": {"coding": [{"system": "http://homunculus.local/obs", "code": "spo2"}]},
    "subject": {"reference": "Patient/20239121"},
    "effectiveDateTime": WHEN.isoformat(),
    "valueQuantity": {"value": 97.0, "unit": "%"},
    "device": {"display": "nce"},
}


@pytest.fixture
def client():
    audit = InMemoryAuditLog()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit,
                     identities=InMemoryIdentityStore())
    with TestClient(app) as c:
        c.audit = audit
        yield c


def test_a_patient_resource_is_accepted_and_appears_on_the_board(client):
    assert client.post("/ingest", json=PATIENT, headers=HEAD).status_code == 200
    [entry] = client.get("/patients", headers=HEAD).json()["patients"]
    assert entry["patient_id"] == "20239121"
    assert entry["identity"]["display_name"] == "AYSE YILMAZ"
    assert entry["identity"]["source"] == "comed"
    assert entry["latest"]["spo2"] is None          # admitted, not yet measured


def test_an_encounter_adds_the_bed(client):
    client.post("/ingest", json=PATIENT, headers=HEAD)
    client.post("/ingest", json=ENCOUNTER, headers=HEAD)
    [entry] = client.get("/patients", headers=HEAD).json()["patients"]
    assert entry["identity"]["bed_label"] == "YB 304-2"


def test_a_reading_for_a_known_patient_lands_on_the_same_card(client):
    client.post("/ingest", json=PATIENT, headers=HEAD)
    client.post("/ingest", json=OBSERVATION, headers=HEAD)
    patients = client.get("/patients", headers=HEAD).json()["patients"]
    assert len(patients) == 1
    assert patients[0]["latest"]["spo2"] == 97.0
    assert patients[0]["identity"]["display_name"] == "AYSE YILMAZ"


def test_a_reading_without_an_identity_still_makes_a_card(client):
    client.post("/ingest", json=OBSERVATION, headers=HEAD)
    [entry] = client.get("/patients", headers=HEAD).json()["patients"]
    assert entry["identity"] is None
    assert entry["latest"]["spo2"] == 97.0


def test_the_audit_records_the_event_but_never_the_name(client):
    client.post("/ingest", json=PATIENT, headers=HEAD)
    records = client.get("/audit", headers=HEAD).json()
    events = records if isinstance(records, list) else next(
        v for v in records.values() if isinstance(v, list))
    identity_events = [e for e in events if e["event_type"] == "identity"]
    assert len(identity_events) == 1
    assert identity_events[0]["patient_id"] == "20239121"
    assert identity_events[0]["payload"] == {"source": "comed", "state": "admitted",
                                             "resource": "Patient"}
    assert "YILMAZ" not in str(records) and "AYSE" not in str(records)


def test_a_malformed_identity_resource_is_refused_with_400(client):
    broken = {**PATIENT, "identifier": []}
    response = client.post("/ingest", json=broken, headers=HEAD)
    assert response.status_code == 400
    assert "protocol number" in response.json()["detail"]


def test_one_hospital_never_sees_another_hospitals_identity():
    app = create_app({TOKEN: "h1", "tok-2": "h2"}, run_escalation_loop=False,
                     identities=InMemoryIdentityStore())
    with TestClient(app) as c:
        c.post("/ingest", json=PATIENT, headers=HEAD)
        assert c.get("/patients", headers={"Authorization": "Bearer tok-2"}).json()["patients"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_api_identity_ingest.py -q`
Expected: FAIL — `TypeError: create_app() got an unexpected keyword argument 'identities'`

- [ ] **Step 3: Write minimal implementation**

In `homunculus-engine/src/homunculus/api/app.py`:

Add to the imports:

```python
from homunculus.api.identity import (
    IdentityStore, InMemoryIdentityStore, parse_fhir_encounter, parse_fhir_patient,
)
```

Add a parameter to `create_app` (keyword-only, after `audit`):

```python
    identities: IdentityStore | None = None,
```

Extend its docstring with:

```
    `identities` holds who a protocol number belongs to (from the HIS ADT feed). Injected so a
    test can use the in-memory store and the server a durable, encrypted one; identity is NOT
    rehydrated from the audit log, because the audit deliberately carries no name.
```

Just below `audit = audit or InMemoryAuditLog()` add:

```python
    identities = identities or InMemoryIdentityStore()
```

In `/ingest`, dispatch on the resource type. Replace the first lines of the handler:

```python
    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
        hospital = await _hospital(authorization)
        kind = resource.get("resourceType")
        if kind in ("Patient", "Encounter"):
            return await _ingest_identity(hospital, resource, kind)
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
```

(the rest of the observation path is unchanged), and add this helper next to `_live_keys`:

```python
    async def _ingest_identity(hospital: str, resource: dict, kind: str) -> dict:
        """A Patient or Encounter from the HIS: update the record, audit the fact, publish."""
        parse = parse_fhir_patient if kind == "Patient" else parse_fhir_encounter
        try:
            incoming = parse(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        record = identities.apply(hospital, incoming)
        if record is None:          # an older message than what we already hold
            return {"patient_id": incoming.patient_id, "identity": "stale"}
        # PHI: the audit says THAT an identity arrived, never WHO. The name lives only in the
        # identity store, encrypted; the audit log is read by more eyes and kept for longer.
        audit.append(AuditEvent(hospital, "identity", record.patient_id, "",
                                {"source": record.source, "state": record.state,
                                 "resource": kind}))
        engine = _engine(hospital)
        store = _store(hospital)
        board = (patient_board(engine, record.patient_id, store, identity=record)
                 if record.patient_id in set(engine.patient_ids())
                 else identity_only_board(record))
        await broadcaster.publish(hospital, board)
        return {"patient_id": record.patient_id, "identity": "ok"}
```

Import the two board builders (Task 8 adds `identity_only_board`):

```python
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
```

Every existing `patient_board(...)` / `board_snapshot(...)` call in this file gains the identity
argument. There are four: in `/ingest` (observation path), `/ack`, `/patients`, and the
escalation cycle. Pass the record for that patient:

```python
        await broadcaster.publish(hospital, patient_board(
            engine, obs.patient_id, store, identity=identities.get(hospital, obs.patient_id)))
```

```python
        board = patient_board(engine, patient_id, store,
                              identity=identities.get(hospital, patient_id))
```

```python
    @app.get("/patients")
    async def patients(authorization: str | None = Header(default=None)):
        hospital = await _hospital(authorization)
        return {"patients": board_snapshot(_engine(hospital), _store(hospital),
                                           identities=identities, hospital=hospital)}
```

In `_escalation_cycle`, after the existing body, prune spent identities:

```python
        identities.prune(now)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_api_identity_ingest.py -q`
Expected: PASS — 7 passed. (This task's tests need Task 8's `board.py` changes; do Task 8 first if
you are running tasks out of order.)

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_identity_ingest.py
git commit -m "feat(api): /ingest accepts Patient and Encounter, audits the event not the name

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The board carries an identity block

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/board.py:41-61`
- Test: `homunculus-engine/tests/test_api_board_identity.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_api_board_identity.py`:

```python
"""The board's identity block: present when the HIS told us, null when it did not.

Synthetic names.
"""
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.identity import IdentityRecord, InMemoryIdentityStore
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)
RECORD = IdentityRecord(patient_id="20239121", family="YILMAZ", given="AYSE", unit="YB",
                        room="304", bed="2", source="comed", updated_at=WHEN)


def engine_with_a_reading() -> Engine:
    engine = Engine()
    engine.ingest(Observation("20239121", SignalCode.SPO2, 97.0, "%", WHEN, "nce"), now=WHEN)
    return engine


def test_a_card_without_an_identity_keeps_todays_shape():
    board = patient_board(engine_with_a_reading(), "20239121", AckStore())
    assert board["identity"] is None
    assert board["latest"]["spo2"] == 97.0


def test_a_card_with_an_identity_carries_name_bed_state_and_source():
    board = patient_board(engine_with_a_reading(), "20239121", AckStore(), identity=RECORD)
    assert board["identity"] == {
        "patient_id": "20239121",
        "display_name": "AYSE YILMAZ",
        "bed_label": "YB 304-2",
        "state": "admitted",
        "source": "comed",
        "updated_at": WHEN.isoformat(),
    }


def test_an_admitted_patient_with_no_reading_still_gets_a_card():
    board = identity_only_board(RECORD)
    assert board["patient_id"] == "20239121"
    assert board["risk"] == "none" and board["alerts"] == []
    assert board["identity"]["display_name"] == "AYSE YILMAZ"
    assert set(board["latest"]) == {"heart_rate", "map", "spo2", "temperature", "resp_rate",
                                    "lactate", "sofa"}
    assert all(v is None for v in board["latest"].values())


def test_the_snapshot_unions_measured_patients_and_admitted_ones():
    identities = InMemoryIdentityStore()
    identities.apply("h1", RECORD)
    identities.apply("h1", IdentityRecord(patient_id="99999", given="BORIS", family="X",
                                          source="comed", updated_at=WHEN))
    snapshot = board_snapshot(engine_with_a_reading(), AckStore(),
                              identities=identities, hospital="h1")
    ids = [entry["patient_id"] for entry in snapshot]
    assert ids == ["20239121", "99999"]
    assert snapshot[0]["latest"]["spo2"] == 97.0        # measured
    assert snapshot[1]["latest"]["spo2"] is None        # admitted only


def test_the_snapshot_without_a_store_is_unchanged():
    snapshot = board_snapshot(engine_with_a_reading(), AckStore())
    assert [e["patient_id"] for e in snapshot] == ["20239121"]
    assert snapshot[0]["identity"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_api_board_identity.py -q`
Expected: FAIL — `ImportError: cannot import name 'identity_only_board'`

- [ ] **Step 3: Write minimal implementation**

In `homunculus-engine/src/homunculus/api/board.py`, add the import:

```python
from homunculus.api.identity import IdentityRecord, IdentityStore
```

Add above `patient_board`:

```python
_EMPTY_LATEST = {
    "heart_rate": None, "map": None, "spo2": None, "temperature": None,
    "resp_rate": None, "lactate": None, "sofa": None,
}


def identity_only_board(record: IdentityRecord) -> dict:
    """A card for a patient the HIS has admitted but no device has measured yet.

    Built without touching the Engine on purpose: `Engine.state` creates the patient's state on
    read, which would leave an empty record behind for every admission that never gets a reading.
    """
    return {
        "patient_id": record.patient_id,
        "risk": "none",
        "alerts": [],
        "latest": dict(_EMPTY_LATEST),
        "identity": record.as_board(),
    }
```

Change `patient_board` and `board_snapshot`:

```python
def patient_board(engine: Engine, patient_id: str, store: AckStore,
                  identity: IdentityRecord | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
        "patient_id": patient_id,
        "risk": _risk(alerts),
        "alerts": [_merge_alert(patient_id, a, store) for a in alerts],
        "latest": {
            "heart_rate": _latest(state, SignalCode.HEART_RATE),
            "map": _latest(state, SignalCode.MAP),
            "spo2": _latest(state, SignalCode.SPO2),
            "temperature": _latest(state, SignalCode.TEMPERATURE),
            "resp_rate": _latest(state, SignalCode.RESP_RATE),
            "lactate": _latest(state, SignalCode.LACTATE),
            "sofa": total_sofa(state),
        },
        # Null, never a placeholder: a name we do not have is not a name we invent.
        "identity": identity.as_board() if identity is not None else None,
    }


def board_snapshot(engine: Engine, store: AckStore,
                   identities: IdentityStore | None = None,
                   hospital: str = "") -> list[dict]:
    """Every card: measured patients first, then patients the HIS admitted but nobody measured."""
    measured = engine.patient_ids()
    boards = [
        patient_board(engine, pid, store,
                      identity=identities.get(hospital, pid) if identities else None)
        for pid in measured
    ]
    if identities is None:
        return boards
    seen = set(measured)
    for pid in identities.admitted_ids(hospital):
        if pid not in seen:
            record = identities.get(hospital, pid)
            if record is not None:
                boards.append(identity_only_board(record))
    return boards
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_api_board_identity.py tests/test_api_identity_ingest.py -q`
Expected: PASS — 12 passed

Then the whole suite: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — every previously passing test still passes (the new arguments are optional).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_api_board_identity.py
git commit -m "feat(api): board entries carry an identity block; admitted patients get a card

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end — ADT to the board and back to the device

**Files:**
- Test: `homunculus-engine/tests/test_edge_identity_e2e.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_identity_e2e.py`:

```python
"""One synthetic admission, all the way through: Comed ADT -> bridge -> API -> board, and the
device query answered with the name in between. No network, no hardware."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import InMemoryIdentityStore
from homunculus.canonical import SignalCode
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.identity import IdentityMirror

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
A01 = (
    "MSH|^~\\&|COMED|HOSP|HOMUNCULUS|HOSP|20260904143000||ADT^A01|MSG1|P|2.5\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE^N||19800115|F\r"
    "PV1|1|I|YB^304^2\r"
)
QBP = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143100||QBP^Q22^QBP_Q21|C1|P|2.6\r"
    "QPD|IHE PDQ Query|C1|@PID.3.1^20239121~@PID3.4^EMR\r"
    "RCP|I|1^RD\r"
)
ORU = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143525||ORU^R01^ORU_R01|X1|P|2.6\r"
    "PID|1||20239121^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F|||20260904143525+0400\r"
)
A03 = A01.replace("ADT^A01", "ADT^A03").replace("20260904143000", "20260904180000")


def test_an_admission_names_the_card_the_reading_lands_on(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    client = TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False,
                                   identities=InMemoryIdentityStore()))
    with client:
        def send(resource: dict) -> None:
            assert client.post("/ingest", json=resource, headers=HEAD).status_code == 200

        bridge = EdgeBridge(send=send, mapping={"150456": SignalCode.SPO2}, identity=mirror)

        # 1. Comed admits the patient.
        bridge.handle_message(A01)
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["identity"]["display_name"] == "AYSE YILMAZ"
        assert card["identity"]["bed_label"] == "YB 304-2"
        assert card["latest"]["spo2"] is None

        # 2. The nurse types the protocol number; the device is told who that is.
        reply = bridge.answer_query(QBP)
        assert "PID|||20239121||YILMAZ^AYSE||19800115|F" in reply

        # 3. The reading lands on the same card.
        bridge.handle_message(ORU)
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["latest"]["spo2"] == 97.0
        assert card["identity"]["display_name"] == "AYSE YILMAZ"

        # 4. Discharge frees the bed but leaves the card until it is pruned.
        bridge.handle_message(A03)
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["identity"]["state"] == "discharged"
    mirror.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_edge_identity_e2e.py -q`
Expected: PASS if Tasks 1–8 are done. If you are running tasks in order it should already be green —
run it anyway: this is the test that proves the slice, and a failure here means one of the earlier
tasks is wrong.

- [ ] **Step 3: No implementation**

This task adds no production code. If the test fails, fix the task it points at rather than
patching around it here.

- [ ] **Step 4: Run the whole suite**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q`
Expected: PASS — all green

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/tests/test_edge_identity_e2e.py
git commit -m "test(edge): end-to-end — admission names the card the reading lands on

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Operator script for manual identity entry

**Files:**
- Create: `homunculus-engine/scripts/set_identity.py`
- Test: `homunculus-engine/tests/test_set_identity_script.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_set_identity_script.py`:

```python
"""The stop-gap until Comed is wired: one patient entered by hand, same path as the HIS feed."""
import pytest

import set_identity


def test_it_builds_the_same_two_resources_the_bridge_would():
    args = set_identity.build_parser().parse_args(
        ["--patient-id", "20239121", "--family", "YILMAZ", "--given", "AYSE",
         "--birth-date", "1980-01-15", "--sex", "female", "--bed", "YB^304^2",
         "--cloud-url", "http://api:8000", "--token", "t"])
    patient, encounter = set_identity.resources(args)
    assert patient["resourceType"] == "Patient"
    assert patient["identifier"][0]["value"] == "20239121"
    assert patient["name"][0] == {"family": "YILMAZ", "given": ["AYSE"]}
    assert patient["meta"]["source"] == "manuel"
    assert encounter["location"][0]["location"]["display"] == "YB^304^2"
    assert encounter["status"] == "in-progress"


def test_a_discharge_flips_both_resources():
    args = set_identity.build_parser().parse_args(
        ["--patient-id", "20239121", "--discharge",
         "--cloud-url", "http://api:8000", "--token", "t"])
    patient, encounter = set_identity.resources(args)
    assert patient["active"] is False and encounter["status"] == "finished"


def test_the_patient_id_is_required():
    with pytest.raises(SystemExit):
        set_identity.build_parser().parse_args(["--cloud-url", "http://api:8000", "--token", "t"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_set_identity_script.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'set_identity'`

- [ ] **Step 3: Write minimal implementation**

Create `homunculus-engine/scripts/set_identity.py`:

```python
"""Enter one patient's identity by hand, until Comed's ADT feed is wired.

    python scripts/set_identity.py --patient-id 20239121 --family YILMAZ --given AYSE \
        --birth-date 1980-01-15 --sex female --bed "YB^304^2" \
        --cloud-url http://api:8000 --token <tenant-token>

    python scripts/set_identity.py --patient-id 20239121 --discharge \
        --cloud-url http://api:8000 --token <tenant-token>

It posts exactly what the bridge posts for an ADT message, marked `source: "manuel"` so the board
can say where the name came from. PHI: the name is on this command line — clear the shell history
on a shared machine, and prefer the HIS feed as soon as it exists.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.edge.adt import PatientIdentity, identity_to_fhir  # noqa: E402
from homunculus.edge.uplink import post_json  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Enter a patient identity by hand")
    parser.add_argument("--patient-id", required=True, help="the protocol number (Comed)")
    parser.add_argument("--family", default="", help="surname")
    parser.add_argument("--given", default="", help="first name")
    parser.add_argument("--birth-date", default="", help="ISO date, e.g. 1980-01-15")
    parser.add_argument("--sex", default="unknown",
                        choices=["male", "female", "other", "unknown"])
    parser.add_argument("--bed", default="", help='unit^room^bed, e.g. "YB^304^2"')
    parser.add_argument("--discharge", action="store_true", help="mark the patient discharged")
    parser.add_argument("--cloud-url", required=True, help="e.g. http://api:8000")
    parser.add_argument("--token", required=True, help="tenant bearer token")
    return parser


def resources(args: argparse.Namespace) -> tuple[dict, dict]:
    unit, room, bed = (args.bed.split("^") + ["", "", ""])[:3]
    identity = PatientIdentity(
        patient_id=args.patient_id, family=args.family, given=args.given,
        birth_date=args.birth_date, sex=args.sex, unit=unit, room=room, bed=bed,
        state="discharged" if args.discharge else "admitted",
        at=datetime.now(tz=timezone.utc),
    )
    return identity_to_fhir(identity, source="manuel")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    url = args.cloud_url.rstrip("/") + "/ingest"
    for resource in resources(args):
        post_json(url, args.token, resource)      # signature is (url, token, payload, timeout)
        print(f"{resource['resourceType']} gönderildi: {args.patient_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_set_identity_script.py -q`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/scripts/set_identity.py homunculus-engine/tests/test_set_identity_script.py
git commit -m "feat(edge): set_identity.py — enter one patient by hand until Comed is wired

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The dashboard shows the name and the bed

**Files:**
- Modify: `dashboard/src/liveAdapters.js:12-50` (`patientFromBoard`)
- Test: `dashboard/src/liveAdapters.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `dashboard/src/liveAdapters.test.js`:

```javascript
describe("identity on a board entry", () => {
  const withIdentity = {
    patient_id: "20239121",
    risk: "none",
    alerts: [],
    latest: { heart_rate: 84, spo2: 97 },
    identity: {
      patient_id: "20239121",
      display_name: "AYSE YILMAZ",
      bed_label: "YB 304-2",
      state: "admitted",
      source: "comed",
      updated_at: "2026-09-04T14:30:00+00:00",
    },
  };

  it("carries the name, the bed and where they came from", () => {
    const patient = patientFromBoard(withIdentity);
    expect(patient.display_name).toBe("AYSE YILMAZ");
    expect(patient.bedLabel).toBe("YB 304-2");
    expect(patient.protocolNo).toBe("20239121");
    expect(patient.source).toBe("comed");
    expect(patient.identityUpdatedAt).toBe("2026-09-04T14:30:00+00:00");
  });

  it("leaves every identity field null when the HIS has said nothing", () => {
    const patient = patientFromBoard({ ...withIdentity, identity: null });
    expect(patient.display_name).toBeNull();
    expect(patient.bedLabel).toBeNull();
    expect(patient.protocolNo).toBeNull();
    expect(patient.source).toBe("device");
  });

  it("does not treat a discharged patient as admitted", () => {
    const discharged = { ...withIdentity, identity: { ...withIdentity.identity, state: "discharged" } };
    expect(patientFromBoard(discharged).identityState).toBe("discharged");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npm test -- liveAdapters`
Expected: FAIL — `expected undefined to be 'AYSE YILMAZ'`

- [ ] **Step 3: Write minimal implementation**

In `dashboard/src/liveAdapters.js`, inside `patientFromBoard`, replace the identity-related nulls.
Add above the `return`:

```javascript
  // The HIS (Comed) is the only source of a name or a bed. Absent it, these stay null — an
  // invented name on a clinical board is worse than no name at all.
  const identity = entry?.identity ?? null;
```

and replace the fields in the returned object:

```javascript
    display_name: identity?.display_name || null,
    sex: null,
    age: null,
    ageDays: null,
    isNeonate: false,
    tc_no: null,
    tcMasked: null,
    phone: null,
    address: null,
    mrn: null,
    protocolNo: identity?.patient_id ?? null,
    bedId: null,
    bedLabel: identity?.bed_label || null,
    unitId: null,
    diagnosis: null,
    admittedBy: null,
    admittedAtMs: null,
    identityState: identity?.state ?? null,
    identityUpdatedAt: identity?.updated_at ?? null,
    source: identity?.source || "device",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npm test`
Expected: PASS — every dashboard test green

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js
git commit -m "feat(dashboard): board cards show the HIS name and bed when there is one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The phone shows the name too

**Files:**
- Modify: `homunculus-mobile/src/transport/types.ts:41-47` (`PatientBoard`)
- Modify: `homunculus-mobile/src/ui/BedCard.tsx`
- Modify: `homunculus-mobile/src/i18n/tr.ts`
- Test: `homunculus-mobile/__tests__/bedCardIdentity.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/bedCardIdentity.test.tsx`:

```tsx
/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { BedCard } from "../src/ui/BedCard";
import type { PatientView } from "../src/store/boardStore";
import type { BoardIdentity, PatientBoard } from "../src/transport/types";

const IDENTITY: BoardIdentity = {
  patient_id: "bed-3",
  display_name: "AYSE YILMAZ",
  bed_label: "YB 304-2",
  state: "admitted",
  source: "comed",
  updated_at: "2026-09-04T14:30:00+00:00",
};

function view(identity: BoardIdentity | null): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "none", alerts: [], identity,
    latest: { heart_rate: 84, map: null, spo2: 97, temperature: null, resp_rate: null,
              lactate: null, sofa: null },
  };
  return {
    board, top: null, tone: "safe", escalated: false, unacknowledged: false,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [], spo2: [], temperature: [], resp_rate: [], lactate: [],
              sofa: [] },
  };
}

const noop = () => {};

it("shows the patient's name when the HIS sent one", async () => {
  await render(<BedCard view={view(IDENTITY)} onPress={noop} onAck={noop} />);
  expect(screen.getByText("AYSE YILMAZ")).toBeTruthy();
});

it("shows no name when the HIS has said nothing", async () => {
  await render(<BedCard view={view(null)} onPress={noop} onAck={noop} />);
  expect(screen.queryByText("AYSE YILMAZ")).toBeNull();
  expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();   // the card is unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-mobile && npm test -- bedCardIdentity`
Expected: FAIL — the name is not rendered

- [ ] **Step 3: Write minimal implementation**

In `homunculus-mobile/src/transport/types.ts`, add above `PatientBoard`:

```typescript
/** Who a protocol number belongs to, as the HIS (Comed) told the server. Absent until it does. */
export interface BoardIdentity {
  patient_id: string;
  display_name: string;
  bed_label: string;
  state: "admitted" | "discharged";
  source: string;
  updated_at: string | null;
}
```

and add the field to `PatientBoard`:

```typescript
  identity?: BoardIdentity | null;
```

In `homunculus-mobile/src/ui/BedCard.tsx`, render the name under the bed number. Immediately after
the `<Text>` that renders `bedNumber(board.patient_id)` (around line 108-110), add:

```tsx
            {board.identity?.display_name ? (
              <Text
                className="text-foreground text-[11px] font-semibold"
                numberOfLines={1}
                accessibilityLabel={`patient-name-${board.patient_id}`}
              >
                {board.identity.display_name}
              </Text>
            ) : null}
```

`board` is already destructured from `view` at the top of the component
(`const { board, top } = view;`), so no new prop is needed. `text-foreground` is the class the
surrounding text in this file already uses; the smaller size is what makes it secondary.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-mobile && npm test`
Expected: PASS — the full mobile suite green

Then: `cd homunculus-mobile && npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile/src/transport/types.ts homunculus-mobile/src/ui/BedCard.tsx homunculus-mobile/__tests__/bedCardIdentity.test.tsx
git commit -m "feat(mobile): bed cards show the HIS name when there is one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Deployment and documentation

**Files:**
- Modify: `deploy/local/docker-compose.yml` (the `bridge` service)
- Modify: `deploy/local/nce-doctor.sh`
- Modify: `docs/EDGE-BRIDGE-LOCAL.md`
- Modify: `homunculus-engine/src/homunculus/api/devserver.py`

- [ ] **Step 1: Wire the API's durable identity store**

In `homunculus-engine/src/homunculus/api/devserver.py`, where `SqliteAuditLog("homunculus-audit.db")`
is constructed, add the identity store beside it and pass it to `create_app`:

```python
from homunculus.api.identity import SqliteIdentityStore

app = create_app(
    ...,
    audit=SqliteAuditLog("homunculus-audit.db"),
    identities=SqliteIdentityStore("homunculus-identity.db"),
)
```

Keep every other argument the file already passes.

- [ ] **Step 2: Give the bridge its encryption key and identity volume**

In `deploy/local/docker-compose.yml`, in the `bridge` service's `environment:` block add:

```yaml
      # The identity mirror stores names at rest; encrypt them with the same key the API uses.
      PHI_ENCRYPTION_KEY: ${PHI_ENCRYPTION_KEY}
      JWT_SECRET: ${JWT_SECRET}
```

The mirror is written next to the buffer inside the existing `bridge-data` volume, so no new
volume is needed. Add `PHI_ENCRYPTION_KEY` to `deploy/local/.env.example` with the same
"generate, do not invent" note the other secrets carry:

```bash
# Encryption key for names at rest (identity records, both API and bridge). Generate it:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
PHI_ENCRYPTION_KEY=change-me
```

- [ ] **Step 3: Show identity in the layer check**

In `deploy/local/nce-doctor.sh`, in the section that reads the bridge's report line, add:

```bash
hr "7. kimlik (HIS akışı)"
docker logs homunculus-bridge 2>&1 | grep -oE "adt=[0-9]+ kimlik=[0-9]+" | tail -1
echo "son ADT: $(docker logs homunculus-bridge 2>&1 | grep -c 'ADT' || echo 0) mesaj"
docker exec homunculus-api python -c "
from homunculus.api.identity import SqliteIdentityStore
s = SqliteIdentityStore('/app/homunculus-identity.db')
print('kayıtlı kimlik:', len(s.admitted_ids('$(grep -E "^TENANT_SLUG=" .env | cut -d= -f2-)')))
s.close()" 2>/dev/null || echo "(kimlik deposu okunamadı)"
```

- [ ] **Step 4: Document the route**

Append to `docs/EDGE-BRIDGE-LOCAL.md`:

```markdown
## The HIS route: Comed ADT gives the board a name and a bed

A reading carries a protocol number and nothing else — the Connex Spot discards the name and room
a nurse types the moment its patient query is answered. The name comes from the hospital's HIS
instead: point Comed's ADT output (A01/A02/A03/A08/A11/A13) at the same MLLP port the readings
use, `LISTEN_ADDR:2575`. The bridge mirrors each identity locally (encrypted, `<db>.identity`) so
the device's patient query is answered with the name in milliseconds, and forwards it upstream as
FHIR `Patient` + `Encounter` so the board can show it.

Operationally:

- Report line gains `adt=` (identities accepted) and `kimlik=` (rows in the mirror).
- `PHI_ENCRYPTION_KEY` must be set for the API **and** the bridge, to the same value.
- Discharged records disappear 24 hours after the discharge message, on both sides.
- Identity is **not** rehydrated from the audit log: the audit records that an identity arrived,
  never who — so the record's durability lives in `homunculus-identity.db` instead.
- Until Comed is wired, `scripts/set_identity.py` enters one patient by hand through the same
  path, marked `source: "manuel"` on the board.

The questions Comed's team needs to answer are listed in
`docs/superpowers/specs/2026-09-04-comed-adt-identity-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add deploy/local/docker-compose.yml deploy/local/.env.example deploy/local/nce-doctor.sh docs/EDGE-BRIDGE-LOCAL.md homunculus-engine/src/homunculus/api/devserver.py
git commit -m "chore(deploy): identity store, bridge encryption key, doctor line, runbook section

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q` — all green, ~60 tests added.
- `cd dashboard && npm test` — green. `cd homunculus-mobile && npm test && npm run typecheck` — green.
- On the VM: a `set_identity.py` call puts a name on a card; the next Connex reading for that
  protocol number lands on the same card; the device shows the name when the nurse types the id.
- Nothing in `docker logs homunculus-bridge`, `docker logs homunculus-api` or `/audit` contains a
  patient's name.
