import functools
import subprocess
import sys
import threading

import pytest
from fastapi.testclient import TestClient

from homunculus.edge import infinity_preview as preview
from homunculus.edge.infinity_discovery import DiscoveryError, find_tool
from test_infinity_research import DEVICE, body, capture_bytes, profile, row


def spec():
    value = profile()
    value["fields"] = [{"name": name, "offset": 4 + i * 2, "width": 2, "byteorder": "big"}
                       for i, name in enumerate(preview.NAMES)]
    return preview.preview_profile(value)


def values():
    return dict(zip(preview.NAMES, [123, 456, 789, 101]))


def test_stale_expiry_uses_arrival_clock_and_removes_numbers():
    clock = [0]
    state = preview.PreviewState("live", DEVICE, clock=lambda: clock[0])
    state.publish(values(), 100, b"one")
    assert state.snapshot()["raw_candidates"] == values()
    clock[0] = 3
    result = state.snapshot()
    assert result["status"] == "stale" and result["raw_candidates"] == {}
    assert not result["clinical_ingest_enabled"]


def test_duplicate_and_out_of_order_packets_do_not_refresh_freshness():
    clock = [0]
    state = preview.PreviewState("live", DEVICE, clock=lambda: clock[0])
    state.publish(values(), 100, b"one")
    clock[0] = 2
    assert not state.publish(values(), 101, b"one")
    assert not state.publish(values(), 99, b"two")
    clock[0] = 3
    result = state.snapshot()
    assert result["status"] == "stale" and result["raw_candidates"] == {}
    assert result["duplicate_payloads"] == result["out_of_order_packets"] == 1
    assert state.publish(values(), 102, b"three")
    assert state.snapshot()["status"] == "streaming"


def test_parser_requires_source_full_packet_guards_and_correct_shape():
    state = preview.PreviewState("live", DEVICE)
    preview.consume_row(state, spec(), row())
    assert state.snapshot()["raw_candidates"]["hr_candidate"] == 12345
    preview.consume_row(state, spec(), row(body()[:10], stamp=2))
    assert state.snapshot()["accepted_packets"] == 1
    preview.consume_row(state, spec(), row(b"\xff" * 20, stamp=3))
    assert state.snapshot()["status"] == "unsupported"
    assert state.snapshot()["raw_candidates"] == {}
    preview.consume_row(state, spec(), row(stamp=4, src="192.0.2.11"))
    assert state.snapshot()["accepted_packets"] == 1
    preview.consume_row(state, spec(), row(stamp=5, cap=50))
    assert state.snapshot()["raw_candidates"] == {}


def test_invalid_raw_values_clear_state():
    state = preview.PreviewState("live", DEVICE)
    assert not state.publish({**values(), "hr_candidate": float("nan")}, 1, b"one")
    assert state.snapshot()["raw_candidates"] == {}


def test_preview_http_is_loopback_host_local_origin_and_no_store():
    state = preview.PreviewState("replay", DEVICE)
    state.publish(values(), 100, b"one")
    with TestClient(preview.create_preview_app(state), base_url="http://127.0.0.1:8765") as client:
        response = client.get("/state", headers={"Origin": "http://127.0.0.1:5173"})
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json()["mode"] == "replay"
        assert client.get("/state", headers={"Origin": "https://untrusted.invalid"}).status_code == 403
        assert client.get("/state", headers={"Host": "rebind.invalid"}).status_code == 400
        assert client.post("/ingest", json={}).status_code == 404
    assert state.snapshot()["status"] == "ended"


def test_replay_waits_for_browser_and_clears_at_end(monkeypatch):
    state = preview.PreviewState("replay", DEVICE)
    stop, ready = threading.Event(), threading.Event()
    ready.set()
    published = []
    publish = state.publish

    def push(v, stamp, fingerprint):
        published.append(stamp)
        publish(v, stamp, fingerprint)
        if len(published) == 2:
            stop.set()

    monkeypatch.setattr(state, "publish", push)
    rows = [{"frame_number": i, "capture_epoch": stamp, "raw_candidates": values()}
            for i, stamp in enumerate([1, 1.001])]
    preview.replay_source(state, stop, ready, rows)
    assert published == [1, 1.001]
    assert state.snapshot()["status"] == "ended"
    assert state.snapshot()["raw_candidates"] == {}


def test_real_live_pipe_with_synthetic_producer_no_file(monkeypatch):
    try:
        tshark = find_tool("tshark")
    except DiscoveryError:
        pytest.skip("Wireshark unavailable")
    popen = subprocess.Popen
    children = []
    commands = []

    def launch(command, **kwargs):
        commands.append(command)
        if command[0] == "synthetic-dumpcap":
            command = [sys.executable, "-c", f"import sys; sys.stdout.buffer.write({capture_bytes()!r})"]
        process = popen(command, **kwargs)
        children.append(process)
        return process

    monkeypatch.setattr(preview, "find_tool", lambda name: tshark if name == "tshark" else "synthetic-dumpcap")
    monkeypatch.setattr(preview.subprocess, "Popen", launch)
    state = preview.PreviewState("live", DEVICE)
    preview.live_source(state, threading.Event(), threading.Event(), spec(), "synthetic-only", 1)
    result = state.snapshot()
    assert result["accepted_packets"] == 1 and result["status"] == "ended"
    assert result["raw_candidates"] == {}
    assert commands[0][commands[0].index("-w") + 1] == "-"
    assert all(process.poll() is not None for process in children)


def test_application_shutdown_stops_source():
    finished = threading.Event()

    def source(state, stop, ready):
        stop.wait(10)
        finished.set()

    state = preview.PreviewState("live", DEVICE)
    with TestClient(preview.create_preview_app(state, source), base_url="http://localhost"):
        pass
    assert finished.is_set()
