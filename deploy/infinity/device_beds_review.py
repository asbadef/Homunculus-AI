"""Print Aşama A's device→bed table for review, in Turkish. Workstation only; touches no VM.

    python deploy/infinity/device_beds_review.py [--allow-unapproved] deploy/infinity/device-beds.icu2.json

The table is checked by the same rules the API applies (`homunculus.api.infinity_device_beds`,
`parse_table`), sorted by address, and printed with the sha256 of the file's bytes. An unapproved
table is refused, exactly as the API refuses it; `--allow-unapproved` checks every other rule and
shows it marked ONAYLANMAMIŞ — the only way to present it for approval (plan Task 13).

Note on the sha256: a Windows checkout holds CRLF line ends, git holds LF. What is deployed is
the COMMITTED bytes (`git show <commit>:deploy/infinity/device-beds.icu2.json`), so the sha that
the API reports must be compared with theirs; this tool says when the bytes it read are CRLF.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "homunculus-engine" / "src"))

from homunculus.api.infinity_device_beds import TableError, parse_table  # noqa: E402

METHOD_TR = {"central_station_list": "merkezi istasyon listesi", "monitor_screen": "monitör ekranı",
             "both": "liste + ekran", None: "—"}
PLACEHOLDER_BY, PLACEHOLDER_AT = "(onaylanmamış)", "1970-01-01"


def _address_key(source: str) -> tuple[int, ...]:
    return tuple(int(part) for part in source.split("."))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aşama A cihaz→yatak tablosunu gözden geçirme çıktısı")
    parser.add_argument("--allow-unapproved", action="store_true",
                        help="onay alanları boş olan tabloyu da göster (onaya sunmak için)")
    parser.add_argument("path")
    args = parser.parse_args(argv)

    data = Path(args.path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    try:
        raw = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        print("TABLO GEÇERSİZ: JSON okunamadı")
        return 1
    unapproved = isinstance(raw, dict) and not (str(raw.get("approved_by") or "").strip()
                                                and str(raw.get("approved_at") or "").strip())
    if unapproved and args.allow_unapproved:
        raw = {**raw, "approved_by": PLACEHOLDER_BY, "approved_at": PLACEHOLDER_AT}
    try:
        table = parse_table(raw)
    except TableError as error:
        print(f"TABLO GEÇERSİZ: {error.reason}")
        return 1

    assigned, unassigned = table.counts()
    print(f"Cihaz→yatak tablosu: {Path(args.path).name}")
    print(f"site: {table.site} · sürüm {table.version}")
    if unapproved:
        print("onay: ONAYLANMAMIŞ — API bu tabloyu yüklemez; onaylanınca approved_by ve approved_at doldurulur")
    else:
        print(f"onaylayan: {table.approved_by} · onay tarihi: {table.approved_at}")
    print(f"sha256 (okunan baytlar): {digest}")
    if b"\r\n" in data:
        print("uyarı: dosyada CRLF satır sonları var (Windows çalışma kopyası). Dağıtılan baytlar "
              "`git show <commit>:<yol>` ile alınır; onların sha256'sı bundan farklıdır.")
    print(f"{assigned} atanmış, {unassigned} atanmamış")
    print()
    header = ("#", "Kaynak IP", "Grup", "Yatak", "Yöntem", "Doğrulama", "Geçerlilik", "Not")
    rows = []
    for number, row in enumerate(sorted(table.rows, key=lambda r: (_address_key(r.source), r.valid_from)), 1):
        until = row.valid_to.strftime("%Y-%m-%dT%H:%MZ") if row.valid_to else "…"
        rows.append((str(number), row.source, row.group,
                     row.bed_label if row.assigned else "— atanmamış",
                     METHOD_TR.get(row.method, row.method or "—"), row.verified_at or "—",
                     f"{row.valid_from.strftime('%Y-%m-%dT%H:%MZ')} → {until}", row.note or ""))
    widths = [max(len(line[i]) for line in [header, *rows]) for i in range(len(header) - 1)]
    for line in [header, *rows]:
        print("  ".join(cell.ljust(width) for cell, width in zip(line, widths)) + "  " + line[-1])
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):          # a Windows console is cp1252: Turkish needs UTF-8
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
