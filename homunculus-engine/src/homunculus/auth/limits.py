"""In-memory attempt limits for the authentication routes.

A six-digit TOTP code has a million values and the verify step accepts three of them (clock
drift), so an unlimited verify route is guessable from a pending-MFA session — which only needs
the password. `FailureLimiter` locks a key (the user id) after a run of consecutive failures.

An Active Directory account's password is checked by a bind, and every failed bind also counts
toward the hospital domain's own lockout. AD keeps an account's count of bad passwords until its
"Reset account lockout counter after" period passes with NONE, measured from the last one — it
does not let old failures age out one by one, so one wrong password every 5 minutes keeps the
count growing — or until a logon with the right password resets it. `FailureChain`
(`directory_binds`) counts Homunculus' failed binds for one account the same way: a chain of
failures lasts until DIRECTORY_BIND_WINDOW_S pass with no failed bind, or a right password ends
it; once it holds 3, the sign-in is refused without a bind until then. An administrator may let
3 more through, once per chain (`FailureChain.unlock`).

The invariant: one chain holds at most 3 + 3 = 6 failed binds, and it holds every failed bind AD
may still be counting:
  * a failure is dated no earlier than the domain controller can have counted it — when it
    answered, or, for a bind sent that it has not answered (the deadline cut it off, ldap3's
    receive timeout gave up on it, the connection went), one deadline later: as late as that
    bind may still be counted (`end`, `pending_s`, `LdapUnavailable.bind_pending_s`). A domain
    controller that processes a request more than one deadline after it left Homunculus is
    outside this guarantee;
  * a right password forgets only the failures recorded before its attempt began (and dated
    before then): those reached the domain controller before its bind, which reset AD's count.
    The ones recorded since may have reached it after that reset, and AD counts them: they start
    the next chain (`succeeded`, `Ticket`).
If DIRECTORY_BIND_WINDOW_S is at least the domain's reset period, Homunculus' failed binds that
AD counts in one run also fall in one chain, so Homunculus alone adds at most 6 to AD's count
before it resets: the domain's lockout threshold must be at least 7. Other bad passwords for the
same account — the clinician mistyping on a ward PC — count toward AD's counter too, and can keep
it from resetting between two chains.

In memory on purpose: the engine runs as a single process (one uvicorn worker), and a restart
clearing the counters costs an attacker a restart they cannot trigger. A restart is not free,
though: one within DIRECTORY_BIND_WINDOW_S of failed binds starts every account afresh while AD
may still hold up to 6 of them, so across a restart Homunculus can add 6 more — up to 12 in one
of AD's runs. Deploy away from a burst of failed AD sign-ins (the runbook says how to look). More
than one worker would need this moved to shared storage.
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field


class FailureLimiter:
    """After `max_failures` consecutive failures a key is locked for `lock_seconds`; a success
    clears it. When a lock lifts the count starts again from zero.

    A check that awaits before its outcome is known (bcrypt on a worker thread) reserves a place
    first (`begin`) and gives it back when it ends (`end`) — on every path, a cancellation's
    too —, its outcome recorded apart with nothing awaited in between. `begin` refuses while the
    key is locked, or once its failures plus its checks in flight reach `max_failures`: requests
    sent all at once then check no more passwords than the limit allows, where each would
    otherwise pass `locked` before the first answer came back. Nobody waits for a place, so a
    burst holds nothing (a database connection) while it is refused. A check whose outcome is
    known with no await in between (the TOTP code) needs no place."""

    def __init__(self, *, max_failures: int = 5, lock_seconds: float = 300,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_failures = max_failures
        self.lock_seconds = lock_seconds
        self._clock = clock
        self._failures: dict[str, int] = {}
        self._locked_until: dict[str, float] = {}
        self._in_flight: dict[str, int] = {}     # checks between `begin` and `end`, per key

    def begin(self, key: str) -> bool:
        """Reserve a place for one check of `key`: False — check nothing — while it is locked,
        or while its failures plus its checks in flight reach `max_failures`. Every True is
        matched by exactly one `end`."""
        if self.locked(key):
            return False
        running = self._in_flight.get(key, 0)
        if self._failures.get(key, 0) + running >= self.max_failures:
            return False
        self._in_flight[key] = running + 1
        return True

    def end(self, key: str) -> None:
        """Give back the place `begin` reserved. The outcome is recorded apart: `failed` for a
        wrong password, `succeeded` for a right one, neither for a check that said nothing
        (cancelled, or refused for another reason). ValueError, and nothing changes, when `key`
        holds no place."""
        running = self._in_flight.get(key, 0)
        if running < 1:
            raise ValueError("end() without a begin()")
        if running == 1:
            del self._in_flight[key]
        else:
            self._in_flight[key] = running - 1

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


@dataclass(frozen=True)
class Ticket:
    """An attempt's place, as `begin` hands it out for `key`. `attempt` numbers it (one per
    `begin`, unique in its FailureChain): `end` releases exactly this place, once. `seq` is how
    many failures the FailureChain had recorded by then (every key counted) and `at` its clock
    at that moment: `succeeded` reads them to tell the failures that came before this attempt
    from those that may have come after. A ticket is good for its own key and its own
    FailureChain only — `end` and `succeeded` refuse another key's and another chain's
    (ValueError): attempt numbers are counted per chain, so another chain's ticket could
    otherwise name a place here and free it."""
    key: str
    attempt: int
    seq: int
    at: float
    # The FailureChain that handed it out (its `_owner`); left out of repr and comparison.
    owner: object = field(default=None, repr=False, compare=False)


@dataclass(frozen=True)
class _Failure:
    seq: int                      # its place in the order failures were recorded (1, 2, ...)
    at: float                     # the latest the domain controller may have counted it


@dataclass
class _Chain:
    allowed: int                  # failures this chain lets through: max_failures, + one unlock
    failures: list[_Failure] = field(default_factory=list)
    unlocked: bool = False        # the unlock is spent: given in this chain, or in the one its
                                  # failures were carried over from (`succeeded`)
    in_flight: set[int] = field(default_factory=set)   # the attempts (Ticket.attempt) running
    refusal_noted: bool = False   # a refusal of this chain was noted (`note_refusal`); an
                                  # unlock that lets more through clears it

    @property
    def last(self) -> float:
        return max(f.at for f in self.failures)


@dataclass(frozen=True)
class Unlocked:
    """What an unlock found and did: the failures in the key's current chain, and the failures
    that chain lets through before and after it. `granted` is False when there was nothing to
    clear (no failure in the chain): nothing changed, and the chain's unlock is still there."""
    failed: int
    allowed_before: int
    allowed_after: int

    @property
    def granted(self) -> bool:
        return self.allowed_after > self.allowed_before


class FailureChain:
    """Failed attempts per key, counted in chains, as AD counts bad passwords.

    A chain lasts until more than `quiet_seconds` pass after its LAST failure with no attempt
    in flight; the next attempt then starts a new one. A refused attempt is no failure and does
    not extend it.

    An attempt reserves its place first (`begin`, which hands it a Ticket) and counts as a
    possible failure while it runs: `begin` refuses once the chain's failures plus its attempts
    in flight reach what the chain allows — `max_failures`, `max_failures` more after an
    `unlock` — so concurrent requests cannot overshoot it, and one chain never holds more than
    2 × `max_failures`. `end`, with the attempt's ticket, releases that place and records
    whether the attempt failed, in the key's current chain (an attempt in flight keeps its
    chain alive). `succeeded`, called right after `end` for a right password, ends the chain
    for the failures that came before that attempt began; those recorded since start the next
    one.

    Misuse is refused, never absorbed: a ticket used for another key or handed out by another
    FailureChain, an `end` for a place that is not held (ended already, or never handed out)
    and a `succeeded` before its attempt's `end` raise ValueError and change nothing. A silent
    `end` would free another attempt's place and let one more bind through than the chain
    allows.

    A failure is dated when its attempt ends, after the directory answered — or `pending_s`
    later, when the bind was sent and the domain controller has not answered it (cut off, or
    its answer given up on) and may still count it: the gap Homunculus measures between two
    failures is never longer than the one the domain controller saw, so a chain never ends
    before AD's count (with a reset period up to `quiet_seconds`) would."""

    def __init__(self, *, max_failures: int, quiet_seconds: float,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_failures = max_failures
        self.quiet_seconds = quiet_seconds
        self._clock = clock
        self._chains: dict[str, _Chain] = {}
        self._recorded = 0                   # failures recorded so far, every key: Ticket.seq
        self._attempts = 0                   # places handed out so far, every key: .attempt
        self._owner = object()               # stamped on every Ticket this chain hands out

    def _current(self, key: str) -> _Chain | None:
        """The key's chain, or None when it has none: never one, or it has gone quiet (it is
        forgotten then, so the table holds only chains still alive or in use)."""
        chain = self._chains.get(key)
        if chain is not None and not chain.in_flight and (
                not chain.failures or self._clock() - chain.last > self.quiet_seconds):
            del self._chains[key]
            return None
        return chain

    def _own(self, key: str, ticket: Ticket) -> None:
        if ticket.owner is not self._owner:
            raise ValueError("this ticket was handed out by another FailureChain")
        if ticket.key != key:
            raise ValueError("this ticket was handed out for another key")

    def begin(self, key: str) -> Ticket | None:
        """Reserve a place for one attempt: its Ticket, or None (try nothing) when the chain is
        full."""
        chain = self._current(key)
        if chain is None:
            chain = self._chains[key] = _Chain(allowed=self.max_failures)
        if len(chain.failures) + len(chain.in_flight) >= chain.allowed:
            return None
        self._attempts += 1
        chain.in_flight.add(self._attempts)
        return Ticket(key=key, attempt=self._attempts, seq=self._recorded, at=self._clock(),
                      owner=self._owner)

    def end(self, key: str, ticket: Ticket, *, failed: bool, pending_s: float = 0.0) -> None:
        """Release the place `begin` reserved for `ticket`; a failed attempt is counted in the
        chain, dated now — or `pending_s` from now, for a bind the caller stopped waiting for
        while it was under way: the domain controller has not answered it and may still count
        it. ValueError, and nothing changes, when `ticket` holds no place here: another key's,
        ended already, or not handed out by this chain."""
        self._own(key, ticket)
        chain = self._chains.get(key)
        if chain is None or ticket.attempt not in chain.in_flight:
            raise ValueError("end() for an attempt that holds no place: ended already, or "
                             "never begun here")
        chain.in_flight.discard(ticket.attempt)
        if failed:
            self._recorded += 1
            chain.failures.append(_Failure(self._recorded, self._clock() + max(0.0, pending_s)))
        elif not chain.failures and not chain.in_flight:
            del self._chains[key]

    def succeeded(self, key: str, ticket: Ticket) -> None:
        """The attempt holding `ticket` had the right password: AD reset its count when that
        bind reached the domain controller. Call it right after the attempt's `end`, with
        nothing awaited in between — before it (the attempt still in flight), or with another
        key's ticket, it raises ValueError and changes nothing.

        The failures recorded before the ticket, and dated before it, came before that bind:
        forgotten. The others — recorded while it ran, or a cut-off bind dated later
        (`pending_s`) — may have reached the domain controller after it, and AD counts them:
        they start the new chain, with their dates, and with the unlock spent if the old chain
        had spent it. Attempts in flight keep their places, in the new chain."""
        self._own(key, ticket)
        chain = self._chains.get(key)
        if chain is None:
            return
        if ticket.attempt in chain.in_flight:
            raise ValueError("succeeded() before the attempt's end()")
        del self._chains[key]
        kept = [f for f in chain.failures if f.seq > ticket.seq or f.at > ticket.at]
        if kept or chain.in_flight:
            self._chains[key] = _Chain(allowed=self.max_failures, failures=kept,
                                       unlocked=chain.unlocked and bool(kept),
                                       in_flight=chain.in_flight)

    def note_refusal(self, key: str) -> bool:
        """Asked after `begin` refused `key`: True the first time for the key's current chain —
        the refusal worth recording — and False for the ones after it, until the chain ends or
        an `unlock` lets more through. False when the key has no chain. Changes nothing the
        chain counts: it is bookkeeping for the caller's audit trail."""
        chain = self._chains.get(key)
        if chain is None or chain.refusal_noted:
            return False
        chain.refusal_noted = True
        return True

    def unlock(self, key: str) -> Unlocked | None:
        """An administrator's unlock: `max_failures` more failed attempts in the key's current
        chain, once per chain. With no failure in the chain (no chain, one gone quiet, a local
        account) nothing is granted and the chain's unlock is not used (`granted` False). None
        when this chain's unlock is spent: refused, nothing changes. The chain still ends only
        after a quiet period; attempts in flight keep their places."""
        chain = self._current(key)
        if chain is None or not chain.failures:
            allowed = chain.allowed if chain is not None else self.max_failures
            return Unlocked(failed=0, allowed_before=allowed, allowed_after=allowed)
        if chain.unlocked:
            return None
        before = chain.allowed
        chain.unlocked = True
        chain.allowed += self.max_failures
        chain.refusal_noted = False          # once it fills again, its next refusal is new
        return Unlocked(failed=len(chain.failures), allowed_before=before,
                        allowed_after=chain.allowed)


# Wrong TOTP codes, keyed by user id.
totp_failures = FailureLimiter(max_failures=5, lock_seconds=300)

# Wrong passwords at a locked screen (POST /auth/reauth) and wrong current passwords at
# POST /auth/password, for a LOCAL account, keyed by user id: the two places a held token can
# test the account's password, counted together. A sign-in with the right password and an
# administrator's password reset start the count again (and lift a lock). An AD account is never
# counted here: its unlock is a bind and counts in `directory_binds` below, with its sign-ins,
# and /auth/password refuses it before reading a password. The dashboard itself signs out after
# 3 wrong unlocks; this bounds a caller holding the token.
REAUTH_MAX_FAILURES = 5
reauth_failures = FailureLimiter(max_failures=REAUTH_MAX_FAILURES, lock_seconds=15 * 60)

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
