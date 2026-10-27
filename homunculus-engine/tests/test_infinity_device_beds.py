"""Aşama A's device→bed table: versioned, approved, closed, and failing closed.

Which monitor belongs to which bed is decided by a reviewed file, approved by the user, and by
nothing else (never an inventory name). An unapproved, malformed, missing or broken table puts
every monitor on an "atanmamış cihaz" card. Synthetic addresses only (192.0.2.x / 239.20.1.x);
the site's real table is checked through its file, never written into a test.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import stat as stat_module
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from homunculus.api.infinity_device_beds import (
    RELOAD_EVERY_S, SCHEMA, DeviceBedTable, TableError, TableFile, parse_table,
)

ROOT = Path(__file__).resolve().parents[2]
WHEN = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _row(source="192.0.2.10", group="239.20.1.10", bed="B-1", **over):
    row = {"source": source, "group": group, "port": 2050, "bed_label": bed, "bed_id": None,
           "unit_id": None, "method": "monitor_screen", "verified_at": "2026-07-14",
           "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""}
    if bed is None:
        row.update(method=None, verified_at=None, note="unresolved: two sources disagree")
    row.update(over)
    return row


def _table(*rows, **over):
    table = {"schema": SCHEMA, "version": 1, "site": "synthetic", "approved_by": "test",
             "approved_at": "2026-07-14",
             "devices": list(rows) or [_row(), _row("192.0.2.11", "239.20.1.11", "B-2", bed_id="bed-b2",
                                                    unit_id="unit-1", method="both"),
                                       _row("192.0.2.12", "239.20.1.12", None)]}
    table.update(over)
    return table


def _refused(raw) -> str:
    with pytest.raises(TableError) as caught:
        parse_table(raw)
    return caught.value.reason


# --- accepted ---------------------------------------------------------------------------------

def test_a_valid_table_loads_and_resolves():
    table = parse_table(_table())
    assert isinstance(table, DeviceBedTable)
    assert (table.version, table.site, table.approved_at) == (1, "synthetic", "2026-07-14")
    one = table.at("192.0.2.10", WHEN)
    assert (one.bed_label, one.assigned, one.bed_id) == ("B-1", True, None)
    two = table.at("192.0.2.11", WHEN.timestamp())          # an epoch is accepted as well
    assert (two.bed_label, two.bed_id, two.unit_id, two.method) == ("B-2", "bed-b2", "unit-1", "both")
    unassigned = table.at("192.0.2.12", WHEN)
    assert unassigned is not None and not unassigned.assigned and unassigned.bed_label is None
    assert table.at("192.0.2.99", WHEN) is None
    assert table.at("192.0.2.10", datetime(2026, 6, 30, tzinfo=timezone.utc)) is None   # before valid_from
    assert table.counts() == (2, 1)


def test_a_monitor_that_moved_is_resolved_by_its_interval():
    moved = "2026-07-14T08:00:00Z"
    table = parse_table(_table(
        _row(valid_to=moved),                                                    # .10 on B-1 until 08:00
        _row(bed="B-3", valid_from=moved),                                       # then .10 on B-3
        _row("192.0.2.11", "239.20.1.11", "B-1", valid_from=moved),              # and .11 takes B-1
    ))
    before, after = datetime(2026, 7, 14, 7, 59, tzinfo=timezone.utc), WHEN
    assert table.at("192.0.2.10", before).bed_label == "B-1"
    assert table.at("192.0.2.10", after).bed_label == "B-3"
    assert table.at("192.0.2.11", before) is None                               # not_in_table
    assert table.at("192.0.2.11", after).bed_label == "B-1"


def test_a_row_whose_interval_ended_no_longer_resolves():
    table = parse_table(_table(_row(valid_to="2026-07-10T00:00:00Z")))
    assert table.at("192.0.2.10", datetime(2026, 7, 9, tzinfo=timezone.utc)).bed_label == "B-1"
    assert table.at("192.0.2.10", WHEN) is None


# --- refused: the whole table, with one Turkish reason ------------------------------------------

def _mutated(path, value):
    def mutate():
        raw = _table()
        target = raw
        for key in path[:-1]:
            target = target[key]
        if value is _DELETE:
            del target[path[-1]]
        else:
            target[path[-1]] = value
        return raw
    return mutate


_DELETE = object()

REFUSALS = [
    ("schema", _mutated(["schema"], "homunculus.infinity-device-beds.v2"), "şema"),
    ("version 0", _mutated(["version"], 0), "sürüm"),
    ("version bool", _mutated(["version"], True), "sürüm"),
    ("version text", _mutated(["version"], "1"), "sürüm"),
    ("approved_by empty", _mutated(["approved_by"], ""), "onaylanmamış"),
    ("approved_at empty", _mutated(["approved_at"], "  "), "onaylanmamış"),
    ("approved_at not a date", _mutated(["approved_at"], "dün"), "approved_at"),
    ("unknown top key", _mutated(["patient_names"], ["VALUE-SENTINEL"]), "bilinmeyen alan"),
    ("unknown row key", _mutated(["devices", 0, "patient_id"], "VALUE-SENTINEL"), "bilinmeyen alan"),
    ("missing row key", _mutated(["devices", 0, "note"], _DELETE), "eksik alan"),
    ("source multicast", _mutated(["devices", 0, "source"], "239.20.1.50"), "unicast"),
    ("source loopback", _mutated(["devices", 0, "source"], "127.0.0.1"), "unicast"),
    ("source not an address", _mutated(["devices", 0, "source"], "bed-1"), "unicast"),
    ("group unicast", _mutated(["devices", 0, "group"], "192.0.2.50"), "multicast"),
    ("group link-local", _mutated(["devices", 0, "group"], "224.0.0.251"), "multicast"),
    ("port", _mutated(["devices", 0, "port"], 2051), "port"),
    ("port text", _mutated(["devices", 0, "port"], "2050"), "port"),
    ("bed label empty", _mutated(["devices", 0, "bed_label"], ""), "yatak etiketi"),
    ("bed label leading space", _mutated(["devices", 0, "bed_label"], " B1"), "yatak etiketi"),
    ("bed label too long", _mutated(["devices", 0, "bed_label"], "B" * 33), "yatak etiketi"),
    ("bed label slash", _mutated(["devices", 0, "bed_label"], "B/1"), "yatak etiketi"),
    ("assigned without method", _mutated(["devices", 0, "method"], None), "yöntem"),
    ("assigned with a guessed method", _mutated(["devices", 0, "method"], "inventory_name"), "yöntem"),
    ("assigned without verified_at", _mutated(["devices", 0, "verified_at"], None), "verified_at"),
    ("verified_at not a date", _mutated(["devices", 0, "verified_at"], "22.09"), "verified_at"),
    ("unassigned without note", _mutated(["devices", 2, "note"], ""), "neden"),
    ("unassigned with a bed id", _mutated(["devices", 2, "bed_id"], "bed-x"), "atanmamış"),
    ("valid_from not UTC", _mutated(["devices", 0, "valid_from"], "2026-07-01T00:00:00+04:00"), "valid_from"),
    ("valid_from a date only", _mutated(["devices", 0, "valid_from"], "2026-07-01"), "valid_from"),
    ("valid_to equal", _mutated(["devices", 0, "valid_to"], "2026-07-01T00:00:00Z"), "valid_to"),
    ("valid_to earlier", _mutated(["devices", 0, "valid_to"], "2026-06-01T00:00:00Z"), "valid_to"),
    ("bed_id too long", _mutated(["devices", 0, "bed_id"], "b" * 129), "bed_id"),
    ("unit_id empty", _mutated(["devices", 0, "unit_id"], ""), "unit_id"),
    ("devices not a list", _mutated(["devices"], {"a": 1}), "devices"),
]


@pytest.mark.parametrize(("make", "word"), [pytest.param(m, w, id=i) for i, m, w in REFUSALS])
def test_a_table_breaking_a_rule_is_refused_whole_with_its_reason(make, word):
    reason = _refused(make())
    assert word in reason
    assert "VALUE-SENTINEL" not in reason          # names the rule (and a key), never a value


def test_the_same_source_twice_in_overlapping_intervals_is_refused():
    reason = _refused(_table(_row(), _row(bed="B-9", valid_from="2026-07-10T00:00:00Z")))
    assert "192.0.2.10" in reason and "çakışan" in reason


def test_two_monitors_on_one_bed_in_overlapping_intervals_are_refused():
    reason = _refused(_table(_row(), _row("192.0.2.11", "239.20.1.11", "b-1")))   # case does not hide it
    assert "B-1" in reason and "çakışan" in reason


@pytest.mark.parametrize(("first", "second"), [
    (dict(bed="B-1", bed_id="bed-b1"), dict(bed="B-1a", bed_id="BED-B1 ")),   # one bed id, two spellings
    (dict(bed="B-1"), dict(bed="B-1 ")),                                     # a trailing space
    (dict(bed="BED05"), dict(bed="BED 05")),                                 # a separator
    (dict(bed="BED-05"), dict(bed="bed_05")),
])
def test_one_bed_by_any_spelling_holds_one_monitor(first, second):
    # Two monitors on one bed would both link to its patient (the review's wrong-patient path): a
    # label or a bed id is the same bed whatever its case, spaces or separators.
    reason = _refused(_table(_row(**first), _row("192.0.2.11", "239.20.1.11", **second)))
    assert "çakışan" in reason and "bir yatakta iki monitör" in reason


def test_the_same_source_and_bed_may_repeat_in_intervals_that_do_not_overlap():
    table = parse_table(_table(_row(valid_to="2026-07-10T00:00:00Z"),
                               _row(valid_from="2026-07-10T00:00:00Z"),
                               _row("192.0.2.11", "239.20.1.11", None, valid_from="2026-07-01T00:00:00Z")))
    assert table.counts() == (2, 1)


def test_a_table_that_is_not_an_object_is_refused():
    assert "nesne" in _refused([_row()])


# --- the file: fail closed, re-read at most every 10 s ------------------------------------------

class FakeFile:
    def __init__(self, data: bytes | None = None, *, directory: bool = False):
        self.data, self.directory, self.mtime, self.reads = data, directory, 1, 0
        self.ino, self.ctime = 7, 1

    def stat(self, path):
        if self.directory:
            return SimpleNamespace(st_mode=stat_module.S_IFDIR | 0o755, st_size=0, st_mtime_ns=self.mtime,
                                   st_ino=self.ino, st_ctime_ns=self.ctime)
        if self.data is None:
            raise FileNotFoundError(str(path))
        return SimpleNamespace(st_mode=stat_module.S_IFREG | 0o644, st_size=len(self.data), st_mtime_ns=self.mtime,
                               st_ino=self.ino, st_ctime_ns=self.ctime)

    def read(self, path):
        self.reads += 1
        if self.data is None:
            raise FileNotFoundError(str(path))
        return self.data

    def write(self, data: bytes | None):
        self.data, self.mtime = data, self.mtime + 1


def _bytes(raw) -> bytes:
    return json.dumps(raw).encode("utf-8")


def _file(fake: FakeFile, clock):
    return TableFile("/etc/homunculus/infinity-shadow/device-beds.json", clock=lambda: clock["t"],
                     stat=fake.stat, read=fake.read)


def test_a_valid_file_reports_its_version_and_sha256():
    data = _bytes(_table(version=4))
    state = _file(FakeFile(data), {"t": 0.0}).current()
    assert (state.status, state.reason, state.version) == ("ok", None, 4)
    assert state.sha256 == hashlib.sha256(data).hexdigest()
    assert state.table.at("192.0.2.10", WHEN).bed_label == "B-1"
    table, status, reason, sha256, version = state                     # the plan's tuple shape
    assert (status, version) == ("ok", 4)


def test_a_missing_path_or_a_directory_is_missing_and_places_nothing(tmp_path):
    for path in (tmp_path / "device-beds.json", tmp_path):            # Docker leaves a directory
        state = TableFile(str(path), clock=lambda: 0.0).current()
        assert (state.table, state.status, state.version) == (None, "missing", None)
        assert state.reason


@pytest.mark.parametrize(("data", "word"), [
    (b"{not json", "JSON"),
    (b'{"schema": "a", "schema": "b"}', "JSON"),                       # a duplicated key hides a value
    (_bytes(_table(approved_by="")), "onaylanmamış"),
    (b"\xff\xfe", "JSON"),
])
def test_unreadable_json_or_an_invalid_table_is_invalid_and_places_nothing(data, word):
    state = _file(FakeFile(data), {"t": 0.0}).current()
    assert (state.table, state.status, state.version) == (None, "invalid", None)
    assert word in state.reason
    assert state.sha256 == hashlib.sha256(data).hexdigest()           # what was there, for the operator


def test_a_file_too_large_is_invalid_without_being_read():
    fake = FakeFile(b" " * (300 * 1024))
    state = _file(fake, {"t": 0.0}).current()
    assert state.status == "invalid" and fake.reads == 0


def test_a_changed_file_is_re_read_at_most_every_10_s():
    clock, fake = {"t": 100.0}, FakeFile(_bytes(_table(version=1)))
    tablefile = _file(fake, clock)
    assert tablefile.current().version == 1 and fake.reads == 1
    fake.write(_bytes(_table(version=2)))
    clock["t"] += RELOAD_EVERY_S - 0.1
    assert tablefile.current().version == 1 and fake.reads == 1        # not looked at yet
    clock["t"] += 0.1
    assert tablefile.current().version == 2 and fake.reads == 2
    clock["t"] += 3
    assert tablefile.current().version == 2 and fake.reads == 2        # inside the 10 s: not looked at
    clock["t"] += 60
    assert tablefile.current().version == 2 and fake.reads == 3        # looked at once, at most


def test_a_same_length_edit_with_every_timestamp_kept_is_re_read():
    # `cp -p`, `rsync -t` and `tar x` keep the mtime, a same-length edit keeps the size, and on NTFS
    # a rewrite keeps the inode and the "ctime" (its creation time). Only the bytes say it changed.
    clock, fake = {"t": 0.0}, FakeFile(_bytes(_table(_row(bed="B-1"))))
    tablefile = _file(fake, clock)
    assert tablefile.current().table.rows[0].bed_label == "B-1"
    fake.data = _bytes(_table(_row(bed="B-2")))                       # same length; stat unchanged
    clock["t"] += RELOAD_EVERY_S
    assert tablefile.current().table.rows[0].bed_label == "B-2"


def test_a_table_that_did_not_change_is_not_parsed_or_logged_again(caplog):
    clock, fake = {"t": 0.0}, FakeFile(_bytes(_table()))
    tablefile = _file(fake, clock)
    with caplog.at_level(logging.INFO, logger="homunculus.api.infinity_device_beds"):
        first = tablefile.current()
        for _ in range(5):
            clock["t"] += RELOAD_EVERY_S
            assert tablefile.current() is first
    assert fake.reads == 6 and len(caplog.records) == 1


def test_a_file_that_grew_between_stat_and_read_is_refused(tmp_path):
    # The size check is a stat; the read is capped at one byte over the limit, so a file that grew
    # in between is still never read whole.
    path = tmp_path / "device-beds.json"
    path.write_bytes(b" " * (300 * 1024))
    small = SimpleNamespace(st_mode=stat_module.S_IFREG | 0o644, st_size=10, st_mtime_ns=1, st_ino=1, st_ctime_ns=1)
    state = TableFile(str(path), clock=lambda: 0.0, stat=lambda p: small).current()
    assert state.status == "invalid" and "KiB" in state.reason


def test_an_invalid_replacement_does_not_keep_the_old_table():
    clock, fake = {"t": 0.0}, FakeFile(_bytes(_table()))
    tablefile = _file(fake, clock)
    assert tablefile.current().status == "ok"
    fake.write(b"{broken")
    clock["t"] += RELOAD_EVERY_S
    state = tablefile.current()
    assert (state.table, state.status) == (None, "invalid")
    fake.write(None)
    clock["t"] += RELOAD_EVERY_S
    assert tablefile.current().status == "missing"


def test_loads_and_failures_are_logged_once_each_with_version_sha_and_counts(caplog):
    clock, fake = {"t": 0.0}, FakeFile(_bytes(_table(version=3)))
    tablefile = _file(fake, clock)
    with caplog.at_level(logging.INFO, logger="homunculus.api.infinity_device_beds"):
        sha = tablefile.current().sha256
        clock["t"] += RELOAD_EVERY_S
        tablefile.current()                                             # unchanged: no second line
        fake.write(_bytes(_table(approved_at="")))
        clock["t"] += RELOAD_EVERY_S
        tablefile.current()
    lines = [r.getMessage() for r in caplog.records]
    assert len(lines) == 2
    assert "sürüm 3" in lines[0] and f"sha256 {sha[:12]}…" in lines[0] and "2 atanmış, 1 atanmamış" in lines[0]
    assert "onaylanmamış" in lines[1] and "bütün cihazlar atanmamış" in lines[1]


# --- the site's table and its review ------------------------------------------------------------

ICU2 = ROOT / "deploy" / "infinity" / "device-beds.icu2.json"


def test_the_committed_site_table_is_approved_and_puts_every_monitor_on_its_own_bed():
    # Task 13: approved on 19.10.2026, every monitor on a bed (the three left open before were read
    # on the central station that day). parse_table refuses two monitors on one bed. v2 (B1a,
    # 27.10.2026): the same monitors on the same beds, the bed and unit ids now the tenant's UUIDs.
    raw = json.loads(ICU2.read_text(encoding="utf-8"))
    table = parse_table(raw)
    assert (table.version, table.approved_at) == (2, "2026-10-27")
    import uuid
    for row in table.rows:
        uuid.UUID(row.bed_id), uuid.UUID(row.unit_id)        # v2: tenant UUIDs, never labels
    assert table.counts() == (13, 0)
    inventory = json.loads((ROOT / "deploy" / "infinity" / "inventory.icu2.json").read_text(encoding="utf-8-sig"))
    assert {(r.source, r.group, r.port) for r in table.rows} == {
        (d["source"], d["group"], d["port"]) for d in inventory["devices"]}


def _review():
    spec = importlib.util.spec_from_file_location("device_beds_review", ROOT / "deploy/infinity/device_beds_review.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_review_prints_the_table_its_counts_and_its_sha256(tmp_path, capsys):
    review = _review()
    path = tmp_path / "device-beds.json"
    data = _bytes(_table(approved_by="", approved_at=""))
    path.write_bytes(data)
    assert review.main([str(path)]) == 1                                # unapproved: refused by default
    assert "onaylanmamış" in capsys.readouterr().out
    assert review.main(["--allow-unapproved", str(path)]) == 0
    out = capsys.readouterr().out
    assert hashlib.sha256(data).hexdigest() in out
    assert "2 atanmış, 1 atanmamış" in out and "ONAYLANMAMIŞ" in out
    assert out.index("192.0.2.10") < out.index("192.0.2.11") < out.index("192.0.2.12")
    path.write_bytes(_bytes(_table()))
    assert review.main([str(path)]) == 0
    assert "onaylayan: test" in capsys.readouterr().out
    # A duplicated key hides a value from the reviewer: refused, as the API refuses it.
    path.write_bytes(b'{"schema": "a", ' + _bytes(_table())[1:])
    assert review.main([str(path)]) == 1
    assert "JSON" in capsys.readouterr().out
