# Edge Bridge Runtime — Design Spec

**Date:** 2026-08-03
**Status:** approved
**Driver:** Monday pilot — a Mindray central station feeding real (parallel/observation-mode) data.

## Purpose

Make the bridge *runnable*. The MLLP listener and HL7 parser exist; what is missing is the piece an
operator actually starts: a process that listens, survives a dropped uplink, and can be pointed at a
central station in minutes.

## Deployment shape (settled)

The bridge runs **on-prem**, not on Render. Hospital device networks are segmented: the central
station cannot reach the public internet, and should not. The bridge sits on the hospital network,
receives MLLP locally, and makes **outbound** HTTPS calls to the cloud — which firewalls permit,
unlike inbound.

```
Mindray CMS ──HL7/MLLP :2575──> Bridge (on-prem laptop/mini-PC) ──HTTPS out──> Cloud API ──> Postgres
```

Activation is a configuration on the CMS: point its HL7 export at the bridge's IP:port. There is no
USB path — medical central stations export over the network, and their USB ports are locked down.

## Components

### 1. `edge/buffer.py` — `SqliteBuffer`

Durable, ordered store-and-forward queue.

```python
append(payload: dict) -> int          # returns row id
pending(limit: int) -> list[tuple[int, dict]]   # oldest first
ack(ids: list[int]) -> None           # delete delivered rows
depth() -> int                        # rows awaiting delivery
```

- Survives process restart (that is the whole point — an in-memory queue loses a shift's data on a
  crash).
- **Order is preserved.** Observations are a time series; delivering them out of order would make
  the engine reason about a past state as if it were current.
- **At-least-once delivery.** If the uplink dies mid-flush the rows stay queued and are re-sent.
  Duplicates are acceptable: an observation is keyed by patient + signal + timestamp, so a repeat
  overwrites rather than accumulates. Exactly-once would need distributed transactions and buys
  nothing here.
- Retention cap: oldest rows are dropped past a configurable limit, and the drop is **counted and
  logged** (silently discarding clinical data is not acceptable; being loud about it is).

### 2. `scripts/run_bridge.py` — the CLI

```
--listen-host / --listen-port   MLLP listener (default 0.0.0.0:2575, the IANA HL7 port)
--cloud-url                     e.g. https://…/api  (empty = capture-only, see below)
--token                         tenant bearer token
--db                            SQLite buffer path
--mapping                       JSON file: OBX code -> SignalCode slug
--flush-interval                seconds between uplink flushes
```

Flow: MLLP in → parse HL7 → buffer.append → background flush task → POST to cloud → ack.
Two concurrent tasks: the listener and the flusher. A flush failure is logged and retried on the
next tick; nothing is lost.

### 3. Discovery mode — the thing that de-risks Monday

The largest practical risk is that Mindray's OBX identifiers do not match our `SignalCode` slugs.
If so, messages arrive, ACKs go back, everything *looks* healthy — and every observation is silently
dropped.

So the bridge **counts every unmapped OBX code and reports the codes it saw**:

```
Eşlenmemiş kodlar: MDC_ECG_HEART_RATE (142), MDC_PRESS_BLD_NONINV_MEAN (71)
```

**The code is reported; the value never is.** An OBX identifier is device metadata, not patient
data. The measurement is patient data and must not reach a log file.

With `--cloud-url` empty the bridge runs **capture-only**: it listens, ACKs, and reports codes
without forwarding anything. That is the safe first thing to run against a live CMS — it proves the
link and produces the mapping table without moving any data.

### 4. `scripts/hl7_simulator.py`

Sends synthetic ORU messages at the bridge so the whole chain can be exercised today, without the
CMS. Monday then changes only an IP.

## Error handling

| Condition | Behaviour |
|---|---|
| Uplink down | Rows stay queued in order; flushed on recovery |
| Malformed HL7 | `AE` ACK, counted, **content never logged**, link stays up |
| Bridge restarts | Resumes from SQLite |
| Unknown OBX code | Observation dropped, code counted for the discovery report |
| Buffer full | Oldest dropped, **counted and logged loudly** |

## PHI rules (pilot carries real data)

- Never log message bodies, observation values, or patient identifiers.
- Log only: connection events, counts, OBX identifiers, buffer depth.
- The SQLite buffer holds real observations in transit → the file lives on encrypted storage, is
  **gitignored**, and is deleted after the pilot.
- Uplink is HTTPS.

## Testing

Unit: buffer durability across reopen, ordering, ack, retention cap. Discovery counter. Mapping
applied from file. Integration: simulator → bridge → fake uplink, including an uplink that fails
mid-flush and recovers with order intact.

## Out of scope

TLS client certificates, a service/daemon installer, multi-site fan-out, and backfill of data
predating the bridge.
