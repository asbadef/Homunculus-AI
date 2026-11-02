# Infinity dalga formu — live waveforms from the monitors, phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bed's live ECG, pressure, pleth and respiration waves, decoded from the monitor's multicast payload on the hub, drawn ≈ 2 s behind the monitor on a `<canvas>` under the strip on the device screen and the patient screen (and full screen), unvalidated and display only — no sound, no number, nothing stored.

**Architecture:** The hub decodes the wave blocks of every acknowledged packet into a 20 s in-memory ring per monitor (`edge/infinity_waves.py`) and serves them on `GET /infinity-research/waves` (viewer token, 1–16 monitors, one hub-wide cursor). The API's `GET /infinity-waves/{device_id}` (`api/infinity_waves.py`) passes the strip board's own gates by calling the board handler itself, then fetches the monitor's last 10 s from the hub through one keep-alive `httpx.AsyncClient` with a 250 ms single-flight cache, and hands each caller the blocks after its own cursor through an allow-list plus a catalogue. The dashboard's per-session wave store polls every 750 ms only while a panel watches a monitor and the tab is visible; pure geometry (`waveGeometry.js`) turns blocks into polylines and row states; `WaveRows`/`WavePanel`/`WaveFullscreen` draw them and say "sinyal yok" / "akış durdu · N sn" in words.

**Tech Stack:** Python 3.12, FastAPI, httpx 0.28 (now a runtime dependency of the API), pytest + pytest-asyncio (`asyncio_mode = "auto"`); React 18, Vite 5, Vitest 2 + jsdom, four languages (az default, tr source, ru, en).

**Spec:** `docs/superpowers/specs/2026-10-27-infinity-dalga-formu-design.md` (approved 2026-10-27, W1–W6), **as corrected by the lead's BED08 note of 2026-10-27** (commit `302ac83` amends §2, §4, §9; see "Read this before Task 1"). **Protocol:** `docs/INFINITY-DALGA-FORMU.md`. **Phase 2 (§11, the wall) is not in this plan;** the hub route already takes several `device` parameters on one cursor (Task 4), which is what phase 2 needs.

**Branch:** `feat/infinity-dalga` in the worktree `/c/tmp/inf-dalga` (base main `b985810` + the lead's docs `f45dcbf`, `c57bfdb`, `302ac83`, `5b9047b` — the last only records why V1 stays open). Work only there. Every code reference below was read at `302ac83`; every code block in this plan was run against that tree while the plan was written — Tasks 1–13 and 15 (the latter on the screens as they are before Aşama B), with the engine and dashboard suites green and the build green (Task 16 has the numbers); Task 14's doc anchors were checked to occur exactly once.

---

## Read this before Task 1

**What exists (at `302ac83`).**
- Worker: forwards every datagram as a transport event with `payload_base64` (`--capture-payload`); event keys `edge/infinity_stream.py:119-121` (`id`, `source_ip`, `group`, `received_at`, `mode`, `payload_bytes`, `sha256`, `payload_base64`, …). No worker change in this plan.
- Hub `edge/infinity_hub.py`: `create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time, research_view=None, timings=None)` (`:64-65`); tokens distinct, ≥ 32 chars (`:66-67`); `POST /v1/packets` (`:118`) appends to the journal and then calls `research_view.consume(...)` (`:159-162`); `GET /infinity-research/state` (`:167-172`, 409 when research is off); `GET /v1/status` (`:214`, shows `timings`). `edge/infinity_live.py` `LiveResearchView` keys monitors by `source_ip` and refuses an event `received_at` ≥ 3 s old or in the future (`:24`, `:90-97`). `edge/infinity_timing.py:28-29` `HUB_NAMES` is the hub's closed list of timing names (`valid_snapshot`).
- Runner `scripts/run_infinity_transport.py`: `--unverified-live-research` needs a hub with `--capture-payload` (`:61-65`); `create_hub(...)` at `:94-95`.
- Release `deploy/infinity/build_transport_release.py:23-24` (`EDGE`), pinned by `tests/test_infinity_release.py:16-23` (`FILES`) and `:61-63` (the import check). Files are read from git `HEAD`, so a new edge module must be **committed** before the release test can pass.
- API: `api/infinity_research.py` (the research window; settings `INFINITY_HUB_URL` https-only, `INFINITY_VIEWER_TOKEN`, `INFINITY_HUB_CA_FILE`, `:43-53`; it uses `urllib`, not httpx). `api/app.py`: research router imported and included at `:464`, `:475`; `_caller` `:514`, `_scope` `:567`; `GET /infinity-shadow/board` is `shadow_board(authorization)` at `:1029-1061` — its gates are `board.view` or `devices.manage` (403), the stage (`{"stage": "off"}`), the hospital (`{"stage": "off"}` for another one), the scope lambdas, then `board_view(...)` (`api/infinity_shadow.py:458-529`), whose cards carry `source` (the monitor's address) and no inventory id. Aşama B (Lane A) will make the board answer `"stage": "rules"` too, so "the strip is on" is tested here as "the answer has `beds`", never as `stage == "shadow"`.
- `httpx` is pinned in `homunculus-engine/constraints.txt` (`httpx==0.28.1` and its dependencies) but is only a **dev** extra in `pyproject.toml`: the API image (`pip install -c constraints.txt .`) does not have it today. Task 5 makes it a runtime dependency; `constraints.txt` needs no change (its freeze already holds it).
- Dashboard: `live/data/shadowStore.js` + `ShadowProvider.jsx` (the strip's store; `useShadow()`); `live/screens/common/MonitorStrip.jsx` (`MonitorStrip`, `readUnknown`, `stripOn`); `live/screens/patient/PatientScreen.jsx:251-254` (`monitor` = the card with `link === "one"`), `:356-361` (the strip under the vitals); `live/screens/devices/DevicesScreen.jsx:25-41` (`Device`); `backendApi.js` `request: authed` (the escape hatch, `:819`) and `authed(path, { timeoutMs })`; the session store exposes `api` and `track` (`live/session/sessionStore.js:595`, `:602`); `live/i18n/catalog.js` registers namespaces; `live/i18n/strings.test.js` checks every namespace's completeness; `src/reachable.test.js` fails for any product module the page cannot reach; `live/boundaries.test.js` is the strip's alarm-path rule. No `<canvas>` exists yet.

**The BED08 correction (lead, 2026-10-27, commit `302ac83`).** It overrides the spec where they differ:
1. ECG lead identity is **not** fixed by id (BED07: `0x0103` live; BED08: `0x0102` live, `0x0103`/`0x0104` all-`0x0001`). ECG rows are chosen by **liveness**, preferring id order `0x0102, 0x0103, 0x0104, 0x0122, 0x0124`, at most two; every ECG row is labelled **"EKG"** with the note **"derivasyon adı doğrulanmadı"**. "II" or any lead name is never printed.
2. Two pressure waves, both mmHg = sample/40 against the screen: `0x0301` → kind `pressure`, label `ART`; `0x0e01` → kind `pressure`, label `P1`. "ART" only for `0x0301`. Any pressure row uses the fixed 0–200 (→ 250) mmHg axis; both rows when both are live, after ECG and before pleth.
3. Everything else stands. **`edge/infinity_records.py` is not touched by this plan** (its HR/PLS label issue is handled elsewhere).

**Decisions this plan takes where the spec is silent or ambiguous** (each is in the code and its tests):

| # | Decision | Why |
|---|---|---|
| R1 | A monitor is named by its **source address** (the strip card's `source`) on both routes: hub `device=192.0.2.21`, API `/infinity-waves/192.0.2.21`; the JSON field stays `device_id`. | The API knows monitors only by address (the forwarder sends no inventory id; the table maps addresses). |
| R2 | Hub blocks carry `seq` (the cursor value they were added under); the API strips it. | So one cached 10 s window serves every viewer's own cursor. |
| R3 | The API always asks the hub for `since=0` (the 10 s window) and caches **per monitor** for 250 ms. | "Several viewers of one bed cost one hub request" needs a per-monitor cache; a per-(monitor, cursor) one would not share. Cost (measured, Task 4 review): ≈ 86–113 KB per device per 10 s window (BED08-shaped / all nine waves live), ≤ 4 hub requests/s per watched monitor. Phase 2's wall must use `since` as a real cursor: 16 devices × a full window (1.4–1.8 MB) would exceed the API's 1 MiB cap, and the hub's encode of it (≈ 300 ms) is why the hub route returns `JSONResponse` (encoded on the threadpool, not the loop). |
| R4 | Hub 404 (a hub before R5 has no route) → API **503 `hub_no_waves`** ("Dalga akışı yok"); hub 409 → 503 `research_off`; 401 → 503 `hub_unauthorized`; other → 503 `hub_error` + status; timeout/connection → 503; oversize/invalid → 502; `OverflowError` (a 400-digit integer in the answer) and `httpx.InvalidURL` (a typo in `INFINITY_HUB_URL`, named at start as `misconfigured`) are caught too, never a 500. | Spec §10: the API answers "dalga akışı yok" while the hub lacks the route; never a 500. |
| R5 | A fresh block more than 10 s (`ANSWER_S`) older than the monitor's newest **clears that monitor's ring** (its clock was set back). The ring also forgets blocks **received** more than 20 s ago. | `since` floors its answer at the newest block − 10 s, so a fresh block older than that could never be served and the old newest would hide it (a 10–20 s set-back would stall the display for set-back − 10 s and leave a phantom newest for ~35 s); a transport delay is ≤ 3 s, so only a clock reaches 10 s. Otherwise a restarted monitor stalls, and a silent monitor's last blocks would be served to a new viewer as a window. (Task 2 review: the first draft cleared at 20 s.) **Known limit, pinned by a test:** a set-back of 10 s or less is not detected; it stalls (phase kept) or overlaps the old stream (phase shifted) for at most that long and self-heals (monitor clocks are not NTP-synced, so set-backs come from restarts and manual edits). |
| R5b | Ring cap: 1024 entries per monitor (`MAX_HELD`), oldest dropped. | A bound against a malformed or spoofing sender (the decoder accepts any wave id and a 64 KB packet carries ~1,200 blocks); never reached by a real bed (≈ 909 at the worst: 9 catalogue waves × 101 blocks in the inclusive 20 s window). |
| R6 | Stall timing: a row freezes when the render time (head − 2 s) reaches the data's end, greys and says "akış durdu · N sn" **1.5 s later (≈ 3.5 s after the data stopped)**, N = whole seconds since the data's end; it is cleared **10 s after the data's end**. | Spec §5.3 read literally; the acceptance "within ~3 s" is ≈ 3.5–4 s with worker batching. |
| R7 | Row choice per group: ECG ≤ 2, pressure ≤ 2, pleth 1, resp 1 — the group's **live** waves in id order; a group the monitor sends with **no** live wave still gets one row (its first id) that says "sinyal yok". | The correction's liveness rule, and §5.2: an absent ECG must read as "no signal", never as nothing. |
| R8 | Catalogue `kind` ∈ `ecg | pressure | pleth | resp`; ECG `label` is null (the screen says "EKG"); `evidence` ∈ `structural` (yapısal) / `unverified` (doğrulanmadı) / `screen_scale` (pressure: "ölçek ekranla doğrulandı"). | The correction; spec §3.2's `art`/`ecg_other` kinds are superseded by it. |
| R9 | Device screen: each device's panel is **closed behind a "Dalga formunu göster" button**; the patient screen opens it. | A device list would otherwise poll every monitor at 750 ms for one biomed screen — against "pulled only for a bed someone is looking at". |
| R10 | On the patient screen the panel draws **nothing** until its first answer and nothing when waves are off (409); on the device screen (opened by hand) it says why. | The strip's rule: the screen does not advertise what it cannot fill. |
| R11 | Traces in plain ink (white on the full-screen black); no monitor colours. | The strip's Decision 14: a monitor value is never dressed in a vital's colour. |
| R12 | The browser calls `api.request(path, { timeoutMs: 4000 })` (backendApi's escape hatch) through the session's `track`; **`backendApi.js` is not changed**; the wave store is one per session (`waveStoreFor(session)`, a WeakMap), so `LiveApp.jsx` is not changed either. | Lane A edits `backendApi.js`; the shell unmounts at a lock, so the last panel's release forgets every block. |
| R13 | The pleth/resp minimum span is 200 counts. | A display constant, not a measurement; to be checked in the ward (spec §9, V5). |
| R14 | The hub decodes waves whenever it runs live research with payload capture (no separate hub flag); `INFINITY_WAVES` on the API is the switch. | Spec §3.1 hook 1; §5.7. |
| R15 | Full screen uses the browser Fullscreen API when it can, else a window-filling overlay; Esc, × or leaving browser full screen close it; Tab stays on ×; focus returns to ⤢. | W5; the shell's own full screen (`shell/TopBar.jsx`) uses the same API. |
| R16 | `INFINITY_WAVES=on` with the hub settings missing or not https → 503 with the reason (`not_configured` / `misconfigured`), logged once at start; flag off → 409 `waves_off`; strip off or another hospital → 409 `stage_off`. Gate order: the board's 401/403 first, then the flag, the stage, the monitor (404 `no_device`), the cursor (400 `bad_since`), the hub process it came from (400 `bad_started`, amendment A3). | §3.2 "status mapping"; a caller without the right learns nothing else. |
| R17 | The new boundary rule lives in its own file `live/waveBoundaries.test.js` (both directions, plus a ban on audio, speech, vibration, notification, storage and canvas-export APIs in wave modules). `src/reachable.test.js` gets a named, temporary `PENDING` list (Task 8) that Task 15 removes. | `boundaries.test.js` is shared with Lane A; the page reaches the wave modules only after the screen lines. |
| R18 | `api/app.py` gets one 4-line hunk beside the research router: a local import and `register_waves(app, board=lambda authorization: shadow_board(authorization))` — `shadow_board` is defined later in `create_app` and looked up when a request comes. The two route-inventory tests declare the route as caller-resolved outside `app.py`. | §10: one registration away from the shadow routes; the gates are the board's own, by construction. |
| R19 | The hub names its process: `create_hub` keeps `hub_started = iso_z(clock())` once, the waves answer carries it as a top-level `"started"` (both shapes), and `GET /v1/status` gains `"waves": {"cursor", "refused", "started"}` — only when the hub has a `WaveBuffer`. Task 5 reads `started`. | (1) `WaveBuffer.refused` (events turned away: not live, over 3 s old, ahead of the hub's clock) was surfaced nowhere, so a worker clock a few hundred ms ahead of the hub's would black out every wave while the journal acknowledged each packet; the status page now shows it. (2) A restarted hub counts its cursor from 0 again, and "a cursor ahead of the hub's counts as 0" is only a heuristic (a cursor can be *behind* the new count and silently skip blocks); a per-process token makes the restart exact for every caller. (Task 2 review.) |

*R19 in Task 5 (lead amendment A2).* `api/infinity_waves.py` requires `started` as a non-empty string on every hub answer (without it the answer is `hub_invalid`, 502), passes it to the browser top-level and unchanged, and `answer(…, started=…)` serves the whole window to a caller whose cursor came from another hub process; the cursor is always the answer's top-level `cursor`, never read from a block (blocks are in device-time order, so `seq` is not monotonic down the list).

*R16 / R19 in Task 7 (lead amendment A3).* The route reads an optional `started` (the hub process the caller's cursor came from; at most `MAX_TEXT` = 40 characters, a longer one is 400 `bad_started`; empty names no process and is served the whole window) and passes it to `answer(…, started=…)`; the five route reasons (`waves_off`, `stage_off`, `no_device`, `bad_since`, `bad_started`) join `REASONS`, each emitted as a literal `{"reason": "…"}` so the scan test stays meaningful; the answer is a `JSONResponse` carrying its own `Cache-Control: no-store` (FastAPI's `jsonable_encoder` on a bare dict measured 7.2 ms against 0.75 ms for a first full window; the injected `Response`'s headers do not reach a returned response); and the app's custom `lifespan` closes `app.state.wave_feed` at teardown (Starlette ignores `add_event_handler("shutdown")` once a lifespan is set). Task 7 review: R16's order (the board's 401/403, the flag, the stage, the monitor, the cursor) is pinned by `test_the_gates_answer_in_r16s_order`, and `checked()` bounds the hub's cursor to `0 <= cursor < MAX_CURSOR` (10**15) so that what the browser sends back as `since` always passes the route's 15-digit `SINCE`.

**Ground rules (every task).**
- TDD: the failing test first, then the code. Run tests in the **foreground** with a timeout; never background a suite and wait.
- Engine: from `/c/tmp/inf-dalga/homunculus-engine`, `PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files>`. Never run `tests/test_infinity_vm_pilot.py` (`--ignore` it in whole-suite runs). Never export `DATABASE_URL`; the DB tests skip without `TEST_DATABASE_URL` (≈ 650 skips is normal). The ldap3 `DeprecationWarning`s and Starlette's "install `httpx2`" warning are known noise.
- Dashboard: from `/c/tmp/inf-dalga/dashboard`, `npx vitest run <files>`; `npx vite build` at the end. A `Warning: … not wrapped in act(...)` printed from `Sepsis` in `PatientScreen.test.jsx` predates this plan.
- Line endings: the repository stores LF; the Windows checkout has CRLF (`core.autocrlf=true`). Make Edits with the Edit tool (it keeps a file's endings); a new file may be written with LF. Never append to a CRLF file with `cat >>`.
- **No patient data, ever.** Tests and the dev script use TEST-NET addresses (`192.0.2.x`), made-up integer patterns and round device times; nothing from a capture.
- Commit each task with a pathspec, the house style (a descriptive subject, a body that says why), ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **Do not push** and do not merge into `main`; the owner decides.
- Do not touch `edge/infinity_records.py`, `MonitorStrip.jsx`, `shadowStore.js`, `backendApi.js` or `LiveApp.jsx`. `PatientScreen.jsx` and `DevicesScreen.jsx` are touched **only in Task 15**, after Aşama B is on `main`.

---

## File map

| File | Task | Change |
|---|---|---|
| `homunculus-engine/src/homunculus/edge/infinity_waves.py` | 1, 2 | new: `WAVES`, `WaveBlock`, `parse_waves`, `iso_z`; then `WaveBuffer` |
| `homunculus-engine/tests/infinity_wave_packets.py` | 1 | new: the synthetic packet builder (not collected) |
| `homunculus-engine/tests/test_infinity_waves.py` | 1, 2 | new: decoder, then ring |
| `deploy/infinity/build_transport_release.py`, `homunculus-engine/tests/test_infinity_release.py` | 3 | `infinity_waves` in `EDGE` / `FILES` / the import check |
| `homunculus-engine/src/homunculus/edge/infinity_timing.py` | 4 | `HUB_NAMES` += `waves_ms`, `waves_read_ms` |
| `homunculus-engine/src/homunculus/edge/infinity_hub.py` | 4 | `waves=` param, consume after the journal, `GET /infinity-research/waves` (with `started`), `waves` in `/v1/status` (R19) |
| `homunculus-engine/scripts/run_infinity_transport.py` | 4 | a `WaveBuffer` with live research; one printed line |
| `homunculus-engine/tests/test_infinity_waves_hub.py` | 4 | new |
| `homunculus-engine/src/homunculus/api/infinity_waves.py` | 5, 7 | new: settings, `checked`, `answer`, `HubWaves`; then `register` |
| `homunculus-engine/pyproject.toml` | 5 | `httpx>=0.27` in `dependencies` (and out of the `dev` extra) |
| `homunculus-engine/tests/test_infinity_waves_api.py` | 5, 7 | new: the pieces, then the route |
| `deploy/local/web/nginx.conf`, `homunculus-engine/tests/test_nginx_routes.py`, `dashboard/vite.config.js` | 6 | `/infinity-waves` |
| `homunculus-engine/src/homunculus/api/app.py` | 7 | one hunk beside the research router |
| `homunculus-engine/tests/test_route_inventory.py`, `homunculus-engine/tests/test_tenant_isolation.py` | 7 | the route declared |
| `deploy/local/docker-compose.yml`, `deploy/local/.env.example`, `homunculus-engine/tests/test_local_compose_env.py` | 7 | `INFINITY_WAVES` |
| `dashboard/src/live/data/waves.testutil.js`, `waveStore.js`, `waveStore.test.js` | 8 | new |
| `dashboard/src/reachable.test.js` | 8, 15 | `PENDING` added, then removed |
| `dashboard/src/live/screens/common/waveGeometry.js`, `.test.js` | 9 | new |
| `dashboard/src/live/i18n/strings/waves.js`, `i18n/catalog.js`, `i18n/waves.strings.test.js` | 10 | new namespace |
| `dashboard/src/live/screens/common/WaveRows.jsx`, `WavePanel.jsx`, `WaveFullscreen.jsx` + `WavePanel.test.jsx`, `WaveFullscreen.test.jsx` | 11 | new |
| `dashboard/src/live/waveBoundaries.test.js` | 12 | new |
| `homunculus-engine/scripts/dev_waves_replay.py`, `homunculus-engine/tests/test_dev_waves_replay.py` | 13 | new (synthetic local replay) |
| `docs/INFINITY-*.md`, G2 spec, Aşama A plan, `docs/homunculus-rehber-TR.md`, `edge/infinity_live.py`, `edge/infinity_research.py`, `i18n/strings/patient.js` | 14 | spec §12's statements |
| `dashboard/src/live/screens/patient/PatientScreen.jsx`, `devices/DevicesScreen.jsx` (+ tests), `live/session/testTokens.testutil.js` | 15 | **after Aşama B is on main** |

---

### Task 0: Environment and baseline

**Files:** none.

- [ ] **Step 1: The worktree.**

```bash
cd /c/tmp/inf-dalga && git status --short && git branch --show-current && git log --oneline -3
```
Expected: no output from `status` (a clean tree; `dashboard/node_modules/` and `dashboard/dist/` are ignored), `feat/infinity-dalga`, the plan's commits on top of the lead's `5b9047b` (or later docs commits of the lead).

- [ ] **Step 2: The two toolchains.**

```bash
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys, fastapi, httpx; print(sys.version.split()[0], fastapi.__version__, httpx.__version__)"
cd /c/tmp/inf-dalga/dashboard && ls node_modules/.bin/vitest || npm ci --no-audit --no-fund
```
Expected: `3.12.13 0.142.2 0.28.1`; then either the vitest path, or `npm ci` ending `added 532 packages` (≈ 2 min).

- [ ] **Step 3: Engine baseline** (≈ 3 min, foreground):

```bash
cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 timeout 1200 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```
Expected: `N passed, M skipped`, no failure. **Record N and M** (Task 16 compares). Measured at `302ac83` while this plan was written: `2420 passed, 654 skipped`.

- [ ] **Step 4: Dashboard baseline** (≈ 30 s) and build:

```bash
cd /c/tmp/inf-dalga/dashboard && timeout 900 npx vitest run 2>&1 | tail -4 && timeout 600 npx vite build 2>&1 | grep -E "built in|precache"
```
Expected: `Test Files F passed (F)`, `Tests T passed (T)`; `✓ built in …`, `precache  20 entries`. **Record F and T.** Measured at `302ac83`: `91 passed (91)`, `2467 passed (2467)`.

- [ ] **Step 5: Nothing to commit.**

---

### Task 1: The wave-block decoder

The pure part of `edge/infinity_waves.py`: the catalogue every layer shares, the block, `parse_waves` (never raises; `[]` unless blocks tile from offset 64; stops at the first non-block and keeps what came before) and `iso_z`. Standard library only — the hub release packs `edge/` alone.

**Files:**
- Create: `homunculus-engine/tests/infinity_wave_packets.py` (a helper module; no `test_` prefix, so pytest does not collect it — `pythonpath` includes `tests`)
- Create: `homunculus-engine/tests/test_infinity_waves.py`
- Create: `homunculus-engine/src/homunculus/edge/infinity_waves.py`

- [ ] **Step 1: The synthetic packet builder.** Create `homunculus-engine/tests/infinity_wave_packets.py`:

```python
"""Synthetic Infinity waveform payloads for tests (Lane C, dalga).

No capture bytes and no patient values: every sample is a made-up integer pattern, every device
time a round number. The layout is docs/INFINITY-DALGA-FORMU.md's: a 64-byte header (byte 29 the
message type), then blocks `u16 rate | u16 len | u16 ms | u32 device_s | u16 wave_id | u8 n | u8 0 |
n x i16`, big-endian, len = 14 + 2n, n = rate / 5.
"""
import struct

HEADER = 64
ECG, ECG_OTHER, PRESSURE_ART, PRESSURE_P1, PLETH, RESP = 0x0103, 0x0102, 0x0301, 0x0E01, 0x1916, 0x0201


def samples_for(rate, start=0):
    """A made-up pattern of rate/5 samples, well inside every row's range."""
    return [((start + i) * 37) % 401 - 200 for i in range(rate // 5)]


def block(wave_id, rate, samples=None, *, ms=40, device_s=1000, size=None, n=None):
    """One block. `size` and `n` override the declared length and count (to build broken ones)."""
    values = samples_for(rate) if samples is None else list(samples)
    count = len(values) if n is None else n
    length = 14 + 2 * len(values) if size is None else size
    return (struct.pack(">HHHIHBB", rate, length, ms, device_s, wave_id, count, 0)
            + struct.pack(f">{len(values)}h", *values))


def no_signal(wave_id, rate, **kwargs):
    """The monitor's "no signal" block: every sample 0x0001."""
    return block(wave_id, rate, [1] * (rate // 5), **kwargs)


def packet(*blocks, kind=0x03, tail=b""):
    """A payload: the header, the blocks, then `tail` (a record section, garbage)."""
    header = bytearray(HEADER)
    header[29] = kind
    return bytes(header) + b"".join(blocks) + tail


def tick(device_s, ms, *, ecg=True, pressure=True, pleth=True, resp=True):
    """One 200 ms packet of a bed sending ECG (0x0103), ART at a flat 100 mmHg, pleth and resp."""
    parts = []
    if ecg:
        parts.append(block(ECG, 200, ms=ms, device_s=device_s))
    if pressure:
        parts.append(block(PRESSURE_ART, 100, [4000] * 20, ms=ms, device_s=device_s))
    if pleth:
        parts.append(block(PLETH, 100, ms=ms, device_s=device_s))
    if resp:
        parts.append(block(RESP, 50, ms=ms, device_s=device_s))
    return packet(*parts)


def at(k, start=1000):
    """(device_s, ms) of the k-th 200 ms packet after `start` s: ms runs 40, 240, 440, 640, 840."""
    device_s, ms = divmod(start * 1000 + k * 200 + 40, 1000)
    return device_s, ms
```

- [ ] **Step 2: Write the failing decoder tests.** Create `homunculus-engine/tests/test_infinity_waves.py`:

```python
"""Lane C (dalga): the wave-block decoder and the hub's 20 s ring. Synthetic payloads only
(infinity_wave_packets.py): no capture, no monitor traffic, no patient values."""
import pytest

from infinity_wave_packets import ECG, PLETH, PRESSURE_ART, PRESSURE_P1, RESP, block, no_signal, packet, tick
from homunculus.edge.infinity_waves import WAVES, parse_waves


# --- the decoder -----------------------------------------------------------------------------------

@pytest.mark.parametrize("rate", [50, 100, 200, 250, 500])
def test_every_allowed_rate_decodes_with_rate_over_five_samples(rate):
    [found] = parse_waves(packet(block(ECG, rate, ms=240, device_s=77)))
    assert (found.rate, found.ms, found.device_s, found.wave_id) == (rate, 240, 77, ECG)
    assert len(found.samples) == rate // 5 and found.t_ms == 77_240


def test_the_four_waves_of_one_packet_decode_in_order_with_signed_samples():
    blocks = parse_waves(tick(1000, 40))
    assert [b.wave_id for b in blocks] == [ECG, PRESSURE_ART, PLETH, RESP]
    assert blocks[0].samples[0] == -200 and min(blocks[0].samples) < 0 < max(blocks[0].samples)
    assert blocks[1].samples == (4000,) * 20


def test_a_block_of_nothing_but_0x0001_is_no_signal_and_a_lone_1_is_data():
    assert parse_waves(packet(no_signal(ECG, 200)))[0].samples is None
    assert parse_waves(packet(block(ECG, 200, [1] * 39 + [2])))[0].samples[0] == 1


def test_decoding_stops_at_the_record_section_and_keeps_the_blocks_before_it():
    record_section = (72).to_bytes(2, "big") + bytes(70)            # what follows the blocks at 1/s
    blocks = parse_waves(packet(block(ECG, 200), block(RESP, 50), kind=0x0A, tail=record_section))
    assert [b.wave_id for b in blocks] == [ECG, RESP]


@pytest.mark.parametrize("broken", [
    block(ECG, 200, n=41),                    # n is not rate / 5
    block(ECG, 200, size=95),                 # len is not 14 + 2n
    block(ECG, 300, [0] * 60),                # not an allowed rate
    block(ECG, 200, ms=1000),                 # not a millisecond of a second
])
def test_a_malformed_first_block_yields_nothing(broken):
    assert parse_waves(packet(broken)) == []


def test_a_truncated_block_is_dropped_and_the_whole_ones_before_it_kept():
    payload = packet(block(ECG, 200), block(PRESSURE_ART, 100))
    assert [b.wave_id for b in parse_waves(payload[:-1])] == [ECG]


@pytest.mark.parametrize("garbage", [b"", bytes(63), bytes(64), bytes(500), b"\xff" * 300, None, "text", 42])
def test_anything_else_is_no_blocks_and_never_an_exception(garbage):
    assert parse_waves(garbage) == []


def test_the_catalogue_names_no_ecg_lead_and_calls_only_0x0301_art():
    ecg = {wave: entry for wave, entry in WAVES.items() if entry["kind"] == "ecg"}
    assert set(ecg) == {0x0102, 0x0103, 0x0104, 0x0122, 0x0124}
    assert all(entry["label"] is None for entry in ecg.values())
    pressure = {wave: entry for wave, entry in WAVES.items() if entry["kind"] == "pressure"}
    assert {wave: entry["label"] for wave, entry in pressure.items()} == {PRESSURE_ART: "ART", PRESSURE_P1: "P1"}
    assert all(entry["unit"] == "mmHg" and entry["scale"] == 1 / 40 for entry in pressure.values())
    assert {entry["kind"] for entry in WAVES.values()} == {"ecg", "pressure", "pleth", "resp"}
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves.py`
Expected: `1 error` — `ModuleNotFoundError: No module named 'homunculus.edge.infinity_waves'`.

- [ ] **Step 4: Write the decoder.** Create `homunculus-engine/src/homunculus/edge/infinity_waves.py`:

```python
"""Waveform blocks in the Infinity multicast payload: decoded, and the last seconds kept per monitor.

Research decoding for DISPLAY ONLY (docs/INFINITY-DALGA-FORMU.md; the dalga spec, §3.1). Nothing
here interprets a sample: no rate, beat, alarm or other number is derived from a wave. The hub
keeps WINDOW_S of blocks per monitor in memory and nothing else; the journal keeps its encrypted
raw payloads exactly as before, and nothing here reads it. Standard library only: the release
packs `edge/` alone (deploy/infinity/build_transport_release.py).

A payload is a 64-byte header (byte 29: the message type), then blocks, back to back:

    u16 rate_hz | u16 len | u16 ms | u32 device_s | u16 wave_id | u8 n | u8 0 | n x i16, big-endian

with len == 14 + 2n and n == rate / 5: one block is 200 ms of one wave. The once-a-second message
carries the numeric-record section after the same blocks, so decoding stops at the first thing
that is not a block and keeps what came before it. A block whose samples are ALL 0x0001 means "no
signal" (lead off, channel closed): it is kept with `samples=None` and must never be drawn as a
flat line, which reads as asystole. A lone 1 inside a live block is data.

Monitors are named by their source address, as the strip names them (`edge/infinity_shadow.py`
sends no inventory name), so the API can find a monitor on a strip card and ask for it here.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import datetime, timezone

SCHEMA = "homunculus.infinity-waves.v1"
HEADER = 64
_BLOCK = struct.Struct(">HHHIHBB")            # rate, len, ms, device_s, wave_id, n, zero: 14 bytes
RATES = frozenset({50, 100, 200, 250, 500})
NO_SIGNAL = 0x0001


def _ecg(evidence):
    return {"kind": "ecg", "label": None, "rate": 200, "unit": None, "scale": None, "evidence": evidence}


def _pressure(label, rate):
    return {"kind": "pressure", "label": label, "rate": rate, "unit": "mmHg", "scale": 1 / 40,
            "evidence": "screen_scale"}


#: wave id -> what the API and the screen say about it (docs/INFINITY-DALGA-FORMU.md, "Dalga
#: kimlikleri", and the lead's ward note of 2026-10-27, BED08). ECG: the live channel is NOT fixed
#: by id (0x0103 on BED07, 0x0102 on BED08), so no ECG id carries a lead name; the screen picks the
#: live ones. Pressure: two ids, both mmHg = sample / 40 against the screen; 0x0301 is the screen's
#: "ART", 0x0e01 the screen's "P1" — a pressure is called "ART" only when its id is 0x0301. A rate
#: here is what was seen; the block's own rate is what is drawn.
WAVES = {
    0x0102: _ecg("structural"),
    0x0103: _ecg("structural"),
    0x0104: _ecg("unverified"),
    0x0122: _ecg("unverified"),
    0x0124: _ecg("unverified"),
    0x0301: _pressure("ART", 100),
    0x0E01: _pressure("P1", 100),
    0x1916: {"kind": "pleth", "label": "Pleth", "rate": 100, "unit": None, "scale": None, "evidence": "structural"},
    0x0201: {"kind": "resp", "label": "RESP", "rate": 50, "unit": None, "scale": None, "evidence": "structural"},
}


@dataclass(frozen=True)
class WaveBlock:
    rate: int
    ms: int
    device_s: int
    wave_id: int
    samples: tuple[int, ...] | None        # None: every sample was 0x0001, "no signal"

    @property
    def t_ms(self) -> int:
        """Device time in whole milliseconds: exact, so two copies of a block compare equal."""
        return self.device_s * 1000 + self.ms


def parse_waves(payload) -> list[WaveBlock]:
    """The wave blocks of one payload, in order. Pure; never raises; [] for anything else."""
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        return []
    data = bytes(payload)
    blocks = []
    offset = HEADER
    try:
        while offset + _BLOCK.size <= len(data):
            rate, size, ms, device_s, wave_id, n, _zero = _BLOCK.unpack_from(data, offset)
            if (rate not in RATES or n != rate // 5 or size != _BLOCK.size + 2 * n or ms > 999
                    or offset + size > len(data)):
                break                         # the record section, a truncated block, or not a block
            samples = struct.unpack_from(f">{n}h", data, offset + _BLOCK.size)
            blocks.append(WaveBlock(rate, ms, device_s, wave_id,
                                    None if all(s == NO_SIGNAL for s in samples) else samples))
            offset += size
    except struct.error:
        return blocks
    return blocks


def iso_z(epoch: float) -> str:
    """An epoch as UTC ISO 8601 with milliseconds and a Z."""
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
```

- [ ] **Step 5: Run the tests.**

Run: the command of Step 3.
Expected: `22 passed`.

- [ ] **Step 6: Commit** (the release test of Task 3 reads this module from `HEAD`, so it must be committed).

```bash
cd /c/tmp/inf-dalga && git add homunculus-engine/src/homunculus/edge/infinity_waves.py homunculus-engine/tests/infinity_wave_packets.py homunculus-engine/tests/test_infinity_waves.py && git commit -m "feat(infinity): decode the waveform blocks of a monitor payload (Lane C, dalga)" -m "parse_waves reads the blocks that tile a payload from byte 64 — rate in {50, 100, 200, 250, 500}, n = rate/5, len = 14 + 2n, ms below 1000 — and stops at the first thing that is not one (the record section of the once-a-second message, a truncated block), keeping what came before; it never raises. A block of nothing but 0x0001 is 'no signal' and decodes to None, never to a flat line. WAVES is the catalogue every layer shares, as corrected by the BED08 note of 2026-10-27: five ECG channels with no lead name (the live one differs by bed), two pressure waves at sample/40 (0x0301 ART, 0x0e01 P1), pleth and resp. Tests are synthetic packets only." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The hub's 20 s ring

`WaveBuffer`: per monitor (by address), the last 20 s of blocks ordered by device time, one per (time, wave); the `LiveResearchView` freshness rule (refuse a packet ≥ 3 s old, from the future, or not live); one hub-wide cursor; `since(sources, cursor)` with the 10 s cap; a monitor clock set back clears its ring (R5).

**Files:**
- Modify: `homunculus-engine/src/homunculus/edge/infinity_waves.py` (imports; append the ring)
- Modify: `homunculus-engine/tests/test_infinity_waves.py` (imports; append the ring tests)

- [ ] **Step 1: Write the failing ring tests.** In `tests/test_infinity_waves.py`, replace the two import lines (as of `4cf75f3` the first one also imports `ECG_OTHER` and the second `RATES`, which Task 1's review added: keep them and add the new names to the lists below)

```python
from infinity_wave_packets import ECG, PLETH, PRESSURE_ART, PRESSURE_P1, RESP, block, no_signal, packet, tick
from homunculus.edge.infinity_waves import WAVES, parse_waves
```

with

```python
from infinity_wave_packets import (
    ECG, PLETH, PRESSURE_ART, PRESSURE_P1, RESP, at, block, no_signal, packet, tick,
)
from homunculus.edge.infinity_live import MAX_TRANSPORT_DELAY as LIVE_MAX_TRANSPORT_DELAY
from homunculus.edge.infinity_stream import Inventory, packet_event
from homunculus.edge.infinity_waves import (
    ANSWER_S, MAX_HELD, MAX_TRANSPORT_DELAY, WAVES, WINDOW_S, WaveBuffer, parse_waves,
)
```

and append to the end of the file (after a blank line):

```python
# --- the ring --------------------------------------------------------------------------------------

def inventory(count=2):
    return Inventory.parse({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": f"synthetic-{i}", "source": f"192.0.2.{i}", "group": f"239.20.1.{i}", "port": 2050}
        for i in range(1, count + 1)]})


INV = inventory()
BED = "192.0.2.1"


def event(payload, stamp, *, index=0, mode="live"):
    return packet_event(INV, INV.devices[index], payload, 2564, received_at=stamp, retain_payload=True, mode=mode)


def ring(now):
    return WaveBuffer(INV, clock=lambda: now[0])


def times(found, source=BED):
    return [(b["t"], b["id"]) for b in found[source]]


def test_blocks_come_back_in_device_time_order_whatever_order_they_arrived_in():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(1), ecg=True, pressure=False, pleth=False, resp=False), 1000.0),
                   event(tick(*at(0), ecg=True, pressure=False, pleth=False, resp=False), 1000.0)])
    cursor, found = waves.since([BED], 0)
    assert cursor == 2 and times(found) == [(1000.04, ECG), (1000.24, ECG)]
    assert [b["seq"] for b in found[BED]] == [2, 1]
    assert set(found[BED][0]) == {"seq", "t", "recv", "id", "rate", "samples"}
    assert found[BED][0]["recv"] == "1970-01-01T00:16:40.000Z"


def test_a_block_seen_twice_is_kept_once():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    waves.consume([event(tick(*at(0)), 1000.0)])               # another event id, the same blocks
    cursor, found = waves.since([BED], 0)
    assert cursor == 4 and len(found[BED]) == 4


def test_a_no_signal_block_travels_as_null():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(packet(no_signal(ECG, 200)), 1000.0)])
    assert waves.since([BED], 0)[1][BED][0]["samples"] is None


@pytest.mark.parametrize("stamp, mode, kept", [
    (1000.0 - MAX_TRANSPORT_DELAY + 0.1, "live", True),
    (1000.0 - MAX_TRANSPORT_DELAY, "live", False),             # an outbox replay after an outage
    (1000.0, "live", True),                                    # received this very instant
    (1000.5, "live", False),                                   # from the future
    (1000.0, "replay", False),
])
def test_only_a_live_packet_younger_than_three_seconds_is_added(stamp, mode, kept):
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), stamp, mode=mode)])
    assert bool(waves.since([BED], 0)[1][BED]) is kept
    assert waves.refused == (0 if kept else 1)


def test_the_ring_holds_twenty_seconds_and_an_answer_carries_ten():
    now = [0.0]
    waves = ring(now)
    for k in range(125):                                       # 25 s of packets, each fresh
        now[0] = 5000.0 + k * 0.2
        waves.consume([event(tick(*at(k), pressure=False, pleth=False, resp=False), now[0])])
    held = [entry[0] for entry in waves.devices[BED]]
    assert len(held) == 101                                    # 20.0 s of 200 ms packets, both ends held
    assert (held[-1] - held[0]) / 1000 == pytest.approx(WINDOW_S)
    found = waves.since([BED], 0)[1][BED]
    assert len(found) == 51                                    # 10.0 s of them
    assert found[-1]["t"] - found[0]["t"] == pytest.approx(ANSWER_S)


def test_after_twenty_seconds_without_data_a_monitor_answers_nothing():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    now[0] = 1000.0 + WINDOW_S + 0.1
    assert waves.since([BED], 0)[1][BED] == []


def test_the_cursor_is_one_counter_for_every_monitor():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0, index=0)])
    first, _ = waves.since([BED], 0)
    waves.consume([event(tick(*at(0)), 1000.0, index=1), event(tick(*at(1)), 1000.0, index=0)])
    cursor, found = waves.since([BED, "192.0.2.2"], first)
    assert (first, cursor) == (4, 12)
    # one device time: by wave id (0x0103, 0x0201, 0x0301, 0x1916)
    assert times(found) == [(1000.24, ECG), (1000.24, RESP), (1000.24, PRESSURE_ART), (1000.24, PLETH)]
    assert len(found["192.0.2.2"]) == 4


def test_a_cursor_from_before_a_restart_counts_as_zero():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    assert len(waves.since([BED], 10**9)[1][BED]) == 4


def test_a_monitor_clock_set_back_drops_what_was_held():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(5000, 40), 1000.0)])
    waves.consume([event(tick(100, 40), 1000.0)])
    assert {b["t"] for b in waves.since([BED], 0)[1][BED]} == {100.04}


def test_a_monitor_clock_set_back_by_fifteen_seconds_drops_what_was_held_too():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(5000, 40), 1000.0)])
    waves.consume([event(tick(4985, 40), 1000.0)])             # 15 s back: inside the ring, outside the answer
    assert {b["t"] for b in waves.since([BED], 0)[1][BED]} == {4985.04}


def test_a_block_exactly_ten_seconds_behind_the_newest_is_kept_and_served_beside_it():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(5000, 40), 1000.0)])
    waves.consume([event(tick(4990, 40), 1000.0)])             # exactly ANSWER_S back: reordering, not a clock
    assert {b["t"] for b in waves.since([BED], 0)[1][BED]} == {4990.04, 5000.04}


def test_a_set_back_of_at_most_ten_seconds_is_not_detected_and_self_heals():
    only_ecg = dict(pressure=False, pleth=False, resp=False)
    now = [1000.0]
    waves = ring(now)
    for k in range(50):                                        # 10 s on the old clock: 5000.04 ... 5009.84
        now[0] = 1000.0 + k * 0.2
        waves.consume([event(tick(*at(k, 5000), **only_ecg), now[0])])
    cursor, _ = waves.since([BED], 0)
    for k in range(25, 50):                                    # clock set back 5 s, phase kept: 5005.04 ... 5009.84
        now[0] += 0.2
        waves.consume([event(tick(*at(k, 5000), **only_ecg), now[0])])
        assert waves.since([BED], cursor) == (cursor, {BED: []})   # every key is held: nothing new for 5 s
    assert waves.refused == 0
    now[0] += 0.2
    waves.consume([event(tick(*at(50, 5000), **only_ecg), now[0])])    # the new clock passes the old newest
    assert times(waves.since([BED], cursor)[1]) == [(5010.04, ECG)]


def test_a_source_the_inventory_does_not_list_and_a_payloadless_event_are_ignored():
    now = [1000.0]
    waves = ring(now)
    assert waves.knows(BED) and not waves.knows("192.0.2.99")
    waves.consume([dict(event(tick(*at(0)), 1000.0), source_ip="192.0.2.99"),
                   dict(event(tick(*at(0)), 1000.0), payload_base64=None)])
    assert waves.cursor == 0 and waves.refused == 0


def test_a_refused_packet_in_a_batch_does_not_stop_the_others():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0),
                   event(tick(*at(1)), 1000.0 - MAX_TRANSPORT_DELAY),   # an outbox replay
                   event(tick(*at(2)), 1000.0)])
    cursor, found = waves.since([BED], 0)
    assert waves.refused == 1 and cursor == 8
    assert {b["t"] for b in found[BED]} == {1000.04, 1000.44}


def test_a_monitor_holds_at_most_max_held_blocks_whatever_it_sends():
    now = [1000.0]
    waves = ring(now)
    for first in range(0, 2000, 100):                          # 2,000 distinct wave ids in one fresh second
        waves.consume([event(packet(*[block(0x2000 + first + i, 50, ms=40, device_s=1000) for i in range(100)]), 1000.0)])
    assert waves.cursor == 2000
    assert len(waves.devices[BED]) == len(waves.keys[BED]) == MAX_HELD
    assert len(waves.since([BED], 0)[1][BED]) == MAX_HELD


def test_the_ring_uses_the_live_views_transport_delay():
    assert MAX_TRANSPORT_DELAY == LIVE_MAX_TRANSPORT_DELAY
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves.py`
Expected: `1 error` — `ImportError: cannot import name 'ANSWER_S' from 'homunculus.edge.infinity_waves'`.

- [ ] **Step 3: Write the ring.** In `src/homunculus/edge/infinity_waves.py`, replace the import block

```python
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
```

with

```python
import base64
import bisect
import struct
import threading
import time
from array import array
from dataclasses import dataclass
from datetime import datetime, timezone
```

and append to the end of the file (after two blank lines):

```python
# --- the ring ------------------------------------------------------------------------------------

WINDOW_S = 20.0            # what the hub holds per monitor, by device time and by receipt time
ANSWER_S = 10.0            # the most one answer carries per monitor
MAX_TRANSPORT_DELAY = 3.0  # = infinity_live.MAX_TRANSPORT_DELAY: an outbox replay is never live
MAX_QUERY_DEVICES = 16     # one hub request names at most this many monitors (phase 2's wall)
MAX_HELD = 1024            # entries per monitor, oldest dropped: a bound against a malformed sender
                           # (a real bed's worst case is ~909: 9 catalogue waves x 101 blocks in the
                           # inclusive 20 s window)


def _order(entry):
    return entry[0], entry[1]


class WaveBuffer:
    """The last WINDOW_S of wave blocks per monitor, in memory, and one cursor for the whole hub.

    An entry is (t_ms, wave_id, seq, received_at, recv, rate, samples), ordered by device time and
    one per (t_ms, wave_id). `seq` is the hub-wide cursor value the block was added under, so one
    `since` serves any set of monitors (phase 2's wall). A packet received more than
    MAX_TRANSPORT_DELAY before the hub's now, from the future, or not live, adds nothing: the rule
    `LiveResearchView` applies, so a worker outbox replay after an outage never appears as live.
    A fresh block more than ANSWER_S older than the monitor's newest means the monitor's clock went
    back (a restart, a clock set): what was held is dropped rather than left to hide the new data.
    A set-back of ANSWER_S or less is not detected: it stalls (phase kept) or overlaps the old stream
    (phase shifted) for at most that long, then heals (monitor clocks are not NTP-synced, so
    set-backs come from restarts and manual edits).
    At most MAX_HELD entries are kept per monitor, the oldest dropped first."""

    def __init__(self, inventory, *, clock=time.time):
        self.clock = clock
        self.lock = threading.Lock()
        self.devices = {device.source: [] for device in inventory.devices}
        self.keys = {device.source: set() for device in inventory.devices}
        self.cursor = 0
        self.refused = 0

    def knows(self, source) -> bool:
        return source in self.devices

    def consume(self, events) -> None:
        now = self.clock()
        with self.lock:
            for event in events:
                self._consume_one(event, now)

    def _consume_one(self, event, now) -> None:
        source = event.get("source_ip")
        payload = event.get("payload_base64")
        if source not in self.devices or payload is None:
            return
        epoch = event.get("received_at")
        if (event.get("mode") != "live" or type(epoch) not in (int, float)
                or not now - MAX_TRANSPORT_DELAY < epoch <= now):
            self.refused += 1
            return
        try:
            raw = base64.b64decode(payload, validate=True)
        except (ValueError, TypeError):
            self.refused += 1
            return
        recv = iso_z(epoch)
        for block in parse_waves(raw):
            self._add(source, block, float(epoch), recv)
        self._prune(source, now)

    def _add(self, source, block, epoch, recv) -> None:
        held, keys = self.devices[source], self.keys[source]
        key = (block.t_ms, block.wave_id)
        if key in keys:
            return
        # `since` floors its answer at newest - ANSWER_S, so a fresh block older than that could never be
        # served and the old newest would hide it until it aged out. Transport delay is at most
        # MAX_TRANSPORT_DELAY, so only a monitor clock set back gets here.
        if held and block.t_ms < held[-1][0] - ANSWER_S * 1000:
            held.clear()
            keys.clear()
        self.cursor += 1
        samples = None if block.samples is None else array("h", block.samples)
        bisect.insort(held, (block.t_ms, block.wave_id, self.cursor, epoch, recv, block.rate, samples), key=_order)
        keys.add(key)
        overflow = len(held) - MAX_HELD
        if overflow > 0:
            for entry in held[:overflow]:
                keys.discard(entry[:2])
            del held[:overflow]

    def _prune(self, source, now) -> None:
        held, keys = self.devices[source], self.keys[source]
        if not held:
            return
        floor, stale = held[-1][0] - WINDOW_S * 1000, now - WINDOW_S
        cut = 0
        while cut < len(held) and (held[cut][0] < floor or held[cut][3] < stale):
            keys.discard(held[cut][:2])
            cut += 1
        if cut:
            del held[:cut]

    def since(self, sources, cursor):
        """(the hub's cursor now, {source: [block, ...]}): per monitor, the blocks added after
        `cursor` and at most ANSWER_S behind its newest block. A cursor ahead of this hub's (one
        from before a restart) counts as 0. Every source must be one `knows` accepts."""
        now = self.clock()
        with self.lock:
            current = self.cursor
            if cursor > current:
                cursor = 0
            found = {}
            for source in sources:
                self._prune(source, now)
                held = self.devices[source]
                floor = held[-1][0] - ANSWER_S * 1000 if held else 0
                found[source] = [
                    {"seq": seq, "t": t_ms / 1000, "recv": recv, "id": wave, "rate": rate,
                     "samples": None if samples is None else samples.tolist()}
                    for t_ms, wave, seq, _epoch, recv, rate, samples in held
                    if seq > cursor and t_ms >= floor]
        return current, found
```

- [ ] **Step 4: Run the tests.**

Run: the command of Step 2.
Expected: `49 passed` (the file now holds Task 1's 29 cases, after its review, plus the 20 ring cases; the first draft of this plan, before the review, said 35).

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/inf-dalga && git add homunculus-engine/src/homunculus/edge/infinity_waves.py homunculus-engine/tests/test_infinity_waves.py && git commit -m "feat(infinity): keep the last 20 s of wave blocks per monitor on the hub, on one cursor" -m "WaveBuffer holds, per monitor address, the blocks of the last 20 s ordered by device time and kept once per (time, wave); arrays of int16, not lists. It refuses what LiveResearchView refuses — a packet received 3 s or more ago, from the future, or not live — so a worker outbox replay never appears as live. One cursor for the whole hub, so one 'since' serves any set of monitors (phase 2's wall); an answer carries at most 10 s per monitor, and a cursor ahead of the hub's (from before a restart) counts as 0. A fresh block more than 20 s older than the newest means the monitor's clock went back: the ring is cleared rather than left to hide the new data; blocks received more than 20 s ago are forgotten." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The hub release carries the new module

**Files:**
- Modify: `homunculus-engine/tests/test_infinity_release.py:16-23, 61-63`
- Modify: `deploy/infinity/build_transport_release.py:23-24`

- [ ] **Step 1: Write the failing expectation.** In `tests/test_infinity_release.py`, replace

```python
    "app/src/homunculus/edge/infinity_shadow.py",          # Aşama A's forwarder, off unless drop-in 93
}
```

with

```python
    "app/src/homunculus/edge/infinity_shadow.py",          # Aşama A's forwarder, off unless drop-in 93
    "app/src/homunculus/edge/infinity_waves.py",           # Lane C (dalga): the wave blocks, display only
}
```

and replace

```python
                             "homunculus.edge.infinity_shadow",
```

with

```python
                             "homunculus.edge.infinity_shadow, homunculus.edge.infinity_waves",
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_release.py`
Expected: `2 failed, 1 passed` — the member set lacks `infinity_waves.py`, and the extracted release cannot import `homunculus.edge.infinity_waves`.

- [ ] **Step 3: Add it to the release.** In `deploy/infinity/build_transport_release.py`, replace

```python
EDGE = ("__init__", "infinity_stream", "infinity_journal", "infinity_collector", "infinity_hub",
        "infinity_live", "infinity_records", "infinity_timing", "infinity_shadow")
```

with

```python
EDGE = ("__init__", "infinity_stream", "infinity_journal", "infinity_collector", "infinity_hub",
        "infinity_live", "infinity_records", "infinity_timing", "infinity_shadow", "infinity_waves")
```

- [ ] **Step 4: Run it.** Expected: `3 passed`.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/inf-dalga && git add deploy/infinity/build_transport_release.py homunculus-engine/tests/test_infinity_release.py && git commit -m "build(infinity): the transport release packs infinity_waves (the hub's R5 will need it)" -m "The hub imports the wave module from Task 4 on, so a release without it would not start. The release test pins the member list and imports the module from the extracted release." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The hub's two hooks, and the runner

Hook 1: `/v1/packets` hands the acknowledged events to the `WaveBuffer` right after `research_view.consume`. Hook 2: `GET /infinity-research/waves?device=<addr>[&device=…]&since=<cursor>` — viewer token, 409 when there is no buffer, 400 out of bounds (0 or more than 16 devices, a repeated device, a cursor that is not 1–15 digits), 404 for an address the inventory does not list. One device → `{schema, device_id, cursor, hub_now, started, blocks}`; several → `{schema, cursor, hub_now, started, devices: {addr: {blocks}}}`. Both are timed under two new closed names, and both are returned as a `JSONResponse` so that the encoding runs on the route's threadpool thread, not on the event loop (a plain dict is encoded on the loop; measured 230–310 ms for 16 devices). (R19) `started` is the hub process's start time (`iso_z` of the hub clock at `create_hub`): a reader that holds a cursor treats a changed `started` as a restarted hub. `GET /v1/status` gains `"waves": {cursor, refused, started}` when the hub has a buffer, and has no such key otherwise.

**Files:**
- Create: `homunculus-engine/tests/test_infinity_waves_hub.py`
- Modify: `homunculus-engine/src/homunculus/edge/infinity_hub.py:4-15, 57, 64-69, 159-162, 174, 235-236`
- Modify: `homunculus-engine/src/homunculus/edge/infinity_timing.py:28-29`
- Modify: `homunculus-engine/scripts/run_infinity_transport.py:60-65, 94-95`

- [ ] **Step 1: Write the failing tests.** Create `homunculus-engine/tests/test_infinity_waves_hub.py`:

```python
"""Lane C (dalga): the hub's two hooks — `/v1/packets` hands acknowledged events to the WaveBuffer,
`GET /infinity-research/waves` answers the viewer — and the runner that wires them. Synthetic
payloads only (infinity_wave_packets.py), synthetic tokens, a throwaway journal."""
import contextlib
import importlib.util
import io
import json
import sys
import threading
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from infinity_wave_packets import ECG, at, no_signal, packet, tick
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_journal import CapacityError, Journal
from homunculus.edge.infinity_live import LiveResearchView
from homunculus.edge.infinity_stream import Inventory, packet_event
from homunculus.edge.infinity_timing import HUB_NAMES, valid_snapshot
from homunculus.edge.infinity_waves import SCHEMA, WaveBuffer

ROOT = Path(__file__).resolve().parents[2]
COLLECTOR, VIEWER = "synthetic-collector-token-" + "c" * 32, "synthetic-viewer-token-" + "v" * 32
INV = Inventory.parse({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
    {"id": f"synthetic-{i}", "source": f"192.0.2.{i}", "group": f"239.20.1.{i}", "port": 2050} for i in (1, 2)]})
BED, OTHER = "192.0.2.1", "192.0.2.2"
STARTED = "1970-01-01T00:16:40.000Z"      # the hub fixture's clock when the hub is created


def event(payload, stamp, index=0):
    return packet_event(INV, INV.devices[index], payload, 2564, received_at=stamp, retain_payload=True)


@pytest.fixture
def hub(tmp_path):
    """A hub at the hub clock 1000.0 with the live view and the WaveBuffer, as the runner builds it."""
    now = [1000.0]
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key(), clock=lambda: now[0])
    waves = WaveBuffer(INV, clock=lambda: now[0])
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, clock=lambda: now[0],
                     research_view=LiveResearchView(INV, clock=lambda: now[0], monotonic=lambda: now[0]), waves=waves)
    try:
        with TestClient(app) as client:
            yield client, waves, now
    finally:
        journal.close()


def post(client, events):
    return client.post("/v1/packets", json={"events": events}, headers={"Authorization": "Bearer " + COLLECTOR})


def read(client, *devices, since="0", token=VIEWER):
    """`since=None` leaves the parameter out of the request."""
    params = [("device", d) for d in devices] + ([] if since is None else [("since", since)])
    return client.get("/infinity-research/waves", params=params,
                      headers={"Authorization": "Bearer " + token} if token else {})


def status(client):
    return client.get("/v1/status", headers={"Authorization": "Bearer " + VIEWER}).json()


def test_only_the_viewer_token_reads_the_waves(hub):
    client, _, _ = hub
    assert read(client, BED, token=None).status_code == 401
    assert read(client, BED, token=COLLECTOR).status_code == 401
    assert read(client, BED).status_code == 200


def test_an_acknowledged_packet_reaches_the_answer_in_the_schema(hub):
    client, _, _ = hub
    assert post(client, [event(tick(*at(0)), 999.8)]).status_code == 200
    answer = read(client, BED)
    assert answer.headers["content-type"] == "application/json"
    body = answer.json()
    assert set(body) == {"schema", "device_id", "cursor", "hub_now", "started", "blocks"}
    assert body["schema"] == SCHEMA and body["device_id"] == BED and body["cursor"] == 4
    assert body["hub_now"] == "1970-01-01T00:16:40.000Z"
    assert [set(b) for b in body["blocks"]] == [{"seq", "t", "recv", "id", "rate", "samples"}] * 4
    assert body["blocks"][0]["recv"] == "1970-01-01T00:16:39.800Z"


def test_a_no_signal_block_is_null_and_the_cursor_moves_on(hub):
    client, _, _ = hub
    post(client, [event(packet(no_signal(ECG, 200, **dict(zip(("device_s", "ms"), at(0))))), 1000.0)])
    first = read(client, BED).json()
    assert first["blocks"][0]["samples"] is None
    post(client, [event(tick(*at(1)), 1000.0)])
    assert len(read(client, BED, since=str(first["cursor"])).json()["blocks"]) == 4


def test_several_monitors_in_one_request_share_one_cursor(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0, 0), event(tick(*at(0)), 1000.0, 1)])
    answer = read(client, BED, OTHER)
    assert answer.headers["content-type"] == "application/json"
    body = answer.json()
    assert set(body) == {"schema", "cursor", "hub_now", "started", "devices"}
    assert body["cursor"] == 8 and set(body["devices"]) == {BED, OTHER}
    assert all(len(entry["blocks"]) == 4 for entry in body["devices"].values())


def test_every_answer_names_the_hub_process_it_came_from(hub):
    # A caller that holds a cursor compares `started` with the one it saw before: a different value is
    # a restarted hub, whose cursor counts from 0 again. It is fixed at create_hub; `hub_now` moves.
    client, _, now = hub
    one = read(client, BED).json()
    now[0] = 1005.0
    several = read(client, BED, OTHER).json()
    assert one["started"] == several["started"] == STARTED
    assert one["hub_now"] == STARTED and several["hub_now"] == "1970-01-01T00:16:45.000Z"


@pytest.mark.parametrize("devices, since", [((), "0"), (tuple(f"192.0.2.{i}" for i in range(17)), "0"),
                                            ((BED, BED), "0"), ((BED,), "-1"), ((BED,), "x"), ((BED,), "1" * 16)])
def test_a_request_out_of_bounds_is_400(hub, devices, since):
    client, _, _ = hub
    assert read(client, *devices, since=since).status_code == 400


def test_a_monitor_the_inventory_does_not_list_is_404(hub):
    client, _, _ = hub
    assert read(client, "192.0.2.99").status_code == 404
    assert read(client, BED, "192.0.2.99").status_code == 404


def test_since_left_out_counts_as_zero_but_present_and_empty_is_400(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0)])
    body = read(client, BED, since=None).json()
    assert body["cursor"] == 4 and len(body["blocks"]) == 4
    assert read(client, BED, since="").status_code == 400


def test_sixteen_devices_pass_the_bound_and_seventeen_do_not(hub):
    client, _, _ = hub
    sixteen = [f"192.0.2.{i}" for i in range(1, 17)]
    assert read(client, *sixteen).status_code == 404            # past the 400 gate: only .1 and .2 are listed
    assert read(client, *sixteen, "192.0.2.17").status_code == 400


def test_a_wrong_token_is_401_before_any_other_check(hub, tmp_path):
    client, _, _ = hub
    seventeen = [f"192.0.2.{i}" for i in range(17)]
    assert read(client, *seventeen, token=COLLECTOR).status_code == 401        # not 400
    assert read(client, "192.0.2.99", token=None).status_code == 401           # not 404
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as plain:
            assert read(plain, BED, token=COLLECTOR).status_code == 401        # not 409
    finally:
        journal.close()


def test_without_waves_the_route_is_409_and_waves_need_payload_acceptance(tmp_path):
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with pytest.raises(ValueError, match="explicit payload"):
            create_hub(INV, journal, COLLECTOR, VIEWER, waves=WaveBuffer(INV))
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as client:
            assert read(client, BED).status_code == 409
    finally:
        journal.close()


def test_a_refused_batch_feeds_the_waves_nothing(hub):
    client, waves, _ = hub
    outsider = dict(event(tick(*at(0)), 1000.0), source_ip="192.0.2.77", group="239.20.1.77")
    assert post(client, [event(tick(*at(0)), 1000.0), outsider]).status_code == 503
    assert waves.cursor == 0


def test_a_batch_the_journal_cannot_hold_feeds_the_waves_nothing(hub, monkeypatch):
    client, waves, _ = hub

    def full(*args, **kwargs):
        raise CapacityError("full")

    monkeypatch.setattr(Journal, "append", full)
    assert post(client, [event(tick(*at(0)), 1000.0)]).status_code == 507
    assert waves.cursor == 0 and waves.refused == 0
    assert "waves_ms" not in status(client)["timings"]


def test_the_hub_times_the_decoding_and_the_reads_under_its_closed_names(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0)])
    read(client, BED)
    seen = status(client)["timings"]
    assert seen["waves_ms"][0] == 1 and seen["waves_read_ms"][0] == 1
    assert valid_snapshot(seen, HUB_NAMES)


def test_only_a_read_that_answers_is_timed(hub):
    client, _, _ = hub
    assert read(client, "192.0.2.99").status_code == 404
    assert read(client, BED, since="x").status_code == 400
    assert read(client, BED, token=None).status_code == 401
    assert "waves_read_ms" not in status(client)["timings"]
    assert read(client).status_code == 400
    assert read(client, BED).status_code == 200
    assert status(client)["timings"]["waves_read_ms"][0] == 1


def test_the_answer_is_encoded_on_a_threadpool_thread_not_on_the_event_loop(hub, monkeypatch):
    # A bare dict would be encoded by FastAPI on the loop after the threadpool hop, where it holds up
    # /v1/packets (a wall poll of 16 devices: ~300 ms). /v1/packets is the loop's own handler, so the
    # thread that renders its answer is the loop thread; the waves answer must render on another.
    client, _, _ = hub
    rendered, original = [], JSONResponse.render

    def render(self, content):
        rendered.append(threading.get_ident())
        return original(self, content)

    monkeypatch.setattr(JSONResponse, "render", render)
    post(client, [event(tick(*at(0)), 1000.0)])
    loop_thread = rendered[-1]
    assert read(client, BED).status_code == 200
    assert read(client, BED, OTHER).status_code == 200
    assert rendered[-2] != loop_thread and rendered[-1] != loop_thread


def test_the_hub_page_shows_the_wave_counters(hub):
    client, _, _ = hub
    script = client.get("/app.js").text
    assert "s.waves.cursor" in script and "s.waves.refused" in script


def test_status_shows_how_many_events_the_buffer_took_and_refused(hub):
    # A worker clock a few hundred ms ahead of the hub's makes the buffer refuse every packet while the
    # journal acknowledges it: without these numbers the waves go dark and nothing says why.
    client, _, _ = hub
    assert status(client)["waves"] == {"cursor": 0, "refused": 0, "started": STARTED}
    assert post(client, [event(tick(*at(0)), 1000.4)]).status_code == 200      # ahead of the hub's clock
    assert status(client)["waves"] == {"cursor": 0, "refused": 1, "started": STARTED}
    assert post(client, [event(tick(*at(1)), 1000.0)]).status_code == 200
    assert status(client)["waves"] == {"cursor": 4, "refused": 1, "started": STARTED}
    assert read(client, BED).json()["cursor"] == 4


def test_status_has_no_waves_object_without_a_buffer(tmp_path):
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as client:
            assert "waves" not in status(client)
    finally:
        journal.close()


# --- the runner ----------------------------------------------------------------------------------

def _runner():
    spec = importlib.util.spec_from_file_location("run_infinity_transport",
                                                  ROOT / "homunculus-engine/scripts/run_infinity_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(tmp_path, monkeypatch, *flags):
    inventory = tmp_path / "inventory.json"
    inventory.write_text(json.dumps({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": "synthetic-1", "source": BED, "group": "239.20.1.1", "port": 2050}]}), encoding="utf-8")
    database = tmp_path / f"hub-{len(list(tmp_path.glob('hub-*.sqlite')))}.sqlite"
    monkeypatch.setenv("INFINITY_STORAGE_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("INFINITY_COLLECTOR_TOKEN", COLLECTOR)
    monkeypatch.setenv("INFINITY_VIEWER_TOKEN", VIEWER)
    for name in ("INFINITY_SHADOW_URL", "INFINITY_SHADOW_TOKEN", "INFINITY_SHADOW_CA_FILE"):
        monkeypatch.delenv(name, raising=False)
    runner, served = _runner(), []
    monkeypatch.setattr(sys, "argv", ["run_infinity_transport.py", "hub", "--inventory", str(inventory),
                                      "--database", str(database), *flags])
    monkeypatch.setattr(runner.uvicorn, "run", lambda app, **kwargs: served.append(app))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = runner.main()
    return code, out.getvalue(), served


def test_the_runner_decodes_waves_with_live_research_and_says_so(tmp_path, monkeypatch):
    code, out, served = _run(tmp_path, monkeypatch, "--capture-payload", "--unverified-live-research")
    assert code == 0 and "Waveform blocks decoded for display only" in out and "the last 20 s in memory" in out
    with TestClient(served[0]) as client:
        assert read(client, BED).json()["blocks"] == []


def test_without_live_research_the_runner_decodes_no_waves(tmp_path, monkeypatch):
    code, out, served = _run(tmp_path, monkeypatch, "--capture-payload")
    assert code == 0 and "Waveform" not in out
    with TestClient(served[0]) as client:
        assert read(client, BED).status_code == 409
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves_hub.py`
Expected: failures and errors with `TypeError: create_hub() got an unexpected keyword argument 'waves'`, and the runner test failing on the missing printed line.

- [ ] **Step 3: The timing names.** In `src/homunculus/edge/infinity_timing.py`, replace

```python
HUB_NAMES = JOURNAL_NAMES | {"packets_ms", "body_ms", "validate_ms", "consume_ms", "lag_ms",
                             "batch_events", "status_ms"}
```

with

```python
HUB_NAMES = JOURNAL_NAMES | {"packets_ms", "body_ms", "validate_ms", "consume_ms", "lag_ms",
                             "batch_events", "status_ms", "waves_ms", "waves_read_ms"}
```

- [ ] **Step 4: The hub.** Eight Edits in `src/homunculus/edge/infinity_hub.py`.

(a) Replace

```python
import json
import math
import secrets
```

with

```python
import json
import math
import re
import secrets
```

(b) Replace

```python
from .infinity_timing import WORKER_NAMES, Timings, valid_snapshot
```

with

```python
from .infinity_timing import WORKER_NAMES, Timings, valid_snapshot
from .infinity_waves import MAX_QUERY_DEVICES, SCHEMA as WAVES_SCHEMA, iso_z
```

(c) Replace

```python
def create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time,
               research_view=None, timings=None):
    if min(len(collector_token), len(viewer_token)) < 32 or collector_token == viewer_token:
        raise ValueError("Use distinct collector and viewer tokens of at least 32 characters.")
    if research_view is not None and not accept_payload:
        raise ValueError("Research decoding requires explicit payload acceptance.")
```

with

```python
CURSOR = re.compile(r"[0-9]{1,15}")


def create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time,
               research_view=None, timings=None, waves=None):
    if min(len(collector_token), len(viewer_token)) < 32 or collector_token == viewer_token:
        raise ValueError("Use distinct collector and viewer tokens of at least 32 characters.")
    if research_view is not None and not accept_payload:
        raise ValueError("Research decoding requires explicit payload acceptance.")
    if waves is not None and not accept_payload:
        raise ValueError("Waveform decoding requires explicit payload acceptance.")
    # One value per hub process (named hub_started because the handlers' own `started` is a timing
    # start). The wave cursor counts from 0 in every process, so a reader that holds a cursor compares
    # this with the one it saw: a different value is a restarted hub and its cursor means nothing.
    hub_started = iso_z(clock()) if waves is not None else None
```

(d) Replace

```python
            research_view.consume(data["events"])
            timings.since("consume_ms", consuming)
```

with

```python
            research_view.consume(data["events"])
            timings.since("consume_ms", consuming)
        if waves is not None:
            # Lane C (dalga): the wave blocks of the same acknowledged events, for display only.
            decoding = timings.clock()
            waves.consume(data["events"])
            timings.since("waves_ms", decoding)
```

(e) Replace

```python
    @app.post("/infinity-research/restart")
```

with

```python
    @app.get("/infinity-research/waves")
    def research_waves(request: Request):
        """Lane C (dalga): the last seconds of wave blocks of 1 to 16 monitors, named by address,
        after one hub-wide cursor. Display only; unvalidated; nothing here reads the journal."""
        started = timings.clock()
        auth(request, viewer_token)
        if waves is None:
            raise HTTPException(409, "Waveform decoding is not enabled.")
        names = request.query_params.getlist("device")
        since = request.query_params.get("since", "0")
        if (not 1 <= len(names) <= MAX_QUERY_DEVICES or len(set(names)) != len(names)
                or not CURSOR.fullmatch(since)):
            raise HTTPException(400, "Name 1 to 16 distinct devices, and a cursor.")
        if not all(waves.knows(name) for name in names):
            raise HTTPException(404, "Unknown device.")
        cursor, found = waves.since(names, int(since))
        now = iso_z(clock())
        timings.since("waves_read_ms", started)
        # JSONResponse, not a bare dict: FastAPI would run its encoder on the event loop, where it
        # blocks /v1/packets (a wall poll of 16 devices was measured at ~300 ms); this way
        # json.dumps runs here, on the threadpool thread.
        if len(names) == 1:
            return JSONResponse({"schema": WAVES_SCHEMA, "device_id": names[0], "cursor": cursor, "hub_now": now,
                                 "started": hub_started, "blocks": found[names[0]]})
        return JSONResponse({"schema": WAVES_SCHEMA, "cursor": cursor, "hub_now": now, "started": hub_started,
                             "devices": {name: {"blocks": found[name]} for name in names}})

    @app.post("/infinity-research/restart")
```

(f) Replace

```python
        timings.since("status_ms", started)
        return {"devices": devices, "collector": collector, "archive": archive,
                "clinical_forwarding": False, "kernel_drop_count": None, "timings": timings.snapshot()}
```

with

```python
        timings.since("status_ms", started)
        answer = {"devices": devices, "collector": collector, "archive": archive,
                  "clinical_forwarding": False, "kernel_drop_count": None, "timings": timings.snapshot()}
        if waves is not None:
            # Lane C (dalga): what the buffer holds back, readable without asking for waves. `refused`
            # counts events the buffer turned away (not live, older than 3 s, ahead of the hub's clock):
            # a worker clock a few hundred ms fast would otherwise black out every wave silently.
            answer["waves"] = {"cursor": waves.cursor, "refused": waves.refused, "started": hub_started}
        return answer
```

(g) Replace

```python
from fastapi.responses import HTMLResponse, Response
```

with

```python
from fastapi.responses import HTMLResponse, JSONResponse, Response
```

(h) The hub's own page script reads `/v1/status`; show the buffer's counters on its overview line. In `JS`, replace

```python
  ' · Süresi dolan: '+(q?.counters?.expired??0)+' · Aktarım hatası: '+(q?.counters?.forward_errors??0);
```

with

```python
  ' · Süresi dolan: '+(q?.counters?.expired??0)+' · Aktarım hatası: '+(q?.counters?.forward_errors??0)+
  (s.waves?' · Dalga: imleç '+s.waves.cursor+' · reddedilen '+s.waves.refused:'');
```

- [ ] **Step 5: The runner.** Two Edits in `scripts/run_infinity_transport.py`.

(a) Replace

```python
        research_view = None
        if args.unverified_live_research:
            if args.role != "hub" or not args.capture_payload or args.replay:
                raise ValueError("Live research requires a hub with explicit payload acceptance.")
            from homunculus.edge.infinity_live import LiveResearchView
            research_view = LiveResearchView(inventory)
```

with

```python
        research_view = None
        waves = None
        if args.unverified_live_research:
            if args.role != "hub" or not args.capture_payload or args.replay:
                raise ValueError("Live research requires a hub with explicit payload acceptance.")
            from homunculus.edge.infinity_live import LiveResearchView
            from homunculus.edge.infinity_waves import WINDOW_S, WaveBuffer
            research_view = LiveResearchView(inventory)
            waves = WaveBuffer(inventory)
```

(b) Replace

```python
            app = create_hub(inventory, journal, token, viewer, accept_payload=args.capture_payload,
                             research_view=research_view, timings=timings)
```

with

```python
            app = create_hub(inventory, journal, token, viewer, accept_payload=args.capture_payload,
                             research_view=research_view, timings=timings, waves=waves)
            if waves is not None:
                print(f"Waveform blocks decoded for display only (unvalidated; the last {WINDOW_S:g} s in memory).",
                      flush=True)
```

- [ ] **Step 6: Run the hub's tests and its neighbours.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves_hub.py tests/test_infinity_waves.py tests/test_infinity_release.py tests/test_infinity_timing.py tests/test_infinity_transport.py tests/test_infinity_live.py tests/test_infinity_shadow_forwarder.py`
Expected: all pass (`26` new hub tests among them, 211 in these seven files in all; the release test passes only because Tasks 1–2 are committed — run it again after Step 7 if in doubt).

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/inf-dalga && git add homunculus-engine/src/homunculus/edge/infinity_hub.py homunculus-engine/src/homunculus/edge/infinity_timing.py homunculus-engine/scripts/run_infinity_transport.py homunculus-engine/tests/test_infinity_waves_hub.py && git commit -m "feat(infinity): the hub decodes wave blocks of acknowledged packets and serves them to the viewer token" -m "Hook 1: /v1/packets hands the events it has journaled to the WaveBuffer, next to the live research view, timed as waves_ms. Hook 2: GET /infinity-research/waves takes 1 to 16 monitor addresses and one hub-wide cursor; the viewer token only (the collector's is refused), 409 without decoding, 400 out of bounds, 404 for an address the inventory does not list. One device answers with its blocks, several with a map — the shape phase 2's wall will poll in one request. Every answer carries `started`, the hub process's start time, so a reader that holds a cursor can tell a restarted hub (whose cursor counts from 0 again) exactly; /v1/status shows the buffer's cursor, its refused count and the same token, so a worker clock ahead of the hub's is visible instead of a silent blackout. The route returns JSONResponse, so the encoding of a (large) answer runs on the threadpool thread, not on the event loop that takes /v1/packets. The runner builds the buffer only with live research and payload capture, and says so in one line." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The API's hub client — settings, the window check, the browser's copy, one keep-alive client

`api/infinity_waves.py` without its route yet: `WaveSettings` / `wave_settings_from_env` (off unless `INFINITY_WAVES=on`; the research window's three hub settings, https only), `checked` (the hub's answer, type by type — `started`, the hub process's start (R19), must be a non-empty string; blocks of an uncatalogued wave dropped), `answer` (the blocks after a caller's cursor, through the allow-list, plus the catalogue; `started` goes through to the browser unchanged, and a caller that names another hub process than the answer's is served the whole window), `REASONS` (the one set of reason codes the module emits, held by a scan test), and `HubWaves` (one `httpx.AsyncClient` for the life of the process, closed by `aclose()` at the lifespan's teardown — no redirects, no proxy from the environment, the CA pinned; 2 s; 1 MiB; a 250 ms per-monitor cache with single-flight, forgotten 250 ms after it was fetched; every failure a named outcome).

**Files:**
- Modify: `homunculus-engine/pyproject.toml` (dependencies)
- Create: `homunculus-engine/tests/test_infinity_waves_api.py`
- Create: `homunculus-engine/src/homunculus/api/infinity_waves.py`

- [ ] **Step 1: Write the failing tests.** Create `homunculus-engine/tests/test_infinity_waves_api.py`:

```python
"""Lane C (dalga): GET /infinity-waves/{device_id} — the hub behind one keep-alive client with a
250 ms single-flight cache, the allow-list, the strip board's gates, and nothing written.

The hub is never contacted: `HubWaves` gets an httpx.MockTransport. Synthetic addresses (TEST-NET
192.0.2.x), synthetic sample patterns, no patient anywhere."""
from __future__ import annotations

import ast
import asyncio
import json
import logging
import os
import subprocess
import sys
import tomllib
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from homunculus.api import infinity_waves
from homunculus.api.infinity_waves import (
    CACHE_S, MAX_BODY, REASONS, HubWaves, WaveSettings, answer, checked, wave_settings_from_env,
)
from homunculus.edge.infinity_waves import SCHEMA

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
VIEWER = "v" * 40
ON = WaveSettings(True, "https://hub.example:8766", VIEWER, "/etc/homunculus/infinity-ca.pem")
BED, OTHER_UNIT, UNLISTED = "192.0.2.10", "192.0.2.11", "192.0.2.13"
STARTED, RESTARTED = "2027-01-15T06:00:00.000Z", "2027-01-15T07:00:30.000Z"     # two hub processes


def block(seq, t, wave=0x0103, rate=200, samples="pattern"):
    values = ([(seq * 7 + i) % 300 - 150 for i in range(rate // 5)] if samples == "pattern" else samples)
    return {"seq": seq, "t": t, "recv": "2027-01-15T07:00:00.000Z", "id": wave, "rate": rate, "samples": values}


def window(blocks=None, *, device=BED, cursor=None, started=STARTED):
    # The hub lists blocks in DEVICE-TIME order (then wave id), so `seq` is not monotonic down the list.
    blocks = blocks if blocks is not None else [
        block(1, 1000.0), block(3, 1000.0, 0x0301, 100), block(2, 1000.2), block(4, 1000.2, 0x0301, 100, None)]
    return {"schema": SCHEMA, "device_id": device, "hub_now": "2027-01-15T07:00:00.500Z", "started": started,
            "cursor": cursor if cursor is not None else max((b["seq"] for b in blocks), default=0), "blocks": blocks}


class Hub:
    """A fake hub: answers the waves route with `payload` (default: a window for the monitor asked
    for), or `status`/`content`, or raises `error`; it keeps every request."""

    def __init__(self, *, status=200, payload=None, content=None, error=None, delay=0.0):
        self.status, self.payload, self.content, self.error, self.delay = status, payload, content, error, delay
        self.requests = []

    async def __call__(self, request):
        self.requests.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error("synthetic", request=request)
        if self.content is not None:
            return httpx.Response(self.status, content=self.content)
        return httpx.Response(self.status, json=self.payload if self.payload is not None
                              else window(device=request.url.params["device"]))


# --- the settings ---------------------------------------------------------------------------------

def test_the_flag_reads_on_and_names_what_stops_it():
    hub = {"INFINITY_HUB_URL": "https://hub.example:8766/", "INFINITY_VIEWER_TOKEN": VIEWER,
           "INFINITY_HUB_CA_FILE": "/etc/homunculus/infinity-ca.pem"}
    assert wave_settings_from_env({}) == WaveSettings()
    assert wave_settings_from_env({**hub, "INFINITY_WAVES": "yes"}) == WaveSettings()
    on = wave_settings_from_env({**hub, "INFINITY_WAVES": " ON "})
    assert on.on and on.url == "https://hub.example:8766" and on.token == VIEWER
    assert wave_settings_from_env({"INFINITY_WAVES": "on"}).problem == "not_configured"
    assert wave_settings_from_env({**hub, "INFINITY_WAVES": "on", "INFINITY_HUB_URL": "http://hub"}).problem == "misconfigured"
    assert VIEWER not in repr(on)


def test_a_hub_url_httpx_cannot_parse_is_named_at_start_not_raised_per_request():
    env = {"INFINITY_WAVES": "on", "INFINITY_HUB_URL": "https://hub:abc", "INFINITY_VIEWER_TOKEN": VIEWER,
           "INFINITY_HUB_CA_FILE": "/etc/homunculus/infinity-ca.pem"}
    settings = wave_settings_from_env(env)
    assert settings.problem == "misconfigured" and settings.on is False


def test_httpx_is_a_runtime_dependency_of_the_api_image():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    assert any(dep.split(">")[0].split("=")[0].strip() == "httpx" for dep in project["dependencies"])


# --- the window and the browser's copy ------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    [], {**window(), "cursor": -1}, {**window(), "cursor": True}, {**window(), "cursor": 10 ** 15},
    {**window(), "hub_now": "x" * 41},
    {key: value for key, value in window().items() if key != "started"},      # no hub process named
    {**window(), "started": ""}, {**window(), "started": 7}, {**window(), "started": "x" * 41},
    window([block(5, 1000.0)], cursor=4),                         # a block after the hub's own cursor
    window([dict(block(1, 1000.0), rate=True)]), window([dict(block(1, 1000.0), t=float("nan"))]),
    window([dict(block(1, 1000.0), t=10 ** 400)]), window([dict(block(1, 1000.0), t=2 ** 53)]),   # no OverflowError
    window([block(1, 1000.0, samples=[1] * 39)]), window([block(1, 1000.0, samples=[40000] * 40)]),
    window([block(1, 1000.0, samples=[1.5] * 40)]), window(["not a block"], cursor=1),
])
def test_checked_refuses_what_is_not_a_window(raw):
    with pytest.raises(ValueError):
        checked(raw, BED)


def test_checked_takes_an_integer_instant_a_float_holds_exactly():
    assert checked(window([dict(block(1, 1000.0), t=1000)]), BED)["blocks"][0]["t"] == 1000.0


def test_the_hubs_cursor_is_bounded_where_the_route_can_take_it_back():
    # The browser sends the cursor back as `since`, which the route admits to 15 digits.
    assert checked(window([], cursor=10 ** 15 - 1), BED)["cursor"] == 10 ** 15 - 1
    assert infinity_waves.SINCE.fullmatch(str(10 ** 15 - 1)) and not infinity_waves.SINCE.fullmatch(str(10 ** 15))


def test_checked_drops_a_wave_the_catalogue_does_not_name():
    assert [b["id"] for b in checked(window([block(1, 1000.0), block(2, 1000.0, 0x7777, 100)]), BED)["blocks"]] == [0x0103]


def test_answer_drops_seq_and_starts_again_for_a_cursor_from_before_a_restart():
    checked_window = checked(window(), BED)
    assert checked_window["started"] == STARTED
    assert [b["id"] for b in answer(BED, checked_window, 3)["blocks"]] == [0x0301]
    assert len(answer(BED, checked_window, 10)["blocks"]) == 4
    copy = answer(BED, checked_window, 0)
    assert set(copy) == {"schema", "device_id", "cursor", "hub_now", "started", "blocks", "waves"}
    assert copy["started"] == STARTED                                # the hub process, passed on unchanged
    assert all(set(b) == {"t", "recv", "id", "rate", "samples"} for b in copy["blocks"])
    assert copy["waves"]["259"]["label"] is None and copy["waves"]["3585"]["label"] == "P1"


def test_the_cursor_is_the_answers_own_never_taken_from_a_block():
    # Blocks are in device-time order, so neither the last block's seq nor the largest is the hub's
    # cursor (which also counts other monitors' blocks and blocks since dropped).
    held = checked(window([block(9, 1000.0), block(6, 1000.2), block(7, 1000.4)], cursor=12), BED)
    assert held["cursor"] == 12
    copy = answer(BED, held, 6)
    assert copy["cursor"] == 12
    assert [b["t"] for b in copy["blocks"]] == [1000.0, 1000.4]         # filtered block by block, order kept


def test_a_cursor_ahead_of_the_hubs_is_served_whole_even_from_the_same_process():
    assert len(answer(BED, checked(window(), BED), 10, started=STARTED)["blocks"]) == 4


# --- the shared client: keep-alive, the cache, single-flight, the failures -----------------------

async def test_two_viewers_of_one_bed_cost_one_hub_request_and_two_beds_two():
    gate = asyncio.Event()
    calls = []

    async def handler(request):
        calls.append(request.url.params["device"])
        await gate.wait()
        return httpx.Response(200, json=window(device=request.url.params["device"]))

    feed = HubWaves(ON, transport=httpx.MockTransport(handler))
    first, second, other = (asyncio.ensure_future(feed.window(d)) for d in (BED, BED, OTHER_UNIT))
    await asyncio.sleep(0.01)
    gate.set()
    a, b, c = await asyncio.gather(first, second, other)
    assert a is b and a.status == 200 and c.status == 200
    assert sorted(calls) == [BED, OTHER_UNIT]


async def test_an_answer_is_reused_for_250_ms_then_asked_for_again_and_forgotten():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    await feed.window(BED)
    await feed.window(BED)
    assert len(hub.requests) == 1
    request = hub.requests[0]
    assert request.url.path == "/infinity-research/waves"
    assert request.url.params.get_list("device") == [BED] and request.url.params["since"] == "0"
    assert request.headers["authorization"] == "Bearer " + VIEWER
    now[0] = CACHE_S + 0.05
    await feed.window(BED)
    assert len(hub.requests) == 2
    await asyncio.sleep(CACHE_S + 0.1)
    assert feed._cache == {}                                         # nothing outlives its 250 ms


async def test_a_failure_is_cached_too_so_a_dead_hub_is_not_hammered():
    hub = Hub(status=500)
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: 0.0)
    assert (await feed.window(BED)).status == 503
    assert (await feed.window(BED)).status == 503
    assert len(hub.requests) == 1


async def test_every_waiter_leaving_does_not_cancel_the_flight():
    gate = asyncio.Event()
    calls = []

    async def handler(request):
        calls.append(request)
        await gate.wait()
        return httpx.Response(200, json=window())

    feed = HubWaves(ON, transport=httpx.MockTransport(handler), clock=lambda: 0.0)
    waiters = [asyncio.ensure_future(feed.window(BED)) for _ in range(2)]
    await asyncio.sleep(0.01)
    for waiter in waiters:
        waiter.cancel()
    await asyncio.gather(*waiters, return_exceptions=True)
    gate.set()
    await asyncio.sleep(0.01)                                        # the flight finishes with nobody waiting
    assert feed._flights == {} and BED in feed._cache
    assert (await feed.window(BED)).status == 200 and len(calls) == 1


async def test_ten_polls_across_cache_expiry_use_one_client_and_one_hub_request_per_expiry():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    await feed.window(BED)
    client = feed._client
    for n in range(1, 11):
        now[0] = n * (CACHE_S + 0.05)
        await feed.window(BED)
        await feed.window(BED)                                       # inside the 250 ms: the cache
        assert len(hub.requests) == n + 1 and feed._client is client


async def test_aclose_ends_the_client_and_a_later_request_makes_a_fresh_one():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    await HubWaves(ON).aclose()                                      # never used: nothing to close
    await feed.window(BED)
    client = feed._client
    await feed.aclose()
    await feed.aclose()                                              # twice is fine
    assert client.is_closed and feed._client is None
    now[0] = CACHE_S + 0.05
    assert (await feed.window(BED)).status == 200
    assert feed._client is not client and not feed._client.is_closed and len(hub.requests) == 2
    await feed.aclose()


async def test_a_restarted_hub_is_served_whole_not_filtered_by_the_old_cursor():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    before = answer(BED, (await feed.window(BED)).body, 0)           # a viewer, holding cursor 4 of hub STARTED
    assert (before["started"], before["cursor"]) == (STARTED, 4)
    # The hub restarts: its cursor counts from 0 again and has already passed the viewer's 4.
    hub.payload = window([block(i, 2000.0 + i / 5) for i in range(1, 7)], cursor=6, started=RESTARTED)
    now[0] = CACHE_S + 0.05
    after = await feed.window(BED)
    assert len(hub.requests) == 2 and after.body["started"] == RESTARTED
    assert len(answer(BED, after.body, 4)["blocks"]) == 2            # a cursor alone cannot tell: blocks 1-4 are lost
    whole = answer(BED, after.body, before["cursor"], started=before["started"])
    assert whole["started"] == RESTARTED and len(whole["blocks"]) == 6
    assert len(answer(BED, after.body, 4, started=RESTARTED)["blocks"]) == 2    # the same process: the cursor filters


@pytest.mark.parametrize("hub, status, detail", [
    (Hub(status=404), 503, {"reason": "hub_no_waves"}),            # a hub without the route (before R5)
    (Hub(status=409), 503, {"reason": "research_off"}),
    (Hub(status=401), 503, {"reason": "hub_unauthorized"}),
    (Hub(status=500), 503, {"reason": "hub_error", "status": 500}),
    (Hub(status=302), 503, {"reason": "hub_error", "status": 302}),     # no redirect is followed
    (Hub(error=httpx.ConnectTimeout), 503, {"reason": "hub_timeout"}),
    (Hub(error=httpx.ConnectError), 503, {"reason": "hub_unreachable"}),
    (Hub(content=b"x" * (MAX_BODY + 1)), 502, {"reason": "hub_too_large"}),
    (Hub(content=b"not json"), 502, {"reason": "hub_invalid"}),
    (Hub(payload=window(device="192.0.2.99")), 502, {"reason": "hub_invalid"}),   # another monitor's window
    (Hub(payload={**window(), "schema": "other"}), 502, {"reason": "hub_invalid"}),
    (Hub(payload={**window(), "started": ""}), 502, {"reason": "hub_invalid"}),    # a hub that names no process
    (Hub(payload=window([dict(block(1, 1000.0), t=10 ** 400)])), 502, {"reason": "hub_invalid"}),   # json.loads takes it
])
async def test_a_hub_failure_is_a_named_outcome(hub, status, detail):
    outcome = await HubWaves(ON, transport=httpx.MockTransport(hub)).window(BED)
    assert (outcome.status, outcome.body) == (status, detail)


async def test_a_slow_hub_is_a_timeout(monkeypatch):
    monkeypatch.setattr(infinity_waves, "TIMEOUT_S", 0.05)
    outcome = await HubWaves(ON, transport=httpx.MockTransport(Hub(delay=1.0))).window(BED)
    assert (outcome.status, outcome.body) == (503, {"reason": "hub_timeout"})


def test_the_client_is_one_follows_no_redirect_and_reads_no_proxy_from_the_environment():
    feed = HubWaves(ON, transport=httpx.MockTransport(Hub()))
    client = feed._http()
    assert feed._http() is client
    assert client.follow_redirects is False and client.trust_env is False


async def test_an_unreadable_ca_file_is_a_misconfiguration_not_a_crash(tmp_path):
    feed = HubWaves(WaveSettings(True, "https://hub.example:8766", VIEWER, str(tmp_path / "missing.pem")))
    outcome = await feed.window(BED)
    assert outcome.status == 503 and outcome.body == {"reason": "misconfigured"}


async def test_a_url_httpx_refuses_is_a_misconfiguration_not_a_crash():
    feed = HubWaves(WaveSettings(True, "https://hub:abc", VIEWER, "/x.pem"), transport=httpx.MockTransport(Hub()))
    outcome = await feed.window(BED)                                 # settings catch it first; this is the net
    assert (outcome.status, outcome.body) == (503, {"reason": "misconfigured"})


def test_every_reason_the_module_emits_is_in_the_one_set():
    found = set()
    for node in ast.walk(ast.parse((SRC / "homunculus/api/infinity_waves.py").read_text(encoding="utf-8"))):
        if isinstance(node, ast.Dict):
            found.update(value.value for key, value in zip(node.keys, node.values)
                         if isinstance(key, ast.Constant) and key.value == "reason" and isinstance(value, ast.Constant))
        elif isinstance(node, ast.keyword) and node.arg == "problem" and isinstance(node.value, ast.Constant):
            found.add(node.value.value)
        elif (isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict)
              and any(isinstance(target, ast.Name) and target.id == "_UPSTREAM" for target in node.targets)):
            found.update(value.value for value in node.value.values)
    assert found == REASONS                                          # nothing emitted outside it, nothing stale in it


# --- isolation: nothing clinical ------------------------------------------------------------------

FORBIDDEN = ("homunculus.pipeline", "homunculus.rules", "homunculus.reco", "homunculus.state",
             "homunculus.canonical", "homunculus.gateway", "homunculus.api.audit", "homunculus.api.broadcast",
             "homunculus.api.notify", "homunculus.api.escalation", "homunculus.api.rehydrate",
             "homunculus.api.board", "homunculus.api.app", "homunculus.db")


def _forbidden(name):
    return any(name == f or name.startswith(f + ".") for f in FORBIDDEN)


def test_the_module_imports_nothing_clinical():
    found = set()
    for node in ast.walk(ast.parse((SRC / "homunculus/api/infinity_waves.py").read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.add(node.module or "")
    assert "homunculus.edge.infinity_waves" in found, "the scan went blind"
    assert not sorted(name for name in found if _forbidden(name))


def test_importing_it_loads_nothing_clinical_even_indirectly():
    code = ("import sys; import homunculus.api.infinity_waves; "
            "print('\\n'.join(sorted(m for m in sys.modules if m.startswith('homunculus'))))")
    loaded = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                            env={"PYTHONPATH": str(SRC), "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")}).stdout.split()
    assert "homunculus.api.infinity_waves" in loaded
    assert not [m for m in loaded if _forbidden(m)], loaded
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves_api.py`
Expected: `1 error` — `ImportError: cannot import name 'infinity_waves' from 'homunculus.api'`.

- [ ] **Step 3: httpx becomes a runtime dependency.** In `homunculus-engine/pyproject.toml`, replace

```toml
    "ldap3>=2.9",                       # Active Directory sign-in (pure Python; spec §7)
]
```

with

```toml
    "ldap3>=2.9",                       # Active Directory sign-in (pure Python; spec §7)
    "httpx>=0.27",                      # the keep-alive client to the Infinity hub (api/infinity_waves.py)
]
```

and, in the same file, take it out of the `dev` extra (it is a runtime dependency now): replace

```toml
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "httpx>=0.27", "uvicorn>=0.30"]
```

with

```toml
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "uvicorn>=0.30"]
```

`constraints.txt` is **not** regenerated: its freeze (`pip install '/b[dev]'`) already pins `httpx==0.28.1` and every package it brings (`anyio`, `certifi`, `h11`, `httpcore`, `idna`); `tests/test_api_image_dependencies.py` holds the pin within the new range.

- [ ] **Step 4: Write the module.** Create `homunculus-engine/src/homunculus/api/infinity_waves.py`:

```python
"""Lane C (dalga): a monitor's live waveform blocks, for the people the strip already shows it to.

UNVALIDATED research decoding of the bedside monitor's waveform blocks (edge/infinity_waves.py,
docs/INFINITY-DALGA-FORMU.md; the dalga spec §3.2). Display only: nothing here derives a number
from a sample, and nothing is written — no database row, no audit row, no log line that carries a
sample (tests/test_infinity_waves_api.py).

The gates are the strip board's, by construction: the route asks `GET /infinity-shadow/board`'s
own handler for this caller's board and serves a monitor only if it is on a card that board shows
them. So `board.view` or `devices.manage`, the shadow hospital and the same scope lambdas hold
here exactly as there, and a monitor the caller may not see is a 404, like one that does not exist.

Off unless INFINITY_WAVES=on. The hub is the research window's (INFINITY_HUB_URL, https only;
INFINITY_VIEWER_TOKEN; INFINITY_HUB_CA_FILE). One keep-alive client for the life of the process,
and a CACHE_S answer per monitor with single-flight, so several viewers of one bed cost one hub
request: the API always asks the hub for the monitor's last ANSWER_S and serves each caller the
blocks after its own cursor. A monitor is named by its address, the strip card's `source`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import ssl
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

import httpx

from homunculus.edge.infinity_waves import RATES, SCHEMA, WAVES

log = logging.getLogger(__name__)

CACHE_S = 0.25
TIMEOUT_S = 2.0
MAX_BODY = 1024 * 1024
MAX_TEXT = 40                         # an ISO instant, with room
MAX_CURSOR = 10 ** 15                 # the hub's cursor stays below it: the route's SINCE takes 15 digits back
BLOCK_KEYS = ("t", "recv", "id", "rate", "samples")
_UPSTREAM = {401: "hub_unauthorized", 404: "hub_no_waves", 409: "research_off"}
#: Every `reason` this module puts in a settings problem or an error body: one set, so the tests
#: (and the panel's words) read the same list. A new reason is added here or the scan test fails.
REASONS = frozenset({
    "not_configured", "misconfigured", "hub_no_waves", "research_off", "hub_unauthorized",
    "hub_error", "hub_timeout", "hub_unreachable", "hub_too_large", "hub_invalid"})


@dataclass(frozen=True)
class WaveSettings:
    on: bool = False
    url: str = ""
    token: str = field(default="", repr=False)
    ca_file: str = ""
    problem: str | None = None         # INFINITY_WAVES=on was asked for, and why it cannot run


def wave_settings_from_env(env: Mapping[str, str]) -> WaveSettings:
    """Off unless INFINITY_WAVES is "on"; then the research window's three hub settings, all set,
    the URL https. A problem leaves it off and names itself; it never stops the API."""
    if (env.get("INFINITY_WAVES", "") or "").strip().lower() != "on":
        return WaveSettings()
    url = (env.get("INFINITY_HUB_URL", "") or "").strip().rstrip("/")
    token = (env.get("INFINITY_VIEWER_TOKEN", "") or "").strip()
    ca_file = (env.get("INFINITY_HUB_CA_FILE", "") or "").strip()
    if not (url and token and ca_file):
        return WaveSettings(problem="not_configured")
    if not url.startswith("https://"):
        # The viewer credential rides in a header: never over plain HTTP (infinity_research.py).
        return WaveSettings(problem="misconfigured")
    try:
        httpx.URL(url)                 # a typo ("https://hub:abc") is named here, not raised per request
    except httpx.InvalidURL:
        return WaveSettings(problem="misconfigured")
    return WaveSettings(True, url, token, ca_file)


@dataclass(frozen=True)
class Outcome:
    status: int                        # 200, or the status the route answers with
    body: dict                         # the checked hub window (200), or {"reason": ...}


def _number(value) -> bool:
    # Not math.isfinite(value) on an int: it converts to float first, and a 400-digit integer
    # (json.loads accepts one) raises OverflowError. An int must be one a float holds exactly.
    return (type(value) is float and math.isfinite(value)) or (type(value) is int and -2**53 < value < 2**53)


def checked(raw, device: str) -> dict:
    """The hub's answer for one monitor, checked type by type; ValueError for anything else. Blocks
    of a wave the catalogue does not name are dropped: the screen has no row for them. `started` —
    the hub process's start — must be a non-empty string: an answer without it is invalid. The
    cursor is the answer's own; blocks come in device-time order, so none of them carries it."""
    if (not isinstance(raw, dict) or raw.get("schema") != SCHEMA or raw.get("device_id") != device
            or type(raw.get("cursor")) is not int or not 0 <= raw["cursor"] < MAX_CURSOR
            or not isinstance(raw.get("hub_now"), str) or len(raw["hub_now"]) > MAX_TEXT
            or not isinstance(raw.get("started"), str) or not 0 < len(raw["started"]) <= MAX_TEXT
            or not isinstance(raw.get("blocks"), list)):
        raise ValueError("not a waves window")
    blocks = []
    for block in raw["blocks"]:
        if not isinstance(block, dict):
            raise ValueError("block")
        seq, t, recv, wave, rate, samples = (block.get(k) for k in ("seq", "t", "recv", "id", "rate", "samples"))
        if (type(seq) is not int or not 0 < seq <= raw["cursor"] or not _number(t)
                or not isinstance(recv, str) or len(recv) > MAX_TEXT or type(wave) is not int
                or type(rate) is not int or rate not in RATES):
            raise ValueError("block")
        if samples is not None and (not isinstance(samples, list) or len(samples) != rate // 5
                                    or any(type(s) is not int or not -32768 <= s <= 32767 for s in samples)):
            raise ValueError("samples")
        if wave in WAVES:
            blocks.append({"seq": seq, "t": float(t), "recv": recv, "id": wave, "rate": rate, "samples": samples})
    return {"cursor": raw["cursor"], "hub_now": raw["hub_now"], "started": raw["started"], "blocks": blocks}


def answer(device: str, window: dict, since: int, started: str | None = None) -> dict:
    """The browser's copy of a checked window: the blocks after its cursor — all of them for a
    cursor from before a hub restart — through the allow-list, and the catalogue; `started` goes
    through unchanged. A cursor ahead of the hub's is from before a restart; but a restarted hub
    may already have counted past the caller's cursor, so a caller that says which hub process its
    cursor came from (`started`) and names another is served the whole window."""
    if since > window["cursor"] or (started is not None and started != window["started"]):
        since = 0
    return {"schema": SCHEMA, "device_id": device, "cursor": window["cursor"], "hub_now": window["hub_now"],
            "started": window["started"],
            "blocks": [{key: block[key] for key in BLOCK_KEYS} for block in window["blocks"] if block["seq"] > since],
            "waves": {str(wave): dict(entry) for wave, entry in sorted(WAVES.items())}}


class HubWaves:
    """One keep-alive client to the hub for the life of the process (no redirects, no proxy, the
    research window's CA); a CACHE_S answer per monitor, single-flight, forgotten CACHE_S after it
    was fetched. Every hub request asks for the monitor's last seconds (since=0); `answer` serves
    each caller the blocks after its own cursor. It trusts its caller to ask `window()` only about
    a device on the caller's board (which bounds the cache's keys) and only when `settings.on`.
    `aclose()` ends the client: the app's lifespan teardown calls it (Starlette ignores
    add_event_handler("shutdown") when a lifespan is set)."""

    def __init__(self, settings: WaveSettings, *, transport: httpx.AsyncBaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.settings = settings
        self._transport, self._clock = transport, clock
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, int, Outcome]] = {}
        self._flights: dict[str, asyncio.Future] = {}
        self._made = 0
        self.requests = 0                 # hub requests made: the tests and the acceptance read it

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            common = {"timeout": httpx.Timeout(TIMEOUT_S), "follow_redirects": False, "trust_env": False}
            if self._transport is not None:
                self._client = httpx.AsyncClient(transport=self._transport, **common)
            else:
                context = ssl.create_default_context(cafile=self.settings.ca_file)
                # keepalive_expiry < uvicorn's timeout_keep_alive (5 s): the client drops an idle socket
                # before the hub does, so a request is never sent into a connection that is closing.
                self._client = httpx.AsyncClient(
                    verify=context, **common,
                    limits=httpx.Limits(max_connections=8, max_keepalive_connections=8, keepalive_expiry=4.0))
        return self._client

    async def aclose(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    async def window(self, device: str) -> Outcome:
        held = self._cache.get(device)
        if held is not None and 0 <= self._clock() - held[0] < CACHE_S:
            return held[2]
        flight = self._flights.get(device)
        if flight is None:
            flight = asyncio.ensure_future(self._load(device))
            self._flights[device] = flight
            flight.add_done_callback(lambda _done, key=device: self._flights.pop(key, None))
        return await asyncio.shield(flight)

    async def _load(self, device: str) -> Outcome:
        outcome = await self._fetch(device)
        self._made += 1
        made = self._made
        self._cache[device] = (self._clock(), made, outcome)
        asyncio.get_running_loop().call_later(CACHE_S, self._forget, device, made)
        return outcome

    def _forget(self, device: str, made: int) -> None:
        held = self._cache.get(device)
        if held is not None and held[1] == made:
            del self._cache[device]

    async def _fetch(self, device: str) -> Outcome:
        self.requests += 1
        try:
            client = self._http()
        except (OSError, ssl.SSLError, ValueError):
            return Outcome(503, {"reason": "misconfigured"})
        body = bytearray()
        try:
            async with asyncio.timeout(TIMEOUT_S):
                async with client.stream("GET", self.settings.url + "/infinity-research/waves",
                                         params={"device": device, "since": "0"},
                                         headers={"Authorization": "Bearer " + self.settings.token}) as response:
                    if response.status_code != 200:
                        reason = _UPSTREAM.get(response.status_code)
                        return Outcome(503, {"reason": reason} if reason else
                                       {"reason": "hub_error", "status": response.status_code})
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BODY:
                            return Outcome(502, {"reason": "hub_too_large"})
        except (TimeoutError, httpx.TimeoutException):
            return Outcome(503, {"reason": "hub_timeout"})
        except httpx.InvalidURL:                  # not an HTTPError; settings catch it first, this is the net
            return Outcome(503, {"reason": "misconfigured"})
        except httpx.HTTPError:
            return Outcome(503, {"reason": "hub_unreachable"})
        try:
            return Outcome(200, checked(json.loads(body), device))
        except (ValueError, TypeError, RecursionError, OverflowError):
            return Outcome(502, {"reason": "hub_invalid"})
```

- [ ] **Step 5: Run the tests and the dependency pins.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves_api.py tests/test_api_image_dependencies.py`
Expected: all pass (`54` in the new file, `4` in the dependency file). The cache test sleeps 0.35 s on purpose (the entry must be gone after 250 ms of real time).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/inf-dalga && git add homunculus-engine/pyproject.toml homunculus-engine/src/homunculus/api/infinity_waves.py homunculus-engine/tests/test_infinity_waves_api.py && git commit -m "feat(api): the waveform panel's hub client — one keep-alive connection, a 250 ms single-flight cache, an allow-list" -m "HubWaves keeps one httpx.AsyncClient for the life of the API (no TLS handshake per poll; the research window's CA pinned, no redirect followed, no proxy read from the environment; 2 s; 1 MiB) and answers each monitor from a 250 ms cache with single-flight, so several viewers of one bed cost one hub request and a dead hub is not hammered. It always asks the hub for the monitor's last 10 s; answer() serves each caller the blocks after its own cursor (all of them for a cursor from before a hub restart), through an allow-list, with the catalogue. Every hub failure is a named status — a hub without the route (before R5) is 'hub_no_waves' — never a 500. httpx moves from the dev extra to the API's dependencies; constraints.txt already pins it." -m "The hub answer's 'started' (R19) is required by checked() and passed to the browser unchanged; answer() takes the 'started' a caller's cursor was issued under and serves the whole window when it names another hub process, because a restarted hub may already have counted past that cursor. The cursor is the answer's own, never read from a block (blocks come in device-time order)." -m "Nothing the hub sends or the settings say can make window() raise: a 400-digit integer instant is refused (OverflowError is named hub_invalid), a URL httpx cannot parse is 'misconfigured' at start and per request; HubWaves.aclose() ends the client at teardown; the reason codes live in one set (REASONS) that a test holds against the source." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `/infinity-waves` through nginx and the dev server

**Files:**
- Modify: `homunculus-engine/tests/test_nginx_routes.py:22-29`
- Modify: `deploy/local/web/nginx.conf:140-143`
- Modify: `dashboard/vite.config.js:103`

- [ ] **Step 1: Write the failing expectation.** In `tests/test_nginx_routes.py`, replace

```python
    "/infinity-shadow/board", "/infinity-shadow/readings", "/patients", "/ack",
```

with

```python
    "/infinity-shadow/board", "/infinity-shadow/readings", "/infinity-waves/192.0.2.10", "/patients", "/ack",
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_nginx_routes.py`
Expected: `1 failed` — `test_api_path_is_proxied[/infinity-waves/192.0.2.10]`.

- [ ] **Step 3: nginx.** In `deploy/local/web/nginx.conf`, replace

```nginx
    # own token, and the board GETs them; the API decides both (the body limit is the API's, 64 KiB).
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|patients|ack|ingest|view|audit|health)(/|$) {
```

with

```nginx
    # own token, and the board GETs them; the API decides both (the body limit is the API's, 64 KiB).
    # infinity-waves (Lane C, dalga): the live waveform panel's GET, behind the strip board's gates.
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health)(/|$) {
```

- [ ] **Step 4: The dev server's proxy** (`src/devProxy.test.js` holds it to nginx's list). In `dashboard/vite.config.js`, replace

```js
      "/infinity-shadow",   // Aşama A's monitor strip (the board GET; the POST is the hub forwarder's)
```

with

```js
      "/infinity-shadow",   // Aşama A's monitor strip (the board GET; the POST is the hub forwarder's)
      "/infinity-waves",    // Lane C (dalga): the live waveform panel's GET
```

- [ ] **Step 5: Run both.**

Run: the command of Step 2, then `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/devProxy.test.js`
Expected: all pass; `5 passed` for the dev proxy.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/inf-dalga && git add deploy/local/web/nginx.conf dashboard/vite.config.js homunculus-engine/tests/test_nginx_routes.py && git commit -m "build(web): /infinity-waves reaches the API through nginx and the dev server" -m "Without the prefix nginx would answer the panel's poll with index.html and a 200, and the client would fail far from the cause." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The route — `GET /infinity-waves/{device_id}` behind the strip board's own gates

`register(app, board=…)` adds the route; `board(authorization)` is `shadow_board` itself, so its 401 and 403 are this route's and its cards are exactly what this caller may see (R16, R18). Then: the flag (409 `waves_off`, or 503 with the reason it cannot run), the strip (409 `stage_off` — the stage off or another hospital), the monitor on one of the caller's cards (404 `no_device`, the same for "not yours" and "none"), the cursor (400 `bad_since`), the hub process it came from (400 `bad_started`; A3), the hub (Task 5's outcomes). `Cache-Control: no-store`, on a `JSONResponse` (A3).

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/infinity_waves.py` (imports; the five route reasons into `REASONS`; append the route)
- Modify: `homunculus-engine/tests/test_infinity_waves_api.py` (append the route tests)
- Modify: `homunculus-engine/src/homunculus/api/app.py:475` (one hunk) and the `lifespan` teardown (`:433`, one guarded `aclose()` — A3)
- Modify: `homunculus-engine/tests/test_route_inventory.py:21, 41-43`, `homunculus-engine/tests/test_tenant_isolation.py:722-729, 783`
- Modify: `deploy/local/docker-compose.yml:71`, `deploy/local/.env.example:122`, `homunculus-engine/tests/test_local_compose_env.py:28-36`

- [ ] **Step 1: Write the failing route tests.** Append to the end of `tests/test_infinity_waves_api.py` (after a blank line):

```python
# === the route: GET /infinity-waves/{device_id}, behind the strip board's own gates ===============

from homunculus.api.app import create_app  # noqa: E402
from homunculus.api.audit import InMemoryAuditLog  # noqa: E402
from homunculus.api.identity import Caller  # noqa: E402
from homunculus.api.infinity_shadow import SCHEMA as SHADOW_SCHEMA, ShadowSettings  # noqa: E402
from homunculus.api.patient_identity import InMemoryIdentityStore  # noqa: E402
from homunculus.scope import Scope, ScopeReason  # noqa: E402

HOSPITAL, DEVICE_TOKEN, SHADOW = "HOSP1", "tok-device-00000000000000000000000000", "s" * 40
T0 = 1_800_000_000.0


def _row(source, label, bed, unit):
    return {"source": source, "group": "239.20.1." + source.rsplit(".", 1)[1], "port": 2050, "bed_label": label,
            "bed_id": bed, "unit_id": unit, "method": "monitor_screen", "verified_at": "2026-07-14",
            "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""}


TABLE = {"schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic",
         "approved_by": "test", "approved_at": "2026-07-14",
         "devices": [_row(BED, "B-1", "bed-b1", "unit-1"), _row(OTHER_UNIT, "B-2", "bed-b2", "unit-2")]}
CALLERS = {
    "nurse-jwt": Caller(hospital=HOSPITAL, actor="ayse", groups=("nurse",), perms=frozenset({"board.view"})),
    "scoped-jwt": Caller(hospital=HOSPITAL, actor="elif", groups=("nurse",), perms=frozenset({"board.view"})),
    "biomed-jwt": Caller(hospital=HOSPITAL, actor="ahmet", groups=("biomedical",), perms=frozenset({"devices.manage"})),
    "none-jwt": Caller(hospital=HOSPITAL, actor="synth-none"),
    "elsewhere-jwt": Caller(hospital="HOSP2", actor="x", groups=("nurse",), perms=frozenset({"board.view"})),
}
SCOPES = {"scoped-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"unit-1"}))}


async def _resolve_jwt(token):
    return CALLERS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


def _hdr(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


def _readings(now):
    return {"schema": SHADOW_SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 10, "old_or_duplicate_packets": 0},
            "devices": [{"source": s, "group": "239.20.1." + s.rsplit(".", 1)[1], "port": 2050,
                         "status": "streaming", "packet_age_ms": 120.0,
                         "readings": [{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True,
                                       "captured_at": now - 0.4}]}
                        for s in (BED, OTHER_UNIT, UNLISTED)]}


@contextmanager
def _client(tmp_path, *, hub=None, settings=ON, stage=True, audit=None):
    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(TABLE), encoding="utf-8")
    shadow = ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(path)) if stage else ShadowSettings()
    app = create_app({DEVICE_TOKEN: HOSPITAL}, run_escalation_loop=False, resolve_jwt=_resolve_jwt,
                     resolve_scope=_resolve_scope, shadow=shadow, shadow_clock=lambda: T0,
                     audit=audit if audit is not None else InMemoryAuditLog(), identities=InMemoryIdentityStore())
    hub = hub if hub is not None else Hub()
    app.state.wave_feed = HubWaves(settings, transport=httpx.MockTransport(hub))
    with TestClient(app) as client:
        if stage:
            assert client.post("/infinity-shadow/readings", json=_readings(T0), headers=_hdr(SHADOW)).status_code == 200
        yield client, hub


def _get(client, device=BED, token="nurse-jwt", since="0", started=None):
    params = {"since": since} if started is None else {"since": since, "started": started}
    return client.get(f"/infinity-waves/{device}", params=params, headers=_hdr(token))


def test_a_permitted_caller_gets_the_monitors_blocks_and_the_catalogue(tmp_path):
    with _client(tmp_path) as (client, hub):
        response = _get(client)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"schema", "device_id", "cursor", "hub_now", "started", "blocks", "waves"}
    assert (body["schema"], body["device_id"], body["cursor"], body["started"]) == (SCHEMA, BED, 4, STARTED)
    assert [set(b) for b in body["blocks"]] == [{"t", "recv", "id", "rate", "samples"}] * 4
    assert body["blocks"][3]["samples"] is None
    assert body["waves"]["259"] == {"kind": "ecg", "label": None, "rate": 200, "unit": None, "scale": None,
                                    "evidence": "structural"}
    assert body["waves"]["769"]["label"] == "ART" and body["waves"]["3585"]["label"] == "P1"
    assert body["waves"]["769"]["unit"] == "mmHg" and body["waves"]["769"]["scale"] == 0.025
    assert [r.url.params["device"] for r in hub.requests] == [BED]


def test_each_caller_gets_the_blocks_after_its_own_cursor(tmp_path):
    with _client(tmp_path) as (client, _):
        assert [b["id"] for b in _get(client, since="2").json()["blocks"]] == [0x0301, 0x0301]   # seq 3, 4
        assert _get(client, since="4").json()["blocks"] == []
        assert len(_get(client, since="999").json()["blocks"]) == 4          # a cursor from before a hub restart
        for bad in ("-1", "x", "1" * 16):
            response = _get(client, since=bad)
            assert response.status_code == 400 and response.json()["detail"] == {"reason": "bad_since"}


def test_a_caller_names_the_hub_process_its_cursor_came_from(tmp_path):
    # The hub restarted and has already counted past the viewer's cursor 4: a cursor alone would
    # silently skip blocks 1-4; the process name makes the restart exact (R19, amendment A3).
    restarted = Hub(payload=window([block(i, 2000.0 + i / 5) for i in range(1, 7)], cursor=6, started=RESTARTED))
    with _client(tmp_path, hub=restarted) as (client, _):
        same = _get(client, since="4", started=RESTARTED)
        other = _get(client, since="4", started=STARTED)
        unsaid = _get(client, since="4")
        nothing = _get(client, since="4", started="")
    assert [b["t"] for b in same.json()["blocks"]] == [2000.0 + 5 / 5, 2000.0 + 6 / 5]      # same process: it filters
    assert len(other.json()["blocks"]) == 6 and other.json()["started"] == RESTARTED       # another: the whole window
    assert len(unsaid.json()["blocks"]) == 2                                                # no claim: the cursor alone
    assert nothing.status_code == 200 and len(nothing.json()["blocks"]) == 6                # names no process: whole


def test_a_started_longer_than_the_hubs_is_400_bad_started_after_the_cursor_and_before_the_hub(tmp_path):
    with _client(tmp_path) as (client, hub):
        too_long = _get(client, started="x" * 41)
        assert too_long.status_code == 400 and too_long.json()["detail"] == {"reason": "bad_started"}
        assert _get(client, started="x" * 1000).status_code == 400
        assert _get(client, since="x", started="x" * 41).json()["detail"] == {"reason": "bad_since"}   # the cursor first
        assert _get(client, "192.0.2.99", started="x" * 41).json()["detail"] == {"reason": "no_device"}  # the monitor first
        assert hub.requests == []
        assert _get(client, started="x" * 40).status_code == 200                # the hub's own bound
    assert len(hub.requests) == 1


def test_only_the_allow_list_reaches_the_browser(tmp_path):
    extra = window([dict(block(1, 1000.0), secret="no"), block(2, 1000.0, 0x7777, 100)])
    extra["internal"] = "no"
    with _client(tmp_path, hub=Hub(payload=extra)) as (client, _):
        body = _get(client).json()
    assert "internal" not in body
    assert body["blocks"] == [{key: block(1, 1000.0)[key] for key in ("t", "recv", "id", "rate", "samples")}]


def test_nothing_is_written_and_no_log_line_carries_a_sample(tmp_path, caplog):
    audit = InMemoryAuditLog()
    caplog.set_level(logging.DEBUG)
    marked = Hub(payload=window([block(1, 1000.0, samples=[4321] * 40)]))
    with _client(tmp_path, hub=marked, audit=audit) as (client, _):
        before = len(audit.records(tenant=HOSPITAL))
        assert _get(client).json()["blocks"][0]["samples"] == [4321] * 40
        assert len(audit.records(tenant=HOSPITAL)) == before
    assert "4321" not in caplog.text


def test_no_credential_is_401_and_no_permission_is_403_before_the_hub_is_asked(tmp_path):
    with _client(tmp_path) as (client, hub):
        assert _get(client, token=None).status_code == 401
        assert _get(client, token="none-jwt").status_code == 403
    assert hub.requests == []


@pytest.mark.parametrize("token", ["nurse-jwt", "biomed-jwt", DEVICE_TOKEN])
def test_board_view_devices_manage_and_the_device_token_are_let_in(tmp_path, token):
    with _client(tmp_path) as (client, _):
        assert _get(client, token=token).status_code == 200


def test_a_monitor_the_callers_scope_does_not_reach_is_a_404_like_an_unknown_one(tmp_path):
    with _client(tmp_path) as (client, hub):
        assert _get(client, BED, "scoped-jwt").status_code == 200
        for device in (OTHER_UNIT, UNLISTED, "192.0.2.99"):
            response = _get(client, device, "scoped-jwt")
            assert response.status_code == 404 and response.json()["detail"] == {"reason": "no_device"}
        assert _get(client, "192.0.2.99", "biomed-jwt").status_code == 404
    assert [r.url.params["device"] for r in hub.requests] == [BED]


def test_an_unassigned_monitor_is_served_to_those_the_board_shows_it(tmp_path):
    with _client(tmp_path) as (client, _):
        assert _get(client, UNLISTED, "biomed-jwt").status_code == 200
        assert _get(client, UNLISTED, "nurse-jwt").status_code == 200       # unrestricted


def test_another_hospital_sees_the_strip_off(tmp_path):
    with _client(tmp_path) as (client, hub):
        response = _get(client, token="elsewhere-jwt")
    assert response.status_code == 409 and response.json()["detail"] == {"reason": "stage_off"}
    assert hub.requests == []


def test_waves_off_is_409_and_a_flag_that_cannot_run_is_503_with_its_reason(tmp_path):
    with _client(tmp_path, settings=WaveSettings()) as (client, hub):
        response = _get(client)
        assert response.status_code == 409 and response.json()["detail"] == {"reason": "waves_off"}
    with _client(tmp_path, settings=WaveSettings(problem="not_configured")) as (client, hub):
        response = _get(client)
        assert response.status_code == 503 and response.json()["detail"] == {"reason": "not_configured"}
    assert hub.requests == []


def test_the_strip_off_is_409_stage_off(tmp_path):
    with _client(tmp_path, stage=False) as (client, hub):
        response = _get(client)
    assert response.status_code == 409 and response.json()["detail"] == {"reason": "stage_off"}


def test_the_gates_answer_in_r16s_order(tmp_path):
    def refused(response, status, reason=None):
        assert response.status_code == status and (reason is None or response.json()["detail"] == {"reason": reason})

    with _client(tmp_path, settings=WaveSettings()) as (client, _):                 # waves off
        refused(_get(client, token=None), 401)                                      # the board before the flag
        refused(_get(client, token="none-jwt"), 403)
        refused(_get(client, token="elsewhere-jwt"), 409, "waves_off")              # the flag before the stage
    with _client(tmp_path, stage=False, settings=WaveSettings()) as (client, _):
        refused(_get(client), 409, "waves_off")
    with _client(tmp_path) as (client, _):                                          # waves on
        refused(_get(client, "192.0.2.99", since="x"), 404, "no_device")            # the monitor before the cursor


def test_every_refusal_the_route_makes_names_a_reason_from_the_one_set(tmp_path):
    seen = set()
    with _client(tmp_path) as (client, _):
        seen.update(r.json()["detail"]["reason"]
                    for r in (_get(client, "192.0.2.99"), _get(client, since="x"), _get(client, started="x" * 41)))
    for kwargs in ({"settings": WaveSettings()}, {"settings": WaveSettings(problem="not_configured")},
                   {"settings": WaveSettings(problem="misconfigured")}, {"stage": False}):
        with _client(tmp_path, **kwargs) as (client, _):
            response = _get(client)
            assert response.status_code in (409, 503)
            seen.add(response.json()["detail"]["reason"])
    assert seen == {"no_device", "bad_since", "bad_started", "waves_off", "not_configured", "misconfigured",
                    "stage_off"}
    assert seen <= REASONS


def test_a_hub_failure_reaches_the_browser_as_its_named_status_never_a_500(tmp_path):
    with _client(tmp_path, hub=Hub(status=404)) as (client, _):
        response = _get(client)
    assert response.status_code == 503 and response.json()["detail"] == {"reason": "hub_no_waves"}


def test_the_hub_client_is_closed_when_the_app_stops(tmp_path):
    with _client(tmp_path) as (client, _):
        feed = client.app.state.wave_feed
        assert _get(client).status_code == 200
        http = feed._client
        assert http is not None and not http.is_closed
    assert http.is_closed and feed._client is None                   # the lifespan's teardown closed it


def test_the_app_reads_the_flag_from_its_environment_at_start(monkeypatch):
    monkeypatch.setenv("INFINITY_WAVES", "on")
    for name in ("INFINITY_HUB_URL", "INFINITY_VIEWER_TOKEN", "INFINITY_HUB_CA_FILE"):
        monkeypatch.delenv(name, raising=False)
    app = create_app({DEVICE_TOKEN: HOSPITAL}, run_escalation_loop=False)
    assert app.state.wave_feed.settings.problem == "not_configured"
    monkeypatch.delenv("INFINITY_WAVES")
    assert create_app({DEVICE_TOKEN: HOSPITAL}, run_escalation_loop=False).state.wave_feed.settings == WaveSettings()
```

- [ ] **Step 2: Declare the route where the route inventories expect it.** In `tests/test_route_inventory.py`, replace

```python
CALLER_RESOLVED_MODULE = "homunculus.api.app"
```

with

```python
CALLER_RESOLVED_MODULE = "homunculus.api.app"
# Lane C (dalga): the waveform GET is registered from api/infinity_waves.py, and resolves its caller
# by calling the strip board's own handler (`shadow_board`: the Caller, board.view/devices.manage).
CALLER_RESOLVED_ELSEWHERE = {"/infinity-waves/{device_id}"}
```

and replace

```python
               if r.endpoint.__module__ != CALLER_RESOLVED_MODULE
               and r.path not in PUBLIC | PRE_MFA | PRE_PASSWORD
```

with

```python
               if r.endpoint.__module__ != CALLER_RESOLVED_MODULE
               and r.path not in PUBLIC | PRE_MFA | PRE_PASSWORD | CALLER_RESOLVED_ELSEWHERE
```

In `tests/test_tenant_isolation.py`, replace

```python
    ("GET", "/infinity-research/state"),
}
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | {
```

with

```python
    ("GET", "/infinity-research/state"),
}
# Lane C (dalga): the waveform GET lives in api/infinity_waves.py but is the strip board's own gate:
# it calls `shadow_board` (the Caller, and only a caller of the ONE shadow hospital gets a card).
CALLER_ELSEWHERE = {("GET", "/infinity-waves/{device_id}")}
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | CALLER_ELSEWHERE | {
```

and replace

```python
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD == board
```

with

```python
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD - CALLER_ELSEWHERE == board
```

And in `tests/test_local_compose_env.py`, replace

```python
    _SRC / "api" / "infinity_shadow.py",
]
```

with

```python
    _SRC / "api" / "infinity_shadow.py",
    _SRC / "api" / "infinity_waves.py",
]
```

and replace

```python
          "INFINITY_CLINICAL_STAGE"}
```

with

```python
          "INFINITY_CLINICAL_STAGE", "INFINITY_WAVES"}
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves_api.py tests/test_route_inventory.py tests/test_tenant_isolation.py tests/test_local_compose_env.py`
Expected: the 20 route tests fail (`404` where 200/401/403/409 are expected; `AttributeError: … 'State' object has no attribute 'wave_feed'` in the environment test; the `started` tests, the gate-order test, the reasons test and the lifespan test with them); the tenant test fails on the stale `CALLER_ELSEWHERE` entry; the compose tests fail with `INFINITY_WAVES` missing from compose and `.env.example` — `23 failed, 59 passed, 108 skipped` over the four files.

- [ ] **Step 4: Write the route.** In `src/homunculus/api/infinity_waves.py`, three import Edits and the reasons — replace

```python
import math
import ssl
```

with

```python
import math
import os
import re
import ssl
```

replace

```python
from collections.abc import Callable, Mapping
```

with

```python
from collections.abc import Awaitable, Callable, Mapping
```

replace

```python
import httpx

from homunculus.edge.infinity_waves import RATES, SCHEMA, WAVES
```

with

```python
import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from homunculus.edge.infinity_waves import RATES, SCHEMA, WAVES
```

replace (A3: the route's five reasons join the one set; the scan test then holds the route to it)

```python
#: Every `reason` this module puts in a settings problem or an error body: one set, so the tests
#: (and the panel's words) read the same list. A new reason is added here or the scan test fails.
REASONS = frozenset({
    "not_configured", "misconfigured", "hub_no_waves", "research_off", "hub_unauthorized",
    "hub_error", "hub_timeout", "hub_unreachable", "hub_too_large", "hub_invalid"})
```

with

```python
#: Every `reason` this module puts in a settings problem or an error body: one set, so the tests
#: (and the panel's words) read the same list. A new reason is added here or the scan test fails.
#: The route's own (waves_off … bad_started) are written as literal `{"reason": "…"}` dicts, which
#: is what the scan reads; only a settings problem, whose values the scan reads at their source,
#: is passed through.
REASONS = frozenset({
    "not_configured", "misconfigured", "hub_no_waves", "research_off", "hub_unauthorized",
    "hub_error", "hub_timeout", "hub_unreachable", "hub_too_large", "hub_invalid",
    "waves_off", "stage_off", "no_device", "bad_since", "bad_started"})
```

— then append to the end of the file (after two blank lines):

```python
# --- the route ------------------------------------------------------------------------------------

SINCE = re.compile(r"[0-9]{1,15}")        # a cursor: digits only, and few enough for an int


def register(app: FastAPI, *, board: Callable[[str | None], Awaitable[dict]],
             settings: WaveSettings | None = None) -> HubWaves:
    """Add GET /infinity-waves/{device_id}. `board(authorization)` is the strip board's own handler:
    its 401 and 403 are this route's, and its cards are what this caller may see. The hub client
    is `app.state.wave_feed` (a test puts a fake hub there); the app's lifespan closes it."""
    settings = settings if settings is not None else wave_settings_from_env(os.environ)
    if settings.problem:
        # Names the problem, never a token or the URL.
        log.error("INFINITY_WAVES=on çalıştırılamıyor (%s); dalga formu kapalı", settings.problem)
    app.state.wave_feed = HubWaves(settings)

    @app.get("/infinity-waves/{device_id}")
    async def infinity_waves(device_id: str, request: Request, since: str = "0", started: str | None = None,
                             authorization: str | None = Header(default=None)):
        shown = await board(authorization)
        feed: HubWaves = request.app.state.wave_feed
        if not feed.settings.on:
            if feed.settings.problem:
                raise HTTPException(503, {"reason": feed.settings.problem})
            raise HTTPException(409, {"reason": "waves_off"})
        if shown.get("stage", "off") == "off" or "beds" not in shown:
            raise HTTPException(409, {"reason": "stage_off"})
        cards = (*shown.get("beds", ()), *shown.get("unassigned", ()))
        if not any(card.get("source") == device_id for card in cards):
            raise HTTPException(404, {"reason": "no_device"})
        if not SINCE.fullmatch(since):
            raise HTTPException(400, {"reason": "bad_since"})
        if started is not None and len(started) > MAX_TEXT:      # the hub's own bound on its `started`
            raise HTTPException(400, {"reason": "bad_started"})
        outcome = await feed.window(device_id)
        if outcome.status != 200:
            raise HTTPException(outcome.status, outcome.body)
        # A JSONResponse, not a bare dict: FastAPI's jsonable_encoder on a first full window measured
        # 7.2 ms against 0.75 ms (the hub's route does the same). The header goes on it, not on `response`.
        return JSONResponse(answer(device_id, outcome.body, int(since), started=started),
                            headers={"Cache-Control": "no-store"})

    return app.state.wave_feed
```

- [ ] **Step 5: Register it — one hunk in `app.py`, beside the research router, away from the shadow routes.** In `src/homunculus/api/app.py`, replace

```python
    app.include_router(infinity_research_router)
```

with

```python
    app.include_router(infinity_research_router)
    # Lane C (dalga): the live waveform panel's GET, behind the strip board's own gates — it calls
    # `shadow_board` (defined below; looked up when a request comes). Off unless INFINITY_WAVES=on.
    from homunculus.api.infinity_waves import register as register_waves
    register_waves(app, board=lambda authorization: shadow_board(authorization))
```

`shadow_board` is assigned later in `create_app` (`@app.get("/infinity-shadow/board")`, ≈ line 1030 after this hunk); the lambda reads it when a request arrives, by which time `create_app` has returned. If Aşama B renames `shadow_board` or changes its signature, Task 15's merge is where this line follows it (the route tests fail first).

And the one teardown line (A3): `create_app` has its own `lifespan` (`FastAPI(title="Homunculus", lifespan=lifespan)`, ≈ line 411), so `app.add_event_handler("shutdown", …)` would be silently ignored; the client is closed in that lifespan's `finally`. Replace

```python
            if ldap is not None:
                ldap.close()                 # the directory's own worker threads
```

with

```python
            if ldap is not None:
                ldap.close()                 # the directory's own worker threads
            feed = getattr(app.state, "wave_feed", None)      # Lane C (dalga): the hub client
            if feed is not None:
                await feed.aclose()
```

An app that never registered the route (`getattr` default) is unaffected; `test_the_hub_client_is_closed_when_the_app_stops` is the proof it runs.

- [ ] **Step 6: The switch reaches the container.** In `deploy/local/docker-compose.yml`, replace

```yaml
      INFINITY_HUB_CA_FILE: ${INFINITY_HUB_CA_FILE:-}
```

with

```yaml
      INFINITY_HUB_CA_FILE: ${INFINITY_HUB_CA_FILE:-}
      # Lane C (dalga) — the live waveform panel, through the same hub settings. Unset = off.
      INFINITY_WAVES: ${INFINITY_WAVES:-}
```

In `deploy/local/.env.example`, replace

```sh
#INFINITY_HUB_CA_FILE=/etc/homunculus/infinity-ca.pem
```

with

```sh
#INFINITY_HUB_CA_FILE=/etc/homunculus/infinity-ca.pem

# ---------------------------------------------------------------------------------------
# Infinity dalga (Lane C) — the live waveform panel on the device and patient screens,
# labelled "doğrulanmamış" (unvalidated), display only: no alarm, score, sound, record or
# audit row comes from it. Off unless "on". It reads the three hub settings above and needs
# the monitor strip (INFINITY_CLINICAL_STAGE below) on: a monitor gets waves only where the
# strip shows it. "on" with the hub settings missing or not https is logged at start and
# answers "not_configured" / "misconfigured"; it never stops the API. The hub must run a
# release that has the waves route (R5 or later); before that the panel says "Dalga akışı
# yok". Apply with `docker compose up -d --no-build api`.
#INFINITY_WAVES=on
```

- [ ] **Step 7: Run the route tests and every route inventory.**

Run: the command of Step 3, then `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_waves_hub.py tests/test_nginx_routes.py tests/test_infinity_shadow_api.py tests/test_infinity_shadow_isolation.py tests/test_infinity_research_api.py tests/test_api_image_dependencies.py`
Expected: all pass (`74` in `test_infinity_waves_api.py` = 54 + 15 + 4 for A3 + 1 for the gate order; `26` in `test_infinity_waves_hub.py`; `4` in the route inventory, `1 passed, 108 skipped` in the tenant file without `TEST_DATABASE_URL`, `3` compose, `44` nginx, `10` research, `45` + `18` shadow, `4` dependencies). Measured at this commit (Tasks 1–7 applied) with the whole engine suite (`--ignore=tests/test_infinity_vm_pilot.py`): `2570 passed, 654 skipped`.

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/inf-dalga && git add homunculus-engine/src/homunculus/api/infinity_waves.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_infinity_waves_api.py homunculus-engine/tests/test_route_inventory.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_local_compose_env.py deploy/local/docker-compose.yml deploy/local/.env.example && git commit -m "feat(api): GET /infinity-waves/{device_id} — a monitor's live waves behind the strip board's own gates" -m "The route calls the strip board's handler for the caller, so board.view or devices.manage, the shadow hospital and the scope are the board's own, and a monitor is served only from a card that board shows this caller; any other address is a 404, the same as none. Off unless INFINITY_WAVES=on (409 waves_off; 503 with the reason when 'on' cannot run); the strip off or another hospital is 409 stage_off. Nothing is written: no row, no audit, no log line carrying a sample." -m "An optional 'started' names the hub process a cursor came from (a restarted hub is then served whole; over 40 characters is 400 bad_started), the route's five reasons join REASONS as literal dicts, and the answer is a JSONResponse carrying its own no-store header. One hunk in app.py, beside the research router and away from the shadow routes, plus one guarded aclose() in the app's lifespan teardown so the hub client is closed with the app; the two route inventories declare the route as caller-resolved outside app.py; compose and .env.example carry the switch." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The browser's wave store

`live/data/waveStore.js`: one subscription per monitor (`watch(source)` → its release; the first watcher starts polling, the last release forgets everything), a poll every 750 ms with the cursor only while watched and the tab visible, 20 s kept, every refusal a status (R12). The panel will reach it through `waveStoreFor(session)`. Its synthetic fixtures go in `waves.testutil.js`. Until Task 15 wires the panel into the screens, the page cannot reach these modules: `src/reachable.test.js` gets a named, temporary `PENDING` list (R17).

**Files:**
- Create: `dashboard/src/live/data/waves.testutil.js`
- Create: `dashboard/src/live/data/waveStore.test.js`
- Create: `dashboard/src/live/data/waveStore.js`
- Modify: `dashboard/src/reachable.test.js:23-24, 68-70`

*R19 in Task 8 (lead amendment A4).* The browser sends the hub process back with its cursor. `waves.testutil.js` exports `STARTED`, and `answer()` carries `started` (an option, like `cursor`). `wavesPath(source, since, started)` appends `&started=…` only for a non-empty string, so the first poll names no process. `isWavesAnswer` also requires `started` to be a string of 1–40 characters (the API's `MAX_TEXT`): an answer without one is "unavailable" and keeps the blocks, cursor and process held. `IDLE_DEVICE` gains `started: null`; each answer's `started` is kept and sent back with its cursor on the next poll. An answer that names another process is a restarted hub's whole window: it is merged like any other (`mergeBlocks` keeps one block per wave and time, so the overlap adds nothing), and its cursor and process are taken even when the cursor went backwards. The store's header carries this as rule 5. Seven tests join the plan's twenty, under "the wave store and the hub process (amendment A4)", and "polls every 750 ms" now expects `&started=` on its second poll. The code blocks below predate the amendment; the committed files are the reference.

- [ ] **Step 1: The synthetic fixtures.** Create `dashboard/src/live/data/waves.testutil.js`:

```js
// Test-only: synthetic answers of GET /infinity-waves/{source} (Lane C, dalga), in the API's own
// shape (homunculus-engine api/infinity_waves.py `answer`), and the hand-driven timers, frames and
// session the wave tests use.
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6), and no capture: addresses are 192.0.2.x
// (TEST-NET-1), device times are round numbers, and every sample is a made-up integer pattern.
//
//     wblock(259, 1000.2, ramp)            one 200 ms block of ECG channel 0x0103, a made-up pattern
//     wblock(259, 1000.2, null)            a "no signal" block (the hub's all-0x0001)
//     run(769, { samples: 4000 })          8 s of ART at a flat 100 mmHg, ending at T_END
//     answer([...run(259), ...run(513)])   the API's answer carrying them

export const SOURCE = "192.0.2.10";
export const T_END = 1008;                               // device seconds: the end of the newest block
export const RECV = "2026-10-27T10:00:00.800Z";          // when the worker received every block
export const HUB_NOW = "2026-10-27T10:00:01.000Z";       // 0.2 s later, on the hub's clock

const ENTRY = (kind, label, rate, unit = null, scale = null, evidence = "structural") =>
  ({ kind, label, rate, unit, scale, evidence });
const ECG = (evidence) => ENTRY("ecg", null, 200, null, null, evidence);
const PRESSURE = (label, rate) => ENTRY("pressure", label, rate, "mmHg", 0.025, "screen_scale");

/** The API's catalogue, as api/infinity_waves.py sends it (ids as decimal strings): five ECG
 *  channels with no lead name, two pressure waves (0x0301 "ART", 0x0e01 "P1"), pleth, resp. */
export const CATALOGUE = Object.freeze({
  258: ECG("structural"), 259: ECG("structural"), 260: ECG("unverified"), 290: ECG("unverified"),
  292: ECG("unverified"), 513: ENTRY("resp", "RESP", 50), 769: PRESSURE("ART", 100), 3585: PRESSURE("P1", 100),
  6422: ENTRY("pleth", "Pleth", 100),
});
const RATE = { 258: 200, 259: 200, 260: 200, 290: 200, 292: 200, 513: 50, 769: 100, 3585: 100, 6422: 100 };

/** A made-up pattern, well inside the ECG row's ±1200 counts. */
export const ramp = (i) => ((i * 53) % 801) - 400;

const round = (x) => Math.round(x * 1000) / 1000;

/** One block of wave `id` at device time `t`: `samples` a function of the index, a number for a
 *  flat block, or null for "no signal". */
export function wblock(id, t, samples = ramp, { recv = RECV } = {}) {
  const rate = RATE[id] ?? 100;
  const n = rate / 5;
  const values = samples === null ? null
    : Array.from({ length: n }, (_, i) => (typeof samples === "function" ? samples(i) : samples));
  return { t: round(t), recv, id, rate, samples: values };
}

/** `seconds` of contiguous blocks of wave `id` ending at `end`. */
export function run(id, { end = T_END, seconds = 8, samples = ramp, recv = RECV } = {}) {
  const out = [];
  for (let k = Math.round(seconds / 0.2); k >= 1; k -= 1) out.push(wblock(id, end - k * 0.2, samples, { recv }));
  return out;
}

/** A bed like BED07: ECG live on 0x0103, ART (a flat 100 mmHg), pleth and resp. */
export const bed4 = () => [...run(259), ...run(769, { samples: 4000 }), ...run(6422), ...run(513)];

/** A bed like BED08: ECG live on 0x0102 with 0x0103 and 0x0104 "no signal", and P1 (0x0e01). */
export const bed8 = () => [...run(258), ...run(259, { samples: null }), ...run(260, { samples: null }),
  ...run(3585, { samples: 3600 })];

/** The API's answer. */
export function answer(blocks = bed4(), { cursor = blocks.length, hub_now = HUB_NOW, device_id = SOURCE } = {}) {
  return { schema: "homunculus.infinity-waves.v1", device_id, cursor, hub_now, blocks, waves: CATALOGUE };
}

/** A refusal as backendApi throws it: an Error with the HTTP status. */
export const refusal = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

export const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A timer queue the test fires by hand (shadowStore.test.js's). */
export function manualTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => { seq += 1; pending.set(seq, { fn, ms }); return seq; },
    clearTimer: (id) => { pending.delete(id); },
    get delays() { return [...pending.values()].map((p) => p.ms); },
    async fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const p of due) p.fn();
      await settle();
    },
  };
}

/** requestAnimationFrame by hand: `run(perfMs)` calls every frame due with that timestamp. */
export function manualFrames() {
  let seq = 0;
  const pending = new Map();
  return {
    raf: (fn) => { seq += 1; pending.set(seq, fn); return seq; },
    caf: (id) => { pending.delete(id); },
    get waiting() { return pending.size; },
    run(perfMs) {
      const due = [...pending.values()];
      pending.clear();
      for (const fn of due) fn(perfMs);
    },
  };
}

const READY = Object.freeze({ phase: "ready", user: null });

/** The least a <SessionProvider> needs for a component that only asks for `store`. */
export function sessionStub(api = {}) {
  return { subscribe: () => () => {}, getState: () => READY, api, track: (call) => call() };
}
```

- [ ] **Step 2: Write the failing store tests.** Create `dashboard/src/live/data/waveStore.test.js`:

```js
// The wave store (Lane C, dalga): polled only while watched and visible, with the cursor, keeping
// at most 20 s, and turning every refusal into a status — never into an empty trace.
// Synthetic blocks only (waves.testutil.js), synthetic addresses (192.0.2.x).
import { describe, it, expect, vi } from "vitest";
import {
  IDLE_DEVICE, WAVE_KEEP_S, WAVE_POLL_MS, WAVE_STATUS, WAVE_TIMEOUT_MS, createWaveStore, mergeBlocks, newestOf,
  sampleOf, statusOf, waveStoreFor, wavesPath,
} from "./waveStore.js";
import { HUB_NOW, SOURCE, T_END, answer, manualTimers, refusal, run, settle, wblock } from "./waves.testutil.js";

function harness({ reply = () => answer(), visible = true, track } = {}) {
  const timers = manualTimers();
  let shown = visible;
  const watchers = new Set();
  const clock = { perf: 5000 };
  const api = { request: vi.fn(async () => reply()) };
  const store = createWaveStore({
    api, track, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => shown,
    onVisibility: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    perfNow: () => clock.perf,
  });
  const show = async (value) => {
    shown = value;
    for (const fn of watchers) fn();
    await settle();
  };
  return { api, store, timers, show, clock, watchers };
}

describe("the wave store's polling", () => {
  it("asks for nothing until a monitor is watched, then for that monitor from cursor 0", async () => {
    const { api, store } = harness();
    await settle();
    expect(api.request).not.toHaveBeenCalled();
    store.watch(SOURCE);
    await settle();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request).toHaveBeenCalledWith(`/infinity-waves/${SOURCE}?since=0`, { timeoutMs: WAVE_TIMEOUT_MS });
  });

  it("polls every 750 ms with the cursor of the last answer", async () => {
    const { api, store, timers } = harness({ reply: () => answer(undefined, { cursor: 41 }) });
    store.watch(SOURCE);
    await settle();
    expect(timers.delays).toEqual([WAVE_POLL_MS]);
    await timers.fire();
    expect(api.request).toHaveBeenLastCalledWith(`/infinity-waves/${SOURCE}?since=41`, { timeoutMs: WAVE_TIMEOUT_MS });
    expect(store.get(SOURCE).cursor).toBe(41);
  });

  it("shares one poll between two watchers of a monitor, and the last release forgets it", async () => {
    const { api, store, timers, watchers } = harness();
    const first = store.watch(SOURCE);
    const second = store.watch(SOURCE);
    await settle();
    expect(api.request).toHaveBeenCalledTimes(1);
    first();
    first();                                   // a release is idempotent
    expect(timers.delays).toEqual([WAVE_POLL_MS]);
    second();
    expect(timers.delays).toEqual([]);
    expect(store.get(SOURCE)).toBe(IDLE_DEVICE);
    expect(watchers.size).toBe(0);
  });

  it("does not poll a hidden tab, and catches up at once when it is shown again", async () => {
    const { api, store, timers, show } = harness({ visible: false });
    store.watch(SOURCE);
    await settle();
    expect(api.request).not.toHaveBeenCalled();
    expect(timers.delays).toEqual([]);
    await show(true);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(timers.delays).toEqual([WAVE_POLL_MS]);
    await show(false);
    expect(timers.delays).toEqual([]);
  });

  it("runs every call through the session's track", async () => {
    const track = vi.fn((call) => call());
    const { store } = harness({ track });
    store.watch(SOURCE);
    await settle();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("drops an answer that lands after its monitor was released", async () => {
    let resolve;
    const { store } = harness({ reply: () => new Promise((r) => { resolve = r; }) });
    const release = store.watch(SOURCE);
    await settle();
    release();
    resolve(answer());
    await settle();
    expect(store.get(SOURCE)).toBe(IDLE_DEVICE);
  });
});

describe("the wave store's statuses", () => {
  it("keeps the blocks of an answer, the catalogue and where the monitor's clock stood", async () => {
    const { store } = harness();
    store.watch(SOURCE);
    await settle();
    const device = store.get(SOURCE);
    expect(device.status).toBe(WAVE_STATUS.OK);
    expect(Object.keys(device.blocks).sort()).toEqual(["259", "513", "6422", "769"]);
    expect(device.catalogue["769"].label).toBe("ART");
    expect(device.newest).toEqual({ t: T_END - 0.2, recv: "2026-10-27T10:00:00.800Z" });
    // the newest block's end (T_END) plus the 0.2 s between the worker's receipt and the hub's now
    expect(device.sample.deviceS).toBeCloseTo(T_END + 0.2, 6);
    expect(device.sample.perfMs).toBe(5000);
  });

  it.each([[403, WAVE_STATUS.DENIED], [404, WAVE_STATUS.GONE], [409, WAVE_STATUS.OFF]])(
    "a %i drops the blocks and stops polling (%s)", async (code, status) => {
      let reply = () => answer();
      const { store, timers } = harness({ reply: () => reply() });
      store.watch(SOURCE);
      await settle();
      reply = () => { throw refusal(code); };
      await timers.fire();
      expect(store.get(SOURCE).status).toBe(status);
      expect(store.get(SOURCE).blocks).toEqual({});
      expect(timers.delays).toEqual([]);
    });

  it.each([["a 503", () => { throw refusal(503); }], ["a network failure", () => { throw new TypeError("fetch"); }],
    ["an answer that is not one", () => ({ stage: "off" })]])(
    "%s keeps the blocks, says unavailable and keeps polling", async (_name, failing) => {
      let reply = () => answer();
      const { store, timers } = harness({ reply: () => reply() });
      store.watch(SOURCE);
      await settle();
      reply = failing;
      await timers.fire();
      expect(store.get(SOURCE).status).toBe(WAVE_STATUS.UNAVAILABLE);
      expect(Object.keys(store.get(SOURCE).blocks)).toHaveLength(4);
      expect(timers.delays).toEqual([WAVE_POLL_MS]);
    });

  it("maps a refusal to a status by its HTTP status only", () => {
    expect(statusOf(refusal(403))).toBe(WAVE_STATUS.DENIED);
    expect(statusOf(refusal(404))).toBe(WAVE_STATUS.GONE);
    expect(statusOf(refusal(409))).toBe(WAVE_STATUS.OFF);
    expect(statusOf(refusal(401))).toBe(WAVE_STATUS.UNAVAILABLE);
    expect(statusOf(new Error("no status"))).toBe(WAVE_STATUS.UNAVAILABLE);
  });
});

describe("what the wave store holds", () => {
  it("keeps one block per wave and time, in device-time order", () => {
    const held = mergeBlocks({}, [wblock(259, 1000.4), wblock(259, 1000.0), wblock(259, 1000.2)]);
    const again = mergeBlocks(held, [wblock(259, 1000.2), wblock(259, 1000.6)]);
    expect(again["259"].map((b) => b.t)).toEqual([1000, 1000.2, 1000.4, 1000.6]);
    expect(held["259"]).toHaveLength(3);                      // the old object is not changed
  });

  it("keeps nothing more than 20 s behind the monitor's newest block", () => {
    const held = mergeBlocks({}, [...run(259, { end: 1000, seconds: 2 }), wblock(513, 1000 + WAVE_KEEP_S + 5)]);
    expect(held["259"]).toBeUndefined();
    expect(held["513"]).toHaveLength(1);
  });

  it("refuses a block that is not one", () => {
    const held = mergeBlocks({}, [{ ...wblock(259, 1000), samples: [1, 2] }, { ...wblock(259, 1000.2), rate: 300 },
      { ...wblock(259, 1000.4), t: Number.NaN }, null, wblock(259, 1000.6)]);
    expect(held["259"].map((b) => b.t)).toEqual([1000.6]);
  });

  it("dates the head by the worker's and the hub's clocks, never this browser's", () => {
    const newest = newestOf({ 259: [wblock(259, 1000)], 513: [wblock(513, 1001)] });
    expect(newest.t).toBe(1001);
    expect(sampleOf(newest, HUB_NOW, 12).deviceS).toBeCloseTo(1001.4, 6);
    expect(sampleOf(newest, "not a time", 12)).toBeNull();
    expect(sampleOf(null, HUB_NOW, 12)).toBeNull();
  });

  it("builds its path with the address encoded", () => {
    expect(wavesPath("192.0.2.10", 7)).toBe("/infinity-waves/192.0.2.10?since=7");
    expect(wavesPath("a/b", 0)).toBe("/infinity-waves/a%2Fb?since=0");
  });

  it("gives a session one store, and another session another", () => {
    const session = { api: { request: vi.fn() }, track: (call) => call() };
    const store = waveStoreFor(session);
    expect(waveStoreFor(session)).toBe(store);
    expect(waveStoreFor({ api: session.api, track: session.track })).not.toBe(store);
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/data/waveStore.test.js`
Expected: the file fails to load — `Failed to resolve import "./waveStore.js"`.

- [ ] **Step 4: Write the store.** Create `dashboard/src/live/data/waveStore.js`:

```js
// src/live/data/waveStore.js — a monitor's live waveform blocks (Lane C, dalga), as GET
// /infinity-waves/{source} shows them to this session. Framework-free, in shadowStore's style; the
// panel (screens/common/WavePanel.jsx) reads it through `watch` and `useSyncExternalStore`.
//
// UNVALIDATED research decoding of the bedside monitor's waveform blocks, display only. The rules,
// each held by a test:
//   1. POLLED ONLY WHILE WATCHED AND VISIBLE. A monitor is fetched every WAVE_POLL_MS only while
//      something on screen watches it (`watch` -> its release) and the tab is visible. The first
//      watcher starts it, the last release stops it and forgets everything of that monitor.
//   2. NOTHING KEPT. Blocks more than WAVE_KEEP_S (device time) behind the monitor's newest are
//      dropped on every answer; nothing is written anywhere.
//   3. A REFUSAL IS A STATUS, NEVER AN EMPTY TRACE. 403, 404 and 409 drop the blocks and stop the
//      polling (denied, gone, off); anything else — a 5xx, a timeout, an answer that is not one —
//      is "unavailable": the blocks held stay, and age into "akış durdu" on screen.
//   4. NEVER INTO AN ALARM PATH (waveBoundaries.test.js).
// The calls go through the session's `track` and the API client's own `request` (backendApi.js's
// escape hatch for a route it does not wrap), so a refused refresh ends the session here too.

export const WAVE_POLL_MS = 750;
export const WAVE_KEEP_S = 20;
export const WAVE_BLOCK_S = 0.2;          // every block is 200 ms of one wave (n = rate / 5)
export const WAVE_TIMEOUT_MS = 4000;
export const WAVES_SCHEMA = "homunculus.infinity-waves.v1";
const RATES = new Set([50, 100, 200, 250, 500]);

export const WAVE_STATUS = Object.freeze({
  IDLE: "idle",               // nobody watches this monitor
  LOADING: "loading",         // watched; the first answer is on its way
  OK: "ok",                   // the last poll answered
  UNAVAILABLE: "unavailable", // the last poll failed (5xx, timeout, not an answer): blocks kept
  OFF: "off",                 // 409: waves or the strip are off here
  DENIED: "denied",           // 403
  GONE: "gone",               // 404: not a monitor this session may see (or none at all)
});
const POLLING = new Set([WAVE_STATUS.LOADING, WAVE_STATUS.OK, WAVE_STATUS.UNAVAILABLE]);

export const IDLE_DEVICE = Object.freeze({
  status: WAVE_STATUS.IDLE, cursor: 0, catalogue: Object.freeze({}), blocks: Object.freeze({}), newest: null, sample: null,
});

/** The API path for one monitor after `since`. */
export function wavesPath(source, since) {
  return `/infinity-waves/${encodeURIComponent(String(source))}?since=${encodeURIComponent(String(since))}`;
}

/** The status a refused call maps to. A 401 is the session's own business (`track` ends it). */
export function statusOf(err) {
  if (err?.status === 403) return WAVE_STATUS.DENIED;
  if (err?.status === 404) return WAVE_STATUS.GONE;
  if (err?.status === 409) return WAVE_STATUS.OFF;
  return WAVE_STATUS.UNAVAILABLE;
}

export const isWavesAnswer = (a) => Boolean(a) && typeof a === "object" && a.schema === WAVES_SCHEMA
  && Number.isInteger(a.cursor) && a.cursor >= 0 && typeof a.hub_now === "string" && Array.isArray(a.blocks)
  && Boolean(a.waves) && typeof a.waves === "object" && !Array.isArray(a.waves);

const isBlock = (b) => Boolean(b) && typeof b === "object" && Number.isFinite(b.t) && Number.isInteger(b.id)
  && RATES.has(b.rate) && typeof b.recv === "string"
  && (b.samples === null || (Array.isArray(b.samples) && b.samples.length === b.rate / 5
    && b.samples.every(Number.isFinite)));

function insertAt(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** What a monitor holds after an answer: per wave id, ordered by device time, one block per time,
 *  nothing more than WAVE_KEEP_S behind the monitor's newest block. Pure: `held` is not changed. */
export function mergeBlocks(held, incoming) {
  const out = { ...held };
  const copied = new Set();
  for (const block of incoming) {
    if (!isBlock(block)) continue;
    const id = String(block.id);
    if (!copied.has(id)) {
      out[id] = [...(out[id] ?? [])];
      copied.add(id);
    }
    const list = out[id];
    const at = insertAt(list, block.t);
    if (at < list.length && list[at].t === block.t) continue;          // held already
    list.splice(at, 0, block);
  }
  let newest = -Infinity;
  for (const list of Object.values(out)) if (list.length > 0) newest = Math.max(newest, list[list.length - 1].t);
  const floor = newest - WAVE_KEEP_S;
  for (const [id, list] of Object.entries(out)) {
    const first = list.findIndex((b) => b.t >= floor);
    if (first === -1) delete out[id];
    else if (first > 0) out[id] = list.slice(first);
  }
  return out;
}

/** The monitor's newest block over every wave: `{t, recv}`, or null. */
export function newestOf(blocks) {
  let best = null;
  for (const list of Object.values(blocks)) {
    const last = list[list.length - 1];
    if (last && (best === null || last.t > best.t)) best = { t: last.t, recv: last.recv };
  }
  return best;
}

/** Where the monitor's clock stood when an answer arrived: its newest block's end plus how long
 *  before `hub_now` the worker received it — the worker's and the hub's clocks, never this
 *  browser's — paired with this browser's monotonic `perfMs` of that moment. null if unreadable. */
export function sampleOf(newest, hubNow, perfMs) {
  if (!newest) return null;
  const age = (Date.parse(hubNow) - Date.parse(newest.recv)) / 1000;
  if (!Number.isFinite(age) || !Number.isFinite(perfMs)) return null;
  return { deviceS: newest.t + WAVE_BLOCK_S + Math.max(0, age), perfMs };
}

const defaultIsVisible = () => typeof document === "undefined"
  || (document.visibilityState !== "hidden" && document.hidden !== true);
function defaultOnVisibility(fn) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}

/**
 * api: the session's API client (`request`). track(call): the session's wrapper for its calls.
 * The rest are injectable for the tests: the timers, the page's visibility, the monotonic clock.
 */
export function createWaveStore({
  api, track = (call) => call(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  isVisible = defaultIsVisible, onVisibility = defaultOnVisibility,
  perfNow = () => performance.now(),
}) {
  const devices = new Map();     // source -> { count, timer, inFlight, state }
  const listeners = new Set();
  let unwatch = null;
  const notify = () => { for (const fn of listeners) fn(); };
  const live = (source, entry) => devices.get(source) === entry;
  const set = (entry, patch) => {
    entry.state = Object.freeze({ ...entry.state, ...patch });
    notify();
  };

  function cancel(entry) {
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.timer = null;
  }

  function schedule(source, entry) {
    cancel(entry);
    if (!live(source, entry) || !isVisible() || !POLLING.has(entry.state.status)) return;
    entry.timer = setTimer(() => {
      entry.timer = null;
      poll(source, entry).then(() => schedule(source, entry));
    }, WAVE_POLL_MS);
  }

  async function poll(source, entry) {
    if (entry.inFlight || !live(source, entry) || !isVisible()) return;
    entry.inFlight = true;
    try {
      const answer = await track(() => api.request(wavesPath(source, entry.state.cursor), { timeoutMs: WAVE_TIMEOUT_MS }));
      if (!live(source, entry)) return;
      if (!isWavesAnswer(answer)) {
        set(entry, { status: WAVE_STATUS.UNAVAILABLE });
        return;
      }
      const blocks = mergeBlocks(entry.state.blocks, answer.blocks);
      const newest = newestOf(blocks);
      set(entry, {
        status: WAVE_STATUS.OK, cursor: answer.cursor, catalogue: answer.waves, blocks, newest,
        sample: sampleOf(newest, answer.hub_now, perfNow()) ?? entry.state.sample,
      });
    } catch (err) {
      if (!live(source, entry)) return;
      const status = statusOf(err);
      set(entry, status === WAVE_STATUS.UNAVAILABLE ? { status } : { ...IDLE_DEVICE, status });
    } finally {
      entry.inFlight = false;
    }
  }

  function resume(source, entry) {
    if (!live(source, entry) || !isVisible()) {
      cancel(entry);
      return;
    }
    poll(source, entry).then(() => schedule(source, entry));
  }

  function onVisible() {
    for (const [source, entry] of devices) {
      if (isVisible() && POLLING.has(entry.state.status)) resume(source, entry);
      else cancel(entry);
    }
  }

  return {
    get: (source) => devices.get(source)?.state ?? IDLE_DEVICE,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Something on screen shows this monitor's waves. Returns its release; the last release forgets. */
    watch(source) {
      let entry = devices.get(source);
      if (!entry) {
        entry = { count: 0, timer: null, inFlight: false,
          state: Object.freeze({ ...IDLE_DEVICE, status: WAVE_STATUS.LOADING }) };
        devices.set(source, entry);
        if (!unwatch) unwatch = onVisibility(onVisible);
        notify();
      }
      entry.count += 1;
      if (entry.count === 1) resume(source, entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.count -= 1;
        if (entry.count > 0) return;
        cancel(entry);
        devices.delete(source);
        if (devices.size === 0 && unwatch) {
          unwatch();
          unwatch = null;
        }
        notify();
      };
    },
  };
}

const perSession = new WeakMap();

/** The session's one wave store, made on first use from its own API client and `track`: a panel
 *  needs nothing from LiveApp, and every panel of a session shares the subscriptions. */
export function waveStoreFor(session) {
  let store = perSession.get(session);
  if (!store) {
    store = createWaveStore({ api: session.api, track: session.track });
    perSession.set(session, store);
  }
  return store;
}
```

- [ ] **Step 5: Run the store tests.** Expected: `27 passed` (20 + A4's 7).

- [ ] **Step 6: Let the wave modules be unreached — by name, until Task 15.** Run `npx vitest run src/reachable.test.js` first: it fails with `live/data/waveStore.js` unreached. In `dashboard/src/reachable.test.js`, replace

```js
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");
```

with

```js
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");
// Lane C (dalga): the waveform panel's modules are written before their two screen lines, which
// wait for Aşama B on main (docs/superpowers/plans/2026-10-27-infinity-dalga-formu.md, Task 15).
// Until then these, and only these, may be unreached; the last test below fails the moment a
// screen reaches one, so the list is removed with the insertion and cannot outlive it.
const PENDING = new Set([
  "live/data/waveStore.js",
  "live/screens/common/waveGeometry.js",
  "live/screens/common/WaveRows.jsx",
  "live/screens/common/WavePanel.jsx",
  "live/screens/common/WaveFullscreen.jsx",
]);
```

and replace

```js
    expect(sources(SRC).filter((file) => !reached.has(file)).map(rel).sort()).toEqual([]);
  });
```

with

```js
    expect(sources(SRC).filter((file) => !reached.has(file) && !PENDING.has(rel(file))).map(rel).sort()).toEqual([]);
  });

  it("lets a pending module stay pending only while no screen reaches it", () => {
    expect([...reached].map(rel).filter((name) => PENDING.has(name))).toEqual([]);
  });
```

Run: `npx vitest run src/reachable.test.js src/live/data/waveStore.test.js` → all pass (`4` reachable tests).

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/inf-dalga && git add dashboard/src/live/data/waves.testutil.js dashboard/src/live/data/waveStore.js dashboard/src/live/data/waveStore.test.js dashboard/src/reachable.test.js && git commit -m "feat(dashboard): the wave store — polled only while a panel watches a monitor and the tab is visible" -m "One subscription per monitor, shared by every panel showing it; the last release forgets its blocks, so nothing of the waves survives the shell (a lock unmounts it). Every 750 ms with the cursor of the last answer; at most 20 s of device time kept. A 403, 404 or 409 is a status that drops the blocks and stops the polling; anything else is 'unavailable' and keeps the blocks, which then age into 'akış durdu' on screen. Where the monitor's clock stood is read from the worker's and the hub's clocks, never this browser's. The calls go through the session's track and the API client's own request (backendApi.js is not changed); one store per session, without touching LiveApp. reachable.test.js lets the five wave modules stay unreached, by name, until the screens take the panel in, and fails once they do." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The geometry — pure, tested without a canvas

`live/screens/common/waveGeometry.js`: the head (the monitor's clock now, smoothed poll to poll), the rows a monitor gets (R7, the BED08 correction), what a row says (live / sinyal yok / stalled / cleared, R6), and the polylines: a 6 s window ending 2 s behind the head, breaks at every gap and every no-signal block, ECG at a fixed ±1200 counts with clip marks, every pressure wave on 0–200 (→ 250) mmHg with lines at 50/100/150, pleth and resp on a slow 10 s autoscale with a minimum span (R13). Nothing is interpolated or extrapolated: a line joins only adjacent samples of one unbroken run.

**Files:**
- Create: `dashboard/src/live/screens/common/waveGeometry.test.js`
- Create: `dashboard/src/live/screens/common/waveGeometry.js`

- [ ] **Step 1: Write the failing tests.** Create `dashboard/src/live/screens/common/waveGeometry.test.js`:

```js
// Where a wave goes on its row — without a canvas. Synthetic blocks only (waves.testutil.js).
import { describe, it, expect } from "vitest";
import {
  CLEAR_AFTER_S, DELAY_S, ECG_SPAN, MIN_SPAN, PRESSURE_MAX, PRESSURE_MAX_WIDE, WINDOW_S, autoscale, easeRange, ecgY,
  headAt, nextAnchor, pressureGrid, pressureMax, pressureY, rowState, rowView, rowsOf, tracePaths,
} from "./waveGeometry.js";
import { CATALOGUE, T_END, bed4, bed8, run, wblock } from "../../data/waves.testutil.js";

const byId = (blocks) => blocks.reduce((out, b) => {
  (out[String(b.id)] ??= []).push(b);
  return out;
}, {});
const ECG = run(259);                          // 8 s of ECG ending at T_END (1008)
const ROW = { width: 600, height: 60 };

describe("the head: where the monitor's clock stands", () => {
  it("takes the first sample, then smooths small corrections and takes jumps whole", () => {
    expect(nextAnchor(null, { deviceS: 100, perfMs: 0 })).toEqual({ deviceS: 100, perfMs: 0 });
    const smoothed = nextAnchor({ deviceS: 100, perfMs: 0 }, { deviceS: 101.1, perfMs: 1000 });
    expect(smoothed.deviceS).toBeCloseTo(101.025, 9);       // predicted 101, a quarter of the way to 101.1
    expect(nextAnchor({ deviceS: 100, perfMs: 0 }, { deviceS: 105, perfMs: 1000 })).toEqual({ deviceS: 105, perfMs: 1000 });
    expect(nextAnchor({ deviceS: 100, perfMs: 0 }, null)).toEqual({ deviceS: 100, perfMs: 0 });
  });

  it("moves on with this browser's monotonic clock", () => {
    expect(headAt({ deviceS: 100, perfMs: 1000 }, 3500)).toBe(102.5);
    expect(headAt(null, 3500)).toBeNull();
  });
});

describe("which rows a monitor gets", () => {
  it("ECG, pressure, pleth, resp — only for waves the monitor transmits", () => {
    expect(rowsOf(byId(bed4()), CATALOGUE)).toEqual([
      { id: "259", kind: "ecg" }, { id: "769", kind: "pressure" }, { id: "6422", kind: "pleth" }, { id: "513", kind: "resp" }]);
    expect(rowsOf(byId([...run(259), ...run(513)]), CATALOGUE).map((r) => r.kind)).toEqual(["ecg", "resp"]);
  });

  it("picks the ECG channel that carries samples, whichever id it is (BED08: 0x0102, not 0x0103)", () => {
    expect(rowsOf(byId(bed8()), CATALOGUE)).toEqual([{ id: "258", kind: "ecg" }, { id: "3585", kind: "pressure" }]);
  });

  it("shows at most two live ECG channels, the first in id order", () => {
    const blocks = byId([...run(290), ...run(260), ...run(259), ...run(258, { samples: null })]);
    expect(rowsOf(blocks, CATALOGUE).map((r) => r.id)).toEqual(["259", "260"]);
  });

  it("gives a monitor whose ECG channels all say 'no signal' one ECG row — never none", () => {
    const blocks = byId([...run(259, { samples: null }), ...run(258, { samples: null })]);
    expect(rowsOf(blocks, CATALOGUE)).toEqual([{ id: "258", kind: "ecg" }]);
  });

  it("shows both pressure waves when both are live, ART first", () => {
    const blocks = byId([...run(3585, { samples: 3600 }), ...run(769, { samples: 4000 })]);
    expect(rowsOf(blocks, CATALOGUE).map((r) => r.id)).toEqual(["769", "3585"]);
  });

  it("gives a wave the catalogue does not name no row", () => {
    const blocks = { ...byId(run(259)), 4242: run(259).map((b) => ({ ...b, id: 4242 })) };
    expect(rowsOf(blocks, CATALOGUE).map((r) => r.id)).toEqual(["259"]);
  });
});

describe("what a row says about its data", () => {
  it("is live while the data runs ahead of the render time, even frozen at its end", () => {
    expect(rowState(ECG, T_END + 0.2).state).toBe("live");
    expect(rowState(ECG, T_END + DELAY_S + 1.4).state).toBe("live");   // frozen, not yet grey
  });

  it("is stalled 1.5 s after the render time passes the data's end, and says how long", () => {
    const stalled = rowState(ECG, T_END + DELAY_S + 1.6);
    expect(stalled.state).toBe("stalled");
    expect(Math.floor(stalled.silentS)).toBe(3);
  });

  it("is cleared 10 s after the data's end", () => {
    expect(rowState(ECG, T_END + CLEAR_AFTER_S).state).toBe("cleared");
  });

  it("says 'no signal' when the block at its right edge is a no-signal block", () => {
    expect(rowState(run(259, { samples: null }), T_END + 0.2).state).toBe("nosignal");
  });

  it("is waiting with no block or no head", () => {
    expect(rowState([], 1000).state).toBe("waiting");
    expect(rowState(ECG, null).state).toBe("waiting");
  });
});

describe("the trace", () => {
  const ecg = (blocks) => tracePaths(blocks, { leftS: 1000.2, rightS: 1006.2, width: 600, y: ecgY(60) });

  it("spans the window: the window's first sample at x 0, its last at the right edge", () => {
    const { paths } = ecg(ECG);
    expect(paths).toHaveLength(1);
    expect(paths[0][0]).toBeCloseTo(0, 6);
    expect(paths[0][paths[0].length - 2]).toBeGreaterThan(599);
    expect(paths[0][paths[0].length - 2]).toBeLessThanOrEqual(600 + 1e-6);
    expect(paths[0].length / 2).toBeGreaterThanOrEqual(1199);           // 6 s at 200 Hz, no more
    expect(paths[0].length / 2).toBeLessThanOrEqual(1201);
  });

  it("breaks at a missing block and at a no-signal block, and draws nothing across either", () => {
    expect(ecg(ECG.filter((b) => b.t !== 1003))).toMatchObject({ paths: [expect.any(Array), expect.any(Array)] });
    const holed = ecg(ECG.map((b) => (b.t === 1003 ? { ...b, samples: null } : b))).paths;
    expect(holed).toHaveLength(2);
    const xs = holed.flatMap((p) => p.filter((_, i) => i % 2 === 0));
    expect(xs.some((x) => x > 280 + 1e-6 && x < 300 - 1e-6)).toBe(false);   // 1003.0–1003.2 is x 280–300
  });

  it("holds ECG at a fixed gain and marks where it leaves the row, once per run", () => {
    const y = ecgY(60);
    expect(y(ECG_SPAN)).toEqual({ y: 2, clip: null });                // full scale is the row's edge: the gain is pinned
    expect(y(ECG_SPAN + 1)).toEqual({ y: 2, clip: "top" });
    expect(y(-ECG_SPAN - 1)).toEqual({ y: 58, clip: "bottom" });
    const clipped = tracePaths([wblock(259, 1000, (i) => (i < 3 ? 1500 : i < 6 ? -1500 : 0))],
      { leftS: 1000, rightS: 1000.2, width: 200, y });
    expect(clipped.clips.map((c) => c[1])).toEqual(["top", "bottom"]);
  });

  it("draws any pressure wave on 0–200 mmHg (sample / 40), widening to 250 only while it is needed", () => {
    expect(pressureY(100, PRESSURE_MAX)(4000).y).toBe(50);              // 100 mmHg, half way up
    expect(pressureGrid(100, PRESSURE_MAX)).toEqual([74, 50, 26]);      // 50, 100, 150 mmHg
    expect(pressureY(100, PRESSURE_MAX)(-40).clip).toBe("bottom");
    const high = [wblock(769, 1000, 8400)];                             // 210 mmHg
    expect(pressureMax(high, 999, 1001)).toBe(PRESSURE_MAX_WIDE);
    expect(pressureMax(high, 1001, 1007)).toBe(PRESSURE_MAX);
    const p1 = rowView(run(3585, { samples: 3600 }), "pressure", T_END + 0.2, { width: 600, height: 100 });
    expect(p1.grid).toEqual([74, 50, 26]);
    expect(p1.paths[0][1]).toBeCloseTo(98 - 0.45 * 96, 6);             // 90 mmHg
  });

  it("scales pleth and resp to their own last 10 s, never narrower than the minimum span", () => {
    const flat = autoscale([wblock(6422, 1000, 1000)], 1000.2, MIN_SPAN.pleth);
    expect(flat.lo).toBeCloseTo(890, 9);
    expect(flat.hi).toBeCloseTo(1110, 9);
    expect(autoscale([wblock(6422, 1000, null)], 1000.2, 200)).toBeNull();
    const eased = easeRange({ lo: 0, hi: 100 }, { lo: 20, hi: 80 }, 2);
    expect(eased.lo).toBeCloseTo(20 * (1 - Math.exp(-1)), 9);           // narrows slowly
    expect(easeRange({ lo: 0, hi: 100 }, { lo: -50, hi: 150 }, 0.016)).toEqual({ lo: -50, hi: 150 });  // widens at once
  });

  it("stops at the data's end when the render time has passed it (frozen), draws nothing once cleared", () => {
    const frozen = rowView(ECG, "ecg", T_END + 3, ROW);
    const last = frozen.paths[0][frozen.paths[0].length - 2];
    expect(last).toBeCloseTo(600 * (WINDOW_S - 0.005) / WINDOW_S, 6);   // the last sample, 5 ms before the end
    expect(rowView(ECG, "ecg", T_END + CLEAR_AFTER_S, ROW).paths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/screens/common/waveGeometry.test.js`
Expected: `Failed to resolve import "./waveGeometry.js"`.

- [ ] **Step 3: Write the geometry.** Create `dashboard/src/live/screens/common/waveGeometry.js`:

```js
// src/live/screens/common/waveGeometry.js — where a wave goes on its row, and what the row says
// about its own data. Pure: no React, no DOM, no clock but the instants it is handed. Tested
// without a canvas (waveGeometry.test.js).
//
// NOTHING HERE MEASURES ANYTHING (spec §5.4). Samples become pixels; a row is live, "sinyal yok",
// stalled or cleared; and that is all — no rate, beat, amplitude or threshold on a sample.
//
// Time is the MONITOR's clock (`t`, device seconds). `headAt` is where that clock stands now: the
// store's last sample (the newest block's end plus how long ago the worker received it) carried
// forward on this browser's monotonic clock, `nextAnchor` smoothing the poll-to-poll jitter. A row
// draws WINDOW_S of it, ending DELAY_S behind the head; when the data ends before that, the row
// stops there (frozen), greys after GREY_AFTER_S more, and is cleared CLEAR_AFTER_S after the data's
// end. Gaps and "no signal" blocks break the line; nothing is ever drawn where there is no sample.
import { WAVE_BLOCK_S } from "../../data/waveStore.js";

export const DELAY_S = 2.0;
export const WINDOW_S = 6.0;
export const GREY_AFTER_S = 1.5;
export const CLEAR_AFTER_S = 10.0;
export const ECG_SPAN = 1200;                       // counts, either way: fixed, never autoscaled
// Every catalogued pressure wave (0x0301 "ART", 0x0e01 "P1"): mmHg = sample / 40, checked against
// the screen on BED07 and BED08 (docs/INFINITY-DALGA-FORMU.md, "ART ölçeği"; the lead's note of 27.10).
export const COUNTS_PER_MMHG = 40;
export const PRESSURE_MAX = 200;
export const PRESSURE_MAX_WIDE = 250;
export const PRESSURE_LINES = Object.freeze([50, 100, 150]);
export const AUTOSCALE_S = 10.0;
// The smallest span a relative row is stretched to, in counts: a near-flat signal stays near-flat
// instead of being blown up into something that looks like a wave. A display constant, not a
// measurement; to be checked against the bedside screen in the ward check (spec §9, V5).
export const MIN_SPAN = Object.freeze({ pleth: 200, resp: 200 });
export const HEAD_JUMP_S = 1.0;
export const HEAD_SMOOTHING = 0.25;
export const RANGE_TAU_S = 2.0;
const GAP_TOLERANCE = 0.5;     // of one sample interval: a block further off its predecessor's end is a gap
const PAD = 2;                 // px kept clear at a row's top and bottom

/** The head estimate after a new store sample: the sample itself the first time or after a jump
 *  of more than HEAD_JUMP_S, else the old estimate carried forward and moved HEAD_SMOOTHING of the
 *  way to the sample — so the trace scrolls smoothly between polls. */
export function nextAnchor(previous, sample) {
  if (!sample) return previous ?? null;
  if (!previous) return sample;
  const predicted = previous.deviceS + (sample.perfMs - previous.perfMs) / 1000;
  const error = sample.deviceS - predicted;
  if (!Number.isFinite(error) || Math.abs(error) > HEAD_JUMP_S) return sample;
  return { deviceS: predicted + error * HEAD_SMOOTHING, perfMs: sample.perfMs };
}

/** Where the monitor's clock stands at this browser's `perfMs`, or null with no anchor. */
export function headAt(anchor, perfMs) {
  if (!anchor || !Number.isFinite(perfMs)) return null;
  return anchor.deviceS + (perfMs - anchor.perfMs) / 1000;
}

const byNumber = (a, b) => Number(a) - Number(b);

// The row groups, in screen order, and how many rows each may have (spec §3.3, §4; amended
// 2026-10-27 after BED08). Within a group the ids go in ascending order, which IS the preference
// order: ECG 0x0102, 0x0103, 0x0104, 0x0122, 0x0124; pressure 0x0301, 0x0e01.
export const ROW_GROUPS = Object.freeze([["ecg", 2], ["pressure", 2], ["pleth", 1], ["resp", 1]]);

/** The rows a monitor gets. A wave carrying samples somewhere in what is held is "live"; each group
 *  shows its live waves, up to its limit. A group the monitor transmits with NO live wave still gets
 *  one row, its first wave, which then says "sinyal yok": an absent ECG must read as no signal,
 *  never as nothing (spec §5.2). The live ECG channel is not fixed by id — 0x0103 on BED07, 0x0102
 *  on BED08 — so the ECG rows are chosen by liveness and never named by lead. A wave the
 *  catalogue does not name gets no row. */
export function rowsOf(blocks, catalogue) {
  const kindOf = (id) => catalogue?.[id]?.kind;
  const present = Object.keys(blocks ?? {}).filter((id) => blocks[id]?.length > 0 && kindOf(id)).sort(byNumber);
  const live = (id) => blocks[id].some((b) => b.samples !== null);
  return ROW_GROUPS.flatMap(([kind, max]) => {
    const sent = present.filter((id) => kindOf(id) === kind);
    const alive = sent.filter(live);
    return (alive.length > 0 ? alive.slice(0, max) : sent.slice(0, 1)).map((id) => ({ id, kind }));
  });
}

/** The last block that starts at or before device time `s`, or null. */
export function blockAt(blocks, s) {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].t <= s) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : blocks[lo - 1];
}

/** What a row says of its data at head `headS`: waiting (nothing yet), live, nosignal (the block
 *  at its right edge is "no signal"), stalled (the data ended more than GREY_AFTER_S before the
 *  render time) or cleared (no data for CLEAR_AFTER_S). `silentS`: how long since the data's end,
 *  in device seconds — the N of "akış durdu · N sn". `endS`: that end. */
export function rowState(blocks, headS) {
  if (!blocks?.length || !Number.isFinite(headS)) return { state: "waiting", silentS: null, endS: null };
  const endS = blocks[blocks.length - 1].t + WAVE_BLOCK_S;
  const silentS = Math.max(0, headS - endS);
  if (silentS >= CLEAR_AFTER_S) return { state: "cleared", silentS, endS };
  if (silentS - DELAY_S > GREY_AFTER_S) return { state: "stalled", silentS, endS };
  const edge = blockAt(blocks, Math.min(headS - DELAY_S, endS - 1e-6));
  if (edge && edge.samples === null) return { state: "nosignal", silentS, endS };
  return { state: "live", silentS, endS };
}

/** ECG: fixed gain, ±ECG_SPAN counts over the row's height; beyond it, the edge and a clip mark. */
export function ecgY(height) {
  const mid = height / 2;
  const half = Math.max(0, height / 2 - PAD);
  return (v) => {
    if (v > ECG_SPAN) return { y: mid - half, clip: "top" };
    if (v < -ECG_SPAN) return { y: mid + half, clip: "bottom" };
    return { y: mid - (v / ECG_SPAN) * half, clip: null };
  };
}

/** A pressure row: 0–`max` mmHg bottom to top, a sample being mmHg × COUNTS_PER_MMHG. */
export function pressureY(height, max) {
  const usable = Math.max(0, height - 2 * PAD);
  return (v) => {
    const mmHg = v / COUNTS_PER_MMHG;
    if (mmHg > max) return { y: PAD, clip: "top" };
    if (mmHg < 0) return { y: height - PAD, clip: "bottom" };
    return { y: height - PAD - (mmHg / max) * usable, clip: null };
  };
}

/** A pressure row's faint lines (50, 100, 150 mmHg), as y positions. */
export function pressureGrid(height, max) {
  const y = pressureY(height, max);
  return PRESSURE_LINES.map((mmHg) => y(mmHg * COUNTS_PER_MMHG).y);
}

/** The pressure axis: PRESSURE_MAX, or PRESSURE_MAX_WIDE while a sample in the window is above it. */
export function pressureMax(blocks, leftS, rightS) {
  for (const b of blocks) {
    if (b.samples === null || b.t + WAVE_BLOCK_S < leftS || b.t > rightS) continue;
    for (const v of b.samples) if (v > PRESSURE_MAX * COUNTS_PER_MMHG) return PRESSURE_MAX_WIDE;
  }
  return PRESSURE_MAX;
}

/** A relative row's target range: the last AUTOSCALE_S of samples, never narrower than `minSpan`,
 *  with a 10 % margin. null when there is no sample. */
export function autoscale(blocks, rightS, minSpan) {
  let lo = Infinity;
  let hi = -Infinity;
  const from = rightS - AUTOSCALE_S;
  for (const b of blocks) {
    if (b.samples === null || b.t + WAVE_BLOCK_S < from || b.t > rightS) continue;
    for (const v of b.samples) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo === Infinity) return null;
  const span = Math.max(hi - lo, minSpan);
  const mid = (hi + lo) / 2;
  return { lo: mid - span * 0.55, hi: mid + span * 0.55 };
}

/** The range a relative row draws with: it widens at once to the target, and narrows towards it
 *  with time constant RANGE_TAU_S — a slow autoscale that never cuts the trace off. */
export function easeRange(previous, target, dtS) {
  if (!target) return previous ?? null;
  if (!previous) return target;
  const k = 1 - Math.exp(-Math.max(0, dtS) / RANGE_TAU_S);
  return {
    lo: Math.min(target.lo, previous.lo + (target.lo - previous.lo) * k),
    hi: Math.max(target.hi, previous.hi + (target.hi - previous.hi) * k),
  };
}

/** A relative row: `range` bottom to top, clamped to the row. */
export function rangeY(height, range) {
  const usable = Math.max(0, height - 2 * PAD);
  const span = range.hi - range.lo || 1;
  return (v) => {
    const f = Math.min(1, Math.max(0, (v - range.lo) / span));
    return { y: height - PAD - f * usable, clip: null };
  };
}

/** The polylines of one wave between device times `leftS` and `rightS` on a `width`-px row, as
 *  flat [x0, y0, x1, y1, …] arrays: a new one after a gap or a "no signal" block, nothing drawn
 *  across either. `clips`: [x, "top" | "bottom"] where the trace leaves the row (once per run). */
export function tracePaths(blocks, { leftS, rightS, width, y }) {
  const paths = [];
  const clips = [];
  const scale = rightS > leftS ? width / (rightS - leftS) : 0;
  let current = null;
  let lastEnd = null;
  let clipping = null;           // the edge the trace is beyond now, or null
  for (const b of blocks) {
    if (b.t > rightS) break;
    const end = b.t + WAVE_BLOCK_S;
    if (end < leftS || b.samples === null) {
      current = null;
      lastEnd = end;
      clipping = null;
      continue;
    }
    const step = 1 / b.rate;
    if (current === null || lastEnd === null || Math.abs(b.t - lastEnd) > step * GAP_TOLERANCE) {
      current = [];
      paths.push(current);
      clipping = null;
    }
    for (let i = 0; i < b.samples.length; i += 1) {
      const s = b.t + i * step;
      if (s < leftS || s > rightS) continue;
      const x = (s - leftS) * scale;
      const p = y(b.samples[i]);
      current.push(x, p.y);
      if (p.clip && p.clip !== clipping) clips.push([x, p.clip]);
      clipping = p.clip;
    }
    lastEnd = end;
  }
  return { paths: paths.filter((path) => path.length >= 4), clips };
}

/** Everything one row draws at head `headS` on a `size` ({width, height}) canvas: its state, its
 *  paths, clip marks and grid lines, and the range a relative row used (fed back next frame). */
export function rowView(blocks, kind, headS, size, previousRange = null, dtS = 0) {
  const state = rowState(blocks, headS);
  const none = { ...state, paths: [], clips: [], grid: [], range: previousRange };
  if (state.state === "waiting" || state.state === "cleared") return none;
  const rightS = Math.min(headS - DELAY_S, state.endS);
  const leftS = rightS - WINDOW_S;
  let y;
  let grid = [];
  let range = previousRange;
  if (kind === "ecg") {
    y = ecgY(size.height);
  } else if (kind === "pressure") {
    const max = pressureMax(blocks, leftS, rightS);
    y = pressureY(size.height, max);
    grid = pressureGrid(size.height, max);
  } else {
    range = easeRange(previousRange, autoscale(blocks, rightS, MIN_SPAN[kind] ?? MIN_SPAN.pleth), dtS);
    if (!range) return { ...none, range };
    y = rangeY(size.height, range);
  }
  const { paths, clips } = tracePaths(blocks, { leftS, rightS, width: size.width, y });
  return { ...state, paths, clips, grid, range };
}
```

- [ ] **Step 4: Run.** Expected: `19 passed`.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/inf-dalga && git add dashboard/src/live/screens/common/waveGeometry.js dashboard/src/live/screens/common/waveGeometry.test.js && git commit -m "feat(dashboard): where a wave goes on its row — pure geometry, no canvas, no number" -m "A row draws 6 s of the monitor's own clock ending 2 s behind its head, the head smoothed from poll to poll. The line breaks at a missing block and at a no-signal block and is drawn nowhere there; ECG has a fixed ±1200-count gain with a clip mark where it leaves the row (an autoscale would make noise look like a rhythm); every pressure wave — ART or P1 — sits on 0–200 mmHg at sample/40, widening to 250 only while it must; pleth and resp follow their last 10 s, never narrower than a minimum span. Rows are chosen by liveness (BED08: the live ECG channel differs by bed), at most two ECG and two pressure, and a group sent with no live wave keeps one row that says 'sinyal yok'. A row freezes when the render time reaches the data's end, greys 1.5 s later and is cleared 10 s after the data stopped." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The panel's words, in the four languages

`live/i18n/strings/waves.js`, registered in `catalog.js` (whose completeness test, `strings.test.js`, then covers it: four languages, the Turkish keys and placeholders, Azerbaijani in Latin script, Russian in Cyrillic, every reviewed az = tr identity). The words name no ECG lead (the BED08 correction); Azerbaijani "no signal" avoids "siqnal", which this interface uses for an **alarm**. AZ/RU/EN await a native-speaking clinician's review, as `monitor.js`'s do.

**Files:**
- Create: `dashboard/src/live/i18n/waves.strings.test.js`
- Create: `dashboard/src/live/i18n/strings/waves.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (after `sofa`, the last namespace since the main merge 9fae9ec)

- [ ] **Step 1: Write the failing test.** Create `dashboard/src/live/i18n/waves.strings.test.js`:

```js
// The waveform panel's words (Lane C, dalga). Completeness — four languages, the same keys, the
// Turkish placeholders — is strings.test.js's, for every namespace in the catalogue; this holds what
// is particular to these: the stamp is the spec's sentence, a stall says its age, no ECG lead is
// named, and Azerbaijani "no signal" does not use the interface's word for an alarm.
import { describe, it, expect } from "vitest";
import { DICTIONARIES, NAMESPACES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

describe("the waveform panel's words", () => {
  it("are in the catalogue, in every language", () => {
    expect(NAMESPACES.waves).toBeDefined();
    for (const lang of LANG_CODES) {
      for (const key of ["stamp", "delay", "noSignal", "stalled", "cleared", "ecg", "ecgLead"]) {
        expect(DICTIONARIES[lang][`waves.${key}`], `${lang} ${key}`).toBeTruthy();
      }
    }
  });

  it("stamp the panel with the spec's sentence (§5.1) and the delay (§4)", () => {
    expect(DICTIONARIES.tr["waves.stamp"]).toBe("Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür");
    expect(DICTIONARIES.tr["waves.delay"]).toBe("≈ 2 sn gecikmeli");
    expect(DICTIONARIES.tr["waves.noSignal"]).toBe("sinyal yok");
    expect(DICTIONARIES.tr["waves.stalled"]).toBe("akış durdu · {seconds} sn");
  });

  it("say how long a stopped stream has been silent, in every language", () => {
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["waves.stalled"], lang).toContain("{seconds}");
      expect(DICTIONARIES[lang]["waves.cleared"], lang).toContain("{seconds}");
    }
  });

  it("name no ECG lead (BED08: the live channel is not fixed by id)", () => {
    for (const lang of LANG_CODES) {
      const words = Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("waves.")).map(([, v]) => v);
      expect(words.join(" "), lang).not.toMatch(/\b(II|III|aVR|aVL|aVF|V[1-6])\b/);
    }
  });

  it("do not say 'no signal' in Azerbaijani with the word this interface uses for an alarm", () => {
    expect(DICTIONARIES.az["waves.noSignal"].toLowerCase()).not.toContain("siqnal");
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/i18n/waves.strings.test.js`
Expected: `4 failed | 1 passed` (`NAMESPACES.waves` undefined, every `waves.*` key missing; the "names no ECG lead" test passes on an empty set until the words exist).

- [ ] **Step 3: Write the words.** Create `dashboard/src/live/i18n/strings/waves.js`:

```js
// src/live/i18n/strings/waves.js — the live waveform panel (Lane C, dalga; screens/common/WavePanel.jsx).
//
// Every clinician who can open the strip sees these words. They must say, in every language: the
// waves are UNVALIDATED research decoding, for DISPLAY ONLY, the bedside monitor is the primary
// alarm (`stamp`, spec §5.1, the owner's own Turkish), the trace runs about 2 s behind the monitor
// (`delay`), a missing signal is "no signal" and not a line (`noSignal`, §5.2), and a stopped
// stream says so with its age (`stalled`, `cleared`, §5.3). No word here names an ECG lead: the
// live channel is not fixed by id (BED07 0x0103, BED08 0x0102), so a row is "EKG" with
// `ecgLead`. Pressure, pleth and resp rows carry the monitor's own label from the API's
// catalogue ("ART", "P1", "Pleth", "RESP"), as the strip's `monitor.p.*` do; `kind.*` is said only
// when a catalogue entry has none. In Azerbaijani "siqnal" is this interface's word for an ALARM
// (nav.alarms), so "no signal" is said without it (waves.strings.test.js). AZ/RU/EN await a
// native-speaking clinician's review, as monitor.js's do.
export default {
  tr: {
    title: "Dalga formu · doğrulanmamış",
    tag: "DOĞRULANMAMIŞ",
    stamp: "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür",
    delay: "≈ 2 sn gecikmeli",
    show: "Dalga formunu göster",
    hide: "Dalga formunu gizle",
    fullscreen: "Tam ekran görünüm",
    close: "Tam ekrandan çık",
    waiting: "dalga bekleniyor",
    noSignal: "sinyal yok",
    stalled: "akış durdu · {seconds} sn",
    cleared: "akış durdu · {seconds} sn · iz kaldırıldı",
    unavailable: "Dalga akışı yok",
    off: "Dalga formu bu kurulumda kapalı",
    denied: "Bu cihazın dalga formunu görme yetkiniz yok",
    gone: "Bu cihazın dalga formu gösterilemiyor",
    relative: "göreli",
    canvas: "{label} dalgası — yalnız görüntü, ölçüm değildir",
    ecg: "EKG",
    ecgLead: "derivasyon adı doğrulanmadı",
    kind: { pressure: "Basınç", pleth: "Pletismogram", resp: "Solunum" },
    ev: { structural: "yapısal", unverified: "doğrulanmadı", screen_scale: "ölçek ekranla doğrulandı" },
  },
  az: {
    title: "Dalğa forması · təsdiqlənməmiş",
    tag: "TƏSDİQLƏNMƏMİŞ",
    stamp: "Dalğa · təsdiqlənməmiş · yalnız görüntü — əsas siqnal çarpayı yanındakı monitordur",
    delay: "≈ 2 san gecikmə ilə",
    show: "Dalğa formasını göstər",
    hide: "Dalğa formasını gizlət",
    fullscreen: "Tam ekran görünüş",
    close: "Tam ekrandan çıx",
    waiting: "dalğa gözlənilir",
    noSignal: "kanalda dalğa yoxdur",
    stalled: "axın dayandı · {seconds} san",
    cleared: "axın dayandı · {seconds} san · iz silindi",
    unavailable: "Dalğa axını yoxdur",
    off: "Dalğa forması bu quraşdırmada söndürülüb",
    denied: "Bu cihazın dalğa formasını görmək icazəniz yoxdur",
    gone: "Bu cihazın dalğa forması göstərilə bilmir",
    relative: "nisbi",
    canvas: "{label} dalğası — yalnız görüntü, ölçmə deyil",
    ecg: "EKQ",
    ecgLead: "aparmanın adı təsdiqlənməyib",
    kind: { pressure: "Təzyiq", pleth: "Pletizmoqram", resp: "Tənəffüs" },
    ev: { structural: "struktur", unverified: "təsdiqlənməyib", screen_scale: "miqyas ekranla təsdiqlənib" },
  },
  ru: {
    title: "Кривые · не валидировано",
    tag: "НЕ ВАЛИДИРОВАНО",
    stamp: "Кривая · не валидировано · только отображение — основная тревога у прикроватного монитора",
    delay: "≈ 2 с задержки",
    show: "Показать кривые",
    hide: "Скрыть кривые",
    fullscreen: "Во весь экран",
    close: "Выйти из полноэкранного режима",
    waiting: "ожидание кривой",
    noSignal: "нет сигнала",
    stalled: "поток остановлен · {seconds} с",
    cleared: "поток остановлен · {seconds} с · кривая убрана",
    unavailable: "Нет потока кривых",
    off: "Кривые в этой установке выключены",
    denied: "Нет права видеть кривые этого устройства",
    gone: "Кривые этого устройства недоступны",
    relative: "относительная",
    canvas: "Кривая {label} — только отображение, не измерение",
    ecg: "ЭКГ",
    ecgLead: "название отведения не подтверждено",
    kind: { pressure: "Давление", pleth: "Плетизмограмма", resp: "Дыхание" },
    ev: { structural: "структурно", unverified: "не подтверждено", screen_scale: "масштаб сверен с экраном" },
  },
  en: {
    title: "Waveforms · unvalidated",
    tag: "UNVALIDATED",
    stamp: "Waveform · unvalidated · display only — the bedside monitor is the primary alarm",
    delay: "≈ 2 s behind",
    show: "Show waveforms",
    hide: "Hide waveforms",
    fullscreen: "Full-screen view",
    close: "Exit full screen",
    waiting: "waiting for the waveform",
    noSignal: "no signal",
    stalled: "stream stopped · {seconds} s",
    cleared: "stream stopped · {seconds} s · trace removed",
    unavailable: "No waveform stream",
    off: "Waveforms are off in this installation",
    denied: "You may not see this device's waveforms",
    gone: "This device's waveforms cannot be shown",
    relative: "relative",
    canvas: "{label} waveform — display only, not a measurement",
    ecg: "ECG",
    ecgLead: "lead name not verified",
    kind: { pressure: "Pressure", pleth: "Pleth", resp: "Respiration" },
    ev: { structural: "structural", unverified: "unverified", screen_scale: "scale checked against the screen" },
  },
};
```

- [ ] **Step 4: Register them — each line with blank lines either side, as the file asks.** The main merge (9fae9ec) brought namespaces after `monitor` (`shadow`, `kabul`, `esleme`, `sofa`), each registered last, with a one-line comment over its import and a trailing tag on its entry; `waves` follows them the same way. In `dashboard/src/live/i18n/catalog.js`, replace

```js
import sofa from "./strings/sofa.js";
```

with

```js
import sofa from "./strings/sofa.js";

// Dalga: the live waveform panel (screens/common/WavePanel.jsx).
import waves from "./strings/waves.js";
```

and replace

```js
  sofa, // G2-A4
};
```

with

```js
  sofa, // G2-A4

  waves, // dalga
};
```

- [ ] **Step 5: Run every dictionary test.**

Run: `npx vitest run src/live/i18n`
Expected: all pass (`5` in the new file; `strings.test.js` unchanged and green — no az text equals its Turkish source, every Russian text has Cyrillic).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/inf-dalga && git add dashboard/src/live/i18n/strings/waves.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/waves.strings.test.js && git commit -m "feat(i18n): the waveform panel's words in az, tr, ru, en" -m "The stamp is the spec's sentence (Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür); the delay '≈ 2 sn gecikmeli'; 'sinyal yok' for a missing signal; 'akış durdu · N sn' and its cleared form for a stopped stream. An ECG row is 'EKG' with 'derivasyon adı doğrulanmadı' and no lead name (BED08: the live channel differs by bed); pressure, pleth and resp carry the monitor's own label from the catalogue. Azerbaijani says 'no signal' without 'siqnal', which this interface uses for an alarm. AZ/RU/EN await a native clinician's review." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The panel, its rows and its full-screen view

`WaveRows.jsx` (one `<canvas>` per row, a `requestAnimationFrame` loop; the row's label, unit and evidence and its state as DOM text, never pixels; faded when stalled, blank when cleared), `WavePanel.jsx` (the header, the always-visible stamp, the statuses of R10, the ⤢ button; on the device screen closed behind "Dalga formunu göster", R9) and `WaveFullscreen.jsx` (W5, R15: black, the stamp at full size, the strip's own numbers beside the waves through `MonitorStrip`; Esc, × or leaving browser full screen close it, focus back to ⤢). Tested on a mocked 2D context with a hand-driven frame clock (`manualFrames`): jsdom has no canvas.

**Files:**
- Create: `dashboard/src/live/screens/common/WavePanel.test.jsx`, `WaveFullscreen.test.jsx`
- Create: `dashboard/src/live/screens/common/WaveRows.jsx`, `WaveFullscreen.jsx`, `WavePanel.jsx`

- [ ] **Step 1: Write the failing panel tests.** Create `dashboard/src/live/screens/common/WavePanel.test.jsx`:

```jsx
// The live waveform panel (Lane C, dalga): its stamp, its rows, its words for no signal and for a
// stopped stream, the statuses it shows instead of a trace — and no number and no sound. Drawn on a
// mocked 2D context with a hand-driven frame clock. Synthetic blocks only (waves.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { SessionProvider } from "../../session/SessionProvider.jsx";
import { WAVE_STATUS, createWaveStore } from "../../data/waveStore.js";
import {
  SOURCE, answer, bed4, bed8, manualFrames, manualTimers, refusal, run, sessionStub, settle,
} from "../../data/waves.testutil.js";
import { WavePanel } from "./WavePanel.jsx";

let ctx;
beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(600);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(60);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The panel on a wave store whose API answers `reply()`; the store's clock reads 0 at every answer. */
async function show({ reply = () => answer(), collapsible = false } = {}) {
  const timers = manualTimers();
  const frames = manualFrames();
  const request = vi.fn(async () => reply());
  const store = createWaveStore({
    api: { request }, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true, onVisibility: () => () => {}, perfNow: () => 0,
  });
  render(
    <I18nProvider>
      <SessionProvider store={sessionStub()}>
        <WavePanel source={SOURCE} title="REA-01 · 2" store={store} raf={frames.raf} caf={frames.caf} collapsible={collapsible} />
      </SessionProvider>
    </I18nProvider>,
  );
  await act(async () => { await settle(); });
  const frame = (perfMs) => act(() => { frames.run(perfMs); });
  return { store, timers, frames, request, frame };
}

const STAMP = "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür";
const panel = () => screen.getByRole("region", { name: "REA-01 · 2 · Dalga formu · doğrulanmamış" });
const rowOf = (kind) => document.querySelector(`[data-wave-row="${kind}"]`);

describe("the waveform panel", () => {
  it("carries the stamp and the delay, and draws a row per wave the monitor sends, in order", async () => {
    const { frame } = await show();
    frame(0);
    expect(within(panel()).getByText(STAMP)).toBeInTheDocument();
    expect(within(panel()).getByText("≈ 2 sn gecikmeli")).toBeInTheDocument();
    expect([...document.querySelectorAll("[data-wave-row]")].map((li) => li.dataset.waveRow))
      .toEqual(["ecg", "pressure", "pleth", "resp"]);
    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it("calls the ECG row 'EKG', names no lead, and prints the monitor's own labels for the rest", async () => {
    await show();
    expect(within(rowOf("ecg")).getByText("EKG")).toBeInTheDocument();
    expect(within(rowOf("ecg")).getByText("derivasyon adı doğrulanmadı · yapısal")).toBeInTheDocument();
    expect(within(rowOf("pressure")).getByText("ART")).toBeInTheDocument();
    expect(within(rowOf("pressure")).getByText("mmHg · ölçek ekranla doğrulandı")).toBeInTheDocument();
    expect(within(rowOf("pleth")).getByText("göreli · yapısal")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent(/\bII\b/);
  });

  it("follows the live ECG channel and labels a P1 pressure 'P1', never 'ART' (BED08)", async () => {
    const { frame } = await show({ reply: () => answer(bed8()) });
    frame(0);
    const rows = [...document.querySelectorAll("[data-wave-row]")];
    expect(rows.map((li) => li.dataset.waveRow)).toEqual(["ecg", "pressure"]);
    expect(within(rows[0]).queryByText("sinyal yok")).toBeNull();          // 0x0102 is live, 0x0103 is not drawn
    expect(within(rows[1]).getByText("P1")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("ART");
  });

  it("prints no number while the waves are live", async () => {
    const { frame } = await show();
    frame(0);
    expect(document.querySelector("[data-wave-rows]").textContent).not.toMatch(/\d/);
  });

  it("says 'sinyal yok' for a no-signal ECG and draws no line for it", async () => {
    const { frame } = await show({ reply: () => answer(run(259, { samples: null })) });
    frame(0);
    expect(within(rowOf("ecg")).getByText("sinyal yok")).toBeInTheDocument();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it("freezes, fades and says 'akış durdu · N sn' when the stream stops, and clears after 10 s", async () => {
    const { frame } = await show();
    frame(0);
    expect(screen.queryByText(/akış durdu/)).toBeNull();
    frame(4000);                                   // 4.2 s after the data's end: past 2 s + 1.5 s
    expect(within(rowOf("ecg")).getByText("akış durdu · 4 sn")).toBeInTheDocument();
    expect(rowOf("ecg").querySelector("canvas")).toHaveClass("opacity-40");
    ctx.lineTo.mockClear();
    frame(10000);
    expect(within(rowOf("ecg")).getByText("akış durdu · 10 sn · iz kaldırıldı")).toBeInTheDocument();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it("keeps the trace it has and says the stream is missing when a poll fails", async () => {
    let reply = () => answer();
    const { timers, frame } = await show({ reply: () => reply() });
    reply = () => { throw refusal(503); };
    await act(async () => { await timers.fire(); });
    frame(0);
    expect(within(panel()).getByText("Dalga akışı yok")).toBeInTheDocument();
    expect(within(panel()).getByText(STAMP)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-wave-row]")).toHaveLength(4);
  });

  it.each([[404, "Bu cihazın dalga formu gösterilemiyor"], [403, "Bu cihazın dalga formunu görme yetkiniz yok"]])(
    "says why it shows no waves on a %i, never an empty trace", async (code, words) => {
      await show({ reply: () => { throw refusal(code); } });
      expect(within(panel()).getByRole("note")).toHaveTextContent(words);
      expect(document.querySelector("[data-wave-rows]")).toBeNull();
    });

  it("draws nothing at all when waves are off here (409), and nothing before the first answer", async () => {
    const { store } = await show({ reply: () => { throw refusal(409); } });
    expect(store.get(SOURCE).status).toBe(WAVE_STATUS.OFF);
    expect(document.querySelector("[data-wave-panel]")).toBeNull();
  });

  it("on the device screen waits behind a button, polls once opened and stops when hidden", async () => {
    const { request, timers } = await show({ collapsible: true });
    expect(request).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(timers.delays).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dalga formunu gizle" }));
    expect(timers.delays).toEqual([]);
    expect(screen.getByRole("button", { name: "Dalga formunu göster" })).toBeInTheDocument();
  });

  it("says on the device screen that waves are off, when they are", async () => {
    await show({ reply: () => { throw refusal(409); }, collapsible: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
    expect(within(panel()).getByRole("note")).toHaveTextContent("Dalga formu bu kurulumda kapalı");
  });

  it("makes no sound: no audio element, no audio context", async () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const { frame } = await show();
    frame(0);
    frame(4000);
    expect(AudioContext).not.toHaveBeenCalled();
    expect(document.querySelector("audio")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("stops drawing when it is gone", async () => {
    const { frames, frame } = await show();
    frame(0);
    expect(frames.waiting).toBe(1);
    cleanup();
    expect(frames.waiting).toBe(0);
  });

  it("draws the full set for a BED07-like monitor from four separate runs", async () => {
    const { frame } = await show({ reply: () => answer(bed4()) });
    frame(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Write the failing full-screen tests.** Create `dashboard/src/live/screens/common/WaveFullscreen.test.jsx`:

```jsx
// The full-screen single-bed view (Lane C, dalga; spec W5): opened from the panel's ⤢, black, the
// stamp at full size, the strip's numbers beside the waves; Escape, × or leaving browser full screen
// close it and give the focus back. Synthetic blocks and strip (waves.testutil.js, shadow.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { SessionProvider } from "../../session/SessionProvider.jsx";
import { ShadowProvider } from "../../data/ShadowProvider.jsx";
import { createWaveStore } from "../../data/waveStore.js";
import { bed as stripBed, param, strip } from "../../data/shadow.testutil.js";
import { SOURCE, answer, manualFrames, manualTimers, sessionStub, settle } from "../../data/waves.testutil.js";
import { WavePanel } from "./WavePanel.jsx";
import { cardOf } from "./WaveFullscreen.jsx";

const STAMP = "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür";
let fullscreenElement = null;

beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  HTMLElement.prototype.requestFullscreen = vi.fn(function request() { fullscreenElement = this; return Promise.resolve(); });
  document.exitFullscreen = vi.fn(() => { fullscreenElement = null; return Promise.resolve(); });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete HTMLElement.prototype.requestFullscreen;
  delete document.exitFullscreen;
  delete document.fullscreenElement;
  localStorage.clear();
});

/** The strip as its store would hold it: one bed card for SOURCE with a made-up HR. */
function shadowStub(data = strip({ beds: [stripBed("REA-01 · 2", [param("hr", 72)], { source: SOURCE })] })) {
  const state = { phase: "ok", stage: data.stage, data, fetchedAtMs: Date.now() };
  return { acquire() {}, release() {}, subscribe: () => () => {}, getState: () => state };
}

async function openFull() {
  const timers = manualTimers();
  const frames = manualFrames();
  const store = createWaveStore({
    api: { request: vi.fn(async () => answer()) }, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true, onVisibility: () => () => {}, perfNow: () => 0,
  });
  render(
    <I18nProvider>
      <SessionProvider store={sessionStub()}>
        <ShadowProvider store={shadowStub()}>
          <WavePanel source={SOURCE} title="REA-01 · 2" store={store} raf={frames.raf} caf={frames.caf} />
        </ShadowProvider>
      </SessionProvider>
    </I18nProvider>,
  );
  await act(async () => { await settle(); });
  const opener = screen.getByRole("button", { name: "Tam ekran görünüm" });
  await act(async () => { fireEvent.click(opener); await settle(); });
  return { opener, dialog: screen.getByRole("dialog", { name: "REA-01 · 2 · Dalga formu · doğrulanmamış" }) };
}

describe("the full-screen view", () => {
  it("fills the screen on black, asks the browser for full screen, and keeps the stamp at full size", async () => {
    const { dialog } = await openFull();
    expect(dialog).toHaveClass("bg-black", "fixed", "inset-0");
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBe(dialog);
    expect(within(dialog).getByText(STAMP)).toHaveClass("text-17");
    expect(within(dialog).getAllByRole("img")).toHaveLength(4);
    expect(document.querySelector("[data-wave-panel] [data-wave-rows]")).toBeNull();   // the panel's rows wait
  });

  it("shows the strip's own numbers beside the waves", async () => {
    const { dialog } = await openFull();
    const numbers = within(dialog).getByRole("region", { name: "REA-01 · 2 · Monitör · doğrulanmamış" });
    expect(numbers).toHaveTextContent("72");
  });

  it("closes on Escape, leaves browser full screen and gives the focus back to ⤢", async () => {
    const { opener } = await openFull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tam ekrandan çık" }));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on ×, and when the browser leaves full screen by itself", async () => {
    await openFull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tam ekrandan çık" })); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tam ekran görünüm" })); await settle(); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fullscreenElement = null;
    await act(async () => { document.dispatchEvent(new Event("fullscreenchange")); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab on its one control", async () => {
    await openFull();
    const close = screen.getByRole("button", { name: "Tam ekrandan çık" });
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("finds the strip's card by address, and none while the strip is off", () => {
    const data = strip({ beds: [stripBed("REA-01 · 2", [], { source: SOURCE })] });
    expect(cardOf(data, SOURCE).bed_label).toBe("REA-01 · 2");
    expect(cardOf(data, "192.0.2.99")).toBeNull();
    expect(cardOf({ stage: "off" }, SOURCE)).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/screens/common/WavePanel.test.jsx src/live/screens/common/WaveFullscreen.test.jsx`
Expected: both files fail to load — `Failed to resolve import "./WavePanel.jsx"`.

- [ ] **Step 4: The rows.** Create `dashboard/src/live/screens/common/WaveRows.jsx`:

```jsx
// src/live/screens/common/WaveRows.jsx — the drawn rows of a waveform panel (Lane C, dalga): one
// <canvas> per row waveGeometry.js `rowsOf` gives the monitor — ECG (chosen by liveness, never named
// by lead), pressure, pleth, resp — redrawn on every animation frame. Shared by the panel and its
// full-screen view.
//
// What a row SAYS is DOM text, not pixels, so a screen reader and a test read it: its label, its
// unit or "göreli", the evidence word and — over the trace — "sinyal yok", "akış durdu · N sn" or
// "akış durdu · N sn · iz kaldırıldı". No number made from a sample is ever printed (spec §5.4).
// A stalled row is drawn frozen and faded; a cleared one is blank. Colours are plain ink (white on
// the full-screen black): a monitor value is never dressed in a vital's colour (the strip's
// Decision 14).
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { headAt, nextAnchor, rowView, rowsOf } from "./waveGeometry.js";

const defaultRaf = (fn) => (typeof requestAnimationFrame === "function"
  ? requestAnimationFrame(fn) : setTimeout(() => fn(performance.now()), 50));
const defaultCaf = (id) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));
const EVIDENCE = new Set(["structural", "unverified", "screen_scale"]);

/** The row's name: "EKG" for every ECG channel (the lead is not verified), else the monitor's own
 *  label from the catalogue ("ART", "P1", "Pleth", "RESP"), else the kind's word. */
function rowLabel(t, row, catalogue) {
  if (row.kind === "ecg") return t("waves.ecg");
  const label = catalogue?.[row.id]?.label;
  return typeof label === "string" && label ? label : t(`waves.kind.${row.kind}`);
}

function rowNote(t, row, catalogue) {
  const evidence = catalogue?.[row.id]?.evidence;
  const ev = t(`waves.ev.${EVIDENCE.has(evidence) ? evidence : "unverified"}`);
  if (row.kind === "ecg") return `${t("waves.ecgLead")} · ${ev}`;
  if (row.kind === "pressure") return `${t("board.unitMmhg")} · ${ev}`;
  return `${t("waves.relative")} · ${ev}`;
}

function overlay(t, s) {
  if (!s) return null;
  if (s.state === "cleared") return t("waves.cleared", { seconds: s.seconds });
  if (s.state === "stalled") return t("waves.stalled", { seconds: s.seconds });
  if (s.state === "nosignal") return t("waves.noSignal");
  if (s.state === "waiting") return t("waves.waiting");
  return null;
}

/** The canvas's drawing buffer at its CSS size × devicePixelRatio. */
function fit(canvas) {
  if (!canvas) return { width: 0, height: 0, dpr: 1 };
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const width = canvas.clientWidth || 0;
  const height = canvas.clientHeight || 0;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { width, height, dpr };
}

function paint(canvas, size, view) {
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  if (view.paths.length === 0 && view.grid.length === 0) return;
  const color = (typeof getComputedStyle === "function" && getComputedStyle(canvas).color) || "#888888";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (const y of view.grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  for (const path of view.paths) {
    ctx.beginPath();
    ctx.moveTo(path[0], path[1]);
    for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    ctx.stroke();
  }
  for (const [x, edge] of view.clips) {           // a small triangle on the edge the trace went past
    const y = edge === "top" ? 0 : size.height;
    const dir = edge === "top" ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, y + 5 * dir);
    ctx.closePath();
    ctx.fill();
  }
}

const sameStates = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length
    && ka.every((k) => b[k] && a[k].state === b[k].state && a[k].seconds === b[k].seconds);
};

/** `device`: the wave store's state of one monitor. `tall`: the full-screen look. `raf`/`caf` are
 *  for the tests (a hand-driven frame clock); the page uses the browser's. */
export function WaveRows({ device, tall = false, raf = defaultRaf, caf = defaultCaf }) {
  const { t } = useI18n();
  const rows = rowsOf(device.blocks, device.catalogue);
  const canvases = useRef(new Map());
  const latest = useRef(device);
  latest.current = device;
  const [states, setStates] = useState({});

  useEffect(() => {
    let handle = null;
    let anchor = null;
    let seen = null;
    let lastPerf = null;
    const ranges = new Map();
    const frame = (perfMs) => {
      const d = latest.current;
      if (d.sample && d.sample !== seen) {
        anchor = nextAnchor(anchor, d.sample);
        seen = d.sample;
      }
      const head = headAt(anchor, perfMs);
      const dt = lastPerf === null ? 0 : Math.max(0, (perfMs - lastPerf) / 1000);
      lastPerf = perfMs;
      const next = {};
      for (const row of rowsOf(d.blocks, d.catalogue)) {
        const canvas = canvases.current.get(row.id);
        const size = fit(canvas);
        const view = rowView(d.blocks[row.id] ?? [], row.kind, head, size, ranges.get(row.id) ?? null, dt);
        ranges.set(row.id, view.range ?? null);
        paint(canvas, size, view);
        next[row.id] = { state: view.state, seconds: view.silentS === null ? null : Math.floor(view.silentS) };
      }
      setStates((previous) => (sameStates(previous, next) ? previous : next));
      handle = raf(frame);
    };
    handle = raf(frame);
    return () => caf(handle);
  }, [raf, caf]);

  return (
    <ul data-wave-rows="" className="m-0 mt-1.5 grid list-none gap-1.5 p-0">
      {rows.map((row) => {
        const s = states[row.id];
        const text = overlay(t, s);
        const label = rowLabel(t, row, device.catalogue);
        return (
          <li key={row.id} data-wave-row={row.kind} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2">
            <div className="min-w-0">
              <p className={`m-0 font-text text-11 font-bold uppercase leading-[normal] tracking-[.06em] ${tall ? "text-white" : "text-mute"}`}>{label}</p>
              <p className={`m-0 font-text text-10.5 leading-[normal] ${tall ? "text-white/70" : "text-mute"}`}>{rowNote(t, row, device.catalogue)}</p>
            </div>
            <div className={`relative ${tall ? "h-[18vh] min-h-[90px]" : "h-14"}`}>
              <canvas
                ref={(el) => { if (el) canvases.current.set(row.id, el); else canvases.current.delete(row.id); }}
                role="img" aria-label={t("waves.canvas", { label })} data-state={s?.state ?? "waiting"}
                className={`block h-full w-full ${tall ? "text-white" : "text-ink"} ${s?.state === "stalled" ? "opacity-40" : ""}`}
              />
              {text ? (
                <p className={`pointer-events-none absolute inset-0 m-0 grid place-items-center font-text text-12 font-semibold ${tall ? "text-amber-300" : "text-att-ink"}`}>
                  {text}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: The full-screen view.** Create `dashboard/src/live/screens/common/WaveFullscreen.jsx`:

```jsx
// src/live/screens/common/WaveFullscreen.jsx — the full-screen single-bed view (Lane C, dalga; spec
// W5): the panel's rows, filling the screen on a black ground, with the strip's own numbers beside
// them. Esc or × closes it; the stamp stays visible at full size. It asks the browser for full
// screen when it can, and is a window-filling overlay when it cannot. No sound, no number from a
// wave (spec §5.4, §5.8). The numbers are the strip's card for this monitor — values, ages and
// evidence words exactly as the strip prints them; MonitorStrip prints no patient.
import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { Button, Tag } from "../../ui/index.js";
import { MonitorStrip, readUnknown, stripOn } from "./MonitorStrip.jsx";
import { maxAgeOf } from "./monitor.js";
import { WaveRows } from "./WaveRows.jsx";

/** The strip's card for this monitor — a bed card or an unassigned one — or null. */
export function cardOf(data, source) {
  if (!stripOn(data)) return null;
  return [...(data.beds ?? []), ...(data.unassigned ?? [])].find((card) => card.source === source) ?? null;
}

export function WaveFullscreen({ source, title, device, onClose, raf, caf }) {
  const { t } = useI18n();
  const shadow = useShadow();
  const card = cardOf(shadow.data, source);
  const titleId = useId();
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    const root = rootRef.current;
    closeRef.current?.focus();
    // Escape closes, Tab stays on the one control there is; capture, so nothing behind sees either.
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closing.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    // In browser full screen, Escape leaves full screen without a key event: that closes it too.
    const onChange = () => { if (!document.fullscreenElement) closing.current(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onChange);
    if (typeof root?.requestFullscreen === "function" && !document.fullscreenElement) {
      Promise.resolve(root.requestFullscreen()).catch(() => {});   // refused: the overlay fills the window
    }
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === root && typeof document.exitFullscreen === "function") {
        Promise.resolve(document.exitFullscreen()).catch(() => {});
      }
    };
  }, []);

  const maxAgeS = maxAgeOf(shadow.data);
  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={titleId} data-wave-fullscreen=""
      className="fixed inset-0 z-[120] flex flex-col gap-3 overflow-auto bg-black p-4 text-white">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="m-0 font-display text-20 font-bold leading-[normal]">
          {title ? `${title} · ${t("waves.title")}` : t("waves.title")}
        </h2>
        <Tag tone="warn">{t("waves.tag")}</Tag>
        <span className="font-text text-12.5 text-white/70">{t("waves.delay")}</span>
        <Button ref={closeRef} icon="x" label={t("waves.close")} onClick={() => closing.current()} className="ml-auto" />
      </div>
      <p data-wave-stamp="" className="m-0 font-text text-17 font-bold text-amber-300">{t("waves.stamp")}</p>
      <div className="grid min-h-0 flex-1 gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
        <WaveRows device={device} tall raf={raf} caf={caf} />
        {card ? (
          <MonitorStrip entry={card} variant="full" title={title} level={3} className="self-start bg-card text-ink"
            nowMs={shadow.nowMs} fetchedAtMs={shadow.fetchedAtMs} maxAgeS={maxAgeS}
            feedOk={shadow.data.feed?.state === "ok"} unreadable={readUnknown(shadow, shadow.nowMs, maxAgeS)} />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 6: The panel.** Create `dashboard/src/live/screens/common/WavePanel.jsx`:

```jsx
// src/live/screens/common/WavePanel.jsx — the live waveform panel (Lane C, dalga; spec §3.3, §4, §5).
//
// UNVALIDATED research decoding of a bedside monitor's waveform blocks, drawn about 2 s behind the
// monitor, for a monitor the strip already shows. The safety rules, each held by a test:
//   1. The stamp is on screen whenever anything of the panel is (§5.1), in full screen too.
//   2. "No signal" is never a flat line (§5.2): a no-signal block draws nothing and the row says so.
//   3. Stalls are loud (§5.3): frozen, faded and "akış durdu · N sn" 1.5 s after the render time
//      reaches the end of the data; cleared, and said, 10 s after it.
//   4. No number from a wave (§5.4): the rows print labels and states, never a value.
//   5. The patient binding is the caller's (§5.5): the patient screen mounts this only for the
//      strip's `link === "one"`.
//   6. Nothing stored (§5.6) and 8. no sound of any kind (§5.8) — waveBoundaries.test.js.
// It polls only while open, mounted and visible (data/waveStore.js). On the patient screen it
// draws nothing until the first answer, and nothing when waves are off (409): it does not
// advertise a panel it cannot fill. On the device screen it is opened by hand (`collapsible`), so
// there it says why it shows nothing.
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { WAVE_STATUS, waveStoreFor } from "../../data/waveStore.js";
import { Button, Note, Tag } from "../../ui/index.js";
import { WaveRows } from "./WaveRows.jsx";
import { WaveFullscreen } from "./WaveFullscreen.jsx";

const NOTE = {
  [WAVE_STATUS.UNAVAILABLE]: "waves.unavailable",
  [WAVE_STATUS.GONE]: "waves.gone",
  [WAVE_STATUS.DENIED]: "waves.denied",
  [WAVE_STATUS.OFF]: "waves.off",
};
const QUIET = new Set([WAVE_STATUS.IDLE, WAVE_STATUS.LOADING, WAVE_STATUS.OFF]);

function OpenPanel({ store, source, title, collapsible, onHide, raf, caf, className }) {
  const { t } = useI18n();
  const id = useId();
  const [full, setFull] = useState(false);
  const fullRef = useRef(null);
  useEffect(() => store.watch(source), [store, source]);
  const device = useSyncExternalStore(store.subscribe, () => store.get(source));
  const { status } = device;
  if (!collapsible && QUIET.has(status)) return null;
  const hasRows = Object.keys(device.blocks).length > 0;
  const noteKey = NOTE[status];
  const waiting = status === WAVE_STATUS.LOADING || (status === WAVE_STATUS.OK && !hasRows);
  const closeFull = () => {
    setFull(false);
    fullRef.current?.focus();
  };
  return (
    <section aria-labelledby={id} data-wave-panel="" className={`rounded-ctl border border-dashed border-line2 px-2.5 py-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={id} className="m-0 font-text text-11.5 font-bold leading-[normal] text-ink">
          {title ? `${title} · ${t("waves.title")}` : t("waves.title")}
        </h3>
        <Tag tone="warn">{t("waves.tag")}</Tag>
        <span className="font-text text-11 text-mute">{t("waves.delay")}</span>
        <span className="ml-auto flex gap-1">
          {hasRows ? (
            <Button ref={fullRef} variant="ghost" size="sm" icon="fullscreen" label={t("waves.fullscreen")}
              onClick={() => setFull(true)} />
          ) : null}
          {collapsible ? <Button variant="ghost" size="sm" icon="x" label={t("waves.hide")} onClick={onHide} /> : null}
        </span>
      </div>
      <p data-wave-stamp="" className="m-0 mt-1 font-text text-11.5 font-semibold text-att-ink">{t("waves.stamp")}</p>
      {noteKey ? <Note className="mt-1.5">{t(noteKey)}</Note> : null}
      {waiting ? <p className="m-0 mt-1.5 font-text text-12 text-mute">{t("waves.waiting")}</p> : null}
      {hasRows && !full ? <WaveRows device={device} raf={raf} caf={caf} /> : null}
      {full ? <WaveFullscreen source={source} title={title} device={device} onClose={closeFull} raf={raf} caf={caf} /> : null}
    </section>
  );
}

/**
 * One monitor's waves. `source`: the strip card's address. `title`: the bed label (or the device
 * screen's own title). `collapsible`: closed behind a button until opened (the device screen, so
 * that a list of monitors polls none of them by itself). `store`, `raf`, `caf`: for the tests; the
 * page uses the session's wave store and the browser's frame clock.
 */
export function WavePanel({ source, title, collapsible = false, store, raf, caf, className = "" }) {
  const { t } = useI18n();
  const { store: session } = useSession();
  const waves = store ?? waveStoreFor(session);
  const [open, setOpen] = useState(!collapsible);
  if (!source) return null;
  if (!open) {
    return (
      <div className={className}>
        <Button variant="ghost" size="sm" icon="activity" onClick={() => setOpen(true)}>{t("waves.show")}</Button>
      </div>
    );
  }
  return (
    <OpenPanel store={waves} source={source} title={title} collapsible={collapsible} onHide={() => setOpen(false)}
      raf={raf} caf={caf} className={className} />
  );
}
```

- [ ] **Step 7: Run.**

Run: the command of Step 3.
Expected: `21 passed` (15 + 6).

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/inf-dalga && git add dashboard/src/live/screens/common/WaveRows.jsx dashboard/src/live/screens/common/WavePanel.jsx dashboard/src/live/screens/common/WaveFullscreen.jsx dashboard/src/live/screens/common/WavePanel.test.jsx dashboard/src/live/screens/common/WaveFullscreen.test.jsx && git commit -m "feat(dashboard): the live waveform panel and its full-screen view — unvalidated, display only, silent" -m "A <canvas> per row and one animation-frame loop per panel; what a row says is DOM text (its label, unit, evidence, and 'sinyal yok' or 'akış durdu · N sn' over the trace), so a screen reader and a test read it, and no number from a sample is ever printed. The stamp is on screen whenever any of the panel is, at full size in full screen. ECG rows are 'EKG', never a lead; a pressure is 'ART' only for 0x0301 and 'P1' for 0x0e01. On the patient screen the panel shows nothing until its first answer and nothing when waves are off; on the device screen it waits behind a button and says why it is empty. The full-screen view is black, the strip's own numbers beside the waves; Escape, × or leaving browser full screen close it and give the focus back. No audio of any kind." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The wave modules never reach an alarm path, and make no sound

**Files:**
- Create: `dashboard/src/live/waveBoundaries.test.js`

- [ ] **Step 1: Write the test.** Create `dashboard/src/live/waveBoundaries.test.js`:

```js
// Lane C (dalga): the live waveform modules feed nothing, make no sound and store nothing.
//
// Its own file, beside boundaries.test.js (the monitor strip's rule, which Lane A edits): the same
// reader (imports.testutil.js) and the same walk. Both directions are held, through any chain of
// imports: nothing that alarms — the sound and the notification (signals/), the bell, rail and menu
// (shell/, all but the screen registry shell/routes.js), the lock screen and the board store — may
// reach a wave module, and no wave module may reach any of them. And no wave module may name an
// audio, speech, vibration or notification API (spec §5.8), browser storage, or a way to save a
// picture of its canvas (§5.6). Comments are read past: a comment that says "no sound" is allowed.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf } from "./imports.testutil.js";

const LIVE = path.dirname(fileURLToPath(import.meta.url));
const WAVES = ["data/waveStore.js", "screens/common/waveGeometry.js", "screens/common/WaveRows.jsx",
  "screens/common/WavePanel.jsx", "screens/common/WaveFullscreen.jsx"];
const REGISTRY = "shell/routes.js";
const rel = (file) => path.relative(LIVE, file).replace(/\\/g, "/");
const isWave = (target) => WAVES.includes(target);
const isAlarm = (target) => target.startsWith("signals/") || (target.startsWith("shell/") && target !== REGISTRY)
  || target === "auth/LockScreen.jsx" || target === "data/boardStore.js" || target === "data/BoardProvider.jsx";

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.|\.testutil\./.test(entry.name) ? [full] : [];
  });
}

const resolveSpec = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, "index.js"), path.join(base, "index.jsx")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};

/** Every module `root` reaches through relative imports (stopping at the registry), with the
 *  chain that reached it, as "a -> b -> c". */
function reached(root) {
  const via = new Map([[root, null]]);
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file !== root && rel(file) === REGISTRY) continue;
    for (const spec of importsOf(fs.readFileSync(file, "utf8")).specs) {
      if (!spec.startsWith(".")) continue;
      const target = resolveSpec(file, spec);
      if (!target || via.has(target) || !target.startsWith(LIVE + path.sep)) continue;
      via.set(target, file);
      queue.push(target);
    }
  }
  return [...via.keys()].filter((file) => file !== root).map((file) => {
    const chain = [];
    for (let at = file; at; at = via.get(at)) chain.unshift(rel(at));
    return { target: rel(file), chain: chain.join(" -> ") };
  });
}

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FORBIDDEN_API = /\b(Audio|AudioContext|webkitAudioContext|speechSynthesis|SpeechSynthesisUtterance|vibrate|Notification|localStorage|sessionStorage|indexedDB|toDataURL|toBlob|captureStream)\b/;

describe("the waveform modules", () => {
  const guarded = [
    ...sources(path.join(LIVE, "signals")),
    ...sources(path.join(LIVE, "shell")).filter((f) => rel(f) !== REGISTRY),
    path.join(LIVE, "auth", "LockScreen.jsx"),
    path.join(LIVE, "data", "boardStore.js"),
    path.join(LIVE, "data", "BoardProvider.jsx"),
  ];

  it("exist, so no rule here can pass by their absence", () => {
    for (const file of WAVES) expect(fs.existsSync(path.join(LIVE, file)), file).toBe(true);
    expect(guarded.length).toBeGreaterThan(8);
  });

  it("are reached by no signal, shell, lock-screen or board-store module, through any chain", () => {
    const leaks = guarded.flatMap((root) => reached(root).filter((r) => isWave(r.target)).map((r) => r.chain));
    expect(leaks).toEqual([]);
  });

  it("reach no signal, shell, lock-screen or board-store module, through any chain", () => {
    let followed = 0;
    const leaks = WAVES.flatMap((file) => {
      const found = reached(path.join(LIVE, file));
      followed += found.length;
      return found.filter((r) => isAlarm(r.target)).map((r) => r.chain);
    });
    expect(followed, "the walk followed no import at all").toBeGreaterThan(WAVES.length);
    expect(leaks).toEqual([]);
  });

  it("name no sound, speech, vibration, notification, storage or canvas-export API", () => {
    const named = WAVES.filter((file) => FORBIDDEN_API.test(withoutComments(fs.readFileSync(path.join(LIVE, file), "utf8"))));
    expect(named).toEqual([]);
  });

  it("the rules see a leak when there is one", () => {
    expect(isWave("screens/common/WavePanel.jsx")).toBe(true);
    expect(isAlarm("signals/AlarmSignals.jsx") && isAlarm("data/boardStore.js") && isAlarm("shell/TopBar.jsx")).toBe(true);
    expect(isAlarm(REGISTRY)).toBe(false);
    expect(FORBIDDEN_API.test(withoutComments("const a = new AudioContext(); // ok"))).toBe(true);
    expect(FORBIDDEN_API.test(withoutComments("// no AudioContext here\nconst a = 1;"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, and prove it bites.**

Run: `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/waveBoundaries.test.js src/live/boundaries.test.js`
Expected: `13 passed` (5 + 8). Then, as a check that is not committed, add `import { useBoard } from "../../data/BoardProvider.jsx";` as the last import of `WavePanel.jsx` and re-run: `reach no signal, shell, lock-screen or board-store module` fails naming `screens/common/WavePanel.jsx -> data/BoardProvider.jsx`; put the line back out (`git diff --stat` shows only the new test file) and re-run: green.

- [ ] **Step 3: Commit.**

```bash
cd /c/tmp/inf-dalga && git add dashboard/src/live/waveBoundaries.test.js && git commit -m "test(dashboard): the wave modules never reach an alarm path, store nothing and make no sound" -m "Its own file beside boundaries.test.js (the strip's rule, which Lane A edits), with the same reader and the same walk, in both directions: nothing that alarms — signals/, the shell but its screen registry, the lock screen, the board store — reaches a wave module, and no wave module reaches any of them. And no wave module names an audio, speech, vibration or notification API, browser storage, or a way to save its canvas as a picture (spec §5.6, §5.8)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: A synthetic fake hub for the local walk

`scripts/dev_waves_replay.py` runs the real hub app (with the live view and the `WaveBuffer`) over TLS on this machine, feeds it made-up packets for three made-up monitors every 200 ms — SYN-1 like BED07 (ECG on `0x0103`, ART), SYN-2 like BED08 (ECG on `0x0102` with `0x0103`/`0x0104` "no signal", P1), SYN-3 with its ECG lead off — and posts the strip's values to a local API the way drop-in 93's forwarder does. Everything it writes goes to one scratch folder outside the repository. No capture, no patient: every value is a formula of time.

**Files:**
- Create: `homunculus-engine/tests/test_dev_waves_replay.py`
- Create: `homunculus-engine/scripts/dev_waves_replay.py`

- [ ] **Step 1: Write the failing tests.** Create `homunculus-engine/tests/test_dev_waves_replay.py`:

```python
"""The local replay's fake hub (scripts/dev_waves_replay.py) builds what the panel needs, and only
made-up data: its packets decode as the three synthetic monitors, its table is one the API accepts,
its certificate is for the names the API container uses. Nothing is served or sent here."""
import importlib.util
import ipaddress
from pathlib import Path

from cryptography import x509

from homunculus.api.infinity_device_beds import parse_table
from homunculus.edge.infinity_records import PARAMETERS, parse_payload
from homunculus.edge.infinity_stream import Inventory
from homunculus.edge.infinity_waves import WAVES, parse_waves

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "dev_waves_replay.py"
SPEC = importlib.util.spec_from_file_location("dev_waves_replay", SCRIPT)
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)


def ids(monitor, k=1):
    return [(b.wave_id, b.samples is None) for b in parse_waves(replay.build_payload(monitor, k))]


def test_the_three_monitors_send_the_waves_the_panel_must_draw():
    syn1, syn2, syn3 = replay.MONITORS
    assert ids(syn1) == [(0x0102, True), (0x0103, False), (0x0301, False), (0x1916, False), (0x0201, False)]
    assert ids(syn2) == [(0x0103, True), (0x0104, True), (0x0102, False), (0x0E01, False), (0x1916, False),
                         (0x0201, False)]
    assert ids(syn3) == [(0x0103, True), (0x0201, False)]
    assert all(wave in WAVES for monitor in replay.MONITORS for wave, _ in ids(monitor))


def test_its_pressure_is_a_made_up_80_to_120_mmhg_at_sample_over_40():
    blocks = [b for k in range(5) for b in parse_waves(replay.build_payload(replay.MONITORS[0], k)) if b.wave_id == 0x0301]
    values = [s / 40 for b in blocks for s in b.samples]
    assert 79 <= min(values) and max(values) <= 131


def test_once_a_second_a_packet_carries_the_strips_two_numbers_after_its_blocks():
    names = {PARAMETERS[replay.HR_ID][0], PARAMETERS[replay.SPO2_ID][0]}
    assert set(parse_payload(replay.build_payload(replay.MONITORS[0], 0))) == names
    assert parse_payload(replay.build_payload(replay.MONITORS[0], 1)) == {}
    assert len(parse_waves(replay.build_payload(replay.MONITORS[0], 0))) == 5     # the blocks still decode


def test_consecutive_packets_are_200_ms_apart_on_the_monitors_clock():
    t = [parse_waves(replay.build_payload(replay.MONITORS[0], k))[0].t_ms for k in range(6)]
    assert [b - a for a, b in zip(t, t[1:])] == [200] * 5


def test_the_inventory_parses_and_names_the_three_monitors():
    assert [d.source for d in Inventory.parse(replay.INVENTORY).devices] == ["192.0.2.21", "192.0.2.22", "192.0.2.23"]


def test_the_scratch_folder_holds_a_valid_table_the_api_env_and_the_override(tmp_path):
    replay.issue_certificates(tmp_path)
    replay.write_scratch(tmp_path, port=8766, viewer="v" * 48, shadow="s" * 48, today="2026-10-27")
    table = parse_table(__import__("json").loads((tmp_path / "infinity-shadow" / "device-beds.json").read_text("utf-8")))
    assert table is not None
    env = (tmp_path / "api.env").read_text("utf-8")
    assert "INFINITY_WAVES=on" in env and "INFINITY_CLINICAL_STAGE=shadow" in env
    assert "INFINITY_HUB_URL=https://host.docker.internal:8766" in env
    assert '"127.0.0.1:18000:8000"' in (tmp_path / "compose.dalga.yml").read_text("utf-8")


def test_the_certificate_is_the_cas_and_names_the_hosts_the_api_container_uses(tmp_path):
    replay.issue_certificates(tmp_path)
    ca = x509.load_pem_x509_certificate((tmp_path / "ca.pem").read_bytes())
    leaf = x509.load_pem_x509_certificate((tmp_path / "hub.pem").read_bytes())
    leaf.verify_directly_issued_by(ca)
    names = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert set(names.get_values_for_type(x509.DNSName)) == {"host.docker.internal", "localhost"}
    assert names.get_values_for_type(x509.IPAddress) == [ipaddress.ip_address("127.0.0.1")]
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_dev_waves_replay.py`
Expected: `1 error` — `FileNotFoundError` for `scripts/dev_waves_replay.py`.

- [ ] **Step 3: Write the script.** Create `homunculus-engine/scripts/dev_waves_replay.py`:

```python
"""A fake Infinity hub on this machine, streaming SYNTHETIC monitors — for watching the dalga panel
in a browser against a local stack. Never on the VM, never with real traffic, never a real patient.

It runs the real hub app (`edge.infinity_hub.create_hub`, with the live research view and the
WaveBuffer) over TLS, feeds it made-up packets for three made-up monitors every 200 ms, and posts
the strip's values to a local API the way the hub forwarder does, so the device screen shows the
three monitors and their waves. Everything it writes goes into one scratch folder (`--folder`): a
throwaway CA and certificate, the device->bed table, `api.env` (the lines the local API's
environment needs, its two random tokens included) and `compose.dalga.yml` (an override that
publishes the API on 127.0.0.1:18000 and mounts the table and the CA).

    python scripts/dev_waves_replay.py --folder C:/tmp/inf-dalga-stack

The monitors (made up; every value is a formula of time):
  SYN-1  192.0.2.21  bed yb-01  ECG live on 0x0103 (0x0102 "no signal"), ART 0x0301, pleth, resp
  SYN-2  192.0.2.22  bed yb-02  ECG live on 0x0102 (0x0103, 0x0104 "no signal"), P1 0x0e01, pleth, resp
  SYN-3  192.0.2.23  bed yb-03  ECG "no signal" on 0x0103 (lead off), resp
Once a second each packet also carries two numeric records (a made-up pulse 72 and SpO2 97).
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import math
import secrets
import struct
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from cryptography import x509  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID  # noqa: E402

from homunculus.edge.infinity_records import PARAMETERS, RECORD_SIZE  # noqa: E402

PERIOD_S = 0.2
DEVICE_EPOCH_S = 800_000_000          # where the made-up monitors' own clocks start
HOSTS = ("host.docker.internal", "localhost")
ADDRESSES = ("127.0.0.1",)
MONITORS = (
    {"id": "SYN-1", "source": "192.0.2.21", "group": "239.20.1.21", "bed_label": "YB-1", "bed_id": "yb-01",
     "ecg_live": 0x0103, "ecg_quiet": (0x0102,), "pressure": 0x0301, "pleth": True},
    {"id": "SYN-2", "source": "192.0.2.22", "group": "239.20.1.22", "bed_label": "YB-2", "bed_id": "yb-02",
     "ecg_live": 0x0102, "ecg_quiet": (0x0103, 0x0104), "pressure": 0x0E01, "pleth": True},
    {"id": "SYN-3", "source": "192.0.2.23", "group": "239.20.1.23", "bed_label": "YB-3", "bed_id": "yb-03",
     "ecg_live": None, "ecg_quiet": (0x0103,), "pressure": None, "pleth": False},
)
INVENTORY = {"collector_id": "synthetic-dalga", "interface": "192.0.2.200/24",
             "devices": [{"id": m["id"], "source": m["source"], "group": m["group"], "port": 2050} for m in MONITORS]}
HR_ID, SPO2_ID = 0x1905, 0x190E


# --- the made-up signals: functions of the monitor's own time, nothing measured ------------------

def _bump(phase, centre, width):
    return math.exp(-((phase - centre) / width) ** 2)


def ecg(t):
    phase = t % 0.8
    return int(900 * _bump(phase, 0.20, 0.012) - 150 * _bump(phase, 0.17, 0.010) + 180 * _bump(phase, 0.45, 0.05))


def pressure(t):
    phase = t % 0.8                                        # a made-up 80–120 mmHg, in counts (x 40)
    return int((80 + 40 * (_bump(phase, 0.30, 0.06) + 0.25 * _bump(phase, 0.50, 0.05))) * 40)


def pleth(t):
    return int(1500 + 900 * _bump((t - 0.25) % 0.8, 0.25, 0.12))


def resp(t):
    return int(1200 * math.sin(2 * math.pi * t / 4.0))


def _block(wave_id, rate, device_s, ms, values):
    return struct.pack(">HHHIHBB", rate, 14 + 2 * len(values), ms, device_s, wave_id, len(values), 0) + \
        struct.pack(f">{len(values)}h", *values)


def _wave(wave_id, rate, device_s, ms, signal):
    start = device_s + ms / 1000
    return _block(wave_id, rate, device_s, ms, [signal(start + i / rate) for i in range(rate // 5)])


def _quiet(wave_id, rate, device_s, ms):
    return _block(wave_id, rate, device_s, ms, [1] * (rate // 5))


def _record(identifier, value, *, low, high):
    data = bytearray(RECORD_SIZE)
    data[0:2] = value.to_bytes(2, "big")
    data[2:4] = high.to_bytes(2, "big", signed=True)
    data[4:6] = low.to_bytes(2, "big", signed=True)
    data[20:22] = identifier.to_bytes(2, "big")
    data[24] = PARAMETERS[identifier][1]
    return bytes(data)


def build_payload(monitor, k):
    """The k-th 200 ms packet of one made-up monitor; every fifth carries the record section."""
    device_s, ms = divmod(DEVICE_EPOCH_S * 1000 + 40 + 200 * k, 1000)
    parts = [_quiet(wave, 200, device_s, ms) for wave in monitor["ecg_quiet"]]
    if monitor["ecg_live"] is not None:
        parts.append(_wave(monitor["ecg_live"], 200, device_s, ms, ecg))
    if monitor["pressure"] is not None:
        parts.append(_wave(monitor["pressure"], 100, device_s, ms, pressure))
    if monitor["pleth"]:
        parts.append(_wave(0x1916, 100, device_s, ms, pleth))
    parts.append(_wave(0x0201, 50, device_s, ms, resp))
    header = bytearray(64)
    header[29] = 0x0A if k % 5 == 0 else 0x03
    tail = (_record(HR_ID, 72, low=40, high=150) + _record(SPO2_ID, 97, low=85, high=100)) if k % 5 == 0 else b""
    return bytes(header) + b"".join(parts) + tail


# --- the scratch folder ---------------------------------------------------------------------------

def issue_certificates(folder, *, hosts=HOSTS, addresses=ADDRESSES, now=None):
    """A throwaway CA and a server certificate for `hosts` and `addresses`, valid for 30 days."""
    now = now or dt.datetime.now(dt.timezone.utc)
    ca_key, key = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "dev_waves_replay synthetic CA")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
          .not_valid_after(now + dt.timedelta(days=30))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    names = [x509.DNSName(h) for h in hosts] + [x509.IPAddress(ipaddress.ip_address(a)) for a in addresses]
    leaf = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "dev_waves_replay synthetic hub")]))
            .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=30))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName(names), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    pem = serialization.Encoding.PEM
    (folder / "ca.pem").write_bytes(ca.public_bytes(pem))
    (folder / "hub.pem").write_bytes(leaf.public_bytes(pem))
    (folder / "hub-key.pem").write_bytes(key.private_bytes(pem, serialization.PrivateFormat.PKCS8,
                                                           serialization.NoEncryption()))


def write_scratch(folder, *, port, viewer, shadow, today=None):
    """The device->bed table, `api.env` and `compose.dalga.yml` for the local stack."""
    today = today or dt.date.today().isoformat()
    beds = folder / "infinity-shadow"
    beds.mkdir(parents=True, exist_ok=True)
    table = {"schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic-dalga",
             "approved_by": "dev_waves_replay (synthetic)", "approved_at": today,
             "devices": [{"source": m["source"], "group": m["group"], "port": 2050, "bed_label": m["bed_label"],
                          "bed_id": m["bed_id"], "unit_id": "yb", "method": "monitor_screen", "verified_at": today,
                          "valid_from": "2026-01-01T00:00:00Z", "valid_to": None, "note": "synthetic"}
                         for m in MONITORS]}
    (beds / "device-beds.json").write_text(json.dumps(table, ensure_ascii=False, indent=2), encoding="utf-8")
    ca = (folder / "ca.pem").resolve().as_posix()
    (folder / "api.env").write_text("".join(f"{line}\n" for line in (
        "# Written by scripts/dev_waves_replay.py: SYNTHETIC monitors, a local walk only.",
        f"INFINITY_HUB_URL=https://host.docker.internal:{port}",
        f"INFINITY_VIEWER_TOKEN={viewer}",
        f"INFINITY_HUB_CA_HOST_PATH={ca}",
        "INFINITY_HUB_CA_FILE=/etc/homunculus/infinity-ca.pem",
        "INFINITY_WAVES=on",
        "INFINITY_CLINICAL_STAGE=shadow",
        f"INFINITY_SHADOW_TOKEN={shadow}")), encoding="utf-8")
    (folder / "compose.dalga.yml").write_text("".join(f"{line}\n" for line in (
        "# Written by scripts/dev_waves_replay.py: a LOCAL walk only, SYNTHETIC monitors.",
        "services:",
        "  api:",
        "    ports:",
        '      - "127.0.0.1:18000:8000"',
        "    extra_hosts:",
        '      - "host.docker.internal:host-gateway"',
        "    volumes:",
        f"      - {beds.resolve().as_posix()}:/etc/homunculus/infinity-shadow:ro",
        f"      - {ca}:/etc/homunculus/infinity-ca.pem:ro")), encoding="utf-8")


# --- the run ----------------------------------------------------------------------------------------

def feed(inventory, consumers, stop, *, clock=time.time, monotonic=time.monotonic):
    """Every PERIOD_S, one packet per monitor, handed to each consumer as the hub would."""
    from homunculus.edge.infinity_stream import packet_event
    started, k = monotonic(), 0
    while not stop.is_set():
        events = [packet_event(inventory, device, build_payload(monitor, k), 2564, received_at=clock(),
                               retain_payload=True) for device, monitor in zip(inventory.devices, MONITORS)]
        for consume in consumers:
            consume(events)
        k += 1
        stop.wait(max(0.0, started + k * PERIOD_S - monotonic()))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--folder", required=True, type=Path, help="a scratch folder outside the repository")
    parser.add_argument("--api", default="http://127.0.0.1:18000", help="the local API, for the strip's values")
    parser.add_argument("--host", default="127.0.0.1", help="the fake hub's bind address")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args(argv)
    import uvicorn
    from homunculus.edge.infinity_hub import create_hub
    from homunculus.edge.infinity_journal import Journal
    from homunculus.edge.infinity_live import LiveResearchView
    from homunculus.edge.infinity_shadow import ShadowSender, forward_loop
    from homunculus.edge.infinity_stream import Inventory
    from homunculus.edge.infinity_waves import WaveBuffer

    folder = args.folder
    folder.mkdir(parents=True, exist_ok=True)
    viewer, collector, shadow = (secrets.token_urlsafe(36) for _ in range(3))
    issue_certificates(folder)
    write_scratch(folder, port=args.port, viewer=viewer, shadow=shadow)
    inventory = Inventory.parse(INVENTORY)
    journal = Journal(folder / f"hub-{int(time.time())}.sqlite", Fernet.generate_key())
    view, waves = LiveResearchView(inventory), WaveBuffer(inventory)
    app = create_hub(inventory, journal, collector, viewer, accept_payload=True, research_view=view, waves=waves)
    stop = threading.Event()
    threading.Thread(target=feed, args=(inventory, (view.consume, waves.consume), stop), daemon=True).start()
    # The strip's values, as drop-in 93's forwarder sends them — over plain HTTP to the API's
    # loopback port here (compose.dalga.yml), which is why the opener is injected.
    sender = ShadowSender(args.api.rstrip("/") + "/infinity-shadow/readings", shadow, "",
                          opener=urllib.request.build_opener(urllib.request.ProxyHandler({})))
    threading.Thread(target=forward_loop, args=(view, sender, stop), kwargs={"collector_age": lambda: 0.0},
                     daemon=True).start()
    print(f"SYNTHETIC fake hub on https://{args.host}:{args.port} - three made-up monitors, no patient.", flush=True)
    print(f"Scratch folder: {folder.resolve()} (api.env, compose.dalga.yml, infinity-shadow/, ca.pem).", flush=True)
    print("Ctrl+C stops it.", flush=True)
    try:
        uvicorn.run(app, host=args.host, port=args.port, ssl_certfile=str(folder / "hub.pem"),
                    ssl_keyfile=str(folder / "hub-key.pem"), access_log=False)
    finally:
        stop.set()
        journal.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run.** Expected: `7 passed`.

- [ ] **Step 5: A smoke run over real TLS** (a scratch folder outside the repository; the hub stops itself after 30 s):

```bash
F=/c/tmp/inf-dalga-smoke-$(date +%s)
cd /c/tmp/inf-dalga/homunculus-engine && (PYTHONDONTWRITEBYTECODE=1 timeout 30 /c/tmp/f7-py312/venv/Scripts/python.exe scripts/dev_waves_replay.py --folder "$F" > "$F.log" 2>&1 &)
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 timeout 40 /c/tmp/f7-py312/venv/Scripts/python.exe - "$F" <<'EOF'
import asyncio, sys, time
from pathlib import Path
from homunculus.api.infinity_waves import HubWaves, WaveSettings, answer
folder = Path(sys.argv[1])
async def main():
    deadline = time.monotonic() + 20
    while not (folder / "api.env").exists() and time.monotonic() < deadline:
        await asyncio.sleep(0.2)
    env = dict(l.split("=", 1) for l in (folder / "api.env").read_text().splitlines() if "=" in l and not l.startswith("#"))
    feed = HubWaves(WaveSettings(True, "https://localhost:8766", env["INFINITY_VIEWER_TOKEN"], str(folder / "ca.pem")))
    while time.monotonic() < deadline:
        outcome = await feed.window("192.0.2.22")
        if outcome.status == 200 and outcome.body["blocks"]:
            break
        await asyncio.sleep(0.5)
    body = answer("192.0.2.22", outcome.body, 0)
    print(outcome.status, sorted({hex(b["id"]) for b in body["blocks"]}), "null:", sorted({hex(b["id"]) for b in body["blocks"] if b["samples"] is None}))
asyncio.run(main())
EOF
```
Expected: `200 ['0x102', '0x103', '0x104', '0x1916', '0x201', '0xe01'] null: ['0x103', '0x104']` — the API's own client, through the hub's real TLS and route, gets SYN-2's BED08-like waves. Delete `$F` and `$F.log` afterwards (scratch, synthetic).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/inf-dalga && git add homunculus-engine/scripts/dev_waves_replay.py homunculus-engine/tests/test_dev_waves_replay.py && git commit -m "feat(scripts): a synthetic fake hub for watching the waveform panel on a local stack" -m "dev_waves_replay.py runs the real hub app over TLS with three made-up monitors — one like BED07 (ECG on 0x0103, ART), one like BED08 (ECG on 0x0102 beside two no-signal channels, P1), one with its ECG lead off — and posts the strip's values to a local API as the forwarder does. It writes a throwaway CA and certificate for host.docker.internal, the device->bed table, api.env and a compose override into a scratch folder. Every value is a formula of time; nothing comes from a capture or a patient." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: The documents that change with this slice (spec §12)

Statements that the waves are undecoded, not drawn, or "not a monitor" become false with this slice; each gets a dated correction that points at the protocol document. **No patient value is written anywhere.** The spec and the protocol document themselves are the lead's (`302ac83`) and are not edited here.

**Files:**
- Modify: `docs/INFINITY-PARAMETER-RECORDS.md:120-121, 170-171, 214-216`
- Modify: `docs/INFINITY-BED09-DECODER.md:24-25`, `docs/INFINITY-CONTINUOUS-RESEARCH.md:27`, `docs/INFINITY-RESEARCH-REPLAY.md:6`, `docs/INFINITY-100-DEVICE-ARCHITECTURE.md:102-104`
- Modify: `docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md:37, 269`, `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md:168`
- Modify: `docs/homunculus-rehber-TR.md:966-968, 1059, 1198` (a new sub-bullet after the NBP one)
- Modify: `homunculus-engine/src/homunculus/edge/infinity_live.py:9-10`, `homunculus-engine/src/homunculus/edge/infinity_research.py:264`, `dashboard/src/live/i18n/strings/patient.js:3-4`

- [ ] **Step 1: `docs/INFINITY-PARAMETER-RECORDS.md`** — three Edits.

(a) Replace
```markdown
- Yatak etiketi bu akışta **yok**. Cihaz adresten tanımlanır; yatak adı ayrı ve
  doğrulanmış bir kaynaktan gelmelidir.
```
with
```markdown
- Yatak etiketi bu akışta (`2050`) **yok**. Cihaz adresten tanımlanır; yatak adı ayrı ve
  doğrulanmış bir kaynaktan gelmelidir. (27.10.2026: aynı cihaz yatak adını ayrı bir yan akışta,
  `224.127.2.255:2150`'de yayınlıyor; worker o gruba katılmıyor —
  [INFINITY-DALGA-FORMU.md](INFINITY-DALGA-FORMU.md), "Yan akışlar".)
```

(b) Replace
```markdown
dağıtımında yakalandı: bir yatak araya kayıt taşımayan dalga formu paketleri gönderiyor ve
```
with
```markdown
dağıtımında yakalandı: bir yatak saniyede dört kez yalnız dalga blokları taşıyan, kayıt
taşımayan paket (tür `0x03`, [INFINITY-DALGA-FORMU.md](INFINITY-DALGA-FORMU.md)) gönderiyor ve
```

(c) Replace
```markdown
Gösterilen "diagram", parametre değerlerinin zaman içindeki trend çizgisidir. Monitördeki
EKG/pleth dalga formu **çizilmez**; dalga formu paketleri (`522/468/346` bayt) çözülmedi ve
bunların dalga formu olduğu iddia edilmez. Ayrı iştir.
```
with
```markdown
Gösterilen "diagram", parametre değerlerinin zaman içindeki trend çizgisidir; bu araştırma
sayfası dalga çizmez. (27.10.2026: "`522/468/346` baytlık dalga formu paketleri" ayrı bir biçim
değildi — her paket dalga blokları taşır ve bloklar çözüldü,
[INFINITY-DALGA-FORMU.md](INFINITY-DALGA-FORMU.md). Canlı çizim, cihaz ve hasta ekranındaki
"Dalga formu · doğrulanmamış" panelidir (`INFINITY_WAVES=on`); yalnız görüntüdür.)
```

- [ ] **Step 2: the other protocol notes** — one Edit each.

`docs/INFINITY-BED09-DECODER.md`: replace
```markdown
522 baytlık paketlerde çözümleme denenmez; bu paketlerin dalga biçimi olduğu iddia
edilmez ve bunlar aday sayıların tazeliğini yenilemez.
```
with
```markdown
522 baytlık paketlerde çözümleme denenmez ve bunlar aday sayıların tazeliğini yenilemez.
(27.10.2026: bunlar tür `0x03` dalga paketleridir — [INFINITY-DALGA-FORMU.md](INFINITY-DALGA-FORMU.md);
bu decoder onlara hâlâ dokunmaz.)
```

`docs/INFINITY-CONTINUOUS-RESEARCH.md`: replace
```markdown
doğrulanmadı. Hasta eşleştirmesi, ECG dalgaları ve klinik ingest kapalıdır.
```
with
```markdown
doğrulanmadı. Hasta eşleştirmesi ve klinik ingest kapalıdır. (27.10.2026: dalga blokları
çözüldü ve yalnız ayrı, doğrulanmamış bir görüntü panelinde çizilir —
[INFINITY-DALGA-FORMU.md](INFINITY-DALGA-FORMU.md), `INFINITY_WAVES`.)
```

`docs/INFINITY-RESEARCH-REPLAY.md`: replace
```markdown
Canlı sayısal aktarım, klinik `/ingest`, hasta eşleştirmesi ve ECG dalga çözümü etkin değildir.
```
with
```markdown
Canlı sayısal aktarım, klinik `/ingest`, hasta eşleştirmesi ve ECG dalga çözümü bu yerel
oynatımda etkin değildir. (27.10.2026: canlı dalga paneli için [INFINITY-DALGA-FORMU.md](INFINITY-DALGA-FORMU.md).)
```

`docs/INFINITY-100-DEVICE-ARCHITECTURE.md`: replace
```markdown
   extraction does not validate a waveform decoder or replacement alarm display.
```
with
```markdown
   extraction does not validate a waveform decoder or replacement alarm display.
   Status 2026-10-27: the structure is answered in `docs/INFINITY-DALGA-FORMU.md` (blocks,
   ids, rates, the pressure scale, timing, gaps; the live ECG channel differs by bed). The
   screen-level validation is open, and the panel built on it is display-only, unvalidated,
   silent and stores nothing.
```

- [ ] **Step 3: the decisions it reverses** — one Edit each.

`docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md`: replace
```markdown
| D5 | **No waveforms.** 
```
with
```markdown
| D5 | **No waveforms.** *(Superseded 2026-10-27 by the owner's W1–W6, `2026-10-27-infinity-dalga-formu-design.md`: real decoded waves are drawn in a separate, unvalidated panel; the synthetic traces stay gone.)* 
```
and replace
```markdown
Waveforms; the unit board (`grafik.js`); the wall monitor;
```
with
```markdown
Waveforms (since 2026-10-27: the dalga slice, a separate panel); the unit board (`grafik.js`); the wall monitor;
```

`docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md`: replace
```markdown
- **It is slow enough not to be a monitor.** The strip must not invite anyone to treat it as a live waveform display.
```
with
```markdown
- **It is slow enough not to be a monitor.** The strip must not invite anyone to treat it as a live waveform display. *(2026-10-27: the owner reversed this for a separate waveform panel — decision W2 of the dalga spec, with its safety rules; the strip itself keeps its 5 s cadence.)*
```

- [ ] **Step 4: the Turkish guide** (`docs/homunculus-rehber-TR.md`) — three Edits.

(a) Replace
```markdown
  numarası, simüle monitör dalgası ve hemşirelik risk skorları. Vital eğrileri artık motorun
  kaydından çizilir (3.7).
```
with
```markdown
  numarası, simüle (uydurma) monitör dalgası ve hemşirelik risk skorları. Vital eğrileri artık
  motorun kaydından çizilir (3.7). Gerçek monitör dalgası ayrı, "doğrulanmamış" etiketli bir
  paneldedir (5. bölüm, "Dalga paneli").
```

(b) Replace
```markdown
**Ne göstermez:** dalga formu (ECG vb.) — prototiptekiler sentetikti; Aşama A'nın monitör
```
with
```markdown
**Ne göstermez:** dalga formu (ECG vb.) — prototiptekiler sentetikti; gerçek dalga ayrı,
doğrulanmamış bir paneldedir (5. bölüm, "Dalga paneli"); Aşama A'nın monitör
```

(c) Replace
```markdown
    drop-in 94; geri alma: önce 94 silinir (hub R3'e, NBP'siz şeride döner), API/web ancak ondan
    sonra. Dağıtımda sıra tersidir: önce API ve web, sonra hub.
```
with
```markdown
    drop-in 94; geri alma: önce 94 silinir (hub R3'e, NBP'siz şeride döner), API/web ancak ondan
    sonra. Dağıtımda sıra tersidir: önce API ve web, sonra hub.
  - **Dalga paneli (Lane C, "dalga" dilimi):** Monitörün ağ yayınındaki dalga blokları da
    çözüldü: EKG, basınç (ART ya da P1), pleth ve solunum. Cihaz ekranında her monitörün altında
    "Dalga formunu göster" düğmesiyle; hasta ekranında yalnız şeridin **tek bir** monitörü
    bağladığı hastada, şeridin hemen altında canlı akan bir panel olarak görünür; ⤢ ile siyah
    zeminli tam ekran açılır. Çizim monitörün yaklaşık **2 saniye gerisinden** gelir ve yalnız
    **görüntüdür**: panelde her zaman "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm
    başucu monitörüdür" yazar. Sınırları: dalgadan hiçbir sayı, alarm, skor, bildirim ya da
    **ses** üretilmez (nabız sesi yoktur). EKG satırı yalnız "EKG" diye yazılır; hangi kanalın
    canlı olduğu yatağa göre değiştiği ve derivasyon adı doğrulanmadığı için "II" gibi bir ad
    verilmez; EKG kazancı bilinmediği için mV ızgarası da yoktur. Sinyal yoksa düz çizgi değil
    "sinyal yok" yazar (düz bir EKG çizgisi asistoli gibi okunur). Akış durursa iz donar,
    soluklaşır ve "akış durdu · N sn" der; 10 saniye sonra silinir — eski dalga hiçbir zaman
    güncel gibi gösterilmez. Hiçbir şey saklanmaz: hub belleğinde 20 sn, API'de 250 ms,
    tarayıcıda 20 sn. Panel varsayılan olarak kapalıdır (API `.env`'de `INFINITY_WAVES=on`),
    şeridin açık olmasını ve hub'ın dalga yolunu taşıyan sürümünü (R5) ister; kapatmak için
    bayrak kaldırılır. Koğuşta ekranla örnek düzeyinde karşılaştırma bitmeden kanıt düzeyi
    "yapısal"dır.
```

- [ ] **Step 5: three code comments that said "no waveform".**

`homunculus-engine/src/homunculus/edge/infinity_live.py`: replace
```python
No patient association, clinical ingest, alarm action or waveform interpretation. The alarm
limits carried in the records are the device's own settings, reported as context, not acted on.
```
with
```python
No patient association, clinical ingest, alarm action or waveform interpretation (the wave
blocks are decoded for display only, in infinity_waves.py). The alarm limits carried in the
records are the device's own settings, reported as context, not acted on.
```

`homunculus-engine/src/homunculus/edge/infinity_research.py`: replace
```python
                              "No waveform decoding or clinical model integration is performed."]}
```
with
```python
                              "No waveform decoding (wave blocks are decoded for display only, in "
                              "infinity_waves.py) or clinical model integration is performed."]}
```

`dashboard/src/live/i18n/strings/patient.js`: replace
```js
// hospital or protocol number, no simulated monitor waveform, no deterioration criteria of its
// own, no nursing-risk scores, no synthetic 24-hour curves.
```
with
```js
// hospital or protocol number, no simulated monitor waveform (real decoded waves are a separate,
// unvalidated panel: screens/common/WavePanel.jsx), no deterioration criteria of its own, no
// nursing-risk scores, no synthetic 24-hour curves.
```

- [ ] **Step 6: Check nothing else moved.**

Run: `cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_live.py tests/test_infinity_research.py` and `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/i18n`
Expected: all pass. And `git diff --stat` lists exactly the eleven files of this task.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/inf-dalga && git add docs/INFINITY-PARAMETER-RECORDS.md docs/INFINITY-BED09-DECODER.md docs/INFINITY-CONTINUOUS-RESEARCH.md docs/INFINITY-RESEARCH-REPLAY.md docs/INFINITY-100-DEVICE-ARCHITECTURE.md docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md docs/homunculus-rehber-TR.md homunculus-engine/src/homunculus/edge/infinity_live.py homunculus-engine/src/homunculus/edge/infinity_research.py dashboard/src/live/i18n/strings/patient.js && git commit -m "docs(infinity): the waves are decoded and drawn — the statements that said otherwise, and the ward's words for the panel" -m "Spec §12's list: the 522/468/346-byte 'waveform packets' were never a separate format, the bed label is absent only from the 2050 stream, G2's D5 and Aşama A's 'not a monitor' are superseded for a separate panel, the 100-device requirement 8 is answered for structure. The Turkish guide gets the panel in plain words — where it shows, what the stamp says, that it makes no sound and no number, that ECG is 'EKG' without a lead name, what 'sinyal yok' and 'akış durdu' mean, that nothing is kept, and that it is off unless INFINITY_WAVES=on. No patient value anywhere." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: The two screen lines — **run only after Aşama B is on `main`**

Lane A (Aşama B, `feat/infinity-asama-b`) is editing `PatientScreen.jsx`, `DevicesScreen.jsx` and their tests, `MonitorStrip.jsx`, `shadowStore.js`, `backendApi.js` and `app.py`'s shadow routes. **Do not start this task until the lead says Aşama B is merged into `main`.** Then merge `main` here first and insert.

**Files:**
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (`fakeApi`: `request`)
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx`, `PatientScreen.test.jsx`
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.jsx`, `DevicesScreen.test.jsx`
- Modify: `dashboard/src/reachable.test.js` (remove `PENDING`)

- [ ] **Step 1: Merge `main`.**

```bash
cd /c/tmp/inf-dalga && git fetch origin && git merge --no-edit origin/main
```
(If Aşama B is merged into the local `main` only: `git merge --no-edit main`.) Resolve a conflict only after reading both sides; this branch touched `app.py` in one hunk (beside the research router), `test_tenant_isolation.py` (`CALLER_ELSEWHERE`) and `test_route_inventory.py`, `catalog.js` (a blank-line-separated entry), `testTokens.testutil.js` not yet. Then confirm, by reading `app.py`, that `shadow_board(authorization)` still exists under that name and signature (the Task 7 lambda calls it), and that `stripOn` (`MonitorStrip.jsx`) accepts the stage `rules` (Aşama B's Task 10).

- [ ] **Step 2: Both suites at the merge.** Run Task 0's Steps 3 and 4. Expected: green, both. If `test_tenant_isolation.py` fails, it is a merge of the `UNSCOPED_BY_DESIGN` set: keep Aşama B's new board routes and this branch's `CALLER_ELSEWHERE`. If `test_infinity_waves_api.py` fails at the gates, `shadow_board` changed: follow it in the Task 7 hunk, and nowhere else.

- [ ] **Step 3: The fake API answers the waves route "off" unless a test says otherwise.** In `dashboard/src/live/session/testTokens.testutil.js`, replace

```js
    shadowBoard: vi.fn(),
```

with

```js
    shadowBoard: vi.fn(),
    // Lane C (dalga): the waveform panel reads GET /infinity-waves/{source} through the client's
    // `request` (data/waveStore.js). Off (409) unless a test answers it.
    request: vi.fn(async () => { throw Object.assign(new Error("waves off"), { status: 409 }); }),
```

- [ ] **Step 4: Write the failing screen tests.** In `dashboard/src/live/screens/patient/PatientScreen.test.jsx`, after the line `import { PatientScreen } from "./PatientScreen.jsx";` add

```js
import { answer as waveAnswer, bed4 } from "../../data/waves.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
```

and append at the end of the file:

```js

// Lane C (dalga): the live waveform panel, under the strip, for a patient linked to ONE monitor and
// for no one else (spec §5.5). Synthetic blocks only (data/waves.testutil.js).
describe("the waveform panel on the patient screen", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { vi.restoreAllMocks(); });

  async function withWaves(answer, waves) {
    const mounted = await open({ payload: board([entry("S-001", [], FULL)]) });
    mounted.api.shadowBoard.mockResolvedValue(answer);
    if (waves) mounted.api.request.mockResolvedValue(waves);
    await act(async () => { mounted.shadow.start(["board.view", "alerts.ack"]); await settle(); });
    await act(async () => { await settle(); });
    return mounted;
  }
  const linked = (link = "one", patientId = "S-001") => strip({
    beds: [monitorBed("REA-01 · 2", [monitorParam("hr", 72)], { link, patient_id: patientId })],
  });
  const PANEL = `REA-01 · 2 · ${DICTIONARIES.az["waves.title"]}`;

  it("draws it right under the strip for a patient linked to one monitor, asking for that monitor", async () => {
    const mounted = await withWaves(linked(), waveAnswer(bed4(), { device_id: "192.0.2.2" }));
    const panel = screen.getByRole("region", { name: PANEL });
    expect(panel).toHaveTextContent(DICTIONARIES.az["waves.stamp"]);
    const stripRegion = screen.getByRole("region", { name: "Monitor · təsdiqlənməmiş" });
    expect(stripRegion.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mounted.api.request).toHaveBeenCalledWith("/infinity-waves/192.0.2.2?since=0", { timeoutMs: 4000 });
  });

  it("draws none for a patient without exactly one monitor, and asks for no waves", async () => {
    for (const answer of [linked("none", null), linked("ambiguous", null), linked("one", "S-999")]) {
      const mounted = await withWaves(answer, waveAnswer());
      expect(document.querySelector("[data-wave-panel]"), answer.beds[0].link).toBeNull();
      expect(mounted.api.request).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("draws none when waves are off here (the API's 409)", async () => {
    const mounted = await withWaves(linked());
    expect(mounted.api.request).toHaveBeenCalled();
    expect(document.querySelector("[data-wave-panel]")).toBeNull();
  });
});
```

In `dashboard/src/live/screens/devices/DevicesScreen.test.jsx`, after the line `import { DevicesScreen } from "./DevicesScreen.jsx";` add

```js
import { fireEvent } from "@testing-library/react";
import { answer as waveAnswer, bed4 } from "../../data/waves.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
```

and append at the end of the file:

```js

// Lane C (dalga): each device's waves wait behind a button — a list of monitors polls none of them
// by itself. Synthetic blocks only (data/waves.testutil.js).
describe("the waveform behind each device", () => {
  it("offers each device's waves behind a button, and asks for one only when it is opened", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const mounted = await open(WARD);
    const buttons = screen.getAllByRole("button", { name: DICTIONARIES.az["waves.show"] });
    expect(buttons).toHaveLength(4);
    expect(mounted.api.request).not.toHaveBeenCalled();
    mounted.api.request.mockResolvedValue(waveAnswer(bed4(), { device_id: "192.0.2.2" }));
    await act(async () => { fireEvent.click(buttons[0]); await settle(); });
    expect(mounted.api.request).toHaveBeenCalledTimes(1);
    expect(mounted.api.request).toHaveBeenCalledWith("/infinity-waves/192.0.2.2?since=0", { timeoutMs: 4000 });
    const panel = screen.getByRole("region", { name: `REA-01 · 2 · ${DICTIONARIES.az["waves.title"]}` });
    expect(panel).toHaveTextContent(DICTIONARIES.az["waves.stamp"]);
  });
});
```

These lean on the files' own helpers (`open`, `board`, `entry`, `FULL`, `strip`, `monitorBed`, `monitorParam`, `settle`, `WARD`) as they stand at `302ac83`; if Aşama B renamed one, use its new name — the assertions stay. `WARD`'s count of devices (`4`) is the fixture's; if Aşama B changed it, assert its new count.

- [ ] **Step 5: Run them to see them fail.**

Run: `cd /c/tmp/inf-dalga/dashboard && npx vitest run src/live/screens/patient/PatientScreen.test.jsx src/live/screens/devices/DevicesScreen.test.jsx`
Expected: the two "draws it"/"offers" tests fail (no panel region, no button); the "draws none" tests pass.

- [ ] **Step 6: The two insertions.** In `dashboard/src/live/screens/patient/PatientScreen.jsx`, after the line `import { MonitorStrip, readUnknown, stripOn } from "../common/MonitorStrip.jsx";` add

```js
import { WavePanel } from "../common/WavePanel.jsx";
```

and directly after the strip's block — the `{monitor ? ( <MonitorStrip entry={monitor} … /> ) : null}` expression, whatever its props are after the merge — add one line:

```jsx
          {monitor ? <WavePanel source={monitor.source} title={monitor.bed_label} className="bg-card" /> : null}
```

In `dashboard/src/live/screens/devices/DevicesScreen.jsx`, after the line `import { maxAgeOf, reasonKey } from "../common/monitor.js";` add

```js
import { WavePanel } from "../common/WavePanel.jsx";
```

and in `Device`, between the strip's closing `</MonitorStrip>` and the `</li>` that closes the device, add one line:

```jsx
      <WavePanel source={card.source} title={title} collapsible className="mx-2.5 mb-2" />
```

- [ ] **Step 7: The page now reaches the wave modules: `PENDING` goes.** Run `npx vitest run src/reachable.test.js` — `lets a pending module stay pending only while no screen reaches it` fails, listing the five modules. In `dashboard/src/reachable.test.js`, delete the comment and the `PENDING` set added in Task 8 (the 11 lines after `const rel = …`), replace

```js
    expect(sources(SRC).filter((file) => !reached.has(file) && !PENDING.has(rel(file))).map(rel).sort()).toEqual([]);
  });

  it("lets a pending module stay pending only while no screen reaches it", () => {
    expect([...reached].map(rel).filter((name) => PENDING.has(name))).toEqual([]);
  });
```

with

```js
    expect(sources(SRC).filter((file) => !reached.has(file)).map(rel).sort()).toEqual([]);
  });
```

so that `git diff main -- dashboard/src/reachable.test.js` is empty.

- [ ] **Step 8: Run the screens, the reachability and the boundaries.**

Run: `npx vitest run src/live/screens/patient/PatientScreen.test.jsx src/live/screens/devices/DevicesScreen.test.jsx src/reachable.test.js src/live/boundaries.test.js src/live/waveBoundaries.test.js`
Expected: all pass. (`boundaries.test.js` lists `screens/devices/` as strip modules: the device screen importing the panel is a strip module importing a wave module, which no rule forbids; neither is reached from an alarm path.)

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/inf-dalga && git add dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.test.jsx dashboard/src/live/session/testTokens.testutil.js dashboard/src/reachable.test.js && git commit -m "feat(dashboard): the waveform panel under the strip — on the patient linked to one monitor, behind a button per device" -m "Two lines, after Aşama B is on main. The patient screen draws the panel right under the strip, and only for the patient the strip links to exactly one monitor (link one); no other patient gets one, nor a placeholder. The device screen offers each device's waves behind 'Dalga formunu göster', so a list of thirteen monitors polls none of them by itself. The test API answers the waves route 'off' unless a test says otherwise; reachable.test.js loses its pending list now that the page reaches the five wave modules." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Gates, the local synthetic walk, and what a deploy will need

**Files:** none changed (the walk's scratch lives outside the repository).

- [ ] **Step 1: Engine, whole** (≈ 3 min, foreground):

```bash
cd /c/tmp/inf-dalga/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 timeout 1200 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```
Expected: no failure; passed = Task 0's N + **108** (this plan's engine tests: 35 decoder/ring, 16 hub, 49 API, 7 replay, and 1 new nginx path case; Aşama B's own tests arrive with the merge); skipped = M. While this plan was written, the tree with Tasks 1–13 applied measured `2525 passed, 654 skipped` with the three release tests deselected (they need Task 1's commit), so `2528` with them.

- [ ] **Step 2: Dashboard, whole, and the build:**

```bash
cd /c/tmp/inf-dalga/dashboard && timeout 900 npx vitest run 2>&1 | tail -4 && timeout 600 npx vite build 2>&1 | grep -E "built in|precache"
```
Expected: no failure; files = F + 6, tests = T + 74 (20 store, 19 geometry, 5 words, 15 panel, 6 full screen, 5 boundaries, 3 patient screen, 1 device screen; reachable unchanged). While this plan was written: `97 passed (97)`, `2541 passed (2541)` with every task applied at `302ac83`; `✓ built`, `precache  20 entries`.

- [ ] **Step 3: The local synthetic walk** (spec §8 "Local replay"). The G1-15 scratch stack (`/c/tmp/g115plan/stack/`: `local.env`, `compose.g115.yml`, a synthetic `bed-mapping.json` that puts `YB^1^1` on `yb-01`) plus this branch's images, and the fake hub of Task 13 on this machine. Synthetic accounts and monitors only. **Not done while writing this plan** (Docker and `host.docker.internal` were not exercised): if the API cannot reach the hub (`/infinity-waves/…` answers `503 hub_unreachable`), restart the fake hub with `--host 0.0.0.0` (synthetic data, random tokens, stop it after the walk).

```bash
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"
```
Expected: `no stack containers`. If a container is listed, **stop and ask** — it may be another session's.

Start the fake hub with the Bash tool's `run_in_background` (it runs until stopped):

```bash
cd /c/tmp/inf-dalga/homunculus-engine && PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe scripts/dev_waves_replay.py --folder /c/tmp/inf-dalga-stack
```
Expected in its output: `SYNTHETIC fake hub on https://127.0.0.1:8766 - three made-up monitors, no patient.` and uvicorn's `running on https://127.0.0.1:8766`.

```bash
grep -v '^INFINITY_' /c/tmp/g115plan/stack/local.env > /c/tmp/inf-dalga-stack/local.env && cat /c/tmp/inf-dalga-stack/api.env >> /c/tmp/inf-dalga-stack/local.env
cd /c/tmp/inf-dalga
C="docker compose -p dalga -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml -f /c/tmp/inf-dalga-stack/compose.dalga.yml --env-file /c/tmp/inf-dalga-stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
```
Expected: `Image dalga-api Built`, `precache  20 entries …`, `Image dalga-web Built`; three containers started. Re-run `docker inspect -f '{{.State.Health.Status}}' homunculus-api` until `healthy` (≈ 30–60 s; do not loop on `sleep`), then `curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:18080/health` → `http 200`.

```bash
docker exec -e TEST_USER_PASSWORD='Dalga-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py 2>&1 | grep -E "test\.(hemsire|biyomedikal)"
cd /c/tmp/inf-dalga/homunculus-engine && TT=$(grep '^TENANT_TOKEN=' /c/tmp/inf-dalga-stack/local.env | cut -d= -f2-) && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe scripts/set_identity.py --patient-id S-DALGA-1 --family SENTETIK --given DALGA --bed "YB^1^1" --cloud-url http://127.0.0.1:18080 --token "$TT" | tail -1
TT=$(grep '^TENANT_TOKEN=' /c/tmp/inf-dalga-stack/local.env | cut -d= -f2-) && curl -s -H "Authorization: Bearer $TT" "http://127.0.0.1:18080/infinity-waves/192.0.2.22?since=0" | /c/tmp/f7-py312/venv/Scripts/python.exe -c "import json,sys; d=json.load(sys.stdin); print(d['schema'], sorted({b['id'] for b in d['blocks']}), d['waves']['3585']['label'])"
```
Expected: the two account lines; the identity accepted; `homunculus.infinity-waves.v1 [258, 259, 260, 513, 3585, 6422] P1`. The token is read inside each command and printed nowhere.

The walk in a browser (a person, or an agent driving one) at `http://127.0.0.1:18080`, Settings › language **Türkçe**:
1. **Device screen.** Sign in as `test.biyomedikal@homunculus.health` / `Dalga-Sentetik-Parola-1` → Monitörler. Three strips (`YB-1`, `YB-2`, `YB-3`), each with **Dalga formunu göster**; the network tab shows **no** `/infinity-waves` request yet. Open YB-1: the stamp "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür", "≈ 2 sn gecikmeli", rows **EKG · derivasyon adı doğrulanmadı · yapısal**, **ART · mmHg · ölçek ekranla doğrulandı**, **Pleth · göreli**, **RESP · göreli**, scrolling right to left, about one request per 750 ms. YB-2: **EKG** (drawn from `0x0102`), **P1**, **Pleth**, **RESP** — no "ART", no "II" anywhere. YB-3: EKG says **sinyal yok** and draws no line; RESP scrolls. **Acceptance: all four rows draw from a synthetic stream.**
2. **Full screen.** ⤢ on YB-1: black, the stamp large, the four rows tall, the strip's numbers beside them; Esc closes and the focus is back on ⤢; open again and close with ×.
3. **Patient screen.** Sign out; sign in as `test.hemsire@homunculus.health` → Yataklar → **SENTETIK DALGA** (`S-DALGA-1`): the strip, and directly under it the panel, open by itself. No other patient shows a panel.
4. **Stall.** Stop the fake hub (the background task). Within ≈ 3.5–4 s every row freezes, fades and says **akış durdu · N sn** (N counting up); the panel's note becomes **Dalga akışı yok**; ≈ 10 s after the stop each row says **akış durdu · N sn · iz kaldırıldı** and is blank. (R6: 2 s behind the monitor + 1.5 s grace.)
5. **No sound, no number:** nothing audible at any point; the rows print words only. At 390 px wide (devtools device toolbar) and at 1440 px there is no horizontal page scroll. Switch the language to az, ru, en: no raw `waves.…` key; az says "kanalda dalğa yoxdur", never "siqnal yoxdur".

Tear down: `$C down -v` (with `C` as above), stop the fake hub if still running, `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`; delete `/c/tmp/inf-dalga-stack` (synthetic scratch). Nothing to commit; record the outcome for the lead.

- [ ] **Step 4: Acceptance checklist (spec §8), for the lead.**

| Item | Where | State after this plan |
|---|---|---|
| Engine and dashboard suites green; build green | Steps 1–2 | done here |
| A fake hub fed by a synthetic stream draws all four rows | Step 3 (1) | done here (local) |
| A bed's panel scrolls smoothly for 10 minutes | VM, flag on | **deploy** |
| Hub CPU within the existing ceiling (README ≈ 43 % at 13 beds), measured before and after | VM; `/v1/status` `timings` `waves_ms`, `waves_read_ms` | **deploy** |
| API latency for `/infinity-waves` p95 < 150 ms | VM | **deploy** |
| Stopping the worker shows "akış durdu" within ≈ 3.5–4 s and clears within 10 s of the data's end | VM (Step 3 (4) locally) | local done; VM at deploy |
| The ward check (§9) recorded; evidence stays "yapısal" until V1 passes | the owner's film; the lead | open (V1, V3 open; V2, V4, V5 numbers done per `302ac83`) |

- [ ] **Step 5: What a deploy will need** (the owner pastes the blocks; one VM deploy at a time; nothing here deploys):
1. **Hub R5.** `python deploy/infinity/build_transport_release.py --output <a folder outside the repo> --commit <the merge commit>` → a new `transport-<hash>` whose `SHA256SUMS` lists `app/src/homunculus/edge/infinity_waves.py`; on the hub, a new release directory checked with `sha256sum -c SHA256SUMS` and a new drop-in (after 94) pointing `ExecStart` at it with **the same arguments as today** (`--capture-payload --unverified-live-research` included — that is what turns the decoding on). The journal log shows `Waveform blocks decoded for display only (unvalidated; the last 20 s in memory).`; `/v1/status` shows `waves_ms`.
2. **API and web images** from the merge commit (the API image now installs `httpx` from `constraints.txt`).
3. **`INFINITY_WAVES=on`** in the API's `.env` (the hub settings and `INFINITY_CLINICAL_STAGE` already set), applied with `docker compose up -d --no-build api`.
4. **Order:** either. An API before R5 answers "Dalga akışı yok" (hub 404 → `hub_no_waves`); a hub at R5 before the API flag changes nothing visible.
5. **Rollback:** the flag off (the panel disappears; the strip stays); or the previous drop-in (hub back to R4); or the previous image tags.
6. **Review before deploy:** Lane A reviews the `edge/` and hub hunks and the `app.py` hunk (spec §10).

---

## Self-review (done while writing)

- **Spec coverage.** §3.1 → Tasks 1–4 (decoder rules, ring, freshness, cursor, 10 s cap, ≤ 16 devices, both hooks, 409/404/400, multi-device shape, release `EDGE`). §3.2 → Tasks 5, 7 (flag, settings reuse, gates through `shadow_board`, 404 indistinguishable, keep-alive client, 2 s, 1 MiB, no redirects/proxy, CA pinning, 250 ms single-flight cache, allow-list, catalogue, nothing written) and Task 6 (nginx, its test, Vite). §3.3 → Tasks 8–12, 15 (store, panel, geometry, rows in fixed order, placements, W5 full screen, boundary rule, four languages). §4 → Task 9 (+ the BED08 correction). §5.1–5.8 → stamp (Tasks 10, 11), no flat line (9, 11), stalls (9, 11), no numbers (11, 12), binding only via `link === "one"` (15), no storage (8, 12; API 7), flag off by default (5, 7), no sound (11, 12). §5.9 and §11 → phase 2, out. §7 tests → every task's tests. §8 → Task 16. §10 → the lane rules (Ground rules, Task 15, R18). §12 → Task 14.
- **Placeholders.** None: every code step carries the code that was run; every command its expected output.
- **Names across tasks.** `WAVES`, `parse_waves`, `WaveBuffer.knows/consume/since`, `iso_z`, `MAX_QUERY_DEVICES`, `SCHEMA` (edge) → used by the hub (Task 4) and the API (Task 5). `HubWaves.window`, `Outcome`, `checked`, `answer`, `WaveSettings`, `wave_settings_from_env`, `register` (API). `createWaveStore`, `waveStoreFor`, `wavesPath`, `WAVE_STATUS`, `WAVE_BLOCK_S` (store) → used by geometry and the panel. `rowsOf`, `rowView`, `headAt`, `nextAnchor` (geometry) → `WaveRows`. `WavePanel`, `WaveFullscreen`, `WaveRows`, `cardOf`. All as defined.
