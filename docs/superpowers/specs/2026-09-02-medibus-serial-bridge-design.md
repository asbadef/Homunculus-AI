# MEDIBUS serial bridge — design

**Date:** 2026-09-02
**Status:** approved for implementation (autonomous session; decisions recorded here)
**Folder:** `medibus/` — a new, self-contained top-level package. Not inside `homunculus-engine/`.

## Why this exists

The pilot ICU runs Dräger equipment. The user asked for Dräger **MEDIBUS** (RS-232) support to be
built *now*, "just in case", so that it sits ready on a USB stick and can be tried on one device
through a USB-to-serial adapter once biomed approves — and to start it in its own folder.

### What MEDIBUS is — and is not — at this site

Two findings from the 2026-09-02 survey shape everything below:

1. **The Infinity Kappa bedsides (VF9.1-C) do not speak MEDIBUS outward.** Their serial vitals
   export is the *Infinity RS-232 Export Protocol* (Dräger doc MS28819, "Olympus-compliant"
   monitors, Siemens SC lineage) on connector **X5** of the monitor or CPS/IDS dock, via Dräger
   cable **5206441**, configured in the Biomed menu. That is a different protocol. The Delta
   series' MEDIBUS support is for *importing* ventilator data into the monitor, not for exporting
   vitals. So MEDIBUS will not pull ECG/SpO2/NIBP from the Kappas.
2. **MEDIBUS is the protocol of Dräger ventilators and anaesthesia machines** — Evita, Evita 2,
   Evita 2 dura, Evita 4, Evita XL, Savina, V500, Fabius, Primus, Perseus. Those export exactly
   the numbers the engine's respiratory reasoning needs and the spot-check route never provides:
   inspired O2 (FiO2), PEEP, respiratory rate, minute volume, etCO2, and (Evita 4 with the SpO2
   option) SpO2 and pulse.

So this package targets **Dräger ventilators**. The serial transport, buffering and uplink it
builds are reused unchanged when the Infinity Export Protocol driver is added later (see
"Follow-ups"). The user must be told plainly which machines this connects to.

## Sources (engineering documents, not clinical claims)

- *Dräger RS 232 MEDIBUS Protocol Definition*, Rev 6.00, document 90 28 258, Dec 2007
  (UVA Health copy; full text extracted for this work).
- *MEDIBUS for Dräger Intensive Care Devices* IFU (Evita / Evita 2 / Evita 2 dura / Evita 4 /
  Savina / Capnosat) — device IDs, serial settings, data-code tables.
- Vital Recorder / VitalDB device notes and vscapture — field practice (FTDI adapter, null-modem,
  19200-8-E-1, 2 s numeric polling).

These are not vault sources: they support no clinical claim and stay out of `Homunculus/raw/`.
Distilled protocol notes live in `medibus/docs/medibus-protocol-notes.md` with those references.

## Scope

**In:** a bedside process that keeps a MEDIBUS session alive with one ventilator, polls measured
data (code page 1, optionally code page 2 and device settings) every 2 s, maps data codes to
`SignalCode`s through a per-site JSON table, stamps the configured patient/bed, and delivers FHIR
Observations to the existing `/ingest` endpoint through the engine's store-and-forward buffer.
Discovery mode (no uplink) reports which codes the device actually sends. A scripted fake device
makes the whole stack testable without hardware; a loopback check validates the USB adapter.

**Out:** realtime waveforms (bytes ≥ 80H are skipped), alarm forwarding (parsed and counted only),
writing anything *to* the ventilator beyond protocol handshakes, infusion-pump extension, trend
data, the Infinity Export Protocol (follow-up), any patient-identity lookup (the bridge has none).

## Architecture

```text
medibus/
├── README.md                       how to build the cable, run the loopback check, run the bridge
├── pyproject.toml                  package "homunculus-medibus"; extras: serial (pyserial), dev (pytest)
├── medibus-mapping.example.json    Evita 4 / Savina codes from the Dräger IFU — "verify at discovery"
├── docs/medibus-protocol-notes.md  distilled framing/timing rules + device tables, with references
├── src/medibus/
│   ├── framing.py      checksum, command/response encoders, StreamParser (embedded frames)
│   ├── messages.py     decode device-ID, measured-data, settings, alarm responses
│   ├── session.py      sans-I/O protocol state machine (ICC / NOP / timeouts / polling)
│   ├── mapping.py      site mapping JSON -> Observation builder + discovery counters
│   ├── bridge.py       session events -> observations -> send(FHIR dict); stats
│   ├── fake_device.py  scripted Dräger device (sans-I/O) for tests and --fake runs
│   ├── transport.py    pyserial reader/writer thread + loopback pair for the fake device
│   └── run.py          CLI entry point
├── scripts/loopback_check.py       USB adapter smoke test (TX↔RX jumper)
└── tests/
```

Dependency on the engine is limited to four stdlib-only modules — `homunculus.canonical`
(`Observation`, `SignalCode`), `homunculus.edge.serialize`, `homunculus.edge.buffer`,
`homunculus.edge.uplink`. They are imported from `../homunculus-engine/src` (pytest `pythonpath`;
`run.py` adds the path when `homunculus` is not installed). The engine's heavy dependencies are
not needed; the bedside box installs only `pyserial`. If the folder is moved out of the repo
later, those four modules are copied in.

### framing.py

- `checksum(data: bytes) -> bytes` — least-significant byte of the sum of all bytes, as two
  uppercase ASCII-hex characters. The leading ESC/SOH **is** included (spec FAQ).
- `encode_command(code: int, arg: bytes = b"") -> bytes` → `ESC code arg CS CR`.
- `encode_response(echo: int, payload: bytes = b"") -> bytes` → `SOH echo payload CS CR`.
- `Frame(kind: "command"|"response", code: int, payload: bytes, checksum_ok: bool)`.
- `StreamParser.feed(data) -> list[Frame]`. Rules from the spec: a frame opens on ESC or SOH and
  closes on CR; **a command may be embedded at any position inside a response** with its own
  checksum, so the parser keeps one open response and one open command and routes bytes to the
  innermost open frame; bytes ≥ 80H (realtime records) are discarded and never enter a checksum;
  DC1/DC3/CAN (11H/13H/18H) are surfaced as control events; anything before the first ESC/SOH is
  dropped. Frames with a bad checksum are returned with `checksum_ok=False` so the session can NAK
  a corrupt command or ignore a corrupt response.

### messages.py

Pure decoders from a response payload:

- `parse_device_id(payload) -> DeviceId(id, name, device_rev, medibus_rev)` —
  `NNNN 'Name' DD.DD MM.MM`.
- `parse_measured(payload) -> list[Reading(code: str, raw: str)]` — 2 hex chars + 4 chars; leading
  spaces stripped; `'-'` allowed; a value that does not parse as a number is kept as raw text for
  the discovery counters and never becomes an observation.
- `parse_settings(payload)` — same with 5-char values.
- `parse_alarms(payload) -> list[Alarm(priority, code, phrase)]` — 1 + 2 + 12 chars.
- Codes are two-character uppercase hex strings (`"EB"`), never ints, so mapping files read like
  the Dräger tables.

### session.py — sans-I/O state machine

`Session(config, clock)` exposes `receive(data: bytes)`, `tick(now) -> None`,
`outgoing() -> bytes`, `events() -> list[Event]`. No sockets, no threads, no sleeps — tests drive
it with a fake clock; the transport pumps bytes both ways.

States: `IDLE` → `INITIALISING` (our ICC sent, waiting for its echo) → `ACTIVE`.

Rules, each traceable to the protocol definition:

- **Start / restart:** send ICC when idle; repeat every 3 s if nothing is received. Receiving an
  ICC *from* the device also makes us `ACTIVE` (after answering it). Commands embedded in an ICC
  response are disregarded.
- **Answer every command**, known or not, with at least an empty response (`SOH echo CS CR`).
  Device-ID requests (52H) get `0161 'Homunculus' 01.00 06.00` — 0161 is the Dräger-recommended PC
  ID, and the MEDIBUS revision is the protocol-definition revision we implemented. STOP (55H) is
  answered and drops us to `IDLE`. A corrupt command gets `SOH NAK CS CR`.
- **One command in flight.** A new command only after the previous response arrived, or after
  10 s. On the 10 s timeout the command is retried; after 3 failed retries → re-initialise.
- **3 s silence** on the receive side → `IDLE` and ICC again.
- **NOP every 2 s** when nothing else is due and no command is in flight.
- **Polling** in `ACTIVE`: 24H every `poll_interval` (default 2 s); 2BH and 29H only when enabled
  in config (Evita 4 does not process 2BH — the IFU's command table is the reference).
- After our device-ID response the session waits ~200 ms before the next command (spec FAQ), which
  costs nothing and avoids the documented "command ignored" trap.
- Flow control: DC1 suspends our output until DC3 or 3 s; CAN aborts the in-flight command.

Events: `Connected(device_id)`, `Disconnected(reason)`, `Measured(codepage, readings, at)`,
`Settings(readings, at)`, `Alarms(alarms, at)`, `Unknown(frame)`.

### mapping.py

`medibus-mapping.json`:

```json
{
  "device": "Evita 4",
  "measured": {
    "EB": {"signal": "spo2",       "unit": "%"},
    "E1": {"signal": "heart_rate", "unit": "/min"},
    "D6": {"signal": "resp_rate",  "unit": "/min"},
    "F0": {"signal": "fio2",       "unit": "fraction", "scale": 0.01}
  },
  "derived": {"on_resp_support": true},
  "poll": {"codepage2": false, "settings": false}
}
```

- Only codes present in the file become observations; every other code is counted by
  `(codepage, code)` in the discovery report with an example *format* (digits/decimal/negative),
  never the value.
- `scale` multiplies the numeric value (FiO2 arrives as a percentage; the engine's `fio2` is a
  fraction, as the SOFA respiratory rule expects `pao2_fio2`/`fio2` in that form).
- `derived.on_resp_support` emits `on_resp_support = 1.0` once per successful measured-data poll
  while the session is `ACTIVE` — the fact that a ventilator is answering *is* the evidence; no
  observation is emitted when it is not.
- The example file pre-fills the Evita 4 / Savina codes from the Dräger IFU, each entry carrying a
  `"note"` naming the table it came from and `"verified": false`. Discovery on the real device
  flips them to true — the same workflow as `nce-mapping.json`.

### bridge.py

`MedibusBridge(send, mapping, patient_id, source_device)` consumes session events, builds
`Observation`s stamped with the configured `patient_id` (MEDIBUS carries **no** patient identity;
bed→patient is an operator responsibility, set per run and logged as bed label only) and the
poll's wall-clock UTC time, serialises through `observation_to_fhir`, and calls `send`. Stats:
polls, observations, unmapped counters, non-numeric counters, alarms seen (code + phrase only),
reconnects. `discovery_report()` renders the counters for the operator log. No values, ever, in
logs.

### transport.py and run.py

- `SerialTransport(port, baud, parity, bytesize=8, stopbits=1)` runs a reader thread that pushes
  bytes into an `asyncio.Queue` and writes whatever `session.outgoing()` yields. pyserial is
  imported lazily so tests and the fake never need it.
- `--fake` runs the same loop against `FakeDevice` in-process through a pair of byte queues.
- `run.py` flags mirror `run_nce_bridge.py`: `--port`, `--baud` (19200), `--parity` (E),
  `--patient-id` (required unless discovery), `--bed`, `--mapping`, `--cloud-url`, `--token`,
  `--db`, `--poll-interval`, `--report-interval`, `--fake`. No `--cloud-url` = discovery mode:
  nothing is forwarded, codes are reported. Buffer + `flush_loop` exactly as the NCE bridge.
- `scripts/loopback_check.py`: with TX and RX jumpered on the adapter, sends an ICC and expects the
  identical bytes back; prints the port settings it used. This is the "USB'ye yazıp bir cihazda
  deneriz" step's first check, before any ventilator is touched.

### fake_device.py

A sans-I/O scripted Dräger device: answers ICC with the spec's example bytes, sends its own
device-ID request embedded in the ICC response (the documented trap), answers 52H with
`8240 'Evita 4' 04.00 04.00`, answers 24H with a configurable table of readings, sends NOP every
2 s when idle, times out after 3 s of silence and re-sends ICC, optionally injects realtime bytes
and a corrupt frame. Used by tests and by `--fake` for demos.

## Data flow

```text
ventilator ──RS-232──▶ transport ─bytes─▶ Session ─events─▶ MedibusBridge ─FHIR dict─▶ SqliteBuffer ─▶ flush_loop ─▶ /ingest
                ◀──────────────────────── outgoing()  (ICC/NOP/24H/responses)
```

## Error handling

| Situation | Behaviour |
| --- | --- |
| Corrupt command from device | `SOH NAK CS CR`; counted |
| Corrupt response | ignored; command retried on the 10 s timer; counted |
| 3 s silence | `Disconnected`; ICC every 3 s; observations stop (no stale emission) |
| Unknown command | empty echo response; counted under `Unknown` |
| Non-numeric value | counted per code, not emitted |
| Unmapped code | counted per code with format hint |
| Serial port vanishes (USB pulled) | transport raises; runner logs, reopens every 5 s; buffer keeps delivering |
| Cloud down | buffer grows to `--max-buffer`, oldest dropped with a log line (engine behaviour) |

## Testing

- `test_framing.py` — checksum against every example byte string in the spec (ICC `1B 51 36 43 0D`,
  ICC response `01 51 35 32 0D`, NOP `1B 30 34 42 0D`, data request `1B 24 33 46 0D`, empty data
  response `01 24 32 35 0D`, NAK `01 15 31 36 0D`, PC device-ID `... 46 43 0D`); parser with
  embedded command inside a response, realtime bytes interleaved, garbage before the first frame,
  split frames across `feed()` calls, bad checksum.
- `test_messages.py` — measured data from the spec example (`EB 98`, `E1 70`), negative values,
  non-numeric, settings (5 chars), alarms, device ID with spaces in the name.
- `test_session.py` — fake clock: ICC on start, repeat at 3 s, ACTIVE on echo, embedded 52H
  answered with 0161, 200 ms hold, 24H every 2 s, NOP when idle, 10 s retry ×3 → re-init, 3 s
  silence → re-init, STOP → IDLE, DC1/DC3, corrupt command → NAK.
- `test_mapping.py` / `test_bridge.py` — observations carry patient id, UTC time, scaled FiO2,
  `on_resp_support` per poll, unmapped/non-numeric counters, no values in the report text.
- `test_fake_device.py` + `test_end_to_end.py` — Session ⇄ FakeDevice pumped through queues:
  full life-cycle to observations without hardware.
- `test_run.py` — CLI parsing, discovery-mode refusal to forward, `--fake` run for a few ticks.

## Security and clinical guard-rails

- The bridge only ever *reads* from the ventilator: the only bytes it writes are protocol
  handshakes, keep-alives and data requests. No configuration commands (4AH, 53H/54H, 59H).
- Attaching anything to a ventilator's RS-232 port requires biomed approval and a 1-bed pilot;
  the port is galvanically isolated on the device side (IFU), but the adapter and laptop must
  still be medical-grade-safe per the hospital's rules. The README says this before the wiring.
- No patient data in the repo: the buffer file is runtime-only; logs carry counts and codes.

## Follow-ups (not in this build)

- **Infinity RS-232 Export Protocol driver** (Kappa/Delta X5, cable 5206441, doc MS28819 Rev12) as
  a second `Session` implementation behind the same transport/bridge — needs the Dräger booklet.
- Alarm forwarding once the engine has an alarm-event input.
- Trend backfill (6CH/6DH) after a reconnect.
