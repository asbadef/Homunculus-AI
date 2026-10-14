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
