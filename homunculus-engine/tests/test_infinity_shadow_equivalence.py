"""Aşama A and Aşama B change nothing clinical: the proof the plans' gates rest on.

Two apps run the same engine inputs: A with the stage off, B with the stage on and the shadow lane
fed, between every step, with monitor values that would raise every alert if they were clinical.
Everything a clinician, a notification or an auditor could ever see must be identical. A negative
control shows the harness can tell a difference. Synthetic scenarios only (the engine's own YAML).

Aşama B (spec 2026-10-27, D11) runs B a third time with the stage `rules`: the lane's samples feed
a SECOND engine, which may add exactly three things — the `shadow` key on a card, audit rows of the
two shadow kinds, and the frames the sampler republishes inside a shadow step (a linked patient's
real card, carrying its new shadow picture). `_clinical` takes those out and nothing else;
`_republish_drift` holds each republished frame to being the real card it repeats.

Every wall-clock read on the clinical path is frozen (`_freeze`). Found by grepping
`datetime.now` / `_now_iso` / `time.time()` under src/homunculus/api/ (and the engine's packages)
on 2026-10-19: api/app.py, api/board.py, api/clinical.py and api/patient_identity.py read
`datetime.now`; api/audit.py and api/notify.py have `_now_iso`. Again on 2026-10-27 (Aşama B):
api/infinity_rules.py reads `time.time` only as the default of its clock, and the app hands it
`shadow_clock` — the lane's clock here. Grep again when this file changes, and add any new one:
two runs must differ ONLY by the shadow lane.
"""
import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

import homunculus.api.app as app_module
import homunculus.api.audit as audit_module
import homunculus.api.board as board_module
import homunculus.api.clinical as clinical_module
import homunculus.api.notify as notify_module
import homunculus.api.patient_identity as identity_module
import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog, verify_chain
from homunculus.api.identity import Caller
from homunculus.api.infinity_rules import DEFAULT_PARAMETERS
from homunculus.api.infinity_shadow import ShadowSettings
from homunculus.api.patient_identity import InMemoryIdentityStore
from homunculus.scenarios.loader import load_scenario
from homunculus.scope import Scope, ScopeReason
from homunculus.tenant.bedmap import BedMap, BedRef

SCEN = Path(homunculus.scenarios.__file__).parent
TOKEN, HOSPITAL = "tok-device-00000000000000000000000000", "HOSP1"
SHADOW = "s" * 40
FROZEN = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
TABLE = {
    "schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic",
    "approved_by": "test", "approved_at": "2026-07-14",
    "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "bed_label": "B-1",
                 "bed_id": "bed-b1", "unit_id": "unit-1", "method": "monitor_screen",
                 "verified_at": "2026-07-14", "valid_from": "2026-07-01T00:00:00Z", "valid_to": None,
                 "note": "synthetic"}],
}
# Clinicians as well as the device token: a leak that only a signed-in or a scoped caller would see
# (the strip merged into /patients for a JWT only) must show here too. One nurse sees the whole
# hospital; one is scoped to the bed the table puts the monitor on.
JWTS = {
    "nurse-jwt": Caller(hospital=HOSPITAL, actor="ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "alerts.ack"})),
    "scoped-jwt": Caller(hospital=HOSPITAL, actor="zeyneb", groups=("nurse",), perms=frozenset({"board.view"})),
}
SCOPES = {"scoped-jwt": Scope(False, ScopeReason.ASSIGNED, bed_ids=frozenset({"bed-b1"}))}
# Every 30 s from 0.5 to 12 min: a change to the escalation TIMER (5 min) shows at the cycle it moves.
ESCALATION_MINUTES = [m / 2 for m in range(1, 25)]
SHADOW_KINDS = ("shadow_alert", "shadow_alert_cleared")      # the only audit rows the lane writes
# The card's keys judged at the instant the card is BUILT (`board._meds`: `now` minus the
# recognition, the deadline minus `now`), not at any input's time. A republish built later on the
# clinical clock than the frame it repeats shows them moved — by exactly that clock's advance
# between the two frames, with these signs, which `_republish_drift` checks rather than masks. The
# clock runs while `remaining_sec` is a number: once an administration is charted it is None and
# `elapsed_sec` stops at the administration. Found by diffing every republish of the stage-`rules`
# run against the frame it repeats (2026-10-27); nothing else differed.
ANTIBIOTIC_CLOCK = ("meds", "antibiotic_clock")
CLOCKED = {(*ANTIBIOTIC_CLOCK, "elapsed_sec"): +1,      # now - recognized_at
           (*ANTIBIOTIC_CLOCK, "remaining_sec"): -1}    # deadline - now


async def _resolve_jwt(token):
    return JWTS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


def _record(what):
    return asdict(what) if is_dataclass(what) else what


class Frozen(datetime):
    now_value = FROZEN

    @classmethod
    def now(cls, tz=None):
        return cls.now_value


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _freeze(monkeypatch):
    """Every wall-clock read on the clinical path (see the module docstring): two runs must differ
    ONLY by the shadow lane."""
    Frozen.now_value = FROZEN               # a run that failed half-way must not leak its time
    for module in (app_module, board_module, clinical_module, identity_module):
        monkeypatch.setattr(module, "datetime", Frozen)
    monkeypatch.setattr(audit_module, "_now_iso", lambda: Frozen.now_value.isoformat())
    monkeypatch.setattr(notify_module, "_now_iso", lambda: Frozen.now_value.isoformat())


def _encounter(pid, location="YB^1^1"):
    # parse_fhir_encounter refuses an empty meta.source; lastUpdated pins the identity's time.
    return {"resourceType": "Encounter", "status": "in-progress",
            "subject": {"reference": f"Patient/{pid}"},
            "meta": {"source": "comed", "lastUpdated": FROZEN.isoformat()},
            "location": [{"location": {"display": location}}]}


def _shadow_body(now):
    readings = [("hr", 180, "bpm"), ("spo2", 70, "%"), ("respiration", 40, "/min"), ("art_systolic", 70, "mmHg")]
    # NBP 70/40 (50), with the time its value changed: hypotension, were it clinical.
    nbp = [("nbp_systolic", 70), ("nbp_diastolic", 40), ("nbp_mean", 50)]
    return {"schema": "homunculus.infinity-shadow.v2", "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "status": "streaming",
                         "packet_age_ms": 100,
                         "readings": [{"parameter": p, "value": v, "unit": u, "valid": True, "captured_at": now - 0.5}
                                      for p, v, u in readings]
                                     + [{"parameter": p, "value": v, "unit": "mmHg", "valid": True,
                                         "captured_at": now - 0.5, "changed_at": now - 30.0} for p, v in nbp]}]}


def _settings(stage, table):
    """The lane's switch for one run: `off`; Aşama A's `shadow` (the strip); Aşama B's `rules` (the
    strip and the shadow engine it feeds, with the default allowlist)."""
    if stage == "off":
        return ShadowSettings(table_path=str(table))
    if stage == "shadow":
        return ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(table))
    assert stage == "rules", stage
    return ShadowSettings("rules", "rules", None, SHADOW, HOSPITAL, str(table), parameters=DEFAULT_PARAMETERS)


async def _run(monkeypatch, tmp_path, *, stage, extra_ingest=False, probe=None):
    _freeze(monkeypatch)
    table = tmp_path / f"{stage}-{extra_ingest}-table.json"
    table.write_text(json.dumps(TABLE), encoding="utf-8")
    settings = _settings(stage, table)
    bedmap = BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")})
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    lane = {"t": 1_800_000_000.0}           # the lane's own clock: advanced 2 s per shadow step
    app = create_app({TOKEN: HOSPITAL}, escalate_after=timedelta(minutes=5), run_escalation_loop=False,
                     audit=audit, identities=identities, bedmap=bedmap, shadow=settings,
                     shadow_clock=lambda: lane["t"], resolve_jwt=_resolve_jwt, resolve_scope=_resolve_scope)
    # Everything the board stream and the notification hub are ever handed, for any tenant and any
    # audience — not what one subscriber happens to receive.
    published = {"frames": [], "notes": []}
    # The indices in `frames` of the frames published INSIDE a shadow step: none below `rules`; with
    # it, the sampler's republishes of a linked patient's card (a sample taken, a link started).
    step_frames: list[int] = []
    frame_at: list[str] = []                 # the clinical clock's instant each frame was published at
    broadcaster, hub = app.state.broadcaster, app.state.notification_hub
    board_publish, note_publish = broadcaster.publish, hub.publish

    async def board_spy(tenant, message):
        published["frames"].append(json.dumps([tenant, _record(message)], sort_keys=True, default=str))
        frame_at.append(Frozen.now_value.isoformat())
        await board_publish(tenant, message)

    async def note_spy(tenant, note):
        published["notes"].append(json.dumps([tenant, _record(note)], sort_keys=True, default=str))
        await note_publish(tenant, note)

    monkeypatch.setattr(broadcaster, "publish", board_spy)
    monkeypatch.setattr(hub, "publish", note_spy)
    seen = {"patients": [], "alerts": [], **{f"patients {jwt}": [] for jwt in JWTS},
            **{f"alerts {jwt}": [] for jwt in JWTS}}
    hdr = {"Authorization": f"Bearer {TOKEN}"}
    events = load_scenario(SCEN / "septic_shock.yaml") + load_scenario(SCEN / "news2_deterioration.yaml")
    pid = events[0][1]["subject"]["reference"].split("/", 1)[1]
    other = events[-1][1]["subject"]["reference"].split("/", 1)[1]      # the NEWS2 scenario's patient
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        async def shadow_step():
            before = len(published["frames"])
            if stage != "off":
                lane["t"] += 2.0                 # past the lane's 1 s spacing, no sleeping
                body = _shadow_body(lane["t"])
                posted = await c.post("/infinity-shadow/readings", json=body,
                                      headers={"Authorization": f"Bearer {SHADOW}"})
                board = await c.get("/infinity-shadow/board", headers=hdr)
                if probe is not None:
                    probe.setdefault("posts", []).append(posted.status_code)
                    probe["board"] = board.json()
            step_frames.extend(range(before, len(published["frames"])))

        async def observe():
            patients = (await c.get("/patients", headers=hdr)).json()
            seen["patients"].append(json.dumps(patients, sort_keys=True))
            if probe is not None:          # the cards of the last /patients answer that carried a shadow
                probe["shadow_cards"] = [card["shadow"] for card in patients["patients"] if card.get("shadow")]
            seen["alerts"].append(json.dumps((await c.get(f"/alerts/{pid}", headers=hdr)).json(), sort_keys=True))
            for jwt in JWTS:
                bearer = {"Authorization": f"Bearer {jwt}"}
                seen[f"patients {jwt}"].append(json.dumps((await c.get("/patients", headers=bearer)).json(),
                                                          sort_keys=True))
                seen[f"alerts {jwt}"].append(json.dumps((await c.get(f"/alerts/{pid}", headers=bearer)).json(),
                                                        sort_keys=True))

        await shadow_step()
        assert (await c.post("/ingest", json=_encounter(pid), headers=hdr)).status_code == 200
        # A bed the map does not cover: every /patients counts a miss in both apps, so the
        # discovery counters compared below are not empty, and a shadow read that counted would show.
        assert (await c.post("/ingest", json=_encounter(other, "YB^9^9"), headers=hdr)).status_code == 200
        await shadow_step(); await observe()
        for _ts, fhir in events:
            assert (await c.post("/ingest", json=fhir, headers=hdr)).status_code == 200
            await shadow_step(); await observe()
        if extra_ingest:
            assert (await c.post("/ingest", json={**events[0][1], "code": {"coding": [{"code": "heart_rate"}]},
                                                  "valueQuantity": {"value": 180, "unit": "/min"}},
                                 headers=hdr)).status_code == 200
        charted = await c.post(f"/clinical/{pid}", json={"entries": [{"code": "suspected_infection", "value": 1}]},
                               headers=hdr)
        assert charted.status_code == 200, charted.text
        await shadow_step(); await observe()
        live = (await c.get(f"/alerts/{pid}", headers=hdr)).json()["alerts"]
        if live:
            await c.post("/ack", json={"patient_id": pid, "kind": live[0]["kind"], "role": "nurse"}, headers=hdr)
        await shadow_step(); await observe()
        for minutes in ESCALATION_MINUTES:
            Frozen.now_value = FROZEN + timedelta(minutes=minutes)
            await app.state.escalation_cycle(Frozen.now_value)
            await shadow_step(); await observe()
        Frozen.now_value = FROZEN
    store = app.state.ack_stores[HOSPITAL]
    return {
        **seen,
        **published,
        "escalated": sorted(store.escalated),
        "acks": sorted((k, v["by"]) for k, v in store.acks.items()),
        "first_seen": sorted((k, v.isoformat()) for k, v in store.first_seen.items()),
        "audit": [(r.tenant, r.event_type, r.patient_id, r.subject, json.dumps(r.payload, sort_keys=True))
                  for r in audit.records(tenant=HOSPITAL, limit=100_000)],
        "audit_count": len(audit.records(tenant=HOSPITAL, limit=100_000)),
        "chain_ok": verify_chain(audit.records(tenant=HOSPITAL, limit=100_000)),
        "unmatched": bedmap.unmatched(),
        "identity": identities.get(HOSPITAL, pid),
        "step_frames": step_frames,
        "frame_at": frame_at,
    }


def _strip(obj):
    """`obj` without the `shadow` key of a card (any dict that names a `patient_id`), at any depth:
    the one key Aşama B adds to what a clinician sees. Nothing else is taken out."""
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if not (k == "shadow" and "patient_id" in obj)}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


def _strip_json(text):
    return json.dumps(_strip(json.loads(text)), sort_keys=True)


def _clinical(run: dict) -> dict:
    """Everything a clinician, a notification or an auditor sees, minus what Aşama B is allowed to
    add: the `shadow` key on a card, the two shadow audit kinds, and the frames published inside a
    shadow step (the sampler's republishes — none below `rules`; `_republish_drift` holds them to
    their own test). The chain is compared by its verdict: its report counts the rows, and the
    shadow rows are rows. Nothing else is masked."""
    step = set(run["step_frames"])
    out = {key: value for key, value in run.items() if key != "step_frames"}
    out["frames"] = [_strip_json(f) for i, f in enumerate(run["frames"]) if i not in step]
    out["frame_at"] = [at for i, at in enumerate(run["frame_at"]) if i not in step]
    out["audit"] = [row for row in run["audit"] if row[1] not in SHADOW_KINDS]
    out["audit_count"] = len(out["audit"])
    out["chain_ok"] = run["chain_ok"].ok
    for key, value in run.items():
        if key in ("patients", "alerts") or key.startswith(("patients ", "alerts ")):
            out[key] = [_strip_json(v) for v in value]
    return out


def _get(card: dict, path: tuple[str, ...]):
    """The value at `path`; None when any step of it is absent or null."""
    for name in path:
        card = card.get(name) if isinstance(card, dict) else None
    return card


def _pop(card: dict, path: tuple[str, ...]):
    """Removes and returns the value at `path`; None when any step of it is absent or null."""
    *parents, leaf = path
    parent = _get(card, tuple(parents))
    return parent.pop(leaf, None) if isinstance(parent, dict) else None


def _republish_drift(run: dict) -> list[str]:
    """Every frame published inside a shadow step against the LATEST frame published for its patient
    outside one: stripped of `shadow`, the two must be equal — the sampler republishes the real
    card, it does not make one — except the CLOCKED keys, which must have moved by exactly the
    clinical clock's advance between the two frames. Returns what is not so (empty: all is)."""
    step, latest, problems = set(run["step_frames"]), {}, []
    for i, (frame, at) in enumerate(zip(run["frames"], run["frame_at"], strict=True)):
        tenant, card = json.loads(frame)
        key = (tenant, card.get("patient_id"))
        if i not in step:
            latest[key] = (frame, at)
            continue
        if key not in latest:
            problems.append(f"frame {i}: a republish of {key} with no real frame before it")
            continue
        prior_frame, prior_at = latest[key]
        prior, card = _strip(json.loads(prior_frame)[1]), _strip(card)
        moved = (datetime.fromisoformat(at) - datetime.fromisoformat(prior_at)).total_seconds()
        runs = _get(prior, (*ANTIBIOTIC_CLOCK, "remaining_sec")) is not None
        for path, sign in CLOCKED.items():
            before, after = _pop(prior, path), _pop(card, path)
            expected = None if before is None else before + (sign * moved if runs else 0)
            if after != expected:
                problems.append(f"frame {i}: {'.'.join(path)} {before} -> {after}, the clock moved {moved} s")
        if card != prior:
            problems.append(f"frame {i}: {key} is not the real card it repeats")
    return problems


@pytest.mark.anyio
async def test_every_clinical_output_is_identical_with_the_stage_on_or_off(monkeypatch, tmp_path):
    off = await _run(monkeypatch, tmp_path, stage="off")
    on = await _run(monkeypatch, tmp_path, stage="shadow")
    # Not vacuous: the scenario raised alerts, escalated, notified, acknowledged and was audited; the
    # scoped nurse sees less than the unrestricted one; escalation happened at a cycle in between.
    assert len(off["audit"]) > 0 and len(off["frames"]) > 0 and len(off["notes"]) > 0
    assert off["escalated"] and off["acks"] and off["first_seen"] and off["identity"] is not None
    assert off["unmatched"] and off["chain_ok"].ok
    assert off["patients scoped-jwt"] != off["patients nurse-jwt"]
    assert any(row[1] == "escalation" for row in off["audit"])
    for key in off:
        assert on[key] == off[key], key


@pytest.mark.anyio
async def test_the_shadow_lane_actually_ran_in_the_on_app(monkeypatch, tmp_path):
    # Guards against a B that silently ran as off: the readings must have been taken and placed.
    probe: dict = {}
    await _run(monkeypatch, tmp_path, stage="shadow", probe=probe)
    assert probe["posts"] and set(probe["posts"]) == {200}
    board = probe["board"]
    assert board["stage"] == "shadow" and board["table"]["status"] == "ok"
    (bed,) = board["beds"]
    assert (bed["bed_label"], bed["link"], bed["patient_id"]) == ("B-1", "one", "bed-3")
    values = {p["parameter"]: (p["state"], p.get("value")) for p in bed["parameters"]}
    assert values["hr"] == ("value", 180) and values["spo2"] == ("value", 70)
    nbp = bed["parameters"][-1]
    assert (nbp["parameter"], nbp["state"], nbp["systolic"], nbp["diastolic"], nbp["mean"]) == ("nbp", "value", 70, 40, 50)


@pytest.mark.anyio
async def test_the_harness_sees_a_real_clinical_difference(monkeypatch, tmp_path):
    off = await _run(monkeypatch, tmp_path, stage="off")
    changed = await _run(monkeypatch, tmp_path, stage="off", extra_ingest=True)
    assert changed["patients"] != off["patients"]
    assert changed["audit"] != off["audit"]
    assert changed["frames"] != off["frames"]


# --- Aşama B: the stage `rules` (D11) ------------------------------------------------------------

@pytest.mark.anyio
async def test_every_clinical_output_is_identical_with_the_stage_rules(monkeypatch, tmp_path):
    off = await _run(monkeypatch, tmp_path, stage="off")
    rules = await _run(monkeypatch, tmp_path, stage="rules")
    # Not vacuous: the shadow engine opened findings and the sampler republished cards; below
    # `rules` nothing is published inside a shadow step. Both chains hold, not merely agree.
    assert off["step_frames"] == [] and rules["step_frames"]
    assert any(row[1] == "shadow_alert" for row in rules["audit"])
    assert off["chain_ok"].ok and rules["chain_ok"].ok
    clinical_off, clinical_rules = _clinical(off), _clinical(rules)
    assert clinical_rules.keys() == clinical_off.keys()
    for key in clinical_off:
        assert clinical_rules[key] == clinical_off[key], key
    # The frames taken out above, on their own terms: each is the real card it repeats.
    assert _republish_drift(rules) == []


@pytest.mark.anyio
async def test_the_stage_rules_actually_fed_the_shadow_engine(monkeypatch, tmp_path):
    # Guards against a third run that silently ran as `shadow`: samples were taken from the strip,
    # the shadow engine judged them, and the card and the audit carry what it found.
    probe: dict = {}
    run = await _run(monkeypatch, tmp_path, stage="rules", probe=probe)
    assert probe["posts"] and set(probe["posts"]) == {200}
    board = probe["board"]
    assert board["stage"] == "rules" and board["feed"]["rules_state"] == "ok"
    (bed,) = board["beds"]
    assert (bed["link"], bed["patient_id"]) == ("one", "bed-3")
    pictures = probe["shadow_cards"]           # the last /patients answer's non-null `shadow` keys
    assert any(p["vitals"] and p["findings"] for p in pictures), pictures
    assert all(v["source"].startswith("infinity:192.0.2.10:") for p in pictures for v in p["vitals"].values())
    assert any(row[1] == "shadow_alert" for row in run["audit"])
    assert any(json.loads(run["frames"][i])[1].get("shadow") for i in run["step_frames"])


@pytest.mark.anyio
async def test_the_rules_comparison_sees_a_real_clinical_difference(monkeypatch, tmp_path):
    # The negative control for `_clinical`: what it takes out must not blind it to a clinical change.
    rules = _clinical(await _run(monkeypatch, tmp_path, stage="rules"))
    changed = _clinical(await _run(monkeypatch, tmp_path, stage="rules", extra_ingest=True))
    assert changed["patients"] != rules["patients"]
    assert changed["audit"] != rules["audit"]
    assert changed["frames"] != rules["frames"]
