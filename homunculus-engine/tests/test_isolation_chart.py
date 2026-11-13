# homunculus-engine/tests/test_isolation_chart.py
"""G4-05 «Enfeksiyon kontrol» (spec D3, D7, §5 M8): the four isolation flags at the two doors. At the chart door
(POST /clinical/{id}) each is a flag like the suspected-infection mark — 0 / 1 / true / false and nothing else, recorded
as "bool" by the clinician — held to the bedside time bound when a time is sent, never withdrawable as «hatalı giriş» and
never filed in the measurement record. A monitor or the HIS cannot decide isolation: the device door (POST /ingest)
answers a flag 200 and applies nothing (§5 A7 — a 4xx would stall the bridge's serial uplink, D18); the chart door
refuses one from the bridge's device token (400); and no device mapping carries the four slugs — the bridge's default
table drops them as unmapped, a site's table naming one is refused at load. Synthetic patients and values only
(CLAUDE.md rule 6)."""
from __future__ import annotations

import asyncio
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.clinical import (
    AT_FUTURE, AT_TOO_OLD, CHARTABLE, ISOLATION_CODES, RETRACT_NOT_BEDSIDE, RETRACTABLE_CODES, ClinicalEntryError,
    build_entries,
)
from homunculus.api.identity import Caller
from homunculus.api.readings import MANUAL_CODES, POLICY_UNMATCHED, InMemoryReadingStore
from homunculus.canonical import Observation, SignalCode
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.ncefiles import load_site_mapping
from homunculus.edge.serialize import observation_to_fhir
from homunculus.edge.uplink import UplinkRefused, flush_once
from homunculus.gateway.hl7 import default_mapping, parse_hl7_oru
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
SLUGS = ["isolation_contact", "isolation_droplet", "isolation_airborne", "isolation_protective"]
#: The chart door's refusal of a flag from the device token (api/clinical.py ISOLATION_FROM_DEVICE), word for word —
#: the dashboard maps this exact sentence (apiErrors.js).
REFUSED = "izolasyon bir klinisyen kaydıdır; cihazdan alınmaz"
#: `/ingest`'s answer to a flag from a device (§5 A7): well-formed, not applied — as a discharged or unmatched number.
NOT_APPLIED = {"patient_id": "S-101", "dropped": "isolation"}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(**kw):
    return create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, **kw)


@pytest.fixture()
def world():
    audit, readings = InMemoryAuditLog(), InMemoryReadingStore()
    with TestClient(_app(audit=audit, readings=readings)) as client:
        yield client, audit, readings


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(client, entries, at=None, pid="S-101"):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at
    return client.post(f"/clinical/{pid}", json=body, headers=NURSE)


def _filed(readings) -> list:
    """Every row of the measurement record for S-101 over the last two days — and the unmatched list."""
    now = datetime.now(timezone.utc)
    return (readings.for_patient("h1", "S-101", since=now - timedelta(days=2), until=now + timedelta(hours=1))
            + readings.unmatched("h1", since=now - timedelta(days=2)))


class TestTheFourFlags:
    def test_they_are_chartable_flags_in_one_order(self):
        assert [code.value for code in ISOLATION_CODES] == SLUGS
        for code in ISOLATION_CODES:
            assert CHARTABLE[code] == "bool", code

    @pytest.mark.parametrize("slug", SLUGS)
    @pytest.mark.parametrize("raw,value", [(0, 0.0), (1, 1.0), (True, 1.0), (False, 0.0)])
    def test_each_takes_0_1_true_and_false(self, slug, raw, value):
        (entry,) = build_entries("S-101", [{"code": slug, "value": raw}], charted_by="hem.ayse")
        assert (entry.observation.code.value, entry.observation.value, entry.observation.unit) == (slug, value, "bool")
        assert (entry.observation.source_device, entry.charted_by) == ("clinician", "hem.ayse")

    @pytest.mark.parametrize("slug", SLUGS)
    def test_anything_else_is_refused_with_the_doors_own_sentence(self, slug):
        for raw in (0.5, 2, -1):
            with pytest.raises(ClinicalEntryError, match=f"^{slug}: yalnız 0 veya 1 olabilir$"):
                build_entries("S-101", [{"code": slug, "value": raw}], charted_by="hem.ayse")

    def test_a_save_of_the_four_writes_four_chart_rows_under_the_nurses_name(self, world):
        client, audit, _ = world
        r = _chart(client, [{"code": slug, "value": v} for slug, v in zip(SLUGS, (1, 1, 0, 0))])
        assert r.status_code == 200, r.text
        assert r.json()["charted"] == 4
        rows = [rec for rec in audit.records(tenant="h1", limit=100) if rec.event_type == "chart"]
        assert [(rec.subject, rec.payload["value"], rec.payload["unit"], rec.payload["charted_by"]) for rec in rows] == [
            ("isolation_contact", 1.0, "bool", "hem.ayse"), ("isolation_droplet", 1.0, "bool", "hem.ayse"),
            ("isolation_airborne", 0.0, "bool", "hem.ayse"), ("isolation_protective", 0.0, "bool", "hem.ayse")]

    def test_half_a_flag_through_the_door_is_a_400_that_writes_nothing(self, world):
        client, audit, _ = world
        r = _chart(client, [{"code": "isolation_contact", "value": 1}, {"code": "isolation_droplet", "value": 0.5}])
        assert (r.status_code, r.json()["detail"]) == (400, "isolation_droplet: yalnız 0 veya 1 olabilir")
        assert audit.records(tenant="h1", limit=100) == []


class TestTheTimeBound:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_time_ahead_or_more_than_a_day_back_is_refused_and_writes_nothing(self, world, slug):
        """Spec D7: a flag stamped tomorrow would stay the latest value, and no save today could end the isolation."""
        client, audit, _ = world
        ahead = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        r = _chart(client, [{"code": slug, "value": 1}], at=ahead)
        assert (r.status_code, r.json()["detail"]) == (400, AT_FUTURE)
        r = _chart(client, [{"code": slug, "value": 1}], at=_ago(25 * 60))
        assert (r.status_code, r.json()["detail"]) == (400, AT_TOO_OLD)
        assert audit.records(tenant="h1", limit=100) == []
        assert _chart(client, [{"code": slug, "value": 1}], at=_ago(60)).status_code == 200

    def test_a_suspected_infection_mark_keeps_todays_rule(self, world):
        """Unchanged: the bound is opened to the four flags only (spec D7), not to every code of the door."""
        client, _, _ = world
        assert _chart(client, [{"code": "suspected_infection", "value": 1}], at=_ago(25 * 60)).status_code == 200


class TestNeverWithdrawnNorFiled:
    def test_no_flag_is_withdrawable_or_a_manual_reading(self):
        assert not set(SLUGS) & (RETRACTABLE_CODES | MANUAL_CODES)

    @pytest.mark.parametrize("slug", SLUGS)
    def test_the_withdrawal_refuses_a_flag_and_writes_nothing(self, world, slug):
        """X22's rule, as for the suspected-infection mark: a flag is corrected by a new entry."""
        client, audit, readings = world
        r = _chart(client, [{"code": slug, "value": 1}], at=_ago(5))
        entry = r.json()["entries"][0]["entry"]
        trail = len(audit.records(tenant="h1", limit=100))
        r = client.post(f"/clinical/S-101/entries/{entry}/retract", json={"reason": "yanlış hastaya girildi"},
                        headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_NOT_BEDSIDE)
        assert len(audit.records(tenant="h1", limit=100)) == trail
        assert _filed(readings) == []


class TestTheDeviceDoor:
    """§5 A7 (code review, 2026-11-13): a flag from a device is answered 200 with `dropped: "isolation"` and nothing is
    applied — the door's answer for a well-formed observation it chose not to apply (a discharged or an unmatched
    number). A 4xx would stop the bridge's serial uplink on that row and hold every reading queued behind it (D18)."""

    @pytest.mark.parametrize("slug", SLUGS)
    def test_ingest_answers_200_and_applies_nothing(self, world, slug):
        client, audit, readings = world
        for value in (1, 0):
            r = client.post("/ingest", json=obs(slug, value, patient="S-101"), headers=DEVICE)
            assert (r.status_code, r.json()) == (200, NOT_APPLIED)
        assert audit.records(tenant="h1", limit=100) == []                       # no `ingest` row, no frame's rows
        assert client.get("/patients", headers=DEVICE).json()["patients"] == []   # the engine never saw it
        assert _filed(readings) == []

    def test_an_unknown_number_under_the_unmatched_policy_is_not_listed(self):
        audit, readings = InMemoryAuditLog(), InMemoryReadingStore()
        with TestClient(_app(audit=audit, readings=readings, unknown_readings=POLICY_UNMATCHED)) as client:
            r = client.post("/ingest", json=obs("isolation_airborne", 1, patient="S-404"), headers=DEVICE)
        assert (r.status_code, r.json()) == (200, {"patient_id": "S-404", "dropped": "isolation"})
        assert audit.records(tenant="h1", limit=100) == [] and _filed(readings) == []

    def test_a_device_cannot_move_a_flag_a_nurse_charted(self, world):
        client, audit, _ = world
        assert _chart(client, [{"code": "isolation_contact", "value": 1}]).status_code == 200
        before = client.get("/patients", headers=DEVICE).json()["patients"]
        trail = len(audit.records(tenant="h1", limit=100))
        r = client.post("/ingest", json=obs("isolation_contact", 0, patient="S-101"), headers=DEVICE)
        assert (r.status_code, r.json()) == (200, NOT_APPLIED)
        assert client.get("/patients", headers=DEVICE).json()["patients"] == before
        assert len(audit.records(tenant="h1", limit=100)) == trail

    def test_another_reading_still_passes(self, world):
        client, _, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 88, patient="S-101"), headers=DEVICE).status_code == 200


class TestTheChartDoorWithADeviceToken:
    """G4-05 (spec §5 M8's intent, closed at the chart door too by the coordinator's decision of 2026-11-13): the
    bridge's device token passes `clinical.chart` as every board route's guard lets it, so without this it could
    still chart a flag through POST /clinical. This door is a request and its answer, not the bridge's queue, so it
    refuses: 400 with ISOLATION_FROM_DEVICE, nothing written. Every other code the token charts today stays accepted."""

    def test_build_entries_refuses_a_flag_from_a_device(self):
        from homunculus.api import clinical
        assert clinical.ISOLATION_FROM_DEVICE == REFUSED          # the sentence the dashboard maps
        for slug in SLUGS:
            with pytest.raises(ClinicalEntryError, match=f"^{REFUSED}$"):
                build_entries("S-101", [{"code": slug, "value": 1}], charted_by="tenant-token", from_device=True)
        (entry,) = build_entries("S-101", [{"code": "isolation_contact", "value": 1}], charted_by="hem.ayse",
                                 from_device=False)
        assert entry.observation.value == 1.0

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_device_chart_of_a_flag_is_a_400_that_writes_nothing(self, world, slug):
        client, audit, readings = world
        for value in (1, 0):
            r = client.post("/clinical/S-101", json={"entries": [{"code": slug, "value": value}]}, headers=DEVICE)
            assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert audit.records(tenant="h1", limit=100) == []                       # no `chart` row
        assert client.get("/patients", headers=DEVICE).json()["patients"] == []   # the engine never saw it
        assert _filed(readings) == []

    def test_a_flag_beside_another_code_takes_the_whole_request_down(self, world):
        """All-or-nothing, as the door is: the temperature beside the flag is not charted either."""
        client, audit, _ = world
        r = client.post("/clinical/S-101", headers=DEVICE, json={"entries": [
            {"code": "temperature", "value": 37.2}, {"code": "isolation_airborne", "value": 1}]})
        assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert audit.records(tenant="h1", limit=100) == []
        assert client.get("/patients", headers=DEVICE).json()["patients"] == []

    def test_a_device_cannot_move_a_flag_a_nurse_charted_through_the_chart_door(self, world):
        client, audit, _ = world
        assert _chart(client, [{"code": "isolation_contact", "value": 1}]).status_code == 200    # the clinician: 200
        before = client.get("/patients", headers=DEVICE).json()["patients"]
        trail = len(audit.records(tenant="h1", limit=100))
        r = client.post("/clinical/S-101", json={"entries": [{"code": "isolation_contact", "value": 0}]},
                        headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert client.get("/patients", headers=DEVICE).json()["patients"] == before
        assert len(audit.records(tenant="h1", limit=100)) == trail

    def test_the_preview_says_what_the_door_would(self, world):
        """POST /clinical/{id}/preview parses as the door does — the same refusals (its docstring) — so it refuses
        a device's flag too; a clinician's preview of a flag is answered."""
        client, audit, _ = world
        body = {"entries": [{"code": "isolation_droplet", "value": 1}]}
        r = client.post("/clinical/S-101/preview", json=body, headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert client.post("/clinical/S-101/preview", json=body, headers=NURSE).status_code == 200
        assert audit.records(tenant="h1", limit=100) == []

    def test_every_other_code_from_the_device_token_is_charted_as_today(self, world):
        client, audit, _ = world
        r = client.post("/clinical/S-101", headers=DEVICE, json={"entries": [
            {"code": "suspected_infection", "value": 1}, {"code": "temperature", "value": 37.2}]})
        assert r.status_code == 200, r.text
        assert r.json()["charted"] == 2
        rows = [rec for rec in audit.records(tenant="h1", limit=100) if rec.event_type == "chart"]
        assert [(rec.subject, rec.payload["charted_by"]) for rec in rows] == [
            ("suspected_infection", "tenant-token"), ("temperature", "tenant-token")]


def _oru(*obx: tuple[str, str], pid: str = "S-101") -> str:
    """A synthetic ORU^R01: one OBX per (code, value), stamped two minutes ago."""
    ts = (datetime.now(timezone.utc) - timedelta(minutes=2)).strftime("%Y%m%d%H%M%S+0000")
    return "\r".join([f"MSH|^~\\&|SIM|WARD|HOM|HOSP|{ts}||ORU^R01|1|P|2.5", f"PID|||{pid}",
                      *(f"OBX|{i}|NM|{code}||{value}|u|||||F|||{ts}" for i, (code, value) in enumerate(obx, 1))])


def _run_bridge():
    """scripts/run_bridge.py, loaded by its path (scripts/ is not a package), as tests/test_run_bridge_identity.py does."""
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_bridge.py"
    spec = importlib.util.spec_from_file_location("run_bridge_isolation", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheBridge:
    """§5 A7 (code review, 2026-11-13). The bridge never carries a flag: its default table leaves the four slugs out (an
    OBX that names one is unmapped — dropped and counted, as any code nothing maps), and a site's table naming one stops
    startup. Should a flag reach the uplink's queue all the same, `/ingest` answers it 200, so the readings behind it
    flow: the uplink stops a pass on any refused observation (edge/uplink.py)."""

    def test_the_default_table_maps_every_code_but_the_four_flags(self):
        table = default_mapping()
        assert not set(table) & set(SLUGS)
        assert set(table) == {code.value for code in SignalCode} - set(SLUGS)

    def test_an_obx_naming_a_flag_is_unmapped_and_the_reading_beside_it_flows(self):
        sent: list[dict] = []
        bridge = EdgeBridge(send=sent.append)
        message = _oru(("isolation_contact", "1"), ("heart_rate", "88"))
        assert [o.code for o in parse_hl7_oru(message)] == [SignalCode.HEART_RATE]
        assert [o.code for o in bridge.handle_message(message)] == [SignalCode.HEART_RATE]
        assert bridge.stats.unmapped == {"isolation_contact": 1}

    def test_a_flag_in_the_uplinks_queue_no_longer_holds_back_the_reading_behind_it(self, tmp_path):
        """The reviewer's probe, as a test: a flag queued ahead of a heart rate used to be refused (400) on every pass,
        and the heart rate never left the bridge. Now both rows are acked; the heart rate reaches the board and the flag
        nothing — no isolation on the card, no row in the trail for it."""
        at = datetime.now(timezone.utc) - timedelta(minutes=2)
        buffer = SqliteBuffer(tmp_path / "outbox.db")
        buffer.append(observation_to_fhir(Observation("S-101", SignalCode.ISOLATION_CONTACT, 1.0, "bool", at, "sim")))
        buffer.append(observation_to_fhir(Observation("S-101", SignalCode.HEART_RATE, 88.0, "bpm", at, "sim")))
        audit = InMemoryAuditLog()
        try:
            with TestClient(_app(audit=audit)) as client:
                def sender(payload):
                    r = client.post("/ingest", json=payload, headers=DEVICE)
                    if not 200 <= r.status_code < 300:
                        raise UplinkRefused(r.status_code)

                assert asyncio.run(flush_once(buffer, sender=sender)) == 2
                assert buffer.depth() == 0
                (card,) = client.get("/patients", headers=DEVICE).json()["patients"]
        finally:
            buffer.close()
        assert card["latest"]["heart_rate"] == 88.0
        assert card["isolation"]["state"] == "unrecorded"
        assert {rec.subject for rec in audit.records(tenant="h1", limit=100)} & set(SLUGS) == set()

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_site_obx_table_naming_a_flag_stops_the_bridge_at_startup(self, tmp_path, slug):
        path = tmp_path / "mapping.json"
        path.write_text(json.dumps({"HR": "heart_rate", "ISO": slug}), encoding="utf-8")
        with pytest.raises(SystemExit, match=f"{slug}.*isolation"):
            _run_bridge().load_mapping(str(path))
        path.write_text(json.dumps({"HR": "heart_rate"}), encoding="utf-8")
        assert _run_bridge().load_mapping(str(path)) == {"HR": SignalCode.HEART_RATE}

    @pytest.mark.parametrize("table", ["signals", "hl7_signals"])
    def test_an_nce_site_mapping_naming_a_flag_stops_the_bridge_at_startup(self, tmp_path, table):
        path = tmp_path / "nce-mapping.json"
        entry = {"Iso": {"signal": "isolation_droplet"}} if table == "signals" else {"150999": "isolation_droplet"}
        path.write_text(json.dumps({table: entry}), encoding="utf-8")
        with pytest.raises(SystemExit, match="isolation_droplet.*isolation"):
            load_site_mapping(path)
