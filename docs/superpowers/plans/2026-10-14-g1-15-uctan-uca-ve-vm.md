# Group 1 · G1-15 — the end-to-end gate on this machine, then the VM deploy with the user — Gate Plan and Runbook

> **For agentic workers:** Part A is executable task by task (superpowers:executing-plans). Parts B and C are checklists for the user (or an agent driving Chrome for Part B), **never** for an agent alone on the VM. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Group 1 is code-complete (G1-01…G1-14, G1-16) on `feat/canli-tasarim` @ `667ea91`. G1-15 is the last item: prove the whole of it end to end on this machine (Part A: stack, suites, API refusals, and a rehearsal of the VM upgrade from the VM's own commit), walk it in a browser (Part B), and only then deploy it to the hospital VM **together with the user** (Part C), with what still needs a person or the hospital listed in Part D.

**Approach:** Nothing in this plan changes behaviour. Four small fix tasks (F1–F4) came out of the research and are listed with their gate impact; three of them are worth doing before the deploy. Everything below the fix tasks was **run while this was written** unless a line says "not run".

**Status (14.10).** F1–F3 are merged (`d1d0a74`, `835d739`, `86117d6`) and F4 is measured. **Part A ran as the gate of record at `86117d6`** and passed (see "Gate record" below); every Expected line in Part A now carries the gate's figure, with the research's figure at `667ea91` kept where it differs. **Part B, Part C and the items that need a person (Part D) are still open.** The user's decisions of 14.10: Part D 1 (roadmap decision 2) accepted — deploy now, Groups 2–4 bring the removed capabilities back; Part D 2 (roadmap decision 3) — MFA stays mandatory for all four groups.

**Inputs:**
- **Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — the G1-15 row (l. 130), "G1-15 deploy kapısı — AD açılmadan önce (F7)" (l. 185–279), "G1-15 okuması · Dalga 3B'nin beş metni" (l. 281–310), "G1-15 · (Dalga 3) Uçtan uca yürüyüş" (l. 312–357), "Hastaneden gerekenler" (l. 370–396), "Bu dal VM'ye çıkmaz" (l. 482–535), the G1-15 notes in "Dalga 0/1A/3/3B/G1-16'dan açık kalanlar", and "Kullanıcı kararları" 1–11. (Line numbers as of `667ea91`. After the gate's record: the row l. 130, "G1-15 kapısı — Part A sonucu" l. 182, the F7 gate l. 256, the five texts l. 352, the walk l. 383, "Hastaneden gerekenler" l. 441, "Bu dal VM'ye çıkmaz" l. 553, "Kullanıcı kararları" l. 1236.)
- **RBAC plan, "Deploy notes for the VM":** `docs/superpowers/plans/2026-09-23-rbac-groups-permissions.md` l. 7735–7823.
- **Runbook:** `docs/EDGE-BRIDGE-LOCAL.md` ("Backups", "Updating", "Sign-in limits", "Check against the real directory", "Clock").
- **VM facts:** `docs/VM-HOMUNCULUS-CHECK-2026-09-22.md`, `docs/INFINITY-PARAMETER-RECORDS.md` ("Production dağıtımı — 22 Eylül"), `deploy/infinity/README.md`, and the user's memory notes as summarised in the brief (hub `172.100.101.72`, worker `.74`, `sysadmin`, `/opt/homunculus`, web on 8080/8443, git bundle over SSH, releases + systemd drop-ins, temporary NOPASSWD sudo and `tcpdump` setcap to revoke).
- **AD questions:** `docs/active-directory-bt-sorulari.md` (unanswered).
- **House style:** `docs/superpowers/plans/2026-10-13-g1-16-eski-modlari-kaldir.md`.

---

## Read this before anything

**Gate record — Part A at `86117d6` (14.10).** Run from `/c/tmp/homunculus-g1`, never on the VM, synthetic data only.

| Step | Result at `86117d6` |
|---|---|
| A0 | tip `86117d6`, `git status` empty, no stack containers; config shows the three scratch sources on `127.0.0.1:18080/18443`, plus F1's `SCOPE_ENFORCE_UNASSIGNED` and F2's `BUILD_SHA` |
| A1 | both images built (from cache: API 13 s, web 11 s); with `BUILD_SHA=86117d6` the web image's `index` 146.74 / 48.02 kB gz, `Toast` 186.01 / 68.39, `LiveApp` 206.71 / 63.94, precache 20 (753.09 KiB); API healthy at `0011`; the four MFA groups; HTTP 200, HTTPS 200 |
| F2 check | the Docker-built `LiveApp-CRKoRz8Y.js` holds `"86117d6"` twice (top bar, Settings › Profile); no `onrender.com` |
| A2–A3 | 12 accounts / 11 groups / 4 TOTP; six beds as A3 expects (`yb` 01–03, `yyb` 04–05, `yatak-06` without identity; 03 critical) |
| A4 | **37 / 37** (the 28 below + 9 F1 checks); `scope_denied` 0; with the API stopped nginx answered **504 after 60 s**, not an immediate 502 (see A4 Step 2); board rehydrated to 6 |
| F1 check | an unassigned nurse sees 6 beds; with `SCOPE_ENFORCE_UNASSIGNED=1` in the env file and `up -d --no-build api`, her `/scope/me` is `('unassigned', False, [])` and her board **0**, the admin unchanged; with the line removed and the API recreated, `('unassigned', True)` and 6 again |
| A5 | findings 1 and 5 seen again; pre-flight STOP on the clash; skipping it restart-loops at `0008`; after the rename `PRE-FLIGHT OK`, `0011`, 14/14 local accounts flagged, groups from roles, board 6, nurse 403 → password change → 200, the fifteen prefixes JSON; rollback: old images on `0011` loop (`Can't locate revision identified by '0011'`), dump restore + old images → `0008`, board 6, the old password signs in (200), the new one does not (401) |
| A6 | 76 files / **1809 / 1809**; pinned 75 files / **1787 / 1787** (`routes.test.js` excluded; alone and pinned it fails only its 3 registry tests); build within budget (`index` 146.74 / 48.01 kB gz, precache 20, 753.04 KiB) |
| A7 | measured at this tip by the F1–F4 run, not re-run: **2304 passed, 8 skipped** on 3.12.13 **and** 3.14.5 (1001 · 871+6 · 432+2), `test_infinity_vm_pilot.py` excluded |
| A8 | not run (open; Part D 10) |
| A9 | containers (24 names), volumes (29), images (68), networks (10) and worktrees (4) identical to the A0 listing; `homunculus-test-pg` and `summa-*` untouched; only Docker's build cache grew (559 → 567 entries; not pruned, it is shared) |
| A10 | roadmap G1-15 row, "G1-15 kapısı — Part A sonucu", decisions 2 and 3 recorded |

The paragraphs below are the research run at `667ea91` (13.10), kept as written.

**The local stack builds and starts at HEAD `667ea91`.** `deploy/local` built both images (API 37 s, web 53 s), the API migrated an empty database to `0011`, seeded the administrator, and answered `/health` on HTTP and HTTPS. 28 API smoke checks passed. The machine was left as found: every container, volume, image and worktree this plan's research created was removed; only the scratch files under `/c/tmp/g115plan/` remain (A0 lists them).

**The VM upgrade was rehearsed here, from the VM's own commit.** A database built by `538ba54` (the VM's branch tip, schema `0008`, legacy roles, a synthetic ward) was upgraded to `667ea91` exactly as Part C will do it: backup, image tags, new build, the `0010` pre-flight, `up`, checks — and then **rolled back** from the dump. What it found decides several Part C steps:

1. **The VM's current API image cannot be rebuilt today.** `538ba54`'s `Dockerfile.api` installs unpinned; a build now gets SQLAlchemy 2.1.4 without `greenlet` and the API dies at import (the F6 failure). The rollback therefore **must** use the image the VM runs now, tagged before the build (C3) — never a rebuild of the old commit.
2. **Old images on an upgraded database do not start:** `FAILED: Can't locate revision identified by '0011'`, restart loop. The rollback is *dump restore + old images*, both, in that order (R).
3. **Skipping the `0010` pre-flight costs the ward its board.** With one case-clash e-mail the new API restart-looped at `0008` ("Migration 0010 changed nothing"; `0009` rolled back with it). The pre-flight (C8.2) caught the same clash before `up`; after a rename the restart loop healed itself and `0009 → 0011` applied.
4. **After the upgrade:** legacy roles became groups, **every** local account carried `must_change_password = true`, a nurse got 403 on `/patients` until she changed her password and 200 after, and the board came back with all six beds (rehydrated from the audit trail).
5. **The VM's current nginx (`538ba54`) answers `POST /clinical/...` with 405 and serves `/admin`, `/scope`, `/scores`, `/alarm-quality`, `/tenant` as `index.html`.** Roadmap user decision 1 asked whether clinical charting on the VM ever reached the engine: **on the committed nginx, it does not** (unless the VM's copy was edited by hand — C1 checks). The new build fixes it.

**The Infinity pilot needs nothing merged.** `538ba54` (the VM's `feat/infinity-production-integration`) and `2f3544a` (`origin/main`, which merged it) are both ancestors of `667ea91`: every commit of the pilot's branch is already on this one. Between `538ba54` and `HEAD`, `deploy/infinity/` is byte-identical; `api/infinity_research.py` only moved from roles to `require_permission("devices.manage")`; and the dashboard's `InfinityBeds.jsx` ("Cihaz & Veri Akışı") was deleted by G1-16 (target: Group 4). The pilot's hub and worker run as systemd units under `/opt/homunculus-infinity/` (releases + drop-ins), outside the Docker stack, and this deploy does not touch them. **What the pilot loses is the research window inside the clinical dashboard**, not the pilot: the hub's own page on 8766 stays, `/infinity-research/state` stays (now `devices.manage`: biomedical, platform_support, hospital_admin), and an account that holds only `devices.manage` (the Biyomedikal group) cannot enter the new UI at all (`NO_BOARD_ACCESS`, roadmap l. 554). That is user decision 2's question (Part D, 1). Two things only the VM can show are read in C1: whether its checkout holds commits or local edits beyond `538ba54` (on 22.09 its compose file differed from the repo's), and that the pilot's units are active before and after.

**Base figures** (research at `667ea91`; the gate at `86117d6`; the roadmap's own in the last column):

| What | Research, `667ea91` | Gate, `86117d6` | Roadmap |
|---|---|---|---|
| Dashboard suite | 75 files / **1804** tests, 15.6 s | 76 files / **1809** (+5: F2's `buildSha.test.js`), 26 s | 75 / 1804 (G1-16 end) |
| Dashboard suite, registry pinned empty | **1800 / 1804**: 3 failures are the registry's own tests (harness artefact, excluded), 1 is real (F3) | **1787 / 1787** with `routes.test.js` excluded (F3 fixed the real one) | not defined before |
| Build (`vite build`) | `index` 146.74 / 48.02 kB gz, `LiveApp` 206.66 / 63.90, `Toast` 186.01 / 68.39, precache **20** (753 KiB), no 500 kB warning | the same (`index` 48.01 kB gz), precache 20 (753.04 KiB) | 146.74 / 48.02, 206.66 / 63.90, 20 / ~753 |
| Backend, Python 3.12.13 (`/c/tmp/f7-py312/venv`) | **2301 passed, 8 skipped** (1001 · 868+6 · 432+2) | **2304 / 8** (1001 · 871+6 · 432+2; +3: F1's `test_local_compose_env.py`) | 2294 / 8 (Wave 3B; `9a62c0c`, `fde2fe8`, `a301c73` added tests after it) |
| Backend, Python 3.14.5 | **not measured** — the first third ran 6 h with no result and was killed (F4) | **2304 / 8** (F4's scratch venv) | 2298 / 6 |
| API smoke through nginx | **28 / 28** | **37 / 37** (28 + 9 F1) | — |

`tests/test_infinity_vm_pilot.py` is in no count (it hangs under load; Group 4).

---

## How this plan was checked, so you know what to trust

**Run:** the HEAD stack build and start; the seeds; the 28 smoke checks (twice, on two fresh databases; the first pass failed 5 checks on a bug in the smoke script itself — `GROUPS` is a bash builtin — fixed); API stop → nginx 502 → start → board rehydrated; the whole `538ba54 → 667ea91` rehearsal including the failure modes and the rollback; the dashboard suite plain and pinned; the build; the 3.12 backend suite in thirds against a throwaway Postgres.

**Not run:** a browser (no driver here; Part B is the user's or a Chrome agent's), a speaker, a Windows notification; the 3.14 backend suite (F4); the suite inside the API image (A8); `new_critical.sh` (B9's alarm source — it reuses yatak-03's tested inputs); anything on the VM (never).

**At the gate (`86117d6`, 14.10):** the 3.14 suite has been measured (F4, 2304 / 8); a browser, a speaker, a Windows notification, A8, `new_critical.sh` and the VM are still not run.

**Found by running, not visible by reading:**
- `SCOPE_ENFORCE_UNASSIGNED` is read by the engine (`scope/resolver.py:34`) but **not passed by `deploy/local/docker-compose.yml`** and absent from `.env.example`: on the VM, setting it in `.env` does nothing (F1).
- **The Docker-built dashboard says "version unknown".** `.dockerignore` drops `.git`, so `vite.config.js`'s `gitSha()` returns `""` and the bundle keeps only `shell.versionUnknown` (checked in the built `LiveApp-*.js`). The account menu's build SHA — added after 20.09 because nobody could tell which build the pilot ran — will not exist on the VM (F2).
- `rawKeys.test.jsx` › "the keys three screens share resolve on each screen that draws them" opens `/beds` and `/alarms` through the shell without stating its build (`onlyScreens`), so it fails with the registry pinned empty (F3).
- A workstation build (`npx vite build`) contains `onrender.com` (from `dashboard/.env.production`). Expected and known (RBAC deploy note 2): only the Docker build is shippable; its Dockerfile deletes the file and fails on the string.
- Locally, `docker compose up -d` **without service names** stops at the bridge/nce images (`ghcr.io/asbadef/homunculus-bridge:latest` is not pullable here) and leaves services half-recreated. Locally always name `postgres api web`.
- Locally nginx logs the Docker Desktop gateway (`172.25.0.1`) as the client. On the VM the same line decides whether the per-address limits mean anything (C11).

---

## Fix tasks found by the research (before Part A is the gate of record)

Each is small, its own commit on a branch off `feat/canli-tasarim` in a scratch worktree, test first; the gate then runs at that tip. None is required for the stack to start.

**State at the gate (14.10):** F1 merged `d1d0a74` (checked end to end in A4: the flag in the env file reaches the API and narrows an unassigned nurse's board, and goes again); F2 merged `835d739` (checked in A1 and A5: the Docker-built bundle carries the tip's SHA); F3 merged `86117d6` (A6's pinned run is fully green); F4 measured — 2304 / 8 on 3.14.5 as on 3.12.13.

| # | What | Files | Test | Before the deploy? |
|---|---|---|---|---|
| **F1** | Pass `SCOPE_ENFORCE_UNASSIGNED` to the API: `SCOPE_ENFORCE_UNASSIGNED: ${SCOPE_ENFORCE_UNASSIGNED:-}` in `api.environment`, a commented line with its meaning in `.env.example`, one sentence in `docs/EDGE-BRIDGE-LOCAL.md`. | `deploy/local/docker-compose.yml`, `deploy/local/.env.example`, runbook | A pytest that reads the compose file and requires every `os.getenv` name of `scope/resolver.py` and `auth/session_policy.py` among the API's environment keys (catches the next one too) | **Only if** the user turns enforcement on (Part D, 4). Off is the pilot's intended state, so not a blocker — but the runbook must not offer a switch that does nothing. |
| **F2** | The build SHA reaches a Docker build: `ARG BUILD_SHA` in `deploy/local/web/Dockerfile` exported to `npm run build`; `vite.config.js` `gitSha()` falls back to `process.env.BUILD_SHA`; compose `web.build.args: BUILD_SHA: ${BUILD_SHA:-}`. Deploy runs `BUILD_SHA=$(git rev-parse --short HEAD) docker compose build web`. | the three files | `devProxy.test.js`-style config test: the Dockerfile declares and passes `BUILD_SHA`; `gitSha` honours the variable when git is absent | **Recommended** (the user decides, Part D, 9). Without it C4/C11 record image IDs and the git SHA by hand. |
| **F3** | `rawKeys.test.jsx`'s shared-keys test states its build: `onlyScreens({ beds: BedsScreen, alarms: AlarmsScreen })` in that test (restore in `afterEach`). | `dashboard/src/live/rawKeys.test.jsx` | It passes plain and pinned (A6) | No (test-only); it makes A6's pinned run fully green. |
| **F4** | The 3.14 run. Build a scratch venv as Wave 3B did (`uv venv --python 3.14 /c/tmp/g115-py314; uv pip install --python /c/tmp/g115-py314/Scripts/python.exe -c constraints.txt -e ".[dev]"` from the worktree's `homunculus-engine`) and run A7's thirds with it. If the first third hangs again, run it file by file with `-v` to name the test. The main checkout's venv carries SQLAlchemy 2.0.51 (not `constraints.txt`'s 2.1.3) and is not ours to install into. | none (environment) | A7 on 3.14 | The roadmap's discipline is "both interpreters"; the image is 3.12, which passed. User decides whether 3.12 alone closes A7 (Part D, 10). |

---

# Part A — the local gate (English; runnable on this machine)

**Ground rules.** Never touch `/c/Users/User/Desktop/Project/Homunculus AI` (the 3.14 interpreter path below is read and run, never installed into; set `PYTHONDONTWRITEBYTECODE=1`). Never connect to the VM. `/c/tmp/homunculus-g1` is the reference worktree: run from it, commit nothing in it, leave `git status` empty. **Leave `homunculus-test-pg` (55432) and the `summa-*` containers alone**; the backend suite gets its own throwaway Postgres on 55433. Run every gate in the foreground; a Bash call times out at 10 minutes, so the backend suite runs in thirds and nothing else runs beside it. **No patient data, ever** (CLAUDE.md rule 6): the accounts and the ward below are synthetic; names are `TEST …`, beds `yatak-0N`, units `yb`/`yyb`.

Every compose call in this part uses the same prefix; set it in each Bash call (shell state does not survive):

```bash
cd /c/tmp/homunculus-g1
C="docker compose -p g115 -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
```

### A0 — Baseline and scratch

- [ ] **Step 1: the tree.**

```bash
git -C /c/tmp/homunculus-g1 log --oneline -1 ; git -C /c/tmp/homunculus-g1 status --short | wc -l
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web|bridge|nce)$|^g115' || echo "no stack containers"
```
Expected: `667ea91 docs(roadmap): G1-16 Task 10 is done; …` (or the F-tasks' tip — then every count below moves only by those tasks' own deltas), `0`, `no stack containers`. **Gate:** `86117d6 test(dashboard): the shared-keys test states the build it names`, `0`, `no stack containers`.

Before anything starts, list what the machine holds, so A9 can prove it is restored (the gate kept these in `/c/tmp/g115plan/a9/`):

```bash
mkdir -p /c/tmp/g115plan/a9 && cd /c/tmp/g115plan/a9
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | sort > before-containers.txt
docker volume ls -q | sort > before-volumes.txt
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | sort > before-images.txt
docker network ls --format '{{.Name}}' | sort > before-networks.txt
git -C /c/tmp/homunculus-g1 worktree list > before-worktrees.txt
```

- [ ] **Step 2: the scratch files** (kept in `/c/tmp/g115plan/` from the research; recreate any that is missing exactly as below).

| File | What |
|---|---|
| `stack/local.env` | synthetic `.env`: `POSTGRES_PASSWORD`/`JWT_SECRET`/`TENANT_TOKEN` = `openssl rand -hex 24/32/32`, `PHI_ENCRYPTION_KEY=$(openssl rand -base64 32 \| tr '+/' '-_')`, `TENANT_SLUG=demo-hastanesi`, `SEED_ADMIN_EMAIL=g115.admin@homunculus.health`, `SEED_ADMIN_PASSWORD=G115-Synthetic-Admin-1`, `SEED_ADMIN_NAME=G115 Sentetik Yonetici`, `LISTEN_ADDR=127.0.0.1`, `WEB_LISTEN_ADDR=127.0.0.1`, `WEB_PORT=18080`, `WEB_TLS_PORT=18443`, `TZ=Asia/Baku`, `NCE_SHARE_PATH=C:/tmp/g115plan/stack/nce`, `INFINITY_HUB_CA_HOST_PATH=C:/tmp/g115plan/stack/infinity-ca.pem` |
| `stack/compose.g115.yml` | override: every bind-mount source in scratch, so the worktree gains no `ldap-ca/`, `infinity-ca.pem/` or `bed-mapping.json` |
| `stack/bed-mapping.json` | two synthetic units: `YB^1^1..3` → `yb-01..03` (unit `yb`), `YYB^2^1..2` → `yyb-01..02` (unit `yyb`) |
| `stack/{ldap-ca/, nce/, infinity-ca.pem (empty), site-mapping.json ({})}` | mount sources |
| `seed.sh` | A3 (below, in full) |
| `smoke.sh` | A4: 28 checks + 9 F1 checks (listed in A4; `F1=0` skips the nine) |
| `preflight_0010.py` | A5 and C9 (in full in C9) |
| `pinned/{pin-empty.setup.js, vitest.pinned.config.js}` | A6 (in full in A6) |
| `new_critical.sh` | B9's alarm source |

`compose.g115.yml`:

```yaml
services:
  api:
    volumes:
      - C:/tmp/g115plan/stack/bed-mapping.json:/app/bed-mapping.json:ro
      - C:/tmp/g115plan/stack/infinity-ca.pem:/etc/homunculus/infinity-ca.pem:ro
      - C:/tmp/g115plan/stack/ldap-ca:/etc/homunculus/ldap-ca:ro
  bridge:
    volumes:
      - bridge-data:/data
      - C:/tmp/g115plan/stack/site-mapping.json:/app/site-mapping.json:ro
```

`$C config | grep -E "source:|published"` must show the three `C:/tmp/g115plan/stack/…` sources and `published: "18080"` / `"18443"` on `127.0.0.1`.

### A1 — Build and start the stack at HEAD

- [ ] **Step 1: build.**

```bash
$C build api 2>&1 | tail -2
BUILD_SHA=$(git rev-parse --short HEAD) $C build web 2>&1 | grep -E "index-.*\.js|LiveApp-.*\.js|Toast-.*\.js|precache|Built|ERROR"
```
Expected (measured): `Image g115-api Built` (≈ 40 s); `index-….js 146.74 kB │ gzip: 48.01 kB`, `Toast-….js 186.01 kB │ gzip: 68.39 kB`, `LiveApp-….js 206.68 kB │ gzip: 63.91 kB`, `precache  20 entries (753.07 KiB)`, `Image g115-web Built` (≈ 55 s). The image's own `onrender.com` guard passed (the build did not fail). **Gate (`BUILD_SHA=86117d6`, from the layer cache: 13 s and 11 s):** `index` 146.74 / 48.02, `Toast` 186.01 / 68.39, `LiveApp` 206.71 / 63.94, `precache  20 entries (753.09 KiB)`.

- [ ] **Step 1b: F2 — the bundle carries the commit.**

```bash
docker run --rm --entrypoint sh g115-web -c 'cd /usr/share/nginx/html/assets; grep -l "86117d6" *.js; grep -l onrender.com *.js || echo "no onrender"'
```
Expected (gate): `LiveApp-CRKoRz8Y.js` (it holds `const …="86117d6"` twice: the top bar's version line and Settings › Profile), `no onrender`. Replace `86117d6` with the SHA being gated.

- [ ] **Step 2: start — always name the three services.**

```bash
$C up -d postgres api web 2>&1 | tail -3
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' homunculus-api); [ "$s" = healthy ] && break; sleep 2; done; echo "api $s"
docker logs homunculus-api 2>&1 | grep -E "seeded|startup complete"
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "SELECT version_num FROM alembic_version;" -c "SELECT slug, mfa_required FROM groups ORDER BY slug;" -c "SELECT username, auth_source, must_change_password, totp_enabled FROM users;"
curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:18080/health ; curl -sk -o /dev/null -w "https %{http_code}\n" https://127.0.0.1:18443/health
```
Expected: `api healthy`; `seeded: tenant='demo-hastanesi' admin='g115.admin@homunculus.health'`, `Application startup complete.`; `0011`; eleven groups — `attending|t`, `auditor|f`, `biomedical|f`, `charge_nurse|f`, `hospital_admin|t`, `nurse|f`, `pharmacist|f`, `physician|f`, `platform_support|t`, `rapid_response|f`, `unit_physician|t`; `g115.admin@homunculus.health|local|t|f`; `http 200`, `https 200`.

**Gate A1:** both images build, the API is healthy at `0011`, the four MFA groups are the four the roadmap names, HTTP and HTTPS answer. **Passed at `86117d6`** — every line as expected, and the bundle carries the SHA.

### A2 — Synthetic tenant users, one per default group

- [ ] **Step 1.**

```bash
docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py 2>&1 | grep -E "homunculus.health|TOTP"
```
Expected: 12 accounts in 11 groups (`physician` holds two: `test.yardimci.hekim`, `test.nobetci.hekim`): `test.sorumlu.hekim` attending, `test.unite.hekimi` unit_physician, `test.sorumlu.hemsire` charge_nurse, `test.hemsire` nurse, `test.rrt` rapid_response, `test.yonetici` hospital_admin, `test.denetci` auditor, `test.destek` platform_support, `test.eczaci` pharmacist, `test.biyomedikal` biomedical — all `@homunculus.health`, password `G115-Sentetik-Parola-1` — and `⚠ İlk girişte TOTP kuracak hesaplar: test.sorumlu.hekim…, test.unite.hekimi…, test.yonetici…, test.destek…`. These are created after `0011` by the script, so **they are not flagged** for a password change; the seed administrator is.

### A3 — A synthetic ward

- [ ] **Step 1.** `seed.sh` (in full):

```bash
#!/usr/bin/env bash
# G1-15 Part A, step A3: a synthetic ward on the local stack. SYNTHETIC ONLY.
set -euo pipefail
B=${B:-http://127.0.0.1:18080}
ENVF=${ENVF:-/c/tmp/g115plan/stack/local.env}
TT=$(grep '^TENANT_TOKEN=' "$ENVF" | cut -d= -f2-)
ENGINE=/c/tmp/homunculus-g1/homunculus-engine
DEV_API="$B" DEV_TOKEN="$TT" python "$ENGINE/scripts/dev_seed_ward.py" | head -3
ident() {  # patient-id  bed-key  given
  docker exec homunculus-api python scripts/set_identity.py --patient-id "$1" --family TEST \
    --given "$3" --birth-date 1970-01-01 --sex unknown --bed "$2" \
    --cloud-url http://api:8000 --token "$TT" | tr '\n' ' '; echo
}
ident yatak-01 "YB^1^1"  Yatak01
ident yatak-02 "YB^1^2"  Yatak02
ident yatak-03 "YB^1^3"  Yatak03
ident yatak-04 "YYB^2^1" Yatak04
ident yatak-05 "YYB^2^2" Yatak05
# yatak-06 stays without an identity on purpose: a device-only card ("kimlik bekleniyor").
```
```bash
bash /c/tmp/g115plan/seed.sh
```
Expected: `Sentetik koğuş kuruldu — 6 yatak:` and five `Patient: ok Encounter: ok`. The board (tenant token) then holds six beds: `yatak-01` risk `none`, `yatak-02` high, `yatak-03` **critical** (news2, sepsis, antibiotic_due, under_resuscitated_sepsis, septic_shock), `yatak-04` high (unit `yyb`), `yatak-05` none (`yyb`), `yatak-06` high with no bed or unit. Note: the seeder writes `/clinical` with the **device token** — that still works (user decision 4 is open). **Gate:** exactly this (A2 too: 12 accounts, 11 groups, the four TOTP accounts); the units sit under each card's `identity` (`yb`: 01–03, `yyb`: 04–05).

### A4 — API smoke through nginx

- [ ] **Step 1: the 28 checks, and F1's nine.** `smoke.sh` needs a **fresh** stack after A2–A3 (it enrols the test admin's TOTP and assigns the nurse a unit; a second run on the same database fails those checks by design — reset with A9 Step 1's `down -v`, then A1 Step 2, A2, A3). It signs in six times, inside nginx's 10/min + 10 burst.

```bash
bash /c/tmp/g115plan/smoke.sh
```
Expected: `passed 28, failed 0` at `667ea91`; **`passed 37, failed 0` at the gate** (33 s). The checks, in order (F1's nine run between 13 and 14, while the nurse is still unassigned):

| # | Check | Expected |
|---|---|---|
| 1–2 | `/health` over HTTP and HTTPS | 200, 200 |
| 3–4 | `/admin/users`, `/scope/me` without a token | 401 JSON (proxied, not the SPA) |
| 5–6 | seed admin signs in | `requires_mfa` True, `password_change_required` True |
| 7–9 | `test.yonetici`: pending, not enrolled; pending token on `/admin/users`; after TOTP enrolment | (True, False); 403; 200 |
| 10–11 | **refusal 4** — auditor's `perms`; auditor `POST /ack` | `['audit.view', 'board.view']`; 403 |
| 12–13 | **`/scope/me`**: nurse before any assignment; admin | `('unassigned', True)`; `('role', True)` |
| F1·1 | **F1**, enforcement off: the nurse's board | 6 beds |
| F1·2–3 | a copy of `local.env` plus `SCOPE_ENFORCE_UNASSIGNED=1`, then `up -d --no-build api` (as the VM applies `.env`): the container's value; nginx reaches the recreated API | `1`; `/health` 200 (the API kept `172.25.0.3`; nginx resolves `api` only at start, so a new address would need `web` recreated too) |
| F1·4–6 | enforced: nurse `/scope/me`; nurse's board; admin `/scope/me` | `('unassigned', False, [])`; 0 beds; `('role', True)` |
| F1·7–9 | API recreated from the untouched `local.env`: the value; nurse `/scope/me`; nurse's board | empty; `('unassigned', True)`; 6 beds |
| 14 | admin's board | 6 beds |
| 15–17 | **CAS 1/3** `PUT /scope/{nurse}`: stale `expected_grants`; nurse still holds 0 grants; true expectation `[]` | 409; 0; `('assigned', ['yb'])` |
| 18–19 | nurse `/scope/me` agrees with the board; nurse's board | `('assigned', False, ['yb'])`; `['yatak-01','yatak-02','yatak-03']` |
| 20–21 | **CAS 2/3** `PATCH /admin/groups/{pharmacist}`: stale; true (no change) | 409; 200 |
| 22–24 | **CAS 3/3** `PUT /admin/users/{nurse}/groups`: stale; true; the 409's `detail` | 409; 200; `Kayıt aynı anda değiştirildi; lütfen tekrar deneyin` |
| 25 | **the unlock answer** on a local account | `(True, False, 3, 3)` — ok, nothing granted |
| 26–27 | `/admin/ldap/status`; `POST /admin/ldap/test` with LDAP off | `configured` False; 409 |
| 28 | `/stream?ticket=` through nginx | `200 text/event-stream; charset=utf-8`, held open (curl exit 28 at 3 s) |

- [ ] **Step 2: refusal 3's server half, and the board surviving a restart.**

```bash
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "SELECT count(*) FROM audit WHERE event_type = 'scope_denied';"
docker stop homunculus-api >/dev/null; curl -s -m 100 -o /dev/null -w "patients, API stopped: %{http_code} after %{time_total} s\n" http://127.0.0.1:18080/patients -H "Authorization: Bearer x"
docker start homunculus-api >/dev/null; for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy ] && break; sleep 2; done
TT=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-); curl -s http://127.0.0.1:18080/patients -H "Authorization: Bearer $TT" | python -c "import json,sys; print('rehydrated', len(json.load(sys.stdin)['patients']))"
```
Expected: `0` (re-run after B4.3: still `0`); `patients, API stopped: 502`; `rehydrated 6`. **Gate:** `0`; **`504 after 60.08 s`** (twice: a 10 s cap gave `000`) — nginx's log reads `upstream timed out (110: Operation timed out) while connecting to upstream … "http://172.25.0.3:8000/patients"`: the stopped container's address no longer refuses, it times out after nginx's default 60 s `proxy_connect_timeout`; `rehydrated 6`. Either answer is an error rather than an empty board; the difference matters to B4.1 — with the API down each request hangs about a minute before it fails, so B4.1 notes how long the strip takes to appear.

**Gate A4:** 28/28 (37/37 with F1), no `scope_denied` row, an error (502, or 504 after 60 s) while the API is down, six beds after the restart. **Passed at `86117d6`.**

### A5 — Rehearse the VM upgrade from the VM's commit (Part C, locally)

Stop the HEAD stack first (`$C down -v`): the container names are fixed. Use a second project, `g115vm`.

- [ ] **Step 1: the VM's state.** A detached worktree at `538ba54` and its images; its API image needs `greenlet` added to start at all (finding 1 — the VM's real image was built before SQLAlchemy 2.1 and has it).

```bash
git -C /c/tmp/homunculus-g1 worktree add --detach /c/tmp/g115plan/wt-vm 538ba54
cd /c/tmp/g115plan/wt-vm
V="docker compose -p g115vm -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$V build api web 2>&1 | grep -E "Built|index-.*\.js"
mkdir -p /c/tmp/g115plan/vmimg && printf 'FROM g115vm-api\nUSER root\nRUN pip install --no-cache-dir greenlet==3.5.6\nUSER homunculus\n' > /c/tmp/g115plan/vmimg/Dockerfile
docker build -q -t g115vm-api /c/tmp/g115plan/vmimg
$V up -d --no-build postgres api web
```
Expected: both built (`index-….js 690.30 kB │ gzip: 214.09 kB` — the old single bundle); without the patch the API log ends in `ImportError: The SQLAlchemy asyncio module requires that the Python 'greenlet' library is installed`; with it `alembic_version` = `0008`. **Gate:** built from the layer cache in 15 s (so no size lines; the image holds the single `index-Dm3HplJd.js`, 716,903 bytes); the unpatched image has `sqlalchemy 2.1.4` and no `greenlet` (finding 1 again); patched `greenlet 3.5.6`; API healthy at `0008`.

- [ ] **Step 2: seed the old schema.** `seed_test_users.py` (A2's command; 12 legacy-role accounts) and the ward **directly against the API** — the old nginx refuses `POST /clinical` with **405** (finding 5):

```bash
TT=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-)
docker exec -e DEV_API=http://127.0.0.1:8000 -e DEV_TOKEN=$TT homunculus-api python scripts/dev_seed_ward.py | head -1
```
then A3's five `ident` lines; add one synthetic clash for the pre-flight:
```bash
docker exec homunculus-postgres psql -U homunculus -d homunculus -c "INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, is_active, is_platform_support, created_at, updated_at) SELECT gen_random_uuid(), 'TEST.Eczaci@homunculus.health', 'TEST Eczaci (kopya)', hashed_password, false, true, false, now(), now() FROM users WHERE email='test.eczaci@homunculus.health';"
```
Expected: board 6; `INSERT 0 1`. **Gate:** 12 accounts, board 6, `INSERT 0 1`; and finding 5 again through the old nginx — `POST /clinical/x` → `405 text/html`, `/admin/users`, `/scope/me`, `/scores/sofa/x`, `/alarm-quality`, `/tenant/units` → `200 text/html` (the SPA).

- [ ] **Step 3: C2–C3 — backup and tag.**

```bash
$V exec -T postgres pg_dump -U homunculus homunculus | gzip > /c/tmp/g115plan/backup-0008.sql.gz
docker tag $(docker inspect -f '{{.Image}}' homunculus-api) g115vm-api:rollback
docker tag $(docker inspect -f '{{.Image}}' homunculus-web) g115vm-web:rollback
```

- [ ] **Step 4: C7–C8 — build the new release under the same project; pre-flight with the new image.**

```bash
cd /c/tmp/homunculus-g1
N="docker compose -p g115vm -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
BUILD_SHA=$(git rev-parse --short HEAD) $N build api web 2>&1 | grep Built
$N run --rm --no-deps -T --entrypoint python api - < /c/tmp/g115plan/preflight_0010.py 2>&1 | tail -7
```
Expected: the running containers still on the old image IDs; `alembic_version: 0008`, `tenants: ['demo-hastanesi']`, `users: 14`, the `test.*` list, `0010 fold clashes: [['TEST.Eczaci@homunculus.health', 'test.eczaci@homunculus.health']]`, `PRE-FLIGHT STOP: 0010 would refuse these e-mails and the API would restart-loop`. **Gate:** exactly this (13 `test.*` rows, the clash among them), the containers still on `bd83ef58…` / `3730007b…`.

- [ ] **Step 5 (optional, observed once): what skipping the pre-flight does.** `$N up -d --no-build api`; after 25 s `status=restarting restarts≈8`, the log `RuntimeError: Migration 0010 cannot backfill usernames … Migration 0010 changed nothing.`, `alembic_version` still `0008`, `to_regclass('staff_scopes')` empty. **Gate (observed a second time):** `status=restarting restarts=8`, the same `RuntimeError`, `0008`, no `staff_scopes`.

- [ ] **Step 6: C9–C10 — fix, upgrade, check.** Run the pre-flight once more between the rename and `up`.

```bash
docker exec homunculus-postgres psql -U homunculus -d homunculus -c "UPDATE users SET email='test.eczaci.kopya@homunculus.health' WHERE email='TEST.Eczaci@homunculus.health';"
$N up -d --no-build postgres api web
```
Expected: the API heals itself; `0011`; every account `local|t` (flagged) with its legacy role as a group (`HOSPITAL_ADMIN`→`hospital_admin`, `ATTENDING`→`attending`, …; the clash copy has no membership, so no group); board **6**; `test.hemsire` signs in with `password_change_required: True`, `/patients` **403**, `POST /auth/password` → `/patients` **200**; every prefix of C10's list answers JSON (401/404/405), none `text/html`. (Name the services: a bare `up -d` stopped at the GHCR pull here and left `web` on the old image.) **Gate:** pre-flight `0010 fold clashes: none` … `PRE-FLIGHT OK`; API healthy on the new images (`d2a6337c…` / `d36e1ca6…`), `0011`, `14|14|14` (flagged | local | all), every account its group and the copy `(no group)`; board 6; nurse `True` → 403 → 200; all fifteen prefixes `application/json` (`/clinical/x` 405, `/tenant/units` 404, the rest 401 or 405); the new web image also carries `86117d6` (F2 in the deploy's own command).

- [ ] **Step 7: R — the rollback, both halves.**

```bash
docker tag g115vm-api:rollback g115vm-api:latest; docker tag g115vm-web:rollback g115vm-web:latest
$N up -d --no-build postgres api web     # old images on the 0011 database:
# expected: restart loop, "FAILED: Can't locate revision identified by '0011'"
$N stop api web
$N exec -T postgres psql -U homunculus -d postgres -c "DROP DATABASE homunculus WITH (FORCE);" -c "CREATE DATABASE homunculus OWNER homunculus;"
gunzip -c /c/tmp/g115plan/backup-0008.sql.gz | $N exec -T postgres psql -q -U homunculus -d homunculus -v ON_ERROR_STOP=1 >/dev/null
$N up -d --no-build postgres api web
```
Expected: `0008`; API healthy; board **6**; `test.hemsire` signs in with the **old** password (the change made after the backup is gone — so is every audit row written after it). **Gate:** old images on `0011`: `status=restarting restarts=7`, `FAILED: Can't locate revision identified by '0011'`; after the restore `0008`, 14 users (the clash copy back under its old spelling — the rename came after the dump), API healthy on `bd83ef58…` / `3730007b…`, board 6; the nurse's old password 200, the new one 401.

- [ ] **Step 8: clean up the rehearsal.** `$N down -v`; `docker rmi g115vm-api:latest g115vm-api:rollback g115vm-web:latest g115vm-web:rollback`; `git -C /c/tmp/homunculus-g1 worktree remove /c/tmp/g115plan/wt-vm`. **Also remove the images Step 7's re-tag left without a name** — this Docker uses the containerd image store, which hides them from `docker images` but keeps them: the new release's two (`docker inspect -f '{{.Image}}'` before Step 7, or the build log's `exporting manifest list sha256:…`; at the gate `d2a6337c05e6` and `d36e1ca6a4a5`), then check with `docker image inspect <id>` that each is gone.

**Gate A5:** pre-flight STOP on the clash, OK after the fix; `0008 → 0011` with every local account flagged and the board intact; the rollback lands on `0008` with the board intact. **Passed at `86117d6`.**

### A6 — The dashboard suite twice, and the build

- [ ] **Step 1: plain.**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  75 passed (75)`, `Tests  1804 passed (1804)` (≈ 16 s). **Gate:** `Test Files  76 passed (76)`, `Tests  1809 passed (1809)` (26 s; +1 file / +5 tests: F2's `buildSha.test.js`).

- [ ] **Step 2: the registry pinned empty** — every route but the settings fallback has no screen before every test; a test that states its build (`onlyScreens`/`stubScreens`) overrides it. The roadmap asked for this run (walk step 1); no earlier plan defined it, so it is defined here, outside the repo:

`/c/tmp/g115plan/pinned/pin-empty.setup.js`
```js
import { beforeEach } from "vitest";
import { ROUTES, stubScreens } from "../../homunculus-g1/dashboard/src/live/shell/routes.js";

beforeEach(() => {
  stubScreens(Object.fromEntries(ROUTES.filter((r) => r.id !== "settings").map((r) => [r.id, null])));
});
```
`/c/tmp/g115plan/pinned/vitest.pinned.config.js`
```js
import base from "../../homunculus-g1/dashboard/vite.config.js";

export default {
  ...base,
  root: "C:/tmp/homunculus-g1/dashboard",
  test: {
    ...base.test,
    setupFiles: ["./src/setupTests.js", "C:/tmp/g115plan/pinned/pin-empty.setup.js"],
  },
};
```
```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run --config /c/tmp/g115plan/pinned/vitest.pinned.config.js --exclude src/live/shell/routes.test.js 2>&1 | grep -E "FAIL|Test Files|Tests "
```
Expected at `667ea91`: `Tests  1 failed | 1781 passed (1782)`, 74 files — the one failure is `rawKeys.test.jsx` › "the keys three screens share resolve on each screen that draws them" (F3). **After F3: `1782 passed (1782)`.** `routes.test.js` (22 tests) is excluded on purpose: its three round-trip tests read the registry's current state as "the build's own", so any external pin breaks them (measured: 3 failures, `expected [ 'beds', 'alarms', 'patient', …(2) ] to deeply equal [ 'settings' ]`). **Gate:** `Test Files  75 passed (75)`, `Tests  1787 passed (1787)` (1782 + F2's 5) — no failure; `routes.test.js` run alone under the pin fails exactly its three round-trip tests ("takes a screen from the registry…", "puts every screen back at once…", "pins the registry to a known set…"), as expected.

- [ ] **Step 3: the build, against G1-16's budget — into scratch, never into the worktree's `dist/`.** A separate command from the suite.

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vite build --outDir /c/tmp/g115plan/dist --emptyOutDir 2>&1 | grep -E "\.(js|css) |built in|precache|larger than"
ls /c/tmp/g115plan/dist/assets | grep -cE "legacyRoots|browser-" ; ls /c/tmp/g115plan/dist | grep -c demo
```
Expected: `index-….js 146.74 kB │ gzip: 48.02 kB`, `LiveApp-….js 206.66 kB │ gzip: 63.90 kB`, `Toast-….js 186.01 kB │ gzip: 68.39 kB`, `DesignGallery-….js 8.61 kB`, CSS `28.94 kB` + `7.46 kB`, `precache  20 entries (753.04 KiB)`, no `larger than 500 kB`; `0`; `0`. This build contains `onrender.com` — workstation builds always do; only A1's image is shippable. **Gate:** `index` 146.74 / 48.01, `LiveApp` 206.66 / 63.90, `Toast` 186.01 / 68.39, `DesignGallery` 8.61, CSS 28.94 + 7.46, `precache  20 entries (753.04 KiB)`, no warning; `0`; `0`; the worktree's `git status` stays empty. (A1's Docker `LiveApp` is 206.71 kB: a separate minification — different short names — without `.env.production`; not a budget question.)

**Gate A6:** 1804/1804; pinned 1781/1782 now (1782/1782 after F3); the build within budget. **Passed at `86117d6`: 1809/1809; pinned 1787/1787; the build within budget.**

### A7 — The backend suites, in thirds, on both interpreters

- [ ] **Step 1: a throwaway test database** (not `homunculus-test-pg`).

```bash
docker run -d --name g115-test-pg -e POSTGRES_USER=homunculus -e POSTGRES_PASSWORD=homunculus -e POSTGRES_DB=homunculus_test_g115 -p 127.0.0.1:55433:5432 postgres:16
for i in $(seq 1 30); do docker exec g115-test-pg pg_isready -U homunculus -d homunculus_test_g115 >/dev/null 2>&1 && break; sleep 1; done
```

- [ ] **Step 2: Python 3.12.13 (the image's).** Each line is its own Bash call; every call repeats the four exports.

```bash
cd /c/tmp/homunculus-g1/homunculus-engine
export PYTHONPATH="$PWD/src" PYTHONDONTWRITEBYTECODE=1 TEST_DATABASE_URL="postgresql+asyncpg://homunculus:homunculus@127.0.0.1:55433/homunculus_test_g115"
PY=/c/tmp/f7-py312/venv/Scripts/python.exe
$PY -m pytest -q -p no:cacheprovider tests/rules tests/scoring tests/tenant tests/test_a*.py 2>&1 | tail -1
```
```bash
# same four lines, then:
$PY -m pytest -q -p no:cacheprovider $(ls tests/test_[b-l]*.py | grep -v infinity_vm_pilot) 2>&1 | tail -1
```
```bash
# same four lines, then:
$PY -m pytest -q -p no:cacheprovider tests/test_[m-z]*.py 2>&1 | tail -1
```
Expected (measured): `1001 passed` (9 min 05 s), `868 passed, 6 skipped` (1 min 25 s), `432 passed, 2 skipped` (2 min 47 s) — **2301 passed, 8 skipped**. `/c/tmp/f7-py312/venv` equals `constraints.txt` except `colorama` (present) and `uvloop` (absent): Windows. **Gate (`86117d6`, measured by the F1–F4 run at this tip and not re-run by the gate):** `1001` · `871 passed, 6 skipped` · `432 passed, 2 skipped` — **2304 passed, 8 skipped** (+3: F1's `test_local_compose_env.py`).

- [ ] **Step 3: Python 3.14.5.** The brief names `"/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe"`. With it, the **first third did not finish in 6 hours** (no output; killed). **Not measured.** Do F4 first and run the three thirds with `/c/tmp/g115-py314/Scripts/python.exe`, one after the other, never beside the 3.12 run (they share the database; `conftest.py` holds an advisory lock). Roadmap figure to compare: 2298 passed / 6 skipped at Wave 3B, plus whatever `9a62c0c`/`fde2fe8`/`a301c73` added (+7 on 3.12). **Gate (F4, `/c/tmp/g115-py314`, Python 3.14.5, measured at `86117d6` by the F1–F4 run):** the same thirds, **2304 passed, 8 skipped** — 3.14 now agrees with 3.12.

- [ ] **Step 4: the throwaway database goes, with its anonymous volume.**

```bash
docker rm -f -v g115-test-pg
```

**Gate A7:** 2301 / 8 on 3.12; the 3.14 figure recorded (or the user's decision that 3.12 closes it, Part D 10). **At `86117d6`: 2304 / 8 on 3.12.13 and on 3.14.5.**

### A8 — The F7 item "the suite inside the built API image" (not run; still not run at the gate)

The roadmap's F7 gate wants the backend suite run **inside** the API image (3.12 + `constraints.txt`). It was not run while writing. The honest shape, if the user wants more than A7 Step 2: `docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -e TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@host.docker.internal:55433/homunculus_test_g115 -v C:/tmp/homunculus-g1:/repo:ro -w /repo/homunculus-engine --entrypoint sh g115-api -c 'pip install -q --user -c constraints.txt pytest pytest-asyncio httpx && PYTHONPATH=/repo/homunculus-engine/src python -m pytest -q -p no:cacheprovider tests/test_[m-z]*.py'` — the whole repo mounted, because several tests read files outside `tests/` (`nginx.conf`, the dashboard). Expect the subprocess and PowerShell tests to differ from Windows. Record what it prints; until then A7 Step 2 stands in for it (Part D, 10).

### A9 — Leave the machine as found

- [ ] **Step 1.**

```bash
cd /c/tmp/homunculus-g1 && $C down -v
docker rmi g115-api:latest g115-web:latest
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$|^g115' || echo "clean"
docker volume ls -q | grep -E '^g115' || echo "no g115 volumes"
git -C /c/tmp/homunculus-g1 status --short | wc -l ; git -C /c/tmp/homunculus-g1 worktree list
```
Expected: `clean`, `no g115 volumes`, `0`, and the worktree list without `wt-vm`. `homunculus-test-pg` and `summa-*` untouched. (Keep the stack up instead if Part B follows at once.)

- [ ] **Step 2: prove it against A0's listing.**

```bash
cd /c/tmp/g115plan/a9
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | sort > after-containers.txt
docker volume ls -q | sort > after-volumes.txt
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | sort > after-images.txt
docker network ls --format '{{.Name}}' | sort > after-networks.txt
git -C /c/tmp/homunculus-g1 worktree list > after-worktrees.txt
for k in volumes images networks worktrees; do echo "$k: $(diff before-$k.txt after-$k.txt | grep -c '^[<>]') differing lines"; done
diff <(cut -f1 before-containers.txt) <(cut -f1 after-containers.txt) && echo "same container names"
```
Expected (gate): `clean`, `no g115 volumes`, no `g115` network, `0`; every listing `0 differing lines` (24 containers, 29 volumes, 68 images, 10 networks, 4 worktrees); `same container names`. Base images: `node:20-alpine` (the web build's first stage) is not in the image list before or after — the layer cache served the build, so there is nothing of it to remove. Docker's build cache grows (559 → 567 entries at the gate); it is shared with other projects, so it is not pruned.

### A10 — Record

- [ ] Write the gate record (counts, sizes, the 28 checks, the rehearsal's lines, F1–F4's state, Part B's table) into the roadmap's G1-15 row and a "G1-15 kapısı — sonuç" section; `amendments.md`/`deferred.md` as earlier waves did. The roadmap's backend line for this gate is **2301 / 8 (3.12)**. **Done at `86117d6` (14.10):** the roadmap's G1-15 row, "G1-15 kapısı — Part A sonucu (yerel kapı, 14.10, `86117d6`)" (backend **2304 / 8 on both interpreters**), the Dalgalar table, and user decisions 2 and 3; Part B's table stays empty — Part B, Part C and the "needs a person" items are open. This repository has no `amendments.md`/`deferred.md`; nothing went there.

---

# Part B — Tarayıcıda yürüyüş (kullanıcı ya da Chrome'u süren bir ajan için)

> **Kullanıcı kararı (14.10):** sentetik yatak verisine gerek yok; Part B yerel yığında değil,
> **deploy'dan sonra VM'de, monitörlerden gelen gerçek yataklarla, kullanıcıyla birlikte**
> yapılır (C10'un ardından). Yerel yığın ve sentetik koğuş kapatıldı ve silindi. Aşağıdaki
> satırlar aynen kullanılır; adres VM'nin adresi, hesaplar VM'deki gerçek hesaplardır (sentetik
> `test.*` hesaplarının yerine). Hasta verisi ekran görüntüsüne ya da depoya girmez — görüntü
> gerekirse hasta adı/kimliği görünmeyen bir bölümden alınır ya da yalnız gözlem yazılır.
> Bir satır ❌ çıkarsa düzeltme deploy'dan sonra yapılır (C-adımlarındaki geri dönüş R ayrı kalır).

**Nerede (ilk plan — yerel yığın):** yerel yığın, Part A'nın A1–A3'ü yapılmış ve `smoke.sh` **koşulmamış** taze bir veritabanı (smoke testi kapsam ve TOTP durumunu değiştirir; B4.3 için hemşirenin `yb` atamasını B5'te ekrandan yapacaksınız). Adres: **`https://127.0.0.1:18443`** (kendinden imzalı sertifika: bir kez "Gelişmiş → Devam et"). Kilit testleri için isterseniz `stack/local.env`'e `SCREEN_LOCK_IDLE_MINUTES=1` ekleyip `$C up -d --no-build api` (api yeniden kurulur).

**Hesaplar** (hepsi sentetik, parola `G115-Sentetik-Parola-1`, alan `@homunculus.health`): `test.yonetici` (Sistem Yöneticisi, ilk girişte TOTP — telefonda bir doğrulayıcı uygulama), `test.hemsire` (Hemşire), `test.denetci` (Denetçi), `test.sorumlu.hekim` (Sorumlu Hekim, TOTP), `test.biyomedikal` (yalnız `devices.manage`). Tohum yönetici `g115.admin@homunculus.health` / `G115-Synthetic-Admin-1`: TOTP + ilk girişte şifre değiştirme (göç `0011`'in davranışını görmek için).

**Kayıt kuralı:** her satırın "Sonuç" sütununa ✅ / ❌ ve bir cümle gözlem yazılır. **Gözlemi yazılmamış satır yapılmamış sayılır.** Ekran görüntüleri `/c/tmp/g115plan/walk/` altına, adı satır numarasıyla.

### B1 — Dört dil (az, tr, ru, en; varsayılan az)

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B1.1 | Giriş ekranını dört dilde açın (dil seçici) | Çevrilmemiş anahtar (`auth.something`) yok; seçim yenilemeden sonra kalıyor | |
| B1.2 | `test.yonetici` ile Yataklar ekranı, dört dilde | Anahtar sızıntısı yok; sayı çekimli sözcüğün içine düşmemiş; Rusça Kiril harfle; Rusçada (en uzun) kutudan taşan satır yok | |
| B1.3 | `yatak-03`'ü açın (hasta ekranı), dört dilde | Aynı dört bakış; vital çubuğu ve öneri kartı | |
| B1.4 | Alarmlar ekranı, dört dilde | "Yanıt bekliyor" / "Değerlendiriliyor" başlıkları; süre `d:ss` | |
| B1.5 | Yönetim — üç sekme, dört dilde | Sekme adları: İstifadəçilər / Rollar və səlahiyyətlər / Giriş mənbəyi (az) | |
| B1.6 | Hasta ekranındaki motorun İngilizce gerekçe blokları | Üstünde okuyanın dilinde "metinler İngilizcedir; çevrilmemiştir" satırı (az: "Mühərrikin mətnləri İngiliscədir; tərcümə olunmayıb."); blokların `lang="en"` olduğu (DevTools). **Hangi kural ailesinin metni ekranda — B10'a yazın** | |
| B1.7 | `test.hemsire` (B5.6'da `yb`'ye atandıktan sonra) panosunda Türkçe `scope_note` | Cümle Türkçe; altındaki "bu cümleyi sunucu yazdı" satırı **okuyanın dilinde** (az: "Bu cümləni server yazıb; dili türkcədir.") | |
| B1.8 | Kilit ekranı dört dilde | az: "Ekran kilidlənib", "Başqa istifadəçi ilə giriş" | |

### B2 — 390 px ve 1440 px, Gece ve Gün temasında (DevTools cihaz araç çubuğu)

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B2.1 | 390 px, iki tema: Yataklar, hasta, Alarmlar, Yönetim | Hiçbir ekranda yatay sayfa kaydırması yok | |
| B2.2 | 390 px Yataklar | Kartlar tek sütun; ekranın **kendi** birim seçicisi ve araması erişilebilir (üst çubuğun birim çipi orada gizli) | |
| B2.3 | 390 px Alarmlar | Satırlar düğmeleriyle okunur | |
| B2.4 | 390 px hasta ekranı | Vital ızgarası 1–2 sütun; SOFA, bazal, yükselme sayılarının her biri kendi etiketinin altında | |
| B2.5 | 390 px Yönetim çerçevesi | Başlık, üç sekme düğmesi, yükleniyor satırı sığar; sekme listesi iki ayrı liste gibi kırılmaz, kayar | |
| B2.6 | 1440 px, **Gün** teması, Yataklar | Kart şeritleri ve durum hapları `card` üzerinde ≥ 3:1 (DevTools renk seçicinin kontrast değeri) | |
| B2.7 | Yataklar başlığı, bağlanırken (sayfayı yenileyin) | Başlık "0 yatak" demiyor; sayı yalnız kartlar ekrandayken (`e4cdf15`) | |

### B3 — Yalnız klavye (fare yok; Windows Ekran Okuyucu ya da NVDA açık)

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B3.1 | Sayfa açılınca Tab | İlk durak atlama bağlantısı; Enter → odak `<main>`'de | |
| B3.2 | Menü → üst çubuk → pano denetimleri → bir kart; Enter | Hasta ekranı açılır | |
| B3.3 | Alarmlar'da bir alarm, Enter ile "Gördüm" | "Kaydediliyor…" duyurusu duyulur | |
| B3.4 | Hasta ekranında Enter ile şüpheli enfeksiyon işaretle | "İşaretleniyor…" duyurusu; işaretin denetim kaydına adla yazıldığı önceden söylenir | |
| B3.5 | Yönetim sekmeleri arasında ok tuşları | Sekme değişir, odak sekme listesinde | |
| B3.6 | Bütün yürüyüş boyunca | Yalnız fareyle ulaşılan bir şey yok; odak hiçbir zaman `<body>`'ye düşmüyor (DevTools: `document.activeElement`) | |

### B4 — Dört kasıtlı ret

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B4.1 | Yataklar açıkken `docker stop homunculus-api`; sonra `docker start homunculus-api` | Şerit "Sunucuya bağlantı yok — … hasta olmadığı anlamına GELMEZ" (dört dilde); hiçbir ekran "bekleyen yok" demez; API dönünce ekran kendiliğinden toparlanır. **Şeridin kaç saniyede çıktığı yazılır:** kapıda (A4 Adım 2) nginx API dururken 502'yi hemen değil, **60 s sonra 504** olarak verdi | |
| B4.2 | Yalnız akışı kesin: `docker restart homunculus-web` (ya da DevTools › Network › `/stream` engelle) | Veriler gösterilir ve "güncel olmayabilir" diye işaretlenir; zilde amber nokta; menüde nokta; hiçbir yerde "yok" | |
| B4.3 | `test.hemsire` (`yb` kapsamlı) olarak `#/patients/yatak-04` (`yyb`) ve `#/patients/boyle-biri-yok` | Tek ve dürüst ileti (yok ya da kapsam dışı; ikisi ayırt edilmez); sonra `docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "SELECT count(*) FROM audit WHERE event_type='scope_denied';"` → **0** | |
| B4.4 | `test.denetci` olarak Alarmlar | Onay ("Gördüm") düğmesi yok; `alerts.ack` yetkisini adlandıran satır var | |

### B5 — Yönetimin üç sekmesi

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B5.1 | 390 px, Yönetim | Sekme listesi kayar, iki satıra kırılmaz | |
| B5.2 | Kullanıcılar'da bir ret alın (kendi hesabınızı pasifleştirmeyi deneyin → 409), hemen Roller sekmesine geçin | Ret bildirimi sekme değişince ekranda kalıyor mu (hiçbir birim testi bunu gözlemiyor) | |
| B5.3 | Roller tablosu, 390 px, yana kaydırın | İlk sütun (grup adı) yerinde kalır | |
| B5.4 | Üyesi olan bir grubu (ör. Hemşire) silmeyi deneyin | Silinemez; nedeni sütun başlığına / hücreye sığar | |
| B5.5 | Giriş kaynağı sekmesi | "Kataloq konfiqurasiya olunmayıb…" notu (`source.notConfigured`); başka bölüm çizilmez | |
| B5.6 | `test.hemsire`'yi `yb` birimine atayın; aynı anda ikinci bir pencerede aynı kişinin kapsamını açıp kaydedin | Birinci kayıt ✓; ikinci pencere "hesap başka masada değiştirildi" der ve kapanır, liste ve sayaç yeniden okunur (409 yolu, `a301c73`) | |
| B5.7 | Kullanıcılar'da yeni yerel bir hesap açın (sentetik ad), o hesapla girin | İlk girişte şifre değiştirme zorunlu; değiştirince pano açılır | |

### B6 — Eski adresler (G1-16)

| # | Adres | Neye bakılır | Sonuç |
|---|---|---|---|
| B6.1 | `/?demo=1` | Canlı arayüzün giriş ekranı; adres çubuğu `/` | |
| B6.2 | `/#/demo` | Aynı; çubuk `/` | |
| B6.3 | `/?eski=1` | Aynı; çubuk `/` | |
| B6.4 | `/?mode=replay&scenario=septic_shock` | Aynı; çubuk `/` | |
| B6.5 | `/?board=1&token=x` | Aynı; çubuk `/` (token adreste ve geçmişte kalmaz) | |
| B6.6 | `/?tasarim=1` | Tasarım galerisi açılır | |

### B7 — Ayarlar sekmesi

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B7.1 | Ayarlar › "Səs və bildiriş", 390 ve 1440 px, iki tema | Taşma yok; her durum yazıyla söylenir (Hazırdır / Bir klik gözləyir / …) | |
| B7.2 | Ses açıkken sayfayı yenileyin, sonra bir iletişim kutusu açın | "Siqnal səsi gözləmədədir — açmaq üçün klikləyin" düğmesi görünür; iletişim kutusu açıkken **görünmez** | |
| B7.3 | Ayarlar › Profil ve hesap menüsü | Sürüm satırı: Docker derlemesinde "bilinmiyor" (F2 yapılmadıysa); F2'den sonra commit SHA'sı. **F2 birleşti (`835d739`):** A1'deki gibi `BUILD_SHA` ile derlenmiş imajda kapının SHA'sı (`86117d6` paketin içinde görüldü; ekranda bakılacak) | |

### B8 — Kilit ekranı

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B8.1 | Hesap menüsünden elle kilitleyin | Hasta bilgisi gizli ("Xəstə məlumatları gizlədilib"); birimlerdeki açık alarm sayısı | |
| B8.2 | Hareketsiz bekleyin (`SCREEN_LOCK_IDLE_MINUTES`) | Bir dakika önce uyarı; sonra kilit | |
| B8.3 | Yanlış şifre (yerel hesap) | "Şifrə səhvdir. Qalan cəhd: N"; sonunda oturum kapanır | |
| B8.4 | "Başqa istifadəçi ilə giriş" | Hemen çıkış, giriş ekranı | |
| B8.5 | Alarmlar'dan kilitleyin, açın; sonra hasta ekranından kilitleyin, açın | Birincide bıraktığı ekrana; ikincide ana ekrana döner (karar 17) | |

### B9 — Alarm sesi gerçek hoparlörde ve Windows bildirimi (bir servis bilgisayarında, Chrome)

Yeni bir kritik alarm üretmek için: `bash /c/tmp/g115plan/new_critical.sh 07` (sonraki denemelerde `08`, `09`…; yatak-03'ün kritik girdilerinin aynısı, onaysız).

| # | Adım | Neye bakılır | Sonuç |
|---|---|---|---|
| B9.1 | Ayarlar › "Səs və bildiriş" › ses Açıq › "Səsi yoxla" | Hoparlörden kritik düzen (10 vuruş, 5+5) | |
| B9.2 | `new_critical.sh 07`; sonra alarmı "Gördüm" ile onaylayın | Kritik alarm sık çalar; yüksek/orta daha seyrek; onaylanınca susar | |
| B9.3 | Alarm beklerken ekranı kilitleyin; sonra çıkış yapın | Kilitte ses sürer; çıkışta durur | |
| B9.4 | Sayfayı yenileyin | "Siqnal səsi gözləmədədir…" düğmesi; bir tıklamayla kalkar ve ses başlar | |
| B9.5 | Bildirime "İcazə ver"; başka bir pencereyi öne alın; `new_critical.sh 08` | Windows bildirimi yatak adıyla ("{yatak} — cavab gözləyən kritik siqnal"); kapatılana dek kalır. Kilitliyken gelen bildirim yatak adı **taşımaz** ("Cavab gözləyən kritik siqnal var…") | |
| B9.6 | Aynı yığını **loopback olmayan** bir adresten HTTP ile açın (yerelde `WEB_LISTEN_ADDR`'i bu PC'nin ağ adresine çekip `$C up -d --no-build web`) | Ekran "Brauzer bildirişləri yalnız təhlükəsiz (HTTPS) ünvanda işləyir." der. **Dikkat:** `http://127.0.0.1` tarayıcı için güvenli sayılır; orada bildirimin çalışması VM'nin HTTP adresinde çalışacağını göstermez | |

### B10 — Motorun gerekçe metinleri: Azerbaycanca konuşan bir klinisyenin okuması (kapı maddesi)

Motorun klinik metinleri (`clinical_reasoning`, `recommended_actions`, `confidence`, `chronic_context`, her `summary`) pilot için İngilizce kalıyor (Dalga 3, Karar 24); kullanıcının koşulu bu okumadır. B1.6'da ekranda görülen metinler buraya yazılır; klinisyen her birini okur.

| # | Kural ailesi | Ekranda görüldü mü (hangi yatak) | Metin (olduğu gibi) | Klinisyen: yazıldığı gibi anlaşıldı mı? (ad, tarih) |
|---|---|---|---|---|
| B10.1 | `news2` | | | |
| B10.2 | `septic_shock` (sepsis, antibiyotik saati, yetersiz resüsitasyon dahil) | | | |
| B10.3 | `acute_change` | (sentetik koğuşta görünmeyebilir — "görülmedi" yazın) | | |
| B10.4 | `patient_relative` (`chronic_context`, "Hastanın kendi normaline göre beklenen") | | | |

### B11 — Dalga 3B'nin beş metni: Azerbaycanca konuşan bir yöneticinin okuması (kapı maddesi)

Metinler roadmap'ten (l. 286–310) olduğu gibi. Son ikisi AD açılmadan ekranda görünmez; buradan okunur.

| # | Anahtar | az metni | Yazıldığı gibi anlaşıldı mı? (ad, tarih) |
|---|---|---|---|
| B11.1 | `admin.sub` | {hospital} · hər dəyişiklik audit jurnalına yazılır | |
| B11.2 | `roles.note` | Səlahiyyət yoxlanışı serverdə aparılır: bu cədvəl nəyin verildiyini göstərir, nəyin görünəcəyini deyil. Menyudan gizlətmək səlahiyyəti götürmək deyil. | |
| B11.3 | `source.notConfigured` | Kataloq konfiqurasiya olunmayıb. Korporativ hesabla giriş bağlıdır; yalnız lokal hesablar istifadə olunur. Bu, server konfiqurasiyasıdır (LDAP_URL) və buradan dəyişdirilə bilməz. | |
| B11.4 | `source.skipInvalidLogin` | istifadəçi adı lokal qaydaya uyğun deyil (a-z, 0-9 və . _ @ -); AD-dəki sAMAccountName-i Latın qarşılığı ilə yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e | |
| B11.5 | `source.mapPickHint` | Ən azı 2 simvol. Fərqləndirici ad (DN) siyahıdan seçilir, əl ilə yazılmır: əl ilə yazılan DN-in Türk/Azərbaycan hərfləri AD-dəki yazılışdan fərqlənərsə uyğunlaşma səssizcə işləməz. | |

### B12 — Kapanış

| # | Adım | Sonuç |
|---|---|---|
| B12.1 | `test.biyomedikal` ile girin | Giriş reddedilir / pano yok (`NO_BOARD_ACCESS`): biyomedikal grubunun yeni arayüzde ekranı yok (Part D, 1) | |
| B12.2 | Bütün ❌'ler bir listede: düzeltilecek (görev) ya da kabul (kullanıcı) | |
| B12.3 | Tablo roadmap'e işlenir (A10) | |

---

# Part C — VM deploy runbook'u (YALNIZ kullanıcıyla birlikte, sırayla)

**Kural:** Bu bölümdeki hiçbir komut kullanıcı yanında değilken koşulmaz; ajan VM'ye bağlanmaz. Part A geçmeden ve Part D'nin "deploy'dan önce" maddeleri yanıtlanmadan başlanmaz. Part B (kullanıcı kararı 14.10) C10'dan sonra VM'de, gerçek yataklarla yapılır. Hub (`172.100.101.72`) bu deploy'un tek hedefidir; worker (`.74`) yalnız C14'te (setcap). Infinity pilotunun "önce hub" kuralı Infinity sürümleri içindir; bu Docker deploy'u Infinity birimlerine dokunmaz.

Her adımda **Geri alma** yazılıdır. Tam geri dönüş: aşağıda **R**.

### C0 — Pencereden önce (bir gün önce)

- [ ] **C0.1 Servis bilgilendirilir** (sorumlu hemşire ve hekimler; metin Part D 15): yeni yatak, alarm ve hasta ekranları; şüpheli enfeksiyon artık hasta ekranından işaretleniyor ve klinisyenin adıyla denetim kaydına yazılıyor; **yerel hesabı olan herkes güncellemeden sonraki ilk girişte bugünkü şifresiyle girip yenisini belirler** (göç `0011` hepsini işaretler; AD hesapları yok); Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi ve Üretici Destek üyeleri ilk girişte telefonda bir doğrulayıcı (TOTP) kurar — telefon yanlarında olsun; ilk vardiyada şifre değişiklikleri ve kilit açmalar aynı adresin arkasında dakikada 30 ile sınırlı, "bir dakika sonra yeniden deneyin" diyebilir; mobil uygulamada işaretli hesap girişte "önce panodan şifrenizi belirleyin" der — mobil kullanıcılar şifrelerini önce panoda değiştirir ya da uygulamayı günceller; deploy sırasında pano birkaç dakika gelmez, monitörler ve köprü veriyi tamponlar. **Geri alma:** yok.
- [ ] **C0.2** Pencere zamanı: vardiya değişimi dışında, son 15 dakikada hatalı AD girişi olmayan bir an (AD kapalı olduğu için bugün doğal olarak sağlanır). İki kişi: kullanıcı + yürüten.
- [ ] **C0.3** Pakette olacaklar: bundle, `preflight_0010.py`, bu belge. Kapıdan geçen commit'in SHA'sı yazılır (`667ea91` ya da F1–F3'ten sonraki uç). **Part A kapısı `86117d6`'da geçti (14.10)**; Part B'den sonra uç değiştiyse Part A o uçta yeniden koşulur.

### C1 — Salt okunur ön kontrol (VM'de; hiçbir şey değişmez)

```bash
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72
mkdir -p ~/g115 && cd /opt/homunculus/deploy/local
git -C /opt/homunculus log -1 --oneline                      # beklenen: 538ba54 (ya da 22.09'daki 97f8bde ailesi)
git -C /opt/homunculus status --porcelain | tee ~/g115/vm-status.txt
git -C /opt/homunculus diff | tee ~/g115/vm-local.diff | wc -l   # yerel düzenlemeler (22.09: compose farklıydı)
git -C /opt/homunculus log --oneline 538ba54..HEAD 2>/dev/null | head   # VM'de 538ba54'ten sonra commit var mı
docker compose ps ; docker compose images | tee ~/g115/images-before.txt
for c in homunculus-api homunculus-web homunculus-bridge homunculus-nce homunculus-postgres; do echo "$c $(docker inspect -f '{{.Image}}' $c)"; done | tee ~/g115/image-ids-before.txt
df -h / /var/lib/docker ; free -h ; timedatectl | grep -E "synchronized|Time zone"
grep -oE '^[A-Z_]+=' .env | sort | tee ~/g115/env-keys-before.txt        # yalnız anahtarlar, değerler değil
docker exec homunculus-web nginx -T 2>/dev/null | grep -nE "location (=|~)|limit_req_zone" | tee ~/g115/nginx-before.txt
systemctl is-active homunculus-infinity-pilot-hub.service ; systemctl list-units 'homunculus-*' --no-legend
TT=$(grep '^TENANT_TOKEN=' .env | cut -d= -f2-); curl -s -H "Authorization: Bearer $TT" http://127.0.0.1:8080/patients | python3 -c "import json,sys; print('board beds:', len(json.load(sys.stdin)['patients']))" | tee ~/g115/board-before.txt
docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT version_num FROM alembic_version;" -c "SELECT slug FROM tenants;" -c "SELECT count(*) FROM users;" -c "SELECT email, is_active FROM users WHERE email ILIKE 'test.%';" -c "SELECT u.email, m.role FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.role IN ('HOSPITAL_ADMIN','ATTENDING','UNIT_PHYSICIAN','PLATFORM_SUPPORT') AND m.is_active;"
```
Beklenen: `0008`; tek kiracı (`demo-hastanesi` ya da sahanın adı — birden çoksa RBAC planı not 4'ün kiracılar arası sorguları önce koşulur); board sayısı kaydedildi (yalnız sayı yazdırılır — PHI ekrana dökülmez); diskte **en az 3 GiB** boş (22.09: 6,7 GiB); saat eşzamanlı; Infinity hub `active`. Son sorgu, ilk girişte TOTP kuracakların listesidir (C12). `vm-local.diff` boş değilse: her satır kullanıcıyla okunur — saha ayarı mı (yeni sürümde `.env`'e taşınır) yoksa unutulmuş bir yama mı; karar Part D 18. `nginx-before.txt`'te `/clinical` yoksa roadmap karar 1'in yanıtı "VM'de klinik giriş motora ulaşmadı"dır (provada da öyleydi). **Geri alma:** yok.

### C2 — Yedek (veritabanı ve site dosyaları), VM dışına

```bash
cd /opt/homunculus/deploy/local
sudo mkdir -p /var/backups && docker compose exec -T postgres pg_dump -U homunculus homunculus | gzip | sudo tee /var/backups/homunculus-pre-g115-$(date +%F-%H%M).sql.gz >/dev/null
sudo gunzip -t /var/backups/homunculus-pre-g115-*.sql.gz && ls -la /var/backups/homunculus-pre-g115-*
cp -a .env bed-mapping.json site-mapping.json nce-mapping.json docker-compose.yml ~/g115/ 2>/dev/null; cp -a web/nginx.conf ~/g115/nginx.conf.before
```
İş istasyonundan (kullanıcı): `scp -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72:/var/backups/homunculus-pre-g115-*.sql.gz <şifreli bir yer>` — döküm hasta verisidir: şifreli depoda tutulur, repoya ve sohbete asla. Döküm 0010'un geri alınamaz dönüşümünün tek geri dönüş yoludur (RBAC notu 3). **Geri alma:** yok.

### C3 — Çalışan imajları geri dönüş için etiketle (yeniden derlenemezler)

```bash
docker tag $(docker inspect -f '{{.Image}}' homunculus-api) homunculus-rollback/api:538ba54
docker tag $(docker inspect -f '{{.Image}}' homunculus-web) homunculus-rollback/web:538ba54
docker images | grep homunculus-rollback
```
Neden: `538ba54`'in API imajı bugün derlenirse SQLAlchemy 2.1'i `greenlet`'siz kurar ve açılmaz (provada görüldü). Bu iki etiket geri dönüşün tek imajlarıdır; deploy sonrası `docker image prune` **yapılmaz**. **Geri alma:** `docker rmi homunculus-rollback/api:538ba54 homunculus-rollback/web:538ba54` (yalnız her şey bittikten ve bir süre geçtikten sonra, kullanıcı kararıyla).

### C4 — Paketi hazırla ve taşı (git bundle, SSH)

İş istasyonunda:
```bash
cd /c/tmp/homunculus-g1
git bundle create /c/tmp/g115plan/g1-$(git rev-parse --short HEAD).bundle feat/canli-tasarim
git bundle verify /c/tmp/g115plan/g1-*.bundle && sha256sum /c/tmp/g115plan/g1-*.bundle /c/tmp/g115plan/preflight_0010.py
scp -i ~/.ssh/homunculus_vm /c/tmp/g115plan/g1-*.bundle /c/tmp/g115plan/preflight_0010.py sysadmin@172.100.101.72:/home/sysadmin/g115/
```
VM'de: `git -C /opt/homunculus bundle verify ~/g115/g1-*.bundle && sha256sum ~/g115/g1-*.bundle ~/g115/preflight_0010.py` — iki taraftaki sha256 aynı. **Geri alma:** dosyalar silinir.

### C5 — Kodu al (çalışan konteynerler değişmez)

```bash
cd /opt/homunculus
git fetch ~/g115/g1-*.bundle feat/canli-tasarim:feat/canli-tasarim
git stash push -m "pre-g115 local edits" || true        # yalnız C1'de vm-local.diff'i kullanıcıyla okuduktan sonra
git checkout feat/canli-tasarim && git log -1 --oneline   # beklenen: kapının SHA'sı
```
`.env`, `bed-mapping.json`, `site-mapping.json` git dışıdır ve yerinde kalır. Yerel düzenlemelerden saha ayarı olanlar `.env`'e taşınır (Part D 18); stash silinmez. **Geri alma:** `git checkout feat/infinity-production-integration && git stash pop` (çalışan konteynerler zaten eski imajlarda).

### C6 — `.env` ve ayarlar (yeni `.env.example`'a göre)

```bash
cd /opt/homunculus/deploy/local
diff <(grep -oE '^#?[A-Z_]+=' .env.example | tr -d '#' | sort -u) <(grep -oE '^[A-Z_]+=' .env | sort -u)
grep -c '^LDAP_ALLOW_INSECURE=' .env        # beklenen: 0
mkdir -p ldap-ca                              # compose bu dizini bağlar; yoksa Docker root sahipli boş dizin yaratır
docker compose config >/dev/null && echo "compose config OK"
```
Kontroller (RBAC notu 5 + Grup 1):
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `TENANT_TOKEN`, `PHI_ENCRYPTION_KEY` dolu — yeni compose boşu reddeder (`:?`). `JWT_SECRET` ≥ 32 karakter, boşluksuz; varsayılan değilse kalır (değiştirmek herkesi çıkarır — geçiş zaten çıkarır).
- `TENANT_TOKEN` kısa ya da bilinen bir yer tutucuysa (`demo-token`, `dev-token`, `pilot-token`, `change-me`): **iki taraf birlikte** döndürülür — bu compose'un `bridge` ve `nce` servisleri aynı `.env`'i okur, yani aynı `up` ikisini de değiştirir; VM dışında başka bir köprü varsa onun ayarı da aynı pencerede.
- `PHI_ENCRYPTION_KEY` **değişmez** (kayıtlı kimlikler onunla yazıldı).
- `SCREEN_LOCK_IDLE_MINUTES` (1–60, boş = 10) ve `SCREEN_LOCK_SIGNOUT_HOURS` (1–72, boş = 12): kullanıcının kararı (Part D 11); boş bırakmak varsayılanlardır.
- `SCOPE_ENFORCE_UNASSIGNED`: **bu compose onu API'ye geçirmiyor** (F1). Pilotun kararı kapalıysa hiçbir şey yapılmaz; açılacaksa F1 önce birleşir. **F1 birleşti (`d1d0a74`)** ve A4'te uçtan uca denendi: `.env`'e `SCOPE_ENFORCE_UNASSIGNED=1` yazılıp `docker compose up -d api` ile uygulanınca atanmamış bir hemşirenin panosu boşalır (düz `restart` eski ortamı tutar). Kapalı kalması pilotun kararıysa satır yazılmaz.
- `LDAP_*`: **boş kalır** — AD açılmaz (C15).
- `INFINITY_HUB_URL`, `INFINITY_VIEWER_TOKEN`, `INFINITY_HUB_CA_FILE`, `INFINITY_HUB_CA_HOST_PATH`: olduğu gibi kalır.
- MFA zorunlu gruplar `.env`'de değil veritabanında (`groups.mfa_required`): `0010` dört grubu işaretler.
- `SEED_ADMIN_*`: mevcut yönetici varken zararsız; `SEED_ADMIN_PASSWORD` boşsa tohum atlanır.

**Geri alma:** `cp ~/g115/.env .env`.

### C7 — Yeni imajları derle (eski konteynerler çalışmaya devam eder)

```bash
cd /opt/homunculus/deploy/local
BUILD_SHA=$(git -C /opt/homunculus rev-parse --short HEAD) docker compose build api web 2>&1 | grep -E "Built|ERROR|precache"
docker compose images ; docker inspect -f '{{.Name}} {{.Image}}' homunculus-api homunculus-web   # konteynerler hâlâ eski imajda
```
`BUILD_SHA` yalnız F2 birleştiyse işe yarar; yoksa zararsızdır ve sürüm ekranda "bilinmiyor" kalır — SHA ve imaj kimlikleri `~/g115/`'e elle yazılır. **F2 birleşti (`835d739`):** kapıda bu komutla derlenen web imajının paketi `86117d6`'yı taşıdı (A1, A5); imaj kimlikleri yine `~/g115/`'e yazılır. Derleme internete (PyPI, npm) çıkar; 22.09'da VM'de derlenmişti. İnternet yoksa: imajlar iş istasyonunda derlenip `docker save local-api local-web | gzip | ssh … 'gunzip | docker load'` ile taşınır (adlar `docker compose images` çıktısındakiyle aynı olmalı). Dashboard imajı `onrender.com` içerirse kendi derlemesini düşürür (Dockerfile). **Geri alma:** gerek yok — çalışan bir şey değişmedi.

### C8 — Test hesapları (roadmap karar 8) ve `0010` ön kontrolü (salt okunur, yeni imajla)

- [ ] **C8.1** C1'in `test.%` listesi boş değilse ve kullanıcı karar verdiyse, `0010`'dan **önce** pasifleştirilir (yoksa test yöneticisi `hospital_admin` olur ve ilk girişte TOTP'yi parolayı bilen kurar): `docker compose exec -T postgres psql -U homunculus -d homunculus -c "UPDATE users SET is_active = false WHERE email ILIKE 'test.%';"`. **Geri alma:** aynı sorgu `true` ile.
- [ ] **C8.2** Ön kontrol — `0010`'un kendi katlamasıyla (`İ/ı` dahil), yeni imajla, hiçbir şey yazmadan:

```bash
cd /opt/homunculus/deploy/local
docker compose run --rm --no-deps -T --entrypoint python api - < ~/g115/preflight_0010.py
```
`preflight_0010.py` (tam metin):
```python
import asyncio
import importlib.util
import os

import asyncpg

spec = importlib.util.spec_from_file_location(
    "m0010", "/app/alembic/versions/0010_groups_and_permissions.py")
m0010 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m0010)
fold, MAX_LOGIN = m0010._fold_login, m0010._MAX_LOGIN


async def main() -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        version = await conn.fetchval("SELECT version_num FROM alembic_version")
        tenants = [r["slug"] for r in await conn.fetch("SELECT slug FROM tenants ORDER BY slug")]
        users = [r["email"] for r in await conn.fetch("SELECT email FROM users")]
        tests = await conn.fetch(
            "SELECT email, is_active FROM users WHERE email ILIKE 'test.%' ORDER BY email")
        columns = {r["column_name"] for r in await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")}
    finally:
        await conn.close()

    print(f"alembic_version: {version}")
    print(f"tenants: {tenants}")
    print(f"users: {len(users)}")
    print(f"test.* accounts (user decision 8): {[(t['email'], t['is_active']) for t in tests]}")
    stop = []
    if version not in ("0008", "0009", "0010", "0011"):
        stop.append(f"unexpected schema version {version!r}")
    if len(tenants) != 1:
        stop.append(f"{len(tenants)} tenants: run the RBAC plan's cross-tenant queries first")
    if version in ("0008", "0009"):
        by_login: dict[str, list[str]] = {}
        for email in users:
            by_login.setdefault(fold(email), []).append(email)
        clashes = sorted(sorted(v) for v in by_login.values() if len(v) > 1)
        too_long = sorted(e for e in users if len(fold(e)) > MAX_LOGIN)
        blank = sorted(repr(e) for e in users if not fold(e))
        print(f"0010 fold clashes: {clashes or 'none'}")
        print(f"0010 too long (> {MAX_LOGIN}): {too_long or 'none'}")
        print(f"0010 blank: {blank or 'none'}")
        if clashes or too_long or blank:
            stop.append("0010 would refuse these e-mails and the API would restart-loop")
    else:
        print(f"0010 already applied (users.username present: {'username' in columns})")
    print("PRE-FLIGHT OK" if not stop else "PRE-FLIGHT STOP: " + "; ".join(stop))


asyncio.run(main())
```
Beklenen: `alembic_version: 0008`, tek kiracı, `0010 fold clashes: none`, `PRE-FLIGHT OK`. **STOP** ise: listelenen hesaplar hastaneyle birleştirilir ya da yeniden adlandırılır (Part D 21) ve C8.2 tekrarlanır; STOP varken **C9'a geçilmez** — atlanırsa API yeniden başlama döngüsüne girer ve pano gelmez (provada ölçüldü; göç hiçbir şey değiştirmez, `0008`'de kalır). **Geri alma:** yok (salt okunur).

### C9 — Geçiş: göçler `0009 → 0010 → 0011` (pencere)

```bash
cd /opt/homunculus/deploy/local
docker compose up -d --no-build api web
docker compose logs -f api      # "Application startup complete." görülünce Ctrl+C
docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT version_num FROM alembic_version;" -c "SELECT count(*) FILTER (WHERE must_change_password), count(*) FILTER (WHERE auth_source='local') FROM users;"
```
Yalnız `api` ve `web` yeniden kurulur; `postgres`, `bridge`, `nce` dokunulmaz (compose'ları değişmedi; köprü API yokken veriyi tamponlar). Beklenen: `0011`; iki sayı eşit (her yerel hesap işaretli). API 2 dakikada sağlıklı değilse ya da `restarting` görünüyorsa: `docker compose logs api | tail -40` okunur ve **R**'ye geçilir. **Geri alma:** R.

### C10 — VM'de duman testleri

```bash
cd /opt/homunculus/deploy/local
curl -s -o /dev/null -w "http %{http_code}\n" http://172.100.101.72:8080/health ; curl -sk -o /dev/null -w "https %{http_code}\n" https://172.100.101.72:8443/health
for p in admin/users scope/me clinical/x scores/sofa/x alarm-quality tenant/units admissions handovers shift-schedule break-glass alerts/x infinity-research/state auth/me audit view; do printf "%-24s %s\n" "/$p" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' http://172.100.101.72:8080/$p)"; done
docker exec homunculus-web nginx -T 2>/dev/null | grep -nE "location = /auth/(login|reauth|password)|limit_req_zone|location ~ \^/\(auth\|admin"
TT=$(grep '^TENANT_TOKEN=' .env | cut -d= -f2-); curl -s -H "Authorization: Bearer $TT" http://127.0.0.1:8080/patients | python3 -c "import json,sys; print('board beds:', len(json.load(sys.stdin)['patients']))"
docker compose logs --since 10m bridge | tail -5 ; docker compose logs --since 10m nce | tail -5
docker compose logs --since 10m web | tail -5        # istemci adresleri servis PC'leri mi, 172.x.0.1 mi?
systemctl is-active homunculus-infinity-pilot-hub.service
```
Beklenen: `http 200`, `https 200`; her önek JSON (401/404/405), **hiçbiri `text/html`**; `nginx -T`'de `/auth/reauth`, `/auth/password` tam eşleşmeleri ve `homunculus_reauth` bölgesi; board sayısı `board-before.txt` ile aynı; köprü ve NCE iletmeye devam ediyor; Infinity hub `active`. nginx günlüğünde yalnız `172.x.0.1` görünüyorsa adres başına giriş sınırları bütün servisi tek adres sayar — Part D 12'ye not. Sonra tarayıcıda (kullanıcı, `https://172.100.101.72:8443`):
- [ ] **C10.1** Mevcut yönetici girer: TOTP'yi QR'dan kurar (daha önce kurduysa kodu yazar), sonra `0011` şifre değiştirme; pano açılır; hesap menüsünde sürüm (F2 varsa SHA).
- [ ] **C10.2** Hemen **ikinci bir yerel `hospital_admin`** açılır ve o kişi kendi doğrulayıcısını kurar — her zaman en az iki yerel yönetici (RBAC notu 7).
- [ ] **C10.3** Yönetimin üç sekmesi **390 px'te** VM'nin kendi verisiyle açılır (hastanenin yöneticileri tablet kullanıyor; Dalga 3B kapısı).
- [ ] **C10.4** Bir hemşire hesabıyla: şifre değiştirme, pano, bir hasta, bir alarm; ses ve (HTTPS'te) bildirim izni.
- [ ] **C10.5** İlk kapsam atamasından **önce** `bed-mapping.json` keşif raporuyla karşılaştırılır (eşleşmeyen bir kart hiçbir birime düşmez). Kapsam ataması ilk hafta yapılmayabilir — `SCOPE_ENFORCE_UNASSIGNED` kapalıyken atanmamış herkes her şeyi görür.
- [ ] **C10.6** `docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT event_type, subject, count(*) FROM audit WHERE ts::timestamptz > now() - interval '1 hour' GROUP BY 1,2 ORDER BY 1,2;"` — `auth`, `admin`, `view` satırları görünür; `scope_denied` yok.

**Geri alma:** R (sorun klinik ekranlarda ve 1 saat içinde çözülemiyorsa).

### C11 — Zorunlu MFA kaydı (dört grup)

```bash
docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT g.name, u.username, u.totp_enabled FROM users u JOIN user_groups ug ON ug.user_id=u.id JOIN groups g ON g.id=ug.group_id WHERE g.mfa_required AND u.is_active ORDER BY 1,2;"
```
Listede `f` olan herkes (Sistem Yöneticisi, Sorumlu Hekim, Ünite Hekimi, Üretici Destek) ilk girişinde QR'ı okutur ya da elle anahtarı yazar; o güne dek panoya ulaşamaz (403 `mfa_required`). Mobil uygulamada TOTP adımı yok: bu dört grubun üyeleri mobili kullanamaz. Liste her gün `t`'ye dönene dek takip edilir. **Geri alma:** bir kişinin doğrulayıcısı kaybolursa başka bir yönetici Yönetim › Kullanıcılar'dan MFA'yı sıfırlar (kendi MFA'sını sıfırlayamaz).

### C12 — Infinity pilotu: uzlaştırma

- [ ] **C12.1** Kod: birleştirilecek bir şey yok — `538ba54` ve `origin/main` (`2f3544a`) bu dalın atası; `deploy/infinity/` aynı. VM'de C1'in `git log 538ba54..HEAD` çıktısı boşsa (VM'de ek commit yoksa) bu kesindir; doluysa o commit'ler kullanıcıyla okunur ve bu dala alınmadan deploy edilmez.
- [ ] **C12.2** Servisler: `systemctl is-active homunculus-infinity-pilot-hub.service` deploy'dan önce ve sonra `active`; worker'da (`.74`) `homunculus-infinity-pilot-worker.service` `active`; hub durumu `sudo /opt/homunculus-infinity/pilot/.venv/bin/python /home/sysadmin/activate_pilot.py hub --status` ile bağlı collector ve taze paket. Bu deploy release'lere ve drop-in'lere dokunmaz.
- [ ] **C12.3** Panodaki araştırma penceresi ("Cihaz & Veri Akışı") yeni arayüzde **yok** (G1-16; hedef Grup 4). `/infinity-research/state` token'sız 401 JSON (C10) — uç duruyor, yetki `devices.manage`. Yalnız Biyomedikal grubundaki bir hesap yeni arayüze **giremez**. Hub'ın 8766'daki kendi sayfası (viewer token) çalışmaya devam eder. Kullanıcının kararı: Part D 1.
- [ ] **C12.4** Ana çalışma ağacındaki commit'lenmemiş `?infinityTest=1` (`InfinityPreview`) hiçbir dalda yok; 22.09'da VM'de de yoktu. Bu deploy'la VM'ye gitmez.

**Geri alma:** gerek yok (Infinity'de hiçbir şey değişmedi).

### C13 — Geçici sudo ve setcap geri alınır (her iki VM)

Yalnız C1–C12 bittikten ve kullanıcı bundan sonra şifreli sudo ile çalışmayı kabul ettikten sonra:
```bash
# hub (.72) ve worker (.74) ayrı ayrı:
sudo grep -l NOPASSWD /etc/sudoers.d/* 2>/dev/null        # geçici dosya(lar)
sudo rm /etc/sudoers.d/<kullanıcıyla belirlenen dosya> && sudo visudo -c
getcap /usr/bin/tcpdump ; sudo setcap -r /usr/bin/tcpdump 2>/dev/null; getcap /usr/bin/tcpdump   # ikincisi boş
sudo -k ; sudo -l        # artık şifre sorar — oturumu kapatmadan doğrulayın
```
Beklenen: `visudo` "parsed OK"; `getcap` boş; `sudo -l` şifre ister. Kalıcı bir NOPASSWD kuralı (ör. Infinity betikleri için) gerekirse o, ayrı ve dar bir karar (Part D 19). **Geri alma:** kullanıcı yeniden verirse aynı dosya `visudo -f` ile.

### C14 — Kayıt

- [ ] Deploy kaydı: tarih, kapı SHA'sı, eski/yeni imaj kimlikleri (`~/g115/`), göç çıktısı, board sayıları, C10–C13 sonuçları; repo'da bir VM belgesine (`docs/VM-…`) ve roadmap'in G1-15 satırına. `docs/EDGE-BRIDGE-LOCAL.md` "Updating" bölümü `git pull` diyor — VM'de git kimliği yok; bundle yolu, ön kontrol ve imaj etiketleme oraya yazılır (belge işi, sonra).

### C15 — AD: hastane BT'si yanıtlayana dek kapalı kalır

Kapalı kalanlar: `LDAP_URL` ve bütün `LDAP_*` boş; Yönetim › Giriş kaynağı "Kataloq konfiqurasiya olunmayıb" der; AD'den içe aktarma ve grup eşlemesi yok. Açılmadan önce (roadmap F7 maddeleri, ayrı bir pencerede): `docs/active-directory-bt-sorulari.md`'nin 14 sorusunun yanıtı; VM'den DC'ye 636; CA `deploy/local/ldap-ca/ca.pem`; `tests/test_ldap_integration.py` VM'de **5 passed** (runbook, "Check against the real directory"); `GET /admin/ldap/status` `configured: true`, `last_test_ok: true`; bağlantı testinin beş ret nedeni gerçek DC'ye karşı kaydedilir; VM saati DC ile eşzamanlı; TOTP'li **en az iki** yerel `hospital_admin`; `.env`'de `LDAP_ALLOW_INSECURE` yok; karar 11 verilmiş; deploy/yeniden başlatma öncesi son 15 dakikada AD'ye özgü `login.fail`/`reauth.fail` yok (runbook sorgusu); başarısız girişin 0,5 s alt sınırı bir test AD hesabıyla ölçülür.

### R — Geri dönüş planı

**Ne zaman:** API C9'dan sonra 5 dakikada sağlıklı değilse; ya da klinik ekranlarda servisi durduran bir hata 1 saat içinde çözülemiyorsa (kullanıcı karar verir). **Bedeli:** yedekten sonra yazılan her şey kaybolur — alarm onayları, şifre değişiklikleri, TOTP kayıtları **ve denetim satırları**. Bu yüzden önce o hâlin dökümü alınır ve saklanır.

```bash
cd /opt/homunculus/deploy/local
docker compose exec -T postgres pg_dump -U homunculus homunculus | gzip | sudo tee /var/backups/homunculus-failed-g115-$(date +%F-%H%M).sql.gz >/dev/null   # kayıt için
docker compose stop api web
docker compose exec -T postgres psql -U homunculus -d postgres -c "DROP DATABASE homunculus WITH (FORCE);" -c "CREATE DATABASE homunculus OWNER homunculus;"
sudo gunzip -c /var/backups/homunculus-pre-g115-<C2'deki zaman>.sql.gz | docker compose exec -T postgres psql -q -U homunculus -d homunculus -v ON_ERROR_STOP=1 >/dev/null
git -C /opt/homunculus checkout feat/infinity-production-integration && git -C /opt/homunculus stash pop   # C5'te stash yapıldıysa
API_IMG=$(grep api ~/g115/images-before.txt | awk '{print $2":"$3}')   # ör. local-api:latest — C1'deki ad
WEB_IMG=$(grep web ~/g115/images-before.txt | awk '{print $2":"$3}')
docker tag homunculus-rollback/api:538ba54 "$API_IMG" ; docker tag homunculus-rollback/web:538ba54 "$WEB_IMG"
docker compose up -d --no-build api web
docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT version_num FROM alembic_version;"
```
Beklenen (provada ölçüldü): `0008`; API sağlıklı; board sayısı `board-before.txt` ile aynı; eski hesaplar eski şifreleriyle girer. **Yapılmaz:** eski imajları yeni veritabanında başlatmak (`Can't locate revision identified by '0011'`, döngü) ya da `538ba54`'i yeniden derlemek (`greenlet` yok, API açılmaz). Servise "eski sürüme dönüldü; bu saatlerde yapılan onaylar ve şifre değişiklikleri kayıtlı değil" denir. `.env` C6'da değiştiyse `cp ~/g115/.env .env`.

---

# Part D — Kullanıcının ve hastanenin kararları

| # | Konu | Kim karar verir | Ne zamana | Engeller mi? |
|---|---|---|---|---|
| 1 | **✅ KARAR 14.10: hepsi kabul, şimdi kurulur** (eksikler Grup 2–4'te gelir; bu sürede septik şok kuralı vazopresör bilgisi alamaz, hastaya göre uyarı bazal değersiz çalışır — duyuru metnine yazılır). Soru: **Grup 2–4'e kalan VM yetenekleri** (roadmap karar 2): elle vazopressör/sıvı girişi, hasta normali, kabul profili, duvar monitörü, RRT, ısı haritası, alarm kalitesi, denetim bütünlüğü ve **panodaki Infinity araştırma penceresi** deploy'la gider; Biyomedikal grubu yeni arayüze giremez. Kabul mü, bekleme mi? | Kullanıcı | Deploy'dan önce | **Evet** |
| 2 | **✅ KARAR 14.10: dört grup için de zorunlu kalır.** Soru: Zorunlu MFA: dört grup ilk girişte TOTP kurar (karar 3) — kabul mü, pilot için gevşetilsin mi? | Kullanıcı | Deploy'dan önce | **Evet** |
| 3 | Cihaz token'ı `/clinical`'a yazabiliyor (karar 4; yerel koğuş tohumu bunu kullandı) | Kullanıcı | Deploy'dan önce olması iyi | Hayır |
| 4 | Kapsamın erimi ve `SCOPE_ENFORCE_UNASSIGNED` (karar 5); açılacaksa önce F1 (**F1 birleşti, `d1d0a74`; A4'te denendi**) | Kullanıcı (+ servis sorumlusu) | İlk kapsam atamasından önce | Açılacaksa evet |
| 5 | `platform_support` canlı araştırma penceresini ve tam denetim izini görsün mü (karar 6) | Kullanıcı | Deploy'dan önce olması iyi | Hayır |
| 6 | NEWS2 sunumu ve `red_param` / hasta normali (karar 7, 9) | Kullanıcı + klinisyen (kasaya dayalı) | Grup 2 | Hayır |
| 7 | VM'deki `test.%` hesapları `0010`'dan önce pasifleştirilsin mi (karar 8; C8.1) | Kullanıcı | C8'den önce | Varsa evet |
| 8 | Giriş denemesi sınırı (karar 11, F7 ekleri) | Kullanıcı | AD açılmadan önce | AD için evet |
| 9 | F2 (sürüm SHA'sı Docker derlemesinde) deploy'dan önce yapılsın mı — **yapıldı: `835d739` birleşti, kapıda doğrulandı** | Kullanıcı | Kapıdan önce | Hayır (öneri: evet) |
| 10 | Backend kapısı: 3.12 (imajın sürümü) yeterli mi, yoksa F4 + 3.14 de mi; A8 (imaj içinde koşu) istenir mi — **F4 ölçüldü: 3.12 ve 3.14'te 2304 / 8; A8 hâlâ koşulmadı (açık)** | Kullanıcı | Kapı kaydından önce | Kapı kaydı için evet |
| 11 | Kilit süresi (`SCREEN_LOCK_IDLE_MINUTES`, 10) ve kilitli çıkış (`SCREEN_LOCK_SIGNOUT_HOURS`, 12) VM'de değişsin mi | Kullanıcı | C6 | Hayır |
| 12 | Servis PC'leri tek NAT/terminal sunucusu arkasında mı (giriş sınırı dakikada 10; şifre/kilit 30) | Hastane BT | Deploy'dan önce olması iyi | Hayır (ilk vardiyada 429 riski) |
| 13 | HTTPS: kendinden imzalı sertifikanın uyarısı her servis PC'sinde bir kez kabul edilir mi, yoksa hastane bir sertifika verir mi; servis PC'lerindeki Chrome sürümü (`color-mix`, `inert` için ≥ 111) | Hastane BT + kullanıcı | Deploy'dan önce | Bildirim için evet |
| 14 | **AD:** `docs/active-directory-bt-sorulari.md`'nin 14 sorusu (LDAPS adı ve CA, servis hesabı, base DN, rol grupları, ASCII adlar, `#`/`=`, kilit eşiği ≥ 7 ve sıfırlama ≤ 15 dk, PDC sayacı, NAT) | Hastane BT | AD'den önce | AD için evet; deploy için hayır |
| 15 | Servise duyuru metni ve zamanı (C0.1) | Kullanıcı + sorumlu hemşire | Pencereden 1 gün önce | **Evet** |
| 16 | Motorun gerekçe metinlerinin okunması (B10) | Azerbaycanca konuşan bir klinisyen | Deploy'dan önce | **Evet** |
| 17 | Dalga 3B'nin beş metninin okunması (B11) | Azerbaycanca konuşan bir yönetici | Deploy'dan önce | **Evet** |
| 18 | VM'deki yerel düzenlemeler (C1 `vm-local.diff`): `.env`'e taşı ya da bırak | Kullanıcı | C5'ten önce | Varsa evet |
| 19 | Geçici NOPASSWD sudo ve `tcpdump` setcap'in kaldırılması; kalıcı dar bir kural gerekir mi | Kullanıcı | C13 | Hayır |
| 20 | Mobil uygulama: işaretli hesaplar için güncelleme ya da önce panoda şifre değiştirme; MFA gruplarının mobili kullanamaması | Kullanıcı | Deploy'dan önce | Hayır |
| 21 | `0010` ön kontrolü STOP derse hangi hesap birleştirilir/yeniden adlandırılır | Kullanıcı + hastane | C8 | STOP varsa evet |
| 22 | Tabletlerde ana ekrana eklenmiş uygulamanın yeniden eklenmesi (artık doğruluk için gerekmiyor) | Kullanıcı | İsteğe bağlı | Hayır |
| 23 | Alarm ses düzeninin IEC 60601-1-8'e göre gözden geçirilmesi | Klinisyen / biyomedikal mühendis | Grup 2 | Hayır |
| 24 | Vercel'deki genel demo ve Render API'si (D1) | Kullanıcı | VM'den bağımsız | Hayır |
| 25 | Üst çubukta ses göstergesi | Kullanıcı / tasarımcı | Sonra | Hayır |

---

## Not in this plan

- Any code change: F1–F4 are specified, not made. No commit, no push. (Since then F1–F3 were made in their own commits and F4 was measured; the gate's record is one documentation commit, not pushed.)
- Connecting to, or running anything on, either VM. Part C is for the user's session.
- AD switched on (C15 lists what waits for the hospital).
- Groups 2–4 (what the deploy removes is Part D 1's decision, not this plan's work).

## Self-review

- **Brief coverage.** The roadmap's G1-15 items: the Wave 3 Task 24 walk → A6 (suite twice, pinned defined here), A6 Step 3 (build), B1–B4 (four languages, 390/1440 in two themes, keyboard, four refusals) and B10 (the reading list); the Wave 3B five texts → B11; the G1-16 browser items → B6, B7, B9; the F7 deploy gate → A7/A8, C15; the AD items → C15, D 8/14; the nginx `/admin` item → found fixed on this branch (A4 checks 3–4, A5 Step 6, C10), and found **broken on the VM's committed nginx** (A5 Step 2); the MFA enrolment → A4 7–9, C10.1, C11; `0010`/`0011` → A5, C8–C9; the nginx `reauth` zone check → C1, C10; the tablet icon → D 22; the ward told → C0.1; `bed-mapping.json` before scoping → C10.5; `view` audit volume → C10.6; nginx client addresses → C10; the 0.5 s floor → C15.
- **Every Expected line here was printed**, except those marked "not run": B9's alarm script, A7 on 3.14, A8. At the gate, A7 on 3.14 was measured too; B9's script, A8, Part B and Part C remain not run.
- **Gate items:** Part A 11 tasks (A0–A10), carrying 28 smoke checks (37 with F1's nine) and 4 backend/dashboard gates; Part B 64 rows; Part C 16 steps (C0–C15) plus R.
- **The machine:** everything this plan's research started was stopped and removed (`g115`, `g115vm`, `g115-test-pg` and its volume, the images, the `wt-vm` worktree); the reference worktree's `git status` is empty; `homunculus-test-pg` and `summa-*` were not touched.
