"""Aşama A's device→bed table: which monitor sits at which bed, as the user approved it.

A bed for a monitor comes from this table and from nothing else — never from the hub's inventory
name, which is a label someone typed. The table is a reviewed file in the repo
(`deploy/infinity/device-beds.icu2.json`), versioned three ways (git history, `version`, the
approval fields), copied to the VM with its sha256 checked, and read here.

Closed and strict: an unknown key anywhere refuses the whole table, so no patient field can ever
be added to it; an unapproved table is not loaded (the approval is the switch). Every refusal
names the rule broken in one Turkish sentence, with addresses and labels only.

Failing closed: a missing, unreadable or invalid file places NO monitor on a bed. The last good
table is deliberately not kept — a table someone changed and broke is not one to keep trusting.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
import os
import re
import stat as stat_module
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

from homunculus.scope.rules import normalise_id

log = logging.getLogger(__name__)

SCHEMA = "homunculus.infinity-device-beds.v1"
PORT = 2050                                          # the PDS port, as edge/infinity_stream.py
TOP_KEYS = frozenset({"schema", "version", "site", "approved_by", "approved_at", "devices"})
ROW_KEYS = frozenset({"source", "group", "port", "bed_label", "bed_id", "unit_id", "method",
                      "verified_at", "valid_from", "valid_to", "note"})
METHODS = frozenset({"central_station_list", "monitor_screen", "both"})
BED_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}")
MAX_ID = 128                                         # bed_id / unit_id: the board's own ids
MAX_TEXT = 500                                       # site, approved_by, note
MAX_ROWS = 1000                                      # rows, history included
MAX_BYTES = 256 * 1024
RELOAD_EVERY_S = 10.0
_LINK_LOCAL_MULTICAST = ipaddress.IPv4Network("224.0.0.0/24")
_FOREVER = datetime.max.replace(tzinfo=timezone.utc)


class TableError(ValueError):
    """The whole table is refused. `reason` is one Turkish sentence: the rule broken, with
    addresses and labels only."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Row:
    source: str
    group: str
    port: int
    bed_label: str | None                  # None: unassigned, shown only as "atanmamış cihaz"
    bed_id: str | None
    unit_id: str | None
    method: str | None
    verified_at: str | None
    valid_from: datetime
    valid_to: datetime | None              # exclusive
    note: str | None

    @property
    def assigned(self) -> bool:
        return self.bed_label is not None

    def valid_at(self, when: datetime) -> bool:
        return self.valid_from <= when < (self.valid_to or _FOREVER)


@dataclass(frozen=True)
class DeviceBedTable:
    version: int
    site: str
    approved_by: str
    approved_at: str
    rows: tuple[Row, ...]

    def at(self, source: str, when: datetime | float) -> Row | None:
        """The row valid for `source` at `when` (an aware datetime or an epoch), or None."""
        moment = _moment(when)
        return next((row for row in self.rows if row.source == source and row.valid_at(moment)), None)

    def counts(self) -> tuple[int, int]:
        """(assigned rows, unassigned rows), history included."""
        assigned = sum(1 for row in self.rows if row.assigned)
        return assigned, len(self.rows) - assigned


def _moment(when: datetime | float) -> datetime:
    if isinstance(when, datetime):
        if when.tzinfo is None:
            raise TypeError("an aware datetime is required")
        return when
    return datetime.fromtimestamp(float(when), timezone.utc)


def _names(keys) -> str:
    return ", ".join(sorted(str(key)[:32] for key in keys))


def _text(value: Any, *, limit: int = MAX_TEXT) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _iso_date(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _utc(value: Any) -> datetime | None:
    """ISO-8601 with an explicit UTC offset ("Z" or +00:00), or None."""
    if not isinstance(value, str) or not (value.endswith("Z") or value.endswith("+00:00")):
        return None
    try:
        moment = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return None
    if moment.tzinfo is None or moment.utcoffset().total_seconds() != 0:
        return None
    return moment


def unicast_ipv4(value: Any) -> str | None:
    """A monitor's source address, as edge/infinity_stream.py `Inventory.parse` accepts it, or None.
    A string only: `ipaddress` would otherwise take an integer for an address."""
    if not isinstance(value, str):
        return None
    try:
        ip = ipaddress.IPv4Address(value)
    except (ipaddress.AddressValueError, ValueError):
        return None
    if ip.is_multicast or ip.is_loopback or ip.is_unspecified or ip.is_reserved:
        return None
    return str(ip)


def multicast_ipv4(value: Any) -> str | None:
    """A monitor's multicast group (not the link-local 224.0.0.0/24), or None."""
    if not isinstance(value, str):
        return None
    try:
        ip = ipaddress.IPv4Address(value)
    except (ipaddress.AddressValueError, ValueError):
        return None
    if not ip.is_multicast or ip in _LINK_LOCAL_MULTICAST:
        return None
    return str(ip)


def _optional_id(value: Any) -> bool:
    return value is None or (isinstance(value, str) and 1 <= len(value) <= MAX_ID)


def _row(position: int, raw: Any) -> Row:
    where = f"satır {position}"
    if not isinstance(raw, dict):
        raise TableError(f"{where}: bir JSON nesnesi değil")
    if set(raw) - ROW_KEYS:
        raise TableError(f"{where}: bilinmeyen alan ({_names(set(raw) - ROW_KEYS)}); şema kapalı")
    if ROW_KEYS - set(raw):
        raise TableError(f"{where}: eksik alan ({_names(ROW_KEYS - set(raw))})")
    source = unicast_ipv4(raw["source"])
    if source is None:
        raise TableError(f"{where}: kaynak adres tek-noktaya (unicast) bir IPv4 adresi değil")
    where = f"{where} ({source})"
    group = multicast_ipv4(raw["group"])
    if group is None:
        raise TableError(f"{where}: grup adresi çok-noktaya (multicast) bir IPv4 adresi değil")
    if type(raw["port"]) is not int or raw["port"] != PORT:
        raise TableError(f"{where}: port {PORT} değil")
    label = raw["bed_label"]
    if label is not None and not (isinstance(label, str) and BED_LABEL.fullmatch(label)):
        raise TableError(f"{where}: yatak etiketi geçersiz (harf, rakam, boşluk . _ -; en çok 32 karakter)")
    for name in ("bed_id", "unit_id"):
        if not _optional_id(raw[name]):
            raise TableError(f"{where}: {name} null ya da en çok {MAX_ID} karakterlik bir metin olmalı")
    method, verified_at, note = raw["method"], raw["verified_at"], raw["note"]
    if note is not None and not _text(note):
        raise TableError(f"{where}: note en çok {MAX_TEXT} karakterlik bir metin olmalı")
    if label is not None:
        if method not in METHODS:
            raise TableError(f"{where}: atanmış satırın yöntemi central_station_list, monitor_screen ya da both olmalı")
        if not _iso_date(verified_at):
            raise TableError(f"{where}: atanmış satırın verified_at alanı bir tarih değil (YYYY-AA-GG)")
    else:
        if not (isinstance(note, str) and note.strip()):
            raise TableError(f"{where}: atanmamış satırın nedeni (note) yazılmalı")
        if raw["bed_id"] is not None or raw["unit_id"] is not None:
            raise TableError(f"{where}: atanmamış satırda bed_id ya da unit_id olamaz")
        if method is not None and method not in METHODS:
            raise TableError(f"{where}: yöntem central_station_list, monitor_screen, both ya da null olmalı")
        if verified_at is not None and not _iso_date(verified_at):
            raise TableError(f"{where}: verified_at bir tarih (YYYY-AA-GG) ya da null olmalı")
    valid_from = _utc(raw["valid_from"])
    if valid_from is None:
        raise TableError(f"{where}: valid_from ISO-8601 UTC bir zaman değil (örnek 2026-10-16T00:00:00Z)")
    valid_to = None
    if raw["valid_to"] is not None:
        valid_to = _utc(raw["valid_to"])
        if valid_to is None or valid_to <= valid_from:
            raise TableError(f"{where}: valid_to null ya da valid_from'dan sonraki bir UTC zaman olmalı")
    return Row(source, group, PORT, label, raw["bed_id"], raw["unit_id"], method, verified_at,
               valid_from, valid_to, note)


def _overlap(a: Row, b: Row) -> bool:
    return a.valid_from < (b.valid_to or _FOREVER) and b.valid_from < (a.valid_to or _FOREVER)


_SEPARATORS = re.compile(r"[\s._-]+")


def bed_label_key(label: str) -> str:
    """One bed, however its label is spelled: "BED05", "bed 05" and "BED-05" are the same bed. Two
    monitors on one bed is the ambiguity (design K5) this table must never contain, so the match
    errs towards "the same": a table that spells two beds alike is refused and is easily fixed,
    while two monitors on one patient's bed are not."""
    return _SEPARATORS.sub("", label).casefold()


def _same_bed(a: Row, b: Row) -> bool:
    if bed_label_key(a.bed_label) == bed_label_key(b.bed_label):
        return True
    return bool(a.bed_id and b.bed_id and normalise_id(a.bed_id) == normalise_id(b.bed_id))


def parse_table(raw: Any) -> DeviceBedTable:
    """The table, or `TableError` with one Turkish reason. Nothing is partly accepted."""
    if not isinstance(raw, dict):
        raise TableError("tablo bir JSON nesnesi değil")
    if set(raw) - TOP_KEYS:
        raise TableError(f"bilinmeyen alan ({_names(set(raw) - TOP_KEYS)}); şema kapalı")
    if TOP_KEYS - set(raw):
        raise TableError(f"eksik alan ({_names(TOP_KEYS - set(raw))})")
    if raw["schema"] != SCHEMA:
        raise TableError(f"şema {SCHEMA} değil")
    version = raw["version"]
    if type(version) is not int or version < 1:
        raise TableError("sürüm (version) pozitif bir tam sayı değil")
    if not _text(raw["site"]):
        raise TableError(f"site en çok {MAX_TEXT} karakterlik bir metin olmalı")
    approved_by, approved_at = raw["approved_by"], raw["approved_at"]
    if not (_text(approved_by) and approved_by.strip()) or not (isinstance(approved_at, str) and approved_at.strip()):
        raise TableError("tablo onaylanmamış: approved_by ve approved_at doldurulmalı")
    if not _iso_date(approved_at):
        raise TableError("approved_at bir tarih değil (YYYY-AA-GG)")
    devices = raw["devices"]
    if not isinstance(devices, list) or len(devices) > MAX_ROWS:
        raise TableError(f"devices en çok {MAX_ROWS} satırlık bir liste olmalı")
    rows = tuple(_row(position, row) for position, row in enumerate(devices, start=1))
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if not _overlap(a, b):
                continue
            if a.source == b.source:
                raise TableError(f"aynı kaynak ({a.source}) için geçerlilik aralıkları çakışan iki satır var")
            if a.assigned and b.assigned and _same_bed(a, b):
                raise TableError(f"aynı yatak ({a.bed_label} / {b.bed_label}) için geçerlilik aralıkları "
                                 f"çakışan iki atanmış satır var ({a.source}, {b.source}): bir yatakta iki monitör")
    return DeviceBedTable(version, raw["site"], approved_by, approved_at, rows)


def no_duplicate_keys(pairs):
    """`json.loads(..., object_pairs_hook=no_duplicate_keys)`: a key given twice hides one of its
    values from whoever reviewed the file, so it is refused (the review printer uses it too)."""
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate key")
    return dict(pairs)


def read_capped(path: Path) -> bytes:
    """At most one byte past MAX_BYTES: the size check is a stat, and a file that grew after it is
    still never read whole."""
    with open(path, "rb") as handle:
        return handle.read(MAX_BYTES + 1)


class TableState(NamedTuple):
    table: DeviceBedTable | None
    status: str                      # "ok" | "missing" | "invalid"
    reason: str | None
    sha256: str | None               # of the file's bytes, whenever they were read
    version: int | None


class TableFile:
    """The deployed table, looked at once per RELOAD_EVERY_S at most and re-parsed when its BYTES
    changed (their sha256). Not by size or mtime: `cp -p`, `rsync -t`, `tar x` or a same-length
    edit keep both, and on some filesystems (NTFS) neither the inode nor the ctime moves on a
    rewrite either. Reading a file of at most MAX_BYTES every 10 s costs nothing worth saving.
    `clock` is monotonic seconds; `stat` and `read` are injectable."""

    def __init__(self, path: str | os.PathLike, clock: Callable[[], float], *,
                 stat: Callable = os.stat, read: Callable = read_capped):
        self._path = Path(path)
        self._clock, self._stat, self._read = clock, stat, read
        self._state: TableState | None = None
        self._checked_at = 0.0
        self._seen: tuple | None = None          # what was found last: the bytes' sha, or why none

    def current(self, now: float | None = None) -> TableState:
        now = self._clock() if now is None else now
        if self._state is not None and 0 <= now - self._checked_at < RELOAD_EVERY_S:
            return self._state
        self._checked_at = now
        early, data = self._fetch()
        seen = ("bytes", hashlib.sha256(data).hexdigest()) if data is not None else ("none", early)
        if self._state is not None and seen == self._seen:
            return self._state
        self._seen = seen
        state = early if data is None else self._parse(data)
        self._announce(state)
        self._state = state
        return state

    def _fetch(self) -> tuple[TableState | None, bytes | None]:
        """The file's bytes, or the state that says why there are none."""
        try:
            info = self._stat(self._path)
        except (FileNotFoundError, NotADirectoryError):
            return TableState(None, "missing", "dosya yok", None, None), None
        except OSError:
            return TableState(None, "invalid", "dosyaya erişilemedi", None, None), None
        if stat_module.S_ISDIR(info.st_mode):
            return TableState(None, "missing", "yol bir klasör, dosya değil", None, None), None
        if not stat_module.S_ISREG(info.st_mode):
            return TableState(None, "invalid", "yol düzenli bir dosya değil", None, None), None
        too_large = TableState(None, "invalid", f"dosya {MAX_BYTES // 1024} KiB'tan büyük", None, None)
        if info.st_size > MAX_BYTES:
            return too_large, None
        try:
            data = self._read(self._path)
        except FileNotFoundError:
            return TableState(None, "missing", "dosya yok", None, None), None
        except OSError:
            return TableState(None, "invalid", "dosya okunamadı", None, None), None
        if len(data) > MAX_BYTES:                  # it grew between the stat and the read
            return too_large, None
        return None, data

    def _parse(self, data: bytes) -> TableState:
        digest = hashlib.sha256(data).hexdigest()
        try:
            raw = json.loads(data.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
        except (UnicodeDecodeError, ValueError, RecursionError):
            return TableState(None, "invalid", "JSON okunamadı (bozuk ya da tekrarlanan anahtar)", digest, None)
        try:
            table = parse_table(raw)
        except TableError as error:
            return TableState(None, "invalid", error.reason, digest, None)
        return TableState(table, "ok", None, digest, table.version)

    def _announce(self, state: TableState) -> None:
        if state.status == "ok":
            assigned, unassigned = state.table.counts()
            log.info("cihaz→yatak tablosu yüklendi: sürüm %d, sha256 %s…, %d atanmış, %d atanmamış",
                     state.version, state.sha256[:12], assigned, unassigned)
        else:
            log.warning("cihaz→yatak tablosu okunamadı (%s): %s; bütün cihazlar atanmamış",
                        state.status, state.reason)
