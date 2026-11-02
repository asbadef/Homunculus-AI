# homunculus-engine/tests/test_protocol_settings.py
"""Yönetim › Protokol ve etiket (G2-B1d, spec §3, D5, D6, D10, D11): the barcode-fit rule and the
start-number rule on the shared case table (tests/label_fit_cases.json — the dashboard reads the
same file), and GET|PUT /admin/protocol-settings: `structure.manage` in the caller's tenant;
twelve digits and at least 000000000001 (A-1); the size, the dpi and the fit refused with their
codes; the start number only ever forward of the last issued; every change audited
`protocol.settings` with no patient in it. The rules need no database; the routes run on Postgres
(tests/kabul_world.py). Synthetic ward only."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, update

from homunculus.protocol.fit import label_refusal, min_width_mm, module_mm
from homunculus.protocol.models import ProtocolSettings
from homunculus.protocol.numbers import parse_start_no
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client

TABLE = json.loads((Path(__file__).parent / "label_fit_cases.json").read_text(encoding="utf-8"))
URL = "/admin/protocol-settings"


def body(next_no: str = "202600000001", width: int = 50, height: int = 30, dpi: int = 203) -> dict:
    return {"next_no": next_no, "label_width_mm": width, "label_height_mm": height, "printer_dpi": dpi}


# ---------------------------------------------------------------- the rules (no database)
@pytest.mark.parametrize("case", TABLE["cases"], ids=lambda c: f"{c['width_mm']}x{c['height_mm']}@{c['printer_dpi']}")
def test_every_case_of_the_shared_table(case):
    assert label_refusal(case["width_mm"], case["height_mm"], case["printer_dpi"]) == case["answer"]


@pytest.mark.parametrize("case", TABLE["next_no_cases"], ids=lambda c: repr(c["next_no"]))
def test_every_start_number_case_of_the_shared_table(case):
    """A-1: twelve ASCII digits and not 000000000000 — the number the test label prints."""
    assert case["answer"] in (None, "protocol_format")     # a wrong non-null answer cannot pass
    expected = None if case["answer"] is None else "protocol_format"
    assert (None if parse_start_no(case["next_no"]) is not None else "protocol_format") == expected


def test_the_full_width_case_of_the_table_is_twelve_characters():
    """So it is refused for its script, not for its length."""
    (wide,) = [c["next_no"] for c in TABLE["next_no_cases"] if not c["next_no"].isascii()]
    assert len(wide) == 12 and wide.isdigit()


def test_a_module_is_whole_printer_dots_and_the_barcode_fits_a_50_mm_label_at_either_dpi():
    """D10: 3 dots at 203 dpi (0.375 mm), 4 at 300 (0.339 mm) — a bar on a dot boundary prints
    crisp. 121 modules and 1.5 mm each side: ≈48.4 mm at 203 dpi, ≈44 mm at 300."""
    assert module_mm(203) == pytest.approx(3 * 25.4 / 203)
    assert module_mm(300) == pytest.approx(4 * 25.4 / 300)
    for dpi, expected in TABLE["min_width_mm"].items():
        assert min_width_mm(int(dpi)) == pytest.approx(expected, abs=1e-3)
    assert min_width_mm(203) < 50 and min_width_mm(300) < 50


# ---------------------------------------------------------------- the routes
@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    # The ward's own row (Task 4 gives every ward a start number) is removed: these tests begin
    # where a tenant begins, with nothing set.
    await db_session.execute(delete(ProtocolSettings))
    await db_session.commit()
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _issued(db_session, w, last: int) -> None:
    """As if admissions had issued numbers up to `last`."""
    await db_session.execute(update(ProtocolSettings).where(ProtocolSettings.tenant_id == w.tenant.id)
                             .values(last_issued=last, next_no=last + 1))
    await db_session.commit()


def _settings_rows(app) -> list:
    return app.state.audit.records(tenant=SLUG, event_type="protocol.settings", limit=50)


@requires_db
async def test_a_tenant_starts_unconfigured_with_a_50_by_30_label_at_203_dpi(ward):
    w, client, _ = ward
    r = await client.get(URL, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {k: v for k, v in r.json().items() if k != "updated_at"} == {
        "configured": False, "next_no": None, "last_issued": None,
        "label_width_mm": 50, "label_height_mm": 30, "printer_dpi": 203}


@requires_db
async def test_the_administrator_sets_the_start_and_the_label_and_it_is_audited(ward, db_session):
    w, client, app = ward
    r = await client.put(URL, json=body(width=60, height=40, dpi=300), headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {k: v for k, v in r.json().items() if k != "updated_at"} == {
        "configured": True, "next_no": "202600000001", "last_issued": None,
        "label_width_mm": 60, "label_height_mm": 40, "printer_dpi": 300}
    assert (await client.get(URL, headers=w.auth["admin"])).json()["next_no"] == "202600000001"
    (row,) = (await db_session.execute(select(ProtocolSettings))).scalars()
    assert (row.tenant_id, row.next_no, row.updated_by) == (w.tenant.id, 202600000001,
                                                             w.users["admin"].id)
    (audit,) = _settings_rows(app)
    assert audit.patient_id == ""
    assert audit.payload == {"actor": "admin@kabul.example.com",
                             "next_no": [None, "202600000001"],
                             "label": [[50, 30, 203], [60, 40, 300]]}


@requires_db
async def test_the_smallest_start_number_is_000000000001(ward):
    """A-1: one above the number the test label prints."""
    w, client, _ = ward
    r = await client.put(URL, json=body("000000000001"), headers=w.auth["admin"])
    assert (r.status_code, r.json()["next_no"]) == (200, "000000000001"), r.text


@requires_db
async def test_the_start_moves_only_forward_of_the_last_number_issued(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(), headers=w.auth["admin"])).status_code == 200
    await _issued(db_session, w, 202600000041)
    for back in ("202600000041", "202600000040", "000000000001"):
        r = await client.put(URL, json=body(back), headers=w.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "protocol_not_forward"), back
    db_session.expire_all()
    (row,) = (await db_session.execute(select(ProtocolSettings))).scalars()
    assert (row.next_no, row.last_issued) == (202600000042, 202600000041)       # unchanged
    for ahead in ("300000000000", "202600000042"):          # forward, and back to last + 1
        r = await client.put(URL, json=body(ahead), headers=w.auth["admin"])
        assert (r.status_code, r.json()["next_no"]) == (200, ahead), r.text
    assert len(_settings_rows(app)) == 3                     # the refusals wrote nothing


@requires_db
@pytest.mark.parametrize("sent, code", [
    (body("20260000001"), "protocol_format"),
    (body("20260000000A"), "protocol_format"),
    (body("２０２６０００００００１"), "protocol_format"),
    (body("2026000000 1"), "protocol_format"),
    (body("000000000000"), "protocol_format"),             # A-1: the test label's number
    (body(dpi=600), "label_dpi"),
    (body(width=111), "label_size"),
    (body(height=19), "label_size"),
    (body(width=48), "label_too_narrow"),
    (body("x", dpi=600), "protocol_format"),               # the number first (E11)
    (body("000000000000", dpi=600), "protocol_format"),    # …the zero start as well (A-1)
])
async def test_a_bad_value_is_refused_with_its_code_and_writes_nothing(ward, db_session, sent, code):
    w, client, app = ward
    r = await client.put(URL, json=sent, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, code), r.text
    assert (await db_session.execute(select(func.count()).select_from(ProtocolSettings))).scalar_one() == 0
    assert _settings_rows(app) == []


@requires_db
async def test_the_zero_start_is_refused_for_a_tenant_that_has_a_row_too(ward, db_session):
    """A-1 holds before the stored row is read: a 422, not the 409 of "not forward"."""
    w, client, app = ward
    assert (await client.put(URL, json=body(), headers=w.auth["admin"])).status_code == 200
    await _issued(db_session, w, 202600000041)
    r = await client.put(URL, json=body("000000000000"), headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "protocol_format"), r.text
    db_session.expire_all()
    (row,) = (await db_session.execute(select(ProtocolSettings))).scalars()
    assert (row.next_no, row.last_issued) == (202600000042, 202600000041)
    assert len(_settings_rows(app)) == 1


@requires_db
async def test_a_field_too_many_or_of_the_wrong_type_is_refused(ward):
    w, client, _ = ward
    for sent in ({**body(), "last_issued": "202600000000"}, {**body(), "printer_dpi": "203"},
                 {**body(), "next_no": 202600000001}):
        assert (await client.put(URL, json=sent, headers=w.auth["admin"])).status_code == 422


@requires_db
async def test_only_structure_manage_reads_or_writes_them(ward):
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor"):
        assert (await client.get(URL, headers=w.auth[who])).status_code == 403
        assert (await client.put(URL, json=body(), headers=w.auth[who])).status_code == 403
