# homunculus-engine/src/homunculus/api/shiftclock.py
"""The shift windows of «İş yükü» (G4-04, spec D3 and §5 A2): the shift that holds an instant, and the one after it.

The two starts are Görevlerim's `shift_start_a` / `shift_start_b` (api/tasks.py `TaskSettings`: whole hours in the
tenant's zone, never equal, not necessarily twelve hours apart). A window is bounded by LOCAL wall-clock boundaries: A
runs from a day's `start_a` o'clock to its `start_b` o'clock, B from there to the next local `start_a` — so a window
is 11 or 13 hours the nights a clock changes, and not 12 at all when the two starts are not twelve hours apart. The
boundaries are found by a search over the candidates of the days around the instant (as `api/tasks.py` `shift_window`
finds Görevlerim's list window); a boundary instant begins the new window. A window's key is the UTC instant of its
local start (`nurse_bed_assignments.shift_start`).

`api/fluids.py` `fluid_day` adds 12 and 24 hours to a UTC instant instead, and is not changed in this slice (Asia/Baku
keeps no summer time): the two disagree only on the night a clock changes (plan note N1)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class Shift:
    """One shift: its UTC bounds, and which of the day's two it is — "A" from `start_a`, "B" from `start_b`."""
    start: datetime
    end: datetime
    which: str


def shift_windows(now: datetime, zone, start_a: int, start_b: int) -> tuple[Shift, Shift]:
    """(«Bu nöbet», «Sonraki nöbet»): the window that holds `now`, and the one after it."""
    day = now.astimezone(zone).date()
    starts = sorted(
        (datetime(d.year, d.month, d.day, hour, 0, tzinfo=zone).astimezone(timezone.utc), which)
        for d in (day + timedelta(days=k) for k in (-1, 0, 1, 2))
        for hour, which in ((start_a, "A"), (start_b, "B")))
    at = max(i for i, (start, _) in enumerate(starts) if start <= now)
    (first, which), (second, then), (third, _) = starts[at], starts[at + 1], starts[at + 2]
    return Shift(first, second, which), Shift(second, third, then)
