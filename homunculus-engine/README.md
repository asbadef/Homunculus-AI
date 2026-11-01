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

- connect 3 s, pool checkout 3 s;
- TCP keepalives, the first probe after 10 s idle and then every 5 s, with `tcp_user_timeout` 4 s.
  On Linux `TCP_USER_TIMEOUT` overrides the keepalive count: an idle connection to a dead peer is
  dropped at about idle + interval (about 15 s), after the first unanswered probe, and
  `keepalives_count` (3) has no effect there. Elsewhere `tcp_user_timeout` does not exist, and the
  count applies where the system supports it;
- a statement timeout per engine: 10 s for the audit's appends (two statements each) and 2 s for the
  identity store and the samples' appends. The long statements set their own for their transaction
  (`SET LOCAL`): 30 s for the audit's reads (`/audit`, `/audit/verify`, the alarm-quality report, a
  restart's replay), 30 s for the samples' replay of up to 24 h of a ward and 60 s for their hourly
  prune, which runs off the loop. `/audit/verify` reads at most 50 000 records and says
  `complete: false` when the trail holds more.

A timeout fails the call like any database error. An audit write that times out answers 500; it is
never skipped, retried quietly or queued, because an event the trail does not hold must not be
answered as done. `/ack` and the profile route write their row before they change anything in
memory, so a failed write leaves the alert unacknowledged (still escalating) and the profile unset.
An escalation is paged at least once: a key counts as paged only after its row and its note, so a
failure can cost a second page, never a lost one. At shutdown the API returns every store's
connections.

**Known limits.**

- libpq has no client-side read timeout: a server frozen while its host still acknowledges TCP (a
  paused container) cannot enforce `statement_timeout`, and a query on a connection already open to
  it stays unbounded. Closing that needs an async driver with cancellation, a separate decision
  (spec O1).
- `connect_timeout` does not cover DNS: a host name that is slow to resolve holds the connect for as
  long as the resolver takes.
- The bounds are per connect and per statement, not per request: a request that makes several
  database calls can take several bounds' worth.
- A slow but live server can hold the event loop for up to 10 s per audit statement, and an append
  is two.
- `connect_args` replaces a URL query parameter of the same name: a `DATABASE_URL` that carries its
  own `options` (or `connect_timeout`, or a `keepalives*`) loses it. The VM's carries none.
- A PgBouncer-style pooler may refuse the `options` startup parameter: test one connection through
  any pooler before relying on the bounds behind it (spec O3).
- The samples' prune is one unbatched DELETE. A backlog it cannot delete in 60 s (after a long
  outage, at ward scale) fails each hourly pass, logged, until it is deleted in batches.
