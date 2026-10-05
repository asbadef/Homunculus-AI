"""What the hospital decides about an open session on a shared ward workstation.

    SCREEN_LOCK_IDLE_MINUTES   minutes without a key press, click or touch after which the
                               dashboard locks its screen (patient data off the screen, the
                               session kept, the password to come back). Default 10; 1-60.
    SCREEN_LOCK_SIGNOUT_HOURS  hours a browser may stay locked; past them it signs itself out
                               (a ward PC locked overnight does not keep yesterday's session
                               behind its lock). Default 12; 1-72.

A personal session always locks: there is no "never". A wall or central display that must stay
on is Group 2's kiosk mode, which has no personal session to lock.

Read once, at import, like the token lifetimes in auth/jwt.py: changing one is a restart of the
API, and the dashboard learns both from /auth/me at every sign-in and page load. A value the API
cannot use is logged as a WARNING and the default applies: a typo in .env must not leave a ward
PC that never locks, nor stop the API.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Mapping

logger = logging.getLogger(__name__)

SCREEN_LOCK_DEFAULT_MINUTES = 10
SCREEN_LOCK_MIN_MINUTES = 1
SCREEN_LOCK_MAX_MINUTES = 60

SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS = 12
SCREEN_LOCK_SIGNOUT_MIN_HOURS = 1
SCREEN_LOCK_SIGNOUT_MAX_HOURS = 72


def _whole_number(env: Mapping[str, str] | None, name: str, default: int, low: int,
                  high: int) -> int:
    """`name` from `env` (default: the process environment) as a whole number from `low` to
    `high`; unset or blank is `default`, anything else is `default` and a warning."""
    raw = (os.environ if env is None else env).get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is None or not low <= value <= high:
        logger.warning("%s must be a whole number from %d to %d; using %d",
                       name, low, high, default)
        return default
    return value


def screen_lock_minutes(env: Mapping[str, str] | None = None) -> int:
    """SCREEN_LOCK_IDLE_MINUTES from `env` (default: the process environment)."""
    return _whole_number(env, "SCREEN_LOCK_IDLE_MINUTES", SCREEN_LOCK_DEFAULT_MINUTES,
                         SCREEN_LOCK_MIN_MINUTES, SCREEN_LOCK_MAX_MINUTES)


def lock_signout_hours(env: Mapping[str, str] | None = None) -> int:
    """SCREEN_LOCK_SIGNOUT_HOURS from `env` (default: the process environment)."""
    return _whole_number(env, "SCREEN_LOCK_SIGNOUT_HOURS", SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS,
                         SCREEN_LOCK_SIGNOUT_MIN_HOURS, SCREEN_LOCK_SIGNOUT_MAX_HOURS)


SCREEN_LOCK_IDLE_MINUTES = screen_lock_minutes()
SCREEN_LOCK_SIGNOUT_HOURS = lock_signout_hours()
