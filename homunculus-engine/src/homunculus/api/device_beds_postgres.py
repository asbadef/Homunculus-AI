# homunculus-engine/src/homunculus/api/device_beds_postgres.py
"""The device→bed table from the database (migration 0014): the `DeviceBedSource` the strip and
Aşama B read in production (spec D6, §5.3). Lane A reviews this file.

A sync engine, as `PostgresSamples`: `current()` is called on the loop, like the identity store's
reads, and costs one small query per RELOAD_EVERY_S. That one statement loads the tenant's rows valid
at the API's wall clock (history stays in the table), `max(id)` and the tenant's name, so the version
and the rows come from one snapshot.

Bounded, because the loop waits: the connect gives up after CONNECT_TIMEOUT_S, a statement after
STATEMENT_TIMEOUT_MS, a pool checkout after the same CONNECT_TIMEOUT_S and data the network leaves
unacknowledged after TCP_USER_TIMEOUT_MS, so a database that accepts and stays silent, or a link that
goes dead mid-query, costs a few seconds, not the loop (A-10).

Strictly fail closed, on purpose: no rows is `missing`; an unreadable or stalled database, a broken
current set, or ANY exception while the rows are read or built is `invalid`. Both place no monitor on
any bed, as a missing or broken file does. There is no grace period on a read error: keeping the last
good mapping for a while would, right after a bind or an unbind (`invalidate()`), serve the OLD one, and
a monitor just moved to another bed could show on the previous bed's patient. A database outage only
blinks the strip, with every device unassigned. A change of state is logged once; a failure logs the
exception's class and, when the driver gave one, its 5-character SQLSTATE (`OperationalError 57014`),
never its message."""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.infinity_device_beds import (
    RELOAD_EVERY_S, DeviceBedTable, TableError, TableState, check_current, rows_digest,
)
from homunculus.devicebeds.rows import to_row

log = logging.getLogger(__name__)

CONNECT_TIMEOUT_S = 3
STATEMENT_TIMEOUT_MS = 2000
TCP_USER_TIMEOUT_MS = 4000          # a libpq 12+ keyword; psycopg2-binary>=2.9 bundles libpq 13 or later
# The tenant (by slug) LEFT JOINed to its rows valid at :now, with its max(id) (history included): one
# statement, one snapshot. A tenant with no rows, or none valid, comes back as one row whose `source` is
# NULL; an unknown slug comes back as none.
_READ = text(
    "SELECT t.name AS tenant_name, (SELECT max(h.id) FROM device_beds h WHERE h.tenant_id = t.id) AS head,"
    " d.source, d.group_address, d.port, d.bed_label, d.bed_id, d.unit_id, d.method, d.verified_at,"
    " d.valid_from, d.valid_to, d.note, d.approved_by, d.approved_at"
    " FROM tenants t LEFT JOIN device_beds d"
    " ON d.tenant_id = t.id AND (d.valid_to IS NULL OR d.valid_to > :now)"
    " WHERE t.slug = :slug ORDER BY d.id")
MISSING = "eşleme tablosunda bu hastane için satır yok"
UNREADABLE = "eşleme tablosu okunamadı"


def _failure(exc: BaseException) -> str:
    """What the log may say of a failure: the exception's class, then the driver's SQLSTATE when it
    gave one (`OperationalError 57014`, query_canceled). Never a message, which can hold SQL or a URL;
    a `pgcode` that is not exactly 5 characters of text is not kept."""
    code = getattr(getattr(exc, "orig", None), "pgcode", None)
    name = type(exc).__name__
    return f"{name} {code}" if isinstance(code, str) and len(code) == 5 else name


class PostgresDeviceBeds:
    def __init__(self, url: str, *, hospital: str, clock: Callable[[], float] = time.monotonic,
                 wall: Callable[[], float] = time.time, ssl_required: bool = False) -> None:
        connect_args = {"connect_timeout": CONNECT_TIMEOUT_S, "tcp_user_timeout": TCP_USER_TIMEOUT_MS,
                        "options": f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
                        **({"sslmode": "require"} if ssl_required else {})}
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, pool_timeout=CONNECT_TIMEOUT_S,
                                     hide_parameters=True, connect_args=connect_args)
        self._hospital, self._clock, self._wall = hospital, clock, wall
        self._state: TableState | None = None
        self._checked_at = float("-inf")
        self._said: tuple | None = None

    def current(self, now: float | None = None) -> TableState:
        now = self._clock() if now is None else now
        if self._state is not None and 0 <= now - self._checked_at < RELOAD_EVERY_S:
            return self._state
        self._checked_at = now
        state, failure = self._read()
        said = (state.status, state.reason, state.version, state.sha256, failure)
        if said != self._said:
            self._said = said
            if state.status == "ok":
                log.info("cihaz→yatak tablosu (veritabanı): sürüm %d, sha256 %s…, %d satır",
                         state.version, state.sha256[:12], len(state.table.rows))
            else:
                log.warning("cihaz→yatak tablosu (veritabanı) okunamadı (%s): %s%s; bütün cihazlar atanmamış",
                            state.status, state.reason, f" [{failure}]" if failure else "")
        self._state = state
        return state

    def invalidate(self) -> None:
        """The next `current()` reads the database again, whatever RELOAD_EVERY_S says."""
        self._checked_at = float("-inf")

    def dispose(self) -> None:
        self._engine.dispose()

    def _read(self) -> tuple[TableState, str | None]:
        """The state, and `_failure`'s label of the exception behind an `invalid` one (None for a broken
        current set, which names its own rule). Never raises: the last `ok` is not kept."""
        try:
            return self._load(), None
        except TableError as error:
            return TableState(None, "invalid", error.reason, None, None), None
        except Exception as exc:                  # the database, or building the table from its rows
            return TableState(None, "invalid", UNREADABLE, None, None), _failure(exc)

    def _load(self) -> TableState:
        wall = datetime.fromtimestamp(self._wall(), timezone.utc)
        with self._engine.connect() as conn:
            loaded = conn.execute(_READ, {"slug": self._hospital, "now": wall}).mappings().all()
        rows = [r for r in loaded if r["source"] is not None]
        if not rows:                       # no tenant, no rows, or every row closed before `now`
            return TableState(None, "missing", MISSING, None, None)
        table_rows = tuple(to_row(r) for r in rows)
        check_current(table_rows)
        newest = max(rows, key=lambda r: r["approved_at"])
        version = int(rows[0]["head"])
        table = DeviceBedTable(version, rows[0]["tenant_name"], newest["approved_by"],
                               newest["approved_at"].astimezone(timezone.utc).date().isoformat(), table_rows)
        current = [row for row in table_rows if row.valid_to is None]
        return TableState(table, "ok", None, rows_digest(current), version)
