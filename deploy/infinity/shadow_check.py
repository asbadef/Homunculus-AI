"""Read-only acceptance check for Aşama A's monitor strip, run on the hub VM.

Run it without copying it anywhere, from a machine that has the hub's SSH key:

    ssh sysadmin@172.100.101.72 'python3 - --window 300 --table-version 1 --table-sha <12 hex>' \
        < deploy/infinity/shadow_check.py

`--unassigned a,b,…` names the devices the table leaves on no bed; left out, none is expected (the
table approved on 19.10.2026 puts all 13 on a bed).

It reads `TENANT_TOKEN` from the clinical stack's `.env` (never printing it) and asks the panel, on
the host's own address over plain HTTP (it never leaves the machine, and needs no certificate or
sudo), for GET /infinity-shadow/board and GET /patients twice, `--window` seconds apart. Nothing is
written anywhere.

It prints counts, ages and hashes — NEVER a physiological value, a patient id or the token: one row
per criterion (KABUL / RED), what each device is doing (per assigned bed: its label, status, how
many fresh values and the oldest one's age), the unassigned devices and why, then `SONUÇ:` and
`PANO_OZET {"sha256", "cards", "alerts"}` — the hash of /patients with the two keys that age by
themselves (`elapsed_sec`, `remaining_sec`) removed at every depth, so two readings of an unchanged
board hash alike (Kabul K4).

A strip endpoint that does not exist (the build before Aşama A: a 404, or nginx's HTML page) is
"aşama: yok", and PANO_OZET is still printed: that is how D-2's "before" is read.

Python standard library only: it runs on the hub's system python3.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import urllib.error
import urllib.request

API = "http://172.100.101.72:8080"
ENV = "/opt/homunculus/deploy/local/.env"

# Engineering thresholds, not clinical ones (the plan, Task 12).
LIVE_WINDOW_MS = 3000          # the hub's own freshness window
LAG_MEAN_MAX_MS = 1500
LAG_SHARE_MIN = 0.99
INTERVAL_S = 5                 # the forwarder's cadence
POSTS_MIN_SHARE = 0.9          # of window / INTERVAL_S
LAG_EDGES_MS = (10, 50, 100, 250, 500, 1000, 3000)    # the API's histogram: count, total, then buckets
AGEING_KEYS = frozenset({"elapsed_sec", "remaining_sec"})


class Missing(Exception):
    """The endpoint is not there (404, or a page that is not JSON)."""


def _without_ageing(node):
    if isinstance(node, dict):
        return {k: _without_ageing(v) for k, v in node.items() if k not in AGEING_KEYS}
    if isinstance(node, list):
        return [_without_ageing(v) for v in node]
    return node


def projection(patients_body):
    """/patients as canonical JSON, without the keys that age on their own."""
    return json.dumps(_without_ageing(patients_body), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def summary(patients_body):
    patients = (patients_body or {}).get("patients") or []
    return {"sha256": hashlib.sha256(projection(patients_body).encode("utf-8")).hexdigest(),
            "cards": len(patients), "alerts": sum(len(p.get("alerts") or []) for p in patients)}


def _lag(before, after):
    a = ((before or {}).get("feed") or {}).get("lag_ms") or [0] * (len(LAG_EDGES_MS) + 3)
    b = ((after or {}).get("feed") or {}).get("lag_ms") or []
    if len(b) != len(LAG_EDGES_MS) + 3:
        return None
    if len(a) != len(b) or b[0] < a[0]:                  # the API restarted: judge the after reading alone
        a = [0] * len(b)
    return [y - x for x, y in zip(a, b)]


def _sent(board):
    forwarder = ((board or {}).get("feed") or {}).get("forwarder") or {}
    return forwarder.get("sent")


def evaluate(before, after, *, window_s, table_version, table_sha, unassigned):
    """Judge two readings, each (board or None, patients). Returns (name, passed, text) rows."""
    board_a, board_b = before[0], after[0]
    if board_b is None:
        return [("asama", False, "aşama: yok — uç nokta yok (Aşama A öncesi sürüm)")]
    stage = board_b.get("stage")
    if stage != "shadow":
        problem = board_b.get("problem")
        text = f"aşama: {stage}" + (f" (istenen {board_b.get('configured_stage')}, sorun: {problem})" if problem else "")
        return [("asama", False, text)]
    rows = [("asama", True, "aşama: shadow")]

    table = board_b.get("table") or {}
    sha = str(table.get("sha256") or "")
    ok = (table.get("status") == "ok" and table_version is not None and table.get("version") == table_version
          and bool(table_sha) and sha.startswith(table_sha.lower()))
    rows.append(("tablo", ok, f"tablo {table.get('status')}, sürüm {table.get('version')}, sha256 {sha[:12] or '—'}"
                 f" (beklenen sürüm {table_version}, sha {table_sha or '—'})"))

    feed = board_b.get("feed") or {}
    rows.append(("besleme", feed.get("state") == "ok",
                 f"besleme {feed.get('state')}, son gövde {feed.get('last_post_age_s')} sn önce, "
                 f"toplayıcı {'bağlı' if feed.get('collector_connected') else 'bağlı değil'}"))

    seen = sorted(d.get("source") for d in board_b.get("unassigned") or [])
    wanted = sorted(unassigned or [])
    rows.append(("atanmamis", seen == wanted, f"atanmamış: {', '.join(seen) or 'yok'} (beklenen {', '.join(wanted) or 'yok'})"))

    lag = _lag(board_a, board_b)
    if not lag or lag[0] <= 0:
        rows.append(("gecikme", False, "pencerede ölçülen okuma yok"))
    else:
        mean = lag[1] / lag[0]
        share = sum(lag[2:2 + len(LAG_EDGES_MS)]) / lag[0]
        rows.append(("gecikme", mean <= LAG_MEAN_MAX_MS and share >= LAG_SHARE_MIN,
                     f"{lag[0]} okuma, ortalama {mean:.0f} ms, %{share * 100:.1f}'i {LIVE_WINDOW_MS} ms içinde "
                     f"(sınır: %{LAG_SHARE_MIN * 100:.0f} ve {LAG_MEAN_MAX_MS} ms)"))

    sent_a, sent_b = _sent(board_a), _sent(board_b)
    needed = POSTS_MIN_SHARE * window_s / INTERVAL_S
    if sent_b is None or sent_a is None or sent_b < sent_a:
        rows.append(("gonderim", False, "forwarder sayacı okunamadı ya da pencerede sıfırlandı (hub yeniden başladı mı?)"))
    else:
        posts = sent_b - sent_a
        rows.append(("gonderim", posts >= needed, f"pencerede {posts} gönderi (en az {needed:.0f})"))
    return rows


def nbp_line(board):
    """NBP on the strip, by device: shown with its change time (and the oldest change among them),
    shown with its measurement time unknown (NBP-2: `value_untimed`), awaiting a measurement (an entry
    with no time at all), or withheld — counts and an age, never a pressure."""
    entries = [p for card in (board.get("beds") or []) + (board.get("unassigned") or [])
               for p in card.get("parameters") or [] if p.get("parameter") == "nbp"]
    shown = [p for p in entries if p.get("state") == "value"]
    untimed = sum(1 for p in entries if p.get("state") == "value_untimed")
    ages = [p.get("measured_age_s") for p in shown if isinstance(p.get("measured_age_s"), (int, float))]
    oldest = f" (en eski {math.ceil(max(ages) / 60)} dk önce)" if ages else ""
    # An untimed value whose packet went old (or turned ***) keeps the packet's time: withheld, not awaiting.
    waiting = sum(1 for p in entries if p.get("state") not in ("value", "value_untimed")
                  and p.get("changed_at") is None and p.get("last_at") is None)
    withheld = len(entries) - len(shown) - untimed - waiting
    return (f"nbp: {len(shown)} cihazda ölçüm saati ≤ ile gösteriliyor{oldest}, {untimed} cihazda zamanı bilinmeyen "
            f"değer, {waiting} cihazda ölçüm bekleniyor, {withheld} cihazda gizli (eski)")


def details(board):
    """What each device is doing — statuses, counts, ages; never a value or a patient."""
    if not board or board.get("stage") != "shadow":
        return []
    devices = (board.get("feed") or {}).get("devices") or {}
    lines = ["cihazlar: " + ", ".join(f"{k} {devices.get(k, 0)}" for k in
                                      ("total", "streaming", "standby", "silent", "waiting", "unsupported", "unknown")),
             nbp_line(board)]
    for bed in board.get("beds") or []:
        fresh = [p.get("age_s") for p in bed.get("parameters") or [] if p.get("state") == "value"]
        ages = [a for a in fresh if isinstance(a, (int, float))]
        oldest = f", en eski {max(ages):.1f} sn" if ages else ""
        lines.append(f"  yatak {bed.get('bed_label')}: {bed.get('status')}, {len(fresh)} taze değer{oldest}")
    for device in board.get("unassigned") or []:
        lines.append(f"  atanmamış {device.get('source')}: {device.get('reason')}, {device.get('status')}")
    return lines


def report(before, after, *, window_s, table_version, table_sha, unassigned):
    rows = evaluate(before, after, window_s=window_s, table_version=table_version, table_sha=table_sha,
                    unassigned=unassigned)
    lines = [f"Pencere: {window_s:.0f} sn"]
    lines += [f"{'KABUL' if passed else 'RED  '}  {name:10s} {text}" for name, passed, text in rows]
    lines += details(after[0])
    lines.append("SONUÇ: " + ("KABUL" if rows and all(r[1] for r in rows) else "RED"))
    lines.append("PANO_OZET " + json.dumps(summary(after[1]), separators=(",", ":")))
    return lines


def _token(env_path):
    with open(env_path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("TENANT_TOKEN="):
                return line.split("=", 1)[1].strip().strip("'\"")
    raise SystemExit("TENANT_TOKEN .env içinde yok")


def _http_get(path, token):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token})
    try:
        with opener.open(request, timeout=15) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise Missing() from None
        raise
    try:
        return json.loads(raw)
    except ValueError:
        raise Missing() from None                      # nginx's SPA page: the route is not there


def _read(get, token):
    try:
        board = get("/infinity-shadow/board", token)
    except Missing:
        board = None
    return board, get("/patients", token)


def main(argv=None, *, get=_http_get, sleep=time.sleep, env_path=ENV, clock=time.monotonic):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window", type=int, default=300, help="seconds between the two readings")
    parser.add_argument("--table-version", type=int)
    parser.add_argument("--table-sha", help="the approved table's sha256, its first 12 hex at least")
    parser.add_argument("--unassigned", default="", help="the addresses the table leaves unassigned, comma-separated")
    args = parser.parse_args(argv)
    token = _token(env_path)
    start = clock()
    before = _read(get, token)
    sleep(args.window)
    after = _read(get, token)
    window = max(clock() - start, float(args.window))
    unassigned = tuple(s.strip() for s in args.unassigned.split(",") if s.strip())
    for line in report(before, after, window_s=window, table_version=args.table_version,
                       table_sha=args.table_sha, unassigned=unassigned):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
