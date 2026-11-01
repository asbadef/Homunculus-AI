"""Read-only summary of the monitor strip, for the monitor->bed editor's deploy blocks (spec 7.2).

Run it as shadow_check.py runs, from a machine that has the hub's SSH key, never copying it anywhere
(pin the commit, never a branch):

    git -C <worktree> show <commit>:deploy/infinity/esleme_ozet.py |
      ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --etiket ONCE' | tee ONCE.txt

It reads TENANT_TOKEN from the clinical stack's .env (never printing it), asks GET /infinity-shadow/board
on the host's own address over plain HTTP, and prints ONE line:

    ESLEME_OZET_<ETIKET> {"beds": [[source, bed_id, bed_label], ...], "unassigned": [[source, reason], ...],
                          "link_one": n, "devices_total": n, "table": {"status", "version", "sha12"}, "stage"}

Addresses, bed ids, bed labels, reasons and counts only: never a physiological value, a patient id, a
note, a unit id or the token. Nothing is written anywhere. The line is pure ASCII (a non-ASCII label is
escaped by JSON, and json.loads restores it), so it survives any locale and any pipe.

On the workstation, `--karsilastir ONCE.txt SONRA.txt` compares two saved lines (each file may hold other
lines; the last ESLEME_OZET_ line counts): it prints "AYNI" when the bed cards, the unassigned devices and
the link: one count agree, else "FARKLI: <parts>", then one BILGI line with both readings' table, device
count and stage. The table is shown, not judged: it changes by design at the switch (the file's sha and
version before, the rows digest and max(id) after).

Exit codes: 0 printed, or AYNI; 1 FARKLI; 2 nothing could be read (no token or an .env that cannot be
read, the board unreachable, not an object or of an odd shape, a saved file without its line or whose line
lacks a compared key): the reason goes to stderr, stdout stays empty. Behind a pipe to tee,
`set -o pipefail` keeps the 2 visible.

Python standard library only: it runs on the hub's system python3.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request

API = "http://172.100.101.72:8080"
ENV = "/opt/homunculus/deploy/local/.env"
COMPARED = ("beds", "unassigned", "link_one")
LABEL = re.compile(r"[A-Za-z0-9_-]{1,32}")


class Refused(Exception):
    """Nothing could be read. The message is safe to print: it never carries the token or a body."""


def _label(text):
    if not LABEL.fullmatch(text):
        raise argparse.ArgumentTypeError("etiket tek sözcük olmalı (harf, rakam, _ ya da -)")
    return text


def _token(env_path):
    try:
        with open(env_path, encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("TENANT_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip("'\"")
                    if token:
                        return token
                    break
    except (OSError, ValueError) as error:        # ValueError: a byte that is not UTF-8
        raise Refused(".env okunamadı: " + type(error).__name__) from None
    raise Refused("TENANT_TOKEN .env içinde yok ya da boş")


def _http_get(path, token):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token})
    with opener.open(request, timeout=15) as response:
        return json.loads(response.read())


def _key(row):
    return tuple("" if value is None else str(value) for value in row)


def summary(board):
    table = board.get("table") or {}
    beds = board.get("beds") or []
    return {
        "beds": sorted(([c.get("source"), c.get("bed_id"), c.get("bed_label")] for c in beds), key=_key),
        "unassigned": sorted(([c.get("source"), c.get("reason")] for c in board.get("unassigned") or []), key=_key),
        "link_one": sum(1 for c in beds if c.get("link") == "one"),
        "devices_total": ((board.get("feed") or {}).get("devices") or {}).get("total"),
        "table": {"status": table.get("status"), "version": table.get("version"),
                  "sha12": str(table.get("sha256") or "")[:12]},
        "stage": board.get("stage"),
    }


def _read(get, env_path):
    """The board's summary. Whatever goes wrong, only a fixed message (or a class and HTTP code) is raised."""
    token = _token(env_path)
    try:
        board = get("/infinity-shadow/board", token)
    except Exception as error:        # whatever the transport raises: only its class and HTTP code are printed
        code = getattr(error, "code", None)
        raise Refused("board okunamadı: " + type(error).__name__ + (f" {code}" if code else "")) from None
    if not isinstance(board, dict):
        raise Refused("board bir JSON nesnesi değil")
    try:
        return summary(board)
    except (AttributeError, TypeError):           # a key holding a list where an object belongs, a null entry
        raise Refused("board biçimi beklenmedik") from None


def _saved(path):
    try:
        with open(path, encoding="utf-8-sig") as handle:
            lines = [line.strip() for line in handle]
    except (OSError, ValueError) as error:
        raise Refused(f"{path} okunamadı: {type(error).__name__}") from None
    found = [line for line in lines if line.startswith("ESLEME_OZET_") and " " in line]
    if not found:
        raise Refused(f"{path}: ESLEME_OZET_ satırı yok")
    try:
        saved = json.loads(found[-1].split(" ", 1)[1])
    except ValueError:
        raise Refused(f"{path}: ESLEME_OZET_ satırı JSON değil") from None
    if not isinstance(saved, dict):
        raise Refused(f"{path}: ESLEME_OZET_ satırı bir nesne değil")
    if not all(key in saved for key in COMPARED):     # fail closed: two empty objects must not read as AYNI
        raise Refused(f"{path}: ESLEME_OZET_ satırında {', '.join(COMPARED)} yok")
    return saved


def _shown(saved):
    table = saved.get("table")
    table = table if isinstance(table, dict) else {}
    text = f"{table.get('status')} v{table.get('version')} {table.get('sha12') or '-'}"
    return text, saved.get("devices_total"), saved.get("stage")


def _compare(once_path, sonra_path):
    before, after = _saved(once_path), _saved(sonra_path)
    differ = [key for key in COMPARED if before.get(key) != after.get(key)]
    print("AYNI" if not differ else "FARKLI: " + ", ".join(differ))
    (table_a, devices_a, stage_a), (table_b, devices_b, stage_b) = _shown(before), _shown(after)
    print(f"BILGI tablo: {table_a} -> {table_b}; cihaz: {devices_a} -> {devices_b}; asama: {stage_a} -> {stage_b}")
    return 1 if differ else 0


def main(argv=None, *, get=_http_get, env_path=ENV):
    parser = argparse.ArgumentParser(prog="esleme_ozet.py", description="Read-only summary of the monitor strip.")
    parser.add_argument("--etiket", default="OZET", type=_label, help="ONCE, SONRA, ... - the line's label")
    parser.add_argument("--karsilastir", nargs=2, metavar=("ONCE", "SONRA"),
                        help="compare two saved lines instead of reading the board")
    args = parser.parse_args(argv)
    try:
        if args.karsilastir:
            return _compare(*args.karsilastir)
        line = json.dumps(_read(get, env_path))       # pure ASCII on any locale; json.loads restores the labels
    except Refused as error:
        print("esleme_ozet: " + str(error), file=sys.stderr)
        return 2
    print(f"ESLEME_OZET_{args.etiket} {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
