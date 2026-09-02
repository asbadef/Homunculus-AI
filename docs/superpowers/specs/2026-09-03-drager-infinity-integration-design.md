# Dräger Infinity ICU integration — design

**Date:** 2026-09-03
**Status:** approved for planning
**Deliverable of this spec:** a biomed outreach question list + a ready-to-run Gateway runbook +
a fixed architecture decision for the Kappa serial fallback. **Not** new production code — the
Gateway path reuses the engine's existing MLLP bridge unchanged; the Kappa path is blocked on a
document the hospital hasn't been asked for yet.

## Why this exists

The pilot ICU's real continuous-telemetry source is the **Dräger Infinity** network: 13 Infinity
Kappa bedsides (VF9.1-C) on `10.10.203.0/24`, live ECG on occupied beds — the input the engine's
SOFA/sepsis/trend reasoning was built for, and richer than the Welch Allyn NCE spot-checks already
integrated. See [[hospital-monitoring-landscape]] and the vault's
`pilot-icu-monitoring-survey-2026-09-02` source note.

Two facts from the 2026-09-02 site survey shape everything below:

1. **This Dräger generation's HL7 exit is Infinity Gateway** — separate Windows software that
   exports HL7 ORU from the Infinity network. Whether the hospital has it, or can license it, is
   the open question this spec exists to resolve — by asking, not guessing.
2. **The Kappa bedsides do not speak MEDIBUS outward.** Their serial vitals export is a different
   protocol, the *Infinity RS-232 Export Protocol* (Dräger doc MS28819 Rev12, connector X5, cable
   5206441) — "Olympus-compliant", Siemens SC lineage. The `medibus/` package built 2026-09-02
   targets ventilators (Evita/Savina/V500/Primus); its own "Follow-ups" section already earmarks a
   second `Session` implementation for MS28819 behind the same transport/bridge, once the booklet
   is obtained. Nothing about that document has been requested yet.

## Scope

**In:** a biomed/Dräger-reseller question list (the actual next action); a Gateway-path runbook
that points the *existing, unmodified* MLLP bridge (`homunculus-engine/scripts/run_bridge.py`,
`edge/mllp.py`) at Gateway's HL7 output once it exists; a fixed architecture decision for where the
Kappa serial driver will live and what it reuses, so that work can start immediately once MS28819
arrives, without a second design round.

**Out:** writing the Kappa serial protocol driver itself (blocked on MS28819 — a follow-up spec,
not this one); any change to `run_bridge.py`, `edge/mllp.py`, or the engine's HL7 adapter (the
Gateway path is a configuration/runbook exercise against code that already exists and is already
tested); waveform data (out of scope for both device generations per existing project decisions);
anything that writes to or configures a Dräger device.

## Track 1 — Gateway path (primary)

### What already exists (verified 2026-09-03, not rebuilt)

- `homunculus-engine/src/homunculus/edge/mllp.py` — a working `asyncio` MLLP server
  (`serve_mllp`): frames `<VT>message<FS><CR>`, always ACKs (AA or AE — never silence), one bad
  message never drops the connection, no PHI in logs.
- `homunculus-engine/scripts/run_bridge.py` — the on-prem runner: MLLP in → `SqliteBuffer` →
  `flush_loop` → cloud `/ingest`. Discovery mode (`--db` only, no `--cloud-url`) forwards nothing
  and reports which OBX identifiers a station actually sends — the same workflow already proven
  against the NCE bridge and the MEDIBUS bridge.
- Network path: the Homunculus VM (`172.100.101.72`) already reaches `10.10.203.32` (verified
  2026-09-02) — when a Gateway exists, `172.100.101.72:2575` is reachable from the Dräger subnet.

So the Gateway path needs **zero new code**. It needs an answer, then a discovery run, then a
mapping file — identical in shape to `mindray.json`.

### Biomed / Dräger-reseller question list (this spec's actual deliverable)

1. Is Infinity Gateway software installed anywhere at the hospital? If not, can it be licensed
   from Dräger, and roughly what does that involve (cost, lead time, a service visit)?
2. The `Win-DRGMON` integration server (`10.10.207.2`) already speaks HL7 to other systems (Karl
   Storz SCENARA.connect, Medset PADSY, Nihon Kohden) but has no Dräger software despite the
   hostname — is Gateway meant to go there, or somewhere else?
3. Who can configure the Biomed menu on the central station (`ICU2`, label `BONADEA`) to enable
   HL7 ORU export and point it at a destination host:port — hospital biomed, a Dräger field
   engineer, or only Dräger remote support?
4. Can Gateway's HL7 ORU output be pointed at an arbitrary destination
   (`172.100.101.72:2575`), or does it require a specific receiving system profile / registration
   on the Dräger side?
5. (Separate from Gateway, but same conversation) Can we get the MS28819 Rev12 booklet
   ("Infinity RS-232 Export Protocol") and cable 5206441 — see Track 2 — and confirm which Kappa
   bedsides have the X5 export port physically enabled?

### Runbook (to execute once Q1–4 are answered "yes")

1. Configure Gateway's HL7 ORU export to target `172.100.101.72:2575`.
2. Run `python scripts/run_bridge.py --db bridge.db` in discovery mode (no `--cloud-url`) against
   live Gateway traffic. Let it run long enough to see a full vitals cycle per bed.
3. Read the operator log's OBX-identifier counts; write `drager-gateway-mapping.json` mapping each
   sent OBX identifier to a `SignalCode`, the same format as `mindray.json` (unknown slugs fail
   startup loudly, per `run_bridge.py`'s existing `load_mapping`).
4. Re-run with `--mapping drager-gateway-mapping.json --cloud-url <...> --token <...>` and confirm
   observations for one live bed reach the dashboard.
5. Document the finished mapping and the runbook itself in `docs/EDGE-BRIDGE-LOCAL.md` alongside
   the existing NCE section.

## Track 2 — Kappa serial path (fallback, architecture fixed now, code deferred)

**Decision, fixed by this spec:** when MS28819 is obtained, the Infinity RS-232 Export Protocol
driver is built as a **second protocol implementation inside the existing `medibus/` package**,
not a new top-level package — reusing `transport.py` (pyserial reader/writer thread), the
`EdgeBridge`/`SqliteBuffer`/`flush_loop` chain, the `run.py` CLI flag shape, and the
sans-I/O-session + fake-device testing pattern that `medibus/`'s own MEDIBUS implementation
already proved out. Only `framing.py` and `session.py` are protocol-specific and get a parallel
module (e.g. `medibus/src/medibus/kappa/`) once the document defines their rules — this spec does
not guess at them.

This is a direct continuation of the MEDIBUS design's own "Follow-ups" section, which named this
exact driver as its first planned extension.

**What must be obtained before any code is written (Q5 above):**
- Dräger doc MS28819 Rev12 ("Infinity RS-232 Export Protocol").
- Cable 5206441 (X5 connector).
- Confirmation of which bedsides have X5 export enabled in the Biomed menu.

## Acceptance criteria

- **Gateway path:** discovery-mode `run_bridge.py` shows real OBX identifiers from live Gateway
  traffic; a written mapping file turns them into observations; one live bed's data appears in the
  dashboard end to end. This mirrors the NCE and MEDIBUS acceptance pattern — no new pattern
  invented.
- **Kappa path:** out of acceptance scope for this spec. Acceptance criteria for it belong to the
  follow-up spec written once MS28819 is in hand.
- **This spec specifically:** the question list above is sent to biomed/Dräger, and the runbook is
  committed and ready to execute the moment an answer unlocks it.

## Testing

No new production code ships from this spec, so there is nothing to unit-test. The Gateway path
rides on `run_bridge.py`'s existing coverage (part of the engine's 412 tests). The Kappa path's
tests are deferred to its own follow-up spec, written the same way `medibus/`'s were: framing
against literal byte examples from the manual, a fake-device end-to-end harness, no speculative
protocol code merged without the document backing it.
