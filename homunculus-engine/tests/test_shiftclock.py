# homunculus-engine/tests/test_shiftclock.py
"""G4-04 (spec D3, §5 A2): the shift windows are bounded by the tenant's local wall-clock starts — A from `start_a`, B
from `start_b` to the next local `start_a` — found by a search over the candidate starts; a boundary instant begins the
new window; a window that crosses midnight belongs to the day it began; «Bu nöbet» and «Sonraki nöbet»; two starts not
twelve hours apart; the two nights a clock changes (13 and 11 hours). A window's key is the UTC instant of its local
start. Synthetic zones: tzdata is not on every test host (test_fluids.py), so the summer-time zone is written here."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone, tzinfo

from homunculus.api.fluids import fluid_day
from homunculus.api.shiftclock import Shift, shift_windows

UTC = timezone.utc
BAKU = timezone(timedelta(hours=4))     # Asia/Baku keeps +04 all year
HOUR = timedelta(hours=1)


def _z(*args) -> datetime:
    return datetime(*args, tzinfo=UTC)


class _Summer(tzinfo):
    """A zone with a summer hour: +01:00, and +02:00 from SPRING to AUTUMN (UTC instants, both at 01:00 UTC as in
    Europe in 2026 — the clock jumps 02:00 → 03:00 on 29 March and falls 03:00 → 02:00 on 25 October). A wall time in
    the hour the clock repeats is told apart by `fold` (PEP 495)."""
    STD, SUMMER = timedelta(hours=1), timedelta(hours=2)
    SPRING, AUTUMN = datetime(2026, 3, 29, 1), datetime(2026, 10, 25, 1)        # naive UTC

    def utcoffset(self, dt):
        wall = dt.replace(tzinfo=None, fold=0)
        if self.SPRING + self.SUMMER <= wall < self.AUTUMN + self.STD:          # summer, past the skipped hour
            return self.SUMMER
        if self.AUTUMN + self.STD <= wall < self.AUTUMN + self.SUMMER:          # the repeated hour
            return self.STD if dt.fold else self.SUMMER
        return self.STD

    def dst(self, dt):
        return self.utcoffset(dt) - self.STD

    def tzname(self, dt):
        return "SUMMER" if self.dst(dt) else "STD"

    def fromutc(self, dt):
        utc = dt.replace(tzinfo=None)
        if self.SPRING <= utc < self.AUTUMN:
            return (utc + self.SUMMER).replace(tzinfo=self)
        repeated = self.AUTUMN <= utc < self.AUTUMN + HOUR
        return (utc + self.STD).replace(tzinfo=self, fold=1 if repeated else 0)


def current(now, zone=UTC, a=8, b=20) -> Shift:
    return shift_windows(now, zone, a, b)[0]


def following(now, zone=UTC, a=8, b=20) -> Shift:
    return shift_windows(now, zone, a, b)[1]


class TestBuNobet:
    def test_a_runs_from_the_first_start_to_the_second(self):
        assert current(_z(2026, 11, 12, 10)) == Shift(_z(2026, 11, 12, 8), _z(2026, 11, 12, 20), "A")

    def test_b_crosses_midnight_and_belongs_to_the_day_it_began(self):
        night = Shift(_z(2026, 11, 12, 20), _z(2026, 11, 13, 8), "B")
        assert current(_z(2026, 11, 12, 23)) == night
        assert current(_z(2026, 11, 13, 3)) == night

    def test_a_boundary_instant_begins_the_new_shift(self):
        assert current(_z(2026, 11, 12, 20)).which == "B"
        assert current(_z(2026, 11, 13, 7, 59, 59)).which == "B"
        assert current(_z(2026, 11, 13, 8)) == Shift(_z(2026, 11, 13, 8), _z(2026, 11, 13, 20), "A")

    def test_the_hours_are_the_tenants_own(self):
        # 05:00 UTC is 09:00 in Baku: shift A, 08:00–20:00 Baku = 04:00–16:00 UTC.
        assert current(_z(2026, 11, 12, 5), BAKU) == Shift(_z(2026, 11, 12, 4), _z(2026, 11, 12, 16), "A")
        # 03:00 UTC is 07:00 in Baku: still last night's B.
        assert current(_z(2026, 11, 12, 3), BAKU) == Shift(_z(2026, 11, 11, 16), _z(2026, 11, 12, 4), "B")

    def test_a_crosses_midnight_when_the_first_start_is_in_the_evening(self):
        assert current(_z(2026, 11, 13, 2), a=19, b=7) == Shift(_z(2026, 11, 12, 19), _z(2026, 11, 13, 7), "A")
        assert current(_z(2026, 11, 13, 9), a=19, b=7) == Shift(_z(2026, 11, 13, 7), _z(2026, 11, 13, 19), "B")

    def test_the_two_starts_need_not_be_twelve_hours_apart(self):
        assert current(_z(2026, 11, 12, 10), a=8, b=16) == Shift(_z(2026, 11, 12, 8), _z(2026, 11, 12, 16), "A")
        assert current(_z(2026, 11, 12, 17), a=8, b=16) == Shift(_z(2026, 11, 12, 16), _z(2026, 11, 13, 8), "B")


class TestSonrakiNobet:
    def test_after_a_comes_its_b_and_after_b_the_next_days_a(self):
        assert following(_z(2026, 11, 12, 10)) == Shift(_z(2026, 11, 12, 20), _z(2026, 11, 13, 8), "B")
        assert following(_z(2026, 11, 12, 23)) == Shift(_z(2026, 11, 13, 8), _z(2026, 11, 13, 20), "A")

    def test_in_the_tenants_zone(self):
        assert following(_z(2026, 11, 12, 20), BAKU) == Shift(_z(2026, 11, 13, 4), _z(2026, 11, 13, 16), "A")


class TestTheNightsTheClockChanges:
    """§5 A2: a window is bounded by the local wall clock, so the shifts tile time — no hour in no window, no two
    windows for one hour. `fluid_day` (G3-03) adds 24 hours to a UTC instant and is not changed in this slice; the
    two disagree on these nights only (plan note N1)."""
    ZONE = _Summer()

    def test_the_night_the_clock_goes_back_b_lasts_thirteen_hours(self):
        b = current(_z(2026, 10, 25, 6, 30), self.ZONE)                # 07:30 local, standard time again
        assert b == Shift(_z(2026, 10, 24, 18), _z(2026, 10, 25, 7), "B")
        assert b.end - b.start == 13 * HOUR
        assert current(_z(2026, 10, 25, 7), self.ZONE) == Shift(_z(2026, 10, 25, 7), _z(2026, 10, 25, 19), "A")
        assert following(_z(2026, 10, 24, 12), self.ZONE) == b         # «Sonraki nöbet» from the day before
        # The fluid day, unchanged, ends at 06:00 UTC — an hour before this window does (the recorded discrepancy).
        assert fluid_day(_z(2026, 10, 25, 6, 30), self.ZONE, 8, 20)["day"][1] == _z(2026, 10, 25, 6)

    def test_the_night_the_clock_goes_forward_b_lasts_eleven_hours(self):
        b = current(_z(2026, 3, 28, 22), self.ZONE)                    # 23:00 local, standard time
        assert b == Shift(_z(2026, 3, 28, 19), _z(2026, 3, 29, 6), "B")
        assert b.end - b.start == 11 * HOUR
        assert current(_z(2026, 3, 29, 6, 30), self.ZONE) == Shift(_z(2026, 3, 29, 6), _z(2026, 3, 29, 18), "A")
        assert following(_z(2026, 3, 28, 22), self.ZONE).start == b.end
