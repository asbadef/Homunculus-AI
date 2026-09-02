---
title: Pilot site survey — ICU continuous-monitoring network (Dräger Infinity)
source_url:
authors: Homunculus project team (first-party site survey)
publication:
year: 2026
doi:
retrieved: 2026-09-02
type: protocol
capture: full-text
status: current
superseded_by:
---

> **Capture note.** This is a FIRST-PARTY record: facts read directly off the pilot hospital's
> central-station and bedside screens on 2026-09-02, transcribed by the project team. It is not an
> external publication. Photographs exist but are deliberately NOT stored in this repository —
> they carry live patient waveforms, ward backgrounds and service credentials; this text is the
> sanitised evidence of record. The hospital's name and all credentials are intentionally omitted.

# Pilot site survey — ICU continuous-monitoring network (2026-09-02)

## What was found

The pilot hospital's ICU runs a **Dräger Infinity** continuous-monitoring network, entirely
separate from the Welch Allyn / NCE spot-check world already integrated (see
`nce-savedcopies` route in the engine docs).

**Central station.** A Dräger central (hospital label `BONADEA`, care unit `ICU`, monitoring
unit `MU2`, host `ICU2`) displaying live continuous ECG for occupied beds. Its Biomed menu
exposes device inventory, a diagnostic log, and a system console shell. It is a live clinical
system: exploration was read-only.

**Bedside fleet.** 13 × **Dräger Infinity Kappa** bedside monitors, software **VF9.1-C**,
device labels BED01–BED15 and BED25, host labels Y2412–Y2453, docked via CPS stations
(example: BED14 on CPS/IDS Y2445). At survey time 6 were ONLINE (occupied beds), the rest
STANDBY.

**Telemetry stock.** 12 × **Dräger Infinity M300** wireless telemetry transmitters registered
to host ICU2, all DISCONNECTED — apparently unused inventory, available for future mobile/ward
monitoring.

**Network.** Dedicated monitoring subnet `10.10.203.0/24` (example bedside: 10.10.203.32/24,
default route 10.10.203.254; network printer 10.10.203.232). Network mode "Direct Net.";
central station flag enabled on bedsides; remote silence/control enabled.

**Timezone.** The site is at **UTC+4 (Asia/Baku)**. This retroactively explains the
"one-hour clock discrepancy" recorded during the 2026-08-28 NCE discovery: the server clock was
correct for the site; the earlier UTC+3 assumption was wrong. No data was mis-stamped — the
file bridge takes timestamps from UTC epochs by design — but deployment `TZ` must be
`Asia/Baku`.

## What it implies for Homunculus

- Continuous ICU telemetry — the engine's primary intended input (SOFA, sepsis conjunction,
  trend analysis) — already exists at the site on 13 beds. The integration key for this
  Dräger generation is **Infinity Gateway** (separate Dräger software that exports HL7 ORU
  from the Infinity network). Whether the site has or can license it is THE open question.
- If Gateway output is pointed at the engine's existing MLLP bridge (port 2575), the
  established discovery-then-mapping workflow applies unchanged: unmapped OBX identifiers are
  counted and reported, and the site mapping is written from what the station actually sends.
- The M300 stock suggests a future step-down/ward telemetry expansion without new hardware.

## Limitations

First-party observation of screens on one day; software versions and inventory can drift.
Supports **no clinical claims** — infrastructure facts only. The Infinity Gateway question is
recorded here as open, not answered.
