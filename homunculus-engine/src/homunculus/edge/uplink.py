# src/homunculus/edge/uplink.py
"""Delivering a buffered payload to the cloud, and draining the buffer in order.

Lifted out of scripts/run_bridge.py so the HL7 bridge and the NCE file bridge share one delivery
path. Two bridges with two copies of this loop would eventually disagree about ordering or acking,
and the disagreement would only show up as missing observations on a ward.

PHI: payloads are patient data. Nothing here logs a payload — only counts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable

from homunculus.edge.buffer import SqliteBuffer

_log = logging.getLogger(__name__)


def post_json(url: str, token: str, payload: dict, timeout: float = 10.0) -> None:
    """Deliver one observation to the cloud. Raises on any non-2xx so the row stays queued."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"uplink returned {response.status}")


async def flush_once(
    buffer: SqliteBuffer,
    *,
    sender: Callable[[dict], None],
    limit: int = 100,
) -> int:
    """One drain pass, oldest first. Stops at the first failure, leaving the rest queued in order.

    Returns how many were delivered. The sender runs on a worker thread because it does blocking
    network I/O and this loop shares an event loop with the file watcher.
    """
    batch = buffer.pending(limit=limit)
    if not batch:
        return 0

    delivered: list[int] = []
    for row_id, payload in batch:
        try:
            await asyncio.to_thread(sender, payload)
            delivered.append(row_id)
        except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
            _log.warning("uplink unavailable (%s); %s observation(s) stay queued",
                         exc.__class__.__name__, buffer.depth() - len(delivered))
            break
    buffer.ack(delivered)
    if delivered:
        _log.info("forwarded %s observation(s); %s still queued", len(delivered), buffer.depth())
    return len(delivered)


async def flush_loop(buffer: SqliteBuffer, ingest_url: str, token: str, interval: float) -> None:
    """Drain the buffer to the cloud forever, pausing `interval` seconds between passes."""
    while True:
        await asyncio.sleep(interval)
        await flush_once(buffer, sender=lambda p: post_json(ingest_url, token, p))
