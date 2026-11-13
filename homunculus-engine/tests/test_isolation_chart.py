# homunculus-engine/tests/test_isolation_chart.py
"""G4-05 «Enfeksiyon kontrol» (spec D3, D7, §5 M8): the four isolation flags at the two doors. At the chart door
(POST /clinical/{id}) each is a flag like the suspected-infection mark — 0 / 1 / true / false and nothing else, recorded
as "bool" by the clinician — held to the bedside time bound when a time is sent, never withdrawable as «hatalı giriş» and
never filed in the measurement record. At the device door (POST /ingest) each is refused before anything is written:
a monitor or the HIS cannot decide isolation. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

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
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
SLUGS = ["isolation_contact", "isolation_droplet", "isolation_airborne", "isolation_protective"]
#: api/app.py `/ingest`'s refusal, word for word (the dashboard maps this exact sentence: apiErrors.js).
REFUSED = "izolasyon bir klinisyen kaydıdır; cihazdan alınmaz"


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
    @pytest.mark.parametrize("slug", SLUGS)
    def test_ingest_refuses_each_flag_before_anything_is_written(self, world, slug):
        client, audit, readings = world
        for value in (1, 0):
            r = client.post("/ingest", json=obs(slug, value, patient="S-101"), headers=DEVICE)
            assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert audit.records(tenant="h1", limit=100) == []                       # no `ingest` row, no frame's rows
        assert client.get("/patients", headers=DEVICE).json()["patients"] == []   # the engine never saw it
        assert _filed(readings) == []

    def test_an_unknown_number_under_the_unmatched_policy_is_refused_not_listed(self):
        audit, readings = InMemoryAuditLog(), InMemoryReadingStore()
        with TestClient(_app(audit=audit, readings=readings, unknown_readings=POLICY_UNMATCHED)) as client:
            r = client.post("/ingest", json=obs("isolation_airborne", 1, patient="S-404"), headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert audit.records(tenant="h1", limit=100) == [] and _filed(readings) == []

    def test_a_device_cannot_move_a_flag_a_nurse_charted(self, world):
        client, _, _ = world
        assert _chart(client, [{"code": "isolation_contact", "value": 1}]).status_code == 200
        before = client.get("/patients", headers=DEVICE).json()["patients"]
        r = client.post("/ingest", json=obs("isolation_contact", 0, patient="S-101"), headers=DEVICE)
        assert r.status_code == 400
        assert client.get("/patients", headers=DEVICE).json()["patients"] == before

    def test_another_reading_still_passes(self, world):
        client, _, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 88, patient="S-101"), headers=DEVICE).status_code == 200
