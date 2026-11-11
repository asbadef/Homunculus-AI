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
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_shadow import (
    FORGET_AFTER_S, LEDGER_KEEP_S, MAX_DEVICES, NBP_PARTS, SCHEMA, STALE_LIST_AFTER_S, STALE_LIST_UNTIL_S, FeedLedger,
    ShadowStore, reported_sources,
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


def test_only_a_value_the_board_showed_moves_a_channels_time():
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
