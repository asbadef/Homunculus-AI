"""Aşama A's two routes: the forwarder's POST and the board's GET.

`POST /infinity-shadow/readings` takes the hub forwarder's dedicated token and nothing else — not
a TENANTS device token, not a clinician's JWT. `GET /infinity-shadow/board` answers `board.view`
or `devices.manage` (and the device token, as every board route does), scoped card by card, and
links a monitor to a patient only through an explicit binding: exactly one admitted identity
whose bed-map bed is the table row's `bed_id`. Synthetic addresses and ids only.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.infinity_shadow import SCHEMA, ShadowSettings, shadow_settings_from_env
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.scope import Scope, ScopeReason
from homunculus.tenant.bedmap import BedMap, BedRef

HOSPITAL = "HOSP1"
DEVICE = "tok-device-00000000000000000000000000"
SHADOW = "s" * 40
T0 = 1_800_000_000.0
WHEN = datetime(2027, 1, 15, 7, 0, tzinfo=timezone.utc)

TABLE = {
    "schema": "homunculus.infinity-device-beds.v1", "version": 7, "site": "synthetic",
    "approved_by": "test", "approved_at": "2026-07-14",
    "devices": [
        {"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "bed_label": "B-1",
         "bed_id": "bed-b1", "unit_id": "unit-1", "method": "monitor_screen", "verified_at": "2026-07-14",
         "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
        {"source": "192.0.2.11", "group": "239.20.1.11", "port": 2050, "bed_label": "B-2",
         "bed_id": "bed-b2", "unit_id": "unit-2", "method": "central_station_list",
         "verified_at": "2026-07-14", "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
        {"source": "192.0.2.12", "group": "239.20.1.12", "port": 2050, "bed_label": None,
         "bed_id": None, "unit_id": None, "method": None, "verified_at": None,
         "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": "unresolved: two lists disagree"},
        {"source": "192.0.2.14", "group": "239.20.1.14", "port": 2050, "bed_label": "B-4",
         "bed_id": None, "unit_id": None, "method": "both", "verified_at": "2026-07-14",
         "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""},
    ],
}
SOURCES = ("192.0.2.10", "192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.14")   # .13: not in the table

CALLERS = {
    "nurse-jwt": Caller(hospital=HOSPITAL, actor="ayse", groups=("nurse",), perms=frozenset({"board.view"})),
    "scoped-jwt": Caller(hospital=HOSPITAL, actor="elif", groups=("nurse",), perms=frozenset({"board.view"})),
    "bedscoped-jwt": Caller(hospital=HOSPITAL, actor="zeynep", groups=("nurse",), perms=frozenset({"board.view"})),
    "biomed-jwt": Caller(hospital=HOSPITAL, actor="ahmet", groups=("biomedical",),
                         perms=frozenset({"devices.manage"})),
    "none-jwt": Caller(hospital=HOSPITAL, actor="synth-none"),
    "elsewhere-jwt": Caller(hospital="HOSP2", actor="x", groups=("nurse",), perms=frozenset({"board.view"})),
}
SCOPES = {
    "scoped-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"unit-1"})),
    "bedscoped-jwt": Scope(False, ScopeReason.ASSIGNED, bed_ids=frozenset({"bed-b2"})),
}


async def _resolve_jwt(token):
    return CALLERS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _record(pid, bed="1", state="admitted"):
    return IdentityRecord(patient_id=pid, unit="YB", room="1", bed=bed, state=state, source="test",
                          updated_at=WHEN)


def _app(tmp_path, *, settings=None, table=TABLE, identities=None, bedmap=None):
    path = tmp_path / "device-beds.json"
    if table is not None:
        path.write_text(json.dumps(table), encoding="utf-8")
    if settings is None:
        settings = ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(path))
    clock = Clock()
    bedmap = bedmap if bedmap is not None else BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1"),
                                                       "YB^1^2": BedRef("bed-b2", "unit-2", "B-2")})
    app = create_app({DEVICE: HOSPITAL}, run_escalation_loop=False, resolve_jwt=_resolve_jwt,
                     resolve_scope=_resolve_scope, shadow=settings, shadow_clock=clock, bedmap=bedmap,
                     identities=identities if identities is not None else InMemoryIdentityStore())
    return TestClient(app), clock, bedmap


def _body(now, sources=SOURCES):
    return {"schema": SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 3, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 10, "old_or_duplicate_packets": 0},
            "devices": [{"source": s, "group": "239.20.1." + s.rsplit(".", 1)[1], "port": 2050,
                         "status": "streaming", "packet_age_ms": 120.0,
                         "readings": [{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True,
                                       "captured_at": now - 0.4},
                                      {"parameter": "spo2", "value": None, "unit": "%", "valid": False,
                                       "captured_at": now - 0.4}]}
                        for s in sources]}


def _post(client, clock, token=SHADOW, body=None):
    return client.post("/infinity-shadow/readings", json=body if body is not None else _body(clock.t),
                       headers=_hdr(token))


def _board(client, token="nurse-jwt"):
    response = client.get("/infinity-shadow/board", headers=_hdr(token))
    assert response.status_code == 200, response.text
    return response.json()


# --- POST ------------------------------------------------------------------------------------------

def test_a_post_with_the_stage_off_is_409(tmp_path):
    for settings in (ShadowSettings(), shadow_settings_from_env(
            {"INFINITY_CLINICAL_STAGE": "shadow", "INFINITY_SHADOW_TOKEN": "short",
             "INFINITY_SHADOW_HOSPITAL": HOSPITAL}, {DEVICE: HOSPITAL})):
        client, clock, _ = _app(tmp_path, settings=settings)
        response = _post(client, clock)
        assert response.status_code == 409 and response.json()["detail"] == {"reason": "stage_off"}


@pytest.mark.parametrize("token", [None, "", "wrong-" + "x" * 40, DEVICE, "nurse-jwt"])
def test_a_post_without_the_shadow_token_is_401_even_with_a_tenants_token(tmp_path, token):
    client, clock, _ = _app(tmp_path)
    headers = {} if token is None else _hdr(token)
    response = client.post("/infinity-shadow/readings", json=_body(clock.t), headers=headers)
    assert response.status_code == 401
    assert _board(client)["feed"]["state"] == "never"            # nothing was taken


def test_an_empty_credential_never_opens_the_lane_even_around_the_settings_check(tmp_path):
    # ShadowSettings refuses an "on" stage without a strong token; the route checks again, so a
    # settings object that got round that (built with object.__new__) still cannot take a POST
    # with no credential: compare_digest(b"", b"") is True.
    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(TABLE), encoding="utf-8")
    hollow = object.__new__(ShadowSettings)
    for name, value in dict(stage="shadow", configured="shadow", problem=None, token="",
                            hospital=HOSPITAL, table_path=str(path)).items():
        object.__setattr__(hollow, name, value)
    client, clock, _ = _app(tmp_path, settings=hollow)
    for headers in ({}, {"Authorization": "Bearer "}, {"Authorization": ""}):
        response = client.post("/infinity-shadow/readings", json=_body(clock.t), headers=headers)
        assert response.status_code in (401, 409), headers
        assert response.status_code != 200


def test_the_route_stops_reading_a_body_once_it_is_over_64_kib(tmp_path):
    # Driven at the ASGI level, so the test can count what the route takes from the wire: a body
    # with no Content-Length is counted chunk by chunk and refused at the limit, not read whole.
    import asyncio

    client, _, _ = _app(tmp_path)
    taken = {"chunks": 0}
    chunk = b" " * 8192

    async def receive():
        taken["chunks"] += 1
        return {"type": "http.request", "body": chunk, "more_body": taken["chunks"] < 40}

    sent = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": "/infinity-shadow/readings", "raw_path": b"/infinity-shadow/readings",
             "query_string": b"", "root_path": "", "server": ("t", 80), "client": ("192.0.2.200", 1),
             "headers": [(b"authorization", f"Bearer {SHADOW}".encode()), (b"content-type", b"application/json"),
                         (b"transfer-encoding", b"chunked")]}
    asyncio.run(client.app(scope, receive, send))
    assert sent[0]["status"] == 413
    assert taken["chunks"] <= 9                     # 64 KiB of 8 KiB chunks, and the one that crossed


def test_a_chunked_body_over_64_kib_is_413(tmp_path):
    client, clock, _ = _app(tmp_path)
    chunk = b" " * 8192

    def chunks():                                   # no Content-Length: Transfer-Encoding: chunked
        yield json.dumps(_body(clock.t)).encode()[:-1]
        for _ in range(10):
            yield chunk
        yield b"}"

    response = client.post("/infinity-shadow/readings", content=chunks(),
                           headers={**_hdr(SHADOW), "Content-Type": "application/json"})
    assert response.status_code == 413
    assert _board(client)["feed"]["state"] == "never"

    def small():
        yield json.dumps(_body(clock.t)).encode()

    assert client.post("/infinity-shadow/readings", content=small(),
                       headers={**_hdr(SHADOW), "Content-Type": "application/json"}).status_code == 200


def test_a_post_over_64_kib_is_413(tmp_path):
    client, clock, _ = _app(tmp_path)
    big = json.dumps({**_body(clock.t), "pad": "x" * (65 * 1024)}).encode()
    response = client.post("/infinity-shadow/readings", content=big,
                           headers={**_hdr(SHADOW), "Content-Type": "application/json"})
    assert response.status_code == 413


@pytest.mark.parametrize("content", [b"{not json", b"[]", b'{"schema": "x"}', b"NaN",
                                     json.dumps({**_body(T0), "patient_id": "p1"}).encode()])
def test_a_malformed_body_is_400(tmp_path, content):
    client, _, _ = _app(tmp_path)
    response = client.post("/infinity-shadow/readings", content=content,
                           headers={**_hdr(SHADOW), "Content-Type": "application/json"})
    assert response.status_code == 400 and response.json()["detail"] == {"reason": "rejected"}


def test_a_second_post_within_one_second_is_429(tmp_path):
    client, clock, _ = _app(tmp_path)
    assert _post(client, clock).status_code == 200
    clock.t += 0.5
    response = _post(client, clock)
    assert response.status_code == 429 and response.json()["detail"] == {"reason": "too_soon"}


def test_a_valid_post_is_200_with_its_counts(tmp_path):
    client, clock, _ = _app(tmp_path)
    response = _post(client, clock)
    assert response.status_code == 200
    assert response.json() == {"accepted": 10, "rejected": {"too_old": 0, "clock": 0, "unit": 0, "range": 0,
                                                            "unknown_parameter": 0, "duplicate": 0}}


# --- GET -------------------------------------------------------------------------------------------

def test_the_board_with_the_stage_off_is_exactly_stage_off(tmp_path):
    client, _, _ = _app(tmp_path, settings=ShadowSettings())
    assert _board(client) == {"stage": "off"}


def test_the_board_names_a_configuration_problem(tmp_path):
    settings = shadow_settings_from_env({"INFINITY_CLINICAL_STAGE": "shadow", "INFINITY_SHADOW_TOKEN": "w" * 31,
                                         "INFINITY_SHADOW_HOSPITAL": HOSPITAL}, {DEVICE: HOSPITAL})
    client, _, _ = _app(tmp_path, settings=settings)
    assert _board(client) == {"stage": "off", "configured_stage": "shadow", "problem": "token_weak"}


def test_the_board_needs_a_credential_and_a_permission(tmp_path):
    client, _, _ = _app(tmp_path)
    assert client.get("/infinity-shadow/board").status_code == 401
    assert client.get("/infinity-shadow/board", headers=_hdr(SHADOW)).status_code == 401   # the lane's key
    response = client.get("/infinity-shadow/board", headers=_hdr("none-jwt"))
    assert response.status_code == 403
    assert response.json()["detail"] == "permission required: board.view or devices.manage"


@pytest.mark.parametrize("token", ["nurse-jwt", "biomed-jwt", DEVICE])
def test_the_board_opens_for_board_view_devices_manage_and_the_device_token(tmp_path, token):
    client, _, _ = _app(tmp_path)
    assert _board(client, token)["stage"] == "shadow"


def test_another_hospitals_caller_sees_the_stage_off(tmp_path):
    client, clock, _ = _app(tmp_path)
    _post(client, clock)
    assert _board(client, "elsewhere-jwt") == {"stage": "off"}


# --- placement -------------------------------------------------------------------------------------

def test_a_device_sits_on_its_table_bed_and_the_rest_are_unassigned_cards(tmp_path):
    client, clock, _ = _app(tmp_path)
    _post(client, clock)
    board = _board(client)
    assert [(b["bed_label"], b["source"]) for b in board["beds"]] == [
        ("B-1", "192.0.2.10"), ("B-2", "192.0.2.11"), ("B-4", "192.0.2.14")]
    one = board["beds"][0]
    assert (one["bed_id"], one["unit_id"], one["status"], one["link"]) == ("bed-b1", "unit-1", "streaming", "none")
    assert [(u["source"], u["reason"]) for u in board["unassigned"]] == [
        ("192.0.2.12", "table_unassigned"), ("192.0.2.13", "not_in_table")]
    assert board["unassigned"][0]["note"] == "unresolved: two lists disagree"
    assert board["feed"]["unassigned"] == 2 and board["feed"]["devices"]["total"] == 5


@pytest.mark.parametrize(("table", "status"), [(None, "missing"), ({**TABLE, "approved_by": ""}, "invalid")])
def test_without_a_valid_table_every_device_is_unassigned(tmp_path, table, status):
    client, clock, _ = _app(tmp_path, table=table)
    _post(client, clock)
    board = _board(client)
    assert board["beds"] == [] and board["table"]["status"] == status and board["table"]["reason"]
    assert {u["source"] for u in board["unassigned"]} == set(SOURCES)
    assert {u["reason"] for u in board["unassigned"]} == {f"table_{status}"}


# --- the patient link ------------------------------------------------------------------------------

def test_one_admitted_identity_on_the_rows_bed_links_the_monitor_to_it(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _record("p1"))
    client, clock, _ = _app(tmp_path, identities=identities)
    _post(client, clock)
    beds = {b["bed_label"]: b for b in _board(client)["beds"]}
    assert (beds["B-1"]["link"], beds["B-1"]["patient_id"]) == ("one", "p1")
    assert (beds["B-2"]["link"], beds["B-2"]["patient_id"]) == ("none", None)
    assert (beds["B-4"]["link"], beds["B-4"]["patient_id"]) == ("none", None)       # no bed_id: no binding


def test_two_admitted_identities_on_one_bed_are_ambiguous_and_name_no_one(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _record("p1"))
    identities.apply(HOSPITAL, _record("p2"))
    client, clock, _ = _app(tmp_path, identities=identities)
    _post(client, clock)
    b1 = _board(client)["beds"][0]
    assert (b1["link"], b1["patient_id"], b1["link_reason"]) == ("ambiguous", None, "two_patients")


def test_a_discharged_identity_never_links(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _record("p1", state="discharged"))
    client, clock, _ = _app(tmp_path, identities=identities)
    _post(client, clock)
    b1 = _board(client)["beds"][0]
    assert (b1["link"], b1["patient_id"]) == ("none", None)


def test_a_devices_manage_caller_without_board_view_never_sees_a_patient(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _record("p1"))
    client, clock, _ = _app(tmp_path, identities=identities)
    _post(client, clock)
    board = _board(client, "biomed-jwt")
    assert {(b["link"], b["patient_id"]) for b in board["beds"]} == {("hidden", None)}
    assert "p1" not in json.dumps(board)
    assert len(board["unassigned"]) == 2


def test_fifty_board_reads_leave_the_discovery_counter_unchanged(tmp_path):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, _record("p1"))
    identities.apply(HOSPITAL, _record("p9", bed="9"))                # a bed the map does not cover
    client, clock, bedmap = _app(tmp_path, identities=identities)
    _post(client, clock)
    before = bedmap.unmatched()
    for _ in range(50):
        clock.t += 11                                                 # past the 10 s occupancy cache
        _board(client)
    assert bedmap.unmatched() == before == {}


# --- scope -----------------------------------------------------------------------------------------

@pytest.mark.parametrize(("token", "labels"), [("scoped-jwt", ["B-1"]), ("bedscoped-jwt", ["B-2"])])
def test_a_scoped_caller_sees_only_in_scope_beds_and_no_unassigned_device(tmp_path, token, labels):
    client, clock, _ = _app(tmp_path)
    _post(client, clock)
    board = _board(client, token)
    assert [b["bed_label"] for b in board["beds"]] == labels          # B-4 (no bed, no unit) hidden
    assert board["unassigned"] == [] and board["feed"]["unassigned"] == 0
    assert board["feed"]["devices"]["total"] == 1


def test_unrestricted_and_devices_manage_callers_see_every_device(tmp_path):
    client, clock, _ = _app(tmp_path)
    _post(client, clock)
    for token in ("nurse-jwt", "biomed-jwt", DEVICE):
        board = _board(client, token)
        assert len(board["beds"]) == 3 and len(board["unassigned"]) == 2


# --- the body --------------------------------------------------------------------------------------

def test_the_board_body_carries_evidence_state_ages_the_table_and_the_feed(tmp_path):
    client, clock, _ = _app(tmp_path)
    _post(client, clock)
    clock.t += 2.0
    board = _board(client)
    assert board["stage"] == "shadow" and board["display_max_age_s"] == 15
    assert board["generated_at"].startswith("2027-01-15T08:00:02")
    raw = (tmp_path / "device-beds.json").read_bytes()
    assert board["table"] == {"status": "ok", "reason": None, "version": 7,
                              "sha256": hashlib.sha256(raw).hexdigest(), "approved_at": "2026-07-14",
                              "site": "synthetic"}
    hr, spo2 = board["beds"][0]["parameters"]
    assert (hr["parameter"], hr["state"], hr["value"], hr["unit"], hr["age_s"], hr["evidence"]) == (
        "hr", "value", 72, "bpm", 2.4, "screen_match_two_devices")
    assert (spo2["state"], spo2["value"]) == ("invalid", None)
    feed = board["feed"]
    assert (feed["state"], feed["last_post_age_s"], feed["collector_connected"]) == ("ok", 2.0, True)
    assert feed["devices"] == {"total": 5, "streaming": 5, "standby": 0, "silent": 0, "waiting": 0,
                               "unsupported": 0, "unknown": 0}
    assert len(feed["lag_ms"]) == 10
