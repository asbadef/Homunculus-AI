# src/homunculus/edge/filewatch.py
"""Which NCE session files still need forwarding, and in what order.

NCE writes one file per device session into SavedCopies and never tells us it has done so. This
module answers two questions and nothing else: which files are new, and which order they go in.
Parsing lives in ncefiles.py; delivery lives in uplink.py.

PHI: file *names* are device metadata (peer address, port, timestamp) and may be logged. File
*contents* are patient data and are never read here.
"""
from __future__ import annotations

import logging
import re
import sqlite3
import stat
from dataclasses import dataclass
from pathlib import Path

_log = logging.getLogger(__name__)

# Session names look like: TCP_10.10.98.229_35900-1787921687-24464-DeviceSession.xml
# The ten-digit group is seconds since the Unix epoch. This was established, not assumed:
# 1787921620 decodes to 2026-08-28 12:53:40 UTC and 1787921687 to 12:54:47 UTC, and the 67-second
# gap matches the two files' write times exactly.
_EPOCH_IN_NAME = re.compile(r"-(\d{10})-")


def session_epoch(name: str) -> int | None:
    """The UTC epoch NCE stamped into a session filename, or None if it carries none."""
    match = _EPOCH_IN_NAME.search(name)
    return int(match.group(1)) if match else None


class ProcessedLedger:
    """Which session files have already been forwarded.

    Keyed by name AND size AND modification time, not by name alone: if NCE appends to a session
    after our first read, a name-keyed ledger would skip the new content forever and the loss would
    be invisible. Modification time is stored as whole seconds because the value crosses a network
    filesystem, where sub-second precision is neither stable nor comparable.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).resolve()
        # check_same_thread=False: the scan runs via asyncio.to_thread, so calls may arrive from
        # worker threads (sqlite3 is serialized-mode in CPython).
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

    def first_start_epoch(self, now_epoch: int) -> int:
        """The epoch of the FIRST-ever start, remembered across restarts.

        The default scan window opens here, not at the current start: a bridge that reopens its
        window at every boot silently drops the sessions written while it was down — exactly the
        gap the ledger exists to close.
        """
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
        self._conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('first_start', ?)", (now_epoch,))
        self._conn.commit()
        (value,) = self._conn.execute(
            "SELECT value FROM meta WHERE key = 'first_start'").fetchone()
        return int(value)

    def close(self) -> None:
        self._conn.close()


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

    `since_epoch` deliberately does not filter out epoch-less names: dropping an unrecognised file
    because of a date filter would lose a reading outright, so it is offered like any other file and,
    if it turns out to be unusable, refused downstream where that is counted.

    An unreadable directory returns an empty list and logs. A dropped mount is a condition to ride
    out, not a reason to exit — the bridge that exits is the one nobody restarts.
    """
    root = Path(directory)
    try:
        entries = list(root.iterdir())
    except OSError as exc:
        _log.warning("session directory unreadable (%s): %s", exc.__class__.__name__, root)
        return []

    # Name-based, not resolve()-based: a resolve() is another network round-trip per entry, and NCE
    # session names always look like TCP_..., never like a ledger file, so a name collision here
    # would not be a realistic session file — it would be the ledger itself (or a sidecar).
    ledger_names = {
        ledger.path.name,
        ledger.path.name + "-journal",
        ledger.path.name + "-wal",
        ledger.path.name + "-shm",
    }

    found: list[SessionFile] = []
    unreadable = 0
    for entry in entries:
        if entry.name in ledger_names:
            continue        # the ledger must never offer itself (or its sidecars) for forwarding
        try:
            st = entry.stat()
        except OSError:
            unreadable += 1
            continue        # vanished or unreadable between listing and stat; next pass will see it
        if not stat.S_ISREG(st.st_mode):
            continue
        epoch = session_epoch(entry.name)
        if since_epoch is not None and epoch is not None and epoch < since_epoch:
            continue
        size, mtime = st.st_size, int(st.st_mtime)
        if ledger.seen(entry.name, size, mtime):
            continue
        found.append(SessionFile(entry, entry.name, size, mtime, epoch))

    if unreadable:
        _log.warning("skipped %s unreadable entr(y/ies) in %s", unreadable, root)

    found.sort(key=lambda f: (f.epoch is None, f.epoch or 0, f.name))
    return found[:limit]
