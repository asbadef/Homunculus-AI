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

## Database time bounds

The audit, the identity store and the monitor samples reach Postgres through a sync driver
(psycopg2) from the API's event loop, so each engine is bounded (`bounded_connect_args` in
`src/homunculus/api/audit_postgres.py`; spec `docs/superpowers/specs/2026-11-01-pg-sinirlari-design.md`):
connect 3 s, pool checkout 3 s, TCP keepalives (first probe after 10 s idle, then every 5 s, dead
after 3 unanswered), `tcp_user_timeout` 4 s (Linux only), and a statement timeout of 10 s for the
audit — it also serves `/audit`, `/audit/verify` and the alarm-quality report — and 2 s for the
other two. The samples' two long statements set their own for their transaction (`SET LOCAL`): 30 s
for the install's replay of up to 24 h of a ward's samples, 60 s for the hourly prune, which runs
off the loop; the 2 s stays for the appends. A timeout fails the call like any database error: an
audit write that times out answers 500; it is never skipped, retried quietly or queued, because an
event the trail does not hold must not be answered as done. At shutdown the API returns every
store's connections. **Known limit:** libpq has no client-side read timeout, so a server frozen
while its host still acknowledges TCP (a paused container) cannot enforce `statement_timeout`, and
a query on a connection already open to it stays unbounded; closing that needs an async driver
with cancellation, a separate decision (spec O1).
