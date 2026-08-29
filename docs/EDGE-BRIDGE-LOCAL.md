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

Unlike `site-mapping.json`, **`nce-mapping.json` ships in the repository** — already present next to
the compose file, so the missing-bind-mount trap above does not apply to it. It ships *empty*, and
that is deliberate: the first run is a discovery run. The bridge forwards nothing and reports the
field names the sessions actually carry:

```text
WARNING nce-bridge: Eşlenmemiş alanlar: PatientId (12), SpO2 (12), Nibp_Systolic (12)
```

Fill `nce-mapping.json` in from that line — `patient_fields`, `timestamp_fields` and `signals` —
then `docker compose restart nce`. Guessing the vendor's field names instead is how a pilot receives
nothing while every screen looks healthy.

By default only sessions written after the bridge starts are forwarded. `--since 2026-08-01` or
`--all` backfill deliberately; both put more patient data at rest, so they are a decision, not a
default.

Configuring an HL7 ORU output on NCE itself remains the production target. The file route is what
unblocks the pilot without waiting on a vendor. See
[the design](superpowers/specs/2026-08-28-nce-file-bridge-design.md).

```bash
docker compose up -d
docker compose ps            # all services healthy
docker compose logs -f api
```

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

Data survives: it lives in the `pgdata` volume, not in the containers.

## PHI

- The `pgdata` volume holds patient data. Encrypted storage, and it is removed only deliberately.
- The `bridge-data` volume holds observations in transit; delete it after the pilot.
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
