# homunculus-engine/tests/test_kabul_boardlink.py
"""BoardLink — the one way admission code touches the board world (Group 2 · B1a, spec §4.3, as
amended by A-3, A-11 and A-11d): the card appears on its bed for the board and the stream; the
weight is charted through the charting door the app injects (Lane A's `chart_observations`); the
comorbidities reach the engine through the audit a restart replays; the open-critical count is the
board's own, firing or latched; a discharge writes the tombstone and publishes nothing; the
retirement is the door the app injects, handed the tombstone's removal frame. The link is built
here from real stores, as `api/app.py` will build it once Lane A's A-11 is merged. No database.
Synthetic patients only."""
from __future__ import annotations

import asyncio
import copy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

import homunculus.scenarios
from homunculus.admission.boardlink import BoardLink, board_link_of, kabul_record
from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import acknowledge_latched, sync_alerts
from homunculus.api.audit import InMemoryAuditLog, iter_records
from homunculus.api.board import board_snapshot
from homunculus.api.clinical import ClinicalEntryError
from homunculus.api.notify import Notifier
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.rehydrate import rehydrate
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario
from homunculus.scope import build_scope, sees_patient

HOSPITAL = "HOSP1"
BED = "5f0c6a1e-0000-4000-8000-0000000000b1"
UNIT = "5f0c6a1e-0000-4000-8000-0000000000a1"
T0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
ESCALATE_AFTER = timedelta(minutes=5)
SCEN = Path(homunculus.scenarios.__file__).parent
#: A lactate reading after the scenario's last event (synthetic), its value set by the test.
LACTATE = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": "lactate"}]},
           "subject": {"reference": "Patient/H2600001"}, "effectiveDateTime": "2026-07-14T11:01:00+00:00"}
#: Lane A's `chart_observations` takes these, by keyword (the coordinator, 2026-10-26).
CHART_KWARGS = {"engine", "store", "audit", "notifier", "hospital", "patient_id", "charted", "now",
                "escalate_after"}


def record(number: str = "H2600001", bed_id: str = BED, unit_id: str = UNIT,
           at: datetime = T0) -> IdentityRecord:
    return kabul_record(patient_number=number, display_name="Sentetik Hasta",
                        birth_date=date(1970, 1, 1), sex="female", bed_label="1A",
                        bed_id=bed_id, unit_id=unit_id, at=at)


class World:
    """One app's board world as `api/app.py` holds it — an engine and an ack store per hospital,
    the identity store, the audit, the notifier — with a BoardLink over it. `published` is every
    frame the link sent to the stream."""

    def __init__(self, *, chart=None, retire=None) -> None:
        self.engines: dict[str, Engine] = {}
        self.stores: dict[str, AckStore] = {}
        self.identities = InMemoryIdentityStore()
        self.audit = InMemoryAuditLog()
        self.notifier = Notifier()
        self.published: list[tuple[str, dict]] = []
        self.link = BoardLink(identities=self.identities, engine=self.engine, store=self.store,
                              audit=self.audit, publish=self.publish, notifier=self.notifier,
                              escalate_after=ESCALATE_AFTER, chart=chart, retire_patient=retire,
                              clock=lambda: T0)

    def engine(self, hospital: str) -> Engine:
        return self.engines.setdefault(hospital, Engine())

    def store(self, hospital: str) -> AckStore:
        return self.stores.setdefault(hospital, AckStore())

    async def publish(self, hospital: str, board: dict) -> None:
        self.published.append((hospital, board))

    def board(self) -> list[dict]:
        """The ward as `GET /patients` builds it."""
        return board_snapshot(self.engine(HOSPITAL), self.store(HOSPITAL),
                              identities=self.identities, hospital=HOSPITAL)

    def ingest(self, fhir: dict, number: str = "H2600001") -> None:
        """A reading as `/ingest` takes it: evaluated, then G2-A1's lifecycle hook."""
        fhir = copy.deepcopy(fhir)
        fhir["subject"]["reference"] = f"Patient/{number}"
        obs = parse_fhir_observation(fhir)
        engine, store = self.engine(HOSPITAL), self.store(HOSPITAL)
        engine.ingest(obs, now=obs.timestamp)
        sync_alerts(engine, store, obs.patient_id, obs.timestamp)

    def ack(self, kind: str, number: str = "H2600001") -> None:
        """An acknowledgement as `/ack` takes it: a latched alert is removed, a firing one acked."""
        store = self.store(HOSPITAL)
        if acknowledge_latched(store, number, kind) is None:
            store.acknowledge(number, kind, "nurse", T0)

    def alert(self, kind: str, number: str = "H2600001") -> dict | None:
        return next((a for b in self.board() if b["patient_id"] == number
                     for a in b["alerts"] if a["kind"] == kind), None)


# ---------------------------------------------------------------- the card
def test_an_admission_puts_its_card_on_its_bed_and_tells_the_stream():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))

    (card,) = world.board()
    assert card["patient_id"] == "H2600001"
    assert (card["identity"]["bed_id"], card["identity"]["unit_id"]) == (BED, UNIT)
    assert (card["identity"]["bed_label"], card["identity"]["display_name"]) == ("1A", "Sentetik Hasta")
    assert card["identity"]["source"] == KABUL
    ((hospital, frame),) = world.published
    assert (hospital, frame["patient_id"], frame["identity"]["bed_id"]) == (HOSPITAL, "H2600001", BED)
    assert world.engine(HOSPITAL).patient_ids() == []          # a card, not a measured patient


def test_the_app_reaches_its_board_link_through_the_request():
    link = World().link
    assert board_link_of(SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))) is None
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(board_link=link)))
    assert board_link_of(request) is link


# ---------------------------------------------------------------- the weight and the profile
def test_the_weight_is_charted_through_the_injected_door_with_the_entries_built_from_it():
    calls: list[dict] = []
    world = World(chart=lambda **kwargs: calls.append(kwargs) or [])
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    world.published.clear()

    asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))

    (call,) = calls
    assert set(call) == CHART_KWARGS
    assert call["engine"] is world.engine(HOSPITAL) and call["store"] is world.store(HOSPITAL)
    assert call["audit"] is world.audit and call["notifier"] is world.notifier
    assert (call["hospital"], call["patient_id"], call["now"], call["escalate_after"]) == \
        (HOSPITAL, "H2600001", T0, ESCALATE_AFTER)
    (entry,) = call["charted"]                                   # api/clinical.build_entries
    obs = entry.observation
    assert (obs.patient_id, obs.code.value, obs.value, obs.unit) == ("H2600001", "weight_kg", 72.5, "kg")
    assert (obs.timestamp, obs.source_device, entry.charted_by) == (T0, "clinician", "hemsire")
    ((hospital, frame),) = world.published                       # the card hears it
    assert (hospital, frame["patient_id"]) == (HOSPITAL, "H2600001")


def test_a_weight_outside_the_engines_bound_is_refused_before_the_door():
    calls: list[dict] = []
    world = World(chart=lambda **kwargs: calls.append(kwargs) or [])
    with pytest.raises(ClinicalEntryError):
        asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 900.0, actor="hemsire"))
    assert calls == [] and world.published == []


def test_charting_with_no_door_wired_raises_and_writes_nothing():
    world = World()
    with pytest.raises(RuntimeError, match="chart_observations not wired"):
        asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
    assert world.published == [] and world.audit.records(tenant=HOSPITAL) == []
    assert world.engine(HOSPITAL).patient_ids() == []


def test_the_comorbidities_reach_the_engine_and_a_restart_replays_them():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    asyncio.run(world.link.apply_profile(HOSPITAL, "H2600001", ["copd", "dementia"], actor="hemsire"))

    assert world.engine(HOSPITAL).profile("H2600001").comorbidities == frozenset({"copd", "dementia"})
    rows = world.audit.records(tenant=HOSPITAL, patient_id="H2600001", limit=50)
    (profile,) = [r for r in rows if r.event_type == "profile"]
    assert (sorted(profile.payload["comorbidities"]), profile.payload["charted_by"]) == \
        (["copd", "dementia"], "hemsire")
    assert "Sentetik" not in repr([r.payload for r in rows])
    assert world.published[-1][1]["patient_id"] == "H2600001"

    engine, store = Engine(), AckStore()                         # a restart: rebuilt from the audit
    rehydrate(engine, store, iter_records(world.audit, tenant=HOSPITAL, page=500))
    assert engine.profile("H2600001").comorbidities == frozenset({"copd", "dementia"})


# ---------------------------------------------------------------- open critical alerts
def test_open_critical_counts_a_critical_nobody_acknowledged_firing_then_latched():
    """G2-A1 (O17): a critical alert whose rule stops firing while nobody acknowledged it stays on
    the board, latched (`resolved_at` set, `acknowledged` false), until a clinician acknowledges
    it. It holds a discharge as a firing one does. Real alerts from the real engine and lifecycle:
    the synthetic septic-shock scenario, then a normal lactate, then the acknowledgement."""
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        world.ingest(fhir)
    shock = world.alert("septic_shock")
    assert (shock["severity"], shock["acknowledged"], shock["resolved_at"]) == ("critical", False, None)
    assert world.link.open_critical(HOSPITAL, "H2600001") == 1        # sepsis and antibiotic_due: high

    world.ingest({**LACTATE, "valueQuantity": {"value": 1.5, "unit": "mmol/L"}})
    shock = world.alert("septic_shock")
    assert shock["resolved_at"] is not None and shock["acknowledged"] is False    # latched
    assert world.link.open_critical(HOSPITAL, "H2600001") == 1

    world.ack("septic_shock")
    assert world.alert("septic_shock") is None                        # the answer removes the latch
    assert world.link.open_critical(HOSPITAL, "H2600001") == 0


def test_an_acknowledged_critical_does_not_count_while_it_still_fires():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        world.ingest(fhir)
    world.ack("septic_shock")
    assert world.alert("septic_shock")["acknowledged"] is True
    assert world.link.open_critical(HOSPITAL, "H2600001") == 0


def test_open_critical_on_a_patient_never_measured_is_nought_and_creates_nothing():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    assert world.link.open_critical(HOSPITAL, "H2600001") == 0
    assert world.engine(HOSPITAL).patient_ids() == []


# ---------------------------------------------------------------- discharge and retirement
def test_a_discharge_writes_the_tombstone_keeps_the_last_place_and_publishes_nothing():
    """A-11d: the one removal frame is published by the app's retirement, after the alerts are
    ended — never by `discharge_identity`. A-11 note B: the tombstone keeps the last bed and unit
    (`_merge` leaves the location group alone when the incoming record names none)."""
    retired: list = []

    async def retire(*args, **kwargs):
        retired.append((args, kwargs))

    world = World(retire=retire)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    asyncio.run(world.link.put_identity(HOSPITAL, record("H2600002", bed_id="other-bed",
                                                         unit_id="other-unit")))
    world.published.clear()

    tomb = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))

    assert world.published == [] and retired == []
    assert (tomb.state, tomb.source, tomb.bed_id, tomb.unit_id) == ("discharged", KABUL, BED, UNIT)
    assert world.identities.get(HOSPITAL, "H2600001") == tomb
    assert [c["patient_id"] for c in world.board()] == ["H2600002"]
    assert world.engine(HOSPITAL).patient_ids() == []


def test_a_discharge_older_than_the_record_is_refused_and_says_so():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record(at=T0 + timedelta(hours=1))))
    assert asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001")) is None
    assert world.identities.get(HOSPITAL, "H2600001").state == "admitted"
    assert not world.link.is_discharged(HOSPITAL, "H2600001")


def test_is_discharged_holds_for_a_kabul_tombstone_only():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    assert world.link.is_discharged(HOSPITAL, "H2600001") is False      # admitted
    assert world.link.is_discharged(HOSPITAL, "H2600099") is False      # unknown
    world.identities.apply(HOSPITAL, IdentityRecord(patient_id="HIS-7", given="Sentetik",
                                                    state="admitted", source="adt", updated_at=T0))
    world.identities.apply(HOSPITAL, IdentityRecord(patient_id="HIS-7", state="discharged",
                                                    source="adt", updated_at=T0))
    assert world.link.is_discharged(HOSPITAL, "HIS-7") is False         # a HIS card keeps its 24 h

    asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    assert world.link.is_discharged(HOSPITAL, "H2600001") is True
    assert world.link.is_discharged("OTHER", "H2600001") is False       # per hospital


def test_the_retirement_is_the_injected_door_handed_the_tombstones_removal():
    calls: list = []

    async def retire(*args, **kwargs):
        calls.append((args, kwargs))
        return ["cleared"]

    world = World(retire=retire)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    tomb = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    world.published.clear()

    assert asyncio.run(world.link.retire(HOSPITAL, "H2600001", tomb)) == ["cleared"]

    ((args, kwargs),) = calls
    assert args == (HOSPITAL, "H2600001") and set(kwargs) == {"frame"}
    frame = kwargs["frame"]
    assert (frame["patient_id"], frame["removed"]) == ("H2600001", True)
    assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
    assert "Sentetik" not in repr(frame)
    assert sees_patient(frame, build_scope("MEMBER", unit_ids=[UNIT]))
    assert not sees_patient(frame, build_scope("MEMBER", unit_ids=["other-unit"]))
    assert world.published == []                 # BoardLink never publishes the removal itself


def test_a_retirement_with_no_door_wired_raises():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    tomb = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    world.published.clear()
    with pytest.raises(RuntimeError, match="retire_patient not wired"):
        asyncio.run(world.link.retire(HOSPITAL, "H2600001", tomb))
    assert world.published == []
