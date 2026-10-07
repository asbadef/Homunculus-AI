"""
Login / TOTP attempt throttling (Y3).

Two independent counters: per account (email, or user id for TOTP) and per client IP. Failures inside a
sliding window add up; reaching the limit locks that key for `lock_seconds`. A locked key answers 429 even
when the credential is right, and unknown accounts are counted exactly like known ones, so the response
pattern does not reveal which accounts exist. A successful login clears the account counter (not the IP's).

State is in-process memory: correct for one API process. With several workers/instances each keeps its own
counters, so the effective limit is multiplied; move the same interface onto Redis/DB before scaling out.
The client IP is the TCP peer. X-Forwarded-For is NOT trusted (spoofable); behind a reverse proxy, run
uvicorn with --proxy-headers and --forwarded-allow-ips set to the proxy so request.client is the real client.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


class AttemptLimiter:
    def __init__(self) -> None:
        self.account_max = _int("LOGIN_MAX_FAILURES_PER_ACCOUNT", 5)
        self.ip_max = _int("LOGIN_MAX_FAILURES_PER_IP", 20)
        self.window_seconds = _int("LOGIN_FAILURE_WINDOW_SECONDS", 900)
        self.lock_seconds = _int("LOGIN_LOCK_SECONDS", 900)
        self._lock = threading.Lock()
        self._offset = 0.0  # test clock shift
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self._failures: dict[str, deque[float]] = defaultdict(deque)
            self._locked_until: dict[str, float] = {}
            self._offset = 0.0
            self._last_sweep = float("-inf")

    def advance_clock(self, seconds: float) -> None:
        """Test hook only."""
        self._offset += seconds

    def _now(self) -> float:
        return time.monotonic() + self._offset

    def retry_after(self, *keys: str) -> int:
        """Seconds until every given key is usable again; 0 if none is locked."""
        now = self._now()
        with self._lock:
            waits = [self._locked_until[k] - now for k in keys if self._locked_until.get(k, 0) > now]
        return int(max(waits)) + 1 if waits else 0

    def _sweep(self, now: float) -> None:
        """Drop expired records so unique-key spraying cannot grow memory without bound.
        Caller holds the lock. Runs at most once a minute."""
        if now - self._last_sweep < 60:
            return
        self._last_sweep = now
        for k in [k for k, q in self._failures.items() if not q or q[-1] <= now - self.window_seconds]:
            del self._failures[k]
        for k in [k for k, t in self._locked_until.items() if t <= now]:
            del self._locked_until[k]

    def record_failure(self, key: str, limit: int) -> None:
        now = self._now()
        with self._lock:
            self._sweep(now)
            q = self._failures[key]
            while q and q[0] <= now - self.window_seconds:
                q.popleft()
            q.append(now)
            if len(q) >= limit:
                self._locked_until[key] = now + self.lock_seconds
                q.clear()

    def clear(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)


limiter = AttemptLimiter()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def too_many(seconds: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many failed attempts. Try again later.",
        headers={"Retry-After": str(seconds)},
    )


def account_key(email: str) -> str:
    return "acct:" + email.strip().lower()


def ip_key(request: Request) -> str:
    return "ip:" + client_ip(request)


def totp_key(user_id: object) -> str:
    return f"totp:{user_id}"
