# Infinity · Aşama A — gölge görünüm: monitör değerleri panoda, "doğrulanmamış" şeridinde, hiçbir şeyi beslemeden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 13 Dräger Infinity Kappa monitors' values appear on the Homunculus clinical board, in a separate strip unmistakably labelled **"doğrulanmamış"** (unvalidated) in all four languages. Every clinician who can open the board sees it. The values feed **no rule, no NEWS2, no risk, no alert, no alarm, no sound, no notification, no escalation and no audit row**. A test gate proves it: for the same engine inputs, every clinical output is byte-identical with the stage `off` and `shadow`. Monitors whose bed is not confirmed (`.28`, `.34`, `.38`) are shown as "atanmamış cihaz" cards and never on a bed. The board can never look calm because the monitor feed died: silent monitors, a stopped forwarder, a stopped hub and a disconnected worker each say so.

**Architecture:** Three pieces, each switchable on its own.
1. **Hub (forwarder).** A thread inside the existing hub service reads the hub's own live research view every **5 s**. It sends at most one value per parameter per device per cycle, only values younger than **3 s**, never NBP, to a new API lane. It is turned on by a new systemd drop-in that only adds an `EnvironmentFile=`. The decoder, the transport and the worker do not change.
2. **API (shadow lane).** `POST /infinity-shadow/readings` is accepted only with a dedicated token that is **not** a `TENANTS` device token, so it can never reach `/ingest`. The readings go to a bounded, in-memory, expiring store, separate from the engine, the audit and the board stream. `GET /infinity-shadow/board` answers the board. The stage switch is `INFINITY_CLINICAL_STAGE`, default `off`. A versioned device→bed table, approved by the user, decides which monitor belongs to which bed.
3. **Dashboard.** A separate poller (`shadowStore`) reads the board endpoint every 5 s. It is never imported by the bell, the sound, the notifications, the lock screen or `boardStore`. The strip appears on bed monitor cards, on unassigned-device cards, on a patient's card and patient screen when the patient is explicitly bound to that bed, on a device screen for biomedical, and as a legend in Settings.

**Tech Stack:** Python 3.12 (FastAPI, stdlib `urllib`/`ssl` on the hub; nothing added to either venv), React 18 + Vitest (nothing added). The VMs run Python 3.12.3. Locally: `/c/tmp/f7-py312/venv/Scripts/python.exe` (3.12.13). **No package added or removed. No database migration.**

**Inputs:**
- **The design:** `/c/tmp/homunculus-plans/2026-10-14-infinity-klinik-pano-tasarim.md`, §2.3–2.4, §3, §4.1, §5 (Aşama A row), §6, §7 phase 2. The user's decisions of 14.10 supersede parts of it (next section).
- **Stage 0a:** plan `/c/tmp/homunculus-plans/2026-10-14-infinity-asama0a-tasima.md`; branch `feat/infinity-asama0a` @ `5bf7c1e`, worktree `/c/tmp/inf-0a`. It is deployed: hub and worker run `transport-a4dd159a85e9c0b9`.
- **The clinical side:** `feat/canli-tasarim` @ `52656da`, deployed on the hub VM (`/opt/homunculus` reads `52656daf`, 14.10).
- **House style:** `/c/tmp/homunculus-plans/2026-10-13-g1-16-eski-modlari-kaldir.md`, the 0a plan, and `docs/superpowers/plans/2026-10-14-g1-15-uctan-uca-ve-vm.md` Part C (Docker compose deploy).
- **Paths:** unless a path starts with `homunculus-engine/`, `dashboard/`, `deploy/` or `docs/`, it is under `homunculus-engine/src/homunculus/`.

---

## Read this before Task 1

### The user's decisions of 14.10 (binding)

1. **Our own decoder, not the Dräger Infinity Gateway.** The design's F3 branch, the Gateway questions and §6.5's "Gateway and the native decoder must not feed the engine together" are dropped. Stage A uses only the hub's record decoder (`edge/infinity_records.py`).
2. **Every clinician who can see the board sees Stage A.** The strip is not limited by a permission (design decision 3 proposed a permission-limited first period; the user chose otherwise). So:
   - the labelling must be unmistakable in az, tr, ru and en (az is the default);
   - the permission catalogue's "not observations, never read by the clinical pipeline" text (`auth/permissions.py:42-46`) is rewritten for the stage (Task 11);
   - whether biomedical, who today gets `NO_BOARD_ACCESS`, also sees it is decided below (**recommendation: yes, through a device-only screen, not through `board.view`**).
3. **The device→bed table is approved by the user.** Unresolved devices stay unassigned and appear only as "atanmamış cihaz" cards: `.28` (BED07 against BED12), `.34`, `.38`. The table is a versioned file. Approval is a step of this plan (Task 13), before anything is deployed that reads it.
4. **No synthetic data in verification.** Acceptance happens on the 13 real monitors, with the user. Unit tests keep the repo's small in-code fixtures (`test_infinity_records.record(...)`, documentation addresses `192.0.2.x`, the engine's own YAML scenarios). No captured data enters the repo.
5. **The user pastes every VM block.** The agent's production commands are blocked. The agent builds, fills every value into the block, and reads the output the user pastes back. That includes the `scp` of a release.
6. **No patient data anywhere.** No checker prints a physiological value; checkers print counts, ages and hashes only.

### What runs today (read 14.10, read-only)

**Hub `172.100.101.72`, 14.10 ~12:15 UTC:**
- `homunculus-infinity-pilot-hub` is `active` since 14.10 11:58:15 UTC. Its newest drop-in is `90-transport-0a-duzeltme.conf`, release `transport-a4dd159a85e9c0b9`, with flags `--capture-payload --unverified-live-research`.
- The unit file has `EnvironmentFile=/etc/homunculus-infinity-pilot/hub.env`, `User=homunculus-infinity-pilot`, `ProtectSystem=strict`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `MemoryMax=512M`. Outbound HTTPS from the hub process is allowed. The forwarder writes no file.
- `transport_check.py --window 60`, all criteria **KABUL**:
  - 3,905 live packets in 60 s, 100 % within 3 s, mean lag **276 ms**;
  - worker queue 17 rows, oldest 0.2 s;
  - 13/13 devices streaming;
  - hub CPU **8.4 %** of a core (ceiling 43 %).
- The 24 h watch of 0a runs until 15.10 12:01Z.
- Passwordless sudo on the hub still exists (temporary, 0a). It does not matter here: the user pastes every block.

**Clinical stack, same VM:**
- `/opt/homunculus` is at `52656daf`. It has four untracked `.env.bak*`/`site-mapping.json.bak*` files, and nothing else is changed.
- `.env` holds these keys: `POSTGRES_PASSWORD JWT_SECRET TENANT_TOKEN TENANT_SLUG SEED_ADMIN_* LISTEN_ADDR WEB_LISTEN_ADDR WEB_PORT TZ NCE_SHARE_PATH PHI_ENCRYPTION_KEY INFINITY_HUB_URL INFINITY_HUB_CA_FILE INFINITY_HUB_CA_HOST_PATH INFINITY_VIEWER_TOKEN`. The non-secret values are: `TENANT_SLUG=demo-hastanesi`, `WEB_LISTEN_ADDR=172.100.101.72`, `WEB_PORT=8080`, `TZ=Asia/Baku`, `INFINITY_HUB_URL=https://172.100.101.72:8766`. TLS uses the compose default **8443**.
- **`/opt/homunculus/deploy/local/bed-mapping.json` is a DIRECTORY**, not a file. Docker created it when the bind mount's source was missing (`deploy/local/docker-compose.yml`, the `api` volumes comment). The API treats it as "no table" (`tenant/bedmap.py`, `from_file` → `is_file()`). So **no patient card on the VM sits on a bed today**. This explains the design's "yatak eşleşmesi 0". It decides how Stage A looks on the VM: monitor values appear on **bed monitor cards**, not on patient cards (Decision 9).
- `sysadmin` is **not** in the `docker` group (`permission denied … docker.sock`). Every Docker command in the blocks uses `sudo`.
- **What could not be read.** Two reads were refused by this session's permission system as production reads, and were not attempted another way:
  - the database's units and beds (labels and ids, no patient data);
  - a per-device parameter-status listing from the hub (names only, no values).

  Task 13's block and Kabul K0 have the user run both, read-only.

### What this plan changes from the design

| Design says | This plan | Why |
|---|---|---|
| F2 "parallel with the F3 Gateway question" (§2.4, §8.1) | F2 only | User decision 1 |
| Stage A "first limited by a permission" (§5, §8.3) | every `board.view` holder; biomedical through a device screen | User decision 2 |
| "a separate Infinity **device token** in `TENANTS`" (§2.3, §5 rollback) | a **dedicated shadow token, not in `TENANTS`** | A `TENANTS` token is a device `Caller`. A device passes **every** permission check (`api/app.py:407-411`, `Caller.can`) and can `POST /ingest`, `/ack` and `/clinical`. A forwarder holding one could feed the engine. The shadow token opens one route and nothing else. |
| "the audit uses a separate event type" (§2.3 "Gölge yolu") | **no audit row at all** in Stage A | The brief: Stage A must not touch the audit. Any audit row grows the oldest-1,000,000-rows rehydration (`api/app.py:215`, `api/audit_postgres.py` `records()` `ORDER BY id ASC LIMIT`). The approval of the table is recorded in the table file and its commit instead (K2). |
| "every change of the device→bed table is written to the audit" (K2) | the table is a reviewed file in git, deployed with its sha256; the API logs and shows the version and sha | the same reason; Stage B can add an audit event once rehydration is fixed |
| "device episode cards" in phase 2 | **no episodes in Stage A** | Stage A keeps no history: a value older than 15 s is not shown and is deleted after 120 s. Two patients' data cannot meet on one card when the card holds only the last 15 s. Episodes come with attribution (phase 3 / Stage B). |
| thinning "per minute, clinician approves" (§2.3) | **5 s** cadence for display | The per-minute default is for values that would enter NEWS2 (an audit row and a rule run each). Stage A stores nothing durable, so 5 s costs nothing. The clinician's number belongs to Stage B, which feeds the engine. |
| F8 "decode on the worker" deferred to Aşama A (0a plan) | **not needed** | Hub CPU is 8.4 % with decoding on the hub. The forwarder adds one snapshot every 5 s. |
| a "verification under synthetic 13-device load" (§7) | none | User decision 4 |

### How this plan was checked, so you know what to trust

- **Read, with file and line:** the hub, live view, records decoder, runner and release builder at `5bf7c1e`; `api/app.py`, `api/board.py`, `api/infinity_research.py`, `api/rehydrate.py`, `api/audit_postgres.py`, `auth/permissions.py`, `tenant/bedmap.py`, `scope/rules.py`, `scope/resolver.py`, `api/patient_identity.py`; the compose file, `nginx.conf` and its route test; the dashboard's `BedsScreen`, `BedCard`, `PatientScreen`, `SettingsScreen`, `boardStore`, `BoardState`, `feedHealth`, `freshness`, `vitals`, `routes`, `LiveApp`, `sessionStore`, the i18n catalogue and its tests, and `liveAuth`.
- **Measured locally at `5bf7c1e` (14.10, foreground):**
  - the Infinity gate set (0a's 14 files) is **164 passed**;
  - the clinical gate set (28 files, listed in the ground rules) is **320 passed, 122 skipped**. The skips are the Postgres-backed tests, which skip without a database.
  - The dashboard suite was not run in this research. The G1-15 gate at `86117d6` was 76 files / 1,809 tests, and the 0a branch changed no dashboard file. Task 0 measures it.
- **Measured on the VM (read-only):** what the previous section lists.
- **NOT done:** no code in this plan was written or replayed. The 0a plan replayed every block. This one gives the safety-critical code in full (the gate test, the forwarder's thinning, the lane's validation) and specifies the rest precisely. Every test count below is a **plan**, marked `≈`. Task 0 and each task's gate record the real figures. No deploy, no file on either VM, no restart.

---

## The shape of Stage A

```text
 13 × Kappa ─UDP─▶ worker .74 (unchanged) ─HTTPS─▶ hub .72:8766 (journal, LiveResearchView: decoder, 3 s window)
                                                      │  snapshot() every 5 s, in-process thread (NEW, off unless drop-in 93)
                                                      ▼
                                         thin(): ≤1 value/parameter/device/5 s, age < 3 s, no NBP, no airway RESP,
                                                 decoder units verbatim, device by (source, group, port), no name
                                                      │ HTTPS POST, Bearer INFINITY_SHADOW_TOKEN (not a TENANTS token)
                                                      ▼
 nginx :8443 ──▶ API  POST /infinity-shadow/readings ── stage off → 409 · bad token → 401 · ≥1 s spacing else 429
                      │  validate (closed schema, units, integrity bounds, clock) → ShadowStore (memory, ≤100 devices,
                      │  latest value per parameter, deleted after 120 s). NEVER: engine.ingest, audit.append,
                      │  broadcaster.publish, notification hub, escalation, identity store writes, bed-map counters.
                      │
                      ├─ device→bed table (file, approved, hot-reloaded, fail closed)  ──┐
                      ├─ explicit bed binding (admitted identity + bed map, non-counting) ┤
                      ▼                                                                  ▼
                 GET /infinity-shadow/board  (board.view | devices.manage | device token; scope applied)
                      │  {stage, table, feed, beds[], unassigned[]}  — ages computed, values >15 s withheld
                      ▼
 Dashboard shadowStore (poll 5 s while a strip is on screen and the tab is visible; never on the lock screen)
      ├─ BedsScreen: monitor chip · "Monitörler — doğrulanmamış" section (bed monitor cards, unassigned cards)
      ├─ BedCard / PatientScreen: strip, only for a patient explicitly bound to that bed (none on the VM today)
      ├─ DevicesScreen (devices.manage: biomedical, platform_support, hospital_admin): every device, no patient
      └─ Settings › Sinyaller: legend (what it is, evidence per parameter, NBP, ages)

 /patients, /stream, /notifications, /alerts, /ack, /clinical, /audit, NEWS2, risk, bell, sound: UNCHANGED (Task 5 proves it)
```

---

## The stage switch

`INFINITY_CLINICAL_STAGE` in the API's environment. Compose passes it, `.env.example` explains it, and `tests/test_local_compose_env.py` pins both (Task 1). The design reserves the values `off | shadow | rules | alarms`.

| Value | Behaviour |
|---|---|
| unset, empty, `off` | **The default.** `POST /infinity-shadow/readings` → **409** `{"reason": "stage_off"}`. `GET /infinity-shadow/board` → 200 `{"stage": "off"}` and nothing else. The store is empty. The dashboard draws no strip, no monitor card, no chip, no legend. The device screen says "Monitör şeridi kapalı". |
| `shadow` | Stage A as specified here. The lane accepts readings only when the rest of the configuration is valid, as described below. |
| `rules`, `alarms` | **Not implemented in this build.** The API logs an error at start: "INFINITY_CLINICAL_STAGE=rules çalıştırılamıyor (stage_not_implemented); aşama off olarak çalışıyor". It then behaves exactly as `off`. It never fails to start because of this. |
| anything else | the same: logged, treated as `off` |

**What `shadow` needs, and what happens without it.** The API never refuses to start over Stage A. A clinical API that will not boot over an optional display feature is the worse failure (the same reasoning as `BedMap.from_file`). Instead `GET /infinity-shadow/board` answers `{"stage": "off", "configured_stage": "shadow", "problem": "<code>"}`. The device screen shows the problem. The ward sees nothing, because nothing is being claimed.

| Problem code | Condition |
|---|---|
| `token_missing` | `INFINITY_SHADOW_TOKEN` empty |
| `token_weak` | shorter than 32 characters |
| `token_reused` | equal to a `TENANTS` token or to `INFINITY_VIEWER_TOKEN` |
| `hospital_missing` | `INFINITY_SHADOW_HOSPITAL` empty, or not one of the `TENANTS` hospitals |

**The table is not a configuration problem.** A missing or invalid table puts every device on an "unassigned" card (fail closed, Decision 7). The stage stays `shadow`, and the strip says why.

**Applying it.** Edit `.env`, then `sudo docker compose up -d --no-build api`. This recreates the API container, which rehydrates the engine from the audit, as every deploy does; the board is unavailable for that time. A plain `restart` keeps the old environment (G1-15 F1).

**Rollback, three tiers, fastest first.** Each is one switch or one drop-in.
1. **Forwarder off:** delete the hub's drop-in `93-asama-a-golge.conf`, then `daemon-reload` and restart the hub. No API restart. Within ~20 s (15 s of silence, then the next poll) every value has aged off the strip, and the strip says "Monitör verisi gelmiyor". That is honest and visible.
2. **Stage off:** `INFINITY_CLINICAL_STAGE=off` in `.env`, then `up -d --no-build api`. The strip, the cards, the chip and the legend disappear.
3. **Code off:** delete the hub's `92-asama-a-kod.conf` (back to `transport-a4dd159a85e9c0b9`). The API and web go back to the images tagged before the build, and the checkout returns to `feat/canli-tasarim`. There is no migration, so no database restore.

---

## The forwarder

**Where it runs: in the hub process, as a daemon thread** (Decision 1). The decoder already lives there (`LiveResearchView`, `edge/infinity_live.py`). The thread reads `research_view.snapshot()` every 5 s. That is in-process, with no HTTP, no viewer token and no JSON of the 180 s history. It also reads the hub's own collector heartbeat age, through one new accessor `app.state.collector_age`. The hub keeps its rule "no imports from clinical ingest or engine" (`edge/infinity_hub.py:1`). The forwarder is an HTTPS client that imports only `edge/` and the standard library, and the release packs nothing else (`deploy/infinity/build_transport_release.py`, `EDGE`).

**Activation:** environment only, from a file named by the new drop-in `93-asama-a-golge.conf`:

```ini
# Homunculus Aşama A: gölge forwarder (doğrulanmamış görüntü; klinik iletim değildir)
[Service]
EnvironmentFile=/etc/homunculus-infinity-pilot/shadow-forwarder.env
```

`shadow-forwarder.env` (root:root 0600, like `hub.env`) contains `INFINITY_SHADOW_URL=https://172.100.101.72:8443/infinity-shadow/readings`, `INFINITY_SHADOW_CA_FILE=/etc/homunculus-infinity-pilot/web-ca.pem` and `INFINITY_SHADOW_TOKEN=<32 random bytes, hex>`.

The runner starts the thread **only** when it runs as the hub, with `--unverified-live-research`, and all three variables are set. It then prints `Shadow display forwarding ENABLED (Stage A, unvalidated; not clinical ingest) every 5 s.`; the token is never printed. If the three are set only partly, or the URL is not `https://`, the runner stops with `Shadow forwarding misconfigured: …`. The H-A2 block reads the next lines and rolls back by deleting 93. The research hub keeps `"clinical_forwarding": False` in every answer, and `/infinity-research/state` keeps `"clinical_ingest_enabled": False`. Both are true: the shadow lane is not clinical ingest, so `api/infinity_research.py:97-100` keeps accepting the hub.

**Thinning: N = 5 s.** Each cycle sends the hub's current value of each parameter of each device once. So at most one value per parameter per device per 5 s, against ~5 packets per second per device that the hub receives: about 25× fewer. Why 5:
- **It is fast enough to be useful.** The strip is a glance view that a clinician or biomedical engineer compares with the bedside screen. With 5 s cadence and a 5 s dashboard poll, a value is at most 3 + 5 + 5 = **13 s** old when drawn. That is inside the 15 s display limit, so one late cycle does not blank it, and two do.
- **It is slow enough not to be a monitor.** The strip must not invite anyone to treat it as a live waveform display.
- **It costs nothing.** 13 devices × ≤9 parameters every 5 s is ≤ 24 values per second into an in-memory dict, one POST (~15 KB) per 5 s, and nothing durable.
- **It is not the engine's number.** NEWS2's sampling rate (design §2.3, "clinician approves") is a Stage B decision.

**Age limits.** All are engineering numbers, not clinical ones. Each is a named constant, and the user may change it.

| Where | Limit | Rule |
|---|---|---|
| Hub (exists) | 3 s | `LiveResearchView` drops a packet ≥ 3 s old and reports a value ≥ 3 s old as `stale` with `value: None` (`edge/infinity_live.py:21-24, 64-66, 121-125`) |
| Forwarder | **< 3 s** (`MAX_FORWARD_AGE_MS = 3000`) | sends only `candidate` values (fresh and valid) and `device_reports_invalid` states (fresh `***`) with `age_ms < 3000`. A `stale` parameter is not sent. |
| API at arrival | **≤ 10 s old**, **≤ 2 s in the future** (`captured_at` against the API clock; same VM, NTP) | otherwise rejected and counted (`too_old`, `clock`) |
| API at display | **15 s** (`DISPLAY_MAX_AGE_S`) | an older value is returned without its number, state `old`, with the time of the last value |
| API store | **120 s** (`FORGET_AFTER_S`) | the parameter is deleted. A device not reported for 120 s keeps only its last status. |
| Dashboard | **15 s**, ageing locally between polls | if a poll fails or stalls, values still age out on screen |

**NBP: excluded from Stage A (recommendation).** The forwarder does not send `nbp_systolic`, `nbp_diastolic` or `nbp_mean`. The API refuses them anyway (its parameter table does not list them). The legend says why. Reasons:
- **Its age is not knowable.** The last NBP repeats as a valid record in every packet (`docs/INFINITY-PARAMETER-RECORDS.md:66-69`, design §4.1). Packet freshness therefore says nothing about when the cuff measured. The device timestamp is not decoded (`edge/infinity_records.py:14`).
- **A mark would be a lie next to an age.** Every other value on the strip carries a true age of seconds. An NBP drawn there with a "measurement time unknown" mark would be the one value whose visible age means nothing. A small mark is exactly the kind of qualifier a busy reader does not see.
- **It may not be this patient's.** Whether a Kappa clears the last NBP when a patient leaves the monitor has no source in the vault or the repo. Until it is known, an hours-old NBP could belong to the bed's previous occupant.
- **It is consistent.** Stage B excludes NBP until its time is validated (design §4.2(d), §8.4).
- *The cost:* a bed without an arterial line shows no blood pressure on the strip. The legend says that NIBP is withheld on purpose and that the monitor is the place to read it.

**Also excluded: `respiration_airway`** (`0x1F06`). The decoder itself marks it `unverified_layout` (`edge/infinity_records.py:51`), and no observed bed displayed it.

**Units.** The decoder already gives canonical units and scale: temperature is divided by 10 (`edge/infinity_records.py:43, 249`), and a record whose unit code is not the expected one is dropped (`:70`). The forwarder sends the decoder's unit string verbatim, and the API checks it against a closed table: `hr`/`pls` `bpm`, `spo2` `%`, `etco2` `mmHg`, `temperature` `C`, `art_*` `mmHg`, `respiration` `/min`. A mismatch is rejected and counted as `unit`. There is no conversion anywhere. **Known gap:** a monitor set to show etCO₂ in kPa sends a record the decoder drops without counting (design §4.1). On the strip, etCO₂ is then simply absent, not wrong. The decoder counter is Stage B's (Not in this plan).

**The token.** It is generated in the D-3 block on the VM (`openssl rand -hex 32`) into a shell variable. It is written with `sudo tee … >/dev/null` into two files, the hub's `shadow-forwarder.env` and the API's `.env` (`INFINITY_SHADOW_TOKEN=`), and is never echoed. It is not a `TENANTS` token. So:
- `/ingest`, `/ack`, `/clinical`, `/patients` and every other route answer it with 401 (test);
- the API refuses to enable the lane if the token equals a `TENANTS` token or the viewer token.

**The forwarder's own failures** never leave the thread. It logs to the hub's journal only when its state changes (ok → failing → ok), one line, with no token, URL query or value. Counters travel in its POST, so the API shows them to `devices.manage`.

| What happens | What the forwarder does |
|---|---|
| timeout or network error | counted (`failed`); the next cycle goes on as usual |
| 401 | log "token refused" once; retry every 60 s |
| 409 `stage_off` | retry every 60 s, one log line |
| 429 | wait for the next cycle |
| 400 | log once with the status; continue (a 400 means a bug: Task 6 has its test) |

**The wire format, `homunculus.infinity-shadow.v1`.** Closed on both sides:

```json
{"schema": "homunculus.infinity-shadow.v1", "sent_at": 1791980158.6,
 "forwarder": {"interval_s": 5, "sent": 1204, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
 "hub": {"collector_age_s": 1.2, "accepted_packets": 67821, "old_or_duplicate_packets": 333},
 "devices": [
  {"source": "10.10.203.23", "group": "224.0.2.23", "port": 2050, "status": "streaming", "packet_age_ms": 140,
   "readings": [{"parameter": "hr", "value": 72, "unit": "bpm", "valid": true, "captured_at": 1791980158.2},
                {"parameter": "spo2", "value": null, "unit": "%", "valid": false, "captured_at": 1791980157.9}]}]}
```

**No device name travels.** The hub's inventory `id` ("BED05", "infinity-monitor-28") is not sent. A bed comes only from the approved table (K1/K2). An inventory name can therefore never stand in for a bed on a clinical screen.

---

## The shadow lane in the API

**Module** `api/infinity_shadow.py` (pure; Task 3 and Task 4): the stage configuration, the parameter table, the integrity bounds, `ShadowStore` and `board_view()`. **Module** `api/infinity_device_beds.py` (Task 2): the table. The two routes are defined inside `create_app` beside the other board routes, because they need `_caller` and `_scope`. They call only these modules, a read-only occupancy function and `sees_patient`.

**`ShadowStore`** (in memory, one per configured hospital):
- **Bounds:** ≤ 100 devices (the inventory's own limit, `edge/infinity_stream.py` `Inventory.parse`); ≤ 9 parameter names, a closed set; ≤ 16 readings per device per POST; body ≤ 64 KiB (413).
- **Contents per device:** the last status and `status_at` (API clock), `packet_age_ms`, and per parameter the latest `{value, valid, unit, captured_at, received_at}`. A reading whose `captured_at` is not newer than the held one is ignored: no out-of-order overwrite.
- **Feed:** `last_post_at`; the forwarder's `sent`/`failed`; the hub block; cumulative rejection counters (`too_old`, `clock`, `unit`, `range`, `unknown_parameter`, `duplicate`); an integer histogram of `received_at − captured_at`, in ms, with the 0a buckets (≤10, 50, 100, 250, 500, 1000, 3000, >3000).
- **Expiry:** checked on every write and read, against an injected clock.
- **Writes nothing else, anywhere.** It is gone on API restart and refills within 5 s.

**Integrity bounds (not clinical):** `hr`/`pls` 0–350, `spo2` 0–100, `etco2` 0–150, `temperature` 0–50, `art_*` 0–400, `respiration` 0–200. A value outside its bound means a decoding fault, not a patient finding. It is rejected and counted (`range`), never shown. The bounds include 0.

**`POST /infinity-shadow/readings`** (Bearer shadow token, `secrets.compare_digest`):

| Condition | Answer |
|---|---|
| stage off (or `problem`) | 409 `{"reason": "stage_off"}` |
| missing or wrong token | 401 |
| body > 64 KiB | 413 |
| a schema violation (unknown key, wrong type, > 100 devices, a non-unicast source…) | 400, the whole body refused |
| a second POST within 1 s of the previous one | 429 |
| otherwise | 200 `{"accepted": n, "rejected": {"too_old": a, "clock": b, "unit": c, "range": d, "unknown_parameter": e, "duplicate": f}}` |

**`GET /infinity-shadow/board`.** The same gate shape as `/patients`: `_caller`, then `board.view` **or** `devices.manage`. A device token passes, as everywhere; the read-only checker uses `TENANT_TOKEN`.

```json
{"stage": "shadow", "display_max_age_s": 15, "generated_at": "2026-10-20T09:00:05+00:00",
 "table": {"status": "ok", "version": 1, "sha256": "ab12…", "approved_at": "2026-10-16"},
 "feed": {"state": "ok", "last_post_age_s": 2.1, "collector_connected": true,
          "devices": {"total": 13, "streaming": 9, "standby": 1, "silent": 0, "waiting": 0, "unsupported": 0},
          "unassigned": 3,
          "lag_ms": [1203, 812345, 0, 2, 40, 300, 700, 161, 0, 0]},
 "beds": [{"bed_label": "BED05", "bed_id": null, "unit_id": null, "source": "10.10.203.23",
           "link": "none", "patient_id": null, "status": "streaming", "status_age_s": 2.1,
           "parameters": [{"parameter": "hr", "state": "value", "value": 72, "unit": "bpm", "age_s": 2.4,
                           "evidence": "screen_match_two_devices"},
                          {"parameter": "spo2", "state": "invalid", "value": null, "unit": "%", "age_s": 2.6,
                           "evidence": "screen_match_two_devices"}]}],
 "unassigned": [{"source": "10.10.203.28", "reason": "table_unassigned", "status": "standby", "parameters": []}]}
```

**`feed.state`** takes one of:
- `never`: no POST since the API started;
- `forwarder_silent`: the last POST is older than 15 s;
- `collector_disconnected`: the hub's collector heartbeat is older than 15 s;
- `ok`.

**A parameter's `state`** takes one of:
- `value`: fresh and valid, age ≤ 15 s;
- `invalid`: the device sends `***`, age ≤ 15 s;
- `old`: older than 15 s. The number is withheld, and `last_at` is given instead.

**A device's `status`** takes one of `streaming`, `standby` (the hub's `no_parameters`), `silent` (the hub's `stale`), `waiting`, `unsupported` and `unknown`. `unknown` means the device has not been reported for more than 15 s.

**Patient link (`link`, `patient_id`).** Decision 9; the rule from design K3 and K5:
- A bed monitor card is linked to a patient **only** when exactly one **admitted** identity resolves, through the site's bed map, to the table row's `bed_id`. `link` is then `one`.
- Two or more admitted identities give `link: "ambiguous"`. No patient is named, and the card says so.
- None gives `link: "none"`.
- Discharged identities never link.
- The bed-map lookup **does not count** a miss. Task 3 adds `BedMap.lookup()`, because `BedMap.resolve()` increments the discovery counter (`tenant/bedmap.py` `resolve`). A shadow read must not change the discovery report the board shows.
- Occupancy is cached per hospital for 10 s.

**Scope** (`scope/rules.py` `sees_patient`, applied card by card):
- An unrestricted caller sees everything. That is today's VM: `SCOPE_ENFORCE_UNASSIGNED` is unset, so an unassigned user is unrestricted (`scope/resolver.py`).
- A scoped `board.view` caller sees a bed monitor card when its `bed_id` or `unit_id` is in scope. A linked card also needs `sees_patient` for its patient.
- A row with neither `bed_id` nor `unit_id` is visible only to unrestricted callers. This is the board's own rule for an unresolved bed.
- Unassigned devices go only to unrestricted callers and to `devices.manage`.
- **A `devices.manage` caller without `board.view`** gets every device and **never** a `patient_id`: `link` is reported as `hidden`.

**Evidence per parameter** (`EVIDENCE` in `api/infinity_shadow.py`, from design §4.1 and `docs/INFINITY-PARAMETER-RECORDS.md:36-50`). Neither the vault nor the repo records how many samples any of these rest on, and the legend says so.

| Parameter | `evidence` | Today's evidence | On the strip |
|---|---|---|---|
| `hr`, `pls`, `spo2`, `etco2` | `screen_match_two_devices` | identical to the screen on two devices | shown |
| `art_systolic` | `screen_match` | identical to the screen | shown |
| `temperature` | `screen_match_site_unknown` | identical to the screen, tenths; where it is measured is unknown | shown, marked **kısmi** |
| `art_mean` | `structural` | MAP identity only (≤ 3 mmHg in 150 packets); not compared with the screen | shown, marked **kısmi** |
| `art_diastolic` | `structural_trend` | MAP identity + the screen's trend | shown, marked **kısmi** |
| `respiration` (impedance) | `range_overlap` | range overlap on one bed; not identical to the screen | shown, marked **kısmi** |
| `nbp_*` | — | identical to the screen, but the measurement time is not decoded | **not shown** |
| `respiration_airway` | — | not validated | **not shown** |

---
## The device→bed table

**Source of record:** `deploy/infinity/device-beds.icu2.json`, in the repo. It sits next to `inventory.icu2.json`, which already carries the same addresses and bed names, and neither holds patient data. It is versioned three ways: git history, a `version` field that increases with every change, and the approval fields.

**Deployed copy:** `/opt/homunculus/deploy/local/infinity-shadow/device-beds.json`. A new `.gitignore` entry keeps it out of the checkout. Compose mounts the **directory** read-only at `/etc/homunculus/infinity-shadow`. The directory, not the file: Docker turns a missing file source into a directory, which is exactly what happened to `bed-mapping.json`. A missing directory is harmless (the compose file's own `ldap-ca` comment). The D-3 block copies the file and checks its sha256 against the commit's. The API logs the version and sha at load, and `GET /infinity-shadow/board` shows them. The user can therefore see that the deployed table is the approved one.

**Format** (`homunculus.infinity-device-beds.v1`). The schema is closed: an unknown key refuses the whole table, so no patient field can ever be added to it.

```json
{
  "schema": "homunculus.infinity-device-beds.v1",
  "version": 1,
  "site": "ICU2 (VLAN 203)",
  "approved_by": "",
  "approved_at": "",
  "devices": [
    {"source": "10.10.203.23", "group": "224.0.2.23", "port": 2050, "bed_label": "BED05",
     "bed_id": null, "unit_id": null, "method": "central_station_list", "verified_at": "2026-09-22",
     "valid_from": "2026-10-16T00:00:00Z", "valid_to": null, "note": "Merkezi istasyon Biomed listesi (538ba54)"},
    {"source": "10.10.203.28", "group": "224.0.2.28", "port": 2050, "bed_label": null,
     "bed_id": null, "unit_id": null, "method": null, "verified_at": null,
     "valid_from": "2026-10-16T00:00:00Z", "valid_to": null,
     "note": "ÇÖZÜLMEDİ: 22.09 ekran karşılaştırmasında BED07, merkezi istasyon listesinde BED12"}
  ]
}
```

**Validation** (`api/infinity_device_beds.py` `parse_table`). The whole table is refused, with one Turkish reason, when any of these fails:
- `schema` matches exactly; `version` is a positive integer;
- **`approved_by` and `approved_at` are non-empty**. An unapproved table is not loaded: approval is not optional, it is the switch.
- `source` is a unicast IPv4, `group` a multicast IPv4, `port` is 2050 (the hub's own rules, `edge/infinity_stream.py` `Inventory.parse`);
- `bed_label` is null (unassigned) or matches `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$`;
- an **assigned** row has `method` ∈ {`central_station_list`, `monitor_screen`, `both`} and a `verified_at` date;
- an **unassigned** row has a `note` that gives the reason;
- `valid_from` is ISO-8601 UTC; `valid_to` is null or later than `valid_from`;
- **two rows for the same source with overlapping intervals** are refused;
- **two assigned rows for the same bed label with overlapping intervals** are refused. Two monitors on one bed is the K5 ambiguity, so it is an error in the table, not something to guess around.
- `bed_id` and `unit_id` are null or a string of at most 128 characters. They are the board's own ids, from the bed map and the database. They may stay null in Stage A: such a bed is then visible only to unrestricted callers (Scope, above).

**Resolution** (`DeviceBedTable.at(source, when)`): the row valid at `when`, or none. A device in the hub's stream with no valid row is unassigned, reason `not_in_table`.

**Hot reload, fail closed.** The API checks the file's size and mtime at most once every 10 s, and re-parses it on a change. A new **valid** table replaces the old one and is logged with its version and sha. A **missing or invalid** file puts **every** device on an unassigned card, `table.status` `missing` or `invalid` with the reason, and the strip says "Cihaz→yatak tablosu yok ya da geçersiz". The last good table is deliberately **not** kept: a table someone changed and broke is not one to keep trusting.

**The table for approval** (Task 13 presents it from the file, in Turkish, with `deploy/infinity/device_beds_review.py`). The sources are the repo's own:
- `deploy/infinity/inventory.icu2.json`;
- commit `538ba54` (the central station's Biomed list, read by the user on 22.09);
- `docs/INFINITY-PARAMETER-RECORDS.md:188-193` (screen comparisons: BED06=.29, BED07=.28, BED08=.37, BED09=.26).

| # | Kaynak IP | Grup | Yatak | Yöntem | Doğrulama | Not |
|---|---|---|---|---|---|---|
| 1 | 10.10.203.23 | 224.0.2.23 | **BED05** | merkezi istasyon listesi | 22.09 | |
| 2 | 10.10.203.24 | 224.0.2.24 | **BED11** | merkezi istasyon listesi | 22.09 | |
| 3 | 10.10.203.25 | 224.0.2.25 | **BED01** | merkezi istasyon listesi | 22.09 | 22.09: listede BED01; ekrandaki `***` + bekleyen NBP davranışıyla örtüşüyor |
| 4 | 10.10.203.26 | 224.0.2.26 | **BED09** | monitör ekranı | 22.09 | ekran karşılaştırması |
| 5 | 10.10.203.27 | 224.0.2.27 | **BED10** | merkezi istasyon listesi | 22.09 | |
| 6 | 10.10.203.28 | 224.0.2.28 | — **atanmamış** | — | — | 22.09 ekranda BED07, listede BED12: çelişki |
| 7 | 10.10.203.29 | 224.0.2.29 | **BED06** | monitör ekranı | 22.09 | ekran karşılaştırması |
| 8 | 10.10.203.31 | 224.0.2.31 | **BED15** | merkezi istasyon listesi | 22.09 | |
| 9 | 10.10.203.32 | 224.0.2.32 | **BED14** | merkezi istasyon listesi | 22.09 | |
| 10 | 10.10.203.33 | 224.0.2.33 | **BED13** | merkezi istasyon listesi | 22.09 | |
| 11 | 10.10.203.34 | 224.0.2.34 | — **atanmamış** | — | — | listede yok |
| 12 | 10.10.203.37 | 224.0.2.37 | **BED08** | monitör ekranı | 22.09 | ekran karşılaştırması |
| 13 | 10.10.203.38 | 224.0.2.38 | — **atanmamış** | — | — | listede yok |

The table carries the 22.09 mapping. **Monitors move.** The design's open question is whether the IP follows the monitor or the CPS docking station (design §3.3, `Homunculus/raw/pilot-icu-monitoring-survey-2026-09-02-raw.md:35-36`). So the approval step asks the user and biomedical to re-confirm each row on the ward first, from the central station or each monitor's screen. "Kullanıcıdan gerekenler" 1 says how.

---

## The dashboard

**Data** (`dashboard/src/live/data/shadowStore.js`, framework-free, in the shape of `boardStore`):
- **When it polls:** `GET /infinity-shadow/board` (`backendApi.shadowBoard()`) every **5 s**, through the session's `track`, **only while** all three hold: the session is `READY` (never `LOCKED`: no monitor value reaches a lock screen); it holds `board.view` or `devices.manage`; and at least one consumer is mounted with `document.visibilityState === "visible"`.
- **What it holds:** `{phase: idle|loading|ok|unreadable, stage, data, fetchedAtMs}`. A failed poll sets `unreadable` and keeps the data, which then ages out on screen. `clear()` runs on session end.
- **What it never touches:** it imports nothing from `boardStore` and is imported by **no** module under `signals/`, by `shell/` (TopBar, Sidebar, Menu, Shell), by `auth/LockScreen.jsx` or by `data/boardStore.js`. `boundaries.test.js` enforces this (Task 7).

**Display rules** (`screens/common/monitor.js`, pure, tested):
- `displayAge(param, nowMs, fetchedAtMs) = param.age_s + (nowMs − fetchedAtMs)/1000`.
- A number is drawn only when `state === "value"` **and** that age ≤ `display_max_age_s`. Otherwise the cell reads `—` and `eski · <age>`.
- `invalid` reads `***`, with the screen-reader text "monitör geçerli değer göstermiyor".
- A device status `standby`, `silent`, `waiting`, `unsupported` or `unknown` replaces the values with its sentence.
- There is no threshold, band or colour that depends on a value. This is the same rule as `screens/common/vitals.js` and `freshness.js`.

**Look:**
- The strip has a **dashed** border and a header tag **DOĞRULANMAMIŞ** in `text-att-ink`. In this interface amber means "the screen cannot vouch for this" (`screens/common/BoardState.jsx`, the `RAIL` note); that is exactly the claim.
- Values are in `text-ink`, **not** in the vital identity colours (`text-v-hr`…), so a monitor value is never dressed as an engine vital.
- No risk pill, no rail, no green anywhere. Partial-evidence parameters carry a neutral `StatusPill` "kısmi".
- Every value has its age beside it.

**Where it appears:**
1. **Beds screen** (`BedsScreen.jsx`):
   - A **monitor chip** joins the feed row, next to the existing `FeedHealth` chip and separately labelled: "Monitör (doğrulanmamış): 9/13 veri gönderiyor · 1 beklemede · 0 susuyor · 3 atanmamış", or the feed sentence when the feed is not `ok`.
   - After the patient cards, a section **"Monitörler — doğrulanmamış"** with its own heading. It holds bed monitor cards for assigned beds whose monitor is **not** linked to a patient card on this board, then the **unassigned-device** cards.
   - The unit filter and the search apply. Unassigned cards belong to no unit, so a unit filter hides them, and the existing "hidden" line says so.
   - The section comes **after** the patient cards, so no engine card is ever pushed down by a monitor.
2. **Bed card** (`BedCard.jsx`): a compact strip under the vitals, **only** when the API links this patient (`link: "one"`, the same `patient_id`). On the VM today no card qualifies (bed map is a directory).
3. **Patient screen** (`PatientScreen.jsx`): a `Box` "Monitör — doğrulanmamış" right after the engine's vitals, for the same linked patient. It shows the full note, each value with its age, the evidence text per parameter and the device status.
4. **Device screen** (`screens/devices/DevicesScreen.jsx`, route `/devices`, `devices.manage`): every device with its source, its table row (bed or "atanmamış" and why), status, values, ages and evidence, plus the table version and sha and the feed counters. It shows **no patient id or name**, even to a session that also holds `board.view`.
5. **Settings › Sinyaller** (`SettingsScreen.jsx`): a `Box` "Monitör şeridi (doğrulanmamış)". It holds the full explanation, a line that it never sounds or notifies, the evidence table, the NBP line and the age rule. It is shown only while the stage is `shadow`.

**Accessibility:**
- The strip is `<section aria-labelledby>`, and its heading includes "doğrulanmamış".
- Values are in a `<dl>`. Each `<dd>` carries a screen-reader age and, for `***`, the sentence.
- **No `aria-live`.** Values change every 5 s, and a live region would talk over everything. The feed sentence is a static `Note`, as `BoardStrip`'s DEGRADED is.
- Monitor and unassigned cards are not links: there is no screen to open. The device screen is reached from the rail.
- Every text clears 4.5:1 in both themes. The tokens used are the validated `att-ink`, `ink`, `mute` and `line2`.
- Tested by role and name, as the existing screens are.

**390 px and 1440 px:**
- Values wrap in `grid-cols-3` (390) to `auto-fill, minmax(92px, 1fr)` (1440).
- Monitor cards use the beds grid's existing rule (`grid-cols-[repeat(auto-fill,minmax(290px,1fr))] … max-[640px]:grid-cols-1`).
- The chip wraps under `FeedHealth` below 861 px, the existing breakpoint.

**Labels, four languages** (the namespace `monitor`, `src/live/i18n/strings/monitor.js`, full text in Task 8). The essential sentences, Turkish source:
- **Strip title:** "Monitör · doğrulanmamış". **Tag:** "DOĞRULANMAMIŞ".
- **Under every strip:** "Araştırma çözümlemesi · karar için ölçüm değildir · uyarı üretmez".
- **Full text** (patient screen, device screen, Settings): "Bu değerler başucu monitörünün ağ yayınından araştırma amacıyla çözülüyor ve doğrulanmadı. Karar için başucu monitörüne bakın. Bu değerlerden hiçbir uyarı, skor (NEWS2 dahil), bildirim ya da ses üretilmez; birincil alarm başucu monitörünün kendi alarmıdır."

AZ, RU and EN are written in Task 8. Like every other dictionary file in this build, they **await a native-speaking clinician's review**. For this namespace that review is a **deploy gate**, not a nicety (Kullanıcıdan gerekenler 4).

---

## Biomedical access: recommendation

**Recommendation: yes, biomedical sees the monitor values, through a device-only screen (`/devices`, `devices.manage`), not through `board.view`.**

Why:
1. **They own the table and sign the validation.** Design K2 and decision 9 make biomedical the owner of the device→bed table, and §4.2 makes a biomedical engineer one of the two signatories per parameter. On the ward, they are the people who can check "BED05's screen shows 72, the strip shows 72". Without a screen they are the only people involved who cannot see what the clinicians see.
2. **Least privilege.** `board.view` would hand them patient names, findings, NEWS2 and the acknowledgement buttons' context. A device screen gives them devices, beds, values and feed health, and nothing about a person. The API enforces this: a `devices.manage` caller without `board.view` gets `patient_id: null` and `link: "hidden"`.
3. **It is the roadmap's own page, earlier.** "Cihaz & Veri Akışı" is promised to biomedical and the hospital administrator for Group 4 (`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md:627`). This is its first slice.

**What it changes, which the user approves with it:**
- A `devices.manage`-only account **can now sign in** to the new UI: `hasWorkRoute` gains a work route it can reach, and it lands on `/devices`.
- `platform_support` (the vendor's support group: `audit.view` + `devices.manage`, MFA required) can also sign in now. It sees the device screen and nothing clinical. G1-15 Part D 5 already asked whether `platform_support` sees the research window. This is the same question, now with live monitor values (no names).
- G1-15's acceptance line B12.1 ("`test.biyomedikal` is refused, `NO_BOARD_ACCESS`") becomes "lands on Monitörler". `liveAuth.accessProblem` is no longer the live UI's entry rule (`LiveApp` uses `hasWorkRoute`). It is left as it is; nothing reads it for this.

**If the user says no:** skip Task 11's screen and route. Its permission-text half stays. Nothing else depends on it. Biomedical then checks the mapping on a clinician's screen, side by side with a clinician.

---

## Feed health: the board never looks calm because the feed died

| What failed | What the hub/forwarder sees | API `feed.state` / device status | What the beds screen says (TR) |
|---|---|---|---|
| one monitor off, cable out | device `stale` | that device `silent` | the card: "Monitör susuyor · son veri 14:02:31"; the chip: "1 susuyor" |
| monitor in standby | `no_parameters` | `standby` | the card: "Monitör beklemede"; the chip: "1 beklemede" |
| `***` on a parameter | `device_reports_invalid` | parameter `invalid` | `***` (screen reader: "monitör geçerli değer göstermiyor") |
| a value older than 15 s | — | parameter `old` | `— eski · 25 sn` |
| worker down, or the network to it | heartbeat > 15 s; every device `stale` | `collector_disconnected` | the chip, as a `Note`: "Monitör ağ toplayıcısı bağlı değil — hiçbir monitörden veri alınmıyor"; every card says "susuyor" |
| transport lag returns (the 0a failure) | the hub drops packets ≥ 3 s; devices `stale` | devices `silent` | "13 susuyor" (never stale numbers) |
| **forwarder thread dead, or drop-in removed** | — | `forwarder_silent` after 15 s | "Monitör verisi gelmiyor (son: 14:02:31) — aktarım ya da Infinity sunucusu durmuş olabilir"; every value ages off |
| **hub service down** | — (the forwarder lives in it) | `forwarder_silent` after 15 s | the same sentence. The distinction is made by `transport_check.py` and `systemctl`, which are operations' tools. For the ward both mean "no monitor data", and the board says exactly that. |
| hub service up, forwarder never started | — | `never` | "Monitör aktarımı henüz başlamadı" |
| API down | — | — | the existing `BoardStrip` UNAVAILABLE (crit, announced) covers the board; the strip says "Monitör şeridi okunamıyor" |
| the dashboard's own poll fails | — | — | "Monitör şeridi okunamıyor"; values age off within 15 s |
| table missing or invalid | — | `table.status` `missing`/`invalid` | "Cihaz→yatak tablosu yok ya da geçersiz: hiçbir monitör bir yatağa yazılmıyor"; every device on an unassigned card |
| stage off | — | `stage: off` | nothing at all, because nothing is claimed |

**The "N monitör susuyor" chip** counts the devices the caller may see whose status is `silent`, `waiting` or `unknown`. It counts `standby` separately and unassigned devices separately. It is **never** drawn while `feed.state` is not `ok`: the feed sentence replaces it. This follows `FeedHealth`'s rule that a chip never reports our own lost connection as the ward's dead monitors (`screens/common/BoardState.jsx` `FeedHealth`).

---

## The gate: nothing clinical changes

**Task 5 is the gate of this plan.** No dashboard task starts before it is green.

**1. Equivalence: `tests/test_infinity_shadow_equivalence.py`.** Two apps, **A** (stage off) and **B** (stage shadow, valid token, an approved in-code table). Both use the same `TENANTS`, the same in-memory audit and identity stores, the same bed map, and the same frozen clock. Every wall-clock read on the clinical path is monkeypatched: `datetime` in `api/app.py`, `api/board.py` (the antibiotic clock), `api/clinical.py` and `api/patient_identity.py` (the identity's `updated_at`), and `_now_iso` in `api/audit.py` and `api/notify.py`. Read 14.10 by grep; the test's own docstring says to grep again.

Both run the **same engine inputs**: the repo's own synthetic scenarios `septic_shock.yaml` and `news2_deterioration.yaml` through `/ingest`. Before them, a synthetic `Encounter` puts the scenario patient in the bed the table assigns a monitor to, so B links that monitor to that patient. Then one `/clinical` chart, one `/ack`, and three `escalation_cycle(now)` calls at fixed instants, including one past `escalate_after`.

In **B only**, before and after every step, the test sends shadow readings for that bed. These values would raise every alert if they were clinical: HR 180, SpO₂ 70, RESP 40, ART S 70. It also reads `GET /infinity-shadow/board`.

**Asserted equal, A against B:**
- every `GET /patients` body after every step (`json.dumps(sort_keys=True)`; this carries NEWS2, risk, alerts, scope and `scope_note`);
- every `GET /alerts/{pid}`;
- every frame the broadcaster published (a queue subscribed before the first step);
- every notification the hub published, for the nurse and doctor audiences;
- `ack_stores[hospital].escalated`, `.acks` and `.first_seen`;
- the audit records as `(tenant, event_type, patient_id, subject, payload)`, all of them, in order (`ts`, `hash`, `prev_hash` and `id` are excluded, because they are wall time and seal it), **and the count**; `verify_chain` is OK on both;
- `bedmap.unmatched()`, the discovery counters;
- the identity store's contents.

**The negative control** (same file) proves the harness can see a difference. With one real `/ingest` of HR 180 added in B only, the `/patients` bodies, the audit lists and the frames differ. A gate that cannot fail is not a gate.

**2. Isolation: `tests/test_infinity_shadow_isolation.py`.**
- **Imports** (AST): `api/infinity_shadow.py`, `api/infinity_device_beds.py` and `edge/infinity_shadow.py` import nothing from `homunculus.pipeline`, `.rules`, `.reco`, `.state`, `.canonical`, `.gateway`, `.api.audit`, `.api.broadcast`, `.api.notify`, `.api.escalation`, `.api.rehydrate` or `.api.board`.
- `edge/infinity_shadow.py` imports nothing from `homunculus` outside `homunculus.edge`. The release packs only `edge/`, so such an import would fail on the hub anyway (`build_transport_release.py` `PACKAGE`).
- **Spies:** with `audit.append`, `broadcaster.publish`, `notification_hub.publish`, `Engine.ingest`, `IdentityStore.apply` and `BedMap.resolve` wrapped, one shadow POST and one shadow GET call **none** of them.
- **The token:** the shadow token gets 401 from `/ingest`, `/ack`, `/clinical/p1`, `/patients`, `/stream-ticket` and `/audit`. A `TENANTS` token gets 401 from `POST /infinity-shadow/readings`.
- **The stage:** with stage off, a POST is 409 and the store stays empty. `rules` and `alarms` behave as `off`.

**3. Dashboard: `boundaries.test.js` + `shadowStore.test.js`.**
- `signals/*`, `shell/*`, `auth/LockScreen.jsx` and `data/boardStore.js` import no `data/shadowStore.js`, `data/ShadowProvider.jsx`, `screens/common/monitor*.js(x)` or `screens/devices/*`.
- With a board store and a shadow store fed fakes, filling the shadow store leaves `boardStore.getState()` **the same object**, and leaves `alarmsToSignal`, `waitingAlarms`, `alarmCounts` and `lockSummary` deep-equal.
- `MonitorStrip` renders no risk class (`bg-crit`, `text-crit`, `bg-high`, `bg-ok`, `text-ok`…), no `aria-live`, no `role="alert"`.

**On the real system** the same claim is checked twice (Kabul K4, K5):
- **K4, the board.** A hash of `/patients` (with the only two wall-clock-ageing keys removed, `elapsed_sec` and `remaining_sec`) is read before the forwarder is enabled and after 30 minutes of it. No API restart lies between the two readings, and no clinical input flows today.
- **K5, the audit.** Audit rows per event type are counted in the hour before and the hour after. Any audit row per POST would show as ≥ 360 rows in 30 minutes.

---

## Decisions

> **Approved by the user, 15.10:** all of the plan's recommendations — NBP excluded (3), the
> device-only "Monitörler" screen for biomedical, also reachable by vendor support (12), and the
> timing numbers 5 / 3 / 10 / 15 / 120 s (2). Stage A touching the clinical API and web is
> approved (Group 1 is deployed; the 07.10 rule was Group 1's). Still before the switch-on deploy
> (D-3): the device→bed table on the ward (Task 13), a native-speaker look at the az/ru strip
> texts, and the ward notice a day earlier.

Each carries the alternative it rejected.

1. **The forwarder is a thread in the hub process, enabled by a drop-in that only adds an `EnvironmentFile=`.**
   - *Why:* the decoder's state is in that process, so no HTTP, no token and no 180 s history JSON are needed. The collector heartbeat age is available directly. The house release/drop-in layout is unchanged. Rollback is deleting one drop-in.
   - *Rejected:*
     - **a separate systemd unit polling `/infinity-research/state`**: a new unit and env file, the viewer token, and serialising the history every 5 s;
     - **a Docker compose service**: outside the house layout for Infinity, and it polls the hub over HTTP all the same;
     - **decoding on the worker** (0a's F8): hub CPU is 8.4 %, and it would need a v2 event schema and a mixed queue at deploy.
   - *Cost accepted:* a "hub down" and a "forwarder down" look the same on the board. That is fine for the ward, and operations tell them apart with `transport_check.py`.
2. **5 s cadence; 3 s at forward, 10 s at arrival, 15 s on screen, 120 s in memory.**
   - *Rejected:* **1 s**, which invites "this is a monitor"; **60 s** (the design's NEWS2 default), where a strip value is up to 60 s old and the ages train people to ignore them.
3. **NBP is not shown in Stage A.** *Rejected:* **showing it with a "measurement time unknown" mark** (Forwarder, NBP).
4. **`respiration_airway` is not shown.** It is unverified in the decoder itself.
5. **A dedicated shadow token, not a `TENANTS` device token.** *Rejected:* **the design's `TENANTS` token**, which passes every permission check and can write `/ingest`.
6. **Memory only: no audit row, no database table, no file.**
   - *Rejected:* **an audit event type** (it grows the oldest-1,000,000 rehydration window, and the brief forbids touching the audit); **a Postgres table** (a migration, and a rollback that needs a dump).
   - *Cost accepted:* an API restart empties the strip for 5 s.
7. **The table is a repo file, approved in-file and by commit, copied with a sha256 check, hot-reloaded, failing closed.**
   - *Rejected:*
     - the unused column `beds.device_location_id` in Postgres (`tenant/models.py` `Bed`): no version, no approval, no interval, no history, and an admin screen to build;
     - keeping the last good table on an invalid file;
     - restarting the API to reload, which costs a rehydration.
8. **No episodes in Stage A.** The store holds 15 s of meaning and nothing older, so two patients cannot share a card's data. *Rejected:* **building K4 episodes now**, which is a phase-3 feature that only matters once values are kept or attributed.
9. **A monitor is shown on a patient only through an existing explicit binding:** exactly one admitted identity whose bed-map bed is the table row's `bed_id`. Otherwise it gets a bed monitor card.
   - On the VM today the bed map is a directory, so **every** assigned monitor appears on a bed monitor card, and the patient-card strip is proven by tests until a bed map and a binding exist.
   - *Rejected:* **matching the HIS bed text or the inventory name** (a guess); **writing a bed-map now** (phase 3, and a hospital decision).
10. **A separate endpoint, polled; the clinical stream untouched.**
    - *Rejected:* adding monitor values to `/patients` or to the SSE board frames. It would make "byte-identical" false by construction, and every 5 s update would wake every card's render and the alarm logic's inputs.
11. **The stage switch is an environment variable. `rules` and `alarms` are refused in this build, and treated as `off`.** *Rejected:* a runtime admin switch (the design's "later"; it needs an audit entry, which Stage A does not write).
12. **Biomedical: a device-only screen** (the recommendation above). *Rejected:* **giving biomedical `board.view`** (least privilege); **nothing in Stage A** (the table's owner cannot see the table at work).
13. **The hub's public answers do not change** (`clinical_forwarding: False`, `clinical_ingest_enabled: False`; no new `/v1/status` key). One accessor, `app.state.collector_age`, is added. *Rejected:* a `shadow_forwarding` block in `/v1/status`. The API is the forwarder's observer, and `transport_check.py` stays as 0a shipped it.
14. **The strip's look is amber tag + dashed border + ink values, with no risk or vital colours, no live region and not on the lock screen.** *Rejected:* the vital identity colours (they would dress a monitor value as an engine vital).
15. **Integrity bounds at the API, not clinical thresholds.** A value outside the physically encodable range is a decoding fault, rejected and counted. *Rejected:* none (bounds that include 0, so no finding is filtered as a value).

---

## Not in this plan

- **Stage B and C.** The allowlist into the engine, shadow findings, the audit rehydration fix (`api/app.py:215`), NEWS2 freshness in the engine, source priority (§6.5).
- **Validation acceptance criteria.** N, the number of beds and the condition list (design §4.2(e)) **have no source in the vault**, so they need a clinician's and biomedical's figure. That belongs to Stage B and is not asked now. The comparator (phase 0b) and the field rounds (phase 1) are not here either.
- **Bed→patient binding in the UI**, the admission screen, writing `bed-mapping.json`, Comed ADT (phase 3). Without them, the patient-card and patient-screen strip stays dormant on the VM (Decision 9).
- **Episodes** (K4), trends and history, the device's alarm limits on the strip (§6.7 suggests them as context; not validated, design §4.1 "alarm limitleri: yalnız gözlem").
- **A decoder counter for unit-mismatched records** (the etCO₂-in-kPa gap). It needs a change to `infinity_records.py`, and its test belongs with Stage B's validation.
- **The worker.** Nothing changes on `.74`, and **no worker session is needed**.
- **The six old NCE cards** (design decision 11). They are asked about in Kullanıcıdan gerekenler 6; there is no code here.
- **Revoking the hub's temporary sudo** (0a, Needs the user 8) and rotating the hub CA (21.09.2027).
- **`tests/test_infinity_vm_pilot.py`**, which is never run.

---

## Size and estimate

**19 tasks (0–18). Honestly ≈ 78 agent hours, about 10 developer-days of code**, inside the design's 8–12 for phase 2. Without the biomedical screen it is ≈ 72 hours, about 9 days. **On the calendar: 2.5–3 weeks.** The code takes about two weeks. The calendar adds:
- a native-speaker review of the AZ (and RU) strip texts;
- the table re-confirmation on the ward;
- three short user sessions on the VM, with a ward notice a day before the third;
- a 24-hour observation.

| Task | Agent h | The user | What |
|---|---|---|---|
| 0 — Baseline | 0.5 | — | worktree, three gate bases, plan committed |
| 1 — Stage switch + config | 3 | — | TDD; compose, `.env.example` |
| 2 — Device→bed table | 5 | — | TDD; the file (unapproved), the review printer |
| 3 — Shadow store + `BedMap.lookup` | 5 | — | TDD |
| 4 — The two routes, nginx, prodserver | 7 | — | TDD |
| **5 — The gate: equivalence + isolation** | **6** | — | **must be green before Task 7** |
| 6 — Hub forwarder, runner, release | 8 | — | TDD; end-to-end into the API lane |
| 7 — Dashboard data layer | 5 | — | TDD; the import boundary |
| 8 — Strip + `monitor` texts, four languages | 8 | text review (deploy gate) | TDD |
| 9 — Beds screen + bed card | 6 | — | TDD; 390/1440 |
| 10 — Patient screen + Settings legend | 4 | — | TDD |
| 11 — Biomedical device screen + permission texts | 6 | decision (Kullanıcıdan gerekenler 5) | TDD |
| 12 — `shadow_check.py` (read-only acceptance) | 3 | — | TDD |
| 13 — Table approval | 1 | **≈ 30 min + a ward round with biomedical** | commit with the approval |
| 14 — D-1: hub release R3 (forwarding off) | 1.5 | ≈ 10 min | hub transport KABUL again |
| 15 — D-2: API/web (stage off) | 2.5 | ≈ 45 min | the invisible deploy |
| 16 — D-3: table, token, stage `shadow`, forwarder | 1.5 | ≈ 20 min, **ward told a day before** | the strip appears |
| 17 — Acceptance + 24 h | 3 + 24 h | ≈ 30 min on the ward | K0–K9 |
| 18 — Documents as deployed | 2 | — | README, records doc, Turkish guide |
| **Total** | **≈ 78** | | |

**Counts** (the plan; Task 0 and each gate record the real figures):

| After | Python gate (Infinity 164 + clinical 320/122 at base) | New test files | Dashboard |
|---|---|---|---|
| Task 1 | +≈ 10 | `test_infinity_shadow_config.py`; `test_local_compose_env.py` sees three more names | — |
| Task 2 | +≈ 18 | `test_infinity_device_beds.py` | — |
| Task 3 | +≈ 16 | `test_infinity_shadow_store.py`; +2 in `test_api_board_bedmap.py` (`lookup`) | — |
| Task 4 | +≈ 22 | `test_infinity_shadow_api.py`; `test_nginx_routes.py` +1 path | — |
| Task 5 | +≈ 12 | `test_infinity_shadow_equivalence.py` (≈ 3), `test_infinity_shadow_isolation.py` (≈ 9) | — |
| Task 6 | +≈ 16 | `test_infinity_shadow_forwarder.py`; `test_infinity_release.py` names the new module | — |
| Tasks 7–11 | — | — | +≈ 70 tests in ≈ 7 files |
| Task 12 | +≈ 6 | `test_infinity_shadow_check.py` | — |

---

## Ground rules for every task

- **Your own worktree.** Work in `/c/tmp/inf-a` on branch `feat/infinity-asama-a`, made from `feat/infinity-asama0a` in Task 0. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`**: it is the user's main checkout, on another branch, with uncommitted work that is not yours. `/c/tmp/inf-0a` and `/c/tmp/homunculus-g1` are reference worktrees: read them, never commit in them. Never `git push`. If you remove the worktree later, unlink the `node_modules` junction first (`cmd /c rmdir "C:\tmp\inf-a\dashboard\node_modules"`, then `git worktree remove --force`). A recursive delete that follows the junction empties the shared `node_modules`.
- **Edit with the Write and Edit tools only, never `sed`, `python`, `node` or a shell heredoc on a repo file.** The worktree checks out **CRLF**; every block in this document is LF. The Edit tool matches either way; a shell replacement fails or rewrites every line end. **Write** is only for a file this plan gives whole. **Edit** is for everything else, and the old text must match exactly once.
- **Stage explicit paths only** (`git add <paths>`). Before every commit, run `git status --short` and `git diff --cached --stat`. If a staged path is not one the task lists, stop and ask.
- **TDD.** Write the test, **run it and see it red** for the reason the task names, then write the code, then green. Record the red in the commit message's body ("red: 7 failed, ImportError …").
- **Commit after each code task.** Every message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Foreground gates.** Run every suite and build in the foreground, with the Bash timeout as the backstop. Never background a gate and wait on it: an agent that did sat silent for hours.
- **The Python gates.** Always name the files. **Never run `tests/test_infinity_vm_pilot.py`**, alone or in a bare `pytest tests/`.
  ```bash
  cd /c/tmp/inf-a/homunculus-engine
  # Infinity gate (0a's 14 files, 164 at base) + this plan's edge/forwarder files
  PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q \
    tests/test_infinity_transport.py tests/test_infinity_live.py tests/test_infinity_records.py \
    tests/test_infinity_research_upgrade.py tests/test_infinity_pilot_activation.py \
    tests/test_infinity_decoder.py tests/test_infinity_bed09_decoder_install.py tests/test_infinity_bed09_switch.py \
    tests/test_infinity_timing.py tests/test_infinity_release.py tests/test_infinity_check.py \
    tests/test_infinity_journal.py tests/test_infinity_forwarding.py tests/test_infinity_certificate.py \
    <tests/test_infinity_shadow_forwarder.py tests/test_infinity_shadow_check.py once they exist> 2>&1 | tail -1
  ```
  ```bash
  cd /c/tmp/inf-a/homunculus-engine
  # Clinical gate (28 files, 320 passed + 122 skipped at base) + this plan's API files
  PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q \
    tests/test_api_ack.py tests/test_api_audit.py tests/test_api_board_bedmap.py tests/test_api_board_identity.py \
    tests/test_api_board_meds.py tests/test_api_board_news2.py tests/test_api_board_sepsis.py \
    tests/test_api_clinical.py tests/test_api_identity_ingest.py tests/test_api_ingest.py \
    tests/test_api_notifications.py tests/test_api_scope.py tests/test_api_stream.py \
    tests/test_board.py tests/test_board_permissions.py tests/test_board_vitals.py \
    tests/test_escalation.py tests/test_escalation_chain.py tests/test_escalation_workflow.py \
    tests/test_notify.py tests/test_notify_hub.py tests/test_permissions.py tests/test_rehydrate.py \
    tests/test_nginx_routes.py tests/test_local_compose_env.py tests/test_tenant_isolation.py \
    tests/test_infinity_research_api.py tests/test_scope_rules.py \
    <tests/test_infinity_shadow_*.py except _forwarder and _check, once they exist> 2>&1 | tail -1
  ```
- **The dashboard gates:** the suite and the build are **two separate commands**, never one chained line (G1-16's rule: `LiveApp.test.jsx` failed with a build queued behind it).
  ```bash
  cd /c/tmp/inf-a/dashboard
  npx vitest run 2>&1 | tail -5
  ```
  ```bash
  cd /c/tmp/inf-a/dashboard
  npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
  ```
  Filter by file, or by folder with a trailing slash (`npx vitest run src/live/`). Vitest filters by substring.
- **D1 holds.** Nothing under `src/live/` imports anything outside it but the four API modules (`boundaries.test.js`). Every new file is reachable from the page (`reachable.test.js`). No comment under `src/` may contain `import (` or a quoted `import "x"` (the shared import reader takes it for an import).
- **No patient data, ever** (CLAUDE.md rule 6). Fixtures are in-code and synthetic: addresses `192.0.2.x` / `239.20.1.x` (edge) and the engine's YAML scenarios (API). Patient ids are `bed-3`-style. The real table's addresses (`10.10.203.x`) appear only in `deploy/infinity/device-beds.icu2.json` and its review, as they do in `inventory.icu2.json`, never in a test. No checker prints a physiological value.
- **The VMs are read-only for the agent.** Every change is a block the **user pastes** (D-1, D-2, D-3 and the rollbacks). The agent may run the read-only checkers (`transport_check.py`, `shadow_check.py`) over SSH, as 0a did. If this session's permission system refuses one, as it refused two reads during this plan's research, hand the same command to the user; do not look for another way in. **Never print a token**, a key or an env file's values.

---

## File map

**Create:**

| File | Task |
|---|---|
| `homunculus-engine/src/homunculus/api/infinity_shadow.py` | 1 (config), 3 (store), 4 (`board_view`) |
| `homunculus-engine/src/homunculus/api/infinity_device_beds.py` | 2 |
| `homunculus-engine/src/homunculus/edge/infinity_shadow.py` | 6 |
| `deploy/infinity/device-beds.icu2.json` | 2 (unapproved), 13 (approved) |
| `deploy/infinity/device_beds_review.py` | 2 |
| `deploy/infinity/shadow_check.py` | 12 |
| `homunculus-engine/tests/test_infinity_shadow_config.py` | 1 |
| `homunculus-engine/tests/test_infinity_device_beds.py` | 2 |
| `homunculus-engine/tests/test_infinity_shadow_store.py` | 3 |
| `homunculus-engine/tests/test_infinity_shadow_api.py` | 4 |
| `homunculus-engine/tests/test_infinity_shadow_equivalence.py` | 5 |
| `homunculus-engine/tests/test_infinity_shadow_isolation.py` | 5 |
| `homunculus-engine/tests/test_infinity_shadow_forwarder.py` | 6 |
| `homunculus-engine/tests/test_infinity_shadow_check.py` | 12 |
| `dashboard/src/live/data/shadowStore.js` (+ `.test.js`) | 7 |
| `dashboard/src/live/data/ShadowProvider.jsx` | 7 |
| `dashboard/src/live/screens/common/monitor.js` (+ `.test.js`) | 8 |
| `dashboard/src/live/screens/common/MonitorStrip.jsx` (+ `.test.jsx`) | 8 |
| `dashboard/src/live/i18n/strings/monitor.js` | 8 |
| `dashboard/src/live/screens/devices/DevicesScreen.jsx` (+ `.test.jsx`) | 11 |

**Modify:**

| File | Change | Task |
|---|---|---|
| `api/app.py` | `create_app(…, shadow=None)`; the two routes; read-only occupancy | 4 |
| `api/prodserver.py` | `shadow=shadow_settings_from_env(os.environ, _tenants)` | 4 |
| `tenant/bedmap.py` | `lookup()` that does not count | 3 |
| `auth/permissions.py` | `board.view` and `devices.manage` texts | 11 |
| `edge/infinity_hub.py` | `app.state.collector_age` | 6 |
| `homunculus-engine/scripts/run_infinity_transport.py` | start the forwarder when its environment is set | 6 |
| `deploy/infinity/build_transport_release.py` | `EDGE += ("infinity_shadow",)` | 6 |
| `deploy/local/docker-compose.yml`, `deploy/local/.env.example`, `.gitignore` | four env names; the `infinity-shadow` mount; ignore the deployed table | 1, 4 |
| `deploy/local/web/nginx.conf` | `infinity-shadow` in the API prefix list | 4 |
| `homunculus-engine/tests/test_local_compose_env.py`, `test_nginx_routes.py`, `test_infinity_release.py`, `test_api_board_bedmap.py`, `test_permissions.py` (if it pins texts) | as named | 1, 3, 4, 6, 11 |
| `dashboard/src/backendApi.js` (+ test) | `shadowBoard()` | 7 |
| `dashboard/src/live/LiveApp.jsx` | `ShadowProvider` | 7 |
| `dashboard/src/live/boundaries.test.js` | the shadow import rule | 7 |
| `dashboard/src/live/i18n/catalog.js`, `strings.test.js` | `monitor` namespace; neutral labels | 8 |
| `dashboard/src/live/screens/beds/BedsScreen.jsx`, `BedCard.jsx` (+ tests) | chip, section, card strip | 9 |
| `dashboard/src/live/screens/patient/PatientScreen.jsx` (+ test) | strip box | 10 |
| `dashboard/src/live/screens/settings/SettingsScreen.jsx` (+ test) | legend box | 10 |
| `dashboard/src/live/shell/routes.js` (+ test), `i18n/strings/nav.js`, `i18n/strings/perms.js` | `/devices`; texts | 11 |
| `deploy/infinity/README.md`, `docs/INFINITY-PARAMETER-RECORDS.md`, `docs/homunculus-rehber-TR.md` | as deployed | 18 |

**On the VMs (Tasks 14–16 only, user-pasted):**
- **Hub:**
  - `/opt/homunculus-infinity/<R3>/`;
  - drop-ins `92-asama-a-kod.conf` (R3, forwarding off) and `93-asama-a-golge.conf` (`EnvironmentFile=`);
  - `/etc/homunculus-infinity-pilot/shadow-forwarder.env` (root 0600) and `web-ca.pem` (root:homunculus-infinity-pilot 0640, a copy of nginx's self-signed certificate);
  - `/opt/homunculus` checked out at the Stage A tip;
  - `deploy/local/.env`: three or four new lines;
  - `deploy/local/infinity-shadow/device-beds.json`;
  - two image tags `homunculus-rollback/{api,web}:52656da`.
- **Worker:** nothing.
- Nothing else: no inventory, journal, certificate, database, nginx certificate or firewall change.

---
### Task 0: Baseline

**Files:** none changed except this plan, committed into the repo.

- [ ] **Step 1: Make your worktree from 0a's tip**

```bash
git -C /c/tmp/inf-0a log --oneline -1
git -C /c/tmp/inf-0a worktree add /c/tmp/inf-a -b feat/infinity-asama-a feat/infinity-asama0a
cd /c/tmp/inf-a/dashboard
cmd //c "mklink /J node_modules C:\tmp\homunculus-g1\dashboard\node_modules"
git -C /c/tmp/inf-a log --oneline -1
```
Expected: `5bf7c1e fix(infinity): the renewal writes keys owner-only and synced, and names its backup stamp`, then `Junction created for node_modules`.

If 0a's tip is later (its Task 10/11 documents), check that no code moved:
```bash
git -C /c/tmp/inf-a diff --stat 5bf7c1e -- homunculus-engine/src homunculus-engine/scripts deploy dashboard/src
```
It must print nothing. If it does, stop and ask: the line references below were read at `5bf7c1e`.

- [ ] **Step 2: The three gates at base.** Run the Infinity gate (expected **164 passed**), the clinical gate (expected **320 passed, 122 skipped**), then the dashboard suite and, as a separate command, the build. Record all four. The dashboard is expected near G1-15's gate (76 files / 1,809 tests, precache 20); write down what you get, which is the base for Tasks 7–11.

- [ ] **Step 3: The VM, read-only.** Run the hub's acceptance:
```bash
cd /c/tmp/inf-a
ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'python3 - --window 60' < deploy/infinity/transport_check.py
```
Expected `SONUÇ: KABUL` (as on 14.10: lag ~276 ms, 13/13, hub CPU ~8 %). Record it. It is the "before" for Task 14.

- [ ] **Step 4: Commit the plan**
```bash
cd /c/tmp/inf-a
cp /c/tmp/homunculus-plans/2026-10-15-infinity-asama-a-golge.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md
git commit -m "$(cat <<'EOF'
docs(plan): Infinity Aşama A — the unvalidated monitor strip, feeding nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** the four base figures recorded, the hub read KABUL, one commit.

---

### Task 1: The stage switch and the lane's configuration

**Files:**
- Create: `homunculus-engine/src/homunculus/api/infinity_shadow.py` (configuration part), `homunculus-engine/tests/test_infinity_shadow_config.py`
- Modify: `deploy/local/docker-compose.yml`, `deploy/local/.env.example`, `homunculus-engine/tests/test_local_compose_env.py`

- [ ] **Step 1: Write the tests** (`test_infinity_shadow_config.py`, ≈ 10):
  - `test_unset_is_off`: an empty env gives `stage == "off"`, `problem is None`.
  - `test_off_and_shadow_are_read_case_and_space_insensitively`: `" Shadow "` gives `shadow` when the rest is valid.
  - `test_rules_and_alarms_are_not_in_this_build_and_run_as_off`: parametrised. `stage == "off"`, `configured == "rules"`, `problem == "stage_not_implemented"`, and one ERROR log line that contains neither token.
  - `test_an_unknown_value_runs_as_off`: `problem == "stage_unknown"`.
  - `test_shadow_needs_a_token_of_32_or_more`: `token_missing`, `token_weak`.
  - `test_a_tenants_token_or_the_viewer_token_is_refused`: `token_reused`. This is the test that keeps a `TENANTS` token, which passes every permission check, out of the lane.
  - `test_the_hospital_must_be_one_the_api_serves`: `hospital_missing` (empty, or not among `TENANTS`' hospitals).
  - `test_the_token_is_never_in_repr_or_logs`: `repr(settings)` and the captured log hold no token.
  - `test_the_table_path_defaults_inside_the_mounted_directory`: `/etc/homunculus/infinity-shadow/device-beds.json`.

  Run: `ModuleNotFoundError` → red.

- [ ] **Step 2: Write `api/infinity_shadow.py`, configuration part:**

```python
"""Aşama A: the shadow lane. Unvalidated monitor values, shown to clinicians, fed to nothing.

The values are research decoding of bedside-monitor traffic (`edge/infinity_records.py`). They
are displayed in a strip labelled "doğrulanmamış" and are never an observation: nothing here
calls the engine, the audit, the board's broadcaster, the notification hub or the identity
store. `tests/test_infinity_shadow_isolation.py` holds this module to that, by its imports and
by spies; `tests/test_infinity_shadow_equivalence.py` proves that every clinical output is the
same with the stage on or off.

Configuration never stops the API: a clinical service that will not boot over an optional
display feature is the worse failure. A problem makes the stage `off`, says why, and the
device screen shows it.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

STAGES = ("off", "shadow", "rules", "alarms")   # the design's switch (§5)
IMPLEMENTED = ("off", "shadow")                 # this build: Stage A only
MIN_TOKEN = 32
DEFAULT_TABLE_PATH = "/etc/homunculus/infinity-shadow/device-beds.json"


@dataclass(frozen=True)
class ShadowSettings:
    stage: str = "off"                 # what runs: "off" or "shadow"
    configured: str = "off"            # what the environment asked for
    problem: str | None = None
    token: str = field(default="", repr=False)
    hospital: str = ""
    table_path: str = DEFAULT_TABLE_PATH

    @property
    def on(self) -> bool:
        return self.stage == "shadow"


def shadow_settings_from_env(env: Mapping[str, str], tenants: Mapping[str, str]) -> ShadowSettings:
    configured = (env.get("INFINITY_CLINICAL_STAGE", "") or "").strip().lower() or "off"
    table_path = (env.get("INFINITY_DEVICE_BEDS_PATH", "") or "").strip() or DEFAULT_TABLE_PATH
    token = (env.get("INFINITY_SHADOW_TOKEN", "") or "").strip()
    hospital = (env.get("INFINITY_SHADOW_HOSPITAL", "") or "").strip()
    viewer = (env.get("INFINITY_VIEWER_TOKEN", "") or "").strip()

    def off(problem: str | None) -> ShadowSettings:
        if problem:
            # Names the stage and the problem, never a token.
            log.error("INFINITY_CLINICAL_STAGE=%s çalıştırılamıyor (%s); aşama off olarak çalışıyor",
                      configured, problem)
        return ShadowSettings("off", configured, problem, table_path=table_path)

    if configured == "off":
        return off(None)
    if configured not in STAGES:
        return off("stage_unknown")
    if configured not in IMPLEMENTED:
        return off("stage_not_implemented")
    if not token:
        return off("token_missing")
    if len(token) < MIN_TOKEN:
        return off("token_weak")
    if token in tenants or (viewer and token == viewer):
        return off("token_reused")
    if not hospital or hospital not in set(tenants.values()):
        return off("hospital_missing")
    return ShadowSettings("shadow", configured, None, token, hospital, table_path)
```

- [ ] **Step 3: Compose and `.env.example`.**
  - In the `api` service's `environment:`, after the three `INFINITY_HUB_*` lines, add the four names below, with a comment.
  - Add the volume `- ./infinity-shadow:/etc/homunculus/infinity-shadow:ro`, with its comment: a directory, for the `ldap-ca` reason.
  - In `.env.example`, explain each name in Turkish, the way its neighbours are explained. The stage line says "off (varsayılan) | shadow; rules ve alarms bu sürümde yok".

```yaml
      # Aşama A — the unvalidated monitor strip (docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md).
      # Unset = off. The token is the hub forwarder's, NOT a TENANTS device token: it opens
      # POST /infinity-shadow/readings and nothing else.
      INFINITY_CLINICAL_STAGE: ${INFINITY_CLINICAL_STAGE:-}
      INFINITY_SHADOW_TOKEN: ${INFINITY_SHADOW_TOKEN:-}
      INFINITY_SHADOW_HOSPITAL: ${TENANT_SLUG:-demo-hastanesi}
      INFINITY_DEVICE_BEDS_PATH: /etc/homunculus/infinity-shadow/device-beds.json
```
  `INFINITY_SHADOW_HOSPITAL` reads `TENANT_SLUG`, like `TENANTS` and `SEED_TENANT_SLUG`, so the three cannot drift.

- [ ] **Step 4: `test_local_compose_env.py`:** add `_SRC / "api" / "infinity_shadow.py"` to `_MODULES`, and `"INFINITY_CLINICAL_STAGE"` to `_KNOWN`. Run the file alone and see it red **before** Step 3's compose edit if you do them in that order. Otherwise run it after Step 3 and confirm it names all four.

- [ ] **Step 5:** run both gates, then commit `feat(infinity): Aşama A's stage switch, off by default; rules and alarms run as off`.

**Gate:** clinical gate green with +≈ 10; `test_local_compose_env.py` passes and lists the new names.

---

### Task 2: The device→bed table

**Files:**
- Create: `homunculus-engine/src/homunculus/api/infinity_device_beds.py`, `homunculus-engine/tests/test_infinity_device_beds.py`, `deploy/infinity/device-beds.icu2.json`, `deploy/infinity/device_beds_review.py`
- Modify: `.gitignore` (`deploy/local/infinity-shadow/`)

- [ ] **Step 1: Write the tests** (≈ 18, synthetic addresses only):
  - **Accepted:** a valid table with two assigned rows and one unassigned row loads, and `at(source, when)` resolves.
  - **Refused**, one test per rule, each giving its Turkish reason:
    - wrong `schema`;
    - `version` 0;
    - **empty `approved_by` or `approved_at`**;
    - an **unknown key** at the top or in a row (this closes the path to a patient field);
    - a source that is not unicast, a group that is not multicast, port ≠ 2050;
    - a bad `bed_label`;
    - an assigned row without `method`/`verified_at`;
    - an unassigned row without `note`;
    - `valid_to` ≤ `valid_from`;
    - **the same source twice with overlapping intervals**;
    - **two assigned rows with the same bed label and overlapping intervals**;
    - a `bed_id` over 128 characters.
  - **Intervals:** a row whose `valid_to` has passed no longer resolves, and the device is `not_in_table`. A later row takes over the monitor that moved.
  - **The file:**
    - a missing path, a **directory** at the path, unreadable JSON and an invalid table each give `status` `missing` / `invalid`, with **every** device unassigned (fail closed);
    - a changed file is re-read at most every 10 s (injected clock and `stat`);
    - an invalid replacement does **not** keep the old table;
    - `sha256` and `version` are reported.

- [ ] **Step 2: Write `api/infinity_device_beds.py`:** `parse_table(raw) -> DeviceBedTable` (raises `TableError(reason_tr)`), `DeviceBedTable.at(source, when) -> Row | None`, and `TableFile(path, clock, stat=os.stat, read=Path.read_bytes)` with `.current(now) -> (table | None, status, reason, sha256, version)`.
  - Use `ipaddress` for the address checks, exactly as `edge/infinity_stream.py` `Inventory.parse` does.
  - Keep every message free of anything but addresses, labels and the rule broken.
  - Reloads log one line: `cihaz→yatak tablosu yüklendi: sürüm 1, sha256 ab12…, 10 atanmış, 3 atanmamış`. A failure logs: `… okunamadı: <reason>; bütün cihazlar atanmamış`.

- [ ] **Step 3: Write `deploy/infinity/device-beds.icu2.json`.** It holds the 13 rows of the table in "The device→bed table" above:
  - `version: 1`, `"approved_by": ""`, `"approved_at": ""`;
  - `valid_from` = the planned D-3 date, at `T00:00:00Z`;
  - `bed_id`/`unit_id` null;
  - `note` in Turkish, as in the table.

  **It does not load until Task 13 fills the approval.** That is the design: an unapproved table is refused.

- [ ] **Step 4: Write `deploy/infinity/device_beds_review.py`** (stdlib; imports `parse_table` by putting `homunculus-engine/src` on `sys.path`, as the tests do).
  - It prints the table in Turkish, sorted by address, with the columns of the table above and the sha256 of the file's bytes.
  - With `--allow-unapproved` it shows a table whose approval is still empty. That is the only way Task 13 can present it before approval.
  - It prints no token and touches no VM.

- [ ] **Step 5:** gates; commit `feat(infinity): a versioned, approved device→bed table; an unapproved or broken one places no monitor on a bed`.

**Gate:** clinical gate +≈ 18. `python deploy/infinity/device_beds_review.py --allow-unapproved deploy/infinity/device-beds.icu2.json` prints 10 assigned and 3 unassigned rows.

---

### Task 3: The shadow store, and a bed-map lookup that does not count

**Files:**
- Modify: `api/infinity_shadow.py` (store), `tenant/bedmap.py` (`lookup`), `homunculus-engine/tests/test_api_board_bedmap.py` (+2)
- Create: `homunculus-engine/tests/test_infinity_shadow_store.py`

- [ ] **Step 1: `BedMap.lookup` tests** (in `test_api_board_bedmap.py`):
  - `lookup` returns the same `BedRef` as `resolve` for a mapped location, and `None` for an unmapped one;
  - **`unmatched()` is unchanged after any number of `lookup` calls.**

  Red: `AttributeError`.

- [ ] **Step 2: Add to `tenant/bedmap.py`:**

```python
    def lookup(self, unit: str, room: str, bed: str) -> BedRef | None:
        """Look up one location WITHOUT counting a miss.

        For readers that are not the board: the discovery counter is the board's statement of
        which HIS locations its patients arrived from, and a reader that looked up the same
        locations every few seconds (Aşama A's monitor strip) would inflate it into noise."""
        return self._table.get(normalise_key(unit, room, bed))
```

- [ ] **Step 3: Store tests** (`test_infinity_shadow_store.py`, ≈ 14; an injected clock; synthetic sources `192.0.2.x`). Use the wire format above.
  - **Ingest:**
    - a valid body is accepted and its counts are returned;
    - each rejection is counted: `too_old` (> 10 s), `clock` (> 2 s ahead), `unit` (`spo2` in `bpm`), `range` (`spo2` 101; `hr` 0 is **accepted**), `unknown_parameter` (`nbp_systolic`, `respiration_airway`, `foo`), `duplicate` (a `captured_at` not newer than the held one);
    - each schema violation refuses the whole body (`ShadowRejected`): unknown key, 101 devices, 17 readings, a `float('nan')` value, a non-unicast source, a negative `packet_age_ms`.
  - **Views:**
    - `value`, `invalid` and `old` states, at 14.9 s (`value`) and 15.1 s (`old`, number withheld, `last_at` given);
    - a parameter is gone after 120 s;
    - feed states `never`, `ok`, `forwarder_silent` (16 s after the last POST), `collector_disconnected` (the hub reports `collector_age_s` 20);
    - the lag histogram counts `received_at − captured_at`.
  - **Bounds:** 100 devices × 9 parameters stays bounded, and the store's size after many POSTs is constant.
  - **No side door:** the store has no method that takes an engine, an audit or a broadcaster (a test that the class's public attributes are the documented ones).

- [ ] **Step 4: Write the store** in `api/infinity_shadow.py`:

```python
SCHEMA = "homunculus.infinity-shadow.v1"
# parameter -> (wire unit, integrity bounds). Integrity, NOT clinical: a value outside what the
# record can mean is a decoding fault, rejected and counted; 0 is inside every bound.
PARAMETERS = {
    "hr": ("bpm", 0, 350), "pls": ("bpm", 0, 350), "spo2": ("%", 0, 100),
    "etco2": ("mmHg", 0, 150), "temperature": ("C", 0, 50),
    "art_systolic": ("mmHg", 0, 400), "art_diastolic": ("mmHg", 0, 400), "art_mean": ("mmHg", 0, 400),
    "respiration": ("/min", 0, 200),
}
# Design §4.1 / docs/INFINITY-PARAMETER-RECORDS.md:36-50. NBP and airway RESP are absent on purpose:
# NBP's measurement time is not decoded, airway RESP is not verified. N is recorded for none.
EVIDENCE = {
    "hr": "screen_match_two_devices", "pls": "screen_match_two_devices",
    "spo2": "screen_match_two_devices", "etco2": "screen_match_two_devices",
    "art_systolic": "screen_match", "temperature": "screen_match_site_unknown",
    "art_mean": "structural", "art_diastolic": "structural_trend", "respiration": "range_overlap",
}
PARTIAL = frozenset({"temperature", "art_mean", "art_diastolic", "respiration"})
DEVICE_STATUSES = ("streaming", "no_parameters", "stale", "waiting", "unsupported")
MAX_DEVICES, MAX_READINGS, MAX_BODY = 100, 16, 64 * 1024
ARRIVAL_MAX_AGE_S, ARRIVAL_MAX_AHEAD_S = 10.0, 2.0
DISPLAY_MAX_AGE_S, FORGET_AFTER_S, SILENT_AFTER_S = 15.0, 120.0, 15.0
MIN_POST_SPACING_S = 1.0
LAG_BUCKETS_MS = (10, 50, 100, 250, 500, 1000, 3000)      # the 0a histogram's edges
```
  `ShadowStore(clock)` has:
  - `ingest(body) -> dict`, which raises `ShadowRejected` (→ 400) or `TooSoon` (→ 429);
  - `devices(now) -> dict[source, DeviceView]`;
  - `feed(now) -> dict`.

  Readings are kept per `(source, parameter)`. Every check uses `math.isfinite`, `type(x) is bool`/`int`/`float` exactly, as the hub's heartbeat check does (`edge/infinity_hub.py` `update_heartbeat`). Map the hub's `no_parameters` to `standby` and `stale` to `silent` here, once.

- [ ] **Step 5:** gates; commit `feat(infinity): the shadow store, bounded and forgetting, and a bed-map lookup that counts nothing`.

**Gate:** clinical gate +≈ 16, `unmatched()` untouched by `lookup`.

---

### Task 4: The two routes, nginx, and the production wiring

**Files:**
- Modify: `api/app.py`, `api/infinity_shadow.py` (`board_view`), `api/prodserver.py`, `deploy/local/web/nginx.conf`, `homunculus-engine/tests/test_nginx_routes.py`
- Create: `homunculus-engine/tests/test_infinity_shadow_api.py`

- [ ] **Step 1: Tests** (`test_infinity_shadow_api.py`, ≈ 22; `create_app(TENANTS, run_escalation_loop=False, shadow=ShadowSettings(...), bedmap=BedMap({...}), identities=InMemoryIdentityStore())`; a JWT caller via `resolve_jwt` returning a `Caller` with chosen perms, as `test_board_permissions.py` does):
  - **POST:**
    - 409 with stage off;
    - 401 with no token, with a wrong token and **with a `TENANTS` token**;
    - 413 over 64 KiB;
    - 400 for a malformed body;
    - 429 for a second POST within 1 s (the lane's clock injected through `create_app(..., shadow_clock=...)`);
    - 200 with counts.
  - **GET:**
    - `{"stage": "off"}` exactly when off;
    - `{"stage": "off", "configured_stage": "shadow", "problem": "token_weak"}` for a weak token;
    - 401 without a credential;
    - 403 for a JWT holding neither `board.view` nor `devices.manage`;
    - 200 for `board.view`, for `devices.manage` and for a `TENANTS` device token.
  - **Placement:**
    - an assigned device appears in `beds` with the table's label;
    - `.28`-style unassigned rows and devices missing from the table appear in `unassigned`, with `reason` `table_unassigned` / `not_in_table`;
    - with no table file, **every** device is in `unassigned` with `table.status == "missing"`.
  - **Patient link:**
    - one admitted identity on the row's `bed_id` gives `link: "one"` with its `patient_id`;
    - two give `link: "ambiguous"` and no `patient_id`;
    - a discharged one gives `link: "none"`;
    - a `devices.manage`-only caller always gets `link: "hidden"` and `patient_id: null`;
    - **`bedmap.unmatched()` is unchanged after 50 GETs.**
  - **Scope:**
    - a scoped caller (via `resolve_scope`) sees a bed card only for an in-scope `bed_id`/`unit_id`;
    - a row with neither is hidden from them;
    - `unassigned` is empty for them and full for an unrestricted caller and for `devices.manage`.
  - **Board body:** each parameter carries `evidence`, `state` and `age_s`; `display_max_age_s == 15`; `table.sha256` and `version` are present.

- [ ] **Step 2: `board_view(...)`** in `api/infinity_shadow.py`. It is pure, and its arguments are: the store's devices and feed, the table result, an `occupants: dict[bed_id_normalised, list[patient_id]]`, a `visible(card) -> bool`, the flags `may_see_patients` and `unrestricted_or_devices`, and `now`. It returns the board JSON above. Parameters are ordered as `PARAMETERS`; beds by label; unassigned by address.

- [ ] **Step 3: The routes, inside `create_app`.** Add the keyword `shadow: ShadowSettings | None = None`. `None` is `ShadowSettings()`, i.e. off, so every existing test and caller is unchanged. Add a second keyword, `shadow_clock: Callable[[], float] = time.time`: the lane's wall clock, injected by the tests. Build `store = ShadowStore(clock=shadow_clock)` and `table = TableFile(shadow.table_path, clock=time.monotonic)` once, and when the stage is `shadow` load the table right there, so its line (version, sha, counts, or why it failed) is in the API's start-up log, where D-3 reads it. Then:

```python
    def _occupants(hospital: str) -> dict[str, list[str]]:
        """Admitted patients per bed, through the site's bed map — read-only and counting nothing
        (`BedMap.lookup`), cached 10 s. The ONLY bridge between a monitor and a patient in
        Aşama A: an explicit binding the hospital already made (ADT or set_identity), never a
        guess from a name (design K3, K5)."""
        ...

    @app.post("/infinity-shadow/readings")
    async def shadow_readings(request: Request, authorization: str | None = Header(default=None)):
        if not shadow.on:
            raise HTTPException(409, {"reason": "stage_off"})
        provided = (authorization or "").removeprefix("Bearer ")
        if not secrets.compare_digest(provided.encode(), shadow.token.encode()):
            raise HTTPException(401, "unknown credential")
        raw = await request.body()
        if len(raw) > MAX_BODY:
            raise HTTPException(413, "too large")
        try:
            return store.ingest(json.loads(raw))
        except TooSoon:
            raise HTTPException(429, {"reason": "too_soon"}) from None
        except (ShadowRejected, ValueError, RecursionError):
            raise HTTPException(400, {"reason": "rejected"}) from None

    @app.get("/infinity-shadow/board")
    async def shadow_board(authorization: str | None = Header(default=None)):
        caller = await _caller(authorization)
        if not (caller.can(BOARD_VIEW) or caller.can(DEVICES_MANAGE)):
            raise HTTPException(403, detail="permission required: board.view or devices.manage")
        if not shadow.on:
            body = {"stage": "off"}
            if shadow.configured != "off":
                body.update(configured_stage=shadow.configured, problem=shadow.problem)
            return body
        if caller.hospital != shadow.hospital:
            return {"stage": "off"}
        scope = await _scope(authorization)
        ...  # board_view(...) with occupants only when caller.can(BOARD_VIEW)
```
  - `DEVICES_MANAGE` is added to the module's `validate_permissions(...)` line; `Request` joins the `fastapi` import, and `secrets` the standard-library imports.
  - The POST is the only route in the app not reached through `_caller`. That is on purpose: its credential is not a caller, and `_caller` would accept a `TENANTS` token as a device. The isolation test (Task 5) pins that a `TENANTS` token gets 401 here.

- [ ] **Step 4: Production wiring** (`api/prodserver.py`). Add `shadow=shadow_settings_from_env(os.environ, _tenants)` to the `create_app(...)` call.

- [ ] **Step 5: nginx.** Add `infinity-shadow` to the API prefix alternation in `deploy/local/web/nginx.conf` (the `location ~ ^/(auth|admin|…|health)(/|$)` line), after `infinity-research`. Add `"/infinity-shadow/board"` and `"/infinity-shadow/readings"` to `API_PATHS` in `test_nginx_routes.py`.
  - First run `test_nginx_routes.py` **before** the nginx edit: `test_every_app_route_prefix_is_proxied` must be red, naming `/infinity-shadow`. That is the drift guard doing its job.
  - Then edit nginx, and it is green.

- [ ] **Step 6:** both gates; commit `feat(infinity): the shadow lane — a forwarder-only POST and a board GET, scoped, linking a patient only by an explicit bed binding`.

**Gate:** clinical gate +≈ 22; `test_nginx_routes.py` green after being seen red.

---

### Task 5: The gate — nothing clinical changes

**Files:** Create `homunculus-engine/tests/test_infinity_shadow_equivalence.py`, `homunculus-engine/tests/test_infinity_shadow_isolation.py`. **No production file changes in this task.** If a test fails, the fix belongs in the task that made the code, re-opened, with its own commit.

- [ ] **Step 1: The equivalence test**, whole:

```python
"""Aşama A changes nothing clinical: the proof the plan's gate rests on.

Two apps run the same engine inputs: A with the stage off, B with the stage on and the shadow lane
fed, between every step, with monitor values that would raise every alert if they were clinical.
Everything a clinician, a notification or an auditor could ever see must be identical. A negative
control shows the harness can tell a difference. Synthetic scenarios only (the engine's own YAML).
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

import homunculus.api.app as app_module
import homunculus.api.audit as audit_module
import homunculus.api.board as board_module
import homunculus.api.clinical as clinical_module
import homunculus.api.notify as notify_module
import homunculus.api.patient_identity as identity_module
import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog, verify_chain
from homunculus.api.infinity_shadow import ShadowSettings
from homunculus.api.patient_identity import InMemoryIdentityStore
from homunculus.scenarios.loader import load_scenario
from homunculus.tenant.bedmap import BedMap, BedRef

SCEN = Path(homunculus.scenarios.__file__).parent
TOKEN, HOSPITAL = "tok-device-00000000000000000000000000", "HOSP1"
SHADOW = "s" * 40
FROZEN = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
TABLE = {
    "schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic",
    "approved_by": "test", "approved_at": "2026-07-14",
    "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "bed_label": "B-1",
                 "bed_id": "bed-b1", "unit_id": "unit-1", "method": "monitor_screen",
                 "verified_at": "2026-07-14", "valid_from": "2026-07-01T00:00:00Z", "valid_to": None,
                 "note": "synthetic"}],
}


class Frozen(datetime):
    now_value = FROZEN

    @classmethod
    def now(cls, tz=None):
        return cls.now_value


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _freeze(monkeypatch):
    """Every wall-clock read on the clinical path (grep `datetime.now` / `_now_iso` under api/ when
    you write this, and add any new one): two runs must differ ONLY by the shadow lane."""
    Frozen.now_value = FROZEN               # a run that failed half-way must not leak its time
    for module in (app_module, board_module, clinical_module, identity_module):
        monkeypatch.setattr(module, "datetime", Frozen)
    monkeypatch.setattr(audit_module, "_now_iso", lambda: Frozen.now_value.isoformat())
    monkeypatch.setattr(notify_module, "_now_iso", lambda: Frozen.now_value.isoformat())


def _encounter(pid):
    return {"resourceType": "Encounter", "status": "in-progress",
            "subject": {"reference": f"Patient/{pid}"},
            "location": [{"location": {"display": "YB^1^1"}}]}   # shaped like parse_fhir_encounter's tests


def _shadow_body(now):
    readings = [("hr", 180, "bpm"), ("spo2", 70, "%"), ("respiration", 40, "/min"), ("art_systolic", 70, "mmHg")]
    return {"schema": "homunculus.infinity-shadow.v1", "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "status": "streaming",
                         "packet_age_ms": 100,
                         "readings": [{"parameter": p, "value": v, "unit": u, "valid": True, "captured_at": now - 0.5}
                                      for p, v, u in readings]}]}


async def _run(monkeypatch, tmp_path, *, stage, extra_ingest=False):
    _freeze(monkeypatch)
    table = tmp_path / f"{stage}-table.json"
    table.write_text(json.dumps(TABLE), encoding="utf-8")
    settings = (ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(table)) if stage == "shadow"
                else ShadowSettings(table_path=str(table)))
    bedmap = BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")})
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    lane = {"t": 1_800_000_000.0}           # the lane's own clock: advanced 2 s per shadow step
    app = create_app({TOKEN: HOSPITAL}, escalate_after=timedelta(minutes=5), run_escalation_loop=False,
                     audit=audit, identities=identities, bedmap=bedmap, shadow=settings,
                     shadow_clock=lambda: lane["t"])
    frames = app.state.broadcaster.subscribe(HOSPITAL)
    notes = {r: app.state.notification_hub.subscribe(HOSPITAL, r) for r in ("nurse", "doctor")}
    seen = {"patients": [], "alerts": []}
    hdr = {"Authorization": f"Bearer {TOKEN}"}
    events = load_scenario(SCEN / "septic_shock.yaml") + load_scenario(SCEN / "news2_deterioration.yaml")
    pid = events[0][1]["subject"]["reference"].split("/", 1)[1]
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        async def shadow_step():
            if stage == "shadow":
                lane["t"] += 2.0                 # past the lane's 1 s spacing, no sleeping
                body = _shadow_body(lane["t"])
                await c.post("/infinity-shadow/readings", json=body, headers={"Authorization": f"Bearer {SHADOW}"})
                await c.get("/infinity-shadow/board", headers=hdr)

        async def observe():
            seen["patients"].append(json.dumps((await c.get("/patients", headers=hdr)).json(), sort_keys=True))
            seen["alerts"].append(json.dumps((await c.get(f"/alerts/{pid}", headers=hdr)).json(), sort_keys=True))

        await shadow_step()
        await c.post("/ingest", json=_encounter(pid), headers=hdr)
        await shadow_step(); await observe()
        for _ts, fhir in events:
            await c.post("/ingest", json=fhir, headers=hdr)
            await shadow_step(); await observe()
        if extra_ingest:
            await c.post("/ingest", json={**events[0][1], "code": {"coding": [{"code": "heart_rate"}]},
                                          "valueQuantity": {"value": 180}}, headers=hdr)
        await c.post(f"/clinical/{pid}", json={"entries": [{"code": "suspected_infection", "value": 1}]}, headers=hdr)
        await shadow_step(); await observe()
        live = (await c.get(f"/alerts/{pid}", headers=hdr)).json()["alerts"]
        if live:
            await c.post("/ack", json={"patient_id": pid, "kind": live[0]["kind"], "role": "nurse"}, headers=hdr)
        await shadow_step(); await observe()
        for minutes in (1, 6, 12):
            Frozen.now_value = FROZEN + timedelta(minutes=minutes)
            await app.state.escalation_cycle(Frozen.now_value)
            await shadow_step(); await observe()
        Frozen.now_value = FROZEN
    drained = lambda q: [json.dumps(q.get_nowait(), sort_keys=True, default=str) for _ in range(q.qsize())]
    store = app.state.ack_stores[HOSPITAL]
    return {
        **seen,
        "frames": drained(frames),
        "notes": {r: drained(q) for r, q in notes.items()},
        "escalated": sorted(store.escalated),
        "acks": sorted((k, v["by"]) for k, v in store.acks.items()),
        "first_seen": sorted((k, v.isoformat()) for k, v in store.first_seen.items()),
        "audit": [(r.tenant, r.event_type, r.patient_id, r.subject, json.dumps(r.payload, sort_keys=True))
                  for r in audit.records(tenant=HOSPITAL, limit=100_000)],
        "chain_ok": verify_chain(audit.records(tenant=HOSPITAL, limit=100_000)),
        "unmatched": bedmap.unmatched(),
        "identity": identities.get(HOSPITAL, pid),
    }


@pytest.mark.anyio
async def test_every_clinical_output_is_identical_with_the_stage_on_or_off(monkeypatch, tmp_path):
    off = await _run(monkeypatch, tmp_path, stage="off")
    on = await _run(monkeypatch, tmp_path, stage="shadow")
    assert len(off["audit"]) > 0 and len(off["frames"]) > 0 and any(off["notes"].values())  # not vacuous
    for key in off:
        assert on[key] == off[key], key


@pytest.mark.anyio
async def test_the_shadow_lane_actually_ran_in_the_on_app(monkeypatch, tmp_path):
    # Guards against a B that silently ran as off: the readings must have been taken and placed.
    ...  # same run with stage="shadow", then GET /infinity-shadow/board: B-1 linked to pid, hr state "value"


@pytest.mark.anyio
async def test_the_harness_sees_a_real_clinical_difference(monkeypatch, tmp_path):
    off = await _run(monkeypatch, tmp_path, stage="off")
    changed = await _run(monkeypatch, tmp_path, stage="off", extra_ingest=True)
    assert changed["patients"] != off["patients"]
    assert changed["audit"] != off["audit"]
```
  Fit the details to the code: the exact `Encounter` shape `parse_fhir_encounter` accepts, the `/clinical` body, the escalation instants. **Do not change what is compared.**
  - `verify_chain`'s return shape: compare whatever it returns.
  - The lane runs on its own injected clock (`shadow_clock`), advanced 2 s per step, so the test never sleeps; the engine's clock stays frozen. If a step needs a different gap, change the clock, never the comparison.

- [ ] **Step 2: The isolation tests** (`test_infinity_shadow_isolation.py`, ≈ 9), as listed in "The gate", items 2:
  - the AST import rule over the three modules;
  - the six spies (`monkeypatch.setattr` on the instances from `app.state` and on `Engine.ingest`, `InMemoryIdentityStore.apply`, `BedMap.resolve`, each recording calls), around one POST and one GET;
  - the shadow token refused by six clinical routes, and a `TENANTS` token refused by the lane;
  - stage off leaves the store empty after a refused POST;
  - `rules`/`alarms` behave as off.

- [ ] **Step 3: See the gate fail on purpose, then pass.** Before trusting the gate, prove it bites. In a scratch edit you **do not commit**, add `audit.append(AuditEvent(hospital, "shadow", "", "", {}))` to the POST route and run the equivalence file: it must be red on `audit`. Revert with `git checkout -- homunculus-engine/src/homunculus/api/app.py`, run again: green. Write both results into the commit body.

- [ ] **Step 4:** both gates; commit `test(infinity): the gate — every clinical output is byte-identical with Aşama A on or off`.

**Gate:** both files green; the deliberate break seen red; the clinical gate +≈ 12. **Tasks 7–11 do not start before this.**

---

### Task 6: The hub forwarder

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/infinity_shadow.py`, `homunculus-engine/tests/test_infinity_shadow_forwarder.py`
- Modify: `edge/infinity_hub.py`, `homunculus-engine/scripts/run_infinity_transport.py`, `deploy/infinity/build_transport_release.py`, `homunculus-engine/tests/test_infinity_release.py`

- [ ] **Step 1: Tests** (≈ 16; synthetic, reusing `test_infinity_live`'s `inventory`/`event` and `test_infinity_records`'s `record`):
  - **`thin`:**
    - with HR, SpO₂ and NBP records consumed by a `LiveResearchView`, `thin(view.snapshot(), ...)` holds `hr` and `spo2`, and **no `nbp_*`**;
    - `respiration_airway` is never sent;
    - a value aged 3.0 s or more is not sent; 2.9 s is;
    - a `***` record becomes `valid: false, value: null`;
    - a standby payload (`NO_RECORDS`) gives `status: "no_parameters"` and `readings: []`;
    - a device never heard gives `waiting`;
    - **no `device_id` key anywhere in the body**;
    - two consecutive cycles over the same snapshot send each parameter once per cycle (one cycle = one body; there is no second value for the same parameter inside it);
    - units are the decoder's (`"C"` for temperature, already ÷10).
  - **`forward_loop`** (a fake clock, a fake sender, `stop` set after N cycles):
    - it sends every 5 s;
    - a sender error is counted and the loop goes on;
    - 409 and 401 back off to 60 s;
    - log lines appear only on state changes, and **the token never appears in any log record**.
  - **`settings_from_env`:**
    - none of the three variables gives `None` (forwarding off);
    - all three valid gives settings;
    - a partial set raises `ValueError("Shadow forwarding misconfigured …")`;
    - `http://` raises;
    - a token under 32 raises.
  - **The hub:** `create_hub(...).state.collector_age()` is `None` before a heartbeat and ≈ the elapsed time after one.
  - **End to end, no network:** a `ShadowSender` whose transport is the API's `TestClient` delivers a `thin` body into `create_app(..., shadow=…)`, and `GET /infinity-shadow/board` shows the synthetic bed with `hr` `value`. This is the test that keeps the two sides of the wire in step.
  - **The release** (`test_infinity_release.py`): `infinity_shadow.py` is in the tarball and in `SHA256SUMS`.

- [ ] **Step 2: Write `edge/infinity_shadow.py`:**

```python
"""Aşama A forwarder: the hub's live research values, thinned, to the clinical API's shadow lane.

Display only. The API shows these values in a strip labelled "doğrulanmamış" and feeds them to
nothing: no rule, score, alert, notification or audit row. This is NOT clinical forwarding, and
the hub keeps saying `clinical_forwarding: False`. No imports outside `homunculus.edge` and the
standard library: the release packs only `edge/` (deploy/infinity/build_transport_release.py).

One body per cycle: for each device, its status and, for each forwarded parameter, the value the
live view holds now — at most one value per parameter per device per INTERVAL_S. A device is
named by its address only; a bed comes from the API's approved table, never from here.
"""
from __future__ import annotations

import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.request

SCHEMA = "homunculus.infinity-shadow.v1"
INTERVAL_S = 5.0
MAX_FORWARD_AGE_MS = 3000.0          # = infinity_live.STALE_AFTER_MS: nothing older leaves the hub
BACKOFF_S = 60.0                     # after 401 or 409
TIMEOUT_S = 3.0
MIN_TOKEN = 32
# NBP is absent on purpose (measurement time not decoded); so is airway RESP (layout unverified).
FORWARDED = ("hr", "pls", "spo2", "etco2", "temperature",
             "art_systolic", "art_diastolic", "art_mean", "respiration")

log = logging.getLogger(__name__)


def settings_from_env(env):
    url = (env.get("INFINITY_SHADOW_URL") or "").strip()
    token = (env.get("INFINITY_SHADOW_TOKEN") or "").strip()
    ca_file = (env.get("INFINITY_SHADOW_CA_FILE") or "").strip()
    if not (url or token or ca_file):
        return None
    if not (url and token and ca_file) or not url.startswith("https://") or len(token) < MIN_TOKEN:
        raise ValueError("Shadow forwarding misconfigured: INFINITY_SHADOW_URL (https), "
                         "INFINITY_SHADOW_TOKEN (>= 32) and INFINITY_SHADOW_CA_FILE must all be set.")
    return {"url": url, "token": token, "ca_file": ca_file}


def thin(snapshot, *, now, collector_age, counters):
    devices = []
    for device in snapshot["devices"]:
        readings = []
        for name in FORWARDED:
            entry = device["parameters"].get(name)
            if entry is None or entry["age_ms"] >= MAX_FORWARD_AGE_MS or entry["status"] == "stale":
                continue
            valid = entry["status"] == "candidate"
            readings.append({"parameter": name, "value": entry["value"] if valid else None,
                             "unit": entry["unit"], "valid": valid,
                             "captured_at": float(entry["capture_epoch"])})
        age = device["packet_age_ms"]
        devices.append({"source": device["source_ip"], "group": device["group"], "port": 2050,
                        "status": device["status"], "packet_age_ms": None if age is None else float(age),
                        "readings": readings})
    return {"schema": SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": INTERVAL_S, "sent": counters["sent"], "failed": counters["failed"],
                          "decoder": snapshot.get("schema")},
            "hub": {"collector_age_s": collector_age,
                    "accepted_packets": snapshot.get("accepted_packets", 0),
                    "old_or_duplicate_packets": snapshot.get("old_or_duplicate_packets", 0)},
            "devices": devices}


class ShadowSender:
    """POST one body; returns the HTTP status (or 0 for a network failure). Never raises, never logs
    the token or the body."""
    def __init__(self, url, token, ca_file, *, opener=None):
        self.url, self._token = url, token
        context = ssl.create_default_context(cafile=ca_file)
        self._opener = opener or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))

    def send(self, body):
        request = urllib.request.Request(self.url, data=json.dumps(body, allow_nan=False).encode(),
                                         method="POST", headers={"Authorization": "Bearer " + self._token,
                                                                 "Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=TIMEOUT_S) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
        except (urllib.error.URLError, OSError, ssl.SSLError, ValueError):
            return 0


def forward_loop(view, sender, stop, *, collector_age, clock=time.time, wait=None):
    wait = wait or stop.wait
    counters, state = {"sent": 0, "failed": 0}, "starting"
    while not stop.is_set():
        status = sender.send(thin(view.snapshot(), now=clock(), collector_age=collector_age(), counters=counters))
        if status == 200:
            counters["sent"] += 1
            new, pause = "ok", INTERVAL_S
        else:
            counters["failed"] += 1
            new = {401: "token_refused", 409: "stage_off", 429: "too_soon"}.get(status, f"failing_{status}")
            pause = BACKOFF_S if status in (401, 409) else INTERVAL_S
        if new != state:
            log.warning("Aşama A forwarder: %s -> %s", state, new)   # one line per change, no token, no value
            state = new
        wait(pause)
```
  Fit `thin` to the live view's actual snapshot keys: `device_id`, `source_ip`, `group`, `status`, `packets`, `packet_age_ms`, `parameters[name]` with `value`, `status`, `unit`, `age_ms`, `capture_epoch` (`edge/infinity_live.py` `snapshot`). The test is the contract.

- [ ] **Step 3: The hub accessor** (`edge/infinity_hub.py`). After `heartbeat = {...}`, add:

```python
    # Aşama A's forwarder reads how long ago the collector last spoke, so the board can say "the
    # collector is not connected" instead of "13 monitors silent". Read-only; nothing else changes.
    app.state.collector_age = lambda: None if heartbeat["seen"] is None else max(0.0, clock() - heartbeat["seen"])
```

- [ ] **Step 4: The runner** (`scripts/run_infinity_transport.py`), in the hub branch, after `app = create_hub(...)` and before `uvicorn.run`:

```python
            from homunculus.edge.infinity_shadow import ShadowSender, forward_loop, settings_from_env
            shadow = settings_from_env(os.environ) if research_view is not None else None
            if shadow is not None:
                sender = ShadowSender(shadow["url"], shadow["token"], shadow["ca_file"])
                threading.Thread(target=forward_loop, args=(research_view, sender, stop),
                                 kwargs={"collector_age": app.state.collector_age}, daemon=True).start()
                print("Shadow display forwarding ENABLED (Stage A, unvalidated; not clinical ingest) every 5 s.",
                      flush=True)
```
  `settings_from_env`'s `ValueError` is caught by the runner's existing `except (OSError, ValueError, KeyError)`. **Change only that handler's message** so it adds "or shadow forwarding". The hub then stops with a clear line, and the H-A2 block sees it.

- [ ] **Step 5: The release.** Add `"infinity_shadow"` to `EDGE` in `deploy/infinity/build_transport_release.py`.

- [ ] **Step 6:** the Infinity gate (and the clinical gate for the end-to-end test); commit `feat(infinity): the hub's Aşama A forwarder — thinned, fresh, no NBP, off unless its environment is set`.

**Gate:** Infinity gate 164 → +≈ 16, green; the 0a files untouched in behaviour (their counts unchanged).

---
### Task 7: The dashboard's data layer, kept out of every alarm path

**Files:**
- Create: `dashboard/src/live/data/shadowStore.js`, `dashboard/src/live/data/shadowStore.test.js`, `dashboard/src/live/data/ShadowProvider.jsx`
- Modify: `dashboard/src/backendApi.js` (+ `backendApi.test.js`), `dashboard/src/live/LiveApp.jsx`, `dashboard/src/live/boundaries.test.js`

- [ ] **Step 1: Tests first.**
  - **`backendApi.test.js`:** `shadowBoard()` issues an authed `GET /infinity-shadow/board`.
  - **`shadowStore.test.js`** (≈ 12; fake `api`, fake timers, fake visibility):
    - nothing is fetched before `start()`, nor after `start()` with no consumer;
    - the first `acquire()` fetches at once and then every **5 s**; the last `release()` stops it;
    - a hidden tab pauses and a visible one resumes with an immediate fetch;
    - a failed fetch gives `phase: "unreadable"` **and keeps `data`** (ageing is the screen's job);
    - `clear()` drops an answer that arrives after it (the generation guard, as in `boardStore`);
    - `start()` for a session lacking both `board.view` and `devices.manage` never fetches;
    - `{"stage": "off"}` is held as data, and the screens draw nothing.
    - **Isolation:** with a `createBoardStore` and a `createShadowStore` fed fakes, ten shadow polls of a board that has readings leave `board.getState()` **the identical object**, and `alarmsToSignal`, `waitingAlarms`, `alarmCounts` and `lockSummary` deep-equal to their values before.
  - **`boundaries.test.js`**, a new `describe("the monitor strip never reaches an alarm path")`. Read with `importsOf` every source file under `src/live/signals/` and `src/live/shell/`, plus `src/live/auth/LockScreen.jsx` and `src/live/data/boardStore.js`. Resolve each relative spec, and assert none names `data/shadowStore.js`, `data/ShadowProvider.jsx`, `screens/common/monitor.js`, `screens/common/MonitorStrip.jsx` or anything under `screens/devices/`.

  Red: the module is missing, and the boundary test passes vacuously until the files exist. That is why the test also asserts that **the shadow files exist** (`fs.existsSync`), so it cannot pass by their absence.

- [ ] **Step 2: Write `backendApi.shadowBoard()`:**

```js
    /** Aşama A: the unvalidated monitor strip (GET /infinity-shadow/board). `{stage: "off"}` when
     *  the hospital has not turned it on. Read by the shadow store only — never by the board store,
     *  the bell, the sound, the notifications or the lock screen (boundaries.test.js). */
    shadowBoard() {
      return authed("/infinity-shadow/board");
    },
```

- [ ] **Step 3: Write `shadowStore.js`.** It is framework-free, in `boardStore`'s style: `createShadowStore({ api, track, setTimer, clearTimer, isVisible, onVisibility })` returning `getState`, `subscribe`, `start(perms)`, `acquire()`, `release()`, `clear()`. Its header comment states the three rules: never on a locked screen, never into an alarm path, values age on screen. `POLL_MS = 5000`.

- [ ] **Step 4: `ShadowProvider.jsx` and `LiveApp.jsx`.**
  - `useShadow()` acquires on mount and releases on unmount, and returns `{...state, nowMs}` with a 1 s `useNow` tick (ages on the strip move by the second).
  - In `LiveApp`'s `Phases`, start the shadow store when `phase === PHASE.READY` and the user holds `board.view` or `devices.manage`. Clear it otherwise. **`LOCKED` clears it.** The lock screen shows counts only, by Decision 3 of Wave 2, and no monitor value.
  - Add `<ShadowProvider>` inside `BoardProvider`. **Not** around `AlarmSignals`: the provider wraps `Phases` only.

- [ ] **Step 5:** the dashboard suite, then the build (two commands); commit `feat(dashboard): the shadow store — polled only while shown, never on the lock screen, never in an alarm path`.

**Gate:** suite +≈ 14, green; build clean; `reachable.test.js` green (the new files are reached through `LiveApp`).

---

### Task 8: The strip, and its words in four languages

**Files:**
- Create: `dashboard/src/live/screens/common/monitor.js` (+ `.test.js`), `dashboard/src/live/screens/common/MonitorStrip.jsx` (+ `.test.jsx`), `dashboard/src/live/i18n/strings/monitor.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`

- [ ] **Step 1: Tests.**
  - **`monitor.test.js`** (pure, ≈ 10):
    - `displayAge` adds the time since the fetch;
    - `cellOf` gives `value` at 14.9 s, `old` at 15.1 s (no number), `invalid` for `***`, and `old` for a `value` whose display age crossed 15 s between polls;
    - `chipCounts` counts `silent` + `waiting` + `unknown` as silent, `standby` separately and unassigned separately;
    - `feedSentenceKey` maps `never`, `forwarder_silent` and `collector_disconnected` to their keys and `ok` to `null`;
    - `PARAM_ORDER` is the API's order;
    - `UNIT_KEY` maps `bpm` and `/min` to `board.unitBpm`, `%` to `board.unitPct`, `mmHg` to `board.unitMmhg` and `C` to `board.unitC`.
  - **`MonitorStrip.test.jsx`** (≈ 14, by role and name):
    - the heading reads "Monitor · təsdiqlənməyib" in the default language and "Monitör · doğrulanmamış" in `tr`;
    - the tag is present; the compact variant shows the short note, the full variant the full note;
    - a value shows with its age; an `old` value shows `—` and "eski"; `***` shows with the screen-reader sentence;
    - `standby`/`silent`/`waiting`/`unknown` replace the values with their sentence;
    - `art_mean` carries "kısmi" and `hr` does not;
    - the full variant shows the evidence text;
    - **no element carries a risk or vital-identity class** (a list: `bg-crit text-crit bg-high text-high bg-mid bg-low bg-ok text-ok text-v-hr text-v-map text-v-spo text-v-rr text-v-t`);
    - **no `aria-live`, no `role="alert"`**;
    - there are no numbers from a stage-off board.

- [ ] **Step 2: Write `strings/monitor.js`**, whole. The parameter labels are the monitor's own, so a reader can match the strip to the bedside screen. They are language-neutral.

```js
// src/live/i18n/strings/monitor.js — Aşama A's unvalidated monitor strip.
//
// Every clinician who can open the board sees these words (user decision 2, 14.10). They must say
// three things unmistakably, in every language: the values are UNVALIDATED research decoding; they
// are not a measurement to decide by; nothing — no alert, score, notification or sound — comes from
// them. The bedside monitor stays the primary alarm. AZ/RU/EN await a native-speaking clinician's
// review, and for this namespace that review is a deploy gate (plan, "Kullanıcıdan gerekenler" 4).
//
// `p.*` are the monitor's own labels, so the strip can be read against the bedside screen; they are
// language-neutral (strings.test.js NEUTRAL, AZ_SAME_AS_TR). `ev.*` restate the design's §4.1 and
// docs/INFINITY-PARAMETER-RECORDS.md:36-50 — no sample count is recorded for any, and `legendN` says so.
const p = {
  hr: "HR", pls: "PLS", spo2: "SpO₂", etco2: "etCO₂", temperature: "Ta",
  art_systolic: "ART S", art_diastolic: "ART D", art_mean: "ART M", respiration: "RESP",
};

export default {
  tr: {
    title: "Monitör · doğrulanmamış",
    tag: "DOĞRULANMAMIŞ",
    short: "Araştırma çözümlemesi · karar için ölçüm değildir · uyarı üretmez",
    full: "Bu değerler başucu monitörünün ağ yayınından araştırma amacıyla çözülüyor ve doğrulanmadı. Karar için başucu monitörüne bakın. Bu değerlerden hiçbir uyarı, skor (NEWS2 dahil), bildirim ya da ses üretilmez; birincil alarm başucu monitörünün kendi alarmıdır.",
    noSound: "Bu şerit hiçbir zaman ses çıkarmaz, bildirim göndermez, alarm listesine ve zile girmez.",
    section: "Monitörler — doğrulanmamış",
    sectionSub: "Bir hasta kartına bağlanmamış monitörler. Değerler hiçbir hastaya yazılmaz.",
    bedTitle: "{bed} · monitör",
    noPatient: "Bu yatağa bağlı hasta kaydı yok",
    ambiguous: "Bu yatakta birden çok etkin hasta kaydı var — monitör hiçbirine bağlanmadı",
    unassignedTitle: "Atanmamış cihaz · {source}",
    unassignedNote: "Hangi yatakta olduğu doğrulanmadı — bu değerler hiçbir hastaya ait gösterilmez",
    reasonUnassigned: "Cihaz→yatak tablosunda yatağı çözülmemiş",
    reasonNotInTable: "Cihaz→yatak tablosunda yok",
    reasonTable: "Cihaz→yatak tablosu yok ya da geçersiz",
    standby: "Monitör beklemede",
    silent: "Monitör susuyor · son veri {time}",
    silentNoTime: "Monitör susuyor",
    waiting: "Veri bekleniyor",
    unsupported: "Çözülemeyen veri",
    unknown: "Bu monitörden haber yok",
    invalid: "monitör geçerli değer göstermiyor",
    old: "eski · {age}",
    age: "{age} önce",
    partial: "kısmi",
    partialHint: "kısmi doğrulama — Ayarlar › Sinyaller'deki tabloya bakın",
    chipTitle: "Monitör (doğrulanmamış)",
    chipCounts: "{streaming}/{total} veri gönderiyor",
    chipSilent: "{count} susuyor",
    chipStandby: "{count} beklemede",
    chipUnassigned: "{count} atanmamış",
    feedForwarder: "Monitör verisi gelmiyor (son: {time}) — aktarım ya da Infinity sunucusu durmuş olabilir",
    feedNever: "Monitör aktarımı henüz başlamadı",
    feedCollector: "Monitör ağ toplayıcısı bağlı değil — hiçbir monitörden veri alınmıyor",
    unreadable: "Monitör şeridi okunamıyor",
    tableMissing: "Cihaz→yatak tablosu yok ya da geçersiz: hiçbir monitör bir yatağa yazılmıyor",
    off: "Monitör şeridi kapalı",
    offProblem: "Monitör şeridi açılamadı: {problem}",
    legendTitle: "Monitör şeridi (doğrulanmamış)",
    legendAges: "Her değerin yanında yaşı yazar. 15 saniyeden eski bir değer gösterilmez; yerine «eski» ve son değerin saati yazar.",
    legendNbp: "NIBP bu aşamada gösterilmez: ölçüm zamanı çözülmedi, değer saatler önceki bir ölçüm olabilir. Kan basıncını başucu monitöründen okuyun.",
    legendEvidence: "Parametre başına bugünkü kanıt",
    legendN: "Örnek sayısı hiçbir parametre için kayıtlı değil.",
    tableVersion: "Tablo sürümü {version} · {sha}",
    ev: {
      screen_match_two_devices: "İki cihazda monitör ekranıyla birebir",
      screen_match: "Monitör ekranıyla birebir",
      screen_match_site_unknown: "Monitör ekranıyla birebir; ölçüm yeri bilinmiyor",
      structural: "Yalnız yapısal kontrol (MAP bağıntısı); ekranla karşılaştırılmadı",
      structural_trend: "MAP bağıntısı ve ekran eğilimi",
      range_overlap: "Tek yatakta aralık örtüşmesi; ekranla birebir değil",
    },
    p,
  },
  az: {
    title: "Monitor · təsdiqlənməyib",
    tag: "TƏSDİQLƏNMƏYİB",
    short: "Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · xəbərdarlıq yaratmır",
    full: "Bu dəyərlər çarpayı yanındakı monitorun şəbəkə yayımından tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib. Qərar üçün çarpayı yanındakı monitora baxın. Bu dəyərlərdən heç bir xəbərdarlıq, bal (NEWS2 daxil), bildiriş və ya səs yaradılmır; əsas həyəcan siqnalı çarpayı yanındakı monitorun öz siqnalıdır.",
    noSound: "Bu zolaq heç vaxt səs çıxarmır, bildiriş göndərmir, həyəcan siyahısına və zəngə düşmür.",
    section: "Monitorlar — təsdiqlənməyib",
    sectionSub: "Heç bir xəstə kartına bağlanmamış monitorlar. Dəyərlər heç bir xəstəyə yazılmır.",
    bedTitle: "{bed} · monitor",
    noPatient: "Bu çarpayıya bağlı xəstə qeydi yoxdur",
    ambiguous: "Bu çarpayıda bir neçə aktiv xəstə qeydi var — monitor heç birinə bağlanmayıb",
    unassignedTitle: "Təyin edilməmiş cihaz · {source}",
    unassignedNote: "Hansı çarpayıda olduğu təsdiqlənməyib — bu dəyərlər heç bir xəstəyə aid göstərilmir",
    reasonUnassigned: "Cihaz→çarpayı cədvəlində çarpayısı müəyyənləşdirilməyib",
    reasonNotInTable: "Cihaz→çarpayı cədvəlində yoxdur",
    reasonTable: "Cihaz→çarpayı cədvəli yoxdur və ya etibarsızdır",
    standby: "Monitor gözləmə rejimindədir",
    silent: "Monitor susur · son məlumat {time}",
    silentNoTime: "Monitor susur",
    waiting: "Məlumat gözlənilir",
    unsupported: "Deşifrə olunmayan məlumat",
    unknown: "Bu monitordan xəbər yoxdur",
    invalid: "monitor etibarlı dəyər göstərmir",
    old: "köhnə · {age}",
    age: "{age} əvvəl",
    partial: "qismən",
    partialHint: "qismən yoxlanılıb — Ayarlar › Siqnallar bölməsindəki cədvələ baxın",
    chipTitle: "Monitor (təsdiqlənməyib)",
    chipCounts: "{streaming}/{total} məlumat göndərir",
    chipSilent: "{count} susur",
    chipStandby: "{count} gözləmədə",
    chipUnassigned: "{count} təyin edilməyib",
    feedForwarder: "Monitor məlumatı gəlmir (son: {time}) — ötürmə və ya Infinity serveri dayanmış ola bilər",
    feedNever: "Monitor məlumatının ötürülməsi hələ başlamayıb",
    feedCollector: "Monitor şəbəkə toplayıcısı qoşulmayıb — heç bir monitordan məlumat alınmır",
    unreadable: "Monitor zolağı oxunmur",
    tableMissing: "Cihaz→çarpayı cədvəli yoxdur və ya etibarsızdır: heç bir monitor çarpayıya yazılmır",
    off: "Monitor zolağı söndürülüb",
    offProblem: "Monitor zolağı açıla bilmədi: {problem}",
    legendTitle: "Monitor zolağı (təsdiqlənməyib)",
    legendAges: "Hər dəyərin yanında onun yaşı yazılır. 15 saniyədən köhnə dəyər göstərilmir; əvəzində «köhnə» və son dəyərin vaxtı yazılır.",
    legendNbp: "NIBP bu mərhələdə göstərilmir: ölçmə vaxtı deşifrə olunmayıb, dəyər saatlar əvvəlki ölçmə ola bilər. Qan təzyiqini çarpayı yanındakı monitordan oxuyun.",
    legendEvidence: "Hər parametr üzrə bugünkü sübut",
    legendN: "Heç bir parametr üçün nümunə sayı qeydə alınmayıb.",
    tableVersion: "Cədvəl versiyası {version} · {sha}",
    ev: {
      screen_match_two_devices: "İki cihazda monitor ekranı ilə eynidir",
      screen_match: "Monitor ekranı ilə eynidir",
      screen_match_site_unknown: "Monitor ekranı ilə eynidir; ölçmə yeri məlum deyil",
      structural: "Yalnız struktur yoxlama (MAP əlaqəsi); ekranla müqayisə edilməyib",
      structural_trend: "MAP əlaqəsi və ekrandakı tendensiya",
      range_overlap: "Bir çarpayıda diapazonların üst-üstə düşməsi; ekranla eyni deyil",
    },
    p,
  },
  ru: {
    title: "Монитор · не проверено",
    tag: "НЕ ПРОВЕРЕНО",
    short: "Исследовательское декодирование · не измерение для принятия решений · не создаёт оповещений",
    full: "Эти значения в исследовательских целях декодируются из сетевой трансляции прикроватного монитора и не проверены. Для принятия решений смотрите на прикроватный монитор. Никакие оповещения, шкалы (включая NEWS2), уведомления или звуки из этих значений не создаются; основной сигнал тревоги — собственная тревога прикроватного монитора.",
    noSound: "Эта полоса никогда не издаёт звук, не отправляет уведомления и не попадает в список тревог и в колокольчик.",
    section: "Мониторы — не проверено",
    sectionSub: "Мониторы, не привязанные к карточке пациента. Значения ни одному пациенту не записываются.",
    bedTitle: "{bed} · монитор",
    noPatient: "К этой койке не привязана запись пациента",
    ambiguous: "На этой койке несколько активных записей пациентов — монитор ни к одной не привязан",
    unassignedTitle: "Неназначенное устройство · {source}",
    unassignedNote: "Койка не подтверждена — эти значения не показываются как принадлежащие какому-либо пациенту",
    reasonUnassigned: "В таблице «устройство→койка» койка не определена",
    reasonNotInTable: "Нет в таблице «устройство→койка»",
    reasonTable: "Таблица «устройство→койка» отсутствует или недействительна",
    standby: "Монитор в режиме ожидания",
    silent: "Монитор молчит · последние данные {time}",
    silentNoTime: "Монитор молчит",
    waiting: "Ожидание данных",
    unsupported: "Нераспознанные данные",
    unknown: "Нет сведений от этого монитора",
    invalid: "монитор не показывает достоверного значения",
    old: "устарело · {age}",
    age: "{age} назад",
    partial: "частично",
    partialHint: "частичная проверка — см. таблицу в разделе Настройки › Сигналы",
    chipTitle: "Монитор (не проверено)",
    chipCounts: "{streaming}/{total} передают данные",
    chipSilent: "молчат: {count}",
    chipStandby: "в ожидании: {count}",
    chipUnassigned: "не назначено: {count}",
    feedForwarder: "Данные мониторов не поступают (последние: {time}) — возможно, остановлена передача или сервер Infinity",
    feedNever: "Передача данных мониторов ещё не началась",
    feedCollector: "Сетевой сборщик мониторов не подключён — данные ни от одного монитора не поступают",
    unreadable: "Не удаётся загрузить полосу монитора",
    tableMissing: "Таблица «устройство→койка» отсутствует или недействительна: ни один монитор не привязан к койке",
    off: "Полоса монитора выключена",
    offProblem: "Не удалось включить полосу монитора: {problem}",
    legendTitle: "Полоса монитора (не проверено)",
    legendAges: "Рядом с каждым значением указан его возраст. Значение старше 15 секунд не показывается; вместо него — «устарело» и время последнего значения.",
    legendNbp: "НИАД на этом этапе не показывается: время измерения не декодировано, значение может быть многочасовой давности. Смотрите давление на прикроватном мониторе.",
    legendEvidence: "Текущие подтверждения по каждому параметру",
    legendN: "Число наблюдений не записано ни для одного параметра.",
    tableVersion: "Версия таблицы {version} · {sha}",
    ev: {
      screen_match_two_devices: "Совпадает с экраном монитора на двух устройствах",
      screen_match: "Совпадает с экраном монитора",
      screen_match_site_unknown: "Совпадает с экраном монитора; место измерения неизвестно",
      structural: "Только структурная проверка (соотношение для среднего АД); с экраном не сравнивалось",
      structural_trend: "Соотношение для среднего АД и тренд на экране",
      range_overlap: "Перекрытие диапазонов на одной койке; с экраном не совпадает побуквенно",
    },
    p,
  },
  en: {
    title: "Monitor · unvalidated",
    tag: "UNVALIDATED",
    short: "Research decoding · not a measurement for decisions · raises no alerts",
    full: "These values are decoded, for research, from the bedside monitor's network broadcast and have not been validated. Look at the bedside monitor for decisions. No alert, score (NEWS2 included), notification or sound is produced from them; the bedside monitor's own alarm remains the primary alarm.",
    noSound: "This strip never sounds, never notifies, and never enters the alarm list or the bell.",
    section: "Monitors — unvalidated",
    sectionSub: "Monitors not linked to a patient card. Their values are written to no patient.",
    bedTitle: "{bed} · monitor",
    noPatient: "No patient record is linked to this bed",
    ambiguous: "This bed has more than one active patient record — the monitor is linked to none",
    unassignedTitle: "Unassigned device · {source}",
    unassignedNote: "Its bed is not confirmed — these values are not shown as any patient's",
    reasonUnassigned: "Its bed is unresolved in the device→bed table",
    reasonNotInTable: "Not in the device→bed table",
    reasonTable: "The device→bed table is missing or invalid",
    standby: "Monitor in standby",
    silent: "Monitor silent · last data {time}",
    silentNoTime: "Monitor silent",
    waiting: "Waiting for data",
    unsupported: "Undecodable data",
    unknown: "Nothing heard from this monitor",
    invalid: "the monitor shows no valid value",
    old: "old · {age}",
    age: "{age} ago",
    partial: "partial",
    partialHint: "partially checked — see the table under Settings › Signals",
    chipTitle: "Monitor (unvalidated)",
    chipCounts: "{streaming}/{total} sending data",
    chipSilent: "{count} silent",
    chipStandby: "{count} in standby",
    chipUnassigned: "{count} unassigned",
    feedForwarder: "No monitor data arriving (last: {time}) — the forwarding or the Infinity server may have stopped",
    feedNever: "Monitor forwarding has not started yet",
    feedCollector: "The monitor network collector is not connected — no data from any monitor",
    unreadable: "The monitor strip cannot be loaded",
    tableMissing: "Device→bed table missing or invalid: no monitor is placed on a bed",
    off: "The monitor strip is off",
    offProblem: "The monitor strip could not be turned on: {problem}",
    legendTitle: "Monitor strip (unvalidated)",
    legendAges: "Each value shows its age. A value older than 15 seconds is not shown; «old» and the time of the last value are shown instead.",
    legendNbp: "NIBP is not shown at this stage: its measurement time is not decoded, so the value may be hours old. Read blood pressure on the bedside monitor.",
    legendEvidence: "Today's evidence per parameter",
    legendN: "No sample count is recorded for any parameter.",
    tableVersion: "Table version {version} · {sha}",
    ev: {
      screen_match_two_devices: "Identical to the monitor screen on two devices",
      screen_match: "Identical to the monitor screen",
      screen_match_site_unknown: "Identical to the monitor screen; measurement site unknown",
      structural: "Structural check only (MAP relation); not compared with the screen",
      structural_trend: "MAP relation and the screen's trend",
      range_overlap: "Range overlap on one bed; not identical to the screen",
    },
    p,
  },
};
```
  If the catalogue flattens only one level, flatten `ev.*` and `p.*` to `evScreenMatch…` / `pHr…` and adjust the components. Read `catalog.js` `buildDictionaries` first.

- [ ] **Step 3: Register the namespace** in `catalog.js`: its own import line and its own entry, each with a blank line either side, per the file's rule. In `strings.test.js`, add the nine `monitor.p.*` keys under a new `// Aşama A (monitor) · neutral` heading in `NEUTRAL`, and under `// Aşama A (monitor) · az = tr` in `AZ_SAME_AS_TR`. Then `npx vitest run src/live/i18n/` must be green: every key in four languages, placeholders equal.

- [ ] **Step 4: Write `monitor.js` and `MonitorStrip.jsx`** to the display rules in "The dashboard" above.
  - `MonitorStrip({ entry, variant, nowMs, fetchedAtMs, maxAgeS })`.
  - `MonitorFeedChip({ data, phase })`, which uses `Pill` and the `wifi` icon like `FeedHealth`, with an sr-only title. When `feed.state` is not `ok` it renders a `Note tone="warn"` with the feed sentence instead of counts.

- [ ] **Step 5:** suite, then build; commit `feat(dashboard): the monitor strip — "doğrulanmamış" in four languages, ages on every value, nothing coloured by a value`.

**Gate:** suite +≈ 24, green; `src/live/i18n/` green; build clean.

---

### Task 9: The beds screen and the bed card

**Files:** Modify `dashboard/src/live/screens/beds/BedsScreen.jsx`, `BedCard.jsx`, `BedsScreen.test.jsx`, `BedCard.test.jsx`.

- [ ] **Step 1: Tests** (≈ 12):
  - **Stage off** (the shadow store holds `{stage: "off"}`): no element with `[data-monitor]` on the screen, no monitor chip, and every existing `BedsScreen` and `BedCard` test unchanged and green.
  - **Stage shadow**, with a board of two patient cards and a shadow board of three assigned beds (one linked to a card) and two unassigned devices:
    - the linked card holds a compact strip;
    - the section "Monitörler — doğrulanmamış" holds the two unlinked beds and the two unassigned cards, **after** the patient list (DOM order);
    - the chip counts are right;
    - a unit filter hides the beds of another unit and both unassigned cards, and the "hidden" line counts them;
    - the search matches a bed label;
    - `feed.state: "forwarder_silent"` replaces the chip with the sentence, and every value cell shows `—`;
    - the shadow store's `unreadable` shows "Monitör şeridi okunamıyor".
  - **Layout:** the monitor grid carries the beds grid's classes (`max-[640px]:grid-cols-1`), and the chip sits in the existing `min-[861px]:grid-cols-2` row.

- [ ] **Step 2: Implement.**
  - `BedCard` takes an optional `monitor` prop and, when present, draws `<MonitorStrip variant="compact" … />` under `<Vitals>`, outside the vitals row.
  - `BedsScreen` reads `useShadow()`, builds `linkedByPatient` from beds with `link === "one"`, passes `monitor` to the linked cards and renders the rest in the section.
  - Bed monitor cards and unassigned cards are `<li data-monitor>` and are not links.

- [ ] **Step 3:** suite, then build; commit `feat(dashboard): monitor cards on the beds screen, after the patients, and a strip on a bound patient's card`.

**Gate:** suite +≈ 12, green, with every pre-existing beds test unchanged.

---

### Task 10: The patient screen, and the legend in Settings

**Files:** Modify `dashboard/src/live/screens/patient/PatientScreen.jsx`, `PatientScreen.test.jsx`, `dashboard/src/live/screens/settings/SettingsScreen.jsx`, `SettingsScreen.test.jsx`.

- [ ] **Step 1: Tests** (≈ 8):
  - **Patient screen:**
    - a patient the shadow board links gets a `Box` titled "Monitör — doğrulanmamış" right after the vitals, in the full variant with evidence;
    - an unlinked patient gets none, and no "no monitor" box either: the screen does not advertise monitors it cannot attribute;
    - stage off gives none.
  - **Settings › Sinyaller:**
    - with the stage `shadow`, the legend box shows the full text, `noSound`, the ages rule, the NBP line, the evidence table with one row per parameter in `PARAM_ORDER` (a "kısmi" mark on the four), and `legendN`;
    - with the stage off, no legend box.

- [ ] **Step 2: Implement** to the tests. The legend's evidence table is a `Table` with a caption, readable at 390 px. Wrap it in `overflow-x-auto` the way the admin tables are.

- [ ] **Step 3:** suite, then build; commit `feat(dashboard): the strip on a bound patient's screen, and what it is in Settings`.

**Gate:** suite +≈ 8, green.

---

### Task 11: Biomedical's device screen, and the permission texts

*(Only the screen and route are conditional on the user's yes, Kullanıcıdan gerekenler 5. The permission texts are required either way: the brief, decision 2.)*

**Files:**
- Create: `dashboard/src/live/screens/devices/DevicesScreen.jsx` (+ `.test.jsx`)
- Modify:
  - dashboard: `shell/routes.js` (+ `routes.test.js`), `i18n/strings/nav.js`, `i18n/strings/perms.js`;
  - engine: `auth/permissions.py`, plus `homunculus-engine/tests/test_permissions.py` if it pins the texts (grep `devices.manage` there first).

- [ ] **Step 1: Tests.**
  - **`routes.test.js`:**
    - a session with only `devices.manage` passes `hasWorkRoute`, lands on `/devices` (`homePath`) and sees one main rail entry;
    - `board.view` alone does not see it;
    - a `hospital_admin`-like session sees both.
  - **`DevicesScreen.test.jsx`:**
    - all devices are listed (beds and unassigned) with source, label or "atanmamış" and reason, status, values, ages and evidence;
    - the table version and sha are shown;
    - **no patient id or name is rendered even when the shadow board carries one** (a `patient_id: "bed-3"` in the fixture must not appear in the DOM);
    - stage off shows "Monitör şeridi kapalı", and a `problem` shows `offProblem`.
  - **Python:** if `test_permissions.py` pins catalogue texts, update its expectation first and see it red.

- [ ] **Step 2: The route.** Add `DevicesScreen` to `routes.js` with its own import line and `SCREENS` entry (`devices: DevicesScreen, // Aşama A`), blank lines either side. Then add:
```js
  route({ id: "devices", path: "/devices", icon: "activity", labelKey: "nav.devices", shortKey: "nav.devicesShort",
    perms: ["devices.manage"], work: true, nav: "main" }),
```
  The nav texts are tr "Monitörler", az "Monitorlar", ru "Мониторы", en "Monitors". The short forms are the same.

- [ ] **Step 3: The permission texts** (`auth/permissions.py`; the same meaning in `perms.js`, four languages):

```python
    "board.view": "See the live board, patient detail and the event stream — including, while "
                  "Aşama A is on, the monitor strip labelled unvalidated, which feeds no rule, "
                  "score, alert, notification or sound",
    ...
    "devices.manage": "Devices: the device screen and the research window — live per-device values "
                      "decoded from bedside-monitor traffic, UNVALIDATED. Aşama A shows them to "
                      "clinicians as a strip labelled unvalidated; they are never an observation and "
                      "no rule, score, alert, notification or audit row is made from them. Shows no "
                      "patient. Held by default by biomedical and by platform_support, the vendor's "
                      "support group",
```

- [ ] **Step 4:** suite, then build, then the clinical gate (if a Python test moved); commit `feat(dashboard): biomedical's monitor screen — devices, beds and values, no patient; permission texts for Aşama A`.

**Gate:** suite +≈ 10, green; `routes.test.js` green; clinical gate unchanged or +1.

---

### Task 12: `shadow_check.py`, the read-only acceptance

**Files:** Create `deploy/infinity/shadow_check.py`, `homunculus-engine/tests/test_infinity_shadow_check.py`.

The checker runs like `transport_check.py`: piped over SSH to the hub's own `python3`, standard library only, writing nothing.

```bash
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 300 --table-version 1 --table-sha <12 hex> --unassigned 10.10.203.28,10.10.203.34,10.10.203.38' < deploy/infinity/shadow_check.py
```

- **What it reads:** `TENANT_TOKEN` from `/opt/homunculus/deploy/local/.env`, never printing it. It reads `http://172.100.101.72:8080/infinity-shadow/board` and `/patients` twice, `--window` seconds apart. HTTP on the host's own address never leaves the machine. `sysadmin` cannot read `web-ca.pem`, and needs no sudo this way.
- **What it prints** (Turkish), one row per criterion, KABUL or RED, then the result:
  - the stage; table version and sha (12 hex); the feed state;
  - devices by status; per assigned bed its label, status, **the number** of fresh values and their oldest age, but **never a value**;
  - the unassigned addresses and reasons;
  - over the window: arrival lag mean and share ≤ 3000 ms (from the API's cumulative histogram), and the number of POSTs (from `forwarder.sent`);
  - `SONUÇ:` and `PANO_OZET {"sha256": …, "cards": n, "alerts": m}`. The hash covers the `/patients` body with `elapsed_sec` and `remaining_sec` removed at every depth.
- **What it tolerates:** a missing endpoint (the old code: 404 or HTML) is `stage: yok`, and `PANO_OZET` is still printed. That is how D-2's "before" is read.
- **Thresholds** (constants at the top; engineering, not clinical): `stage == "shadow"`, table version and sha as given, feed `ok`, the unassigned set exactly as given, lag mean ≤ 1500 ms and ≥ 99 % ≤ 3000 ms, POSTs ≥ 0.9 × window / 5.

- [ ] **Step 1: Tests** (≈ 6, on `evaluate()` and `projection()` with fake bodies):
  - KABUL on a good pair;
  - RED for each criterion;
  - `projection` ignores the two keys and key order;
  - **the printed summary contains no `"value"` field and none of the fake readings' numbers.**

  Red: missing module.
- [ ] **Step 2: Write it.**
- [ ] **Step 3:** the Infinity gate; commit `feat(infinity): a read-only Aşama A acceptance check that prints no value`.

**Gate:** Infinity gate +≈ 6.

---

### Task 13: The table, approved by the user

**Files:** `deploy/infinity/device-beds.icu2.json` (approval fields, and any rows the user corrects).

- [ ] **Step 1:** print the table for review and hand it to the user with Kullanıcıdan gerekenler 1:
  ```bash
  /c/tmp/f7-py312/venv/Scripts/python.exe -I deploy/infinity/device_beds_review.py --allow-unapproved deploy/infinity/device-beds.icu2.json
  ```
- [ ] **Step 2:** the user and biomedical re-confirm the rows on the ward, or say which they cannot. The user may run **K0's** read-only block for the bed ids if they want `bed_id`/`unit_id` filled; the recommendation is to leave them null in Stage A.
- [ ] **Step 3:** the user writes back "Onaylıyorum", with a name or role, the date, and every change. Apply exactly that with the Edit tool:
  - `approved_by`, `approved_at`;
  - `valid_from` = D-3's date at `T00:00:00Z`;
  - the rows changed. A device whose confirmation failed becomes unassigned, with its reason.

  `version` stays `1` for the first approval and rises by one with every later change.
- [ ] **Step 4:** run the review **without** `--allow-unapproved`; it must load.
- [ ] **Step 4b:** after the commit (Step 5), record the sha256 **of the committed bytes**, not of the worktree's copy:
  ```bash
  git -C /c/tmp/inf-a show HEAD:deploy/infinity/device-beds.icu2.json | sha256sum
  ```
  The worktree checks out CRLF, so its copy hashes differently. The VM's checkout is LF, like the blob, and so is what the API hashes and shows. D3-1 checks this value.
- [ ] **Step 5:** commit `chore(infinity): the device→bed table, approved by <who> on <date>`. The body lists each row's bed or "atanmamış".

**Gate:** the table loads; its sha recorded; the user's approval quoted in the commit body.

---

### Task 14: D-1 — the hub release R3, forwarding still off

- [ ] **Step 1:** the whole branch green: both Python gates, the dashboard suite, the build.
- [ ] **Step 2:** build R3 outside the repo:
  ```bash
  cd /c/tmp/inf-a
  /c/tmp/f7-py312/venv/Scripts/python.exe -I deploy/infinity/build_transport_release.py --output /c/tmp/infinity-a-releases
  ```
  Call its `release` R3 and its `sha256` R3_SHA. Fill blocks **S-A1** and **H-A1** with them, and hand them to the user.
- [ ] **Step 3:** after the user's H-A1 output (expected below), run `transport_check.py --window 60`. It must be KABUL, with hub CPU like Task 0's.
- [ ] **Step 4:** if anything misbehaves, **H-A1-geri**.

**Gate:** the hub on R3; `clinical forwarding DISABLED` and **no** "Shadow display forwarding" line; transport KABUL.

---

### Task 15: D-2 — the API and the web, stage off (an invisible deploy)

- [ ] **Step 1:** the bundle and its sha (block **D2-0**, on this machine). Hand the user **D2-1 … D2-5**.
- [ ] **Step 2:** read the user's outputs:
  - the image tags exist;
  - the build is clean;
  - `/health` is 200;
  - `GET /infinity-shadow/board` with no token is a **401 JSON** (nginx proxies it; not `text/html`);
  - `shadow_check.py` (no criteria flags) prints `stage: off` and a `PANO_OZET`. Compare it with D2-1's "before": a difference here is a restart effect, not Stage A, since the stage is off. **Report it either way.**
  - the board on a ward PC looks as before;
  - a biomedical account (if Task 11) lands on "Monitörler", which says "kapalı".
- [ ] **Step 3:** on any failure, **D2-geri**.

**Gate:** the API/web on the Stage A tip with the stage off; nothing new on any clinician's screen.

---

### Task 16: D-3 — the table, the token, the stage, the forwarder

**Not before:** Task 13 approved; the ward told a day before (Kullanıcıdan gerekenler 2); the AZ/RU text review done (Kullanıcıdan gerekenler 4).

- [ ] **Step 1:** blocks **D3-0 … D3-2**: the table's committed bytes (`git show`) carried to the hub and installed with their sha checked, then the certificate and token, and the `.env` edits. The table travels apart from the code, so a later table version is deployed with D3-0/D3-1 alone, and the API re-reads it within 10 s with no restart.
- [ ] **Step 2:** **D3-3**, the API recreated with `shadow`. Then `shadow_check.py`: `stage: shadow`, the table's version and sha as approved, feed `never`. Record `PANO_OZET` as **P0**.
- [ ] **Step 3:** **D3-4**, the hub drop-in 93. Within ~15 s `shadow_check.py` shows feed `ok`, the assigned beds with fresh values, and unassigned = {.28, .34, .38}.
- [ ] **Step 4:** if anything is wrong: **G-1** first (forwarder off, seconds), then decide.

**Gate:** the strip live on the ward PCs; feed ok; the hub transport still KABUL.

---

### Task 17: Acceptance on the real system, with the user

- [ ] Run **Kabul K1–K9** (below), in order, with the user; K7 only by agreement with the ward.
- [ ] At +24 h: K4 and K6 again; K5's query for the day.
- [ ] Report:
  - every criterion's output;
  - P0 against P30 and P24h;
  - the audit hour pair;
  - what the user and biomedical saw on the screens (same or different only; **no values written down**);
  - any device biomedical explained (a switched-off monitor is not a failure, but it is recorded).

**Gate:** every K is KABUL, or a RED is reported with its criterion and nothing changed to pass it.

---

### Task 18: The documents, as deployed

Only after Task 17. Write what was measured, not this plan's predictions.

- [ ] **`deploy/infinity/README.md`**, a new section `## Aşama A — gölge forwarder (<tarih>)`. It covers:
  - the release and drop-ins 92/93;
  - `shadow-forwarder.env` and `web-ca.pem` (what they hold, never their contents);
  - the three rollback tiers;
  - `shadow_check.py`;
  - "the hub still says `clinical_forwarding: False`: the shadow lane is display only".
- [ ] **`docs/INFINITY-PARAMETER-RECORDS.md`**, a short Turkish paragraph under "Sınırlar": what the strip shows, the evidence levels as shown, NBP withheld and why.
- [ ] **`docs/homunculus-rehber-TR.md`** (the living Turkish guide), next to its Infinity lines. One paragraph:
  - what the strip is;
  - who sees it;
  - how to turn it off (the three tiers);
  - the table and how a change to it is approved.
- [ ] Commit the three paths: `docs(infinity): Aşama A as deployed` (with the trailer).

---
## Dağıtım blokları (Türkçe, kopyala-yapıştır)

**Ortak kurallar:**
- **Her bloğu kullanıcı yapıştırır.** Ajan blokları değerleri doldurulmuş olarak verir ve çıktıyı okur.
  - **Değerler:** `REL`, `SHA`, bundle adı, tablonun sha256'sı.
  - **Kim, nerede:** iş istasyonu blokları Git Bash'te, VM blokları `ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72` ile açılan oturumda çalışır.
- **Sıra:**
  1. D-1: hub, forwarder kapalı.
  2. D-2: API ve web, aşama `off`.
  3. Tablo onayı ve servis duyurusu.
  4. D-3: tablo, token, aşama `shadow`, en son forwarder.

  Her adım, bir öncekinin beklenen çıktısı görülmeden başlamaz.
- **Geri alma her adımda tek bir anahtar ya da tek bir drop-in'dir** (aşağıda G-1 … G-5). **Veritabanı değişmez**, göç yoktur. Bu yüzden geri dönüş yedekten değil, imaj etiketinden yapılır.
- **Worker (`.74`) bu aşamada hiç değişmez.** Worker oturumu gerekmez.
- **Ne değişmez:** envanter, kuyruk dosyaları, hub sertifikası, nginx sertifikası ve veritabanı.
- **Hiçbir token ekrana basılmaz.** Bloklar token'ı yalnız bir kabuk değişkeninde tutar.
- **`sudo` ve Docker:** `sudo` parola isteyebilir. `sysadmin` docker grubunda değil, bu yüzden Docker komutları `sudo` ile çalışır (14.10'da görüldü).
- **Bir adım hata verirse** blok orada durur; oturum açık kalır.

### S-A1 — R3'ü hub'ın ev klasörüne koy (iş istasyonu)

```bash
cd /c/tmp/infinity-a-releases
echo "<R3_SHA>  <R3>.tar.gz" | sha256sum -c -
scp -i ~/.ssh/homunculus_vm -o BatchMode=yes <R3>.tar.gz sysadmin@172.100.101.72:/home/sysadmin/
```
Beklenen: `OK`, sonra kopya. Worker'a kopya **yok**: worker R2b'de kalır, aralarındaki tel şeması değişmedi.

### H-A1 — hub R3'e, forwarder KAPALI (hub)

```bash
bash -eu -o pipefail <<'BLOK'
REL=<R3>                                  # ör. transport-0123456789abcdef
SHA=<R3_SHA>
ESKI=90-transport-0a-duzeltme.conf        # şu an en yeni drop-in
ESKI_REL=transport-a4dd159a85e9c0b9        # onun kullandığı release (R2b)
YENI=92-asama-a-kod.conf
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
awk -v r="$ESKI_REL" '!/^#/ && index($0, r) {f=1} END {exit !f}' $D/$ESKI || { echo "ESKI drop-in ESKI_REL'i anmıyor: durdum, hiçbir şey değişmedi"; exit 1; }
sudo test ! -e $D/93-asama-a-golge.conf || { echo "93 ZATEN VAR (forwarder açık): önce G-1; durdum"; exit 1; }
# 1) Arşiv doğru mu, bu ad daha önce kurulmamış mı?
echo "$SHA  $HOME/$REL.tar.gz" | sha256sum -c -
sudo test ! -e /opt/homunculus-infinity/$REL || { echo "BU RELEASE ZATEN KURULU: durdum, hiçbir şey değişmedi"; exit 1; }
# 2) Aç, her dosyayı doğrula, sahipliği öncekilerle aynı yap
sudo tar -xzf "$HOME/$REL.tar.gz" -C /opt/homunculus-infinity --no-same-owner
sudo sh -c "cd /opt/homunculus-infinity/$REL; sha256sum -c --quiet SHA256SUMS"
echo "DOSYALAR TAMAM"
sudo test -f /opt/homunculus-infinity/$REL/app/src/homunculus/edge/infinity_shadow.py
echo "FORWARDER KODU VAR (henüz kapalı)"
sudo chown -R root:homunculus-infinity-pilot /opt/homunculus-infinity/$REL
sudo chmod -R u=rwX,g=rX,o= /opt/homunculus-infinity/$REL
# 3) Yeni drop-in: eskisinin aynısı, yalnız release yolu farklı
sudo test ! -e $D/$YENI || { echo "BU DROP-IN ZATEN VAR: durdum"; exit 1; }
sed "s#$ESKI_REL#$REL#g; 1s#.*#\# Homunculus Aşama A kodu (forwarder kapalı): $REL#" $D/$ESKI | sudo tee $D/$YENI >/dev/null
diff <(sed "s#$ESKI_REL#R#g" $D/$ESKI | grep -v '^#') <(sed "s#$REL#R#g" $D/$YENI | grep -v '^#')
echo "AYNI: yalnız release yolu değişti"
# 4) Yalnız hub'ı yeniden başlat
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8
systemctl is-active $UNIT
journalctl -u $UNIT -n 5 --no-pager
BLOK
```
**Beklenen çıktı:**
- `…tar.gz: OK`, `DOSYALAR TAMAM`, `FORWARDER KODU VAR (henüz kapalı)`, `AYNI: yalnız release yolu değişti`, `active`;
- son satırlarda `Infinity research transport; clinical forwarding DISABLED.` ve `Uvicorn running on https://172.100.101.72:8766`;
- **"Shadow display forwarding" satırı OLMAMALI.**

Ardından ajan `transport_check.py --window 60` koşar; beklenen sonuç `SONUÇ: KABUL`.

### D-2 — API ve web, aşama `off` (görünmez dağıtım)

**D2-0 (iş istasyonu):**
```bash
cd /c/tmp/inf-a
B=/c/tmp/infinity-a-releases/asama-a-$(git rev-parse --short HEAD).bundle
git bundle create $B feat/infinity-asama-a
git bundle verify $B && sha256sum $B
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'mkdir -p ~/asama-a'
scp -i ~/.ssh/homunculus_vm $B sysadmin@172.100.101.72:/home/sysadmin/asama-a/
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 -' < deploy/infinity/shadow_check.py | tail -3   # ÖNCE: "stage: yok" ve PANO_OZET
```
`PANO_OZET` satırını saklayın (**P-önce**).

**D2-1 (VM, salt okunur ön kontrol):**
```bash
cd /opt/homunculus/deploy/local
git -C /opt/homunculus log -1 --oneline            # beklenen: 52656daf
git -C /opt/homunculus status --porcelain          # beklenen: yalnız dört .bak dosyası
git -C /opt/homunculus bundle verify ~/asama-a/<bundle adı> && sha256sum ~/asama-a/<bundle adı>
sudo docker compose images | tee ~/asama-a/images-before.txt
for c in homunculus-api homunculus-web; do echo "$c $(sudo docker inspect -f '{{.Image}}' $c)"; done | tee ~/asama-a/image-ids-before.txt
grep -oE '^[A-Z_]+=' .env | sort | tee ~/asama-a/env-keys-before.txt     # yalnız anahtarlar
df -h / /var/lib/docker
```
Beklenen: iki tarafın sha256'sı aynı; diskte en az 3 GiB boş.

**D2-2 (VM): geri dönüş için çalışan imajları etiketle:**
```bash
sudo docker tag $(sudo docker inspect -f '{{.Image}}' homunculus-api) homunculus-rollback/api:52656da
sudo docker tag $(sudo docker inspect -f '{{.Image}}' homunculus-web) homunculus-rollback/web:52656da
sudo docker images | grep homunculus-rollback
```

**D2-3 (VM): kodu al (çalışan konteynerler değişmez):**
```bash
cd /opt/homunculus
git fetch ~/asama-a/<bundle adı> feat/infinity-asama-a:feat/infinity-asama-a
git checkout feat/infinity-asama-a && git log -1 --oneline        # beklenen: <uç SHA>
```

**D2-4 (VM): `.env` ve bağlanacak klasör:**
```bash
cd /opt/homunculus/deploy/local
cp -p .env ~/asama-a/env.before-d2
grep -q '^INFINITY_CLINICAL_STAGE=' .env || printf 'INFINITY_CLINICAL_STAGE=off\n' >> .env
grep '^INFINITY_CLINICAL_STAGE=' .env                # beklenen: INFINITY_CLINICAL_STAGE=off
mkdir -p infinity-shadow                             # compose bu klasörü bağlar; aşama off iken boş kalır
sudo docker compose config >/dev/null && echo "compose config OK"
```

**D2-5 (VM): derle ve aç.** Pano bu adımda birkaç dakika "sunucuya bağlantı yok" diyebilir. API, motoru denetim kaydından yeniden kurar.
```bash
cd /opt/homunculus/deploy/local
sudo env BUILD_SHA=$(git -C /opt/homunculus rev-parse --short HEAD) docker compose build api web 2>&1 | grep -E "Built|ERROR|precache"
sudo docker compose up -d --no-build api web
sleep 20; sudo docker compose ps api web
curl -s -o /dev/null -w "health %{http_code}\n" http://172.100.101.72:8080/health
curl -s -o /dev/null -w "golge-ucu %{http_code} %{content_type}\n" http://172.100.101.72:8080/infinity-shadow/board
systemctl is-active homunculus-infinity-pilot-hub
```
**Beklenen çıktı:**
- `health 200`;
- `golge-ucu 401 application/json` (nginx ucu API'ye iletiyor; `text/html` olmamalı);
- hub `active`.

Ardından ajan `shadow_check.py`'yi koşar. Beklenen: `stage: off` ve bir `PANO_OZET` (**P-sonra**). P-önce ile P-sonra farklıysa ajan bunu bildirir. Bu bir yeniden başlatma etkisidir, Aşama A değil: aşama kapalı. Kullanıcı bir servis bilgisayarında panoya bakar; görünen hiçbir şey değişmemiş olmalı.

### D-3 — tablo, token, aşama `shadow`, en son forwarder

**Ne zaman:** servis bir gün önce bilgilendirildikten sonra, sakin bir saatte, kullanıcı ve mümkünse biyomedikal yanındayken.

**D3-0 (iş istasyonu): onaylı tablonun commit'teki baytlarını hub'a taşı.** Kod dağıtımından bağımsızdır; bu yüzden tablonun ileride değişen bir sürümü de aynı iki blokla (D3-0, D3-1) taşınır ve API'nin yeniden başlaması gerekmez: API dosyayı 10 sn içinde kendisi yeniden okur.
```bash
cd /c/tmp/inf-a
git show HEAD:deploy/infinity/device-beds.icu2.json > /c/tmp/infinity-a-releases/device-beds.json
sha256sum /c/tmp/infinity-a-releases/device-beds.json        # Task 13'te kaydedilenle aynı olmalı
scp -i ~/.ssh/homunculus_vm /c/tmp/infinity-a-releases/device-beds.json sysadmin@172.100.101.72:/home/sysadmin/asama-a/
```

**D3-1 (VM): onaylı tabloyu yerine koy.**
```bash
cd /opt/homunculus/deploy/local
TS=<Task 13'te kaydedilen sha256>
echo "$TS  $HOME/asama-a/device-beds.json" | sha256sum -c -
install -m 0644 $HOME/asama-a/device-beds.json infinity-shadow/device-beds.json
sha256sum infinity-shadow/device-beds.json
```
Beklenen: `OK`; ikinci satırda aynı sha.

**D3-2 (VM): nginx sertifikası, token, `.env`.** Token yazdırılmaz.
```bash
bash -eu -o pipefail <<'BLOK'
C=/etc/homunculus-infinity-pilot
ENVF=/opt/homunculus/deploy/local/.env
sudo test ! -e $C/shadow-forwarder.env || { echo "shadow-forwarder.env ZATEN VAR: durdum"; exit 1; }
if grep -q '^INFINITY_SHADOW_TOKEN=' $ENVF; then echo ".env'de INFINITY_SHADOW_TOKEN ZATEN VAR: durdum"; exit 1; fi
cp -p $ENVF ~/asama-a/env.before-d3                      # yedek; içeriği yazdırılmaz
# 1) Forwarder'ın güvendiği tek dosya: panelin kendinden imzalı sertifikası (açık anahtar, gizli değil)
sudo docker exec homunculus-web cat /etc/nginx/certs/self.crt | sudo tee $C/web-ca.pem >/dev/null
sudo chown root:homunculus-infinity-pilot $C/web-ca.pem
sudo chmod 0640 $C/web-ca.pem
sudo openssl x509 -in $C/web-ca.pem -noout -ext subjectAltName | grep -q 'IP Address:172.100.101.72' \
  || { echo "SERTİFİKA 172.100.101.72'Yİ TAŞIMIYOR: durdum, ajana sorun"; exit 1; }
echo | sudo openssl s_client -connect 172.100.101.72:8443 -CAfile $C/web-ca.pem \
       -verify_ip 172.100.101.72 -verify_return_error >/dev/null 2>&1 \
  || { echo "SERTİFİKA DOĞRULANAMADI: durdum, ajana sorun"; exit 1; }
echo "WEB SERTİFİKASI DOĞRULANDI"
# 2) Token: yalnız bu kabuk değişkeninde; iki dosyaya yazılır, ekrana basılmaz
T=$(openssl rand -hex 32)
printf 'INFINITY_SHADOW_URL=https://172.100.101.72:8443/infinity-shadow/readings\nINFINITY_SHADOW_CA_FILE=%s/web-ca.pem\nINFINITY_SHADOW_TOKEN=%s\n' "$C" "$T" \
  | sudo tee $C/shadow-forwarder.env >/dev/null
sudo chown root:root $C/shadow-forwarder.env
sudo chmod 0600 $C/shadow-forwarder.env
printf 'INFINITY_SHADOW_TOKEN=%s\n' "$T" >> $ENVF
unset T
# 3) Aşama
sed -i 's/^INFINITY_CLINICAL_STAGE=.*/INFINITY_CLINICAL_STAGE=shadow/' $ENVF
grep '^INFINITY_CLINICAL_STAGE=' $ENVF
grep -c '^INFINITY_SHADOW_TOKEN=' $ENVF
sudo awk -F= '{print $1}' $C/shadow-forwarder.env
BLOK
```
**Beklenen çıktı:**
- `WEB SERTİFİKASI DOĞRULANDI`;
- `INFINITY_CLINICAL_STAGE=shadow`;
- `1`;
- üç anahtar adı, değersiz: `INFINITY_SHADOW_URL`, `INFINITY_SHADOW_CA_FILE`, `INFINITY_SHADOW_TOKEN`.

**D3-3 (VM): API'yi yeni ortamla aç.** Pano birkaç dakika gelmeyebilir.
```bash
cd /opt/homunculus/deploy/local
sudo docker compose up -d --no-build api
sleep 20; sudo docker compose ps api
curl -s -o /dev/null -w "health %{http_code}\n" http://172.100.101.72:8080/health
sudo docker compose logs --since 3m api | grep -E "cihaz→yatak tablosu|INFINITY_CLINICAL_STAGE" | tail -3
```
**Beklenen çıktı:**
- `health 200`;
- `cihaz→yatak tablosu yüklendi: sürüm 1, sha256 <ilk 12 hane>…, 10 atanmış, 3 atanmamış`;
- **"çalıştırılamıyor" satırı olmamalı.**

Ardından ajan `shadow_check.py`'yi koşar. Beklenen: `stage: shadow`, tablo sürümü ve sha'sı onaylanan, besleme `never`. Bu andaki `PANO_OZET` **P0**'dır. Panoda şerit "Monitör aktarımı henüz başlamadı" der.

**D3-4 (VM): forwarder'ı aç: drop-in 93.**
```bash
bash -eu -o pipefail <<'BLOK'
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
sudo test -e $D/92-asama-a-kod.conf || { echo "92 YOK: önce H-A1; durdum"; exit 1; }
sudo test ! -e $D/93-asama-a-golge.conf || { echo "93 ZATEN VAR: durdum"; exit 1; }
printf '# Homunculus Aşama A: gölge forwarder (doğrulanmamış görüntü; klinik iletim değildir)\n[Service]\nEnvironmentFile=/etc/homunculus-infinity-pilot/shadow-forwarder.env\n' \
  | sudo tee $D/93-asama-a-golge.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8
systemctl is-active $UNIT
journalctl -u $UNIT -n 8 --no-pager | grep -E "clinical forwarding DISABLED|Shadow display forwarding ENABLED|misconfigured|Uvicorn running" || true
BLOK
```
**Beklenen çıktı:** `active` ve üç satır:
- `clinical forwarding DISABLED`;
- `Shadow display forwarding ENABLED (Stage A, unvalidated; not clinical ingest) every 5 s.`;
- `Uvicorn running…`.

`misconfigured` görülürse hemen **G-1**.

Yaklaşık 15 saniye sonra ajan iki denetimi koşar: `shadow_check.py --window 60 …`, beklenen sonuç besleme `ok`, atanmış yataklarda taze değer, atanmamış = {.28, .34, .38}; ve `transport_check.py --window 60`, beklenen sonuç `KABUL`.

**Not (Tasks 1–5 incelemesi, 19.10):** nginx `POST /infinity-shadow/readings`'i yalnız HTTPS ile kabul eder; düz HTTP (:8080) `403 https_required` alır, yani forwarder adresi `https://…:8443` olmalıdır (bu blokta öyle). Hub'ın adresini kısıtlayan bir izin listesi (`allow <hub>; deny all;`, `deploy/local/web/nginx.conf`'taki bu location'a) hub'ın POST'larının nginx günlüğündeki `$remote_addr`'ı VM'de görüldükten sonra ayrı bir değişiklikle eklenir; adres gözlenmeden yazılan bir liste forwarder'ı kesebilir.

### Geri alma blokları

**Hangi sırayla:** sorun yalnız şeritteyse önce **G-1** (saniyeler, API yeniden başlamaz). Şeridin tamamen kalkması gerekiyorsa **G-2**. Kod geri alınacaksa **G-3**, sonra **G-4**. Hepsi geri alındıysa **G-5** (artıklar).

**G-1 — forwarder kapalı (hub):**
```bash
bash -eu <<'BLOK'
UNIT=homunculus-infinity-pilot-hub
sudo rm /etc/systemd/system/$UNIT.service.d/93-asama-a-golge.conf
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8; systemctl is-active $UNIT
journalctl -u $UNIT -n 6 --no-pager | grep -c "Shadow display forwarding ENABLED" || true    # beklenen: 0
BLOK
```
15–20 saniye içinde şerit "Monitör verisi gelmiyor" der ve bütün değerler kalkar. Pano bunun dışında değişmez.

**G-2 — aşama kapalı (API):**
```bash
cd /opt/homunculus/deploy/local
sed -i 's/^INFINITY_CLINICAL_STAGE=.*/INFINITY_CLINICAL_STAGE=off/' .env && grep '^INFINITY_CLINICAL_STAGE=' .env
sudo docker compose up -d --no-build api
sleep 20; curl -s -o /dev/null -w "health %{http_code}\n" http://172.100.101.72:8080/health
```
Şerit, monitör kartları, çip ve Ayarlar'daki açıklama kalkar. API yeniden başlar; pano birkaç dakika gelmeyebilir.

**G-3 — hub kodu geri (H-A1-geri).** Önce G-1 yapılmış olmalı.
```bash
bash -eu <<'BLOK'
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
sudo test ! -e $D/93-asama-a-golge.conf || { echo "Önce G-1 (93 duruyor)"; exit 1; }
sudo rm $D/92-asama-a-kod.conf
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8; systemctl is-active $UNIT
BLOK
```
Hub `transport-a4dd159a85e9c0b9`'a (`90-…`) döner. R3 klasörü yerinde kalır; zararsızdır.

**G-4 — API ve web kodu geri (D2-geri):**
```bash
cd /opt/homunculus/deploy/local
git -C /opt/homunculus checkout feat/canli-tasarim && git -C /opt/homunculus log -1 --oneline     # beklenen: 52656daf
API_IMG=$(grep api ~/asama-a/images-before.txt | awk '{print $2":"$3}')
WEB_IMG=$(grep web ~/asama-a/images-before.txt | awk '{print $2":"$3}')
sudo docker tag homunculus-rollback/api:52656da "$API_IMG"
sudo docker tag homunculus-rollback/web:52656da "$WEB_IMG"
sudo docker compose up -d --no-build api web
sleep 20; curl -s -o /dev/null -w "health %{http_code}\n" http://172.100.101.72:8080/health
```
Göç olmadığı için veritabanı olduğu gibi kalır. Eski kod `.env`'deki yeni satırları okumaz; satırlar zararsızdır.

**G-5 — artıkları temizle** (yalnız her şey geri alındıysa):
```bash
sudo rm -f /etc/homunculus-infinity-pilot/shadow-forwarder.env /etc/homunculus-infinity-pilot/web-ca.pem
sed -i '/^INFINITY_SHADOW_TOKEN=/d; /^INFINITY_CLINICAL_STAGE=/d' /opt/homunculus/deploy/local/.env
```

---

## Kabul (Türkçe)

**Ne zaman kabul edilir?** K1–K9'un hepsi D-3'ten sonra, kullanıcıyla birlikte, gerçek 13 monitörde sağlanmalıdır. K4–K6 ayrıca 24 saat sonra yeniden okunur.

**Eşikler hakkında:**
- Hepsi mühendislik eşiğidir, hiçbiri klinik değildir.
- `deploy/infinity/shadow_check.py` dosyasının başında sabit olarak yazılıdır.
- **RED görülürse** hiçbir ayar değiştirilerek kabul geçirilmeye çalışılmaz. Hangi ölçütün RED olduğu ve zaman ajana bildirilir. Geri alma kararını kullanıcı verir.

**Doğrulama değildir:** bu kabul, değerlerin doğru çözüldüğünü kanıtlamaz. O iş Aşama B'nin imzalı doğrulamasıdır. K1'deki göz karşılaştırması yalnız "şerit doğru yatağın monitörünü mü gösteriyor" sorusunu yanıtlar.

| # | Ölçüt | Nasıl | Eşik / beklenen |
|---|---|---|---|
| K0 | Önce (bilgi) | `transport_check.py --window 60`; D2-0'daki P-önce; isteğe bağlı birim/yatak listesi (aşağıda) | KABUL; değerler kayıtlı |
| K1 | **Atanmış yataklarda canlı değer** | `shadow_check.py`: her atanmış yatağın durumu ve taze değer sayısı (değerin kendisi yazılmaz). Koğuşta kullanıcı ve biyomedikal 3 yatağın başucu ekranıyla şeritteki HR/SpO₂'ye bakar. | Açık ve standby'da olmayan her atanmış monitörde ≥ 1 taze değer. Üç yatakta ekrandaki sayı ile şeritteki aynı yatağa ait ("aynı / farklı" yazılır, sayı yazılmaz). |
| K2 | **Atanmamış cihazlar öyle görünür** | Panoda "Monitörler — doğrulanmamış" bölümü; `shadow_check.py --unassigned 10.10.203.28,10.10.203.34,10.10.203.38` | `.28`, `.34` ve `.38` yalnız "Atanmamış cihaz" kartında. **Hiçbir yatak kartında ya da hasta ekranında değil.** |
| K3 | **Gecikme hedefte** | `shadow_check.py --window 300` | Varış gecikmesi ortalaması ≤ 1500 ms ve ≥ %99'u ≤ 3000 ms. 300 sn'de ≥ 54 gönderim (5 sn'de bir). Ekranda akan bir cihazın her değerinin yaşı ≤ 15 sn. |
| K4 | **Motorun çıktıları değişmedi** | `PANO_OZET`: P0 (D3-3 sonrası, forwarder kapalıyken), P30 (forwarder açıldıktan 30 dk sonra), P24 (24 sa sonra) | **P0 = P30 = P24.** Arada klinik girdi geldiyse (K5'te `ingest`/`chart` satırı) P24 karşılaştırılmaz; o durumda kanıt Task 5'in testidir, ve bu yazılır. |
| K5 | **Denetim kaydı satır hızı değişmedi** | Aşağıdaki salt okunur sorgu, D3-4 saatinden önceki ve sonraki birer saat | Yeni olay türü yok. İkinci saatteki satırlar yalnız insan işlemleri (`auth`, `view`…). Forwarder'ın ~720 gönderiminden **0** satır. |
| K6 | **Hub etkilenmedi** | `transport_check.py --window 300` | `KABUL`; hub CPU ≤ %43 (beklenen ≈ %9–10) |
| K7 | **Besleme ölünce pano sakin görünmez** (koğuşla anlaşılarak, ~5 dk) | G-1 uygulanır, sonra D3-4 yeniden | 20 sn içinde "Monitör verisi gelmiyor (son: …)", bütün değerler kalkmış. D3-4 ile 10 sn içinde geri. |
| K8 | **Etiketler ve erişilebilirlik** | Ayarlar'dan dört dil; 390 px ve 1440 px (DevTools), Gece ve Gün; yalnız klavye; ekran okuyucu | AZ varsayılanda "Monitor · təsdiqlənməyib"; dört dilde etiket tam; 390 px'te taşma yok; şerit odak tuzağı değil; ekran okuyucu başlığı "doğrulanmamış" ile okur; şerit hiçbir şey anons etmez. |
| K9 | **Biyomedikal** (Task 11 yapıldıysa) | Bir biyomedikal hesabıyla giriş; sonra bir hemşire hesabıyla | Biyomedikal "Monitörler"e iner, 13 cihazı görür, **hiçbir hasta adı ya da numarası görmez**. Hemşirenin raylarında "Monitörler" yok. |

**K0 — birim ve yatak listesi (isteğe bağlı, salt okunur; yalnız Task 13'te `bed_id` doldurulmak istenirse):**
```bash
cd /opt/homunculus/deploy/local
sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT u.id, u.name, b.id, b.label FROM beds b JOIN rooms r ON r.id=b.room_id JOIN units u ON u.id=r.unit_id ORDER BY u.name, b.label;"
```

**K5 — denetim kaydı (salt okunur; yalnız olay türü ve sayı yazdırır):**
```bash
cd /opt/homunculus/deploy/local
T1='<D3-4 saati, UTC, ör. 2026-10-20 09:00:00+00>'
sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "SELECT 'once', event_type, count(*) FROM audit WHERE ts::timestamptz >= timestamptz '$T1' - interval '1 hour' AND ts::timestamptz < timestamptz '$T1' GROUP BY 2 UNION ALL SELECT 'sonra', event_type, count(*) FROM audit WHERE ts::timestamptz >= timestamptz '$T1' AND ts::timestamptz < timestamptz '$T1' + interval '1 hour' GROUP BY 2 ORDER BY 1, 2;"
```

---

## Kullanıcıdan gerekenler

Bunların hiçbiri Task 0–12'yi (kod ve testler) beklemez. **D-1 ve D-2 yalnız 7'yi bekler. D-3; 1, 2, 4 ve 7 olmadan başlamaz.** Tablo kodla değil D3-0/D3-1 ile taşındığı için onayı D-2'yi geciktirmez.

1. **Cihaz→yatak tablosunun onayı (Task 13).**
   - **Ne:** yukarıdaki 13 satırlık tablo. 10 cihaz yatağa atanmış, `.28`, `.34` ve `.38` atanmamış.
   - **Nasıl:** onaydan önce tablo koğuşta, biyomedikalle birlikte **yeniden** doğrulanır. Merkezi istasyonun cihaz listesindeki yatak adı ya da her monitörün kendi ekranındaki yatak etiketi okunur. Neden: tablo 22.09'un eşlemesidir ve monitörler yer değiştirebilir. Açık soru da hâlâ açık: IP adresi monitörü mü izliyor, CPS istasyonunu mu?
   - **`.28`:** çözülebilirse (BED07 mi, BED12 mi), yöntemiyle birlikte atanmış satıra dönüşür. Çözülemezse atanmamış kalır.
   - **Ne yazarsınız:** "Onaylıyorum", adınız ya da rolünüz, tarih ve varsa düzeltmeler.
   - **`bed_id`/`unit_id`:** öneri, bu aşamada **boş** kalsın. Doldurmak yalnız kapsam ataması başlayınca gerekir: atanmış bir hemşire yalnız kendi biriminin monitör kartlarını görsün diye. O gün yeni bir sürümle eklenir.
   - **Ne zaman:** D-2'den önce, yaklaşık 30 dk ve bir koğuş turu.
   - **Bundan sonra:** tablodaki her değişiklik yeni bir sürüm ve yeni bir onaydır.
2. **Servise önceden duyuru (D-3'ten bir gün önce).** Önerilen metin (Türkçe; Azerbaycan Türkçesine çevirisini siz ya da okuyucu klinisyen yapar):
   > **Konu: Panoda yeni "Monitör · doğrulanmamış" şeridi — yalnız bilgi, uyarı üretmez.** <tarih> günü saat <saat>'ten itibaren Homunculus panosunda, başucu monitörlerinden okunan değerler ayrı, kesik çizgili bir şeritte **"DOĞRULANMAMIŞ"** etiketiyle görünecek. Bu değerler araştırma amacıyla monitörün ağ yayınından çözülüyor ve henüz doğrulanmadı: **tedavi kararı için her zaman başucu monitörüne bakın.** Şerit hiçbir uyarı, NEWS2 ya da skor, ses veya bildirim üretmez; alarm listesi ve zil değişmez. **Başucu monitörlerinin kendi alarmları aynen çalışır ve birincil alarmdır.** Kan basıncı (NIBP) bu şeritte gösterilmez. Yatağı henüz doğrulanmamış bazı monitörler "Atanmamış cihaz" olarak ayrı görünür ve hiçbir hastaya yazılmaz. Şeritteki bir değer monitörünüzdekinden farklıysa ya da şerit "susuyor" diyorsa lütfen <kişi / telefon>'a bildirin. Panodaki başka hiçbir şey bundan etkilenmez.
3. **Dağıtım oturumları.** Bütün blokları siz yapıştırırsınız; ajan blokları değerleri doldurulmuş olarak verir ve çıktıyı okur.
   - **D-1, hub (~10 dk):** klinik etkisi yok; araştırma görünümünde ~10 sn boşluk.
   - **D-2, API ve web (~45 dk, sakin bir saatte):** derleme sırasında pano çalışmaya devam eder. Açılışta birkaç dakika "sunucuya bağlantı yok" görülebilir. Ekranda yeni bir şey görünmez.
   - **D-3 (~20 dk):** duyurudan sonraki gün. Şerit bu adımın sonunda görünür.
   - **Kabul (~30 dk koğuşta, mümkünse biyomedikalle), sonra 24 saat:** K7'nin "beslemeyi kes" denemesi için koğuşun onayı alınır.
   - **Worker oturumu gerekmez.**
4. **AZ ve RU metinlerinin okunması (D-3'ün kapısı).** Şeridin ve Ayarlar'daki açıklamanın metinleri (`monitor` sözlüğü, Task 8) Azerbaycanca konuşan bir klinisyence, mümkünse Rusça konuşan biri tarafından da okunur. Soru tek: **"Bu, değerlerin doğrulanmadığını, karar için olmadığını ve uyarı üretmediğini herkesin anlayacağı şekilde söylüyor mu?"** Düzeltmeler D-3'ten önce koda girer.
5. **Biyomedikal erişimi: karar.**
   - **Öneri:** evet, yalnız cihaz ekranı ("Monitörler") üzerinden. `board.view` verilmez, hasta adı ve numarası görünmez.
   - **Neden:** tablonun sahibi ve doğrulamanın imzacısı biyomedikal. Şeridi koğuşta monitörle karşılaştırabilecek kişiler onlar.
   - **Sonuç:** yalnız `devices.manage` taşıyan hesaplar artık yeni arayüze girer. Bu, **Üretici Destek (`platform_support`)** grubunu da kapsar: o grup canlı monitör değerlerini (hastasız) görür. G1-15 Part D 5'in sorusu buydu; onayınızı ikisi için birlikte istiyoruz.
   - **"Hayır" derseniz:** Task 11'in ekranı yapılmaz; başka hiçbir şey değişmez.
6. **Eski NCE kartları** (tasarım kararı 11). Panoda 38–40 gün önceki değerleri taşıyan 6 kimliksiz kart var. Yeni monitör kartlarının yanında yanlış güvence verebilirler.
   - **Öneri:** D-3'ten önce karar verin: bırakılsın mı, "eski kaynak" diye işaretlensin mi, arşivlensin mi?
   - Bu planda kod yok; karar ayrı bir iş olur. Engellemez.
7. **VM kuralı.** 07.10 kararınız: "Grup 1'in tamamı kapıdan geçmeden hastane VM'ine hiçbir şey gitmez." G1-15 dağıtıldı; 0a ise ayrı bir araştırma servisine dokundu. **Bu aşama klinik API ve web'e de dokunuyor** (D-2, D-3). Bunu izinli sayıyor musunuz? D-1 de dahil, hiçbir dağıtım bu yanıt olmadan yapılmaz.
8. **NIBP gösterilmiyor: onay.** Ölçüm zamanı çözülmediği için tansiyon değeri saatler önceki bir ölçüm olabilir (belki önceki hastanın). Bu yüzden şeritte yok. Arteriyel hattı olmayan yatakta şeritte tansiyon görünmez; açıklama Ayarlar'da.
9. **Sayılar: onay ya da değişiklik.** Hepsi mühendislik değeridir, hiçbiri klinik değildir.
   - **5 sn:** forwarder'ın gönderme ve panonun okuma sıklığı.
   - **3 sn:** hub'dan çıkabilecek en eski değer.
   - **15 sn:** ekranda gösterilebilecek en eski değer.
   - **120 sn:** bellekte tutma süresi.
   - **Kabul eşikleri:** ortalama ≤ 1,5 sn, %99 ≤ 3 sn.

   NEWS2'ye girecek değerlerin sıklığı (tasarımdaki "dakikada bir, klinisyen onaylar") Aşama B'nin sorusudur, şimdi değil.
10. **Bilgi: `bed-mapping.json` VM'de bir klasör.** Dosya hiç yazılmamış, Docker yerine boş bir klasör koymuş. Bu yüzden bugün hiçbir hasta kartı bir yatağa oturmuyor. Aşama A'da monitör değerleri bu nedenle **hasta kartında değil, "yatak monitörü" kartlarında** görünür. Hasta kartındaki şerit kodda hazırdır ve testlidir; bir yatak eşleme tablosu ve yatağa hasta bağlama (faz 3) geldiğinde kendiliğinden çalışır. **Öneri:** Aşama A için `bed-mapping.json`'a dokunulmasın.
11. **Aşama B için, bugünden not:** doğrulamanın kabul rakamları (kaç örnek, kaç yatak, hangi koşullar) için **kasada kaynak yok**. Klinisyenin ve biyomedikalin rakamı gerekecek. Şimdi istenmiyor.
12. **Geçici yetkiler.** Hub'daki geçici parolasız sudo (0a'dan) hâlâ duruyor. Bu planın blokları onu gerektirmez: `sudo` parola isterse siz girersiniz. Kaldırılması 0a'nın "Needs the user 8" maddesidir.

---

## Self-review

**The brief, point by point:**
1. **Stage switch:** `INFINITY_CLINICAL_STAGE`, default `off`. `off`/`shadow` behaviour is tabled; `rules`/`alarms` are refused as `off`. A configuration problem never stops the API. Three rollback tiers.
2. **Forwarder:**
   - in the hub process, enabled by drop-in 93;
   - thinning **N = 5 s**, justified (13 s worst on-screen age inside the 15 s limit; the per-minute figure belongs to NEWS2, Stage B);
   - age limits 3 / 10 / 15 / 120 s;
   - NBP excluded (recommended, with four reasons);
   - units verbatim from the decoder, checked against a closed table;
   - a dedicated token outside `TENANTS`, because a `TENANTS` token passes every permission check and can write `/ingest`.
3. **Store:** memory only, bounded (100 × 9), expiring (15/120 s). No audit row, so the rehydration window does not grow.
4. **Endpoints and the dashboard:**
   - **Endpoints:** POST and GET.
   - **Where the strip appears:** bed monitor cards, unassigned cards, a bound patient's card and screen, the device screen.
   - **States and ages:** standby, `***`, silent, waiting and unknown; per-parameter staleness and ages; the feed chip and sentences.
   - **Settings, layout, accessibility:** the Settings legend; 390/1440 px; the accessibility rules.
5. **The gate:** byte-identical outputs in two apps (patients, alerts, frames, notifications, escalation, acks, `first_seen`, audit, discovery counters, identities), with a negative control and a deliberate break seen red. Isolation by imports, spies, token refusals and the stage. The dashboard import boundary and store isolation. On the VM: the board hash and the audit hour pair.
6. **Evidence per parameter:** shown on the strip ("kısmi") and in the legend, from §4.1. No N, and no Stage B acceptance figures, since the vault has no source.
7. **Feed health:** a matrix of twelve failures. The silent chip; forwarder down; hub down; worker down; transport lag; the table; the dashboard's own poll.
8. **Deploy and rollback, in order:** hub (D-1), then API/web (D-2), then the switch and forwarder (D-3). Each is reversible by one switch or one drop-in (G-1…G-4). No worker change. No migration.
9. **Acceptance with the user:** K1 live values, K2 unassigned, K3 lag, K4 engine outputs, K5 audit rate, plus K6–K9.
10. **Tasks:** 19, each with files, steps and a gate; ≈ 78 agent hours (≈ 10 developer-days), 2.5–3 weeks on the calendar.
11. **"Kullanıcıdan gerekenler"** is in Turkish: the table review, the ward notice (with a draft), the deploy sessions, plus the text review, biomedical, old cards, the VM rule, NBP and the numbers.

**Honesty:**
- No code here was written or replayed. Test counts are plans (`≈`).
- The equivalence test's code is complete in intent, but its request shapes (the `Encounter`, the `/clinical` body) must be fitted to the code. The plan says not to change what it compares.
- Two VM reads were refused by this session's permission system: the database's beds, and per-device parameter names. They are handed to the user (K0) and not worked around.
- The table rows come from 22.09 sources and are re-confirmed on the ward before approval.
- The hub-down and forwarder-down states look the same on the board, by design (Decision 1), and the plan says so.
- The patient-card strip will not appear on the VM until a bed map and a binding exist (Decision 9, Kullanıcıdan gerekenler 10).

**Rules kept:**
- `tests/test_infinity_vm_pilot.py` is never run.
- No patient data in any fixture or checker output.
- Tokens never printed.
- The main checkout is untouched.
- Every VM change is a user-pasted block.
