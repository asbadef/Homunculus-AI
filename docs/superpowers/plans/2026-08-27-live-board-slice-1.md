# Live Board — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinician opens the dashboard on the hospital VM, logs in with their real account, and watches real device vitals and alerts arrive on the polished clinical board — or reads an honest statement that nothing is flowing.

**Architecture:** The engine's hospital key becomes the tenant slug, which both credentials already reach — the bridge through its configured token, a user through their tenant membership. Board routes accept either. SSE gets a short-lived single-use ticket instead of a credential in the URL. On the frontend, an adapter maps the API's board payload onto the patient shape `ClinicalDemo` already renders, filling only the machine-fed fields and leaving the human-entered ones explicitly empty.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, pytest; React + Vite, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-live-board-auth-bridge-design.md`

---

## Before you start

**The division of labour this slice assumes.** Device data (vitals, alerts, risk) arrives automatically. Clinical context (name, room, bed, care team, medication) is typed in by clinicians. This slice delivers **only the machine-fed half**. Human-entered fields must render as visibly empty — never as an invented value, and never as a leftover from the simulation.

**Where it runs.** The stack is on the hospital's Ubuntu VM at `172.100.101.72:8080` (Docker Compose, `deploy/local/`). Docker is not available on the Windows dev machine, so Task 11 — the only end-to-end check — is performed on that VM.

**Both suites are green now** (backend 317 passed / 40 skipped, frontend 194 passed). Keep them that way.

## File structure

| File | Responsibility |
| --- | --- |
| `homunculus-engine/src/homunculus/api/identity.py` | **New.** Deterministic hospital-key choice, and the slug-mismatch check. Pure functions, no I/O. |
| `homunculus-engine/src/homunculus/api/tickets.py` | **New.** Short-lived single-use SSE tickets. Pure, clock injected. |
| `homunculus-engine/src/homunculus/api/app.py` | Wire the resolver, the startup check and the ticket endpoint into the routes. |
| `homunculus-engine/src/homunculus/api/board.py` | Surface the vitals the engine already holds but does not publish. |
| `dashboard/src/liveAdapters.js` | **New.** API board payload → the patient shape `ClinicalDemo` renders. |
| `dashboard/src/liveStore.js` | Extend past authentication: real patients, alerts, ack, SSE, connection state. |
| `dashboard/src/main.jsx` | Root becomes live; the demo banner appears only in demo mode. |

---

### Task 1: Deterministic hospital key for a multi-tenant user

**Files:**
- Create: `homunculus-engine/src/homunculus/api/identity.py`
- Test: `homunculus-engine/tests/test_identity.py`

- [ ] **Step 1: Write the failing test**

```python
"""Which hospital a request belongs to.

The engine keys its state by a hospital string; a logged-in user belongs to one or more tenants.
These are the pure decisions in that mapping — kept out of the request handlers so they can be
tested without a database.
"""
from __future__ import annotations

from homunculus.api.identity import hospital_for_slugs, unmatched_hospital_keys


def test_no_membership_means_no_hospital():
    assert hospital_for_slugs([]) is None


def test_a_single_membership_resolves_to_it():
    assert hospital_for_slugs(["demo-hastanesi"]) == "demo-hastanesi"


def test_several_memberships_resolve_deterministically():
    """Lowest slug, always the same one.

    A user who lands on the wrong hospital's board must land on the *same* wrong board every
    time — an intermittent one is a bug nobody can report or reproduce.
    """
    assert hospital_for_slugs(["kardiyoloji", "acil", "yogun-bakim"]) == "acil"
    assert hospital_for_slugs(["yogun-bakim", "acil", "kardiyoloji"]) == "acil"


def test_configured_keys_matching_no_tenant_are_reported():
    """The silent failure this catches: the bridge writes to a hospital key no user can read,
    so observations arrive, alerts fire, and every screen stays empty with nothing complaining."""
    assert unmatched_hospital_keys(["HOSP1"], ["demo-hastanesi"]) == ["HOSP1"]
    assert unmatched_hospital_keys(["demo-hastanesi"], ["demo-hastanesi"]) == []
    assert unmatched_hospital_keys([], ["demo-hastanesi"]) == []


def test_unmatched_keys_are_reported_in_a_stable_order():
    assert unmatched_hospital_keys(["b", "a"], []) == ["a", "b"]
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_identity.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.identity'`

- [ ] **Step 3: Implement**

Create `homunculus-engine/src/homunculus/api/identity.py`:

```python
# src/homunculus/api/identity.py
"""Which hospital a request belongs to.

Two credentials reach the clinical routes: the bridge's static tenant token, and a clinician's
JWT. They meet because the engine's hospital key *is* the tenant slug — so the bridge is
configured with the slug, and a user resolves to theirs through their membership. No second
mapping table to drift out of step with the first.

These functions are pure so the decisions can be tested without a database; the queries that feed
them live in app.py.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence


def hospital_for_slugs(slugs: Sequence[str]) -> str | None:
    """The hospital key for a user's tenant memberships.

    A user with several memberships gets the lowest slug, always. Deterministic rather than
    arbitrary: someone seeing the wrong hospital's board must see the same wrong board every
    time, or the fault cannot be reproduced or reported.
    """
    return min(slugs) if slugs else None


def unmatched_hospital_keys(configured: Iterable[str], known_slugs: Iterable[str]) -> list[str]:
    """Configured TENANTS hospital keys that match no tenant slug.

    This catches a failure with no symptoms: the bridge writes observations under a key no user
    can ever resolve to, so data arrives, alerts fire, escalations run — and every screen stays
    empty, with nothing anywhere reporting a problem.
    """
    known = set(known_slugs)
    return sorted({key for key in configured if key not in known})
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_identity.py -v`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/identity.py homunculus-engine/tests/test_identity.py
git commit -m "feat(api): deterministic hospital key, and a check for keys that match no tenant"
```

---

### Task 2: Board routes accept a JWT as well as the tenant token

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py`
- Test: `homunculus-engine/tests/test_dual_credentials.py`

`create_app` gains one optional argument so the JWT path can be exercised without a database. Read `create_app`'s current signature first — it is `(tenants, *, escalate_after, escalate_interval, run_escalation_loop, audit)`.

- [ ] **Step 1: Write the failing test**

```python
"""The clinical routes must accept either credential.

The bridge authenticates with a static tenant token. A clinician authenticates with a JWT. Both
have to reach the same engine, and anything else has to be refused — the tenant token also
authorises /ingest, so it can never be handed to a browser.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app


@pytest.fixture
def client():
    async def fake_jwt_hospital(token: str) -> str | None:
        # Stands in for: decode JWT -> load user -> membership -> tenant slug.
        return "demo-hastanesi" if token == "valid-jwt" else None

    app = create_app(
        {"bridge-token": "demo-hastanesi"},
        run_escalation_loop=False,
        resolve_jwt_hospital=fake_jwt_hospital,
    )
    with TestClient(app) as c:
        yield c


def test_the_bridge_token_still_works(client):
    res = client.get("/patients", headers={"Authorization": "Bearer bridge-token"})
    assert res.status_code == 200


def test_a_jwt_reaches_the_same_board(client):
    res = client.get("/patients", headers={"Authorization": "Bearer valid-jwt"})
    assert res.status_code == 200


def test_an_unknown_credential_is_refused(client):
    assert client.get("/patients", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_a_missing_credential_is_refused(client):
    assert client.get("/patients").status_code == 401


def test_ingest_also_accepts_both(client):
    """Same resolver everywhere: one place decides who a caller is."""
    observation = {
        "resourceType": "Observation",
        "status": "final",
        "code": {"coding": [{"system": "http://loinc.org", "code": "8867-4"}]},
        "subject": {"reference": "Patient/bed-3"},
        "effectiveDateTime": "2026-08-27T10:00:00Z",
        "valueQuantity": {"value": 96, "unit": "/min"},
    }
    assert client.post("/ingest", json=observation,
                       headers={"Authorization": "Bearer bridge-token"}).status_code == 200
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_dual_credentials.py -v`
Expected: FAIL — `create_app() got an unexpected keyword argument 'resolve_jwt_hospital'`

- [ ] **Step 3: Implement**

In `homunculus-engine/src/homunculus/api/app.py`, add the parameter to `create_app`'s signature (keyword-only, alongside `audit`):

```python
    resolve_jwt_hospital: Callable[[str], Awaitable[str | None]] | None = None,
```

Add `from collections.abc import Awaitable, Callable` to the imports if not already present.

Then replace the two helpers (currently around line 175) with:

```python
    def _tenant_from_token(token: str | None) -> str:
        hospital = tenants.get(token or "")
        if hospital is None:
            raise HTTPException(status_code=401, detail="unknown tenant token")
        return hospital

    async def _hospital(authorization: str | None) -> str:
        """Resolve the caller's hospital from either credential.

        The static token is tried first: it is the device path, and it must not depend on the
        database being reachable for authentication. Only then is the value treated as a JWT.
        """
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        credential = authorization.split(" ", 1)[1]

        hospital = tenants.get(credential)
        if hospital is not None:
            return hospital

        if resolve_jwt_hospital is not None:
            hospital = await resolve_jwt_hospital(credential)
            if hospital is not None:
                return hospital

        raise HTTPException(status_code=401, detail="unknown credential")
```

Then change every board route that calls `_tenant(authorization)` to `await _hospital(authorization)`: `/ingest`, `/ack`, `/view`, `/patients`, `/alerts/{patient_id}`, `/audit`. Routes declared `def` must become `async def` — `/view`, `/patients`, `/alerts/{patient_id}`, `/audit`. Leave `/health` alone; it is unauthenticated on purpose.

Leave `_tenant_from_token` in place: `/stream` and `/notifications` still use it for the `?token=` path (Task 5 adds tickets alongside it).

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_dual_credentials.py -v`
Expected: PASS — 5 tests

- [ ] **Step 5: Run the whole backend suite**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest -q`
Expected: 322 passed, 40 skipped. If an existing test broke because a route became `async`, fix the test — do not revert the route.

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_dual_credentials.py
git commit -m "feat(api): clinical routes accept a clinician's JWT as well as the bridge token"
```

---

### Task 3: Resolve the JWT against the database

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py`
- Test: `homunculus-engine/tests/test_jwt_hospital_lookup.py`

Task 2 made the lookup injectable. This supplies the real one.

- [ ] **Step 1: Write the failing test**

```python
"""The real JWT -> hospital lookup, with the database faked out.

The query itself needs Postgres and is covered by the deployment check in Task 11; what is worth
testing here is the decision logic around it — a bad token, a user with no membership, and the
multi-membership case all have to behave predictably.
"""
from __future__ import annotations

import pytest

from homunculus.api.prodserver import make_jwt_hospital_resolver


class _FakeSessionMaker:
    def __init__(self, slugs):
        self._slugs = slugs

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def slugs_for_user(self, _user_id):
        return self._slugs


@pytest.mark.anyio
async def test_an_undecodable_token_is_not_a_hospital():
    resolve = make_jwt_hospital_resolver(_FakeSessionMaker([]), decode=lambda _t: None)
    assert await resolve("not-a-jwt") is None


@pytest.mark.anyio
async def test_a_user_with_no_membership_is_not_a_hospital():
    resolve = make_jwt_hospital_resolver(_FakeSessionMaker([]),
                                         decode=lambda _t: "11111111-1111-1111-1111-111111111111")
    assert await resolve("valid") is None


@pytest.mark.anyio
async def test_the_lowest_slug_wins():
    resolve = make_jwt_hospital_resolver(_FakeSessionMaker(["kardiyoloji", "acil"]),
                                         decode=lambda _t: "11111111-1111-1111-1111-111111111111")
    assert await resolve("valid") == "acil"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_jwt_hospital_lookup.py -v`
Expected: FAIL — `ImportError: cannot import name 'make_jwt_hospital_resolver'`

- [ ] **Step 3: Implement**

In `homunculus-engine/src/homunculus/api/prodserver.py`, add:

```python
def make_jwt_hospital_resolver(session_maker, *, decode=None):
    """Build the JWT -> hospital-key lookup the clinical routes use.

    `decode` and `session_maker` are injected so the decision logic can be tested without a
    database or a signing key.
    """
    import logging
    import uuid as _uuid

    from homunculus.api.identity import hospital_for_slugs

    log = logging.getLogger(__name__)

    if decode is None:
        def decode(token: str) -> str | None:
            from jose import JWTError

            from homunculus.auth.jwt import decode_token
            try:
                payload = decode_token(token)
            except JWTError:
                return None
            if payload.get("type") != "access":
                return None
            return payload.get("sub")

    async def resolve(token: str) -> str | None:
        user_id = decode(token)
        if not user_id:
            return None
        async with session_maker() as session:
            slugs = await session.slugs_for_user(_uuid.UUID(str(user_id)))
        hospital = hospital_for_slugs(sorted(slugs))
        if hospital and len(slugs) > 1:
            log.info("user %s belongs to %d tenants; resolved to %r", user_id, len(slugs), hospital)
        return hospital

    return resolve
```

Add a real session maker that implements `slugs_for_user`, and pass the resolver into `create_app`:

```python
class _TenantSlugSession:
    """Thin wrapper so the resolver's collaborator is one small, nameable method."""

    def __init__(self, session):
        self._session = session

    async def slugs_for_user(self, user_id):
        from sqlalchemy import select

        from homunculus.auth.models import TenantMembership
        from homunculus.tenant.models import Tenant

        result = await self._session.execute(
            select(Tenant.slug)
            .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
            .where(TenantMembership.user_id == user_id)
        )
        return list(result.scalars().all())


class _SlugSessionMaker:
    def __call__(self):
        return self

    async def __aenter__(self):
        from homunculus.db import AsyncSessionLocal

        self._ctx = AsyncSessionLocal()
        return _TenantSlugSession(await self._ctx.__aenter__())

    async def __aexit__(self, *exc):
        return await self._ctx.__aexit__(*exc)


app = create_app(
    _parse_tenants(os.getenv("TENANTS")),
    audit=_audit(),
    resolve_jwt_hospital=make_jwt_hospital_resolver(_SlugSessionMaker()),
)
```

Replace the existing `app = create_app(...)` line with the above.

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_jwt_hospital_lookup.py -v`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_jwt_hospital_lookup.py
git commit -m "feat(api): resolve a clinician's JWT to their tenant slug"
```

---

### Task 4: Warn when a configured hospital key matches no tenant

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py`
- Test: `homunculus-engine/tests/test_identity.py` (extend)

The pure check exists from Task 1. This calls it at startup.

- [ ] **Step 1: Write the failing test**

Append to `homunculus-engine/tests/test_identity.py`:

```python
def test_the_warning_names_the_key_and_says_what_breaks(caplog):
    """The operator has to be able to act on this line without reading the source."""
    import logging

    from homunculus.api.prodserver import warn_about_unmatched_tenants

    with caplog.at_level(logging.WARNING):
        warn_about_unmatched_tenants(["HOSP1"], ["demo-hastanesi"])

    message = caplog.text
    assert "HOSP1" in message
    assert "demo-hastanesi" in message


def test_no_warning_when_every_key_matches(caplog):
    import logging

    from homunculus.api.prodserver import warn_about_unmatched_tenants

    with caplog.at_level(logging.WARNING):
        warn_about_unmatched_tenants(["demo-hastanesi"], ["demo-hastanesi"])

    assert caplog.text == ""
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_identity.py -v`
Expected: FAIL — `ImportError: cannot import name 'warn_about_unmatched_tenants'`

- [ ] **Step 3: Implement**

Add to `homunculus-engine/src/homunculus/api/prodserver.py`:

```python
def warn_about_unmatched_tenants(configured, known_slugs) -> None:
    """Report configured hospital keys that no tenant slug matches.

    A warning rather than a refusal to start: on a ward, a service that will not boot is worse
    than one running with a fault that can be read in the log and fixed.
    """
    import logging

    from homunculus.api.identity import unmatched_hospital_keys

    unmatched = unmatched_hospital_keys(configured, known_slugs)
    if not unmatched:
        return
    logging.getLogger(__name__).warning(
        "TENANTS names hospital key(s) %s, which match no tenant slug in the database (known: %s). "
        "Observations sent under those keys are stored and evaluated, but no clinician can ever "
        "see them: alerts will fire into an empty room. Set TENANTS to the tenant's slug.",
        ", ".join(unmatched), ", ".join(sorted(known_slugs)) or "none",
    )
```

Then call it during startup. In `homunculus-engine/src/homunculus/api/app.py`, extend the `lifespan` function so it runs the check when one is supplied — add a keyword-only `on_startup_check: Callable[[], Awaitable[None]] | None = None` parameter to `create_app`, and inside `lifespan`, before `yield`:

```python
        if on_startup_check is not None:
            try:
                await on_startup_check()
            except Exception:      # a diagnostic must never stop the service from starting
                logging.getLogger(__name__).exception("tenant configuration check failed to run")
```

In `prodserver.py`, pass a callable that reads the slugs and calls `warn_about_unmatched_tenants`:

```python
async def _check_tenant_configuration(configured) -> None:
    from sqlalchemy import select

    from homunculus.db import AsyncSessionLocal
    from homunculus.tenant.models import Tenant

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Tenant.slug))
        warn_about_unmatched_tenants(configured, list(result.scalars().all()))
```

and wire it into the `create_app(...)` call as
`on_startup_check=lambda: _check_tenant_configuration(list(_parse_tenants(os.getenv("TENANTS")).values()))`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_identity.py -v`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_identity.py
git commit -m "feat(api): warn at startup when TENANTS names a hospital nobody can read"
```

---

### Task 5: Stream tickets

**Files:**
- Create: `homunculus-engine/src/homunculus/api/tickets.py`
- Test: `homunculus-engine/tests/test_tickets.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py`

- [ ] **Step 1: Write the failing test**

```python
"""Short-lived tickets for the SSE endpoints.

EventSource cannot send headers, so the credential has to travel in the URL — where it lands in
server logs, browser history and referrer headers. A JWT there is a long-lived credential leaked
into three places at once. A ticket is worthless a minute later and after one use.
"""
from __future__ import annotations

from homunculus.api.tickets import TicketStore


def test_a_ticket_resolves_to_the_hospital_it_was_issued_for():
    store = TicketStore(ttl_seconds=60)
    ticket = store.issue("demo-hastanesi", now=1000.0)
    assert store.consume(ticket, now=1001.0) == "demo-hastanesi"


def test_a_ticket_works_once():
    """A replayable ticket in a URL is just a credential in a URL again."""
    store = TicketStore(ttl_seconds=60)
    ticket = store.issue("demo-hastanesi", now=1000.0)

    assert store.consume(ticket, now=1001.0) == "demo-hastanesi"
    assert store.consume(ticket, now=1002.0) is None


def test_a_ticket_expires():
    store = TicketStore(ttl_seconds=60)
    ticket = store.issue("demo-hastanesi", now=1000.0)
    assert store.consume(ticket, now=1061.0) is None


def test_an_unknown_ticket_resolves_to_nothing():
    assert TicketStore().consume("made-up", now=1000.0) is None


def test_tickets_are_unguessable_and_distinct():
    store = TicketStore()
    tickets = {store.issue("h", now=1000.0) for _ in range(50)}
    assert len(tickets) == 50
    assert all(len(t) >= 32 for t in tickets)


def test_expired_tickets_do_not_accumulate():
    """This store lives for the life of the process; without pruning it grows forever."""
    store = TicketStore(ttl_seconds=10)
    for _ in range(100):
        store.issue("h", now=1000.0)
    store.issue("h", now=2000.0)
    assert store.size() == 1
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_tickets.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.tickets'`

- [ ] **Step 3: Implement**

Create `homunculus-engine/src/homunculus/api/tickets.py`:

```python
# src/homunculus/api/tickets.py
"""Single-use, short-lived tickets for the SSE endpoints.

`EventSource` cannot set request headers, so whatever authorises a stream has to travel in the
query string — and query strings end up in server access logs, browser history and referrer
headers. Putting a JWT there leaks a long-lived credential into three places that get copied
around freely. A ticket is bound to one hospital, dies after one use, and expires in a minute.

The clock is a parameter so expiry is tested rather than waited for.
"""
from __future__ import annotations

import secrets


class TicketStore:
    """In-process ticket store, living alongside the broadcaster it authorises access to."""

    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._tickets: dict[str, tuple[str, float]] = {}

    def issue(self, hospital: str, *, now: float) -> str:
        self._prune(now)
        ticket = secrets.token_urlsafe(32)
        self._tickets[ticket] = (hospital, now + self._ttl)
        return ticket

    def consume(self, ticket: str, *, now: float) -> str | None:
        """Return the hospital and invalidate the ticket. None if unknown or expired."""
        entry = self._tickets.pop(ticket, None)
        if entry is None:
            return None
        hospital, expires_at = entry
        return hospital if now < expires_at else None

    def size(self) -> int:
        return len(self._tickets)

    def _prune(self, now: float) -> None:
        expired = [t for t, (_h, exp) in self._tickets.items() if now >= exp]
        for ticket in expired:
            del self._tickets[ticket]
```

Note the tests call `issue`/`consume` with `now` as a keyword — match that.

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_tickets.py -v`
Expected: PASS — 6 tests

- [ ] **Step 5: Wire it into the app**

In `homunculus-engine/src/homunculus/api/app.py`, create the store next to the broadcaster and expose it (`app.state.tickets = tickets`), then add the endpoint and accept tickets on both SSE routes:

```python
    @app.post("/stream-ticket")
    async def stream_ticket(authorization: str | None = Header(default=None)):
        """Exchange a credential for a short-lived, single-use SSE ticket."""
        hospital = await _hospital(authorization)
        return {"ticket": tickets.issue(hospital, now=time.monotonic()), "expires_in": 60}
```

Add `import time` if absent. Then change `/stream` and `/notifications` to accept either:

```python
    def _stream_hospital(token: str | None, ticket: str | None) -> str:
        if ticket:
            hospital = tickets.consume(ticket, now=time.monotonic())
            if hospital is None:
                raise HTTPException(status_code=401, detail="invalid or expired ticket")
            return hospital
        return _tenant_from_token(token)
```

and use it in both route bodies, with signatures `(token: str | None = None, ticket: str | None = None)` — `/notifications` keeps its `role` parameter.

- [ ] **Step 6: Add an endpoint test**

Append to `homunculus-engine/tests/test_tickets.py`:

```python
def test_the_endpoint_issues_a_ticket_that_opens_the_stream():
    from fastapi.testclient import TestClient

    from homunculus.api.app import create_app

    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    with TestClient(app) as client:
        issued = client.post("/stream-ticket", headers={"Authorization": "Bearer bridge-token"})
        assert issued.status_code == 200
        ticket = issued.json()["ticket"]

        assert client.post("/stream-ticket").status_code == 401       # no credential, no ticket
        assert app.state.tickets.consume(ticket, now=0.0) == "demo-hastanesi"
```

- [ ] **Step 7: Run the whole backend suite**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest -q`
Expected: 330 passed, 40 skipped.

- [ ] **Step 8: Commit**

```bash
git add homunculus-engine/src/homunculus/api/tickets.py homunculus-engine/tests/test_tickets.py homunculus-engine/src/homunculus/api/app.py
git commit -m "feat(api): short-lived stream tickets, so no JWT goes in a URL"
```

---

### Task 6: Publish the vitals the board actually displays

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/board.py`
- Test: `homunculus-engine/tests/test_board_vitals.py`

`patient_board` returns `heart_rate`, `map`, `lactate` and `sofa`. The dashboard shows SpO₂, temperature and respiratory rate too, and the engine already holds them — they are simply not published.

- [ ] **Step 1: Write the failing test**

```python
"""The board payload has to carry every vital the dashboard renders.

Otherwise the screen shows a blank where a measured value exists, which reads as "not measured"
— a different clinical statement from the truth.
"""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def _obs(code: SignalCode, value: float, unit: str) -> Observation:
    return Observation(patient_id="bed-3", code=code, value=value, unit=unit,
                       timestamp=datetime(2026, 8, 27, 10, 0, tzinfo=timezone.utc),
                       source_device="TEST")


def test_every_displayed_vital_is_published():
    engine = Engine()
    at = datetime(2026, 8, 27, 10, 0, tzinfo=timezone.utc)
    for code, value, unit in [
        (SignalCode.HEART_RATE, 96.0, "bpm"),
        (SignalCode.MAP, 72.0, "mmHg"),
        (SignalCode.SPO2, 93.0, "%"),
        (SignalCode.TEMPERATURE, 38.2, "Cel"),
        (SignalCode.RESP_RATE, 22.0, "/min"),
    ]:
        engine.ingest(_obs(code, value, unit), now=at)   # `now` is required, not optional

    latest = patient_board(engine, "bed-3", AckStore())["latest"]

    assert latest["heart_rate"] == 96.0
    assert latest["map"] == 72.0
    assert latest["spo2"] == 93.0
    assert latest["temperature"] == 38.2
    assert latest["resp_rate"] == 22.0


def test_an_unmeasured_vital_is_null_not_absent():
    """The key must exist and be null: a missing key and a null read differently downstream,
    and the UI has to be able to say "not measured" rather than crash on undefined."""
    board = patient_board(Engine(), "bed-9", AckStore())

    for key in ("heart_rate", "map", "spo2", "temperature", "resp_rate", "lactate"):
        assert key in board["latest"]
        assert board["latest"][key] is None
```

Verified while planning: `SignalCode` has `HEART_RATE`, `RESP_RATE`, `SPO2`, `TEMPERATURE`,
`MAP` and `LACTATE`; `AckStore()` takes no arguments; and `patient_board` today returns only
`heart_rate`, `lactate`, `map` and `sofa` — which is the gap this task closes.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_board_vitals.py -v`
Expected: FAIL — `KeyError: 'spo2'`

- [ ] **Step 3: Implement**

In `homunculus-engine/src/homunculus/api/board.py`, extend the `latest` block in `patient_board`:

```python
        "latest": {
            "heart_rate": _latest(state, SignalCode.HEART_RATE),
            "map": _latest(state, SignalCode.MAP),
            "spo2": _latest(state, SignalCode.SPO2),
            "temperature": _latest(state, SignalCode.TEMPERATURE),
            "resp_rate": _latest(state, SignalCode.RESP_RATE),
            "lactate": _latest(state, SignalCode.LACTATE),
            "sofa": total_sofa(state),
        },
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd homunculus-engine && ./.venv/Scripts/python.exe -m pytest tests/test_board_vitals.py -v`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_board_vitals.py
git commit -m "feat(api): publish SpO2, temperature and respiratory rate on the board"
```

---

### Task 7: Adapter — API payload to the shape the board renders

**Files:**
- Create: `dashboard/src/liveAdapters.js`
- Test: `dashboard/src/liveAdapters.test.js`

The simulated patient carries name, national ID, phone, address, bed, diagnosis and more. The API supplies **none** of those: they are typed in by clinicians (a later slice persists them). The adapter fills the machine-fed fields and leaves the rest explicitly null.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { patientFromBoard, patientsFromBoard } from "./liveAdapters.js";

const entry = {
  patient_id: "bed-3",
  risk: "high",
  alerts: [
    { kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
      acknowledged: false, acknowledged_by: null, acknowledged_at: null,
      first_seen_at: "2026-08-27T10:00:00Z", escalated: false },
  ],
  latest: { heart_rate: 123, map: 61, spo2: 89, temperature: 38.4, resp_rate: 28,
            lactate: 3.1, sofa: 7 },
};

describe("patientFromBoard", () => {
  it("carries the machine-measured vitals across", () => {
    expect(patientFromBoard(entry).vitals)
      .toEqual({ hr: 123, map: 61, spo2: 89, temp: 38.4, rr: 28 });
  });

  it("keeps the patient id and the engine's risk", () => {
    const p = patientFromBoard(entry);
    expect(p.patient_id).toBe("bed-3");
    expect(p.risk).toBe("high");
  });

  it("passes the alerts through untouched", () => {
    expect(patientFromBoard(entry).alerts).toHaveLength(1);
    expect(patientFromBoard(entry).alerts[0].kind).toBe("sepsis");
  });

  it("leaves every clinician-entered field null rather than inventing one", () => {
    // An invented name, bed or national ID on a clinical board is worse than a blank one:
    // a blank prompts someone to fill it in, a plausible value gets trusted.
    const p = patientFromBoard(entry);
    for (const field of ["display_name", "tc_no", "tcMasked", "phone", "address", "mrn",
                         "protocolNo", "bedId", "bedLabel", "unitId", "diagnosis",
                         "admittedBy", "sex", "age"]) {
      expect(p[field], `${field} must be null until a clinician enters it`).toBeNull();
    }
  });

  it("marks the record as machine-sourced", () => {
    expect(patientFromBoard(entry).source).toBe("device");
  });

  it("renders an unmeasured vital as null, not zero", () => {
    const sparse = { patient_id: "bed-9", risk: "stable", alerts: [],
                     latest: { heart_rate: null, map: null, spo2: null,
                               temperature: null, resp_rate: null, lactate: null, sofa: null } };
    expect(patientFromBoard(sparse).vitals)
      .toEqual({ hr: null, map: null, spo2: null, temp: null, rr: null });
  });

  it("survives a payload with no latest block at all", () => {
    const p = patientFromBoard({ patient_id: "bed-1", risk: "stable", alerts: [] });
    expect(p.vitals).toEqual({ hr: null, map: null, spo2: null, temp: null, rr: null });
  });
});

describe("patientsFromBoard", () => {
  it("maps a whole board response", () => {
    expect(patientsFromBoard({ patients: [entry, { ...entry, patient_id: "bed-4" }] }))
      .toHaveLength(2);
  });

  it("treats a missing patients array as no patients", () => {
    expect(patientsFromBoard({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd dashboard && npx vitest run src/liveAdapters.test.js`
Expected: FAIL — cannot resolve `./liveAdapters.js`

- [ ] **Step 3: Implement**

Create `dashboard/src/liveAdapters.js`:

```js
// Maps the API's board payload onto the patient shape the clinical components render.
//
// The split this file encodes: the engine supplies what a machine measured — vitals, alerts,
// risk. Everything else on a patient record (name, national ID, bed, diagnosis, admitting
// clinician) is typed in by clinicians and is not in this payload.
//
// Those fields are set to null, deliberately and explicitly. An invented name or bed number on a
// clinical board is worse than a blank one: a blank prompts someone to fill it in, a plausible
// value gets trusted and acted on.

const NO_VITALS = { hr: null, map: null, spo2: null, temp: null, rr: null };

/** One board entry -> one patient record. */
export function patientFromBoard(entry) {
  const latest = entry?.latest ?? {};
  return {
    patient_id: entry?.patient_id ?? null,
    risk: entry?.risk ?? null,
    alerts: entry?.alerts ?? [],
    vitals: {
      hr: latest.heart_rate ?? null,
      map: latest.map ?? null,
      spo2: latest.spo2 ?? null,
      temp: latest.temperature ?? null,
      rr: latest.resp_rate ?? null,
    },
    lactate: latest.lactate ?? null,
    sofa: latest.sofa ?? null,
    // Awaiting a clinician. Null, never a placeholder that could be mistaken for data.
    display_name: null,
    sex: null,
    age: null,
    isNeonate: false,
    tc_no: null,
    tcMasked: null,
    phone: null,
    address: null,
    mrn: null,
    protocolNo: null,
    bedId: null,
    bedLabel: null,
    unitId: null,
    diagnosis: null,
    admittedBy: null,
    admittedAtMs: null,
    source: "device",
  };
}

/** The whole /patients response -> patient records. */
export function patientsFromBoard(payload) {
  const list = Array.isArray(payload?.patients) ? payload.patients : [];
  return list.map(patientFromBoard);
}

export { NO_VITALS };
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd dashboard && npx vitest run src/liveAdapters.test.js`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js
git commit -m "feat(dashboard): map the live board payload, leaving clinician fields blank"
```

---

### Task 8: Connection state — empty and unreachable must not look alike

**Files:**
- Create: `dashboard/src/liveConnection.js`
- Test: `dashboard/src/liveConnection.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { CONNECTION, nextConnection, boardView } from "./liveConnection.js";

describe("nextConnection", () => {
  it("starts out connecting", () => {
    expect(nextConnection(undefined, { type: "start" })).toBe(CONNECTION.CONNECTING);
  });

  it("becomes live when the board loads", () => {
    expect(nextConnection(CONNECTION.CONNECTING, { type: "loaded" })).toBe(CONNECTION.LIVE);
  });

  it("degrades when the stream drops but data still arrives", () => {
    expect(nextConnection(CONNECTION.LIVE, { type: "stream-lost" })).toBe(CONNECTION.DEGRADED);
  });

  it("recovers to live when the stream reopens", () => {
    expect(nextConnection(CONNECTION.DEGRADED, { type: "stream-open" })).toBe(CONNECTION.LIVE);
  });

  it("becomes unavailable when a fetch fails", () => {
    expect(nextConnection(CONNECTION.LIVE, { type: "failed" })).toBe(CONNECTION.UNAVAILABLE);
  });
});

describe("boardView", () => {
  it("shows patients when they are there", () => {
    const view = boardView(CONNECTION.LIVE, [{ patient_id: "bed-3" }]);
    expect(view.showList).toBe(true);
    expect(view.patients).toHaveLength(1);
    expect(view.notice).toBeNull();
  });

  it("says there are no patients when connected and the board is empty", () => {
    // A real answer, and it must not resemble a failure.
    const view = boardView(CONNECTION.LIVE, []);
    expect(view.showList).toBe(true);
    expect(view.notice).toMatch(/izlenen hasta yok/i);
    expect(view.isError).toBe(false);
  });

  it("SUPPRESSES the list when the backend is unreachable", () => {
    // An empty list reads as "nobody needs attention" — the most reassuring screen this system
    // can draw, and a lie at the exact moment it has stopped watching.
    const view = boardView(CONNECTION.UNAVAILABLE, []);
    expect(view.showList).toBe(false);
    expect(view.isError).toBe(true);
    expect(view.notice).toMatch(/bağlantı yok/i);
  });

  it("never yields patients it was handed while unreachable", () => {
    const view = boardView(CONNECTION.UNAVAILABLE, [{ patient_id: "stale" }]);
    expect(view.patients).toEqual([]);
  });

  it("keeps showing data while degraded, and says so", () => {
    const view = boardView(CONNECTION.DEGRADED, [{ patient_id: "bed-3" }]);
    expect(view.showList).toBe(true);
    expect(view.patients).toHaveLength(1);
    expect(view.notice).toMatch(/canlı akış/i);
    expect(view.isError).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd dashboard && npx vitest run src/liveConnection.test.js`
Expected: FAIL — cannot resolve `./liveConnection.js`

- [ ] **Step 3: Implement**

Create `dashboard/src/liveConnection.js`:

```js
// What the board is allowed to show, given the state of the connection.
//
// The distinction this file exists to enforce: "connected, and there are no patients" and
// "we cannot reach the backend" must never render the same way. An empty patient list reads as
// nobody needing attention — the most reassuring screen the system can draw — and displaying it
// while monitoring has actually stopped would be a lie told at the worst possible moment.
//
// Falling back to simulated data on failure is likewise forbidden: whatever this returns while
// unavailable is empty, and the screen says why.

export const CONNECTION = {
  CONNECTING: "connecting",
  LIVE: "live",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
};

export function nextConnection(current, event) {
  switch (event.type) {
    case "start":       return CONNECTION.CONNECTING;
    case "loaded":      return CONNECTION.LIVE;
    case "stream-open": return CONNECTION.LIVE;
    case "stream-lost": return CONNECTION.DEGRADED;
    case "failed":      return CONNECTION.UNAVAILABLE;
    default:            return current ?? CONNECTION.CONNECTING;
  }
}

export function boardView(connection, patients) {
  if (connection === CONNECTION.UNAVAILABLE) {
    return {
      showList: false,
      patients: [],
      isError: true,
      notice: "Sunucuya bağlantı yok — hasta listesi gösterilmiyor. "
            + "Bu ekran hasta olmadığı anlamına GELMEZ.",
    };
  }

  if (connection === CONNECTION.CONNECTING) {
    return { showList: false, patients: [], isError: false, notice: "Bağlanılıyor…" };
  }

  const list = patients ?? [];
  const degraded = connection === CONNECTION.DEGRADED;

  let notice = null;
  if (degraded) {
    notice = "Canlı akış koptu — veriler düzenli aralıklarla yenileniyor.";
  } else if (list.length === 0) {
    notice = "Şu anda izlenen hasta yok. Bağlantı çalışıyor.";
  }

  return { showList: true, patients: list, isError: false, notice };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd dashboard && npx vitest run src/liveConnection.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/liveConnection.js dashboard/src/liveConnection.test.js
git commit -m "feat(dashboard): an empty board and an unreachable one must never look alike"
```

---

### Task 9: Live data in the store

**Files:**
- Modify: `dashboard/src/backendApi.js`
- Modify: `dashboard/src/liveStore.js`
- Test: `dashboard/src/liveStore.live.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { CONNECTION } from "./liveConnection.js";

function fakeBase() {
  const state = { patients: [{ patient_id: "SIMULATED", display_name: "Simüle Hasta" }] };
  return { getState: () => state, subscribe: () => () => {}, logout: () => {} };
}

function fakeApi(overrides = {}) {
  return {
    login: vi.fn(), verifyTotp: vi.fn(), me: vi.fn(), logout: vi.fn(),
    boardPatients: vi.fn(async () => ({ patients: [] })),
    streamTicket: vi.fn(async () => ({ ticket: "t", expires_in: 60 })),
    acknowledge: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("live store data layer", () => {
  it("replaces the simulated patients with what the API returned", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({
        patients: [{ patient_id: "bed-3", risk: "high", alerts: [],
                     latest: { heart_rate: 120 } }],
      })),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    const patients = store.getState().patients;
    expect(patients).toHaveLength(1);
    expect(patients[0].patient_id).toBe("bed-3");
    expect(patients[0].vitals.hr).toBe(120);
  });

  it("never falls back to simulated patients when the API fails", async () => {
    // The whole point: a clinician logged in with real credentials must not be shown invented
    // patients because a fetch failed.
    const api = fakeApi({ boardPatients: vi.fn(async () => { throw new Error("network"); }) });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    expect(store.getState().connection).toBe(CONNECTION.UNAVAILABLE);
    expect(store.getState().patients).toEqual([]);
    expect(JSON.stringify(store.getState().patients)).not.toContain("SIMULATED");
  });

  it("reports live with an empty board when there is genuinely nothing", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });

    await store.refreshBoard();

    expect(store.getState().connection).toBe(CONNECTION.LIVE);
    expect(store.getState().patients).toEqual([]);
  });

  it("acknowledges through the API and refreshes", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.acknowledgeAlert("bed-3", "sepsis", "nurse");

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis", "nurse");
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("asks for a fresh ticket before opening the stream", async () => {
    // The JWT must never reach the URL; the ticket is what goes there.
    const api = fakeApi();
    const opened = [];
    const store = createLiveStore({
      api, base: fakeBase(),
      openStream: (url) => { opened.push(url); return () => {}; },
    });

    await store.startLive();

    expect(api.streamTicket).toHaveBeenCalled();
    expect(opened[0]).toContain("ticket=t");
    expect(opened[0]).not.toMatch(/token=/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd dashboard && npx vitest run src/liveStore.live.test.js`
Expected: FAIL — `store.refreshBoard is not a function`

- [ ] **Step 3: Add the API methods**

In `dashboard/src/backendApi.js`, add to the object returned by `createBackendApi` (it already has an authenticated `request` helper — reuse it, do not write new fetch logic):

```js
    /** The clinical board for the caller's hospital. */
    boardPatients() {
      return authed("/patients");
    },

    /** A short-lived, single-use ticket for the SSE endpoints. */
    streamTicket() {
      return authed("/stream-ticket", { method: "POST" });
    },

    acknowledge(patientId, kind, role) {
      return authed("/ack", { method: "POST",
                              body: { patient_id: patientId, kind, role } });
    },
```

Check `authed`'s actual signature in that file and match it.

- [ ] **Step 4: Extend the store**

In `dashboard/src/liveStore.js`, import the adapter and the connection module, hold `patients` and `connection` in the overlay, and add the three actions. `createLiveStore` gains an injectable `openStream` (defaulting to a real `EventSource`) so the test can observe the URL:

```js
import { patientsFromBoard } from "./liveAdapters.js";
import { CONNECTION, nextConnection } from "./liveConnection.js";
```

Overlay starts as `{ user: null, mfaPending: null, patients: [], connection: CONNECTION.CONNECTING }`, and:

```js
    /** Load the board. On failure the patient list is emptied, never left simulated. */
    async refreshBoard() {
      try {
        const payload = await api.boardPatients();
        overlay = { ...overlay, patients: patientsFromBoard(payload),
                    connection: nextConnection(overlay.connection, { type: "loaded" }) };
      } catch {
        // Deliberately not falling back to `base`: simulated patients behind a real login are
        // the one outcome this store exists to prevent.
        overlay = { ...overlay, patients: [],
                    connection: nextConnection(overlay.connection, { type: "failed" }) };
      }
      emit();
    },

    async acknowledgeAlert(patientId, kind, role) {
      await api.acknowledge(patientId, kind, role);
      await this.refreshBoard();
    },

    /** Open the live stream with a ticket, so no long-lived credential enters a URL. */
    async startLive() {
      await this.refreshBoard();
      const { ticket } = await api.streamTicket();
      return openStream(`/stream?ticket=${encodeURIComponent(ticket)}`);
    },
```

`getState()` already spreads the overlay over the base state, so `patients` and `connection` surface automatically.

- [ ] **Step 5: Run it and confirm it passes**

Run: `cd dashboard && npx vitest run src/liveStore.live.test.js`
Expected: PASS — 5 tests

- [ ] **Step 6: Run the whole frontend suite**

Run: `cd dashboard && npx vitest run`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/backendApi.js dashboard/src/liveStore.js dashboard/src/liveStore.live.test.js
git commit -m "feat(dashboard): real patients, alerts and acknowledgement in the live store"
```

---

### Task 10: Routing, and the banner only where it is true

**Files:**
- Modify: `dashboard/src/main.jsx`
- Modify: `dashboard/src/DemoDataBanner.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/routing.test.js`:

```js
import { describe, it, expect } from "vitest";
import { chooseMode } from "./main.jsx";

describe("chooseMode", () => {
  it("defaults to live — the address a clinician types is the real system", () => {
    expect(chooseMode(new URLSearchParams(""))).toBe("live");
  });

  it("keeps the simulation on ?demo=1", () => {
    expect(chooseMode(new URLSearchParams("demo=1"))).toBe("demo");
  });

  it("still honours ?live=1 for anyone with an old link", () => {
    expect(chooseMode(new URLSearchParams("live=1"))).toBe("live");
  });

  it("routes the replay demo", () => {
    expect(chooseMode(new URLSearchParams("mode=replay"))).toBe("replay");
  });

  it("routes the legacy board", () => {
    expect(chooseMode(new URLSearchParams("board=1"))).toBe("board");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd dashboard && npx vitest run src/routing.test.js`
Expected: FAIL — `chooseMode` is not exported

- [ ] **Step 3: Implement**

In `dashboard/src/main.jsx`, extract and export the decision, then render the banner only in demo mode:

```jsx
/** Which mode a URL selects. Exported so the routing is testable without a DOM. */
export function chooseMode(params) {
  if (params.get("demo") === "1") return "demo";
  if (params.get("mode") === "replay" || params.has("scenario")) return "replay";
  if (params.get("board") === "1") return "board";
  return "live";
}
```

Rewrite `pickRoot()` to switch on `chooseMode(params)`, and change the render so the banner appears only for `"demo"`:

```jsx
const mode = chooseMode(params);

// The banner belongs only to the simulation. In live mode it would be false — and a notice that
// is sometimes wrong is worse than none, because people stop reading it.
createRoot(document.getElementById("root")).render(
  <>
    {mode === "demo" ? <DemoDataBanner /> : null}
    {pickRoot(mode)}
  </>,
);
```

`window.location.hash.startsWith("#/demo")` was handled by the old `isDemo`; keep that behaviour by treating it as `"demo"` inside `chooseMode` — it takes a params object, so pass the hash check in from the caller or check `window.location.hash` inside `pickRoot`. Prefer: keep `chooseMode(params)` pure and handle the hash at the call site with `const mode = window.location.hash.startsWith("#/demo") ? "demo" : chooseMode(params);`

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd dashboard && npx vitest run src/routing.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Run the whole frontend suite and build**

Run: `cd dashboard && npx vitest run && npm run build`
Expected: all tests pass; build completes.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/main.jsx dashboard/src/routing.test.js
git commit -m "feat(dashboard): the root address is the live system; the banner stays with the demo"
```

---

### Task 11: Watch live data on the hospital VM

Runs **on the Ubuntu VM** (`172.100.101.72`), not the dev machine.

- [ ] **Step 1: Deploy**

On the dev machine: `git push origin HEAD:main`

On the VM:
```bash
cd /opt/homunculus && git pull
cd deploy/local
docker compose up -d --build
docker compose ps
```

- [ ] **Step 2: Point TENANTS at the tenant slug**

The hospital key is now the tenant slug. The seeded tenant is `demo-hastanesi`.

```bash
cd /opt/homunculus/deploy/local
grep ^TENANT_TOKEN .env
docker compose logs api | grep -i "match no tenant" || echo "eslesme uyarisi yok"
```

If the warning appears, the compose file's `TENANTS: ${TENANT_TOKEN}:HOSP1` still says `HOSP1`. Change it to `${TENANT_TOKEN}:demo-hastanesi` in `deploy/local/docker-compose.yml`, commit that change, and `docker compose up -d`.

- [ ] **Step 3: Confirm a JWT reaches the board**

```bash
PW=$(grep ^SEED_ADMIN_PASSWORD .env | cut -d= -f2)
TOKEN=$(curl -s -X POST http://172.100.101.72:8080/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@hastane.com.tr\",\"password\":\"$PW\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://172.100.101.72:8080/patients ; echo
```
Expected: `{"patients":[]}` — an empty board, because no device is connected yet. A 401 here means the resolver is not seeing the membership; check `docker compose logs api`.

- [ ] **Step 4: Confirm the ticket path**

```bash
TICKET=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://172.100.101.72:8080/stream-ticket | python3 -c "import sys,json; print(json.load(sys.stdin)['ticket'])")
curl -N "http://172.100.101.72:8080/stream?ticket=$TICKET"
```
Expected: the connection stays open and emits keepalive frames. Ctrl+C to stop. If it closes immediately the ticket was rejected; if it hangs silently with no frames, nginx is buffering (`proxy_buffering off` in `deploy/local/web/nginx.conf`).

- [ ] **Step 5: Push data through and watch it appear**

```bash
docker compose exec bridge python scripts/hl7_simulator.py \
  --host bridge --port 2575 --patients 1 --count 5
curl -s -H "Authorization: Bearer $TOKEN" http://172.100.101.72:8080/patients ; echo
```
Expected: a patient with `risk`, `alerts` and a `latest` block carrying heart rate, MAP, SpO₂, temperature and respiratory rate.

- [ ] **Step 6: Watch it in the browser**

Open `http://172.100.101.72:8080/`, log in as `admin@hastane.com.tr`, and confirm:

- the board shows the patient the simulator produced, with real vitals;
- name, bed and diagnosis are visibly blank, not invented;
- stopping the API (`docker compose stop api`) makes the screen say the connection is gone and **hide** the list — it must not show an empty board as though nobody needed attention;
- `docker compose start api` brings it back.

- [ ] **Step 7: Confirm the audit trail recorded it**

```bash
docker compose exec postgres psql -U homunculus -d homunculus -c \
  "SELECT event_type, count(*) FROM audit GROUP BY event_type ORDER BY 2 DESC;"
```
Expected: `ingest` rows, and `alert` rows if the scenario crossed a threshold.

---

## Self-review notes

**Spec coverage.** Hospital key = tenant slug (Tasks 1–3) · startup mismatch warning (Tasks 1, 4) · dual-credential resolver with the device path first (Task 2) · stream tickets, no JWT in URLs (Task 5) · what the live board can show, clinician fields blank (Task 7) · vitals the board renders are published (Task 6 — a gap found while planning: `board.py` omitted SpO₂, temperature and respiratory rate) · connection states and the empty/unreachable distinction (Tasks 8, 9) · routing and the banner (Task 10) · end-to-end on the VM (Task 11).

**Deliberately not here.** Patient identity from `/admissions`, bed mapping via `beds.device_location_id`, care team and medication persistence — that is Slice 2, and until it lands the fields stay blank on purpose.
