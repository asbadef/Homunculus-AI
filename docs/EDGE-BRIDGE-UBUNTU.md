# Edge bridge on Ubuntu (vCenter VM) — runbook

The on-prem half of the pilot: an MLLP listener inside the hospital that receives HL7 from the
monitor or central station, buffers to disk, and makes only outbound HTTPS calls to the cloud.

## Before you touch the device

Open **Advanced → Network** on the monitor and read the configured host.

- **A host is already set** — that device is feeding the hospital's Connex CS / integration engine
  today. Repointing it **breaks the clinical flow into the EMR**. Do not change it. Ask for a copy
  of the feed to be forwarded from that host instead, and note its IP: that box is the real
  integration point.
- **The field is empty** — nothing depends on it. Pointing it at this VM breaks nothing.

This single check decides whether the work is safe. It costs two seconds.

## VM

| | |
| --- | --- |
| OS | **Ubuntu Server 24.04 LTS** |
| vCPU / RAM | 2 / 4 GB |
| Disk | 32 GB |
| NIC | on the device VLAN (`10.10.96.0/22`) |

**24.04, not 22.04.** The engine requires Python >= 3.12; 24.04 ships 3.12, 22.04 ships 3.10 and
will not run this.

The bridge is IO-light. Disk matters only because the store-and-forward buffer grows while the
uplink is down — 32 GB is far more than a pilot can fill.

**Routing.** A VM in another VLAN works *if* the network permits TCP 2575 between them. ACLs
commonly allow ICMP and block everything else, so a successful ping proves nothing about 2575.
Putting the VM on the device VLAN removes the question; prefer that.

Take a vCenter snapshot before starting, so the VM can be rolled back without a rebuild.

## Static IP (netplan)

`/etc/netplan/01-homunculus.yaml` — use an address reserved by the network team, not a guess:

```yaml
network:
  version: 2
  ethernets:
    ens160:
      dhcp4: false
      addresses: [10.10.96.50/22]
      routes:
        - to: default
          via: 10.10.97.1
      nameservers:
        addresses: [10.10.97.1]
```

```bash
ip link                       # confirm the interface name first; it may not be ens160
sudo chmod 600 /etc/netplan/01-homunculus.yaml
sudo netplan apply
ip -4 addr show ens160
```

## Firewall

```bash
sudo ufw allow from 10.10.96.0/22 to any port 2575 proto tcp
sudo ufw enable
sudo ufw status verbose
```

Scoped to the device subnet rather than opened to the world: this port accepts clinical data and
should hear only from the segment that produces it.

## Install — no pip, no internet needed

The bridge's whole import chain is the standard library. Nothing needs installing beyond Python,
which 24.04 already has.

```bash
sudo mkdir -p /opt/homunculus
sudo chown "$USER" /opt/homunculus
```

From your workstation:

```bash
scp -r homunculus-engine/src homunculus-engine/scripts user@10.10.96.50:/opt/homunculus/
```

Then on the VM:

```bash
python3 --version                    # expect 3.12 or newer
cd /opt/homunculus
PYTHONPATH=src python3 -c "from homunculus.edge.bridge import EdgeBridge; print('ok')"
```

## First run — discovery, forwards nothing

```bash
cd /opt/homunculus
PYTHONPATH=src python3 scripts/run_bridge.py --db /var/tmp/bridge.db
```

Point the device's HL7 export at `10.10.96.50:2575`, then read the output:

- no connection lines, `mesaj=0` — the device is not sending here. Nothing in this repo fixes that;
  the export destination has not been set.
- `Eşlenmemiş kodlar: ...` — connected and sending; those identifiers need a site mapping.
- `mesaj=N gözlem=M` with `M>0` — codes are recognised and observations are being produced.

Discovery forwards nothing to the cloud, so it is safe to leave running while the mapping is
written.

## Mapping

Write `/opt/homunculus/site-mapping.json` from the reported identifiers:

```json
{
  "MDC_ECG_HEART_RATE": "heart_rate",
  "MDC_PULS_OXIM_SAT_O2": "spo2",
  "MDC_PRESS_BLD_NONINV_MEAN": "map",
  "MDC_RESP_RATE": "resp_rate",
  "MDC_TEMP_BLD": "temperature"
}
```

The supplied file **replaces** the built-in table rather than merging with it, so list every code
the site sends. An unknown signal slug stops startup rather than silently dropping that signal for
the whole pilot.

## Forwarding to the cloud

```bash
PYTHONPATH=src python3 scripts/run_bridge.py \
  --db /var/tmp/bridge.db \
  --mapping /opt/homunculus/site-mapping.json \
  --cloud-url https://homunculus-api-bkrf.onrender.com \
  --token "$HOMUNCULUS_TOKEN"
```

Outbound HTTPS only. The firewall must permit egress from this VM to the cloud host; the device
itself never talks to the internet.

## Running it as a service

`/etc/systemd/system/homunculus-bridge.service`:

```ini
[Unit]
Description=Homunculus edge bridge (HL7 MLLP -> cloud)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=homunculus
WorkingDirectory=/opt/homunculus
Environment=PYTHONPATH=/opt/homunculus/src
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/etc/homunculus/bridge.env
ExecStart=/usr/bin/python3 scripts/run_bridge.py --db /var/lib/homunculus/bridge.db --mapping /opt/homunculus/site-mapping.json --cloud-url ${CLOUD_URL} --token ${TOKEN}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`PYTHONUNBUFFERED=1` matters: without it Python buffers stdout when it is not a terminal, and
`journalctl -f` shows nothing for minutes — which reads as "the bridge is dead".

The token lives in `/etc/homunculus/bridge.env` (`chmod 600`), never in the unit file, which is
world-readable.

```bash
sudo useradd --system --home /var/lib/homunculus --create-home homunculus
sudo mkdir -p /etc/homunculus && sudo chmod 700 /etc/homunculus
sudo systemctl daemon-reload
sudo systemctl enable --now homunculus-bridge
```

## Watching it live

```bash
journalctl -u homunculus-bridge -f
```

The periodic line is the health summary:

```
mesaj=412 gözlem=2060 reddedilen=0 kuyruk=0
```

- `kuyruk` climbing — the uplink is failing and data is accumulating locally. It is being kept, not
  lost, but the cloud is not seeing it.
- `reddedilen` rising — messages are arriving and being refused, usually a mapping gap.

## Verifying the whole chain

```bash
nc -vz 10.10.96.50 2575                                        # the bridge accepts connections
curl -s https://homunculus-api-bkrf.onrender.com/health        # the cloud is reachable from here
```

Observations that arrived are visible in the cloud audit trail, which records every ingest with its
value, unit and observation time.

## PHI

`bridge.db` holds real observations in transit. Keep it on encrypted storage, never commit it,
delete it after the pilot. The bridge logs counts, connection events and OBX identifiers — never
measurements, names or patient identifiers.

Prefer discovery against a device with no patient connected: then there is no PHI to protect.

## Clock

```bash
timedatectl                  # expect "System clock synchronized: yes"
```

Verify NTP on the monitor too. The engine evaluates against the **observation** timestamp and
escalates against the **wall clock**. A monitor with a wrong clock or a stale timezone database
makes stale readings look fresh and shifts every scoring window — an input to alarm correctness,
not a cosmetic detail.
