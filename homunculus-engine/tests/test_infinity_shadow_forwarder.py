"""Aşama A's hub forwarder: thinned, fresh, NBP with the time it changed — or untimed and whole while no
change was seen (NBP-2) — display only, off unless its environment is set.

Synthetic only: the live view's own test inventory (192.0.2.x / 239.20.1.x) and the records
decoder's test records. The end-to-end tests carry a `thin` body into the clinical API's shadow
lane, sharing one clock with the live view, so the two sides of the wire stay in step.
"""
from __future__ import annotations

import contextlib
import datetime
import importlib.util
import io
import ipaddress
import json
import logging
import random
import socket
import sys
import threading
import time
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from test_infinity_live import NO_RECORDS, PAYLOAD, event, inventory
from test_infinity_records import ART_SYS, HR, SPO2, TEMPERATURE, record
from homunculus.edge import infinity_collector
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_journal import Journal
from homunculus.edge.infinity_live import NBP, LiveResearchView
from homunculus.edge.infinity_shadow import (
    BACKOFF_S, FORWARDED, INTERVAL_S, MAX_FORWARD_AGE_MS, SCHEMA, ShadowMisconfigured, ShadowSender,
    _untimed_nbp, forward_loop, settings_from_env, thin,
)

ROOT = Path(__file__).resolve().parents[2]
NBP_SYS, NBP_DIA, NBP_MEAN, RESP, RESP_AIRWAY = 0x1E08, 0x1E07, 0x1E09, 0x0206, 0x1F06
TOKEN = "f" * 64                                  # the lane's token, synthetic
T = 1_800_000_000.0
COLLECTOR, VIEWER = "synthetic-collector-token-" + "a" * 32, "synthetic-viewer-token-" + "b" * 32


def _view(count=1):
    now = [T]
    view = LiveResearchView(inventory(count), clock=lambda: now[0], monotonic=lambda: now[0])
    return view, now


def _thin(view, now, **kwargs):
    return thin(view.snapshot(), now=now[0], collector_age=kwargs.get("collector_age", 1.0),
                counters=kwargs.get("counters", {"sent": 0, "failed": 0}))


def _names(body, index=0):
    return [r["parameter"] for r in body["devices"][index]["readings"]]


# --- thin ----------------------------------------------------------------------------------------

def _nbp(systolic, diastolic, mean):
    return record(NBP_SYS, systolic) + record(NBP_DIA, diastolic) + record(NBP_MEAN, mean)


def test_thin_sends_nbp_untimed_until_a_change_is_seen_and_then_with_its_change_time():
    view, now = _view()
    view.consume([event(T - 2.2, PAYLOAD + _nbp(120, 80, 93))])     # first seen after a start: time unknown
    readings = _thin(view, now)["devices"][0]["readings"]
    assert [r["parameter"] for r in readings] == ["hr", "spo2", "nbp_systolic", "nbp_diastolic", "nbp_mean"]
    assert [(r["value"], r["changed_at"]) for r in readings[2:]] == [(120, None), (80, None), (93, None)]
    view.consume([event(T - 1.2, PAYLOAD + _nbp(118, 79, 92))])     # the triple changed: measured at or before
    view.consume([event(T - 0.2, PAYLOAD + _nbp(118, 79, 92))])     # and repeated in every packet
    readings = _thin(view, now)["devices"][0]["readings"]
    assert [r["parameter"] for r in readings] == ["hr", "spo2", "nbp_systolic", "nbp_diastolic", "nbp_mean"]
    assert readings[2] == {"parameter": "nbp_systolic", "value": 118, "unit": "mmHg", "valid": True,
                           "captured_at": T - 0.2, "changed_at": T - 1.2}
    assert {r["changed_at"] for r in readings[2:]} == {T - 1.2}
    assert not any("changed_at" in r for r in readings[:2])
    assert [n for n in FORWARDED if n.startswith("nbp_")] == ["nbp_systolic", "nbp_diastolic", "nbp_mean"]


def test_a_newer_nbp_value_without_its_triple_is_not_sent_with_the_older_time():
    view, now = _view()
    view.consume([event(T - 2.2, _nbp(120, 80, 93)), event(T - 1.2, _nbp(118, 79, 92))])
    view.consume([event(T - 0.2, record(NBP_SYS, 105))])           # a packet carrying the systolic alone
    assert _names(_thin(view, now)) == ["nbp_diastolic", "nbp_mean"]


def test_an_nbp_three_seconds_old_never_leaves_the_hub():
    view, now = _view()
    view.consume([event(T - 1.0, _nbp(120, 80, 93)), event(T - 0.5, _nbp(118, 79, 92))])
    now[0] = T + 2.4                                               # the packet is 2.9 s old
    assert _names(_thin(view, now)) == ["nbp_systolic", "nbp_diastolic", "nbp_mean"]
    now[0] = T + 2.5                                               # 3.0 s: no older value leaves the hub
    entry = view.snapshot()["devices"][0]["parameters"]["nbp_systolic"]
    assert (entry["status"], entry["changed_at"]) == ("stale", T - 0.5)    # stale, yet it keeps its time
    assert _names(_thin(view, now)) == []                          # so it is thin() that drops it


# --- NBP-2: an untimed NBP is the whole complete valid triple, or nothing --------------------------
#
# After a hub start, an outage or a gap the hub has seen no change, so the cuff's measurement time is
# unknown. The three still travel, `changed_at: None`, when they are the complete valid triple the
# monitor shows now: all present, valid, fresh, and the values of the triple the hub holds. Anything
# less sends none of the three: never half a cuff, never a half-updated one.

def test_an_untimed_complete_valid_triple_travels_whole_with_changed_at_null():
    view, now = _view()
    view.consume([event(T - 0.4, _nbp(120, 80, 93)), event(T - 0.2, _nbp(120, 80, 93))])   # repeated, never changed
    readings = _thin(view, now)["devices"][0]["readings"]
    assert readings == [{"parameter": name, "value": value, "unit": "mmHg", "valid": True,
                         "captured_at": T - 0.2, "changed_at": None}
                        for name, value in zip(NBP, (120, 80, 93))]
    assert json.dumps(readings).count('"changed_at": null') == 3


def test_the_untimed_rule_needs_the_whole_held_triple_to_compare_against():
    # The guard reads the live view's `nbp_triple`. A snapshot without the key, or with an empty or a
    # short one, can vouch for no part of the cuff: none of the three travel untimed.
    fresh = {name: {"status": "candidate", "age_ms": 100.0, "changed_at": None, "value": value}
             for name, value in zip(NBP, (120, 80, 93))}
    assert _untimed_nbp({"parameters": fresh, "nbp_triple": (120, 80, 93)})
    assert not _untimed_nbp({"parameters": fresh})
    assert not _untimed_nbp({"parameters": fresh, "nbp_triple": None})
    assert not _untimed_nbp({"parameters": fresh, "nbp_triple": []})
    assert not _untimed_nbp({"parameters": fresh, "nbp_triple": (120, 80)})


def test_a_change_seen_only_after_a_gap_travels_untimed_with_the_new_values():
    view, now = _view()
    now[0] = T - 10.0
    view.consume([event(T - 10.2, _nbp(120, 80, 93)), event(T - 10.1, _nbp(118, 79, 92))])   # a change seen live
    assert {r["changed_at"] for r in _thin(view, now)["devices"][0]["readings"]} == {T - 10.1}
    now[0] = T
    view.consume([event(T - 0.2, _nbp(131, 85, 100))])            # after 10 s without NBP: changed, but when?
    assert [(r["parameter"], r["value"], r["changed_at"]) for r in _thin(view, now)["devices"][0]["readings"]] == [
        ("nbp_systolic", 131, None), ("nbp_diastolic", 85, None), ("nbp_mean", 100, None)]


def test_an_untimed_triple_with_a_star_component_sends_none_of_the_three():
    view, now = _view()
    view.consume([event(T - 0.6, record(NBP_SYS, 120) + record(NBP_DIA, 4, valid=False) + record(NBP_MEAN, 93))])
    assert view.snapshot()["devices"][0]["nbp_triple"] is None and _names(_thin(view, now)) == []
    view.consume([event(T - 0.5, _nbp(120, 80, 93))])                       # the triple held, untimed
    view.consume([dict(event(T - 0.4, PAYLOAD), payload_base64="!")])       # undecodable: the readings go, the triple stays
    view.consume([event(T - 0.2, record(NBP_SYS, 120) + record(NBP_DIA, 4, valid=False) + record(NBP_MEAN, 93))])
    state = view.snapshot()["devices"][0]
    assert state["nbp_triple"] == [120, 80, 93]
    assert [state["parameters"][name]["status"] for name in NBP] == ["candidate", "device_reports_invalid",
                                                                     "candidate"]
    assert _names(_thin(view, now)) == []                                   # not 120/— (93), not 120 and 93


def test_an_untimed_triple_with_a_stale_component_sends_none_of_the_three():
    view, now = _view()
    now[0] = T - 3.4
    view.consume([event(T - 3.5, _nbp(120, 80, 93))])                       # the triple held, untimed
    now[0] = T
    view.consume([event(T - 0.2, record(NBP_SYS, 120) + record(NBP_MEAN, 93))])    # the diastolic not carried since
    state = view.snapshot()["devices"][0]
    assert state["nbp_triple"] == [120, 80, 93]
    assert [state["parameters"][name]["status"] for name in NBP] == ["candidate", "stale", "candidate"]
    assert _names(_thin(view, now)) == []


def test_an_untimed_triple_with_a_missing_component_sends_none_of_the_three():
    view, now = _view()
    view.consume([event(T - 0.6, record(NBP_SYS, 120) + record(NBP_MEAN, 93))])    # two of the three, no triple held
    assert view.snapshot()["devices"][0]["nbp_triple"] is None and _names(_thin(view, now)) == []
    view.consume([event(T - 0.5, _nbp(120, 80, 93))])                       # the triple held, untimed
    view.consume([dict(event(T - 0.4, PAYLOAD), payload_base64="!")])       # undecodable: the readings go, the triple stays
    view.consume([event(T - 0.2, record(NBP_SYS, 120) + record(NBP_MEAN, 93))])
    state = view.snapshot()["devices"][0]
    assert state["nbp_triple"] == [120, 80, 93] and "nbp_diastolic" not in state["parameters"]
    assert _names(_thin(view, now)) == []


def test_three_components_from_partial_packets_are_not_a_triple_and_none_is_sent():
    # Each is valid and fresh, but no packet carried the three together: the hub holds no triple,
    # so nothing says these three were ever on the monitor's screen at once.
    view, now = _view()
    view.consume([event(T - 0.4, record(NBP_SYS, 120) + record(NBP_MEAN, 93)), event(T - 0.2, record(NBP_DIA, 80))])
    state = view.snapshot()["devices"][0]
    assert state["nbp_triple"] is None
    assert [state["parameters"][name]["status"] for name in NBP] == ["candidate"] * 3
    assert _names(_thin(view, now)) == []


def test_a_lone_newer_component_of_an_untimed_triple_sends_none_of_the_three():
    # X38 without a time: a partial packet brought a newer systolic alone. 105/80 (93) would draw a
    # half-updated cuff, 80 (93) half a cuff; the timed form of this case is the test above it.
    view, now = _view()
    view.consume([event(T - 1.2, _nbp(120, 80, 93))])                       # the triple held, untimed
    view.consume([event(T - 0.2, record(NBP_SYS, 105))])                    # a packet carrying the systolic alone
    state = view.snapshot()["devices"][0]
    assert state["nbp_triple"] == [120, 80, 93] and state["parameters"]["nbp_systolic"]["value"] == 105
    assert _names(_thin(view, now)) == []


FUZZ_NBP = (80, 93, 118, 120)      # few values, so repeats and a return to an older triple are common


def _fuzz_payload(rng):
    payload = PAYLOAD if rng.random() < 0.5 else b""
    for identifier in (NBP_SYS, NBP_DIA, NBP_MEAN):
        draw = rng.random()
        if draw < 0.15:
            continue                                                         # not carried in this packet
        payload += record(identifier, rng.choice(FUZZ_NBP), valid=draw >= 0.25)   # one in ten: the device's ***
    return payload or NO_RECORDS


def test_fuzzed_packets_give_bodies_the_api_takes_with_nbp_timed_or_whole_and_untimed():
    """Deterministic: 300 runs of 40 steps over two monitors — packets late, repeated, undecodable or
    replayed; NBP components missing, flagged, changed or returning to an older triple; gaps of up to
    10 s — and one body after every step. Each body, as JSON, passes the API's own `_validate`, and
    NBP-2 holds: an untimed NBP is the whole triple the hub holds, a timed one is never after its
    packet, and no *** or stale NBP ever travels."""
    from homunculus.api.infinity_shadow import _validate

    rng, seen = random.Random(20261028), {"timed": 0, "untimed": 0}
    inv = inventory(2)
    for _ in range(300):
        view, now = _view(2)
        for _ in range(40):
            now[0] += rng.choice((0.0, 0.2, 0.5, 1.0, 2.0, 3.5, 10.0))
            index, stamp = rng.randrange(2), now[0] - rng.choice((0.0, 0.1, 0.3, 2.9, 3.5))
            item = event(stamp, _fuzz_payload(rng), index=index, inv=inv,
                         mode="replay" if rng.random() < 0.02 else "live")
            if rng.random() < 0.03:
                item = dict(item, payload_base64="!")
            if rng.random() < 0.9:
                view.consume([item])
            snapshot = view.snapshot()
            body = json.loads(json.dumps(thin(snapshot, now=now[0], collector_age=1.0,
                                              counters={"sent": 0, "failed": 0}), allow_nan=False))
            _validate(body)                                                  # the API takes it whole
            for sent, held in zip(body["devices"], snapshot["devices"]):
                nbp = [r for r in sent["readings"] if r["parameter"] in NBP]
                assert all(r["valid"] and now[0] - r["captured_at"] < 3.0 for r in nbp)
                untimed = [r for r in nbp if r["changed_at"] is None]
                if untimed:
                    assert untimed == nbp and [r["parameter"] for r in nbp] == list(NBP)
                    assert [r["value"] for r in nbp] == held["nbp_triple"]
                    seen["untimed"] += 1
                elif nbp:
                    assert all(0 < r["changed_at"] <= r["captured_at"] for r in nbp)
                    seen["timed"] += 1
    assert min(seen.values()) > 500, seen                                   # both forms were exercised


def test_airway_respiration_is_never_sent_and_impedance_respiration_is():
    view, now = _view()
    view.consume([event(T - 0.2, record(RESP_AIRWAY, 14) + record(RESP, 16))])
    assert _names(_thin(view, now)) == ["respiration"]
    assert "respiration_airway" not in FORWARDED


@pytest.mark.parametrize(("age", "sent"), [(2.9, True), (3.0, False), (4.0, False)])
def test_a_value_3_s_old_or_older_never_leaves_the_hub(age, sent):
    view, now = _view()
    view.consume([event(T, PAYLOAD)])
    now[0] = T + age                                 # T is an integer: 3.0 s is exactly 3000 ms
    assert ("hr" in _names(_thin(view, now))) is sent
    assert MAX_FORWARD_AGE_MS == 3000.0


def test_a_devices_star_reading_travels_as_invalid_with_no_value():
    view, now = _view()
    view.consume([event(T - 0.2, record(SPO2, 4, valid=False))])
    (reading,) = _thin(view, now)["devices"][0]["readings"]
    assert reading == {"parameter": "spo2", "value": None, "unit": "%", "valid": False,
                       "captured_at": T - 0.2}


def test_standby_is_no_parameters_with_no_readings_and_an_unheard_device_is_waiting():
    view, now = _view(2)
    view.consume([event(T - 0.2, NO_RECORDS, index=0, inv=inventory(2))])
    first, second = _thin(view, now)["devices"]
    assert (first["status"], first["readings"]) == ("no_parameters", [])
    assert (second["status"], second["packet_age_ms"], second["readings"]) == ("waiting", None, [])
    # The hub's own words travel; the API renames them for the board, once.


def test_a_silent_device_is_reported_stale_with_nothing_to_show():
    view, now = _view()
    view.consume([event(T - 0.2, PAYLOAD)])
    now[0] += 10
    (device,) = _thin(view, now)["devices"]
    assert (device["status"], device["readings"]) == ("stale", [])
    assert device["packet_age_ms"] == pytest.approx(10_200.0)


def test_no_device_id_or_inventory_name_travels():
    view, now = _view()
    view.consume([event(T - 0.2, PAYLOAD)])
    body = _thin(view, now)
    text = json.dumps(body)
    assert "device_id" not in text and "synthetic-1" not in text
    assert set(body["devices"][0]) == {"source", "group", "port", "status", "packet_age_ms", "readings"}
    assert body["devices"][0]["port"] == 2050


def test_one_value_per_parameter_per_device_per_cycle():
    view, now = _view()
    view.consume([event(T - 1.0 + i / 5, PAYLOAD) for i in range(5)])        # five packets in a second
    for _ in range(2):                                                       # two cycles, one body each
        body = _thin(view, now)
        assert _names(body) == ["hr", "spo2"]
        assert body["devices"][0]["readings"][0]["captured_at"] == pytest.approx(T - 0.2)
        now[0] += 0.5


def test_units_and_scale_are_the_decoders():
    view, now = _view()
    view.consume([event(T - 0.2, record(TEMPERATURE, 366) + record(ART_SYS, 118))])
    readings = {r["parameter"]: r for r in _thin(view, now)["devices"][0]["readings"]}
    assert (readings["temperature"]["value"], readings["temperature"]["unit"]) == (36.6, "C")
    assert (readings["art_systolic"]["value"], readings["art_systolic"]["unit"]) == (118, "mmHg")


def test_the_body_names_the_forwarder_the_hub_and_the_decoder():
    view, now = _view()
    view.consume([event(T - 0.2, PAYLOAD)])
    body = _thin(view, now, collector_age=None, counters={"sent": 7, "failed": 2})
    assert (body["schema"], body["sent_at"]) == (SCHEMA, T) and SCHEMA == "homunculus.infinity-shadow.v2"
    assert body["forwarder"] == {"interval_s": INTERVAL_S, "sent": 7, "failed": 2,
                                 "decoder": "homunculus.infinity-preview.v3"}
    assert body["hub"] == {"collector_age_s": None, "accepted_packets": 1, "old_or_duplicate_packets": 0}


# --- forward_loop --------------------------------------------------------------------------------

class FakeSender:
    def __init__(self, *statuses):
        self.statuses, self.bodies = list(statuses), []

    def send(self, body):
        self.bodies.append(body)
        return self.statuses.pop(0) if self.statuses else 200


def _loop(sender, cycles, view=None, **kwargs):
    stop, pauses = threading.Event(), []
    view = view or _view()[0]

    def wait(pause):
        pauses.append(pause)
        if len(pauses) >= cycles:
            stop.set()

    forward_loop(view, sender, stop, collector_age=lambda: 1.0, clock=lambda: T, wait=wait, **kwargs)
    return pauses


def test_the_loop_sends_every_5_s_and_reports_its_counters():
    sender = FakeSender()
    assert _loop(sender, 3) == [INTERVAL_S] * 3 == [5.0] * 3
    assert [b["forwarder"]["sent"] for b in sender.bodies] == [0, 1, 2]


def test_a_network_failure_is_counted_and_the_loop_goes_on():
    sender = FakeSender(0, 0, 200)
    assert _loop(sender, 3) == [INTERVAL_S] * 3
    assert [b["forwarder"]["failed"] for b in sender.bodies] == [0, 1, 2]


@pytest.mark.parametrize(("status", "pause"), [(401, BACKOFF_S), (409, BACKOFF_S), (429, INTERVAL_S),
                                               (400, INTERVAL_S), (413, INTERVAL_S), (503, INTERVAL_S)])
def test_401_and_409_back_off_to_60_s_and_the_rest_wait_one_cycle(status, pause):
    assert _loop(FakeSender(status), 1) == [pause]
    assert BACKOFF_S == 60.0


def test_an_internal_error_never_leaves_the_thread(caplog):
    class Broken:
        calls = 0

        def snapshot(self):
            Broken.calls += 1
            if Broken.calls == 1:
                raise KeyError("a bug")
            return _view()[0].snapshot()

    sender = FakeSender()
    with caplog.at_level(logging.WARNING, logger="homunculus.edge.infinity_shadow"):
        assert _loop(sender, 2, view=Broken()) == [INTERVAL_S, INTERVAL_S]
    assert len(sender.bodies) == 1 and sender.bodies[0]["forwarder"]["failed"] == 1
    assert "a bug" not in caplog.text


def test_logs_come_only_on_state_changes_and_never_carry_the_token(caplog):
    sender = SimpleNamespace(url="https://192.0.2.200:8443/infinity-shadow/readings", bodies=[],
                             statuses=[200, 200, 401, 401, 200, 200])
    sender.send = lambda body: (sender.bodies.append(body), sender.statuses.pop(0))[1]
    view, now = _view()
    view.consume([event(T - 0.2, PAYLOAD)])
    with caplog.at_level(logging.DEBUG, logger="homunculus.edge.infinity_shadow"):
        _loop(sender, 6, view=view)
    lines = [r.getMessage() for r in caplog.records]
    assert lines == ["Aşama A forwarder: starting -> ok", "Aşama A forwarder: ok -> token_refused",
                     "Aşama A forwarder: token_refused -> ok"]
    assert TOKEN not in caplog.text and "192.0.2" not in caplog.text
    assert "70" not in caplog.text and "97" not in caplog.text      # the values that were sent


# --- the sender ----------------------------------------------------------------------------------

class Opener:
    def __init__(self, outcome):
        self.outcome, self.requests = outcome, []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return contextlib.nullcontext(SimpleNamespace(status=self.outcome))


@pytest.mark.parametrize(("outcome", "status"), [
    (200, 200),
    (urllib.error.HTTPError("https://x", 401, "no", {}, None), 401),
    (urllib.error.HTTPError("https://x", 302, "moved", {}, None), 302),
    (urllib.error.URLError("refused"), 0), (TimeoutError("slow"), 0), (OSError("down"), 0),
])
def test_the_sender_returns_a_status_and_never_raises(outcome, status):
    opener = Opener(outcome)
    sender = ShadowSender("https://192.0.2.200:8443/infinity-shadow/readings", TOKEN, "unused", opener=opener)
    assert sender.send({"schema": SCHEMA}) == status
    request, timeout = opener.requests[0]
    assert request.get_method() == "POST" and timeout == 3.0
    assert request.get_header("Authorization") == "Bearer " + TOKEN
    assert json.loads(request.data) == {"schema": SCHEMA}


def test_the_sender_refuses_a_body_that_is_not_strict_json():
    sender = ShadowSender("https://192.0.2.200:8443/x", TOKEN, "unused", opener=Opener(200))
    assert sender.send({"value": float("nan")}) == 0


def test_the_sender_never_follows_a_redirect(tmp_path):
    # A redirect would carry the Authorization header to wherever it points.
    certfile, _ = _certificate(tmp_path, "panel")
    sender = ShadowSender("https://192.0.2.200:8443/x", TOKEN, str(certfile))
    handlers = sender._opener.handlers
    redirect = next(h for h in handlers if isinstance(h, urllib.request.HTTPRedirectHandler))
    assert redirect.redirect_request(None, None, 302, "moved", {}, "https://elsewhere/") is None
    assert not any(isinstance(h, urllib.request.ProxyHandler) and h.proxies for h in handlers)


def test_an_unreadable_ca_file_is_a_misconfiguration(tmp_path):
    with pytest.raises(ShadowMisconfigured, match="INFINITY_SHADOW_CA_FILE"):
        ShadowSender("https://192.0.2.200:8443/x", TOKEN, str(tmp_path / "missing.pem"))


# --- settings ------------------------------------------------------------------------------------

def _env(**over):
    env = {"INFINITY_SHADOW_URL": "https://192.0.2.200:8443/infinity-shadow/readings",
           "INFINITY_SHADOW_TOKEN": TOKEN, "INFINITY_SHADOW_CA_FILE": "/etc/homunculus-infinity-pilot/web-ca.pem"}
    env.update(over)
    return {k: v for k, v in env.items() if v is not None}


def test_no_forwarding_variable_means_forwarding_off():
    assert settings_from_env({}) is None
    assert settings_from_env({"INFINITY_SHADOW_URL": "  ", "INFINITY_VIEWER_TOKEN": "x"}) is None


def test_all_three_give_the_settings():
    assert settings_from_env(_env()) == {"url": "https://192.0.2.200:8443/infinity-shadow/readings",
                                         "token": TOKEN, "ca_file": "/etc/homunculus-infinity-pilot/web-ca.pem"}


@pytest.mark.parametrize("over", [
    {"INFINITY_SHADOW_URL": None}, {"INFINITY_SHADOW_TOKEN": None}, {"INFINITY_SHADOW_CA_FILE": None},
    {"INFINITY_SHADOW_URL": "http://192.0.2.200:8080/infinity-shadow/readings"},
    {"INFINITY_SHADOW_URL": "https:///no-host"},
    {"INFINITY_SHADOW_TOKEN": "f" * 31}, {"INFINITY_SHADOW_TOKEN": "f" * 32 + " x"},
])
def test_a_partial_or_unsafe_setting_stops_the_hub_with_a_fixed_sentence(over):
    with pytest.raises(ShadowMisconfigured) as caught:
        settings_from_env(_env(**over))
    message = str(caught.value)
    assert message.startswith("Shadow forwarding misconfigured:")
    assert TOKEN not in message and "f" * 31 not in message and "192.0.2" not in message
    assert isinstance(caught.value, ValueError)


# --- the hub -------------------------------------------------------------------------------------

@pytest.fixture
def journal(tmp_path):
    archive = Journal(tmp_path / "journal.sqlite", Fernet.generate_key())
    yield archive
    archive.close()


def test_the_hub_says_how_long_ago_the_collector_spoke(journal):
    now = [1000.0]
    app = create_hub(inventory(), journal, COLLECTOR, VIEWER, clock=lambda: now[0])
    assert app.state.collector_age() is None
    heartbeat = {"collector_id": "synthetic", "mode": "live", "queue": journal.snapshot(),
                 "clinical_forwarding": False}
    client = TestClient(app)
    assert client.post("/v1/heartbeat", json=heartbeat, headers={"Authorization": "Bearer " + COLLECTOR}).status_code == 200
    now[0] += 7.5
    assert app.state.collector_age() == pytest.approx(7.5)


def test_the_hubs_public_answers_do_not_change(journal):
    view, _ = _view()
    client = TestClient(create_hub(inventory(), journal, COLLECTOR, VIEWER, accept_payload=True,
                                   research_view=view))
    headers = {"Authorization": "Bearer " + VIEWER}
    status = client.get("/v1/status", headers=headers).json()
    assert set(status) == {"devices", "collector", "archive", "clinical_forwarding", "kernel_drop_count", "timings"}
    assert status["clinical_forwarding"] is False
    state = client.get("/infinity-research/state", headers=headers).json()
    assert state["clinical_ingest_enabled"] is False and "shadow" not in json.dumps(state)
    assert "shadow" not in json.dumps(status)


# --- end to end, no network: the hub's body into the API's lane --------------------------------

SHADOW_TABLE = {
    "schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic",
    "approved_by": "test", "approved_at": "2026-07-14",
    "devices": [{"source": "192.0.2.1", "group": "239.20.1.1", "port": 2050, "bed_label": "B-1",
                 "bed_id": None, "unit_id": None, "method": "monitor_screen", "verified_at": "2026-07-14",
                 "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""}],
}
DEVICE = "tok-device-00000000000000000000000000"


class ClientOpener:
    """urllib's opener shape, with the API's TestClient as its transport."""

    def __init__(self, client):
        self.client = client

    def open(self, request, timeout):
        response = self.client.post(urlsplit(request.full_url).path, content=request.data,
                                    headers=dict(request.header_items()))
        if response.status_code >= 400:
            raise urllib.error.HTTPError(request.full_url, response.status_code, "refused", {}, None)
        return contextlib.nullcontext(SimpleNamespace(status=response.status_code))


def _api(tmp_path, clock, *, stage="shadow"):
    from homunculus.api.app import create_app
    from homunculus.api.infinity_shadow import ShadowSettings

    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(SHADOW_TABLE), encoding="utf-8")
    settings = (ShadowSettings("shadow", "shadow", None, TOKEN, "HOSP1", str(path)) if stage == "shadow"
                else ShadowSettings(table_path=str(path)))
    return TestClient(create_app({DEVICE: "HOSP1"}, run_escalation_loop=False, shadow=settings,
                                 shadow_clock=clock))


def _run_cycles(view, now, client, cycles, collector_age=lambda: 1.0, payload=PAYLOAD):
    """The real loop, the real sender; the live view and the API on one clock."""
    stop, pauses = threading.Event(), []
    sender = ShadowSender("https://api.test/infinity-shadow/readings", TOKEN, "unused", opener=ClientOpener(client))
    inv = inventory(2)

    def wait(pause):
        pauses.append(pause)
        now[0] += pause
        view.consume([event(now[0] - 0.3, payload, index=0, inv=inv)])       # the monitor keeps sending
        if len(pauses) >= cycles:
            stop.set()

    forward_loop(view, sender, stop, collector_age=collector_age, clock=lambda: now[0], wait=wait)
    return pauses


def test_a_thinned_body_lands_in_the_api_lane_and_on_the_board(tmp_path):
    view, now = _view(2)
    view.consume([event(T - 0.5, PAYLOAD + _nbp(120, 80, 93), index=0, inv=inventory(2)),
                  event(T - 0.3, PAYLOAD + _nbp(118, 79, 92), index=0, inv=inventory(2))])   # NBP changed at T - 0.3
    client = _api(tmp_path, lambda: now[0])
    assert _run_cycles(view, now, client, 3, payload=PAYLOAD + _nbp(118, 79, 92)) == [INTERVAL_S] * 3
    board = client.get("/infinity-shadow/board", headers={"Authorization": f"Bearer {DEVICE}"}).json()
    (bed,) = board["beds"]
    assert (bed["bed_label"], bed["source"], bed["status"]) == ("B-1", "192.0.2.1", "streaming")
    params = {p["parameter"]: p for p in bed["parameters"]}
    assert (params["hr"]["state"], params["hr"]["value"], params["hr"]["unit"]) == ("value", 70, "bpm")
    assert params["spo2"]["value"] == 97
    nbp = params["nbp"]
    assert (nbp["state"], nbp["systolic"], nbp["diastolic"], nbp["mean"], nbp["unit"]) == ("value", 118, 79, 92, "mmHg")
    assert nbp["changed_at"] == datetime.datetime.fromtimestamp(T - 0.3, datetime.timezone.utc).isoformat()
    assert nbp["measured_age_s"] == 15.3                           # at T + 15, the third cycle's end
    assert not [p for p in params if p.startswith("nbp_")]
    (unheard,) = board["unassigned"]
    assert (unheard["source"], unheard["reason"], unheard["status"]) == ("192.0.2.2", "not_in_table", "waiting")
    feed = board["feed"]
    assert (feed["state"], feed["posts"], feed["forwarder"]["sent"]) == ("ok", 3, 2)
    assert feed["rejected"] == {"too_old": 0, "clock": 0, "unit": 0, "range": 0,
                                "unknown_parameter": 0, "duplicate": 0}


def test_a_hub_that_never_heard_its_collector_shows_as_disconnected(tmp_path):
    view, now = _view(2)
    view.consume([event(T - 0.3, PAYLOAD, index=0, inv=inventory(2))])
    client = _api(tmp_path, lambda: now[0])
    _run_cycles(view, now, client, 1, collector_age=lambda: None)
    feed = client.get("/infinity-shadow/board", headers={"Authorization": f"Bearer {DEVICE}"}).json()["feed"]
    assert (feed["state"], feed["collector_connected"]) == ("collector_disconnected", False)


def test_with_the_api_stage_off_the_forwarder_backs_off(tmp_path):
    view, now = _view(2)
    client = _api(tmp_path, lambda: now[0], stage="off")
    assert _run_cycles(view, now, client, 2) == [BACKOFF_S, BACKOFF_S]


# --- end to end over TLS, the way the hub reaches the panel --------------------------------------

def _certificate(folder: Path, name: str):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "homunculus-panel")])
    stamp = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(stamp - datetime.timedelta(minutes=1))
            .not_valid_after(stamp + datetime.timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                                                        x509.DNSName("homunculus")]), critical=False)
            .sign(key, hashes.SHA256()))
    certfile, keyfile = folder / f"{name}.crt", folder / f"{name}.key"
    certfile.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    keyfile.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
    return certfile, keyfile


def test_over_tls_the_sender_trusts_only_the_panels_own_certificate(tmp_path):
    import uvicorn

    certfile, keyfile = _certificate(tmp_path, "panel")
    stranger, _ = _certificate(tmp_path, "stranger")
    client = _api(tmp_path, time.time)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    url = f"https://127.0.0.1:{listener.getsockname()[1]}/infinity-shadow/readings"
    server = uvicorn.Server(uvicorn.Config(client.app, ssl_certfile=str(certfile), ssl_keyfile=str(keyfile),
                                           access_log=False, log_level="error"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        view = LiveResearchView(inventory())
        view.consume([event(time.time() - 0.2, PAYLOAD)])
        body = thin(view.snapshot(), now=time.time(), collector_age=1.0, counters={"sent": 0, "failed": 0})
        assert ShadowSender(url, TOKEN, str(stranger)).send(body) == 0          # not the panel: refused
        assert ShadowSender(url, "e" * 64, str(certfile)).send(body) == 401     # not the lane's token
        assert ShadowSender(url, TOKEN, str(certfile)).send(body) == 200
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
    assert not thread.is_alive()


# --- the runner ----------------------------------------------------------------------------------

def _runner():
    spec = importlib.util.spec_from_file_location("run_infinity_transport",
                                                  ROOT / "homunculus-engine/scripts/run_infinity_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_runner_keeps_the_collectors_own_forward_loop():
    # The forwarder's loop must not shadow the collector's: one name, two loops, one function.
    assert _runner().forward_loop is infinity_collector.forward_loop


def _hub_argv(tmp_path):
    inv = tmp_path / "inventory.json"
    inv.write_text(json.dumps({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": "synthetic-1", "source": "192.0.2.1", "group": "239.20.1.1", "port": 2050}]}), encoding="utf-8")
    database = tmp_path / f"hub-{len(list(tmp_path.glob('hub-*.sqlite')))}.sqlite"   # each run its own key
    return ["run_infinity_transport.py", "hub", "--inventory", str(inv), "--database", str(database),
            "--capture-payload", "--unverified-live-research"]


def _hub_env(monkeypatch, **shadow):
    monkeypatch.setenv("INFINITY_STORAGE_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("INFINITY_COLLECTOR_TOKEN", COLLECTOR)
    monkeypatch.setenv("INFINITY_VIEWER_TOKEN", VIEWER)
    for name in ("INFINITY_SHADOW_URL", "INFINITY_SHADOW_TOKEN", "INFINITY_SHADOW_CA_FILE"):
        monkeypatch.delenv(name, raising=False)
    for name, value in shadow.items():
        monkeypatch.setenv(name, value)


def _main(runner, monkeypatch, argv, served):
    monkeypatch.setattr(sys, "argv", argv)
    monkeypatch.setattr(runner.uvicorn, "run", lambda app, **kwargs: served.append(app))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = runner.main()
    return code, out.getvalue()


def test_the_runner_starts_the_forwarder_only_with_its_environment(tmp_path, monkeypatch):
    runner, served = _runner(), []
    _hub_env(monkeypatch)
    code, out = _main(runner, monkeypatch, _hub_argv(tmp_path), served)
    assert code == 0 and len(served) == 1 and "Shadow display forwarding" not in out
    certfile, _ = _certificate(tmp_path, "panel")
    _hub_env(monkeypatch, INFINITY_SHADOW_URL="https://127.0.0.1:9/infinity-shadow/readings",
             INFINITY_SHADOW_TOKEN=TOKEN, INFINITY_SHADOW_CA_FILE=str(certfile))
    code, out = _main(runner, monkeypatch, _hub_argv(tmp_path), served)
    assert code == 0
    assert "Shadow display forwarding ENABLED (Stage A, unvalidated; not clinical ingest) every 5 s." in out
    assert "clinical forwarding DISABLED" in out and TOKEN not in out


@pytest.mark.parametrize("shadow", [{"INFINITY_SHADOW_URL": "https://127.0.0.1:9/x"},
                                    {"INFINITY_SHADOW_URL": "http://127.0.0.1:9/x", "INFINITY_SHADOW_TOKEN": TOKEN,
                                     "INFINITY_SHADOW_CA_FILE": "/nowhere.pem"}])
def test_a_misconfigured_forwarder_stops_the_hub_with_a_line_the_deploy_block_greps(tmp_path, monkeypatch, shadow):
    runner, served = _runner(), []
    _hub_env(monkeypatch, **shadow)
    code, out = _main(runner, monkeypatch, _hub_argv(tmp_path), served)
    assert code == 2 and served == []
    assert "Transport stopped: Shadow forwarding misconfigured:" in out and TOKEN not in out


def test_without_live_research_the_forwarder_is_not_started_and_says_so(tmp_path, monkeypatch):
    runner, served = _runner(), []
    certfile, _ = _certificate(tmp_path, "panel")
    _hub_env(monkeypatch, INFINITY_SHADOW_URL="https://127.0.0.1:9/x", INFINITY_SHADOW_TOKEN=TOKEN,
             INFINITY_SHADOW_CA_FILE=str(certfile))
    argv = [a for a in _hub_argv(tmp_path) if a != "--unverified-live-research"]
    code, out = _main(runner, monkeypatch, argv, served)
    assert code == 0 and len(served) == 1
    assert "Shadow display forwarding NOT started" in out and "ENABLED" not in out


def test_the_generic_stop_line_names_shadow_forwarding_too(tmp_path, monkeypatch):
    runner, served = _runner(), []
    _hub_env(monkeypatch)
    monkeypatch.delenv("INFINITY_VIEWER_TOKEN")
    code, out = _main(runner, monkeypatch, _hub_argv(tmp_path), served)
    assert code == 2 and "or shadow forwarding configuration" in out
