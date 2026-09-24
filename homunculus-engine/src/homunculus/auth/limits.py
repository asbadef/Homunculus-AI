"""In-memory attempt limits for the authentication routes.

A six-digit TOTP code has a million values and the verify step accepts three of them (clock
drift), so an unlimited verify route is guessable from a pending-MFA session — which only needs
the password. `FailureLimiter` locks a key (the user id) after a run of consecutive failures.

In memory on purpose: the engine runs as a single process (one uvicorn worker), and a restart
clearing the counters costs an attacker a restart they cannot trigger. More than one worker
would need this moved to shared storage.
"""
from __future__ import annotations

import time
from collections.abc import Callable


class FailureLimiter:
    """After `max_failures` consecutive failures a key is locked for `lock_seconds`; a success
    clears it. When a lock lifts the count starts again from zero."""

    def __init__(self, *, max_failures: int = 5, lock_seconds: float = 300,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_failures = max_failures
        self.lock_seconds = lock_seconds
        self._clock = clock
        self._failures: dict[str, int] = {}
        self._locked_until: dict[str, float] = {}

    def locked(self, key: str) -> bool:
        until = self._locked_until.get(key)
        if until is None:
            return False
        if self._clock() >= until:
            del self._locked_until[key]
            return False
        return True

    def failed(self, key: str) -> bool:
        """Count a failure. True exactly when THIS failure engages the lock — the moment worth
        one audit row; requests refused while the lock holds are not."""
        count = self._failures.get(key, 0) + 1
        if count >= self.max_failures:
            self._failures.pop(key, None)
            self._locked_until[key] = self._clock() + self.lock_seconds
            return True
        self._failures[key] = count
        return False

    def succeeded(self, key: str) -> None:
        self._failures.pop(key, None)
        self._locked_until.pop(key, None)


# Wrong TOTP codes, keyed by user id.
totp_failures = FailureLimiter(max_failures=5, lock_seconds=300)
