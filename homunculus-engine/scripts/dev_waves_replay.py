"""A fake Infinity hub on this machine, streaming SYNTHETIC monitors - for watching the dalga panel
in a browser against a local stack. Never on the VM, never with real traffic, never a real patient.

It runs the real hub app (`edge.infinity_hub.create_hub` with the live research view and the
WaveBuffer, as `run_infinity_transport.py hub --capture-payload --unverified-live-research` builds
it) over TLS, and in front of it a fake worker made of the worker's own parts: every 200 ms one
made-up packet per monitor goes into an outbox (`edge.infinity_journal.Journal`), and the collector's
forwarding loop (`edge.infinity_collector.forward_loop`, `Sender`) posts it, with the heartbeat, to
the hub's own `/v1/packets`. So the hub's own hooks decode the numbers and the waves, `/v1/status`
shows their timings (`waves_ms` among them), and Aşama A's forwarder (`edge.infinity_shadow`, the code
drop-in 93 runs) posts the strip's values to a local API every 5 s.

Everything it writes goes into one scratch folder outside any repository (`--folder`; refused inside
one): a throwaway CA and certificate, the hub's and the worker's journals, the device->bed table,
`api.env` (the lines the local API's environment needs, its two random tokens included) and
`compose.dalga.yml` (an override that publishes the API on 127.0.0.1:18000 and mounts the table and
the CA).

    python scripts/dev_waves_replay.py --folder C:/tmp/inf-dalga-stack [--seconds 30]

The table is one the strip's own reader accepts, and a lab API (no Postgres) reads it. A Postgres
stack (deploy/local) reads the device->bed table from its database since the monitor->bed editor
(migration 0014), and the import takes only the approved v2 file: there the three monitors stand as
"atanmamış cihaz" until one is bound to a bed on «Monitörler». The mount still keeps the worktree
free of a deploy/local/infinity-shadow/ directory.

The monitors (made up; every value is a formula of time):
  SYN-1  192.0.2.21  ECG live on 0x0103 (0x0102 "no signal"), ART 0x0301, pleth, resp  HR 75 PLS 73 SpO2 97
  SYN-2  192.0.2.22  ECG live on 0x0102 (0x0103, 0x0104 "no signal"), P1 0x0e01, pleth, resp  HR 80 PLS 78 SpO2 95
  SYN-3  192.0.2.23  ECG "no signal" on 0x0103 (lead off), resp  HR "***" (the device says invalid)
Once a second each packet also carries its numbers as records: HR on 0x0101 and PLS on 0x1905, hub
release R7's labels. PLS is two below HR on purpose, so a swapped label shows on the strip.
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

from homunculus.edge.infinity_hub import create_hub  # noqa: E402
from homunculus.edge.infinity_journal import Journal, external_path  # noqa: E402
from homunculus.edge.infinity_live import LiveResearchView  # noqa: E402
from homunculus.edge.infinity_records import PARAMETERS, RECORD_SIZE  # noqa: E402
from homunculus.edge.infinity_stream import packet_event  # noqa: E402
from homunculus.edge.infinity_timing import Timings  # noqa: E402
# The decoder's own block layout, so a made-up packet cannot drift from what the hub reads.
from homunculus.edge.infinity_waves import _BLOCK, HEADER, NO_SIGNAL, WaveBuffer  # noqa: E402

PERIOD_S = 0.2
DEVICE_EPOCH_S = 800_000_000          # where the made-up monitors' own clocks start
SOURCE_PORT = 2564                    # a made-up sending port
HOSTS = ("host.docker.internal", "localhost")
ADDRESSES = ("127.0.0.1",)
# Hub release R7's record ids (edge/infinity_records.py since 70e45e9): 0x0101 is the screen's HR
# (ECG rate), 0x1905 its PLS (SpO2 pulse).
HR_ID, PLS_ID, SPO2_ID = 0x0101, 0x1905, 0x190E
RECORDS = {"hr": (HR_ID, 40, 150), "pls": (PLS_ID, 40, 150), "spo2": (SPO2_ID, 85, 100)}  # id, alarm low, high
MONITORS = (
    {"id": "SYN-1", "source": "192.0.2.21", "group": "239.20.1.21", "bed_label": "YB-1", "bed_id": "yb-01",
     "ecg_live": 0x0103, "ecg_quiet": (0x0102,), "pressure": 0x0301, "pleth": True, "beat_s": 0.8,
     "numbers": {"hr": 75, "pls": 73, "spo2": 97}},
    {"id": "SYN-2", "source": "192.0.2.22", "group": "239.20.1.22", "bed_label": "YB-2", "bed_id": "yb-02",
     "ecg_live": 0x0102, "ecg_quiet": (0x0103, 0x0104), "pressure": 0x0E01, "pleth": True, "beat_s": 0.75,
     "numbers": {"hr": 80, "pls": 78, "spo2": 95}},
    {"id": "SYN-3", "source": "192.0.2.23", "group": "239.20.1.23", "bed_label": "YB-3", "bed_id": "yb-03",
     "ecg_live": None, "ecg_quiet": (0x0103,), "pressure": None, "pleth": False, "beat_s": 0.8,
     "numbers": {"hr": None}},
)
INVENTORY = {"collector_id": "synthetic-dalga", "interface": "192.0.2.200/24",
             "devices": [{"id": m["id"], "source": m["source"], "group": m["group"], "port": 2050} for m in MONITORS]}


# --- the made-up signals: functions of the monitor's own time, nothing measured ------------------
# A beat of `beat` seconds: 0.8 s draws the 75/min SYN-1's HR says, 0.75 s the 80/min of SYN-2's.

def _bump(phase, centre, width):
    return math.exp(-((phase - centre) / width) ** 2)


def ecg(t, beat):
    phase = t % beat
    return int(900 * _bump(phase, 0.20, 0.012) - 150 * _bump(phase, 0.17, 0.010) + 180 * _bump(phase, 0.45, 0.05))


def pressure(t, beat):
    phase = t % beat                                       # a made-up 80-120 mmHg, in counts (x 40)
    return int((80 + 40 * (_bump(phase, 0.30, 0.06) + 0.25 * _bump(phase, 0.50, 0.05))) * 40)


def pleth(t, beat):
    return int(1500 + 900 * _bump((t - 0.25) % beat, 0.25, 0.12))


def resp(t):
    return int(1200 * math.sin(2 * math.pi * t / 4.0))


def _block(wave_id, rate, device_s, ms, values):
    return (_BLOCK.pack(rate, _BLOCK.size + 2 * len(values), ms, device_s, wave_id, len(values), 0)
            + struct.pack(f">{len(values)}h", *values))


def _wave(wave_id, rate, device_s, ms, signal):
    start = device_s + ms / 1000
    return _block(wave_id, rate, device_s, ms, [signal(start + i / rate) for i in range(rate // 5)])


def _quiet(wave_id, rate, device_s, ms):
    return _block(wave_id, rate, device_s, ms, [NO_SIGNAL] * (rate // 5))


def _record(name, value):
    """One numeric record (edge/infinity_records.py's layout); `value` None is the device's "***"."""
    identifier, low, high = RECORDS[name]
    data = bytearray(RECORD_SIZE)
    data[0:2] = (0 if value is None else value).to_bytes(2, "big")
    data[2:4] = high.to_bytes(2, "big", signed=True)
    data[4:6] = low.to_bytes(2, "big", signed=True)
    data[20:22] = identifier.to_bytes(2, "big")
    data[22] = 0 if value is not None else 1               # 1: the value means nothing
    data[24] = PARAMETERS[identifier][1]
    return bytes(data)


def build_payload(monitor, k):
    """The k-th 200 ms packet of one made-up monitor; every fifth carries the record section."""
    device_s, ms = divmod(DEVICE_EPOCH_S * 1000 + 40 + 200 * k, 1000)
    beat = monitor["beat_s"]
    parts = [_quiet(wave, 200, device_s, ms) for wave in monitor["ecg_quiet"]]
    if monitor["ecg_live"] is not None:
        parts.append(_wave(monitor["ecg_live"], 200, device_s, ms, lambda t: ecg(t, beat)))
    if monitor["pressure"] is not None:
        parts.append(_wave(monitor["pressure"], 100, device_s, ms, lambda t: pressure(t, beat)))
    if monitor["pleth"]:
        parts.append(_wave(0x1916, 100, device_s, ms, lambda t: pleth(t, beat)))
    parts.append(_wave(0x0201, 50, device_s, ms, resp))
    header = bytearray(HEADER)
    header[29] = 0x0A if k % 5 == 0 else 0x03
    tail = b"".join(_record(name, value) for name, value in monitor["numbers"].items()) if k % 5 == 0 else b""
    return bytes(header) + b"".join(parts) + tail


def events_at(inventory, k, received_at):
    """The k-th tick: one live event per monitor, its payload kept, as the worker's receiver makes them."""
    monitors = {m["source"]: m for m in MONITORS}
    return [packet_event(inventory, device, build_payload(monitors[device.source], k), SOURCE_PORT,
                         received_at=received_at, retain_payload=True) for device in inventory.devices]


def produce(inventory, save, stop, *, clock=time.time, monotonic=time.monotonic):
    """Every PERIOD_S, one tick handed to `save` (the worker's outbox), until `stop` is set."""
    started, k = monotonic(), 0
    while not stop.is_set():
        save(events_at(inventory, k, clock()))
        k += 1
        stop.wait(max(0.0, started + k * PERIOD_S - monotonic()))


def build_hub(folder, inventory, collector, viewer, *, clock=time.time):
    """The real hub app as the runner builds it for live research with payloads (one Timings for the
    journal and the app), its journal a throwaway in `folder`. Returns (app, live view, journal)."""
    timings = Timings()
    journal = Journal(Path(folder) / f"hub-{secrets.token_hex(4)}.sqlite", Fernet.generate_key(), clock=clock,
                      timings=timings)
    view = LiveResearchView(inventory, clock=clock)
    app = create_hub(inventory, journal, collector, viewer, accept_payload=True, clock=clock, research_view=view,
                     timings=timings, waves=WaveBuffer(inventory, clock=clock))
    return app, view, journal


# --- the scratch folder ---------------------------------------------------------------------------

def scratch_folder(folder):
    """`folder`, resolved, when it is outside every repository - the journals' own rule; ValueError
    otherwise. Creates nothing."""
    external_path(Path(folder) / "api.env")
    return Path(folder).resolve()


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
        "# INFINITY_SHADOW_HOSPITAL and INFINITY_DEVICE_BEDS_PATH come from docker-compose.yml itself.",
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

def _start_when_serving(server, stop, threads):
    """The monitors, the worker and the forwarder start once the hub listens: a packet queued before
    could reach it over 3 s old, and the hub would count it as refused."""
    while not server.started:
        if stop.wait(0.05):
            return
    for thread in threads:
        thread.start()


def _end_server_on(stop, server):
    stop.wait()
    server.should_exit = True


def main(argv=None):
    # A redirected Windows console is cp1252, which has no "ş": the help, the forwarder's log line and a
    # scratch path would die on it (scripts/dev_local.py does the same).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--folder", required=True, type=Path, help="a scratch folder outside any repository")
    parser.add_argument("--api", default="http://127.0.0.1:18000", help="the local API, for the strip's values")
    parser.add_argument("--host", default="127.0.0.1",
                        help="the fake hub's bind address: 127.0.0.1, or 0.0.0.0 if the API container cannot reach it")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--seconds", type=float, default=0.0, help="stop by itself after this long (0: at Ctrl+C)")
    args = parser.parse_args(argv)
    try:
        folder = scratch_folder(args.folder)
    except ValueError:
        print("Not started: the scratch folder must be outside any repository.", flush=True)
        return 2
    import uvicorn

    from homunculus.edge.infinity_collector import Sender, save_batch
    from homunculus.edge.infinity_collector import forward_loop as deliver_loop
    # Aşama A's forwarder, under its own names: its `forward_loop` must never shadow the collector's.
    from homunculus.edge.infinity_shadow import ShadowSender
    from homunculus.edge.infinity_shadow import forward_loop as strip_loop
    from homunculus.edge.infinity_stream import Inventory

    folder.mkdir(parents=True, exist_ok=True)
    viewer, collector, shadow = (secrets.token_urlsafe(36) for _ in range(3))
    issue_certificates(folder)
    write_scratch(folder, port=args.port, viewer=viewer, shadow=shadow)
    inventory = Inventory.parse(INVENTORY)
    app, view, journal = build_hub(folder, inventory, collector, viewer)
    # The fake worker, from the worker's own parts: an outbox and the loop that empties it into the
    # hub over the hub's TLS, heartbeat included (the hub's collector age is then the real one).
    worker_timings = Timings()
    outbox = Journal(folder / f"worker-{secrets.token_hex(4)}.sqlite", Fernet.generate_key(), timings=worker_timings)
    sender = Sender(f"https://127.0.0.1:{args.port}", collector, ca_file=str(folder / "ca.pem"), timings=worker_timings)
    # The strip's values, as drop-in 93's forwarder sends them - over plain HTTP to the API's
    # loopback port here (compose.dalga.yml), which is why the opener is injected.
    strip = ShadowSender(args.api.rstrip("/") + "/infinity-shadow/readings", shadow, "",
                         opener=urllib.request.build_opener(urllib.request.ProxyHandler({})))
    server = uvicorn.Server(uvicorn.Config(app, host=args.host, port=args.port, ssl_certfile=str(folder / "hub.pem"),
                                           ssl_keyfile=str(folder / "hub-key.pem"), access_log=False,
                                           proxy_headers=False))
    stop, failure = threading.Event(), threading.Event()
    workers = [
        threading.Thread(target=produce, args=(inventory, lambda batch: save_batch(outbox, batch), stop),
                         daemon=True, name="synthetic-monitors"),
        threading.Thread(target=deliver_loop, args=(outbox, sender, inventory, stop, "live", failure),
                         kwargs={"timings": worker_timings}, daemon=True, name="synthetic-worker"),
        threading.Thread(target=strip_loop, args=(view, strip, stop), kwargs={"collector_age": app.state.collector_age},
                         daemon=True, name="strip-forwarder"),
    ]
    threading.Thread(target=_start_when_serving, args=(server, stop, workers), daemon=True).start()
    threading.Thread(target=_end_server_on, args=(stop, server), daemon=True).start()
    if args.seconds > 0:
        timer = threading.Timer(args.seconds, stop.set)
        timer.daemon = True
        timer.start()
    print(f"SYNTHETIC fake hub on https://{args.host}:{args.port} - three made-up monitors, no patient.", flush=True)
    print(f"Scratch folder: {folder} (api.env, compose.dalga.yml, infinity-shadow/, ca.pem).", flush=True)
    print(f"Strip values to {args.api.rstrip('/')}/infinity-shadow/readings every 5 s.", flush=True)
    print(f"Stops by itself after {args.seconds:g} s." if args.seconds > 0 else "Ctrl+C stops it.", flush=True)
    try:
        server.run()
    finally:
        stop.set()
        for thread in workers:
            if thread.is_alive():
                thread.join(timeout=10)
        outbox.close()
        journal.close()
    return 2 if failure.is_set() else 0


if __name__ == "__main__":
    raise SystemExit(main())
