"""The TOTP guessing limit and the time-step check behind replay refusal, without a database."""
from __future__ import annotations

import pyotp

from homunculus.auth.limits import FailureLimiter
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
