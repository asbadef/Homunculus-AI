# Infinity · Aşama 0a — the research transport catches up: measure first, then fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The research transport from the 13 Dräger Infinity monitors to the hub delivers within seconds again, as it did in late September. Today it is ~15 minutes behind: the hub's live research view has accepted no packet since 05.10, and all 13 devices read `stale`. The plan finds out, on the real system, where each batch's ~0.5 s goes before changing anything. Then it fixes what the numbers point at. Read-only evidence of 14.10 already points at one module: the journal scans its whole queue on every batch, on both machines. The plan also closes the inventory-rename wedge of 22.09 (K1, plus a quarantine for a batch the hub will never take) and renews the hub's TLS certificate before it expires on 20.12.2026. **There is no clinical effect.** Clinical forwarding stays off everywhere, and nothing in this plan writes to `/ingest`, the engine, the audit or the board.

**Architecture:** No new service, no new endpoint, no new dependency. One new module, `edge/infinity_timing.py`, holds bounded integer histograms. The journal, the sender, the forwarding loop and the hub handler record into them. The worker sends its timings in its heartbeat, and the hub shows its own and the worker's in `/v1/status`. That is the measurement (Task 1). The expected fix is inside `Journal`: an index on `created` and running totals of rows and bytes, so no operation scans the queue (Task 4). With it, the worker lets a drained queue gather for 0.25 s (Task 5). The hub then recognises a monitor by its address, not by the name the event carries (K1). The worker sets aside a batch the hub refuses for good (400/409/413) instead of retrying it forever (Task 6). Code reaches the VMs as a **release built from a commit** (`deploy/infinity/build_transport_release.py`): content-named, with `SHA256SUMS`, installed in the house layout (a new immutable directory under `/opt/homunculus-infinity/` and a new, higher-numbered systemd drop-in). Acceptance is a read-only checker (`deploy/infinity/transport_check.py`), piped over SSH to the hub's own `python3`, so nothing is copied onto the VM.

**Tech Stack:** Python 3.12, standard library plus what the pilot venv already has: FastAPI 0.139.2, uvicorn 0.51.0, cryptography 50.0.0 (read on the hub 14.10). The VMs run Python 3.12.3 with SQLite 3.45.1, so `DELETE … RETURNING` is available (it needs ≥ 3.35). Locally: `/c/tmp/f7-py312/venv/Scripts/python.exe` (3.12.13, SQLite 3.53.1), pytest. **No package added or removed.**

**Inputs:**
- **The design:** `/c/tmp/homunculus-plans/2026-10-14-infinity-klinik-pano-tasarim.md`, §0 (finding 2), §1, §2, §5 (Aşama 0) and §7 (phase 0a). Two of its statements are superseded here, both by the user's decision of 14.10 or by measurement:
  - §5 and §7 say the fix "is measured locally under a synthetic 13-device load". **There is no synthetic load** (user decision 14.10). Verification is on the 13 real devices, with the user, after deploy. Unit tests keep the repo's small in-code fixtures.
  - §1 says the worker was unreachable with our key. On 14.10 the key works on both VMs; the worker needs a password for `sudo`.
- **Code:** `feat/canli-tasarim` @ `52656da`, worktree `/c/tmp/homunculus-g1` (read it, never commit there). Paths below are under `homunculus-engine/src/homunculus/` unless they start with `homunculus-engine/`, `deploy/` or `docs/`.
- **Deploy facts:** `docs/INFINITY-PARAMETER-RECORDS.md` §"Yatak adları ve bir işletim tuzağı" (the 22.09 wedge, lines 188–210), `deploy/infinity/README.md`, and the drop-ins read on both VMs on 14.10 (below).
- **House style:** `/c/tmp/homunculus-plans/2026-10-13-g1-16-eski-modlari-kaldir.md`.

---

## Read this before Task 1

### The base

`feat/canli-tasarim` at `52656da`. The transport's own suites, measured 14.10 in `/c/tmp/homunculus-g1`:

| File | Tests |
|---|---|
| `tests/test_infinity_transport.py` | 35 |
| `tests/test_infinity_live.py` | 15 |
| `tests/test_infinity_records.py` | 14 |
| `tests/test_infinity_research_upgrade.py` | 4 |
| `tests/test_infinity_pilot_activation.py` | 9 |
| `tests/test_infinity_decoder.py` | 21 (imports `infinity_stream`) |
| `tests/test_infinity_bed09_decoder_install.py` | 3 |
| `tests/test_infinity_bed09_switch.py` | 5 |
| **The gate set at base** | **106** |

`test_infinity_transport.py::test_dashboard_renders_hundred_devices_and_clears_on_logout` needs `dashboard/node_modules/jsdom`. In a fresh worktree without the `node_modules` junction it **skips** (105 passed, 1 skipped). Task 0 makes the junction, as G1-16 did.

**Never run `tests/test_infinity_vm_pilot.py`**, alone or in a bare `pytest tests/`: under contention it hangs (seven hours once). Every gate below names its files.

### What runs on the VMs today, and whether it is the repo's code

Read on 14.10 between 07:57 and ~09:00 UTC, with `sha256sum` over SSH (`sudo` on the hub, which still has passwordless sudo, temporarily; the worker needs a password, so its release was not read).

| | Hub `172.100.101.72` | Worker `172.100.101.74` |
|---|---|---|
| Unit | `homunculus-infinity-pilot-hub` | `homunculus-infinity-pilot-worker` |
| Newest drop-in | `70-records.conf` (others: 30, 40, 50, 60) | `50-membership-refresh.conf` (others: 30, 40) |
| Release | `/opt/homunculus-infinity/records-30cfb790074af999` | `/opt/homunculus-infinity/membership-56e8e43eb08a022c` |
| Journal limits | 256 MiB · 200,000 rows · 900 s | 256 MiB · 200,000 rows · 900 s |
| Flags | `--capture-payload --unverified-live-research` | `--capture-payload` |
| Running since | 05.10 06:11 UTC (VM reboot) | 14.10 07:48 UTC (VM reboot) |

**The hub runs exactly the repo's code.** All eight code files of `records-30cfb790074af999` hash the same as the `52656da` git blobs: the runner, `infinity_collector`, `_decoder`, `_hub`, `_journal`, `_live`, `_records` and `_stream`. For example, `infinity_journal.py` is `482158a1…` and `infinity_hub.py` is `851ef16a…`. It also has `research-profile.json`, which the current runner ignores.

**The worker's release, read from the hub's copy of the same hash-named directory, differs from HEAD in two files.** Neither is a code path the worker runs:
- `run_infinity_transport.py` (`318d7cd5…` against HEAD's `176a33d4…`) differs only in the hub-only `--unverified-live-research` branch: it still takes a profile path.
- `infinity_live.py` (`5bec2c15…`) is hub-only.
- `infinity_collector`, `_journal`, `_stream` and `_hub` are HEAD's (`66226f6c…`, `482158a1…`, `989414ae…`, `851ef16a…`).
- There is no `infinity_records.py`, and the worker does not need it.

The worker's own copy could not be read without its password. The user's first worker session (deploy block **W-1**, step 0) prints its hashes so the match is confirmed rather than assumed.

### What was measured on 14.10 (read-only)

| Measure | Hub | Worker |
|---|---|---|
| Service CPU, long run | 94 h in 218 h = **43 %** of a core (05.10–14.10) | 209 h in 218 h = **96 %** of a core (05.10–14.10) |
| CPU now | 45.5 % (10 s), 49.8 % (61 s); all on the main thread | main (collector) thread **79 %**, forwarder 14 % (10 s): the GIL's one core |
| Thread states (200 samples / 10 s) | — | collector R 74 %, D 7 %, S 20 %; forwarder R 14 %, D 6 %, **S 81 %** (waiting) |
| Reads from the page cache | **`rchar` 388.8 MB/s in 94,924 `read` syscalls/s** (4.1 KB each: SQLite pages); `read_bytes` 0 | not readable without sudo |
| Writes | `write_bytes` 1.35 MB/s, 643 write syscalls/s; disk 160 writes/s, busy **~7 %**, ~4.7 ms per write | disk 275 writes/s, busy **~10 %**, ~2.6 ms per write |
| Journal | `archive.sqlite` 220 MB on disk; 48,064 rows, 77.4 MB encrypted bodies (~1.6 KB per row) | outbox 52,289–53,687 rows, 84 MB, oldest **872–888 s** of a 900 s retention |
| Rates | archive accepted 62–65 /s | outbox accepted 50.5 /s; expired 0–5.4 /s (it oscillates at the cap); `forward_errors` 0 /s now, 11,735 cumulative |
| Multicast | — | kernel `InDatagrams` 67 /s, `RcvbufErrors` 0, socket drops 0: the socket keeps up |
| `/v1/status` | 4.04 s once, 0.29 s once | — |
| Live view (61 s window) | **0** accepted, 3,808 old or duplicate; 0/13 devices fresh; every packet 873–888 s old | — |
| Clock | NTP synchronised (timesyncd) | NTP synchronised |
| TLS | leaf ends **20.12.2026 10:52 UTC**; private CA ends 21.09.2027 | trusts the CA, not the leaf |

The brief's own numbers fit: a TLS handshake takes ~10 ms worker to hub, a full request ~12 ms, keep-alive ~1.5 ms; ~57 events/s at 32 per batch is ~1.8 batches/s, ~0.5 s per sequential cycle. On 14.10 at 08:00 it was 65 /s, about 2 batches/s.

### The trap: why it never recovers on its own

Every journal operation costs time in proportion to the rows in the queue (next section). So the system has **two stable states**:
- **Healthy.** The outbox is nearly empty, the worker's scans cost nothing, and it delivers within a second. From 25.09 07:04 to 30.09 06:46 the worker used **4.7 h CPU in ~120 h (4 %)**.
- **Jammed.** The outbox sits at the 900 s cap, every scan reads ~85 MB, delivery falls below production, and expiry trims the excess. From 05.10 06:11 to 14.10 07:47 the worker used **96 %**.

The hub VM's boot list shows how it moved from the first state to the second. The hub was **down from 02.10 11:10 to 03.10 06:35 (~19 h)**. Meanwhile the outbox filled to its cap. The worker run spanning that outage averaged 49 %: about 4 % before it and ~96 % after. Neither the reboots of 05.10 nor today's worker reboot cleared the persistent outbox.

**The hub pays even when the pipeline is healthy.** Its archive is always full (900 s × ~65/s ≈ 58,000 rows), and each `/v1/packets` request scans it twice. While the worker was healthy and sent many small batches, the hub used **84 % of a core** (25.09 06:55 → 01.10 06:43: 19 h 37 m in 23.4 h, then 100.7 h in 120.4 h). It shares 2 vCPUs with the clinical API. So **unjamming the worker alone would double the hub's CPU.** The fix must land on the hub first, and "hub CPU not raised" is a real acceptance criterion, not a formality.

### The user's rules for this stage

- **No synthetic load, fake devices or fake ward in the verification** (14.10). Acceptance is on the 13 real monitors, with the user, after deploy. Unit tests use the repo's existing in-code fixtures (`Inventory.parse` with documentation addresses, `b"SYNTHETIC-NOT-A-PATIENT-…"` payloads). No captured data enters the repo.
- **The worker's `sudo` needs a password, so the user runs the worker's commands.** The agent stages files in `/home/sysadmin` (no sudo needed) and hands the user a paste-ready block with the values filled in. The hub's passwordless sudo is temporary. The agent uses it for the hub blocks while it exists; otherwise the user runs them too.
- **No device id renames in this stage.** A mixed queue (old and new names) wedges the current code, 22.09. No block in this plan touches `inventory.json`.
- **Never print a token.** The checker reads the viewer token inside Python and prints only counters.
- **Hub first, worker second**, for every deploy.

### How this plan was checked, so you know what to trust

**Run, not reasoned. Every code block below was developed test-first and replayed.** The work was done on copies in the session's scratchpad, **outside the repository**. The worktree and the repo were not modified (`git status` clean after every run).
- **The tests:** each new test was seen red before its code: Task 1's file red with no module, then 10 failed and 3 passed with the module alone. Task 4: 2 failed, 1 passed (append cost 23 units at 20 rows and 2,408 at 3,000). Task 5: 2 failed (`[3, 1, 1]` against `[3, 0.25, 1, 0.25, 1, 0.25]`). Task 6 failed to collect without `Refused`. Tasks 2 and 7 failed to collect without their modules. The heartbeat test was also run against the old heartbeat order, and fails there.
- **The gate set:** in a scratch git repo laid out like this one, at the end of Task 7 it gave **153 passed, 1 skipped**, which is 154. The skip is the jsdom test, which runs in the real repo.
- **The text:** a script replayed the plan's own text. Starting from **HEAD's bytes** (`git show 52656da:…`), it applied every replace pair and whole file below in task order. At every stage (Task 1, 4, 5, 6) the result equals byte-for-byte the code that passed.
- **The checker, on the real hub:** it ran read-only on 14.10 in all three modes.
  - `--window 60` printed the baseline of Task 3: RED on every live criterion, as expected.
  - `--since`, fed a saved `OZET` line through the exact quoting of Kabul command 3, judged a 21 s window.
  - `--breakdown` printed `ROW: ?`, because there are no timings yet.
- **The deploy blocks:** dry-run in Git Bash with the real R-style tarball and the real `50-membership-refresh.conf` text. Paths pointed into a scratch folder, and `sudo` and `systemctl` were stubbed.
  - The new drop-in differs only in the release path (`AYNI` printed).
  - A tampered file fails `sha256sum -c`.
  - A second run stops at the existing release.
  - Not run: a real `systemctl` and real ownership changes.

**What was NOT run:**
- No deploy. No release was installed on either VM, and no service was restarted.
- The conditional fixes of Task 8 (F3–F7) are specified, with their tests, but not replayed.
- The documents of Task 11.
- **The numbers that decide the fix do not exist yet.** They come from Task 3. "Expected" in the decision table is a prediction from the read-only evidence, and Task 3 can overturn it.

---

## Where the ~0.5 s per batch goes — the likely cost centres

Read from the code at `52656da`, ranked by the 14.10 evidence. Lines are HEAD's.

| # | Cost centre | Where | Evidence | Expected share |
|---|---|---|---|---|
| 1 | **Expiry scans the whole events table.** `_expire` runs `DELETE FROM events WHERE created < ?`, and there is no index on `created` (the schema at `edge/infinity_journal.py:47-50` indexes only `seq` and `id`). `EXPLAIN QUERY PLAN` says `SCAN events`. It runs inside every `append` (`:85`), `pending` (`:115`) and `snapshot` (`:125`). | `edge/infinity_journal.py:75-78` | Hub: `rchar` 389 MB/s ≈ 2 batches/s × 2 scans × ~95 MB of table pages; 45 % CPU ≈ 0.22 s per batch | hub ≈ ½ of each handler |
| 2 | **The capacity check sums the whole table.** `SELECT COALESCE(SUM(size),0),COUNT(*) FROM events` (`SCAN events`), on every append. | `edge/infinity_journal.py:86` | same `rchar`: the second scan per batch | hub ≈ ½ of each handler |
| 3 | **On the worker, the collector does both scans every ≤0.1 s, under the forwarder's lock.** `save_batch` → `append` runs every 0.1 s or 32 datagrams. One `RLock` and the GIL are shared with the forwarder's `pending`, `ack` and heartbeat `snapshot` (two more scans every 5 s). | `edge/infinity_collector.py:184-192, 214, 221, 234-239`; `edge/infinity_journal.py:84, 114, 120, 124` | collector thread 79 % CPU, R 74 %; forwarder S 81 % (waiting on the lock, the GIL or the hub) | worker: `pending` + `ack` waits ≈ ½ of the cycle |
| 4 | **The hub's handler blocks its event loop.** `async def packets` calls the synchronous journal, so `/v1/status` and heartbeats queue behind a batch. | `edge/infinity_hub.py:106, 119` | `/v1/status` took 4.04 s once | latency, not throughput |
| 5 | Commits: `journal_mode=DELETE` + `synchronous=FULL`, so several fsyncs per commit. The worker commits ~10 appends/s plus 2 per batch. | `edge/infinity_journal.py:43-44` | disks only 7–10 % busy, 2.6–4.7 ms per write | small today; next in line once 1–3 are gone |
| 6 | A new TLS connection per request. | `edge/infinity_collector.py:41-54` | ~10 ms against ~1.5 ms keep-alive | ~2 % of a 0.5 s cycle |
| 7 | Request size and validation: 32 events with `payload_base64` (~75 KB); `canonical` + `json.loads`; base64 and SHA-256 per event. | `edge/infinity_stream.py:21-22, 92-117`; `edge/infinity_hub.py:86-95, 110-117` | — | 1–3 ms |
| 8 | Fernet per event, and a stats upsert per event. | `edge/infinity_journal.py:95, 102` | — | ~50 µs per event |
| 9 | The live view's decoding (`find_array` reads every offset of a payload). **Today it costs nothing, because every packet is old and is dropped before decoding** (`edge/infinity_live.py:64-66`). Once delivery is fresh, ~67 packets/s are decoded. | `edge/infinity_records.py:91-111` | — | desk estimate 1–4 % of a core **after** the fix. It counts against "hub CPU not raised". |

**The measurement settles it.** Task 1 times rows 1, 2, 3, 5, 6 and 7 separately on both sides, and the hub's delivery lag per packet.

---

## The decision table — Task 3 fills it

`transport_check.py --breakdown --window 300`, run twice in a row against the measurement release, prints the per-batch phases on both sides and a row. Five minutes at ~2 batches/s is ~600 batches. A window longer than ~9 minutes would outlive the agent's 10-minute foreground limit, so do not use one. Both windows must give the same row:

| Row | Condition (shares of one batch) | Fix | Deploy order |
|---|---|---|---|
| **A** (expected) | hub `expire_ms + capacity_ms` ≥ 40 % of `packets_ms`, **or** worker `pending_ms + ack_ms` ≥ 40 % of `flush_ms` with `expire_ms + capacity_ms` ≥ 40 % of all its journal time | **Task 4 (F1)** journal index + running totals, **and Task 5 (F2)** pacing | hub, then worker |
| **B** | not A; `commit_ms` ≥ 40 % (hub of `packets_ms`, or worker of its journal time with `pending + ack` ≥ 40 %) | **Task 8a (F3)** WAL + `synchronous=NORMAL` (**user decision 5**) and/or **8b (F4)** `MAX_BATCH` 128 | hub, then worker |
| **C** | `connect_ms` ≥ 25 % of `flush_ms` | **Task 8c (F5)** keep-alive | worker only |
| **D** | hub `body_ms + validate_ms` ≥ 40 % of `packets_ms` | **Task 8b (F4)** larger batches amortise per-request cost | hub, then worker flag |
| **E** | worker `post_ms − connect_ms` − hub `packets_ms` ≥ 40 % of `flush_ms` (time between the two: event-loop queueing, network) | **Task 8d (F7)** hub handler off the event loop, then C | hub only |
| **–** | batches, but nothing dominates | stop; measure two more 5-minute windows; do not guess | — |
| **?** | no batches in the window | the measurement release is not running on both sides; check `collector.heartbeat.timings` | — |

Rows are not exclusive: `ROW: A C` means both. **K1 + quarantine (Task 6) and the certificate (Task 7) do not depend on the table**, and they ship with the fix release whatever it says. After the fix release, `--breakdown` is run again: the expected answer is `-`, with the acceptance checker passing.

---

## Fix candidates and their trade-offs

| | What | Gains | Costs, risks | Schema / order | When |
|---|---|---|---|---|---|
| **F1** | `CREATE INDEX events_created ON events(created)`; rows and bytes kept as running totals, applied only on commit; `ack`/expiry via `DELETE … RETURNING size` | an operation costs the same whatever the queue's depth. In SQLite steps (÷10), at 20 rows → 3,000 rows: append 8 → 8, pending 11 → 15, ack 5 → 5, snapshot 4 → 4. Before the change: 23 → 2,408, 18 → 1,214, 12 → 1,204, 26 → 3,602. It also ends the bistability: a backlog drains instead of locking in | first open of an existing file builds the index: one scan, ~1–2 s on 220 MB. Running totals must never drift (a test recounts after each kind of change) | no wire change. Older code tolerates the index, so rollback by drop-in is safe. Hub, then worker | row A |
| **F2** | after a part batch (`< MAX_BATCH`), the loop waits `LINGER = 0.25` s; a full batch goes straight on | the hub gets ~4 requests/s of ~17 events instead of a stream of 1–3-event requests, each paying a TLS handshake (RSA-3072) and a commit | adds ≤ 0.25 s of delivery lag, inside the 3 s live window | worker only | with F1 |
| **F3** | `journal_mode=WAL`, `synchronous=NORMAL`, behind a runner flag | one sequential WAL append per commit instead of several fsyncs | a power loss can lose the last seconds of committed rows. On the hub these are acknowledged rows, so the hub's "ack only after a durable commit" weakens to "after a commit". Research data only | flag in a new drop-in; old code reopens in `DELETE` mode | row B, **user decision 5** |
| **F4** | the hub accepts up to 128 events (`MAX_ACCEPT`); the worker sends `--send-batch` (default 32) | fewer requests during a backlog | **an old hub refuses a 128-event batch with 400, and after Task 6 that batch is quarantined, i.e. lost.** The worker flag is raised only in a later drop-in, after the hub is confirmed on the new code | hub first, flag later | rows B, D |
| **F5** | one persistent HTTPS connection, reconnected after any error | ~8.5 ms per batch, and the hub's handshake CPU | a stale connection after a hub restart or the 5 s idle timeout must reconnect without a double send. A resend is harmless anyway: the hub acknowledges an id it already holds (`edge/infinity_journal.py:90-94`) | worker only | row C |
| **F6** | newest-first catch-up: `pending` takes the newest rows (each batch still sent oldest-first inside it) | a backlog shows live values at once instead of after the drain | the archive receives old rows late or never (they may expire). Each batch must stay ascending, or the live view drops the older half as `epoch <= last_epoch` (`edge/infinity_live.py:64`). **Is the archive still wanted for stale rows?** (user decision 4) | worker only | only if the post-fix drain takes > 10 min |
| **F7** | `await run_in_threadpool(journal.append, …)` in the hub handler | `/v1/status` and heartbeats stop queueing behind a batch | a second thread enters the journal (it has its own `RLock`, already shared by the hub's threadpool `status` handler) | hub only | row E |
| **P** | pipelining, or several batches in flight at once | none while a batch costs ~0.5 s of scanning on each side; after F1, one batch every ~50 ms is already ~10× the production rate | `pending` must skip rows in flight, and acks arrive out of order. The hub handler serialises on its event loop and the journal lock anyway, so concurrent requests would queue there | worker and hub | **rejected** (Decision 15) |
| **F8** | thinning: decode on the worker, forward records instead of packets | smaller archive and requests; decoding (1–4 % of a core) leaves the hub | event schema v2; a mixed queue of v1 and v2 events at deploy; the hub loses its raw archive. The hub's cost is the journal, not the decoding | hub first, plus a migration | **deferred to Aşama A** (the forwarder), unless the hub CPU fails acceptance after F1 |
| **K1** | the hub identifies a monitor by `(source, group, port)`; the name an event carries must only be well-formed; per-device counts use the hub's own name for the address | a rename can never wedge the queue again (test: the 22.09 scenario drains 50 of 50) | — | hub only | always (Task 6) |
| **Q** | `Refused` (400/409/413) → `journal.quarantine(ids)`: rows move to an encrypted `quarantine` table, expire with the queue, counted `quarantined` | poison cannot block the head of the queue | a batch refused because of a fixable config error is set aside, not retried. It stays visible: counter, and rows kept for the retention | new counter, so hub first. An old hub refuses that heartbeat, and after Task 1 delivery continues anyway | always (Task 6) |
| **Cert** | renew the leaf under the existing CA: new key, up to a day before the CA ends, backups kept | the hub keeps working after 20.12.2026 | — | hub only; the worker and the API trust the CA, not the leaf | always (Task 7, deployed in Task 9) |

---

## Size and estimate

**11 tasks after the baseline. Honestly 16–18 agent hours (2–2.5 developer-days) for the expected path, plus 0–4 hours if Task 3 selects a conditional fix. On the calendar: 3–4 days**, set by two worker sessions with the user and a 24-hour watch. The design's estimate for 0a was 3–5 developer-days. It lands lower because the cause is one module.

| Task | Agent hours | The user | What |
|---|---|---|---|
| 0 — Baseline | 0.25 | — | worktree, gate 106, VM status read |
| 1 — The measurement | 3.0 | — | TDD: timings on both sides; a refused heartbeat no longer stops delivery |
| 2 — Release builder and checker | 2.0 | — | TDD: a release is a commit's code; the read-only acceptance and breakdown |
| 3 — Deploy R1, measure, decide | 1.0 + ~15 min measuring | ~10 min worker session; tells biomedical first | the decision table's row |
| 4 — F1 journal | 1.5 | — | TDD; row A |
| 5 — F2 pacing | 0.5 | — | TDD; with F1 |
| 6 — K1 + quarantine | 2.5 | — | TDD |
| 7 — Certificate script | 1.5 | — | TDD |
| 8 — Conditional (F3–F7) | 0–4 | decisions 4–5 if selected | only what the table selects |
| 9 — Deploy R2 and the certificate | 1.5 | ~10 min worker session | hub, cert, worker; first acceptance |
| 10 — The 24-hour watch | 1.0 + 24 h | reads the result | acceptance over the day |
| 11 — Documents | 1.5 | — | README, the trap section, the Turkish guide |

**Counts** (the gate set: the 8 files above plus every new file):

| After | Files | Tests | Δ | What moved |
|---|---|---|---|---|
| Task 0 | 8 | **106** | — | — |
| Task 1 | 9 | 119 | +13 | `test_infinity_timing.py` **13** |
| Task 2 | 11 | 132 | +13 | `test_infinity_release.py` **3**, `test_infinity_check.py` **10** |
| Task 4 | 12 | 135 | +3 | `test_infinity_journal.py` **3** |
| Task 5 | 13 | 137 | +2 | `test_infinity_forwarding.py` **2** |
| Task 6 | 13 | 151 | +14 | `test_infinity_forwarding.py` 2 → **16** |
| Task 7 | 14 | **154** | +3 | `test_infinity_certificate.py` **3** |

---

## Decisions

Each carries the alternative it rejected.

1. **Measure before fixing, although the read-only evidence already names the scans.** The hub-side evidence is strong (`rchar`, CPU, the code). The worker side was seen only through thread CPU and states: without sudo, its I/O and its lock waits are invisible. A fix shipped on inference is a guess on the worker. Task 1 is small, ships with tests, and stays in every later release as the acceptance instrument. *Rejected:* deploying F1 straight away (one worker session fewer, but the plan would not know what it fixed); `py-spy` or `strace` on the VMs (installs a tool, or attaches ptrace to a process on the clinical VM).
2. **Timings are cumulative integer histograms in memory, carried by the heartbeat and `/v1/status`.** Two readings any distance apart give exact averages and tails, like the existing counters. A 24-hour watch is two readings, not a sampler left running. The names are a closed list on each side and the hub refuses any other, so no free text can ride a heartbeat. *Rejected:* persisting them in the `stats` table (a commit added to the path being measured); a log line per batch (two lines a second in the journal); a window maximum (readers would reset each other).
3. **A refused heartbeat no longer holds delivery up** (Task 1). Today the heartbeat is retried before every flush until it succeeds. So a worker deployed ahead of its hub, which refuses an unknown heartbeat key with 400, **stops delivering altogether** instead of merely going unseen. That made "hub first" a safety rule. After this change, getting the order wrong costs only visibility: the hub page shows the collector as unreachable, and packets still arrive. *Rejected:* relying on deploy order alone.
4. **F1 is an index on `created` and running totals, not expiry by `seq`.** The index is robust to a clock step (expiry by `seq` assumes `created` grows with `seq`). The totals change only on commit, so a rolled-back batch cannot skew them. *Rejected:* expiry by `seq`; an expiry thread (still a scan); shrinking the retention (fewer rows to scan, still a scan); setting the outbox aside as on 22.09 (it unjams the worker for now, but the hub would go back to ~84 % of a core, and the next outage jams it again).
5. **F2 is a 0.25 s pause after a part batch, the same pause an empty queue already took.** *Rejected:* a fixed send interval (it would slow a backlog's drain too); bigger batches as the pacing tool (they need the hub first and do not cut the request rate while batches are partial).
6. **K1 in 0a is the minimum: the hub stops treating the name as identity.** The event keeps `device_id` as a well-formed display name, the wire schema does not change, and the worker still checks its own names. *Rejected:* removing `device_id` from the event (schema v2 and a mixed queue at deploy); the device→bed table K2 now (Aşama A, in the API).
7. **Only 400, 409 and 413 are final; the whole batch is set aside, kept encrypted for the queue's retention, and counted.** 401, 5xx and 507 may pass on a retry and stay queued. *Rejected:* splitting a refused batch to find the one bad event (with K1 the known cause is gone, and it is more code on the delivery path); deleting refused rows (loses the evidence); setting aside on 5xx.
8. **A release is a commit's code, read from git, content-named, with `SHA256SUMS`.** The worktree checks out CRLF (measured: `infinity_hub.py` has 192 CRLF line ends in `/c/tmp/homunculus-g1`), while the VMs need git's LF bytes. A release built from the working copy could also carry uncommitted code. The same commit gives the same tarball bytes. *Rejected:* copying working-tree files; reusing `build_pilot_bundle.py` (its allowlist predates `infinity_records` and `infinity_timing`, and it packs a single-device inventory).
9. **Each new drop-in is the current newest one with only the release path replaced** (`sed`), and a `diff` proves nothing else changed. The journal limits and flags cannot drift through a typo. *Rejected:* hand-written `ExecStart` lines; editing an existing drop-in (that would break rollback-by-delete).
10. **The certificate is renewed under the existing CA, with a new key, valid until a day before the CA ends** (~20.09.2027), and the current pair kept as `.bak-<stamp>`. *Rejected:* 90 days again (another renewal in March); a new CA now (the worker's `ca.pem` and the API's `/etc/homunculus/infinity-ca.pem` would have to change too: a separate, announced change before September 2027).
11. **The queue stays first-in first-out, and the archive stays,** unless the post-fix drain is slow (F6, user decision 4). With F1 a 52,000-row backlog should drain in about 2 minutes (desk estimate: ~500–800 events/s of capacity against 67 produced).
12. **WAL and `synchronous=NORMAL` only if the numbers say so** (row B). Commits cost a few ms on disks that are 7–10 % busy. *Rejected:* switching now (weaker acknowledgement semantics without evidence of need).
13. **Thinning waits for Aşama A** (F8). The hub's cost is the journal. Decoding is estimated at 1–4 % of a core.
14. **The acceptance thresholds are engineering choices, written as constants at the top of `transport_check.py`:** lag ≤ 3 s for 99 % of live packets, mean ≤ 1 s, hub CPU ≤ 43 % of a core (the 9-day average before any change). The user may change them. None is clinical.
15. **No pipelining and no concurrent batches.** One batch in flight at a time keeps `pending`/`ack` simple: the rows sent are the rows acknowledged, in order. With the scans gone, a sequential cycle is not the limit: ~50 ms per batch is ~640 events/s of capacity against 67 produced (desk estimate; Task 9's `--breakdown` measures it). *Rejected:* in-flight tracking in the journal and out-of-order acks, for a throughput the system does not need.

---

## Not in this plan

- **Anything clinical.** `clinical_forwarding` stays `False` in every heartbeat, response and check. There is no `/ingest` path, and no Aşama A, K2–K6, episode or board work.
- **Device renames**, and naming `.28`, `.34`, `.38`. No block touches `inventory.json`.
- **Thinning** (F8) and decoding on the worker: Aşama A.
- **Rotating the CA** (ends 21.09.2027): a later, announced change to the worker and the API.
- **The legacy helpers** `build_pilot_bundle.py`, `enable_continuous_research.py`, `activate_pilot.py`, `switch_bed09.py`, `install_bed09_decoder.py`. They are not changed. **`build_pilot_bundle.py` is now unusable for the hub:** after Task 1, `infinity_hub` imports `infinity_timing`, which its allowlist does not pack. Task 11 marks it superseded.
- **Kernel drop counters** (`kernel_drop_count: None` in `/v1/status`). The worker's `/proc/net/udp` drops column could feed it later; on 14.10 it read 0.
- **Revoking the hub's temporary sudo**: the user's (Needs the user, 8).
- **The validation comparator (0b) and the field rounds.**

---

## Ground rules for every task

- **Your own worktree.** Work in `/c/tmp/infinity-0a` on branch `feat/infinity-0a`, made from `feat/canli-tasarim` in Task 0. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`**: it is the user's main checkout, on another branch, with uncommitted work that is not yours. `/c/tmp/homunculus-g1` is the reference worktree: read it, never commit in it. Never `git push`. If you remove the worktree later, unlink the `node_modules` junction first (`cmd /c rmdir "C:\tmp\infinity-0a\dashboard\node_modules"`, then `git worktree remove --force`). A recursive delete that follows the junction empties the shared `node_modules`.
- **Edit with the Write and Edit tools only, never `sed`, `python`, `node` or a shell heredoc on a repo file.** The worktree checks out **CRLF**; every block in this document is LF. The Edit tool matches either way; a shell replacement fails to match or rewrites every line end. Use **Write** only for a file this plan gives whole (new, or replaced whole); use **Edit** for every replace pair. The old text must match exactly once.
- **Stage explicit paths only** (`git add <paths>`). Before every commit, run `git status --short` and `git diff --cached --stat`. If a staged path is not one the task lists, stop and ask.
- **Commit after each code task.** Every message ends with the trailer your session is given; on 14.10 that is:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Foreground gates.** Run every suite in the foreground, with the Bash timeout as the backstop. Never background a gate and wait on it: an agent that did sat silent for hours.
- **The gate command.** Always name the files. Never run `tests/test_infinity_vm_pilot.py`, and never run a bare `pytest tests/`.
  ```bash
  cd /c/tmp/infinity-0a/homunculus-engine
  PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q \
    tests/test_infinity_transport.py tests/test_infinity_live.py tests/test_infinity_records.py \
    tests/test_infinity_research_upgrade.py tests/test_infinity_pilot_activation.py \
    tests/test_infinity_decoder.py tests/test_infinity_bed09_decoder_install.py tests/test_infinity_bed09_switch.py \
    <the new files that exist by then> 2>&1 | tail -1
  ```
- **No patient data, ever** (CLAUDE.md rule 6). Tests use in-code synthetic fixtures only (documentation addresses `192.0.2.x` / `239.10.2.x`, `SYNTHETIC-NOT-A-PATIENT` payloads). No capture, no `/v1/status` reading and no checker output enters the repo.
- **The VMs are read-only except in the deploy blocks of Tasks 3 and 9**, and the user is told before each. Copying a release into `/home/sysadmin` (no sudo) is part of those blocks. **Never print a token**, a key or an env file.

---

## File map

**Create:**

| File | Task |
|---|---|
| `homunculus-engine/src/homunculus/edge/infinity_timing.py` | 1 |
| `homunculus-engine/tests/test_infinity_timing.py` | 1 |
| `deploy/infinity/build_transport_release.py` | 2 |
| `deploy/infinity/transport_check.py` | 2 |
| `homunculus-engine/tests/test_infinity_release.py` | 2 |
| `homunculus-engine/tests/test_infinity_check.py` | 2 |
| `homunculus-engine/tests/test_infinity_journal.py` | 4 |
| `homunculus-engine/tests/test_infinity_forwarding.py` | 5 (replaced whole in 6) |
| `deploy/infinity/renew_hub_certificate.py` | 7 |
| `homunculus-engine/tests/test_infinity_certificate.py` | 7 |

**Modify:**

| File | Change | Task |
|---|---|---|
| `edge/infinity_journal.py` | timed transactions (whole file); index and running totals; `quarantine`, `device_ids` | 1, 4, 6 |
| `edge/infinity_collector.py` | connect/flush timings, heartbeat order; `LINGER`; `Refused` and quarantine | 1, 5, 6 |
| `edge/infinity_hub.py` | handler timings, lag, `timings` in heartbeat and status; K1, `quarantined` counter | 1, 6 |
| `edge/infinity_stream.py` | `validate_event(…, match_name=…)` | 6 |
| `homunculus-engine/scripts/run_infinity_transport.py` | one `Timings` for everything | 1 |
| `deploy/infinity/README.md`, `docs/INFINITY-PARAMETER-RECORDS.md`, `docs/homunculus-rehber-TR.md` | as deployed | 11 |

**On the VMs (Tasks 3 and 9 only):**
- **Hub:** `/opt/homunculus-infinity/<R1>/`, `/opt/homunculus-infinity/<R2>/`, drop-ins `80-transport-0a-olcum.conf` and `90-transport-0a-duzeltme.conf`; `server.pem` and `server-key.pem` replaced, with `.bak-<stamp>` copies.
- **Worker:** `/opt/homunculus-infinity/<R1>/`, `/opt/homunculus-infinity/<R2>/`, drop-ins `60-transport-0a-olcum.conf` and `70-transport-0a-duzeltme.conf`.
- Nothing else. No inventory, env, key, journal file or firewall rule changes.

---

### Task 0: Baseline

**Files:** none changed except this plan, committed into the repo.

- [ ] **Step 1: Make your worktree**

```bash
git -C /c/tmp/homunculus-g1 worktree add /c/tmp/infinity-0a -b feat/infinity-0a feat/canli-tasarim
cd /c/tmp/infinity-0a/dashboard
cmd //c "mklink /J node_modules C:\tmp\homunculus-g1\dashboard\node_modules"
git -C /c/tmp/infinity-0a log --oneline -1
```
Expected: `Junction created for node_modules`, and `52656da docs(g1-15): the browser walk moves to the VM, after the deploy, with real beds (user decision 14.10)`. If the tip is later, check that none of the transport files changed: `git -C /c/tmp/infinity-0a diff --stat 52656da -- homunculus-engine/src/homunculus/edge/ homunculus-engine/scripts/run_infinity_transport.py deploy/infinity/` must print nothing. If it prints something, stop and ask: every replace pair below was replayed against `52656da`.

- [ ] **Step 2: The gate at base**

Run the gate command with the eight base files.
Expected: `106 passed` (or `105 passed, 1 skipped` without the junction).

- [ ] **Step 3: Read the VMs' state (read-only)**

```bash
ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'bash ~/g115/hub_sample.sh'
```
Expected, shaped like 14.10: `worker connected: True mode: live`, `worker queue rows:` ~52,000, `oldest_age_s:` 850–900, and `device states: {'stale': 13}`. Record the numbers in your report; they are the "before".

- [ ] **Step 4: Commit the plan**

```bash
cd /c/tmp/infinity-0a
cp /c/tmp/homunculus-plans/2026-10-14-infinity-asama0a-tasima.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-14-infinity-asama0a-tasima.md
git commit -m "$(cat <<'EOF'
docs(plan): Infinity Aşama 0a — the research transport catches up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 106, the VM read recorded, one commit.

---

### Task 1: The measurement — where each batch's time goes, on both sides

**Files:**
- Create: `homunculus-engine/src/homunculus/edge/infinity_timing.py`, `homunculus-engine/tests/test_infinity_timing.py`
- Replace whole: `homunculus-engine/src/homunculus/edge/infinity_journal.py`
- Modify: `edge/infinity_collector.py`, `edge/infinity_hub.py`, `homunculus-engine/scripts/run_infinity_transport.py`

The journal's behaviour does not change in this task: the same statements in the same transactions, now timed. Two behaviour changes ship with it, both tested:
- the heartbeat is scheduled before it is sent (Decision 3);
- the hub accepts an optional `timings` key in the heartbeat and adds `timings` to `/v1/status`.

`/infinity-research/state`, the API's only window onto the hub, is untouched. The API copies it through an allow-list anyway (`api/infinity_research.py:28-35, 55-64`).

- [ ] **Step 1: Write the tests.** Create `homunculus-engine/tests/test_infinity_timing.py` with exactly:

```python
"""Where a batch's time goes, measured on the real system. Synthetic fixtures only."""
import http.server
import threading

from fastapi.testclient import TestClient
import pytest

from test_infinity_transport import TOKEN, VIEW, event, factory, inventory, post, status  # noqa: F401
from homunculus.edge.infinity_collector import Sender, flush_once, forward_loop
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_timing import BUCKETS, HUB_NAMES, WORKER_NAMES, Timings, valid_snapshot


def test_a_timing_is_a_count_a_total_and_a_histogram_of_integers():
    timings = Timings()
    for value in (5, 60, 4000.4):
        timings.add("post_ms", value)
    # n, total, then one count per bucket: <=10, <=50, <=100, <=250, <=500, <=1000, <=3000, >3000
    assert timings.snapshot() == {"post_ms": [3, 4065, 1, 0, 1, 0, 0, 0, 0, 1]}
    # Cumulative: reading does not reset, so two readings any distance apart give an exact
    # average over the span between them, as the queue counters already do.
    assert timings.snapshot() == {"post_ms": [3, 4065, 1, 0, 1, 0, 0, 0, 0, 1]}
    assert len(BUCKETS) == 7


def test_a_timing_name_is_never_free_text():
    timings = Timings()
    with pytest.raises(ValueError):
        timings.add("Patient Name", 1)
    with pytest.raises(ValueError):
        timings.add("x" * 49, 1)


def test_the_hub_accepts_only_known_names_and_consistent_counts():
    good = {"post_ms": [2, 30, 1, 1, 0, 0, 0, 0, 0, 0]}
    assert valid_snapshot(good, WORKER_NAMES)
    assert not valid_snapshot({"patient_ms": [1, 1, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)
    assert not valid_snapshot({"post_ms": [2, 30, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)   # n != buckets
    assert not valid_snapshot({"post_ms": [1, -1, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)
    assert not valid_snapshot({"post_ms": [1, 1.5, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)
    assert not valid_snapshot({"post_ms": [1, 1, 1]}, WORKER_NAMES)
    assert not valid_snapshot([], WORKER_NAMES)
    assert WORKER_NAMES.isdisjoint({"patient", "name"}) and "lag_ms" in HUB_NAMES


def test_the_journal_says_where_its_time_goes(factory):
    timings = Timings()
    journal = factory(timings=timings)
    journal.append([event()])
    item = journal.pending()
    journal.ack([item[0]["id"]])
    journal.snapshot()
    seen = timings.snapshot()
    for name in ("append_ms", "pending_ms", "ack_ms", "snapshot_ms"):
        assert seen[name][0] == 1, name
    # The three suspects, each on its own line: the expiry scan (append, pending,
    # snapshot), the size query (append) and the commit (every write).
    assert seen["expire_ms"][0] == 3 and seen["capacity_ms"][0] == 1
    assert seen["commit_ms"][0] == 4 and seen["lock_wait_ms"][0] == 4 and seen["insert_ms"][0] == 1


def test_a_flush_reports_its_phases_and_its_size(factory):
    inv = inventory(3)
    timings = Timings()
    outbox, archive = factory(timings=timings), factory()
    c = TestClient(create_hub(inv, archive, TOKEN, VIEW, clock=lambda: 1000))
    class LocalSender:
        def post(self, path, body):
            return c.post(path, json=body, headers={"Authorization": "Bearer " + TOKEN}).json()
    outbox.append([event(inv, index=i) for i in range(3)])
    assert flush_once(outbox, LocalSender(), timings) == 3
    seen = timings.snapshot()
    assert seen["flush_ms"][0] == seen["post_ms"][0] == 1
    assert seen["batch_events"][:2] == [1, 3]
    assert flush_once(outbox, LocalSender(), timings) == 0
    assert timings.snapshot()["flush_ms"][0] == 1      # an empty queue is not a batch


class _Ack(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = b'{"ack": []}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def test_the_sender_times_the_connection_apart_from_the_request():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Ack)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        timings = Timings()
        sender = Sender(f"http://127.0.0.1:{server.server_address[1]}", TOKEN,
                        allow_loopback_http=True, timings=timings)
        assert sender.post("/v1/packets", {"events": []}) == {"ack": []}
        assert timings.snapshot()["connect_ms"][0] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_the_hub_times_each_batch_and_measures_delivery_lag(factory):
    inv = inventory(2)
    timings = Timings()       # one object for the journal and the hub, as the runner does
    c = TestClient(create_hub(inv, factory(timings=timings), TOKEN, VIEW, clock=lambda: 1000.0,
                              timings=timings))
    assert post(c, [event(inv, stamp=999.5, index=0), event(inv, stamp=998.0, index=1)]).status_code == 200
    seen = status(c)["timings"]
    for name in ("packets_ms", "body_ms", "validate_ms", "append_ms"):
        assert seen[name][0] == 1, name
    assert seen["batch_events"][:2] == [1, 2]
    # 500 ms and 2000 ms behind the hub's clock: both inside the 3 s live window.
    assert seen["lag_ms"][:2] == [2, 2500] and seen["lag_ms"][2 + 4] == 1 and seen["lag_ms"][2 + 6] == 1
    assert valid_snapshot(seen, HUB_NAMES)


def test_a_replayed_packet_is_not_counted_as_delivery_lag(factory):
    c = TestClient(create_hub(inventory(), factory(), TOKEN, VIEW, clock=lambda: 1000.0))
    assert post(c, [event(stamp=10.0, mode="replay")]).status_code == 200
    assert "lag_ms" not in status(c)["timings"]


def heartbeat(journal, **extra):
    return dict({"collector_id": "collector-a", "mode": "live", "queue": journal.snapshot(),
                 "clinical_forwarding": False}, **extra)


def test_the_hub_shows_the_worker_timings_and_still_takes_an_old_heartbeat(factory):
    journal = factory()
    c = TestClient(create_hub(inventory(), journal, TOKEN, VIEW))
    headers = {"Authorization": "Bearer " + TOKEN}
    timings = {"post_ms": [1, 12, 0, 1, 0, 0, 0, 0, 0, 0]}
    assert c.post("/v1/heartbeat", json=heartbeat(journal, timings=timings), headers=headers).status_code == 200
    assert status(c)["collector"]["heartbeat"]["timings"] == timings
    assert c.post("/v1/heartbeat", json=heartbeat(journal), headers=headers).status_code == 200
    bad = {"patient_ms": [1, 12, 0, 1, 0, 0, 0, 0, 0, 0]}
    assert c.post("/v1/heartbeat", json=heartbeat(journal, timings=bad), headers=headers).status_code == 400


class Steps:
    """A stop event whose waits return at once, and that ends the loop after `passes`."""
    def __init__(self, passes):
        self.left, self.flag = passes, False

    def is_set(self):
        self.left -= 1
        return self.flag or self.left < 0

    def wait(self, _):
        return self.flag

    def set(self):
        self.flag = True


def test_a_refused_heartbeat_does_not_hold_delivery_up(factory):
    # Before: the loop retried the heartbeat forever and never reached the queue, so a worker
    # deployed ahead of its hub stopped delivering altogether rather than only going unseen.
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv)])
    delivered = []
    class HubThatRefusesHeartbeats:
        def post(self, path, body):
            if path == "/v1/heartbeat":
                raise OSError("Receiver refused delivery.")
            delivered.extend(e["id"] for e in body["events"])
            return {"ack": [e["id"] for e in body["events"]]}
    forward_loop(outbox, HubThatRefusesHeartbeats(), inv, Steps(6), "live", timings=Timings())
    assert len(delivered) == 1 and outbox.snapshot()["rows"] == 0
    assert outbox.snapshot()["counters"]["forward_errors"] >= 1


def test_the_heartbeat_carries_the_worker_timings(factory):
    inv = inventory()
    outbox = factory()
    beats = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/heartbeat":
                beats.append(body)
            return {"ack": []}
    timings = Timings()
    timings.add("post_ms", 12)
    forward_loop(outbox, Hub(), inv, Steps(2), "live", timings=timings)
    assert beats and beats[0]["timings"]["post_ms"][:2] == [1, 12]


def _runner():
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location(
        "run_infinity_transport", Path(__file__).resolve().parents[1] / "scripts/run_infinity_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _environment(monkeypatch, tmp_path):
    import json as _json
    from cryptography.fernet import Fernet
    (tmp_path / "inventory.json").write_text(_json.dumps({
        "collector_id": "collector-a", "interface": "192.0.2.220/24",
        "devices": [{"id": "monitor-1", "source": "192.0.2.1", "group": "239.10.2.1", "port": 2050}]}))
    monkeypatch.setenv("INFINITY_STORAGE_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("INFINITY_COLLECTOR_TOKEN", TOKEN)
    monkeypatch.setenv("INFINITY_VIEWER_TOKEN", VIEW)


def test_the_runner_gives_the_hub_and_its_journal_one_timings_object(monkeypatch, tmp_path):
    runner = _runner()
    _environment(monkeypatch, tmp_path)
    seen = {}
    def serve(app, **_):
        # Read while "serving": the runner closes the journal once run() returns.
        response = TestClient(app).get("/v1/status", headers={"Authorization": "Bearer " + VIEW})
        seen.update(response.json()["timings"])
    monkeypatch.setattr(runner.uvicorn, "run", serve)
    monkeypatch.setattr("sys.argv", ["run", "hub", "--inventory", str(tmp_path / "inventory.json"),
                                     "--database", str(tmp_path / "archive.sqlite")])
    assert runner.main() == 0
    assert "snapshot_ms" in seen and "status_ms" in seen      # the journal's and the hub's own


def test_the_runner_gives_the_worker_one_timings_object(monkeypatch, tmp_path):
    import struct as _struct
    runner = _runner()
    _environment(monkeypatch, tmp_path)
    capture = tmp_path / "empty.pcap"
    capture.write_bytes(_struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 101))
    seen = {}
    def fake_forward(journal, sender, inventory, stop, mode, failure=None, timings=None):
        seen.update(journal=journal.timings, sender=sender.timings, loop=timings)
    monkeypatch.setattr(runner, "forward_loop", fake_forward)
    monkeypatch.setattr("sys.argv", ["run", "collector", "--inventory", str(tmp_path / "inventory.json"),
                                     "--database", str(tmp_path / "outbox.sqlite"),
                                     "--endpoint", "http://127.0.0.1:9", "--allow-loopback-http",
                                     "--replay", str(capture)])
    assert runner.main() == 0
    assert seen["loop"] is not None and seen["journal"] is seen["loop"] and seen["sender"] is seen["loop"]
```

- [ ] **Step 2: See them fail**

```bash
cd /c/tmp/infinity-0a/homunculus-engine
PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_timing.py 2>&1 | tail -1
```
Expected: `1 error` (collection: `No module named 'homunculus.edge.infinity_timing'`).

- [ ] **Step 3: The module.** Create `homunculus-engine/src/homunculus/edge/infinity_timing.py` with exactly:

```python
"""Where the research transport spends its time: bounded integer counters, no packet content.

Each name keeps a count, a total and a fixed histogram, all integers and all cumulative since
the process started. Cumulative, because two readings taken any distance apart then give an
exact average and an exact tail over the span between them, the way the queue counters do;
a 24-hour watch needs two readings, not a sampler left running. In memory only: writing them
to the journal would add a commit to the very path being measured, and a restart resetting
them is visible (the count goes down).

The unit is part of the name (`_ms`, `_events`). The names are a closed list on each side and
the hub refuses any other, so a heartbeat can never carry free text.
"""
from __future__ import annotations

import re
import threading
import time

BUCKETS = (10, 50, 100, 250, 500, 1000, 3000)     # upper edges; one more bucket above the last
WIDTH = 2 + len(BUCKETS) + 1
LIMIT = 10**12
NAME = re.compile(r"[a-z][a-z0-9_]{0,47}\Z")

# The journal's own phases, timed on both sides.
JOURNAL_NAMES = frozenset({"append_ms", "pending_ms", "ack_ms", "snapshot_ms", "lock_wait_ms",
                           "expire_ms", "capacity_ms", "insert_ms", "commit_ms"})
WORKER_NAMES = JOURNAL_NAMES | {"connect_ms", "post_ms", "flush_ms", "batch_events"}
HUB_NAMES = JOURNAL_NAMES | {"packets_ms", "body_ms", "validate_ms", "consume_ms", "lag_ms",
                             "batch_events", "status_ms"}


class Timings:
    def __init__(self, clock=time.perf_counter):
        self.clock = clock
        self.lock = threading.Lock()
        self.values = {}

    def add(self, name, amount):
        if not NAME.fullmatch(name):
            raise ValueError("Invalid timing name.")
        amount = min(LIMIT, max(0, int(round(amount))))
        slot = next((i for i, edge in enumerate(BUCKETS) if amount <= edge), len(BUCKETS))
        with self.lock:
            entry = self.values.setdefault(name, [0] * WIDTH)
            entry[0] += 1
            entry[1] += amount
            entry[2 + slot] += 1

    def since(self, name, started):
        """Record the milliseconds elapsed since `started` (a reading of `self.clock`)."""
        self.add(name, (self.clock() - started) * 1000)

    def snapshot(self):
        with self.lock:
            return {name: list(entry) for name, entry in self.values.items()}


def valid_snapshot(value, names):
    """A snapshot the hub will store: known names, integers in range, counts that add up."""
    if not isinstance(value, dict) or len(value) > len(names):
        return False
    for name, entry in value.items():
        if (name not in names or not isinstance(entry, list) or len(entry) != WIDTH
                or any(type(v) is not int or not 0 <= v <= LIMIT for v in entry)
                or entry[0] != sum(entry[2:])):
            return False
    return True
```

Run Step 2's command again. Expected: `10 failed, 3 passed` (the module's own three pass; the journal, sender, loop, hub and runner do not know `timings` yet).

- [ ] **Step 4: The journal, timed.** Replace `homunculus-engine/src/homunculus/edge/infinity_journal.py` whole with the following. Against HEAD, `_transaction` replaces `with self.lock, self.db:` (same commit-or-rollback), and the expiry, the size query, the inserts and the commit are each timed. No statement changes.

```python
"""Encrypted, bounded durable packet outbox/archive; no patient assignments."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path

from cryptography.fernet import Fernet

from .infinity_stream import canonical


class CapacityError(Exception):
    pass


class ConflictError(Exception):
    pass


def external_path(path):
    path = Path(path).expanduser().resolve()
    if any((parent / ".git").exists() for parent in (path.parent, *path.parents)):
        raise ValueError("Runtime data must stay outside repositories.")
    return path


class _Untimed:
    """Stands in when no one asked for timings, so the journal's code has one shape."""
    @staticmethod
    def clock():
        return 0.0

    @staticmethod
    def since(name, started):
        pass


class Journal:
    def __init__(self, path, key, *, max_bytes=128 * 1024 * 1024, max_rows=100_000,
                 retention=3600, clock=time.time, timings=None):
        if not 1024 <= max_bytes <= 4 * 1024**3 or not 1 <= max_rows <= 1_000_000 or not 60 <= retention <= 86400:
            raise ValueError("Invalid storage limits.")
        self.path = external_path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fernet = Fernet(key)
        self.clock, self.retention = clock, retention
        self.timings = timings or _Untimed()
        self.max_bytes, self.max_rows = max_bytes, max_rows
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA synchronous=FULL")
        # SQLite reuses freed pages; logical caps bound growth, not immediate file shrinkage.
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
                created REAL NOT NULL, size INTEGER NOT NULL, body BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY, stamp REAL NOT NULL, packets INTEGER NOT NULL,
                bytes INTEGER NOT NULL, length INTEGER NOT NULL, mode TEXT NOT NULL);
        """)
        check = self.db.execute("SELECT value FROM settings WHERE name='key_check'").fetchone()
        try:
            if check:
                if self.fernet.decrypt(check[0]) != b"infinity-journal-v1":
                    raise ValueError("Wrong journal key.")
            else:
                self.db.execute("INSERT INTO settings VALUES ('key_check',?)", (self.fernet.encrypt(b"infinity-journal-v1"),))
            self.db.commit()
        except Exception:
            self.db.close()
            raise ValueError("Journal key does not match existing storage.") from None

    @contextmanager
    def _transaction(self, name=None):
        """The lock, one transaction, and where the time went: waiting, working, committing.

        Commits on success and rolls back on any exception, exactly as `with self.db:` did.
        """
        started = self.timings.clock()
        with self.lock:
            self.timings.since("lock_wait_ms", started)
            try:
                yield
                committing = self.timings.clock()
                self.db.commit()
                self.timings.since("commit_ms", committing)
            except BaseException:
                self.db.rollback()
                raise
        if name:
            self.timings.since(name, started)

    def _increment(self, name, amount=1):
        self.db.execute("INSERT INTO stats VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value", (name, amount))

    def count(self, name, amount=1):
        with self._transaction():
            self._increment(name, amount)

    def _expire(self):
        started = self.timings.clock()
        count = self.db.execute("DELETE FROM events WHERE created < ?", (self.clock() - self.retention,)).rowcount
        self.timings.since("expire_ms", started)
        if count:
            self._increment("expired", count)

    def append(self, events, *, update_devices=False):
        """Atomic batch: ack only after commit. Same ID with different content is an error."""
        if not events:
            return []
        with self._transaction("append_ms"):
            self._expire()
            started = self.timings.clock()
            size, rows = self.db.execute("SELECT COALESCE(SUM(size),0),COUNT(*) FROM events").fetchone()
            self.timings.since("capacity_ms", started)
            started = self.timings.clock()
            for event in events:
                plain = canonical(event)
                digest = hashlib.sha256(plain).hexdigest()
                existing = self.db.execute("SELECT digest FROM events WHERE id=?", (event["id"],)).fetchone()
                if existing:
                    if existing[0] != digest:
                        raise ConflictError("Event ID reused with different content.")
                    continue
                encrypted = self.fernet.encrypt(plain)
                if size + len(encrypted) > self.max_bytes or rows + 1 > self.max_rows:
                    raise CapacityError("Journal capacity reached.")
                self.db.execute("INSERT INTO events(id,digest,created,size,body) VALUES (?,?,?,?,?)",
                                (event["id"], digest, self.clock(), len(encrypted), encrypted))
                size += len(encrypted)
                rows += 1
                self._increment("accepted")
                if update_devices:
                    self.db.execute("""INSERT INTO devices VALUES (?,?,1,?,?,?)
                        ON CONFLICT(id) DO UPDATE SET
                        packets=packets+1,bytes=bytes+excluded.bytes,
                        length=CASE WHEN excluded.stamp>stamp THEN excluded.length ELSE length END,
                        mode=CASE WHEN excluded.stamp>stamp THEN excluded.mode ELSE mode END,
                        stamp=MAX(stamp,excluded.stamp)""",
                        (event["device_id"], event["received_at"], event["payload_bytes"], event["payload_bytes"], event["mode"]))
            self.timings.since("insert_ms", started)
        return [e["id"] for e in events]

    def pending(self, limit=32):
        with self._transaction("pending_ms"):
            self._expire()
            rows = self.db.execute("SELECT body FROM events ORDER BY seq LIMIT ?", (limit,)).fetchall()
            return [json.loads(self.fernet.decrypt(row[0])) for row in rows]

    def ack(self, ids):
        with self._transaction("ack_ms"):
            self.db.executemany("DELETE FROM events WHERE id=?", ((x,) for x in ids))

    def snapshot(self):
        with self._transaction("snapshot_ms"):
            self._expire()
            rows, size, oldest = self.db.execute("SELECT COUNT(*),COALESCE(SUM(size),0),MIN(created) FROM events").fetchone()
            return {"rows": rows, "encrypted_bytes": size, "oldest_age_seconds": None if oldest is None else max(0, self.clock()-oldest),
                    "counters": dict(self.db.execute("SELECT name,value FROM stats")), "retention_seconds": self.retention}

    def device_states(self):
        with self.lock:
            return {row[0]: dict(zip(("last_packet_at", "packets", "bytes", "last_payload_bytes", "mode"), row[1:]))
                    for row in self.db.execute("SELECT * FROM devices")}

    def close(self):
        with self.lock:
            self.db.close()
```

- [ ] **Step 5: The sender, the flush and the loop.** In `homunculus-engine/src/homunculus/edge/infinity_collector.py`, make these four replacements:

**1.** Replace:

```python
class Sender:
    def __init__(self, endpoint, token, *, ca_file=None, allow_loopback_http=False):
```

with:

```python
class Sender:
    def __init__(self, endpoint, token, *, ca_file=None, allow_loopback_http=False, timings=None):
```

**2.** Replace:

```python
        self.target, self.token = target, token
```

with:

```python
        self.target, self.token, self.timings = target, token, timings
```

**3.** Replace:

```python
        connection = cls(self.target.hostname, self.target.port, timeout=5, **kwargs)
        try:
            connection.request("POST", path, canonical(body),
```

with:

```python
        connection = cls(self.target.hostname, self.target.port, timeout=5, **kwargs)
        try:
            # TCP and the TLS handshake on their own line: one new connection per request is
            # a suspect for the batch cycle, and request() alone would hide it.
            started = time.perf_counter()
            connection.connect()
            if self.timings is not None:
                self.timings.since("connect_ms", started)
            connection.request("POST", path, canonical(body),
```

**4.** Replace:

```python
def flush_once(journal, sender):
    batch = journal.pending(MAX_BATCH)
    if not batch:
        return 0
    result = sender.post("/v1/packets", {"events": batch})
    expected = [event["id"] for event in batch]
    if not isinstance(result, dict) or result.get("ack") != expected:
        raise OSError("Invalid receiver acknowledgment.")
    journal.ack(expected)
    return len(expected)


def forward_loop(journal, sender, inventory, stop, mode, failure=None):
    next_heartbeat = 0
    backoff = 0.25
    while not stop.is_set():
        try:
            if time.monotonic() >= next_heartbeat:
                sender.post("/v1/heartbeat", {"collector_id": inventory.collector_id,
                            "mode": mode, "queue": journal.snapshot(), "clinical_forwarding": False})
                next_heartbeat = time.monotonic() + 5
            sent = flush_once(journal, sender)
```

with:

```python
def flush_once(journal, sender, timings=None):
    started = time.perf_counter()
    batch = journal.pending(MAX_BATCH)
    if not batch:
        return 0
    posting = time.perf_counter()
    result = sender.post("/v1/packets", {"events": batch})
    if timings is not None:
        timings.since("post_ms", posting)
    expected = [event["id"] for event in batch]
    if not isinstance(result, dict) or result.get("ack") != expected:
        raise OSError("Invalid receiver acknowledgment.")
    journal.ack(expected)
    if timings is not None:
        timings.since("flush_ms", started)
        timings.add("batch_events", len(expected))
    return len(expected)


def forward_loop(journal, sender, inventory, stop, mode, failure=None, timings=None):
    next_heartbeat = 0
    backoff = 0.25
    while not stop.is_set():
        try:
            if time.monotonic() >= next_heartbeat:
                # Scheduled before it is sent: a refused heartbeat is counted below and tried
                # again in five seconds, but it must never hold delivery up. Retried at once,
                # it starved the queue, so a worker deployed ahead of its hub stopped
                # delivering altogether instead of merely going unseen.
                next_heartbeat = time.monotonic() + 5
                beat = {"collector_id": inventory.collector_id, "mode": mode,
                        "queue": journal.snapshot(), "clinical_forwarding": False}
                if timings is not None:
                    beat["timings"] = timings.snapshot()
                sender.post("/v1/heartbeat", beat)
            sent = flush_once(journal, sender, timings)
```

- [ ] **Step 6: The hub.** In `homunculus-engine/src/homunculus/edge/infinity_hub.py`, make these nine replacements:

**1.** Replace:

```python
from .infinity_journal import CapacityError, ConflictError
from .infinity_stream import MAX_BATCH, MAX_REQUEST, validate_event
```

with:

```python
from .infinity_journal import CapacityError, ConflictError
from .infinity_stream import MAX_BATCH, MAX_REQUEST, validate_event
from .infinity_timing import WORKER_NAMES, Timings, valid_snapshot
```

**2.** Replace:

```python
def create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time,
               research_view=None):
```

with:

```python
def create_hub(inventory, journal, collector_token, viewer_token, *, accept_payload=False, clock=time.time,
               research_view=None, timings=None):
```

**3.** Replace:

```python
    heartbeat = {"seen": None, "value": None}
    lock = threading.Lock()
```

with:

```python
    heartbeat = {"seen": None, "value": None}
    lock = threading.Lock()
    # Pass the journal's own Timings here too, and /v1/status shows the whole handler,
    # the journal's phases included, under one key.
    timings = timings or Timings()
```

**4.** Replace:

```python
        auth(request, collector_token)
        data = await body(request)
        try:
            if not isinstance(data, dict) or set(data) != {"events"}
```

with:

```python
        started = timings.clock()
        auth(request, collector_token)
        data = await body(request)
        timings.since("body_ms", started)
        validating = timings.clock()
        try:
            if not isinstance(data, dict) or set(data) != {"events"}
```

**5.** Replace:

```python
            raise HTTPException(400, "Rejected event, clock or payload policy.") from None
        try:
            ack = journal.append(data["events"], update_devices=True)
```

with:

```python
            raise HTTPException(400, "Rejected event, clock or payload policy.") from None
        timings.since("validate_ms", validating)
        try:
            ack = journal.append(data["events"], update_devices=True)
```

**6.** Replace:

```python
            raise HTTPException(409, "Conflicting event ID.") from None
        if research_view is not None:
            research_view.consume(data["events"])
        return {"ack": ack, "clinical_forwarding": False}
```

with:

```python
            raise HTTPException(409, "Conflicting event ID.") from None
        now = clock()
        for event in data["events"]:
            # How far behind the hub's clock a live packet arrives: the number the 3 s live
            # window judges. A replay carries its capture time, which is not a delay.
            if event["mode"] == "live":
                timings.add("lag_ms", (now - event["received_at"]) * 1000)
        if research_view is not None:
            consuming = timings.clock()
            research_view.consume(data["events"])
            timings.since("consume_ms", consuming)
        timings.add("batch_events", len(data["events"]))
        timings.since("packets_ms", started)
        return {"ack": ack, "clinical_forwarding": False}
```

**7.** Replace:

```python
            if (not isinstance(data, dict) or set(data) != {"collector_id", "mode", "queue", "clinical_forwarding"}
                    or data["collector_id"] != inventory.collector_id or data["mode"] not in ("live", "replay")
                    or data["clinical_forwarding"] is not False):
                raise ValueError
```

with:

```python
            # `timings` is optional: a worker that predates it keeps its heartbeat accepted.
            # A worker that sends it needs this hub first (deploy hub first, worker second).
            if (not isinstance(data, dict)
                    or set(data) - {"timings"} != {"collector_id", "mode", "queue", "clinical_forwarding"}
                    or data["collector_id"] != inventory.collector_id or data["mode"] not in ("live", "replay")
                    or data["clinical_forwarding"] is not False
                    or ("timings" in data and not valid_snapshot(data["timings"], WORKER_NAMES))):
                raise ValueError
```

**8.** Replace:

```python
    def status(request: Request):
        auth(request, viewer_token)
        states = journal.device_states()
```

with:

```python
    def status(request: Request):
        started = timings.clock()
        auth(request, viewer_token)
        states = journal.device_states()
```

**9.** Replace:

```python
        return {"devices": devices, "collector": collector, "archive": journal.snapshot(),
                "clinical_forwarding": False, "kernel_drop_count": None}
```

with:

```python
        archive = journal.snapshot()
        timings.since("status_ms", started)
        return {"devices": devices, "collector": collector, "archive": archive,
                "clinical_forwarding": False, "kernel_drop_count": None, "timings": timings.snapshot()}
```

- [ ] **Step 7: The runner.** In `homunculus-engine/scripts/run_infinity_transport.py`, make these six replacements:

**1.** Replace:

```python
from homunculus.edge.infinity_stream import Inventory, MAX_BATCH
```

with:

```python
from homunculus.edge.infinity_stream import Inventory, MAX_BATCH
from homunculus.edge.infinity_timing import Timings
```

**2.** Replace:

```python
    failure = threading.Event()
    try:
        inventory = Inventory.read(args.inventory)
```

with:

```python
    failure = threading.Event()
    # One object for the journal, the sender, the forwarding loop and the hub, so a reading
    # of /v1/status or of a heartbeat shows every phase of a batch side by side.
    timings = Timings()
    try:
        inventory = Inventory.read(args.inventory)
```

**3.** Replace:

```python
            sender = Sender(args.endpoint, token, ca_file=args.ca_file, allow_loopback_http=args.allow_loopback_http)
```

with:

```python
            sender = Sender(args.endpoint, token, ca_file=args.ca_file, allow_loopback_http=args.allow_loopback_http,
                            timings=timings)
```

**4.** Replace:

```python
        journal = Journal(args.database, key, max_bytes=args.max_mib*1024*1024,
                          max_rows=args.max_rows, retention=args.retention_seconds)
```

with:

```python
        journal = Journal(args.database, key, max_bytes=args.max_mib*1024*1024,
                          max_rows=args.max_rows, retention=args.retention_seconds, timings=timings)
```

**5.** Replace:

```python
            app = create_hub(inventory, journal, token, viewer, accept_payload=args.capture_payload,
                             research_view=research_view)
```

with:

```python
            app = create_hub(inventory, journal, token, viewer, accept_payload=args.capture_payload,
                             research_view=research_view, timings=timings)
```

**6.** Replace:

```python
        worker = threading.Thread(target=forward_loop, args=(journal, sender, inventory, stop,
                                   "replay" if args.replay else "live", failure), daemon=True)
```

with:

```python
        worker = threading.Thread(target=forward_loop, args=(journal, sender, inventory, stop,
                                   "replay" if args.replay else "live", failure),
                                  kwargs={"timings": timings}, daemon=True)
```

- [ ] **Step 8: Green, and nothing else moved.** Run Step 2's command. Expected: `13 passed`. Then run the gate command with the eight base files plus `tests/test_infinity_timing.py`.
Expected: **`119 passed`**.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/infinity-0a
git add homunculus-engine/src/homunculus/edge/infinity_timing.py homunculus-engine/src/homunculus/edge/infinity_journal.py \
        homunculus-engine/src/homunculus/edge/infinity_collector.py homunculus-engine/src/homunculus/edge/infinity_hub.py \
        homunculus-engine/scripts/run_infinity_transport.py homunculus-engine/tests/test_infinity_timing.py
git status --short && git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(infinity): time each phase of a batch on both sides; a refused heartbeat no longer stops delivery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 119 passed; six paths in the commit.

---

### Task 2: A release is a commit's code, and a read-only checker

**Files:**
- Create: `deploy/infinity/build_transport_release.py`, `deploy/infinity/transport_check.py`
- Create: `homunculus-engine/tests/test_infinity_release.py`, `homunculus-engine/tests/test_infinity_check.py`

`transport_check.py` is the acceptance instrument for Tasks 3, 9 and 10. It runs on the hub's system `python3` (standard library only), fed over SSH, so nothing is copied onto the VM. It reads the viewer token inside Python, from the same `.env` the existing `~/g115/hub_sample.sh` reads, and never prints it. **It was run read-only on the real hub on 14.10** and parsed both endpoints' real shapes.

- [ ] **Step 1: The tests.** Create `homunculus-engine/tests/test_infinity_release.py` with exactly:

```python
"""The release a VM runs is a commit's code and nothing else. No credentials, no captures."""
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("build_transport_release",
                                              ROOT / "deploy/infinity/build_transport_release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

FILES = {
    "app/run_infinity_transport.py", "app/src/homunculus/__init__.py",
    "app/src/homunculus/edge/__init__.py", "app/src/homunculus/edge/infinity_stream.py",
    "app/src/homunculus/edge/infinity_journal.py", "app/src/homunculus/edge/infinity_collector.py",
    "app/src/homunculus/edge/infinity_hub.py", "app/src/homunculus/edge/infinity_live.py",
    "app/src/homunculus/edge/infinity_records.py", "app/src/homunculus/edge/infinity_timing.py",
}


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, check=True).stdout


def test_a_release_is_exactly_the_transport_code_of_a_commit(tmp_path):
    name, tarball = release.build(tmp_path)
    with tarfile.open(tarball) as archive:
        members = {m.name: m for m in archive.getmembers() if m.isfile()}
        assert set(members) == {f"{name}/{path}" for path in FILES | {"SHA256SUMS", "RELEASE.json"}}
        for path in FILES:
            data = archive.extractfile(members[f"{name}/{path}"]).read()
            source = release.SOURCES.get(path)
            if source:
                # The bytes git holds, not the working copy's: Windows checks out CRLF.
                assert data == git("show", "HEAD:" + source), path
        sums = archive.extractfile(members[f"{name}/SHA256SUMS"]).read().decode()
    assert sorted(line.split("  ", 1)[1] for line in sums.splitlines()) == sorted(FILES)
    assert name.startswith("transport-") and len(name) == len("transport-") + 16


def test_the_same_commit_gives_the_same_bytes_and_name(tmp_path):
    first = release.build(tmp_path / "a")
    second = release.build(tmp_path / "b")
    assert first[0] == second[0]
    assert first[1].read_bytes() == second[1].read_bytes()


def test_a_release_runs_on_its_own(tmp_path):
    name, tarball = release.build(tmp_path)
    with tarfile.open(tarball) as archive:
        archive.extractall(tmp_path / "x", filter="data")
    app = tmp_path / "x" / name / "app"
    environment = dict(os.environ, PYTHONPATH=str(app / "src"), PYTHONDONTWRITEBYTECODE="1")
    result = subprocess.run([sys.executable, "-I", "-c",
                             "import sys; sys.path.insert(0, sys.argv[1]); "
                             "import homunculus.edge.infinity_timing, homunculus.edge.infinity_hub, "
                             "homunculus.edge.infinity_collector, homunculus.edge.infinity_live",
                             str(app / "src")], capture_output=True, text=True, env=environment)
    assert result.returncode == 0, result.stderr
    result = subprocess.run([sys.executable, str(app / "run_infinity_transport.py"), "--help"],
                            capture_output=True, text=True, env=environment)
    assert result.returncode == 0 and "collector" in result.stdout, result.stderr
```

And `homunculus-engine/tests/test_infinity_check.py` with exactly:

```python
"""The acceptance reader judges two readings of the hub. Small in-code readings only."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("transport_check", ROOT / "deploy/infinity/transport_check.py")
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def lag(n, total, within_3s):
    # n, total, then buckets <=10, <=50, <=100, <=250, <=500, <=1000, <=3000, >3000
    return [n, total, 0, 0, 0, 0, within_3s, 0, 0, n - within_3s]


def reading(*, lag_ms, rows=40, oldest=0.4, expired=0, errors=0, quarantined=0, archived=1000,
            devices=("streaming",) * 13, live=("streaming",) * 13, accepted=900, old=0):
    counters = {"accepted": 5000, "expired": expired, "forward_errors": errors}
    if quarantined:
        counters["quarantined"] = quarantined
    status = {
        "devices": [{"id": f"BED{i:02d}", "status": s, "packet_age_seconds": 0.5} for i, s in enumerate(devices)],
        "collector": {"connected": True, "heartbeat": {"queue": {
            "rows": rows, "oldest_age_seconds": oldest, "counters": counters}}},
        "archive": {"counters": {"accepted": archived}},
        "timings": {"lag_ms": lag_ms},
    }
    state = {"accepted_packets": accepted, "old_or_duplicate_packets": old,
             "devices": [{"device_id": f"BED{i:02d}", "status": s} for i, s in enumerate(live)]}
    return status, state


def verdicts(before, after, cpu=0.10):
    return {name: ok for name, ok, _ in check.evaluate(before, after, cpu_share=cpu, cpu_ceiling=0.43)}


def test_a_live_pipeline_passes_every_criterion():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500)
    assert all(verdicts(before, after).values())


def test_old_packets_fail_the_delivery_and_live_view_criteria():
    before = reading(lag_ms=lag(100, 87000000, 0), oldest=870)
    after = reading(lag_ms=lag(4100, 3567000000, 0), oldest=872, archived=5000, accepted=900, old=4000)
    seen = verdicts(before, after)
    assert not seen["gecikme"] and not seen["kuyruk"] and not seen["canli_gorunum"]


def test_any_expiry_error_or_quarantine_in_the_window_fails():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500,
                    expired=3, errors=1, quarantined=2)
    seen = verdicts(before, after)
    assert not seen["suresi_dolan"] and not seen["aktarim_hatasi"] and not seen["karantina"]


def test_a_stale_device_is_named_and_fails():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500,
                    devices=("streaming",) * 12 + ("stale",), live=("streaming",) * 12 + ("stale",))
    results = check.evaluate(before, after, cpu_share=0.1, cpu_ceiling=0.43)
    device = next(r for r in results if r[0] == "cihazlar")
    assert not device[1] and "BED12" in device[2]


def test_hub_cpu_above_the_ceiling_fails():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500)
    assert not verdicts(before, after, cpu=0.50)["hub_cpu"]


def test_a_hub_without_timings_cannot_pass_the_delay_criterion():
    before, after = reading(lag_ms=lag(100, 30000, 100)), reading(lag_ms=lag(4100, 1230000, 4100))
    before[0].pop("timings")
    after[0].pop("timings")
    assert not verdicts(before, after)["gecikme"]


def timed(n, total):
    return [n, total] + [0] * 7 + [n]


def phases(hub, worker):
    """A /v1/status-shaped reading carrying only timings: the hub's and the worker's."""
    return {"timings": {k: timed(*v) for k, v in hub.items()},
            "collector": {"heartbeat": {"timings": {k: timed(*v) for k, v in worker.items()}}}}


QUIET = {"packets_ms": (0, 0), "expire_ms": (0, 0), "capacity_ms": (0, 0), "commit_ms": (0, 0),
         "body_ms": (0, 0), "validate_ms": (0, 0)}
WORKER_QUIET = {"flush_ms": (0, 0), "pending_ms": (0, 0), "ack_ms": (0, 0), "post_ms": (0, 0),
                "connect_ms": (0, 0), "expire_ms": (0, 0), "capacity_ms": (0, 0), "append_ms": (0, 0),
                "snapshot_ms": (0, 0), "commit_ms": (0, 0), "lock_wait_ms": (0, 0)}


def test_the_measured_14_10_shape_points_at_the_journal_scans():
    # What the read-only evidence of 14.10 predicts: the hub's two scans take most of each
    # batch, and the worker's pending and ack wait on a journal busy scanning.
    hub = dict(QUIET, packets_ms=(1000, 260000), expire_ms=(1000, 110000), capacity_ms=(1000, 110000),
               commit_ms=(1000, 12000))
    worker = dict(WORKER_QUIET, flush_ms=(1000, 520000), pending_ms=(1000, 150000), ack_ms=(1000, 90000),
                  post_ms=(1000, 280000), connect_ms=(1000, 10000), expire_ms=(9000, 700000),
                  capacity_ms=(8000, 650000), append_ms=(8000, 1500000), snapshot_ms=(100, 20000))
    lines, rows = check.breakdown(phases(QUIET, WORKER_QUIET), phases(hub, worker))
    assert rows == ["A"] and any("expire" in line for line in lines)


def test_commits_dominating_after_the_scans_are_gone_points_at_durability():
    hub = dict(QUIET, packets_ms=(1000, 30000), expire_ms=(1000, 200), capacity_ms=(1000, 50),
               commit_ms=(1000, 20000))
    worker = dict(WORKER_QUIET, flush_ms=(1000, 60000), pending_ms=(1000, 2000), ack_ms=(1000, 25000),
                  post_ms=(1000, 33000), connect_ms=(1000, 9000), commit_ms=(3000, 70000),
                  append_ms=(2000, 50000))
    assert check.breakdown(phases(QUIET, WORKER_QUIET), phases(hub, worker))[1] == ["B"]


def test_a_slow_connection_points_at_keep_alive():
    hub = dict(QUIET, packets_ms=(1000, 8000), expire_ms=(1000, 100), commit_ms=(1000, 1000))
    worker = dict(WORKER_QUIET, flush_ms=(1000, 80000), pending_ms=(1000, 2000), ack_ms=(1000, 3000),
                  post_ms=(1000, 75000), connect_ms=(1000, 60000))
    assert check.breakdown(phases(QUIET, WORKER_QUIET), phases(hub, worker))[1] == ["C"]


def test_no_batches_means_no_verdict():
    assert check.breakdown(phases(QUIET, WORKER_QUIET), phases(QUIET, WORKER_QUIET))[1] == ["?"]
```

- [ ] **Step 2: See them fail**

```bash
cd /c/tmp/infinity-0a/homunculus-engine
PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_release.py tests/test_infinity_check.py 2>&1 | tail -1
```
Expected: `2 errors` (both modules missing).

- [ ] **Step 3: The builder.** Create `deploy/infinity/build_transport_release.py` with exactly:

```python
"""Build one immutable Infinity transport release from a commit: code and checksums only.

Both roles run the same release. It holds no inventory, key, token, certificate, capture or
profile. Files are read from git, not from the working copy, so the release is that commit's
code and nothing uncommitted (and LF, as git holds it, although Windows checks out CRLF).
It is named after its contents: the same commit always gives the same name and the same
tarball bytes, and any change gives a new name. On the VM, `sha256sum -c SHA256SUMS` checks
every file before a drop-in points at the directory.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
ENGINE = "homunculus-engine/"
EDGE = ("__init__", "infinity_stream", "infinity_journal", "infinity_collector", "infinity_hub",
        "infinity_live", "infinity_records", "infinity_timing")
SOURCES = {"app/run_infinity_transport.py": ENGINE + "scripts/run_infinity_transport.py",
           **{f"app/src/homunculus/edge/{name}.py": f"{ENGINE}src/homunculus/edge/{name}.py" for name in EDGE}}
# The package root is the release's own: the repo's would import the clinical engine.
PACKAGE = b'"""Isolated Infinity research package."""\n'


def _git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, check=True).stdout


def build(output, commit="HEAD"):
    revision = _git("rev-parse", "--verify", commit + "^{commit}").decode().strip()
    stamp = int(_git("show", "-s", "--format=%ct", revision).decode())
    files = {path: _git("show", f"{revision}:{source}") for path, source in SOURCES.items()}
    files["app/src/homunculus/__init__.py"] = PACKAGE
    sums = "".join(f"{hashlib.sha256(data).hexdigest()}  {path}\n" for path, data in sorted(files.items()))
    name = "transport-" + hashlib.sha256(sums.encode()).hexdigest()[:16]
    files["SHA256SUMS"] = sums.encode()
    files["RELEASE.json"] = json.dumps({"name": name, "commit": revision}, indent=2).encode() + b"\n"
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    tarball = output / f"{name}.tar.gz"
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for path in sorted(files):
                info = tarfile.TarInfo(f"{name}/{path}")
                info.size, info.mode, info.mtime = len(files[path]), 0o644, stamp
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                archive.addfile(info, io.BytesIO(files[path]))
    tarball.write_bytes(buffer.getvalue())
    return name, tarball


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="a folder outside the repository")
    parser.add_argument("--commit", default="HEAD")
    args = parser.parse_args()
    name, tarball = build(args.output, args.commit)
    print(json.dumps({"release": name, "tarball": str(tarball.resolve()),
                      "sha256": hashlib.sha256(tarball.read_bytes()).hexdigest()}))
```

- [ ] **Step 4: The checker.** Create `deploy/infinity/transport_check.py` with exactly:

```python
"""Read-only acceptance check for the Infinity research transport, run on the hub.

Run it without copying it anywhere, from a machine that has the hub's SSH key:

    ssh sysadmin@172.100.101.72 'python3 - --window 60' < deploy/infinity/transport_check.py

It reads the viewer token from the clinical stack's `.env` (never printing it), asks the hub
for `/v1/status` and `/infinity-research/state` twice, `--window` seconds apart, reads the hub
service's CPU time from systemd, and judges the difference. Nothing is written anywhere. The
last line, `OZET {...}`, holds only counters; pass it back with `--since` a day later to judge
the whole day from two readings (every number it compares is cumulative).

Python standard library only: it runs on the hub's system python3.
"""
from __future__ import annotations

import argparse
import json
import ssl
import subprocess
import time
import urllib.request

HUB = "https://172.100.101.72:8766"
CA = "/etc/homunculus/infinity-ca.pem"
ENV = "/opt/homunculus/deploy/local/.env"
UNIT = "homunculus-infinity-pilot-hub"

# Engineering thresholds, not clinical ones. The live window is the hub's own (infinity_live.py).
LIVE_WINDOW_MS = 3000
QUEUE_OLDEST_MAX_S = 3.0
LAG_SHARE_MIN = 0.99
LAG_MEAN_MAX_MS = 1000
LIVE_ACCEPT_MIN = 0.9
CPU_CEILING = 0.43            # the hub's share of one core, measured 14.10 before any change
LIVE_STATES = ("streaming", "no_parameters")


def _counters(status):
    return ((status.get("collector") or {}).get("heartbeat") or {}).get("queue", {}).get("counters", {})


def _delta(before, after, key):
    return after.get(key, 0) - before.get(key, 0)


def evaluate(before, after, *, cpu_share, cpu_ceiling=CPU_CEILING, errors_allowed=0):
    """Judge two readings, each a (status, state) pair. Returns (name, passed, text) rows."""
    (status_a, state_a), (status_b, state_b) = before, after
    rows = []
    queue = (status_b.get("collector") or {}).get("heartbeat", {}).get("queue", {})
    oldest = queue.get("oldest_age_seconds") or 0
    rows.append(("kuyruk", oldest <= QUEUE_OLDEST_MAX_S,
                 f"worker kuyruğu {queue.get('rows')} satır, en eskisi {oldest:.1f} sn (sınır {QUEUE_OLDEST_MAX_S} sn)"))
    lag_a = (status_a.get("timings") or {}).get("lag_ms")
    lag_b = (status_b.get("timings") or {}).get("lag_ms")
    if not lag_b:
        rows.append(("gecikme", False, "hub gecikme ölçmüyor (timings yok): ölçüm sürümü kurulu mu?"))
    else:
        lag_a = lag_a or [0] * len(lag_b)
        d = [y - x for x, y in zip(lag_a, lag_b)]
        within = sum(d[2:9])                 # every bucket up to and including <=3000 ms
        share = within / d[0] if d[0] else 0.0
        mean = d[1] / d[0] if d[0] else float("inf")
        rows.append(("gecikme", d[0] > 0 and share >= LAG_SHARE_MIN and mean <= LAG_MEAN_MAX_MS,
                     f"{d[0]} canlı paketin %{share * 100:.2f}'i {LIVE_WINDOW_MS} ms içinde vardı, ortalama "
                     f"{mean:.0f} ms (sınır: %{LAG_SHARE_MIN * 100:.0f} ve {LAG_MEAN_MAX_MS} ms)"))
    ca, cb = _counters(status_a), _counters(status_b)
    for name, key, allowed, text in (("suresi_dolan", "expired", 0, "süresi dolup silinen"),
                                     ("aktarim_hatasi", "forward_errors", errors_allowed, "aktarım hatası"),
                                     ("karantina", "quarantined", 0, "karantinaya alınan")):
        change = _delta(ca, cb, key)
        rows.append((name, change <= allowed, f"{text}: {change} (izin verilen {allowed})"))
    archived = _delta(status_a.get("archive", {}).get("counters", {}),
                      status_b.get("archive", {}).get("counters", {}), "accepted")
    accepted = state_b.get("accepted_packets", 0) - state_a.get("accepted_packets", 0)
    old = state_b.get("old_or_duplicate_packets", 0) - state_a.get("old_or_duplicate_packets", 0)
    rows.append(("canli_gorunum", accepted > 0 and accepted >= LIVE_ACCEPT_MIN * archived,
                 f"canlı görünüm {accepted} paket kabul etti, {old} eski/tekrar; hub {archived} paket arşivledi"))
    stale = [f"{d['id']}={d['status']}" for d in status_b.get("devices", []) if d.get("status") != "streaming"]
    quiet = [f"{d['device_id']}={d['status']}" for d in state_b.get("devices", []) if d.get("status") not in LIVE_STATES]
    total = len(status_b.get("devices", []))
    rows.append(("cihazlar", total > 0 and not stale and not quiet,
                 f"{total - len(stale)}/{total} cihaz paket akışında; sorunlu: {', '.join(stale + quiet) or 'yok'}"))
    rows.append(("hub_cpu", cpu_share is not None and cpu_share <= cpu_ceiling,
                 "hub CPU ölçülemedi" if cpu_share is None else
                 f"hub bir çekirdeğin %{cpu_share * 100:.1f}'ini kullandı (tavan %{cpu_ceiling * 100:.0f})"))
    return rows


def _per(before, after, name):
    """(count, total ms) of one timing between two readings; zeros when absent."""
    a, b = (before or {}).get(name), (after or {}).get(name)
    if not b:
        return 0, 0
    a = a or [0] * len(b)
    return b[0] - a[0], b[1] - a[1]


def breakdown(before, after, share=0.4, connect_share=0.25):
    """Per-batch phases from two /v1/status readings, and the decision-table row(s) they give.

    A: the journal scans. B: the commits. C: the connection. D: the hub's parsing of a request.
    E: time spent between the worker and the hub handler. "-": nothing dominates. "?": no batches.
    """
    hub_a, hub_b = before.get("timings") or {}, after.get("timings") or {}
    beat = lambda status: ((status.get("collector") or {}).get("heartbeat") or {}).get("timings") or {}
    work_a, work_b = beat(before), beat(after)
    h = lambda name: _per(hub_a, hub_b, name)[1]
    w = lambda name: _per(work_a, work_b, name)[1]
    n, m = _per(hub_a, hub_b, "packets_ms")[0], _per(work_a, work_b, "flush_ms")[0]
    lines, rows = [], []
    if n:
        lines.append(f"hub, per batch of {_per(hub_a, hub_b, 'batch_events')[1] / n:.1f} events: "
                     + ", ".join(f"{k} {h(k) / n:.1f} ms" for k in ("packets_ms", "body_ms", "validate_ms",
                                 "append_ms", "lock_wait_ms", "expire_ms", "capacity_ms", "insert_ms",
                                 "commit_ms", "consume_ms")))
    if m:
        lines.append(f"worker, per batch of {_per(work_a, work_b, 'batch_events')[1] / m:.1f} events: "
                     + ", ".join(f"{k} {w(k) / m:.1f} ms" for k in ("flush_ms", "pending_ms", "post_ms",
                                 "connect_ms", "ack_ms")))
        journal = sum(w(k) for k in ("append_ms", "pending_ms", "ack_ms", "snapshot_ms"))
        lines.append(f"worker journal, all operations: {journal} ms, of which expire {w('expire_ms')}, "
                     f"capacity {w('capacity_ms')}, commit {w('commit_ms')}, lock wait {w('lock_wait_ms')}")
    else:
        journal = 0
    waiting = (w("pending_ms") + w("ack_ms")) / m if m else 0
    per_batch = w("flush_ms") / m if m else 0
    scans = (w("expire_ms") + w("capacity_ms")) / journal if journal else 0
    commits = w("commit_ms") / journal if journal else 0
    if (n and h("expire_ms") + h("capacity_ms") >= share * h("packets_ms")) or (
            m and waiting >= share * per_batch and scans >= share):
        rows.append("A")
    elif (n and h("commit_ms") >= share * h("packets_ms")) or (m and waiting >= share * per_batch and commits >= share):
        rows.append("B")
    if m and w("connect_ms") >= connect_share * w("flush_ms"):
        rows.append("C")
    if n and h("body_ms") + h("validate_ms") >= share * h("packets_ms"):
        rows.append("D")
    if m and n and (w("post_ms") / m - w("connect_ms") / m - h("packets_ms") / n) >= share * per_batch:
        rows.append("E")
    return lines, rows or (["-"] if n or m else ["?"])


def _read():
    token = next(line.split("=", 1)[1].strip() for line in open(ENV, encoding="utf-8")
                 if line.startswith("INFINITY_VIEWER_TOKEN="))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                         urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA)))
    def get(path):
        request = urllib.request.Request(HUB + path, headers={"Authorization": "Bearer " + token})
        with opener.open(request, timeout=15) as response:
            return json.load(response)
    unit = subprocess.run(["systemctl", "show", "-p", "CPUUsageNSec", "-p", "InvocationID", UNIT],
                          capture_output=True, text=True).stdout
    fields = dict(line.split("=", 1) for line in unit.splitlines() if "=" in line)
    cpu = int(fields["CPUUsageNSec"]) if fields.get("CPUUsageNSec", "").isdigit() else None
    return time.time(), cpu, fields.get("InvocationID"), (get("/v1/status"), get("/infinity-research/state"))


def _summary(stamp, cpu, invocation, reading):
    status, state = reading
    return {"t": stamp, "cpu_ns": cpu, "invocation": invocation,
            "status": {"collector": {"heartbeat": {"queue": {"counters": _counters(status)}}},
                       "archive": {"counters": status.get("archive", {}).get("counters", {})},
                       "timings": {"lag_ms": (status.get("timings") or {}).get("lag_ms")}},
            "state": {k: state.get(k, 0) for k in ("accepted_packets", "old_or_duplicate_packets")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window", type=int, default=60, help="seconds between the two readings")
    parser.add_argument("--since", help="an OZET line printed earlier: judge everything since then")
    parser.add_argument("--cpu-ceiling", type=float, default=CPU_CEILING)
    parser.add_argument("--breakdown", action="store_true",
                        help="print where a batch's time goes and the decision-table row, nothing else")
    args = parser.parse_args()
    if args.breakdown:
        _, _, _, (first, _) = _read()
        time.sleep(args.window)
        _, _, _, (second, _) = _read()
        lines, rows = breakdown(first, second)
        print("\n".join(lines) or "no batches in the window")
        print("ROW: " + " ".join(rows))
        return 0
    if args.since:
        first = json.loads(args.since.split(" ", 1)[-1])
        before = (first["status"], first["state"])
        start, start_cpu, start_invocation = first["t"], first["cpu_ns"], first["invocation"]
        errors_allowed = 10
    else:
        start, start_cpu, start_invocation, before = _read()
        time.sleep(args.window)
        errors_allowed = 0
    stamp, cpu, invocation, after = _read()
    restarted = invocation != start_invocation
    share = None if restarted or cpu is None or start_cpu is None else (cpu - start_cpu) / ((stamp - start) * 1e9)
    print(f"Pencere: {stamp - start:.0f} sn" + ("  — HUB BU ARADA YENİDEN BAŞLADI: CPU ve gecikme sayaçları sıfırlandı,"
                                               " bu pencere geçersiz" if restarted else ""))
    rows = evaluate(before, after, cpu_share=share, cpu_ceiling=args.cpu_ceiling, errors_allowed=errors_allowed)
    for name, passed, text in rows:
        print(f"{'KABUL' if passed else 'RED  '}  {name:15s} {text}")
    print("SONUÇ: " + ("KABUL" if all(r[1] for r in rows) and not restarted else "RED"))
    print("OZET " + json.dumps(_summary(stamp, cpu, invocation, after), separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Green, then commit.** The builder is loaded from the working tree, but it packs the transport files **from `HEAD`**, which is Task 1's commit and holds `infinity_timing.py`. So the release test passes before this task is committed (checked: 3 passed with the builder uncommitted). Run Step 2's command.
Expected: `13 passed`. Then run the full gate (base + timing + release + check). Expected: **`132 passed`**.

```bash
cd /c/tmp/infinity-0a
git add deploy/infinity/build_transport_release.py deploy/infinity/transport_check.py \
        homunculus-engine/tests/test_infinity_release.py homunculus-engine/tests/test_infinity_check.py
git status --short && git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(infinity): a release is a commit's transport code; a read-only acceptance check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: The checker against the real hub (read-only).** The "before" of Task 3.

```bash
cd /c/tmp/infinity-0a
ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'python3 - --window 60' < deploy/infinity/transport_check.py
```
Expected, as on 14.10:
- `RED    kuyruk … en eskisi ~880 sn`
- `RED    gecikme hub gecikme ölçmüyor (timings yok)`
- `RED    canli_gorunum canlı görünüm 0 paket kabul etti, ~3800 eski/tekrar`
- `RED    cihazlar 0/13 cihaz paket akışında`
- `RED    hub_cpu … %45–50`
- `SONUÇ: RED`

Keep the `OZET` line.

**Gate:** 132 passed; the checker runs on the hub; one commit.

---

### Task 3: Deploy the measurement release (R1), measure, decide

**Files:** none in the repo. On the VMs: deploy blocks **H-1** and **W-1** (Turkish, below).

- [ ] **Step 1: Tell the user, and through them biomedical** (Needs the user, 1 and 2). Wait for their go. The user also confirms the time of the worker session.

- [ ] **Step 2: Build R1 outside the repo and stage it in both home directories**

```bash
cd /c/tmp/infinity-0a
/c/tmp/f7-py312/venv/Scripts/python.exe -I deploy/infinity/build_transport_release.py --output /c/tmp/infinity-0a-releases
```
Expected: one JSON line, `{"release": "transport-<16 hex>", "tarball": "…", "sha256": "<64 hex>"}`. Call them R1 and R1_SHA.

```bash
R1=transport-…   # from the line above
for h in 172.100.101.72 172.100.101.74; do
  scp -i ~/.ssh/homunculus_vm -o BatchMode=yes /c/tmp/infinity-0a-releases/$R1.tar.gz sysadmin@$h:/home/sysadmin/
done
```

- [ ] **Step 3: The hub first: block H-1** with `REL=R1`, `SHA=R1_SHA`, `ESKI=70-records.conf`, `ESKI_REL=records-30cfb790074af999`, `YENI=80-transport-0a-olcum.conf`. Expected: `AYNI: yalnız release yolu değişti`, `active`, and `Uvicorn running on https://172.100.101.72:8766` in the last lines.

  Then wait one minute and confirm the hub's own timings are in `/v1/status`:
  ```bash
  ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'python3 - --breakdown --window 30' < deploy/infinity/transport_check.py
  ```
  Expected: a `hub, per batch of … events:` line (the old worker still delivers), and `ROW:` with a letter or `-`.

- [ ] **Step 4: The worker: block W-1**, run by the user, with the same `REL` and `SHA`, `ESKI=50-membership-refresh.conf`, `ESKI_REL=membership-56e8e43eb08a022c`, `YENI=60-transport-0a-olcum.conf`. Hand the user the block **with the values filled in**.
  - Expected from step 0: the old release's `infinity_collector.py` is `66226f6c72f7…`, `infinity_journal.py` is `482158a1fbe7…`, and `infinity_stream.py` is `989414ae02c6…` (HEAD's). If any differs, the measurement still stands, but write it into the report.
  - Then: `DOSYALAR TAMAM`, `AYNI: yalnız release yolu değişti`, `active`, and `clinical forwarding DISABLED` in the last lines.

- [ ] **Step 5: Measure: two 5-minute windows, back to back.** Run each in the foreground, with a Bash timeout of 400000 ms.

```bash
cd /c/tmp/infinity-0a
for i in 1 2; do
  ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'python3 - --breakdown --window 300' < deploy/infinity/transport_check.py
done
```
Run it as two separate calls if one call would pass the 10-minute limit. If the two rows differ, measure a third window, and report all three.
Expected, if the evidence holds: a hub line where `expire_ms` and `capacity_ms` are each ~100 ms of a `packets_ms` of ~250 ms, and a worker line where `pending_ms` and `ack_ms` take a large part of a ~500 ms `flush_ms`. Then `ROW: A`.

- [ ] **Step 6: Report and decide.**
  - Report to the controller: the three breakdown lines, the row, and the `OZET` of a 60 s acceptance run.
  - Rows **A, C, D, E** need no user decision. Run the tasks the table names: A → Tasks 4 and 5.
  - Row **B** needs user decision 5 before Task 8a.
  - `-` or `?`: stop. Do not pick a fix.
  - **Leave R1 running.** It is harmless: the same journal as before, now timed.

  Rollback, if anything misbehaves: blocks **W-geri** then **H-geri**, with `YENI` set to the R1 drop-ins.

**Gate:** both units on R1; the heartbeat carries timings (`--breakdown` prints a worker line); a row reported.

---

### Task 4 (row A): F1 — the journal stops scanning its queue

**Files:**
- Create: `homunculus-engine/tests/test_infinity_journal.py`
- Modify: `homunculus-engine/src/homunculus/edge/infinity_journal.py`

- [ ] **Step 1: The tests.** Create `homunculus-engine/tests/test_infinity_journal.py` with exactly:

```python
"""The journal's cost must not grow with its queue. Synthetic fixtures only.

On 14.10 both journals held ~50,000 rows (~85 MB of encrypted bodies) and every append,
pending and snapshot scanned the whole events table, two scans per batch on the hub alone
(~389 MB/s of page reads). The deeper the queue, the slower each batch, the deeper the queue:
once a hub outage had filled it, the worker never caught up again.
"""
import pytest

from test_infinity_transport import event, factory, inventory  # noqa: F401
from homunculus.edge.infinity_journal import CapacityError


def _work(journal, action):
    """SQLite virtual-machine steps an action takes, in units of 10. Wall time would flake."""
    steps = [0]
    def tick():
        steps[0] += 1
        return 0
    journal.db.set_progress_handler(tick, 10)
    try:
        action()
    finally:
        journal.db.set_progress_handler(None, 10)
    return steps[0]


def _filled(factory, rows, inv):
    journal = factory()
    for start in range(0, rows, 500):
        journal.append([event(inv, stamp=1000) for _ in range(min(500, rows - start))])
    return journal


def test_an_operation_costs_the_same_whatever_the_depth_of_the_queue(factory):
    inv = inventory()
    shallow, deep = _filled(factory, 20, inv), _filled(factory, 3000, inv)
    for name, action in (("append", lambda j: j.append([event(inv)])),
                         ("pending", lambda j: j.pending(32)),
                         ("ack", lambda j: j.ack([e["id"] for e in j.pending(1)])),
                         ("snapshot", lambda j: j.snapshot())):
        small, large = _work(shallow, lambda: action(shallow)), _work(deep, lambda: action(deep))
        # 150 times the rows; a scan makes this ratio about that large.
        assert large <= 2 * small + 50, (name, small, large)


def test_the_running_totals_always_equal_a_recount(factory):
    now = [1000.0]
    inv = inventory()
    journal = factory(clock=lambda: now[0], retention=60, max_rows=4)
    def recount():
        rows, size = journal.db.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM events").fetchone()
        state = journal.snapshot()
        assert (state["rows"], state["encrypted_bytes"]) == (rows, size)
        return rows
    journal.append([event(inv), event(inv)])
    assert recount() == 2
    first = journal.pending(1)[0]["id"]
    journal.ack([first, "not-queued"])
    assert recount() == 1
    with pytest.raises(CapacityError):
        journal.append([event(inv) for _ in range(5)])      # over max_rows: nothing is kept
    assert recount() == 1
    now[0] += 61                                             # the remaining row expires
    journal.append([event(inv)])
    assert recount() == 1 and journal.snapshot()["counters"]["expired"] == 1


def test_an_existing_journal_gains_the_expiry_index_when_opened(tmp_path):
    from cryptography.fernet import Fernet
    from homunculus.edge.infinity_journal import Journal
    key = Fernet.generate_key()
    journal = Journal(tmp_path / "old.sqlite", key)
    journal.append([event()])
    journal.db.execute("DROP INDEX IF EXISTS events_created")    # as written by the old code
    journal.db.commit()
    journal.close()
    reopened = Journal(tmp_path / "old.sqlite", key)
    try:
        names = {row[0] for row in reopened.db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        assert "events_created" in names
        state = reopened.snapshot()
        assert state["rows"] == 1 and state["encrypted_bytes"] > 0     # totals rebuilt on open
    finally:
        reopened.close()
```

The first test counts SQLite virtual-machine steps with `set_progress_handler` rather than wall time, which would flake. The second recounts after every kind of change: add, ack (an unknown id included), a capacity rollback, and expiry. It **passes before the change**: it pins today's numbers so the rewrite cannot move them.

- [ ] **Step 2: See them fail**

```bash
cd /c/tmp/infinity-0a/homunculus-engine
PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_journal.py 2>&1 | grep -E "^E  .*(assert|Error)|passed|failed"
```
Expected: `AssertionError: ('append', 23, 2408)`, the index missing from `sqlite_master`, and `2 failed, 1 passed`.

- [ ] **Step 3: The change.** In `homunculus-engine/src/homunculus/edge/infinity_journal.py`, make these eight replacements:

**1.** Replace:

```python
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
                created REAL NOT NULL, size INTEGER NOT NULL, body BLOB NOT NULL);
```

with:

```python
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
                created REAL NOT NULL, size INTEGER NOT NULL, body BLOB NOT NULL);
            -- Expiry and the oldest row's age read this, not the whole table. Created on the
            -- first open of an older file (one scan, once); older code keeps working with it.
            CREATE INDEX IF NOT EXISTS events_created ON events(created);
```

**2.** Replace:

```python
            self.db.commit()
        except Exception:
            self.db.close()
            raise ValueError("Journal key does not match existing storage.") from None
```

with:

```python
            self.db.commit()
        except Exception:
            self.db.close()
            raise ValueError("Journal key does not match existing storage.") from None
        # Rows and encrypted bytes, counted once here and then kept in step with every
        # commit, so the capacity check no longer sums the whole table on every append.
        self.rows, self.bytes = self.db.execute("SELECT COUNT(*),COALESCE(SUM(size),0) FROM events").fetchone()
        self._delta = [0, 0]
```

**3.** Replace:

```python
        started = self.timings.clock()
        with self.lock:
            self.timings.since("lock_wait_ms", started)
            try:
                yield
                committing = self.timings.clock()
                self.db.commit()
                self.timings.since("commit_ms", committing)
            except BaseException:
                self.db.rollback()
                raise
```

with:

```python
        started = self.timings.clock()
        with self.lock:
            self.timings.since("lock_wait_ms", started)
            self._delta = [0, 0]
            try:
                yield
                committing = self.timings.clock()
                self.db.commit()
                self.timings.since("commit_ms", committing)
            except BaseException:
                self.db.rollback()
                raise
            # Only a committed change moves the totals; a rolled-back batch leaves them be.
            self.rows += self._delta[0]
            self.bytes += self._delta[1]
```

**4.** Replace:

```python
    def _expire(self):
        started = self.timings.clock()
        count = self.db.execute("DELETE FROM events WHERE created < ?", (self.clock() - self.retention,)).rowcount
        self.timings.since("expire_ms", started)
        if count:
            self._increment("expired", count)
```

with:

```python
    def _removed(self, sizes):
        self._delta[0] -= len(sizes)
        self._delta[1] -= sum(size for (size,) in sizes)
        return len(sizes)

    def _expire(self):
        started = self.timings.clock()
        count = self._removed(self.db.execute("DELETE FROM events WHERE created < ? RETURNING size",
                                              (self.clock() - self.retention,)).fetchall())
        self.timings.since("expire_ms", started)
        if count:
            self._increment("expired", count)
```

**5.** Replace:

```python
            started = self.timings.clock()
            size, rows = self.db.execute("SELECT COALESCE(SUM(size),0),COUNT(*) FROM events").fetchone()
            self.timings.since("capacity_ms", started)
```

with:

```python
            started = self.timings.clock()
            size, rows = self.bytes + self._delta[1], self.rows + self._delta[0]
            self.timings.since("capacity_ms", started)
```

**6.** Replace:

```python
                size += len(encrypted)
                rows += 1
```

with:

```python
                size += len(encrypted)
                rows += 1
                self._delta[0] += 1
                self._delta[1] += len(encrypted)
```

**7.** Replace:

```python
        with self._transaction("ack_ms"):
            self.db.executemany("DELETE FROM events WHERE id=?", ((x,) for x in ids))
```

with:

```python
        with self._transaction("ack_ms"):
            for x in ids:
                self._removed(self.db.execute("DELETE FROM events WHERE id=? RETURNING size", (x,)).fetchall())
```

**8.** Replace:

```python
            rows, size, oldest = self.db.execute("SELECT COUNT(*),COALESCE(SUM(size),0),MIN(created) FROM events").fetchone()
            return {"rows": rows, "encrypted_bytes": size,
```

with:

```python
            oldest = self.db.execute("SELECT MIN(created) FROM events").fetchone()[0]
            rows, size = self.rows + self._delta[0], self.bytes + self._delta[1]
            return {"rows": rows, "encrypted_bytes": size,
```

- [ ] **Step 4: Green.** Run Step 2's command. Expected: `3 passed`. Measured after the change, in the same units: append 8 → 8, pending 11 → 15 (32 rows decrypted instead of 20), ack 5 → 5, snapshot 4 → 4. Then run the full gate. Expected: **`135 passed`**.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/infinity-0a
git add homunculus-engine/src/homunculus/edge/infinity_journal.py homunculus-engine/tests/test_infinity_journal.py
git status --short && git diff --cached --stat
git commit -m "$(cat <<'EOF'
fix(infinity): the journal no longer scans its whole queue on every batch

An index on created and running totals of rows and bytes. Both journals held
~50,000 rows on 14.10 and scanned them twice per batch on the hub alone
(~389 MB/s of page reads); once a hub outage had filled the worker's outbox,
delivery never caught up again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 135 passed; two paths.

---

### Task 5 (with F1): F2 — a drained queue waits a moment

**Files:**
- Create: `homunculus-engine/tests/test_infinity_forwarding.py`
- Modify: `homunculus-engine/src/homunculus/edge/infinity_collector.py`

- [ ] **Step 1: The tests.** Create `homunculus-engine/tests/test_infinity_forwarding.py` with exactly:

```python
"""How the worker paces its batches, and what it does with one the hub will never take.

Synthetic fixtures only.
"""
from test_infinity_transport import event, factory, inventory  # noqa: F401
from test_infinity_timing import Steps
from homunculus.edge.infinity_collector import forward_loop


class Recording(Steps):
    def __init__(self, passes, log):
        super().__init__(passes)
        self.log = log

    def wait(self, seconds):
        self.log.append(seconds)
        return self.flag


def test_a_part_batch_waits_a_moment_so_the_hub_gets_batches_not_a_trickle(factory):
    # Sent at once, a healthy queue left as a stream of one- and two-event requests, each
    # costing the hub a TLS handshake and a commit (84% of a core in late September).
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(3)])
    log = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                outbox.append([event(inv)])          # a packet arrives while the batch is out
                return {"ack": [e["id"] for e in body["events"]]}
            return {"ok": True}
    forward_loop(outbox, Hub(), inv, Recording(3, log), "live")
    assert log == [3, 0.25, 1, 0.25, 1, 0.25]


def test_a_full_batch_goes_straight_on_so_a_backlog_drains_at_full_speed(factory):
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(70)])
    log = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                return {"ack": [e["id"] for e in body["events"]]}
            return {"ok": True}
    forward_loop(outbox, Hub(), inv, Recording(4, log), "live")
    assert log == [32, 32, 6, 0.25, 0.25]
```

- [ ] **Step 2: See them fail**

```bash
cd /c/tmp/infinity-0a/homunculus-engine
PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_forwarding.py 2>&1 | grep -E "^E  .*assert|passed|failed"
```
Expected: `assert [3, 1, 1] == [3, 0.25, 1, 0.25, 1, 0.25]`, `assert [32, 32, 6, 0.25] == [32, 32, 6, 0.25, 0.25]`, `2 failed`.

- [ ] **Step 3: The change.** In `homunculus-engine/src/homunculus/edge/infinity_collector.py`, make these two replacements:

**1.** Replace:

```python
IP_PKTINFO = 8  # Linux UAPI, not a portable Winsock constant
IP_MULTICAST_ALL = 49
```

with:

```python
IP_PKTINFO = 8  # Linux UAPI, not a portable Winsock constant
IP_MULTICAST_ALL = 49
# After less than a full batch the queue is drained: let the next packets gather this long.
# Well inside the hub's 3 s live window, and the same pause an empty queue already took.
LINGER = 0.25
```

**2.** Replace:

```python
            sent = flush_once(journal, sender, timings)
            backoff = 0.25
            if not sent:
                stop.wait(0.25)
```

with:

```python
            sent = flush_once(journal, sender, timings)
            backoff = 0.25
            if sent < MAX_BATCH:
                # Sent at once, a drained queue went out as a stream of one- and two-event
                # requests, each costing the hub a TLS handshake and a commit. A full batch
                # means a backlog, and that goes straight on.
                stop.wait(LINGER)
```

- [ ] **Step 4: Green.** Expected: `2 passed`; full gate **`137 passed`**.

- [ ] **Step 5: Commit** `homunculus-engine/src/homunculus/edge/infinity_collector.py` and `homunculus-engine/tests/test_infinity_forwarding.py`, message `fix(infinity): a drained queue waits a moment, so the hub gets batches, not a trickle` (with the trailer).

**Gate:** 137 passed; two paths.

---

### Task 6: K1 — the hub knows a monitor by its address; a batch it will never take is set aside

**Files:**
- Replace whole: `homunculus-engine/tests/test_infinity_forwarding.py`
- Modify: `edge/infinity_collector.py`, `edge/infinity_journal.py`, `edge/infinity_stream.py`, `edge/infinity_hub.py`

Unconditional: it closes the 22.09 trap (`docs/INFINITY-PARAMETER-RECORDS.md:195-210`), whatever Task 3 said. If Task 4 did not run (a row other than A), the journal pairs below do not match. Stop and ask: the quarantine is built on F1's `_removed` and `_delta`.

- [ ] **Step 1: The tests.** Replace `homunculus-engine/tests/test_infinity_forwarding.py` whole with exactly the following. It is Task 5's file with a wider import block and eight more test functions: fourteen more tests, because one is parametrised over seven status codes. It assumes Tasks 4 and 5 ran: their journal internals and their two pacing tests are in it.

```python
"""How the worker paces its batches, and what it does with one the hub will never take.

Synthetic fixtures only.
"""
import http.server
import threading

from fastapi.testclient import TestClient
import pytest

from test_infinity_transport import TOKEN, VIEW, client, event, factory, inventory, post, status  # noqa: F401
from test_infinity_timing import Steps
from homunculus.edge.infinity_collector import Refused, Sender, flush_once, forward_loop
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_stream import Inventory


class Recording(Steps):
    def __init__(self, passes, log):
        super().__init__(passes)
        self.log = log

    def wait(self, seconds):
        self.log.append(seconds)
        return self.flag


def test_a_part_batch_waits_a_moment_so_the_hub_gets_batches_not_a_trickle(factory):
    # Sent at once, a healthy queue left as a stream of one- and two-event requests, each
    # costing the hub a TLS handshake and a commit (84% of a core in late September).
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(3)])
    log = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                outbox.append([event(inv)])          # a packet arrives while the batch is out
                return {"ack": [e["id"] for e in body["events"]]}
            return {"ok": True}
    forward_loop(outbox, Hub(), inv, Recording(3, log), "live")
    assert log == [3, 0.25, 1, 0.25, 1, 0.25]


def test_a_full_batch_goes_straight_on_so_a_backlog_drains_at_full_speed(factory):
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(70)])
    log = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                return {"ack": [e["id"] for e in body["events"]]}
            return {"ok": True}
    forward_loop(outbox, Hub(), inv, Recording(4, log), "live")
    assert log == [32, 32, 6, 0.25, 0.25]


def renamed(inv, new_id):
    """The same monitors at the same addresses, the first one under another name."""
    rows = [{"id": new_id if i == 0 else d.id, "source": d.source, "group": d.group, "port": d.port}
            for i, d in enumerate(inv.devices)]
    return Inventory.parse({"collector_id": inv.collector_id, "interface": inv.interface, "devices": rows})


def test_the_hub_knows_a_monitor_by_its_address_not_by_its_name(factory):
    # K1. On 22.09 a rename left 7,006 rows under the old name in the worker's queue; the hub
    # refused each with 400 and the queue never moved again.
    old = inventory()
    archive = factory()
    c = client(renamed(old, "BED-NEW"), archive)
    assert post(c, [event(old)]).status_code == 200
    row = status(c)["devices"][0]
    assert row["id"] == "BED-NEW" and row["packets"] == 1 and row["status"] == "streaming"


def test_an_address_the_hub_does_not_know_is_still_refused(factory):
    c = client(inventory(1), factory())
    assert post(c, [event(inventory(2), index=1)]).status_code == 400


class _Status(http.server.BaseHTTPRequestHandler):
    code = 200

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = b'{"ack": []}'
        self.send_response(self.code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


@pytest.mark.parametrize("code, refused", [(400, True), (409, True), (413, True),
                                           (401, False), (500, False), (503, False), (507, False)])
def test_only_a_refusal_the_hub_would_repeat_forever_is_final(code, refused):
    handler = type("Handler", (_Status,), {"code": code})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        sender = Sender(f"http://127.0.0.1:{server.server_address[1]}", TOKEN, allow_loopback_http=True)
        with pytest.raises(OSError) as caught:
            sender.post("/v1/packets", {"events": []})
        assert isinstance(caught.value, Refused) is refused
    finally:
        server.shutdown()
        server.server_close()


class Refusing:
    def post(self, path, body):
        raise Refused(400)


def test_a_refused_batch_is_set_aside_and_the_queue_moves_on(factory):
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv), event(inv)])
    assert flush_once(outbox, Refusing()) == 2
    state = outbox.snapshot()
    assert state["rows"] == 0 and state["counters"]["quarantined"] == 2
    assert outbox.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0] == 2
    outbox.append([event(inv)])
    class Accepting:
        def post(self, path, body):
            return {"ack": [e["id"] for e in body["events"]]}
    assert flush_once(outbox, Accepting()) == 1 and outbox.snapshot()["rows"] == 0


def test_a_transient_failure_keeps_the_batch_queued(factory):
    outbox = factory()
    outbox.append([event()])
    class Down:
        def post(self, path, body):
            raise OSError("Receiver refused delivery.")
    with pytest.raises(OSError):
        flush_once(outbox, Down())
    assert outbox.snapshot()["rows"] == 1 and "quarantined" not in outbox.snapshot()["counters"]


def test_set_aside_rows_expire_with_the_queue_retention(factory):
    now = [1000.0]
    outbox = factory(clock=lambda: now[0], retention=60)
    outbox.append([event()])
    flush_once(outbox, Refusing())
    now[0] += 61
    outbox.snapshot()
    assert outbox.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0] == 0


def test_the_22_09_wedge_cannot_recur(factory):
    # The worker's queue holds old-name and new-name rows; the hub knows only the new name.
    old = inventory()
    new = renamed(old, "BED-NEW")
    outbox, archive = factory(), factory()
    outbox.append([event(old) for _ in range(40)] + [event(new) for _ in range(10)])
    c = client(new, archive)
    class Local:
        def post(self, path, body):
            response = c.post(path, json=body, headers={"Authorization": "Bearer " + TOKEN})
            if response.status_code in Refused.FINAL:
                raise Refused(response.status_code)
            assert response.status_code == 200
            return response.json()
    while flush_once(outbox, Local()):
        pass
    assert outbox.snapshot()["rows"] == 0 and archive.snapshot()["rows"] == 50
    assert "quarantined" not in outbox.snapshot()["counters"]


def test_the_hub_accepts_the_quarantine_counter(factory):
    journal = factory()
    c = TestClient(create_hub(inventory(), journal, TOKEN, VIEW))
    queue = {"rows": 0, "encrypted_bytes": 0, "oldest_age_seconds": None, "retention_seconds": 900,
             "counters": {"accepted": 1, "quarantined": 2}}
    beat = {"collector_id": "collector-a", "mode": "live", "queue": queue, "clinical_forwarding": False}
    assert c.post("/v1/heartbeat", json=beat, headers={"Authorization": "Bearer " + TOKEN}).status_code == 200
```

- [ ] **Step 2: See them fail.** Run Task 5's Step 2 command. Expected: `1 error` (collection: `cannot import name 'Refused'`).

- [ ] **Step 3: The worker side.** In `homunculus-engine/src/homunculus/edge/infinity_collector.py`, make these three replacements:

**1.** Replace:

```python
class Sender:
    def __init__
```

with:

```python
class Refused(OSError):
    """The hub answered, and will answer the same batch the same way every time.

    400 (an event its policy rejects), 409 (an id it holds with other content) and 413 (too
    large). Anything else, 401, 5xx and 507 (archive full) included, may pass on a retry.
    """
    FINAL = (400, 409, 413)

    def __init__(self, status):
        super().__init__(f"Receiver refused the batch ({status}).")
        self.status = status


class Sender:
    def __init__
```

**2.** Replace:

```python
            response = connection.getresponse()
            data = response.read(65537)
            if response.status != 200 or len(data) > 65536:
```

with:

```python
            response = connection.getresponse()
            data = response.read(65537)
            if response.status in Refused.FINAL:
                raise Refused(response.status)
            if response.status != 200 or len(data) > 65536:
```

**3.** Replace:

```python
    posting = time.perf_counter()
    result = sender.post("/v1/packets", {"events": batch})
```

with:

```python
    posting = time.perf_counter()
    try:
        result = sender.post("/v1/packets", {"events": batch})
    except Refused as refusal:
        # This hub will refuse this batch every time. Retried, it held the head of the queue
        # for good (22.09: 7,006 rows, none delivered). Set it aside, counted, and move on.
        journal.quarantine([event["id"] for event in batch], refusal.status)
        return len(batch)
```

In `homunculus-engine/src/homunculus/edge/infinity_journal.py`, make these six replacements:

**1.** Replace:

```python
            CREATE INDEX IF NOT EXISTS events_created ON events(created);
```

with:

```python
            CREATE INDEX IF NOT EXISTS events_created ON events(created);
            -- Rows the hub refused for good, still encrypted, kept no longer than the queue.
            CREATE TABLE IF NOT EXISTS quarantine (
                id TEXT PRIMARY KEY, digest TEXT NOT NULL, created REAL NOT NULL,
                size INTEGER NOT NULL, body BLOB NOT NULL, status INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS quarantine_created ON quarantine(created);
```

**2.** Replace:

```python
        started = self.timings.clock()
        count = self._removed(self.db.execute("DELETE FROM events WHERE created < ? RETURNING size",
                                              (self.clock() - self.retention,)).fetchall())
        self.timings.since("expire_ms", started)
```

with:

```python
        started = self.timings.clock()
        cutoff = self.clock() - self.retention
        count = self._removed(self.db.execute("DELETE FROM events WHERE created < ? RETURNING size",
                                              (cutoff,)).fetchall())
        self.db.execute("DELETE FROM quarantine WHERE created < ?", (cutoff,))
        self.timings.since("expire_ms", started)
```

**3.** Replace:

```python
    def append(self, events, *, update_devices=False):
        """Atomic batch: ack only after commit. Same ID with different content is an error."""
```

with:

```python
    def append(self, events, *, update_devices=False, device_ids=None):
        """Atomic batch: ack only after commit. Same ID with different content is an error.

        `device_ids`, when given, names each event's device for the per-device counts in place
        of the label the event carries: the hub's own name for the address (K1).
        """
```

**4.** Replace:

```python
            for event in events:
                plain = canonical(event)
```

with:

```python
            for index, event in enumerate(events):
                plain = canonical(event)
```

**5.** Replace:

```python
                        (event["device_id"], event["received_at"], event["payload_bytes"], event["payload_bytes"], event["mode"]))
```

with:

```python
                        (device_ids[index] if device_ids else event["device_id"], event["received_at"],
                         event["payload_bytes"], event["payload_bytes"], event["mode"]))
```

**6.** Replace:

```python
    def snapshot(self):
```

with:

```python
    def quarantine(self, ids, status):
        """Move rows the hub refused for good out of the queue, counted as `quarantined`."""
        with self._transaction():
            moved = []
            for x in ids:
                for row in self.db.execute("DELETE FROM events WHERE id=? RETURNING id,digest,created,size,body",
                                           (x,)).fetchall():
                    self.db.execute("INSERT OR REPLACE INTO quarantine VALUES (?,?,?,?,?,?)", (*row, status))
                    moved.append((row[3],))
            if self._removed(moved):
                self._increment("quarantined", len(moved))

    def snapshot(self):
```

- [ ] **Step 4: The contract and the hub.** In `homunculus-engine/src/homunculus/edge/infinity_stream.py`, make this replacement. The worker keeps `match_name=True` (the default): it still checks its own names.

**1.** Replace:

```python
def validate_event(event, inventory):
    """Reject arbitrary metadata/clinical fields; failures never echo packet content."""
    try:
        if set(event) != {"schema", "id", "collector_id", "device_id", "source_ip", "group", "source_port",
                          "port", "received_at", "mode", "payload_bytes", "sha256", "payload_base64"}:
            raise ValueError
        device = inventory.lookup(event["source_ip"], event["group"], event["port"])
        if (event["schema"] != SCHEMA or event["collector_id"] != inventory.collector_id
                or not device or device.id != event["device_id"] or event["mode"] not in ("live", "replay")
```

with:

```python
def validate_event(event, inventory, *, match_name=True):
    """Reject arbitrary metadata/clinical fields; failures never echo packet content.

    The device is the address: (source, group, port). With `match_name=False` (the hub, K1)
    the name the event carries need only be a well-formed name, not this inventory's, so a
    monitor renamed on one side is still delivered and a queue holding the old name drains.
    """
    try:
        if set(event) != {"schema", "id", "collector_id", "device_id", "source_ip", "group", "source_port",
                          "port", "received_at", "mode", "payload_bytes", "sha256", "payload_base64"}:
            raise ValueError
        device = inventory.lookup(event["source_ip"], event["group"], event["port"])
        named = (device.id == event["device_id"] if match_name and device else
                 isinstance(event["device_id"], str) and IDENTIFIER.fullmatch(event["device_id"]))
        if (event["schema"] != SCHEMA or event["collector_id"] != inventory.collector_id
                or not device or not named or event["mode"] not in ("live", "replay")
```

In `homunculus-engine/src/homunculus/edge/infinity_hub.py`, make these three replacements:

**1.** Replace:

```python
            for event in data["events"]:
                validate_event(event, inventory)
```

with:

```python
            for event in data["events"]:
                validate_event(event, inventory, match_name=False)
```

**2.** Replace:

```python
            ack = journal.append(data["events"], update_devices=True)
```

with:

```python
            ack = journal.append(data["events"], update_devices=True, device_ids=[
                inventory.lookup(e["source_ip"], e["group"], e["port"]).id for e in data["events"]])
```

**3.** Replace:

```python
"membership_refresh_scheduled", "membership_refresh_silence", "membership_refresh_failed"})
```

with:

```python
"membership_refresh_scheduled", "membership_refresh_silence", "membership_refresh_failed", "quarantined"})
```

- [ ] **Step 5: Green.** Expected: `16 passed` for the file; full gate **`151 passed`**. `test_event_contract_rejects_ambiguous_data` (with `{"device_id": "other"}`) still passes: the worker-side default still matches names.

- [ ] **Step 6: Commit** the five paths, message `fix(infinity): the hub knows a monitor by its address; a batch it will never take is set aside` (with the trailer).

**Gate:** 151 passed; five paths.

---

### Task 7: The hub's TLS certificate, renewed under its CA

**Files:**
- Create: `deploy/infinity/renew_hub_certificate.py`, `homunculus-engine/tests/test_infinity_certificate.py`

The leaf ends **20.12.2026 10:52 UTC**. Task 9 applies it; the latest safe day is **06.12.2026**, two weeks' margin. If Task 9 slips past that, apply this task alone (block **C-2**).

- [ ] **Step 1: The tests.** Create `homunculus-engine/tests/test_infinity_certificate.py` with exactly:

```python
"""Renewing the research hub's TLS leaf under its existing CA. Synthetic keys only."""
import datetime as dt
import importlib.util
import json
from pathlib import Path

import pytest
from cryptography import x509

ROOT = Path(__file__).resolve().parents[2]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pilot = _load("pilot_activation_for_renewal", "deploy/infinity/activate_pilot.py")
renewal = _load("renew_hub_certificate", "deploy/infinity/renew_hub_certificate.py")


@pytest.fixture(scope="module")
def authority():
    return pilot.issue_tls("127.0.0.1")       # a CA and a first leaf, as activation made them


def test_a_renewed_leaf_is_trusted_through_the_same_ca(authority, tmp_path, monkeypatch):
    from test_infinity_pilot_activation import BaseHTTPRequestHandler, ThreadingHTTPServer, ssl, threading
    now = dt.datetime.now(dt.timezone.utc)
    cert_pem, key_pem = renewal.issue_leaf(authority["ca.pem"], authority["ca-key.pem"], "127.0.0.1", now)
    (tmp_path / "server.pem").write_bytes(cert_pem)
    (tmp_path / "server-key.pem").write_bytes(key_pem)
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"renewed":true}')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(tmp_path / "server.pem", tmp_path / "server-key.pem")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(pilot, "ENDPOINT", f"https://127.0.0.1:{server.server_port}")
    try:
        # The worker and the API hold the CA, never the leaf: the old CA must trust the new leaf.
        assert json.loads(pilot.fetch(authority["ca.pem"].decode())) == {"renewed": True}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    ca = x509.load_pem_x509_certificate(authority["ca.pem"])
    leaf = x509.load_pem_x509_certificate(cert_pem)
    old = x509.load_pem_x509_certificate(authority["server.pem"])
    assert leaf.not_valid_after_utc <= ca.not_valid_after_utc - dt.timedelta(days=1)
    assert leaf.not_valid_after_utc > now + dt.timedelta(days=300)
    assert leaf.public_key().public_numbers() != old.public_key().public_numbers()


def test_a_ca_at_its_end_is_not_renewed_under(authority):
    ca = x509.load_pem_x509_certificate(authority["ca.pem"])
    with pytest.raises(ValueError, match="CA"):
        renewal.issue_leaf(authority["ca.pem"], authority["ca-key.pem"], "127.0.0.1",
                           ca.not_valid_after_utc - dt.timedelta(hours=12))


def test_install_keeps_the_current_pair_and_never_overwrites_a_backup(tmp_path):
    (tmp_path / "server.pem").write_bytes(b"old certificate")
    (tmp_path / "server-key.pem").write_bytes(b"old key")
    renewal.install(tmp_path, b"new certificate", b"new key", "20261201T000000Z")
    assert (tmp_path / "server.pem").read_bytes() == b"new certificate"
    assert (tmp_path / "server-key.pem").read_bytes() == b"new key"
    assert (tmp_path / "server.pem.bak-20261201T000000Z").read_bytes() == b"old certificate"
    assert (tmp_path / "server-key.pem.bak-20261201T000000Z").read_bytes() == b"old key"
    with pytest.raises(ValueError):
        renewal.install(tmp_path, b"third", b"third key", "20261201T000000Z")
    assert (tmp_path / "server.pem").read_bytes() == b"new certificate"
    assert not list(tmp_path.glob("*.new"))
```

- [ ] **Step 2: See them fail.** Expected: `1 error` (the script is missing).
- [ ] **Step 3: The script.** Create `deploy/infinity/renew_hub_certificate.py` with exactly:

```python
"""Renew the Infinity research hub's TLS leaf under its existing private CA. Hub only.

The worker and the API trust the CA (`/etc/homunculus-infinity-pilot/ca.pem` on the worker,
`/etc/homunculus/infinity-ca.pem` for the API), never the leaf, so neither changes. The CA key
is read here and never copied anywhere. The current pair is kept beside the new one as
`.bak-<UTC stamp>`; putting it back and restarting the hub is the rollback. This script does
not restart anything. Without `--apply` it only reports.

The CA itself ends one year after activation (21.09.2027 on this site). The leaf is issued to
a day before that, and renewal refuses once the CA is that close: replacing the CA means
giving the worker and the API the new one, which is a separate, announced change.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import os
from pathlib import Path
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CONFIG = Path("/etc/homunculus-infinity-pilot")
ADDRESS = "172.100.101.72"
LIFETIME = dt.timedelta(days=365)
MARGIN = dt.timedelta(days=1)


def issue_leaf(ca_pem, ca_key_pem, address, now):
    """A new key and leaf, shaped as activation shaped the first one, signed by the same CA."""
    ca = x509.load_pem_x509_certificate(ca_pem)
    ca_key = serialization.load_pem_private_key(ca_key_pem, password=None)
    if not ca.not_valid_before_utc <= now < ca.not_valid_after_utc - MARGIN:
        raise ValueError("The CA itself is at its end; the CA must be replaced, not the leaf renewed.")
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    leaf = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Infinity research hub")]))
            .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(min(now + LIFETIME, ca.not_valid_after_utc - MARGIN))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(address))]),
                           critical=False)
            .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, None, None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    leaf.verify_directly_issued_by(ca)
    return (leaf.public_bytes(serialization.Encoding.PEM),
            key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()))


def install(config, cert_pem, key_pem, stamp):
    """Back the current pair up, then put the new pair in place with the same owner and mode."""
    pairs = (("server-key.pem", key_pem), ("server.pem", cert_pem))
    if any((config / f"{name}.bak-{stamp}").exists() for name, _ in pairs):
        raise ValueError("A backup with this stamp exists; nothing changed.")
    staged = []
    for name, data in pairs:
        current, new = config / name, config / f"{name}.new"
        info = current.stat()
        (config / f"{name}.bak-{stamp}").write_bytes(current.read_bytes())
        new.write_bytes(data)
        for path in (config / f"{name}.bak-{stamp}", new):
            os.chmod(path, info.st_mode & 0o777)
            if hasattr(os, "chown"):
                os.chown(path, info.st_uid, info.st_gid)
        staged.append((new, current))
    for new, current in staged:          # the key first, then the certificate
        os.replace(new, current)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the new pair (default: report only)")
    args = parser.parse_args()
    current = x509.load_pem_x509_certificate((CONFIG / "server.pem").read_bytes())
    names = current.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    if names.get_values_for_type(x509.IPAddress) != [ipaddress.ip_address(ADDRESS)]:
        raise SystemExit("The current certificate does not name " + ADDRESS + "; nothing changed.")
    now = dt.datetime.now(dt.timezone.utc)
    print("current leaf expires: " + current.not_valid_after_utc.isoformat())
    if not args.apply:
        print("Report only. Run again with --apply to renew; the hub is not restarted by this script.")
        return 0
    if sys.platform != "linux" or os.geteuid() != 0:
        raise SystemExit("Run on the hub with sudo.")
    cert_pem, key_pem = issue_leaf((CONFIG / "ca.pem").read_bytes(), (CONFIG / "ca-key.pem").read_bytes(),
                                   ADDRESS, now)
    install(CONFIG, cert_pem, key_pem, now.strftime("%Y%m%dT%H%M%SZ"))
    renewed = x509.load_pem_x509_certificate(cert_pem)
    print("RENEWED: new leaf expires " + renewed.not_valid_after_utc.isoformat()
          + "; restart homunculus-infinity-pilot-hub to use it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Green.** Expected: `3 passed`; full gate **`154 passed`**.
- [ ] **Step 5: Commit** the two paths, message `feat(infinity): renew the hub's TLS leaf under its existing CA` (with the trailer).

**Gate:** 154 passed.

---

### Task 8 (conditional): only what Task 3's row selects

**Not replayed.** Each sub-task is TDD like the others: write the named tests, see them red, implement, see the gate grow by exactly their number, and commit alone. Each ships in R2 only if its row fired. **If none fired, skip this task.**

- **8a, F3, row B, after user decision 5.**
  - **Change:** `Journal(…, fast_commits=False)`. When true, `PRAGMA journal_mode=WAL` and `PRAGMA synchronous=NORMAL`, in place of `DELETE`/`FULL` (`edge/infinity_journal.py`, the two `PRAGMA` lines). The runner gets `--fast-commits`; it reaches the service only through a new drop-in.
  - **Tests** (in `test_infinity_journal.py`):
    - `test_fast_commits_use_the_write_ahead_log`: reads back `wal` and `1`.
    - `test_a_fast_journal_reopens_in_the_old_mode`: opened fast, closed, reopened default, reads `delete`; this is the rollback path.
  - **Gate:** +2.
- **8b, F4, rows B or D.**
  - **Change:** in `edge/infinity_stream.py`, `MAX_ACCEPT = 128` (the hub's limit, `edge/infinity_hub.py:110`), with `MAX_BATCH` staying the default send size. The runner gets `--send-batch N` (1 ≤ N ≤ `MAX_ACCEPT`, default 32), and `flush_once` takes it.
  - **Tests:**
    - `test_the_hub_takes_128_and_refuses_129`;
    - `test_the_worker_never_sends_more_than_its_send_batch`.
  - **Deploy:** the hub on R2 first. Then a **separate, later** worker drop-in adds `--send-batch 128`, after the hub is confirmed (otherwise the batch is refused with 400 and quarantined).
  - **Gate:** +2.
- **8c, F5, row C.**
  - **Change:** `Sender` keeps one connection. On any exception it closes the connection and re-raises; the loop's retry reconnects.
  - **Tests** (real loopback `http.server`, like Task 1's `_Ack`):
    - `test_two_posts_share_one_connection`: `connect_ms` count 1;
    - `test_a_closed_connection_is_reopened_on_the_next_post`: count 2, both posts answered.
  - **Gate:** +2.
- **8d, F7, row E.**
  - **Change:** `ack = await run_in_threadpool(journal.append, data["events"], update_devices=True, device_ids=…)` in `packets` (Starlette's `run_in_threadpool`).
  - **Test:** `test_status_answers_while_a_batch_is_being_written`. A journal stand-in blocks `append` on a `threading.Event`; `/v1/status` must answer before the event is set.
  - **Gate:** +1.
- **F6 (newest-first)**: only after Task 9, if the drain after the worker's restart takes more than 10 minutes, **and** after user decision 4. Its tests:
  - `test_a_backlog_is_sent_newest_first_but_each_batch_oldest_first`;
  - `test_the_live_view_accepts_every_packet_of_a_newest_first_batch`.

---

### Task 9: Deploy the fix release (R2) and the certificate; first acceptance

**Files:** none in the repo. On the VMs: blocks **H-2**, **C-2**, **W-2** (Turkish, below).

- [ ] **Step 1: Tell the user, and through them biomedical** (Needs the user, 2). Confirm the worker session's time.
- [ ] **Step 2: Build R2** from the branch's tip, exactly as in Task 3 Step 2. Expect a different name, because the code changed. Stage it in both home directories. Also copy the certificate script: `scp … deploy/infinity/renew_hub_certificate.py sysadmin@172.100.101.72:/home/sysadmin/`.
- [ ] **Step 3: The hub on R2: block H-2** (`ESKI=80-transport-0a-olcum.conf`, `ESKI_REL=<R1>`, `YENI=90-transport-0a-duzeltme.conf`).
  - On its first start the hub builds the index on its archive (one scan, a second or two) before it listens.
  - Expected: `active`, `Uvicorn running`.
  - Then `--breakdown --window 60`. Expected: the hub line's `expire_ms` and `capacity_ms` near 0, and `packets_ms` down by an order of magnitude. The worker is still on R1, so it is still slow.
- [ ] **Step 4: The certificate: block C-2.**
  - Expected: `RENEWED: new leaf expires 2027-09-…`, `active`, `Verify return code: 0 (ok)`, `notAfter=Sep … 2027 GMT`.
  - Within 15 s, the worker's next heartbeat reconnects through the same CA. Confirm with `--breakdown --window 30` (a worker line).
  - Keep the printed backup stamp: it is the rollback (**C-geri**).
- [ ] **Step 5: The worker on R2: block W-2**, run by the user (`ESKI=60-transport-0a-olcum.conf`, `ESKI_REL=<R1>`, `YENI=70-transport-0a-duzeltme.conf`).
  - The worker builds its index (one scan of ~85 MB), then drains the backlog: ~52,000 rows, full batches, no pause between them.
- [ ] **Step 6: Watch the drain (read-only), every 2 minutes until the queue is small.**

```bash
ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'bash ~/g115/hub_sample.sh'
```
Expected: `worker queue rows` falling by tens of thousands per minute, `oldest_age_s` falling to ≤ 1–2 s, and the device states becoming `streaming`. Desk estimate: 2–3 minutes. **If it takes more than 10 minutes**, that is F6's trigger (user decision 4).

- [ ] **Step 7: First acceptance**, about 15 minutes after the drain:

```bash
cd /c/tmp/infinity-0a
ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'python3 - --window 300' < deploy/infinity/transport_check.py \
  | tee /c/tmp/infinity-0a-releases/kabul-t0.txt
grep '^OZET' /c/tmp/infinity-0a-releases/kabul-t0.txt > /c/tmp/infinity-0a-releases/t0-ozet.txt
ssh -i ~/.ssh/homunculus_vm -o BatchMode=yes sysadmin@172.100.101.72 'python3 - --breakdown --window 300' < deploy/infinity/transport_check.py
```
Expected: `SONUÇ: KABUL` and `ROW: -`. `t0-ozet.txt` is T0 for Task 10. It holds counters only, and lives outside the repo. Then the worker's CPU (Kabul, command 2). If the first check is `RED`, the line names the criterion. Do not change anything to pass it; report it.

**Gate:** both units on R2, the new certificate served, KABUL on a 5-minute window, the T0 `OZET` kept.

---

### Task 10: The 24-hour watch

- [ ] **Step 1:** At about +1 h and +6 h, run the 60-second check (Kabul, command 1). These catch a transient that the day's totals would average away.
- [ ] **Step 2:** At +24 h, run the day's check, with T0's `OZET` line as `--since` (Kabul, command 3). Expected: `SONUÇ: KABUL`, with the window ≈ 86,400 s and no `HUB BU ARADA YENİDEN BAŞLADI`. If the hub restarted, the day is void for lag and CPU: the counters were reset. Restart the 24 h from a new T0, and report why the hub restarted.
- [ ] **Step 3:** The worker's CPU over a minute (Kabul, command 2), and the user looks at the hub page or the device screen with biomedical: 13 devices fresh, values updating.
- [ ] **Step 4: Report.** The four check outputs, the breakdown, the worker CPU, any device listed in `cihazlar` and what biomedical said about it (a switched-off monitor is not a transport failure).

**Gate:** KABUL over 24 hours.

---

### Task 11: The documents, as deployed

**Files:** `deploy/infinity/README.md`, `docs/INFINITY-PARAMETER-RECORDS.md`, `docs/homunculus-rehber-TR.md`. Run only after Task 10 passes, and write what was measured, not this plan's predictions.

- [ ] **`deploy/infinity/README.md`**, a new section `## Transport releases (Aşama 0a, <date>)`:
  - the two release names, their commits (`RELEASE.json`) and drop-ins on each VM;
  - how to build (`build_transport_release.py`), install (blocks H-x/W-x of this plan, or their description) and roll back;
  - `transport_check.py` and its two modes;
  - `renew_hub_certificate.py` and the new expiry date;
  - **"`build_pilot_bundle.py` and `enable_continuous_research.py` are superseded: they predate `infinity_records` and `infinity_timing`, and a hub built with them would not start."**
- [ ] **`docs/INFINITY-PARAMETER-RECORDS.md`**, under §"Yatak adları ve bir işletim tuzağı", after "Açık düzeltme:", a Turkish paragraph `**Kapandı (<tarih>):**` saying:
  - the hub now recognises a device by its address `(kaynak, grup, port)`, so a renamed id is no longer refused (K1);
  - a batch the hub refuses for good (400/409/413) is set aside in the worker's `quarantine` table and counted as `quarantined`, so the queue head cannot wedge;
  - renaming is still done on both sides together, but the order no longer matters;
  - the two tests: `test_the_22_09_wedge_cannot_recur`, `test_the_hub_knows_a_monitor_by_its_address_not_by_its_name`.
- [ ] **`docs/homunculus-rehber-TR.md`**, next to its Infinity lines (around 1010–1024), one short paragraph in Turkish:
  - the research transport was ~15 min late from 02.10 and has been fixed; delivery is now within seconds;
  - the check command;
  - the certificate's new expiry.
- [ ] Commit the three paths, `docs(infinity): Aşama 0a as deployed` (with the trailer).

---

## Dağıtım blokları (Türkçe, kopyala-yapıştır)

**Ortak kurallar:**
- Her adım `/opt/homunculus-infinity/` altına **yeni, değiştirilmeyen** bir release klasörü ve **daha yüksek numaralı yeni** bir drop-in ekler. Var olan release'lere ve drop-in'lere dokunulmaz.
- **Önce hub, sonra worker.** Worker adımı, hub adımı doğrulanmadan başlamaz.
- **Geri alma:** en yeni drop-in silinir, `daemon-reload` yapılır, yalnız o servis yeniden başlatılır. Release klasörü yerinde kalır; zararsızdır.
- **Envanter (`inventory.json`), anahtarlar, `.env` dosyaları ve kuyruk dosyaları değişmez. Cihaz adları değiştirilmez.**
- Her blok `bash -eu -o pipefail` içinde çalışır. Bir adım hata verirse blok orada durur ve oturum açık kalır.
- `sudo` ilk seferde parola sorar. Worker'da parolayı kullanıcı girer.
- Ajan, bloğu kullanıcıya `REL` ve `SHA` değerleri **doldurulmuş** olarak verir. Bu değerleri Task 3 ve Task 9'daki derleme satırı üretir.

### H-1 / H-2 — hub (ajan, geçici parolasız sudo duruyorsa; durmuyorsa kullanıcı)

H-1 (ölçüm): `ESKI=70-records.conf`, `ESKI_REL=records-30cfb790074af999`, `YENI=80-transport-0a-olcum.conf`.
H-2 (düzeltme): `ESKI=80-transport-0a-olcum.conf`, `ESKI_REL=<R1>`, `YENI=90-transport-0a-duzeltme.conf`.

```bash
bash -eu -o pipefail <<'BLOK'
REL=transport-XXXXXXXXXXXXXXXX          # yeni release'in adı
SHA=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX   # arşivin sha256'sı
ESKI=70-records.conf                    # şu an en yeni drop-in
ESKI_REL=records-30cfb790074af999        # onun kullandığı release
YENI=80-transport-0a-olcum.conf          # eklenecek drop-in
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
# 1) Arşiv doğru mu, bu ad daha önce kurulmamış mı?
echo "$SHA  $HOME/$REL.tar.gz" | sha256sum -c -
sudo test ! -e /opt/homunculus-infinity/$REL || { echo "BU RELEASE ZATEN KURULU: durdum, hiçbir şey değişmedi"; exit 1; }
# 2) Release'i aç, her dosyayı doğrula, sahipliği öncekilerle aynı yap
#    (Kontrol ve diff ayrı satırda: "a && b" biçiminde set -e, a'nın hatasında durmaz.)
sudo tar -xzf "$HOME/$REL.tar.gz" -C /opt/homunculus-infinity --no-same-owner
sudo sh -c "cd /opt/homunculus-infinity/$REL; sha256sum -c --quiet SHA256SUMS"
echo "DOSYALAR TAMAM"
sudo chown -R root:homunculus-infinity-pilot /opt/homunculus-infinity/$REL
sudo chmod -R u=rwX,g=rX,o= /opt/homunculus-infinity/$REL
# 3) Yeni drop-in: eskisinin aynısı, yalnız release yolu farklı
sudo test ! -e $D/$YENI || { echo "BU DROP-IN ZATEN VAR: durdum"; exit 1; }
sed "s#$ESKI_REL#$REL#g; 1s#.*#\# Homunculus transport 0a: $REL#" $D/$ESKI | sudo tee $D/$YENI >/dev/null
diff <(sed "s#$ESKI_REL#R#g" $D/$ESKI | grep -v '^#') <(sed "s#$REL#R#g" $D/$YENI | grep -v '^#')
echo "AYNI: yalnız release yolu değişti"
# 4) Yalnız bu servisi yeniden başlat
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8
systemctl is-active $UNIT
journalctl -u $UNIT -n 4 --no-pager
BLOK
```

### W-1 / W-2 — worker (kullanıcı; sudo parola ister)

W-1 (ölçüm): `ESKI=50-membership-refresh.conf`, `ESKI_REL=membership-56e8e43eb08a022c`, `YENI=60-transport-0a-olcum.conf`.
W-2 (düzeltme): `ESKI=60-transport-0a-olcum.conf`, `ESKI_REL=<R1>`, `YENI=70-transport-0a-duzeltme.conf`. W-2'de 0. adım R1'in dosyalarını okur; karşılaştırma gerekmez.

```bash
bash -eu -o pipefail <<'BLOK'
REL=transport-XXXXXXXXXXXXXXXX
SHA=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ESKI=50-membership-refresh.conf
ESKI_REL=membership-56e8e43eb08a022c
YENI=60-transport-0a-olcum.conf
UNIT=homunculus-infinity-pilot-worker
D=/etc/systemd/system/$UNIT.service.d
# 0) (yalnız W-1) Bugün çalışan kod repodaki kod mu? Yalnız okur.
sudo sha256sum /opt/homunculus-infinity/$ESKI_REL/app/src/homunculus/edge/infinity_{collector,journal,stream}.py
# 1)–4) hub bloğuyla aynı
echo "$SHA  $HOME/$REL.tar.gz" | sha256sum -c -
sudo test ! -e /opt/homunculus-infinity/$REL || { echo "BU RELEASE ZATEN KURULU: durdum, hiçbir şey değişmedi"; exit 1; }
sudo tar -xzf "$HOME/$REL.tar.gz" -C /opt/homunculus-infinity --no-same-owner
sudo sh -c "cd /opt/homunculus-infinity/$REL; sha256sum -c --quiet SHA256SUMS"
echo "DOSYALAR TAMAM"
sudo chown -R root:homunculus-infinity-pilot /opt/homunculus-infinity/$REL
sudo chmod -R u=rwX,g=rX,o= /opt/homunculus-infinity/$REL
sudo test ! -e $D/$YENI || { echo "BU DROP-IN ZATEN VAR: durdum"; exit 1; }
sed "s#$ESKI_REL#$REL#g; 1s#.*#\# Homunculus transport 0a: $REL#" $D/$ESKI | sudo tee $D/$YENI >/dev/null
diff <(sed "s#$ESKI_REL#R#g" $D/$ESKI | grep -v '^#') <(sed "s#$REL#R#g" $D/$YENI | grep -v '^#')
echo "AYNI: yalnız release yolu değişti"
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8
systemctl is-active $UNIT
journalctl -u $UNIT -n 4 --no-pager
BLOK
```

Beklenen çıktı:
- 0\. adımda üç satır. İlk 12 hanesi `66226f6c72f7…` (collector), `482158a1fbe7…` (journal) ve `989414ae02c6…` (stream) olmalı.
- Sonra `…tar.gz: OK`, `DOSYALAR TAMAM`, `AYNI: yalnız release yolu değişti` ve `active`.
- Son satırlarda `Infinity research transport; clinical forwarding DISABLED.` görünmeli.

Kullanıcı çıktıyı ajana yapıştırır. Token ya da anahtar yazdırılmaz.

### C-2 — hub sertifikası (ajan ya da kullanıcı, H-2'den sonra)

```bash
bash -eu -o pipefail <<'BLOK'
P=/opt/homunculus-infinity/pilot/.venv/bin/python
sudo $P $HOME/renew_hub_certificate.py            # yalnız rapor: bugünkü bitiş tarihi
sudo $P $HOME/renew_hub_certificate.py --apply    # yeni anahtar ve sertifika; eskiler .bak-<damga> olarak kalır
sudo ls /etc/homunculus-infinity-pilot/ | grep '^server.*\.bak-' | tail -2     # geri dönüş için damgayı not et
sudo systemctl restart homunculus-infinity-pilot-hub
sleep 8
systemctl is-active homunculus-infinity-pilot-hub
echo | openssl s_client -connect 172.100.101.72:8766 -CAfile /etc/homunculus/infinity-ca.pem 2>/dev/null \
  | grep "Verify return code"
echo | openssl s_client -connect 172.100.101.72:8766 2>/dev/null | openssl x509 -noout -enddate
BLOK
```
Worker ve API'de hiçbir şey değişmez: ikisi de sertifikaya değil, CA'ya güvenir.

### Geri alma blokları

**W-geri (kullanıcı)**, `YENI`'ye en son eklenen worker drop-in'i yazılır:
```bash
bash -eu <<'BLOK'
YENI=70-transport-0a-duzeltme.conf
UNIT=homunculus-infinity-pilot-worker
sudo rm /etc/systemd/system/$UNIT.service.d/$YENI
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8; systemctl is-active $UNIT
BLOK
```
**H-geri**: aynısı, `UNIT=homunculus-infinity-pilot-hub` ve hub'ın en yeni drop-in'i ile.

**C-geri** (hub):
```bash
bash -eu <<'BLOK'
C=/etc/homunculus-infinity-pilot; S=20261201T000000Z     # C-2'de not edilen damga
sudo cp -p $C/server-key.pem.bak-$S $C/server-key.pem
sudo cp -p $C/server.pem.bak-$S $C/server.pem
sudo systemctl restart homunculus-infinity-pilot-hub
sleep 8; systemctl is-active homunculus-infinity-pilot-hub
BLOK
```

**Geri alma sırası:** önce worker, sonra hub. Task 1'den sonra sıra karışsa da teslim durmaz: eski bir hub yeni heartbeat'i reddeder ve worker yine de paket göndermeye devam eder. Yalnız "toplayıcı bağlı" göstergesi söner. **Bir istisna:** 8b'nin `--send-batch 128` drop-in'i varsa, hub geri alınmadan **önce** o drop-in silinmelidir. Yoksa eski hub 128'lik batch'leri reddeder ve worker onları karantinaya alır.

---

## Kabul (Türkçe)

**Ne zaman kabul edilir?** Aşağıdaki ölçütlerin hepsi önce Task 9'un 5 dakikalık penceresinde, sonra 24 saat boyunca sağlanmalıdır. Ölçütler `deploy/infinity/transport_check.py` dosyasının başında sabit olarak yazılıdır. Hepsi mühendislik eşiğidir, hiçbiri klinik değildir; kullanıcı değiştirebilir.

| Ölçüt | Ne ölçülür | Eşik | Kaynak |
|---|---|---|---|
| `kuyruk` | Worker kuyruğunda bekleyen en eski satırın yaşı | ≤ 3 sn | worker heartbeat'i (`oldest_age_seconds`) |
| `gecikme` | Canlı paketlerin hub'a varış gecikmesi | paketlerin ≥ %99'u ≤ 3000 ms, ortalama ≤ 1000 ms | hub `timings.lag_ms` |
| `suresi_dolan` | Süresi dolduğu için silinen satır | 0 | worker `expired` sayacı |
| `aktarim_hatasi` | Aktarım hatası | pencerede 0; 24 saatte ≤ 10 | worker `forward_errors` |
| `karantina` | Hub'ın kalıcı olarak reddettiği satır | 0 | worker `quarantined` |
| `canli_gorunum` | Canlı görünümün, hub'ın arşivlediği paketlerden kabul ettiği pay | ≥ %90 | `/infinity-research/state` |
| `cihazlar` | Cihaz durumları | 13/13 `streaming`; canlı görünümde `streaming` ya da `no_parameters` (standby) | `/v1/status`, `/infinity-research/state` |
| `hub_cpu` | Hub servisinin bir çekirdekten aldığı pay | ≤ %43 (14.10 öncesi 9 günlük ortalama); beklenen ≈ %10 (masa tahmini) | systemd `CPUUsageNSec` |
| worker CPU | Bilgi için | beklenen ≤ %10 (25–30.09 sağlıklı dönemde %4) | systemd `CPUUsageNSec` |

**Komutlar.** Hepsi salt okunurdur ve VM'e hiçbir dosya yazmaz.
- **Kim, nerede:** ajan ya da kullanıcı, `homunculus_vm` anahtarıyla, repo klasöründen çalıştırır.
- **Hangi kabuk:** Git Bash. PowerShell `<` yönlendirmesini desteklemez, Türkçe karakterleri de bozabilir.
- **Denendi mi:** 14.10'da gerçek hub'da denendi. 60 sn modu, `--since` modu (tırnaklar SSH'ten bozulmadan geçti) ve `--breakdown` modu çalıştı.

1. **60 saniyelik kabul (hub):**
   ```bash
   ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 60' < deploy/infinity/transport_check.py
   ```
   Her ölçüt `KABUL` ya da `RED` olarak yazılır. Son iki satır `SONUÇ:` ve `OZET {…}`'tir. `OZET` yalnız sayaç içerir; saklanabilir ve sohbete yapıştırılabilir.

2. **Worker CPU'su (sudo gerekmez):**
   ```bash
   ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.74 'u=homunculus-infinity-pilot-worker; a=$(systemctl show -p CPUUsageNSec --value $u); sleep 60; b=$(systemctl show -p CPUUsageNSec --value $u); echo "worker son 60 sn: bir çekirdeğin %$(( (b-a)/600000000 ))i"'
   ```

3. **24 saatlik kabul (T0'dan bu yana):** T0'daki `OZET` satırı, Task 9'da repo dışındaki bir dosyaya kaydedilir: `/c/tmp/infinity-0a-releases/t0-ozet.txt`. JSON'daki çift tırnaklar SSH'ten bu şekilde bozulmadan geçer.
   ```bash
   ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 "python3 - --since '$(cat /c/tmp/infinity-0a-releases/t0-ozet.txt)'" < deploy/infinity/transport_check.py
   ```
   Sayaçlar birikimli olduğu için iki okuma bütün günü kapsar. Arada hub yeniden başladıysa betik `HUB BU ARADA YENİDEN BAŞLADI` yazar ve pencereyi geçersiz sayar. Bu durumda 24 saat yeni bir T0'dan yeniden başlar.

4. **Nereye takıldığını görmek için (mühendislik):**
   ```bash
   ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --breakdown --window 300' < deploy/infinity/transport_check.py
   ```
   Düzeltmeden sonra beklenen sonuç `ROW: -`'dir; yani hiçbir aşama baskın değildir.

**Bir cihaz `cihazlar` satırında görünürse** önce biyomedikale sorun: monitör kapalı mı, kablosu çıkmış mı? Kapalı bir monitör taşıma hatası değildir. Ancak kabul kaydına yazılır.

**RED görülürse** hiçbir ayarı değiştirerek kabulü geçirmeye çalışmayın. Hangi ölçütün RED olduğu, `--breakdown` çıktısı ve zaman ajana bildirilir. Geri alma kararını kullanıcı verir.

---

## Kullanıcıdan gerekenler

Bunların hiçbiri Task 0–2'yi ve Task 4–7'yi (kod ve testler) beklemez. Task 3 ve Task 9 (VM'e dağıtım) **1 ve 2 olmadan başlamaz.**

1. **VM kuralı için onay.** 07.10'daki kararınız şuydu: "Grup 1 bitmeden hastane VM'ine hiçbir şey gitmez." Bu aşama hub VM'ine (`.72`) dokunuyor. Ancak yalnız ayrı çalışan Infinity araştırma servisine dokunuyor. Klinik Docker yığını, API, pano, veritabanı ve `/opt/homunculus` değişmez. Worker (`.74`) zaten ayrı bir makine. Bu dağıtımı o kuralın dışında sayıyor musunuz?
2. **Biyomedikale önceden haber.** Task 3'ten ve Task 9'dan önce, saat vererek haber verin. Önerilen metin (Türkçe; Azerbaycan Türkçesine çevirisi gerekirse sizden):
   > **Konu: Infinity araştırma bağlantısı — kısa güncelleme, klinik etkisi yok.** <tarih> günü saat <saat> civarında, monitörlerden gelen araştırma verisini taşıyan yazılımı güncelliyoruz. Monitörlere, merkezi istasyona ve ağ ayarlarına dokunulmuyor; başucu monitörleri ve alarmları aynen çalışıyor. Homunculus klinik panosu bu verileri kullanmıyor. Güncelleme sırasında araştırma görünümünde 1–2 dakikalık bir boşluk olabilir. Amaç, şu an yaklaşık 15 dakika geriden gelen araştırma verisini birkaç saniyeye indirmek.
3. **Worker komutlarını siz çalıştıracaksınız.** Worker'da `sudo` parola istiyor.
   - **Kaç oturum:** iki oturum, her biri yaklaşık 10 dakika. Task 3'te ölçüm sürümü (W-1), Task 9'da düzeltme sürümü (W-2). Gerekirse bir de geri alma (W-geri).
   - **Ajan önceden ne yapar:** dosyaları worker'ın ev klasörüne koyar, size değerleri doldurulmuş bloğu verir ve çıktıyı sizden ister.
   - **Ne zaman:** Task 3'te ölçüm yaklaşık 15 dakika sürer. Task 9 aynı gün ya da ertesi gün olabilir.
   - **Ardından:** Task 10'un 24 saati başlar. Sonunda, mümkünse biyomedikalle birlikte, 13 cihazın güncel değer verdiğine ekrandan bakarsınız.
4. **Karar (yalnız gerekirse): hub'daki ham paket arşivi ve en-yenisi-önce teslim.**
   - **Bugünkü durum:** hub her paketi şifreli olarak 15 dakika saklıyor (~77 MB). Kodda bu arşivi okuyan bir şey yok.
   - **Öneri:** Bu aşamada arşiv kalsın ve kuyruk sırası değişmesin. Düzeltmeden sonra birikmiş kuyruğun ~2–3 dakikada boşalması bekleniyor.
   - **Soru ne zaman gelir:** Task 9'da boşalma 10 dakikayı aşarsa. O zaman şu sorulur: eski paketler arşive geç gitse ya da hiç gitmese olur mu?
5. **Karar (yalnız tablo B satırı çıkarsa): daha hızlı yazma (WAL + `synchronous=NORMAL`).**
   - **Kazanç:** yazma hızlanır.
   - **Bedel:** elektrik ya da VM çökmesinde, son birkaç saniyenin araştırma paketleri kaybolabilir. Hub bunları "kaydettim" diye onaylamış olabilir.
   - **Bugünkü ölçüm:** bunu gerektirmiyor; diskler %7–10 dolu.
6. **Sertifika tarihi.** Hub'ın TLS sertifikası **20.12.2026**'da bitiyor.
   - **Yenileme:** Task 9'da yenilenir (son güvenli gün **06.12.2026**). Yeni sertifika, CA'nın bitişinden bir gün öncesine kadar, ~20.09.2027'ye kadar geçerli olur.
   - **CA'nın kendisi 21.09.2027'de bitiyor.** CA'yı değiştirmek worker'a ve API'ye yeni CA dağıtmayı gerektirir. Bu ayrı, duyurulacak bir iş; 2027 yazından önce yapılmalı.
7. **Doğrulama yalnız gerçek cihazlarla.** 14.10 kararınız gereği sentetik yük, sahte cihaz ya da sahte koğuş kullanılmıyor. Kabul, dağıtımdan sonra 13 gerçek cihazla ve sizinle birlikte yapılır. Testler yalnız repoda zaten kullanılan küçük kod-içi örneklerle yazılır.
8. **Geçici yetkiler.**
   - **Hub'da:** parolasız sudo duruyor (`/etc/sudoers.d/90-homunculus-claude`, 14.10 07:19'da yeniden verilmiş). Aşama 0a bitince kaldırılmalı: `sudo rm /etc/sudoers.d/90-homunculus-claude`.
   - **Worker'da:** parolasız sudo da `tcpdump` yetkisi de zaten yok (14.10'da kontrol edildi).
9. **Envanter ve cihaz adları bu aşamada değişmez.** `.28`, `.34` ve `.38` adsız kalır. K1 düzeltmesinden sonra bir yeniden adlandırma artık kuyruğu kilitlemez. Yine de adlandırma ayrı bir karar ve ayrı bir iştir (biyomedikal tablosu, Aşama A).

---

## Self-review

- **Arithmetic, tests.** Base 106 = 35 + 15 + 14 + 4 + 9 + 21 + 3 + 5. Then:
  - Task 1: +13 → 119.
  - Task 2: +3 +10 → 132.
  - Task 4: +3 → 135.
  - Task 5: +2 → 137.
  - Task 6: +14 → 151. The fourteen are 2 (K1) + 7 (parametrised status codes) + 4 (quarantine: set aside, transient, expiry, the 22.09 wedge) + 1 (the hub counter).
  - Task 7: +3 → **154**.
  - The scratch replay of the gate set printed 153 passed + 1 skipped (the jsdom test, which runs where the junction exists).
- **Every red was observed:**
  - Task 1: collection error, then `10 failed, 3 passed`, and the heartbeat test red against the old order.
  - Task 2: collection errors.
  - Task 4: `('append', 23, 2408)` and the missing index.
  - Task 5: `[3, 1, 1]` and `[32, 32, 6, 0.25]`.
  - Task 6: `cannot import name 'Refused'`.
  - Task 7: collection error.
  - Task 8 was not replayed and says so.
- **The text was replayed from HEAD's bytes.** Every replace pair matched exactly once, and every stage (Tasks 1, 4, 5, 6) equals the tested code byte-for-byte.
- **The brief, point by point:**
  1. The cost centres are named with file:line, and ranked with the 14.10 evidence.
  2. The plan begins with a measurement deployed in the usual way. Its numbers pick the fix through a decision table, with conditional tasks.
  3. Every candidate the brief listed is in the trade-off table, with its deploy order: `MAX_BATCH` (hub first, and the quarantine hazard), the persistent connection, concurrency (F7, and why not pipelining), newest-first and the archive question, thinning, the 400-quarantine and K1, and the certificate.
  4. Deploy and rollback follow the house layout, with the worker's blocks paste-ready for the user. The rename hazard is respected: no inventory change.
  5. Acceptance is a set of read-only commands with Turkish output, run over 60 s, 5 min and 24 h.
  6. Every code change is TDD in the repo's own pattern: `factory`, `TestClient`, loopback HTTP, fake sockets. `test_infinity_vm_pilot.py` is never run.
  7. "Needs the user" is answered: who runs the worker, when, the biomedical notice, and the VM-rule question.
- **Honesty.**
  - The read-only evidence predicts row A; the plan does not assume it.
  - The checker passing on fake readings is a unit test, not acceptance.
  - Thresholds are engineering choices.
  - Two desk estimates are marked as such: the decode cost after the fix, and the drain time.
  - The worker's release was read through the hub's copy of the same hash-named directory, not on the worker, and W-1 step 0 confirms it.
