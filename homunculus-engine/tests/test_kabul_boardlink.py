# homunculus-engine/tests/test_kabul_boardlink.py
"""BoardLink — the one way admission code touches the board world (Group 2 · B1a, spec §4.3, as
amended by A-11d, A-20 and A-23): the card appears on its bed for the board and the stream; the
weight is charted through the charting door the app injects (Lane A's `chart_observations`), and
only when that door, the notifier and the escalation delay are all wired; the comorbidities reach
the engine through the audit a restart replays; the open-critical count is the board's own, firing
or latched; a discharge writes the tombstone (a second one returns it, a refused one raises) and
publishes nothing; the retirement is the door the app injects, handed the tombstone's removal frame
and refusing any other record, and what its door raises is a retirement left incomplete (A-25). A
card written after the discharge is refused, whatever its stamp (Task 8 re-review, A-29); a number
with neither an identity nor a reading sends nothing. The link is built here from real stores, as
`api/app.py` builds it; the last section takes the one the app itself builds (Task 6b, A-23,
A-25): wired with the app's own doors, its weight replayed after a restart, the retention sweep's
removal and the monitor strip's link. No database. Synthetic patients only."""
from __future__ import annotations

import asyncio
import copy
from datetime import date, datetime, timedelta, timezone
from functools import partial
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.admission.boardlink import BoardLink, RetireIncomplete, board_link_of, kabul_record
from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import acknowledge_latched, sync_alerts
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog, iter_records
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.clinical import ClinicalEntryError, chart_observations
from homunculus.api.notify import Notifier
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.rehydrate import rehydrate
from homunculus.canonical import SignalCode
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario
from homunculus.scope import build_scope, sees_patient
from tests.test_infinity_shadow_api import HOSPITAL as SHADOW_HOSPITAL
from tests.test_infinity_shadow_api import _app as shadow_app, _board as shadow_board
from tests.test_api_shadow_findings import HOSPITAL as RULES_HOSPITAL
from tests.test_api_shadow_findings import _app as rules_app, _post as rules_post
from tests.test_infinity_shadow_api import _post as shadow_post

HOSPITAL = "HOSP1"
BED = "5f0c6a1e-0000-4000-8000-0000000000b1"
UNIT = "5f0c6a1e-0000-4000-8000-0000000000a1"
T0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
ESCALATE_AFTER = timedelta(minutes=5)
SCEN = Path(homunculus.scenarios.__file__).parent
#: A lactate reading after the scenario's last event (synthetic), its value set by the test.
LACTATE = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": "lactate"}]},
           "subject": {"reference": "Patient/H2600001"}, "effectiveDateTime": "2026-07-14T11:01:00+00:00"}
#: Lane A's `chart_observations` takes these, by keyword (the coordinator, 2026-10-26); `mirror` is
#: Aşama B's — None when the link was built without the shadow lane's hook.
CHART_KWARGS = {"engine", "store", "audit", "notifier", "hospital", "patient_id", "charted", "now",
                "escalate_after", "mirror"}


def record(number: str = "H2600001", bed_id: str = BED, unit_id: str = UNIT,
           at: datetime = T0) -> IdentityRecord:
    return kabul_record(patient_number=number, display_name="Sentetik Hasta",
                        birth_date=date(1970, 1, 1), sex="female", bed_label="1A",
                        bed_id=bed_id, unit_id=unit_id, at=at)


class World:
    """One app's board world as `api/app.py` holds it — an engine and an ack store per hospital,
    the identity store, the audit, the notifier — with a BoardLink over it. `published` is every
    frame the link sent to the stream; `now` is the link's clock. `wiring` overrides the app's
    notifier and escalation delay (`notifier=None`: an app that forgot to wire it)."""

    def __init__(self, *, chart=None, retire=None, **wiring) -> None:
        self.engines: dict[str, Engine] = {}
        self.stores: dict[str, AckStore] = {}
        self.identities = InMemoryIdentityStore()
        self.audit = InMemoryAuditLog()
        self.notifier = Notifier()
        self.published: list[tuple[str, dict]] = []
        self.now = T0
        wiring = {"notifier": self.notifier, "escalate_after": ESCALATE_AFTER, **wiring}
        self.link = BoardLink(identities=self.identities, engine=self.engine, store=self.store,
                              audit=self.audit, publish=self.publish, chart=chart,
                              retire_patient=retire, clock=lambda: self.now, **wiring)

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


def test_an_identity_is_never_stamped_with_a_clock_that_names_no_zone():
    """A-15, as `admission/numbers.py` refuses it: a naive datetime is read in the server's own
    zone, so the identity store's ordering would depend on where the process runs."""
    with pytest.raises(ValueError, match="time zone"):
        record(at=datetime(2026, 10, 25, 8, 0))


def test_a_number_with_neither_an_identity_nor_a_reading_sends_nothing_and_creates_nothing():
    """`patient_board` reads `engine.state()`, which creates the patient: a card for a number
    nobody admitted and nothing measured would put it on every board in the hospital."""
    world = World(chart=lambda **kwargs: [])
    asyncio.run(world.link.apply_profile(HOSPITAL, "H2600099", ["copd"], actor="hemsire"))
    asyncio.run(world.link.chart_weight(HOSPITAL, "H2600099", 72.5, actor="hemsire"))
    assert world.published == []
    assert world.engine(HOSPITAL).patient_ids() == []


def test_a_link_without_the_apps_builders_sends_every_card_with_the_shadow_key_none():
    """Lane B's review of 457a2bd (M-2): `patient_board` always sets `"shadow"` and
    `identity_only_board` has no such key, so a link built without the app's builders used to send
    two shapes. Both plain cards — the identity-only one before the first value, the measured one
    after it — carry the key, None: there is no builder to fill it."""
    world = World(chart=chart_observations)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    identity_card = world.published[-1][1]
    asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
    measured_card = world.published[-1][1]

    assert "meds" not in identity_card and "meds" in measured_card      # the two branches
    assert "shadow" in identity_card and identity_card["shadow"] is None
    assert "shadow" in measured_card and measured_card["shadow"] is None
    assert set(identity_card) == set(identity_only_board(record())) | {"shadow"}


@pytest.mark.parametrize("stamp", [T0, T0 + timedelta(hours=2)],
                         ids=["stamped before the discharge", "stamped after it"])
def test_a_card_written_after_the_discharge_is_refused_whatever_its_stamp(stamp):
    """Task 8 re-review, A-29: an admission's card written again after the patient left — a
    resend's retry that read the admission open just before the discharge — is refused before the
    store sees it. Stamped after the tombstone, the store itself would take it (`_merge` lets a
    newer `kabul` write decide) and the discharged patient would lie on a bed in cleaning for good,
    a tombstone never being pruned. The check and the write are one synchronous step, so no other
    request runs between them; a number is never issued twice, so no admission is refused by it.
    Nothing is written, nothing published; the caller reports the card `failed`."""
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    world.now = T0 + timedelta(hours=1)
    tomb = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    world.published.clear()

    with pytest.raises(RuntimeError, match="H2600001 is discharged"):
        asyncio.run(world.link.put_identity(HOSPITAL, record(at=stamp)))

    assert world.identities.get(HOSPITAL, "H2600001") == tomb
    assert world.published == [] and world.board() == []
    assert world.engine(HOSPITAL).patient_ids() == []


def _ingesting_door(calls: list):
    """A charting door that really puts the entries into the engine, as Lane A's
    `chart_observations` does — so a charting that should not have happened can be seen."""
    def chart(*, engine, charted, now, **_rest):
        calls.append(charted)
        for item in charted:
            engine.ingest(item.observation, now=now)
        return []
    return chart


@pytest.mark.parametrize("write", ["chart_weight", "apply_profile"])
def test_a_discharged_number_takes_no_weight_and_no_profile(write):
    """A-11: nothing reaches the engine for a discharged number, and no row a restart would
    replay is written. Lane A's `chart_observations` leaves that drop to its caller, so BoardLink
    refuses before it builds, charts or writes anything; the admission route reports it failed."""
    calls: list = []
    world = World(chart=_ingesting_door(calls))
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    world.published.clear()

    with pytest.raises(RuntimeError, match="H2600001 is discharged"):
        if write == "chart_weight":
            asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
        else:
            asyncio.run(world.link.apply_profile(HOSPITAL, "H2600001", ["copd"], actor="hemsire"))

    assert calls == [] and world.published == []
    assert world.engine(HOSPITAL).patient_ids() == []
    assert world.engine(HOSPITAL).profile("H2600001") is None
    assert world.audit.records(tenant=HOSPITAL) == []


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
    assert call["mirror"] is None                                # no shadow lane wired here
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


@pytest.mark.parametrize(("missing", "named"), [("chart", "chart_observations"),
                                                ("notifier", "notifier"),
                                                ("escalate_after", "escalate_after")])
def test_charting_with_any_part_of_the_door_unwired_raises_before_anything_is_charted(missing, named):
    """Lane A's `chart_observations` prunes the notifier before it writes the `chart` row: run
    with no notifier, it would leave the weight in the engine with no row for a restart to
    replay. The door here charts into the engine, so "nothing charted" is observable."""
    calls: list = []
    world = World(**{"chart": _ingesting_door(calls), missing: None})
    with pytest.raises(RuntimeError, match=f"{named} not wired"):
        asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
    assert calls == [] and world.published == [] and world.audit.records(tenant=HOSPITAL) == []
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


# ---------------------------------------------------------------- Aşama B: the shadow lane's hooks
def _hooked_world():
    """A World whose link is handed Aşama B's four callables, as `api/app.py` hands it the app's
    own, each recording what reached it: the identity write (and whether the record had landed),
    each charted observation (and whether the real engine held it already), each profile (and
    whether the real engine had been given it). `card` and `identity_card` build as the app's do —
    `patient_board`, `identity_only_board` — and name themselves in the `shadow` key, so a frame
    says which builder made it. The charting door is the real `chart_observations`."""
    heard: list[tuple] = []
    worlds: list[World] = []

    def mirror(hospital, obs, now):
        real = worlds[0].engine(hospital).state(obs.patient_id).latest(obs.code)
        heard.append(("mirror", hospital, obs.patient_id, obs.code.value, obs.value, now,
                      real is not None and real.value == obs.value))

    def mirror_profile(hospital, profile):
        heard.append(("profile", hospital, profile.patient_id, profile.comorbidities,
                      worlds[0].engine(hospital).profile(profile.patient_id) == profile))

    def occupancy_reset(hospital):
        stored = worlds[0].identities.get(hospital, "H2600001")
        heard.append(("reset", hospital, stored.state if stored is not None else None))

    def card(hospital, patient_id, identity):
        world = worlds[0]
        return {**patient_board(world.engine(hospital), patient_id, world.store(hospital),
                                identity=identity), "shadow": "card"}

    def identity_card(hospital, identity):
        return {**identity_only_board(identity), "shadow": "identity_card"}

    worlds.append(World(chart=chart_observations, mirror=mirror, mirror_profile=mirror_profile,
                        occupancy_reset=occupancy_reset, card=card, identity_card=identity_card))
    return worlds[0], heard


def test_the_shadow_lane_hears_the_identity_write_the_weight_and_the_profile():
    """Aşama B × B1a: the strip's cached occupants are dropped after the identity write has
    landed — the admission's and a resend's retry's alike — so the next readings body links the
    bed's new occupant; the weight reaches the shadow engine through the charting door's `mirror`,
    after the real evaluation, at the link's one instant; the profile right after the real
    `set_profile`. Every card is the app's builders': the identity-only one before the first
    value, the measured one after it — so each frame carries the `shadow` key."""
    world, heard = _hooked_world()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    assert heard == [("reset", HOSPITAL, "admitted")]
    assert world.published[-1][1]["shadow"] == "identity_card"

    heard.clear()
    asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
    assert heard == [("mirror", HOSPITAL, "H2600001", "weight_kg", 72.5, T0, True)]
    assert world.published[-1][1]["shadow"] == "card"

    heard.clear()
    asyncio.run(world.link.apply_profile(HOSPITAL, "H2600001", ["copd"], actor="hemsire"))
    assert heard == [("profile", HOSPITAL, "H2600001", frozenset({"copd"}), True)]
    assert world.published[-1][1]["shadow"] == "card"

    heard.clear()                                                # a resend's retry: the card again
    asyncio.run(world.link.put_identity(HOSPITAL, record(at=T0 + timedelta(minutes=1))))
    assert heard == [("reset", HOSPITAL, "admitted")]
    assert world.published[-1][1]["shadow"] == "card"


@pytest.mark.parametrize("write", ["put_identity", "chart_weight", "apply_profile"])
def test_a_discharged_number_reaches_no_shadow_hook(write):
    """A-11 holds for the shadow lane too: a discharged number is refused before the identity
    write, the chart and the profile, so no hook hears it and no card is built."""
    world, heard = _hooked_world()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    heard.clear()
    world.published.clear()
    calls = {
        "put_identity": lambda: world.link.put_identity(HOSPITAL, record(at=T0 + timedelta(hours=1))),
        "chart_weight": lambda: world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"),
        "apply_profile": lambda: world.link.apply_profile(HOSPITAL, "H2600001", ["copd"],
                                                          actor="hemsire"),
    }
    with pytest.raises(RuntimeError, match="H2600001 is discharged"):
        asyncio.run(calls[write]())
    assert heard == [] and world.published == []


# ---------------------------------------------------------------- Aşama B: the hooks are witnesses
# Lane B's review of 457a2bd (M-1): the shadow lane hears a write and is never a condition of it.
def _broken(*_args):
    raise RuntimeError("synthetic hook failure")


def _hook_errors(caplog, hook: str) -> list:
    """The ERROR records the link logged for this hook, each with its traceback."""
    return [r for r in caplog.records
            if r.levelname == "ERROR" and r.name == "homunculus.admission.boardlink"
            and f"{hook} hook raised" in r.getMessage()]


def _profile_rows(world: World) -> list[tuple]:
    rows = world.audit.records(tenant=HOSPITAL, patient_id="H2600001", event_type="profile", limit=50)
    return [(row.event_type, row.payload) for row in rows]


def test_the_profile_is_audited_before_the_shadow_lane_hears_it():
    """The engine holds the profile and the row a restart replays stands behind it before
    `mirror_profile` is called: nothing the lane does can leave the one without the other."""
    seen: list[int] = []
    worlds: list[World] = []

    def mirror_profile(hospital, profile):
        seen.append(len(worlds[0].audit.records(tenant=hospital, patient_id=profile.patient_id,
                                                event_type="profile", limit=10)))

    worlds.append(World(mirror_profile=mirror_profile))
    world = worlds[0]
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    asyncio.run(world.link.apply_profile(HOSPITAL, "H2600001", ["copd"], actor="hemsire"))
    assert seen == [1]                                           # the row was there when it was heard


def test_a_profile_mirror_that_raises_leaves_the_audit_row_and_the_write_stands(caplog):
    plain = World()                                              # the same writes, no hook at all
    asyncio.run(plain.link.put_identity(HOSPITAL, record()))
    asyncio.run(plain.link.apply_profile(HOSPITAL, "H2600001", ["copd", "dementia"],
                                         actor="hemsire"))

    world = World(mirror_profile=_broken)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    with caplog.at_level("ERROR", logger="homunculus.admission.boardlink"):
        asyncio.run(world.link.apply_profile(HOSPITAL, "H2600001", ["copd", "dementia"],
                                             actor="hemsire"))

    assert world.engine(HOSPITAL).profile("H2600001").comorbidities == frozenset({"copd", "dementia"})
    assert len(_profile_rows(world)) == 1 and _profile_rows(world) == _profile_rows(plain)
    assert len(world.published) == len(plain.published) == 2     # the card was republished
    assert world.published[-1][1]["patient_id"] == "H2600001"

    engine, store = Engine(), AckStore()                         # a restart replays the profile
    rehydrate(engine, store, iter_records(world.audit, tenant=HOSPITAL, page=500))
    assert engine.profile("H2600001").comorbidities == frozenset({"copd", "dementia"})

    (error,) = _hook_errors(caplog, "mirror_profile")
    assert error.exc_info is not None                            # the traceback, no value in the line
    assert "copd" not in error.getMessage() and "H2600001" not in error.getMessage()


def test_an_occupancy_reset_that_raises_leaves_the_identity_written_and_the_card_sent(caplog):
    world = World(occupancy_reset=_broken)
    with caplog.at_level("ERROR", logger="homunculus.admission.boardlink"):
        asyncio.run(world.link.put_identity(HOSPITAL, record()))
        asyncio.run(world.link.put_identity(HOSPITAL, record(at=T0 + timedelta(minutes=1))))  # a resend

    stored = world.identities.get(HOSPITAL, "H2600001")
    assert stored is not None and stored.state == "admitted" and stored.bed_id == BED
    assert [frame["patient_id"] for _hospital, frame in world.published] == ["H2600001"] * 2
    assert world.published[-1][1]["identity"]["bed_id"] == BED
    errors = _hook_errors(caplog, "occupancy_reset")
    assert len(errors) == 2 and all(error.exc_info is not None for error in errors)


def test_a_weight_mirror_that_raises_leaves_the_chart_row_the_door_writes_after_it(caplog):
    """`chart_observations` calls `mirror` before it writes the `chart` row: a `mirror` that raised
    through it would leave the weight in the engine with no row for a restart to replay."""
    world = World(chart=chart_observations, mirror=_broken)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    with caplog.at_level("ERROR", logger="homunculus.admission.boardlink"):
        asyncio.run(world.link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))

    (chart,) = world.audit.records(tenant=HOSPITAL, event_type="chart", patient_id="H2600001",
                                   limit=10)
    assert (chart.subject, chart.payload["value"], chart.payload["charted_by"]) == \
        ("weight_kg", 72.5, "hemsire")
    assert world.engine(HOSPITAL).state("H2600001").latest(SignalCode("weight_kg")).value == 72.5
    assert world.published[-1][1]["patient_id"] == "H2600001"
    (error,) = _hook_errors(caplog, "mirror")
    assert error.exc_info is not None


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


def test_open_critical_on_a_number_with_no_identity_is_nought_and_creates_nothing():
    world = World()
    assert world.link.open_critical(HOSPITAL, "H2600099") == 0
    assert world.engine(HOSPITAL).patient_ids() == []


def test_open_critical_counts_through_plain_cards_never_the_apps_card_builder():
    """Lane B's review of 457a2bd (M-3): the count needs the real engine's alerts, not the shadow
    picture the app's `card` builder computes. The injected builder here answers a card with no
    alerts, and records that it was called: the count is still 1, and it was never called."""
    built: list[str] = []

    def card(hospital, patient_id, identity):
        built.append(patient_id)
        return {"patient_id": patient_id, "alerts": [], "shadow": "card"}

    world = World(card=card)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        world.ingest(fhir)
    built.clear()

    assert world.link.open_critical(HOSPITAL, "H2600001") == 1
    assert built == []

    asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))   # a tombstone's card: a removal
    assert world.link.open_critical(HOSPITAL, "H2600001") == 0
    assert built == []


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
    assert tomb.display_name == "Sentetik Hasta"         # A-16: the tombstone keeps the identity
    assert world.identities.get(HOSPITAL, "H2600001") == tomb
    assert [c["patient_id"] for c in world.board()] == ["H2600002"]
    assert world.engine(HOSPITAL).patient_ids() == []


def test_a_discharge_the_store_refuses_raises_and_the_card_stays():
    """A newer record decides (the identity store's ordering): the discharge did not happen. A
    None here let the caller report the board `ok` and hand `retire` nothing (A-23, I-1)."""
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record(at=T0 + timedelta(hours=1))))
    world.published.clear()
    with pytest.raises(RuntimeError, match="refused"):
        asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    assert world.identities.get(HOSPITAL, "H2600001").state == "admitted"
    assert not world.link.is_discharged(HOSPITAL, "H2600001")
    assert [c["patient_id"] for c in world.board()] == ["H2600001"] and world.published == []


def test_a_second_discharge_returns_the_tombstone_even_when_the_store_refuses_its_stamp():
    """A repeated confirm is the same success, not an error: the patient has left."""
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    world.published.clear()
    world.now = T0 + timedelta(hours=2)
    first = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    again = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    world.now = T0 + timedelta(hours=1)                  # stamped before the stored tombstone
    late = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    for tomb in (first, again, late):
        assert (tomb.state, tomb.source, tomb.bed_id, tomb.unit_id) == ("discharged", KABUL, BED, UNIT)
        assert tomb.display_name == "Sentetik Hasta"
    assert world.published == []


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


@pytest.mark.parametrize("given", ["another number's tombstone", "an admitted record",
                                   "a HIS discharge", "no record"])
def test_a_retirement_refuses_anything_but_this_numbers_kabul_tombstone(given):
    """A removal frame built from the wrong record would take another patient's card off the
    screens, or an admitted one's: refused before the door is called."""
    calls: list = []

    async def retire(*args, **kwargs):
        calls.append((args, kwargs))

    world = World(retire=retire)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    asyncio.run(world.link.put_identity(HOSPITAL, record("H2600002", bed_id="other-bed",
                                                         unit_id="other-unit")))
    records = {
        "another number's tombstone": asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600002")),
        "an admitted record": world.identities.get(HOSPITAL, "H2600001"),
        "a HIS discharge": IdentityRecord(patient_id="H2600001", state="discharged", source="adt",
                                          updated_at=T0, bed_id=BED, unit_id=UNIT),
        "no record": None,
    }
    world.published.clear()
    with pytest.raises(ValueError):
        asyncio.run(world.link.retire(HOSPITAL, "H2600001", records[given]))
    assert calls == [] and world.published == []


def test_a_retirement_with_no_door_wired_raises():
    world = World()
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    tomb = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    world.published.clear()
    with pytest.raises(RuntimeError, match="retire_patient not wired"):
        asyncio.run(world.link.retire(HOSPITAL, "H2600001", tomb))
    assert world.published == []


def test_a_door_that_raises_is_a_retirement_left_incomplete_not_a_refusal():
    """A-25: whatever the door raises — after the tombstone was written, so a read of the board
    leaves the card off; whether its removal frame went out depends on where in the door it
    failed — comes out as `RetireIncomplete`, the door's error as its cause, so the discharge
    route can tell it from a refusal before the door (a `ValueError`, or a `RuntimeError` for a
    door not wired), which sent nothing and is a failed discharge."""
    audit_down = RuntimeError("audit store down")
    calls: list = []

    async def retire(*args, **kwargs):
        calls.append(kwargs["frame"])
        raise audit_down

    world = World(retire=retire)
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    tomb = asyncio.run(world.link.discharge_identity(HOSPITAL, "H2600001"))
    with pytest.raises(RetireIncomplete, match="H2600001") as caught:
        asyncio.run(world.link.retire(HOSPITAL, "H2600001", tomb))
    assert caught.value.__cause__ is audit_down
    assert not isinstance(caught.value, (ValueError, RuntimeError))
    assert [frame["removed"] for frame in calls] == [True]           # the door was entered, once


# ---------------------------------------------------------------- take_off: the step, never raising
def _counting_door(calls: list, error: Exception | None = None):
    async def retire(tenant, patient_number, *, frame):
        calls.append((patient_number, frame))
        if error is not None:
            raise error
        return []
    return retire


def test_take_off_writes_the_tombstone_then_retires_through_the_door_and_may_run_again():
    """Review I-2: the discharge's board step is one method, for the confirmation, its retry and
    the bed release: the tombstone, then the retirement. Both parts are idempotent, so a second
    run — the nurse's retry — answers `ok` again."""
    calls: list = []
    world = World(retire=_counting_door(calls))
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    assert asyncio.run(world.link.take_off(HOSPITAL, "H2600001")) == ("ok", "ok")
    assert world.link.is_discharged(HOSPITAL, "H2600001") and world.board() == []
    assert asyncio.run(world.link.take_off(HOSPITAL, "H2600001")) == ("ok", "ok")
    assert [(number, frame["removed"]) for number, frame in calls] == [("H2600001", True)] * 2


def test_take_off_does_not_look_at_alerts_the_confirmation_is_the_one_hold():
    """Review I-1 and the dashboard review's ordering: the hold on an unacknowledged critical
    alarm is the confirmation's own (PENDING_DISCHARGE → DISCHARGED, under its locks). The step
    runs for a patient already confirmed gone — after that confirmation, at its retry, at the bed
    release — and must not be held by an alert on a card left standing, or such a card could never
    be taken off. So it takes the patient off with the alarm open: the retirement ends it."""
    calls: list = []
    world = World(retire=_counting_door(calls))
    asyncio.run(world.link.put_identity(HOSPITAL, record()))
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        world.ingest(fhir)
    assert world.link.open_critical(HOSPITAL, "H2600001") == 1

    assert asyncio.run(world.link.take_off(HOSPITAL, "H2600001")) == ("ok", "ok")
    assert world.link.is_discharged(HOSPITAL, "H2600001") and len(calls) == 1


@pytest.mark.parametrize(("failure", "answer"), [
    ("the store refuses the tombstone", ("failed", "failed")),
    ("no door wired", ("failed", "failed")),
    ("the door raises", ("ok", "incomplete")),
])
def test_take_off_reports_each_failure_and_never_raises(failure, answer):
    calls: list = []
    door = None if failure == "no door wired" else _counting_door(
        calls, RuntimeError("audit store down") if failure == "the door raises" else None)
    world = World(retire=door)
    stamp = T0 + timedelta(hours=1) if failure == "the store refuses the tombstone" else T0
    asyncio.run(world.link.put_identity(HOSPITAL, record(at=stamp)))
    assert asyncio.run(world.link.take_off(HOSPITAL, "H2600001")) == answer
    assert len(calls) == (1 if failure == "the door raises" else 0)


# ---------------------------------------------------------------- the link as the app wires it
# Task 6b (A-23, A-25): `api/app.py` builds the link from its own stores and hands it Lane A's
# doors by reference — `chart_observations`, `retire_and_publish`, the broadcaster's publish.
TOKEN = "t"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def app_with(audit=None, identities=None):
    return create_app({TOKEN: HOSPITAL}, run_escalation_loop=False,
                      audit=audit if audit is not None else InMemoryAuditLog(),
                      identities=identities)


def test_the_app_builds_its_board_link_with_its_own_doors_never_copies():
    """Lane A's condition 5: the link is handed the app's doors themselves, so charting and
    retirement can never drift from what `/clinical` and the escalation cycle run."""
    identities = InMemoryIdentityStore()
    app = app_with(identities=identities)
    link = app.state.board_link
    assert isinstance(link, BoardLink)
    assert link._chart is chart_observations
    assert link._retire is app.state.retire_patient
    assert link._publish == app.state.broadcaster.publish       # a bound method: equal, not `is`
    assert link._notifier is app.state.notifier and link._audit is app.state.audit
    assert link._identities is identities
    assert link._escalate_after == timedelta(minutes=5)          # create_app's own default


def test_a_weight_charted_through_the_apps_own_door_is_replayed_after_a_restart():
    """A-23: the weight goes through the REAL `chart_observations` the app wires, so its `chart`
    row is the one the replay reads — the restarted app's card carries it."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    link = app_with(audit, identities).state.board_link
    asyncio.run(link.put_identity(HOSPITAL, record()))
    asyncio.run(link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
    (chart,) = audit.records(tenant=HOSPITAL, event_type="chart", patient_id="H2600001", limit=10)
    assert (chart.subject, chart.payload["value"], chart.payload["charted_by"]) == \
        ("weight_kg", 72.5, "hemsire")
    assert "Sentetik" not in repr([r.payload for r in audit.records(tenant=HOSPITAL, limit=100)])

    restarted = app_with(audit, identities)                      # the engine rebuilt from the audit
    with TestClient(restarted) as client:
        (card,) = client.get("/patients", headers=AUTH).json()["patients"]
    assert card["patient_id"] == "H2600001"
    assert card["meds"]["weight_kg"] == 72.5
    assert card["identity"]["bed_id"] == BED


def test_the_retention_sweep_sends_a_removal_with_the_last_bed_and_unit():
    """api/app.py's 24-hour sweep (a record that is not a `kabul` tombstone, but had its own bed):
    the removal used to carry no identity at all, so no scoped screen ever received it (X55)."""
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="M-1", given="Sentetik", bed="1A",
                                              state="admitted", source="manuel", updated_at=T0,
                                              bed_id=BED, unit_id=UNIT))
    identities.apply(HOSPITAL, IdentityRecord(patient_id="M-1", state="discharged",
                                              source="manuel", updated_at=T0))
    app = app_with(identities=identities)
    queue = app.state.broadcaster.subscribe(HOSPITAL)
    asyncio.run(app.state.escalation_cycle(T0 + timedelta(days=2)))
    frame = queue.get_nowait()
    assert (frame["patient_id"], frame["removed"]) == ("M-1", True)
    assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
    assert "Sentetik" not in repr(frame)
    assert sees_patient(frame, build_scope("MEMBER", unit_ids=[UNIT]))
    assert queue.empty()


def test_the_monitor_strip_links_a_device_to_the_kabul_patient_on_its_bed(tmp_path):
    """Aşama A's `_occupants`: the device table row's bed_id is the tenant bed UUID from now on; a
    `kabul` identity names that bed itself, with no HIS location for the bed map to resolve."""
    identities = InMemoryIdentityStore()
    identities.apply(SHADOW_HOSPITAL, record(bed_id="bed-b2", unit_id="unit-2"))
    client, clock, _ = shadow_app(tmp_path, identities=identities)
    shadow_post(client, clock)
    beds = {b["bed_label"]: b for b in shadow_board(client)["beds"]}
    assert (beds["B-2"]["link"], beds["B-2"]["patient_id"]) == ("one", "H2600001")
    assert (beds["B-1"]["link"], beds["B-1"]["patient_id"]) == ("none", None)


# Aşama B × B1a: the app's link is handed the shadow lane's hooks and card builders, by reference.
def test_the_app_hands_its_board_link_the_shadow_lanes_own_hooks_never_copies():
    """The admission reaches the shadow engine through the very callables Lane A's doors use, so
    it can never drift from what `/clinical` and `PUT /clinical/{id}/profile` mirror."""
    app = app_with()
    link = app.state.board_link
    assert link._mirror is app.state.shadow_mirror
    assert link._mirror_profile is app.state.shadow_profile
    assert link._occupancy_reset is app.state.shadow_occupancy_reset


def test_at_rules_the_apps_admission_feeds_the_shadow_lane_and_its_frames_carry_shadow(tmp_path):
    """At the stage `rules`, through the link the app builds: the admission's identity write drops
    the strip's cached occupants, so the very next readings body links the monitor on its bed to
    the admitted patient (the cache would hold the empty bed for 10 s); a resend's retry writes the
    card again with the shadow picture on it; the weight and the comorbidities reach the shadow
    engine; and every frame the link sends is the app's own card, `shadow` key included."""
    client, _audit, _samples, _identities = rules_app(tmp_path)
    with client:
        link, lane = client.app.state.board_link, client.app.state.shadow_lane
        queue = client.app.state.broadcaster.subscribe(RULES_HOSPITAL)

        def frames() -> list[dict]:
            sent = []
            while not queue.empty():
                sent.append(queue.get_nowait())
            return [frame for frame in sent if frame["patient_id"] == "H2600001"]

        assert rules_post(client).status_code == 200       # the occupants read and cached: bed-b1 empty
        admitted_at = datetime.now(timezone.utc)
        client.portal.call(link.put_identity, RULES_HOSPITAL,
                           record(bed_id="bed-b1", unit_id="unit-1", at=admitted_at))
        (frame,) = frames()
        assert "shadow" in frame and frame["shadow"] is None           # not linked yet
        assert frame["latest"]["news2"] is None                         # the identity-only card
        assert rules_post(client).status_code == 200       # the next body, 2 s on: the link starts
        assert set(lane.linked[RULES_HOSPITAL]) == {"H2600001"}
        assert rules_post(client).status_code == 200       # the first samples (HR 140, SpO2 85)
        frames()

        client.portal.call(link.put_identity, RULES_HOSPITAL,          # a resend's retry
                           record(bed_id="bed-b1", unit_id="unit-1",
                                  at=admitted_at + timedelta(seconds=1)))
        (frame,) = frames()
        assert frame["shadow"]["vitals"]["heart_rate"]["value"] == 140.0
        assert frame["latest"]["news2"] is None                         # still never measured

        client.portal.call(partial(link.chart_weight, RULES_HOSPITAL, "H2600001", 72.5,
                                   actor="hemsire"))
        shadow_engine = lane.engines[RULES_HOSPITAL]
        assert shadow_engine.state("H2600001").latest(SignalCode("weight_kg")).value == 72.5
        (frame,) = frames()
        assert frame["meds"]["weight_kg"] == 72.5                       # the measured card
        assert frame["shadow"]["vitals"]["heart_rate"]["value"] == 140.0

        client.portal.call(partial(link.apply_profile, RULES_HOSPITAL, "H2600001", ["copd"],
                                   actor="hemsire"))
        assert shadow_engine.profile("H2600001").comorbidities == frozenset({"copd"})
        (frame,) = frames()
        assert frame["shadow"] is not None
        assert lane.state == "ok"
