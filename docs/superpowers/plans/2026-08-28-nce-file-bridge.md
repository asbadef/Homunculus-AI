# NCE File Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the session files Welch Allyn NCE already writes to disk, turn them into canonical Observations, and feed them through the bridge's existing buffer and uplink into `/ingest` — without changing anything on the NCE server.

**Architecture:** A read-only SMB mount exposes NCE's `SavedCopies` folder to the bridge container. A directory watcher finds unprocessed session files in timestamp order and records them in a SQLite ledger (the share is read-only, so we cannot mark progress by moving files). A structure-agnostic parser walks the session XML, maps field names to `SignalCode` through a site file, and emits `Observation`s. Everything downstream — `observation_to_fhir`, `SqliteBuffer`, the flush loop — is reused unchanged.

**Tech Stack:** Python 3.12, standard library only (see constraint below), pytest, SQLite, Docker Compose, CIFS/SMB.

**Design spec:** [docs/superpowers/specs/2026-08-28-nce-file-bridge-design.md](../specs/2026-08-28-nce-file-bridge-design.md)

---

## Hard constraint: standard library only

`homunculus-engine/Dockerfile` builds the bridge image with **no pip install at all** — its comment
explains why: a hospital device VLAN frequently has no internet, and an image that needs a package
mirror is an image that cannot be rebuilt on site. Every module in this plan is imported by that
image.

**Do not add a dependency to solve anything in this plan.** No `lxml`, no `pydantic`, no `watchdog`.
Everything here uses `xml.etree.ElementTree`, `sqlite3`, `json`, `re`, `pathlib`, `dataclasses` and
`datetime`, all of which ship with Python.

## Running the tests

All commands run from the `homunculus-engine` directory. `pyproject.toml` already sets
`pythonpath = ["src", "tests"]` and `testpaths = ["tests"]`, so no environment variables are needed:

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

On the Windows dev machine the interpreter is `.venv/Scripts/python.exe`; substitute it for `python`
if a bare `python` is not the project venv.

## File structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/homunculus/edge/ncefiles.py` | Pure format: site mapping, field extraction, session → `Observation`s. No filesystem, no network. |
| `src/homunculus/edge/filewatch.py` | Directory scan, filename-epoch ordering, processed-file ledger. No parsing, no network. |
| `src/homunculus/edge/ncebridge.py` | `NceFileBridge`: ties parsing to the send callback, counts what it could not use, reports it. Mirrors `EdgeBridge`. |
| `src/homunculus/edge/uplink.py` | `post_json` + `flush_loop`, moved out of `scripts/run_bridge.py` so both bridges share one uplink. |
| `scripts/run_nce_bridge.py` | CLI + wiring, mirroring `scripts/run_bridge.py` including its discovery mode. |
| `deploy/local/nce-mapping.json` | Site field table. Ships empty — it is written from discovery output. |
| `tests/test_edge_uplink.py`, `tests/test_edge_filewatch.py`, `tests/test_edge_ncefiles.py`, `tests/test_edge_ncebridge.py` | Tests, one per unit. |

**Modify:**

| File | Change |
| --- | --- |
| `scripts/run_bridge.py:56-92` | Delete `post_json`/`flush_loop`, import them from `edge.uplink`. |
| `deploy/local/docker-compose.yml` | Add the `nce` service and the read-only mount. |
| `deploy/local/.env.example` | Add `NCE_SHARE_PATH`. |
| `docs/EDGE-BRIDGE-LOCAL.md` | Replace the "WACP dead end" note with the NCE file route. |

---

### Task 1: Extract the uplink so both bridges share one

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/uplink.py`
- Modify: `homunculus-engine/scripts/run_bridge.py:56-92`
- Test: `homunculus-engine/tests/test_edge_uplink.py`

This is a pure move. No behaviour changes. Doing it first keeps it reviewable on its own.

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_uplink.py`:

```python
"""The uplink drains the buffer in order and acks only what was delivered.

Extracted from run_bridge.py so the HL7 bridge and the NCE file bridge cannot drift into two
different delivery behaviours. Order is the property under test: delivering a later observation
past a stuck earlier one would let the engine read a past state as the present.
"""
from __future__ import annotations

import asyncio

import pytest

from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.uplink import flush_once


def test_delivers_oldest_first_and_acks_them(tmp_path):
    buffer = SqliteBuffer(tmp_path / "b.db")
    for n in (1, 2, 3):
        buffer.append({"n": n})
    sent: list[dict] = []

    delivered = asyncio.run(flush_once(buffer, sender=sent.append))

    assert [p["n"] for p in sent] == [1, 2, 3]
    assert delivered == 3
    assert buffer.depth() == 0


def test_a_failure_stops_the_pass_and_leaves_the_rest_queued(tmp_path):
    buffer = SqliteBuffer(tmp_path / "b.db")
    for n in (1, 2, 3):
        buffer.append({"n": n})
    sent: list[dict] = []

    def sender(payload: dict) -> None:
        if payload["n"] == 2:
            raise RuntimeError("uplink down")
        sent.append(payload)

    delivered = asyncio.run(flush_once(buffer, sender=sender))

    assert [p["n"] for p in sent] == [1]
    assert delivered == 1
    assert buffer.depth() == 2       # 2 and 3 stay queued, in order
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_uplink.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'homunculus.edge.uplink'`

- [ ] **Step 3: Create the module**

Create `homunculus-engine/src/homunculus/edge/uplink.py`:

```python
# src/homunculus/edge/uplink.py
"""Delivering a buffered payload to the cloud, and draining the buffer in order.

Lifted out of scripts/run_bridge.py so the HL7 bridge and the NCE file bridge share one delivery
path. Two bridges with two copies of this loop would eventually disagree about ordering or acking,
and the disagreement would only show up as missing observations on a ward.

PHI: payloads are patient data. Nothing here logs a payload — only counts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable

from homunculus.edge.buffer import SqliteBuffer

_log = logging.getLogger(__name__)


def post_json(url: str, token: str, payload: dict, timeout: float = 10.0) -> None:
    """Deliver one observation to the cloud. Raises on any non-2xx so the row stays queued."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"uplink returned {response.status}")


async def flush_once(
    buffer: SqliteBuffer,
    *,
    sender: Callable[[dict], None],
    limit: int = 100,
) -> int:
    """One drain pass, oldest first. Stops at the first failure, leaving the rest queued in order.

    Returns how many were delivered. The sender runs on a worker thread because it does blocking
    network I/O and this loop shares an event loop with the file watcher.
    """
    batch = buffer.pending(limit=limit)
    if not batch:
        return 0

    delivered: list[int] = []
    for row_id, payload in batch:
        try:
            await asyncio.to_thread(sender, payload)
            delivered.append(row_id)
        except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
            _log.warning("uplink unavailable (%s); %s observation(s) stay queued",
                         exc.__class__.__name__, buffer.depth() - len(delivered))
            break
    buffer.ack(delivered)
    if delivered:
        _log.info("forwarded %s observation(s); %s still queued", len(delivered), buffer.depth())
    return len(delivered)


async def flush_loop(buffer: SqliteBuffer, ingest_url: str, token: str, interval: float) -> None:
    """Drain the buffer to the cloud forever, pausing `interval` seconds between passes."""
    while True:
        await asyncio.sleep(interval)
        await flush_once(buffer, sender=lambda p: post_json(ingest_url, token, p))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_uplink.py -v
```

Expected: PASS, 2 passed

- [ ] **Step 5: Point run_bridge.py at the new module**

In `homunculus-engine/scripts/run_bridge.py`, delete the `post_json` function (lines 56-67) and the
`flush_loop` function (lines 69-92), delete the now-unused `import urllib.error` and
`import urllib.request` lines, and add the import next to the other `homunculus.edge` imports:

```python
from homunculus.edge.uplink import flush_loop
```

The call site in `main_async` is unchanged — it already reads:

```python
        tasks.append(asyncio.create_task(
            flush_loop(buffer, ingest_url, args.token, args.flush_interval)))
```

- [ ] **Step 6: Run the whole suite — the extraction must change nothing**

```bash
cd homunculus-engine
python -m pytest -q
```

Expected: PASS, same number of tests as before the change, no failures. If any bridge test fails,
the move was a rewrite; revert and redo it as a literal move.

- [ ] **Step 7: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/uplink.py homunculus-engine/scripts/run_bridge.py homunculus-engine/tests/test_edge_uplink.py
git commit -m "refactor(edge): share one uplink between bridges"
```

---

### Task 2: Read the UTC epoch out of a session filename

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/filewatch.py`
- Test: `homunculus-engine/tests/test_edge_filewatch.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_filewatch.py`:

```python
"""Finding unprocessed NCE session files, in the order they were written.

The share is mounted read-only, so progress cannot be recorded by moving or renaming a file the way
a file feeder normally would. The ledger here is the only record that a session was forwarded.
"""
from __future__ import annotations

from homunculus.edge.filewatch import session_epoch

REAL_NAME = "TCP_10.10.98.229_35900-1787921687-24464-DeviceSession.xml"


def test_epoch_is_read_from_the_session_filename():
    assert session_epoch(REAL_NAME) == 1787921687


def test_a_name_carrying_no_epoch_yields_none():
    """NCE's own config files live in the same tree; they are not sessions."""
    assert session_epoch("NCEConfig.xml") is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_filewatch.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'homunculus.edge.filewatch'`

- [ ] **Step 3: Create the module with the epoch reader**

Create `homunculus-engine/src/homunculus/edge/filewatch.py`:

```python
# src/homunculus/edge/filewatch.py
"""Which NCE session files still need forwarding, and in what order.

NCE writes one file per device session into SavedCopies and never tells us it has done so. This
module answers two questions and nothing else: which files are new, and which order they go in.
Parsing lives in ncefiles.py; delivery lives in uplink.py.

PHI: file *names* are device metadata (peer address, port, timestamp) and may be logged. File
*contents* are patient data and are never read here.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# Session names look like: TCP_10.10.98.229_35900-1787921687-24464-DeviceSession.xml
# The ten-digit group is seconds since the Unix epoch. This was established, not assumed:
# 1787921620 decodes to 2026-08-28 12:53:40 UTC and 1787921687 to 12:54:47 UTC, and the 67-second
# gap matches the two files' write times exactly.
_EPOCH_IN_NAME = re.compile(r"-(\d{10})-")


def session_epoch(name: str) -> int | None:
    """The UTC epoch NCE stamped into a session filename, or None if it carries none."""
    match = _EPOCH_IN_NAME.search(name)
    return int(match.group(1)) if match else None
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_filewatch.py -v
```

Expected: PASS, 2 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/filewatch.py homunculus-engine/tests/test_edge_filewatch.py
git commit -m "feat(edge): read the UTC epoch out of an NCE session filename"
```

---

### Task 3: The processed-file ledger

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/filewatch.py`
- Test: `homunculus-engine/tests/test_edge_filewatch.py`

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_filewatch.py`:

```python
from homunculus.edge.filewatch import ProcessedLedger


def test_a_recorded_file_is_not_offered_again(tmp_path):
    ledger = ProcessedLedger(tmp_path / "ledger.db")

    ledger.record(REAL_NAME, size=4096, mtime=1787921687)

    assert ledger.seen(REAL_NAME, size=4096, mtime=1787921687) is True


def test_the_ledger_survives_a_restart(tmp_path):
    path = tmp_path / "ledger.db"
    first = ProcessedLedger(path)
    first.record(REAL_NAME, size=4096, mtime=1787921687)
    first.close()

    second = ProcessedLedger(path)

    assert second.seen(REAL_NAME, size=4096, mtime=1787921687) is True


def test_a_file_that_grew_after_we_read_it_is_offered_again(tmp_path):
    """Keying on the name alone would skip appended content forever, invisibly."""
    ledger = ProcessedLedger(tmp_path / "ledger.db")
    ledger.record(REAL_NAME, size=4096, mtime=1787921687)

    assert ledger.seen(REAL_NAME, size=8192, mtime=1787921700) is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_filewatch.py -v
```

Expected: FAIL with `ImportError: cannot import name 'ProcessedLedger'`

- [ ] **Step 3: Add the ledger**

Add to `homunculus-engine/src/homunculus/edge/filewatch.py` — the `sqlite3` import goes at the top
with the others:

```python
import sqlite3


class ProcessedLedger:
    """Which session files have already been forwarded.

    Keyed by name AND size AND modification time, not by name alone: if NCE appends to a session
    after our first read, a name-keyed ledger would skip the new content forever and the loss would
    be invisible. Modification time is stored as whole seconds because the value crosses a network
    filesystem, where sub-second precision is neither stable nor comparable.
    """

    def __init__(self, path: str | Path) -> None:
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS processed ("
            " name TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL,"
            " PRIMARY KEY (name, size, mtime))"
        )
        self._conn.commit()

    def seen(self, name: str, size: int, mtime: int) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM processed WHERE name = ? AND size = ? AND mtime = ?",
            (name, size, mtime),
        ).fetchone()
        return row is not None

    def record(self, name: str, size: int, mtime: int) -> None:
        self._conn.execute(
            "INSERT OR IGNORE INTO processed (name, size, mtime) VALUES (?, ?, ?)",
            (name, size, mtime),
        )
        self._conn.commit()

    def count(self) -> int:
        (total,) = self._conn.execute("SELECT count(*) FROM processed").fetchone()
        return int(total)

    def close(self) -> None:
        self._conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_filewatch.py -v
```

Expected: PASS, 5 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/filewatch.py homunculus-engine/tests/test_edge_filewatch.py
git commit -m "feat(edge): ledger of forwarded NCE sessions, keyed by name+size+mtime"
```

---

### Task 4: List unprocessed files, oldest first

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/filewatch.py`
- Test: `homunculus-engine/tests/test_edge_filewatch.py`

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_filewatch.py`:

```python
from homunculus.edge.filewatch import pending_files


def _write(directory, name, body="<S/>"):
    path = directory / name
    path.write_text(body, encoding="utf-8")
    return path


def test_files_come_back_oldest_first(tmp_path):
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921687-2-DeviceSession.xml")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    ledger = ProcessedLedger(tmp_path / "ledger.db")

    found = pending_files(tmp_path, ledger)

    assert [f.epoch for f in found] == [1787921620, 1787921687]


def test_a_recorded_file_is_skipped(tmp_path):
    path = _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    ledger = ProcessedLedger(tmp_path / "ledger.db")
    stat = path.stat()
    ledger.record(path.name, stat.st_size, int(stat.st_mtime))

    assert pending_files(tmp_path, ledger) == []


def test_since_excludes_older_sessions(tmp_path):
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921687-2-DeviceSession.xml")
    ledger = ProcessedLedger(tmp_path / "ledger.db")

    found = pending_files(tmp_path, ledger, since_epoch=1787921687)

    assert [f.epoch for f in found] == [1787921687]


def test_a_file_with_no_epoch_sorts_last_but_is_not_dropped(tmp_path):
    """An unreadable name is not a reason to lose a reading."""
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    _write(tmp_path, "odd-name.xml")
    ledger = ProcessedLedger(tmp_path / "ledger.db")

    found = pending_files(tmp_path, ledger)

    assert [f.name for f in found] == [
        "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml",
        "odd-name.xml",
    ]


def test_a_missing_directory_yields_nothing_rather_than_raising(tmp_path):
    """A mount that has dropped must not kill the loop; it may come back on its own."""
    ledger = ProcessedLedger(tmp_path / "ledger.db")

    assert pending_files(tmp_path / "not-mounted", ledger) == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_filewatch.py -v
```

Expected: FAIL with `ImportError: cannot import name 'pending_files'`

- [ ] **Step 3: Add the scanner**

Add to `homunculus-engine/src/homunculus/edge/filewatch.py` — the `logging` import goes at the top:

```python
import logging

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SessionFile:
    """One session file on the share, with everything the ledger needs to key it."""
    path: Path
    name: str
    size: int
    mtime: int
    epoch: int | None


def pending_files(
    directory: str | Path,
    ledger: ProcessedLedger,
    *,
    since_epoch: int | None = None,
    limit: int = 500,
) -> list[SessionFile]:
    """Unprocessed session files, oldest first.

    Ordered by the epoch in the name so the buffer's oldest-first guarantee means something:
    delivering a later observation past an earlier one would let the engine read a past state as the
    present. Files whose name carries no epoch sort last, by name, rather than being dropped.

    An unreadable directory returns an empty list and logs. A dropped mount is a condition to ride
    out, not a reason to exit — the bridge that exits is the one nobody restarts.
    """
    root = Path(directory)
    try:
        entries = list(root.iterdir())
    except OSError as exc:
        _log.warning("session directory unreadable (%s): %s", exc.__class__.__name__, root)
        return []

    found: list[SessionFile] = []
    for entry in entries:
        try:
            if not entry.is_file():
                continue
            stat = entry.stat()
        except OSError:
            continue        # vanished or unreadable between listing and stat; next pass will see it
        epoch = session_epoch(entry.name)
        if since_epoch is not None and epoch is not None and epoch < since_epoch:
            continue
        size, mtime = stat.st_size, int(stat.st_mtime)
        if ledger.seen(entry.name, size, mtime):
            continue
        found.append(SessionFile(entry, entry.name, size, mtime, epoch))

    found.sort(key=lambda f: (f.epoch is None, f.epoch or 0, f.name))
    return found[:limit]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_filewatch.py -v
```

Expected: PASS, 10 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/filewatch.py homunculus-engine/tests/test_edge_filewatch.py
git commit -m "feat(edge): list unprocessed NCE sessions oldest-first"
```

---

### Task 5: The site mapping file

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/ncefiles.py`
- Test: `homunculus-engine/tests/test_edge_ncefiles.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_ncefiles.py`:

```python
"""NCE session files -> canonical Observations.

Every fixture here is hand-written and synthetic. No real session file, and therefore no patient
data, may enter this repository (CLAUDE.md hard rule 6).
"""
from __future__ import annotations

import json

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.ncefiles import SiteMapping, load_site_mapping


def test_a_mapping_file_becomes_signal_codes(tmp_path):
    path = tmp_path / "nce-mapping.json"
    path.write_text(json.dumps({
        "patient_fields": ["PatientId"],
        "timestamp_fields": ["MeasurementTimeUtc"],
        "signals": {
            "Nibp_Systolic": {"signal": "sbp", "unit": "mmHg"},
            "SpO2": {"signal": "spo2", "unit": "%"},
        },
    }), encoding="utf-8")

    mapping = load_site_mapping(path)

    assert mapping.signals["Nibp_Systolic"].signal is SignalCode.SBP
    assert mapping.signals["Nibp_Systolic"].unit == "mmHg"
    assert mapping.patient_fields == ("PatientId",)
    assert mapping.timestamp_fields == ("MeasurementTimeUtc",)


def test_an_unknown_slug_stops_startup(tmp_path):
    """Ignoring it would drop a signal for the whole pilot with nothing reporting a problem."""
    path = tmp_path / "nce-mapping.json"
    path.write_text(json.dumps({"signals": {"Foo": {"signal": "blood_unicorns"}}}), encoding="utf-8")

    with pytest.raises(SystemExit) as caught:
        load_site_mapping(path)

    assert "blood_unicorns" in str(caught.value)


def test_an_empty_mapping_is_valid_and_maps_nothing(tmp_path):
    """The file ships empty: the field table is written from discovery output, not guessed."""
    path = tmp_path / "nce-mapping.json"
    path.write_text("{}", encoding="utf-8")

    mapping = load_site_mapping(path)

    assert mapping == SiteMapping()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'homunculus.edge.ncefiles'`

- [ ] **Step 3: Create the module with the mapping types**

Create `homunculus-engine/src/homunculus/edge/ncefiles.py`:

```python
# src/homunculus/edge/ncefiles.py
"""Welch Allyn NCE session files -> canonical Observations.

NCE writes one file per device session under SavedCopies. The format is the vendor's own and
undocumented, so this parser assumes as little about its shape as it can get away with: it walks
every element and attribute in the document and collects (name, value) pairs. Which name carries
which signal is a site question, answered by nce-mapping.json — the same arrangement the HL7 side
uses for OBX identifiers, and for the same reason: guessing a vendor's field names in advance is how
a pilot silently receives nothing.

PHI: values are patient data. Nothing here logs, and no error message carries a value.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from homunculus.canonical import SignalCode


@dataclass(frozen=True)
class MappedField:
    """One device field the site has told us how to read."""
    signal: SignalCode
    unit: str = ""


@dataclass(frozen=True)
class SiteMapping:
    """The per-site field table. Empty is valid: it means discovery has not happened yet."""
    signals: dict[str, MappedField] = field(default_factory=dict)
    patient_fields: tuple[str, ...] = ()
    timestamp_fields: tuple[str, ...] = ()
    pair_attributes: tuple[tuple[str, str], ...] = ()


def load_site_mapping(path: str | Path) -> SiteMapping:
    """Read nce-mapping.json.

    An unknown slug stops startup rather than dropping that signal for the whole pilot: a bridge
    that runs while quietly discarding blood pressure is worse than one that refuses to start and
    says why.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))

    signals: dict[str, MappedField] = {}
    for name, spec in (raw.get("signals") or {}).items():
        slug = spec.get("signal") if isinstance(spec, dict) else spec
        unit = spec.get("unit", "") if isinstance(spec, dict) else ""
        try:
            signals[name] = MappedField(SignalCode(slug), unit)
        except ValueError:
            raise SystemExit(
                f"{path}: unknown signal slug {slug!r} for device field {name!r}"
            ) from None

    return SiteMapping(
        signals=signals,
        patient_fields=tuple(raw.get("patient_fields") or ()),
        timestamp_fields=tuple(raw.get("timestamp_fields") or ()),
        pair_attributes=tuple(
            (pair["name"], pair["value"]) for pair in (raw.get("pair_attributes") or ())
        ),
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: PASS, 3 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/ncefiles.py homunculus-engine/tests/test_edge_ncefiles.py
git commit -m "feat(edge): site field table for NCE session files"
```

---

### Task 6: Walk a session and collect every name/value pair

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/ncefiles.py`
- Test: `homunculus-engine/tests/test_edge_ncefiles.py`

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_ncefiles.py`:

```python
from homunculus.edge.ncefiles import session_fields, session_pairs
from homunculus.gateway.fhir import GatewayError

ELEMENT_STYLE = """<?xml version="1.0"?>
<DeviceSession xmlns="urn:welchallyn:nce">
  <PatientId>yatak-3</PatientId>
  <MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>
  <Vitals Pulse="88">
    <Nibp_Systolic>128</Nibp_Systolic>
    <SpO2>97</SpO2>
  </Vitals>
</DeviceSession>
"""


def test_element_text_and_attributes_both_become_pairs():
    pairs = session_pairs(ELEMENT_STYLE)

    assert ("PatientId", "yatak-3") in pairs
    assert ("Nibp_Systolic", "128") in pairs
    assert ("Pulse", "88") in pairs          # attributes count too


def test_namespaces_are_stripped_from_names():
    """Every element in the fixture sits in urn:welchallyn:nce. A site table keyed on a namespace
    URI would break the day the vendor renumbers it, for no clinical reason."""
    names = session_fields(ELEMENT_STYLE)

    assert "PatientId" in names                          # not "{urn:welchallyn:nce}PatientId"
    assert not any("}" in name or ":" in name for name in names)


def test_field_names_are_reported_for_discovery():
    names = session_fields(ELEMENT_STYLE)

    assert "SpO2" in names
    assert "MeasurementTimeUtc" in names


def test_malformed_xml_raises_without_quoting_the_document():
    with pytest.raises(GatewayError) as caught:
        session_pairs("<DeviceSession><PatientId>yatak-3")

    assert "yatak-3" not in str(caught.value)     # the message must not carry patient data
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: FAIL with `ImportError: cannot import name 'session_fields'`

- [ ] **Step 3: Add the walk**

Add to `homunculus-engine/src/homunculus/edge/ncefiles.py` — the ElementTree import goes at the top:

```python
import xml.etree.ElementTree as ET

from homunculus.gateway.fhir import GatewayError


def _local_name(tag: str) -> str:
    """`{urn:welchallyn:nce}SpO2` -> `SpO2`.

    Vendors add, drop and renumber namespaces between versions. A site table keyed on a namespace
    URI would break on an upgrade for no clinical reason, so the URI is discarded.
    """
    return tag.rpartition("}")[2]


def _flat_pairs(root: ET.Element) -> list[tuple[str, str]]:
    """Every (name, value) in the document: element text and attributes alike."""
    pairs: list[tuple[str, str]] = []
    for element in root.iter():
        text = (element.text or "").strip()
        if text:
            pairs.append((_local_name(element.tag), text))
        for attribute, value in element.attrib.items():
            value = (value or "").strip()
            if value:
                pairs.append((_local_name(attribute), value))
    return pairs


def session_pairs(text: str, mapping: SiteMapping | None = None) -> list[tuple[str, str]]:
    """Every name/value pair a session carries, in document order.

    Raises GatewayError if the document is not well-formed. The message names the failure class only
    — an XML parser's own error text can quote the offending bytes, which here are patient data.
    """
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise GatewayError(
            f"session is not well-formed XML ({exc.__class__.__name__})"
        ) from None
    return _flat_pairs(root)


def session_fields(text: str, mapping: SiteMapping | None = None) -> list[str]:
    """The field names a session carries, duplicates included. This is what discovery reports."""
    return [name for name, _ in session_pairs(text, mapping)]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: PASS, 7 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/ncefiles.py homunculus-engine/tests/test_edge_ncefiles.py
git commit -m "feat(edge): collect name/value pairs from an NCE session"
```

---

### Task 7: Support the name/value attribute idiom

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/ncefiles.py`
- Test: `homunculus-engine/tests/test_edge_ncefiles.py`

Some vendors write `<Reading name="SpO2" value="97"/>` instead of `<SpO2>97</SpO2>`. Under the flat
walk that yields the useless pairs `("name", "SpO2")` and `("value", "97")`. Which idiom NCE uses is
a discovery question, and we get one trip to the ward — so both are supported, switched by config
rather than guessed.

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_ncefiles.py`:

```python
ATTRIBUTE_STYLE = """<?xml version="1.0"?>
<DeviceSession>
  <Reading name="SpO2" value="97"/>
  <Reading name="Nibp_Systolic" value="128"/>
</DeviceSession>
"""


def test_paired_attributes_become_a_named_value_when_configured():
    mapping = SiteMapping(pair_attributes=(("name", "value"),))

    pairs = session_pairs(ATTRIBUTE_STYLE, mapping)

    assert ("SpO2", "97") in pairs
    assert ("Nibp_Systolic", "128") in pairs


def test_without_the_configuration_the_pairing_is_not_invented():
    """Pairing every name/value attribute by default would misread documents that use them for
    something else, so it stays off until a site says otherwise."""
    pairs = session_pairs(ATTRIBUTE_STYLE)

    assert ("SpO2", "97") not in pairs
    assert ("name", "SpO2") in pairs
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: FAIL — `assert ("SpO2", "97") in pairs` fails, because pairing is not implemented

- [ ] **Step 3: Add the pairing**

Add `_paired_attributes` to `homunculus-engine/src/homunculus/edge/ncefiles.py` and extend
`session_pairs` to call it:

```python
def _paired_attributes(
    root: ET.Element, pairs_config: tuple[tuple[str, str], ...]
) -> list[tuple[str, str]]:
    """Read the `<Reading name="SpO2" value="97"/>` idiom into ("SpO2", "97")."""
    found: list[tuple[str, str]] = []
    for element in root.iter():
        attributes = {_local_name(k): (v or "").strip() for k, v in element.attrib.items()}
        for name_attribute, value_attribute in pairs_config:
            name = attributes.get(name_attribute, "")
            value = attributes.get(value_attribute, "")
            if name and value:
                found.append((name, value))
    return found
```

Then replace the last line of `session_pairs` with:

```python
    pairs = _flat_pairs(root)
    if mapping is not None and mapping.pair_attributes:
        pairs.extend(_paired_attributes(root, mapping.pair_attributes))
    return pairs
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: PASS, 9 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/ncefiles.py homunculus-engine/tests/test_edge_ncefiles.py
git commit -m "feat(edge): support the name/value attribute idiom in NCE sessions"
```

---

### Task 8: Timestamps — UTC or nothing

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/ncefiles.py`
- Test: `homunculus-engine/tests/test_edge_ncefiles.py`

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_ncefiles.py`:

```python
from datetime import datetime, timezone

from homunculus.edge.ncefiles import parse_timestamp


def test_an_iso_utc_stamp_is_accepted():
    assert parse_timestamp("2026-08-28T12:54:47Z") == datetime(
        2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc
    )


def test_an_offset_stamp_is_converted_to_utc():
    assert parse_timestamp("2026-08-28T15:54:47+03:00") == datetime(
        2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc
    )


def test_a_stamp_with_no_timezone_is_refused():
    """The NCE server's local clock runs an hour ahead of Turkey time. Assuming local would shift
    every observation by an unknown amount, quietly, in a system that reasons about time."""
    assert parse_timestamp("2026-08-28T16:54:47") is None
    assert parse_timestamp("20260828165447") is None


def test_nonsense_is_refused_rather_than_guessed():
    assert parse_timestamp("bugün") is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: FAIL with `ImportError: cannot import name 'parse_timestamp'`

- [ ] **Step 3: Add the timestamp reader**

Add to `homunculus-engine/src/homunculus/edge/ncefiles.py` — the datetime import goes at the top:

```python
from datetime import datetime, timezone


def parse_timestamp(raw: str) -> datetime | None:
    """A vendor timestamp as an aware UTC datetime, or None if it cannot be trusted.

    A value carrying no timezone is REFUSED, not assumed local. The NCE server displays session
    files an hour ahead of the UTC epoch in their own names, so "assume local" would shift every
    observation by an unknown amount — silently, and in a system whose alerts are timers.
    """
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: PASS, 13 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/ncefiles.py homunculus-engine/tests/test_edge_ncefiles.py
git commit -m "feat(edge): refuse timestamps that carry no timezone"
```

---

### Task 9: Parse a session into Observations

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/ncefiles.py`
- Test: `homunculus-engine/tests/test_edge_ncefiles.py`

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_edge_ncefiles.py`:

```python
from homunculus.edge.ncefiles import parse_session

FULL_MAPPING = SiteMapping(
    signals={
        "Nibp_Systolic": MappedField(SignalCode.SBP, "mmHg"),
        "SpO2": MappedField(SignalCode.SPO2, "%"),
        "Pulse": MappedField(SignalCode.HEART_RATE, "bpm"),
    },
    patient_fields=("PatientId",),
    timestamp_fields=("MeasurementTimeUtc",),
)

EPOCH_FALLBACK = datetime(2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc)


def test_mapped_fields_become_observations():
    parsed = parse_session(ELEMENT_STYLE, FULL_MAPPING)

    by_code = {o.code: o for o in parsed.observations}
    assert by_code[SignalCode.SBP].value == 128.0
    assert by_code[SignalCode.SBP].unit == "mmHg"
    assert by_code[SignalCode.SPO2].value == 97.0
    assert all(o.patient_id == "yatak-3" for o in parsed.observations)
    assert all(o.timestamp == EPOCH_FALLBACK for o in parsed.observations)


def test_a_session_with_no_patient_identifier_is_refused():
    """A vital recorded against the wrong patient is worse than one that never arrives, and a
    placeholder patient is a wrong patient with a friendly name."""
    anonymous = ELEMENT_STYLE.replace("<PatientId>yatak-3</PatientId>", "")

    with pytest.raises(GatewayError) as caught:
        parse_session(anonymous, FULL_MAPPING)

    assert "patient" in str(caught.value).lower()


def test_the_filename_epoch_is_used_when_the_session_carries_no_utc_time():
    undated = ELEMENT_STYLE.replace(
        "<MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>", ""
    )

    parsed = parse_session(undated, FULL_MAPPING, fallback_timestamp=EPOCH_FALLBACK)

    assert all(o.timestamp == EPOCH_FALLBACK for o in parsed.observations)


def test_a_session_with_no_usable_time_at_all_is_refused():
    undated = ELEMENT_STYLE.replace(
        "<MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>", ""
    )

    with pytest.raises(GatewayError):
        parse_session(undated, FULL_MAPPING, fallback_timestamp=None)


def test_a_mapped_field_that_is_not_a_number_is_reported_not_dropped():
    broken = ELEMENT_STYLE.replace("<SpO2>97</SpO2>", "<SpO2>--</SpO2>")

    parsed = parse_session(broken, FULL_MAPPING)

    assert "SpO2" in parsed.non_numeric
    assert SignalCode.SPO2 not in {o.code for o in parsed.observations}


def test_a_mapped_field_appearing_twice_is_reported():
    """The flat walk keeps the first value. If a session carries several readings per field that is
    data loss, so it has to be visible rather than quiet."""
    twice = ELEMENT_STYLE.replace("<SpO2>97</SpO2>", "<SpO2>97</SpO2><SpO2>95</SpO2>")

    parsed = parse_session(twice, FULL_MAPPING)

    assert "SpO2" in parsed.repeated
    assert len([o for o in parsed.observations if o.code is SignalCode.SPO2]) == 1
```

Add `MappedField` to the imports at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: FAIL with `ImportError: cannot import name 'parse_session'`

- [ ] **Step 3: Add the parser**

Add to `homunculus-engine/src/homunculus/edge/ncefiles.py` — the `Observation` import joins the
existing `homunculus.canonical` import line:

```python
from homunculus.canonical import Observation, SignalCode


@dataclass(frozen=True)
class ParsedSession:
    """What one session yielded, and what it carried that we could not use.

    The two failure lists are not diagnostics for later — they are the reason the operator report
    can say a signal is going missing while files keep arriving.
    """
    observations: tuple[Observation, ...] = ()
    non_numeric: tuple[str, ...] = ()
    repeated: tuple[str, ...] = ()


def _first_value(pairs: list[tuple[str, str]], names: tuple[str, ...]) -> str:
    """The first non-empty value among `names`, preferring the order the site listed them in."""
    for wanted in names:
        for name, value in pairs:
            if name == wanted and value:
                return value
    return ""


def parse_session(
    text: str,
    mapping: SiteMapping,
    *,
    fallback_timestamp: datetime | None = None,
    source_device: str = "nce",
) -> ParsedSession:
    """One session file -> the observations it carries.

    Raises GatewayError when the session has no patient identifier or no trustworthy time: both make
    every reading in it unusable, and inventing either would put real numbers on an imaginary
    patient or an imaginary minute.
    """
    pairs = session_pairs(text, mapping)

    patient_id = _first_value(pairs, mapping.patient_fields)
    if not patient_id:
        raise GatewayError("session carries no patient identifier in any configured field")

    timestamp = parse_timestamp(_first_value(pairs, mapping.timestamp_fields))
    if timestamp is None:
        timestamp = fallback_timestamp
    if timestamp is None:
        raise GatewayError("session carries no usable UTC time and its filename has no epoch")

    observations: list[Observation] = []
    non_numeric: list[str] = []
    repeated: list[str] = []
    taken: set[str] = set()

    for name, raw_value in pairs:
        mapped = mapping.signals.get(name)
        if mapped is None:
            continue
        if name in taken:
            if name not in repeated:
                repeated.append(name)
            continue
        try:
            value = float(raw_value)
        except ValueError:
            if name not in non_numeric:
                non_numeric.append(name)
            continue
        taken.add(name)
        observations.append(Observation(
            patient_id=patient_id,
            code=mapped.signal,
            value=value,
            unit=mapped.unit,
            timestamp=timestamp,
            source_device=source_device,
        ))

    return ParsedSession(tuple(observations), tuple(non_numeric), tuple(repeated))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncefiles.py -v
```

Expected: PASS, 19 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/ncefiles.py homunculus-engine/tests/test_edge_ncefiles.py
git commit -m "feat(edge): parse an NCE session into canonical observations"
```

---

### Task 10: The bridge — counting what it could not use, and saying so

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/ncebridge.py`
- Test: `homunculus-engine/tests/test_edge_ncebridge.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_edge_ncebridge.py`:

```python
"""Discovery mode for the file route — the thing that stops the ward visit failing silently.

NCE emits the vendor's field names, not our slugs. Without a site table every observation is
dropped while files keep arriving and the mount keeps looking healthy. The bridge counts what it
could not map and names it, turning an invisible failure into a five-minute fix.

PHI: field names are device metadata and are reported. Values are patient data and must never reach
a log or a report.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.ncebridge import NceFileBridge
from homunculus.edge.ncefiles import MappedField, SiteMapping
from homunculus.gateway.fhir import GatewayError

SESSION = """<?xml version="1.0"?>
<DeviceSession>
  <PatientId>yatak-3</PatientId>
  <MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>
  <Nibp_Systolic>128</Nibp_Systolic>
  <SpO2>97</SpO2>
</DeviceSession>
"""

MAPPING = SiteMapping(
    signals={"SpO2": MappedField(SignalCode.SPO2, "%")},
    patient_fields=("PatientId",),
    timestamp_fields=("MeasurementTimeUtc",),
)

WHEN = datetime(2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc)


def test_mapped_observations_are_sent_as_fhir():
    sent: list[dict] = []
    bridge = NceFileBridge(send=sent.append, mapping=MAPPING)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert len(sent) == 1
    assert sent[0]["resourceType"] == "Observation"
    assert sent[0]["valueQuantity"]["value"] == 97.0
    assert bridge.stats.files == 1
    assert bridge.stats.observations == 1


def test_unmapped_fields_are_counted():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.stats.unmapped["Nibp_Systolic"] == 1


def test_counts_accumulate_across_sessions():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)
    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.stats.unmapped["Nibp_Systolic"] == 2
    assert bridge.stats.files == 2


def test_a_refused_session_still_reports_its_field_names():
    """Without this, a missing patient_fields setting is undiagnosable: every session is refused and
    nothing says which field the identifier was actually in."""
    bridge = NceFileBridge(send=lambda _p: None, mapping=SiteMapping())

    with pytest.raises(GatewayError):
        bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.stats.rejected == 1
    assert "PatientId" in bridge.stats.unmapped


def test_the_report_names_fields_but_never_values():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)
    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    report = bridge.discovery_report()

    assert "Nibp_Systolic" in report
    assert "128" not in report          # the measurement is PHI
    assert "yatak-3" not in report      # so is the identifier


def test_the_report_is_empty_when_everything_maps():
    mapping = SiteMapping(
        signals={
            "SpO2": MappedField(SignalCode.SPO2, "%"),
            "Nibp_Systolic": MappedField(SignalCode.SBP, "mmHg"),
        },
        patient_fields=("PatientId",),
        timestamp_fields=("MeasurementTimeUtc",),
    )
    bridge = NceFileBridge(send=lambda _p: None, mapping=mapping)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.discovery_report() == ""
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncebridge.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'homunculus.edge.ncebridge'`

- [ ] **Step 3: Create the bridge**

Create `homunculus-engine/src/homunculus/edge/ncebridge.py`:

```python
# src/homunculus/edge/ncebridge.py
"""The NCE file route: one session in, FHIR observations out, everything else counted.

The counterpart of edge/bridge.py for the file source. It is deliberately thin — no clinical
reasoning, only normalisation and bookkeeping — and its bookkeeping exists for one reason: a site
whose field table is wrong looks exactly like a quiet ward. Files keep arriving, the mount keeps
working, and nothing reaches the engine. The counters are what make that visible.

PHI: a session that cannot be parsed is counted, never logged. Field names are device metadata and
are reported; values never are.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from homunculus.canonical import Observation
from homunculus.edge.ncefiles import SiteMapping, parse_session, session_fields
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.fhir import GatewayError

_log = logging.getLogger(__name__)


@dataclass
class NceStats:
    """Operational counters. Deliberately holds no session content."""
    files: int = 0
    observations: int = 0
    rejected: int = 0
    unmapped: dict[str, int] = field(default_factory=dict)
    non_numeric: dict[str, int] = field(default_factory=dict)
    repeated: dict[str, int] = field(default_factory=dict)


def _bump(counter: dict[str, int], name: str) -> None:
    counter[name] = counter.get(name, 0) + 1


@dataclass
class NceFileBridge:
    """Wires the session parser to a sender.

    `send` receives one FHIR Observation dict and is expected to deliver it (in production, an
    append to the store-and-forward buffer). `mapping` is the per-site field table.
    """

    send: Callable[[dict], None]
    mapping: SiteMapping
    stats: NceStats = field(default_factory=NceStats)

    def handle_session(
        self,
        text: str,
        *,
        fallback_timestamp: datetime | None = None,
        source_device: str = "nce",
    ) -> tuple[Observation, ...]:
        """Parse one session file and forward every observation it carries."""
        self.stats.files += 1
        self._record_unmapped(text)

        try:
            parsed = parse_session(
                text, self.mapping,
                fallback_timestamp=fallback_timestamp, source_device=source_device,
            )
        except GatewayError:
            self.stats.rejected += 1
            _log.warning("rejected an unusable NCE session (content not logged)")
            raise

        for name in parsed.non_numeric:
            _bump(self.stats.non_numeric, name)
        for name in parsed.repeated:
            _bump(self.stats.repeated, name)

        for observation in parsed.observations:
            self.send(observation_to_fhir(observation))
        self.stats.observations += len(parsed.observations)
        return parsed.observations

    def _record_unmapped(self, text: str) -> None:
        """Count field names the site table does not cover.

        Runs BEFORE parsing, so a session that is refused for a missing patient identifier still
        reports which fields it actually carried — which is the only way that misconfiguration is
        diagnosable from a log.
        """
        known = (
            set(self.mapping.signals)
            | set(self.mapping.patient_fields)
            | set(self.mapping.timestamp_fields)
        )
        try:
            names = session_fields(text, self.mapping)
        except GatewayError:
            return          # malformed XML; the parse below counts it as rejected
        for name in names:
            if name and name not in known:
                _bump(self.stats.unmapped, name)

    def discovery_report(self) -> str:
        """Human-readable list of what this site sent that we could not use. Empty when all is well.

        Reports names and counts — never a measurement and never a patient identifier.
        """
        sections: list[str] = []
        if self.stats.unmapped:
            sections.append("Eşlenmemiş alanlar: " + _rank(self.stats.unmapped))
        if self.stats.non_numeric:
            sections.append("Sayı olmayan değerler: " + _rank(self.stats.non_numeric))
        if self.stats.repeated:
            sections.append("Aynı dosyada tekrarlanan alanlar: " + _rank(self.stats.repeated))
        return " | ".join(sections)


def _rank(counter: dict[str, int]) -> str:
    ranked = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)
    return ", ".join(f"{name} ({count})" for name, count in ranked)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd homunculus-engine
python -m pytest tests/test_edge_ncebridge.py -v
```

Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/edge/ncebridge.py homunculus-engine/tests/test_edge_ncebridge.py
git commit -m "feat(edge): NCE file bridge with discovery counters"
```

---

### Task 11: The runner script

**Files:**
- Create: `homunculus-engine/scripts/run_nce_bridge.py`
- Create: `deploy/local/nce-mapping.json`

There is no unit test for this file: it is argument parsing and wiring, and every piece it wires has
its own tests. It is verified by running it against a directory of synthetic sessions in Step 3.

- [ ] **Step 1: Write the script**

Create `homunculus-engine/scripts/run_nce_bridge.py`:

```python
"""Run the NCE file bridge: session files in -> durable buffer -> cloud.

Runs on the hospital server, reading a READ-ONLY mount of the NCE machine's SavedCopies folder.
Nothing is installed on the NCE server and nothing there is reconfigured.

Typical first run — discovery, forwards nothing:

    python scripts/run_nce_bridge.py --dir /mnt/nce --db /data/nce.db

That reports the field names the sessions actually carry, which is how nce-mapping.json gets
written. Then, with a mapping and an uplink:

    python scripts/run_nce_bridge.py --dir /mnt/nce --db /data/nce.db \
        --mapping /app/nce-mapping.json --cloud-url http://api:8000 --token <tenant-token>

PHI: nothing here logs session contents, measurements or patient identifiers — only counts, file
names (device metadata) and field names. The buffer file holds real observations in transit: keep it
on encrypted storage, never commit it, delete it after the pilot.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone

from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.filewatch import ProcessedLedger, pending_files
from homunculus.edge.ncebridge import NceFileBridge
from homunculus.edge.ncefiles import SiteMapping, load_site_mapping
from homunculus.edge.uplink import flush_loop
from homunculus.gateway.fhir import GatewayError

_log = logging.getLogger("nce-bridge")


async def scan_loop(
    bridge: NceFileBridge,
    ledger: ProcessedLedger,
    directory: str,
    interval: float,
    since_epoch: int | None,
) -> None:
    """Forward every new session, oldest first, recording each one as it goes.

    A file is recorded even when it is refused. Retrying a session that has no patient identifier
    would refuse it again every pass, forever, burying the log it needs to appear in.
    """
    while True:
        for session in pending_files(directory, ledger, since_epoch=since_epoch):
            try:
                text = session.path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                _log.warning("could not read %s (%s)", session.name, exc.__class__.__name__)
                continue

            fallback = (
                datetime.fromtimestamp(session.epoch, tz=timezone.utc)
                if session.epoch is not None else None
            )
            try:
                # source_device stays a constant, not the filename: every session has a distinct
                # name, and storing it per observation would give the field unbounded cardinality
                # while telling a clinician nothing. Which file a reading came from is a bridge-log
                # question, not a patient-record one.
                bridge.handle_session(text, fallback_timestamp=fallback, source_device="nce")
            except GatewayError:
                pass        # already counted and logged by the bridge; do not retry it forever
            ledger.record(session.name, session.size, session.mtime)

        await asyncio.sleep(interval)


async def report_loop(bridge: NceFileBridge, buffer: SqliteBuffer, ledger: ProcessedLedger,
                      interval: float) -> None:
    """Periodic operator report: throughput, buffer depth, and what could not be used."""
    while True:
        await asyncio.sleep(interval)
        stats = bridge.stats
        _log.info("dosya=%s gözlem=%s reddedilen=%s kuyruk=%s işlenmiş=%s",
                  stats.files, stats.observations, stats.rejected, buffer.depth(), ledger.count())
        report = bridge.discovery_report()
        if report:
            _log.warning("%s", report)


async def main_async(args: argparse.Namespace) -> None:
    buffer = SqliteBuffer(args.db, max_rows=args.max_buffer)
    ledger = ProcessedLedger(args.ledger or f"{args.db}.ledger")
    mapping = load_site_mapping(args.mapping) if args.mapping else SiteMapping()
    capture_only = not args.cloud_url

    def send(payload: dict) -> None:
        if not capture_only:
            buffer.append(payload)

    bridge = NceFileBridge(send=send, mapping=mapping)

    since_epoch = None
    if args.since:
        since_epoch = int(
            datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc).timestamp()
        )
    elif not args.all:
        # Default: only sessions written from now on. Replaying years of discharged admissions would
        # fill the board with patients who are not on the ward, and multiply patient data at rest
        # before the field table has been validated. The files stay on the NCE server either way.
        since_epoch = int(datetime.now(tz=timezone.utc).timestamp())

    if capture_only:
        _log.warning("KEŞİF MODU: veri iletilmiyor, yalnızca alan adları raporlanıyor "
                     "(iletmek için --cloud-url verin)")
    else:
        _log.info("uplink: %s", args.cloud_url)
    _log.info("izlenen dizin: %s (since_epoch=%s)", args.dir, since_epoch)

    tasks = [
        asyncio.create_task(scan_loop(bridge, ledger, args.dir, args.poll_interval, since_epoch)),
        asyncio.create_task(report_loop(bridge, buffer, ledger, args.report_interval)),
    ]
    if not capture_only:
        ingest_url = args.cloud_url.rstrip("/") + "/ingest"
        tasks.append(asyncio.create_task(
            flush_loop(buffer, ingest_url, args.token, args.flush_interval)))

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    finally:
        for task in tasks:
            task.cancel()
        _log.info("kapanıyor — kuyrukta %s gözlem kaldı (kaybolmaz)", buffer.depth())
        buffer.close()
        ledger.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Homunculus NCE file bridge")
    parser.add_argument("--dir", required=True, help="read-only mount of NCE's SavedCopies")
    parser.add_argument("--db", default="nce-buffer.db", help="durable buffer file")
    parser.add_argument("--ledger", default="", help="processed-file ledger (default: <db>.ledger)")
    parser.add_argument("--mapping", default=None, help="nce-mapping.json")
    parser.add_argument("--cloud-url", default="", help="e.g. http://api:8000 (empty = discovery)")
    parser.add_argument("--token", default="", help="tenant bearer token")
    parser.add_argument("--since", default="", help="backfill from this UTC date, e.g. 2026-08-01")
    parser.add_argument("--all", action="store_true",
                        help="process every session on the share, however old")
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--flush-interval", type=float, default=2.0)
    parser.add_argument("--report-interval", type=float, default=30.0)
    parser.add_argument("--max-buffer", type=int, default=200_000)
    args = parser.parse_args(argv)

    # Windows consoles default to a code page that cannot encode Turkish characters, which would
    # mangle or crash every log line. Force UTF-8 so this runs on the pilot laptop too.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Create the empty site mapping**

Create `deploy/local/nce-mapping.json`:

```json
{
  "_comment": "Field table for this site's NCE sessions. Written from discovery output, never guessed. Run the bridge without --cloud-url, read the 'Eşlenmemiş alanlar' line, and fill in the fields below. patient_fields and timestamp_fields are tried in the order listed. pair_attributes is only for the <Reading name=\"X\" value=\"1\"/> idiom; leave it empty otherwise.",
  "patient_fields": [],
  "timestamp_fields": [],
  "pair_attributes": [],
  "signals": {}
}
```

- [ ] **Step 3: Verify it runs end to end in discovery mode**

```bash
cd homunculus-engine
mkdir -p /tmp/nce-test
printf '<?xml version="1.0"?><DeviceSession><PatientId>yatak-3</PatientId><MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc><SpO2>97</SpO2></DeviceSession>' \
  > "/tmp/nce-test/TCP_10.0.0.1_35900-1787921687-1-DeviceSession.xml"
timeout 40 python scripts/run_nce_bridge.py --dir /tmp/nce-test --db /tmp/nce-test/buf.db --all --report-interval 5
```

Expected within ~10 seconds:

```
... WARNING nce-bridge: KEŞİF MODU: veri iletilmiyor, yalnızca alan adları raporlanıyor ...
... INFO nce-bridge: dosya=1 gözlem=0 reddedilen=1 kuyruk=0 işlenmiş=1
... WARNING nce-bridge: Eşlenmemiş alanlar: MeasurementTimeUtc (1), PatientId (1), SpO2 (1)
```

`reddedilen=1` is correct here: the mapping is empty, so there is no configured patient field and
the session is refused — while still reporting the names, which is exactly the diagnostic loop this
mode exists for.

- [ ] **Step 4: Verify a filled mapping forwards**

```bash
cd homunculus-engine
cat > /tmp/nce-test/mapping.json <<'JSON'
{"patient_fields": ["PatientId"],
 "timestamp_fields": ["MeasurementTimeUtc"],
 "signals": {"SpO2": {"signal": "spo2", "unit": "%"}}}
JSON
rm -f /tmp/nce-test/buf.db /tmp/nce-test/buf.db.ledger
timeout 40 python scripts/run_nce_bridge.py --dir /tmp/nce-test --db /tmp/nce-test/buf.db \
  --mapping /tmp/nce-test/mapping.json --all --report-interval 5 \
  --cloud-url http://127.0.0.1:9 --token dummy
```

Expected: `dosya=1 gözlem=1 reddedilen=0` and a `kuyruk=1` that stays at 1 with an
`uplink unavailable (URLError)` warning — port 9 refuses connections, which is the point: the
observation is parsed, buffered, and **kept** rather than lost when the uplink is down.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/scripts/run_nce_bridge.py deploy/local/nce-mapping.json
git commit -m "feat(edge): runner for the NCE file bridge"
```

---

### Task 12: Deploy it — the read-only mount

**Files:**
- Modify: `deploy/local/docker-compose.yml`
- Modify: `deploy/local/.env.example`

The bridge image's `ENTRYPOINT` is `python`, so a second service can run a different script from the
same image. That image is built from `homunculus-engine/Dockerfile` and published by
`.github/workflows/bridge-image.yml`; the new script only reaches the server once that image is
rebuilt and pulled.

- [ ] **Step 1: Add the share to the environment template**

Add to `deploy/local/.env.example`, after the `TZ` block:

```bash
# Host path where NCE's SavedCopies folder is mounted, READ-ONLY. Mount it on the host first, e.g.
#
#   mkdir -p /mnt/nce
#   printf 'username=<ro-user>\npassword=<ro-pass>\n' > /root/.nce-credentials
#   chmod 600 /root/.nce-credentials
#   mount -t cifs //<nce-server>/SavedCopies /mnt/nce \
#         -o ro,credentials=/root/.nce-credentials,uid=10001,gid=10001,iocharset=utf8
#
# uid/gid 10001 is the bridge container's user (see homunculus-engine/Dockerfile) — without them the
# container can list the directory but not open the files, which looks like an empty share.
# Read-only is not a precaution here, it is the design: the NCE box is a live clinical system that
# four devices have depended on since 2020, and this pilot must not be able to write to it.
NCE_SHARE_PATH=/mnt/nce
```

- [ ] **Step 2: Add the service**

Add to `deploy/local/docker-compose.yml`, after the `bridge` service and before `volumes:`:

```yaml
  nce:
    image: ghcr.io/asbadef/homunculus-bridge:latest
    container_name: homunculus-nce
    restart: unless-stopped
    volumes:
      # The vendor's session files. READ-ONLY on both sides: :ro here, and `-o ro` on the host
      # mount. The NCE server is a live clinical system; nothing here may write to it.
      - ${NCE_SHARE_PATH}:/nce:ro
      # Buffer and processed-file ledger. MUST persist: the buffer holds observations the API has
      # not acknowledged, and the ledger is the ONLY record of which sessions were forwarded —
      # losing it re-sends whatever the --since window covers.
      - nce-data:/data
      - ./nce-mapping.json:/app/nce-mapping.json:ro
    environment:
      TZ: ${TZ:-Europe/Istanbul}
    command:
      - scripts/run_nce_bridge.py
      - --dir
      - /nce
      - --db
      - /data/nce.db
      - --mapping
      - /app/nce-mapping.json
      - --cloud-url
      - http://api:8000
      - --token
      - ${TENANT_TOKEN}
    depends_on:
      - api
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```

And add the volume to the `volumes:` block at the bottom:

```yaml
volumes:
  pgdata:
  bridge-data:
  nce-data:
```

- [ ] **Step 3: Verify the compose file parses and the service is wired**

```bash
cd deploy/local
NCE_SHARE_PATH=/tmp/nce-test docker compose config --services
```

Expected: the list includes `nce` alongside `postgres`, `api`, `web`, `bridge`. If
`NCE_SHARE_PATH` is unset, Compose reports an empty-string mount error — which is the intended
loud failure rather than a container that silently watches nothing.

- [ ] **Step 4: Commit**

```bash
git add deploy/local/docker-compose.yml deploy/local/.env.example
git commit -m "feat(deploy): mount NCE SavedCopies read-only and run the file bridge"
```

---

### Task 13: Write the route into the runbook

**Files:**
- Modify: `docs/EDGE-BRIDGE-LOCAL.md`

- [ ] **Step 1: Fix the stale pointer at the top of the runbook**

`docs/EDGE-BRIDGE-LOCAL.md:6-7` currently promises the WACP story lives in another document. It does
not — `grep -n WACP docs/EDGE-BRIDGE-DOCKER.md` returns nothing. Replace those two lines:

```markdown
For the device-side story (discovery, mapping, the WACP finding) see
[EDGE-BRIDGE-DOCKER.md](EDGE-BRIDGE-DOCKER.md).
```

with:

```markdown
For running the bridge in Docker see [EDGE-BRIDGE-DOCKER.md](EDGE-BRIDGE-DOCKER.md). For why the
devices reach us through NCE's files rather than HL7, see **The device route** below.
```

- [ ] **Step 2: Add the device-route section**

Insert the following immediately after the paragraph ending
`An unknown signal slug stops startup rather than silently dropping that signal.`
(`docs/EDGE-BRIDGE-LOCAL.md:41-42`) and before the ```` ```bash ```` block containing
`docker compose up -d`:

````markdown
## The device route: NCE's files, not WACP

The Connex Spot monitors do not speak HL7. The discovery probe caught a `RNDZCONNECT` rendezvous on
2575 — Welch Allyn's own WACP — and the device hung up when nothing answered it. The address the
device was calling turned out to be the hospital's **Welch Allyn NCE 5.2.0.2** server, which has
been collecting from these monitors since 2020 and writes every session to `SavedCopies` as XML.

So the bridge reads those files instead of implementing the vendor's protocol. The `nce` service in
`deploy/local/docker-compose.yml` mounts that folder **read-only** and runs
`scripts/run_nce_bridge.py`. Nothing is installed on the NCE server and nothing there is
reconfigured: it is a live clinical system four devices have depended on for five years.

Mount the share on the host before the first `up` — see `NCE_SHARE_PATH` in `.env.example` for the
exact `mount -t cifs` line, including the `uid=10001` that the bridge container needs. Without it
the container lists the directory fine and cannot open a single file, which looks exactly like an
empty share.

Unlike `site-mapping.json`, **`nce-mapping.json` ships in the repository** — already present next to
the compose file, so the missing-bind-mount trap above does not apply to it. It ships *empty*, and
that is deliberate: the first run is a discovery run. The bridge forwards nothing and reports the
field names the sessions actually carry:

```text
WARNING nce-bridge: Eşlenmemiş alanlar: PatientId (12), SpO2 (12), Nibp_Systolic (12)
```

Fill `nce-mapping.json` in from that line — `patient_fields`, `timestamp_fields` and `signals` —
then `docker compose restart nce`. Guessing the vendor's field names instead is how a pilot receives
nothing while every screen looks healthy.

By default only sessions written after the bridge starts are forwarded. `--since 2026-08-01` or
`--all` backfill deliberately; both put more patient data at rest, so they are a decision, not a
default.

Configuring an HL7 ORU output on NCE itself remains the production target. The file route is what
unblocks the pilot without waiting on a vendor. See
[the design](superpowers/specs/2026-08-28-nce-file-bridge-design.md).
````

- [ ] **Step 3: Verify the links resolve and the stale claim is gone**

```bash
ls docs/superpowers/specs/2026-08-28-nce-file-bridge-design.md
grep -n "WACP" docs/EDGE-BRIDGE-LOCAL.md
```

Expected: the spec path prints; the only remaining WACP mentions are inside the new section, which
explains it rather than pointing elsewhere for it.

- [ ] **Step 4: Commit**

```bash
git add docs/EDGE-BRIDGE-LOCAL.md
git commit -m "docs(edge): document the NCE file route in the runbook"
```

---

## Final verification

- [ ] **Run the whole suite**

```bash
cd homunculus-engine
python -m pytest -q
```

Expected: all tests pass, including the pre-existing ones. Task 1 was a move, not a rewrite, so no
existing test may have been edited to accommodate it.

- [ ] **Confirm the bridge image still needs no dependencies**

```bash
cd homunculus-engine
python - <<'PY'
import ast, pathlib, sys
stdlib = set(sys.stdlib_module_names)
local = {"homunculus"}
bad = []
for path in list(pathlib.Path("src/homunculus/edge").rglob("*.py")) + [pathlib.Path("scripts/run_nce_bridge.py")]:
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names = [node.module]
        for name in names:
            root = name.split(".")[0]
            if root not in stdlib and root not in local:
                bad.append(f"{path}: {name}")
print("\n".join(bad) or "clean: standard library and homunculus only")
PY
```

Expected: `clean: standard library and homunculus only`. Anything else means the bridge image can no
longer be rebuilt on a hospital VLAN with no internet.

## What this plan does not do

- It does not write the field table. `nce-mapping.json` ships empty on purpose; it is filled from
  the first discovery run on the hospital server, using the names the report prints.
- It does not configure HL7 output on NCE (route A) or implement WACP (route C).
- It does not backfill history. `--since` and `--all` exist for that, and using them is a deliberate
  decision about patient data at rest, not a default.
- It does not diagnose the one-hour clock discrepancy on the NCE server. The parser refuses
  timezone-less timestamps so the discrepancy cannot corrupt our data, but it may still be
  corrupting something else on that machine, and it needs explaining separately.
