"""Synthetic transport evidence only: no purported Infinity payload fixtures."""
import json
import struct
import subprocess
import sys
from ipaddress import IPv4Address
from unittest.mock import MagicMock

import pytest

from homunculus.edge import infinity_discovery as discovery

DEVICE = "192.0.2.32"
GROUP = "239.1.2.3"


def row(stamp=1, src=DEVICE, dst=GROUP, proto=17, offset=0, more=0):
    ports = ["1234", "5678", "", ""] if proto == 17 else ["", "", "1234", "5678"]
    return "\t".join(map(str, [stamp, 80, src, dst, proto, *ports, offset, more, 80]))


def report(rows, mode="offline", devices=(DEVICE,), limit=100):
    return discovery.summarize("\n".join(rows), devices, mode=mode, limit=limit)


def test_multicast_evidence_never_becomes_clinical_data():
    result = report([row(1), row(2), row(4)])
    assert result["status"] == "protocol_unverified"
    assert not result["live_multicast_receipt_observed"]
    assert not result["infinity_protocol_verified"]
    assert not result["clinical_ingest_enabled"]
    assert not result["measurement_cadence_verified"]
    assert result["flows"][0]["mean_packet_gap_seconds"] == 1.5
    assert result["flows"][0]["max_packet_gap_seconds"] == 2
    assert report([row()], mode="live")["live_multicast_receipt_observed"]


def test_no_traffic_and_unicast_are_inconclusive():
    assert report([])["status"] == "network_unverified"
    result = report([row(dst="192.0.2.1", proto=6)])
    assert result["status"] == "network_unverified"
    assert result["flows"][0]["transport"] == "tcp"
    assert result["flows"][0]["mean_packet_gap_seconds"] is None


def test_13_sources_stay_separate_even_on_same_group():
    devices = tuple(f"192.0.2.{i}" for i in range(1, 14))
    result = report([row(src=ip) for ip in devices], devices=devices)
    assert len(result["flows"]) == 13
    assert not result["devices_without_observed_flows"]


def test_rejected_rows_never_echo_input():
    secret = "SYNTHETIC-PATIENT-CONTENT"
    result = report([secret, row(stamp="nan"), row(stamp="inf"), row(src=secret),
                     row(src="192.0.2.99"), row(offset=1), row(more=1)])
    assert secret not in json.dumps(result)
    assert result["malformed_rows"] == 4
    assert result["excluded_rows"] == 1
    assert result["fragmented_packets_excluded"] == 2
    assert not result["flows"]


@pytest.mark.parametrize("value,fragmented", [("False", 0), ("True", 1), ("0", 0), ("1", 1)])
def test_wireshark_boolean_versions(value, fragmented):
    result = report([row(more=value)])
    assert result["malformed_rows"] == 0
    assert result["fragmented_packets_excluded"] == fragmented


def test_backwards_capture_time_and_duplicate_timestamps_are_not_measurements():
    flow = report([row(10), row(8), row(8)])["flows"][0]
    assert flow["backwards_capture_timestamps"] == 1
    assert flow["packets"] == 3
    assert flow["observed_span_seconds"] == 2


def test_resource_bounds(monkeypatch):
    monkeypatch.setattr(discovery, "MAX_FLOWS", 1)
    result = report([row(), row(dst="239.1.2.4"), row(), row()], limit=3)
    assert len(result["flows"]) == 1
    assert result["overflow_rows"] == 2


@pytest.mark.parametrize("devices", [[], ["239.1.1.1"], ["0.0.0.0"], ["::1"],
                                    ["192.0.2.1 or ip"], [f"192.0.2.{i}" for i in range(1, 15)]])
def test_no_broad_or_injected_capture_filters(devices):
    with pytest.raises(ValueError):
        discovery.device_addresses(devices)


def test_commands_never_write_capture_files_or_request_payload():
    command = discovery.dumpcap_command("dumpcap", "eth0", (DEVICE,), 10, 100)
    assert command[command.index("-w") + 1] == "-"
    assert command[command.index("-s") + 1] == "128"
    assert "src host 192.0.2.32" in command[command.index("-f") + 1]
    read = discovery.tshark_command("tshark", "-", (DEVICE,), 100)
    assert "-w" not in read and "-i" not in read and "-n" in read
    assert not any(field in read for field in ("data", "udp.payload", "_ws.col.info"))


@pytest.mark.parametrize("failure", ["timeout", "error", "interrupt"])
def test_capture_processes_reaped_on_failure(monkeypatch, failure):
    producer, consumer = MagicMock(), MagicMock()
    producer.poll.return_value = consumer.poll.return_value = None
    producer.returncode = 0
    consumer.returncode = 1 if failure == "error" else 0
    consumer.communicate.return_value = (b"SYNTHETIC-SECRET", b"")
    if failure == "timeout":
        consumer.communicate.side_effect = subprocess.TimeoutExpired("tshark", 10)
    if failure == "interrupt":
        consumer.communicate.side_effect = KeyboardInterrupt
    monkeypatch.setattr(discovery.subprocess, "Popen", MagicMock(side_effect=[producer, consumer]))
    with pytest.raises(KeyboardInterrupt if failure == "interrupt" else discovery.DiscoveryError) as error:
        discovery.collect_headers(devices=(DEVICE,), interface="eth0", tshark="tshark", dumpcap="dumpcap")
    assert "SYNTHETIC-SECRET" not in str(error.value)
    producer.kill.assert_called_once()
    consumer.kill.assert_called_once()
    producer.stdout.close.assert_called()


def synthetic_pcap(vlan=False):
    payload = b"SYNTHETIC-PATIENT-CONTENT-NOT-A-REAL-INFINITY-PACKET"
    udp = struct.pack("!HHHH", 1234, 5678, 8 + len(payload), 0) + payload
    ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(udp), 1, 0, 64, 17, 0,
                     IPv4Address(DEVICE).packed, IPv4Address(GROUP).packed) + udp
    eth = bytes.fromhex("01005e010203020000000001")
    eth += bytes.fromhex("810000640800") if vlan else bytes.fromhex("0800")
    packet = eth + ip
    return (struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1)
            + struct.pack("<IIII", 1, 0, len(packet), len(packet)) + packet)


def synthetic_pcapng(vlan=False):
    packet = synthetic_pcap(vlan)[40:]

    def block(kind, body):
        length = len(body) + 12
        return struct.pack("<II", kind, length) + body + struct.pack("<I", length)

    section = block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    interface = block(1, struct.pack("<HHI", 1, 0, 65535))
    padded = packet + b"\x00" * (-len(packet) % 4)
    enhanced = block(6, struct.pack("<IIIII", 0, 0, 1_000_000, len(packet), len(packet)) + padded)
    return section + interface + enhanced


@pytest.mark.parametrize("vlan", [False, True])
@pytest.mark.parametrize("filetype", ["pcap", "pcapng"])
def test_real_tshark_with_synthetic_packet(tmp_path, vlan, filetype):
    try:
        tshark = discovery.find_tool("tshark")
    except discovery.DiscoveryError:
        pytest.skip("Wireshark not installed")
    path = tmp_path / f"synthetic.{filetype}"
    path.write_bytes(synthetic_pcap(vlan) if filetype == "pcap" else synthetic_pcapng(vlan))
    headers = discovery.collect_headers(devices=(DEVICE,), capture_file=str(path), tshark=tshark)
    assert "SYNTHETIC-PATIENT" not in headers
    result = discovery.summarize(headers, (DEVICE,), mode="offline", limit=20000)
    assert result["malformed_rows"] == 0
    assert result["flows"][0]["destination_port"] == 5678
    assert result["multicast_udp_observed"]
    assert not result["clinical_ingest_enabled"]


def test_real_tshark_reads_live_pipe_without_capture_file(monkeypatch):
    try:
        tshark = discovery.find_tool("tshark")
    except discovery.DiscoveryError:
        pytest.skip("Wireshark not installed")
    popen = subprocess.Popen

    def synthetic_producer(command, **kwargs):
        if command[0] == "synthetic-dumpcap":
            command = [sys.executable, "-c", f"import sys; sys.stdout.buffer.write({synthetic_pcap()!r})"]
        return popen(command, **kwargs)

    monkeypatch.setattr(discovery.subprocess, "Popen", synthetic_producer)
    headers = discovery.collect_headers(devices=(DEVICE,), interface="synthetic-only",
                                        tshark=tshark, dumpcap="synthetic-dumpcap")
    assert "SYNTHETIC-PATIENT" not in headers
    result = discovery.summarize(headers, (DEVICE,), mode="live", limit=20000)
    assert result["live_multicast_receipt_observed"]
    assert not result["infinity_protocol_verified"]
