# homunculus-engine/tests/test_device_beds_api.py
"""The editor's routes (spec §4): the list (Task 8); bind and unbind (Task 9). Synthetic ward."""
from __future__ import annotations

import pytest

from homunculus.devicebeds.models import DeviceBed
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.esleme_world import APPROVED, FROM, URL, esleme_client, group_of, seed
from tests.kabul_world import BOARD

pytestmark = [requires_db]


def _by_source(body):
    return {d["source"]: d for d in body["devices"]}


async def test_the_list_is_the_workers_devices_and_the_tables_rows_in_address_order(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", None, "BED01"),
                         ("192.0.2.20", "3", "BED07"))
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    assert body["stage"] == "shadow" and body["can_bind"] is True
    assert [d["source"] for d in body["devices"]] == ["192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.20"]
    d = _by_source(body)
    assert d["192.0.2.11"] | {"last_seen_at": None} == {
        "source": "192.0.2.11", "group": "224.0.2.11", "port": 2050, "device_bed_label": "BED05",
        "seen": True, "status": "streaming", "last_seen_at": None, "row_id": ids["192.0.2.11"],
        "bed": {"id": str(ward.beds["1"].id), "in_scope": True, "label": "1", "room": "Otaq 1",
                "unit": "Reanimasiya"},
        "editable": True}
    assert d["192.0.2.11"]["last_seen_at"].endswith("+00:00")
    assert (d["192.0.2.12"]["bed"], d["192.0.2.12"]["device_bed_label"]) == (None, "BED01")   # label-only
    assert (d["192.0.2.13"]["row_id"], d["192.0.2.13"]["bed"], d["192.0.2.13"]["editable"]) == (None, None, True)
    absent = d["192.0.2.20"]                                         # bound, not reported: kept (D9)
    assert (absent["seen"], absent["status"], absent["last_seen_at"]) == (False, None, None)
    assert absent["bed"]["label"] == "3" and absent["group"] == "224.0.2.20"


async def test_a_charge_nurse_sees_another_units_monitor_without_names_and_cannot_edit_it(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "N1", "BEDN1"), ("192.0.2.12", "2", "BED02"))
        body = (await client.get(URL, headers=ward.auth["charge"])).json()
    d = _by_source(body)
    assert d["192.0.2.11"]["bed"] == {"id": str(ward.beds["N1"].id), "in_scope": False}
    assert d["192.0.2.11"]["editable"] is False
    assert d["192.0.2.12"]["bed"]["in_scope"] is True and d["192.0.2.12"]["editable"] is True
    assert d["192.0.2.13"]["editable"] is True                      # unbound: any holder may bind it


async def test_biomedical_reads_the_list_and_may_change_nothing(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        body = (await client.get(URL, headers=ward.auth["bio"])).json()
    assert body["can_bind"] is False and not any(d["editable"] for d in body["devices"])


async def test_a_row_pointing_at_another_tenants_bed_names_nothing_even_to_the_administrator(db_session):
    """A bed has no tenant_id (A-8): the names come through room, unit and site, so a row that
    somehow names a bed of another hospital shows its id alone and is not editable."""
    async with esleme_client(db_session) as (client, _, ward):
        other = Tenant(name="Sentetik Başqa Xəstəxana", slug="baska-hastane", country_code="AZ")
        db_session.add(other)
        await db_session.flush()
        site = Site(tenant_id=other.id, name="Başqa bina")
        db_session.add(site)
        await db_session.flush()
        unit = Unit(site_id=site.id, name="Başqa şöbə", unit_type=UnitType.ADULT_ICU)
        db_session.add(unit)
        await db_session.flush()
        room = Room(unit_id=unit.id, name="Başqa otaq")
        db_session.add(room)
        await db_session.flush()
        foreign = Bed(room_id=room.id, label="X1")
        db_session.add(foreign)
        await db_session.flush()
        db_session.add(DeviceBed(tenant_id=ward.tenant.id, source="192.0.2.11", group_address=group_of("192.0.2.11"),
                                 port=2050, device_bed_label="BED05", bed_label="BED05", bed_id=foreign.id,
                                 unit_id=unit.id, valid_from=FROM, approved_by="proje sahibi", approved_at=APPROVED))
        await db_session.commit()
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    shown = _by_source(body)["192.0.2.11"]
    assert shown["bed"] == {"id": str(foreign.id), "in_scope": False} and shown["editable"] is False


@pytest.mark.parametrize("who, status", [("nurse", 403), ("auditor", 403)])
async def test_a_caller_without_either_key_is_refused(db_session, who, status):
    async with esleme_client(db_session) as (client, _, ward):
        assert (await client.get(URL, headers=ward.auth[who])).status_code == status


async def test_a_device_token_is_not_a_person(db_session):
    async with esleme_client(db_session) as (client, _, _ward):
        assert (await client.get(URL, headers=BOARD)).status_code == 401


@pytest.mark.parametrize("options", [{"stage": "off"}, {"hospital": "baska-hastane"}])
async def test_the_list_answers_monitor_lane_off_unless_the_strip_runs_for_this_hospital(db_session, options):
    async with esleme_client(db_session, **options) as (client, _, ward):
        response = await client.get(URL, headers=ward.auth["admin"])
    assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"


async def test_at_stage_rules_the_list_says_rules(db_session):
    async with esleme_client(db_session, stage="rules") as (client, _, ward):
        assert (await client.get(URL, headers=ward.auth["admin"])).json()["stage"] == "rules"
