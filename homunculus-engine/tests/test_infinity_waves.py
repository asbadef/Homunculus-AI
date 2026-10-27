"""Lane C (dalga): the wave-block decoder and the hub's 20 s ring. Synthetic payloads only
(infinity_wave_packets.py): no capture, no monitor traffic, no patient values."""
import pytest

from infinity_wave_packets import ECG, PLETH, PRESSURE_ART, PRESSURE_P1, RESP, block, no_signal, packet, tick
from homunculus.edge.infinity_waves import WAVES, parse_waves


# --- the decoder -----------------------------------------------------------------------------------

@pytest.mark.parametrize("rate", [50, 100, 200, 250, 500])
def test_every_allowed_rate_decodes_with_rate_over_five_samples(rate):
    [found] = parse_waves(packet(block(ECG, rate, ms=240, device_s=77)))
    assert (found.rate, found.ms, found.device_s, found.wave_id) == (rate, 240, 77, ECG)
    assert len(found.samples) == rate // 5 and found.t_ms == 77_240


def test_the_four_waves_of_one_packet_decode_in_order_with_signed_samples():
    blocks = parse_waves(tick(1000, 40))
    assert [b.wave_id for b in blocks] == [ECG, PRESSURE_ART, PLETH, RESP]
    assert blocks[0].samples[0] == -200 and min(blocks[0].samples) < 0 < max(blocks[0].samples)
    assert blocks[1].samples == (4000,) * 20


def test_a_block_of_nothing_but_0x0001_is_no_signal_and_a_lone_1_is_data():
    assert parse_waves(packet(no_signal(ECG, 200)))[0].samples is None
    assert parse_waves(packet(block(ECG, 200, [1] * 39 + [2])))[0].samples[0] == 1


def test_decoding_stops_at_the_record_section_and_keeps_the_blocks_before_it():
    record_section = (72).to_bytes(2, "big") + bytes(70)            # what follows the blocks at 1/s
    blocks = parse_waves(packet(block(ECG, 200), block(RESP, 50), kind=0x0A, tail=record_section))
    assert [b.wave_id for b in blocks] == [ECG, RESP]


@pytest.mark.parametrize("broken", [
    block(ECG, 200, n=41),                    # n is not rate / 5
    block(ECG, 200, size=95),                 # len is not 14 + 2n
    block(ECG, 300, [0] * 60),                # not an allowed rate
    block(ECG, 200, ms=1000),                 # not a millisecond of a second
])
def test_a_malformed_first_block_yields_nothing(broken):
    assert parse_waves(packet(broken)) == []


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
