# Infinity collector and research receiver

Implemented 2026-09-20. **This is a runnable transport/research system, not a
validated vital-sign decoder or a replacement central monitoring station.**
It supports an explicit inventory of up to 100 devices on one IPv4 subnet.
Linux is required for live multicast; the receiver and offline replay also run
on Windows. No vendor installation, monitor command or gateway change is needed
by the code. Group subscription does generate normal IGMP signaling.

## Components

- `homunculus-engine/scripts/run_infinity_transport.py collector`: joins explicitly
  configured PDS groups on the selected interface, checks source/group pairs,
  batches transport events into an encrypted SQLite outbox and forwards via HTTPS.
- The same script with `hub`: authenticates collector submissions, acknowledges
  only after durable commit and offers a separate authenticated research dashboard
  on `/`. Default bind is loopback port 8766. `/v1/status` contains packet status,
  not patient observations. There is no connection to `/ingest` or MLLP 2575.
- Raw payloads are omitted by default. `--capture-payload` must be explicitly set
  on **both** processes to save/transfer encrypted research payloads. They are not
  returned by the dashboard API. These payloads may contain personal/clinical data.
- Replay accepts the classic microsecond LINKTYPE_RAW (101) PCAP emitted by the VM
  pilot. It retains original receive timestamps and labels every event `replay`.
  PCAPNG and other link types are intentionally rejected, not guessed.

## Before deployment

Site update, 2026-09-21: the user provisioned Ubuntu 24.04 worker
`172.100.101.74` (`sysadmin`), with monitor interface `ens3=10.10.203.101/24`
and management interface `ens4=172.100.101.74/24`. Its only default route is
via `172.100.101.254`; an explicit SSH-client host route still uses ens3.
The standalone bounded probe received 150 selected datagrams in 30.001 seconds
from `.28:2564` to `224.0.2.28:2050`; payload lengths were 676 x 90, 1430 x 30,
898 x 30. It saved no payload and forwarded nothing. Drop statistics are unknown.
This establishes single-source Linux network access, not service deployment,
full collector operation, decoder validation, or fleet capacity.
`inventory.worker-28.json` is the prepared single-device site inventory; it has
no patient association. Both roles must use the same inventory. The hub remains
targeted at `172.100.101.72`; TLS/authenticated delivery is still pending.

1. Use a dedicated Linux collector with Python 3.12+ and two NICs. Attach its
   monitor NIC to the existing VLAN with a unique reserved address. Do not reuse
   10.10.203.220 while the old collector owns it. Keep the default route on the
   management NIC; no bridging, NAT or IP forwarding between interfaces.
2. Populate `inventory.example.json` with actual identified devices and **observed**
   multicast destinations. The example uses documentation addresses and is not
   a site configuration. A source IP is an allowlist entry, not authenticated
   hardware identity or a patient association. Keep device IDs stable.
3. Check switch/virtual-switch IGMP delivery and the host's
   `sysctl net.ipv4.igmp_max_memberships`. Linux documents a default of 20;
   100 distinct groups need at least 100. For a dedicated host an administrator
   can configure a limit such as 128 after reviewing its network role. The
   application only reads this setting, reports insufficient capacity and exits;
   it never changes sysctls. UDP 2050 must be free. Do not launch 100 processes.
4. Install the package in the VM's virtual environment with `pip install .`
   from `homunculus-engine`. No new Python dependency is required by this change.
5. Configure HTTPS on the receiver using a certificate trusted by the collector,
   with a SAN matching its URL. Place the CA certificate on the collector.
   Restrict access to the chosen receiver port (8766 in these templates) to the
   collector and authorized viewers. TLS verification cannot be disabled by CLI.

The current agent has not deployed these files. A 2026-09-20 SSH connection check
to Homunculus 172.100.101.72:22 timed out. Live Linux NIC/multicast delivery and the
100-device hospital load have not been tested by this implementation.

## Secrets and storage

Set these in the process environment or a protected environment file outside Git:

```text
INFINITY_STORAGE_KEY=<Fernet key, generated locally and retained across restarts>
INFINITY_COLLECTOR_TOKEN=<random token of at least 32 characters>
INFINITY_VIEWER_TOKEN=<different random token; receiver only>
```

Generate a storage key with `Fernet.generate_key()` from the installed cryptography
library and tokens with `secrets.token_urlsafe(32)` in a private administrator
session. Do not send keys in chat or place them in command-line arguments or Git.
Collector and receiver should use **different storage keys** and the same collector
token. Losing a storage key loses the queued/archive data; a mismatched key stops
startup rather than discarding an existing journal. Viewer and collector tokens
must be distinct. The viewer key stays only in browser memory, not local storage.

Runtime database paths must resolve outside any Git repository. Encrypt the host
volume as well and restrict its OS permissions. The app encrypts each event's JSON
with Fernet; aggregate device IDs, packet timestamps/counts and journal indices are
metadata, not encrypted columns. Raw packets are never written as plaintext PCAP
by this service. Source captures remain outside the repository.

Defaults are 128 MiB of encrypted event bodies, 100,000 events and one hour retention
for each journal. SQLite indices/page overhead are additional; freed pages are
reused rather than immediately shrinking the file. Set a filesystem quota and
monitor disk free space for a hard physical-disk budget. CLI limits:
`--max-mib`, `--max-rows`, `--retention-seconds` (60..86400).

When full, the collector retains its existing queue and explicitly counts new
packets that could not be queued. Receiver capacity returns HTTP 507 without ACK.
Expired records are counted; finite storage does not promise lossless operation
during indefinite outages. The browser displays queue depth, overflow, expiry
and forwarding error counters from collector heartbeats.

## Run

Run commands from `homunculus-engine` with its virtual environment active. Use
absolute external paths suitable for the host. The inventory must match at both
ends; the receiver's `interface` field describes the collector, not the hub NIC.

```bash
# Receiver (example IP is the existing Homunculus host; do not add a monitor NIC here)
python scripts/run_infinity_transport.py hub \
  --inventory /etc/homunculus-infinity/inventory.json \
  --database /var/lib/homunculus-infinity/archive.sqlite \
  --host 172.100.101.72 --port 8766 \
  --tls-cert /etc/homunculus-infinity/server.pem \
  --tls-key /etc/homunculus-infinity/server-key.pem

# Collector
python scripts/run_infinity_transport.py collector \
  --inventory /etc/homunculus-infinity/inventory.json \
  --database /var/lib/homunculus-infinity/outbox.sqlite \
  --endpoint https://172.100.101.72:8766 \
  --ca-file /etc/homunculus-infinity/ca.pem
```

The receiver refuses non-loopback binding without certificate/key arguments.
For local-only replay testing, start a hub at its default 127.0.0.1:8766 and run:

```bash
python scripts/run_infinity_transport.py collector \
  --inventory /external/path/inventory.json \
  --database /external/path/outbox.sqlite \
  --endpoint http://127.0.0.1:8766 --allow-loopback-http \
  --replay /external/path/infinity-ipv4.pcap
```

No multicast is joined during replay. It runs as fast as storage/forwarding allows,
not in original real time. Pending records remain encrypted if the receiver is
unavailable; the command exits nonzero after its finite drain wait. Replaying a
file again creates new research events; it is not a new live measurement session.
Use a separate replay database/inventory instance from a live deployment.

## Persistent service templates

### Site pilot runtime preparation (2026-09-21)

`build_pilot_bundle.py --output <external-path.zip>` builds a source-only ZIP
from an explicit file allowlist. It contains the four transport modules, runner,
single-device site inventory, preparation script and file hash manifest. No
repository-wide archive, capture, environment file or credential is included.
Direct Python dependency versions match the locally exercised environment;
pip still resolves transitive dependencies on Ubuntu (not a complete lockfile).

Copy the bundle over authenticated SSH to each intended VM and extract to a
private setup directory. Run `sudo python3 prepare_pilot_runtime.py worker` on
`.74` and `sudo python3 prepare_pilot_runtime.py hub` on `.72`. The script checks
Ubuntu 24.04/Python, expected role IP, port availability and bundle file hashes,
then installs only an isolated runtime at `/opt/homunculus-infinity/pilot`.
It refuses to overwrite an existing pilot directory. If dependency installation
fails, inspect the partial directory before retrying; no automatic deletion or
overwrite is performed. It does not install/start units, change firewall/routes,
generate credentials or call clinical ingest. TLS/credentials/service activation
are a separate pending step. The older unit templates below use a different code
path and must be adapted to this pilot path before activation.

Local checks verified ZIP member allowlist, hashes/tamper rejection, Python syntax
and the packaged CLI import/help. Ubuntu installation has not yet been observed.

Site update: the user has since supplied successful `PREPARED: worker` and
`PREPARED: hub` output for both VMs. No services were started by those commands.

### Activate the prepared site pilot

Copy `activate_pilot.py` separately to `/home/sysadmin/` on both machines. This
does not modify the original runtime manifest. Run on the hub first:

```bash
sudo /opt/homunculus-infinity/pilot/.venv/bin/python /home/sysadmin/activate_pilot.py hub
```

The script creates a separate `homunculus-infinity-pilot` service account,
configuration under `/etc/homunculus-infinity-pilot`, encrypted journal directory
under `/var/lib/homunculus-infinity-pilot`, and
`homunculus-infinity-pilot-hub.service`. It creates a dedicated private CA and a
90-day server certificate for `172.100.101.72`. It does not reuse or modify the
web container's key/certificate or global trust store. Renewal is not automated;
record the printed expiry and renew before it. CA key is root-only; the server
key is readable by the service group. Env files are root-only; systemd passes
their values to the service without putting tokens on the command line.

After local authenticated HTTPS succeeds, the hub exports two files, owned by
`sysadmin` and mode 0600: `/home/sysadmin/infinity-worker-enrollment.json`
(collector token, public CA and explicit inventory only) and
`/home/sysadmin/infinity-viewer-token.txt` (separate viewer token). Never paste
their contents into chat, Git or logs. The enrollment does NOT contain the viewer
token, TLS private keys, or either journal encryption key.

From the Windows client with both hosts already trusted, use SFTP through SSH:

```powershell
scp -3 -p -o StrictHostKeyChecking=yes sysadmin@172.100.101.72:/home/sysadmin/infinity-worker-enrollment.json sysadmin@172.100.101.74:/home/sysadmin/infinity-worker-enrollment.json
```

This relays the file through the client connection without creating a local
enrollment file. Do not use legacy `-O`; password prompts for both hosts require
the normal SFTP mode. See [OpenSSH scp documentation](https://man.openbsd.org/scp).

Then on the worker:

```bash
sudo /opt/homunculus-infinity/pilot/.venv/bin/python /home/sysadmin/activate_pilot.py worker --enrollment /home/sysadmin/infinity-worker-enrollment.json
```

Before activation, it verifies the exact destination/inventory and the hub's
certificate/hostname using the provided CA, without proxies or redirects.
It creates its OWN journal encryption key and
`homunculus-infinity-pilot-worker.service`; private credentials are never printed.
Both services are **metadata-only**: no raw payload flag, clinical measurements,
patient assignment, or `/ingest` calls. It does not configure UFW/routing or touch
the Docker stack. If a firewall blocks TCP 8766, inspect that policy and add only
the required source-specific rule; do not disable/enable the firewall globally.

Validate delivery on the hub, not merely worker process liveness:

```bash
sudo /opt/homunculus-infinity/pilot/.venv/bin/python /home/sysadmin/activate_pilot.py hub --status
```

Expect connected collector, increasing `.28` packet count and fresh packet age.
This is packet delivery, not decoded measurements. TLS verification/authentication
must succeed; do not bypass verification to make it work. The page on 8766 is the
isolated research transport page, not the existing clinical dashboard. Browser
access/trust and frontend integration are separate from collector delivery.

Repeating activation reuses existing keys and units only when they match; changed
enrollment/configuration is rejected. Partial config is retained for inspection,
never silently regenerated. Newly started services are stopped/disabled if their
initial health checks fail. A worker process being active is not proof of delivery.

Rollback on each corresponding VM, preserving keys/data:

```bash
# Worker
sudo systemctl disable --now homunculus-infinity-pilot-worker.service
# Hub
sudo systemctl disable --now homunculus-infinity-pilot-hub.service
```

Five synthetic activation tests pass locally: real CA-signed loopback HTTPS,
hostname rejection, no redirects/proxies, enrollment constraints, retry key
preservation, non-overwriting exports and the generated unit's isolation. These
do not execute systemd/root provisioning on Ubuntu; actual activation output is
still required. Existing runtime preparation scripts must not be re-run over the
already prepared directories.

Activation retry update: the first site attempt stopped with a generic subprocess
error before enrollment export. The precise failing command was not logged.
Activation now resets only a unit reported as failed (not a fresh/unloaded unit)
and reports the executable/action and exit code without arguments/secrets. Nine
synthetic activation tests now pass, including fresh/unloaded/failed service
startup handling. Re-copy the updated activation script and retry the hub first;
do not delete existing keys or repeat runtime preparation. Site activation is
still pending confirmation.

Site confirmation after the retry: the user supplied `ACTIVE: worker` and hub
status showing `service=active`, `collector_connected=true`, `.28=streaming`,
74 accepted packets and receive age about 0.273 seconds. This establishes live
single-device metadata delivery from the Ubuntu worker to the authenticated TLS
hub. It does not establish end-to-end device latency, absence of packet loss,
reboot/outage behavior, multi-device capacity, or clinical decoding. Both units
remain metadata-only; `measurements` is empty and clinical forwarding is false.
Do not re-run runtime preparation or regenerate keys. The next implementation is
the separate research decoder/display described in the Claude plan.

The adjacent systemd units are templates, not installed services. They assume code
under `/opt/homunculus/homunculus-engine`, a least-privilege account named
`homunculus-infinity`, config/certificates under `/etc/homunculus-infinity` and
state under `/var/lib/homunculus-infinity`. Create the account and directories with
appropriate ownership before installing units. Protect environment files and
private keys; the service account must be able to read its key/cert files.

In `collector.env`, set the storage key, collector token and
`INFINITY_ENDPOINT=https://172.100.101.72:8766`. In `hub.env`, set its storage key,
both tokens and `INFINITY_BIND_IP=172.100.101.72`. Both unit templates default to
metadata only; reviewed raw research collection requires adding the payload flag
to both ExecStart commands. Install each role on its intended VM, not both
collectors simultaneously against the same fleet.

Only one active collector is implemented. A second VM may be provisioned as a
**manual cold standby**, but automated ownership leases, fencing and failover are
not implemented. Stop/fence the first collector before starting a replacement.
Deduplication handles retransmission of the same queued event UUID within archive
retention. It does not infer the proprietary monitor sequence number or deduplicate
two independently capturing VMs. Restarting a process preserves queued UUIDs.

## Verification and remaining work

The new transport suite currently has 28 passing tests. Tests cover 100-device isolation, actual loopback HTTPS/certificate checking,
separate read/write authentication, lost acknowledgments/retries, durable encrypted
restart, key mismatch, atomic capacity rejection, stale/out-of-order and replay
display, malformed input, bounded request bodies, fatal forwarding-thread failures,
the dashboard's 100-row rendering/logout behavior and multicast cleanup with fake
Linux sockets. Linux socket joins are mocked in Windows tests, not demonstrated
on the hospital VLAN. These tests establish software behavior, not 100-monitor
production capacity or clinical validity.

The prior discovery/research/preview/Windows-pilot suites also passed (70 tests)
alongside the first transport run. No existing clinical ingest code was changed.

The actual 301-packet capture saved on 2026-09-19 was also read by the new RAW-PCAP
reader and delivered to the receiver in an isolated in-process replay. All 301
metadata records were accepted, labelled replay, with no measurements exposed;
the source capture hash was unchanged. No clinical payload was persisted by that
check and no packets were sent to the hospital network or another server.

Still required for the intended clinical product:

- Independently validated native decoding or a working supported vendor export.
  There is deliberately no switch that turns arbitrary byte-offset hypotheses
  into clinical observations. Numeric units/status/time and ECG scaling/channel/
  sampling need separate verification.
- Patient/device/bed association and changes; clinical stale-data behavior.
- Integration of validated observations with the existing canonical model,
  authenticated clinical ingest and patient dashboard.
- Deployment, live Linux single-device validation, representative 13/50/100-device
  load tests, outage/restart tests and automated standby fencing if required.

References: [Linux IGMP membership limit](https://docs.kernel.org/networking/ip-sysctl.html#igmp-max-memberships-integer),
[Python sockets](https://docs.python.org/3/library/socket.html),
[Fernet](https://cryptography.io/en/latest/fernet/), and
[site architecture](../../docs/INFINITY-100-DEVICE-ARCHITECTURE.md).
# Research replay added 2026-09-21

The four-field, multi-layout PCAP research view is documented in
[INFINITY-RESEARCH-REPLAY.md](../../docs/INFINITY-RESEARCH-REPLAY.md).
It runs locally and does not replace the deployed metadata worker/hub units.
Those services are already active; do not rerun preparation or recreate keys.
The new Linux validation capture runs alongside the existing receiver without
binding its UDP port. Independent live measurement validation remains pending.

# Aşama A — gölge forwarder (2026-10-19)

Stage A puts an **unvalidated monitor strip** on the clinical board: the hub's own live
research view, forwarded to the clinical API as display-only data. Nothing clinical changes.
The hub still reports `clinical_forwarding: False`; the API keeps the readings in a
memory-only store behind its own token; no rule, score, alert, notification or sound reads
them; and no audit row is written for them (measured: 0 rows from ~720 posts an hour).
Plan and copy-paste deploy blocks:
`docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md` ("Dağıtım blokları").

**Release and drop-ins** (hub unit `homunculus-infinity-pilot-hub`, drop-ins under
`/etc/systemd/system/homunculus-infinity-pilot-hub.service.d/`):

- Release R3 `/opt/homunculus-infinity/transport-3940346adc66ca7b` (tarball sha256
  `e55325f9…`): the Stage 0a decoder and transport unchanged, plus a forwarder thread that
  reads the live view every 5 s and posts at most one value per parameter per device, only
  values younger than 3 s, never NBP (R4, below, adds NBP).
- `92-asama-a-kod.conf` — the same as `90-transport-0a-duzeltme.conf` with the release path
  changed to R3. Code present, forwarder OFF. Created 2026-10-19 08:49 UTC.
- `93-asama-a-golge.conf` — adds only
  `EnvironmentFile=/etc/homunculus-infinity-pilot/shadow-forwarder.env`. Its presence turns
  the forwarder ON (journal line `Shadow display forwarding ENABLED`). Created 2026-10-19
  09:00:13 UTC.

**R4 — NBP on the strip** (spec `docs/superpowers/specs/2026-10-22-infinity-nbp-degisim-saati-design.md`,
plan `docs/superpowers/plans/2026-10-22-infinity-nbp-degisim-saati.md`):

- Release R4 `/opt/homunculus-infinity/transport-eeba1f4702719919`: R3 plus, in the live view, the
  time each device's NBP triple last changed (kept only when a complete valid triple came within
  3 s before the change; flagged or partial NBP neither starts nor continues that run), and the
  forwarder's schema `homunculus.infinity-shadow.v2` — NBP's three readings with `changed_at`, sent
  only once such a change has been seen since the hub started. The name is the files' hash: the
  same two edge files always give it.
- `94-nbp.conf` — `92-asama-a-kod.conf` with the release path changed to R4, checked by `diff`
  before it is installed. 93 stays (the forwarder stays on).
- **Order: the API and web first** (they take v1 and v2 and draw `nbp`), **then the hub.** An R4
  hub posting v2 to an older API is refused whole (400), which the forwarder's `failed` counter and
  `shadow_check.py` show. The worker (.74) does not change.
- **Rollback — the hub first, the API only after it:** delete `94-nbp.conf`, `systemctl
  daemon-reload`, restart the hub: R3, v1, no NBP; the API keeps taking v1. API and web go back by
  image tag, as for every release, but only once the hub is on R3 again: an R4 hub posting v2 to
  the old API is refused whole (400) and the strip goes dark. The blocks run G-1 before G-2 for
  this reason.
- The API withholds NBP once its change is older than 2 h − 15 s (`NBP_MAX_MEASURED_AGE_S −
  DISPLAY_MAX_AGE_S`, the browser's display window for a value), so no screen shows NBP past 2 h;
  the browser compares no age with a number (X50).
- `shadow_check.py` prints one more line, `nbp: N cihazda ölçüm saati ≤ ile gösteriliyor (en eski
  M dk önce), W cihazda ölçüm bekleniyor, O cihazda gizli (eski)` — counts and an age, never a
  pressure.
- Deploy record (2026-10-25, blocks `C:\tmp\infinity-a-releases\NBP-bloklari.txt`): C-2 built api
  and web at `f72dafa` (containers started 07:57:26 UTC; images `b49b062c…` / `426cebc0…`). A first
  C-2 had been pasted at 07:47 UTC before C-1 and rebuilt `0ea1d05` unchanged (new image ids, same
  content) — C-3's content checks (the NBP constants in the api container, `nbpWaiting` in the served
  chunks) caught it; C-1 and C-2 were rerun. D-1 installed R4 and `94-nbp.conf` and restarted the
  hub at 08:00:42 UTC (journal: forwarder `starting -> ok`). D-2: transport_check KABUL (hub 8.1 %
  of a core), shadow_check 300 s six KABUL with 60 v2 bodies accepted, `nbp: 2 cihazda ölçüm saati
  ≤ ile gösteriliyor (en eski 3 dk önce), 5 cihazda ölçüm bekleniyor, 0 cihazda gizli (eski)`,
  PANO_OZET equal to P-önce. Walk: accepted by the user as a whole ("okey"); E-3 bekliyor (no bed
  past 2 h at hand); E-4 and E-5 verified by the agent. A-3 (O30) before B: every NBP bed shows a
  regular 3.00–3.01 s gap between complete valid triples about every 45 s and none longer; the user
  chose to deploy as is and to widen `NBP_CONTINUITY_S` with a day's evidence (O38).

**Files under `/etc/homunculus-infinity-pilot/`** (contents never printed or copied anywhere):

- `shadow-forwarder.env` (root:root 0600) holds `INFINITY_SHADOW_URL`
  (`https://172.100.101.72:8443/infinity-shadow/readings`), `INFINITY_SHADOW_CA_FILE` and
  `INFINITY_SHADOW_TOKEN` — the shadow token, a credential separate from `TENANT_TOKEN`. The
  same token sits in `deploy/local/.env` on the API side.
- `web-ca.pem` (root:homunculus-infinity-pilot 0640) is the web container's self-signed
  certificate (SAN `IP:172.100.101.72`), so the hub verifies TLS to the API rather than
  skipping it.

**API side (`deploy/local`).** `.env` carries `INFINITY_CLINICAL_STAGE=shadow` and the shadow
token. `infinity-shadow/device-beds.json` is the device→bed table: version 1, sha256
`ac5ce1c9549c…`, 13 devices on 13 beds, 0 unassigned, approved by the project owner on
2026-10-19 from the central station's bed list (commit `a2c1257`). A change to the table is a
new version approved the same way, never an edit in place.

**Rollback, three tiers** (blocks in the plan; each stops on its first error, and a line saying
"durdum" means nothing changed):

1. **G-1 — forwarder off** (hub; seconds; the API does not restart): delete
   `93-asama-a-golge.conf`, `systemctl daemon-reload`, restart the hub. Within 15–20 s the strip
   says "Monitör verisi gelmiyor" and every value disappears; the board is otherwise unchanged.
2. **G-2 — stage off** (API): `INFINITY_CLINICAL_STAGE=off` in `.env`, then
   `docker compose up -d --no-build api`. The strip, the monitor cards, the feed chip and the
   Settings legend disappear; the API restarts, so the board may be away for a few minutes.
3. **G-3 / G-4 — code back** (hub to Stage 0a by deleting 92; API and web to the previous
   images), only after G-1. **G-5** removes the leftovers once everything is rolled back.

For a problem on the strip alone: G-1, then G-2 if the strip must go entirely.

**`deploy/infinity/shadow_check.py`** is the read-only acceptance check, run from a
workstation without copying it to the VM:

    ssh sysadmin@172.100.101.72 'python3 - --window 300 --table-version 1 --table-sha ac5ce1c9549c' \
        < deploy/infinity/shadow_check.py

It reads `TENANT_TOKEN` from the API's `.env` (never printing it), asks the API for the strip
and the board twice, `--window` seconds apart, and prints one KABUL/RED row per criterion, each
device's status with its fresh-value count and oldest age, and `PANO_OZET` — the sha256 of
`/patients` with the self-ageing keys removed, so two readings of an unchanged board hash
alike. It never prints a physiological value, a patient id or a token.

**Acceptance as measured on 2026-10-19** (Kabul K0–K9 of the plan; engineering thresholds,
none clinical):

| K | Measured |
|---|---|
| K1 live values on assigned beds | 13 devices: 7 streaming, 6 standby; every streaming bed carried ≥ 1 fresh value. BED08 showed its three parameters as device-flagged *invalid* for some minutes with a patient present, then five fresh values — recorded, nothing changed. Bedside eye comparison (same/different only): **taken by the project owner, confirmed 2026-10-26 — same** on the streaming beds named (BED05, BED06, BED25); the owner also reports the 13 ICU monitors' streaming values as correct (user message, 2026-10-26 ≈14:45 local). No values recorded. |
| K2 unassigned devices | none expected, none seen |
| K3 lag | 2347 readings in 300 s, mean 820 ms, 100 % within 3000 ms; 60 posts in 300 s (≥ 54 required) |
| K4 engine output unchanged | `PANO_OZET` sha256 `26a1c3af…` (6 cards, 0 alerts) identical before the forwarder (P0), right after it (P1), 90 min later and **at +24 h** (2026-10-20 09:00–09:05 UTC): P0 = P1 = P90 = P24. |
| K5 audit row rate | the hour before drop-in 93: 0 rows; the hour after: 11 rows, all human (`auth`, `admin`); no new event type; 0 rows from the forwarder. **The whole first day** (24 h after drop-in 93): 34 rows — `admin` 7, `auth` 19, `view` 8 — every one a human action; no `ingest`/`alert` row (the last `ingest` row in the audit is from 2026-09-05). |
| K6 hub unaffected | `transport_check.py --window 300`: KABUL — 19 322 live packets, 100 % within 3 s, mean 251 ms, 0 expired / 0 transfer errors / 0 quarantined, 13/13 devices, hub CPU 9.0 % of one core (ceiling 43 %). **At +24 h:** KABUL again — 19 170 packets, 100 % within 3 s, mean 302 ms, 0/0/0, 13/13, hub CPU 9.1 %. The strip at +24 h: 13 devices (8 streaming, 5 standby), 2 656 readings in 300 s, mean lag 952 ms, 100 % within 3 s, 60 posts. |
| K7 feed death | **pending**: a 5-minute G-1 then drop-in 93 again, agreed with the ward |
| K8 labels and accessibility | 390 px and 1440 px, four languages, both themes, with the strip rendered: no horizontal overflow; strip heading az "Monitor · təsdiqlənməmiş", tr "Monitör · doğrulanmamış", en "Monitor · unvalidated", ru "Монитор · не валидировано"; no raw keys; the strip holds no live region and no focusable element, so it announces nothing and cannot trap focus |
| K9 biomedical / nurse | a biomedical-only account reaches Monitörler (13 devices, bed labels and addresses, no patient name or number) and nothing else; a nurse-only account has no Monitörler. A first attempt with both "Ek görev" boxes ticked gave the biomedical account `board.view` — the account was wrong, not the screen. |

The pending rows (K7, the bedside comparison) are filled in here when they are taken.
