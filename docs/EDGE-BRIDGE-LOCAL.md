# Homunculus on the hospital server — runbook

Everything runs on the server: the database, the engine, the dashboard and the HL7 bridge. No
patient data leaves the building, and no internet access is required at run time.

For the device-side story (discovery, mapping, the WACP finding) see
[EDGE-BRIDGE-DOCKER.md](EDGE-BRIDGE-DOCKER.md).

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
