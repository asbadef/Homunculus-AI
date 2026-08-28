# NCE file bridge — reading the vendor's device sessions instead of implementing WACP

**Date:** 2026-08-28
**Status:** design approved

## Context

The pilot device is a Welch Allyn **Connex Spot Monitor**. It does not speak HL7. On 2026-08-28 the
discovery probe captured a 37-byte frame from `10.10.98.229` to port 2575 carrying the ASCII marker
`RNDZCONNECT` — the WACP rendezvous — after which the device waited about ten seconds for an answer
our bridge could not give, and hung up.

The address written into the device turned out to be a real machine: a Windows Server 2016 running
**Welch Allyn NCE 5.2.0.2** (`C:\Program Files (x86)\Welch Allyn\NCE\`, service `Welch Allyn NCE`,
running). This is the vendor's own connectivity engine — the party the device was trying to reach.
It is not a test box: `NCEConfig_orig.xml` dates the install to January 2020, and
`TransformSheets\device.sessions\` holds sheets for four Connex Spot serials first seen in 2021,
2022, 2024 and 2025. A ward has depended on it for five years.

NCE writes each device session to `SavedCopies\` as
`TCP_<device-ip>_<port>-<epoch>-<n>-Device…`. Files appeared while we were looking — three within
one second, two more 67 seconds later — and the listing that returned them filtered on
`*.xml`, `*.config`, `*.ini`, so the sessions are structured text, almost certainly XML.

The middle number is a Unix timestamp. `1787921620` decodes to 2026-08-28 12:53:40 UTC and
`1787921687` to 12:54:47 UTC; the 67-second gap matches the two file-write times exactly, which is
what confirms the field rather than merely suggesting it.

Three routes were open: **(A)** configure an HL7 ORU output on NCE and point it at our bridge,
**(B)** read the files NCE already writes, **(C)** implement WACP ourselves. This design takes B.

B is chosen because it is **read-only on a live clinical system**. A changes the configuration of a
box four devices depend on and may require a vendor licence; C means implementing a proprietary
protocol we have no specification for, to solve a problem the vendor's own server already solves. B
needs one read-only share and alters nothing. A remains the production target and is not abandoned.
C is dropped.

One expectation this sets, stated here so it does not surprise anyone later: a Connex Spot Monitor
is a **spot-check** device — a nurse takes a reading and the device sends it. It is not continuous
ICU telemetry. What this pilot can honestly demonstrate is NEWS2-style early warning over
intermittent ward observations, which is the setting NEWS2 was designed for. Continuous ICU
escalation needs a different source.

## Architecture

### 1. The source changes; everything downstream does not

```text
NCE (Windows, untouched)            Homunculus (Linux)
SavedCopies\*.xml
      │ read-only SMB
      ▼
/mnt/nce  (host, ro) ──► bridge container
                              │
                              ├─ filewatch  : finds new files in order, records them
                              ├─ ncefiles   : XML → Observation
                              ├─ serialize  : Observation → FHIR      (existing)
                              └─ SqliteBuffer → flush → api /ingest    (existing)
```

Everything from `SqliteBuffer` onward already exists and is tested: oldest-first ordering,
at-least-once delivery, a queue that survives restarts, a capacity limit that drops loudly rather
than silently, and an uplink that leaves a failed payload and everything after it queued. This
design does not touch any of it. The MLLP listener is replaced by a directory reader; that is the
whole change.

### 2. Five units, each with one job

- **`edge/ncefiles.py`** — a pure parser: session text in, observations out. It knows nothing about
  the filesystem or the network, so it can be tested against a hand-written synthetic fixture with
  no patient data in it.
- **`edge/filewatch.py`** — scans the directory, orders the work, and keeps the processed-file
  ledger. It does no parsing and makes no network calls.
- **`edge/ncebridge.py`** — ties the parser to the send callback and keeps the counters that make a
  wrong field table visible. Separate from the parser for the same reason `bridge.py` is separate
  from `hl7.py`: the format has no business knowing what a pilot's operator needs to see.
- **`edge/uplink.py`** — `post_json` and `flush_loop`, moved out of `scripts/run_bridge.py` so both
  bridges share one uplink instead of growing a second copy. A targeted extraction, justified by
  this work and no wider.
- **`scripts/run_nce_bridge.py`** — the entry point that wires them together, mirroring
  `run_bridge.py` including its discovery mode.

### 3. Ordering, and why the ledger is not optional

Files are processed oldest-first using the epoch in the filename. The buffer's ordering guarantee is
only meaningful if the work arrives in order in the first place: delivering a later observation past
an earlier one lets the engine read a past state as the present.

Because the share is mounted read-only, we cannot move, rename or delete a file once processed —
the usual way a file feeder remembers its progress. Instead a SQLite ledger records each processed
file by **name, size and modification time**, stored alongside the buffer. Name alone would be
wrong: if NCE appends to a session file after we first read it, a name-keyed ledger would skip the
new content forever, and the loss would be invisible.

### 4. Time comes from UTC, never from the server's local clock

The epoch in the filename says 12:53:40 UTC, which is 15:53:40 in Turkey. Windows displays that same
file as 16:53:40 — one hour ahead. Minutes and seconds match exactly across three files, so this is
a genuine one-hour disagreement between two clocks, not a rounding artefact. Which clock is wrong
has not yet been established.

Until it is, the bridge never uses the Windows local time. It takes each observation's timestamp
from, in order of preference: an unambiguous UTC measurement time inside the session if one exists,
because that is when the reading was actually taken; otherwise the UTC epoch in the filename, which
is when NCE wrote the session and is therefore a close upper bound. Which of the two is available
is a discovery question; the precedence is not.

This is not fussiness: the engine reasons about observation times, so escalation timers, "how long
has this alert been open", and handover timing all corrupt together, and all of them corrupt
quietly.

### 5. The field table is discovered, not assumed

Device field names map to our `SignalCode` slugs through a site file, `nce-mapping.json`, with the
same shape and the same rules as the existing `site-mapping.json`: an unknown slug stops startup
rather than dropping a signal for the whole pilot, and a device field the table does not cover is
not forwarded but **is** counted by name and named in the operator report — the failure it guards
against is a signal going missing for a whole pilot while messages keep arriving and nothing
complains.

Run without `--cloud-url`, the bridge forwards nothing and only reports which fields arrive. That is
how the mapping gets written — the same two-phase pattern the HL7 side already uses, and the reason
this design does not need to guess the vendor's field names in advance.

### 6. Patient identity is never invented

If a session carries no patient identifier, its observations are **rejected and counted**, not
attached to a placeholder. This mirrors `parse_hl7_oru`, which raises when PID-3 is missing. A vital
sign recorded against the wrong patient is worse than one that never arrives, and a placeholder
patient is a wrong patient with a friendly name.

### 7. Failure is visible; content never is

- An unparseable file is counted and recorded so it does not block the queue, and is **never
  logged** — its content is patient data.
- An unreachable share is logged loudly and retried. The bridge does not exit; a mount that comes
  back should not need an operator.
- Every 30 seconds the operator report prints files seen, processed and failed, unmapped field
  names, and queue depth — the same shape as the existing `report_loop`.

### 8. Mount and credentials

The host mounts the share read-only at `/mnt/nce` using a credentials file with `chmod 600`, and
Compose bind-mounts that path into the bridge container as `:ro`. The share path and credentials
live in `.env` alongside the existing secrets. Nothing is installed on the Windows server and
nothing in NCE is reconfigured; the only change there is exposing one folder read-only.

### 9. Backfill: new files only, by default

By default the bridge processes only files that appear after it starts. Two explicit flags exist for
deliberate backfill: `--since <ISO-date>` for a window, and `--all` for everything on the share.

Replaying years of sessions would fill the board with discharged patients who are not on the ward,
and would multiply patient data at rest before the parser has been validated against real files.
Nothing is lost by deferring: the files stay on the Windows server, so historical ingest — which is
valuable for training the ML model later — remains available as a separate, deliberate operation
rather than a side effect of turning the bridge on.

## Testing

**`ncefiles`** — a synthetic fixture, hand-written, no patient data: expected `Observation` list;
a session with no patient identifier is rejected and counted; an unmapped field is counted, not
dropped; malformed input raises a typed error whose message carries no file content.

**`filewatch`** — files are ordered by their filename epoch; the ledger prevents a resend across a
restart; a file whose size or modification time changed is read again; an unreadable directory is
reported without crashing the loop.

**`uplink`** — the existing bridge's tests must still pass unchanged after the extraction. That is
the check that the move was a move and not a rewrite.

No test fixture may contain real patient data.

## Known limits, stated rather than designed around

- The field table cannot be written until discovery output is in hand. Until then
  `nce-mapping.json` is empty and the bridge runs in discovery mode — which is the intended first
  run, not a gap.
- We are consuming an undocumented vendor file format. An NCE upgrade could change it. The
  mitigation is the discovery report: unmapped fields surface loudly instead of vanishing. Route A
  stays the production target for exactly this reason.
- Spot-check cadence, not continuous telemetry. See the note in Context.
- The one-hour clock discrepancy is worked around, not explained. It still needs diagnosing on the
  server; the workaround stops it corrupting our data, but it may be corrupting something else.
- The read-only mount means the ledger is our only record of progress. If it is lost, the bridge
  resumes from its start time and re-reads nothing older unless `--since` is given, in which case it
  re-reads that whole window. Duplicates are harmless — an observation is keyed by patient, signal
  and timestamp, so a repeat overwrites rather than accumulates — but an operator seeing the queue
  suddenly refill should know why.

## Out of scope

Configuring HL7 output on NCE (route A); WACP (route C); historical backfill for ML training;
bed and location mapping beyond whatever identifier a session file already carries; any change
whatsoever on the NCE server beyond exposing one folder read-only.
