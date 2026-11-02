"""Lane C (dalga): the wave-block decoder and the hub's 20 s ring. Synthetic payloads only
(infinity_wave_packets.py): no capture, no monitor traffic, no patient values."""
import time

import pytest

from infinity_wave_packets import (
    ECG, ECG_OTHER, PLETH, PRESSURE_ART, PRESSURE_P1, RESP, at, block, no_signal, packet, tick,
)
from homunculus.edge.infinity_live import MAX_TRANSPORT_DELAY as LIVE_MAX_TRANSPORT_DELAY
from homunculus.edge.infinity_stream import Inventory, packet_event
from homunculus.edge.infinity_timing import Timings
from homunculus.edge.infinity_waves import (
    ANSWER_S, MAX_HELD, MAX_TRANSPORT_DELAY, RATES, WAVES, WINDOW_S, WaveBuffer, parse_waves,
)


# --- the decoder -----------------------------------------------------------------------------------

@pytest.mark.parametrize("rate", [50, 100, 200, 250, 500])
def test_every_allowed_rate_decodes_with_rate_over_five_samples(rate):
    [found] = parse_waves(packet(block(ECG, rate, ms=240, device_s=77)))
    assert (found.rate, found.ms, found.device_s, found.wave_id) == (rate, 240, 77, ECG)
    assert len(found.samples) == rate // 5 and found.t_ms == 77_240


def test_a_block_written_out_by_hand_from_the_protocol_table_decodes_to_its_fields():
    # not built by the helper: 200 Hz | len 94 | ms 240 | device_s 77 | wave 0x0103 | n 40 | 0 | 40 x -3
    payload = bytes(64) + bytes.fromhex("00c8005e00f00000004d01032800") + (-3).to_bytes(2, "big", signed=True) * 40
    [found] = parse_waves(payload)
    assert (found.rate, found.ms, found.device_s, found.wave_id) == (200, 240, 77, 0x0103)
    assert found.samples == (-3,) * 40


def test_the_four_waves_of_one_packet_decode_in_order_with_signed_samples():
    blocks = parse_waves(tick(1000, 40))
    assert [b.wave_id for b in blocks] == [ECG, PRESSURE_ART, PLETH, RESP]
    assert blocks[0].samples[0] == -200 and min(blocks[0].samples) < 0 < max(blocks[0].samples)
    assert blocks[1].samples == (4000,) * 20


def test_a_block_of_nothing_but_0x0001_is_no_signal_and_a_lone_1_is_data():
    assert parse_waves(packet(no_signal(ECG, 200)))[0].samples is None
    assert parse_waves(packet(block(ECG, 200, [1] * 39 + [2])))[0].samples[0] == 1


def test_a_bed08_packet_keeps_the_live_channel_and_the_two_silent_ones_in_order_at_one_time():
    # BED08: 0x0102 live, 0x0103 and 0x0104 all 0x0001, in one packet
    payload = packet(block(ECG_OTHER, 200, ms=240, device_s=77), no_signal(ECG, 200, ms=240, device_s=77),
                     no_signal(0x0104, 200, ms=240, device_s=77))
    blocks = parse_waves(payload)
    assert [b.wave_id for b in blocks] == [ECG_OTHER, ECG, 0x0104]
    assert [b.samples is None for b in blocks] == [False, True, True]
    assert {b.t_ms for b in blocks} == {77_240}


def test_an_unknown_wave_id_is_decoded_not_dropped_the_allow_list_is_the_apis_job():
    assert 0x7777 not in WAVES
    [found] = parse_waves(packet(block(0x7777, 100)))
    assert (found.wave_id, found.rate, len(found.samples)) == (0x7777, 100, 20)


def test_decoding_stops_at_the_record_section_and_keeps_the_blocks_before_it():
    record_section = (72).to_bytes(2, "big") + bytes(70)            # what follows the blocks at 1/s
    blocks = parse_waves(packet(block(ECG, 200), block(RESP, 50), kind=0x0A, tail=record_section))
    assert [b.wave_id for b in blocks] == [ECG, RESP]


def test_nothing_after_the_first_non_block_is_read_even_a_well_formed_block():
    payload = packet(block(ECG, 200), tail=bytes(2) + block(RESP, 50))      # two stray bytes, then a good block
    assert [b.wave_id for b in parse_waves(payload)] == [ECG]


@pytest.mark.parametrize("broken", [
    block(ECG, 200, n=41),                    # declares n = 41 over 40 samples: n != rate / 5 (and len != 14 + 2n)
    block(ECG, 200, size=95),                 # len is one more than 14 + 2n (and runs a byte past the data)
    block(ECG, 300, [0] * 60),                # n and len agree with each other: only the rate is not allowed
    block(ECG, 200, ms=1000),                 # only the millisecond is not one of a second
    block(ECG, 200, [0] * 41),                # n and len agree (41, 96) and fit the data: only n != rate / 5
    block(ECG, 200, size=90),                 # len short but inside the data: only len != 14 + 2n
])
def test_a_malformed_first_block_yields_nothing(broken):
    # A good block behind the bad one must stay unread: "stop" means stop, not "skip the bad
    # block by its declared length and carry on" — that refactor would pass without this.
    assert parse_waves(packet(broken, block(RESP, 50))) == []


def test_a_truncated_block_is_dropped_and_the_whole_ones_before_it_kept():
    payload = packet(block(ECG, 200), block(PRESSURE_ART, 100))
    assert [b.wave_id for b in parse_waves(payload[:-1])] == [ECG]


@pytest.mark.parametrize("garbage", [b"", bytes(63), bytes(64), bytes(500), b"\xff" * 300, None, "text", 42])
def test_anything_else_is_no_blocks_and_never_an_exception(garbage):
    assert parse_waves(garbage) == []


def test_the_catalogue_names_no_ecg_lead_and_calls_only_0x0301_art():
    ecg = {wave: entry for wave, entry in WAVES.items() if entry["kind"] == "ecg"}
    assert set(ecg) == {0x0102, 0x0103, 0x0104, 0x0122, 0x0124}
    assert all(entry["label"] is None for entry in ecg.values())
    pressure = {wave: entry for wave, entry in WAVES.items() if entry["kind"] == "pressure"}
    assert {wave: entry["label"] for wave, entry in pressure.items()} == {PRESSURE_ART: "ART", PRESSURE_P1: "P1"}
    assert all(entry["unit"] == "mmHg" and entry["scale"] == 1 / 40 for entry in pressure.values())
    assert {entry["kind"] for entry in WAVES.values()} == {"ecg", "pressure", "pleth", "resp"}


def test_every_catalogue_entry_has_the_same_keys_a_known_evidence_and_an_allowed_rate():
    for wave, entry in WAVES.items():
        assert set(entry) == {"kind", "label", "rate", "unit", "scale", "evidence"}, hex(wave)
        assert entry["evidence"] in {"structural", "unverified", "screen_scale"}, hex(wave)
        assert entry["rate"] in RATES, hex(wave)
        if entry["kind"] == "ecg":
            assert entry["label"] is None, hex(wave)
    assert [wave for wave, entry in WAVES.items() if entry["label"] == "ART"] == [PRESSURE_ART]


# --- the ring --------------------------------------------------------------------------------------

def inventory(count=2):
    return Inventory.parse({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": f"synthetic-{i}", "source": f"192.0.2.{i}", "group": f"239.20.1.{i}", "port": 2050}
        for i in range(1, count + 1)]})


INV = inventory()
BED = "192.0.2.1"


def event(payload, stamp, *, index=0, mode="live"):
    return packet_event(INV, INV.devices[index], payload, 2564, received_at=stamp, retain_payload=True, mode=mode)


def ring(now):
    return WaveBuffer(INV, clock=lambda: now[0])


def times(found, source=BED):
    return [(b["t"], b["id"]) for b in found[source]]


def test_blocks_come_back_in_device_time_order_whatever_order_they_arrived_in():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(1), ecg=True, pressure=False, pleth=False, resp=False), 1000.0),
                   event(tick(*at(0), ecg=True, pressure=False, pleth=False, resp=False), 1000.0)])
    cursor, found = waves.since([BED], 0)
    assert cursor == 2 and times(found) == [(1000.04, ECG), (1000.24, ECG)]
    assert [b["seq"] for b in found[BED]] == [2, 1]
    assert set(found[BED][0]) == {"seq", "t", "recv", "id", "rate", "samples"}
    assert found[BED][0]["recv"] == "1970-01-01T00:16:40.000Z"


def test_a_block_seen_twice_is_kept_once():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    waves.consume([event(tick(*at(0)), 1000.0)])               # another event id, the same blocks
    cursor, found = waves.since([BED], 0)
    assert cursor == 4 and len(found[BED]) == 4


def test_a_no_signal_block_travels_as_null():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(packet(no_signal(ECG, 200)), 1000.0)])
    assert waves.since([BED], 0)[1][BED][0]["samples"] is None


@pytest.mark.parametrize("stamp, mode, kept", [
    (1000.0 - MAX_TRANSPORT_DELAY + 0.1, "live", True),
    (1000.0 - MAX_TRANSPORT_DELAY, "live", False),             # an outbox replay after an outage
    (1000.0, "live", True),                                    # received this very instant
    (1000.5, "live", False),                                   # from the future
    (1000.0, "replay", False),
])
def test_only_a_live_packet_younger_than_three_seconds_is_added(stamp, mode, kept):
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), stamp, mode=mode)])
    assert bool(waves.since([BED], 0)[1][BED]) is kept
    assert waves.refused == (0 if kept else 1)


def test_the_ring_holds_twenty_seconds_and_an_answer_carries_ten():
    now = [0.0]
    waves = ring(now)
    for k in range(125):                                       # 25 s of packets, each fresh
        now[0] = 5000.0 + k * 0.2
        waves.consume([event(tick(*at(k), pressure=False, pleth=False, resp=False), now[0])])
    held = [entry[0] for entry in waves.devices[BED]]
    assert len(held) == 101                                    # 20.0 s of 200 ms packets, both ends held
    assert (held[-1] - held[0]) / 1000 == pytest.approx(WINDOW_S)
    found = waves.since([BED], 0)[1][BED]
    assert len(found) == 51                                    # 10.0 s of them
    assert found[-1]["t"] - found[0]["t"] == pytest.approx(ANSWER_S)


def test_after_twenty_seconds_without_data_a_monitor_answers_nothing():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    now[0] = 1000.0 + WINDOW_S + 0.1
    assert waves.since([BED], 0)[1][BED] == []


def test_the_cursor_is_one_counter_for_every_monitor():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0, index=0)])
    first, _ = waves.since([BED], 0)
    waves.consume([event(tick(*at(0)), 1000.0, index=1), event(tick(*at(1)), 1000.0, index=0)])
    cursor, found = waves.since([BED, "192.0.2.2"], first)
    assert (first, cursor) == (4, 12)
    # one device time: by wave id (0x0103, 0x0201, 0x0301, 0x1916)
    assert times(found) == [(1000.24, ECG), (1000.24, RESP), (1000.24, PRESSURE_ART), (1000.24, PLETH)]
    assert len(found["192.0.2.2"]) == 4


def test_a_cursor_from_before_a_restart_counts_as_zero():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    assert len(waves.since([BED], 10**9)[1][BED]) == 4


def test_a_monitor_clock_set_back_drops_what_was_held():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(5000, 40), 1000.0)])
    waves.consume([event(tick(100, 40), 1000.0)])
    assert {b["t"] for b in waves.since([BED], 0)[1][BED]} == {100.04}


def test_a_monitor_clock_set_back_by_fifteen_seconds_drops_what_was_held_too():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(5000, 40), 1000.0)])
    waves.consume([event(tick(4985, 40), 1000.0)])             # 15 s back: inside the ring, outside the answer
    assert {b["t"] for b in waves.since([BED], 0)[1][BED]} == {4985.04}


def test_a_block_exactly_ten_seconds_behind_the_newest_is_kept_and_served_beside_it():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(5000, 40), 1000.0)])
    waves.consume([event(tick(4990, 40), 1000.0)])             # exactly ANSWER_S back: reordering, not a clock
    assert {b["t"] for b in waves.since([BED], 0)[1][BED]} == {4990.04, 5000.04}


def test_a_set_back_of_at_most_ten_seconds_is_not_detected_and_self_heals():
    only_ecg = dict(pressure=False, pleth=False, resp=False)
    now = [1000.0]
    waves = ring(now)
    for k in range(50):                                        # 10 s on the old clock: 5000.04 ... 5009.84
        now[0] = 1000.0 + k * 0.2
        waves.consume([event(tick(*at(k, 5000), **only_ecg), now[0])])
    cursor, _ = waves.since([BED], 0)
    for k in range(25, 50):                                    # clock set back 5 s, phase kept: 5005.04 ... 5009.84
        now[0] += 0.2
        waves.consume([event(tick(*at(k, 5000), **only_ecg), now[0])])
        assert waves.since([BED], cursor) == (cursor, {BED: []})   # every key is held: nothing new for 5 s
    assert waves.refused == 0
    now[0] += 0.2
    waves.consume([event(tick(*at(50, 5000), **only_ecg), now[0])])    # the new clock passes the old newest
    assert times(waves.since([BED], cursor)[1]) == [(5010.04, ECG)]


def test_a_source_the_inventory_does_not_list_and_a_payloadless_event_are_ignored():
    now = [1000.0]
    waves = ring(now)
    assert waves.knows(BED) and not waves.knows("192.0.2.99")
    waves.consume([dict(event(tick(*at(0)), 1000.0), source_ip="192.0.2.99"),
                   dict(event(tick(*at(0)), 1000.0), payload_base64=None)])
    assert waves.cursor == 0 and waves.refused == 0


def test_a_refused_packet_in_a_batch_does_not_stop_the_others():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0),
                   event(tick(*at(1)), 1000.0 - MAX_TRANSPORT_DELAY),   # an outbox replay
                   event(tick(*at(2)), 1000.0)])
    cursor, found = waves.since([BED], 0)
    assert waves.refused == 1 and cursor == 8
    assert {b["t"] for b in found[BED]} == {1000.04, 1000.44}


def test_a_monitor_holds_at_most_max_held_blocks_whatever_it_sends():
    now = [1000.0]
    waves = ring(now)
    for first in range(0, 2000, 100):                          # 2,000 distinct wave ids in one fresh second
        waves.consume([event(packet(*[block(0x2000 + first + i, 50, ms=40, device_s=1000) for i in range(100)]), 1000.0)])
    assert waves.cursor == 2000
    assert len(waves.devices[BED]) == len(waves.keys[BED]) == MAX_HELD
    assert len(waves.since([BED], 0)[1][BED]) == MAX_HELD


def test_the_ring_uses_the_live_views_transport_delay():
    assert MAX_TRANSPORT_DELAY == LIVE_MAX_TRANSPORT_DELAY


# --- dalga-perf: `since` holds the lock only to copy ---------------------------------------------
# On the ward's hub every read built its dicts and lists under the buffer lock, so the packet
# handler's `consume` waited on it: one open panel took the handler from 38 to 146 ms. The lock is
# now held to prune and copy entry references; the answer is built outside it.

class TimedLock:
    """`threading.Lock` with a record of how long each holder kept it."""

    def __init__(self):
        import threading
        self.lock, self.held = threading.Lock(), []

    def __enter__(self):
        self.lock.acquire()
        self.entered = time.perf_counter()

    def __exit__(self, *exc):
        self.held.append(time.perf_counter() - self.entered)
        self.lock.release()


def full_ring(count=13):
    """`count` monitors, each at MAX_HELD entries of 200 Hz blocks, every one inside the 10 s answer."""
    now, inv = [1000.0], inventory(count)
    waves = WaveBuffer(inv, clock=lambda: now[0])
    waves.lock = TimedLock()
    for k in range(50):                                        # 50 ticks x 21 wave ids = 1050 > MAX_HELD
        now[0] = 1000.0 + k * 0.2
        device_s, ms = at(k)
        payload = packet(*[block(0x0100 + i, 200, ms=ms, device_s=device_s) for i in range(21)])
        waves.consume([packet_event(inv, inv.devices[i], payload, 2564, received_at=now[0], retain_payload=True,
                                    mode="live") for i in range(count)])
    return waves


def test_since_holds_the_lock_for_well_under_a_millisecond_with_a_full_ring_of_thirteen_monitors():
    waves = full_ring()
    sources = list(waves.devices)
    assert all(len(held) == MAX_HELD for held in waves.devices.values())
    waves.lock.held.clear()
    answers = [waves.since(sources, 0) for _ in range(3)]
    assert all(sum(len(blocks) for blocks in found.values()) == 13 * MAX_HELD for _, found in answers)
    assert len(waves.lock.held) == 3 and min(waves.lock.held) < 0.001, waves.lock.held


def test_since_records_the_lock_time_under_waves_lock_ms_when_given_a_timings():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0)), 1000.0)])
    timings = Timings()
    cursor, found = waves.since([BED], 0, timings=timings)
    assert cursor == 4 and len(found[BED]) == 4
    assert set(timings.snapshot()) == {"waves_lock_ms"} and timings.snapshot()["waves_lock_ms"][0] == 1
    assert waves.since([BED], 0) == (cursor, found)            # without one, nothing is recorded, the answer is the same


def test_the_answer_carries_the_rings_own_samples_without_a_copy_per_read():
    now = [1000.0]
    waves = ring(now)
    waves.consume([event(tick(*at(0), pressure=False, pleth=False, resp=False), 1000.0)])
    [entry] = waves.devices[BED]
    assert isinstance(entry[6], tuple) and len(entry[6]) == 40
    assert waves.since([BED], 0)[1][BED][0]["samples"] is entry[6]
