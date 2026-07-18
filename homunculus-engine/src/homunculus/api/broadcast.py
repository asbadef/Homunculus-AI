# src/homunculus/api/broadcast.py
"""In-process per-tenant pub/sub for live board updates. One process only; the multi-process
fan-out (Redis/Postgres) is Plan B slice B4."""
from __future__ import annotations

import asyncio


class Broadcaster:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, tenant: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(tenant, set()).add(queue)
        return queue

    def unsubscribe(self, tenant: str, queue: asyncio.Queue) -> None:
        subs = self._subs.get(tenant)
        if subs:
            subs.discard(queue)
            if not subs:
                self._subs.pop(tenant, None)

    async def publish(self, tenant: str, message: dict) -> None:
        for queue in list(self._subs.get(tenant, ())):
            await queue.put(message)
