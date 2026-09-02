# Homunculus on the hospital server — runbook

Everything runs on the server: the database, the engine, the dashboard and the HL7 bridge. No
patient data leaves the building, and no internet access is required at run time.

For running the bridge in Docker see [EDGE-BRIDGE-DOCKER.md](EDGE-BRIDGE-DOCKER.md). For why the
devices reach us through NCE's files rather than HL7, see **The device route** below.

## Bring-up

```bash
sudo mkdir -p /opt/homunculus && cd /opt/homunculus
git clone https://github.com/asbadef/Homunculus-AI.git .        # or copy the repo across
cd deploy/local

cp .env.example .env && chmod 600 .env
$EDITOR .env          # POSTGRES_PASSWORD, JWT_SECRET, TENANT_TOKEN, SEED_ADMIN_*,
                      # LISTEN_ADDR (device network), WEB_LISTEN_ADDR + WEB_PORT (browser)
```

Generate the secrets rather than inventing them:

```bash
openssl rand -base64 36
```

Create `site-mapping.json` next to the compose file **before** the first `up` — Docker creates a
*directory* where a bind-mounted file is missing, and the error that follows names neither the file
nor the cause:

```json
{
  "MDC_ECG_HEART_RATE": "heart_rate",
  "MDC_PULS_OXIM_SAT_O2": "spo2",
  "MDC_PRESS_BLD_NONINV_MEAN": "map",
  "MDC_RESP_RATE": "resp_rate",
  "MDC_TEMP_BLD": "temperature"
}
```

The mapping **replaces** the built-in table rather than merging with it, so it must list every code
the site sends. An unknown signal slug stops startup rather than silently dropping that signal.

## The device route: NCE's files, not WACP

The Connex Spot monitors do not speak HL7. The discovery probe caught a `RNDZCONNECT` rendezvous on
2575 — Welch Allyn's own WACP — and the device hung up when nothing answered it. The address the
device was calling turned out to be the hospital's **Welch Allyn NCE 5.2.0.2** server, which has
been collecting from these monitors since 2020 and writes every session to `SavedCopies` as XML.

So the bridge reads those files instead of implementing the vendor's protocol. The `nce` service in
`deploy/local/docker-compose.yml` mounts that folder **read-only** and runs
`scripts/run_nce_bridge.py`. Nothing is installed on the NCE server and nothing there is
reconfigured: it is a live clinical system four devices have depended on for five years.

Mount the share on the host before the first `up` — see `NCE_SHARE_PATH` in `.env.example` for the
exact `mount -t cifs` line, including the `uid=10001` that the bridge container needs. Without it
the container lists the directory fine and cannot open a single file, which looks exactly like an
empty share.

**What discovery actually found at this site (2026-09-02):** `SavedCopies` holds two kinds of file.
The `DeviceToNCE.xml` sessions are WACP object serialisation — useful for discovery, painful to
map. But the `NCEToHost.txt` copies are **NCE's own HL7 ORU rendering of the same readings**, with
standard MDC codes (`150456^MDC_PULS_OXIM_SAT_O2^MDC` and friends). The bridge therefore parses any
file starting `MSH|` with the same HL7 gateway the MLLP bridge uses, mapped through `hl7_signals`
in `nce-mapping.json` (keyed by the numeric OBX-3 code), and restamps every observation with the
filename's UTC epoch — the vendor's own timestamps are naive local time from a machine with a known
one-hour clock skew. `nce-mapping.json` in the repository already carries this site's four codes;
diastolic (150022) is deliberately unmapped and shows in the report by design.

Unlike `site-mapping.json`, **`nce-mapping.json` ships in the repository** — already present next to
the compose file, so the missing-bind-mount trap above does not apply to it. Its XML sections ship
*empty*, and that is deliberate: for a new site the first run is a discovery run. The bridge
forwards nothing it cannot map and reports the field names the sessions actually carry:

```text
WARNING nce-bridge: Eşlenmemiş alanlar: PatientId (12), SpO2 (12), Nibp_Systolic (12)
```

Fill `nce-mapping.json` in from that line — `patient_fields`, `timestamp_fields` and `signals` —
then `docker compose restart nce`. Guessing the vendor's field names instead is how a pilot receives
nothing while every screen looks healthy. Sessions that arrive *during* the discovery window are
recorded as processed even though they were refused, so to re-ingest them once the mapping is
filled in, stop the service, delete the ledger (`/data/nce.db.ledger` inside the `nce-data`
volume), and start it again with `--since` covering that window.

The compose service passes `--cloud-url` from the start, so `docker compose logs nce` shows an
`uplink:` line rather than the `KEŞİF MODU` banner — but with an empty mapping nothing is forwarded
either way, which is what makes the first run a de-facto discovery run regardless.

By default only sessions written since the bridge's first-ever start (remembered in the ledger, not
reset on every restart) are forwarded. `--since 2026-08-01` or `--all` backfill deliberately; both
put more patient data at rest, so they are a decision, not a default.

Configuring an HL7 ORU output on NCE itself remains the production target. The file route is what
unblocks the pilot without waiting on a vendor. See
[the design](superpowers/specs/2026-08-28-nce-file-bridge-design.md).

```bash
docker compose up -d
docker compose ps            # all services healthy
docker compose logs -f api
```

## The Dräger Infinity route: Gateway or ask

The pilot ICU's real continuous-telemetry source is a Dräger Infinity network — 13 Kappa bedsides
(VF9.1-C) on their own subnet, live ECG on occupied beds. Unlike the NCE monitors, this device
generation's HL7 exit is **Infinity Gateway**, separate Dräger software that exports HL7 ORU from
the Infinity network. Whether the hospital has it, or can license it, is an open question — see
`docs/drager-infinity-biomed-sorulari.md` for the exact questions asked and
`docs/superpowers/specs/2026-09-03-drager-infinity-integration-design.md` for the full design.

**No new code is needed for this path.** The engine's existing MLLP bridge
(`homunculus-engine/scripts/run_bridge.py`, `homunculus-engine/src/homunculus/edge/mllp.py`) is
the same bridge already proven against the NCE and MEDIBUS work — it just needs Gateway's HL7
output pointed at it.

Once Gateway is configured to send its HL7 ORU output at the Homunculus host's MLLP port (the
network path from `172.100.101.72` to the Dräger subnet was already verified reachable on
2026-09-02), run the bridge in discovery mode from `homunculus-engine/`:

```bash
python scripts/run_bridge.py --db bridge.db
```

With no `--cloud-url`, nothing is forwarded — the log prints:

```text
KEŞİF MODU: veri iletilmiyor, yalnızca dinleniyor ve kodlar raporlanıyor (iletmek için --cloud-url verin)
```

followed by periodic `Eşlenmemiş kodlar: <code> (<count>), ...` lines as real Gateway traffic
arrives. From those, write `drager-gateway-mapping.json` — the same flat shape `run_bridge.py`
expects for any site (`{"<OBX code>": "<SignalCode slug>"}`), for example:

```json
{
  "150456": "spo2",
  "150455": "heart_rate",
  "150457": "resp_rate"
}
```

An unknown `SignalCode` slug fails startup loudly rather than silently dropping a signal for the
whole pilot (`run_bridge.py`'s `load_mapping`). Re-run with the mapping and an uplink:

```bash
python scripts/run_bridge.py --db bridge.db \
  --mapping drager-gateway-mapping.json --cloud-url https://<host>/api --token <tenant-token>
```

and confirm one live Dräger-fed bed's observations reach the dashboard, the same acceptance check
already used for NCE and MEDIBUS.

If Gateway turns out not to exist and cannot be licensed, the fallback is the Kappa bedside's own
serial export (*Infinity RS-232 Export Protocol*, Dräger doc MS28819) — a second protocol driver
inside the `medibus/` package, reusing its transport/buffer/CLI machinery, blocked on obtaining
that document. See the design doc's "Track 2" for what that needs.

## Verifying

```bash
# the proxy path works end to end
curl -s http://172.100.101.72/health

# the engine accepts an observation and the whole chain is wired
docker compose exec bridge python scripts/hl7_simulator.py \
  --host bridge --port 2575 --patients 1 --count 3
```

Then check, in order:

```bash
docker compose logs bridge | tail -5                       # messages and observations counted
curl -s -H "Authorization: Bearer $TENANT_TOKEN" http://172.100.101.72/patients
curl -s -H "Authorization: Bearer $TENANT_TOKEN" http://172.100.101.72/alerts/<patient-id>
```

The audit trail records every ingest with its value, unit and observation time:

```bash
docker compose exec postgres psql -U homunculus -d homunculus -c \
  "SELECT event_type, count(*) FROM audit GROUP BY event_type ORDER BY 2 DESC;"
```

Confirm the live stream is not being buffered by nginx — it should hold the connection open and
emit frames rather than printing nothing and exiting:

```bash
curl -N "http://172.100.101.72/stream?token=$TENANT_TOKEN"
```

## Backups — your responsibility now

No managed provider is doing this any more. The audit trail is a legal record, and an unbacked-up
pilot database is one disk failure away from losing it.

```bash
docker compose exec -T postgres pg_dump -U homunculus homunculus \
  | gzip > "/var/backups/homunculus-$(date +%F-%H%M).sql.gz"
```

Restore:

```bash
gunzip -c /var/backups/homunculus-YYYY-MM-DD-HHMM.sql.gz \
  | docker compose exec -T postgres psql -U homunculus -d homunculus
```

Put the dump on a schedule (cron or a systemd timer), keep it on encrypted storage, and **test a
restore at least once** — an untested backup is a belief, not a backup.

## Updating

```bash
git pull
docker compose build          # rebuilds api and web
docker compose pull bridge    # the bridge image comes from GHCR
docker compose up -d
```

This release adds `NCE_SHARE_PATH` to `.env` — without it, `docker compose up` fails on an invalid
volume spec for the `nce` service and takes the unrelated services down with it. Add it (see
`.env.example`) before pulling.

Data survives: it lives in the `pgdata` volume, not in the containers.

## PHI

- The `pgdata` volume holds patient data. Encrypted storage, and it is removed only deliberately.
- The `bridge-data` volume holds observations in transit; delete it after the pilot.
- The `nce-data` volume holds the same thing for the file route — the SQLite buffer and the
  processed-file ledger; delete it after the pilot too.
- The bridge logs counts, connection events and OBX identifiers — never measurements or patient
  identifiers.
- Nothing in this directory may be committed with real values: `.env` and `site-mapping.json` are
  gitignored.

## What the dashboard shows in Phase 1

The board still draws its patients and alerts from the simulation, and carries a banner saying so.
Real device data is verified through `/patients`, `/alerts/{patient_id}` and the audit table.
Phase 2 wires the board to live data and removes the banner.

## Clock

```bash
timedatectl                  # expect "System clock synchronized: yes"
```

The engine evaluates against the observation timestamp and escalates against the wall clock. A
monitor with a wrong clock makes stale readings look fresh and shifts every scoring window.
