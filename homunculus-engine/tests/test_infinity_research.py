"""Entirely synthetic byte-layout tests; no device captures or personal values."""
import hashlib
import importlib.util
import json
import struct
import subprocess
import sys
from ipaddress import IPv4Address
from pathlib import Path

import pytest

from homunculus.edge import infinity_research as research
from homunculus.edge.infinity_discovery import DiscoveryError, find_tool

DEVICE = "192.0.2.10"
GROUP = "239.2.3.4"


def profile():
    return {"version": 1, "payload_length": 20, "allowed_capture_sha256": ["0" * 64],
            "guards": [{"offset": 0, "hex": "aabb"}],
            "fields": [{"name": "candidate_a", "offset": 4, "width": 2, "byteorder": "big"}]}


def body(value=12345):
    return b"\xaa\xbb\x00\x00" + struct.pack(">H", value) + b"\x00" * 14


def row(data=None, stamp=1, src=DEVICE, dst=GROUP, frag=0, more="False", cap=None):
    data = body() if data is None else data
    size = 42 + len(data)
    return "\t".join(map(str, [1, stamp, size if cap is None else cap, size, src, dst,
                                17, frag, more, 1234, 2050, 8 + len(data), data.hex()]))


def analyze(rows, include_series=True):
    return research.analyze_rows(rows, (DEVICE,), profile(), include_series=include_series)


def test_hypotheses_never_become_measurements_even_for_status_like_values():
    result = analyze([row(body(4)), row(body(1), stamp=2)])
    assert result["counters"]["candidate_packets"] == 2
    assert not result["clinical_ingest_enabled"] and not result["clinical_mapping_verified"]
    assert [r["raw_candidates"]["candidate_a"] for r in result["candidate_series"]] == [4, 1]
    assert all(r["clinical_validity"] == "unknown" for r in result["candidate_series"])
    assert "candidate_series" not in analyze([row()], include_series=False)


def test_wrong_length_guard_truncation_fragment_and_malformed_input_are_rejected():
    secret = "SYNTHETIC-IDENTIFIER-NEVER-ECHO"
    result = analyze([row(body() + b"\x00"), row(b"\xff" * 20), row(cap=50),
                      row(frag=1), row(more="True"), row(stamp="nan"), secret,
                      row(src="192.0.2.11")])
    assert result["counters"] == {"input_rows": 8, "profile_length_mismatch": 1,
                                  "profile_guard_mismatch": 1, "truncated": 1,
                                  "fragmented": 2, "malformed": 2, "excluded_source": 1}
    assert result["candidate_series"] == []
    assert secret not in json.dumps(result)


def test_streams_are_separate_and_replay_anomalies_are_only_metadata():
    result = analyze([row(stamp=10), row(stamp=9), row(dst="239.2.3.5")])
    assert len(result["streams"]) == 2
    assert result["streams"][0]["duplicate_payloads"] == 1
    assert result["streams"][0]["backwards_capture_timestamps"] == 1
    assert result["counters"]["candidate_packets"] == 3


@pytest.mark.parametrize("update", [
    {"payload_length": True}, {"version": True}, {"allowed_capture_sha256": []},
    {"guards": []}, {"guards": [{"offset": 19, "hex": "aabb"}]},
    {"fields": [{"name": "candidate", "offset": 19, "width": 2, "byteorder": "big"}]},
    {"fields": [{"name": "arbitrary\ncontent", "offset": 4, "width": 2, "byteorder": "big"}]},
])
def test_profile_bounds(update):
    value = profile()
    value.update(update)
    with pytest.raises(research.ResearchError, match="Invalid bounded"):
        research.validate_profile(value)


def test_row_bound_fails_instead_of_publishing_partial_results(monkeypatch):
    monkeypatch.setattr(research, "MAX_ROWS", 1)
    with pytest.raises(research.ResearchError, match="row limits"):
        analyze([row(), row()])


def capture_bytes(vlan=False, pcapng=False):
    data = body()
    udp = struct.pack("!HHHH", 1234, 2050, len(data) + 8, 0) + data
    ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(udp), 0, 0, 64, 17, 0,
                     IPv4Address(DEVICE).packed, IPv4Address(GROUP).packed) + udp
    ethernet = b"\x02" * 12 + (b"\x81\x00\x00\x07\x08\x00" if vlan else b"\x08\x00") + ip
    if not pcapng:
        return (struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
                + struct.pack("<IIII", 1, 0, len(ethernet), len(ethernet)) + ethernet)

    def block(kind, contents):
        length = 12 + len(contents)
        return struct.pack("<II", kind, length) + contents + struct.pack("<I", length)

    return (block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
            + block(1, struct.pack("<HHI", 1, 0, 65535))
            + block(6, struct.pack("<IIIII", 0, 0, 1000000, len(ethernet), len(ethernet))
                    + ethernet + b"\x00" * (-len(ethernet) % 4)))


@pytest.mark.parametrize("vlan", [False, True])
@pytest.mark.parametrize("pcapng", [False, True])
def test_actual_tshark_synthetic_captures(tmp_path, vlan, pcapng):
    try:
        executable = find_tool("tshark")
    except DiscoveryError:
        pytest.skip("Wireshark unavailable")
    path = tmp_path / "synthetic.pcapng"
    path.write_bytes(capture_bytes(vlan, pcapng))
    spec = profile()
    spec["allowed_capture_sha256"] = [hashlib.sha256(path.read_bytes()).hexdigest()]
    result = research.analyze_capture(path, (DEVICE,), spec, include_series=True, tshark=executable)
    assert result["counters"] == {"input_rows": 1, "candidate_packets": 1}
    assert result["candidate_series"][0]["raw_candidates"] == {"candidate_a": 12345}


def test_hash_mismatch_prevents_reader_start(tmp_path, monkeypatch):
    path = tmp_path / "synthetic.pcap"
    path.write_bytes(capture_bytes())
    monkeypatch.setattr(research, "read_rows", lambda *a, **k: pytest.fail("reader must not run"))
    with pytest.raises(research.ResearchError, match="hash is not allowed"):
        research.analyze_capture(path, (DEVICE,), profile())


def test_raw_ipv4_vm_capture_is_not_silently_filtered_by_protocol_allowlist(tmp_path):
    from homunculus.edge.infinity_discovery import collect_headers
    try:
        executable = find_tool("tshark")
    except DiscoveryError:
        pytest.skip("Wireshark unavailable")
    ethernet_capture = capture_bytes()
    ip = ethernet_capture[24 + 16 + 14:]
    raw_capture = (struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 101)
                   + struct.pack("<IIII", 1, 123456, len(ip), len(ip)) + ip)
    path = tmp_path / "synthetic-raw-ip.pcap"
    path.write_bytes(raw_capture)
    spec = profile()
    spec["allowed_capture_sha256"] = [hashlib.sha256(raw_capture).hexdigest()]
    result = research.analyze_capture(path, (DEVICE,), spec, include_series=True, tshark=executable)
    assert result["counters"] == {"input_rows": 1, "candidate_packets": 1}
    assert result["candidate_series"][0]["raw_candidates"] == {"candidate_a": 12345}
    headers = collect_headers(devices=(DEVICE,), capture_file=str(path), tshark=executable)
    assert len(headers.strip().splitlines()) == 1
    assert DEVICE in headers and "2050" in headers


def test_mutated_capture_is_rejected_and_reader_closed(tmp_path, monkeypatch):
    path = tmp_path / "synthetic.pcap"
    path.write_bytes(capture_bytes())
    spec = profile()
    spec["allowed_capture_sha256"] = [research.file_hash(path)]
    closed = []

    def rows(*args, **kwargs):
        try:
            yield row()
            path.write_bytes(b"synthetic changed input")
        finally:
            closed.append(True)

    monkeypatch.setattr(research, "read_rows", rows)
    with pytest.raises(research.ResearchError, match="changed during"):
        research.analyze_capture(path, (DEVICE,), spec)
    assert closed


def test_watchdog_reaps_stalled_subprocess(monkeypatch):
    popen = subprocess.Popen
    children = []

    def stall(*args, **kwargs):
        child = popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(research, "find_tool", lambda *a: "synthetic-tshark")
    monkeypatch.setattr(research.subprocess, "Popen", stall)
    with pytest.raises(research.ResearchError, match="timed out"):
        list(research.read_rows(Path("synthetic-only"), (DEVICE,), timeout=0.1))
    assert children[0].poll() is not None


def test_report_rejects_repository_output(tmp_path):
    (tmp_path / ".git").mkdir()
    with pytest.raises(research.ResearchError, match="outside any repository"):
        research.write_report(tmp_path / "sensitive.json", {})
    assert not (tmp_path / "sensitive.json").exists()


def test_writer_uses_exclusive_creation(monkeypatch):
    modes = []

    def exists(path):
        return False

    def open_path(path, mode, **kwargs):
        modes.append(mode)
        raise FileExistsError

    monkeypatch.setattr(Path, "exists", exists)
    monkeypatch.setattr(Path, "is_dir", lambda p: True)
    monkeypatch.setattr(Path, "open", open_path)
    with pytest.raises(FileExistsError):
        research.write_report(Path("unused.json"), {})
    assert modes == ["x"]


def test_thirteen_source_streams_do_not_merge():
    devices = tuple(f"192.0.2.{i}" for i in range(1, 14))
    result = research.analyze_rows([row(body(i + 1000), src=ip) for i, ip in enumerate(devices)],
                                   devices, profile(), include_series=True)
    assert len(result["streams"]) == 13
    assert len({s["source_ip"] for s in result["streams"]}) == 13
    assert all(s["candidate_statistics"]["candidate_a"]["distinct"] == 1 for s in result["streams"])


def test_cli_stdout_contains_no_candidate_values_or_paths(tmp_path, monkeypatch, capsys):
    script = Path(__file__).parents[1] / "scripts" / "analyze_infinity_capture.py"
    spec = importlib.util.spec_from_file_location("research_cli_for_test", script)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    path = tmp_path / "SYNTHETIC-PRIVATE-PROFILE.json"
    path.write_text("{}", encoding="utf-8")
    report = {"counters": {"candidate_packets": 1}, "candidate_series": [123456789]}
    saved = []
    monkeypatch.setattr(cli, "analyze_capture", lambda *a, **k: report)
    monkeypatch.setattr(cli, "write_report", lambda p, r: saved.append(r))
    assert cli.main(["--read", "synthetic", "--profile", str(path), "--device", DEVICE,
                     "--output", "unused.json"]) == 0
    output = capsys.readouterr().out
    assert "123456789" not in output and "SYNTHETIC-PRIVATE" not in output
    assert saved == [report]


def test_schema_validation_remains_active_under_optimized_python():
    command = [sys.executable, "-O", "-c",
               "from homunculus.edge.infinity_research import validate_profile, ResearchError; "
               "validate_profile({'version': 1, 'payload_length': -1})"]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert result.returncode != 0
    assert b"Invalid bounded research profile" in result.stderr
