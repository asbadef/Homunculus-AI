"""Aşama A's shadow store: in memory, bounded, forgetting, and connected to nothing.

The wire format is `homunculus.infinity-shadow.v1` (the hub forwarder's body). A body that breaks
the schema is refused whole; a reading that is well-formed but cannot be shown (too old, from the
future, the wrong unit, outside the record's integrity bounds, an unknown or excluded parameter,
not newer than the one held) is rejected and counted. Synthetic sources only (192.0.2.x).
"""
from __future__ import annotations

import copy
import inspect
import math

import pytest

from homunculus.api.infinity_shadow import (
    DISPLAY_MAX_AGE_S, EVIDENCE, FORGET_AFTER_S, LAG_BUCKETS_MS, PARAMETERS, PARTIAL, SCHEMA,
    ShadowRejected, ShadowStore, TooSoon,
)

T0 = 1_800_000_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def reading(parameter="hr", value=72, unit="bpm", *, valid=True, captured_at=T0 - 0.5):
    return {"parameter": parameter, "value": value if valid else None, "unit": unit, "valid": valid,
            "captured_at": captured_at}


def device(source="192.0.2.10", *readings, status="streaming", packet_age_ms=100.0, group=None):
    last = source.rsplit(".", 1)[1]
    return {"source": source, "group": group or f"239.20.1.{last}", "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": list(readings)}


def body(*devices, sent_at=T0, collector_age_s=1.0, sent=10, failed=0):
    return {"schema": SCHEMA, "sent_at": sent_at,
            "forwarder": {"interval_s": 5, "sent": sent, "failed": failed,
                          "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": collector_age_s, "accepted_packets": 100,
                    "old_or_duplicate_packets": 2},
            "devices": list(devices)}


def _params(store, source="192.0.2.10", now=None):
    return {p["parameter"]: p for p in store.devices(now)[source].parameters}


# --- the parameter table -------------------------------------------------------------------------

def test_the_parameter_table_excludes_nbp_and_airway_respiration():
    assert not any(name.startswith("nbp_") for name in PARAMETERS)
    assert "respiration_airway" not in PARAMETERS
    assert set(EVIDENCE) == set(PARAMETERS) and PARTIAL < set(PARAMETERS)
    assert all(low == 0 for _, low, _ in PARAMETERS.values())          # 0 is inside every bound


# --- ingest --------------------------------------------------------------------------------------

def test_a_valid_body_is_accepted_and_counted():
    store = ShadowStore(Clock())
    answer = store.ingest(body(device("192.0.2.10", reading(), reading("spo2", 97, "%"),
                                      reading("temperature", 36.6, "C"),
                                      reading("etco2", None, "mmHg", valid=False))))
    assert answer == {"accepted": 4, "rejected": {"too_old": 0, "clock": 0, "unit": 0, "range": 0,
                                                  "unknown_parameter": 0, "duplicate": 0}}
    params = _params(store)
    assert params["hr"]["value"] == 72 and params["temperature"]["value"] == 36.6
    assert params["etco2"]["state"] == "invalid" and params["etco2"]["value"] is None


def test_each_unshowable_reading_is_rejected_and_counted():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading("hr", 70, captured_at=T0 - 1.0))))
    clock.t = T0 + 2.0              # the next POST, past the 1 s spacing
    answer = store.ingest(body(device(
        "192.0.2.10",
        reading("spo2", 97, "%", captured_at=T0 + 2.0 - 10.5),          # too_old (> 10 s)
        reading("pls", 80, "bpm", captured_at=T0 + 2.0 + 2.5),         # clock (> 2 s ahead)
        reading("etco2", 5, "kPa"),                                     # unit (no conversion anywhere)
        reading("art_mean", 401, "mmHg"),                               # range
        reading("nbp_systolic", 120, "mmHg"),                           # unknown_parameter
        reading("respiration_airway", 14, "/min"),                      # unknown_parameter
        reading("foo", 1, "x"),                                         # unknown_parameter
        reading("hr", 75, captured_at=T0 - 1.0),                        # duplicate (not newer)
        reading("temperature", 0, "C"),                                 # 0 is ACCEPTED
        reading("respiration", 12, "/min", captured_at=T0 + 2.0 + 1.9),  # 1.9 s ahead is accepted
    )))
    assert answer["accepted"] == 2
    assert answer["rejected"] == {"too_old": 1, "clock": 1, "unit": 1, "range": 1,
                                  "unknown_parameter": 3, "duplicate": 1}
    params = _params(store)
    assert params["hr"]["value"] == 70                                  # the held one stays
    assert params["temperature"]["value"] == 0
    assert "nbp_systolic" not in params and "spo2" not in params and "etco2" not in params
    assert store.feed(T0 + 2.0)["rejected"] == answer["rejected"]       # cumulative


def test_spo2_101_is_out_of_range_and_hr_0_is_a_value():
    store = ShadowStore(Clock())
    answer = store.ingest(body(device("192.0.2.10", reading("spo2", 101, "%"), reading("hr", 0))))
    assert (answer["accepted"], answer["rejected"]["range"]) == (1, 1)
    assert _params(store)["hr"]["value"] == 0 and _params(store)["hr"]["state"] == "value"


def test_an_older_reading_never_overwrites_a_newer_one():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading("hr", 90, captured_at=T0 - 0.2))))
    clock.t += 1.5
    answer = store.ingest(body(device("192.0.2.10", reading("hr", 60, captured_at=T0 - 0.4))))
    assert answer["rejected"]["duplicate"] == 1 and _params(store)["hr"]["value"] == 90


def _bad(mutate):
    raw = body(device("192.0.2.10", reading()), device("192.0.2.11", reading()))
    mutate(raw)
    return raw


SCHEMA_VIOLATIONS = {
    "unknown top key": lambda b: b.update(patient_id="x"),
    "unknown device key": lambda b: b["devices"][0].update(device_id="BED05"),
    "unknown reading key": lambda b: b["devices"][0]["readings"][0].update(note="x"),
    "missing key": lambda b: b["hub"].pop("collector_age_s"),
    "wrong schema": lambda b: b.update(schema="homunculus.infinity-shadow.v2"),
    "101 devices": lambda b: b.update(devices=[device(f"192.0.2.{i + 1}") for i in range(101)]),
    "17 readings": lambda b: b["devices"][0].update(readings=[reading(captured_at=T0 - i / 100)
                                                               for i in range(17)]),
    "nan value": lambda b: b["devices"][0]["readings"][0].update(value=float("nan")),
    "infinite captured_at": lambda b: b["devices"][0]["readings"][0].update(captured_at=float("inf")),
    "bool value": lambda b: b["devices"][0]["readings"][0].update(value=True),
    "text value": lambda b: b["devices"][0]["readings"][0].update(value="72"),
    "valid without a value": lambda b: b["devices"][0]["readings"][0].update(value=None),
    "invalid with a value": lambda b: b["devices"][0]["readings"][0].update(valid=False),
    "non-unicast source": lambda b: b["devices"][0].update(source="239.20.1.10"),
    "non-multicast group": lambda b: b["devices"][0].update(group="192.0.2.99"),
    "port": lambda b: b["devices"][0].update(port=2051),
    "unknown status": lambda b: b["devices"][0].update(status="alarm"),
    "negative packet_age_ms": lambda b: b["devices"][0].update(packet_age_ms=-1.0),
    "a source twice": lambda b: b["devices"][1].update(source="192.0.2.10", group="239.20.1.10"),
    "a parameter twice": lambda b: b["devices"][0]["readings"].append(reading(captured_at=T0 - 0.1)),
    "negative counter": lambda b: b["forwarder"].update(sent=-1),
    "devices not a list": lambda b: b.update(devices={}),
}


@pytest.mark.parametrize("name", sorted(SCHEMA_VIOLATIONS))
def test_a_schema_violation_refuses_the_whole_body(name):
    store = ShadowStore(Clock())
    with pytest.raises(ShadowRejected):
        store.ingest(_bad(SCHEMA_VIOLATIONS[name]))
    assert store.devices(T0) == {}                                     # nothing from it was kept
    assert store.feed(T0)["state"] == "never"


def test_a_body_that_is_not_an_object_is_refused():
    with pytest.raises(ShadowRejected):
        ShadowStore(Clock()).ingest([body()])


def test_a_second_post_within_one_second_is_too_soon():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading())))
    clock.t += 0.9
    with pytest.raises(TooSoon):
        store.ingest(body(device("192.0.2.10", reading(captured_at=T0 + 0.5))))
    clock.t += 0.1
    assert store.ingest(body(device("192.0.2.10", reading(captured_at=T0 + 0.6))))["accepted"] == 1


# --- views ---------------------------------------------------------------------------------------

def test_value_invalid_and_old_states_and_the_number_withheld_after_15_s():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", reading("hr", 72, captured_at=T0),
                             reading("spo2", None, "%", valid=False, captured_at=T0))))
    fresh = _params(store, now=T0 + 14.9)
    assert (fresh["hr"]["state"], fresh["hr"]["value"], fresh["hr"]["age_s"]) == ("value", 72, 14.9)
    assert (fresh["spo2"]["state"], fresh["spo2"]["value"]) == ("invalid", None)
    old = _params(store, now=T0 + 15.1)
    assert (old["hr"]["state"], old["hr"]["value"]) == ("old", None)
    assert old["hr"]["last_at"].startswith("2027-01-15T08:00:00")      # T0, as UTC ISO
    assert old["spo2"]["state"] == "old"
    assert DISPLAY_MAX_AGE_S == 15.0


def test_each_parameter_carries_unit_evidence_and_partial_in_table_order():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", reading("respiration", 14, "/min"), reading("hr", 72),
                             reading("temperature", 36.6, "C"))))
    params = store.devices(T0)["192.0.2.10"].parameters
    assert [p["parameter"] for p in params] == ["hr", "temperature", "respiration"]
    by = {p["parameter"]: p for p in params}
    assert by["hr"]["evidence"] == "screen_match_two_devices" and by["hr"]["partial"] is False
    assert by["temperature"]["unit"] == "C" and by["temperature"]["partial"] is True


def test_a_parameter_is_forgotten_after_120_s():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", reading("hr", 72, captured_at=T0))))
    assert "hr" in _params(store, now=T0 + FORGET_AFTER_S)
    assert "hr" not in _params(store, now=T0 + FORGET_AFTER_S + 0.1)
    view = store.devices(T0 + 500)["192.0.2.10"]
    assert view.parameters == () and view.status == "unknown"          # only the status is left


@pytest.mark.parametrize(("hub", "shown"), [("streaming", "streaming"), ("no_parameters", "standby"),
                                            ("stale", "silent"), ("waiting", "waiting"),
                                            ("unsupported", "unsupported")])
def test_the_hub_status_is_named_for_the_board_once(hub, shown):
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", status=hub, packet_age_ms=None if hub == "waiting" else 5000.0)))
    view = store.devices(T0 + 1)["192.0.2.10"]
    assert (view.status, view.status_age_s) == (shown, 1.0)
    assert store.devices(T0 + 15.1)["192.0.2.10"].status == "unknown"   # not reported for > 15 s


def test_feed_states_never_ok_silent_and_collector_disconnected():
    clock = Clock()
    store = ShadowStore(clock)
    assert store.feed(T0)["state"] == "never"
    store.ingest(body(device("192.0.2.10", reading()), collector_age_s=1.0))
    feed = store.feed(T0 + 2.0)
    assert (feed["state"], feed["last_post_age_s"], feed["collector_connected"]) == ("ok", 2.0, True)
    assert feed["collector_age_s"] == 3.0                              # aged with the post
    assert feed["forwarder"] == {"interval_s": 5, "sent": 10, "failed": 0,
                                 "decoder": "homunculus.infinity-preview.v3"}
    assert store.feed(T0 + 16.0)["state"] == "forwarder_silent"
    clock.t += 20
    store.ingest(body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), collector_age_s=20.0))
    feed = store.feed(clock.t)
    assert (feed["state"], feed["collector_connected"]) == ("collector_disconnected", False)
    clock.t += 5
    store.ingest(body(collector_age_s=None))                           # the hub never heard one
    assert store.feed(clock.t)["state"] == "collector_disconnected"


def test_the_lag_histogram_counts_received_minus_captured():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", reading("hr", 72, captured_at=T0 - 0.005),
                             reading("spo2", 97, "%", captured_at=T0 - 0.2),
                             reading("pls", 72, captured_at=T0 - 4.0),
                             reading("etco2", 35, "mmHg", captured_at=T0 + 1.0))))
    lag = store.feed(T0)["lag_ms"]
    assert len(lag) == 2 + len(LAG_BUCKETS_MS) + 1
    assert lag[0] == 4 and lag[1] == 0 + 5 + 200 + 4000               # count, total (a future one is 0)
    assert lag[2:] == [2, 0, 0, 1, 0, 0, 0, 1]                         # <=10 (5 and 0), <=250, >3000


# --- bounds --------------------------------------------------------------------------------------

def test_the_store_stays_bounded_at_100_devices_by_9_parameters():
    clock = Clock()
    store = ShadowStore(clock)
    units = {name: unit for name, (unit, _, _) in PARAMETERS.items()}
    sizes = []
    for cycle in range(30):
        clock.t = T0 + cycle * 5
        devices = [device(f"192.0.2.{i + 1}" if i < 50 else f"198.51.100.{i - 49}",
                          *(reading(name, 1, unit, captured_at=clock.t - 0.1) for name, unit in units.items()))
                   for i in range(100)]
        store.ingest(body(*devices))
        views = store.devices(clock.t)
        sizes.append((len(views), sum(len(v.parameters) for v in views.values())))
    assert set(sizes) == {(100, 900)}
    # A hundred new sources replace the least recently reported, never grow the store.
    clock.t += 5
    store.ingest(body(*[device(f"203.0.113.{i + 1}") for i in range(100)]))
    assert len(store.devices(clock.t)) == 100


# --- no side door --------------------------------------------------------------------------------

def test_the_store_has_no_method_that_could_reach_the_clinical_side():
    public = {name for name in dir(ShadowStore) if not name.startswith("_")}
    assert public == {"ingest", "devices", "feed"}
    for name in public:
        params = set(inspect.signature(getattr(ShadowStore, name)).parameters) - {"self"}
        assert params <= {"body", "now"}, name
    assert set(inspect.signature(ShadowStore).parameters) == {"clock"}
    assert math.isclose(FORGET_AFTER_S, 120.0)
    assert copy.deepcopy(body()) == body()                             # the fixture is pure data
