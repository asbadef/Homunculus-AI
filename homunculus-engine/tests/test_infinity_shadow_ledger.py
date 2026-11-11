"""G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D2–D4): the shadow lane's last-seen ledger.

Memory only, beside the store's readings: when each device was first and last reported, when its last
packet came (the report's time less the hub's packet age), and when each channel last carried a valid
value — kept after the store forgets the reading at 120 s. A device the hub stops reporting stays 24 h,
never more devices than the store holds, and only the board's own channels. The store itself is
unchanged (test_infinity_shadow_store.py pins its surface). Synthetic sources only (192.0.2.x,
198.51.100.x).
"""
from __future__ import annotations

import inspect
import json
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_device_beds import DeviceBedTable, Row, TableState
from homunculus.api.infinity_shadow import (
    FORGET_AFTER_S, LEDGER_KEEP_S, MAX_DEVICES, NBP_PARTS, SCHEMA, STALE_LIST_AFTER_S, STALE_LIST_UNTIL_S, FeedLedger,
    LedgerView, ShadowStore, board_view, reported_sources,
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
    if parameter in NBP_PARTS:
        out["changed_at"] = changed_at                 # v2: an NBP reading always carries the key
    return out


def device(source="192.0.2.10", *readings, status="streaming", packet_age_ms=100.0):
    last = source.rsplit(".", 1)[1]
    return {"source": source, "group": f"239.20.1.{last}", "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": list(readings)}


def body(*devices, sent_at=T0):
    return {"schema": SCHEMA, "sent_at": sent_at,
            "forwarder": {"interval_s": 5, "sent": 10, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 100, "old_or_duplicate_packets": 2},
            "devices": list(devices)}


def lane(clock=None, monotonic=None):
    """A store and its ledger on the same clocks, as create_app builds them."""
    clock = clock or Clock()
    return clock, ShadowStore(clock, monotonic=monotonic), FeedLedger(clock, monotonic=monotonic)


def post(store, ledger, raw):
    """What POST /infinity-shadow/readings does with a body it accepts (app.py `_note_seen`)."""
    store.ingest(raw)
    ledger.observe(store.devices(), reported_sources(raw))


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


# --- the ledger (Task 1) -------------------------------------------------------------------------

def test_the_ledgers_bounds_are_the_specs():
    assert (STALE_LIST_AFTER_S, STALE_LIST_UNTIL_S, LEDGER_KEEP_S, MAX_DEVICES) == (60.0, 3600.0, 24 * 3600.0, 100)


def test_watching_starts_when_the_ledger_is_made_and_nothing_is_held_before_a_report():
    clock, store, ledger = lane()
    clock.t = T0 + 7
    seen = ledger.view()
    assert seen.started_at == T0 and dict(seen.devices) == {}


def test_reported_sources_are_the_bodys_addresses():
    assert reported_sources(body(device("192.0.2.10"), device("192.0.2.11"))) == ["192.0.2.10", "192.0.2.11"]


def test_a_report_sets_the_last_report_and_the_last_packet_less_its_age():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading(), packet_age_ms=1500.0)))
    one = ledger.view().devices["192.0.2.10"]
    assert (one.first_seen_at, one.last_report_at, one.last_packet_at, one.reported) == (T0, T0, T0 - 1.5, True)
    clock.t = T0 + 5                                    # the monitor went quiet: the hub's age grows with it
    post(store, ledger, body(device("192.0.2.10", status="stale", packet_age_ms=6500.0), sent_at=clock.t))
    one = ledger.view().devices["192.0.2.10"]
    assert (one.first_seen_at, one.last_report_at, one.last_packet_at) == (T0, T0 + 5, T0 - 1.5)


def test_a_report_with_no_packet_age_leaves_the_last_packet_where_it_was():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", status="waiting", packet_age_ms=None)))
    assert ledger.view().devices["192.0.2.10"].last_packet_at is None       # never a packet: never a time
    clock.t = T0 + 5
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5), packet_age_ms=200.0),
                             sent_at=clock.t))
    clock.t = T0 + 10                                   # a hub restarted: no packet since, so no age
    post(store, ledger, body(device("192.0.2.10", status="waiting", packet_age_ms=None), sent_at=clock.t))
    assert ledger.view().devices["192.0.2.10"].last_packet_at == T0 + 5 - 0.2


def test_a_channels_last_valid_value_outlives_the_stores_forgetting():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", 97, "%"))))
    for step in range(1, 30):                           # five-second posts for 145 s: hr goes on, spo2 stops
        clock.t = T0 + 5 * step
        post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=clock.t - 0.5)),
                                 sent_at=clock.t))
    assert "spo2" not in {p["parameter"] for p in store.devices()["192.0.2.10"].parameters}   # forgotten
    channels = dict(ledger.view().devices["192.0.2.10"].channels)
    assert channels == {"hr": pytest.approx(clock.t - 0.5, abs=1e-3), "spo2": pytest.approx(T0 - 0.5, abs=1e-3)}
    assert clock.t - channels["spo2"] > FORGET_AFTER_S


def test_only_a_valid_value_the_store_took_moves_a_channels_time():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", None, "%", valid=False))))
    assert dict(ledger.view().devices["192.0.2.10"].channels) == {"hr": pytest.approx(T0 - 0.5, abs=1e-3)}
    clock.t = T0 + 5                                    # «***» on hr, and a parameter the board does not know
    post(store, ledger, body(device("192.0.2.10", reading("hr", None, valid=False, captured_at=clock.t - 0.5),
                                    reading("bogus", 1, "x", captured_at=clock.t - 0.5)), sent_at=clock.t))
    clock.t = T0 + 10                                   # a value outside the record's bounds: refused, counted
    post(store, ledger, body(device("192.0.2.10", reading("hr", 999, captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert dict(ledger.view().devices["192.0.2.10"].channels) == {"hr": pytest.approx(T0 - 0.5, abs=1e-3)}


def test_nbp_is_one_channel_by_the_boards_name_and_last():
    clock, store, ledger = lane()
    triple = [reading(name, value, "mmHg", changed_at=T0 - 600.0) for name, value in zip(NBP_PARTS, (118, 79, 92))]
    post(store, ledger, body(device("192.0.2.10", reading(), *triple)))
    assert [name for name, _ in ledger.view().devices["192.0.2.10"].channels] == ["hr", "nbp"]


def test_a_device_left_out_of_the_latest_body_is_no_longer_reported():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading())))
    clock.t = T0 + 5
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    seen = ledger.view().devices
    assert (seen["192.0.2.10"].reported, seen["192.0.2.11"].reported) == (True, False)
    assert seen["192.0.2.11"].last_report_at == T0


def test_a_device_no_longer_reported_is_kept_24_hours_then_dropped():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading())))
    clock.t = T0 + LEDGER_KEEP_S
    assert set(ledger.view().devices) == {"192.0.2.10", "192.0.2.11"}       # 24 h to the second: kept
    clock.t = T0 + LEDGER_KEEP_S + 1
    assert dict(ledger.view().devices) == {}
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert set(ledger.view().devices) == {"192.0.2.10"}
    assert ledger.view().devices["192.0.2.10"].first_seen_at == clock.t      # seen again, first again


def test_the_24_hours_run_on_the_monotonic_clock():
    wall, mono = Clock(T0), Clock(5_000.0)
    _, store, ledger = lane(wall, mono)
    post(store, ledger, body(device("192.0.2.10", reading())))
    wall.t += 2 * LEDGER_KEEP_S                         # a wall clock stepped forward two days
    mono.t += 60
    assert "192.0.2.10" in ledger.view().devices
    mono.t += LEDGER_KEEP_S
    assert "192.0.2.10" not in ledger.view().devices


def test_the_ledger_never_holds_a_device_the_store_has_let_go():
    clock, store, ledger = lane()
    post(store, ledger, body(*[device(f"192.0.2.{i + 1}", reading()) for i in range(MAX_DEVICES)]))
    clock.t = T0 + 5                                    # a 101st source: the store drops one, so does the ledger
    post(store, ledger, body(device("198.51.100.1", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    seen = ledger.view().devices
    assert len(seen) == MAX_DEVICES and "198.51.100.1" in seen
    assert set(seen) <= set(store.devices())


def test_the_ledger_has_no_method_that_could_reach_the_clinical_side():
    public = {name for name in dir(FeedLedger) if not name.startswith("_")}
    assert public == {"observe", "view"}
    assert set(inspect.signature(FeedLedger.observe).parameters) == {"self", "views", "reported"}
    assert set(inspect.signature(FeedLedger.view).parameters) == {"self"}
    assert set(inspect.signature(FeedLedger).parameters) == {"clock", "monotonic"}


# --- the board (Task 2) --------------------------------------------------------------------------

START = datetime(2026, 7, 1, tzinfo=timezone.utc)
OLD_TOP = {"stage", "display_max_age_s", "generated_at", "table", "feed", "beds", "unassigned"}
OLD_BED = {"bed_label", "bed_id", "unit_id", "method", "verified_at", "source", "group", "status", "status_age_s",
           "packet_age_ms", "parameters", "link", "patient_id", "link_reason"}
OLD_STRAY = {"source", "group", "status", "status_age_s", "packet_age_ms", "parameters", "reason", "note"}
VANISHED_KEYS = {"source", "bed_label", "last_packet_at", "last_report_at"}


def _table():
    """B-1 (unit-1) and B-2 (unit-2) on beds; .12 in the table, its bed unresolved."""
    rows = tuple(Row(source, f"239.20.1.{source.rsplit('.', 1)[1]}", 2050, label, bed_id, unit_id, "monitor_screen",
                     "2026-07-14", START, None, "")
                 for source, label, bed_id, unit_id in (("192.0.2.10", "B-1", "bed-b1", "unit-1"),
                                                        ("192.0.2.11", "B-2", "bed-b2", "unit-2"),
                                                        ("192.0.2.12", None, None, None)))
    return TableState(DeviceBedTable(1, "synthetic", "test", "2026-07-14", rows), "ok", None, "0" * 64, 1)


def _board(store, ledger, clock, *, visible=lambda card: True, show_unassigned=True, with_ledger=True, occupants=None):
    extra = {"ledger": ledger.view()} if with_ledger else {}
    return board_view(store.devices(clock.t), store.feed(clock.t), _table(), occupants=occupants, visible=visible,
                      patient_visible=lambda card: True, show_unassigned=show_unassigned, now=clock.t, **extra)


def test_without_a_ledger_the_board_is_exactly_what_it_was():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.12", reading())))
    out = _board(store, ledger, clock, with_ledger=False)
    assert set(out) == OLD_TOP
    assert set(out["beds"][0]) == OLD_BED and set(out["unassigned"][0]) == OLD_STRAY


def test_with_the_ledger_every_card_and_the_body_carry_it():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), packet_age_ms=500.0),
                             device("192.0.2.12", reading("spo2", 97, "%"))))
    clock.t = T0 + 2
    out = _board(store, ledger, clock)
    assert set(out) == OLD_TOP | {"watching_since", "stale_list_after_s", "stale_list_until_s", "vanished"}
    assert (out["watching_since"], out["stale_list_after_s"], out["stale_list_until_s"], out["vanished"]) == (
        _iso(T0), STALE_LIST_AFTER_S, STALE_LIST_UNTIL_S, [])
    bed, stray = out["beds"][0], out["unassigned"][0]
    assert set(bed) == OLD_BED | {"last_packet_at", "silent_for_s", "channels_seen"}
    assert set(stray) == OLD_STRAY | {"last_packet_at", "silent_for_s", "channels_seen"}
    assert (bed["last_packet_at"], bed["silent_for_s"]) == (_iso(T0 - 0.5), None)          # streaming: no silence
    assert bed["channels_seen"] == [{"parameter": "hr", "last_value_at": _iso(T0 - 0.5)}]
    assert stray["channels_seen"] == [{"parameter": "spo2", "last_value_at": _iso(T0 - 0.5)}]


def test_channels_seen_keeps_a_channel_the_store_has_forgotten():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", 97, "%"))))
    for step in range(1, 27):                           # to T0 + 130: spo2's reading is past FORGET_AFTER_S
        clock.t = T0 + 5 * step
        post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=clock.t - 0.5)),
                                 sent_at=clock.t))
    card = _board(store, ledger, clock)["beds"][0]
    assert "spo2" not in {p["parameter"] for p in card["parameters"]}
    assert [ch["parameter"] for ch in card["channels_seen"]] == ["hr", "spo2"]
    assert card["channels_seen"][1]["last_value_at"] == _iso(T0 - 0.5)


def test_a_channel_silent_for_over_an_hour_stays_in_channels_seen():
    # Spec D4's amendment: past stale_list_until_s the PAGE stops listing a channel; the board still carries it.
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("art_systolic", 120, "mmHg"))))
    clock.t = T0 + STALE_LIST_UNTIL_S + 100             # the arterial line was taken out at T0
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=clock.t - 0.5)), sent_at=clock.t))
    out = _board(store, ledger, clock)
    card = out["beds"][0]
    assert card["status"] == "streaming"
    assert card["channels_seen"] == [{"parameter": "hr", "last_value_at": _iso(clock.t - 0.5)},
                                     {"parameter": "art_systolic", "last_value_at": _iso(T0 - 0.5)}]
    assert (out["stale_list_after_s"], out["stale_list_until_s"]) == (60.0, 3600.0)


def test_silent_for_is_whole_seconds_since_the_last_packet_for_a_silent_or_unknown_monitor_only():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", status="stale", packet_age_ms=7_000.0),
                             device("192.0.2.11", reading())))
    clock.t = T0 + 0.9
    beds = {c["source"]: c for c in _board(store, ledger, clock)["beds"]}
    assert (beds["192.0.2.10"]["status"], beds["192.0.2.10"]["silent_for_s"]) == ("silent", 7)
    assert beds["192.0.2.11"]["silent_for_s"] is None
    clock.t = T0 + 30                                   # no post since T0: both unknown
    beds = {c["source"]: c for c in _board(store, ledger, clock)["beds"]}
    assert [(c["status"], c["silent_for_s"]) for c in beds.values()] == [("unknown", 37), ("unknown", 30)]


def test_a_monitor_left_out_of_the_bodies_is_vanished_once_unknown_and_the_forwarders_silence_is_not():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading()),
                             device("192.0.2.12", reading())))
    clock.t = T0 + 10
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert _board(store, ledger, clock)["vanished"] == []                   # 10 s: not unknown yet
    clock.t = T0 + 16
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    assert _board(store, ledger, clock)["vanished"] == [
        {"source": "192.0.2.11", "bed_label": "B-2", "last_packet_at": _iso(T0 - 0.1), "last_report_at": _iso(T0)},
        {"source": "192.0.2.12", "bed_label": None, "last_packet_at": _iso(T0 - 0.1), "last_report_at": _iso(T0)},
    ]
    clock.t = T0 + 40                                   # the posts stop: .10 is unknown too, but the last body listed it
    assert [v["source"] for v in _board(store, ledger, clock)["vanished"]] == ["192.0.2.11", "192.0.2.12"]


def test_vanished_reaches_only_what_the_cards_reach():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading()),
                             device("192.0.2.12", reading())))
    clock.t = T0 + 16
    post(store, ledger, body(sent_at=clock.t))         # the hub lists none of them any more
    scoped = _board(store, ledger, clock, visible=lambda card: card["unit_id"] == "unit-1", show_unassigned=False)
    assert [c["source"] for c in scoped["beds"]] == ["192.0.2.10"] and scoped["unassigned"] == []
    assert [v["source"] for v in scoped["vanished"]] == ["192.0.2.10"]
    assert [v["source"] for v in _board(store, ledger, clock)["vanished"]] == ["192.0.2.10", "192.0.2.11", "192.0.2.12"]


def test_the_new_fields_name_no_patient():
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.11", reading())))
    clock.t = T0 + 16
    post(store, ledger, body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), sent_at=clock.t))
    out = _board(store, ledger, clock, occupants={"bed-b1": ["synth-p1"], "bed-b2": ["synth-p2"]})
    assert [set(v) for v in out["vanished"]] == [VANISHED_KEYS]
    assert "synth-p2" not in json.dumps(out["vanished"])
    for card in out["beds"]:
        assert all(set(ch) == {"parameter", "last_value_at"} for ch in card["channels_seen"])


# --- review fixes --------------------------------------------------------------------------------

def test_a_ledger_that_cannot_be_worded_leaves_the_board_exactly_as_it_was(caplog):
    # Review 1: the ledger is display memory; it never costs a viewer the strip. A time that cannot be
    # printed, on the LAST card shown, must not leave the cards before it half-worded either.
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading()), device("192.0.2.12", reading())))
    seen = ledger.view()
    broken = LedgerView(seen.started_at, {**seen.devices,
                                          "192.0.2.12": replace(seen.devices["192.0.2.12"], last_packet_at=float("inf"))})
    out = board_view(store.devices(clock.t), store.feed(clock.t), _table(), occupants=None, visible=lambda card: True,
                     patient_visible=lambda card: True, show_unassigned=True, now=clock.t, ledger=broken)
    assert out == _board(store, ledger, clock, with_ledger=False)
    assert "ledger" in caplog.text


def test_a_wall_clock_stepped_back_an_hour_leaves_no_time_in_the_future():
    # Review 2: as the store forgets what lies further ahead than any arrival may (`_expire`), the ledger
    # drops a channel time or a last packet that a stepped-back clock has put in the future — kept, they
    # would freeze a live channel and hide a stopped one for the hour. A time it cannot place is unknown.
    wall, mono = Clock(T0), Clock(5_000.0)
    _, store, ledger = lane(wall, mono)
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72), reading("spo2", 97, "%")),
                             device("192.0.2.11", reading())))
    wall.t -= 3600.0                                    # an NTP step or a VM restore
    mono.t += 1.0
    assert all((s.channels, s.last_packet_at) == ((), None) for s in ledger.view().devices.values())
    for step in range(1, 40):                           # 195 s of posts: hr goes on, spo2 and .11 have stopped
        wall.t += 5
        mono.t += 5
        post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=wall.t - 0.5)), sent_at=wall.t))
    seen = ledger.view().devices
    assert dict(seen["192.0.2.10"].channels) == {"hr": wall.t - 0.5}             # live, on the new clock
    assert seen["192.0.2.10"].last_packet_at == wall.t - 0.1
    assert (seen["192.0.2.11"].channels, seen["192.0.2.11"].last_packet_at) == ((), None)
    card = {c["source"]: c for c in _board(store, ledger, wall)["beds"]}["192.0.2.11"]
    assert (card["status"], card["last_packet_at"], card["silent_for_s"]) == ("unknown", None, None)


def test_a_valid_reading_the_clock_rule_lets_lead_is_seen_though_the_strip_withholds_it_for_now():
    # Review 3: a collector clock up to ARRIVAL_MAX_AHEAD_S ahead — the store takes the reading; the strip
    # shows it «old» until the API's clock reaches it (unchanged). The ledger counts it at once.
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=T0 + 1.5),
                                    reading("spo2", 97, "%", captured_at=T0 + 2.5))))   # 2.5 s: refused, «clock»
    strip = {p["parameter"]: p["state"] for p in store.devices()["192.0.2.10"].parameters}
    assert strip["hr"] == "old" and "spo2" not in strip
    assert dict(ledger.view().devices["192.0.2.10"].channels) == {"hr": T0 + 1.5}


def test_a_collector_clock_under_a_second_ahead_never_makes_a_live_channel_look_stale():
    # Review 3: hr is seen once on a true clock, then the collector's drifts 0.9 s ahead: each reading
    # 0.4 s old on it lands 0.5 s in the API's future. Seventy seconds on, hr must not read 60 s silent.
    clock, store, ledger = lane()
    post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=T0 - 0.4))))
    for step in range(1, 15):
        clock.t = T0 + 5 * step
        post(store, ledger, body(device("192.0.2.10", reading("hr", 72, captured_at=clock.t + 0.5)),   # 0.9 - 0.4
                                 sent_at=clock.t))
    last_post = clock.t
    clock.t += 1.2                                      # a board 1.2 s after the last post
    hr = next(ch for ch in _board(store, ledger, clock)["beds"][0]["channels_seen"] if ch["parameter"] == "hr")
    assert hr["last_value_at"] == _iso(last_post + 0.5)
    assert clock.t - (last_post + 0.5) < STALE_LIST_AFTER_S


def test_nbp_is_seen_at_its_measurement_time_or_untimed_at_its_packets():
    # Review 4: NBP's last value is the cuff's, not the packet that repeats it — the hub's `changed_at`, an
    # upper bound of the measurement, even once the board withholds it past two hours. Untimed (NBP-2) it
    # has no other time: its packet's. Three parts, one change, all valid, as the board's own rule.
    clock, store, ledger = lane()

    def triple(changed_at, values=(118, 79, 92), valid=True):
        return [reading(name, value, "mmHg", valid=valid, changed_at=changed_at) for name, value in zip(NBP_PARTS, values)]

    post(store, ledger, body(device("192.0.2.10", *triple(T0 - 600.0)),
                             device("192.0.2.11", *triple(None)),
                             device("192.0.2.12", *triple(T0 - 3 * 3600.0)),
                             device("192.0.2.13", *triple(T0 - 600.0, valid=False))))
    states = {s: v.parameters[-1]["state"] for s, v in store.devices().items()}
    assert states == {"192.0.2.10": "value", "192.0.2.11": "value_untimed", "192.0.2.12": "old", "192.0.2.13": "invalid"}
    seen = ledger.view().devices
    assert dict(seen["192.0.2.10"].channels) == {"nbp": T0 - 600.0}
    assert dict(seen["192.0.2.11"].channels) == {"nbp": T0 - 0.5}
    assert dict(seen["192.0.2.12"].channels) == {"nbp": T0 - 3 * 3600.0}
    assert dict(seen["192.0.2.13"].channels) == {}
