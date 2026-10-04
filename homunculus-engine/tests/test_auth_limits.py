"""The TOTP guessing limit, the AD password-bind throttle, and the time-step check behind replay
refusal, without a database."""
from __future__ import annotations

import pyotp

from homunculus.auth.limits import (
    DIRECTORY_BIND_MAX_FAILURES, DIRECTORY_BIND_WINDOW_S, FailureChain, FailureLimiter, Unlocked,
    directory_binds,
)
from homunculus.auth.totp import accepted_step

SECRET = "JBSWY3DPEHPK3PXP"
NOW = 1_790_000_015.0        # mid-step, so t-30 / t / t+30 fall in three distinct 30-s steps


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _limiter(clock: FakeClock) -> FailureLimiter:
    return FailureLimiter(max_failures=5, lock_seconds=300, clock=clock)


# --- FailureLimiter -------------------------------------------------------------------------

def test_the_limiter_locks_after_five_consecutive_failures():
    lim = _limiter(FakeClock())
    for _ in range(4):
        lim.failed("u")
        assert lim.locked("u") is False
    lim.failed("u")
    assert lim.locked("u") is True


def test_failed_reports_true_exactly_when_it_engages_the_lock():
    """The route writes one `mfa.locked` audit row at that moment, not one per refused request."""
    clock = FakeClock()
    lim = _limiter(clock)
    assert [lim.failed("u") for _ in range(5)] == [False, False, False, False, True]
    clock.t += 300
    assert lim.locked("u") is False
    assert [lim.failed("u") for _ in range(5)] == [False, False, False, False, True]


def test_the_lock_lifts_after_300_seconds():
    clock = FakeClock()
    lim = _limiter(clock)
    for _ in range(5):
        lim.failed("u")
    clock.t += 299
    assert lim.locked("u") is True
    clock.t += 1
    assert lim.locked("u") is False


def test_after_the_lock_lifts_the_count_starts_again():
    clock = FakeClock()
    lim = _limiter(clock)
    for _ in range(5):
        lim.failed("u")
    clock.t += 300
    assert lim.locked("u") is False
    lim.failed("u")
    assert lim.locked("u") is False


def test_a_success_resets_the_count():
    lim = _limiter(FakeClock())
    for _ in range(4):
        lim.failed("u")
    lim.succeeded("u")
    for _ in range(4):
        lim.failed("u")
    assert lim.locked("u") is False


def test_keys_are_independent():
    lim = _limiter(FakeClock())
    for _ in range(5):
        lim.failed("a")
    assert lim.locked("a") is True and lim.locked("b") is False


# --- FailureChain (AD password binds) ---------------------------------------------------------

def _chain(clock: FakeClock) -> FailureChain:
    return FailureChain(max_failures=3, quiet_seconds=900, clock=clock)


def _fail(chain: FailureChain, key: str = "u") -> None:
    assert chain.begin(key) is True
    chain.end(key, failed=True)


def test_three_failures_in_a_chain_refuse_the_next_attempt():
    clock = FakeClock()
    chain = _chain(clock)
    for _ in range(3):
        _fail(chain)
        clock.t += 60
    assert chain.begin("u") is False


def test_the_refusal_lasts_until_the_quiet_period_after_the_last_failure():
    """AD resets its count only when its reset period passes with NO bad password, measured
    from the last one — not when the oldest leaves a sliding window. Neither does the chain:
    failures at 1000, 1100, 1200 hold it until 15 minutes after 1200, and then it starts over."""
    clock = FakeClock()
    chain = _chain(clock)
    for _ in range(3):
        _fail(chain)
        clock.t += 100                      # failures at 1000, 1100, 1200
    clock.t = 1000 + 900                    # the first failure is 15 minutes old...
    assert chain.begin("u") is False        # ...and the chain still holds
    clock.t = 1200 + 900
    assert chain.begin("u") is False        # exactly 15 minutes of quiet is not more
    clock.t = 1200 + 901
    for _ in range(3):                      # a new chain: three more
        _fail(chain)
    assert chain.begin("u") is False


def test_a_refusal_is_not_a_failure_and_does_not_extend_the_chain():
    """A refused sign-in never reached the directory, so it counts for nothing in AD either."""
    clock = FakeClock()
    chain = _chain(clock)
    for _ in range(3):
        _fail(chain)
    for _ in range(9):
        clock.t += 100
        assert chain.begin("u") is False    # refused every 100 s for 900 s
    clock.t += 1
    assert chain.begin("u") is True


def test_failures_further_apart_than_the_quiet_period_never_refuse():
    clock = FakeClock()
    chain = _chain(clock)
    for _ in range(10):
        _fail(chain)
        clock.t += 901                      # each starts a chain of its own


def test_attempts_in_flight_count_so_concurrent_requests_cannot_overshoot():
    chain = _chain(FakeClock())
    _fail(chain)
    assert chain.begin("u") is True and chain.begin("u") is True    # two running at once
    assert chain.begin("u") is False                                 # 1 failure + 2 running
    chain.end("u", failed=False)
    assert chain.begin("u") is True


def test_an_attempt_in_flight_keeps_its_chain_alive():
    """A failure lands in the chain its attempt began in — AD saw that bad password when the
    attempt began — however long the directory took to answer."""
    clock = FakeClock()
    chain = _chain(clock)
    _fail(chain)
    _fail(chain)
    assert chain.begin("u") is True
    clock.t += 2000                         # past the quiet period, the attempt still running
    chain.end("u", failed=True)
    assert chain.begin("u") is False        # three in one chain


def test_an_attempt_that_did_not_fail_releases_its_place_without_counting():
    chain = _chain(FakeClock())
    for _ in range(5):
        assert chain.begin("u") is True
        chain.end("u", failed=False)
    _fail(chain)
    _fail(chain)
    assert chain.begin("u") is True


def test_a_success_ends_the_chain():
    chain = _chain(FakeClock())
    _fail(chain)
    _fail(chain)
    chain.succeeded("u")
    _fail(chain)
    _fail(chain)
    assert chain.begin("u") is True


def test_chain_keys_are_independent():
    chain = _chain(FakeClock())
    for _ in range(3):
        _fail(chain, "a")
    assert chain.begin("a") is False and chain.begin("b") is True


def test_an_unlock_lets_three_more_through_once_per_chain():
    """The administrator's unlock (/admin/users/{id}/unlock-sign-in): three more failed binds
    in this chain, and that once — a second unlock in the same chain is refused (None) and
    changes nothing. It says what it found and did (the audit row's before and after)."""
    clock = FakeClock()
    chain = _chain(clock)
    for _ in range(3):
        _fail(chain)
    unlocked = chain.unlock("u")
    assert unlocked == Unlocked(failed=3, allowed_before=3, allowed_after=6)
    assert unlocked.granted is True
    for _ in range(3):
        _fail(chain)
    assert chain.begin("u") is False
    assert chain.unlock("u") is None
    assert chain.begin("u") is False


def test_an_unlock_does_not_end_the_chain():
    """Only a quiet period (or a success) does: the unlocked chain still ends 15 minutes after
    its last failure, and only then is there a new unlock to give."""
    clock = FakeClock()
    chain = _chain(clock)
    for _ in range(3):
        _fail(chain)
        clock.t += 600
    assert chain.unlock("u").failed == 3    # 600 s after the last failure
    for _ in range(3):
        _fail(chain)
        clock.t += 600                      # gaps of 10 minutes: one chain throughout
    assert chain.begin("u") is False and chain.unlock("u") is None
    clock.t += 301                          # 901 s after the last failure
    assert chain.begin("u") is True
    chain.end("u", failed=True)
    assert chain.unlock("u").failed == 1    # a new chain, a new unlock


def test_an_unlock_with_nothing_to_clear_grants_nothing_and_uses_nothing():
    """No failure in the current chain — none ever, an earlier chain gone quiet, a local account
    — grants nothing (`granted` False, 3 allowed before and after), and the chain's one unlock
    is still there when it is needed."""
    clock = FakeClock()
    chain = _chain(clock)
    nothing = Unlocked(failed=0, allowed_before=3, allowed_after=3)
    assert chain.unlock("u") == nothing and nothing.granted is False
    for _ in range(3):
        _fail(chain)
    assert chain.begin("u") is False        # the empty unlock granted nothing
    assert chain.unlock("u").granted        # and did not use the chain's unlock
    clock.t += 901
    assert chain.unlock("u") == nothing     # that chain has gone quiet
    assert chain.unlock("never-failed") == nothing


def test_an_unlock_leaves_attempts_in_flight_their_places():
    chain = _chain(FakeClock())
    _fail(chain)
    _fail(chain)
    assert chain.begin("u") is True                              # in flight
    assert chain.unlock("u").failed == 2
    for _ in range(3):
        assert chain.begin("u") is True                          # 2 + 1 running + 3 = 6
    assert chain.begin("u") is False


def _against_ad(*, every_s: float, ad_reset_s: float, unlock: bool,
                hours: float = 2) -> tuple[int, int, int]:
    """A wrong password for one account every `every_s`, as often as Homunculus lets it reach
    the domain controller, for `hours` — and, with `unlock`, an administrator unlocking the
    account whenever the throttle lets them (a hijacked session, or a careless one). The real
    FailureChain at the production settings. The domain's counter as AD keeps it: reset when a
    bad password comes more than `ad_reset_s` after the previous one. Returns the binds made,
    AD's highest count and the longest run of binds no more than the quiet period apart."""
    clock = FakeClock()
    clock.t = 0.0
    chain = FailureChain(max_failures=DIRECTORY_BIND_MAX_FAILURES,
                         quiet_seconds=DIRECTORY_BIND_WINDOW_S, clock=clock)
    binds: list[float] = []
    count = peak = 0
    while clock.t < hours * 3600:
        if unlock:
            chain.unlock("u")
        if chain.begin("u"):
            if binds and clock.t - binds[-1] > ad_reset_s:
                count = 0
            count += 1
            peak = max(peak, count)
            binds.append(clock.t)
            chain.end("u", failed=True)
        clock.t += every_s
    run = longest = 0
    for i, t in enumerate(binds):
        run = run + 1 if i and t - binds[i - 1] <= DIRECTORY_BIND_WINDOW_S else 1
        longest = max(longest, run)
    return len(binds), peak, longest


def test_a_trickle_of_wrong_passwords_never_brings_ad_past_six():
    """One wrong password every 5 minutes for 2 hours. A sliding window let one through every
    5 minutes once the first had aged out, and AD's count — never quiet for its reset period —
    climbed until the account locked. The chain holds until 15 minutes pass with no failed
    bind: 3 per chain, 3 + 3 with an unlock, and AD's count starts over with each chain. So the
    domain's lockout threshold must be at least 7."""
    binds, peak, longest = _against_ad(every_s=300, ad_reset_s=DIRECTORY_BIND_WINDOW_S,
                                       unlock=False)
    assert (peak, longest) == (3, 3) and binds == 12     # a quiet period resets: 4 chains
    binds, peak, longest = _against_ad(every_s=300, ad_reset_s=DIRECTORY_BIND_WINDOW_S,
                                       unlock=True)
    assert (peak, longest) == (6, 6) and binds == 18


def test_no_pace_of_wrong_passwords_brings_ad_past_six():
    """Every second, every minute, every 4 minutes 59: never more than 3 + 3 in one chain, and
    so in AD's count, for any domain reset period up to the quiet period."""
    for every_s in (1, 60, 299, 450, 901):
        for ad_reset_s in (60, 600, DIRECTORY_BIND_WINDOW_S):
            for unlock in (False, True):
                _, peak, longest = _against_ad(every_s=every_s, ad_reset_s=ad_reset_s,
                                               unlock=unlock)
                assert longest <= (6 if unlock else 3), (every_s, ad_reset_s, unlock)
                assert peak <= longest, (every_s, ad_reset_s, unlock)


def test_the_directory_throttle_stays_below_a_typical_ad_lockout():
    """3 per chain (3 + 3 with an unlock), a chain ending after 15 minutes with no failed bind:
    under AD's common 5-10 threshold (it must be at least 7), the quiet period at least the
    usual 15-minute reset period; the sign-in refusal says "15 dakika"."""
    assert (directory_binds.max_failures, directory_binds.quiet_seconds) == (3, 15 * 60)
    assert (DIRECTORY_BIND_MAX_FAILURES, DIRECTORY_BIND_WINDOW_S) == (3, 15 * 60)


# --- accepted_step ----------------------------------------------------------------------------

def _code_at(t: float) -> str:
    return pyotp.TOTP(SECRET).generate_otp(int(t // 30))


def test_the_current_code_is_accepted_and_names_its_step():
    assert accepted_step(SECRET, _code_at(NOW), now=NOW) == int(NOW // 30)


def test_the_previous_and_next_codes_are_accepted_for_clock_drift():
    assert accepted_step(SECRET, _code_at(NOW - 30), now=NOW) == int(NOW // 30) - 1
    assert accepted_step(SECRET, _code_at(NOW + 30), now=NOW) == int(NOW // 30) + 1


def test_a_code_outside_the_window_is_refused():
    in_window = {_code_at(NOW - 30), _code_at(NOW), _code_at(NOW + 30)}
    for t in (NOW - 90, NOW - 60, NOW + 60, NOW + 90):
        code = _code_at(t)
        if code not in in_window:           # guard against a (one in a million) collision
            assert accepted_step(SECRET, code, now=NOW) is None


def test_garbage_is_refused_not_an_error():
    assert accepted_step(SECRET, "xxxxxx", now=NOW) is None
    assert accepted_step(SECRET, "", now=NOW) is None
    assert accepted_step(SECRET, "１２３４５６", now=NOW) is None      # non-ASCII digits


def test_the_step_matches_pyotps_own_verification():
    code = pyotp.TOTP(SECRET).now()
    assert accepted_step(SECRET, code) is not None
