"""The AD lockout bound, checked against random schedules (spec §7, Security; `auth/limits.py`).

The real FailureChain, driven as `auth/router.py` drives it — `begin`; `end` with what the
directory reported; `succeeded` right after `end` for a right password; an administrator's
`unlock` at any moment — against the hospital domain's own bad-password counter. Homunculus
must never make AD count more than 3 + 3 = 6 of its failed binds in one of AD's runs.

AD, per account, one domain controller: a wrong bind PROCESSED at t restarts the count when the
previous one is more than RESET older (the strict boundary, the worst case for us), then adds
one; a right bind processed at t resets it to 0. RESET is the quiet period itself, the longest
reset period the throttle allows.

When the domain controller processes each bind, in the code's own model:
  answered, wrong or right         some time between the attempt's begin and its end
  cut off by the deadline once     between begin and end + DEADLINE  (end: failed, pending =
    the bind had been sent                                             the deadline)
  the bind sent, ldap3's receive   between begin and end + DEADLINE  (end: failed, pending =
    timeout gave up on its answer                                      what Ldap3Directory
                                                                       reports, read below)
  a marked cancellation            between begin and end + DEADLINE, or never
  an unmarked one                  between begin and end + DEADLINE_CAP_S, or never
  not sent, no bind (disabled,     never
    not found)
A domain controller that processes a request more than one deadline after it left Homunculus
is outside the guarantee (auth/limits.py says so).

Seeded and bounded: SCHEDULES random schedules (half adversarial: every wrong bind processed
as late as it may be, every right one as early) run in a few seconds. For a longer search:
`python -m tests.test_directory_bind_invariant 300000` from homunculus-engine/ (PYTHONPATH=src).
"""
from __future__ import annotations

import asyncio
import random
import sys
from collections.abc import Callable

from ldap3.core.exceptions import LDAPResponseTimeoutError

from homunculus.auth.ldap import DEADLINE_CAP_S, LdapUnavailable, load_ldap_config
from homunculus.auth.ldap3_directory import Ldap3Directory
from homunculus.auth.limits import DIRECTORY_BIND_MAX_FAILURES, FailureChain

RESET = 900.0                    # AD's reset period = the quiet period: the boundary case
DEADLINE = 10.0                  # a sign-in's deadline at the default LDAP_TIMEOUT_S (2 × 5 s)
SCHEDULES = 4000
BOUND = 2 * DIRECTORY_BIND_MAX_FAILURES          # 3 + 3 with an unlock


class _Clock:
    t = 0.0

    def __call__(self) -> float:
        return self.t


class _UnansweredBind:
    """ldap3's connection as `check_password` uses it: opened, then the bind goes out and
    ldap3's receive timeout gives up on its answer."""
    result: dict = {}
    socket = None

    def open(self, read_server_info=True):
        pass

    def bind(self):
        raise LDAPResponseTimeoutError("no answer")

    def unbind(self):
        pass


def receive_timeout_pending(deadline: float = DEADLINE) -> float:
    """What the real Ldap3Directory reports, as `bind_pending_s`, for a bind the domain
    controller received and ldap3's receive timeout stopped waiting for — the route dates the
    failure that much later. Read from the code, not assumed: the model below uses it."""
    config = load_ldap_config({
        "LDAP_URL": "ldaps://dc1.hastane.local", "LDAP_BIND_DN": "CN=svc,DC=hastane,DC=local",
        "LDAP_BIND_PASSWORD": "x", "LDAP_BASE_DN": "DC=hastane,DC=local"})
    directory = Ldap3Directory(config, connect=lambda user, password: _UnansweredBind(),
                               deadline_s=deadline)
    try:
        asyncio.run(directory.check_password("CN=u,DC=hastane,DC=local", "Yanlis-1"))
    except LdapUnavailable as exc:
        assert exc.bind_attempted
        return exc.bind_pending_s
    finally:
        directory.close()
    raise AssertionError("an unanswered bind must be an outage")


def _pick(rng: random.Random, lo: float, hi: float) -> float:
    r = rng.random()
    if r < 0.3:
        return lo
    if r < 0.6:
        return hi
    return rng.uniform(lo, hi)


_KINDS = ["bad", "bad", "bad", "good", "bad_cut", "good_cut", "not_sent", "cancel_marked",
          "cancel_unmarked", "no_bind", "disabled", "bad_recv", "bad_recv", "good_recv"]


def _schedule(rng: random.Random) -> tuple[list[dict], list[float]]:
    """Attempts for one account (begin, end, kind) — bursts, concurrency, and attempts placed
    right at the edges of AD's reset period after an earlier one — and administrators'
    unlocks, some at the very moment an attempt begins or ends."""
    attempts: list[dict] = []
    t = 0.0
    for _ in range(rng.randint(3, 40)):
        r = rng.random()
        if r < 0.45:
            t += rng.choice([0.0, 0.0, 0.001, rng.uniform(0, 3)])
        elif r < 0.75:
            base = rng.choice(attempts)["e"] if attempts else t
            base += rng.choice([0.0, DEADLINE, DEADLINE_CAP_S])
            t = max(t, base + RESET + rng.choice([-0.001, 0.0, 0.001, -1, 1]))
        else:
            t += rng.uniform(0, 400)
        duration = rng.choice([0.0, 0.001, rng.uniform(0, DEADLINE), DEADLINE])
        attempts.append({"b": t, "e": t + duration, "kind": rng.choice(_KINDS)})
    unlocks = [rng.uniform(0, t + 1) for _ in range(rng.randint(0, 4))]
    for a in attempts:
        if rng.random() < 0.15:
            unlocks.append(a["b"] + rng.choice([0.0, 0.0005, a["e"] - a["b"]]))
    return attempts, unlocks


def run_schedule(seed: int, recv_pending: float) -> int:
    """One schedule through the real FailureChain; AD's highest count over it."""
    rng = random.Random(seed)
    adversarial = seed % 2 == 0
    clock = _Clock()
    chain = FailureChain(max_failures=DIRECTORY_BIND_MAX_FAILURES, quiet_seconds=RESET,
                         clock=clock)
    attempts, unlocks = _schedule(rng)
    events = []                                   # (time, tie-break, kind, attempt index)
    for i, a in enumerate(attempts):
        tie = rng.random()
        events.append((a["b"], tie, "begin", i))
        events.append((a["e"], tie + 1e-12 if a["e"] == a["b"] else rng.random(), "end", i))
    events += [(u, rng.random(), "unlock", None) for u in unlocks]
    events.sort(key=lambda ev: (ev[0], ev[1]))
    # At equal times the domain controller processes binds in the order Homunculus' own events
    # put them: a bind processed at its attempt's begin comes just after that begin, one
    # processed at its end just before that end.
    position = {(kind, i): n for n, (_, _, kind, i) in enumerate(events) if i is not None}
    tickets = {}
    processed: list[tuple[float, float, str]] = []   # (time, tie-break, "bad" | "good")

    for t, _, kind, i in events:
        clock.t = t
        if kind == "unlock":
            chain.unlock("k")
            continue
        if kind == "begin":
            tickets[i] = chain.begin("k")
            continue
        ticket = tickets[i]
        if ticket is None:                        # refused: nothing sent, nothing to end
            continue
        b, e, what = attempts[i]["b"], attempts[i]["e"], attempts[i]["kind"]

        def reaches(lo: float, hi: float, bad: bool, verdict: str) -> None:
            p = (hi if bad else lo) if adversarial else _pick(rng, lo, hi)
            if p == b:
                order = position[("begin", i)] + 0.5
            elif p == e:
                order = position[("end", i)] - 0.5
            else:
                order = rng.random() * len(events)
            processed.append((p, order, verdict))

        end: Callable[..., None] = lambda **kw: chain.end("k", ticket, **kw)  # noqa: E731
        if what == "bad":
            end(failed=True)
            reaches(b, e, True, "bad")
        elif what == "good":
            end(failed=False)
            chain.succeeded("k", ticket)
            reaches(b, e, False, "good")
        elif what in ("bad_cut", "good_cut"):
            end(failed=True, pending_s=DEADLINE)
            reaches(b, e + DEADLINE, what == "bad_cut", what[:-4])
        elif what in ("bad_recv", "good_recv"):
            end(failed=True, pending_s=recv_pending)
            reaches(b, e + DEADLINE, what == "bad_recv", what[:-5])
        elif what in ("cancel_marked", "cancel_unmarked"):
            late = DEADLINE if what == "cancel_marked" else DEADLINE_CAP_S
            end(failed=True, pending_s=late)
            verdict = rng.choice(["bad", "good", None])
            if verdict is not None:
                reaches(b, e + late, verdict == "bad", verdict)
        elif what == "no_bind":
            end(failed=True)                      # not found: no bind, counted all the same
        else:                                     # not sent, or disabled: no bind
            end(failed=False)

    count, last_bad, worst = 0, None, 0
    for p, _, verdict in sorted(processed):
        if verdict == "good":
            count = 0
            continue
        if last_bad is not None and p - last_bad > RESET:
            count = 0
        count += 1
        last_bad = p
        worst = max(worst, count)
    assert len(chain._chains) <= 1                # the table holds only this account's chain
    return worst


def worst_over(schedules: range, recv_pending: float) -> tuple[int, int]:
    """AD's highest count over the schedules, and the first seed that reached it."""
    worst, at = -1, -1
    for seed in schedules:
        count = run_schedule(seed, recv_pending)
        if count > worst:
            worst, at = count, seed
    return worst, at


def test_the_code_reports_a_receive_timeout_bind_as_pending_a_deadline():
    """F8: ldap3's receive timeout ends most stalled binds before the deadline does; that bind
    reached the domain controller, which may still count it — dated a deadline later, as the
    deadline's own cut-off is."""
    assert receive_timeout_pending() == DEADLINE


def test_no_schedule_brings_ad_past_six():
    """AD's count of Homunculus' failed binds never passes 3 + 3 in one of its runs, over
    SCHEDULES seeded schedules with every way a bind can end — the receive-timeout path
    included, dated as the real directory dates it."""
    worst, seed = worst_over(range(SCHEDULES), receive_timeout_pending())
    assert worst <= BOUND, f"AD counted {worst} (seed {seed})"
    assert worst == BOUND                         # the bound is reached: the model has teeth


def test_dated_when_it_ended_a_receive_timeout_bind_brought_ad_past_six():
    """The same schedules with the receive-timeout path dated "now", as before F8: AD's count
    passes 6 — the hole this closes is real, and these schedules find it."""
    worst, _ = worst_over(range(SCHEDULES), 0.0)
    assert worst > BOUND


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 300_000
    pending = receive_timeout_pending()
    print(f"receive-timeout pending: {pending} s")
    print(f"{n} schedules: AD's highest count, seed = {worst_over(range(n), pending)}")
