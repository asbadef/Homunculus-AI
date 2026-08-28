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
