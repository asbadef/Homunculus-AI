"""In-memory attempt limits for the authentication routes.

A six-digit TOTP code has a million values and the verify step accepts three of them (clock
drift), so an unlimited verify route is guessable from a pending-MFA session — which only needs
the password. `FailureLimiter` locks a key (the user id) after a run of consecutive failures.

An Active Directory account's password is checked by a bind, and every failed bind also counts
toward the hospital domain's own lockout. `AttemptWindow` caps the failed binds Homunculus makes
for one account (`directory_binds`), so its sign-in page cannot be used to lock a clinician out
of the domain — every hospital system at once.

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


class AttemptWindow:
    """At most `max_failures` failed attempts per key within any `window_seconds`.

    An attempt reserves its place first (`begin`) and counts as a possible failure while it
    runs: `begin` refuses once the key's failures still inside the window plus its attempts in
    flight reach the limit, so concurrent requests cannot overshoot it. `end` releases the place
    and records whether the attempt failed; `succeeded` clears the key's failures. A refusal
    lifts when the oldest counted failure leaves the window."""

    def __init__(self, *, max_failures: int, window_seconds: float,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._clock = clock
        self._failures: dict[str, list[float]] = {}
        self._running: dict[str, int] = {}

    def _recent(self, key: str) -> int:
        cutoff = self._clock() - self.window_seconds
        recent = [t for t in self._failures.get(key, ()) if t > cutoff]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return len(recent)

    def begin(self, key: str) -> bool:
        """Reserve a place for one attempt; False (try nothing) when the limit is reached."""
        if self._recent(key) + self._running.get(key, 0) >= self.max_failures:
            return False
        self._running[key] = self._running.get(key, 0) + 1
        return True

    def end(self, key: str, *, failed: bool) -> None:
        """Release the place `begin` reserved; a failed attempt is counted from now."""
        running = self._running.get(key, 0) - 1
        if running > 0:
            self._running[key] = running
        else:
            self._running.pop(key, None)
        if failed:
            self._failures.setdefault(key, []).append(self._clock())

    def succeeded(self, key: str) -> None:
        self._failures.pop(key, None)

    def clear(self, key: str) -> int:
        """An administrator's unlock: forget the key's failures; returns how many were still
        inside the window. Attempts in flight keep their places (each releases its own)."""
        recent = self._recent(key)
        self._failures.pop(key, None)
        return recent


# Wrong TOTP codes, keyed by user id.
totp_failures = FailureLimiter(max_failures=5, lock_seconds=300)

# Failed AD password binds, keyed by the Homunculus user id (whatever login form was typed).
# These MUST stay below the hospital domain's lockout policy: the threshold below its "Account
# lockout threshold", the window at least its "Reset account lockout counter after". That
# policy is not known yet (AD's default is often 5-10 attempts — ask hospital IT), and the
# clinician's own mistyped logons on ward PCs count toward it as well; hence 3 in 15 minutes.
# The sign-in refusal (auth/router.py, _DIRECTORY_THROTTLED) says "15 dakika": keep it in step.
DIRECTORY_BIND_MAX_FAILURES = 3
DIRECTORY_BIND_WINDOW_S = 15 * 60
directory_binds = AttemptWindow(max_failures=DIRECTORY_BIND_MAX_FAILURES,
                                window_seconds=DIRECTORY_BIND_WINDOW_S)
