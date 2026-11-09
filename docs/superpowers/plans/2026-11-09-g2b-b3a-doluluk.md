# Group 2 · B3a — Doluluk (occupancy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A «Doluluk» screen shows the ward's beds by unit and room: each bed's state and how long it has been in it, the short name of the patient in an occupied bed, and the moves between free, reserved, out of service, cleaning and maintenance. Reserved and out-of-service beds become real states on the server.

**Architecture:**
- **Server (`homunculus-engine`).**
  - `RESERVED` becomes a new `BedState`.
  - Out of service is the existing `BLOCKED`, now with a reason.
  - Two columns go on `beds`: `state_reason`, and `state_note`, which is encrypted.
  - Four new routes move a bed between states. Each takes the bed's row lock and is limited to the caller's units.
  - A new read, `GET /tenant/occupancy`, carries the short names and the notes. `GET /tenant/structure` stays free of patient data.
  - An admission into a reserved bed needs `confirm_reserved: true`.
- **Dashboard.**
  - A new route `/doluluk` holds the screen, built from the structure and that read.
  - The Kabul screen loses its «Yataklar» tab.
  - The admission form can pick a reserved bed and asks the nurse first.

**Tech Stack:** FastAPI, SQLAlchemy 2 (async), Alembic, Postgres 16, pytest. React 18, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-26-g2b-doluluk-design.md`. It was refreshed 2026-11-09 (R1–R9, §5a), and the owner approved it on 2026-11-09 («tamam»). **Read §0 and §5a of the spec before Task 1.**

---

## Departures: what the code says that the spec did not (read before Task 1)

| # | Departure | Why |
|---|---|---|
| X1 | **The `bed_reserved` refusal carries `bed_id`, never the note.** The Kabul form reads the note from `GET /tenant/occupancy` when it asks the nurse. The spec's R8 line is corrected in this plan's commit. | `admission/errors.py` `Refusal`: "`extra` keys … never a name". A reservation note may well hold one. |
| X2 | **`confirm_reserved` sits at the top level of `AdmissionCreate`, not in `note`.** `_request_digest` leaves it out. | `note` is spread into `Admission(**note_fields)`. The flag is the nurse's answer about the bed, not part of the form. Left in the digest, every resend that straddles the deploy would read as another form (`request_conflict`), because the default `false` is written out. |
| X3 | **The reason «Diğer» (`OTHER`) needs a note** (`422 field_invalid:note`). | "Other" with no words says nothing to the next shift. |
| X4 | **The administrator's raw `POST /tenant/beds/{id}/transition` refuses `RESERVED` and `BLOCKED` as targets** (400). | Both come with a note or a reason, which only the new routes take. Before this slice, AVAILABLE → BLOCKED was already a 400 (not in the table). |
| X5 | **A reserved bed cannot be closed** in Yapı (`409 bed_in_use`, as any state outside `_FREE_TO_CLOSE`). | The reservation is cancelled first. No code change: `RESERVED` is simply not added to `_FREE_TO_CLOSE`. A test pins it. |
| X6 | **The four routes refuse a closed bed** (`409 bed_closed`). | Reopen first. A room or unit cannot be closed while a bed of it is open, so the bed's own `is_active` is enough. |
| X7 | **The `kabul` route stops opening for `beds.release` alone.** Its «Yataklar» tab moved to Doluluk; Kabul keeps Kabul and Taburcu. | Otherwise a session holding only `beds.release` would land on a screen with no tab. |
| X8 | **The downgrade cannot drop the enum value.** It turns every RESERVED bed back to AVAILABLE and leaves `RESERVED` in the type. | Postgres has no `DROP VALUE`. No row holds the value afterwards, so an image from before 0016 reads every bed. |
| X9 | **The `admission.admit` audit row gains `bed_was_reserved: true`** when the bed was reserved. | Spec §4, "every state change": RESERVED → OCCUPIED happens inside the admission. |
| X10 | **Doluluk also offers «Bu yatağa hasta kabul» on a reserved bed.** The Kabul form then asks (D5). | D5 allows the admission. The tile is where the charge nurse sees the reservation. |

## Open items (not this slice)

- B1b (transfer) applies the same `confirm_reserved` rule when it reopens transfer (spec R5).
- The native readings of the AZ, RU and EN texts before the pilot. This is the same open item as O73 of B1d.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2b-b3a`, branch `feat/g2b-b3a-doluluk`. It holds main `628c46d4`, the spec commits and this plan's commit.
  - **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout), and never touch another `/c/tmp` worktree.
  - Never `git push`, never deploy, never change anything on a VM.
  - **Never run `git stash`.** The stash is shared with every other worktree and session.
- **The knowledge graph.** `graphify-out/` does not exist in this worktree (checked 2026-11-09). If it appears, the project rule applies: run `graphify query "<question>"` before the first grep or source read.
- **Write and Edit tools only, on repo files.** Never use `sed`, `python`, `node` or a shell heredoc to change one.
  - The single exception is line ends. A NEW file is written with the Write tool, then converted to **CRLF** by this one-line call, which touches only that file:
    ```bash
    /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" <file>
    ```
  - Why: the tree checks out CRLF (`core.autocrlf=true`). Every block in this plan is LF, and the Edit tool matches either way.
  - Each task ends by counting the line ends of the files it touched. CR must equal LF:
    ```bash
    for f in <files>; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
    ```
- **TDD.** Write the test, run it, and **see it red for the reason the task names**. Then write the code, then see it green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add --` line).
  - Before every commit, run `git status --short` and `git diff --cached --stat`.
  - If a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.**
  - The message is `type(scope): what, in words (G2-B3a, Rn/Xn/Dn)`.
  - The body says what changed, why, and the red that was seen. It ends with:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```
- **Foreground gates.**
  - Run every suite and build in the foreground, and report before waiting on anything.
  - Never background a gate and wait on it.
  - One Bash call runs at most 10 minutes; the whole no-DB suite fits in about 3 minutes.
- **Python commands.** Always run from the engine directory, always with `PYTHONPATH=src`, always naming the files:
  ```bash
  cd /c/tmp/g2b-b3a/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  - **Postgres tests** (every file marked `requires_db`) take `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` **on the command line only**, prefixed to the command above. The database is the container `homunculus-test-pg-56` (Task 0 starts it).
  - **Never set or export `DATABASE_URL`**, and never export `TEST_DATABASE_URL`.
  - The whole no-DB suite: `... -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`.
  - **Never run `tests/test_infinity_vm_pilot.py`** (it hangs).
- **Dashboard commands** run from `/c/tmp/g2b-b3a/dashboard`:
  - one file or a few: `./node_modules/.bin/vitest run <paths>`;
  - the whole suite: `./node_modules/.bin/vitest run`;
  - the build, as a separate command: `./node_modules/.bin/vite build`.

  Use the local binaries: `npx` has resolved a cached tool in these trees before. A `Warning: … not wrapped in act(...)` line is not a failure.
- **No patient data, ever** (CLAUDE.md rule 6).
  - Names: `Sentetik Hasta`, `Məmmədov Əli Rauf oğlu`, `Kaya Ayşe`.
  - Notes: `Sentetik planlı kabul`, `Sentetik arıza`.
  - Every value is made up.
- **Four languages for every key.** `tr` is the source; `az` is the default and the tests' language.
  - An `az` text equal to its `tr` text, or an `ru` text with no Cyrillic, needs a reviewed entry in `i18n/strings.test.js`.
  - If the test reports one, change the wording; do not list it. The one exception is `kabul.f.name` / `kabul.miss.name`, which are already listed (Task 9).
- **Comments explain why**, in the register of the file. New lines are tagged `G2-B3a` with the spec item (`D1`…`D5`, `R1`…`R9`) or the departure (`X1`…`X10`).
- **Report back:**
  - DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED;
  - the commit sha;
  - the test counts;
  - any deviation.

---

## File map

**Engine (`homunculus-engine/`)**

| File | Change | Task |
|---|---|---|
| `src/homunculus/tenant/models.py` | `BedState.RESERVED`, `BedStateReason`, the transitions, the `state_reason` / `state_note` columns and their CHECK; `transition_to` clears both | 1 |
| `alembic/versions/0016_bed_occupancy.py` | new: the enum value, the two columns, the CHECK, `beds.manage_state` → `charge_nurse` | 2 |
| `src/homunculus/auth/permissions.py` | `beds.manage_state`; charge nurse holds it | 3 |
| `src/homunculus/tenant/schemas.py` | `BedReserve`, `BedOutOfService`, `OccupancyBed`, `OccupancyResponse`; `StructureBed.state_since` | 4, 5 |
| `src/homunculus/tenant/router.py` | `_free_guards` (extracted); the raw move refuses RESERVED/BLOCKED; the four routes; `GET /tenant/occupancy`; `state_since` in the structure | 4, 5 |
| `src/homunculus/tenant/shortname.py` | new: `short_name()` | 5 |
| `src/homunculus/admission/errors.py` | `BED_RESERVED` | 6 |
| `src/homunculus/admission/schemas.py` | `AdmissionCreate.confirm_reserved` | 6 |
| `src/homunculus/admission/router.py` | the reserved-bed check, the digest exclusion, the audit flag | 6 |
| `src/homunculus/admission/service.py` | `create_draft_admission(..., reserved_ok=)` | 6 |
| `tests/test_bed_state_machine.py` | new (no DB) | 1 |
| `tests/test_migration_0016_bed_occupancy.py` | new (DB) | 2 |
| `tests/test_permissions.py` | 23 → 24 keys | 3 |
| `tests/test_bed_state_routes.py` | new (DB) | 4 |
| `tests/test_route_permissions.py`, `tests/test_tenant_isolation.py` | rows for the new routes | 4, 5 |
| `tests/test_short_name.py` | new (no DB) | 5 |
| `tests/test_occupancy_read.py` | new (DB) | 5 |
| `tests/test_structure_api.py` | the exact bed shape gains `state_since` | 5 |
| `tests/test_reserved_admission.py` | new (DB) | 6 |

**Dashboard (`dashboard/src/`)**

| File | Change | Task |
|---|---|---|
| `backendApi.js`, `backendApi.test.js` | `occupancy`, `reserveBed`, `unreserveBed`, `bedOutOfService`, `bedReturnToService` | 8 |
| `live/session/testTokens.testutil.js` | the five in `fakeApi` | 8 |
| `live/i18n/strings/doluluk.js` | new namespace, four languages | 9 |
| `live/i18n/catalog.js` | registers `doluluk` | 9 |
| `live/i18n/strings/kabul.js` | `state.RESERVED`; `state.BLOCKED` renamed (R4); the name label «Soyad ad» (R9); `err.bedReserved`; `reservedAsk.*` | 9 |
| `live/i18n/strings/perms.js` | `beds.manage_state`, four languages | 9 |
| `live/i18n/strings.test.js` | the comment of the reviewed `kabul.f.name` / `kabul.miss.name` entry | 9 |
| `live/screens/admin/catalogue.js`, `live/screens/admin/admin.testutil.js` | the permission key and its backend text | 9 |
| `live/apiErrors.js` | `bed_reserved` | 9 |
| `live/data/structure.js` | `RESERVED` in `BED_STATE_KEYS`; `admissible` takes a reserved bed | 9 |
| `live/screens/doluluk/occupancy.js`, `occupancy.test.js` | new: counts, actions, time in state | 10 |
| `live/screens/doluluk/BedStateDialog.jsx`, `BedStateDialog.test.jsx` | new: reserve / out-of-service dialog | 11 |
| `live/screens/doluluk/DolulukScreen.jsx`, `DolulukScreen.test.jsx` | new: the screen | 12 |
| `live/shell/routes.js` | the `doluluk` route; `kabul` loses `beds.release` (X7) | 12 |
| `live/screens/kabul/KabulScreen.jsx`, `KabulScreen.test.jsx` | two tabs | 12 |
| `live/screens/kabul/BedsTab.jsx`, `BedsTab.test.jsx` | deleted (their behaviour is retested in `DolulukScreen.test.jsx`) | 12 |
| `live/screens/kabul/admitForm.js`, `admitForm.test.js` | `toBody(..., { confirmReserved })` | 13 |
| `live/screens/kabul/BedPicker.jsx` | a reserved bed is choosable and says so | 13 |
| `live/screens/kabul/ReservedAsk.jsx` | new: the question before an admission into a reserved bed | 13 |
| `live/screens/kabul/AdmitTab.jsx`, `AdmitTab.test.jsx`, `admitDraft.test.jsx` | the question and `bed_reserved`; «Soyad ad» in the tests | 13 |

**Docs:** the roadmap's Grup 2 table and the Turkish guide (Task 14).

---

### Task 0: The worktree, the shared install, the test database and the baseline

**Files:** none changed.

- [ ] **Step 1: The worktree and the branch**

```bash
cd /c/tmp/g2b-b3a && git status --short && git rev-parse --abbrev-ref HEAD && git log --oneline -5
```

Expected:
- no status output;
- the branch `feat/g2b-b3a-doluluk`;
- this plan's commit on top of the spec commits, on top of `628c46d4`.

- [ ] **Step 2: The `node_modules` junction to the shared install**

```powershell
if (-not (Test-Path C:\tmp\g2b-b3a\dashboard\node_modules)) { New-Item -ItemType Junction -Path C:\tmp\g2b-b3a\dashboard\node_modules -Target C:\tmp\homunculus-g1\dashboard\node_modules | Out-Null }
Get-Item C:\tmp\g2b-b3a\dashboard\node_modules | Select-Object LinkType, Target | Format-List
```

Expected: `LinkType : Junction`, `Target : {C:\tmp\homunculus-g1\dashboard\node_modules}`.

**This is the shared install:**
- never delete through it, and never reinstall into it;
- before this worktree is removed, unlink it first: `cmd /c rmdir "C:\tmp\g2b-b3a\dashboard\node_modules"` removes the link only;
- only then run `git worktree remove`.

- [ ] **Step 3: The test database**

```bash
docker start homunculus-test-pg-56 >/dev/null && docker exec homunculus-test-pg-56 pg_isready -U homunculus
```

Expected: `… accepting connections`. The container is the project's shared test database. If another session is running a Postgres suite on it at the same time, wait for it to finish: `clean_db` rebuilds the schema.

- [ ] **Step 4: The engine baseline**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: all passed, the DB tests skipped. Write the numbers into the report.

- [ ] **Step 5: The Postgres baseline of the files this slice touches**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_structure_api.py tests/test_admission_api.py tests/test_tenant_isolation.py tests/test_route_permissions.py tests/test_migration_0015_protocol.py 2>&1 | tail -3
```

Expected: all passed, none skipped. Write the numbers into the report.

- [ ] **Step 6: The dashboard baseline and the build**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -5
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -6
```

Expected:
- the suite: every file and test passed. Write the counts into the report.
- the build: a `precache  N entries` line and no `larger than 500 kB`. Write N into the report.

---

### Task 1: The bed's states — RESERVED, the reasons, the columns (spec §4, R8)

**Files:**
- Modify: `homunculus-engine/src/homunculus/tenant/models.py`
- Create: `homunculus-engine/tests/test_bed_state_machine.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_bed_state_machine.py`:

```python
# homunculus-engine/tests/test_bed_state_machine.py
"""The bed's state machine after G2-B3a (spec §4): a free bed may be reserved for an expected
patient or taken out of service; a reserved bed goes back to free or to its patient and nowhere
else; nothing but a free bed is reserved or blocked. The out-of-service reason and the note belong
to the state they were written with — every transition clears both (R8). No database."""
from __future__ import annotations

import pytest

from homunculus.tenant.models import BED_STATE_TRANSITIONS, Bed, BedState, BedStateReason


def test_a_free_bed_can_be_reserved_or_taken_out_of_service():
    assert {BedState.RESERVED, BedState.BLOCKED} <= BED_STATE_TRANSITIONS[BedState.AVAILABLE]


def test_a_reserved_bed_goes_back_to_free_or_to_its_patient_and_nowhere_else():
    assert BED_STATE_TRANSITIONS[BedState.RESERVED] == {BedState.AVAILABLE, BedState.OCCUPIED}


@pytest.mark.parametrize("state", [s for s in BedState if s is not BedState.AVAILABLE],
                         ids=lambda s: s.value)
def test_only_a_free_bed_is_reserved_or_blocked(state):
    allowed = BED_STATE_TRANSITIONS.get(state, set())
    assert BedState.RESERVED not in allowed and BedState.BLOCKED not in allowed


def test_out_of_service_and_maintenance_both_return_to_free():
    assert BED_STATE_TRANSITIONS[BedState.BLOCKED] == {BedState.AVAILABLE}
    assert BED_STATE_TRANSITIONS[BedState.MAINTENANCE] == {BedState.AVAILABLE}


def test_every_transition_clears_the_reason_and_the_note():
    bed = Bed(label="1", state=BedState.AVAILABLE)
    bed.transition_to(BedState.BLOCKED)
    bed.state_reason, bed.state_note = BedStateReason.FAULT.value, "Sentetik arıza"
    bed.transition_to(BedState.AVAILABLE)
    assert (bed.state_reason, bed.state_note) == (None, None)
    bed.transition_to(BedState.RESERVED)
    bed.state_note = "Sentetik planlı kabul"
    bed.transition_to(BedState.OCCUPIED)
    assert (bed.state_reason, bed.state_note) == (None, None)


def test_the_reasons_are_the_four_the_spec_names():
    assert [r.value for r in BedStateReason] == ["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]


def test_the_note_column_is_encrypted_and_wide_enough_for_a_fernet_text():
    column = Bed.__table__.c.state_note
    assert type(column.type).__name__ == "EncryptedString"
    assert column.type.impl.length == 1536
    assert Bed.__table__.c.state_reason.type.length == 20
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bed_state_machine.py 2>&1 | tail -3
```

Expected: collection error, `ImportError: cannot import name 'BedStateReason'`.

- [ ] **Step 3: The model**

In `homunculus-engine/src/homunculus/tenant/models.py`:

1. Replace the docstring's `PHI RULE` line, and the import block, with the following:

```python
PHI RULE: No real patient data in this module. One column may hold a patient's name all the same:
`beds.state_note` (G2-B3a), a reservation's "for whom" — encrypted at rest like every name.
CLINICAL RULE: This module is infrastructure — no clinical logic here.
"""
from __future__ import annotations
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Enum, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.crypto import EncryptedString
from homunculus.db import Base
```

The old lines being replaced are `PHI RULE: No real patient data in this module.` and `CLINICAL RULE: …`, through `from homunculus.db import Base`. Keep every other import as it is.

2. Replace the `BedState` class and the transition table with:

```python
class BedState(str, enum.Enum):
    """§1.3 — Bed lifecycle states."""
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    PENDING_DISCHARGE = "PENDING_DISCHARGE"
    PENDING_TRANSFER_OUT = "PENDING_TRANSFER_OUT"
    HOUSEKEEPING = "HOUSEKEEPING"
    MAINTENANCE = "MAINTENANCE"
    BLOCKED = "BLOCKED"          # G2-B3a: shown as «Kullanım dışı», always with a reason (D4)
    # G2-B3a (spec §4, D5): held for an expected patient; only an admission that confirms it takes it.
    RESERVED = "RESERVED"


class BedStateReason(str, enum.Enum):
    """G2-B3a (spec §4, D4): why a bed is out of service (BLOCKED). Stored as text and checked by
    `ck_beds_state_reason`: a fifth reason is a migration, not a typo that reaches the ward."""
    FAULT = "FAULT"
    ISOLATION_CLEANING = "ISOLATION_CLEANING"
    STAFFING = "STAFFING"
    OTHER = "OTHER"


#: G2-B3a (R8): the ciphertext of a 200-character note, four-byte letters included. The width
#: admission/models.py PHI_COLUMN_LENGTH gives every encrypted text; not imported from there, so
#: that the structure's models do not depend on the admission's.
STATE_NOTE_COLUMN_LENGTH = 1536


# Valid transitions for BedState (§1.3). G2-B3a: a free bed is reserved or taken out of service,
# and only a free one (spec §4).
BED_STATE_TRANSITIONS: dict[BedState, set[BedState]] = {
    BedState.AVAILABLE: {BedState.OCCUPIED, BedState.RESERVED, BedState.BLOCKED},
    BedState.OCCUPIED: {BedState.PENDING_DISCHARGE, BedState.PENDING_TRANSFER_OUT},
    BedState.PENDING_DISCHARGE: {BedState.OCCUPIED, BedState.HOUSEKEEPING},
    BedState.PENDING_TRANSFER_OUT: {BedState.OCCUPIED, BedState.HOUSEKEEPING},
    BedState.HOUSEKEEPING: {BedState.MAINTENANCE, BedState.AVAILABLE},
    BedState.MAINTENANCE: {BedState.AVAILABLE},
    BedState.BLOCKED: {BedState.AVAILABLE},
    BedState.RESERVED: {BedState.AVAILABLE, BedState.OCCUPIED},
}
```

3. In `class Bed`, after the `is_active` column, add:

```python
    # G2-B3a (spec §4, R8): the out-of-service reason (BLOCKED only) and the reservation's or the
    # out-of-service note. Both belong to the state they were written with: every transition
    # clears them (`transition_to`), and the route that enters RESERVED or BLOCKED sets them after
    # it. The note may name the expected patient, so it is encrypted at rest like a patient's name.
    state_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state_note: Mapped[str | None] = mapped_column(EncryptedString(STATE_NOTE_COLUMN_LENGTH),
                                                   nullable=True)
```

4. Replace `Bed.__table_args__` with:

```python
    __table_args__ = (
        UniqueConstraint("room_id", "label", name="uq_bed_label_per_room"),
        # G2-B3a: the same text as migration 0016's CHECK.
        CheckConstraint("state_reason IS NULL OR state_reason IN "
                        "('FAULT', 'ISOLATION_CLEANING', 'STAFFING', 'OTHER')",
                        name="ck_beds_state_reason"),
    )
```

5. In `Bed.transition_to`, after `self.state_updated_at = datetime.now(timezone.utc)`, add:

```python
        # G2-B3a (R8): the reason and the note were the state's that is left behind.
        self.state_reason = None
        self.state_note = None
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `13 passed` (the parametrised test runs once for each of the 7 states other than AVAILABLE).

- [ ] **Step 5: Nothing else moved**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: Task 0's count + 13, and no failure.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in homunculus-engine/src/homunculus/tenant/models.py homunculus-engine/tests/test_bed_state_machine.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/tenant/models.py homunculus-engine/tests/test_bed_state_machine.py
git commit -m "feat(tenant): a bed can be reserved or out of service with a reason, and its note is encrypted (G2-B3a, §4, R8)" -m "RESERVED joins BedState; BedStateReason names the four out-of-service reasons; beds.state_reason (text, CHECKed) and beds.state_note (EncryptedString 1536) belong to the state they were written with, so every transition clears them. Red: ImportError BedStateReason." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0016 (spec §4, R2, X8)

**Files:**
- Create: `homunculus-engine/alembic/versions/0016_bed_occupancy.py`
- Create: `homunculus-engine/tests/test_migration_0016_bed_occupancy.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_migration_0016_bed_occupancy.py`:

```python
# homunculus-engine/tests/test_migration_0016_bed_occupancy.py
"""Migration 0016 (G2-B3a, spec §4) on the real chain (`clean_db`, never `create_all`):
- `bedstate` gains RESERVED;
- `beds.state_reason` (CHECK: the four reasons or NULL) and `beds.state_note` (wide enough for a
  Fernet text) are added, NULL on every bed;
- `beds.manage_state` reaches every tenant's charge nurses and nobody else;
- the downgrade frees every reserved bed before it takes the rest away (X8), and
  0015 → 0016 → 0015 → 0016 runs.
The model agrees with the migration. Synthetic rows only."""
from __future__ import annotations

import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
CHECK = "ck_beds_state_reason"


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _group(conn, tenant: uuid.UUID, slug: str) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, "
        "updated_at) VALUES (:id, :t, :s, :s, false, false, now(), now())"),
        {"id": gid, "t": tenant, "s": slug})
    return gid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    return bed


def _columns(engine, table: str) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns(table)}


def test_0016_adds_the_state_the_columns_and_the_charge_nurses_right(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0015")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        groups = {(t, s): _group(conn, t, s)
                  for t in (a, b) for s in ("charge_nurse", "nurse", "hospital_admin")}
        bed = _bed(conn, a)
    command.upgrade(cfg, "0016")
    with engine.connect() as conn:
        labels = set(conn.execute(text("SELECT unnest(enum_range(NULL::bedstate))::text")).scalars())
        holders = set(conn.execute(text(
            "SELECT group_id FROM group_permissions WHERE permission = 'beds.manage_state'")).scalars())
        row = conn.execute(text("SELECT state::text, state_reason, state_note FROM beds WHERE id = :id"),
                           {"id": bed}).one()
    assert "RESERVED" in labels
    # hospital_admin holds the whole catalogue by rule (auth/permissions.py): no row for it.
    assert holders == {groups[(t, "charge_nurse")] for t in (a, b)}
    assert tuple(row) == ("AVAILABLE", None, None)
    columns = _columns(engine, "beds")
    assert columns["state_reason"]["type"].length == 20 and columns["state_reason"]["nullable"]
    assert columns["state_note"]["type"].length == 1536 and columns["state_note"]["nullable"]


@pytest.mark.parametrize("reason", ["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER", None])
def test_a_reason_is_one_of_the_four_or_none(clean_db, reason):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        bed = _bed(conn, _tenant(conn, "hastane-a"))
        conn.execute(text("UPDATE beds SET state = 'BLOCKED', state_reason = :r WHERE id = :id"),
                     {"r": reason, "id": bed})


def test_any_other_reason_is_refused(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        bed = _bed(conn, _tenant(conn, "hastane-a"))
    with pytest.raises(IntegrityError, match=CHECK), engine.begin() as conn:
        conn.execute(text("UPDATE beds SET state_reason = 'BROKEN' WHERE id = :id"), {"id": bed})


def test_the_downgrade_frees_reserved_beds_and_takes_the_rest_away(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0015")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        _group(conn, tenant, "charge_nurse")
        reserved, blocked = _bed(conn, tenant), _bed(conn, tenant)
    command.upgrade(cfg, "0016")
    with engine.begin() as conn:
        conn.execute(text("UPDATE beds SET state = 'RESERVED', state_note = 'x' WHERE id = :id"),
                     {"id": reserved})
        conn.execute(text("UPDATE beds SET state = 'BLOCKED', state_reason = 'FAULT' WHERE id = :id"),
                     {"id": blocked})
    command.downgrade(cfg, "0015")
    with engine.connect() as conn:
        states = dict(conn.execute(text("SELECT id, state::text FROM beds")).all())
        rights = conn.execute(text(
            "SELECT count(*) FROM group_permissions WHERE permission = 'beds.manage_state'")).scalar_one()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    # X8: no row holds RESERVED, so an image from before 0016 reads every bed; BLOCKED it knows.
    assert states == {reserved: "AVAILABLE", blocked: "BLOCKED"}
    assert rights == 0 and version == "0015"
    assert {"state_reason", "state_note"}.isdisjoint(_columns(engine, "beds"))
    command.upgrade(cfg, "0016")                     # ADD VALUE IF NOT EXISTS runs again


def test_the_model_and_the_migration_agree(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0015")
    command.upgrade(cfg, "0016")

    def only_0016(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name == "beds"
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == "beds" and name in {"state_reason", "state_note"}
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0016})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: it is read here, by name.
        assert conn.execute(text("SELECT count(*) FROM pg_constraint WHERE contype = 'c' "
                                 "AND conname = :n"), {"n": CHECK}).scalar_one() == 1
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0016_bed_occupancy.py 2>&1 | tail -3
```

Expected: every test fails. The `upgrade(cfg, "0016")` calls fail with alembic's `Can't locate revision identified by '0016'`. The `head` tests fail on the missing columns.

- [ ] **Step 3: The migration**

Create `homunculus-engine/alembic/versions/0016_bed_occupancy.py`:

```python
# homunculus-engine/alembic/versions/0016_bed_occupancy.py
"""G2-B3a (spec 2026-10-26 §4, refreshed 2026-11-09): reserved and out-of-service beds

Revision 0016, follows 0015 (protocol).

* `bedstate` gains `RESERVED`. `ALTER TYPE … ADD VALUE` runs inside the migration's transaction
  (Postgres 12 and later); nothing here uses the new value, which Postgres forbids before the
  commit.
* `beds.state_reason` VARCHAR(20) NULL, one of FAULT / ISOLATION_CLEANING / STAFFING / OTHER
  (`ck_beds_state_reason`), and `beds.state_note` VARCHAR(1536) NULL — a Fernet ciphertext
  (`EncryptedString`, R8): a note may name the expected patient.
* `beds.manage_state` goes to every tenant's `charge_nurse` group. `hospital_admin` holds the whole
  catalogue by rule (auth/permissions.py) and needs no row.

An image from before this revision serves against it as long as no bed is RESERVED: its
`Enum(BedState)` cannot read that value. The downgrade therefore turns every RESERVED bed back to
AVAILABLE first (X8). Postgres cannot drop an enum value, so `RESERVED` stays in the type after a
downgrade; no row holds it, and the upgrade's `ADD VALUE IF NOT EXISTS` runs again cleanly.

ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-09
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK = "ck_beds_state_reason"


def upgrade() -> None:
    op.execute("ALTER TYPE bedstate ADD VALUE IF NOT EXISTS 'RESERVED'")
    op.add_column("beds", sa.Column("state_reason", sa.String(20), nullable=True))
    op.add_column("beds", sa.Column("state_note", sa.String(1536), nullable=True))
    op.create_check_constraint(
        CHECK, "beds",
        "state_reason IS NULL OR state_reason IN ('FAULT', 'ISOLATION_CLEANING', 'STAFFING', 'OTHER')")
    op.execute(
        "INSERT INTO group_permissions (group_id, permission)"
        " SELECT id, 'beds.manage_state' FROM groups WHERE slug = 'charge_nurse'"
        " ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM group_permissions WHERE permission = 'beds.manage_state'")
    op.execute("UPDATE beds SET state = 'AVAILABLE' WHERE state = 'RESERVED'")
    op.drop_constraint(CHECK, "beds", type_="check")
    op.drop_column("beds", "state_note")
    op.drop_column("beds", "state_reason")
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `9 passed`.

- [ ] **Step 5: The chain still has one head, and the older migration tests still pass**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())"
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0015_protocol.py tests/test_migration_0014_device_beds.py tests/test_migration_0012_kabul.py 2>&1 | tail -3
```

Expected:
- the first command prints `['0016']`;
- the second command shows all passed.

If a test of 0012, 0014 or 0015 asserts that `head` is its own revision, change that line to the revision it names (`command.upgrade(cfg, "0015")`), never the assertion's meaning. Name each changed line in the report.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in homunculus-engine/alembic/versions/0016_bed_occupancy.py homunculus-engine/tests/test_migration_0016_bed_occupancy.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/alembic/versions/0016_bed_occupancy.py homunculus-engine/tests/test_migration_0016_bed_occupancy.py
git commit -m "feat(migration): 0016 — RESERVED, the out-of-service reason and the encrypted note, and beds.manage_state for the charge nurses (G2-B3a, §4, R2, X8)" -m "The downgrade frees every reserved bed first: Postgres cannot drop the enum value, and an image from before 0016 could not read it. Red: Can't locate revision '0016'." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The permission `beds.manage_state` (spec §4, D4)

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py`
- Modify: `homunculus-engine/tests/test_permissions.py`

- [ ] **Step 1: Write the failing test**

In `homunculus-engine/tests/test_permissions.py`, make two changes.

First, in `SPEC_KEYS`, replace

```python
    "devices.map_beds",   # G2-ESLEME monitor→bed editor (spec D2)
}
```

with

```python
    "devices.map_beds",   # G2-ESLEME monitor→bed editor (spec D2)
    "beds.manage_state",  # G2-B3a Doluluk: reserve / out of service (spec D4)
}
```

Second, rename and change the count test:

```python
def test_the_catalogue_is_exactly_the_specified_twenty_four_keys():
    assert len(SPEC_KEYS) == 24
    assert set(PERMISSIONS) == SPEC_KEYS
    assert ALL_PERMISSIONS == frozenset(SPEC_KEYS)


def test_the_charge_nurse_and_only_she_among_the_ward_groups_manages_bed_states():
    from homunculus.auth.permissions import DEFAULT_GROUPS
    holders = {g["slug"] for g in DEFAULT_GROUPS if "beds.manage_state" in g["permissions"]}
    assert holders == {"hospital_admin", "charge_nurse"}
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py 2>&1 | tail -3
```

Expected: 2 failed — `set(PERMISSIONS) == SPEC_KEYS` (the key is missing), and the holders are an empty set.

- [ ] **Step 3: The catalogue and the charge nurse**

In `homunculus-engine/src/homunculus/auth/permissions.py`:

1. After the `devices.map_beds` entry, before the closing `}` of `PERMISSIONS`, add:

```python

    # G2-B3a — Doluluk (spec D4): the charge nurse holds a bed for an expected patient or takes it
    # out of service, and undoes either. Not `structure.manage`, which builds and closes the wards.
    "beds.manage_state": "Reserve a free bed for an expected patient or take it out of service, "
                         "and undo either — in one's own units, on the Doluluk screen",
```

2. In the `charge_nurse` entry of `DEFAULT_GROUPS`, replace

```python
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release",
                     "devices.map_beds")},
```

with

```python
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release",
                     "devices.map_beds", "beds.manage_state")},
```

- [ ] **Step 4: Run it and see it green, then the suites that read the catalogue**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: no failure.

A test that pins a group's exact list of rights, or the catalogue's size, fails here with the new key named. For example, a `test_migration_0010_defaults` row for the charge nurse. Add `beds.manage_state` to that list, the way `devices.map_beds` sits in it, and name the file in the report. The dashboard's copies of the catalogue are Task 9's.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
git commit -m "feat(auth): beds.manage_state — the charge nurse reserves a bed or takes it out of service (G2-B3a, D4)" -m "Red: the catalogue lacked the key; no default group held it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If Step 4 changed another test file, add it to the `git add` line and to the commit body.

---

### Task 4: The four moves — reserve, unreserve, out of service, return to service (spec §4, D4, R6, R8, X3–X6)

**Files:**
- Modify: `homunculus-engine/src/homunculus/tenant/schemas.py`
- Modify: `homunculus-engine/src/homunculus/tenant/router.py`
- Create: `homunculus-engine/tests/test_bed_state_routes.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_bed_state_routes.py`:

```python
# homunculus-engine/tests/test_bed_state_routes.py
"""The Doluluk's four bed moves (G2-B3a, spec §4, D4, R6, R8, X3–X6). A charge nurse:
- reserves a free bed of her unit, with or without a note, and cancels the reservation;
- takes a free bed out of service with a reason;
- returns it, or a bed in maintenance, to service.
Each move belongs to the charge nurse or the administrator (`beds.manage_state`). It works only in
the caller's own units, on an open bed, in the state the move needs. Each is audited with the
reason and whether a note was written, never its words; the note is stored encrypted. The
administrator's raw move cannot set either state, and a reserved bed is not closed.
Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from homunculus.tenant import router as tenant_router
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client

pytestmark = [requires_db]
NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _set_state(db, bed: Bed, state: BedState) -> None:
    bed.state = state
    db.add(bed)
    await db.commit()


def _rows(app) -> list:
    """The ward's audit rows of this slice's four moves, oldest first."""
    kinds = {"bed.reserve", "bed.unreserve", "bed.out_of_service", "bed.return_to_service"}
    return [r for r in app.state.audit.records(tenant=SLUG, limit=500) if r.event_type in kinds]


async def _stored(db, bed_id) -> tuple:
    """The bed's state, reason and note as the database holds them — the note's raw column."""
    db.expire_all()
    row = (await db.execute(text("SELECT state::text, state_reason, state_note FROM beds "
                                 "WHERE id = :id"), {"id": bed_id})).one()
    return tuple(row)


async def test_a_charge_nurse_reserves_a_free_bed_with_a_note_kept_encrypted(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id
    r = await client.post(f"/tenant/beds/{bed_id}/reserve", json={"note": f"  {NOTE}  "},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "RESERVED" and "state_note" not in r.json()
    state, reason, raw = await _stored(db_session, bed_id)
    assert (state, reason) == ("RESERVED", None)
    assert raw and NOTE not in raw                                  # R8: ciphertext in the column
    db_session.expire_all()
    assert (await db_session.get(Bed, bed_id)).state_note == NOTE     # trimmed, read back
    (row,) = _rows(app)
    assert row.event_type == "bed.reserve"
    assert row.payload == {"bed_id": str(bed_id), "unit_id": str(w.units["rea"].id),
                           "from": "AVAILABLE", "to": "RESERVED", "reason": None, "note": True,
                           "actor": "charge@kabul.example.com"}


async def test_a_reservation_without_a_note_is_still_a_reservation(ward, db_session):
    w, client, app = ward
    url = f"/tenant/beds/{w.beds['3'].id}"
    for body in ({}, {"note": "   "}):
        r = await client.post(f"{url}/reserve", json=body, headers=w.auth["charge"])
        assert r.status_code == 200, r.text
        assert (await _stored(db_session, w.beds["3"].id))[2] is None
        r = await client.post(f"{url}/unreserve", headers=w.auth["charge"])
        assert r.status_code == 200, r.text
    assert [x.payload["note"] for x in _rows(app) if x.event_type == "bed.reserve"] == [False, False]


async def test_cancelling_a_reservation_frees_the_bed_and_forgets_the_note(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id
    await client.post(f"/tenant/beds/{bed_id}/reserve", json={"note": NOTE}, headers=w.auth["charge"])
    r = await client.post(f"/tenant/beds/{bed_id}/unreserve", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert await _stored(db_session, bed_id) == ("AVAILABLE", None, None)
    assert [(x.payload["from"], x.payload["to"]) for x in _rows(app)] == [
        ("AVAILABLE", "RESERVED"), ("RESERVED", "AVAILABLE")]


async def test_out_of_service_carries_its_reason_and_returns_to_service_clean(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id
    r = await client.post(f"/tenant/beds/{bed_id}/out-of-service",
                          json={"reason": "FAULT", "note": "Sentetik arıza"}, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    state, reason, raw = await _stored(db_session, bed_id)
    assert (state, reason) == ("BLOCKED", "FAULT") and raw and "Sentetik" not in raw
    r = await client.post(f"/tenant/beds/{bed_id}/return-to-service", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert await _stored(db_session, bed_id) == ("AVAILABLE", None, None)
    out, back = _rows(app)
    assert (out.event_type, out.payload["reason"], out.payload["note"]) == ("bed.out_of_service", "FAULT", True)
    assert (back.event_type, back.payload["from"], back.payload["reason"]) == (
        "bed.return_to_service", "BLOCKED", "FAULT")


async def test_the_reason_other_needs_a_note_and_an_unknown_reason_is_refused(ward, db_session):
    w, client, app = ward
    url = f"/tenant/beds/{w.beds['3'].id}/out-of-service"
    r = await client.post(url, json={"reason": "OTHER"}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "field_invalid:note")      # X3
    assert (await client.post(url, json={"reason": "BROKEN"}, headers=w.auth["charge"])).status_code == 422
    r = await client.post(url, json={"reason": "STAFFING", "note": "x" * 201}, headers=w.auth["charge"])
    assert r.status_code == 422
    assert (await _stored(db_session, w.beds["3"].id))[0] == "AVAILABLE" and _rows(app) == []


async def test_a_bed_in_maintenance_returns_to_service(ward, db_session):
    w, client, _ = ward
    await _set_state(db_session, w.beds["3"], BedState.MAINTENANCE)
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/return-to-service", headers=w.auth["charge"])
    assert r.status_code == 200 and r.json()["state"] == "AVAILABLE"


@pytest.mark.parametrize(("route", "body", "states"), [
    ("reserve", {}, ["OCCUPIED", "HOUSEKEEPING", "RESERVED", "BLOCKED", "MAINTENANCE",
                     "PENDING_DISCHARGE"]),
    ("out-of-service", {"reason": "FAULT"}, ["OCCUPIED", "HOUSEKEEPING", "RESERVED", "BLOCKED",
                                             "MAINTENANCE"]),
    ("unreserve", None, ["AVAILABLE", "OCCUPIED", "BLOCKED"]),
    ("return-to-service", None, ["AVAILABLE", "OCCUPIED", "RESERVED", "HOUSEKEEPING"]),
])
async def test_each_move_needs_the_state_it_starts_from(ward, db_session, route, body, states):
    w, client, app = ward
    for state in states:
        await _set_state(db_session, w.beds["3"], BedState(state))
        r = await client.post(f"/tenant/beds/{w.beds['3'].id}/{route}", json=body,
                              headers=w.auth["charge"])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition"), (route, state)
        assert (await _stored(db_session, w.beds["3"].id))[0] == state
    assert _rows(app) == []


async def test_only_beds_manage_state_moves_a_bed(ward):
    w, client, _ = ward
    for who in ("nurse", "doctor"):
        r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth[who])
        assert r.status_code == 403 and r.json()["detail"] == "permission required: beds.manage_state"
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth["admin"])
    assert r.status_code == 200, r.text


async def test_a_bed_of_another_unit_is_out_of_scope(ward):
    w, client, app = ward
    r = await client.post(f"/tenant/beds/{w.beds['N1'].id}/reserve", json={}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    assert _rows(app) == []


async def test_a_closed_bed_is_reopened_before_it_is_moved(ward, db_session):
    """X6."""
    w, client, _ = ward
    w.beds["3"].is_active = False
    db_session.add(w.beds["3"])
    await db_session.commit()
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_closed")


async def test_return_to_service_runs_the_guards_of_every_freeing_move(ward, db_session, monkeypatch):
    """R6: an admission still open on the bed refuses it `bed_in_use`, as the raw move does."""
    w, client, _ = ward

    async def held(db, bed_id):
        return True

    monkeypatch.setattr(tenant_router, "_holds_open_admission", held)
    await _set_state(db_session, w.beds["3"], BedState.BLOCKED)
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/return-to-service", headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_in_use")
    assert (await _stored(db_session, w.beds["3"].id))[0] == "BLOCKED"


@pytest.mark.parametrize("target", ["RESERVED", "BLOCKED"])
async def test_the_raw_move_sets_no_state_that_needs_a_note_or_a_reason(ward, db_session, target):
    """X4."""
    w, client, _ = ward
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/transition", json={"new_state": target},
                          headers=w.auth["admin"])
    assert r.status_code == 400
    assert (await _stored(db_session, w.beds["3"].id))[0] == "AVAILABLE"


async def test_a_reserved_bed_is_not_closed(ward):
    """X5: the reservation is cancelled first."""
    w, client, _ = ward
    await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={}, headers=w.auth["charge"])
    r = await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"is_active": False},
                           headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_in_use")
```

In `homunculus-engine/tests/test_route_permissions.py`, after the row `("POST", "/tenant/beds/{bed_id}/release"): ANY("beds.release"),`, add:

```python
    # G2-B3a (Doluluk): the four bed moves (spec §4, D4)
    ("POST", "/tenant/beds/{bed_id}/reserve"): ANY("beds.manage_state"),
    ("POST", "/tenant/beds/{bed_id}/unreserve"): ANY("beds.manage_state"),
    ("POST", "/tenant/beds/{bed_id}/out-of-service"): ANY("beds.manage_state"),
    ("POST", "/tenant/beds/{bed_id}/return-to-service"): ANY("beds.manage_state"),
```

In `homunculus-engine/tests/test_tenant_isolation.py`, after the `"bed release"` entry of `BY_ID`, add:

```python
    # G2-B3a (Doluluk): the caller's own free bed is reserved and taken out of service (200); it is
    # neither reserved nor out of service, so the two undos are refused by the domain (409).
    "bed reserve": ById("POST", lambda s: f"/tenant/beds/{s.free_bed}/reserve",
                        lambda a: {"note": "Sentetik rezerv"}),
    "bed unreserve": ById("POST", lambda s: f"/tenant/beds/{s.free_bed}/unreserve", control=409),
    "bed out of service": ById("POST", lambda s: f"/tenant/beds/{s.free_bed}/out-of-service",
                               lambda a: {"reason": "FAULT"}),
    "bed return to service": ById("POST", lambda s: f"/tenant/beds/{s.free_bed}/return-to-service",
                                  control=409),
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bed_state_routes.py tests/test_route_permissions.py tests/test_tenant_isolation.py 2>&1 | tail -5
```

Expected:
- `test_bed_state_routes.py` fails with 404s (the routes do not exist), except where a 400 from the raw move is already true (the BLOCKED case of the raw-move test);
- the route table's own completeness test fails on rows for routes the app lacks;
- the four new isolation cases fail.

- [ ] **Step 3: The bodies**

In `homunculus-engine/src/homunculus/tenant/schemas.py`:

1. Replace the two import lines

```python
from pydantic import BaseModel, Field, StringConstraints

from homunculus.tenant.models import BedState, UnitType
```

with

```python
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from homunculus.tenant.models import BedState, BedStateReason, UnitType
```

2. Append at the end of the file:

```python


# ---------------------------------------------------------------- G2-B3a (Doluluk)
# A note is trimmed and at most 200 characters (spec §3); blank is "no note" (None, at the route).
_Note200 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class BedReserve(BaseModel):
    """Hold a free bed: for whom and why — optional, and stored encrypted (R8)."""
    model_config = ConfigDict(extra="forbid")
    note: _Note200 | None = None


class BedOutOfService(BaseModel):
    """Take a free bed out of service: always a reason (D4), a note too for OTHER (X3)."""
    model_config = ConfigDict(extra="forbid")
    reason: BedStateReason
    note: _Note200 | None = None
```

- [ ] **Step 4: The routes**

In `homunculus-engine/src/homunculus/tenant/router.py`:

1. Replace the errors import

```python
from homunculus.admission.errors import (
    BED_IN_USE, BED_LABEL_TAKEN, BOARD_NOT_CLEARED, HAS_OPEN_BEDS, INVALID_TRANSITION, NAME_TAKEN,
    Refusal, field_invalid,
)
```

with

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_IN_USE, BED_LABEL_TAKEN, BOARD_NOT_CLEARED, HAS_OPEN_BEDS, INVALID_TRANSITION,
    NAME_TAKEN, Refusal, field_invalid,
)
```

2. Replace

```python
from homunculus.tenant.models import (
    BED_STATE_TRANSITIONS, Bed, BedState, Room, Site, Tenant, Unit,
)
from homunculus.tenant.schemas import (
    BedCreate, BedPatch, BedResponse, BedStateTransitionRequest,
```

with

```python
from homunculus.tenant.models import (
    BED_STATE_TRANSITIONS, Bed, BedState, BedStateReason, Room, Site, Tenant, Unit,
)
from homunculus.tenant.schemas import (
    BedCreate, BedOutOfService, BedPatch, BedReserve, BedResponse, BedStateTransitionRequest,
```

3. After the function `_holds_open_admission` (it ends with `.limit(1))).first() is not None`), insert:

```python


async def _free_guards(request: Request, db: AsyncSession, hospital: str, bed: Bed, actor: str,
                       *, via: str) -> None:
    """What every move that FREES a bed checks first, under the bed's lock (B1a's final review;
    G2-B3a R6): no admission on it still open (`bed_in_use`), and its discharged patients' cards
    off the board (`_last_card_off`, `board_not_cleared`). The raw move and the Doluluk's return
    to service share it, so neither frees a bed the release would not. Raises Refusal."""
    if await _holds_open_admission(db, bed.id):
        raise Refusal(409, BED_IN_USE, "An admission on this bed is still open: it is "
                      "discharged before the bed is freed.")
    await _last_card_off(request, db, hospital, bed.id, actor, via=via)


#: G2-B3a (X4): states the raw move never sets — each comes with a note or a reason, which only
#: the Doluluk's routes take.
_NOT_RAW = frozenset({BedState.RESERVED, BedState.BLOCKED})
```

4. In `transition_bed`, replace

```python
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _lock_bed(db, bed_id)
    if body.new_state == BedState.AVAILABLE and \
            body.new_state in BED_STATE_TRANSITIONS.get(bed.state, set()):
        try:
            if await _holds_open_admission(db, bed.id):
                raise Refusal(409, BED_IN_USE, "An admission on this bed is still open: it is "
                              "discharged before the bed is freed.")
            await _last_card_off(request, db, await trail.hospital_of(db, caller_tenant), bed.id,
                                 user.username, via="bed.transition")
        except Refusal as exc:
            raise exc.http() from None
```

with

```python
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _lock_bed(db, bed_id)
    if body.new_state in _NOT_RAW:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"{body.new_state.value} is set on the bed's own routes "
                                   "(reserve, out-of-service), with its note or reason.")
    if body.new_state == BedState.AVAILABLE and \
            body.new_state in BED_STATE_TRANSITIONS.get(bed.state, set()):
        try:
            await _free_guards(request, db, await trail.hospital_of(db, caller_tenant), bed,
                               user.username, via="bed.transition")
        except Refusal as exc:
            raise exc.http() from None
```

5. At the end of the file, after `transition_bed`'s last lines

```python
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)
```

append:

```python


# ---------------------------------------------------------------- G2-B3a (Doluluk)
# A free bed reserved for an expected patient or taken out of service with a reason, and either
# undone (spec §4, D4). Every route follows the same steps:
#   1. the bed is proven the caller's tenant's, and its row is locked (R6);
#   2. the caller's units must reach it, and a closed bed is refused (X6);
#   3. the state is checked;
#   4. one transition runs, which clears the old reason and note (`Bed.transition_to`), and the
#      new ones are written.
# Each move is audited after the commit, with the reason and whether a note was written — never
# its words (R8).
_manage_state = Depends(require_permission("beds.manage_state"))


async def _bed_in_reach(db: AsyncSession, bed_id: uuid.UUID, caller_tenant: uuid.UUID,
                        user: User) -> tuple[Bed, uuid.UUID]:
    """The bed, locked, and its unit — or the refusal: 404 when the bed is another tenant's or
    does not exist; 403 `out_of_scope` outside the caller's units; 409 `bed_closed` for a closed
    bed (X6)."""
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _lock_bed(db, bed_id)
    unit_id = await _unit_of_bed(db, bed_id)
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit_id, bed_id=bed.id)
    except Refusal as exc:
        raise exc.http() from None
    if not bed.is_active:
        raise Refusal(409, BED_CLOSED, "The bed is closed: it is reopened first.").http()
    return bed, unit_id


def _must_be(bed: Bed, states: frozenset[BedState], what: str) -> BedState:
    """The bed's state, if it is one of `states`; else 409 `invalid_transition`."""
    if bed.state not in states:
        raise Refusal(409, INVALID_TRANSITION, f"{what} (it is {bed.state.value}).").http()
    return bed.state


async def _state_written(request: Request, db: AsyncSession, hospital: str, bed: Bed,
                         unit_id: uuid.UUID, user: User, event_type: str, *, was: BedState,
                         reason: str | None, note: bool) -> BedResponse:
    """Commit the move, then audit it: who, the bed, from → to, the reason, and whether a note
    was written — never the note (R8)."""
    to = bed.state
    await db.commit()
    await db.refresh(bed)
    trail.record(request, hospital, event_type, payload={
        "bed_id": str(bed.id), "unit_id": str(unit_id), "from": was.value, "to": to.value,
        "reason": reason, "note": note, "actor": user.username})
    return BedResponse.model_validate(bed)


@router.post("/beds/{bed_id}/reserve", response_model=BedResponse,
             summary="Hold a free bed for an expected patient (G2-B3a)")
async def reserve_bed(
    bed_id: uuid.UUID, body: BedReserve, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.AVAILABLE}), "Only a free bed can be reserved")
    hospital = await trail.hospital_of(db, caller_tenant)
    note = body.note or None
    bed.transition_to(BedState.RESERVED)
    bed.state_note = note
    return await _state_written(request, db, hospital, bed, unit_id, user, "bed.reserve",
                                was=was, reason=None, note=note is not None)


@router.post("/beds/{bed_id}/unreserve", response_model=BedResponse,
             summary="Cancel a bed's reservation (G2-B3a)")
async def unreserve_bed(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.RESERVED}), "Only a reserved bed can be unreserved")
    hospital = await trail.hospital_of(db, caller_tenant)
    bed.transition_to(BedState.AVAILABLE)
    return await _state_written(request, db, hospital, bed, unit_id, user, "bed.unreserve",
                                was=was, reason=None, note=False)


@router.post("/beds/{bed_id}/out-of-service", response_model=BedResponse,
             summary="Take a free bed out of service, with a reason (G2-B3a)")
async def bed_out_of_service(
    bed_id: uuid.UUID, body: BedOutOfService, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.AVAILABLE}),
                   "Only a free bed can be taken out of service")
    note = body.note or None
    if body.reason is BedStateReason.OTHER and note is None:
        raise field_invalid("note", "The reason 'other' needs a note.").http()      # X3
    hospital = await trail.hospital_of(db, caller_tenant)
    bed.transition_to(BedState.BLOCKED)
    bed.state_reason, bed.state_note = body.reason.value, note
    return await _state_written(request, db, hospital, bed, unit_id, user, "bed.out_of_service",
                                was=was, reason=body.reason.value, note=note is not None)


@router.post("/beds/{bed_id}/return-to-service", response_model=BedResponse,
             summary="Free a bed out of service or in maintenance (G2-B3a)")
async def bed_return_to_service(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    """R3, R6: BLOCKED or MAINTENANCE → AVAILABLE, after the guards every freeing move runs."""
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.BLOCKED, BedState.MAINTENANCE}),
                   "Only a bed out of service or in maintenance returns to service")
    reason = bed.state_reason
    hospital = await trail.hospital_of(db, caller_tenant)
    try:
        await _free_guards(request, db, hospital, bed, user.username, via="bed.return_to_service")
    except Refusal as exc:
        raise exc.http() from None
    bed.transition_to(BedState.AVAILABLE)
    return await _state_written(request, db, hospital, bed, unit_id, user,
                                "bed.return_to_service", was=was, reason=reason, note=False)
```

- [ ] **Step 5: Run it and see it green**

Same command as Step 2. Expected:
- `test_bed_state_routes.py`: `17 passed`;
- the route table and the isolation suite: all passed.

- [ ] **Step 6: The structure and admission suites still pass**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_structure_api.py tests/test_admission_api.py tests/test_discharge_api.py 2>&1 | tail -3
```

Expected: all passed. The raw move's existing tests (`bed_in_use`, `board_not_cleared`) pass through `_free_guards` unchanged.

- [ ] **Step 7: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_bed_state_routes.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_bed_state_routes.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py
git commit -m "feat(tenant): reserve, unreserve, out of service and return to service — under the bed's lock, in the caller's units, audited without the note (G2-B3a, §4, D4, R6, R8, X3–X6)" -m "_free_guards is the raw move's own check, now shared with return to service. The raw move refuses RESERVED and BLOCKED (X4). Red: 404 on every new route; the route table and the isolation cases named routes the app lacked." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Names and notes in their own read; the structure says since when (spec R1, R7, D2, D3)

**Files:**
- Create: `homunculus-engine/src/homunculus/tenant/shortname.py`
- Create: `homunculus-engine/tests/test_short_name.py`
- Modify: `homunculus-engine/src/homunculus/tenant/schemas.py`
- Modify: `homunculus-engine/src/homunculus/tenant/router.py`
- Create: `homunculus-engine/tests/test_occupancy_read.py`
- Modify: `homunculus-engine/tests/test_structure_api.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: The short name, test first**

Create `homunculus-engine/tests/test_short_name.py`:

```python
# homunculus-engine/tests/test_short_name.py
"""The one form a bed screen names its patient by (G2-B3a, D3, R7). The ward writes the surname
first («Soyad Ad Ata adı», the user, 2026-11-09), so the screen shows the SECOND word in full and
the FIRST word's initial: "Əli M.". Never more than one word and one initial. No database;
synthetic names only."""
from __future__ import annotations

import pytest

from homunculus.tenant.shortname import short_name


@pytest.mark.parametrize(("name", "short"), [
    ("Məmmədov Əli Rauf oğlu", "Əli M."),
    ("Kaya Ayşe", "Ayşe K."),
    ("  İsmayılov   İlkin  ", "İlkin İ."),      # spaces around and between; dotted capital kept
    ("ışık Ömer", "Ömer ı."),                   # case is kept, never folded
    ("Sentetik", "Sentetik"),                   # one word: shown as it is
    ("", None),
    ("   ", None),
    (None, None),
])
def test_the_second_word_and_the_first_words_initial(name, short):
    assert short_name(name) == short


def test_it_never_carries_more_than_one_word_and_one_initial():
    assert short_name("Sentetik Hasta Üçüncü Dördüncü").split(" ") == ["Hasta", "S."]
```

Run it:

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_short_name.py 2>&1 | tail -3
```

Expected: collection error, `ModuleNotFoundError: No module named 'homunculus.tenant.shortname'`.

Create `homunculus-engine/src/homunculus/tenant/shortname.py`:

```python
# homunculus-engine/src/homunculus/tenant/shortname.py
"""The one form a bed screen names its patient by (G2-B3a, spec D3, R7): "Əli M.".

PHI RULE: it reads a name and returns less of it; nothing is kept or logged."""
from __future__ import annotations


def short_name(display_name: str | None) -> str | None:
    """The ward writes the surname first ("Məmmədov Əli Rauf oğlu", the user, 2026-11-09): the
    SECOND word in full and the FIRST word's initial — "Əli M.". A one-word name is shown as it
    is, and no word at all is None. Case is kept: "İ", "ı" and "Ə" are never folded."""
    words = (display_name or "").split()
    if not words:
        return None
    if len(words) == 1:
        return words[0]
    return f"{words[1]} {words[0][0]}."
```

Run the same command. Expected: `9 passed`.

- [ ] **Step 2: The read and the structure's `state_since`, test first**

Create `homunculus-engine/tests/test_occupancy_read.py`:

```python
# homunculus-engine/tests/test_occupancy_read.py
"""GET /tenant/occupancy (G2-B3a, spec R1, R7, R8, D2). It returns, for the caller's beds only:
- the short name of the patient an open admission holds in the bed;
- a reservation's note;
- an out-of-service bed's reason and note.
It is read by whoever may open Doluluk, and by nobody else. A user manager or a device mapper —
who read /tenant/structure since X52 and ESLEME — gets neither names nor notes from either route.
/tenant/structure says since when each bed is in its state. Postgres; synthetic ward
(tests/kabul_world.py)."""
from __future__ import annotations

from datetime import datetime

import pytest_asyncio

from homunculus.auth.models import Group, GroupPermission
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]
NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _form(w, bed: str) -> dict:
    """The Kabul tab's body for bed `bed`: "Sentetik Hasta <bed>", one person per bed."""
    return {
        "patient": {"display_name": f"Sentetik Hasta {bed}", "date_of_birth": "1970-05-05",
                    "sex": "female", "consent": "KVKK_SIGNED"},
        "note": {"admitting_unit_id": str(w.units["rea"].id), "bed_id": str(w.beds[bed].id),
                 "admission_type": "ICU", "admission_diagnosis_free_text": "Sentetik tanı",
                 "no_known_allergy": True},
    }


async def _admit(client, w, bed: str) -> None:
    r = await client.post("/admissions", json=_form(w, bed), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text


async def _only(db, w, permission: str) -> dict[str, str]:
    """A signed-in account of the ward holding ONE right, granted Reanimasiya."""
    group = Group(tenant_id=w.tenant.id, slug=f"sentetik-{permission.replace('.', '-')}",
                  name="Sentetik", permissions=[GroupPermission(permission=permission)])
    db.add(group)
    await db.flush()
    user = await add_user(db, username=f"{permission}@kabul.example.com", tenant_id=w.tenant.id,
                          group=group)
    db.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id, unit_id=str(w.units["rea"].id)))
    await db.commit()
    return await bearer(db, user)


async def test_a_nurse_reads_the_short_name_in_a_bed_of_her_unit_and_no_other(ward):
    w, client, _ = ward
    await _admit(client, w, "2")
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    assert r.json() == {"beds": [{"bed_id": str(w.beds["2"].id), "occupant_short": "Hasta S.",
                                  "state_reason": None, "state_note": None}]}
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse_b"])        # Neonatal only
    assert r.json() == {"beds": []}


async def test_a_reservation_s_note_and_an_out_of_service_reason_are_read(ward):
    w, client, _ = ward
    await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": NOTE},
                      headers=w.auth["charge"])
    await client.post(f"/tenant/beds/{w.beds['10'].id}/out-of-service",
                      json={"reason": "ISOLATION_CLEANING"}, headers=w.auth["charge"])
    r = await client.get("/tenant/occupancy", headers=w.auth["charge"])
    beds = {b["bed_id"]: b for b in r.json()["beds"]}
    assert beds == {
        str(w.beds["3"].id): {"bed_id": str(w.beds["3"].id), "occupant_short": None,
                              "state_reason": None, "state_note": NOTE},
        str(w.beds["10"].id): {"bed_id": str(w.beds["10"].id), "occupant_short": None,
                               "state_reason": "ISOLATION_CLEANING", "state_note": None},
    }


async def test_whoever_may_open_doluluk_reads_it_and_nobody_else(ward):
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor", "admin"):
        assert (await client.get("/tenant/occupancy", headers=w.auth[who])).status_code == 200, who
    assert (await client.get("/tenant/occupancy", headers=w.auth["auditor"])).status_code == 403


async def test_a_user_manager_or_a_device_mapper_gets_no_name_and_no_note(ward, db_session):
    """R1: both read /tenant/structure, which carries no patient data and no note."""
    w, client, _ = ward
    await _admit(client, w, "2")
    await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": NOTE},
                      headers=w.auth["charge"])
    for permission in ("users.manage", "devices.map_beds"):
        auth = await _only(db_session, w, permission)
        assert (await client.get("/tenant/occupancy", headers=auth)).status_code == 403, permission
        r = await client.get("/tenant/structure", headers=auth)
        assert r.status_code == 200, r.text
        beds = [b for s in r.json()["sites"] for u in s["units"] for room in u["rooms"]
                for b in room["beds"]]
        assert beds, permission
        assert all(set(b) == {"id", "label", "state", "is_active", "state_since"} for b in beds)
        assert "Hasta" not in r.text and NOTE not in r.text


async def test_the_structure_says_since_when_a_bed_is_in_its_state(ward, db_session):
    w, client, _ = ward
    r = await client.get("/tenant/structure", headers=w.auth["nurse"])
    bed = r.json()["sites"][0]["units"][0]["rooms"][0]["beds"][0]
    db_session.expire_all()
    stored = (await db_session.get(Bed, w.beds["1"].id)).state_updated_at
    assert datetime.fromisoformat(bed["state_since"]) == stored
```

In `homunculus-engine/tests/test_structure_api.py`, replace

```python
    assert bed == {"id": str(w.beds["1"].id), "label": "1", "state": "AVAILABLE", "is_active": True}
```

with

```python
    assert bed == {"id": str(w.beds["1"].id), "label": "1", "state": "AVAILABLE", "is_active": True,
                   "state_since": bed["state_since"]}          # G2-B3a: when it entered the state
    assert bed["state_since"]
```

In `homunculus-engine/tests/test_route_permissions.py`, after the four rows Task 4 added, add:

```python
    ("GET", "/tenant/occupancy"): ANY("admissions.view", "admissions.admit",
                                      "admissions.discharge.confirm", "beds.release"),
```

In `homunculus-engine/tests/test_tenant_isolation.py`, after `test_the_structure_holds_only_the_callers_tenant`, add:

```python


@requires_db
async def test_the_occupancy_holds_only_the_callers_tenant(world):
    """G2-B3a (R1): GET /tenant/occupancy — the names and notes of the caller's own beds only."""
    r = await _call(world, "GET", "/tenant/occupancy")
    assert r.status_code == 200, r.text
    assert {b["bed_id"] for b in r.json()["beds"]} == {str(world.a.bed)}
```

- [ ] **Step 3: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_occupancy_read.py tests/test_structure_api.py tests/test_route_permissions.py tests/test_tenant_isolation.py 2>&1 | tail -5
```

Expected:
- the occupancy tests fail with 404 (no route);
- the structure tests fail on `KeyError: 'state_since'`;
- the route table names a route the app lacks.

- [ ] **Step 4: The schemas**

In `homunculus-engine/src/homunculus/tenant/schemas.py`:

1. In `class StructureBed`, after `is_active: bool`, add:

```python
    # G2-B3a: when the bed entered its state (`beds.state_updated_at`) — "temizlikte · 25 dk".
    state_since: datetime | None = None
```

2. Append at the end of the file:

```python


class OccupancyBed(BaseModel):
    """One bed of GET /tenant/occupancy. It carries the short name of its patient while an
    admission holds the bed (R7), and the out-of-service reason and the note (R8). Nothing else
    about the patient."""
    bed_id: uuid.UUID
    occupant_short: str | None = None
    state_reason: BedStateReason | None = None
    state_note: str | None = None


class OccupancyResponse(BaseModel):
    """GET /tenant/occupancy (R1): only the caller's beds that have something to say."""
    beds: list[OccupancyBed]
```

- [ ] **Step 5: The route and the structure**

In `homunculus-engine/src/homunculus/tenant/router.py`:

1. In the schemas import, replace

```python
    StructureBed, StructureResponse, StructureRoom, StructureSite, StructureUnit,
```

with

```python
    OccupancyBed, OccupancyResponse,
    StructureBed, StructureResponse, StructureRoom, StructureSite, StructureUnit,
```

and after the line `from homunculus.tenant import scope`, add:

```python
from homunculus.tenant.shortname import short_name          # G2-B3a (R7)
```

2. In `structure`, replace

```python
                room_beds = [StructureBed(id=b.id, label=b.label, state=b.state,
                                          is_active=b.is_active)
```

with

```python
                room_beds = [StructureBed(id=b.id, label=b.label, state=b.state,
                                          is_active=b.is_active, state_since=b.state_updated_at)
```

3. At the end of the file, append:

```python


#: D2: whoever may open the Doluluk screen reads its names and notes; nobody else does (R1).
_OCCUPANCY_READERS = ("admissions.view", "admissions.admit", "admissions.discharge.confirm",
                      "beds.release")


@router.get("/occupancy", response_model=OccupancyResponse,
            summary="The short names and the notes of the caller's beds (G2-B3a)")
async def occupancy(
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission(*_OCCUPANCY_READERS)),
) -> OccupancyResponse:
    """R1: the patient data of the bed screen, apart from GET /tenant/structure. The structure
    is read by the scope editor (`users.manage`) and the monitor→bed editor (`devices.map_beds`)
    as well, and they must not get patient names.
    For each of the caller's beds (her units; her tenant), it lists:
    - the short name of the patient whose admission is still open on it (R7);
    - the out-of-service reason;
    - the note, decrypted (R8).
    A bed with none of the three is left out; the screen joins the rest to the structure by
    `bed_id`."""
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    beds = (await db.execute(
        select(Bed).join(Room, Room.id == Bed.room_id).join(Unit, Unit.id == Room.unit_id)
        .join(Site, Site.id == Unit.site_id)
        .where(Site.tenant_id == caller_tenant,
               unitscope.reach_clause(reach, unit_id=Unit.id, bed_id=Bed.id)))).scalars().all()
    ids = [b.id for b in beds]
    names = dict((await db.execute(
        select(Admission.bed_id, Patient.display_name)
        .join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.bed_id.in_(ids),
               Admission.state.in_(list(OPEN_ADMISSION_STATES))))).all()) if ids else {}
    return OccupancyResponse(beds=[
        OccupancyBed(bed_id=b.id, occupant_short=short_name(names.get(b.id)),
                     state_reason=b.state_reason, state_note=b.state_note)
        for b in sorted(beds, key=lambda b: str(b.id))
        if b.id in names or b.state_reason is not None or b.state_note is not None
    ])
```

- [ ] **Step 6: Run it and see it green**

Same command as Step 3. Expected:
- `test_occupancy_read.py`: `5 passed`;
- the other three files: all passed.

- [ ] **Step 7: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in homunculus-engine/src/homunculus/tenant/shortname.py homunculus-engine/tests/test_short_name.py homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_occupancy_read.py homunculus-engine/tests/test_structure_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/tenant/shortname.py homunculus-engine/tests/test_short_name.py homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_occupancy_read.py homunculus-engine/tests/test_structure_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py
git commit -m "feat(tenant): GET /tenant/occupancy — short names and notes for whoever may open Doluluk; the structure says since when (G2-B3a, R1, R7, D2)" -m "The structure stays free of patient data: the scope editor and the monitor→bed editor read it too. Short name = the second word and the first word's initial, as the ward writes the surname first. Red: ModuleNotFoundError shortname; 404 occupancy; KeyError state_since." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: An admission into a reserved bed (spec D5, X1, X2, X9)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/errors.py`
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Create: `homunculus-engine/tests/test_reserved_admission.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_reserved_admission.py`:

```python
# homunculus-engine/tests/test_reserved_admission.py
"""An admission into a reserved bed (G2-B3a, spec D5, X1, X2, X9).
- Without `confirm_reserved`, it is refused `bed_reserved`, carrying the bed's id and never the
  note. Nothing is written and no protocol number is spent on the refusal.
- With the confirmation, the patient takes the bed, the note goes with the state, and the audit
  row says the bed was reserved.
- `confirm_reserved` is not part of the form's digest.
- A bed out of service or in maintenance takes no admission.
- A reservation racing an admission for one bed leaves exactly one winner.
Postgres; synthetic ward (tests/kabul_world.py)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.admission import router as admission_router
from homunculus.admission.models import Patient
from homunculus.admission.schemas import AdmissionCreate
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import FIRST_PROTOCOL, SLUG, build_ward, ward_client

pytestmark = [requires_db]
NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _form(w, bed: str, request_id: uuid.UUID | None = None, **top) -> dict:
    """The Kabul tab's body for bed `bed`, with `top` beside `patient` and `note`."""
    body = {
        "patient": {"display_name": f"Sentetik Hasta {bed}", "date_of_birth": "1970-05-05",
                    "sex": "female", "consent": "KVKK_SIGNED"},
        "note": {"admitting_unit_id": str(w.units["rea"].id), "bed_id": str(w.beds[bed].id),
                 "admission_type": "ICU", "admission_diagnosis_free_text": "Sentetik tanı",
                 "no_known_allergy": True},
        **top,
    }
    if request_id is not None:
        body["request_id"] = str(request_id)
    return body


async def _reserve(client, w, bed: str) -> None:
    r = await client.post(f"/tenant/beds/{w.beds[bed].id}/reserve", json={"note": NOTE},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text


def _admit_rows(app) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=100)
            if r.event_type == "admission.admit"]


async def test_a_reserved_bed_is_refused_without_the_confirmation_and_nothing_is_spent(ward, db_session):
    w, client, _ = ward
    await _reserve(client, w, "3")
    r = await client.post("/admissions", json=_form(w, "3"), headers=w.auth["charge"])
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert (detail["code"], detail["bed_id"]) == ("bed_reserved", str(w.beds["3"].id))
    assert NOTE not in r.text                                                      # X1
    db_session.expire_all()
    assert (await db_session.execute(select(func.count()).select_from(Patient))).scalar_one() == 0
    assert (await db_session.get(Bed, w.beds["3"].id)).state == BedState.RESERVED
    r = await client.post("/admissions", json=_form(w, "1"), headers=w.auth["charge"])
    assert r.status_code == 201, r.text
    assert r.json()["protocol_no"] == FIRST_PROTOCOL                    # no number was spent


async def test_with_the_confirmation_the_reserved_bed_takes_the_patient(ward, db_session):
    w, client, app = ward
    await _reserve(client, w, "3")
    r = await client.post("/admissions", json=_form(w, "3", confirm_reserved=True),
                          headers=w.auth["charge"])
    assert r.status_code == 201, r.text
    row = (await db_session.execute(text("SELECT state::text, state_note FROM beds WHERE id = :id"),
                                    {"id": w.beds["3"].id})).one()
    assert tuple(row) == ("OCCUPIED", None)
    (audit,) = _admit_rows(app)
    assert audit.payload["bed_was_reserved"] is True                                # X9


async def test_a_free_bed_needs_no_confirmation_and_says_nothing_of_one(ward):
    w, client, app = ward
    r = await client.post("/admissions", json=_form(w, "3", confirm_reserved=True),
                          headers=w.auth["charge"])
    assert r.status_code == 201, r.text
    (audit,) = _admit_rows(app)
    assert "bed_was_reserved" not in audit.payload


@pytest.mark.parametrize("state", [BedState.BLOCKED, BedState.MAINTENANCE])
async def test_a_bed_out_of_service_or_in_maintenance_takes_no_admission(ward, db_session, state):
    w, client, _ = ward
    w.beds["3"].state = state
    db_session.add(w.beds["3"])
    await db_session.commit()
    r = await client.post("/admissions", json=_form(w, "3", confirm_reserved=True),
                          headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available")


async def test_the_confirmation_is_not_part_of_the_forms_digest(ward):
    """X2: one form, sent before and after the nurse's answer, is one form."""
    w, client, _ = ward
    body = _form(w, "3", request_id=uuid.uuid4())
    digest = admission_router._request_digest
    assert digest(AdmissionCreate.model_validate(body)) == \
        digest(AdmissionCreate.model_validate({**body, "confirm_reserved": True}))
    await _reserve(client, w, "3")
    r = await client.post("/admissions", json=body, headers=w.auth["charge"])
    assert r.json()["detail"]["code"] == "bed_reserved"
    r = await client.post("/admissions", json={**body, "confirm_reserved": True},
                          headers=w.auth["charge"])
    assert r.status_code == 201, r.text


async def test_a_reservation_and_an_admission_racing_for_one_bed_leave_one_winner(ward, db_session):
    """R6: both take the bed's row lock first; the second sees what the first committed."""
    w, client, _ = ward
    reserve, admit = await asyncio.gather(
        client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": NOTE},
                    headers=w.auth["charge"]),
        client.post("/admissions", json=_form(w, "3"), headers=w.auth["nurse"]),
    )
    assert (reserve.status_code, admit.status_code) in {(200, 409), (409, 201)}, \
        (reserve.text, admit.text)
    db_session.expire_all()
    state = (await db_session.get(Bed, w.beds["3"].id)).state
    if reserve.status_code == 200:
        assert state == BedState.RESERVED and admit.json()["detail"]["code"] == "bed_reserved"
    else:
        assert state == BedState.OCCUPIED and reserve.json()["detail"]["code"] == "invalid_transition"
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_reserved_admission.py 2>&1 | tail -5
```

Expected:
- the refusal test fails: `bed_not_available` comes back, not `bed_reserved`;
- the bodies with `confirm_reserved` fail with 422 (`extra="forbid"`);
- the digest test fails on `ValidationError`.

- [ ] **Step 3: The code**

1. `homunculus-engine/src/homunculus/admission/errors.py`. After the B1d block, which ends

```python
CODES = CODES | frozenset({
    PROTOCOL_NOT_CONFIGURED, PROTOCOL_EXHAUSTED, PROTOCOL_FORMAT, PROTOCOL_NOT_FORWARD,
    LABEL_SIZE, LABEL_TOO_NARROW, LABEL_DPI, NO_PROTOCOL,
})
```

add:

```python

# G2-B3a — Doluluk (spec D5, X1). Its own block after B1d's, which it widens the same way.
BED_RESERVED = "bed_reserved"                          # a RESERVED bed, and no confirm_reserved
CODES = CODES | frozenset({BED_RESERVED})
```

2. `homunculus-engine/src/homunculus/admission/schemas.py`.

Replace

```python
from pydantic import (
    AfterValidator, BaseModel, ConfigDict, Field, ValidationInfo, field_validator,
)
```

with

```python
from pydantic import (
    AfterValidator, BaseModel, ConfigDict, Field, StrictBool, ValidationInfo, field_validator,
)
```

In `class AdmissionCreate`, after `request_id: uuid.UUID | None = None`, add:

```python
    # G2-B3a (spec D5, X2): the nurse saw the bed is reserved and admits into it all the same. A
    # real boolean, beside the form and not in it: `_request_digest` leaves it out.
    confirm_reserved: StrictBool = False
```

3. `homunculus-engine/src/homunculus/admission/service.py`. In `create_draft_admission`, replace

```python
    protocol_no: str | None = None,
) -> Admission:
```

with

```python
    protocol_no: str | None = None,
    reserved_ok: bool = False,
) -> Admission:
```

and replace

```python
    if bed.state != BedState.AVAILABLE:
        raise WorkflowError(
            f"Bed is not AVAILABLE (current state: {bed.state.value}); "
            f"cannot admit.",
            errors.BED_NOT_AVAILABLE,
        )
```

with

```python
    # G2-B3a (D5): a reserved bed takes the admission its route confirmed (`reserved_ok`).
    if bed.state != BedState.AVAILABLE and not (reserved_ok and bed.state == BedState.RESERVED):
        raise WorkflowError(
            f"Bed is not AVAILABLE (current state: {bed.state.value}); "
            f"cannot admit.",
            errors.BED_NOT_AVAILABLE,
        )
```

If `create_draft_admission`'s signature differs from the lines above, read it and put `reserved_ok: bool = False` as its last keyword parameter. Name the difference in the report.

4. `homunculus-engine/src/homunculus/admission/router.py`.

Replace

```python
from homunculus.admission.errors import (
    BED_CLOSED, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, NO_PROTOCOL, REQUEST_CONFLICT,
    TRANSFER_UNAVAILABLE, Refusal, field_invalid,
)
```

with

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_RESERVED, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, NO_PROTOCOL,
    REQUEST_CONFLICT, TRANSFER_UNAVAILABLE, Refusal, field_invalid,
)
```

and `from homunculus.tenant.models import Bed, Room, Tenant, Unit` with `from homunculus.tenant.models import Bed, BedState, Room, Tenant, Unit`.

In `_request_digest`, replace

```python
    body = payload.model_dump(mode="json", exclude={"request_id"})
```

with

```python
    # G2-B3a (X2): `confirm_reserved` is the nurse's answer about the bed, not the form.
    body = payload.model_dump(mode="json", exclude={"request_id", "confirm_reserved"})
```

In `create_admission`, replace

```python
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
```

with

```python
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
        # G2-B3a (D5, X1): a reserved bed takes the patient only when the form says the nurse
        # saw the reservation. The refusal names the bed, never the note (`Refusal`'s rule); the
        # form reads the note from GET /tenant/occupancy. Before the protocol is issued: nothing
        # is spent on a refusal. The bed is locked here (`_bed_of`), so the state holds.
        if bed.state == BedState.RESERVED and not payload.confirm_reserved:
            raise Refusal(409, BED_RESERVED, "The bed is reserved: the admission must confirm it.",
                          extra={"bed_id": str(bed.id)})
        was_reserved = bed.state == BedState.RESERVED
```

In the same function, replace

```python
            request_id=payload.request_id, request_digest=digest, identity_digest=identity,
            protocol_no=protocol_no,
        )
```

with

```python
            request_id=payload.request_id, request_digest=digest, identity_digest=identity,
            protocol_no=protocol_no, reserved_ok=payload.confirm_reserved,
        )
```

and replace

```python
                              "unit_id": str(card["unit_id"]), "actor": actor,
                              "protocol_no": protocol_no, "patient_number": number})
```

with

```python
                              "unit_id": str(card["unit_id"]), "actor": actor,
                              "protocol_no": protocol_no, "patient_number": number,
                              **({"bed_was_reserved": True} if was_reserved else {})})   # X9
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `7 passed`.

- [ ] **Step 5: The admission suites still pass**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_api.py tests/test_protocol_admission.py tests/test_admission_label.py tests/test_discharge_api.py tests/test_tenant_isolation.py 2>&1 | tail -3
```

Expected: all passed.

A test that pins the `admission.admit` payload exactly still passes, because the key appears only for a reserved bed.

A test that pins `AdmissionCreate`'s fields (an OpenAPI or schema snapshot) fails with `confirm_reserved` named. Add the field there and name the file in the report.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/tests/test_reserved_admission.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/tests/test_reserved_admission.py
git commit -m "feat(admission): a reserved bed takes the patient only with confirm_reserved; the refusal names the bed, never the note (G2-B3a, D5, X1, X2, X9)" -m "Checked under the bed's lock before the protocol is issued; confirm_reserved stays out of the form's digest; the admit audit row says bed_was_reserved. Red: bed_not_available instead of bed_reserved; 422 on confirm_reserved." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The engine's gates

**Files:** none changed, unless a gate finds something.

- [ ] **Step 1: The whole no-DB suite**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: Task 0's count + 13 (Task 1) + 9 (Task 5's short name) + any test Task 3 changed. No failure.

- [ ] **Step 2: The whole Postgres suite, in four parts**

Run each part as its own Bash call (each stays under 10 minutes), with `PART` set to 0, 1, 2 and 3 in turn:

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && PART=0 && files=( $(ls tests/test_*.py | grep -v test_infinity_vm_pilot) ) && q=$(( (${#files[@]} + 3) / 4 )) && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings "${files[@]:$((PART*q)):$q}" 2>&1 | tail -3
```

Expected: every part all passed. The skips are environment-only (the same kinds as Task 0 reported). Add the four parts up in the report.

- [ ] **Step 3: The migration chain from empty, and its one head**

```bash
cd /c/tmp/g2b-b3a/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0016_bed_occupancy.py tests/test_migration_0010_schema_parity.py 2>&1 | tail -3
```

Expected: all passed.

- [ ] **Step 4: Report**

Report the numbers. If a gate fails, stop: fix the cause in the task that owns the file, as its own commit with the red named. Never weaken a test to pass a gate.

---

### Task 8: The API client — the names read and the four moves

**Files:**
- Modify: `dashboard/src/backendApi.js`
- Modify: `dashboard/src/backendApi.test.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`

- [ ] **Step 1: Write the failing test**

In `dashboard/src/backendApi.test.js`, insert before the line `  it("builds the structure under its parents and renames, closes and reopens by PATCH", async () => {`:

```js
  it("reads the beds' names and notes and moves a bed by its own routes (G2-B3a)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.occupancy();
    await api.reserveBed("b/1", { note: "Sentetik planlı kabul" });
    await api.unreserveBed("b-1");
    await api.bedOutOfService("b-1", { reason: "FAULT", note: null });
    await api.bedReturnToService("b-1");
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["GET", "/tenant/occupancy"], ["POST", "/tenant/beds/b%2F1/reserve"], ["POST", "/tenant/beds/b-1/unreserve"],
      ["POST", "/tenant/beds/b-1/out-of-service"], ["POST", "/tenant/beds/b-1/return-to-service"],
    ]);
    expect(sent(fetchMock, 1).body).toEqual({ note: "Sentetik planlı kabul" });
    expect(sent(fetchMock, 3).body).toEqual({ reason: "FAULT", note: null });
  });

```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js 2>&1 | tail -6
```

Expected: 1 failed — `api.occupancy is not a function`.

If `sent(...).method` is undefined for a GET in this file's helper, compare the URL list alone for that call, the way the `admissions` tests above do. Say so in the report.

- [ ] **Step 3: The client and the fake**

In `dashboard/src/backendApi.js`, after the line `    releaseBed(id) { return authed(`/tenant/beds/${seg(id)}/release`, { method: "POST" }); },`, add:

```js
    // G2-B3a — Doluluk (tenant/router.py). Names and notes come from their own read, never the
    // structure (spec R1); the four moves answer the bed as BedResponse, and refuse with
    // `err.apiCode` (`invalid_transition`, `bed_closed`, `out_of_scope`, `field_invalid:note`…).
    /** {beds: [{bed_id, occupant_short, state_reason, state_note}]} — only the beds with something to say. */
    occupancy() { return authed("/tenant/occupancy"); },
    /** {note} — the note may be null. */
    reserveBed(id, body) { return authed(`/tenant/beds/${seg(id)}/reserve`, { method: "POST", body }); },
    unreserveBed(id) { return authed(`/tenant/beds/${seg(id)}/unreserve`, { method: "POST" }); },
    /** {reason: FAULT | ISOLATION_CLEANING | STAFFING | OTHER, note} */
    bedOutOfService(id, body) { return authed(`/tenant/beds/${seg(id)}/out-of-service`, { method: "POST", body }); },
    bedReturnToService(id) { return authed(`/tenant/beds/${seg(id)}/return-to-service`, { method: "POST" }); },
```

In `dashboard/src/live/session/testTokens.testutil.js`, replace

```js
    releaseBed: vi.fn(),
```

with

```js
    releaseBed: vi.fn(),
    // G2-B3a: Doluluk — the names read and the four moves
    occupancy: vi.fn(),
    reserveBed: vi.fn(),
    unreserveBed: vi.fn(),
    bedOutOfService: vi.fn(),
    bedReturnToService: vi.fn(),
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: all passed.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
git commit -m "feat(dashboard): the API client reads the beds' names and notes and moves a bed (G2-B3a, R1)" -m "Red: api.occupancy is not a function." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The words — `doluluk`, the Kabul additions, the permission, the code, the bed states (R4, R9, X1)

**Files:**
- Create: `dashboard/src/live/i18n/strings/doluluk.js`
- Modify: `dashboard/src/live/i18n/catalog.js`
- Modify: `dashboard/src/live/i18n/strings/kabul.js`
- Modify: `dashboard/src/live/i18n/strings/perms.js`
- Modify: `dashboard/src/live/i18n/strings.test.js`
- Modify: `dashboard/src/live/screens/admin/catalogue.js`
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js`
- Modify: `dashboard/src/live/apiErrors.js`
- Modify: `dashboard/src/live/data/structure.js`

- [ ] **Step 1: See the guards red first**

The guards already exist; this step only shows they catch the gap:
- `apiErrors.test.js` reads `errors.py` and finds `bed_reserved` unmapped;
- `catalogue.test.js` and `admin.testutil.test.js` read `permissions.py` and find `beds.manage_state` missing.

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js 2>&1 | tail -8
```

Expected: failures naming `bed_reserved` and `beds.manage_state`.

- [ ] **Step 2: The `doluluk` namespace**

Create `dashboard/src/live/i18n/strings/doluluk.js`:

```js
// Group 2 · B3a — Doluluk (screens/doluluk/). The screen shows the ward's beds by unit and room:
// - their state, and for how long;
// - the short name of the patient in an occupied bed;
// - the moves between free, reserved, out of service, cleaning and maintenance.
// Spec 2026-10-26, refreshed 2026-11-09.
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading
// before the pilot. No text here is clinical advice.
export default {
  tr: {
    nav: "Doluluk", navShort: "Doluluk",
    title: "Yatak doluluğu",
    sub: "Birimlerinizdeki yataklar: kim nerede, hangi yatak boş, hangisi temizlikte, rezerve ya da kullanım dışı.",
    loading: "Yataklar okunuyor…",
    readFailed: "Yataklar okunamadı: {reason}",
    namesFailed: "Hasta adları ve notlar okunamadı: {reason}. Yatakların durumu yine de gösteriliyor.",
    unitChooser: "Birim",
    all: "Tümü",
    noUnits: "Kapsamınızda birim yok.",
    noRooms: "Bu birimde oda yok.",
    noBeds: "Bu odada yatak yok.",
    isolation: "İzolasyon",
    unitClosed: "kapalı", roomClosed: "kapalı", bedClosed: "Kapalı",
    occupied: "{occupied} / {usable} dolu",
    counts: { free: "{n} boş", cleaning: "{n} temizlikte", reserved: "{n} rezerve", outOfService: "{n} kullanım dışı", maintenance: "{n} bakımda" },
    since: { now: "az önce", min: "{n} dk", hour: "{h} sa {m} dk", day: "{n} gün" },
    reason: { FAULT: "Arıza", ISOLATION_CLEANING: "İzolasyon temizliği", STAFFING: "Personel yetersizliği", OTHER: "Diğer" },
    action: {
      admit: "Bu yatağa hasta kabul", reserve: "Rezerve et", outOfService: "Kullanım dışı bırak",
      unreserve: "Rezervi kaldır", returnToService: "Kullanıma aç", release: "Temizlik bitti · boş",
    },
    done: {
      reserve: "Rezerve edildi.", outOfService: "Kullanım dışı bırakıldı.", unreserve: "Rezerv kaldırıldı.",
      returnToService: "Kullanıma açıldı.", release: "Yatak boş.",
    },
    working: "İşlem sürüyor: {bed}",
    admitBusy: "Kabul formunda yanıt bekleyen bir gönderim var; yatak seçimi değiştirilmedi.",
    dialog: {
      reserveTitle: "Rezerve et · {bed}", outTitle: "Kullanım dışı bırak · {bed}",
      reason: "Neden", note: "Not",
      reserveHint: "Kimin için, neden — en çok 200 karakter.", noteHint: "En çok 200 karakter.",
      reasonNeeded: "Bir neden seçin.", noteNeeded: "«Diğer» için bir not yazın.",
      submitReserve: "Rezerve et", submitOut: "Kullanım dışı bırak",
    },
  },
  az: {
    nav: "Doluluq", navShort: "Doluluq",
    title: "Çarpayı doluluğu",
    sub: "Şöbələrinizdəki çarpayılar: kim haradadır, hansı çarpayı boşdur, hansı təmizlikdədir, rezervdədir və ya istifadədən kənardır.",
    loading: "Çarpayılar oxunur…",
    readFailed: "Çarpayılar oxunmadı: {reason}",
    namesFailed: "Xəstə adları və qeydlər oxunmadı: {reason}. Çarpayıların vəziyyəti yenə də göstərilir.",
    unitChooser: "Şöbə",
    all: "Hamısı",
    noUnits: "Əhatənizdə şöbə yoxdur.",
    noRooms: "Bu şöbədə otaq yoxdur.",
    noBeds: "Bu otaqda çarpayı yoxdur.",
    isolation: "İzolyasiya",
    unitClosed: "bağlıdır", roomClosed: "bağlıdır", bedClosed: "Bağlıdır",
    occupied: "{occupied} / {usable} doludur",
    counts: { free: "boş: {n}", cleaning: "təmizlikdə: {n}", reserved: "rezervdə: {n}", outOfService: "istifadədən kənar: {n}", maintenance: "təmirdə: {n}" },
    since: { now: "indicə", min: "{n} dəq", hour: "{h} saat {m} dəq", day: "{n} gündür" },
    reason: { FAULT: "Nasazlıq", ISOLATION_CLEANING: "İzolyasiya təmizliyi", STAFFING: "Personel çatışmazlığı", OTHER: "Digər" },
    action: {
      admit: "Bu çarpayıya xəstə qəbul et", reserve: "Rezerv et", outOfService: "İstifadədən çıxar",
      unreserve: "Rezervi ləğv et", returnToService: "İstifadəyə ver", release: "Təmizlik bitdi · boş",
    },
    done: {
      reserve: "Rezerv edildi.", outOfService: "İstifadədən çıxarıldı.", unreserve: "Rezerv ləğv edildi.",
      returnToService: "İstifadəyə verildi.", release: "Çarpayı boşdur.",
    },
    working: "Əməliyyat gedir: {bed}",
    admitBusy: "Qəbul formasında cavab gözləyən göndəriş var; çarpayı seçimi dəyişdirilmədi.",
    dialog: {
      reserveTitle: "Rezerv et · {bed}", outTitle: "İstifadədən çıxar · {bed}",
      reason: "Səbəb", note: "Qeyd",
      reserveHint: "Kimin üçün, nə üçün — ən çox 200 simvol.", noteHint: "Ən çox 200 simvol.",
      reasonNeeded: "Səbəb seçin.", noteNeeded: "«Digər» üçün qeyd yazın.",
      submitReserve: "Rezerv et", submitOut: "İstifadədən çıxar",
    },
  },
  ru: {
    nav: "Занятость коек", navShort: "Койки",
    title: "Занятость коек",
    sub: "Койки ваших отделений: кто где лежит, какая койка свободна, на уборке, в резерве или не используется.",
    loading: "Койки загружаются…",
    readFailed: "Не удалось прочитать койки: {reason}",
    namesFailed: "Не удалось прочитать имена пациентов и заметки: {reason}. Состояние коек всё равно показано.",
    unitChooser: "Отделение",
    all: "Все",
    noUnits: "В вашей зоне нет отделений.",
    noRooms: "В этом отделении нет палат.",
    noBeds: "В этой палате нет коек.",
    isolation: "Изоляция",
    unitClosed: "закрыто", roomClosed: "закрыта", bedClosed: "Закрыта",
    occupied: "занято {occupied} из {usable}",
    counts: { free: "свободно: {n}", cleaning: "на уборке: {n}", reserved: "в резерве: {n}", outOfService: "не используется: {n}", maintenance: "на обслуживании: {n}" },
    since: { now: "только что", min: "{n} мин", hour: "{h} ч {m} мин", day: "{n} дн." },
    reason: { FAULT: "Неисправность", ISOLATION_CLEANING: "Изоляционная уборка", STAFFING: "Нехватка персонала", OTHER: "Другое" },
    action: {
      admit: "Принять пациента на эту койку", reserve: "Зарезервировать", outOfService: "Вывести из использования",
      unreserve: "Снять резерв", returnToService: "Вернуть в использование", release: "Уборка закончена · свободна",
    },
    done: {
      reserve: "Зарезервирована.", outOfService: "Выведена из использования.", unreserve: "Резерв снят.",
      returnToService: "Возвращена в использование.", release: "Койка свободна.",
    },
    working: "Выполняется: {bed}",
    admitBusy: "В форме приёма есть отправка без ответа; выбор койки не изменён.",
    dialog: {
      reserveTitle: "Резерв · {bed}", outTitle: "Вывод из использования · {bed}",
      reason: "Причина", note: "Заметка",
      reserveHint: "Для кого и зачем — не более 200 символов.", noteHint: "Не более 200 символов.",
      reasonNeeded: "Выберите причину.", noteNeeded: "Для «Другое» напишите заметку.",
      submitReserve: "Зарезервировать", submitOut: "Вывести из использования",
    },
  },
  en: {
    nav: "Occupancy", navShort: "Beds",
    title: "Bed occupancy",
    sub: "The beds of your units: who is where, which bed is free, being cleaned, reserved or out of service.",
    loading: "Reading the beds…",
    readFailed: "The beds could not be read: {reason}",
    namesFailed: "Patient names and notes could not be read: {reason}. The beds' states are still shown.",
    unitChooser: "Unit",
    all: "All",
    noUnits: "No unit in your scope.",
    noRooms: "This unit has no rooms.",
    noBeds: "This room has no beds.",
    isolation: "Isolation",
    unitClosed: "closed", roomClosed: "closed", bedClosed: "Closed",
    occupied: "{occupied} / {usable} occupied",
    counts: { free: "{n} free", cleaning: "{n} being cleaned", reserved: "{n} reserved", outOfService: "{n} out of service", maintenance: "{n} in maintenance" },
    since: { now: "just now", min: "{n} min", hour: "{h} h {m} min", day: "{n} d" },
    reason: { FAULT: "Fault", ISOLATION_CLEANING: "Isolation cleaning", STAFFING: "Not enough staff", OTHER: "Other" },
    action: {
      admit: "Admit a patient to this bed", reserve: "Reserve", outOfService: "Take out of service",
      unreserve: "Cancel the reservation", returnToService: "Return to service", release: "Cleaning done · free",
    },
    done: {
      reserve: "Reserved.", outOfService: "Taken out of service.", unreserve: "Reservation cancelled.",
      returnToService: "Returned to service.", release: "The bed is free.",
    },
    working: "In progress: {bed}",
    admitBusy: "The admission form has a send waiting for an answer; the bed choice was not changed.",
    dialog: {
      reserveTitle: "Reserve · {bed}", outTitle: "Take out of service · {bed}",
      reason: "Reason", note: "Note",
      reserveHint: "For whom and why — 200 characters at most.", noteHint: "200 characters at most.",
      reasonNeeded: "Choose a reason.", noteNeeded: "Write a note for «Other».",
      submitReserve: "Reserve", submitOut: "Take out of service",
    },
  },
};
```

In `dashboard/src/live/i18n/catalog.js`:
- after the line `import olcum from "./strings/olcum.js";`, add a blank line and `import doluluk from "./strings/doluluk.js";`;
- in `NAMESPACES`, after the line `  olcum, // G3-01`, add a blank line and `  doluluk, // G2-B3a`.

Keep the blank lines either side, as the file's comments ask.

- [ ] **Step 3: The Kabul words (R4, R9, X1)**

In `dashboard/src/live/i18n/strings/kabul.js`, make the edits below. The tables give the exact old text to find and the new text to put in its place.

**The name box (R9)** — eight edits:

| Language | Find | Replace with |
|---|---|---|
| tr | `name: "Ad soyad", father: "Baba adı"` | `name: "Soyad ad", father: "Baba adı"` |
| tr | `name: "Ad soyad", sex: "Cinsiyet", dob: "Doğum tarihi", dobWrong` | `name: "Soyad ad", sex: "Cinsiyet", dob: "Doğum tarihi", dobWrong` |
| az | `name: "Ad soyad", father: "Ata adı"` | `name: "Soyad ad", father: "Ata adı"` |
| az | `name: "Ad soyad", sex: "Cins", dob: "Doğum tarixi", dobWrong` | `name: "Soyad ad", sex: "Cins", dob: "Doğum tarixi", dobWrong` |
| ru | `name: "Имя и фамилия", father: "Отчество"` | `name: "Фамилия и имя", father: "Отчество"` |
| ru | `name: "Имя и фамилия", sex: "Пол", dob: "Дата рождения", dobWrong` | `name: "Фамилия и имя", sex: "Пол", dob: "Дата рождения", dobWrong` |
| en | `name: "Full name", father: "Father's name"` | `name: "Surname and name", father: "Father's name"` |
| en | `name: "Full name", sex: "Sex", dob: "Date of birth", dobWrong` | `name: "Surname and name", sex: "Sex", dob: "Date of birth", dobWrong` |

**The bed states (R4, RESERVED) and the reserved-bed question (X1).** Each edit replaces the end of the `state` map's second line, and adds `reservedAsk` right after it.

tr — find

```js
      PENDING_TRANSFER_OUT: "Transfer bekliyor", HOUSEKEEPING: "Temizlikte", MAINTENANCE: "Bakımda", BLOCKED: "Kapatılmış" },
```

and replace it with

```js
      PENDING_TRANSFER_OUT: "Transfer bekliyor", HOUSEKEEPING: "Temizlikte", MAINTENANCE: "Bakımda",
      BLOCKED: "Kullanım dışı", RESERVED: "Rezerve" },   // G2-B3a (R4): "kapat" is Yapı's close
    // G2-B3a (D5, X1): the question before an admission into a reserved bed.
    reservedAsk: {
      title: "Rezerve yatak · {bed}", body: "Bu yatak bir hasta için rezerve edilmiş.",
      note: "Rezervasyon notu: {note}", noNote: "Rezervasyonun notu yok.",
      noteLoading: "Rezervasyon notu okunuyor…", noteFailed: "Rezervasyon notu okunamadı: {reason}",
      confirm: "Yine de bu yatağa kabul et",
    },
```

az — find

```js
      PENDING_TRANSFER_OUT: "Köçürmə gözləyir", HOUSEKEEPING: "Təmizlikdədir", MAINTENANCE: "Təmirdədir", BLOCKED: "Bağlanıb" },
```

and replace it with

```js
      PENDING_TRANSFER_OUT: "Köçürmə gözləyir", HOUSEKEEPING: "Təmizlikdədir", MAINTENANCE: "Təmirdədir",
      BLOCKED: "İstifadədən kənar", RESERVED: "Rezervdədir" },
    reservedAsk: {
      title: "Rezerv edilmiş çarpayı · {bed}", body: "Bu çarpayı bir xəstə üçün rezerv edilib.",
      note: "Rezerv qeydi: {note}", noNote: "Rezervin qeydi yoxdur.",
      noteLoading: "Rezerv qeydi oxunur…", noteFailed: "Rezerv qeydi oxunmadı: {reason}",
      confirm: "Yenə də bu çarpayıya qəbul et",
    },
```

ru — find

```js
      PENDING_TRANSFER_OUT: "Ожидает перевода", HOUSEKEEPING: "На уборке", MAINTENANCE: "На обслуживании", BLOCKED: "Заблокирована" },
```

and replace it with

```js
      PENDING_TRANSFER_OUT: "Ожидает перевода", HOUSEKEEPING: "На уборке", MAINTENANCE: "На обслуживании",
      BLOCKED: "Не используется", RESERVED: "Зарезервирована" },
    reservedAsk: {
      title: "Зарезервированная койка · {bed}", body: "Эта койка зарезервирована для пациента.",
      note: "Заметка резерва: {note}", noNote: "У резерва нет заметки.",
      noteLoading: "Заметка резерва загружается…", noteFailed: "Не удалось прочитать заметку резерва: {reason}",
      confirm: "Всё равно принять на эту койку",
    },
```

en — find

```js
      PENDING_TRANSFER_OUT: "Awaiting transfer", HOUSEKEEPING: "Being cleaned", MAINTENANCE: "In maintenance", BLOCKED: "Blocked" },
```

and replace it with

```js
      PENDING_TRANSFER_OUT: "Awaiting transfer", HOUSEKEEPING: "Being cleaned", MAINTENANCE: "In maintenance",
      BLOCKED: "Out of service", RESERVED: "Reserved" },
    reservedAsk: {
      title: "Reserved bed · {bed}", body: "This bed is reserved for a patient.",
      note: "Reservation note: {note}", noNote: "The reservation has no note.",
      noteLoading: "Reading the reservation note…", noteFailed: "The reservation note could not be read: {reason}",
      confirm: "Admit to this bed all the same",
    },
```

**The code's words** — in each language's `err` block, after its `bedNotAvailable` line, add one line:

| Language | Line to add after `bedNotAvailable: …,` |
|---|---|
| tr | `      bedReserved: "Bu yatak rezerve edilmiş: kabul için rezervasyonu onaylayın.",` |
| az | `      bedReserved: "Bu çarpayı rezerv edilib: qəbul üçün rezervi təsdiqləyin.",` |
| ru | `      bedReserved: "Эта койка зарезервирована: подтвердите резерв для приёма.",` |
| en | `      bedReserved: "This bed is reserved: confirm the reservation to admit.",` |

In `dashboard/src/live/i18n/strings.test.js`, replace the comment on the line

```js
  "kabul.f.name", "kabul.miss.name", // Ad soyad — as admin.fieldFullName (the prototype's AZ dictionary)
```

so that the line reads

```js
  "kabul.f.name", "kabul.miss.name", // Soyad ad — the ward writes the surname first (G2-B3a, R9)
```

- [ ] **Step 4: The permission's words and its two mirrors**

In `dashboard/src/live/i18n/strings/perms.js`, replace each language's `beds` line:

| Language | Find | Replace with |
|---|---|---|
| tr | `    beds: { release: "Temizliği biten yatağı yeniden boş olarak işaretler (temizlik → boş), kendi birimlerinde" },` | `    beds: { release: "Temizliği biten yatağı yeniden boş olarak işaretler (temizlik → boş), kendi birimlerinde",`<br>`      manage_state: "Boş bir yatağı beklenen bir hasta için rezerve eder ya da kullanım dışı bırakır ve bunları geri alır — kendi birimlerinde, Doluluk ekranında" },` |
| az | `    beds: { release: "Təmizlənmiş çarpayını yenidən boş kimi qeyd edir (təmizlik → boş), öz şöbələrində" },` | `    beds: { release: "Təmizlənmiş çarpayını yenidən boş kimi qeyd edir (təmizlik → boş), öz şöbələrində",`<br>`      manage_state: "Boş çarpayını gözlənilən xəstə üçün rezerv edir və ya istifadədən çıxarır və bunları geri qaytarır — öz şöbələrində, Doluluq ekranında" },` |
| ru | `    beds: { release: "Отмечает убранную койку снова свободной (уборка → свободна) в своих отделениях" },` | `    beds: { release: "Отмечает убранную койку снова свободной (уборка → свободна) в своих отделениях",`<br>`      manage_state: "Резервирует свободную койку для ожидаемого пациента или выводит её из использования и отменяет это — в своих отделениях, на экране «Занятость коек»" },` |
| en | `    beds: { release: "Mark a cleaned bed free again (housekeeping → available), in their own units" },` | `    beds: { release: "Mark a cleaned bed free again (housekeeping → available), in their own units",`<br>`      manage_state: "Reserve a free bed for an expected patient or take it out of service, and undo either — in their own units, on the Occupancy screen" },` |

(`<br>` marks the line break: each replacement is two lines.)

In `dashboard/src/live/screens/admin/catalogue.js`, replace

```js
  // G2-ESLEME — a monitor bound to a bed on the Monitörler screen (spec D2)
  "devices.map_beds",
]);
```

with

```js
  // G2-ESLEME — a monitor bound to a bed on the Monitörler screen (spec D2)
  "devices.map_beds",

  // G2-B3a — a bed reserved or taken out of service on the Doluluk screen (spec D4)
  "beds.manage_state",
]);
```

In `dashboard/src/live/screens/admin/admin.testutil.js`, after the `"devices.map_beds": …` entry of `PERMISSION_TEXTS`, add:

```js

  // G2-B3a
  "beds.manage_state": "Reserve a free bed for an expected patient or take it out of service, and undo either — in one's own units, on the Doluluk screen",
```

The text is the backend's description, joined into one string. `admin.testutil.test.js` compares the two character for character.

- [ ] **Step 5: The code and the bed states**

In `dashboard/src/live/apiErrors.js`, after the line `  ["no_protocol", "protokol.err.noProtocol"],`, add:

```js

  // G2-B3a — Doluluk (spec D5). `bed_reserved` opens the reserved-bed question in the Kabul form
  // (ReservedAsk.jsx); its sentence is said only where a screen shows the refusal itself.
  ["bed_reserved", "kabul.err.bedReserved"],
```

In `dashboard/src/live/data/structure.js`:

1. Replace

```js
/** Can an admission take this bed? Open, and AVAILABLE. */
export const admissible = (bed) => Boolean(bed?.open) && bed.state === "AVAILABLE";
```

with

```js
/** Can an admission take this bed? Open, and AVAILABLE — or RESERVED, which the form asks about
 *  first (G2-B3a, D5): the server takes it only with `confirm_reserved`. */
export const admissible = (bed) => Boolean(bed?.open) && (bed.state === "AVAILABLE" || bed.state === "RESERVED");
```

2. In `unavailableKey`, replace

```js
  if (bed.state === "AVAILABLE") return null;
```

with

```js
  if (bed.state === "AVAILABLE" || bed.state === "RESERVED") return null;
```

3. In `BED_STATE_KEYS`, after `BLOCKED: "kabul.state.BLOCKED",`, add:

```js
  RESERVED: "kabul.state.RESERVED",   // G2-B3a
```

- [ ] **Step 6: Run the guards and every string test, and see them green**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/screens/admin src/live/i18n src/live/data src/liveAuth.test.js 2>&1 | tail -8
```

Expected: all passed.

If `strings.test.js` reports an `az` text equal to `tr` in `doluluk` (for example `navShort`), change the `az` wording; do not list it. The one reviewed pair is `kabul.f.name` / `kabul.miss.name`, already listed.

The admission-form tests that still look for «Ad soyad» are Task 13's; they are expected to fail until then.

- [ ] **Step 7: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" dashboard/src/live/i18n/strings/doluluk.js
for f in dashboard/src/live/i18n/strings/doluluk.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/apiErrors.js dashboard/src/live/data/structure.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/i18n/strings/doluluk.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/apiErrors.js dashboard/src/live/data/structure.js
git commit -m "feat(dashboard): the Doluluk words in four languages; BLOCKED reads «out of service», RESERVED is a state, the name box reads «Soyad ad» (G2-B3a, R4, R9, D5)" -m "beds.manage_state and bed_reserved reach their mirrors; a reserved bed is admissible (the form asks first). Red: apiErrors.test (bed_reserved unmapped), catalogue/admin.testutil tests (beds.manage_state missing)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: What the screen counts and offers — `occupancy.js` (spec §3, R3, X10)

**Files:**
- Create: `dashboard/src/live/screens/doluluk/occupancy.js`
- Create: `dashboard/src/live/screens/doluluk/occupancy.test.js`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/doluluk/occupancy.test.js`:

```js
// What the Doluluk screen counts, offers and says about time (G2-B3a, spec §3, R3, X10). Pure.
import { describe, it, expect } from "vitest";
import { structure } from "../kabul/kabul.testutil.js";
import { REASONS, actionsFor, sinceKey, unitCounts, usable, withOpen } from "./occupancy.js";

const rea = () => structure().sites[0].units[0];
const open = (state) => ({ state, open: true });
const CHARGE = ["admissions.view", "admissions.admit", "beds.release", "beds.manage_state"];
const NURSE = ["admissions.view", "admissions.admit", "beds.release"];
const MIN = 60_000;

describe("occupancy", () => {
  it("counts a unit's beds: occupied of usable, and each state apart; a closed bed counts nowhere", () => {
    // Reanimasiya: 1 free, 2 occupied, 3 cleaning, 4 free but CLOSED, 5 free.
    expect(unitCounts(rea())).toEqual({ occupied: 1, usable: 4, free: 2, cleaning: 1, reserved: 0, outOfService: 0, maintenance: 0 });
  });

  it("counts out of service and maintenance as not usable, and a reserved bed as usable", () => {
    const unit = rea();
    unit.rooms[0].beds[0].state = "BLOCKED";
    unit.rooms[0].beds[2].state = "MAINTENANCE";
    unit.rooms[1].beds[0].state = "RESERVED";
    expect(unitCounts(unit)).toEqual({ occupied: 1, usable: 2, free: 0, cleaning: 0, reserved: 1, outOfService: 1, maintenance: 1 });
  });

  it("counts both pending states as occupied: the patient has not left yet", () => {
    const unit = rea();
    unit.rooms[0].beds[0].state = "PENDING_DISCHARGE";
    unit.rooms[1].beds[0].state = "PENDING_TRANSFER_OUT";
    expect(unitCounts(unit).occupied).toBe(3);
  });

  it("marks a bed open only when it, its room and its unit are", () => {
    const unit = rea();
    expect(withOpen(unit, unit.rooms[0], unit.rooms[0].beds[3]).open).toBe(false);       // bed 4 closed
    expect(withOpen({ ...unit, is_active: false }, unit.rooms[0], unit.rooms[0].beds[0]).open).toBe(false);
    expect(usable(open("BLOCKED"))).toBe(false);
    expect(usable({ state: "AVAILABLE", open: false })).toBe(false);
  });

  it("offers each move to the right that makes it, and nothing on a closed bed", () => {
    expect(actionsFor(open("AVAILABLE"), CHARGE)).toEqual(["admit", "reserve", "outOfService"]);
    expect(actionsFor(open("AVAILABLE"), NURSE)).toEqual(["admit"]);
    expect(actionsFor(open("RESERVED"), CHARGE)).toEqual(["admit", "unreserve"]);              // X10
    expect(actionsFor(open("RESERVED"), ["beds.manage_state"])).toEqual(["unreserve"]);
    expect(actionsFor(open("HOUSEKEEPING"), NURSE)).toEqual(["release"]);
    expect(actionsFor(open("BLOCKED"), CHARGE)).toEqual(["returnToService"]);
    expect(actionsFor(open("MAINTENANCE"), CHARGE)).toEqual(["returnToService"]);              // R3
    expect(actionsFor(open("MAINTENANCE"), NURSE)).toEqual([]);
    expect(actionsFor(open("OCCUPIED"), CHARGE)).toEqual([]);
    expect(actionsFor({ state: "AVAILABLE", open: false }, CHARGE)).toEqual([]);
  });

  it("says how long a bed has been in its state, never negative, nothing without an instant", () => {
    const now = Date.UTC(2026, 10, 9, 12, 0, 0);
    expect(sinceKey(null, now)).toBeNull();
    expect(sinceKey(now + 5 * MIN, now)).toEqual({ key: "doluluk.since.now", vars: {} });       // a PC ahead
    expect(sinceKey(now - 30_000, now)).toEqual({ key: "doluluk.since.now", vars: {} });
    expect(sinceKey(now - 25 * MIN, now)).toEqual({ key: "doluluk.since.min", vars: { n: 25 } });
    expect(sinceKey(now - 185 * MIN, now)).toEqual({ key: "doluluk.since.hour", vars: { h: 3, m: 5 } });
    expect(sinceKey(now - 50 * 60 * MIN, now)).toEqual({ key: "doluluk.since.day", vars: { n: 2 } });
  });

  it("offers the four reasons in the server's order", () => {
    expect(REASONS).toEqual(["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]);
  });
});
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/doluluk/occupancy.test.js 2>&1 | tail -6
```

Expected: the file fails to load — `Failed to resolve import "./occupancy.js"`.

- [ ] **Step 3: Write `occupancy.js`**

Create `dashboard/src/live/screens/doluluk/occupancy.js`:

```js
// src/live/screens/doluluk/occupancy.js — what the Doluluk screen counts, offers and says about
// time (Group 2 · B3a, spec §3). Pure: no React, no request.

/** The out-of-service reasons, in the order the dialog offers them (tenant/models.py BedStateReason). */
export const REASONS = Object.freeze(["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]);

/** A bed with `open`: it, its room and its unit are all open (closed wins over any state). */
export const withOpen = (unit, room, bed) => ({
  ...bed, open: unit.is_active !== false && room.is_active !== false && bed.is_active !== false,
});

/** A bed the ward can count on (spec §3, the "y" of "x / y dolu"): open, and neither out of
 *  service nor in maintenance. A reserved bed is usable — it waits for its patient. */
export const usable = (bed) => Boolean(bed?.open) && bed.state !== "BLOCKED" && bed.state !== "MAINTENANCE";

/** The unit header's numbers. `occupied` is every bed a patient is in: OCCUPIED and the two
 *  pending states, whose patient has not left yet. A closed bed counts nowhere. */
export function unitCounts(unit) {
  const out = { occupied: 0, usable: 0, free: 0, cleaning: 0, reserved: 0, outOfService: 0, maintenance: 0 };
  for (const room of unit.rooms ?? []) {
    for (const raw of room.beds ?? []) {
      const bed = withOpen(unit, room, raw);
      if (!bed.open) continue;
      if (usable(bed)) out.usable += 1;
      if (bed.state === "AVAILABLE") out.free += 1;
      else if (bed.state === "HOUSEKEEPING") out.cleaning += 1;
      else if (bed.state === "RESERVED") out.reserved += 1;
      else if (bed.state === "BLOCKED") out.outOfService += 1;
      else if (bed.state === "MAINTENANCE") out.maintenance += 1;
      else out.occupied += 1;
    }
  }
  return out;
}

const can = (perms, key) => Array.isArray(perms) && perms.includes(key);

/** The moves this session may offer on a bed, in the order they are shown. The server checks
 *  each again (tenant/router.py, admission/router.py). */
export function actionsFor(bed, perms) {
  if (!bed?.open) return [];
  const admit = can(perms, "admissions.admit") ? ["admit"] : [];
  const manage = can(perms, "beds.manage_state");
  switch (bed.state) {
    case "AVAILABLE": return [...admit, ...(manage ? ["reserve", "outOfService"] : [])];
    case "RESERVED": return [...admit, ...(manage ? ["unreserve"] : [])];             // X10
    case "HOUSEKEEPING": return can(perms, "beds.release") ? ["release"] : [];
    case "BLOCKED":
    case "MAINTENANCE": return manage ? ["returnToService"] : [];                     // R3
    default: return [];
  }
}

/** How long a bed has been in its state, as an i18n key and its numbers — or null when the
 *  server gave no instant (then nothing is said rather than an invented age). Never negative: a
 *  ward PC ahead of the server says "just now" (screens/common/elapsed.js has the same rule). */
export function sinceKey(fromMs, nowMs) {
  if (!Number.isFinite(fromMs)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (minutes < 1) return { key: "doluluk.since.now", vars: {} };
  if (minutes < 60) return { key: "doluluk.since.min", vars: { n: minutes } };
  if (minutes < 48 * 60) return { key: "doluluk.since.hour", vars: { h: Math.floor(minutes / 60), m: minutes % 60 } };
  return { key: "doluluk.since.day", vars: { n: Math.floor(minutes / 1440) } };
}
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `7 passed`.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in dashboard/src/live/screens/doluluk/occupancy.js dashboard/src/live/screens/doluluk/occupancy.test.js; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/doluluk/occupancy.js dashboard/src/live/screens/doluluk/occupancy.test.js
git commit -m "feat(dashboard): what Doluluk counts, offers and says about time (G2-B3a, §3, R3, X10)" -m "Red: the module did not exist." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The reserve / out-of-service dialog (spec §3, D4, X3)

**Files:**
- Create: `dashboard/src/live/screens/doluluk/BedStateDialog.jsx`
- Create: `dashboard/src/live/screens/doluluk/BedStateDialog.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/doluluk/BedStateDialog.test.jsx`:

```jsx
// The reserve and out-of-service dialog (G2-B3a, spec §3, D4, X3): a note for whom and why,
// trimmed and at most 200 characters; out of service needs a reason, and «Digər» a note too.
// The server checks again; a refusal goes on the toast, named after the bed.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { BED, CHARGE, mountKabul, settle, structure, toasts } from "../kabul/kabul.testutil.js";
import { BedStateDialog } from "./BedStateDialog.jsx";

const SUBJECT = "1 · Otaq 1 · Reanimasiya";
const bed = () => structure().sites[0].units[0].rooms[0].beds[0];
const PERMS = [...CHARGE, "beds.manage_state"];
const dialog = () => screen.getByRole("dialog");
const submit = (name) => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name })); });

async function open(mode, setup) {
  const done = vi.fn(async () => {});
  const refused = vi.fn();
  const mounted = await mountKabul(
    <BedStateDialog mode={mode} bed={bed()} subject={SUBJECT} onClose={() => {}} onDone={done} onRefused={refused} />,
    { perms: PERMS, setup });
  return { ...mounted, done, refused };
}

describe("BedStateDialog", () => {
  it("reserves with the trimmed note, says so, and hands back", async () => {
    const { api, done } = await open("reserve", (a) => a.reserveBed.mockResolvedValue({ state: "RESERVED" }));
    expect(dialog().getAttribute("aria-label") ?? screen.getByRole("heading", { name: `Rezerv et · ${SUBJECT}` })).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/^Qeyd/), { target: { value: "  Sentetik planlı kabul  " } });
    await submit("Rezerv et");
    await settle();
    expect(api.reserveBed).toHaveBeenCalledWith(BED(1), { note: "Sentetik planlı kabul" });
    expect(toasts().getByText(`${SUBJECT} · Rezerv edildi.`)).toBeTruthy();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("sends no note as null, and holds a note to 200 characters", async () => {
    const { api } = await open("reserve", (a) => a.reserveBed.mockResolvedValue({}));
    expect(within(dialog()).getByLabelText(/^Qeyd/).getAttribute("maxlength")).toBe("200");
    await submit("Rezerv et");
    await settle();
    expect(api.reserveBed).toHaveBeenCalledWith(BED(1), { note: null });
  });

  it("asks for a reason, and a note for «Digər», before it sends anything", async () => {
    const { api } = await open("outOfService", (a) => a.bedOutOfService.mockResolvedValue({}));
    await submit("İstifadədən çıxar");
    expect(within(dialog()).getByText("Səbəb seçin.")).toBeTruthy();
    fireEvent.click(within(dialog()).getByLabelText("Digər"));
    await submit("İstifadədən çıxar");
    expect(within(dialog()).getByText("«Digər» üçün qeyd yazın.")).toBeTruthy();
    expect(api.bedOutOfService).not.toHaveBeenCalled();
    fireEvent.change(within(dialog()).getByLabelText(/^Qeyd/), { target: { value: "Sentetik arıza" } });
    await submit("İstifadədən çıxar");
    await settle();
    expect(api.bedOutOfService).toHaveBeenCalledWith(BED(1), { reason: "OTHER", note: "Sentetik arıza" });
  });

  it("takes a bed out of service with a reason alone", async () => {
    const { api } = await open("outOfService", (a) => a.bedOutOfService.mockResolvedValue({}));
    fireEvent.click(within(dialog()).getByLabelText("Nasazlıq"));
    await submit("İstifadədən çıxar");
    await settle();
    expect(api.bedOutOfService).toHaveBeenCalledWith(BED(1), { reason: "FAULT", note: null });
  });

  it("says a refusal on the toast, named after the bed, and tells the screen", async () => {
    const { refused, done } = await open("reserve", (a) => a.reserveBed.mockRejectedValue(
      refusal(409, "Only a free bed can be reserved (it is OCCUPIED).", { apiCode: "invalid_transition" })));
    await submit("Rezerv et");
    await settle();
    expect(toasts().getByText(new RegExp(`^${SUBJECT}: `))).toBeTruthy();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });
});
```

The first test's title check accepts either form, because `Modal` names the dialog by its title. If that line proves awkward, use `screen.getByRole("dialog", { name: \`Rezerv et · ${SUBJECT}\` })`, which is what `Modal`'s `aria-labelledby` gives.

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/doluluk/BedStateDialog.test.jsx 2>&1 | tail -6
```

Expected: the file fails to load — `Failed to resolve import "./BedStateDialog.jsx"`.

- [ ] **Step 3: Write the dialog**

Create `dashboard/src/live/screens/doluluk/BedStateDialog.jsx`:

```jsx
// src/live/screens/doluluk/BedStateDialog.jsx — «Rezerv et» and «İstifadədən çıxar» (Group 2 ·
// B3a, spec §3, D4).
// - Reserve: the note says for whom and why. It is at most 200 characters, and the server keeps it
//   encrypted (R8).
// - Out of service: a reason is required, and «Digər» needs a note as well (X3).
// The server checks all of it again. A refusal is said on the toast, named after the bed, and
// the screen reads its beds again (`onRefused`).
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Button, Field, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { REASONS } from "./occupancy.js";

export const NOTE_MAX = 200;

/** `mode`: "reserve" | "outOfService"; `bed`: the structure's bed; `subject`: "label · room · unit".
 *  `onDone` is awaited (the screen re-reads before the dialog's buttons let go); `onRefused` is not. */
export function BedStateDialog({ mode, bed, subject, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const out = mode === "outOfService";
  const text = note.trim();
  const errors = {
    reason: out && !reason ? t("doluluk.dialog.reasonNeeded") : null,
    note: out && reason === "OTHER" && !text ? t("doluluk.dialog.noteNeeded") : null,
  };
  const formId = `doluluk-${mode}`;
  const reasonErrorId = `${formId}-reason-error`;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (errors.reason || errors.note) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      await store.track(() => (out
        ? store.api.bedOutOfService(bed.id, { reason, note: text || null })
        : store.api.reserveBed(bed.id, { note: text || null })));
      toast(doneFor(t, subject, t(`doluluk.done.${mode}`)));
      await onDone();
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      onRefused?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t(out ? "doluluk.dialog.outTitle" : "doluluk.dialog.reserveTitle", { bed: subject })}
      onClose={onClose} busy={busy}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" icon="ok" busy={busy}>
            {t(out ? "doluluk.dialog.submitOut" : "doluluk.dialog.submitReserve")}
          </Button>
        </>
      )}>
      <form id={formId} noValidate onSubmit={submit}>
        {out ? (
          <fieldset className="mb-2.5 min-w-0 border-0 p-0"
            aria-describedby={tried && errors.reason ? reasonErrorId : undefined}>
            <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("doluluk.dialog.reason")}</legend>
            <div className="flex flex-wrap gap-3">
              {REASONS.map((value) => (
                <label key={value} className="inline-flex items-center gap-1.5 text-13.5">
                  <input type="radio" name={`${formId}-reason`} value={value} checked={reason === value}
                    disabled={busy} onChange={() => setReason(value)} className={FOCUS_RING} />
                  {t(`doluluk.reason.${value}`)}
                </label>
              ))}
            </div>
            {tried && errors.reason
              ? <p id={reasonErrorId} role="alert" className="m-0 mt-1 text-12.5 text-crit-ink">{errors.reason}</p>
              : null}
          </fieldset>
        ) : null}
        <Field label={t("doluluk.dialog.note")} hint={t(out ? "doluluk.dialog.noteHint" : "doluluk.dialog.reserveHint")}
          error={tried ? errors.note ?? undefined : undefined}>
          <textarea value={note} maxLength={NOTE_MAX} rows={3} readOnly={busy} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none focus:border-pri" />
        </Field>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `5 passed`.

`Field` labels its child the way `DischargeDialog`'s note is labelled. If `getByLabelText(/^Qeyd/)` does not find the textarea, read `ui/Field.jsx` and give the textarea the id `Field` expects, the same way `DischargeDialog.jsx` does. Name the change in the report.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in dashboard/src/live/screens/doluluk/BedStateDialog.jsx dashboard/src/live/screens/doluluk/BedStateDialog.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/doluluk/BedStateDialog.jsx dashboard/src/live/screens/doluluk/BedStateDialog.test.jsx
git commit -m "feat(dashboard): the reserve and out-of-service dialog — a trimmed note of at most 200, a reason, a note for «Digər» (G2-B3a, D4, X3)" -m "Red: the component did not exist." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The Doluluk screen and its route; Kabul keeps two tabs (spec §3, R1, X7, X10)

**Files:**
- Create: `dashboard/src/live/screens/doluluk/DolulukScreen.jsx`
- Create: `dashboard/src/live/screens/doluluk/DolulukScreen.test.jsx`
- Modify: `dashboard/src/live/shell/routes.js`
- Modify: `dashboard/src/live/screens/kabul/KabulScreen.jsx`
- Modify: `dashboard/src/live/screens/kabul/KabulScreen.test.jsx`
- Delete: `dashboard/src/live/screens/kabul/BedsTab.jsx`, `dashboard/src/live/screens/kabul/BedsTab.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/live/screens/doluluk/DolulukScreen.test.jsx`:

```jsx
// The Doluluk screen (G2-B3a, spec §3, R1, X7, X10).
// - It shows the caller's beds by unit and room: state in words, for how long, and the counts.
// - The short name and the notes come from their own read; when that read fails, the beds stay
//   and the names go.
// - Each move is offered to the right that makes it. One move is out at a time, and every move is
//   followed by a re-read.
// - «Bu çarpayıya xəstə qəbul et» puts the bed in the session's admission form and opens Kabul.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { ROUTES, canReach } from "../../shell/routes.js";
import { admitDraftOf } from "../kabul/admitDraft.js";
import { BED, CHARGE, DOCTOR, NURSE, UUID_TEXT, mountKabul, settle, structure, toasts } from "../kabul/kabul.testutil.js";
import { DolulukScreen } from "./DolulukScreen.jsx";

const MANAGER = [...CHARGE, "beds.manage_state"];
const ward = (change) => { const s = structure(); change?.(s); return s; };
const rea = (s) => s.sites[0].units[0];
/** The bed `label` inside the room landmark `region`, as its tile. */
const tile = (region, label) => within(within(screen.getByRole("region", { name: region })).getByText(label, { selector: "b" }).closest("li"));
const press = (name) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
const names = (beds) => ({ beds });

async function mountScreen(perms, setup) {
  return mountKabul(<DolulukScreen />, { perms, setup: (a) => { a.occupancy.mockResolvedValue(names([])); setup?.(a); } });
}

afterEach(() => { window.location.hash = ""; });

describe("DolulukScreen", () => {
  it("is a route for whoever reads, admits, confirms a discharge or releases a bed", () => {
    const route = ROUTES.find((r) => r.id === "doluluk");
    expect(route.path).toBe("/doluluk");
    for (const perms of [["admissions.view"], ["admissions.admit"], ["admissions.discharge.confirm"], ["beds.release"]]) {
      expect(canReach(route, perms), perms[0]).toBe(true);
    }
    expect(canReach(route, ["users.manage"])).toBe(false);
    expect(canReach(route, ["devices.map_beds"])).toBe(false);
  });

  it("shows every bed of the caller's units with its state in words, and no UUID", async () => {
    await mountScreen(NURSE);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Çarpayı doluluğu"]);
    for (const [region, label, state] of [
      ["Reanimasiya · Otaq 1", "1", "Boş"], ["Reanimasiya · Otaq 1", "2", "Dolu"],
      ["Reanimasiya · Otaq 1", "3", "Təmizlikdədir"], ["Reanimasiya · Otaq 1", "4", "Bağlıdır"],
      ["Reanimasiya · Otaq 2", "5", "Boş"], ["Neonatal · N-1", "N1", "Bağlıdır"],
    ]) {
      expect(tile(region, label).getByText(state)).toBeTruthy();
    }
    expect(document.body.innerHTML).not.toMatch(UUID_TEXT);
  });

  it("heads each unit with occupied of usable and the counts that are not zero", async () => {
    await mountScreen(NURSE);
    const box = screen.getByRole("region", { name: "Reanimasiya · Otaq 1" }).closest("section").parentElement;
    expect(within(box).getByText("1 / 4 doludur")).toBeTruthy();
    expect(within(box).getByText("boş: 2")).toBeTruthy();
    expect(within(box).getByText("təmizlikdə: 1")).toBeTruthy();
    expect(within(box).queryByText(/rezervdə/)).toBeNull();
  });

  it("names the patient in an occupied bed by the short name only, and shows a reservation's note", async () => {
    await mountScreen(NURSE, (a) => {
      a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds[0].state = "RESERVED"; }));
      a.occupancy.mockResolvedValue(names([
        { bed_id: BED(2), occupant_short: "Əli M.", state_reason: null, state_note: null },
        { bed_id: BED(5), occupant_short: null, state_reason: null, state_note: "Sentetik planlı kabul" },
      ]));
    });
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Əli M.")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 2", "5").getByText("Rezervdədir")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 2", "5").getByText("Sentetik planlı kabul")).toBeTruthy();
  });

  it("shows an out-of-service bed's reason, and how long a bed has been in its state", async () => {
    const since = new Date(Date.now() - 25 * 60_000).toISOString();
    await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => {
        rea(s).rooms[0].beds[0].state = "BLOCKED";
        rea(s).rooms[0].beds[2].state_since = since;
      }));
      a.occupancy.mockResolvedValue(names([{ bed_id: BED(1), occupant_short: null, state_reason: "FAULT", state_note: null }]));
    });
    expect(tile("Reanimasiya · Otaq 1", "1").getByText("İstifadədən kənar")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "1").getByText("Nasazlıq")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "3").getByText("25 dəq")).toBeTruthy();
    expect(screen.getByRole("button", { name: "İstifadəyə ver: 1 · Otaq 1 · Reanimasiya" })).toBeTruthy();
  });

  it("keeps the beds and drops every name when the names cannot be read", async () => {
    await mountScreen(NURSE, (a) => a.occupancy.mockRejectedValue(refusal(503, "Service unavailable")));
    expect(screen.getByText(/^Xəstə adları və qeydlər oxunmadı: /)).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Dolu")).toBeTruthy();
  });

  it("offers each move to its right only", async () => {
    await mountScreen(NURSE);
    expect(screen.getByRole("button", { name: "Bu çarpayıya xəstə qəbul et: 1 · Otaq 1 · Reanimasiya" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Rezerv et:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Təmizlik bitdi · boş: 3 · Otaq 1 · Reanimasiya" })).toBeTruthy();
    act(() => { /* unmount below */ });
  });

  it("reserves through the dialog and reads the beds and the names again", async () => {
    const { api } = await mountScreen(MANAGER, (a) => a.reserveBed.mockResolvedValue({ state: "RESERVED" }));
    const before = [api.structure.mock.calls.length, api.occupancy.mock.calls.length];
    await press("Rezerv et: 1 · Otaq 1 · Reanimasiya");
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(/^Qeyd/), { target: { value: "Sentetik planlı kabul" } });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rezerv et" })); });
    await settle();
    expect(api.reserveBed).toHaveBeenCalledWith(BED(1), { note: "Sentetik planlı kabul" });
    expect(api.structure.mock.calls.length).toBeGreaterThan(before[0]);
    expect(api.occupancy.mock.calls.length).toBeGreaterThan(before[1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels a reservation, releases a cleaned bed and returns one to service, each by its route", async () => {
    const { api } = await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => {
        rea(s).rooms[1].beds[0].state = "RESERVED";
        rea(s).rooms[0].beds[0].state = "MAINTENANCE";
      }));
      for (const call of ["unreserveBed", "releaseBed", "bedReturnToService"]) a[call].mockResolvedValue({});
    });
    await press("Rezervi ləğv et: 5 · Otaq 2 · Reanimasiya");
    await settle();
    await press("Təmizlik bitdi · boş: 3 · Otaq 1 · Reanimasiya");
    await settle();
    await press("İstifadəyə ver: 1 · Otaq 1 · Reanimasiya");
    await settle();
    expect(api.unreserveBed).toHaveBeenCalledWith(BED(5));
    expect(api.releaseBed).toHaveBeenCalledWith(BED(3));
    expect(api.bedReturnToService).toHaveBeenCalledWith(BED(1));
    expect(toasts().getByText("5 · Otaq 2 · Reanimasiya · Rezerv ləğv edildi.")).toBeTruthy();
  });

  it("says a refusal on the toast, named after the bed, and reads the beds again", async () => {
    const { api } = await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds[0].state = "RESERVED"; }));
      a.unreserveBed.mockRejectedValue(refusal(409, "Only a reserved bed can be unreserved (it is OCCUPIED).", { apiCode: "invalid_transition" }));
    });
    const reads = api.structure.mock.calls.length;
    await press("Rezervi ləğv et: 5 · Otaq 2 · Reanimasiya");
    await settle();
    expect(toasts().getByText(/^5 · Otaq 2 · Reanimasiya: /)).toBeTruthy();
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("puts the bed in the session's admission form and opens Kabul (X10)", async () => {
    const { store } = await mountScreen(NURSE);
    await press("Bu çarpayıya xəstə qəbul et: 5 · Otaq 2 · Reanimasiya");
    const form = admitDraftOf(store).get().form;
    expect([form.bedId, form.bedLabel]).toEqual([BED(5), "5 · Otaq 2 · Reanimasiya"]);
    expect(window.location.hash).toBe("#/kabul");
  });

  it("leaves a form with a send waiting for an answer alone, and says so", async () => {
    const { store } = await mountScreen(NURSE);
    admitDraftOf(store).update({ unanswered: [{ bedId: BED(1), bed: "1 · Otaq 1 · Reanimasiya", name: "Sentetik Hasta", checked: false, requestId: "r-1" }] });
    await press("Bu çarpayıya xəstə qəbul et: 5 · Otaq 2 · Reanimasiya");
    expect(admitDraftOf(store).get().form.bedId).not.toBe(BED(5));
    expect(toasts().getByText("Qəbul formasında cavab gözləyən göndəriş var; çarpayı seçimi dəyişdirilmədi.")).toBeTruthy();
    expect(window.location.hash).not.toBe("#/kabul");
  });

  it("chooses one unit or all of them", async () => {
    await mountScreen(DOCTOR);
    fireEvent.click(within(screen.getByRole("group", { name: "Şöbə" })).getByRole("button", { name: "Neonatal" }));
    expect(screen.queryByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeNull();
    expect(screen.getByRole("region", { name: "Neonatal · N-1" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Şöbə" })).getByRole("button", { name: "Hamısı" }));
    expect(screen.getByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeTruthy();
  });
});
```

Delete the empty `act(() => { /* unmount below */ });` line in «offers each move to its right only» if your linter flags it; it does nothing.

In `dashboard/src/live/screens/kabul/KabulScreen.test.jsx`:

1. Replace

```js
    for (const perms of [["admissions.view"], ["admissions.admit"], ["admissions.discharge.confirm"], ["beds.release"]]) {
      expect(canReach(route, perms), perms[0]).toBe(true);
    }
    expect(canReach(route, ["board.view", "alerts.ack"])).toBe(false);
```

with

```js
    for (const perms of [["admissions.view"], ["admissions.admit"], ["admissions.discharge.confirm"]]) {
      expect(canReach(route, perms), perms[0]).toBe(true);
    }
    expect(canReach(route, ["board.view", "alerts.ack"])).toBe(false);
    // G2-B3a (X7): the beds moved to Doluluk; a session that only releases beds lands there.
    expect(canReach(route, ["beds.release"])).toBe(false);
```

2. Replace

```js
    expect(KABUL_TABS.map((tab) => tab.id)).toEqual(["admit", "discharge", "beds"]);
    expect(kabulTabs(["beds.release"]).map((tab) => tab.id)).toEqual(["beds"]);
```

with

```js
    expect(KABUL_TABS.map((tab) => tab.id)).toEqual(["admit", "discharge"]);
    expect(kabulTabs(["beds.release"]).map((tab) => tab.id)).toEqual([]);
```

3. Replace every `["Qəbul", "Evə yazılma", "Çarpayılar"]` with `["Qəbul", "Evə yazılma"]`.

4. In «opens on Kabul for a nurse…», replace the three `"Çarpayılar"` tab names in the click and the two expectations after it with `"Evə yazılma"`.

5. Update the file's first comment line: "the three tabs" → "the two tabs".

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/doluluk/DolulukScreen.test.jsx src/live/screens/kabul/KabulScreen.test.jsx 2>&1 | tail -8
```

Expected:
- `DolulukScreen.test.jsx` fails to load — `Failed to resolve import "./DolulukScreen.jsx"`;
- `KabulScreen.test.jsx` fails on the tabs (three, not two) and on `beds.release` still opening the route.

- [ ] **Step 3: Write the screen**

Create `dashboard/src/live/screens/doluluk/DolulukScreen.jsx`:

```jsx
// src/live/screens/doluluk/DolulukScreen.jsx — «Doluluk» (Group 2 · B3a, spec §3): the caller's
// beds by unit and room. Each bed shows:
// - its state, as colour and words, and for how long;
// - the short name of the patient in an occupied bed;
// - a reserved or out-of-service bed's note and reason.
// It also offers the moves between the states, each gated by its right; the server checks all
// again. It replaces Hasta Kabul's «Yataklar» tab (X7).
//
// Names and notes come from GET /tenant/occupancy (R1), never from the structure. A failed read
// leaves the beds on screen without them and says so: a stale name on a bed whose patient has
// moved would be worse than none.
//
// One move is out at a time (the old tab's rule, A-17): while it is, every other bed's buttons
// are held and say why. Every move, landed or refused, is followed by a re-read of the beds and
// the names.
import React, { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { BED_STATE_KEYS, normId } from "../../data/structure.js";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Seg, Tag, useToast } from "../../ui/index.js";
import { useNow } from "../common/useNow.js";
import { msOf } from "../common/elapsed.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { useAdmitDraft } from "../kabul/admitDraft.js";
import { BedStateDialog } from "./BedStateDialog.jsx";
import { actionsFor, sinceKey, unitCounts, withOpen } from "./occupancy.js";

// Red is for alarms. A bed waiting for something (cleaning, a discharge, a transfer) is warned. A
// reserved, out-of-service or maintenance bed says so in words, and its tile's edge marks it.
const TONE = { HOUSEKEEPING: "warn", PENDING_DISCHARGE: "warn", PENDING_TRANSFER_OUT: "warn" };
const EDGE = { RESERVED: "border-l-4 border-l-pri", BLOCKED: "border-l-4 border-l-line2", MAINTENANCE: "border-l-4 border-l-line2" };
const ICON = { admit: "userPlus", reserve: "clock", outOfService: "x", unreserve: "x", returnToService: "ok", release: "ok" };
const COUNT_KEYS = ["free", "cleaning", "reserved", "outOfService", "maintenance"];
const NO_NAMES = new Map();

export function DolulukScreen() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, error, reload } = useStructure();
  const [, draft] = useAdmitDraft();
  const toast = useToast();
  const uid = useId();
  const now = useNow(30_000);
  const [names, setNames] = useState({ byBed: NO_NAMES, error: null });
  const [chosen, setChosen] = useState("all");
  const [working, setWorking] = useState(null);       // {id, subject} of the move that is out
  const [dialog, setDialog] = useState(null);         // {mode, bed, subject}
  const perms = user?.perms ?? [];

  const readNames = useCallback(async () => {
    try {
      const answer = await store.track(() => store.api.occupancy());
      setNames({ byBed: new Map((answer?.beds ?? []).map((b) => [normId(b.bed_id), b])), error: null });
    } catch (err) {
      setNames({ byBed: NO_NAMES, error: err });     // never a stale name on a bed that changed
    }
  }, [store]);
  const rereadAll = useCallback(() => Promise.all([reload(), readNames()]), [reload, readNames]);
  useEffect(() => { rereadAll(); }, [rereadAll]);

  const heldId = `${uid}-held`;
  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  const shown = chosen === "all" ? units : units.filter((u) => u.id === chosen);

  async function direct(bed, subject, action) {
    const call = {
      unreserve: () => store.api.unreserveBed(bed.id),
      returnToService: () => store.api.bedReturnToService(bed.id),
      release: () => store.api.releaseBed(bed.id),
    }[action];
    setWorking({ id: bed.id, subject });
    try {
      await store.track(call);
      toast(doneFor(t, subject, t(`doluluk.done.${action}`)));
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      // Held until the beds are read again: until then the tile still shows the old state, and a
      // press in that gap would repeat a move the server has already made.
      await rereadAll();
      setWorking(null);
    }
  }

  /** «Bu çarpayıya xəstə qəbul et» (X10): the session's admission form takes this bed, and the
   *  Kabul screen opens on it. A form with a send in flight, held, or waiting for an answer is
   *  not touched — its bed is the one that send went to (admitDraft.js). */
  function admitHere(unit, bed, subject) {
    let taken = false;
    draft.update((s) => {
      if (s.sending || s.held || (s.unanswered?.length ?? 0) > 0) return null;
      taken = true;
      return { form: { ...s.form, unitId: unit.id, bedId: bed.id, bedLabel: subject } };
    });
    if (!taken) {
      toast(t("doluluk.admitBusy"), "error");
      return;
    }
    window.location.hash = "#/kabul";
  }

  function press(unit, bed, subject, action) {
    if (working) return;
    if (action === "admit") admitHere(unit, bed, subject);
    else if (action === "reserve" || action === "outOfService") setDialog({ mode: action, bed, subject });
    else direct(bed, subject, action);
  }

  const saying = working ? t("doluluk.working", { bed: working.subject }) : "";
  const options = [{ value: "all", label: t("doluluk.all") }, ...units.map((u) => ({ value: u.id, label: u.name }))];

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("doluluk.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("doluluk.sub")}</p>
      </div>
      {error ? (
        <div className="grid justify-items-start gap-2">
          <Alert tone="crit">{t("doluluk.readFailed", { reason: readErrorText(t, error) })}</Alert>
          <Button size="sm" onClick={() => rereadAll()}>{t("admin.retry")}</Button>
        </div>
      ) : null}
      {names.error ? <Alert tone="warn">{t("doluluk.namesFailed", { reason: readErrorText(t, names.error) })}</Alert> : null}
      {structure === null && !error ? <p role="status" className="m-0 text-13 text-mute">{t("doluluk.loading")}</p> : null}
      {structure !== null && units.length === 0 ? <Empty icon="bed">{t("doluluk.noUnits")}</Empty> : null}
      {units.length > 1 ? <Seg label={t("doluluk.unitChooser")} options={options} value={chosen} onChange={setChosen} /> : null}
      {shown.map((unit, unitIndex) => {
        const counts = unitCounts(unit);
        return (
          <Box key={unit.id} title={unit.is_active === false ? `${unit.name} · ${t("doluluk.unitClosed")}` : unit.name} icon="building" level={2}>
            <p className="m-0 mb-2 flex flex-wrap items-center gap-2 text-13">
              <b className="font-data">{t("doluluk.occupied", { occupied: counts.occupied, usable: counts.usable })}</b>
              {COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => (
                <Tag key={key} tone={key === "cleaning" ? "warn" : "neutral"}>{t(`doluluk.counts.${key}`, { n: counts[key] })}</Tag>
              ))}
            </p>
            {(unit.rooms ?? []).length === 0 ? <p className="m-0 text-13 text-mute">{t("doluluk.noRooms")}</p> : null}
            {(unit.rooms ?? []).map((room, roomIndex) => {
              // The landmark is named "unit · room": two units may each have an "Otaq 1".
              const headingId = `${uid}-room-${unitIndex}-${roomIndex}`;
              return (
                <section key={room.id} aria-labelledby={headingId} className="mb-2.5 last:mb-0">
                  <h3 className="m-0 mb-1 flex items-center gap-2 text-12.5 font-semibold text-mute">
                    <span id={headingId}>
                      <span className="sr-only">{unit.name} · </span>
                      {room.name}{room.is_active === false ? ` · ${t("doluluk.roomClosed")}` : ""}
                    </span>
                    {room.is_isolation ? <Tag tone="warn">{t("doluluk.isolation")}</Tag> : null}
                  </h3>
                  {(room.beds ?? []).length === 0 ? <p className="m-0 text-13 text-mute">{t("doluluk.noBeds")}</p> : (
                    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 p-0">
                      {(room.beds ?? []).map((raw) => {
                        const bed = withOpen(unit, room, raw);
                        const subject = `${bed.label} · ${room.name} · ${unit.name}`;
                        const about = names.byBed.get(normId(bed.id));
                        const since = bed.open ? sinceKey(msOf(bed.state_since), now) : null;
                        const held = working !== null && working.id !== bed.id;
                        const actions = actionsFor(bed, perms);
                        const stateText = bed.open ? t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther") : t("doluluk.bedClosed");
                        return (
                          <li key={bed.id} className={`grid gap-1.5 rounded-ctl border border-line bg-card px-2.5 py-2 ${bed.open ? EDGE[bed.state] ?? "" : "opacity-70"}`}>
                            <span className="flex items-center justify-between gap-2">
                              <b className="font-data text-15">{bed.label}</b>
                              <Tag tone={bed.open ? TONE[bed.state] ?? "neutral" : "neutral"}>{stateText}</Tag>
                            </span>
                            {since ? <span className="text-12 text-mute">{t(since.key, since.vars)}</span> : null}
                            {about?.occupant_short ? <span className="text-14 font-semibold">{about.occupant_short}</span> : null}
                            {about?.state_reason ? <span className="text-12.5">{t(`doluluk.reason.${about.state_reason}`)}</span> : null}
                            {about?.state_note ? <span className="text-12.5 text-mute">{about.state_note}</span> : null}
                            {actions.length > 0 ? (
                              <span className="flex flex-wrap gap-1.5">
                                {actions.map((action) => (
                                  <Button key={action} size="sm" icon={ICON[action]} busy={working?.id === bed.id}
                                    aria-label={`${t(`doluluk.action.${action}`)}: ${subject}`}
                                    aria-disabled={held ? "true" : undefined} aria-describedby={held ? heldId : undefined}
                                    onClick={() => press(unit, bed, subject, action)}>
                                    {t(`doluluk.action.${action}`)}
                                  </Button>
                                ))}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </Box>
        );
      })}
      {working !== null ? <span id={heldId} className="sr-only">{saying}</span> : null}
      <Announce text={saying} />
      {dialog ? (
        <BedStateDialog mode={dialog.mode} bed={dialog.bed} subject={dialog.subject}
          onClose={() => setDialog(null)}
          onDone={async () => { setDialog(null); await rereadAll(); }}
          onRefused={() => { rereadAll(); }} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: The route, and Kabul without its beds tab**

In `dashboard/src/live/shell/routes.js`:

1. After the line `import { BedsideScreen } from "../screens/bedside/BedsideScreen.jsx"; // G3-01`, add a blank line and:

```js
import { DolulukScreen } from "../screens/doluluk/DolulukScreen.jsx"; // G2-B3a
```

2. In `SCREENS`, after `  olcum: BedsideScreen, // G3-01 — Yatak başı ölçüm: the bedside set by hand`, add a blank line and:

```js
  doluluk: DolulukScreen, // G2-B3a — Doluluk: the ward's beds, their states and moves
```

3. Replace the `kabul` route entry

```js
  route({ id: "kabul", path: "/kabul", icon: "userPlus", labelKey: "kabul.nav", shortKey: "kabul.navShort",
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm", "beds.release"], work: true, nav: "main" }),
```

with

```js
  route({ id: "kabul", path: "/kabul", icon: "userPlus", labelKey: "kabul.nav", shortKey: "kabul.navShort",
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm"], work: true, nav: "main" }),   // G2-B3a (X7)

  // G2-B3a — Doluluk (spec D2): for whoever reads admissions, admits, confirms a discharge or releases
  // a bed — the right to its names (GET /tenant/occupancy). After Kabul, so nobody's home moves.
  route({ id: "doluluk", path: "/doluluk", icon: "bed", labelKey: "doluluk.nav", shortKey: "doluluk.navShort",
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm", "beds.release"], work: true, nav: "main" }),
```

In `dashboard/src/live/screens/kabul/KabulScreen.jsx`:

1. In the header comment, replace `Kabul ·\n// Taburcu · Yataklar, each gated by the rights it acts with` with `Kabul ·\n// Taburcu, each gated by the rights it acts with (the beds moved to Doluluk, G2-B3a)`. Then remove `, \`beds.release\`` from the list of rights the route opens to.
2. Delete the line `import { BedsTab } from "./BedsTab.jsx";`.
3. Replace `/** The three tabs, in order:` with `/** The two tabs, in order:`, and delete the `beds` entry of `KABUL_TABS` (the line that names `BedsTab`).

Then delete the old tab and its test:

```bash
cd /c/tmp/g2b-b3a && git rm -q -- dashboard/src/live/screens/kabul/BedsTab.jsx dashboard/src/live/screens/kabul/BedsTab.test.jsx
```

In the comments of `DischargeTab.jsx`, `DischargeTab.test.jsx` and `SignOffStrip.jsx`, replace the name `BedsTab` with `DolulukScreen`. Only the comments change.

- [ ] **Step 5: Run them and see them green, then the shell's own tests**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/doluluk src/live/screens/kabul src/live/shell src/live/rawKeys.test.jsx 2>&1 | tail -8
```

Expected: all passed — `DolulukScreen.test.jsx` 13 passed.

A shell test that pins a session's rail order fails here if it lists ids. For example, `routes.test.js` or `Menu.test.jsx` for `NURSE`. Add `"doluluk"` after `"kabul"` in that list, and name each changed line in the report.

`rawKeys.test.jsx` opens every route with the whole catalogue. Its fake `occupancy` answers `undefined`, and the screen reads that as no names.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && for f in dashboard/src/live/screens/doluluk/DolulukScreen.jsx dashboard/src/live/screens/doluluk/DolulukScreen.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; done
for f in dashboard/src/live/screens/doluluk/DolulukScreen.jsx dashboard/src/live/screens/doluluk/DolulukScreen.test.jsx dashboard/src/live/shell/routes.js dashboard/src/live/screens/kabul/KabulScreen.jsx dashboard/src/live/screens/kabul/KabulScreen.test.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/doluluk/DolulukScreen.jsx dashboard/src/live/screens/doluluk/DolulukScreen.test.jsx dashboard/src/live/shell/routes.js dashboard/src/live/screens/kabul/KabulScreen.jsx dashboard/src/live/screens/kabul/KabulScreen.test.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx
git commit -m "feat(dashboard): Doluluk — the ward's beds with state, time in state, short name, note and moves; Kabul keeps Kabul and Taburcu (G2-B3a, §3, R1, X7, X10)" -m "Names come from GET /tenant/occupancy and go when it fails. One move at a time, then a re-read; «admit here» fills the session's form unless a send is in flight. BedsTab and its test are removed: their behaviour is retested here. Red: the screen did not exist; Kabul still had three tabs and opened for beds.release." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Also add any shell test file Step 5 changed to the `git add` line. `git rm` has already staged the two deletions.

---

### Task 13: The admission form and a reserved bed (spec D5, R9, X1, X2)

**Files:**
- Modify: `dashboard/src/live/screens/kabul/admitForm.js`, `admitForm.test.js`
- Modify: `dashboard/src/live/screens/kabul/BedPicker.jsx`
- Create: `dashboard/src/live/screens/kabul/ReservedAsk.jsx`
- Modify: `dashboard/src/live/screens/kabul/AdmitTab.jsx`, `AdmitTab.test.jsx`, `admitDraft.test.jsx`

- [ ] **Step 1: «Soyad ad» in the tests (R9)**

Task 9 renamed the label. In `AdmitTab.test.jsx` and `admitDraft.test.jsx`:
- replace every `/^Ad soyad/` with `/^Soyad ad/`;
- in `EVERY_MISSING`, replace `"Ad soyad"` with `"Soyad ad"`.

Leave `UsersTab.test.jsx` alone: the administrator's user form keeps «Ad soyad» (`admin.fieldFullName`).

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/kabul/AdmitTab.test.jsx src/live/screens/kabul/admitDraft.test.jsx 2>&1 | tail -4
```

Expected: all passed. This is the label alone; no behaviour has changed yet.

- [ ] **Step 2: Write the failing tests**

In `dashboard/src/live/screens/kabul/admitForm.test.js`, after the test that holds `expect(Object.keys(toBody(complete()))).toEqual(["patient", "note"]);`, add:

```js
  it("says the nurse confirmed a reserved bed only when she did (G2-B3a, X2)", () => {
    expect(Object.keys(toBody(complete(), null, { confirmReserved: true }))).toEqual(["patient", "note", "confirm_reserved"]);
    expect(toBody(complete(), null, { confirmReserved: true }).confirm_reserved).toBe(true);
    expect("confirm_reserved" in toBody(complete(), null, { confirmReserved: false })).toBe(false);
    expect("confirm_reserved" in toBody(complete())).toBe(false);
  });
```

At the end of `dashboard/src/live/screens/kabul/AdmitTab.test.jsx`, append:

```jsx

describe("AdmitTab · a reserved bed (G2-B3a, D5, X1)", () => {
  const NOTE = "Sentetik planlı kabul";
  const RESERVED_1 = () => withBed(1, { state: "RESERVED" });
  const ask = () => screen.queryByRole("dialog", { name: /^Rezerv edilmiş çarpayı · / });
  const reservedNote = (a) => a.occupancy.mockResolvedValue({
    beds: [{ bed_id: BED(1), occupant_short: null, state_reason: null, state_note: NOTE }] });
  const pickReserved1 = () => {
    fireEvent.click(screen.getByRole("button", { name: /^Reanimasiya/ }));
    fireEvent.click(screen.getByRole("button", { name: "1 · Otaq 1 · Reanimasiya · Rezervdədir" }));
  };

  it("offers a reserved bed, and asks with its note before anything is sent", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => {
      a.structure.mockResolvedValue(RESERVED_1());
      reservedNote(a);
      a.admit.mockResolvedValue(admitted());
    } });
    fillRequired(["bed"]);
    pickReserved1();
    await press();
    expect(api.admit).not.toHaveBeenCalled();
    expect(within(ask()).getByText(`Rezerv qeydi: ${NOTE}`)).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: "Yenə də bu çarpayıya qəbul et" })); });
    await settle();
    expect(api.admit).toHaveBeenCalledTimes(1);
    expect(api.admit.mock.calls[0][0].confirm_reserved).toBe(true);
    expect(ask()).toBeNull();
  });

  it("sends nothing when the nurse steps back, and asks again on the next press", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => {
      a.structure.mockResolvedValue(RESERVED_1());
      reservedNote(a);
    } });
    fillRequired(["bed"]);
    pickReserved1();
    await press();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: "İmtina" })); });
    expect(ask()).toBeNull();
    expect(api.admit).not.toHaveBeenCalled();
    await press();
    expect(ask()).toBeTruthy();
  });

  it("asks when the server says the bed was reserved after the picker read it", async () => {
    let tree = structure();
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => {
      a.structure.mockImplementation(async () => tree);
      reservedNote(a);
      a.admit
        .mockRejectedValueOnce(refusal(409, "The bed is reserved: the admission must confirm it.", { apiCode: "bed_reserved" }))
        .mockResolvedValue(admitted());
    } });
    fillRequired();
    tree = RESERVED_1();
    await press();
    expect(api.admit).toHaveBeenCalledTimes(1);
    expect("confirm_reserved" in api.admit.mock.calls[0][0]).toBe(false);
    expect(ask()).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: "Yenə də bu çarpayıya qəbul et" })); });
    await settle();
    expect(api.admit).toHaveBeenCalledTimes(2);
    expect(api.admit.mock.calls[1][0].confirm_reserved).toBe(true);
    // One form, one request id: the server takes the two sends for one (X2).
    expect(api.admit.mock.calls[1][0].request_id).toBe(api.admit.mock.calls[0][0].request_id);
  });

  it("says when the note cannot be read, and still lets the nurse decide", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => {
      a.structure.mockResolvedValue(RESERVED_1());
      a.occupancy.mockRejectedValue(refusal(503, "Service unavailable"));
      a.admit.mockResolvedValue(admitted());
    } });
    fillRequired(["bed"]);
    pickReserved1();
    await press();
    expect(within(ask()).getByText(/^Rezerv qeydi oxunmadı: /)).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: "Yenə də bu çarpayıya qəbul et" })); });
    await settle();
    expect(api.admit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run them and see them red**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/kabul/admitForm.test.js src/live/screens/kabul/AdmitTab.test.jsx 2>&1 | tail -8
```

Expected:
- the `toBody` test fails: there is no third argument, so no `confirm_reserved`;
- the reserved-bed tests fail: there is no button `… · Rezervdədir`, and the tab sends at once (or, in the third test, shows the refusal on the toast instead of asking).

- [ ] **Step 4: `toBody`'s third argument**

In `dashboard/src/live/screens/kabul/admitForm.js`, replace

```js
/** The body POST /admissions takes (admission/schemas.py AdmissionCreate). `requestId` is the
 *  form's id (admitDraft.js, A-19): the same on every send of one filled form, so the server takes
 *  two sends of it for one admission. None given, none sent. */
export function toBody(form, requestId) {
  return {
    ...(typeof requestId === "string" && requestId ? { request_id: requestId } : null),
```

with

```js
/** The body POST /admissions takes (admission/schemas.py AdmissionCreate). `requestId` is the
 *  form's id (admitDraft.js, A-19): the same on every send of one filled form, so the server takes
 *  two sends of it for one admission. None given, none sent. `confirmReserved` (G2-B3a, X2): the
 *  nurse saw the bed is reserved and admits all the same — sent only then, and outside the form's
 *  digest on the server, so the send before her answer and the one after are one form. */
export function toBody(form, requestId, { confirmReserved = false } = {}) {
  return {
    ...(typeof requestId === "string" && requestId ? { request_id: requestId } : null),
```

and, in the same function, replace the closing lines

```js
      comorbidities_text: text(form.comorbiditiesText),
    },
  };
}
```

with

```js
      comorbidities_text: text(form.comorbiditiesText),
    },
    ...(confirmReserved ? { confirm_reserved: true } : null),
  };
}
```

- [ ] **Step 5: The picker says «reserved»**

In `dashboard/src/live/screens/kabul/BedPicker.jsx`:

1. Replace

```js
/** The beds of a unit an admission can take: open (bed, room and unit) and AVAILABLE. */
const freeBeds = (unit) => (unit.rooms ?? []).flatMap((room) =>
  (room.beds ?? []).filter((bed) => admissible(withOpen(unit, room, bed))));
```

with

```js
/** The FREE beds of a unit: open (bed, room and unit) and AVAILABLE. A reserved bed can be chosen
 *  (G2-B3a, D5) but is not counted free: it waits for someone. */
const freeBeds = (unit) => (unit.rooms ?? []).flatMap((room) =>
  (room.beds ?? []).filter((bed) => admissible(withOpen(unit, room, bed)) && bed.state === "AVAILABLE"));
```

2. In the bed button, replace

```js
                  const label = `${b.label} · ${room.name} · ${unit.name}`;
```

with

```js
                  const label = `${b.label} · ${room.name} · ${unit.name}`;
                  // G2-B3a (D5): a reserved bed is choosable and says so; the form asks before it sends.
                  const reserved = !why && b.state === "RESERVED" ? t("kabul.state.RESERVED") : null;
```

then replace

```js
                      aria-label={why ? `${label} · ${t(why)}` : label}
```

with

```js
                      aria-label={why ? `${label} · ${t(why)}` : reserved ? `${label} · ${reserved}` : label}
```

and replace

```js
                      {why ? <span aria-hidden="true" className="text-10.5">{t(why)}</span> : null}
```

with

```js
                      {why ? <span aria-hidden="true" className="text-10.5">{t(why)}</span> : null}
                      {reserved ? <span aria-hidden="true" className="text-10.5">{reserved}</span> : null}
```

- [ ] **Step 6: The question — `ReservedAsk.jsx`**

Create `dashboard/src/live/screens/kabul/ReservedAsk.jsx`:

```jsx
// src/live/screens/kabul/ReservedAsk.jsx — the question before an admission into a reserved bed
// (Group 2 · B3a, spec D5, X1). The server refuses such an admission (`bed_reserved`) until the
// form says the nurse saw the reservation. The refusal names the bed and never the note, so the
// note is read here, from GET /tenant/occupancy, which the admitting nurse may read (D2). A note
// that cannot be read is said so; the nurse still decides.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { normId } from "../../data/structure.js";
import { readErrorText } from "../../apiErrors.js";
import { Button, Modal } from "../../ui/index.js";

/** `bedId`, `bed` ("label · room · unit"); `onCancel` sends nothing, `onConfirm` sends with the flag. */
export function ReservedAsk({ bedId, bed, onCancel, onConfirm }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [note, setNote] = useState({ phase: "loading" });
  useEffect(() => {
    let live = true;
    store.track(() => store.api.occupancy())
      .then((answer) => {
        if (!live) return;
        const about = (answer?.beds ?? []).find((b) => normId(b.bed_id) === normId(bedId));
        setNote({ phase: "known", text: about?.state_note ?? null });
      })
      .catch((err) => { if (live) setNote({ phase: "failed", err }); });
    return () => { live = false; };
  }, [store, bedId]);

  const said = note.phase === "loading" ? t("kabul.reservedAsk.noteLoading")
    : note.phase === "failed" ? t("kabul.reservedAsk.noteFailed", { reason: readErrorText(t, note.err) })
      : note.text ? t("kabul.reservedAsk.note", { note: note.text }) : t("kabul.reservedAsk.noNote");
  return (
    <Modal open title={t("kabul.reservedAsk.title", { bed })} onClose={onCancel}
      actions={(
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" icon="ok" onClick={onConfirm}>{t("kabul.reservedAsk.confirm")}</Button>
        </>
      )}>
      <p className="m-0 mb-2 text-14">{t("kabul.reservedAsk.body")}</p>
      <p role="status" className="m-0 text-13.5">{said}</p>
    </Modal>
  );
}
```

- [ ] **Step 7: The tab asks**

In `dashboard/src/live/screens/kabul/AdmitTab.jsx`:

1. Add the import, next to the other local imports:

```js
import { ReservedAsk } from "./ReservedAsk.jsx";            // G2-B3a (D5)
```

2. In the component, after the line `const { structure, index, phase, error, reload } = useStructure();`, add:

```js
  // G2-B3a (D5): the reserved-bed question while it is open ({bedId, bed}), and the bed the nurse
  // said yes for — her answer holds for that bed only, and the next bed is asked about again.
  const [ask, setAsk] = useState(null);
  const [confirmedBed, setConfirmedBed] = useState(null);
```

If `useState` is not already imported from React in this file, add it to the React import.

3. In `failed(err, sent)`, as its first statement, add:

```js
    if (err?.apiCode === "bed_reserved") {
      // G2-B3a (X1): the bed was reserved after the picker read it. Nothing was written: read the
      // beds again and ask, as for a bed the picker shows reserved.
      await reload();
      if (!draft.live) return;
      setConfirmedBed(null);
      setAsk({ bedId: sent.bedId, bed: sent.bed });
      return;
    }
```

4. Change `submit` so it can be called again after the answer:
- replace the line `  async function submit(event) {` with `  async function submit(event, confirmed = false) {`;
- replace the next line `    event.preventDefault();` with `    event?.preventDefault();`.

5. In `submit`, replace

```js
    const sent = { bedId: form.bedId, bed: bedText, name: form.name, checked: false, requestId: again?.requestId ?? now.requestId };
    const body = toBody(form, sent.requestId);
```

with

```js
    const sent = { bedId: form.bedId, bed: bedText, name: form.name, checked: false, requestId: again?.requestId ?? now.requestId };
    // G2-B3a (D5): a bed the structure shows reserved is asked about first; the answer goes out
    // as `confirm_reserved`, which the server leaves out of the form's digest (X2).
    const reservedNow = index.beds.get(normId(form.bedId))?.state === "RESERVED";
    const saidYes = confirmed || normId(confirmedBed) === normId(form.bedId);
    if (reservedNow && !saidYes) {
      setAsk({ bedId: form.bedId, bed: bedText });
      return;
    }
    const body = toBody(form, sent.requestId, { confirmReserved: reservedNow && saidYes });
```

6. Render the question inside the returned `<form …>` element, immediately before its closing `</form>`:

```jsx
      {ask ? (
        <ReservedAsk bedId={ask.bedId} bed={ask.bed}
          onCancel={() => setAsk(null)}
          onConfirm={() => { setConfirmedBed(ask.bedId); setAsk(null); submit(null, true); }} />
      ) : null}
```

Two cases need care.

- **The early `return` in step 5.** It sits before `draft.update({ sending: true })`, so no send is marked as in flight. Read the lines between `const sent = …` and `draft.update({ sending: true })`. If `draft.update({ sending: true })` comes before them, move the reserved-bed check above it.
- **The `submit(null, true)` in step 6** reads `form` from the render that drew the dialog. That is the form the nurse confirmed for. `bed_reserved` from the server needs no flag of its own: `failed()` reads the beds again first, so `reservedNow` is true on the second send.

- [ ] **Step 8: Run them and see them green, then every Kabul and structure test**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run src/live/screens/kabul src/live/data src/live/screens/doluluk 2>&1 | tail -6
```

Expected: all passed, including the 4 new reserved-bed tests and the new `toBody` test.

- [ ] **Step 9: Line ends, then commit**

```bash
cd /c/tmp/g2b-b3a && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" dashboard/src/live/screens/kabul/ReservedAsk.jsx
for f in dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/screens/kabul/BedPicker.jsx dashboard/src/live/screens/kabul/ReservedAsk.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/screens/kabul/admitDraft.test.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/screens/kabul/BedPicker.jsx dashboard/src/live/screens/kabul/ReservedAsk.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/screens/kabul/admitDraft.test.jsx
git commit -m "feat(dashboard): the admission form takes a reserved bed after the nurse says yes, with the reservation's note in front of her (G2-B3a, D5, R9, X1, X2)" -m "The picker offers a reserved bed and says so; the question reads the note from /tenant/occupancy; a bed_reserved refusal re-reads the beds and asks; confirm_reserved goes out only after a yes. The form tests read «Soyad ad». Red: no reserved button; the tab sent at once; toBody had no third argument." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The roadmap row and the Turkish guide

**Files:**
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`
- Modify: `docs/homunculus-rehber-TR.md`

- [ ] **Step 1: The roadmap row**

In the roadmap's «Grup 2 · durum» table, insert a new row after the row that starts `| G2-B1d |`. Read that line first, because it is long:

```markdown
| G2-B3a | Doluluk (Lane B'nin speci, B1d oturumu taşıdı): birimlere ve odalara göre yataklar — durum renk ve sözle, durumda geçen süre, dolu yatakta yalnız kısa ad («Əli M.»: ikinci kelime + ilk kelimenin baş harfi, koğuş soyadı önce yazar), rezerv ve kullanım dışı notu/nedeni; boş yatak rezerve edilir ya da nedenle kullanım dışı bırakılır, bakımdaki ve kullanım dışı yatak kullanıma açılır (`beds.manage_state`: sorumlu hemşire, yönetici); rezerve yatağa kabul hemşirenin onayıyla (`confirm_reserved`); adlar ve notlar yalnız `GET /tenant/occupancy`'den (yapı okuması hasta verisi taşımaz); not şifreli, denetimde metni yok; Hasta Kabul'ün «Yataklar» sekmesi buraya taşındı, kabul formundaki ad kutusu «Soyad ad» · spec: [2026-10-26, 09.11 yenilemesi](../specs/2026-10-26-g2b-doluluk-design.md) · plan: [2026-11-09](2026-11-09-g2b-b3a-doluluk.md) | Kodda `feat/g2b-b3a-doluluk` · göç `0016` · **main'e alınmadı · VM'de değil** |
```

- [ ] **Step 2: The guide**

In `docs/homunculus-rehber-TR.md`:

1. In section 3.8, replace the words `sorumlu hemşire Yataklar sekmesinde "Temizlik bitti · boş" der` with `sorumlu hemşire «Doluluk» ekranında "Temizlik bitti · boş" der (B3a'dan önce Hasta Kabul'ün Yataklar sekmesindeydi)`.

2. Insert a new section before the line `## 4. "Neden bunu kullanmıyoruz" köşesi`:

```markdown
### 3.13 Doluluk: yatakların durumu, rezerv ve kullanım dışı (Grup 2 · B3a)

Servisin bütün yatakları tek ekranda, birime ve odaya göre: hangisi boş, hangisi dolu, hangisi
temizlikte, rezerve, kullanım dışı ya da bakımda — ve ne zamandan beri. Hasta Kabul'ün eski
«Yataklar» sekmesi buraya taşındı. **Durum:** kodda (`feat/g2b-b3a-doluluk`); main'e ve hastane
sunucusuna sahibin sözüyle çıkar. Örneklerdeki adlar uydurmadır.

- **Kim görür.** Kabulleri okuyan, kabul yapan, taburcu onaylayan ya da yatak boşaltan herkes,
  yalnız kendi birimlerinde. Kullanıcı yöneticisi ya da monitör eşleyicisi görmez.
- **Birim başlığı.** «1 / 4 doludur»: dolu yatak / kullanılabilir yatak. Kullanılabilir = açık, kullanım
  dışı ve bakımda olmayan; rezerve yatak kullanılabilir sayılır (hastasını bekler). Yanında sıfır
  olmayan sayılar: boş, temizlikte, rezervde, kullanım dışı, bakımda.
- **Dolu yatakta yalnız kısa ad.** «Məmmədov Əli Rauf oğlu» → «Əli M.»: ikinci kelime tam, ilk
  kelimenin baş harfi, çünkü koğuşta ad soyadı önce yazılır (sahibin kararı, 9 Kasım 2026). Kabul
  formundaki kutunun adı da bu yüzden «Soyad ad». Numara, doğum tarihi, tanı gösterilmez.
- **Rezerv.** Sorumlu hemşire boş bir yatağı beklenen hasta için ayırır; isteğe bağlı not («kimin
  için, neden», en çok 200 karakter). Not hasta adı taşıyabileceği için **şifreli** saklanır; denetim
  kaydına yalnız «not yazıldı mı» düşer, metni düşmez. Rezerve yatağa kabul yasak değildir: kabul
  formu yatağın rezerve olduğunu ve notunu gösterip hemşireye sorar, «Yenə də bu çarpayıya qəbul et»
  denirse kabul eder.
- **Kullanım dışı.** Boş bir yatak her zaman bir **nedenle** kullanım dışı bırakılır: arıza, izolasyon
  temizliği, personel yetersizliği ya da diğer («diğer» için not zorunlu). «Kullanıma aç» yatağı yeniden
  boş yapar; bakımdaki yatak için de aynı düğme çıkar. Yatakta açık bir yatış varsa ya da son
  hastanın kartı panodan inmemişse açılmaz (yatak boşaltmanın kuralları).
- **Bir anda bir işlem.** Bir düğmeye basıldığında diğer yatakların düğmeleri işlem bitene dek
  bekler; her işlemden sonra ekran yatakları ve adları yeniden okur. Adlar okunamazsa ekran bunu
  söyler ve yatakları adsız gösterir; eski bir adı yanlış yatakta göstermektense hiç göstermez.
- **«Bu çarpayıya xəstə qəbul et».** Yatağı oturumun kabul formuna koyar ve Hasta Kabul'ü açar.
  Formda yanıt bekleyen bir gönderim varsa yatak seçimine dokunmaz ve bunu söyler.
- **Yetki.** Rezerv ve kullanım dışı için yeni yetki `beds.manage_state` (sorumlu hemşire ve yönetici).
  Temizlik bitti için eskisi gibi `beds.release`.
- **Göç `0016`.** Yatak durumlarına «rezerve» eklenir; iki sütun gelir (neden, şifreli not). Geri
  alınırsa rezerve yataklar boşa döner (Postgres bir durum değerini silemez, değer tipte kalır ama
  hiçbir yatak taşımaz).
```

- [ ] **Step 3: Commit**

```bash
cd /c/tmp/g2b-b3a && for f in docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md
git commit -m "docs: the roadmap's G2-B3a row and the guide's Doluluk section (G2-B3a)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The gates, the final review and the local walk

**Files:** none changed, unless a gate or the review finds something. Each fix is its own commit, in the task that owns the file, with the red named.

- [ ] **Step 1: The engine.** Run Task 7's Steps 1–3 again on the final head. Report the numbers.

- [ ] **Step 2: The dashboard and the build**

```bash
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -5
cd /c/tmp/g2b-b3a/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -6
```

Expected:
- the suite: all passed — Task 0's count, plus the new tests, minus the 18 of the deleted `BedsTab.test.jsx`;
- the build: no `larger than 500 kB`. The precache count is Task 0's N, or a different number with its reason named (for example, a new chunk).

- [ ] **Step 3: The final review (the controller dispatches it)**

One reviewer, the most capable model, reads the whole diff `git diff 628c46d4..HEAD` against the spec (§0–§6) and this plan's departures (X1–X10). It looks hardest at five things:
- lock order: each bed move takes the bed lock first; the admission takes the bed lock (in `_bed_of`) before the protocol;
- patient data: no name in the structure, the audit or a refusal, and the note encrypted;
- the raw move's guards, now shared through `_free_guards`;
- the reserved-bed path through the admission form's unanswered-send logic (A-19, A-21, A-24);
- the four languages.

Fix what it finds and re-review until it approves.

- [ ] **Step 4: The local walk (the controller runs it)**

Run it on a local stack of this branch with synthetic accounts and synthetic patients: a charge nurse, a nurse and an administrator. Use a headless Chrome at 390 px and 1440 px, in the Gece and Gün themes, and in all four languages.

1. **Doluluk** shows the units, the counts, the time in state, and «Əli M.» on an occupied bed; no UUID and no raw key.
2. The charge nurse reserves a bed with a note. The note shows on the tile.
3. The nurse opens «Bu çarpayıya xəstə qəbul et» on that bed. Kabul asks with the note, and the admission goes in after «Yenə də …». The tile reads «Dolu», with the short name.
4. The charge nurse takes a bed out of service with «Digər». The form asks for a note, then takes it. «İstifadəyə ver» returns the bed.
5. A cleaned bed is released from Doluluk. Kabul shows two tabs.
6. An account holding only `users.manage` opens Yönetim; its network panel shows no name in `/tenant/structure`.

Record the walk in the plan's record section, and in the roadmap row's status cell.

- [ ] **Step 5: Report to the user.** Report:
- the commit range;
- the gates' numbers;
- the review's verdict;
- the walk.

The slice then waits for the owner's «main'e al» (ff-only) and, separately, the VM decision.

---

## Deploy notes (for the VM step — not part of this plan's tasks)

- **What ships:** api and web. The hub, the bridge and nce are untouched.
- **Migration:** `0016`, purely additive while no bed is RESERVED.
- **Order:** api first, then web.
  - An old web against the new api still works: Kabul's old «Yataklar» tab calls the unchanged release route.
  - A new web against the old api would show «names could not be read», and every move would answer 404.
- **Rollback:** `alembic downgrade 0015`, which frees every reserved bed (X8) and drops the reasons and the notes. Then the previous images.
  - Out-of-service beds stay BLOCKED. The old web calls that state «Kapatılmış». The administrator's raw move returns them to service.
- **Before the deploy:** tell the ward that the «Yataklar» tab moved to «Doluluk», and that the name box now reads «Soyad ad».

## Record

*(filled in by Task 15: the final review, the walk, the numbers)*

