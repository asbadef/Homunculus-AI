# homunculus-engine/tests/test_pharmacy_api.py
"""G3-04 «Eczane» (spec D2–D4, D12, D13, D15, §3): GET /pharmacy against the DB-less app — the right that opens it,
the caller's scoped cards with `/patients`' own scope block, the states the server decides, creatinine with its time,
the fluid day from the task settings and the tenant's zone, an unreadable scope, a discharged patient, and a read
that writes nothing. Synthetic ward only (`p-a1`…, units `unit-adult` / `unit-nicu`, as tests/test_trends_api.py)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.api.tasks import InMemoryTaskStore, TaskSettings
from homunculus.scope import Scope, build_scope
from homunculus.scope.resolver import UNKNOWN
from homunculus.tenant.bedmap import BedMap

DEVICE = {"Authorization": "Bearer bridge-token"}
PHARMACIST = {"Authorization": "Bearer pharmacist-jwt"}
KEY_ONLY = {"Authorization": "Bearer key-only-jwt"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {
    "pharmacist-jwt": Caller(hospital="demo", actor="ecz.leyla", groups=("pharmacist",),
                             perms=frozenset({"board.view", "admissions.view", "pharmacy.view"})),
    "key-only-jwt": Caller(hospital="demo", actor="ecz.murad", groups=("synth",), perms=frozenset({"pharmacy.view"})),
    "nurse-jwt": Caller(hospital="demo", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart", "tasks.view"})),
}
ADULT = build_scope("NURSE", unit_ids=["unit-adult"])
WHOLE = build_scope("HOSPITAL_ADMIN")
BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"},
    "YB^304^2": {"bed_id": "bed-a2", "unit_id": "unit-adult"},
    "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu"},
}})
BAKU = timezone(timedelta(hours=4))     # Asia/Baku keeps +04 all year; tzdata is not on every test host
KEYS = ["now", "antibiotic_window_min", "antibiotic_window_source", "fluid_day", "fluid_truncated", "counts", "rows",
        "scope", "scope_note"]


def _identities() -> InMemoryIdentityStore:
    store = InMemoryIdentityStore()
    for pid, given, unit, room, bed in (("p-a1", "Bir", "YB", "304", "1"), ("p-a2", "İki", "YB", "304", "2"),
                                        ("p-n1", "Üç", "YYB", "12", "A")):
        store.apply("demo", IdentityRecord(patient_id=pid, given="Örnek Hasta", family=given, unit=unit, room=room,
                                           bed=bed, source="comed",
                                           updated_at=datetime(2026, 11, 4, tzinfo=timezone.utc)))
    return store


def _app(scope: Scope = WHOLE, *, identities=None, store=None):
    async def resolve_scope(_credential: str) -> Scope:
        return scope

    async def resolve_jwt(credential: str):
        return PEOPLE.get(credential)

    return create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                      identities=identities if identities is not None else _identities(), bedmap=BEDMAP,
                      resolve_jwt=resolve_jwt, resolve_scope=resolve_scope,
                      tasks=store if store is not None else InMemoryTaskStore(zones={"demo": "UTC"}))


def _chart(client, pid, entries, at):
    """Through the door with the bridge's credential, as tests/test_api_board_meds.py charts."""
    r = client.post(f"/clinical/{pid}", json={"entries": entries, "recorded_at": at.isoformat()}, headers=DEVICE)
    assert r.status_code == 200, r.text
    return r.json()


def _raise_sepsis(client, pid, at):
    """Suspected infection with a SOFA rise: the engine's sepsis rule fires, and recognition is stamped `at`."""
    return _chart(client, pid, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 80},
                                {"code": "creatinine", "value": 3.5}], at)


def _pharmacy(client, headers=PHARMACIST):
    return client.get("/pharmacy", headers=headers)


def _rows(client, headers=PHARMACIST) -> dict:
    return {row["patient_id"]: row for row in _pharmacy(client, headers).json()["rows"]}


@pytest.fixture()
def ward():
    app = _app()
    with TestClient(app) as client:
        yield app, client


class TestTheRight:
    def test_it_needs_pharmacy_view_and_the_key_alone_opens_it(self, ward):
        _app_, client = ward
        assert client.get("/pharmacy").status_code == 401
        refused = _pharmacy(client, NURSE)
        assert (refused.status_code, refused.json()["detail"]) == (403, "permission required: pharmacy.view")
        assert _pharmacy(client, KEY_ONLY).status_code == 200          # without board.view
        assert _pharmacy(client).status_code == 200

    def test_the_device_token_passes_as_on_every_board_route(self, ward):
        _app_, client = ward
        r = _pharmacy(client, DEVICE)
        assert r.status_code == 200 and r.json()["scope"]["unrestricted"] is True


class TestTheAnswer:
    def test_the_keys_the_window_and_its_source(self, ward):
        _app_, client = ward
        before = datetime.now(timezone.utc)
        answer = _pharmacy(client).json()
        after = datetime.now(timezone.utc)
        assert list(answer) == KEYS
        assert (answer["antibiotic_window_min"], answer["antibiotic_window_source"]) == (
            60, "surviving-sepsis-campaign-2026")
        assert answer["now"].endswith("+00:00")
        assert before <= datetime.fromisoformat(answer["now"]) <= after
        assert answer["fluid_truncated"] is False

    def test_an_identity_only_card_is_a_row_of_no_records(self, ward):
        """An admitted patient the engine has never measured has no `meds` block: nothing is invented for it."""
        _app_, client = ward
        row = _rows(client)["p-a2"]
        assert row == {
            "patient_id": "p-a2", "bed_label": "YB 304-2", "bed_id": "bed-a2", "unit_id": "unit-adult",
            "display_name": "Örnek Hasta İki", "measured": False, "on_pressor": False, "pressors": [],
            "antibiotic": {"state": "none", "given": None, "given_at": None, "recognized_at": None, "deadline": None,
                           "remaining_sec": None},
            "creatinine": None, "fluid": None}

    def test_the_states_the_order_and_the_counters_are_the_servers(self, ward):
        _app_, client = ward
        now = datetime.now(timezone.utc).replace(microsecond=0)
        _raise_sepsis(client, "p-a2", now - timedelta(minutes=10))               # the window is still open
        _raise_sepsis(client, "p-n1", now - timedelta(hours=3))                  # it closed two hours ago
        _chart(client, "p-a1", [{"code": "norepinephrine_rate", "value": 0.12}], now - timedelta(minutes=20))
        _chart(client, "p-a1", [{"code": "dopamine_rate", "value": 5}], now - timedelta(hours=2))
        _chart(client, "p-a1", [{"code": "dopamine_rate", "value": 0}], now - timedelta(hours=1))
        answer = _pharmacy(client).json()
        assert [row["patient_id"] for row in answer["rows"]] == ["p-n1", "p-a2", "p-a1"]
        assert answer["counts"] == {"patients": 3, "clock_running": 1, "clock_missed": 1, "on_pressor": 1,
                                    "recognized": 2, "recognized_no_record": 2}
        missed, running, pressor = answer["rows"]
        assert missed["antibiotic"]["state"] == "missed" and missed["antibiotic"]["given"] is None
        assert missed["antibiotic"]["recognized_at"] == (now - timedelta(hours=3)).isoformat()
        assert missed["antibiotic"]["deadline"] == (now - timedelta(hours=2)).isoformat()
        assert -7300 <= missed["antibiotic"]["remaining_sec"] <= -7200
        assert running["antibiotic"]["state"] == "running" and 2900 <= running["antibiotic"]["remaining_sec"] <= 3000
        assert pressor["on_pressor"] is True and pressor["antibiotic"]["state"] == "none"
        assert pressor["pressors"] == [
            {"drug": "norepinephrine", "rate": 0.12, "at": (now - timedelta(minutes=20)).isoformat()},
            {"drug": "dopamine", "rate": 0.0, "at": (now - timedelta(hours=1)).isoformat()}]

    def test_an_administration_answers_the_clock_and_a_zero_does_not(self, ward):
        _app_, client = ward
        now = datetime.now(timezone.utc).replace(microsecond=0)
        for pid in ("p-a1", "p-a2", "p-n1"):
            _raise_sepsis(client, pid, now - timedelta(hours=3))
        _chart(client, "p-a1", [{"code": "antibiotic_administered", "value": 1}], now - timedelta(hours=2, minutes=30))
        _chart(client, "p-a2", [{"code": "antibiotic_administered", "value": 1}], now - timedelta(hours=1))
        _chart(client, "p-n1", [{"code": "antibiotic_administered", "value": 0}], now - timedelta(hours=2, minutes=30))
        rows = _rows(client)
        met, late, charted_zero = rows["p-a1"]["antibiotic"], rows["p-a2"]["antibiotic"], rows["p-n1"]["antibiotic"]
        assert (met["state"], met["given"], met["remaining_sec"]) == ("met", True, None)
        assert met["given_at"] == (now - timedelta(hours=2, minutes=30)).isoformat()
        assert (late["state"], late["given"]) == ("late", True)
        assert late["given_at"] == (now - timedelta(hours=1)).isoformat()
        assert (charted_zero["state"], charted_zero["given"]) == ("missed", False)      # never «verilmedi» (D8)
        counts = _pharmacy(client).json()["counts"]
        assert (counts["recognized"], counts["recognized_no_record"], counts["clock_missed"]) == (3, 1, 1)

    def test_an_administration_with_no_recognition_is_given(self, ward):
        _app_, client = ward
        at = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=30)
        _chart(client, "p-a1", [{"code": "antibiotic_administered", "value": 1}], at)
        answer = _rows(client)["p-a1"]["antibiotic"]
        assert answer == {"state": "given", "given": True, "given_at": at.isoformat(), "recognized_at": None,
                          "deadline": None, "remaining_sec": None}

    def test_creatinine_travels_with_its_time(self, ward):
        _app_, client = ward
        at = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=4)
        _chart(client, "p-a1", [{"code": "creatinine", "value": 2.1}], at)
        rows = _rows(client)
        assert rows["p-a1"]["creatinine"] == {"value": 2.1, "at": at.isoformat()}
        assert rows["p-a1"]["measured"] is True and rows["p-a2"]["creatinine"] is None


class TestTheScope:
    def test_only_the_callers_beds_with_patients_own_scope_block(self):
        with TestClient(_app(ADULT)) as client:
            _chart(client, "p-n1", [{"code": "norepinephrine_rate", "value": 0.2}],
                   datetime.now(timezone.utc) - timedelta(minutes=5))
            answer = _pharmacy(client).json()
            board = client.get("/patients", headers=PHARMACIST).json()
            everything = _pharmacy(client, DEVICE).json()
        assert [row["patient_id"] for row in answer["rows"]] == ["p-a1", "p-a2"]
        assert [row["patient_id"] for row in answer["rows"]] == sorted(p["patient_id"] for p in board["patients"])
        assert answer["counts"] == {"patients": 2, "clock_running": 0, "clock_missed": 0, "on_pressor": 0,
                                    "recognized": 0, "recognized_no_record": 0}       # the NICU's infusion is not hers
        assert (answer["scope"], answer["scope_note"]) == (board["scope"], board["scope_note"])
        assert answer["scope"]["unrestricted"] is False and answer["scope"]["unit_ids"] == ["unit-adult"]
        assert answer["scope"]["hidden"] == 1
        assert [row["patient_id"] for row in everything["rows"]] == ["p-n1", "p-a1", "p-a2"]   # the vasopressor leads
        assert everything["counts"]["on_pressor"] == 1

    def test_a_scope_that_reaches_no_card_is_an_empty_list_that_says_why(self):
        with TestClient(_app(build_scope("NURSE", unit_ids=["unit-yok"]))) as client:
            answer = _pharmacy(client).json()
            board = client.get("/patients", headers=PHARMACIST).json()
        assert answer["rows"] == [] and answer["counts"]["patients"] == 0
        assert answer["scope"]["blind"] is True and answer["scope_note"] == board["scope_note"]
        assert answer["scope_note"]                                  # the engine's own sentence, not None

    def test_an_unreadable_scope_is_503_not_an_empty_list(self):
        with TestClient(_app(UNKNOWN)) as client:
            r = _pharmacy(client)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")

    def test_a_patient_discharged_through_kabul_is_absent_as_on_the_board(self):
        identities = _identities()
        with TestClient(_app(identities=identities)) as client:
            at = datetime.now(timezone.utc) - timedelta(minutes=5)
            _chart(client, "p-a1", [{"code": "norepinephrine_rate", "value": 0.2}], at)
            assert "p-a1" in _rows(client)
            identities.apply("demo", IdentityRecord(patient_id="p-a1", given="Örnek Hasta", family="Bir",
                                                    state="discharged", source="kabul",
                                                    updated_at=datetime.now(timezone.utc)))
            answer = _pharmacy(client).json()
            board = client.get("/patients", headers=PHARMACIST).json()
        assert "p-a1" not in {p["patient_id"] for p in board["patients"]}
        assert [row["patient_id"] for row in answer["rows"]] == ["p-a2", "p-n1"]
        assert answer["counts"]["on_pressor"] == 0


class TestTheFluidDay:
    def test_the_default_day_starts_at_eight_and_a_saved_shift_start_moves_it(self):
        store = InMemoryTaskStore(zones={"demo": "UTC"})
        with TestClient(_app(store=store)) as client:
            now = datetime.now(timezone.utc)
            day = _pharmacy(client).json()["fluid_day"]
            start, end = datetime.fromisoformat(day["start"]), datetime.fromisoformat(day["end"])
            assert (start.hour, start.minute) == (8, 0) and end - start == timedelta(hours=24)
            assert start <= now < end + timedelta(seconds=5)
            store.save_settings("demo", TaskSettings(shift_start_a=7, shift_start_b=19), by="admin.lbys", now=now)
            moved = datetime.fromisoformat(_pharmacy(client).json()["fluid_day"]["start"])
            assert (moved.hour, moved.minute) == (7, 0) and moved.utcoffset() == timedelta(0)

    def test_the_day_is_read_in_the_tenants_zone(self, monkeypatch):
        """The tenant's zone name goes through `zone_of`, as at /patients/{id}/fluids. The zone database is not on
        every test host, so a fixed +04 stands in for Asia/Baku here (as tests/test_fluids.py does)."""
        asked = []

        def zone_of(name):
            asked.append(name)
            return BAKU if name == "Asia/Baku" else timezone.utc

        monkeypatch.setattr("homunculus.api.app.zone_of", zone_of)
        with TestClient(_app(store=InMemoryTaskStore(zones={"demo": "Asia/Baku"}))) as client:
            start = datetime.fromisoformat(_pharmacy(client).json()["fluid_day"]["start"])
        assert asked == ["Asia/Baku"]
        assert (start.hour, start.minute) == (4, 0) and start.utcoffset() == timedelta(0)       # 08:00 in Baku

    def test_todays_entries_are_summed_and_one_before_the_day_start_is_left_out(self, ward):
        app, client = ward
        first = _pharmacy(client).json()
        start, now = datetime.fromisoformat(first["fluid_day"]["start"]), datetime.fromisoformat(first["now"])
        inside = start + (now - start) / 2                                     # in the day, never ahead of now
        _chart(client, "p-a1", [{"code": "iv_fluid_ml", "value": 500}, {"code": "urine_output_ml", "value": 300}],
               inside)
        wrong = _chart(client, "p-a1", [{"code": "urine_output_ml", "value": 120}], inside)["entries"][0]["entry"]
        assert client.post(f"/clinical/p-a1/entries/{wrong}/retract", json={"reason": "yanlış hastaya girildi"},
                           headers=NURSE).status_code == 200
        # Written straight into the trail: the door's 24-hour rule would refuse it late in the fluid day.
        app.state.audit.append(AuditEvent("demo", "chart", "p-a1", "urine_output_ml", {
            "value": 999, "unit": "mL", "obs_ts": (start - timedelta(hours=1)).isoformat(), "charted_by": "hem.ayse"}))
        rows = _rows(client)
        assert rows["p-a1"]["fluid"] == {"in_ml": 500.0, "out_ml": 300.0, "balance_ml": 200.0, "entries": 2,
                                         "last_at": inside.astimezone(timezone.utc).isoformat()}
        assert rows["p-a2"]["fluid"] is None                                   # «Bugün kayıt yok», never 0 mL
        today = client.get("/patients/p-a1/fluids", headers=NURSE).json()["totals"]["today"]
        assert (today["in"], today["out"], today["balance"]) == (500.0, 300.0, 200.0)     # the Sıvı box's «today»


class TestTheTrail:
    def test_the_read_appends_nothing_to_the_audit_log(self, ward):
        app, client = ward
        _chart(client, "p-a1", [{"code": "creatinine", "value": 2.1}], datetime.now(timezone.utc) - timedelta(hours=1))
        before = len(app.state.audit.records(tenant="demo", limit=10_000))
        for headers in (PHARMACIST, KEY_ONLY, DEVICE):
            assert _pharmacy(client, headers).status_code == 200
        assert _pharmacy(client, NURSE).status_code == 403
        assert len(app.state.audit.records(tenant="demo", limit=10_000)) == before
