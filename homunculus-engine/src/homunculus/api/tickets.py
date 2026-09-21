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
    """In-process ticket store, living alongside the broadcaster it authorises access to.

    A ticket carries a **scope** as well as a hospital, and that is not a convenience. The scope
    has to be decided while the caller is still holding a credential, because by the time
    `/stream` runs there is nothing left identifying them but the ticket. A ticket that carried
    only the hospital would leave the board filtered on request and wide open on the live feed —
    a filter every subsequent observation walks straight past.
    """

    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._tickets: dict[str, tuple[str, object, float]] = {}

    def issue(self, hospital: str, *, now: float, scope: object = None) -> str:
        self._prune(now)
        ticket = secrets.token_urlsafe(32)
        self._tickets[ticket] = (hospital, scope, now + self._ttl)
        return ticket

    def consume(self, ticket: str, *, now: float) -> tuple[str, object] | None:
        """Return (hospital, scope) and invalidate the ticket. None if unknown or expired."""
        entry = self._tickets.pop(ticket, None)
        if entry is None:
            return None
        hospital, scope, expires_at = entry
        return (hospital, scope) if now < expires_at else None

    def size(self) -> int:
        return len(self._tickets)

    def _prune(self, now: float) -> None:
        expired = [t for t, (_h, _s, exp) in self._tickets.items() if now >= exp]
        for ticket in expired:
            del self._tickets[ticket]
