# Time bounds on the API's sync Postgres engines — design and plan

**Date:** 2026-11-01 · **Lane:** A · **Branch:** `fix/pg-bounds`, off `main` `ec66a57`. **Owner:** «uygun gördüğün
sırayla başlat» (2026-11-01), after the finding was shown: Lane B's T4 reviewer found that the sync engines the API
calls on its event loop have no time bounds, Lane A confirmed it by reading, and the audit store is the widest of them.

## 1. The problem

Three stores open a sync SQLAlchemy engine on psycopg2 and are called on the event loop: the audit log
(`api/audit_postgres.py:49`, written on almost every request), the identity store (`api/patient_identity_postgres.py:40`)
and the monitor samples (`api/monitor_samples.py:95`, every accepted hub body at the stage `rules`). None sets a connect
timeout, a pool timeout or a statement timeout. A database that accepts a connection and then stays silent — an
overloaded container, a lock held by a migration, a half-open TCP connection that `pool_pre_ping` waits on — blocks the
loop, and every request of the API with it, until the operating system's TCP timeout (minutes). Nothing reaches the
ward's screens meanwhile. Nothing disposes the engines at shutdown either.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One helper** `bounded_connect_args(*, ssl_required: bool, statement_timeout_ms: int) -> dict` in `api/audit_postgres.py`, beside `to_sync_url` (the module every store already imports it from). It returns libpq's arguments: `connect_timeout` 3 (s), `options` `-c statement_timeout=<N>`, TCP keepalives on (`keepalives` 1, `keepalives_idle` 10, `keepalives_interval` 5, `keepalives_count` 3), `tcp_user_timeout` 4000 (ms — the value Lane B's `PostgresDeviceBeds` already uses), and `sslmode` `require` when `ssl_required`. Named constants, each with its reason. | One place for the numbers; libpq applies all of them, psycopg2 passes them through. |
| D2 | **Every engine gets `pool_timeout=3`** (a checkout waits at most 3 s for a free connection) and the helper's arguments. **Statement timeouts per store:** identity 2000 ms, samples 2000 ms (both read or write a handful of rows — the same 2000 ms Lane B's reader uses), **audit 10000 ms** for its appends (two statements each, on almost every request). **The audit's reads set their own** (the slice's review): `PostgresAuditLog.records` — `GET /audit`, `/audit/verify`, the alarm-quality report and a restart's replay — runs in a transaction that first executes `SET LOCAL statement_timeout = AUDIT_READ_STATEMENT_TIMEOUT_MS` (30 000), and `/audit/verify` clamps its `limit` to `AUDIT_VERIFY_LIMIT_MAX` (50 000 records, one read re-hashed on the loop), answering `complete: false` when the trail holds more. One helper, `set_local_statement_timeout`, beside `bounded_connect_args` and sharing its positive-integer guard, sets every such bound. **Two samples statements set their own** (found at Task 2's review): `PostgresSamples.since`, the install's replay of up to 24 h of a ward's samples, and `prune`, the hourly DELETE of a backlog off the loop, each run in a transaction that first executes `SET LOCAL statement_timeout` — `REPLAY_STATEMENT_TIMEOUT_MS` 30 000 and `PRUNE_STATEMENT_TIMEOUT_MS` 60 000; the engine's 2000 ms stays for the per-body appends on the loop. | A bound that refuses a legitimate long read is a new failure, not a fix. |
| D3 | **On a timeout nothing changes in behaviour above the store:** the exception propagates as today. An audit write that times out fails its request (500) — it is never skipped, retried silently or queued; a write the trail does not hold must not be answered as done. **Ordered so a failure loses nothing** (the slice's review): an escalation is paged at least once — a key joins `paged` only after its `escalation` row, its note and the note's row, and the cycle pages what is escalated and not yet paged, so a failure part-way leaves the rest to the next cycle at the cost of a possible second row or page, never a lost one; `/ack` (and `PUT /clinical/{id}/profile`) append their row first and change memory only after it, so a failed append leaves the alert unacknowledged and still escalating (the profile unset), as the trail has it. | The audit's contract (append-only, sealed) is the reason it exists. |
| D4 | **A common shutdown:** the app's lifespan, on exit, disposes every store passed to `create_app` that has a callable `dispose` (audit, samples) or `close` (identity) — each in its own `try`, logged and swallowed, so one failing store does not keep another's connections open. Lane B's `PostgresDeviceBeds` joins the list once it is on main (it has `dispose()`). | Today nothing returns the pools; a restart under load leaves connections to the server's idle timeout. |
| D5 | **Known limit, stated, not fixed:** libpq has no client-side read timeout. A server process that is frozen while its host still acknowledges TCP (a paused container) is bounded only by `statement_timeout` if the server can enforce it — it cannot when frozen. That case stays unbounded on a sync driver; the fix is an async driver with cancellation, out of scope. | Honesty about what the bounds do and do not cover. |
| D6 | **Not touched:** Lane B's `PostgresDeviceBeds` (`api/device_beds_postgres.py`, its own bounds already, not on main yet) — it may adopt the helper later; the async engines of the ORM path (admissions, auth) — they run on asyncpg with their own settings. | Scope: the three sync stores on the loop. |

## 3. Tasks (TDD; one commit each, explicit pathspec, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`)

1. **The helper.** Tests (no database): the returned dict holds each bound with its value; `ssl_required` adds `sslmode=require` and its absence adds nothing; the statement timeout is an integer of milliseconds in `options`. Then `bounded_connect_args` and its constants in `api/audit_postgres.py`.
2. **The three stores.** For each store: a test that the engine was created with `pool_timeout=3` and the helper's arguments with its own statement timeout (capture `create_engine`'s keyword arguments with a monkeypatch, no database); and a **silent-server test** — a local TCP socket that accepts and never answers; the store's first operation raises within 6 s (measured), never hangs. Then the change in each `__init__`. Keep `pool_pre_ping` and `hide_parameters`.
3. **The shutdown.** A test with fake stores whose `dispose`/`close` record the call: leaving `TestClient(create_app(...))` calls each once; a store whose dispose raises does not stop the others and is logged. Then the lifespan's `finally` block in `api/app.py`.
4. **Docs.** `homunculus-engine/README.md` (or the deploy notes it points to): the bounds, D3 and D5 in a short paragraph; the roadmap gets no row (infrastructure).

**Gates:** the whole engine suite without a database (`tests --ignore=tests/test_infinity_vm_pilot.py`) green; the stores' own Postgres tests (`tests/test_audit_postgres.py`, `tests/test_audit_event_types.py`, `tests/test_audit_newest.py`, `tests/test_audit_since.py`, `tests/test_patient_identity_postgres.py`, `tests/test_monitor_samples.py`, and the server-side proof of the bounds, `tests/test_pg_bounds_postgres.py`) run against the shared test database only with `TEST_DATABASE_URL` set on the command line (a database whose name contains "test"), never `DATABASE_URL`; if the shared test database is not reachable, say so and do not skip silently.

## 4. Open items

- **O1** D5's frozen-server case needs an async driver with cancellation (or a watchdog thread) — a separate decision.
- **O2** Lane B's `PostgresDeviceBeds` may move to the helper once both are on main.
- **O3** A PgBouncer-style pooler may refuse the `options` startup parameter that carries each engine's `statement_timeout`: test one connection through any pooler put in front of the database before relying on the bounds behind it.
