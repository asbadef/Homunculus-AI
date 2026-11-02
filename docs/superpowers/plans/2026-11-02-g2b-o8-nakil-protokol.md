# G2-B1d O8 — a transfer keeps the protocol: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a transfer's arrival is confirmed, the arriving admission takes over the source admission's protocol number, so the card's key, the label and the devices keep one number. Transfers stay closed.

**Architecture:** `admission/service.py` `confirm_transfer_arrival` moves `protocol_no` from the source row, which becomes `TRANSFERRED`, to the new `ACTIVE` row. The source is cleared and flushed BEFORE the insert, because the partial unique index `uq_admissions_tenant_protocol` allows one row per number. There is no migration, no route change (both transfer routes still answer 409 `transfer_unavailable`, A-37), and no screen change. The work is two DB tests, one service change, a comment in the closed routes' reopening list, and three doc lines.

**Tech Stack:** Python 3.12 (3.14 check), SQLAlchemy async ORM, pytest + pytest-asyncio against the shared Postgres test database.

**Spec:** `docs/superpowers/specs/2026-11-02-g2b-o8-nakil-protokol-design.md` (commit `4633a50`).

---

## Environment (binding for every task)

- **Worktree:** `/c/tmp/g2b-o8`, branch `feat/g2b-o8-nakil-protokol`, cut from main `c72cbe5`. Never touch
  `/c/Users/User/Desktop/Project/Homunculus AI`, `main`, origin, the VM, or any other worktree.
- **Python:** `/c/tmp/f7-py312/venv/Scripts/python.exe` (3.12); the 3.14 check uses
  `/c/tmp/g115-py314/Scripts/python.exe`. Always run from `homunculus-engine`, always naming files:
  ```bash
  cd /c/tmp/g2b-o8/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -5
  ```
- **Test database:** prefix the command with
  `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test`, ON THE COMMAND
  LINE ONLY. Never export it; never set `DATABASE_URL`.
  - The database is shared with other sessions behind conftest's advisory lock, so a run may wait minutes.
  - Redirect each DB run to `/c/tmp/g2b-b1d-logs/o8-<n>.log` and poll its tail in short foreground calls.
  - Never use `run_in_background`, and never finish while a run is pending.
- **Never run `tests/test_infinity_vm_pilot.py`**, alone or through a bare `pytest tests/`.
- **Edits:** Write and Edit tools only on repo files. The tree checks out CRLF; the Edit tool keeps it.
- **Git:**
  - Never `git stash`.
  - Commit with a pathspec (`git commit -F - -- <paths>`). Never push.
  - Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No PHI:** synthetic data only. The protocol is `202600000001`; the fixture patients are «Synthetic Patient» with `H99…` numbers.
- **Search scope:** never Grep or Glob `dashboard/node_modules`.

## File structure

- Modify: `homunculus-engine/src/homunculus/admission/service.py`, `confirm_transfer_arrival` (≈ :314–:390). The protocol moves. The F-34 warning comment (≈ :337–:340) is replaced.
- Modify: `homunculus-engine/src/homunculus/admission/router.py`, the A-37 comment above `_transfer_closed` (≈ :899–:908). One reopening condition is added.
- Test: `homunculus-engine/tests/test_admission_workflow.py`, two tests after `test_a_transfer_to_a_bed_that_is_not_available_is_refused_by_its_code`, plus two imports.
- Modify (docs):
  - `docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md` §12 O8;
  - `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, the G2-B1d row;
  - `docs/homunculus-rehber-TR.md` §3.10.

---

### Task 1: The arriving admission takes the protocol

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/service.py` (`confirm_transfer_arrival`)
- Modify: `homunculus-engine/src/homunculus/admission/router.py` (A-37 comment)
- Test: `homunculus-engine/tests/test_admission_workflow.py`

- [ ] **Step 1: The imports.** In `tests/test_admission_workflow.py`, replace

```python
import pytest
import pytest_asyncio

from homunculus.admission import service
```

with

```python
import pytest
import pytest_asyncio
from sqlalchemy import select

from homunculus.admission import service
from homunculus.admission.boardkey import board_key
```

`test_transfer_creates_new_active_and_closes_source` imports `select` again inside its body. Leave that local import as it is; this task does not touch that test.

- [ ] **Step 2: The two failing tests.** Insert them after the end of `test_a_transfer_to_a_bed_that_is_not_available_is_refused_by_its_code`, before the `# Discharge (§4.7)` banner:

```python
#: A synthetic protocol number (G2-B1d: twelve digits; each test's tenant is its own, so no clash).
PROTOCOL = "202600000001"


async def test_a_transfer_keeps_the_protocol_it_moves_to_the_arriving_admission(db_session):
    """O8 (spec 2026-11-02): a transfer is inside one visit, so it keeps the visit's protocol. The
    number moves to the arriving row — `uq_admissions_tenant_protocol` allows one row per number —
    and the card's key (`board_key`) does not change: the label and the devices keep their number."""
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session, n_beds=2)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending),
        protocol_no=PROTOCOL)
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    number = p.patient_number
    key_before = board_key(adm.protocol_no, number)

    await service.initiate_transfer(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    new_adm = await service.confirm_transfer_arrival(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)

    assert (new_adm.protocol_no, adm.protocol_no) == (PROTOCOL, None)
    assert board_key(new_adm.protocol_no, number) == key_before == PROTOCOL
    holders = (await db_session.execute(
        select(Admission.state, Admission.protocol_no)
        .where(Admission.tenant_id == tenant.id, Admission.protocol_no.is_not(None)))).all()
    assert [tuple(row) for row in holders] == [(AdmissionState.ACTIVE, PROTOCOL)]   # the open one


async def test_a_transfer_of_a_legacy_admission_keeps_its_h_number_key(db_session):
    """O8: an admission from before G2-B1d has no protocol — both rows stay without one, and the card's
    key is the H-number, as before."""
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session, n_beds=2)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    number = p.patient_number

    await service.initiate_transfer(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    new_adm = await service.confirm_transfer_arrival(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)

    assert (new_adm.protocol_no, adm.protocol_no) == (None, None)
    assert board_key(new_adm.protocol_no, number) == number
```

- [ ] **Step 3: Run them to see the red.**

```bash
cd /c/tmp/g2b-o8/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_workflow.py -k "keeps_the_protocol or legacy_admission_keeps" > /c/tmp/g2b-b1d-logs/o8-1.log 2>&1; tail -15 /c/tmp/g2b-b1d-logs/o8-1.log
```

Expected: `1 failed, 1 passed`.
- The protocol test fails on its first assert: `(None, '202600000001') != ('202600000001', None)`. The arriving row has no protocol, and the source still holds it.
- The legacy test passes already. It is a guard that the change keeps the old behaviour, not a red. Record both outcomes in the commit body.

If the log says the DB is unreachable or every test is skipped, stop and report: `TEST_DATABASE_URL` was not applied, or the container `homunculus-test-pg-56` is not running (`docker ps`).

- [ ] **Step 4: The change.** In `homunculus-engine/src/homunculus/admission/service.py`, `confirm_transfer_arrival`, replace

```python
    # Create new ACTIVE admission at target, copying the short note.
    # F-34 (G2-B1d): the new row carries no `protocol_no`, so its board key would be the H-number while the
    # card stands under the protocol (E3). Unreachable while transfers are closed (`_transfer_closed` ->
    # 409 `transfer_unavailable`); the transfer slice must move the protocol to this row or issue a new one
    # (`uq_admissions_tenant_protocol` forbids two rows with one protocol). Spec §12 O8.
    new_admission = Admission(
        patient_id=admission.patient_id,
        tenant_id=admission.tenant_id,
```

with

```python
    # O8 (spec 2026-11-02): a transfer keeps the visit's protocol — it moves to the arriving row, so the
    # card's key, the label and the devices keep one number. The source gives it up and is flushed
    # first: `uq_admissions_tenant_protocol` allows one row per number, and the insert below must not
    # meet the source still holding it (the order a single flush would choose is not promised).
    moved_protocol = admission.protocol_no
    if moved_protocol is not None:
        admission.protocol_no = None
        await db.flush()

    # Create new ACTIVE admission at target, copying the short note.
    new_admission = Admission(
        patient_id=admission.patient_id,
        tenant_id=admission.tenant_id,
        protocol_no=moved_protocol,
```

- [ ] **Step 5: The reopening list.** In `homunculus-engine/src/homunculus/admission/router.py`, the A-37 comment above `_transfer_closed`, replace

```python
#   * `_last_card_off` (tenant/router.py) covering TRANSFERRED as well;
#   * a transfer UI.
```

with

```python
#   * `_last_card_off` (tenant/router.py) covering TRANSFERRED as well;
#   * a transfer UI;
#   * the arrival's audit row carrying the moved `protocol_no` — the service moves it to the arriving
#     row (O8), so the TRANSFERRED row no longer holds it, and the card keeps its key across the move.
```

- [ ] **Step 6: Run the transfer tests to see them green.**

```bash
cd /c/tmp/g2b-o8/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_workflow.py > /c/tmp/g2b-b1d-logs/o8-2.log 2>&1; tail -5 /c/tmp/g2b-b1d-logs/o8-2.log
```

Expected: every test in the file passes, 0 failed. That includes `test_transfer_creates_new_active_and_closes_source` and the two new ones.

Then run the closed routes' tests and the other admission and isolation tests that build transfers:

```bash
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_discharge_api.py tests/test_tenant_isolation.py tests/test_admission_api.py tests/test_protocol_admission.py tests/test_protocol_board_key.py > /c/tmp/g2b-b1d-logs/o8-3.log 2>&1; tail -5 /c/tmp/g2b-b1d-logs/o8-3.log
```

Expected: 0 failed. Every `transfer_unavailable` test still answers 409.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-o8
git status --short
git diff --stat
git commit -F - -- homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_admission_workflow.py <<'EOF'
fix(admission): a transfer keeps the protocol — the arriving admission takes it, the source gives it up first (O8)

The owner's rule (2026-11-02): a transfer is inside one visit, so the card's key, the label and the
devices keep one number. confirm_transfer_arrival moves protocol_no from the TRANSFERRED row to the
arriving ACTIVE row; the source is cleared and flushed before the insert, because
uq_admissions_tenant_protocol allows one row per number. A legacy admission (no protocol) transfers
as before. The transfer routes stay closed (A-37); their reopening list gains the arrival's audit
row carrying the moved number.

red: <the real red line from o8-1.log>
green: <the real green lines from o8-2.log and o8-3.log>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Before running it, replace the two `<…>` lines with the real outputs from the logs, so the committed message holds no angle-bracket text.

---

### Task 2: The docs say O8 is closed

**Files:**
- Modify: `docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md` (§12, the O8 item)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the G2-B1d row)
- Modify: `docs/homunculus-rehber-TR.md` (§3.10, the transfer bullet)

- [ ] **Step 1: The B1d spec.** Replace

```markdown
- **O8:** `admission/service.py` `confirm_transfer_arrival` builds the arriving admission without
  `protocol_no`, so its board key would be the H-number while the card stands under the protocol
  (E3's split). This is unreachable while transfers are closed (409 `transfer_unavailable`). The
  transfer slice moves the protocol to the arriving row or issues a new one
  (`uq_admissions_tenant_protocol` forbids two rows with one protocol). Its test pins that
  `board_key` equals the card's key.
```

with

```markdown
- **O8 — closed (2026-11-02, [the O8 follow-up](2026-11-02-g2b-o8-nakil-protokol-design.md)):** a
  transfer keeps the visit's protocol. `confirm_transfer_arrival` moves `protocol_no` from the
  TRANSFERRED row to the arriving row, clearing and flushing the source first, because
  `uq_admissions_tenant_protocol` allows one row per number. The card's key does not change
  (`tests/test_admission_workflow.py`). The transfer routes stay closed (A-37); the slice that reopens
  them records the moved number in the arrival's audit row.
```

- [ ] **Step 2: The roadmap row.** In the G2-B1d row, replace `O7 (adı olmayan HBYS kaydı), O8 (nakil), O9, O10` with `O7 (adı olmayan HBYS kaydı), O9, O10; O8 kapandı (nakil protokolü taşır — takip dilimi, spec 2026-11-02)`.

- [ ] **Step 3: The guide.** In `docs/homunculus-rehber-TR.md` §3.10, replace

```markdown
- **Servisler arası nakil** bugün kapalı (409 `transfer_unavailable`); açıldığında yeni kabul
  kaydı protokolü taşımalı (açık madde O8, spec §12).
```

with

```markdown
- **Servisler arası nakil** bugün kapalı (409 `transfer_unavailable`). Açıldığında protokol aynı
  kalır: nakil aynı gelişin içindedir, numara nakledilen kayıttan yeni kabul kaydına taşınır; etiket,
  cihaza girilen numara ve kart değişmez (O8, kapandı).
```

- [ ] **Step 4: Commit.**

```bash
cd /c/tmp/g2b-o8
git status --short
git commit -F - -- docs/superpowers/specs/2026-11-01-g2b-b1d-protokol-barkod-design.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-11-02-g2b-o8-nakil-protokol.md <<'EOF'
docs(g2b-b1d): O8 closed — a transfer keeps the protocol (the B1d spec, the roadmap row, the guide)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

This plan file is committed here too, unless it already went in with the spec.

---

### Task 3: Gates

- [ ] **Step 1: Engine, no database (3.12)**:

```bash
cd /c/tmp/g2b-o8/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py > /c/tmp/g2b-b1d-logs/o8-nodb.log 2>&1; tail -1 /c/tmp/g2b-b1d-logs/o8-nodb.log
```

Expected: `3153 passed, 1109 skipped` or a little more, 0 failed. Main `c72cbe5` gave 3153 / 1109 / 0, and the two new tests skip without a database.

- [ ] **Step 2: Engine, Postgres.**
  - Cover every `tests/test_*.py` except `test_infinity_vm_pilot.py`, plus `tests/rules tests/scoring tests/tenant`.
  - Run in parts, one after another. Build the list from `ls tests/test_*.py`, covering each file exactly once. B1d's last gate split it into ten parts; its lists are `/c/tmp/g2b-b1d-logs/t18-part-01..09.txt`.
  - Prefix each run with `TEST_DATABASE_URL=…`, redirect it to `/c/tmp/g2b-b1d-logs/o8-db-<nn>.log`, and poll the tail.

Expected: 0 failed. The totals are 4253 passed / 9 skipped (main `c72cbe5`) plus the two new tests, so 4255 / 9. The 9 skips are environment skips: tzdata, CA bundle, LDAP_TEST_*, `homunculus_ml`.

- [ ] **Step 3: 3.14** — the touched files:

```bash
cd /c/tmp/g2b-o8/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_workflow.py tests/test_discharge_api.py tests/test_tenant_isolation.py 2>&1 | tail -1
```

Expected: 0 failed. The DB tests skip, since `TEST_DATABASE_URL` is not given here.

- [ ] **Step 4: The chain is unchanged.**

```bash
cd /c/tmp/g2b-o8/homunculus-engine
git -C /c/tmp/g2b-o8 diff --stat c72cbe5 -- homunculus-engine/alembic dashboard deploy
PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; c = Config('alembic.ini'); c.set_main_option('script_location', 'alembic'); print(ScriptDirectory.from_config(c).get_heads())"
```

Expected: no diff under alembic, dashboard or deploy, and `['0015']`.

- [ ] **Step 5: Record.** No commit. The counts go to the controller, which reports them to the owner. Main is fast-forwarded only on the owner's «main'e al». Nothing in this follow-up reaches the VM; its code ships with the next deploy that carries main.
