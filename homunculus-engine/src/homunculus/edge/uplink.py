# src/homunculus/edge/uplink.py
"""Delivering a buffered payload to the cloud, and draining the buffer in order.

Lifted out of scripts/run_bridge.py so the HL7 bridge and the NCE file bridge share one delivery
path. Two bridges with two copies of this loop would eventually disagree about ordering or acking,
and the disagreement would only show up as missing observations on a ward.

Two kinds of payload travel here and they fail differently.

* An observation is never dropped: a refusal or an outage stops the pass and the row waits, in
  order, until the API takes it.
* An identity record (Patient, Encounter) is the optional half of the ward's picture, idempotent,
  and carries its own ordering stamp — so it must never hold a reading hostage, and a reading
  delivered before it lands on the same card either way. When the API is up and refuses the
  PAYLOAD (400, 422: a bridge one release ahead of its API), the row is acked and counted; the
  next ADT or device query resends it. When the API is up but cannot take it right now (5xx while
  its database restarts, 401/403 while a token is being fixed) the row is HELD for the next pass
  and the pass carries on past it; a decision about the moment is not a decision about the
  record. The held head is bounded (`hold_limit`) so a long identity-only fault cannot fill the
  batch window and starve the readings behind it: past the bound the oldest held rows go.

PHI: payloads are patient data. Nothing here logs a payload — only counts and status codes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

from homunculus.edge.buffer import SqliteBuffer

_log = logging.getLogger(__name__)

_IDENTITY_RESOURCES = ("Patient", "Encounter")
# 4xx that speak about the moment, not the payload: auth being fixed, a timeout, back-pressure.
_NOT_A_PAYLOAD_REFUSAL = (401, 403, 408, 429)
DEFAULT_HOLD_LIMIT = 50


class UplinkRefused(RuntimeError):
    """The API answered, and the answer was an HTTP error status.

    Distinct from the API being unreachable (URLError, TimeoutError): a refusal is a decision the
    API made about this request, an outage is not a decision about anything."""

    def __init__(self, status: int) -> None:
        super().__init__(f"uplink returned {status}")
        self.status = status

    @property
    def refuses_payload(self) -> bool:
        """True when the API judged the PAYLOAD, not the moment (400/422 vs 5xx/401/403)."""
        return 400 <= self.status < 500 and self.status not in _NOT_A_PAYLOAD_REFUSAL


@dataclass
class UplinkStats:
    """Operator counters for the report line. Content-free by construction."""
    identity_dropped: int = 0     # identity rows refused as payload (or past the hold bound): gone
    identity_held: int = 0        # identity rows waiting on the API after the last pass


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
    stats: UplinkStats | None = None,
    hold_limit: int = DEFAULT_HOLD_LIMIT,
) -> int:
    """One drain pass, oldest first. Returns how many were delivered.

    An observation that fails stops the pass, leaving it and everything after it queued in
    order. An identity row that fails is dropped (payload refused) or held (API up but not
    taking it; outage) without stopping the pass — see the module docstring. The sender runs on a
    worker thread because it does blocking network I/O and this loop shares an event loop with
    the file watcher.
    """
    batch = buffer.pending(limit=limit)
    if not batch:
        return 0

    acked: list[int] = []
    held: list[int] = []
    dropped = 0
    for row_id, payload in batch:
        is_identity = payload.get("resourceType") in _IDENTITY_RESOURCES
        try:
            await asyncio.to_thread(sender, payload)
            acked.append(row_id)
        except UplinkRefused as exc:
            if is_identity and exc.refuses_payload:
                acked.append(row_id)
                dropped += 1
                _log.warning("identity resource refused by the uplink (HTTP %s); dropped so the "
                             "readings behind it flow — the next ADT resends it", exc.status)
                continue
            if is_identity:
                held.append(row_id)
                continue
            _log.warning("uplink refused an observation (HTTP %s); %s observation(s) stay queued",
                         exc.status, buffer.depth() - len(acked))
            break
        except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
            _log.warning("uplink unavailable (%s); %s observation(s) stay queued",
                         exc.__class__.__name__, buffer.depth() - len(acked))
            break

    if len(held) > hold_limit:
        # Oldest first: the batch came back in id order, so the head of `held` is the oldest.
        overflow = held[:len(held) - hold_limit]
        acked.extend(overflow)
        dropped += len(overflow)
        held = held[len(overflow):]
        _log.warning("identity rows held past the bound (%s); dropped the oldest %s so the "
                     "readings behind them keep flowing", hold_limit, len(overflow))
    if held:
        _log.warning("%s identity row(s) held: the uplink is up but not taking them yet", len(held))

    buffer.ack(acked)
    delivered = len(acked) - dropped
    if stats is not None:
        stats.identity_dropped += dropped
        stats.identity_held = len(held)
    if delivered:
        _log.info("forwarded %s observation(s); %s still queued", delivered, buffer.depth())
    return delivered


async def flush_loop(buffer: SqliteBuffer, ingest_url: str, token: str, interval: float,
                     stats: UplinkStats | None = None) -> None:
    """Drain the buffer to the cloud forever, pausing `interval` seconds between passes."""
    while True:
        await asyncio.sleep(interval)
        await flush_once(buffer, sender=lambda p: post_json(ingest_url, token, p), stats=stats)
