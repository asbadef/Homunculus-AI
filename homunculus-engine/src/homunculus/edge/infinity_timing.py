"""Where the research transport spends its time: bounded integer counters, no packet content.

Each name keeps a count, a total and a fixed histogram, all integers and all cumulative since
the process started. Cumulative, because two readings taken any distance apart then give an
exact average and an exact tail over the span between them, the way the queue counters do;
a 24-hour watch needs two readings, not a sampler left running. In memory only: writing them
to the journal would add a commit to the very path being measured, and a restart resetting
them is visible (the count goes down).

The unit is part of the name (`_ms`, `_events`). The names are a closed list on each side and
the hub refuses any other, so a heartbeat can never carry free text.
"""
from __future__ import annotations

import re
import threading
import time

BUCKETS = (10, 50, 100, 250, 500, 1000, 3000)     # upper edges; one more bucket above the last
WIDTH = 2 + len(BUCKETS) + 1
LIMIT = 10**12
NAME = re.compile(r"[a-z][a-z0-9_]{0,47}\Z")

# The journal's own phases, timed on both sides.
JOURNAL_NAMES = frozenset({"append_ms", "pending_ms", "ack_ms", "snapshot_ms", "lock_wait_ms",
                           "expire_ms", "capacity_ms", "insert_ms", "commit_ms"})
WORKER_NAMES = JOURNAL_NAMES | {"connect_ms", "post_ms", "flush_ms", "batch_events"}
HUB_NAMES = JOURNAL_NAMES | {"packets_ms", "body_ms", "validate_ms", "consume_ms", "lag_ms",
                             "batch_events", "status_ms"}


class Timings:
    def __init__(self, clock=time.perf_counter):
        self.clock = clock
        self.lock = threading.Lock()
        self.values = {}

    def add(self, name, amount):
        if not NAME.fullmatch(name):
            raise ValueError("Invalid timing name.")
        amount = min(LIMIT, max(0, int(round(amount))))
        slot = next((i for i, edge in enumerate(BUCKETS) if amount <= edge), len(BUCKETS))
        with self.lock:
            entry = self.values.setdefault(name, [0] * WIDTH)
            entry[0] += 1
            entry[1] += amount
            entry[2 + slot] += 1

    def since(self, name, started):
        """Record the milliseconds elapsed since `started` (a reading of `self.clock`)."""
        self.add(name, (self.clock() - started) * 1000)

    def snapshot(self):
        with self.lock:
            return {name: list(entry) for name, entry in self.values.items()}


def valid_snapshot(value, names):
    """A snapshot the hub will store: known names, integers in range, counts that add up."""
    if not isinstance(value, dict) or len(value) > len(names):
        return False
    for name, entry in value.items():
        if (name not in names or not isinstance(entry, list) or len(entry) != WIDTH
                or any(type(v) is not int or not 0 <= v <= LIMIT for v in entry)
                or entry[0] != sum(entry[2:])):
            return False
    return True
