"""A local load bench for the hub's wave path, in the ward's shape, with SYNTHETIC monitors - on this
machine only, never on the VM, never a real patient.

What the hub showed on the VM on 2026-11-02 (lead notes L-9, L-10: one panel polling took packets_ms
38 -> 146 ms, the lag tail 1.4 % -> 27 % over 500 ms, waves.refused +172) never showed locally: the
walk's fake hub had three monitors and one poller. This bench reproduces the load so the fixes can be
measured before any retry, with the same parts and the same reading as the VM:

- The REAL hub app (`dev_waves_replay.build_hub`: the hub of `run_infinity_transport.py hub
  --capture-payload --unverified-live-research`, the WaveBuffer on, Aşama A's strip forwarder), over
  TLS, in a CHILD PROCESS: the VM's hub unit is a process of its own, and its CPU is then the hub's
  alone - the monitors, the worker and the pollers run in this process.
- `--monitors N` (13, the ward's count) made-up monitors in the ward's packet shape: a 64-byte header,
  three ECG blocks at 200 Hz (live on one or two channels, "no signal" on the rest), ART and/or P1 at
  100 Hz, pleth at 100 Hz, RESP at 50 Hz: 488 or 542 B, and once a second the numeric records (HR, PLS,
  SpO2 under hub release R7's labels) make it 596 or 650 B - about 520 B over a second, as the ward's
  522/468/346 B packets (docs/INFINITY-DALGA-FORMU.md). Five packets a second per monitor, the monitors'
  phases spread over the 200 ms (the ward's are not synchronised), go into an outbox `Journal` the way
  the worker's `collect` loop saves them: every 100 ms, whatever arrived, with each packet's own receive
  time. The worker's own `infinity_collector.forward_loop` with its `Sender` then posts them to the
  hub's `/v1/packets` with the worker's own batching (BATCH): at most MAX_BATCH = 32 events per POST,
  and after a partial batch LINGER = 0.25 s before the next; the heartbeat every 5 s. With 13 monitors
  that is one POST of about 20 to 26 events every 250 ms plus the POST's own time and the outbox's.
- `--pollers P` (0): P threads, each one browser panel as the API relays it to the hub today: the hub's
  own `/infinity-research/waves?device=<one monitor>&since=0` every `--poll-interval` s (0.25, the
  API's CACHE_S: the most often it asks the hub per watched monitor; the browser itself asks the API
  every 750 ms, waveStore's WAVE_POLL_MS) over one keep-alive connection, poller p on monitor p mod N.
  `--poll-since cursor` sends the last answer's cursor back instead: what work package 2's API will do.
- `--bench-seconds S` (180): after `--warmup` (30 s), `/v1/status` and the hub process's CPU time are
  read twice, S seconds apart, and the window is reported the way the VM's hubdurum.py reports one
  (the same rows, the same KABUL/DİKKAT/RED rules): the hub's share of a core, the lag over 500 and
  1000 ms and its mean, packets_ms's mean and its share over 250 ms, waves_ms, waves_read_ms,
  waves.refused and .errors, the cursor's growth; and the pollers' p50, p95, bytes and blocks per
  answer. Then one line `BENCH {...}` for machines. The CPU time comes from psutil when it is importable
  (it is not in the engine's venv), else from Windows' GetProcessTimes (ctypes), else /proc/<pid>/stat.
- `--compare BEFORE` reads the BENCH line of a saved run (a file holding the run's output, or its JSON)
  and judges this run against it as hubdurum's `karsilastir` judges R7 against R6: KABUL while the new
  tail is at most the old + max(add, 25 % of the old) (add: 0.5 % for the 500 ms tail, 0.25 % for the
  1000 ms tail, floors 1 % and 0.5 %), DİKKAT up to old + max(2 add, 50 %), RED beyond. `--compare
  BEFORE AFTER` compares two saved runs and runs nothing.

Everything is synthetic (192.0.2.x, formulas of time, random tokens never printed) and everything
written goes into one scratch folder outside any repository (`--folder`; refused inside one): the
credentials as dev_waves_replay keeps them (reused on a restart; `--fresh`), both journals, `hub.log`.

    python scripts/dev_waves_bench.py --folder C:/tmp/inf-dalga-bench --monitors 13 --pollers 1
    python scripts/dev_waves_bench.py --folder C:/tmp/inf-dalga-bench --pollers 3 --compare baseline-C.txt
    python scripts/dev_waves_bench.py --compare baseline-B.txt after-B.txt

Exit code, as hubdurum's: 0 KABUL, 3 DİKKAT, 1 RED (the window's rows; the comparison's when
`--compare` is given); 2 when the bench could not run. A baseline with pollers is expected to be RED
on waves.refused: that is the finding, not a failure of the bench.
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import http.client
import json
import math
import os
import platform
import secrets
import ssl
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dev_waves_replay as replay  # noqa: E402  the fake hub's parts: credentials, hub, signals, records

from cryptography.fernet import Fernet  # noqa: E402

from homunculus.edge.infinity_collector import LINGER  # noqa: E402
from homunculus.edge.infinity_stream import MAX_BATCH, Inventory, packet_event  # noqa: E402
from homunculus.edge.infinity_timing import Timings  # noqa: E402

MONITORS = 13                         # the ward's count
SAVE_PERIOD_S = 0.1                   # infinity_collector.collect's deadline: the worker's outbox takes what arrived every 100 ms
POLL_INTERVAL_S = 0.25                # api/infinity_waves.py CACHE_S: the hub is asked at most this often per monitor
WARMUP_S = 30.0
BENCH_S = 180.0
BATCH = (MAX_BATCH, LINGER)           # the worker's: events per POST at most, and the linger after a partial batch
CPU_TAVAN = 0.43                      # hubdurum.py: the hub's share of one core, README/transport_check (13 beds)
DALGA_MS = 2.0                        # hubdurum.py: the mean of one batch's wave decoding (Lane A Q3)
LISTEN_TIMEOUT_S = 40.0               # how long the child may take to serve
STOP_TIMEOUT_S = 20.0
PID_FILE = "hub.pid"                  # the hub process's own pid, in the scratch folder (see serve_hub)


# --- the monitors: the ward's shape, made up ------------------------------------------------------

def bench_monitors(n):
    """`n` made-up monitors (1 to 100, the inventory's bound) in the ward's packet shape. Profiles cycle
    so the packets are the ward's sizes: ART, P1, or both; ECG live on two channels, then on one."""
    if not 1 <= n <= 100:
        raise ValueError("1 to 100 monitors.")
    monitors = []
    for i in range(n):
        hr = 60 + 5 * (i % 7)                                   # 60-90/min, every value a formula of i
        live, quiet = ((0x0102, 0x0103), (0x0104,)) if i % 2 == 0 else ((0x0102,), (0x0103, 0x0104))
        monitors.append({
            "id": f"BEN-{i + 1}", "source": f"192.0.2.{20 + i}", "group": f"239.20.2.{20 + i}",
            "ecg_live": live, "ecg_quiet": quiet, "pressures": ((0x0301,), (0x0E01,), (0x0301, 0x0E01))[i % 3],
            "pleth": True, "beat_s": 60 / hr, "numbers": {"hr": hr, "pls": hr - 2, "spo2": 94 + i % 5}})
    return monitors


def inventory_for(monitors):
    return Inventory.parse({"collector_id": "synthetic-bench", "interface": "192.0.2.200/24",
                            "devices": [{"id": m["id"], "source": m["source"], "group": m["group"], "port": 2050}
                                        for m in monitors]})


def build_payload(monitor, k):
    """The k-th 200 ms packet of one bench monitor, from the replay's own block, signal and record
    makers; every fifth carries the record section (the replay's rule)."""
    device_s, ms = divmod(replay.DEVICE_EPOCH_S * 1000 + 40 + 200 * k, 1000)
    beat = monitor["beat_s"]
    parts = [replay._wave(wave, 200, device_s, ms, lambda t: replay.ecg(t, beat)) for wave in monitor["ecg_live"]]
    parts += [replay._quiet(wave, 200, device_s, ms) for wave in monitor["ecg_quiet"]]
    parts += [replay._wave(wave, 100, device_s, ms, lambda t: replay.pressure(t, beat)) for wave in monitor["pressures"]]
    if monitor["pleth"]:
        parts.append(replay._wave(0x1916, 100, device_s, ms, lambda t: replay.pleth(t, beat)))
    parts.append(replay._wave(0x0201, 50, device_s, ms, replay.resp))
    header = bytearray(replay.HEADER)
    header[29] = 0x0A if k % 5 == 0 else 0x03
    tail = b"".join(replay._record(name, value) for name, value in monitor["numbers"].items()) if k % 5 == 0 else b""
    return bytes(header) + b"".join(parts) + tail


def phase(index, count):
    """When monitor `index` of `count` sends within every 200 ms, in seconds: spread evenly, as the
    ward's monitors are not synchronised with each other."""
    return index * replay.PERIOD_S / count


def events_at(inventory, k, saved_at, *, monitors):
    """The worker's k-th 100 ms save (SAVE_PERIOD_S, `infinity_collector.collect`'s deadline): the live
    events of the monitors whose packet fell in that period, each with its own receive time (its
    phase; up to 100 ms before the save), its payload kept, as the worker's receiver makes them. Every
    monitor appears in one save of every two: 5 packets a second each."""
    by_source = {m["source"]: m for m in monitors}
    count = len(monitors)
    events = []
    for index, device in enumerate(inventory.devices):
        sent = phase(index, count)                                   # within the 200 ms period
        if int(sent // SAVE_PERIOD_S) != k % 2:
            continue
        age = SAVE_PERIOD_S - (sent % SAVE_PERIOD_S)                 # (0, 0.1]: how long before the save
        events.append(packet_event(inventory, device, build_payload(by_source[device.source], k // 2), replay.SOURCE_PORT,
                                   received_at=saved_at - age, retain_payload=True))
    return events


def tick_events(monitors):
    """What `replay.produce` calls every SAVE_PERIOD_S, bound to these monitors."""
    return functools.partial(events_at, monitors=monitors)


def watched(monitors, pollers):
    """Poller p watches monitor p mod N."""
    return [monitors[p % len(monitors)]["source"] for p in range(pollers)]


# --- the hub's client and the pollers -------------------------------------------------------------

class HubClient:
    """One keep-alive TLS connection to the fake hub, with the viewer's token - what the API's
    keep-alive client is to the VM's hub. `get(path, params)` -> (status, body); OSError when the hub
    cannot be reached on a fresh connection either."""

    def __init__(self, host, port, ca_file, token):
        self.host, self.port, self.token = host, port, token
        self.context = ssl.create_default_context(cafile=ca_file)
        self.connection = None

    def close(self):
        connection, self.connection = self.connection, None
        if connection is not None:
            connection.close()

    def get(self, path, params=None):
        target = path + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in (0, 1):
            try:
                if self.connection is None:
                    self.connection = http.client.HTTPSConnection(self.host, self.port, timeout=10, context=self.context)
                self.connection.request("GET", target, headers={"Authorization": "Bearer " + self.token})
                response = self.connection.getresponse()
                return response.status, response.read()
            except (OSError, http.client.HTTPException) as error:
                self.close()
                if attempt:
                    raise OSError("The hub could not be reached.") from error
        raise OSError("The hub could not be reached.")        # not reached


class Poller:
    """One browser panel as the API relays it to the hub: `get({"device": …, "since": …})` every
    `interval` seconds from request start to request start (a slow answer is followed at once, as
    the API's cache would have expired). `since` "0" asks for the whole window every time (today's
    API); "cursor" sends the last answer's cursor back. Keeps (ms, bytes, blocks) per good answer
    and counts the rest as errors, until `window()` reads and resets them."""

    def __init__(self, get, device, *, interval=POLL_INTERVAL_S, since="0", clock=time.perf_counter, wait=None):
        # perf_counter, not monotonic: on Windows the latter ticks every 15.6 ms, and a 5 ms answer reads 0.
        if since not in ("0", "cursor"):
            raise ValueError("since: 0 or cursor")
        self.get, self.device, self.interval, self.mode = get, device, interval, since
        self.clock, self.wait = clock, wait
        self.cursor = 0
        self.lock = threading.Lock()
        self.samples, self.errors = [], 0

    def once(self):
        since = "0" if self.mode == "0" else str(self.cursor)
        started = self.clock()
        try:
            status, body = self.get({"device": self.device, "since": since})
        except OSError:
            status, body = None, b""
        elapsed = (self.clock() - started) * 1000
        blocks = None
        if status == 200:
            try:
                answer = json.loads(body)
                self.cursor = int(answer["cursor"])
                blocks = len(answer["blocks"])
            except (ValueError, KeyError, TypeError):
                status = None
        with self.lock:
            if status == 200:
                self.samples.append((elapsed, len(body), blocks))
            else:
                self.errors += 1

    def run(self, stop):
        wait = self.wait or stop.wait
        due = self.clock()
        while not stop.is_set():
            self.once()
            due = max(due + self.interval, self.clock())
            wait(max(0.0, due - self.clock()))

    def window(self):
        """(the samples since the last read, the errors since), then start afresh."""
        with self.lock:
            samples, errors = self.samples, self.errors
            self.samples, self.errors = [], 0
        return samples, errors


def percentile(values, q):
    """The q-quantile of sorted `values` (nearest rank); None of nothing."""
    if not values:
        return None
    return values[max(0, math.ceil(q * len(values)) - 1)]


def poll_summary(samples, errors):
    """The pollers' numbers for the window: count, errors, p50, p95 and mean ms, bytes and blocks per answer."""
    ms = sorted(s[0] for s in samples)
    n = len(samples)
    mean = (lambda index: sum(s[index] for s in samples) / n) if n else (lambda index: None)
    return {"poll_n": n, "poll_errors": errors, "poll_p50": percentile(ms, 0.5), "poll_p95": percentile(ms, 0.95),
            "poll_ort": mean(0), "poll_bytes": mean(1), "poll_blocks": mean(2)}


# --- the hub process's CPU ------------------------------------------------------------------------

def cpu_seconds(pid):
    """(the process's CPU seconds, user + system; the method's name): psutil where importable, Windows'
    GetProcessTimes, or /proc/<pid>/stat."""
    try:
        import psutil
    except ImportError:
        psutil = None
    if psutil is not None:
        times = psutil.Process(pid).cpu_times()
        return times.user + times.system, "psutil"
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.GetProcessTimes.restype = wintypes.BOOL
        kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel32.OpenProcess(0x1000, False, pid)             # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            raise OSError(ctypes.get_last_error(), "OpenProcess failed.")
        try:
            times = [wintypes.FILETIME() for _ in range(4)]           # creation, exit, kernel, user
            if not kernel32.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
                raise OSError(ctypes.get_last_error(), "GetProcessTimes failed.")
        finally:
            kernel32.CloseHandle(handle)
        hundred_ns = sum((t.dwHighDateTime << 32 | t.dwLowDateTime) for t in times[2:])
        return hundred_ns / 1e7, "GetProcessTimes"
    fields = Path(f"/proc/{pid}/stat").read_text(encoding="ascii").rsplit(")", 1)[1].split()
    return (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK"), "/proc"      # utime, stime


# --- the window, as hubdurum.py reads it ----------------------------------------------------------

def reading(client, pid):
    """One reading: /v1/status's counters and the hub process's CPU time (hubdurum's `oku`)."""
    status_code, body = client.get("/v1/status")
    if status_code != 200:
        raise OSError(f"/v1/status answered {status_code}.")
    status = json.loads(body)
    cpu, method = cpu_seconds(pid)
    return {"t": time.time(), "pid": pid, "cpu_s": cpu, "cpu_method": method,
            "timings": status.get("timings") or {}, "waves": status.get("waves"), "research": status.get("research"),
            "devices": [[d.get("source_ip"), d.get("status")] for d in status.get("devices") or []]}


def _delta(a, b, name):
    after = (b.get("timings") or {}).get(name)
    if not after:
        return None
    before = (a.get("timings") or {}).get(name) or [0] * len(after)
    return [y - x for x, y in zip(before, after)]


def window(a, b):
    """(metrics, rows) for the span between two readings; a row is (name, KABUL|RED|DİKKAT|BİLGİ, text).
    hubdurum.py's `pencere`, with the hub process's CPU seconds in place of the unit's CPUUsageNSec,
    and its pid in place of the unit's InvocationID."""
    m, rows = {}, []
    span = b["t"] - a["t"]
    m["sn"] = round(span)
    if a.get("pid") is None or a.get("pid") != b.get("pid"):
        rows.append(("hub", "RED", "hub bu arada yeniden başladı: sayaçlar sıfırlandı, pencere geçersiz"))
        return m, rows
    if a.get("cpu_s") is not None and b.get("cpu_s") is not None and span > 0:
        m["cpu"] = (b["cpu_s"] - a["cpu_s"]) / span
        rows.append(("hub_cpu", "KABUL" if m["cpu"] <= CPU_TAVAN else "RED",
                     "hub bir çekirdeğin %%%.1f'ini kullandı (tavan %%%d; %s)" % (m["cpu"] * 100, CPU_TAVAN * 100,
                                                                                   b.get("cpu_method", "?"))))
    else:
        rows.append(("hub_cpu", "RED", "hub CPU ölçülemedi"))
    lag = _delta(a, b, "lag_ms")
    if not lag or lag[0] <= 0:
        rows.append(("gecikme", "RED", "pencerede canlı paket gecikmesi yok (akan monitör yok mu?)"))
    else:
        n = lag[0]
        # buckets: [count, total, <=10, <=50, <=100, <=250, <=500, <=1000, <=3000, >3000]
        m.update(lag_n=n, lag_ort=lag[1] / n, lag_500=sum(lag[7:]) / n, lag_1000=sum(lag[8:]) / n, lag_10=lag[2])
        rows.append(("gecikme", "BİLGİ", "%d canlı paket, ortalama %.0f ms; 500 ms üstü %%%.2f, 1000 ms üstü %%%.2f "
                     "(yargı öncekiyle yan yana: gecikme_onceki)" % (n, m["lag_ort"], m["lag_500"] * 100, m["lag_1000"] * 100)))
    packets = _delta(a, b, "packets_ms")
    if packets and packets[0] > 0:
        m.update(paket_n=packets[0], paket_ort=packets[1] / packets[0], paket_250=sum(packets[6:]) / packets[0])
        rows.append(("paket_ms", "BİLGİ", "%d gönderi, ortalama %.1f ms, %%%.2f'i 250 ms üstünde"
                     % (packets[0], m["paket_ort"], m["paket_250"] * 100)))
    w = _delta(a, b, "waves_ms")
    if w and w[0] > 0:
        m["waves_ms"] = w[1] / w[0]
        rows.append(("waves_ms", "KABUL" if m["waves_ms"] <= DALGA_MS else "DİKKAT",
                     "%d kez, ortalama %.2f ms (sınır %g ms)" % (w[0], m["waves_ms"], DALGA_MS)))
    r = _delta(a, b, "waves_read_ms")
    if r and r[0] > 0:
        m["waves_read_ms"] = r[1] / r[0]
        rows.append(("waves_read_ms", "BİLGİ", "%d kez, ortalama %.2f ms" % (r[0], m["waves_read_ms"])))
    # Names the fix slice may add to the hub's timings (work package 1): shown when present, judged by no one here.
    for name in ("waves_lock_ms",):
        extra = _delta(a, b, name)
        if extra and extra[0] > 0:
            m[name] = extra[1] / extra[0]
            rows.append((name, "BİLGİ", "%d kez, ortalama %.2f ms" % (extra[0], m[name])))
    streaming = sum(1 for _, s in b.get("devices") or [] if s == "streaming")
    m["akan"] = streaming
    wa, wb = a.get("waves") or {}, b.get("waves")
    if wb is None:
        rows.append(("dalga", "RED", "/v1/status'ta waves yok: hub dalga çözümüyle kurulmadı"))
    else:
        change = wb.get("refused", 0) - wa.get("refused", 0)
        m["dalga_refused"] = change
        if change == 0:
            verdict, note = "KABUL", "0 beklenir"
        elif change <= m.get("lag_10", 0):
            verdict, note = "DİKKAT", ("<= 10 ms kovasındaki %d paket: işçinin saati hub'ınkinden birkaç ms ileride "
                                       "olabilir (çok taze paket hub'ın saatinin önünde sayılır; lag_ms onu 0'a "
                                       "kırpar)" % m.get("lag_10", 0))
        else:
            verdict, note = "RED", "0 beklenir"
        rows.append(("dalga_refused", verdict, "waves.refused: pencerede %+d, açılıştan beri %d (%s)"
                     % (change, wb.get("refused", 0), note)))
        change = wb.get("errors", 0) - wa.get("errors", 0)
        m["dalga_errors"] = change
        rows.append(("dalga_errors", "KABUL" if change == 0 else "RED",
                     "waves.errors: pencerede %+d, açılıştan beri %d (0 beklenir)" % (change, wb.get("errors", 0))))
        grew = wb.get("cursor", 0) - wa.get("cursor", 0)
        m["dalga_imlec"] = grew
        rows.append(("dalga_imlec", "KABUL" if grew > 0 else ("RED" if streaming else "DİKKAT"),
                     "imleç %d -> %d (+%d); akan monitör %d" % (wa.get("cursor", 0), wb.get("cursor", 0), grew, streaming)))
    ra, rb = a.get("research") or {}, b.get("research")
    if rb is None:
        rows.append(("arastirma_hata", "RED", "/v1/status'ta research yok"))
    else:
        change = rb.get("errors", 0) - ra.get("errors", 0)
        m["arastirma_errors"] = change
        rows.append(("arastirma_hata", "KABUL" if change == 0 else "RED",
                     "research.errors: pencerede %+d, açılıştan beri %d (0 beklenir)" % (change, rb.get("errors", 0))))
    rows.append(("cihazlar", "BİLGİ", "%d/%d monitör akışta" % (streaming, len(b.get("devices") or []))))
    return m, rows


def poll_rows(summary, pollers, interval, since):
    if not pollers:
        return []
    if not summary["poll_n"]:
        return [("sorgu", "RED", "%d poller, pencerede hiç yanıt yok, %d hata" % (pollers, summary["poll_errors"]))]
    return [("sorgu", "BİLGİ", "%d poller (%g s, since=%s): %d yanıt, p50 %.0f ms, p95 %.0f ms, ortalama %.0f ms; "
             "%.0f bayt ve %.0f blok/yanıt; %d hata"
             % (pollers, interval, since, summary["poll_n"], summary["poll_p50"], summary["poll_p95"], summary["poll_ort"],
                summary["poll_bytes"], summary["poll_blocks"], summary["poll_errors"]))]


def _kuyruk(old, new, floor, add):
    """hubdurum.py's tail rule, verbatim."""
    if new <= max(floor, old + max(add, 0.25 * old)):
        return "KABUL"
    return "DİKKAT" if new <= max(floor + add, old + max(2 * add, 0.5 * old)) else "RED"


def compare(before, after):
    """hubdurum.py's `karsilastir`: this window beside the saved one; plus the pollers when both had them."""
    rows = []
    if "lag_500" in before and "lag_500" in after:
        old, new = before["lag_500"], after["lag_500"]
        votes = (_kuyruk(old, new, 0.01, 0.005), _kuyruk(before["lag_1000"], after["lag_1000"], 0.005, 0.0025))
        verdict = "RED" if "RED" in votes else ("DİKKAT" if "DİKKAT" in votes else "KABUL")
        rows.append(("gecikme_onceki", verdict, "500 ms üstü önce %%%.2f -> şimdi %%%.2f; 1000 ms üstü önce %%%.2f -> %%%.2f; "
                     "ortalama önce %.0f -> %.0f ms" % (old * 100, new * 100, before["lag_1000"] * 100, after["lag_1000"] * 100,
                                                        before["lag_ort"], after["lag_ort"])))
    else:
        rows.append(("gecikme_onceki", "RED", "önceki ya da bu pencere gecikme ölçmedi"))
    if "paket_ort" in before and "paket_ort" in after:
        rows.append(("paket_onceki", "BİLGİ", "paket_ms ortalama önce %.1f -> şimdi %.1f ms (x%.2f); 250 ms üstü önce %%%.2f -> %%%.2f"
                     % (before["paket_ort"], after["paket_ort"],
                        after["paket_ort"] / before["paket_ort"] if before["paket_ort"] else 0,
                        before["paket_250"] * 100, after["paket_250"] * 100)))
    if "cpu" in before and "cpu" in after:
        rows.append(("cpu_onceki", "BİLGİ", "hub CPU önce %%%.1f -> şimdi %%%.1f (tavan %%%d)"
                     % (before["cpu"] * 100, after["cpu"] * 100, CPU_TAVAN * 100)))
    if before.get("poll_n") and after.get("poll_n"):
        rows.append(("sorgu_onceki", "BİLGİ", "poller p95 önce %.0f -> şimdi %.0f ms; bayt/yanıt önce %.0f -> şimdi %.0f"
                     % (before["poll_p95"], after["poll_p95"], before["poll_bytes"], after["poll_bytes"])))
    return rows


def verdict(rows):
    return ("RED" if any(r[1] == "RED" for r in rows) else
            "DİKKAT" if any(r[1] == "DİKKAT" for r in rows) else "KABUL")


def _yaz(rows, label):
    """Print the rows and the SONUÇ line; the exit code: 0 KABUL, 3 DİKKAT, 1 RED."""
    for name, result, text in rows:
        print("%-6s %-15s %s" % (result, name, text), flush=True)
    result = verdict(rows)
    print("SONUÇ (%s): %s" % (label, result), flush=True)
    return {"KABUL": 0, "DİKKAT": 3}.get(result, 1)


def run_record(*, monitors, pollers, poll_interval, poll_since, warmup, bench_seconds, cpu_method):
    """What the BENCH line says about the run itself."""
    return {"monitors": monitors, "pollers": pollers, "poll_interval": poll_interval, "poll_since": poll_since,
            "warmup_s": warmup, "bench_s": bench_seconds, "batch": list(BATCH), "cpu_method": cpu_method,
            "cpus": os.cpu_count(), "platform": platform.platform(), "python": platform.python_version(),
            "when": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}


def summary_line(run, metrics):
    return "BENCH " + json.dumps({"bench": run, **metrics}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def load_bench_text(text):
    """The last `BENCH {…}` line of a saved run's output, or the whole text as JSON."""
    lines = [line[len("BENCH "):] for line in text.splitlines() if line.startswith("BENCH ")]
    return json.loads(lines[-1] if lines else text)


def load_bench(path):
    return load_bench_text(Path(path).read_text(encoding="utf-8"))


# --- the run ----------------------------------------------------------------------------------------

def _stop_on_stdin_eof(stop):
    """The child's stop: the parent closes its end of the pipe (or dies)."""
    try:
        sys.stdin.buffer.read()
    except (OSError, ValueError):
        pass
    stop.set()


def serve_hub(args):
    """The child: the real hub app over TLS for `--monitors` bench monitors, with Aşama A's strip
    forwarder, until stdin closes or `--seconds` pass. The credentials are the parent's, from the folder."""
    import uvicorn

    from homunculus.edge.infinity_shadow import ShadowSender
    from homunculus.edge.infinity_shadow import forward_loop as strip_loop

    folder = replay.scratch_folder(args.folder)
    tokens, _, _ = replay.credentials(folder)
    inventory = inventory_for(bench_monitors(args.monitors))
    app, view, journal = replay.build_hub(folder, inventory, tokens.collector, tokens.viewer)
    strip = ShadowSender(args.api.rstrip("/") + "/infinity-shadow/readings", tokens.shadow, "",
                         opener=urllib.request.build_opener(urllib.request.ProxyHandler({})))
    server = uvicorn.Server(uvicorn.Config(app, host=args.host, port=args.port, ssl_certfile=str(folder / "hub.pem"),
                                           ssl_keyfile=str(folder / "hub-key.pem"), access_log=False,
                                           proxy_headers=False))
    stop = threading.Event()
    threads = [threading.Thread(target=strip_loop, args=(view, strip, stop), kwargs={"collector_age": app.state.collector_age},
                                daemon=True, name="strip-forwarder")]
    threading.Thread(target=replay._start_when_serving, args=(server, stop, threads), daemon=True).start()
    threading.Thread(target=replay._end_server_on, args=(stop, server), daemon=True).start()
    threading.Thread(target=_stop_on_stdin_eof, args=(stop,), daemon=True).start()
    if args.seconds > 0:
        timer = threading.Timer(args.seconds, stop.set)
        timer.daemon = True
        timer.start()
    # The parent's Popen.pid is not this process on Windows: a venv's python.exe is a launcher that runs
    # the interpreter as its child. The CPU time the bench reports must be this process's, so it says
    # which it is (PID_FILE), written before the hub serves and read by the parent once it does.
    (folder / PID_FILE).write_text(str(os.getpid()), encoding="ascii")
    print(f"SYNTHETIC bench hub on https://{args.host}:{args.port} (pid {os.getpid()}) - {args.monitors} made-up monitors, "
          "no patient. Stops when the bench closes this pipe.", flush=True)
    try:
        server.run()
    finally:
        stop.set()
        journal.close()
    return 0


def hub_pid(folder):
    """The hub process's own pid, as the child wrote it (not the launcher the parent spawned)."""
    return int((Path(folder) / PID_FILE).read_text(encoding="ascii").strip())


def _wait_until_serving(client, child, stop):
    deadline = time.monotonic() + LISTEN_TIMEOUT_S
    while time.monotonic() < deadline and not stop.is_set():
        if child.poll() is not None:
            return False
        try:
            if client.get("/v1/status")[0] == 200:
                return True
        except OSError:
            pass
        stop.wait(0.2)
    return False


def _tail(path, lines=12):
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


def run_bench(args):
    from homunculus.edge.infinity_collector import Sender, save_batch
    from homunculus.edge.infinity_collector import forward_loop as deliver_loop
    from homunculus.edge.infinity_journal import Journal

    try:
        folder = replay.scratch_folder(args.folder)
    except ValueError:
        print("Not started: the scratch folder must be outside any repository.", flush=True)
        return 2
    folder.mkdir(parents=True, exist_ok=True)
    tokens, same_tokens, same_certificate = replay.credentials(folder, fresh=args.fresh)
    monitors = bench_monitors(args.monitors)
    inventory = inventory_for(monitors)
    sources = watched(monitors, args.pollers)
    total = args.warmup + args.bench_seconds
    print(f"SYNTHETIC bench: {args.monitors} made-up monitors at 5 packets/s each, {args.pollers} poller(s) every "
          f"{args.poll_interval:g} s with since={args.poll_since}; no patient.", flush=True)
    print(f"Scratch folder: {folder} (hub.log, journals, credentials). " + replay.credentials_note(same_tokens, same_certificate),
          flush=True)
    print(f"Worker batching, the worker's own forward_loop: at most {BATCH[0]} events per POST, {BATCH[1] * 1000:.0f} ms "
          "linger after a partial batch, heartbeat every 5 s.", flush=True)
    log = (folder / "hub.log").open("ab")
    (folder / PID_FILE).unlink(missing_ok=True)              # never a previous run's hub
    child = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--role", "hub", "--folder", str(folder), "--monitors", str(args.monitors),
         "--host", args.host, "--port", str(args.port), "--api", args.api, "--seconds", f"{total + 120:g}"],
        stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    client = HubClient(args.host, args.port, str(folder / "ca.pem"), tokens.viewer)
    stop, failure = threading.Event(), threading.Event()
    worker_timings = Timings()
    outbox = Journal(folder / f"worker-{secrets.token_hex(4)}.sqlite", Fernet.generate_key(), timings=worker_timings)
    sender = Sender(f"https://127.0.0.1:{args.port}", tokens.collector, ca_file=str(folder / "ca.pem"), timings=worker_timings)
    pollers = [Poller(functools.partial(HubClient(args.host, args.port, str(folder / "ca.pem"), tokens.viewer).get,
                                        "/infinity-research/waves"),
                      source, interval=args.poll_interval, since=args.poll_since) for source in sources]
    threads = [
        threading.Thread(target=replay.produce, args=(inventory, lambda batch: save_batch(outbox, batch), stop),
                         kwargs={"events": tick_events(monitors), "period": SAVE_PERIOD_S}, daemon=True, name="synthetic-monitors"),
        threading.Thread(target=deliver_loop, args=(outbox, sender, inventory, stop, "live", failure),
                         kwargs={"timings": worker_timings}, daemon=True, name="synthetic-worker"),
        *(threading.Thread(target=poller.run, args=(stop,), daemon=True, name=f"poller-{i}") for i, poller in enumerate(pollers)),
    ]
    code = 2
    try:
        if not _wait_until_serving(client, child, stop):
            print(f"Not started: the hub child did not serve within {LISTEN_TIMEOUT_S:g} s. hub.log ends:\n{_tail(folder / 'hub.log')}",
                  flush=True)
            return 2
        try:
            pid = hub_pid(folder)
        except (OSError, ValueError):
            print(f"Not started: the hub serves but wrote no {PID_FILE}. hub.log ends:\n{_tail(folder / 'hub.log')}", flush=True)
            return 2
        print(f"Hub process pid {pid} (launched as {child.pid}) serving on https://{args.host}:{args.port}; its output in "
              f"{folder / 'hub.log'}.", flush=True)
        for thread in threads:
            thread.start()
        print(f"Warm-up {args.warmup:g} s, then a {args.bench_seconds:g} s window.", flush=True)
        stop.wait(args.warmup)
        if failure.is_set() or child.poll() is not None:
            print(f"Not measured: the worker failed or the hub child exited during the warm-up. hub.log ends:\n{_tail(folder / 'hub.log')}",
                  flush=True)
            return 2
        before = reading(client, pid)
        for poller in pollers:
            poller.window()
        stop.wait(args.bench_seconds)
        if failure.is_set() or child.poll() is not None:
            print(f"Not measured: the worker failed or the hub child exited during the window. hub.log ends:\n{_tail(folder / 'hub.log')}",
                  flush=True)
            return 2
        after = reading(client, pid)
        samples, errors = [], 0
        for poller in pollers:
            got, failed = poller.window()
            samples += got
            errors += failed
        metrics, rows = window(before, after)
        summary = poll_summary(samples, errors)
        metrics.update(summary)
        rows += poll_rows(summary, args.pollers, args.poll_interval, args.poll_since)
        print(f"--- pencere ({metrics['sn']} sn; {args.monitors} monitör, {args.pollers} poller, {args.poll_interval:g} s, "
              f"since={args.poll_since})", flush=True)
        code = _yaz(rows, "BENCH")
        run = run_record(monitors=args.monitors, pollers=args.pollers, poll_interval=args.poll_interval,
                         poll_since=args.poll_since, warmup=args.warmup, bench_seconds=args.bench_seconds,
                         cpu_method=after["cpu_method"])
        print(summary_line(run, metrics), flush=True)
        if args.compare:
            earlier = load_bench(args.compare[0])
            print(f"--- önceki ile yan yana ({args.compare[0]}: {earlier.get('bench', {}).get('monitors', '?')} monitör, "
                  f"{earlier.get('bench', {}).get('pollers', '?')} poller)", flush=True)
            code = _yaz(compare(earlier, metrics), "BENCH_ONCEKI")
        return code
    finally:
        stop.set()
        for thread in threads:
            if thread.is_alive():
                thread.join(timeout=10)
        try:
            child.stdin.close()
            child.wait(timeout=STOP_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired):
            child.kill()
            child.wait(timeout=STOP_TIMEOUT_S)
        log.close()
        client.close()
        outbox.close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--folder", type=Path, help="a scratch folder outside any repository (required for a run)")
    parser.add_argument("--monitors", type=int, default=MONITORS, help=f"synthetic monitors, 1 to 100 (default {MONITORS}, the ward's)")
    parser.add_argument("--pollers", type=int, default=0, help="browser panels as the API relays them to the hub (default 0)")
    parser.add_argument("--poll-interval", type=float, default=POLL_INTERVAL_S,
                        help=f"seconds between a poller's requests (default {POLL_INTERVAL_S:g}, the API's cache; 0.75 is the browser's)")
    parser.add_argument("--poll-since", choices=("0", "cursor"), default="0",
                        help="0: the whole window every time (today's API); cursor: the last answer's cursor (work package 2)")
    parser.add_argument("--warmup", type=float, default=WARMUP_S, help=f"seconds before the first reading (default {WARMUP_S:g})")
    parser.add_argument("--bench-seconds", type=float, default=BENCH_S, help=f"the window between the two readings (default {BENCH_S:g})")
    parser.add_argument("--compare", nargs="+", metavar="BENCH_FILE",
                        help="BEFORE: judge this run against a saved one; BEFORE AFTER: compare two saved runs, run nothing")
    parser.add_argument("--host", default="127.0.0.1", help="the fake hub's bind address")
    parser.add_argument("--port", type=int, default=8766, help="the fake hub's port (default 8766; check Windows' excluded ranges)")
    parser.add_argument("--api-port", type=int, default=replay.API_PORT,
                        help=f"the local API's port the strip forwarder posts to (default {replay.API_PORT}; nothing need listen)")
    parser.add_argument("--api", help="the strip forwarder's API (default http://127.0.0.1:<--api-port>)")
    parser.add_argument("--fresh", action="store_true", help="new tokens and a new certificate even if the folder holds a previous run's")
    parser.add_argument("--role", choices=("bench", "hub"), default="bench", help="internal: 'hub' is the child process")
    parser.add_argument("--seconds", type=float, default=0.0, help="internal: the hub child's own stop")
    args = parser.parse_args(argv)
    if not 1 <= args.monitors <= 100:
        parser.error("--monitors must be between 1 and 100")
    if not 0 <= args.pollers <= 64:
        parser.error("--pollers must be between 0 and 64")
    if args.poll_interval <= 0 or args.bench_seconds <= 0 or args.warmup < 0:
        parser.error("--poll-interval and --bench-seconds must be positive, --warmup zero or more")
    if not 0 < args.port < 65536 or not 0 < args.api_port < 65536:
        parser.error("--port and --api-port must be between 1 and 65535")
    if args.compare is not None and len(args.compare) > 2:
        parser.error("--compare takes one or two files")
    args.api = args.api or f"http://127.0.0.1:{args.api_port}"
    return args


def main(argv=None):
    # A redirected Windows console is cp1252, which has no "İ": the help and the SONUÇ rows would die on
    # it (dev_waves_replay.py and dev_local.py do the same).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = parse_args(argv)
    if args.role == "hub":
        return serve_hub(args)
    if args.compare and len(args.compare) == 2:
        before, after = (load_bench(path) for path in args.compare)
        print(f"--- {args.compare[0]} ile {args.compare[1]} yan yana", flush=True)
        return _yaz(compare(before, after), "KARSILASTIR")
    if args.folder is None:
        print("Not started: a run needs --folder (a scratch folder outside any repository).", flush=True)
        return 2
    return run_bench(args)


if __name__ == "__main__":
    raise SystemExit(main())
