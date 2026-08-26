# Edge bridge via Docker (GHCR → Ubuntu server)

GitHub builds the image, the on-prem server pulls it. Nothing is compiled on the ward, and the
server needs neither a Python toolchain nor a package mirror.

For the bare-Python install (no Docker), see [EDGE-BRIDGE-UBUNTU.md](EDGE-BRIDGE-UBUNTU.md). The
safety check before touching the device is in that document and applies here unchanged: **if the
monitor already has a host configured, it is feeding the hospital's integration engine today and
repointing it breaks the clinical flow into the EMR.**

## What is where

| | |
| --- | --- |
| Image build | `.github/workflows/bridge-image.yml` — runs on push to `main` |
| Image | `ghcr.io/asbadef/homunculus-bridge:latest` (and a `sha-…` tag per build) |
| Dockerfile | `homunculus-engine/Dockerfile` |
| Server config | `deploy/bridge/docker-compose.yml` + `.env` |

## 1. Publish the image

Push to `main`. The workflow builds, pushes both tags, and then **runs the image** to confirm the
bridge imports — an image that builds but cannot start is worse than a failed build, because it
looks deployable.

Watch it: `gh run watch` or the Actions tab.

## 2. Authenticate the server

The repository is private, so the package is private. The server needs a GitHub token with
**`read:packages`** — a fine-grained PAT or a classic PAT.

On the Ubuntu server:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-kullanici> --password-stdin
```

Use a token that can *only* read packages. A token with repository write access on a machine that
sits in a device VLAN is a much larger blast radius than this job needs.

## 3. Discovery — before there is a mapping

Discovery has no mapping file and no cloud URL, so run the image directly rather than through
compose:

```bash
docker run --rm -it \
  -p 10.10.96.50:2575:2575 \
  -v homunculus-bridge-data:/data \
  ghcr.io/asbadef/homunculus-bridge:latest \
  scripts/run_bridge.py --db /data/bridge.db
```

Point the device's HL7 export at `10.10.96.50:2575` and read the output:

- no connection lines — the device is not sending here; the export destination has not been set.
- `Eşlenmemiş kodlar: ...` — connected and sending. **This list is what the mapping is written
  from.**
- `mesaj=N gözlem=M` with `M>0` — codes are recognised and observations are being produced.

Nothing is forwarded in this mode, so it is safe to leave running.

The same image also carries the multi-port probe, for when the device's destination port is
unknown or it is not clear whether the device is reachable at all:

```bash
# is anything arriving, on any of the usual ports?
docker run --rm -it -p 2575:2575 -p 5000:5000 \
  ghcr.io/asbadef/homunculus-bridge:latest \
  scripts/listen_probe.py --ports 2575,5000

# what does the device itself have open?
docker run --rm ghcr.io/asbadef/homunculus-bridge:latest \
  scripts/listen_probe.py --scan 10.10.96.203
```

## 4. Forwarding — compose

```bash
sudo mkdir -p /opt/homunculus && cd /opt/homunculus
# copy deploy/bridge/docker-compose.yml and .env.example here
cp .env.example .env && chmod 600 .env
$EDITOR .env            # LISTEN_ADDR, CLOUD_URL, TENANT_TOKEN
```

Write `site-mapping.json` next to the compose file, from the identifiers discovery reported:

```json
{
  "MDC_ECG_HEART_RATE": "heart_rate",
  "MDC_PULS_OXIM_SAT_O2": "spo2",
  "MDC_PRESS_BLD_NONINV_MEAN": "map",
  "MDC_RESP_RATE": "resp_rate",
  "MDC_TEMP_BLD": "temperature"
}
```

**Create this file before `up`.** Docker creates a *directory* where a bind-mounted file is
missing, and the failure that follows names neither the file nor the cause.

The mapping **replaces** the built-in table rather than merging with it, so list every code the
site sends. An unknown signal slug stops startup rather than silently dropping that signal for the
whole pilot.

Then:

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

## 5. Watching it

```
mesaj=412 gözlem=2060 reddedilen=0 kuyruk=0
```

- `kuyruk` climbing — the uplink is failing and observations are accumulating locally. They are
  being kept, not lost, but the cloud is not seeing them.
- `reddedilen` rising — messages arrive and are refused, usually a mapping gap.
- `gözlem=0` while `mesaj` climbs — connected, but nothing maps. Check the unmapped-code line.

Health: `docker compose ps` shows `healthy` once the MLLP port accepts connections.

## Pinning for the pilot

Once a device is connected, pin the tag:

```bash
IMAGE_TAG=sha-<full-commit-sha>
```

`latest` cannot answer "what is running on the ward right now?", and that question has to have an
answer for anything carrying clinical data.

## Updating

```bash
docker compose pull && docker compose up -d
```

The buffer is a named volume, so queued observations survive the restart. It also means the volume
**holds real patient data**: keep it on encrypted storage and remove it after the pilot —
`docker volume rm bridge_bridge-data`.

## What the container does not do

No inbound internet access is required or used. The bridge makes outbound HTTPS calls only, and the
device never talks to the cloud. The firewall needs to permit egress from this host to the API,
and TCP 2575 inbound **from the device subnet only**.
