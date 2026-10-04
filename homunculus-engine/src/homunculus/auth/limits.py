"""In-memory attempt limits for the authentication routes.

A six-digit TOTP code has a million values and the verify step accepts three of them (clock
drift), so an unlimited verify route is guessable from a pending-MFA session — which only needs
the password. `FailureLimiter` locks a key (the user id) after a run of consecutive failures.

An Active Directory account's password is checked by a bind, and every failed bind also counts
toward the hospital domain's own lockout. AD keeps an account's count of bad passwords until its
"Reset account lockout counter after" period passes with NONE, measured from the last one — it
does not let old failures age out one by one, so one wrong password every 5 minutes keeps the
count growing. `FailureChain` (`directory_binds`) counts Homunculus' failed binds for one account
the same way: a chain of failures lasts until DIRECTORY_BIND_WINDOW_S pass with no failed bind;
once it holds 3, the sign-in is refused without a bind until then. An administrator may let 3
more through, once per chain (`FailureChain.unlock`).

The invariant: one chain holds at most 3 + 3 = 6 failed binds. If DIRECTORY_BIND_WINDOW_S is at
least the domain's reset period, Homunculus' failed binds that AD counts in one run also fall in
one chain, so Homunculus alone adds at most 6 to AD's count before it resets: the domain's
lockout threshold must be at least 7. Other bad passwords for the same account — the clinician
mistyping on a ward PC — count toward AD's counter too, and can keep it from resetting between
two chains.

In memory on purpose: the engine runs as a single process (one uvicorn worker), and a restart
clearing the counters costs an attacker a restart they cannot trigger. More than one worker
would need this moved to shared storage.
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass


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


@dataclass
class _Chain:
    allowed: int                  # failures this chain lets through: max_failures, + one unlock
    failures: int = 0
    last: float = 0.0             # when the latest failure was recorded
    unlocked: bool = False        # this chain's one unlock has been given
    running: int = 0              # attempts in flight


class FailureChain:
    """Failed attempts per key, counted in chains, as AD counts bad passwords.

    A chain lasts until more than `quiet_seconds` pass after its LAST failure with no attempt
    in flight; the next attempt then starts a new one. A refused attempt is no failure and does
    not extend it.

    An attempt reserves its place first (`begin`) and counts as a possible failure while it
    runs: `begin` refuses once the chain's failures plus its attempts in flight reach what the
    chain allows — `max_failures`, `max_failures` more after an `unlock` — so concurrent
    requests cannot overshoot it, and one chain never holds more than 2 × `max_failures`. `end`
    releases the place and records whether the attempt failed, in the chain it began in (an
    attempt in flight keeps its chain alive); `succeeded` ends the chain.

    Times are recorded when an attempt ends, after the directory answered: the gap Homunculus
    measures between two failures is never longer than the one the domain controller saw, so a
    chain never ends before AD's count (with a reset period up to `quiet_seconds`) would."""

    def __init__(self, *, max_failures: int, quiet_seconds: float,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_failures = max_failures
        self.quiet_seconds = quiet_seconds
        self._clock = clock
        self._chains: dict[str, _Chain] = {}

    def _current(self, key: str) -> _Chain | None:
        """The key's chain, or None when it has none: never one, or it has gone quiet (it is
        forgotten then, so the table holds only chains still alive or in use)."""
        chain = self._chains.get(key)
        if chain is not None and chain.running == 0 and (
                chain.failures == 0 or self._clock() - chain.last > self.quiet_seconds):
            del self._chains[key]
            return None
        return chain

    def begin(self, key: str) -> bool:
        """Reserve a place for one attempt; False (try nothing) when the chain is full."""
        chain = self._current(key)
        if chain is None:
            chain = self._chains[key] = _Chain(allowed=self.max_failures)
        if chain.failures + chain.running >= chain.allowed:
            return False
        chain.running += 1
        return True

    def end(self, key: str, *, failed: bool) -> None:
        """Release the place `begin` reserved; a failed attempt is counted in the chain, from
        now."""
        chain = self._chains.get(key)
        if chain is None:                    # no `begin` before it: count it all the same
            chain = self._chains[key] = _Chain(allowed=self.max_failures)
        chain.running = max(0, chain.running - 1)
        if failed:
            chain.failures += 1
            chain.last = self._clock()
        elif chain.failures == 0 and chain.running == 0:
            del self._chains[key]

    def succeeded(self, key: str) -> None:
        """End the key's chain: the password was right. Attempts in flight keep their places,
        in a new chain."""
        chain = self._chains.pop(key, None)
        if chain is not None and chain.running:
            self._chains[key] = _Chain(allowed=self.max_failures, running=chain.running)

    def unlock(self, key: str) -> int | None:
        """An administrator's unlock: `max_failures` more failed attempts in the key's current
        chain, once per chain. Returns the chain's failures — 0 when it holds none (no chain,
        one gone quiet, a local account): then nothing is granted and the chain's unlock is not
        used. None when this chain's unlock has been given already: refused, nothing changes.
        The chain still ends only after a quiet period; attempts in flight keep their places."""
        chain = self._current(key)
        if chain is None or chain.failures == 0:
            return 0
        if chain.unlocked:
            return None
        chain.unlocked = True
        chain.allowed += self.max_failures
        return chain.failures


# Wrong TOTP codes, keyed by user id.
totp_failures = FailureLimiter(max_failures=5, lock_seconds=300)

# Failed AD password binds, keyed by the Homunculus user id (whatever login form was typed).
# These MUST stay inside the hospital domain's lockout policy: 3 + 3 (with an unlock) below its
# "Account lockout threshold" — so that threshold at least 7 — and the quiet period at least its
# "Reset account lockout counter after". That policy is not known yet (AD's default is often
# 5-10 attempts — ask hospital IT), and the clinician's own mistyped logons on ward PCs count
# toward it as well. The sign-in refusal (auth/router.py, _DIRECTORY_THROTTLED) and the second
# unlock's (admin/service.py, UNLOCK_COOLDOWN) say "15 dakika": keep them in step.
DIRECTORY_BIND_MAX_FAILURES = 3
DIRECTORY_BIND_WINDOW_S = 15 * 60
directory_binds = FailureChain(max_failures=DIRECTORY_BIND_MAX_FAILURES,
                               quiet_seconds=DIRECTORY_BIND_WINDOW_S)
