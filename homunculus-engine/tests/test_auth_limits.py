"""The TOTP guessing limit, the AD password-bind throttle, and the time-step check behind replay
refusal, without a database."""
from __future__ import annotations

import pyotp

from homunculus.auth.limits import (
    DIRECTORY_BIND_MAX_FAILURES, DIRECTORY_BIND_WINDOW_S, AttemptWindow, FailureLimiter,
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


# --- AttemptWindow (AD password binds) --------------------------------------------------------

def _window(clock: FakeClock) -> AttemptWindow:
    return AttemptWindow(max_failures=3, window_seconds=900, clock=clock)


def _fail(win: AttemptWindow, key: str = "u") -> None:
    assert win.begin(key) is True
    win.end(key, failed=True)


def test_three_failures_within_the_window_refuse_the_next_attempt():
    clock = FakeClock()
    win = _window(clock)
    for _ in range(3):
        _fail(win)
        clock.t += 60
    assert win.begin("u") is False


def test_the_refusal_lifts_when_the_oldest_failure_leaves_the_window():
    clock = FakeClock()
    win = _window(clock)
    for _ in range(3):
        _fail(win)
        clock.t += 100                      # failures at 1000, 1100, 1200; now 1300
    clock.t = 1000 + 899
    assert win.begin("u") is False
    clock.t = 1000 + 900                    # the first failure is 15 minutes old: one more try
    assert win.begin("u") is True
    win.end("u", failed=True)
    assert win.begin("u") is False          # 1100, 1200, 1900: three within the window again


def test_failures_spread_wider_than_the_window_never_refuse():
    clock = FakeClock()
    win = _window(clock)
    for _ in range(10):
        _fail(win)
        clock.t += 301                      # never three within 900 s


def test_attempts_in_flight_count_so_concurrent_requests_cannot_overshoot():
    win = _window(FakeClock())
    _fail(win)
    assert win.begin("u") is True and win.begin("u") is True    # two running at once
    assert win.begin("u") is False                               # 1 failure + 2 running = 3
    win.end("u", failed=False)
    assert win.begin("u") is True


def test_an_attempt_that_did_not_fail_releases_its_place_without_counting():
    win = _window(FakeClock())
    for _ in range(5):
        assert win.begin("u") is True
        win.end("u", failed=False)
    _fail(win)
    _fail(win)
    assert win.begin("u") is True


def test_a_success_clears_the_failures():
    win = _window(FakeClock())
    _fail(win)
    _fail(win)
    win.succeeded("u")
    _fail(win)
    _fail(win)
    assert win.begin("u") is True


def test_window_keys_are_independent():
    win = _window(FakeClock())
    for _ in range(3):
        _fail(win, "a")
    assert win.begin("a") is False and win.begin("b") is True


def test_the_directory_throttle_stays_below_a_typical_ad_lockout():
    """3 within 15 minutes: under AD's common 5-10 threshold, the window at least the usual
    15-minute observation window; the sign-in refusal says "15 dakika"."""
    assert (directory_binds.max_failures, directory_binds.window_seconds) == (3, 15 * 60)
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
