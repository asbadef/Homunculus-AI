# Group 1 · Wave 0 — reconcile `main` with the LDAP/RBAC branch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One branch, `feat/canli-tasarim`, that carries everything on `origin/main` (Infinity, staff scope, clinical charting, SOFA form, audit chain) **and** everything on `feat/ldap-rbac` (groups, permissions, `/admin`), with every route permission-gated, one linear migration chain, the nginx proxy complete, and every test suite green.

**Architecture:** `origin/main` is merged INTO a new branch cut from `feat/ldap-rbac`. Conflicts are resolved so that the LDAP branch's *permission model* wins everywhere (no `UserRole`, no `require_roles`), and `main`'s *features* survive on top of it (staff scope, `/clinical`, `/scores`, `/alarm-quality`, `/audit/verify`, Infinity research). The LDAP migration moves from `0006` to `0010`. `ClinicalDemo.jsx` keeps the LDAP branch's version (decision D1 in the roadmap: the demo is removed in G1-16 and the live UI is rebuilt in the new shell; `main`'s 2 000-line rewrite of that file is not ported).

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL (test container), pytest; React 18 + Vite + Vitest; nginx.

**Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (tickets G1-01, G1-02).

---

## Ground rules for every task

- Work only in the worktree `C:/tmp/homunculus-g1`. Never touch the main tree at `C:/Users/User/Desktop/Project/Homunculus AI`: it holds the user's uncommitted edits (`dashboard/src/main.jsx`, `routing.test.js`, `vite.config.js`, untracked Infinity files).
- **Python imports must resolve to the worktree.** The engine venv lives in the main tree and its editable install points at the main tree's `src`. Every pytest command below therefore sets `PYTHONPATH=src`, and Task 0 proves it.
- Python: `PY="/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe"`.
- DB tests: the Docker container `homunculus-test-pg` on port 55432. `export TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test`. **Never export `DATABASE_URL`** (prodserver exits on the PHI-key check).
- Known pre-existing failure, not ours: `tests/test_infinity_vm_pilot.py` (PowerShell). Record it, do not fix it.
- Commit after each task with the attribution line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## File map (what changes, and why)

| File | Change |
|---|---|
| `deploy/local/web/nginx.conf` | Proxy every API prefix (Task 1) |
| `homunculus-engine/tests/test_nginx_routes.py` | New: config test that every router prefix is proxied (Task 1) |
| `homunculus-engine/alembic/versions/0006_groups_and_permissions.py` → `0010_groups_and_permissions.py` | Renumber, down_revision `0009`, two new keys in the frozen defaults, PHARMACIST/BIOMEDICAL legacy rows (Task 3) |
| `homunculus-engine/src/homunculus/auth/permissions.py` | `clinical.chart`, `scores.sign`; `LEGACY_ROLE_TO_GROUP` gains PHARMACIST/BIOMEDICAL (Task 3) |
| `dashboard/src/permissions.js`, `dashboard/src/clinicalI18n.js` | Parity for the two keys; labels in TR/AZ/EN/RU (Task 3) |
| `homunculus-engine/src/homunculus/auth/models.py` | LDAP side wins (no `UserRole`) (Task 2) |
| `homunculus-engine/src/homunculus/scope/service.py`, `scope/router.py` | Role read from groups; admin routes on `users.manage` (Task 4) |
| `homunculus-engine/src/homunculus/api/infinity_research.py` | `require_permission("devices.manage")` (Task 4) |
| `homunculus-engine/src/homunculus/api/app.py`, `api/prodserver.py`, `api/rehydrate.py` | Caller + permissions from LDAP, scope + new routes from main (Task 5) |
| `dashboard/src/{liveAuth,backendApi,liveStore}.js`, `ClinicalDemo.jsx` | Keep both API surfaces; LDAP `ClinicalDemo.jsx` (Task 6) |
| 12 `main` test files that render `main`'s `ClinicalDemo` | Removed; their behaviours recorded as acceptance criteria for the new shell (Task 6) |

---

### Task 0: Worktree, branch, baseline

**Files:** none changed.

- [ ] **Step 1: Create the branch and worktree**

```bash
cd "/c/Users/User/Desktop/Project/Homunculus AI"
git fetch origin
git worktree add -b feat/canli-tasarim /c/tmp/homunculus-g1 feat/ldap-rbac
```
Expected: `Preparing worktree (new branch 'feat/canli-tasarim')`.

- [ ] **Step 2: Prove Python imports the worktree, not the main tree**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -c "import homunculus, sys; print(homunculus.__file__)"
```
Expected: a path starting with `C:\tmp\homunculus-g1\homunculus-engine\src`. If it prints the main tree, STOP: every later test result would be about the wrong code.

- [ ] **Step 3: Install dashboard dependencies in the worktree**

```bash
cd /c/tmp/homunculus-g1/dashboard && npm ci
```
Expected: exits 0.

- [ ] **Step 4: Record the baseline**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
docker start homunculus-test-pg
export TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -3
cd ../dashboard && npx vitest run 2>&1 | tail -4
```
Expected (from the LDAP plan's last record): backend ≈1264 passed (+ the known PS1 failure); dashboard 637 passed. Write the exact numbers into the commit message of Task 1.

---

### Task 1 (G1-01): nginx proxies every API prefix

**Files:**
- Modify: `deploy/local/web/nginx.conf:36`
- Create: `homunculus-engine/tests/test_nginx_routes.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_nginx_routes.py
"""The panel's nginx must hand every API path to the API.

A path nginx does not proxy falls through to `try_files … /index.html`: the browser receives the
dashboard's HTML with a 200, the API client fails to parse it, and the screen shows a generic
error. That is how the staff tab would have shipped broken (2026-10-01): `/admin` was missing
from the location regex. This test reads the real config so a new router cannot be forgotten.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

CONF = Path(__file__).resolve().parents[2] / "deploy" / "local" / "web" / "nginx.conf"

# One representative path per API prefix the dashboard or the bridge calls.
API_PATHS = [
    "/auth/login", "/admin/users", "/tenant/tenants", "/admissions", "/shift-schedule",
    "/handovers", "/alerts/x", "/break-glass", "/scope/me", "/clinical/p1",
    "/scores/sofa/p1", "/alarm-quality", "/infinity-research/state", "/patients", "/ack",
    "/ingest", "/view", "/audit", "/audit/verify", "/health", "/stream", "/stream-ticket",
    "/notifications",
]
# Paths that must stay with the single-page app.
SPA_PATHS = ["/", "/index.html", "/assets/index-abc.js", "/administrator-guide"]


def _api_locations() -> list[re.Pattern[str]]:
    text = CONF.read_text(encoding="utf-8")
    patterns = []
    for match in re.finditer(r"location\s+~\s+(\S+)\s*\{(.*?)\}", text, re.S):
        if "proxy_pass http://api:8000" in match.group(2):
            patterns.append(re.compile(match.group(1)))
    return patterns


@pytest.mark.parametrize("path", API_PATHS)
def test_api_path_is_proxied(path: str) -> None:
    assert any(p.search(path) for p in _api_locations()), f"{path} falls through to the SPA"


@pytest.mark.parametrize("path", SPA_PATHS)
def test_spa_path_is_not_proxied(path: str) -> None:
    assert not any(p.search(path) for p in _api_locations()), f"{path} would hit the API"
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/homunculus-g1/homunculus-engine && PYTHONPATH=src "$PY" -m pytest tests/test_nginx_routes.py -q`
Expected: FAIL for `/admin/users`, `/tenant/tenants`, `/admissions`, `/shift-schedule`, `/handovers`, `/break-glass`, `/scope/me`, `/clinical/p1`, `/scores/sofa/p1`, `/alarm-quality`, `/infinity-research/state`.

- [ ] **Step 3: Widen the location regex**

Replace line 36 of `deploy/local/web/nginx.conf`:

```nginx
    # Every API router's prefix. A prefix missing here is served index.html with a 200 — the API
    # client then fails on HTML, far from the cause. tests/test_nginx_routes.py pins this list.
    # `(/|$)` keeps an SPA path that merely starts with a prefix (e.g. /administrator-guide) out.
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|patients|ack|ingest|view|audit|health)(/|$) {
```

- [ ] **Step 4: Run the test to see it pass**

Run: `PYTHONPATH=src "$PY" -m pytest tests/test_nginx_routes.py -q`
Expected: `27 passed`.

- [ ] **Step 5: Commit**

```bash
git add deploy/local/web/nginx.conf homunculus-engine/tests/test_nginx_routes.py
git commit -m "fix(deploy): nginx proxies every API prefix — /admin and seven others fell through to the SPA

Baseline before this branch's merge: backend <N> passed, dashboard <M> passed.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2 (G1-02a): Start the merge; settle the trivial hunks

**Files (conflicted):** `auth/models.py`, `api/rehydrate.py`, `tests/test_audit_postgres.py`, `dashboard/src/liveAuth.js`.

- [ ] **Step 1: Start the merge**

```bash
cd /c/tmp/homunculus-g1
git merge --no-ff --no-commit origin/main
git diff --name-only --diff-filter=U
```
Expected: exactly these 9 paths:
`dashboard/src/ClinicalDemo.jsx`, `dashboard/src/backendApi.js`, `dashboard/src/liveAuth.js`,
`dashboard/src/liveStore.js`, `homunculus-engine/src/homunculus/api/app.py`,
`homunculus-engine/src/homunculus/api/prodserver.py`, `homunculus-engine/src/homunculus/api/rehydrate.py`,
`homunculus-engine/src/homunculus/auth/models.py`, `homunculus-engine/tests/test_audit_postgres.py`.
If the list differs, STOP and report it: this plan was written against `origin/main` = `2f3544a`.

- [ ] **Step 2: `auth/models.py` — LDAP side**

Keep the four constants; drop `main`'s `UserRole` class (the LDAP branch removed the enum; `tenant_memberships.role` is a nullable `varchar(40)` since its migration).

```python
AUTH_LOCAL = "local"
AUTH_LDAP = "ldap"
SOURCE_MANUAL = "manual"
SOURCE_LDAP = "ldap"
```
Then: `grep -n "UserRole" homunculus-engine/src/homunculus/auth/models.py` → no output.

- [ ] **Step 3: `api/rehydrate.py` — both imports**

```python
from homunculus.api.clinical import profile_from_payload
from homunculus.api.identity import bounded_role
```

- [ ] **Step 4: `tests/test_audit_postgres.py` — `main`'s chain assertions**

Take the `origin/main` side of the hunk verbatim (single head, whole chain, single root). Delete the LDAP line `assert heads == ["0006"]`.

- [ ] **Step 5: `dashboard/src/liveAuth.js` — LDAP side**

Keep `NO_PERMISSIONS` / `NO_BOARD_ACCESS`; drop `main`'s `ROLE_MAP`, `PRECEDENCE`, `UNSUPPORTED_ROLE` and the `ROLE` import. Then:

```bash
grep -rn "UNSUPPORTED_ROLE\|ROLE_MAP" dashboard/src --include=*.js --include=*.jsx | grep -v "\.test\."
```
Expected: no output. (A test file that still imports them is handled in Task 6.)

- [ ] **Step 6: Mark resolved (no commit yet — the merge commit comes in Task 5)**

```bash
git add homunculus-engine/src/homunculus/auth/models.py homunculus-engine/src/homunculus/api/rehydrate.py \
        homunculus-engine/tests/test_audit_postgres.py dashboard/src/liveAuth.js
```

---

### Task 3 (G1-02b): One migration chain; two new permission keys

`main` added `0006_identity_diagnoses → 0007_pharmacist_biomedical_roles → 0008_audit_chain → 0009_staff_scope`. The LDAP branch's `0006_groups_and_permissions` also names `0005` as its parent: two heads. It has never run anywhere (the LDAP branch was never deployed), so it is renumbered, not chained around.

`main` also brought routes no LDAP permission covers: `POST /clinical/{id}` and `PUT /clinical/{id}/profile` (a clinician charting what no device measures) and `POST /scores/sofa/{id}` (signing the severity form). They get two keys, mirroring the design prototype (`forms` for nurses and physicians, `scores_sign` for physicians).

**Files:**
- Rename: `homunculus-engine/alembic/versions/0006_groups_and_permissions.py` → `0010_groups_and_permissions.py`
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py`
- Modify: `dashboard/src/permissions.js`, `dashboard/src/clinicalI18n.js`
- Test: `homunculus-engine/tests/test_permissions.py` (existing), `dashboard/src/permissions.test.js` (existing parity test), the migration tests that name `"0006"`

- [ ] **Step 1: Write the failing tests**

Append to `homunculus-engine/tests/test_permissions.py`:

```python
def test_clinical_and_scoring_keys_exist_and_are_granted_as_designed():
    from homunculus.auth.permissions import DEFAULT_GROUPS, PERMISSIONS

    assert "clinical.chart" in PERMISSIONS
    assert "scores.sign" in PERMISSIONS
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    for slug in ("attending", "unit_physician", "physician", "charge_nurse", "nurse",
                 "rapid_response"):
        assert "clinical.chart" in by_slug[slug], slug
    for slug in ("attending", "unit_physician", "physician"):
        assert "scores.sign" in by_slug[slug], slug
    for slug in ("charge_nurse", "nurse", "rapid_response", "auditor", "pharmacist",
                 "biomedical", "platform_support"):
        assert "scores.sign" not in by_slug[slug], slug


def test_legacy_pharmacist_and_biomedical_convert():
    from homunculus.auth.permissions import LEGACY_ROLE_TO_GROUP

    assert LEGACY_ROLE_TO_GROUP["PHARMACIST"] == "pharmacist"
    assert LEGACY_ROLE_TO_GROUP["BIOMEDICAL"] == "biomedical"
```

(`PERMISSIONS` is the catalogue dict at `permissions.py:19`; `DEFAULT_GROUPS` is a tuple of `GroupSpec` TypedDicts at `:97`; `physician`'s rights are a literal tuple at `:108-110`, `attending`'s come from `_ATTENDING` at `:78`, `unit_physician`'s are derived from `_ATTENDING`.)

- [ ] **Step 2: Run them to see them fail**

Run: `PYTHONPATH=src "$PY" -m pytest tests/test_permissions.py -q -k "clinical_and_scoring or legacy_pharmacist"`
Expected: 2 failed (`KeyError`/`AssertionError`).

- [ ] **Step 3: Add the keys and the legacy rows**

In `permissions.py`, insert after `"devices.manage"` in the catalogue (order matters: the dashboard parity test compares order):

```python
    "clinical.chart": "Chart clinician-observed inputs (infection suspicion, pressor, fluids, "
                      "GCS…) and the patient's own baseline",
    "scores.sign": "Sign a severity-score form (SOFA) with corrections",
```

Add `"clinical.chart"` to the permission sets of `attending`, `unit_physician`, `physician`, `charge_nurse`, `nurse`, `rapid_response`; add `"scores.sign"` to `attending`, `unit_physician`, `physician`. (`hospital_admin` holds the whole catalogue by rule — no edit.)

Extend `LEGACY_ROLE_TO_GROUP`:

```python
    "PHARMACIST": "pharmacist",
    "BIOMEDICAL": "biomedical",
```

- [ ] **Step 4: Renumber the migration**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
git mv alembic/versions/0006_groups_and_permissions.py alembic/versions/0010_groups_and_permissions.py
```
In the moved file set:

```python
revision: str = "0010"
down_revision: Union[str, None] = "0009"
```
and change the docstring's first line to say `Revision 0010, follows 0009 (renumbered from an undeployed 0006 when main's 0006–0009 were merged in).`

In its **frozen** default-group copy (the literal sets the migration seeds, lines ≈58–116 before the move), add the same two keys to the same groups as Step 3, and add `PHARMACIST → pharmacist`, `BIOMEDICAL → biomedical` to its frozen legacy map. The migration must not import the live `permissions.py` — keep it a literal.

Then the four migration test files of the groups migration follow it:

```bash
cd /c/tmp/homunculus-g1/homunculus-engine/tests
for s in conversion defaults orm_writes schema_parity; do
  git mv test_migration_0006_$s.py test_migration_0010_$s.py
done
grep -n '"0005"\|"0006"' test_migration_0010_*.py test_audit_postgres.py
```
In the four renamed files: every `"0006"` (the groups revision) becomes `"0010"`, and every `"0005"` that means *the revision just before the groups migration* becomes `"0009"` (they upgrade to the parent, seed legacy memberships, then upgrade to the groups revision). In `test_migration_0010_conversion.py` add one legacy member with role `PHARMACIST` and one with `BIOMEDICAL` to the seeded set and assert they land in `pharmacist` / `biomedical` — the `userrole` enum holds both values from `main`'s 0007 on. Hits in `test_audit_postgres.py` refer to `main`'s audit revisions: leave them.

The frozen-snapshot test (`test_migration_0010_defaults.py`, which pins the migration's literal defaults, spec §10) gets the two keys in its snapshot too.

- [ ] **Step 5: Dashboard parity and labels**

`dashboard/src/permissions.js`: add `"clinical.chart"` and `"scores.sign"` at the same position as in `permissions.py`, and to the same default groups. `dashboard/src/clinicalI18n.js`, in each language's `rbac.perm` block:

| key | tr | az | en | ru |
|---|---|---|---|---|
| `clinical.chart` | Klinik veri girişi | Klinik məlumat daxil etmə | Clinical charting | Ввод клинических данных |
| `scores.sign` | Skor formunu imzalama | Şkala formasını imzalama | Sign severity scores | Подпись шкал тяжести |

- [ ] **Step 6: Run the tests**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_permissions.py tests/test_migration_0010_*.py -q
cd ../dashboard && npx vitest run src/permissions.test.js src/i18n.rbac.test.js
```
Expected: all pass. The migration tests need `TEST_DATABASE_URL` exported (Task 0 Step 4); without it they skip, which is NOT a pass — check the summary says `passed`, not `skipped`.

- [ ] **Step 7: Stage**

```bash
cd /c/tmp/homunculus-g1
git add -A homunculus-engine/alembic/versions homunculus-engine/src/homunculus/auth/permissions.py \
        homunculus-engine/tests dashboard/src/permissions.js dashboard/src/clinicalI18n.js
```

---

### Task 4 (G1-02c): `main`'s role-based code onto permissions

Two files from `main` still speak roles: the staff-scope package and the Infinity research router. They merge cleanly as text and break at import.

**Files:**
- Modify: `homunculus-engine/src/homunculus/scope/service.py` (`read_role`)
- Modify: `homunculus-engine/src/homunculus/scope/router.py:20-29`
- Modify: `homunculus-engine/src/homunculus/api/infinity_research.py:22-23,106`
- Test: `homunculus-engine/tests/test_scope_role_from_groups.py` (new)

`scope/rules.py` stays as written: it compares a role *string* with `SCOPE_UNRESTRICTED_ROLES = {"HOSPITAL_ADMIN", "PLATFORM_SUPPORT"}`. Only the reader changes: the string now comes from groups (decision D5 — unrestricted = member of the system group `hospital_admin`, or the platform operator flag).

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_scope_role_from_groups.py
"""Scope's notion of an unrestricted user, read from groups instead of the retired role column.

Before the LDAP merge `scope.service.read_role` read `tenant_memberships.role`. After migration
0010 that column is NULL for every membership created by `/admin`, so reading it would scope an
administrator like a nurse — and an empty-scoped administrator cannot fix anyone's scope.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.scope import service
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


# Same shape as tests/test_admin_api.py::_make_user (kept local, as that file keeps it).
async def _make_user(db, tenant, groups, username, group_slug, **kw):
    u = User(username=username, email=f"{username}@example.com", full_name=username.title(),
             hashed_password=hash_password("Gizli-123"), **kw)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
    await db.flush()
    if group_slug:
        await set_manual_groups(db, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
    return u


@pytest_asyncio.fixture
async def world(db_session):
    t = Tenant(name="Demo", slug="demo-hastanesi", country_code="TR")
    other = Tenant(name="Other", slug="other", country_code="TR")
    db_session.add_all([t, other])
    await db_session.flush()
    groups = await ensure_default_groups(db_session, t.id)
    other_groups = await ensure_default_groups(db_session, other.id)
    world = {
        "admin": await _make_user(db_session, t, groups, "admin", "hospital_admin"),
        "nurse": await _make_user(db_session, t, groups, "ayse", "nurse"),
        "operator": await _make_user(db_session, t, groups, "destek", None,
                                     is_platform_support=True),
        "stranger": await _make_user(db_session, other, other_groups, "yabanci", "nurse"),
    }
    await db_session.commit()
    return world


async def test_hospital_admin_member_reads_as_hospital_admin(db_session, world):
    assert await service.read_role(db_session, world["admin"].id) == "HOSPITAL_ADMIN"


async def test_platform_operator_reads_as_platform_support(db_session, world):
    assert await service.read_role(db_session, world["operator"].id) == "PLATFORM_SUPPORT"


async def test_plain_member_reads_as_member(db_session, world):
    assert await service.read_role(db_session, world["nurse"].id) == "MEMBER"


async def test_no_active_membership_reads_as_none(db_session, world):
    await db_session.execute(update(TenantMembership)
                             .where(TenantMembership.user_id == world["nurse"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert await service.read_role(db_session, world["nurse"].id) is None


async def test_unknown_user_reads_as_none(db_session):
    assert await service.read_role(db_session, uuid.uuid4()) is None


@pytest_asyncio.fixture
async def client(db_session):
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _headers(db, user):
    tokens = issue_tokens(user, await build_context(db, user), mfa_verified=True)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.mark.parametrize("method", ["GET", "PUT"])
async def test_scope_of_another_tenants_user_is_not_found(db_session, world, client, method):
    headers = await _headers(db_session, world["admin"])
    body = {"grants": []} if method == "PUT" else None   # scope/schemas.py ScopeAssignment
    r = await client.request(method, f"/scope/{world['stranger'].id}", json=body, headers=headers)
    assert r.status_code == 404, r.text


async def test_scope_admin_routes_need_users_manage(db_session, world, client):
    headers = await _headers(db_session, world["nurse"])
    r = await client.get(f"/scope/{world['admin'].id}", headers=headers)
    assert r.status_code == 403, r.text
```

(`PUT /scope/{user_id}` takes `ScopeAssignment {grants: [ScopeGrantIn{unit_id, bed_id}]}`; an empty list is enough to reach the tenant check.)

- [ ] **Step 2: Run it to see it fail**

Run: `PYTHONPATH=src "$PY" -m pytest tests/test_scope_role_from_groups.py -q`
Expected: FAIL — `read_role` returns the legacy column (`None` for new users) or raises on the removed enum.

- [ ] **Step 3: Rewrite `read_role`**

Replace the body of `read_role` in `scope/service.py` (keep its signature and docstring's first paragraph; replace the rest):

```python
async def read_role(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """The user's scope class: "HOSPITAL_ADMIN", "PLATFORM_SUPPORT", "MEMBER" or None.

    Read from groups since the LDAP/RBAC merge (migration 0010 leaves `tenant_memberships.role`
    NULL for new accounts). Unrestricted means the system group `hospital_admin` in an active
    membership's tenant, or the platform-operator flag — the same two people as before.
    None = no active membership: `build_scope` treats that as unknown, never as unrestricted.
    """
    from homunculus.auth.models import Group, TenantMembership, User, UserGroup

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    if user.is_platform_support:
        return "PLATFORM_SUPPORT"
    tenants = (await db.execute(
        select(TenantMembership.tenant_id).where(
            TenantMembership.user_id == user_id, TenantMembership.is_active.is_(True))
    )).scalars().all()
    if not tenants:
        return None
    admin = (await db.execute(
        select(UserGroup.id).join(Group, Group.id == UserGroup.group_id).where(
            UserGroup.user_id == user_id, Group.slug == "hospital_admin",
            Group.tenant_id.in_(tenants)).limit(1)
    )).first()
    return "HOSPITAL_ADMIN" if admin else "MEMBER"
```
Check the column names against `auth/models.py` (`TenantMembership.is_active`, `UserGroup.group_id`, `Group.slug`, `Group.tenant_id`) and adjust to the real ones.

- [ ] **Step 4: `scope/router.py` onto permissions**

```python
from homunculus.auth.dependencies import get_current_user, require_permission
from homunculus.auth.models import TenantMembership, User

# Assigning staff to units and beds is user management (roadmap D5).
_admin = Depends(require_permission("users.manage"))
```
Delete the `UserRole` import. Then make every `/scope/{user_id}` route refuse a target outside the caller's tenant: read the caller's tenant with the LDAP branch's `caller_tenant_id` dependency (`auth/dependencies.py:168`) and compare it with `_tenant_of(db, user_id)`'s tenant; on mismatch raise `HTTPException(404, "kullanıcı bulunamadı")` (404, not 403: a 403 confirms the account exists elsewhere). The two HTTP tests at the end of Step 1 cover this.

- [ ] **Step 5: `api/infinity_research.py` onto permissions**

Replace the `require_roles` / `UserRole` imports and the dependency at line ≈106:

```python
from homunculus.auth.dependencies import require_permission

_device_staff = Depends(require_permission("devices.manage"))
```
and use `_device_staff` where the route used the role dependency. Then:

```bash
grep -rn "require_roles\|UserRole" homunculus-engine/src
```
Expected: no output. Every remaining hit is a bug to fix the same way (permission chosen by what the route does; if unsure, STOP and ask).

- [ ] **Step 6: Run**

```bash
PYTHONPATH=src "$PY" -m pytest tests/test_scope_role_from_groups.py tests/test_scope*.py tests/test_infinity_research_api.py -q
```
Expected: all pass. A `main` scope test that built a membership with `role=UserRole.X` is updated to build a group membership instead (same fixture as Step 1).

- [ ] **Step 7: Stage**

```bash
git add homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/api/infinity_research.py homunculus-engine/tests
```

---

### Task 5 (G1-02d): `app.py` and `prodserver.py` — one caller, scope on top; merge commit

The LDAP branch resolves every board request to a `Caller` (`_caller`, permissions in the token). `main` resolves to a hospital (`_hospital`) and then a `Scope` (`_scope`, `_require_patient`). After the merge, **`_hospital` no longer exists**; every route takes the LDAP shape and adds `main`'s scope checks.

Resolution rules, hunk by hunk (line numbers are from the trial merge tree `662aabad…`):

| Hunk (approx. line) | Resolution |
|---|---|
| `create_app` parameters (118) | Keep `resolve_jwt` (LDAP) **and** `bedmap`, `resolve_scope` (main). Drop `resolve_jwt_hospital`: `resolve_jwt` already yields the hospital as `Caller.hospital`. |
| docstring (129) | Keep both paragraphs, minus the `resolve_jwt_hospital` sentence. |
| router imports (285) and `include_router` (300) | Keep all three: `admin_router`, `scope_router`, `infinity_research_router`. |
| helpers (373) | Keep LDAP `_require` and `_attribution`, **and** main's `_UNSCOPED`, `_scope`, `_require_patient`. Change `_require_patient(authorization, hospital, patient_id)` to `_require_patient(caller, authorization, patient_id)` and read `hospital = caller.hospital` inside. Replace main's `_charted_by(authorization)` with: `return "tenant-token" if caller.is_device else caller.actor` (signature `_charted_by(caller)`). |
| `/clinical` POST, `/clinical/{id}/profile` PUT (458–545) | `caller = await _caller(authorization)`; `_require(caller, CLINICAL_CHART)`; `hospital = caller.hospital`; `await _require_patient(caller, authorization, patient_id)`; `charted_by=_charted_by(caller)`. Rest of main's body unchanged. |
| `/ack` (618) | LDAP's `who = _attribution(caller, body)` **then** `await _require_patient(caller, authorization, str(patient_id or ""))`. |
| `/view` (642) | `await _require_patient(caller, authorization, str(patient_id or ""))` then LDAP's audit append with `_attribution(caller, body)`. |
| `/patients` (664) | LDAP's caller + `_require(caller, BOARD_VIEW)`; body from main (`apply_scope`, `bedmap=bedmap`, the blind-board log line, `scope` and `scope_note` in the response) with `hospital = caller.hospital`. |
| `/alerts/{id}` (701) | caller + `BOARD_VIEW` + `await _require_patient(caller, authorization, patient_id)`. Delete the duplicated `@app.get("/alerts/{patient_id}")` the hunk leaves behind — exactly one definition. |
| `/stream-ticket` (711) | caller + `BOARD_VIEW`; `scope = await _scope(authorization)`; `tickets.issue(caller.hospital, now=time.monotonic(), scope=scope)`. |
| `/audit` (779) | caller + `_require(caller, AUDIT_VIEW)`; then main's patient / whole-trail scope rule with `hospital = caller.hospital`. |

Then the **non-conflicting** routes from `main` that still call `_hospital` (they merged as text):

| Route | Permission |
|---|---|
| `GET /scores/sofa/{id}` | `BOARD_VIEW` + `_require_patient` |
| `POST /scores/sofa/{id}` | `SCORES_SIGN` + `_require_patient`; the signer is `caller.actor` |
| `GET /alarm-quality` | `AUDIT_VIEW` |
| `GET /audit/verify` | `AUDIT_VIEW` |

Define the constants next to the existing `BOARD_VIEW` / `ALERTS_ACK` / `AUDIT_VIEW` ones:

```python
CLINICAL_CHART = "clinical.chart"
SCORES_SIGN = "scores.sign"
```

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py`
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py`
- Test: `homunculus-engine/tests/test_merge_permissions.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_merge_permissions.py
"""Routes that arrived from main are permission-gated like every LDAP-branch route.

Each case: a JWT caller WITHOUT the permission gets 403; WITH it, not 403. Uses the injected
`resolve_jwt` hook, so no database is needed.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller

pytestmark = pytest.mark.asyncio

HOSPITAL = "h1"


def _app(perms: set[str]):
    async def resolve_jwt(token: str):
        return Caller(hospital=HOSPITAL, actor="u1", groups=("g",), perms=frozenset(perms))
    return create_app({"dev-token": HOSPITAL}, run_escalation_loop=False,
                      resolve_jwt=resolve_jwt)


CASES = [
    ("POST", "/clinical/p1", {"entries": []}, "clinical.chart"),
    ("PUT", "/clinical/p1/profile", {}, "clinical.chart"),
    ("GET", "/scores/sofa/p1", None, "board.view"),
    ("POST", "/scores/sofa/p1", {"overrides": []}, "scores.sign"),
    ("GET", "/alarm-quality", None, "audit.view"),
    ("GET", "/audit/verify", None, "audit.view"),
]


@pytest.mark.parametrize("method,path,body,perm", CASES)
async def test_refused_without_permission(method, path, body, perm):
    async with AsyncClient(transport=ASGITransport(app=_app(set())), base_url="http://t") as c:
        r = await c.request(method, path, json=body, headers={"Authorization": "Bearer jwt"})
    assert r.status_code == 403, (path, r.status_code, r.text)


@pytest.mark.parametrize("method,path,body,perm", CASES)
async def test_admitted_with_permission(method, path, body, perm):
    async with AsyncClient(transport=ASGITransport(app=_app({perm, "board.view"})),
                           base_url="http://t") as c:
        r = await c.request(method, path, json=body, headers={"Authorization": "Bearer jwt"})
    assert r.status_code != 403, (path, r.status_code, r.text)
```

(`create_app(tenants, *, …)` takes the token→hospital map positionally; `run_escalation_loop=False` keeps the background task out of the test.)

- [ ] **Step 2: Resolve `app.py` by the tables above**

Work hunk by hunk. When done:

```bash
grep -n "<<<<<<<\|>>>>>>>\|_hospital(" homunculus-engine/src/homunculus/api/app.py
grep -c '@app.get("/alerts/{patient_id}")' homunculus-engine/src/homunculus/api/app.py
```
Expected: no output from the first; `1` from the second.

- [ ] **Step 3: Resolve `prodserver.py`**

Imports: keep the LDAP block **and** `from homunculus.tenant.bedmap import BedMap`; keep `unmatched_hospital_keys`; drop `hospital_for_slugs` only if nothing else uses it (`grep -n hospital_for_slugs src -r`). The `create_app(...)` call:

```python
    resolve_jwt=make_jwt_caller_resolver(_read_user_auth),
    bedmap=_bedmap(),
    resolve_scope=_scope_resolver(),
```
Delete `make_jwt_hospital_resolver` and `_read_tenant_slugs` if they are now unused (`grep -n` them first).

- [ ] **Step 4: Run the new test and the whole API suite**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest tests/test_merge_permissions.py -q
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -15
```
Expected: the new test 12 passed. Whole suite: every failure is either the known PS1 test or a `main` test that calls `create_app(resolve_jwt_hospital=…)` / builds a role-based caller. Fix those tests by passing `resolve_jwt` returning a `Caller` with the permissions the route needs — never by loosening a route.

- [ ] **Step 5: Stage and commit the merge**

```bash
cd /c/tmp/homunculus-g1
git add homunculus-engine
git diff --name-only --diff-filter=U
```
Expected: only `dashboard/…` paths remain unmerged — the backend is done. Do **not** commit yet; Task 6 finishes the dashboard and makes the single merge commit.

---

### Task 6 (G1-02e): Dashboard — both API surfaces, the LDAP `ClinicalDemo`, and the merge commit

**Files:**
- Resolve: `dashboard/src/backendApi.js`, `dashboard/src/liveStore.js`, `dashboard/src/ClinicalDemo.jsx`
- Remove: `main` tests that render `main`'s `ClinicalDemo` (list below)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (inventory)

- [ ] **Step 1: `backendApi.js` — keep both blocks**

Keep the LDAP block (`changePassword`, `admin*`) **followed by** `main`'s block (`chart`, `audit`, `alarmQuality`, `severityForm`, `signSeverityForm`, `verifyAudit`, `setProfile`). Two orphan JSDoc comments in `main`'s block describe no function (the `setProfile` and `verifyAudit` docs sit above other methods): move each onto the method it describes.

- [ ] **Step 2: `liveStore.js` — keep both blocks**

Keep the LDAP admin block (`adminLoadSeq` … `restoresInFlight`) **followed by** `main`'s (`splitComorbidities`, `auditRowFromRecord`, `refreshAudit`, `chart`). Then make sure the returned store object exports both sets: `grep -n "refreshAudit\|loadAdmin\|chart," dashboard/src/liveStore.js`.

- [ ] **Step 3: `ClinicalDemo.jsx` — LDAP version**

```bash
git checkout --ours dashboard/src/ClinicalDemo.jsx
git add dashboard/src/ClinicalDemo.jsx
```
Rationale (roadmap D1): the simulation is removed in G1-16 and the live UI moves to the new shell; porting `main`'s 2 000-line rewrite into a file that is about to be deleted buys nothing.

- [ ] **Step 4: Remove the tests of `main`'s `ClinicalDemo`, and record what they protected**

These 12 files exercise screens of `main`'s `ClinicalDemo` that the LDAP version does not have:

```
admissionFromHis.test.jsx  admissionScreen.test.jsx  biomedicalAccess.test.jsx
escalationClock.test.jsx   loginRemember.test.jsx    news2Honesty.test.jsx
news2Source.test.jsx       patientBaseline.test.jsx  pharmacyView.test.jsx
rrtPage.test.jsx           setupWizardScope.test.jsx simulationGating.test.jsx
```

For each, before deleting: read its `describe`/`it` titles and add one line per behaviour to the roadmap under a new heading **"Main'den gelen ve yeni kabukta karşılanacak davranışlar"**, tagged with the Group-1 ticket or Group-2/3/4 that will rebuild it (e.g. `escalationClock — alarm süresi sunucu saatiyle → G1-10`). Then:

```bash
cd /c/tmp/homunculus-g1/dashboard/src
git rm -q admissionFromHis.test.jsx admissionScreen.test.jsx biomedicalAccess.test.jsx \
  escalationClock.test.jsx loginRemember.test.jsx news2Honesty.test.jsx news2Source.test.jsx \
  patientBaseline.test.jsx pharmacyView.test.jsx rrtPage.test.jsx setupWizardScope.test.jsx \
  simulationGating.test.jsx
```

Keep `main`'s pure modules and their tests (`patientScope`, `rrtQueue`, `alarmDensity`, `feedHealth`, `patientLabel`, `clinicalCharting`, `auditFromEngine`, `sepsisContext`, `scopeAssignment`, `severityScore`, `alarmQualityPanel`, `auditIntegrity`, `policySettings`, `InfinityBeds`): the new shell will reuse them. If one of them fails only because it imports something `main`'s `ClinicalDemo` exported, delete that test too and record it the same way.

- [ ] **Step 5: Run the dashboard suite**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run 2>&1 | tail -6
```
Expected: 0 failed. A failure in `liveAdapters.test.js` / `liveAuth.test.js` (merged on both sides) is fixed in the test only if the test asserts `main`'s role mapping, which the LDAP model replaced; otherwise fix the code.

- [ ] **Step 6: Build**

```bash
npx vite build 2>&1 | tail -3
```
Expected: `built in …`, no errors.

- [ ] **Step 7: Commit the merge**

```bash
cd /c/tmp/homunculus-g1
git add -A dashboard docs
git diff --name-only --diff-filter=U    # expect: empty
git commit -m "merge: origin/main (2f3544a) into the LDAP/RBAC branch

Permission model wins everywhere; main's features stay on top of it:
- migrations: LDAP 0006 renumbered to 0010 (follows main's 0006-0009)
- clinical.chart and scores.sign join the catalogue (main's /clinical and /scores routes)
- staff scope reads 'unrestricted' from the hospital_admin group; /scope/* on users.manage
- infinity research on devices.manage
- app.py: one Caller per request, main's scope checks on every patient route
- dashboard: both API surfaces; LDAP ClinicalDemo (demo is removed in G1-16, roadmap D1);
  12 tests of main's ClinicalDemo removed, their behaviours listed in the roadmap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7 (G1-02f): Whole-branch verification

**Files:** none (fixes, if any, go in their own commits).

- [ ] **Step 1: Full backend suite**

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
PYTHONPATH=src "$PY" -m pytest -q -p no:cacheprovider 2>&1 | tail -5
```
Expected: 0 failed except `test_infinity_vm_pilot` (known). Record the count.

- [ ] **Step 2: Migrations from empty, and from main's head**

```bash
PYTHONPATH=src "$PY" -m pytest -q tests -k "migration or alembic" 2>&1 | tail -5
```
Expected: pass, including `main`'s single-head / single-root / whole-chain assertions. If the repo has no test that upgrades a database already at `0009` to `0010`, add one (mirror the LDAP branch's B1 real-migration test, starting from `0009`): the VM's database will take exactly that path.

- [ ] **Step 3: Full dashboard suite + build**

```bash
cd ../dashboard && npx vitest run 2>&1 | tail -4 && npx vite build 2>&1 | tail -2
```
Expected: 0 failed; build ok.

- [ ] **Step 4: No role code left**

```bash
cd /c/tmp/homunculus-g1
grep -rn "require_roles\|UserRole\b" homunculus-engine/src dashboard/src
```
Expected: no output.

- [ ] **Step 5: Update the roadmap status and commit**

In the roadmap's Group-1 table set G1-01 and G1-02 to `✅ <date> · <commit>` and add the measured test counts under the table.

```bash
git add docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git commit -m "docs(plan): Wave 0 done — main and LDAP reconciled, counts recorded

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (writer's)

- **Spec coverage:** roadmap blockers 1–4 → Tasks 2–6; blocker 5 (staff scope exists) → kept and converted in Task 4; nginx → Task 1.
- **Where this plan cannot give final code:** the per-hunk merge edits in Tasks 5–6 are given as resolution rules, not full text, because the hunks are hundreds of lines of existing code that is kept, not written. The rules name each hunk, the side kept, and the exact replacements.
- **Fixtures** in Task 4 copy the pattern of `tests/test_admin_api.py` (`db_session` from `conftest.py`, a local `_make_user`, `ensure_default_groups`, `set_manual_groups`, `issue_tokens`); the `PUT /scope` body follows `scope/schemas.py::ScopeAssignment`.
- **Not in this wave:** the new shell, LDAP Plan 2, any UI. The VM is not touched.
