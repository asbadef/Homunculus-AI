"""G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D2–D3): the last-seen ledger through the two routes.

POST /infinity-shadow/readings notes what the store holds after each accepted body; GET
/infinity-shadow/board carries it, additively — `watching_since`, `stale_list_after_s`, `vanished`
and, on each card, `last_packet_at`, `silent_for_s`, `channels_seen` — scoped as the cards are. A
ledger that fails never refuses a body. Synthetic addresses and ids only.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.infinity_shadow import LEDGER_KEEP_S, SCHEMA, ShadowSettings
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.scope import Scope, ScopeReason
from homunculus.tenant.bedmap import BedMap, BedRef

HOSPITAL, DEVICE, SHADOW = "HOSP1", "tok-device-00000000000000000000000000", "s" * 40
T0 = 1_800_000_000.0
WHEN = datetime(2027, 1, 15, 7, 0, tzinfo=timezone.utc)
TABLE = {
    "schema": "homunculus.infinity-device-beds.v1", "version": 3, "site": "synthetic",
    "approved_by": "test", "approved_at": "2026-07-14",
    "devices": [
        {"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "bed_label": "B-1",
         "bed_id": "bed-b1", "unit_id": "unit-1", "method": "monitor_screen", "verified_at": "2026-07-14",
         "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
        {"source": "192.0.2.11", "group": "239.20.1.11", "port": 2050, "bed_label": "B-2",
         "bed_id": "bed-b2", "unit_id": "unit-2", "method": "central_station_list",
         "verified_at": "2026-07-14", "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
    ],
}
CALLERS = {
    "nurse-jwt": Caller(hospital=HOSPITAL, actor="synth-n1", groups=("nurse",), perms=frozenset({"board.view"})),
    "scoped-jwt": Caller(hospital=HOSPITAL, actor="synth-n2", groups=("nurse",), perms=frozenset({"board.view"})),
    "biomed-jwt": Caller(hospital=HOSPITAL, actor="synth-b1", groups=("biomedical",),
                         perms=frozenset({"devices.manage"})),
}
SCOPES = {"scoped-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"unit-1"}))}
EVERYONE = ("192.0.2.10", "192.0.2.11", "192.0.2.13")          # .13: not in the table
NEW_CARD = {"last_packet_at", "silent_for_s", "channels_seen"}
NEW_TOP = {"watching_since", "stale_list_after_s", "stale_list_until_s", "vanished"}
VANISHED_KEYS = {"source", "bed_label", "last_packet_at", "last_report_at"}


async def _resolve_jwt(token):
    return CALLERS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _app(tmp_path, *, identities=None):
    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(TABLE), encoding="utf-8")
    clock = Clock()
    app = create_app({DEVICE: HOSPITAL}, run_escalation_loop=False, resolve_jwt=_resolve_jwt,
                     resolve_scope=_resolve_scope,
                     shadow=ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(path)),
                     shadow_clock=clock, bedmap=BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")}),
                     identities=identities if identities is not None else InMemoryIdentityStore())
    return TestClient(app), clock


def _device(source, *, now=T0, status="streaming", packet_age_ms=120.0, hr=True):
    readings = ([{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True, "captured_at": now - 0.4}]
                if hr else [])
    return {"source": source, "group": "239.20.1." + source.rsplit(".", 1)[1], "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": readings}


def _post(client, clock, *devices):
    body = {"schema": SCHEMA, "sent_at": clock.t,
            "forwarder": {"interval_s": 5, "sent": 3, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 10, "old_or_duplicate_packets": 0},
            "devices": list(devices)}
    response = client.post("/infinity-shadow/readings", json=body, headers={"Authorization": f"Bearer {SHADOW}"})
    assert response.status_code == 200, response.text
    return response.json()


def _board(client, token="biomed-jwt"):
    response = client.get("/infinity-shadow/board", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return response.json()


def _cards(board):
    return {card["source"]: card for card in board["beds"] + board["unassigned"]}


def _ward(client, clock, gone=()):
    """The three monitors at T0, then a post every 5 s to T0 + 20 without the ones in `gone`: past
    SILENT_AFTER_S, so those are `unknown`, and the hub no longer lists them."""
    _post(client, clock, *(_device(source) for source in EVERYONE))
    for step in (5, 10, 15, 20):
        clock.t = T0 + step
        _post(client, clock, *(_device(source, now=clock.t) for source in EVERYONE if source not in gone))


def test_the_board_keeps_every_field_it_had_and_adds_the_ledgers(tmp_path):
    client, clock = _app(tmp_path)
    _post(client, clock, _device("192.0.2.10"), _device("192.0.2.13"))
    clock.t = T0 + 2
    board = _board(client)
    assert set(board) == {"stage", "display_max_age_s", "generated_at", "table", "feed", "beds", "unassigned"} | NEW_TOP
    assert (board["watching_since"], board["stale_list_after_s"], board["stale_list_until_s"], board["vanished"]) == (
        _iso(T0), 60.0, 3600.0, [])
    one = _cards(board)["192.0.2.10"]
    assert (one["last_packet_at"], one["silent_for_s"]) == (_iso(T0 - 0.12), None)
    assert one["channels_seen"] == [{"parameter": "hr", "last_value_at": _iso(T0 - 0.4)}]
    assert NEW_CARD <= set(_cards(board)["192.0.2.13"])                     # an unassigned card too


def test_silent_for_counts_whole_seconds_from_the_last_packet_for_a_silent_or_unknown_monitor_only(tmp_path):
    client, clock = _app(tmp_path)
    _post(client, clock, _device("192.0.2.10", status="stale", packet_age_ms=42_000.0, hr=False),
          _device("192.0.2.11"))
    clock.t = T0 + 3.5
    cards = _cards(_board(client))
    assert (cards["192.0.2.10"]["status"], cards["192.0.2.10"]["silent_for_s"]) == ("silent", 45)
    assert cards["192.0.2.10"]["last_packet_at"] == _iso(T0 - 42.0)
    assert cards["192.0.2.11"]["silent_for_s"] is None
    clock.t = T0 + 20                                   # no post since T0: both unknown
    board = _board(client)
    cards = _cards(board)
    assert (cards["192.0.2.10"]["status"], cards["192.0.2.10"]["silent_for_s"]) == ("unknown", 62)
    assert (cards["192.0.2.11"]["status"], cards["192.0.2.11"]["silent_for_s"]) == ("unknown", 20)
    assert board["vanished"] == []                      # the forwarder's silence, not the monitors' own


def test_a_monitor_the_hub_stops_listing_is_vanished_for_24_hours_then_dropped(tmp_path):
    client, clock = _app(tmp_path)
    _ward(client, clock, gone=("192.0.2.11",))
    board = _board(client)
    assert board["vanished"] == [{"source": "192.0.2.11", "bed_label": "B-2",
                                  "last_packet_at": _iso(T0 - 0.12), "last_report_at": _iso(T0)}]
    gone = _cards(board)["192.0.2.11"]
    assert (gone["status"], gone["silent_for_s"]) == ("unknown", 20)        # still a card: the store keeps it
    clock.t = T0 + LEDGER_KEEP_S
    assert [v["source"] for v in _board(client)["vanished"]] == ["192.0.2.11"]  # 24 h to the second: kept
    clock.t = T0 + LEDGER_KEEP_S + 1
    board = _board(client)
    assert board["vanished"] == []
    gone = _cards(board)["192.0.2.11"]
    assert (gone["status"], gone["last_packet_at"], gone["silent_for_s"], gone["channels_seen"]) == (
        "unknown", None, None, [])


def test_a_scoped_viewer_gets_only_its_beds_devices_and_vanished_rows(tmp_path):
    client, clock = _app(tmp_path)
    _ward(client, clock, gone=EVERYONE)
    scoped = _board(client, "scoped-jwt")               # unit-1: B-1 only, and no unassigned device
    assert [c["source"] for c in scoped["beds"]] == ["192.0.2.10"] and scoped["unassigned"] == []
    assert [v["source"] for v in scoped["vanished"]] == ["192.0.2.10"]
    everyone = _board(client, "biomed-jwt")
    assert [(v["source"], v["bed_label"]) for v in everyone["vanished"]] == [
        ("192.0.2.10", "B-1"), ("192.0.2.11", "B-2"), ("192.0.2.13", None)]


def test_devices_manage_sees_every_device_and_the_new_fields_name_no_patient(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="synth-p1", unit="YB", room="1", bed="1",
                                              state="admitted", source="test", updated_at=WHEN))
    client, clock = _app(tmp_path, identities=identities)
    _ward(client, clock, gone=("192.0.2.10",))
    board = _board(client, "biomed-jwt")
    assert "synth-p1" not in json.dumps(board)
    assert [set(v) for v in board["vanished"]] == [VANISHED_KEYS]
    for card in _cards(board).values():
        assert NEW_CARD <= set(card)
        assert all(set(ch) == {"parameter", "last_value_at"} for ch in card["channels_seen"])
    nurse = _board(client, "nurse-jwt")                 # board.view: the card's own link, as before
    assert _cards(nurse)["192.0.2.10"]["patient_id"] == "synth-p1"
    assert [set(v) for v in nurse["vanished"]] == [VANISHED_KEYS]


def test_a_ledger_that_fails_never_refuses_an_accepted_body(tmp_path, monkeypatch, caplog):
    client, clock = _app(tmp_path)

    def boom(views, reported):
        raise RuntimeError("synthetic ledger failure")

    monkeypatch.setattr(client.app.state.shadow_ledger, "observe", boom)
    assert _post(client, clock, _device("192.0.2.10"))["accepted"] == 1
    assert _cards(_board(client))["192.0.2.10"]["status"] == "streaming"
    assert "ledger" in caplog.text


# --- review fixes --------------------------------------------------------------------------------

def test_a_ledger_that_cannot_be_read_leaves_the_board_as_it_was_for_every_viewer(tmp_path, monkeypatch, caplog):
    # Review 1: the nurses' strip, the biomedical page and /infinity-waves all read this board; a ledger
    # that fails costs them only the new fields.
    client, clock = _app(tmp_path)
    _post(client, clock, _device("192.0.2.10"), _device("192.0.2.13"))

    def boom():
        raise RuntimeError("synthetic ledger failure")

    monkeypatch.setattr(client.app.state.shadow_ledger, "view", boom)
    for token in ("nurse-jwt", "biomed-jwt"):           # board.view, devices.manage
        board = _board(client, token)
        assert set(board) == {"stage", "display_max_age_s", "generated_at", "table", "feed", "beds", "unassigned"}
        assert all(not NEW_CARD & set(card) for card in _cards(board).values())
        assert _cards(board)["192.0.2.10"]["status"] == "streaming"
    assert "ledger" in caplog.text
