# homunculus-engine/tests/test_occupancy_read.py
"""GET /tenant/occupancy (G2-B3a, spec R1, R7, R8, D2). It returns, for the caller's beds only:
- the short name of the patient an open admission holds in the bed;
- a reservation's note;
- an out-of-service bed's reason and note.
It is read by whoever may open Doluluk, and by nobody else. A user manager or a device mapper —
who read /tenant/structure since X52 and ESLEME — gets neither names nor notes from either route.
/tenant/structure says since when each bed is in its state. Postgres; synthetic ward
(tests/kabul_world.py)."""
from __future__ import annotations

from datetime import datetime

import pytest_asyncio
from sqlalchemy import text

from homunculus.auth.models import Group, GroupPermission
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]
NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _form(w, bed: str) -> dict:
    """The Kabul tab's body for bed `bed`: "Sentetik Hasta <bed>", one person per bed."""
    return {
        "patient": {"display_name": f"Sentetik Hasta {bed}", "date_of_birth": "1970-05-05",
                    "sex": "female", "consent": "KVKK_SIGNED"},
        "note": {"admitting_unit_id": str(w.units["rea"].id), "bed_id": str(w.beds[bed].id),
                 "admission_type": "ICU", "admission_diagnosis_free_text": "Sentetik tanı",
                 "no_known_allergy": True},
    }


async def _admit(client, w, bed: str) -> dict:
    r = await client.post("/admissions", json=_form(w, bed), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    return r.json()


async def _bed_only(db, w, bed: str) -> dict[str, str]:
    """A signed-in account that may open Doluluk (`admissions.view`) with a grant on ONE BED and
    on no unit: the scope editor's «yalnız bu yatak» (B1a)."""
    group = Group(tenant_id=w.tenant.id, slug="sentetik-bed-only", name="Sentetik",
                  permissions=[GroupPermission(permission="admissions.view")])
    db.add(group)
    await db.flush()
    user = await add_user(db, username="bed-only@kabul.example.com", tenant_id=w.tenant.id,
                          group=group)
    db.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id, bed_id=str(w.beds[bed].id)))
    await db.commit()
    return await bearer(db, user)


async def _only(db, w, permission: str) -> dict[str, str]:
    """A signed-in account of the ward holding ONE right, granted Reanimasiya."""
    group = Group(tenant_id=w.tenant.id, slug=f"sentetik-{permission.replace('.', '-')}",
                  name="Sentetik", permissions=[GroupPermission(permission=permission)])
    db.add(group)
    await db.flush()
    user = await add_user(db, username=f"{permission}@kabul.example.com", tenant_id=w.tenant.id,
                          group=group)
    db.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id, unit_id=str(w.units["rea"].id)))
    await db.commit()
    return await bearer(db, user)


async def test_a_nurse_reads_the_short_name_in_a_bed_of_her_unit_and_no_other(ward):
    w, client, _ = ward
    await _admit(client, w, "2")
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    assert r.json() == {"beds": [{"bed_id": str(w.beds["2"].id), "occupant_short": "Hasta S.",
                                  "state_reason": None, "state_note": None}]}
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse_b"])        # Neonatal only
    assert r.json() == {"beds": []}


async def test_a_reservation_s_note_and_an_out_of_service_reason_are_read(ward):
    w, client, _ = ward
    await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": NOTE},
                      headers=w.auth["charge"])
    await client.post(f"/tenant/beds/{w.beds['10'].id}/out-of-service",
                      json={"reason": "ISOLATION_CLEANING"}, headers=w.auth["charge"])
    r = await client.get("/tenant/occupancy", headers=w.auth["charge"])
    beds = {b["bed_id"]: b for b in r.json()["beds"]}
    assert beds == {
        str(w.beds["3"].id): {"bed_id": str(w.beds["3"].id), "occupant_short": None,
                              "state_reason": None, "state_note": NOTE},
        str(w.beds["10"].id): {"bed_id": str(w.beds["10"].id), "occupant_short": None,
                               "state_reason": "ISOLATION_CLEANING", "state_note": None},
    }


async def test_an_unrestricted_caller_reads_every_bed_of_the_tenant(ward):
    """The administrator has no unit limit (`reach_clause` is None): she reads every bed's name,
    not an empty list — a None must never reach `.where()`, where it reads as NULL."""
    w, client, _ = ward
    await _admit(client, w, "2")                                   # Reanimasiya
    await _admit(client, w, "10")                                  # Reanimasiya
    r = await client.get("/tenant/occupancy", headers=w.auth["admin"])
    assert {b["bed_id"]: b["occupant_short"] for b in r.json()["beds"]} == {
        str(w.beds["2"].id): "Hasta S.", str(w.beds["10"].id): "Hasta S."}


async def test_whoever_may_open_doluluk_reads_it_and_nobody_else(ward):
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor", "admin"):
        assert (await client.get("/tenant/occupancy", headers=w.auth[who])).status_code == 200, who
    assert (await client.get("/tenant/occupancy", headers=w.auth["auditor"])).status_code == 403


async def test_a_discharge_confirmer_alone_reads_her_units_beds_and_their_names(ward, db_session):
    """D2 opens Doluluk to `admissions.discharge.confirm`. The screen is built from the structure
    AND the names: a session holding that right alone reads both, or the screen waits for a tree
    that never comes (final review M-3)."""
    w, client, _ = ward
    await _admit(client, w, "2")
    auth = await _only(db_session, w, "admissions.discharge.confirm")
    r = await client.get("/tenant/structure", headers=auth)
    assert r.status_code == 200, r.text
    beds = [b for s in r.json()["sites"] for u in s["units"] for room in u["rooms"]
            for b in room["beds"]]
    assert {b["label"] for b in beds} == {"1", "2", "10", "3"}            # Reanimasiya, her unit
    r = await client.get("/tenant/occupancy", headers=auth)
    assert r.status_code == 200, r.text
    assert [b["occupant_short"] for b in r.json()["beds"]] == ["Hasta S."]


async def test_a_user_manager_or_a_device_mapper_gets_no_name_and_no_note(ward, db_session):
    """R1: both read /tenant/structure, which carries no patient data and no note."""
    w, client, _ = ward
    await _admit(client, w, "2")
    await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": NOTE},
                      headers=w.auth["charge"])
    for permission in ("users.manage", "devices.map_beds"):
        auth = await _only(db_session, w, permission)
        assert (await client.get("/tenant/occupancy", headers=auth)).status_code == 403, permission
        r = await client.get("/tenant/structure", headers=auth)
        assert r.status_code == 200, r.text
        beds = [b for s in r.json()["sites"] for u in s["units"] for room in u["rooms"]
                for b in room["beds"]]
        assert beds, permission
        assert all(set(b) == {"id", "label", "state", "is_active", "state_since"} for b in beds)
        assert "Hasta" not in r.text and NOTE not in r.text


async def test_the_structure_says_since_when_a_bed_is_in_its_state(ward, db_session):
    w, client, _ = ward
    bed_id = w.beds["1"].id            # read before expire_all(): a lazy load outside the greenlet fails
    r = await client.get("/tenant/structure", headers=w.auth["nurse"])
    bed = r.json()["sites"][0]["units"][0]["rooms"][0]["beds"][0]
    db_session.expire_all()
    stored = (await db_session.get(Bed, bed_id)).state_updated_at
    assert datetime.fromisoformat(bed["state_since"]) == stored


async def test_a_note_that_cannot_be_decrypted_does_not_take_the_structure_down(ward, db_session):
    """R1: the structure never loads a note, so it never decrypts one. A key mismatch on a single
    bed must not turn the tree every screen reads into a 500. The stored value is shaped like a
    ciphertext («enc::v1::» is the PHI prefix) but is no Fernet token: reading it as a note
    raises. (Without the prefix it would pass as a legacy plaintext and prove nothing.)"""
    w, client, _ = ward
    bed_id = w.beds["3"].id
    await db_session.execute(text("UPDATE beds SET state_note = :v WHERE id = :id"),
                             {"v": "enc::v1::not-a-fernet-token", "id": bed_id})
    await db_session.commit()
    r = await client.get("/tenant/structure", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    ids = {b["id"] for s in r.json()["sites"] for u in s["units"] for room in u["rooms"]
           for b in room["beds"]}
    assert str(bed_id) in ids
    room = w.rooms["o2"].id
    r = await client.get(f"/tenant/rooms/{room}/beds", headers=w.auth["admin"])     # list_beds
    assert r.status_code == 200, r.text
    assert [b["id"] for b in r.json()] == [str(bed_id)]


async def test_a_discharged_patient_s_name_leaves_the_bed(ward):
    """R7: the name is the OPEN admission's. A started discharge still holds the bed; once the
    charge nurse confirms, the admission is DISCHARGED and the bed carries no name."""
    w, client, _ = ward
    admission = await _admit(client, w, "2")
    url = f"/admissions/{admission['id']}"
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse"])
    assert [b["occupant_short"] for b in r.json()["beds"]] == ["Hasta S."]
    r = await client.post(f"{url}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"{url}/discharge/initiate", json={"disposition": "HOME"},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse"])
    assert [b["occupant_short"] for b in r.json()["beds"]] == ["Hasta S."]          # still held
    r = await client.post(f"{url}/discharge/confirm", headers=w.auth["charge"])
    assert (r.status_code, r.json()["state"]) == (200, "DISCHARGED"), r.text
    r = await client.get("/tenant/occupancy", headers=w.auth["nurse"])
    assert r.json() == {"beds": []}
    assert "Hasta" not in r.text


async def test_an_out_of_service_bed_with_other_shows_its_reason_and_its_note(ward):
    w, client, _ = ward
    r = await client.post(f"/tenant/beds/{w.beds['10'].id}/out-of-service",
                          json={"reason": "OTHER", "note": "Sentetik arıza"},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    r = await client.get("/tenant/occupancy", headers=w.auth["charge"])
    assert r.json() == {"beds": [{"bed_id": str(w.beds["10"].id), "occupant_short": None,
                                  "state_reason": "OTHER", "state_note": "Sentetik arıza"}]}


async def test_a_bed_grant_reads_that_bed_s_name_and_no_other(ward, db_session):
    """A grant on one bed reaches that bed alone, not the others of its room or unit."""
    w, client, _ = ward
    await _admit(client, w, "2")
    await _admit(client, w, "10")                                  # same room as bed "2"
    auth = await _bed_only(db_session, w, "2")
    r = await client.get("/tenant/occupancy", headers=auth)
    assert r.status_code == 200, r.text
    assert r.json() == {"beds": [{"bed_id": str(w.beds["2"].id), "occupant_short": "Hasta S.",
                                  "state_reason": None, "state_note": None}]}
