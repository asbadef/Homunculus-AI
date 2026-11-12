# homunculus-engine/tests/test_tres_maps.py
"""Yönetim › TRƏS, the two maps (TRƏS-01, spec §6, D16, D17, D24; plan F1): GET|PUT
/admin/tres/departments and GET /admin/tres/practitioners, PUT …/{user_id} — `tres.manage`, the
caller's tenant only; the department map is written whole, a unit left out unmapped; a practitioner's
FİN is write-only (`fin_set`), ciphertext at rest, held to D20's rule; every change audited with ids
and field names and never a value; a save that changes nothing writes no row. Postgres
(tests/kabul_world.py). Synthetic ward, synthetic people."""
from __future__ import annotations

import asyncio
import uuid

import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.tenant.models import Site, Tenant, Unit, UnitType
from homunculus.tres.errors import WORDS
from homunculus.tres.maps import lock_map, map_lock_key
from homunculus.tres.models import TresDepartmentMap, TresPractitionerIdentity
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.signed_in import add_user

DEPARTMENTS, PRACTITIONERS = "/admin/tres/departments", "/admin/tres/practitioners"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _audit(app, event_type: str) -> list:
    return app.state.audit.records(tenant=SLUG, event_type=event_type, limit=50)


def _department(unit, code="RE-01", display="Reanimasiya") -> dict:
    return {"unit_id": str(unit.id), "code": code, "display": display}


# ---------------------------------------------------------------- the department map (D17)
@requires_db
async def test_every_unit_is_listed_unmapped_until_the_map_is_saved(ward):
    w, client, _ = ward
    r = await client.get(DEPARTMENTS, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert [(u["unit_name"], u["code"], u["display"], u["unit_active"]) for u in r.json()] == [
        ("Neonatal", None, None, True), ("Reanimasiya", None, None, True)]


@requires_db
async def test_the_map_is_saved_whole_audited_by_unit_and_a_unit_left_out_is_unmapped(ward, db_session):
    w, client, app = ward
    rea, neo = w.units["rea"], w.units["neo"]
    sent = {"departments": [_department(rea), _department(neo, " NEO-01 ", " Neonatal ")]}
    r = await client.put(DEPARTMENTS, json=sent, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {u["unit_name"]: (u["code"], u["display"]) for u in r.json()} == {
        "Neonatal": ("NEO-01", "Neonatal"), "Reanimasiya": ("RE-01", "Reanimasiya")}
    (row,) = _audit(app, "tres.map")
    assert row.payload == {"actor": w.users["admin"].username, "units": sorted([str(rea.id), str(neo.id)])}
    assert (await client.put(DEPARTMENTS, json=sent, headers=w.auth["admin"])).status_code == 200
    assert len(_audit(app, "tres.map")) == 1                                    # nothing changed: no row
    r = await client.put(DEPARTMENTS, json={"departments": [_department(rea, "RE-02")]}, headers=w.auth["admin"])
    assert {u["unit_name"]: u["code"] for u in r.json()} == {"Neonatal": None, "Reanimasiya": "RE-02"}
    assert _audit(app, "tres.map")[-1].payload["units"] == sorted([str(rea.id), str(neo.id)])
    stored = (await db_session.execute(select(func.count()).select_from(TresDepartmentMap))).scalar_one()
    assert stored == 1


@requires_db
async def test_a_bad_map_is_refused_with_its_code_and_writes_nothing(ward, db_session):
    w, client, app = ward
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    site = Site(tenant_id=other.id, name="Başka bina")
    db_session.add(site)
    await db_session.flush()
    foreign = Unit(site_id=site.id, name="Başka", unit_type=UnitType.ADULT_ICU)
    db_session.add(foreign)
    await db_session.commit()
    rea = w.units["rea"]
    for departments, code in (([_department(foreign)], "tres_unit_unknown"),
                              ([{"unit_id": str(uuid.uuid4()), "code": "X", "display": "Y"}], "tres_unit_unknown"),
                              ([_department(rea), _department(rea, "RE-02")], "tres_unit_unknown"),
                              ([_department(rea, "  ")], "tres_department_code"),
                              ([_department(rea, "X" * 33)], "tres_department_code"),
                              ([_department(rea, display="")], "tres_department_display"),
                              ([_department(rea, display="Y" * 201)], "tres_department_display")):
        r = await client.put(DEPARTMENTS, json={"departments": departments}, headers=w.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, code), departments
        assert r.json()["detail"]["message"] == WORDS[code]
    assert (await db_session.execute(select(func.count()).select_from(TresDepartmentMap))).scalar_one() == 0
    assert _audit(app, "tres.map") == []


# ---------------------------------------------------------------- the practitioners' identities (D16)
@requires_db
async def test_the_physicians_are_listed_and_an_identity_is_saved_with_its_fin_write_only(ward, db_session):
    w, client, app = ward
    doctor_id, actor = w.users["doctor"].id, w.users["admin"].username
    r = await client.get(PRACTITIONERS, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert [(p["user_id"], p["fin_set"], p["family_name"]) for p in r.json()] == [(str(doctor_id), False, None)]
    r = await client.put(f"{PRACTITIONERS}/{doctor_id}", json={"fin": " zz99yy8 ", "family_name": " Sentetikov ",
                                                               "given_name": "Elçin"}, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert {k: r.json()[k] for k in ("fin_set", "family_name", "given_name")} == {
        "fin_set": True, "family_name": "Sentetikov", "given_name": "Elçin"}
    assert "ZZ99YY8" not in r.text and "fin\"" not in r.text.replace("fin_set\"", "")
    stored = (await db_session.execute(text("SELECT fin FROM tres_practitioner_identity"))).scalar_one()
    assert stored.startswith("enc::v1::") and "ZZ99YY8" not in stored
    db_session.expire_all()
    assert (await db_session.execute(select(TresPractitionerIdentity.fin))).scalar_one() == "ZZ99YY8"
    (row,) = _audit(app, "tres.identity")
    assert row.payload == {"actor": actor, "user_id": str(doctor_id),
                           "changed": ["fin", "family_name", "given_name"]}
    assert "ZZ99YY8" not in str(row.payload)


@requires_db
async def test_a_fin_left_out_stays_an_empty_one_clears_it_and_no_change_writes_no_row(ward, db_session):
    w, client, app = ward
    url = f"{PRACTITIONERS}/{w.users['doctor'].id}"
    names = {"family_name": "Sentetikov", "given_name": "Elçin"}
    await client.put(url, json={"fin": "ZZ99YY8", **names}, headers=w.auth["admin"])
    r = await client.put(url, json=names, headers=w.auth["admin"])
    assert r.json()["fin_set"] is True and len(_audit(app, "tres.identity")) == 1      # nothing changed
    r = await client.put(url, json={"fin": None, **names, "given_name": "Elçin Rəşad"}, headers=w.auth["admin"])
    assert r.json()["fin_set"] is True and _audit(app, "tres.identity")[-1].payload["changed"] == ["given_name"]
    r = await client.put(url, json={"fin": "", **names}, headers=w.auth["admin"])
    assert r.json()["fin_set"] is False
    assert _audit(app, "tres.identity")[-1].payload["changed"] == ["fin", "given_name"]


@requires_db
async def test_a_bad_identity_is_refused_and_writes_nothing(ward, db_session):
    w, client, app = ward
    url = f"{PRACTITIONERS}/{w.users['doctor'].id}"
    for sent, status, code in (({"fin": "ZZ99", "family_name": "S", "given_name": "E"}, 422, "tres_fin_format"),
                               ({"fin": "ƏZ99YY8", "family_name": "S", "given_name": "E"}, 422, "tres_fin_format"),
                               ({"family_name": " ", "given_name": "E"}, 422, "tres_name"),
                               ({"family_name": "S" * 101, "given_name": "E"}, 422, "tres_name")):
        r = await client.put(url, json=sent, headers=w.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (status, code), sent
    r = await client.put(f"{PRACTITIONERS}/{uuid.uuid4()}", json={"family_name": "S", "given_name": "E"},
                         headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_user_unknown")
    assert (await client.put(url, json={"family_name": "S", "given_name": "E", "role": "x"},
                             headers=w.auth["admin"])).status_code == 422          # a field too many: FastAPI's
    assert (await db_session.execute(select(func.count()).select_from(TresPractitionerIdentity))).scalar_one() == 0
    assert _audit(app, "tres.identity") == []


@requires_db
async def test_only_tres_manage_and_only_the_callers_tenant(ward, db_session):
    w, client, _ = ward
    url = f"{PRACTITIONERS}/{w.users['doctor'].id}"
    for who in ("nurse", "charge", "doctor", "auditor"):
        assert (await client.get(DEPARTMENTS, headers=w.auth[who])).status_code == 403, who
        assert (await client.put(DEPARTMENTS, json={"departments": []}, headers=w.auth[who])).status_code == 403, who
        assert (await client.get(PRACTITIONERS, headers=w.auth[who])).status_code == 403, who
        assert (await client.put(url, json={"family_name": "S", "given_name": "E"},
                                 headers=w.auth[who])).status_code == 403, who
    # another tenant's map and identities are never read nor written from here
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresPractitionerIdentity(tenant_id=other.id, user_id=w.users["nurse"].id, fin="AA11BB2",
                                            family_name="Başka", given_name="Kişi"))
    await db_session.commit()
    r = await client.get(PRACTITIONERS, headers=w.auth["admin"])
    assert [p["user_id"] for p in r.json()] == [str(w.users["doctor"].id)]


# ---------------------------------------------------------------- batch-4 review
async def _other_tenant_with_a_unit(db_session) -> tuple[Tenant, Unit]:
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    site = Site(tenant_id=other.id, name="Başka bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Başka", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.flush()
    db_session.add(TresDepartmentMap(unit_id=unit.id, tenant_id=other.id, code="BA-01", display="Başka"))
    await db_session.commit()
    return other, unit


@requires_db
async def test_the_departments_are_the_callers_tenants_alone(ward, db_session):
    w, client, _ = ward
    _other, foreign = await _other_tenant_with_a_unit(db_session)
    r = await client.get(DEPARTMENTS, headers=w.auth["admin"])
    assert r.status_code == 200 and str(foreign.id) not in r.text and "BA-01" not in r.text
    assert [u["unit_name"] for u in r.json()] == ["Neonatal", "Reanimasiya"]


@requires_db
async def test_two_whole_map_saves_at_once_never_merge(ward, db_session):
    """Batch-4 review: the PUT takes the tenant's map lock before it reads what is held. A second admin's
    save waits for the first and then replaces the map WHOLE — never the two maps merged."""
    w, client, app = ward
    rea, neo = w.units["rea"], w.units["neo"]
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def waiting_on_the_lock() -> bool:
        """A backend waits for THIS tenant's map lock (a bigint key: classid the high half, objid the low)."""
        async with maker() as look:
            return (await look.execute(text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1 "
                "AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(:k, 0)"),
                {"k": map_lock_key(w.tenant.id)})).scalar_one() > 0

    async with maker() as first:
        await lock_map(first, w.tenant.id)                           # the first admin's save, under way
        first.add(TresDepartmentMap(unit_id=rea.id, tenant_id=w.tenant.id, code="RE-01", display="Reanimasiya"))
        await first.flush()
        second = asyncio.create_task(client.put(
            DEPARTMENTS, json={"departments": [_department(neo, "NEO-01", "Neonatal")]}, headers=w.auth["admin"]))
        for _ in range(100):                                         # until it ends, or is seen waiting
            if second.done() or await waiting_on_the_lock():
                break
            await asyncio.sleep(0.1)
        assert not second.done() and await waiting_on_the_lock()     # it waits for the first's lock
        await first.commit()
    r = await second
    assert r.status_code == 200, r.text
    assert {u["unit_name"]: u["code"] for u in r.json()} == {"Neonatal": "NEO-01", "Reanimasiya": None}
    assert (await db_session.execute(select(TresDepartmentMap.unit_id))).scalars().all() == [neo.id]
    assert _audit(app, "tres.map")[-1].payload["units"] == sorted([str(rea.id), str(neo.id)])


@requires_db
async def test_a_leavers_identity_can_be_corrected_but_none_is_made_for_a_leaver(ward, db_session):
    """Batch-4 review: a member no longer active keeps the identity the tab holds for them, and its FİN
    typo can be corrected; no identity is made for an inactive member who has none; a user who is not
    a member of this tenant is unknown here whatever another tenant holds."""
    w, client, app = ward
    doctor = w.users["doctor"]
    url = f"{PRACTITIONERS}/{doctor.id}"
    names = {"family_name": "Sentetikov", "given_name": "Elçin"}
    await db_session.execute(text("UPDATE tenant_memberships SET is_active = false WHERE user_id = :u"), {"u": doctor.id})
    await db_session.commit()
    r = await client.put(url, json={"fin": "ZZ99YY8", **names}, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_user_unknown")
    assert (await db_session.execute(select(func.count()).select_from(TresPractitionerIdentity))).scalar_one() == 0
    db_session.add(TresPractitionerIdentity(tenant_id=w.tenant.id, user_id=doctor.id, fin="ZZ99YY9", **names))
    await db_session.commit()
    r = await client.put(url, json={"fin": "ZZ99YY8", **names}, headers=w.auth["admin"])     # the typo corrected
    assert r.status_code == 200, r.text
    assert r.json()["fin_set"] is True and _audit(app, "tres.identity")[-1].payload["changed"] == ["fin"]
    await db_session.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": doctor.id})
    await db_session.commit()
    r = await client.put(url, json={"fin": "ZZ99YY8", **names, "given_name": "Elçin Rəşad"}, headers=w.auth["admin"])
    assert r.status_code == 200, r.text                                              # a deactivated account too
    other, _unit = await _other_tenant_with_a_unit(db_session)
    stranger = await add_user(db_session, username="yad@baska.example.com", tenant_id=other.id)
    db_session.add(TresPractitionerIdentity(tenant_id=other.id, user_id=stranger.id, fin="AA11BB2",
                                            family_name="Başka", given_name="Kişi"))
    await db_session.commit()
    r = await client.put(f"{PRACTITIONERS}/{stranger.id}", json=names, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_user_unknown")
