# src/homunculus/edge/forwarder.py
"""Store-and-forward: the edge bridge's resilience against a dropped uplink.

Payloads are appended to a buffer and flushed in order. If the uplink is down or fails
mid-stream, the failed payload and everything after it stay buffered, in order, for the next
flush — nothing is lost and nothing is reordered. In production the buffer is backed by a
local persistent queue (SQLite) so it also survives a process restart; the logic here is
storage-agnostic and takes an injected buffer.
"""
from __future__ import annotations

from typing import Any, Callable


class StoreAndForward:
    def __init__(self, sender: Callable[[dict], Any], buffer: list[dict] | None = None):
        # sender: delivers one payload to the cloud; raises on any delivery failure.
        self._sender = sender
        self._buffer: list[dict] = buffer if buffer is not None else []

    def submit(self, payload: dict) -> None:
        """Buffer a payload and attempt to flush what's pending."""
        self._buffer.append(payload)
        self.flush()

    def flush(self) -> int:
        """Deliver buffered payloads in order. Stop at the first failure, keeping that payload
        and the rest for later. Returns how many were delivered this call."""
        delivered = 0
        while self._buffer:
            try:
                self._sender(self._buffer[0])
            except Exception:
                break  # uplink down / send failed — preserve order, retry later
            self._buffer.pop(0)
            delivered += 1
        return delivered

    @property
    def pending(self) -> int:
        return len(self._buffer)
