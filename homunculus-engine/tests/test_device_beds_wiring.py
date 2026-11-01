# homunculus-engine/tests/test_device_beds_wiring.py
"""The editor's wiring (spec D6, §4.9): `create_app(device_beds=…)` puts that source behind the
strip; `app.state` carries the lane's settings and clock, the table's invalidate and an uncached
per-bed occupant read that the strip's cached one shares; the five codes are registered. No DB."""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from homunculus.admission.errors import CODES
from homunculus.api.app import create_app
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import TableFile, TableState
from homunculus.api.infinity_shadow import ShadowSettings
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

H, DEVICE, TOKEN = "esleme-hastane", "esleme-device", "s" * 40
BED = "ccbcafd3-0e2c-4c20-8960-e260cf02f3af"


class Source:
    def __init__(self):
        self.reads, self.resets = 0, 0

    def current(self, now=None):
        self.reads += 1
        return TableState(None, "missing", "eşleme tablosunda bu hastane için satır yok", None, None)

    def invalidate(self):
        self.resets += 1


def _app(source, identities=None):
    settings = ShadowSettings("shadow", "shadow", None, TOKEN, H)
    return create_app({DEVICE: H}, run_escalation_loop=False, shadow=settings, device_beds=source,
                      identities=identities or InMemoryIdentityStore()), settings


def test_the_five_codes_are_registered():
    assert {"monitor_lane_off", "device_unknown", "bed_occupied", "mapping_changed",
            "bed_has_monitor"} <= CODES


def test_the_strip_reads_the_source_it_is_given_and_the_state_hooks_reach_it():
    source = Source()
    app, settings = _app(source)
    assert app.state.shadow_settings is settings and app.state.shadow_clock is time.time
    body = TestClient(app).get("/infinity-shadow/board", headers={"Authorization": f"Bearer {DEVICE}"}).json()
    assert body["table"]["status"] == "missing" and source.reads >= 1
    app.state.shadow_table_reset()
    assert source.resets == 1


def test_bed_occupants_is_the_strips_rule_read_fresh_every_time():
    identities = InMemoryIdentityStore()
    app, _ = _app(Source(), identities)
    assert app.state.bed_occupants(H) == {}
    identities.apply(H, IdentityRecord(patient_id="H2600042", given="Ahmet", family="Yılmaz", source="test",
                                       updated_at=datetime(2026, 10, 30, tzinfo=timezone.utc), bed_id=BED))
    assert app.state.bed_occupants(H) == {BED: ["H2600042"]}          # no 10-s cache in between


def test_without_a_source_the_lab_reads_the_file():
    app, _ = _app(None)
    assert isinstance(app.state.shadow_table_reset.__self__, TableFile)


def test_prodserver_reads_the_table_from_postgres_only_on_postgres_with_a_lane_hospital():
    """The production choice (spec D6): a regression here would quietly put production back on the
    file, and the editor's changes would never reach the strip. Building the engine does not connect."""
    from homunculus.api import prodserver

    assert prodserver._device_beds("", "H") is None
    assert prodserver._device_beds("sqlite:///x.db", "H") is None
    assert prodserver._device_beds("postgresql+asyncpg://u@db/x", "") is None
    source = prodserver._device_beds("postgresql+asyncpg://u@db/x", "H")
    try:
        assert isinstance(source, PostgresDeviceBeds)
    finally:
        source.dispose()
