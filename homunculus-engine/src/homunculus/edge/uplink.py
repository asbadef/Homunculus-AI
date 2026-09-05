# src/homunculus/edge/uplink.py
"""Delivering a buffered payload to the cloud, and draining the buffer in order.

Lifted out of scripts/run_bridge.py so the HL7 bridge and the NCE file bridge share one delivery
path. Two bridges with two copies of this loop would eventually disagree about ordering or acking,
and the disagreement would only show up as missing observations on a ward.

Two kinds of payload travel here and they fail differently. An observation is never dropped: a
refusal or an outage stops the pass and the row waits, in order. An identity record (Patient,
Encounter) is the optional half of the ward's picture — the next ADT or device query resends it —
so when the API is up and REFUSES one, the row is acked and counted rather than left at the head
of the queue holding every reading behind it hostage (a bridge one release ahead of its API, a
malformed key on the API side: both would otherwise silence the ward for as long as they lasted).

PHI: payloads are patient data. Nothing here logs a payload — only counts and status codes.
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

_IDENTITY_RESOURCES = ("Patient", "Encounter")


class UplinkRefused(RuntimeError):
    """The API answered, and the answer was an HTTP error status.

    Distinct from the API being unreachable (URLError, TimeoutError): a refusal is a decision the
    API made about this payload, an outage is not a decision about anything."""

    def __init__(self, status: int) -> None:
        super().__init__(f"uplink returned {status}")
        self.status = status


def post_json(url: str, token: str, payload: dict, timeout: float = 10.0) -> dict | None:
    """Deliver one resource. Returns the decoded JSON body when the API sent one.

    Raises UplinkRefused on an HTTP error status and URLError/TimeoutError when the API cannot be
    reached, so the caller can tell a refusal from an outage."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if not 200 <= response.status < 300:
                raise UplinkRefused(response.status)
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise UplinkRefused(exc.code) from None
    try:
        return json.loads(body) if body else None
    except ValueError:
        return None


async def flush_once(
    buffer: SqliteBuffer,
    *,
    sender: Callable[[dict], object],
    limit: int = 100,
) -> int:
    """One drain pass, oldest first. Stops at the first failure, leaving the rest queued in order.

    Returns how many were delivered. A refused identity record is acked and counted as dropped,
    not delivered, and the pass continues (see the module docstring). The sender runs on a worker
    thread because it does blocking network I/O and this loop shares an event loop with the file
    watcher.
    """
    batch = buffer.pending(limit=limit)
    if not batch:
        return 0

    acked: list[int] = []
    dropped = 0
    for row_id, payload in batch:
        try:
            await asyncio.to_thread(sender, payload)
            acked.append(row_id)
        except UplinkRefused as exc:
            if payload.get("resourceType") in _IDENTITY_RESOURCES:
                acked.append(row_id)
                dropped += 1
                _log.warning("identity resource refused by the uplink (HTTP %s); dropped so the "
                             "readings behind it flow — the next ADT resends it", exc.status)
                continue
            _log.warning("uplink refused an observation (HTTP %s); %s observation(s) stay queued",
                         exc.status, buffer.depth() - len(acked))
            break
        except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
            _log.warning("uplink unavailable (%s); %s observation(s) stay queued",
                         exc.__class__.__name__, buffer.depth() - len(acked))
            break
    buffer.ack(acked)
    delivered = len(acked) - dropped
    if delivered:
        _log.info("forwarded %s observation(s); %s still queued", delivered, buffer.depth())
    return delivered


async def flush_loop(buffer: SqliteBuffer, ingest_url: str, token: str, interval: float) -> None:
    """Drain the buffer to the cloud forever, pausing `interval` seconds between passes."""
    while True:
        await asyncio.sleep(interval)
        await flush_once(buffer, sender=lambda p: post_json(ingest_url, token, p))
