"""Lane C (dalga): the wave-block decoder and the hub's 20 s ring. Synthetic payloads only
(infinity_wave_packets.py): no capture, no monitor traffic, no patient values."""
import pytest

from infinity_wave_packets import (ECG, ECG_OTHER, PLETH, PRESSURE_ART, PRESSURE_P1, RESP, block, no_signal,
                                   packet, tick)
from homunculus.edge.infinity_waves import RATES, WAVES, parse_waves


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
