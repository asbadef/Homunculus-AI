# On-prem stack — Homunculus running entirely on the hospital server

**Date:** 2026-08-26
**Status:** design approved (Phase 1)

## Context

The pilot's devices live on the hospital network. Until now the engine ran on Render against
Supabase, which forced three compromises that a hospital pilot should not have to make:

- the free Render plan sleeps, and **a sleeping service runs no escalation loop** — the one failure
  escalation exists to prevent;
- every observation left the hospital, over a TLS connection whose certificate is currently
  **encrypted but unverified**;
- the whole path depended on internet egress from a device VLAN that frequently has none.

Running the stack on the hospital's own Ubuntu server removes all three at once. Patient data never
leaves the building, which also moves the KVKK/consent conversation from "data is processed abroad"
to "data stays on our server".

The device integration itself is separately blocked: the Welch Allyn unit speaks WACP and expects a
Connex server that does not exist here (see the probe capture of `RNDZCONNECT`). That is a vendor
question, not a software one. This design makes the receiving system ready, so the day any HL7
source appears — a Connex server, a Mindray central station, or a middleware — it plugs in.

## Architecture

Four containers on the server, one Docker network:

```
cihaz ──HL7/MLLP:2575──► bridge ──► api ──► postgres        (data stays here)
                                     ▲
tarayıcı ──:80──► web (nginx) ───────┘
                  static dashboard + API reverse proxy
```

| Container | Responsibility |
| --- | --- |
| `postgres` | the only data store. Named volume; no external access. |
| `api` | FastAPI + engine + escalation loop + audit. Runs migrations and seeds the first admin on start. |
| `web` | nginx: serves the built dashboard and reverse-proxies API paths to `api`. |
| `bridge` | the existing GHCR image, forwarding to `api` over the internal network. |

### Postgres replaces Supabase for the pilot

Supabase stays as the demo/cloud database; the pilot's data lives in the local container. This also
retires the unverified-TLS compromise: the connection never crosses a network the hospital does not
own.

Migrations are the same Alembic chain already running against Supabase, so the schema cannot drift
between the two.

### Same-origin serving is the point of the `web` container

The dashboard is built **without** `VITE_API_URL`. `defaultBaseUrl()` then returns `""`, so the
frontend calls its own origin, and nginx proxies those paths to `api`. This is not a convenience:
the Vercel deployment failed precisely because a build-time API URL was missing and every request
went to a static host that answered `405`. Same-origin removes the setting that can be wrong.

nginx proxies: `/auth`, `/patients`, `/alerts`, `/stream`, `/notifications`, `/ack`, `/ingest`,
`/view`, `/audit`, `/health`. Everything else falls through to the SPA.

**SSE requires `proxy_buffering off`** on `/stream` and `/notifications`, with a long
`proxy_read_timeout` and HTTP/1.1. Without it nginx buffers the event stream and the board stays
blank for minutes — a live-monitoring screen that silently stops updating is the worst failure mode
available to this system, so this is a correctness setting, not tuning.

### The bridge talks to `api` internally

`--cloud-url http://api:8000`. No internet egress, no TLS to configure, and the tenant token never
crosses a network boundary. The device still reaches only the bridge, on 2575.

## Phase 1 scope

Phase 1 delivers a system that **receives, evaluates and stores** — verified through the API and
the database.

What ships:

- `homunculus-engine/Dockerfile.api` — the API image. Unlike the bridge (standard library only),
  this installs the project's dependencies.
- `deploy/local/docker-compose.yml` — the four services, volumes, healthchecks.
- `deploy/local/web/` — multi-stage build (dashboard) plus the nginx configuration.
- `deploy/local/.env.example` — database password, JWT secret, tenant token, admin seed.
- Runbook covering bring-up, verification and backup.

What Phase 1 does **not** do: make the dashboard's clinical board show live data.

### The honesty requirement in Phase 1

The dashboard authenticates against the real backend but still draws its patients, alerts and vitals
from the **simulation** — `liveStore.js` replaces only the authentication actions. Shipping that as
the pilot's screen would show invented patients to a clinician who had just logged in with real
credentials, in a real hospital.

So in Phase 1 the served dashboard carries a **persistent, non-dismissible banner** at the top of
every screen, stating that the board shows demonstration data and not this server's live feed. Not
a tooltip, not a one-time dialog: a clinician arriving mid-shift at a screen someone else opened
must see it too. Verification of real data happens through `/patients`, `/alerts/{patient_id}` and
the audit table — not the board.

Phase 2 (separately specced) bridges JWT identity to the tenant-scoped board routes and wires the
live data layer, at which point the notice comes down.

## Data and PHI

- Observations, alerts, escalations and the audit trail live in the local Postgres volume. Nothing
  is sent outside the hospital.
- The bridge's SQLite buffer holds observations in transit; it stays a named volume on encrypted
  storage and is deleted after the pilot.
- No patient data enters this repository — the compose files carry configuration only, and `.env`
  is gitignored.
- Backups are the operator's responsibility now that no managed provider does them: the runbook
  includes a `pg_dump` command and states that an unbacked-up pilot database is one disk failure
  from losing its audit trail, which is a legal record.

## Verification

1. `docker compose up -d`; every service reports healthy.
2. `curl http://<server>/health` → `{"status":"ok"}` through nginx, proving the proxy path.
3. Log in through the browser against the local API.
4. Drive the simulator at the bridge; confirm in order:
   - bridge log shows messages and mapped observations,
   - `GET /patients` returns the patient,
   - `GET /alerts/{patient_id}` returns cited alerts,
   - the `audit` table holds `ingest` rows carrying value, unit and observation timestamp.
5. Restart the stack; confirm the data is still there — the point of the volume.
6. Confirm SSE actually streams through nginx (`curl -N http://<server>/stream?token=…` keeps the
   connection open and emits frames) rather than buffering.

## Out of scope

The live dashboard board (Phase 2); WACP; TLS on the local network; multi-server high availability;
migrating existing Supabase data — the pilot database starts empty.
