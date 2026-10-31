# homunculus-engine/tests/test_infinity_device_beds_contract.py
"""The one interface the strip and Aşama B read (spec D6, D19, §5.3): `DeviceBedSource`
(`current()`, `invalidate()`), `rows_digest` (Lane A's rule: the current rows as [source, bed_id,
bed_label], sorted by source, compact JSON, UTF-8) and `check_current` (one current row per source,
one current bound row per bed, a bound row names its bed; NOT the file's label rule). No database."""
from __future__ import annotations

import logging
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

from homunculus.api.infinity_device_beds import (
    DeviceBedSource, Row, TableError, TableFile, check_current, rows_digest,
)

V2 = Path(__file__).resolve().parents[2] / "deploy" / "infinity" / "device-beds.icu2.json"
V2_DIGEST = "e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af"
FROM = datetime(2026, 10, 19, tzinfo=timezone.utc)
BED = "ccbcafd3-0e2c-4c20-8960-e260cf02f3af"
BED2 = "5d1a7c0e-3b8f-4f6a-9a41-0c7e2b9d6a10"


def _row(source, bed_label=None, bed_id=None, *, valid_to=None):
    return Row(source, "224.0.2." + source.rsplit(".", 1)[1], 2050, bed_label, bed_id,
               "82ff93a0-4b67-4ccc-b326-77fa48524222" if bed_id else None,
               "editor" if bed_label else None, None, FROM, valid_to, None)


def test_the_file_source_and_any_conforming_object_are_device_bed_sources():
    class Fixed:
        def current(self, now=None):
            return None

        def invalidate(self):
            pass

    assert isinstance(TableFile(V2, clock=lambda: 0.0), DeviceBedSource)
    assert isinstance(Fixed(), DeviceBedSource)
    assert not isinstance(object(), DeviceBedSource)


def test_invalidate_makes_the_next_current_look_again_and_the_same_bytes_keep_their_state():
    reads = []

    def read(path):
        reads.append(path)
        return V2.read_bytes()

    source = TableFile(V2, clock=lambda: 0.0, read=read)
    first = source.current(100.0)
    assert source.current(101.0) is first and len(reads) == 1          # inside RELOAD_EVERY_S
    source.invalidate()
    assert source.current(102.0) is first and len(reads) == 2          # looked again, same bytes


def test_the_digest_is_lane_as_rule_over_the_current_rows():
    rows = [_row("10.10.203.25", "BED01"), _row("10.10.203.23", "BED05", BED)]
    # json.dumps([["10.10.203.23","ccbcafd3-…","BED05"],["10.10.203.25",null,"BED01"]], separators=(",",":"))
    assert rows_digest(rows) == "2f97e8a0953c89fcd0402cd81657b9485c3ccb77e4e72d7e0932b2d6165afd61"
    assert rows_digest(reversed(rows)) == rows_digest(rows)            # sorted by source
    relabelled = [rows[0], replace(rows[1], bed_label="bed05")]
    assert rows_digest(relabelled) != rows_digest(rows)                # the strip's label counts
    assert rows_digest([replace(r, method="both", note="x") for r in rows]) == rows_digest(rows)


def test_the_digest_does_not_depend_on_the_callers_order_or_on_the_ids_spelling():
    """A-9: the digest sorts by the whole triple (source, normalised bed_id, label), so even two rows
    of one source hash the same in either order, and it hashes the NORMALISED id (strip + casefold,
    `normalise_id`), as the strip and `board_view` read it: the file's and the database's ids agree."""
    same_source = [_row("10.10.203.23", "BED05", BED), _row("10.10.203.23", "BED06", BED2)]
    assert rows_digest(same_source) == rows_digest(reversed(same_source))
    plain = [_row("10.10.203.25", "BED01"), _row("10.10.203.23", "BED05", BED)]
    upper = [plain[0], replace(plain[1], bed_id=BED.upper())]
    padded = [plain[0], replace(plain[1], bed_id=f"  {BED} ")]
    assert rows_digest(upper) == rows_digest(plain) == rows_digest(padded)
    assert rows_digest(plain) == "2f97e8a0953c89fcd0402cd81657b9485c3ccb77e4e72d7e0932b2d6165afd61"
    assert rows_digest(upper) != rows_digest([plain[0], replace(plain[1], bed_id=BED2)])  # another bed


def test_a_closed_row_passed_in_changes_nothing():
    closed = datetime(2026, 10, 30, tzinfo=timezone.utc)
    current = [_row("10.10.203.25", "BED01"), _row("10.10.203.23", "BED05", BED)]
    history = [replace(_row("10.10.203.23", "BED09", BED2), valid_to=closed),
               replace(_row("10.10.203.27", "BED02"), valid_to=closed)]
    assert rows_digest(current + history) == rows_digest(current)
    assert rows_digest(history) == rows_digest([])


def test_the_v2_files_current_rows_digest_to_the_value_the_blocks_quote():
    state = TableFile(V2, clock=lambda: 0.0).current()
    assert state.status == "ok"
    assert rows_digest(r for r in state.table.rows if r.valid_to is None) == V2_DIGEST
    assert rows_digest(state.table.rows) == V2_DIGEST              # all rows, as the import will pass them


def test_a_second_current_after_invalidate_on_unchanged_bytes_logs_nothing(caplog):
    source = TableFile(V2, clock=lambda: 0.0)
    with caplog.at_level(logging.DEBUG, logger="homunculus.api.infinity_device_beds"):
        source.current(100.0)
        assert [r for r in caplog.records if "yüklendi" in r.getMessage()]   # the first look announces
        caplog.clear()
        source.invalidate()
        source.current(101.0)
    assert caplog.records == []                                    # "unannounced"


@pytest.mark.parametrize("rows, reason", [
    ([_row("10.10.203.23", "BED05", BED), _row("10.10.203.23")], "aynı kaynak"),
    ([_row("10.10.203.23", "BED05", BED), _row("10.10.203.24", "bed05", BED.upper())], "aynı yatak"),
    ([replace(_row("10.10.203.23", "BED05", BED), bed_label=None)], "etiket"),
    ([replace(_row("10.10.203.23", "BED05", BED), bed_label="")], "etiket"),
    ([replace(_row("10.10.203.23", "BED05", BED), bed_label="   ")], "etiket"),
    ([replace(_row("10.10.203.23", "BED05", BED), unit_id=None)], "birim"),
    ([replace(_row("10.10.203.23", "BED05", BED), unit_id="")], "birim"),
])
def test_check_current_refuses_two_rows_for_a_device_two_monitors_on_a_bed_a_blank_label_and_a_bed_without_its_unit(
        rows, reason):
    with pytest.raises(TableError, match=reason):
        check_current(rows)


def test_check_current_allows_history_and_a_label_only_row_named_like_a_yapi_bed():
    closed = datetime(2026, 10, 30, tzinfo=timezone.utc)
    check_current([
        _row("10.10.203.23", "BED05", BED, valid_to=closed),        # history: not current
        _row("10.10.203.23", "bed05", BED),
        _row("10.10.203.25", "bed05"),                              # BED01-like: a label, no bed_id
        _row("10.10.203.26"),                                       # unbound
    ])
