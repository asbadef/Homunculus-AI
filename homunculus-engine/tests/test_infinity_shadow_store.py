"""Aşama A's shadow store: in memory, bounded, forgetting, and connected to nothing.

The wire format is `homunculus.infinity-shadow.v2` (the hub forwarder's body; v1, the R3 hub's, is
still taken). A body that breaks the schema is refused whole; a reading that is well-formed but
cannot be shown (too old, from the future, the wrong unit, outside the record's integrity bounds, an
unknown or excluded parameter, not newer than the one held) is rejected and counted. NBP travels as
three readings with the time their value last changed and is shown as one entry. Synthetic sources
only (192.0.2.x).
"""
from __future__ import annotations

import copy
import inspect
import math
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_shadow import (
    DISPLAY_MAX_AGE_S, EVIDENCE, FORGET_AFTER_S, LAG_BUCKETS_MS, NBP, NBP_MAX_MEASURED_AGE_S, NBP_PARTS,
    PARAMETERS, PARTIAL, SCHEMA, SCHEMA_V1, ShadowRejected, ShadowStore, TooSoon,
)

T0 = 1_800_000_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def reading(parameter="hr", value=72, unit="bpm", *, valid=True, captured_at=T0 - 0.5, changed_at=None):
    out = {"parameter": parameter, "value": value if valid else None, "unit": unit, "valid": valid,
           "captured_at": captured_at}
    if changed_at is not None:
        out["changed_at"] = changed_at
    return out


def nbp(systolic=118, diastolic=79, mean=92, *, captured_at=T0 - 0.5, changed_at=T0 - 600.0):
    """The forwarder's three NBP readings: one packet, one change time."""
    return [reading(name, value, "mmHg", captured_at=captured_at, changed_at=changed_at)
            for name, value in zip(NBP_PARTS, (systolic, diastolic, mean))]


def device(source="192.0.2.10", *readings, status="streaming", packet_age_ms=100.0, group=None):
    last = source.rsplit(".", 1)[1]
    return {"source": source, "group": group or f"239.20.1.{last}", "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": list(readings)}


def body(*devices, sent_at=T0, collector_age_s=1.0, sent=10, failed=0, schema=SCHEMA):
    return {"schema": schema, "sent_at": sent_at,
            "forwarder": {"interval_s": 5, "sent": sent, "failed": failed,
                          "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": collector_age_s, "accepted_packets": 100,
                    "old_or_duplicate_packets": 2},
            "devices": list(devices)}


def _params(store, source="192.0.2.10", now=None):
    return {p["parameter"]: p for p in store.devices(now)[source].parameters}


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


# --- the parameter table -------------------------------------------------------------------------

def test_the_parameter_table_takes_nbp_with_its_change_time_and_still_excludes_airway_respiration():
    assert NBP_PARTS == ("nbp_systolic", "nbp_diastolic", "nbp_mean")
    assert all(PARAMETERS[name] == ("mmHg", 0, 400) for name in NBP_PARTS)
    assert "respiration_airway" not in PARAMETERS
    # The board shows the three as ONE entry, `nbp`; the evidence table names what the board shows.
    assert set(EVIDENCE) == (set(PARAMETERS) - set(NBP_PARTS)) | {NBP}
    assert EVIDENCE[NBP] == "screen_match" and NBP not in PARTIAL and PARTIAL < set(EVIDENCE)
    assert all(low == 0 for _, low, _ in PARAMETERS.values())          # 0 is inside every bound
    assert NBP_MAX_MEASURED_AGE_S == 7200.0
    assert (SCHEMA_V1, SCHEMA) == ("homunculus.infinity-shadow.v1", "homunculus.infinity-shadow.v2")


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
        reading("respiration_airway", 14, "/min"),                      # unknown_parameter
        reading("foo", 1, "x"),                                         # unknown_parameter
        reading("hr", 75, captured_at=T0 - 1.0),                        # duplicate (not newer)
        reading("temperature", 0, "C"),                                 # 0 is ACCEPTED
        reading("respiration", 12, "/min", captured_at=T0 + 2.0 + 1.9),  # 1.9 s ahead is accepted
    )))
    assert answer["accepted"] == 2
    assert answer["rejected"] == {"too_old": 1, "clock": 1, "unit": 1, "range": 1,
                                  "unknown_parameter": 2, "duplicate": 1}
    params = _params(store)
    assert params["hr"]["value"] == 70                                  # the held one stays
    assert params["temperature"]["value"] == 0
    assert "spo2" not in params and "etco2" not in params
    assert store.feed(T0 + 2.0)["rejected"] == answer["rejected"]       # cumulative


def test_a_v1_body_is_still_taken_and_shows_no_nbp_at_all():
    # The R3 hub keeps posting v1 until its own release changes (the API goes first), and v1 never
    # carried NBP's change time: an NBP in a v1 body stays an unknown parameter, as it always was,
    # and the board says nothing of NBP — "awaiting a measurement" would be untrue of a hub that
    # cannot send one.
    store = ShadowStore(Clock())
    answer = store.ingest(body(device("192.0.2.10", reading(), reading("nbp_systolic", 120, "mmHg")),
                               schema=SCHEMA_V1))
    assert answer["accepted"] == 1 and answer["rejected"]["unknown_parameter"] == 1
    params = _params(store)
    assert params["hr"]["value"] == 72 and NBP not in params


def test_after_a_hub_rolled_back_to_v1_its_held_nbp_ages_out_and_then_nbp_is_not_shown():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading(captured_at=T0 - 0.5), *nbp(captured_at=T0 - 0.5))))
    clock.t = T0 + 20.0                                               # the hub restarted on R3
    store.ingest(body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), schema=SCHEMA_V1))
    held = _params(store)[NBP]
    assert (held["state"], held["systolic"], held["changed_at"]) == ("old", None, _iso(T0 - 600.0))
    clock.t = T0 + FORGET_AFTER_S + 5.0
    store.ingest(body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), schema=SCHEMA_V1))
    assert NBP not in _params(store)


def test_nbp_is_judged_by_its_packet_time_like_any_reading():
    clock = Clock()
    store = ShadowStore(clock)
    answer = store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0 - 10.5, changed_at=T0 - 11.0))))
    assert (answer["accepted"], answer["rejected"]["too_old"]) == (0, 3)
    clock.t += 1.5
    # 401 is past the record's integrity bound, as for ART; a change seen in the packet itself is taken.
    answer = store.ingest(body(device("192.0.2.10", *nbp(401, 79, 92, captured_at=clock.t - 0.5,
                                                         changed_at=clock.t - 0.5))))
    assert (answer["accepted"], answer["rejected"]["range"]) == (2, 1)


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
    "wrong schema": lambda b: b.update(schema="homunculus.infinity-shadow.v3"),
    "changed_at on hr": lambda b: b["devices"][0]["readings"][0].update(changed_at=T0 - 60.0),
    "nbp without changed_at": lambda b: b["devices"][0]["readings"].append(reading("nbp_mean", 92, "mmHg")),
    "changed_at after captured_at": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at=T0 - 0.4)),
    "changed_at zero": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at=0)),
    "changed_at nan": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at=float("nan"))),
    "changed_at text": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at="12:00")),
    "changed_at in a v1 body": lambda b: (b.update(schema=SCHEMA_V1), b["devices"][0]["readings"].extend(nbp())),
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
    assert [p["parameter"] for p in params] == ["hr", "temperature", "respiration", "nbp"]
    by = {p["parameter"]: p for p in params}
    assert by["hr"]["evidence"] == "screen_match_two_devices" and by["hr"]["partial"] is False
    assert by["temperature"]["unit"] == "C" and by["temperature"]["partial"] is True


# --- NBP: three readings, one entry, shown with the time its value last changed ------------------

def _waiting():
    return {"parameter": "nbp", "state": "old", "systolic": None, "diastolic": None, "mean": None,
            "unit": "mmHg", "age_s": None, "last_at": None, "changed_at": None, "measured_age_s": None,
            "evidence": "screen_match", "partial": False}


def test_three_nbp_readings_are_one_entry_with_the_time_their_value_changed():
    store = ShadowStore(Clock())
    answer = store.ingest(body(device("192.0.2.10", reading(), *nbp(captured_at=T0 - 0.5, changed_at=T0 - 600.0))))
    assert answer["accepted"] == 4
    params = store.devices(T0)["192.0.2.10"].parameters
    assert [p["parameter"] for p in params] == ["hr", "nbp"]           # after every other parameter
    assert params[1] == {"parameter": "nbp", "state": "value", "systolic": 118, "diastolic": 79, "mean": 92,
                         "unit": "mmHg", "age_s": 0.5, "last_at": _iso(T0 - 0.5),
                         "changed_at": _iso(T0 - 600.0), "measured_age_s": 600.0,
                         "evidence": "screen_match", "partial": False}


def test_nbp_is_withheld_once_its_value_last_changed_more_than_two_hours_ago():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0 - 0.5, changed_at=T0 - 7199.5))))
    shown = _params(store, now=T0)[NBP]
    assert (shown["state"], shown["systolic"], shown["measured_age_s"]) == ("value", 118, 7199.5)
    withheld = _params(store, now=T0 + 1.0)[NBP]          # the packet is 1.5 s old: only the change is too old
    assert withheld == {**_waiting(), "age_s": 7200.5, "last_at": _iso(T0 - 7199.5),
                        "changed_at": _iso(T0 - 7199.5), "measured_age_s": 7200.5}


def test_a_change_exactly_the_limit_old_is_shown_and_one_microsecond_older_is_withheld():
    for extra, state in ((0.0, "value"), (1e-6, "old")):
        store = ShadowStore(Clock())
        store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0 - 0.5,
                                                    changed_at=T0 - NBP_MAX_MEASURED_AGE_S - extra))))
        shown = _params(store, now=T0)[NBP]
        assert (shown["state"], shown["systolic"] is None) == (state, state == "old"), extra


def test_nbp_keeps_showing_while_every_post_repeats_the_same_change():
    clock = Clock()
    store = ShadowStore(clock)
    changed = T0 - 90.0
    for step in range(5):                            # the packets move on, the change does not
        store.ingest(body(device("192.0.2.10", *nbp(captured_at=clock.t - 0.5, changed_at=changed))))
        shown = _params(store, now=clock.t)[NBP]
        assert (shown["state"], shown["systolic"], shown["changed_at"], shown["measured_age_s"]) == (
            "value", 118, _iso(changed), 90.0 + 5.0 * step), step
        clock.t += 5.0


def test_a_silent_monitors_nbp_goes_old_like_any_value_and_is_aged_by_its_change():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0, changed_at=T0 - 300.0))))
    assert _params(store, now=T0 + 14.9)[NBP]["state"] == "value"
    old = _params(store, now=T0 + 15.1)[NBP]
    assert (old["state"], old["systolic"], old["age_s"], old["last_at"]) == ("old", None, 315.1, _iso(T0 - 300.0))


def test_a_device_holding_readings_but_no_nbp_shows_it_awaiting_a_change():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", reading()), device("192.0.2.11")))
    assert _params(store)[NBP] == _waiting()
    assert store.devices(T0)["192.0.2.11"].parameters == ()            # nothing held: no entry at all


@pytest.mark.parametrize("parts", [NBP_PARTS[:2], NBP_PARTS[1:], NBP_PARTS[:1]])
def test_fewer_than_three_nbp_readings_show_no_number(parts):
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", *[r for r in nbp() if r["parameter"] in parts])))
    assert _params(store)[NBP] == _waiting()


def test_three_readings_from_two_changes_are_never_shown_as_one_measurement():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", *nbp(118, 79, 92, captured_at=T0 - 0.5, changed_at=T0 - 600.0))))
    clock.t += 5
    later = nbp(131, 85, 100, captured_at=clock.t - 0.5, changed_at=clock.t - 1.0)
    store.ingest(body(device("192.0.2.10", *later[1:])))               # the systolic did not come this time
    assert _params(store)[NBP] == _waiting()


def test_an_nbp_the_device_flags_invalid_is_stars_and_no_number():
    store = ShadowStore(Clock())
    parts = nbp()
    parts[1] = reading("nbp_diastolic", None, "mmHg", valid=False, changed_at=T0 - 600.0)
    store.ingest(body(device("192.0.2.10", *parts)))
    entry = _params(store)[NBP]
    assert (entry["state"], entry["systolic"], entry["diastolic"], entry["changed_at"]) == (
        "invalid", None, None, _iso(T0 - 600.0))


def test_a_parameter_is_forgotten_after_120_s():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading("hr", 72, captured_at=T0))))
    assert "hr" in _params(store, now=T0 + FORGET_AFTER_S)
    assert "hr" not in _params(store, now=T0 + FORGET_AFTER_S + 0.1)
    clock.t = T0 + 500
    view = store.devices()["192.0.2.10"]
    assert view.parameters == () and view.status == "unknown"          # only the status is left


@pytest.mark.parametrize(("hub", "shown"), [("streaming", "streaming"), ("no_parameters", "standby"),
                                            ("stale", "silent"), ("waiting", "waiting"),
                                            ("unsupported", "unsupported")])
def test_the_hub_status_is_named_for_the_board_once(hub, shown):
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", status=hub, packet_age_ms=None if hub == "waiting" else 5000.0)))
    clock.t = T0 + 1
    view = store.devices()["192.0.2.10"]
    assert (view.status, view.status_age_s) == (shown, 1.0)
    clock.t = T0 + 15.1
    assert store.devices()["192.0.2.10"].status == "unknown"           # not reported for > 15 s


def test_feed_states_never_ok_silent_and_collector_disconnected():
    clock = Clock()
    store = ShadowStore(clock)
    assert store.feed()["state"] == "never"
    store.ingest(body(device("192.0.2.10", reading()), collector_age_s=1.0))
    clock.t = T0 + 2.0
    feed = store.feed()
    assert (feed["state"], feed["last_post_age_s"], feed["collector_connected"]) == ("ok", 2.0, True)
    assert feed["collector_age_s"] == 3.0                              # aged with the post
    assert feed["forwarder"] == {"interval_s": 5, "sent": 10, "failed": 0,
                                 "decoder": "homunculus.infinity-preview.v3"}
    clock.t = T0 + 16.0
    assert store.feed()["state"] == "forwarder_silent"
    clock.t = T0 + 20
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


# --- the wall clock may step; the lane's own spacing and silence may not -------------------------

def test_a_wall_clock_stepped_back_never_shows_a_frozen_value_as_fresh():
    # An NTP step or a VM restore moves the wall clock back ten minutes. The value held from before
    # is now "ten minutes in the future": it is forgotten rather than shown with an age of 0 s, the
    # next POST is not "too soon", and the new reading is taken rather than refused as older.
    wall, mono = Clock(T0), Clock(5_000.0)
    store = ShadowStore(wall, monotonic=mono)
    store.ingest(body(device("192.0.2.10", reading("hr", 80, captured_at=T0 - 0.5))))
    wall.t -= 600
    mono.t += 1
    assert "hr" not in _params(store)                                  # not 80 at age 0
    mono.t += 4
    answer = store.ingest(body(device("192.0.2.10", reading("hr", 120, captured_at=wall.t - 0.5)), sent_at=wall.t))
    assert answer["accepted"] == 1 and answer["rejected"]["duplicate"] == 0
    hr = _params(store)["hr"]
    assert (hr["state"], hr["value"], hr["age_s"]) == ("value", 120, 0.5)
    assert store.feed()["state"] == "ok"


def test_a_value_ahead_of_the_api_clock_is_old_not_fresh():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading("hr", 72, captured_at=T0 + 1.5))))   # taken: <= 2 s ahead
    hr = _params(store)["hr"]
    assert (hr["state"], hr["value"]) == ("old", None)


def test_the_spacing_and_the_silence_run_on_the_monotonic_clock():
    wall, mono = Clock(T0), Clock(5_000.0)
    store = ShadowStore(wall, monotonic=mono)
    store.ingest(body(device("192.0.2.10", reading())))
    wall.t += 100                                                     # a step forward: not 100 s later
    mono.t += 0.5
    with pytest.raises(TooSoon):
        store.ingest(body(device("192.0.2.10", reading(captured_at=wall.t - 0.5))))
    mono.t += 15.6
    wall.t -= 100
    assert store.feed()["state"] == "forwarder_silent"
    assert store.devices()["192.0.2.10"].status == "unknown"


def test_two_monitors_on_one_bed_link_neither_to_its_patient():
    # parse_table refuses such a table; board_view must not link two devices to one patient even if
    # one ever reached it.
    from datetime import datetime, timezone

    from homunculus.api.infinity_device_beds import DeviceBedTable, Row, TableState
    from homunculus.api.infinity_shadow import board_view

    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    rows = tuple(Row(src, f"239.20.1.{src.rsplit('.', 1)[1]}", 2050, label, bed_id, None, "monitor_screen",
                     "2026-07-14", start, None, "")
                 for src, label, bed_id in (("192.0.2.10", "B-1", "bed-b1"), ("192.0.2.11", "B-1a", "BED-B1 "),
                                            ("192.0.2.12", "B-2", "bed-b2")))
    table = TableState(DeviceBedTable(1, "synthetic", "test", "2026-07-14", rows), "ok", None, "0" * 64, 1)
    store = ShadowStore(Clock())
    store.ingest(body(*(device(s, reading()) for s in ("192.0.2.10", "192.0.2.11", "192.0.2.12"))))
    out = board_view(store.devices(), store.feed(), table, occupants={"bed-b1": ["p1"], "bed-b2": ["p2"]},
                     visible=lambda card: True, patient_visible=lambda card: True, show_unassigned=True, now=T0)
    links = {b["source"]: (b["link"], b["patient_id"], b.get("link_reason")) for b in out["beds"]}
    assert links["192.0.2.10"] == ("ambiguous", None, "two_monitors")
    assert links["192.0.2.11"] == ("ambiguous", None, "two_monitors")
    assert links["192.0.2.12"] == ("one", "p2", None)


# --- bounds --------------------------------------------------------------------------------------

def test_the_store_stays_bounded_at_100_devices_by_12_readings():
    clock = Clock()
    store = ShadowStore(clock)
    units = {name: unit for name, (unit, _, _) in PARAMETERS.items()}
    assert len(units) == 12
    sizes = []
    for cycle in range(30):
        clock.t = T0 + cycle * 5
        devices = [device(f"192.0.2.{i + 1}" if i < 50 else f"198.51.100.{i - 49}",
                          *(reading(name, 1, unit, captured_at=clock.t - 0.1,
                                    changed_at=clock.t - 60.0 if name in NBP_PARTS else None)
                            for name, unit in units.items()))
                   for i in range(100)]
        store.ingest(body(*devices))
        views = store.devices(clock.t)
        sizes.append((len(views), sum(len(v.parameters) for v in views.values())))
    assert set(sizes) == {(100, 1000)}             # nine entries, and the one the three NBP readings make
    # A hundred new sources replace the least recently reported, never grow the store.
    clock.t += 5
    store.ingest(body(*[device(f"203.0.113.{i + 1}") for i in range(100)]))
    assert len(store.devices(clock.t)) == 100


def test_any_mangled_body_is_refused_or_taken_never_an_error():
    # The review's fuzzer, deterministic: 2000 bodies with one to three fields replaced by odd
    # values (None, NaN, inf, 10**20, 2**63, 10**400, nested containers, the wrong strings). Each is refused
    # whole or taken; nothing else is raised, and the store stays readable and bounded. The seed
    # carries a complete NBP triple, so `changed_at` and the fold are fuzzed as well.
    import json as _json
    import random

    weird = [None, True, False, 0, -1, 1.5, float("nan"), float("inf"), -0.0, 10**20, "", "x", "192.0.2.10",
             [], {}, [1], {"a": 1}, "239.20.1.10", 2050, "bpm", "hr", 2**63, 10**400]

    def paths(obj, prefix=()):
        yield prefix
        if isinstance(obj, dict):
            for key, value in obj.items():
                yield from paths(value, prefix + (key,))
        elif isinstance(obj, list):
            for i, value in enumerate(obj):
                yield from paths(value, prefix + (i,))

    clock = Clock()
    store = ShadowStore(clock)
    rng = random.Random(7)
    seen = {"taken": 0, "refused": 0}
    for _ in range(2000):
        clock.t += 1.5
        raw = body(device("192.0.2.10", reading(captured_at=clock.t - 0.5),
                          reading("spo2", None, "%", valid=False, captured_at=clock.t - 0.5),
                          *nbp(captured_at=clock.t - 0.5, changed_at=clock.t - 30.0)), sent_at=clock.t)
        for _ in range(rng.randint(1, 3)):
            target = rng.choice([p for p in paths(raw) if p])
            holder = raw
            for key in target[:-1]:
                holder = holder[key]
            try:
                holder[target[-1]] = copy.deepcopy(rng.choice(weird))
            except (TypeError, KeyError, IndexError):
                pass
        try:
            store.ingest(_json.loads(_json.dumps(raw)))
            seen["taken"] += 1
        except (ShadowRejected, TooSoon):
            seen["refused"] += 1
        store.devices()
        store.feed()
    assert seen["taken"] > 0 and seen["refused"] > 0
    assert len(store.devices()) <= 100


# --- no side door --------------------------------------------------------------------------------

def test_the_store_has_no_method_that_could_reach_the_clinical_side():
    public = {name for name in dir(ShadowStore) if not name.startswith("_")}
    assert public == {"ingest", "devices", "feed"}
    for name in public:
        params = set(inspect.signature(getattr(ShadowStore, name)).parameters) - {"self"}
        assert params <= {"body", "now"}, name
    assert set(inspect.signature(ShadowStore).parameters) == {"clock", "monotonic"}
    assert math.isclose(FORGET_AFTER_S, 120.0)
    assert copy.deepcopy(body()) == body()                             # the fixture is pure data
