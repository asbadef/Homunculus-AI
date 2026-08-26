# On-Prem Local Stack (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Homunculus entirely on the hospital's Ubuntu server — devices feed it, and the data is stored there and never leaves the building.

**Architecture:** Four containers on one Docker network. `postgres` holds all data; `api` runs FastAPI, the engine, the escalation loop and the audit trail; `web` is nginx serving the built dashboard and reverse-proxying API paths so the frontend and API share one origin; `bridge` is the existing published image, forwarding to `api` over the internal network. Only `web` (80) and `bridge` (2575) publish ports.

**Tech Stack:** Docker Compose, Postgres 16, Python 3.12 / FastAPI / SQLAlchemy / Alembic, Node 20 / Vite / React, nginx, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-26-local-onprem-stack-design.md`

---

## Before you start

**Docker is not available on the Windows development machine.** Every container step in this plan is verified on the Ubuntu server (`172.100.101.72`). Tasks 1–6 and 8 produce files that are committed from the dev machine and validated on the server in **Task 9**. **Task 7** (the banner) is pure frontend and **is** fully testable on the dev machine with Vitest — do not skip its tests waiting for the server.

Where a task says "verify on the server", that means: commit, pull on the server, run the command there.

## File structure

| File | Responsibility |
| --- | --- |
| `homunculus-engine/Dockerfile.api` | API image. Installs project dependencies (unlike the bridge, which is standard-library only), runs migrations + seed + uvicorn. |
| `.dockerignore` (repo root) | Keeps the web build context small and keeps the Obsidian vault and git history out of the image. |
| `deploy/local/web/nginx.conf` | Serves the SPA; proxies API paths; the SSE-specific block. |
| `deploy/local/web/Dockerfile` | Multi-stage: build the dashboard, serve it with nginx. |
| `deploy/local/docker-compose.yml` | The four services, volumes, healthchecks, port bindings. |
| `deploy/local/.env.example` | Shape of the secrets; the real `.env` is gitignored. |
| `dashboard/src/DemoDataBanner.jsx` | The persistent notice that the board is demonstration data. |
| `dashboard/src/DemoDataBanner.test.jsx` | Its tests. |
| `dashboard/src/main.jsx` | Mounts the banner around the rendered root. |
| `docs/EDGE-BRIDGE-LOCAL.md` | Operator runbook: bring-up, verification, backup, restore. |

---

### Task 1: API image

**Files:**
- Create: `homunculus-engine/Dockerfile.api`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Homunculus API — FastAPI, the clinical engine, the escalation loop and the audit trail.
#
# Unlike the edge bridge (standard library only, see Dockerfile), this image installs the project's
# dependencies: FastAPI, SQLAlchemy, asyncpg, Alembic, bcrypt, pyotp.
#
# Build from the homunculus-engine directory:
#   docker build -t homunculus-api -f Dockerfile.api .

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# pyproject first so the dependency layer is cached independently of source edits.
COPY pyproject.toml /app/
COPY src/ /app/src/
COPY scripts/ /app/scripts/
COPY alembic/ /app/alembic/
COPY alembic.ini /app/

RUN pip install --no-cache-dir -e . \
    && useradd --system --uid 10002 --home /app homunculus \
    && chown -R homunculus:homunculus /app

USER homunculus

EXPOSE 8000

# Migrate, then bootstrap the first admin, then serve. seed_admin.py is idempotent and exits 0 when
# SEED_ADMIN_PASSWORD is unset, so restarts keep working after the operator removes the password.
CMD ["sh", "-c", "alembic upgrade head && python scripts/seed_admin.py && uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]
```

- [ ] **Step 2: Verify the file parses as a Dockerfile locally**

Docker is unavailable on the dev machine, so check the one thing that silently breaks the build — that every path it copies exists:

Run:
```bash
cd homunculus-engine && for p in pyproject.toml src scripts alembic alembic.ini; do test -e "$p" && echo "OK   $p" || echo "MISSING $p"; done
```
Expected: five `OK` lines, no `MISSING`.

- [ ] **Step 3: Commit**

```bash
git add homunculus-engine/Dockerfile.api
git commit -m "feat(deploy): API image for the on-prem stack"
```

---

### Task 2: Keep the web build context small

**Files:**
- Create: `.dockerignore` (repository root)

The `web` image builds from the repository root, because it needs `dashboard/`. Without this file the build context includes the git history and the Obsidian vault — slow, and it puts unrelated content into a build.

- [ ] **Step 1: Write the file**

```
.git/
Homunculus/
homunculus-ml/
homunculus-engine/.venv/
homunculus-engine/alembic/__pycache__/
dashboard/node_modules/
dashboard/dist/
**/__pycache__/
**/*.pyc
**/*.db
**/*.db-journal
**/*.db-wal
deploy/local/.env
deploy/bridge/.env
docs/
```

- [ ] **Step 2: Confirm the dashboard sources are still included**

`.dockerignore` excluding too much is the failure that produces a confusing "file not found" inside the build.

Run:
```bash
test -f dashboard/package.json && test -d dashboard/src && echo "dashboard sources present"
```
Expected: `dashboard sources present`

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore(deploy): trim the docker build context"
```

---

### Task 3: nginx configuration

**Files:**
- Create: `deploy/local/web/nginx.conf`

- [ ] **Step 1: Write the configuration**

```nginx
# Serves the dashboard and reverse-proxies the API, so the frontend and API share one origin.
#
# That is the point of this container. The dashboard is built WITHOUT VITE_API_URL, so
# defaultBaseUrl() returns "" and every request goes to the page's own origin. There is no
# build-time API address that can be wrong — which is exactly how the Vercel deployment broke.

server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Server-Sent Events. These settings are the difference between a live board and one that
    # silently stops updating: nginx buffers proxied responses by default, so event frames pile up
    # in the buffer instead of reaching the browser, and the screen looks merely quiet.
    location ~ ^/(stream|notifications) {
        proxy_pass http://api:8000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location ~ ^/(auth|patients|alerts|ack|ingest|view|audit|health) {
        proxy_pass http://api:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # index.html is never cached: the browser must be able to pick up a new build without the
    # operator clearing site data. The hashed assets under /assets are safe to cache forever.
    location = /index.html {
        add_header Cache-Control "no-store";
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Confirm every proxied path matches a real backend route**

Run:
```bash
cd homunculus-engine && DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/x" ./.venv/Scripts/python.exe -c "
from homunculus.api.app import create_app
paths = sorted(create_app({'t':'HOSP1'}).openapi()['paths'])
proxied = ('auth','patients','alerts','ack','ingest','view','audit','health','stream','notifications')
missing = [p for p in proxied if not any(x.startswith('/'+p) for x in paths)]
print('eslesmeyen:', missing or 'yok')
"
```
Expected: `eslesmeyen: yok`

- [ ] **Step 3: Commit**

```bash
git add deploy/local/web/nginx.conf
git commit -m "feat(deploy): nginx serves the dashboard and proxies the API same-origin"
```

---

### Task 4: web image

**Files:**
- Create: `deploy/local/web/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# Dashboard + reverse proxy. Build context is the REPOSITORY ROOT (it needs dashboard/).
#
#   docker build -t homunculus-web -f deploy/local/web/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /build

COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci

COPY dashboard/ ./

# VITE_API_URL is DELIBERATELY NOT SET. With it unset, defaultBaseUrl() returns "" and the app
# talks to its own origin, which nginx proxies to the API. Setting it here would reintroduce the
# build-time address that broke the Vercel deployment.
RUN npm run build

FROM nginx:alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY deploy/local/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 2: Confirm the build produces dist/**

Run:
```bash
cd dashboard && npm run build && test -d dist && echo "dist uretildi"
```
Expected: `dist uretildi`

- [ ] **Step 3: Commit**

```bash
git add deploy/local/web/Dockerfile
git commit -m "feat(deploy): web image builds the dashboard same-origin"
```

---

### Task 5: Environment template

**Files:**
- Create: `deploy/local/.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Write the template**

```bash
# Copy to `.env` next to docker-compose.yml, fill in, and lock it down:
#   cp .env.example .env && chmod 600 .env
#
# `.env` is gitignored. Nothing in this file may be committed with a real value.

# Postgres. This database holds real patient data; treat the password accordingly.
POSTGRES_PASSWORD=change-me

# Signing key for session tokens. Generate one, do not invent one:
#   openssl rand -base64 36
JWT_SECRET=change-me

# Tenant bearer token used by the bridge to POST observations. This is a WRITE credential: it
# authorises /ingest. Generate it the same way as JWT_SECRET; do not reuse "pilot-token".
TENANT_TOKEN=change-me

# First administrator, created on the first start. The email must pass the login API's validation
# (".local" and "localhost" domains are rejected).
#
# NOTE: seeding is idempotent and SKIPS an existing user. Changing this password later does NOT
# change the account's password — there is no password-change flow yet.
SEED_ADMIN_EMAIL=admin@hastane.com.tr
SEED_ADMIN_PASSWORD=change-me
SEED_ADMIN_NAME=Sistem Yöneticisi

# The interface the MLLP port binds to — the one facing the device network, never 0.0.0.0.
# MLLP is plain text with no authentication.
LISTEN_ADDR=172.100.101.72

# The interface the dashboard is served on.
WEB_LISTEN_ADDR=172.100.101.72

# Container timezone. The engine reasons about observation timestamps, so a host and a monitor that
# disagree about the clock produce alerts that are wrong in ways nobody notices.
TZ=Europe/Istanbul
```

- [ ] **Step 2: Add the secrets to .gitignore**

Append to `.gitignore`:

```
deploy/local/.env
deploy/local/site-mapping.json
```

- [ ] **Step 3: Verify both are actually ignored**

Run:
```bash
touch deploy/local/.env deploy/local/site-mapping.json
git check-ignore -v deploy/local/.env deploy/local/site-mapping.json
rm -f deploy/local/.env deploy/local/site-mapping.json
```
Expected: two lines naming `.gitignore` as the source of the rule.

- [ ] **Step 4: Commit**

```bash
git add deploy/local/.env.example .gitignore
git commit -m "feat(deploy): environment template for the on-prem stack"
```

---

### Task 6: Compose file

**Files:**
- Create: `deploy/local/docker-compose.yml`

- [ ] **Step 1: Write the compose file**

```yaml
# Homunculus, entirely on the hospital's own server.
#
#   cd /opt/homunculus/local
#   cp .env.example .env && chmod 600 .env && $EDITOR .env
#   docker compose up -d
#
# Only `web` and `bridge` publish ports. Postgres and the API are reachable only from inside the
# Docker network: the database holds patient data and has no reason to be addressable from the ward
# network.

services:
  postgres:
    image: postgres:16
    container_name: homunculus-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: homunculus
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: homunculus
      TZ: ${TZ:-Europe/Istanbul}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      # The API waits for this. Without it, `alembic upgrade head` races the database's first
      # start and the API dies on a connection error that looks like a configuration fault.
      test: ["CMD-SHELL", "pg_isready -U homunculus -d homunculus"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

  api:
    build:
      context: ../../homunculus-engine
      dockerfile: Dockerfile.api
    container_name: homunculus-api
    restart: unless-stopped
    environment:
      # DATABASE_SSL is deliberately UNSET: ssl_context() then returns None and the connection is
      # plain, which is correct for a database on the same host. Setting it would demand a
      # certificate chain that does not exist here.
      DATABASE_URL: postgresql://homunculus:${POSTGRES_PASSWORD}@postgres:5432/homunculus
      JWT_SECRET: ${JWT_SECRET}
      TENANTS: ${TENANT_TOKEN}:HOSP1
      SEED_ADMIN_EMAIL: ${SEED_ADMIN_EMAIL}
      SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD}
      SEED_ADMIN_NAME: ${SEED_ADMIN_NAME}
      TZ: ${TZ:-Europe/Istanbul}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s

  web:
    build:
      context: ../..
      dockerfile: deploy/local/web/Dockerfile
    container_name: homunculus-web
    restart: unless-stopped
    ports:
      - "${WEB_LISTEN_ADDR:-0.0.0.0}:80:80"
    depends_on:
      - api

  bridge:
    image: ghcr.io/asbadef/homunculus-bridge:latest
    container_name: homunculus-bridge
    restart: unless-stopped
    ports:
      # Bound to the device-facing interface, never 0.0.0.0: MLLP carries patient data in plain
      # text with no authentication.
      - "${LISTEN_ADDR}:2575:2575"
    volumes:
      # Store-and-forward buffer. MUST persist: it holds observations the API has not acknowledged
      # yet, and a restart would otherwise discard them. It holds patient data in transit.
      - bridge-data:/data
      - ./site-mapping.json:/app/site-mapping.json:ro
    environment:
      TZ: ${TZ:-Europe/Istanbul}
    command:
      - scripts/run_bridge.py
      - --db
      - /data/bridge.db
      - --mapping
      - /app/site-mapping.json
      - --cloud-url
      - http://api:8000
      - --token
      - ${TENANT_TOKEN}
    depends_on:
      - api
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

volumes:
  pgdata:
  bridge-data:
```

- [ ] **Step 2: Validate it parses and the variables resolve**

Run:
```bash
cd deploy/local && cp .env.example .env && docker compose config --quiet && echo "AYRISTIRMA: gecerli"; rm -f .env
```
Expected: `AYRISTIRMA: gecerli`

If `docker compose` is unavailable on the dev machine, run this step on the Ubuntu server after Task 9's checkout.

- [ ] **Step 3: Commit**

```bash
git add deploy/local/docker-compose.yml
git commit -m "feat(deploy): four-container on-prem stack"
```

---

### Task 7: Demonstration-data banner

The dashboard authenticates against the real backend but still draws patients, alerts and vitals from the simulation — `liveStore.js` replaces only the authentication actions. Serving it inside a hospital without saying so would show invented patients to a clinician who had just logged in with real credentials.

**Files:**
- Create: `dashboard/src/DemoDataBanner.jsx`
- Test: `dashboard/src/DemoDataBanner.test.jsx`
- Modify: `dashboard/src/main.jsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/DemoDataBanner.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoDataBanner } from "./DemoDataBanner.jsx";

describe("DemoDataBanner", () => {
  it("names the board as demonstration data", () => {
    render(<DemoDataBanner />);
    expect(screen.getByText(/ÖRNEK VERİ/)).toBeInTheDocument();
  });

  it("says it is not this server's live device feed", () => {
    render(<DemoDataBanner />);
    expect(screen.getByText(/canlı cihaz akışı değildir/i)).toBeInTheDocument();
  });

  it("offers no way to dismiss it", () => {
    // A clinician arriving mid-shift at a screen someone else opened must see it too, so a
    // dismissible notice is not good enough.
    const { container } = render(<DemoDataBanner />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByLabelText(/kapat/i)).toBeNull();
  });

  it("is announced to assistive technology", () => {
    render(<DemoDataBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run src/DemoDataBanner.test.jsx`
Expected: FAIL — cannot resolve `./DemoDataBanner.jsx`

- [ ] **Step 3: Write the component**

Create `dashboard/src/DemoDataBanner.jsx`:

```jsx
// The board still draws its patients, alerts and vitals from the simulation: liveStore.js replaces
// only the authentication actions. Inside a hospital, a clinician who has just logged in with real
// credentials will reasonably read whatever follows as real, so the screen has to say plainly that
// it is not.
//
// Deliberately not dismissible, and deliberately its own file: ClinicalDemo.jsx is already ~4000
// lines. Phase 2 wires the live data layer, and this component is removed with it.

export function DemoDataBanner() {
  return (
    <div
      role="status"
      className="w-full bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      <span className="font-bold tracking-wide">ÖRNEK VERİ</span>
      <span className="ml-2">
        Bu ekrandaki hastalar, ölçümler ve alarmlar gösterim amaçlıdır — bu sunucunun canlı cihaz
        akışı değildir.
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run src/DemoDataBanner.test.jsx`
Expected: PASS — 4 tests

- [ ] **Step 5: Mount it in the entry point**

In `dashboard/src/main.jsx`, add the import next to the other component imports:

```jsx
import { DemoDataBanner } from "./DemoDataBanner.jsx";
```

and replace the final render call:

```jsx
createRoot(document.getElementById("root")).render(pickRoot());
```

with:

```jsx
// The banner sits above whichever root is chosen: every mode currently draws its clinical content
// from the simulation, so every mode has to say so. Phase 2 removes it along with the simulation.
createRoot(document.getElementById("root")).render(
  <>
    <DemoDataBanner />
    {pickRoot()}
  </>,
);
```

- [ ] **Step 6: Run the whole frontend suite**

Run: `cd dashboard && npx vitest run`
Expected: all suites pass. If a snapshot or layout test fails because of the added element, update that test to expect the banner rather than removing the banner.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/DemoDataBanner.jsx dashboard/src/DemoDataBanner.test.jsx dashboard/src/main.jsx
git commit -m "feat(dashboard): say plainly that the board is demonstration data"
```

---

### Task 8: Operator runbook

**Files:**
- Create: `docs/EDGE-BRIDGE-LOCAL.md`

- [ ] **Step 1: Write the runbook**

````markdown
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
$EDITOR .env          # POSTGRES_PASSWORD, JWT_SECRET, TENANT_TOKEN, SEED_ADMIN_*, LISTEN_ADDR
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
````

- [ ] **Step 2: Commit**

```bash
git add docs/EDGE-BRIDGE-LOCAL.md
git commit -m "docs(deploy): on-prem runbook — bring-up, verification, backups"
```

---

### Task 9: Bring it up on the server and verify

This task runs **on the Ubuntu server**, not the dev machine.

- [ ] **Step 1: Push and check out**

On the dev machine:
```bash
git push origin HEAD:main
```

On the server:
```bash
sudo mkdir -p /opt/homunculus && cd /opt/homunculus
git clone https://github.com/asbadef/Homunculus-AI.git . || git pull
```

- [ ] **Step 2: Configure**

```bash
cd /opt/homunculus/deploy/local
cp .env.example .env && chmod 600 .env
$EDITOR .env
```

Set `POSTGRES_PASSWORD`, `JWT_SECRET`, `TENANT_TOKEN` and `SEED_ADMIN_PASSWORD` to values from
`openssl rand -base64 36`. Set `LISTEN_ADDR` and `WEB_LISTEN_ADDR` to `172.100.101.72`.

Create the mapping file:
```bash
cat > site-mapping.json <<'JSON'
{
  "MDC_ECG_HEART_RATE": "heart_rate",
  "MDC_PULS_OXIM_SAT_O2": "spo2",
  "MDC_PRESS_BLD_NONINV_MEAN": "map",
  "MDC_RESP_RATE": "resp_rate",
  "MDC_TEMP_BLD": "temperature"
}
JSON
```

- [ ] **Step 3: Start the stack**

```bash
docker compose up -d --build
docker compose ps
```
Expected: `postgres` and `api` show `healthy`; `web` and `bridge` show `running`.

If `api` restarts in a loop, read `docker compose logs api`. The two likely causes are a database
that was not ready (the healthcheck should prevent it) and a `SEED_ADMIN_EMAIL` the login API's
validation rejects — `.local` and `localhost` domains are refused.

- [ ] **Step 4: Verify the proxy path**

```bash
curl -s http://172.100.101.72/health
```
Expected: `{"status":"ok"}`

This proves nginx reaches the API. A 404 here means the location blocks in `nginx.conf` did not
match; an nginx welcome page means the dashboard build did not land in `/usr/share/nginx/html`.

- [ ] **Step 5: Drive data through the whole chain**

```bash
cd /opt/homunculus/deploy/local
source .env
docker compose exec bridge python scripts/hl7_simulator.py --host bridge --port 2575 --patients 1 --count 3
docker compose logs bridge | tail -5
```
Expected: `ACK=AA` per message, and a bridge status line with `gözlem` greater than zero.

`gözlem=0` with `mesaj` climbing means the codes did not map — check `site-mapping.json` against the
unmapped-code line in the log.

- [ ] **Step 6: Confirm the data is stored**

```bash
curl -s -H "Authorization: Bearer $TENANT_TOKEN" http://172.100.101.72/patients
docker compose exec postgres psql -U homunculus -d homunculus -c \
  "SELECT event_type, count(*) FROM audit GROUP BY event_type ORDER BY 2 DESC;"
```
Expected: the patient appears in `/patients`, and the audit table holds `ingest` rows (and, if the
scenario crossed a threshold, `alert` rows).

- [ ] **Step 7: Confirm SSE is not buffered**

```bash
curl -N "http://172.100.101.72/stream?token=$TENANT_TOKEN"
```
Expected: the command **stays open** and emits keepalive/event frames. If it hangs with no output
and then exits, `proxy_buffering off` is not in effect — check that the `/stream` location block is
being matched.

Stop it with Ctrl+C.

- [ ] **Step 8: Confirm the data survives a restart**

```bash
docker compose down
docker compose up -d
docker compose exec postgres psql -U homunculus -d homunculus -c "SELECT count(*) FROM audit;"
```
Expected: the same count as before the restart. This is what the `pgdata` volume is for; a zero
here means the volume is not being used and every restart is silently discarding the record.

- [ ] **Step 9: Take the first backup**

```bash
sudo mkdir -p /var/backups
docker compose exec -T postgres pg_dump -U homunculus homunculus \
  | gzip > "/var/backups/homunculus-$(date +%F-%H%M).sql.gz"
ls -lh /var/backups/
```
Expected: a non-empty `.sql.gz`. Schedule this before the pilot carries real data.

---

## Self-review notes

**Spec coverage.** Postgres local (Tasks 6, 9) · API container (Task 1) · same-origin nginx with SSE
settings (Tasks 3, 4, and verified in Task 9 Step 7) · bridge to `api` internally (Task 6) · env
template and gitignore (Task 5) · non-dismissible banner (Task 7) · runbook with `pg_dump` (Task 8)
· all six spec verification steps appear in Task 9.

**Not in this plan, by design.** The live dashboard board, the JWT-to-tenant auth bridge, WACP, TLS
on the local network, and migrating existing Supabase data — all Phase 2 or out of scope per the
spec.
