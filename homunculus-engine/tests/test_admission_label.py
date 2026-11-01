# homunculus-engine/tests/test_admission_label.py
"""The protocol label's data (G2-B1d, spec §6, D11): `admissions.admit` in the caller's units; the
answer is exactly the label's fields and the tenant's label settings; every print is audited
`admission.label_print` — who, the admission, its protocol, a reprint or not — and never the name;
an admission without a protocol has no label (409 `no_protocol`). Postgres. Synthetic ward."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import delete, update

from homunculus.admission.models import Admission, AdmissionState
from homunculus.protocol.models import ProtocolSettings
from tests.conftest import requires_db
from tests.kabul_world import FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form
from tests.test_protocol_board_key import _legacy

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def printed(app) -> list:
    return app.state.audit.records(tenant=SLUG, event_type="admission.label_print", limit=50)


async def _admitted(w, client) -> dict:
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_label_carries_its_fields_and_the_tenants_settings(ward, db_session):
    w, client, _ = ward
    await db_session.execute(update(ProtocolSettings).values(label_width_mm=60, label_height_mm=40,
                                                             printer_dpi=300))
    await db_session.commit()
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": False},
                          headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    assert r.json() == {"protocol_no": FIRST_PROTOCOL, "display_name": "Sentetik Hasta",
                        "date_of_birth": "1970-05-05", "sex": "female", "unit_name": "Reanimasiya",
                        "bed_label": "1", "label": {"width_mm": 60, "height_mm": 40, "printer_dpi": 300}}


async def test_without_a_settings_row_the_label_is_the_default_50_by_30(ward, db_session):
    w, client, _ = ward
    admission = await _admitted(w, client)
    await db_session.execute(delete(ProtocolSettings))
    await db_session.commit()
    r = await client.post(f"/admissions/{admission['id']}/label", headers=w.auth["nurse"])
    assert r.json()["label"] == {"width_mm": 50, "height_mm": 30, "printer_dpi": 203}


async def test_every_print_is_audited_with_its_protocol_and_never_the_name(ward):
    w, client, app = ward
    admission = await _admitted(w, client)
    for reprint in (False, True):
        r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": reprint},
                              headers=w.auth["nurse"])
        assert r.status_code == 200, r.text
    rows = printed(app)
    assert [(row.patient_id, row.payload) for row in rows] == [
        (FIRST_PROTOCOL, {"admission_id": admission["id"], "protocol_no": FIRST_PROTOCOL,
                          "reprint": reprint, "actor": "nurse@kabul.example.com"})
        for reprint in (False, True)]
    assert "Sentetik" not in repr([row.payload for row in rows])


async def test_an_admission_without_a_protocol_has_no_label(ward, db_session):
    w, client, app = ward
    legacy = await _legacy(db_session, app, w)
    r = await client.post(f"/admissions/{legacy.id}/label", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "no_protocol")
    assert printed(app) == []


async def test_a_discharged_admissions_label_still_prints_and_is_audited(ward, db_session):
    """Amendment A-2 (O76): the spec is silent on a closed admission; printing stays allowed, with
    no new refusal code, and is audited like any print."""
    w, client, app = ward
    admission = await _admitted(w, client)
    await db_session.execute(update(Admission).where(Admission.id == admission["id"])
                             .values(state=AdmissionState.DISCHARGED))
    await db_session.commit()
    r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": True},
                          headers=w.auth["nurse"])
    assert (r.status_code, r.json()["protocol_no"]) == (200, FIRST_PROTOCOL), r.text
    assert [row.payload["reprint"] for row in printed(app)] == [True]


@pytest.mark.parametrize("who", ["doctor", "auditor"])
async def test_only_admissions_admit_prints(ward, who):
    """The physician and the auditor hold no admissions.admit: the permission 403, whose detail
    is words, not a refusal code (told apart from the unit one below)."""
    w, client, app = ward
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", headers=w.auth[who])
    assert r.status_code == 403, r.text
    assert r.json()["detail"].startswith("permission required"), r.text
    assert printed(app) == []


async def test_only_within_the_beds_units_prints(ward):
    """nurse_b holds admissions.admit for Neonatal only: the bed is Reanimasiya's, so the 403 is
    the unit's — `out_of_scope` — not the permission's."""
    w, client, app = ward
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", headers=w.auth["nurse_b"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope"), r.text
    assert printed(app) == []


async def test_a_body_field_it_does_not_know_is_refused(ward):
    w, client, _ = ward
    admission = await _admitted(w, client)
    r = await client.post(f"/admissions/{admission['id']}/label", json={"reprint": "evet"},
                          headers=w.auth["nurse"])
    assert r.status_code == 422
    r = await client.post(f"/admissions/{admission['id']}/label", json={"copies": 2},
                          headers=w.auth["nurse"])
    assert r.status_code == 422
