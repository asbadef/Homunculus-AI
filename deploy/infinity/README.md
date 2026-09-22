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
