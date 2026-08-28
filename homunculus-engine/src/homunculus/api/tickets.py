# src/homunculus/api/tickets.py
"""Single-use, short-lived tickets for the SSE endpoints.

`EventSource` cannot set request headers, so whatever authorises a stream has to travel in the
query string — and query strings end up in server access logs, browser history and referrer
headers. Putting a JWT there leaks a long-lived credential into three places that get copied
around freely. A ticket is bound to one hospital, dies after one use, and expires in a minute.

The clock is a parameter so expiry is tested rather than waited for.
"""
from __future__ import annotations

import secrets


class TicketStore:
    """In-process ticket store, living alongside the broadcaster it authorises access to."""

    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._tickets: dict[str, tuple[str, float]] = {}

    def issue(self, hospital: str, *, now: float) -> str:
        self._prune(now)
        ticket = secrets.token_urlsafe(32)
        self._tickets[ticket] = (hospital, now + self._ttl)
        return ticket

    def consume(self, ticket: str, *, now: float) -> str | None:
        """Return the hospital and invalidate the ticket. None if unknown or expired."""
        entry = self._tickets.pop(ticket, None)
        if entry is None:
            return None
        hospital, expires_at = entry
        return hospital if now < expires_at else None

    def size(self) -> int:
        return len(self._tickets)

    def _prune(self, now: float) -> None:
        expired = [t for t, (_h, exp) in self._tickets.items() if now >= exp]
        for ticket in expired:
            del self._tickets[ticket]
