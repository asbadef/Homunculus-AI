"""Where a batch's time goes, measured on the real system. Synthetic fixtures only."""
import http.server
import threading

from fastapi.testclient import TestClient
import pytest

from test_infinity_transport import TOKEN, VIEW, event, factory, inventory, post, status  # noqa: F401
from homunculus.edge.infinity_collector import Sender, flush_once, forward_loop
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_timing import BUCKETS, HUB_NAMES, WORKER_NAMES, Timings, valid_snapshot


def test_a_timing_is_a_count_a_total_and_a_histogram_of_integers():
    timings = Timings()
    for value in (5, 60, 4000.4):
        timings.add("post_ms", value)
    # n, total, then one count per bucket: <=10, <=50, <=100, <=250, <=500, <=1000, <=3000, >3000
    assert timings.snapshot() == {"post_ms": [3, 4065, 1, 0, 1, 0, 0, 0, 0, 1]}
    # Cumulative: reading does not reset, so two readings any distance apart give an exact
    # average over the span between them, as the queue counters already do.
    assert timings.snapshot() == {"post_ms": [3, 4065, 1, 0, 1, 0, 0, 0, 0, 1]}
    assert len(BUCKETS) == 7


def test_a_timing_name_is_never_free_text():
    timings = Timings()
    with pytest.raises(ValueError):
        timings.add("Patient Name", 1)
    with pytest.raises(ValueError):
        timings.add("x" * 49, 1)


def test_the_hub_accepts_only_known_names_and_consistent_counts():
    good = {"post_ms": [2, 30, 1, 1, 0, 0, 0, 0, 0, 0]}
    assert valid_snapshot(good, WORKER_NAMES)
    assert not valid_snapshot({"patient_ms": [1, 1, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)
    assert not valid_snapshot({"post_ms": [2, 30, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)   # n != buckets
    assert not valid_snapshot({"post_ms": [1, -1, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)
    assert not valid_snapshot({"post_ms": [1, 1.5, 1, 0, 0, 0, 0, 0, 0, 0]}, WORKER_NAMES)
    assert not valid_snapshot({"post_ms": [1, 1, 1]}, WORKER_NAMES)
    assert not valid_snapshot([], WORKER_NAMES)
    assert WORKER_NAMES.isdisjoint({"patient", "name"}) and "lag_ms" in HUB_NAMES


def test_the_journal_says_where_its_time_goes(factory):
    timings = Timings()
    journal = factory(timings=timings)
    journal.append([event()])
    item = journal.pending()
    journal.ack([item[0]["id"]])
    journal.snapshot()
    seen = timings.snapshot()
    for name in ("append_ms", "pending_ms", "ack_ms", "snapshot_ms"):
        assert seen[name][0] == 1, name
    # The three suspects, each on its own line: the expiry scan (append, pending,
    # snapshot), the size query (append) and the commit (every write).
    assert seen["expire_ms"][0] == 3 and seen["capacity_ms"][0] == 1
    assert seen["commit_ms"][0] == 4 and seen["lock_wait_ms"][0] == 4 and seen["insert_ms"][0] == 1


def test_a_flush_reports_its_phases_and_its_size(factory):
    inv = inventory(3)
    timings = Timings()
    outbox, archive = factory(timings=timings), factory()
    c = TestClient(create_hub(inv, archive, TOKEN, VIEW, clock=lambda: 1000))
    class LocalSender:
        def post(self, path, body):
            return c.post(path, json=body, headers={"Authorization": "Bearer " + TOKEN}).json()
    outbox.append([event(inv, index=i) for i in range(3)])
    assert flush_once(outbox, LocalSender(), timings) == 3
    seen = timings.snapshot()
    assert seen["flush_ms"][0] == seen["post_ms"][0] == 1
    assert seen["batch_events"][:2] == [1, 3]
    assert flush_once(outbox, LocalSender(), timings) == 0
    assert timings.snapshot()["flush_ms"][0] == 1      # an empty queue is not a batch


class _Ack(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = b'{"ack": []}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def test_the_sender_times_the_connection_apart_from_the_request():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Ack)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        timings = Timings()
        sender = Sender(f"http://127.0.0.1:{server.server_address[1]}", TOKEN,
                        allow_loopback_http=True, timings=timings)
        assert sender.post("/v1/packets", {"events": []}) == {"ack": []}
        assert timings.snapshot()["connect_ms"][0] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_the_hub_times_each_batch_and_measures_delivery_lag(factory):
    inv = inventory(2)
    timings = Timings()       # one object for the journal and the hub, as the runner does
    c = TestClient(create_hub(inv, factory(timings=timings), TOKEN, VIEW, clock=lambda: 1000.0,
                              timings=timings))
    assert post(c, [event(inv, stamp=999.5, index=0), event(inv, stamp=998.0, index=1)]).status_code == 200
    seen = status(c)["timings"]
    for name in ("packets_ms", "body_ms", "validate_ms", "append_ms"):
        assert seen[name][0] == 1, name
    assert seen["batch_events"][:2] == [1, 2]
    # 500 ms and 2000 ms behind the hub's clock: both inside the 3 s live window.
    assert seen["lag_ms"][:2] == [2, 2500] and seen["lag_ms"][2 + 4] == 1 and seen["lag_ms"][2 + 6] == 1
    assert valid_snapshot(seen, HUB_NAMES)


def test_a_replayed_packet_is_not_counted_as_delivery_lag(factory):
    c = TestClient(create_hub(inventory(), factory(), TOKEN, VIEW, clock=lambda: 1000.0))
    assert post(c, [event(stamp=10.0, mode="replay")]).status_code == 200
    assert "lag_ms" not in status(c)["timings"]


def heartbeat(journal, **extra):
    return dict({"collector_id": "collector-a", "mode": "live", "queue": journal.snapshot(),
                 "clinical_forwarding": False}, **extra)


def test_the_hub_shows_the_worker_timings_and_still_takes_an_old_heartbeat(factory):
    journal = factory()
    c = TestClient(create_hub(inventory(), journal, TOKEN, VIEW))
    headers = {"Authorization": "Bearer " + TOKEN}
    timings = {"post_ms": [1, 12, 0, 1, 0, 0, 0, 0, 0, 0]}
    assert c.post("/v1/heartbeat", json=heartbeat(journal, timings=timings), headers=headers).status_code == 200
    assert status(c)["collector"]["heartbeat"]["timings"] == timings
    assert c.post("/v1/heartbeat", json=heartbeat(journal), headers=headers).status_code == 200
    bad = {"patient_ms": [1, 12, 0, 1, 0, 0, 0, 0, 0, 0]}
    assert c.post("/v1/heartbeat", json=heartbeat(journal, timings=bad), headers=headers).status_code == 400


class Steps:
    """A stop event whose waits return at once, and that ends the loop after `passes`."""
    def __init__(self, passes):
        self.left, self.flag = passes, False

    def is_set(self):
        self.left -= 1
        return self.flag or self.left < 0

    def wait(self, _):
        return self.flag

    def set(self):
        self.flag = True


def test_a_refused_heartbeat_does_not_hold_delivery_up(factory):
    # Before: the loop retried the heartbeat forever and never reached the queue, so a worker
    # deployed ahead of its hub stopped delivering altogether rather than only going unseen.
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv)])
    delivered = []
    class HubThatRefusesHeartbeats:
        def post(self, path, body):
            if path == "/v1/heartbeat":
                raise OSError("Receiver refused delivery.")
            delivered.extend(e["id"] for e in body["events"])
            return {"ack": [e["id"] for e in body["events"]]}
    forward_loop(outbox, HubThatRefusesHeartbeats(), inv, Steps(6), "live", timings=Timings())
    assert len(delivered) == 1 and outbox.snapshot()["rows"] == 0
    assert outbox.snapshot()["counters"]["forward_errors"] >= 1


def test_the_heartbeat_carries_the_worker_timings(factory):
    inv = inventory()
    outbox = factory()
    beats = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/heartbeat":
                beats.append(body)
            return {"ack": []}
    timings = Timings()
    timings.add("post_ms", 12)
    forward_loop(outbox, Hub(), inv, Steps(2), "live", timings=timings)
    assert beats and beats[0]["timings"]["post_ms"][:2] == [1, 12]


def _runner():
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location(
        "run_infinity_transport", Path(__file__).resolve().parents[1] / "scripts/run_infinity_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _environment(monkeypatch, tmp_path):
    import json as _json
    from cryptography.fernet import Fernet
    (tmp_path / "inventory.json").write_text(_json.dumps({
        "collector_id": "collector-a", "interface": "192.0.2.220/24",
        "devices": [{"id": "monitor-1", "source": "192.0.2.1", "group": "239.10.2.1", "port": 2050}]}))
    monkeypatch.setenv("INFINITY_STORAGE_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("INFINITY_COLLECTOR_TOKEN", TOKEN)
    monkeypatch.setenv("INFINITY_VIEWER_TOKEN", VIEW)


def test_the_runner_gives_the_hub_and_its_journal_one_timings_object(monkeypatch, tmp_path):
    runner = _runner()
    _environment(monkeypatch, tmp_path)
    seen = {}
    def serve(app, **_):
        # Read while "serving": the runner closes the journal once run() returns.
        response = TestClient(app).get("/v1/status", headers={"Authorization": "Bearer " + VIEW})
        seen.update(response.json()["timings"])
    monkeypatch.setattr(runner.uvicorn, "run", serve)
    monkeypatch.setattr("sys.argv", ["run", "hub", "--inventory", str(tmp_path / "inventory.json"),
                                     "--database", str(tmp_path / "archive.sqlite")])
    assert runner.main() == 0
    assert "snapshot_ms" in seen and "status_ms" in seen      # the journal's and the hub's own


def test_the_runner_gives_the_worker_one_timings_object(monkeypatch, tmp_path):
    import struct as _struct
    runner = _runner()
    _environment(monkeypatch, tmp_path)
    capture = tmp_path / "empty.pcap"
    capture.write_bytes(_struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 101))
    seen = {}
    def fake_forward(journal, sender, inventory, stop, mode, failure=None, timings=None):
        seen.update(journal=journal.timings, sender=sender.timings, loop=timings)
    monkeypatch.setattr(runner, "forward_loop", fake_forward)
    monkeypatch.setattr("sys.argv", ["run", "collector", "--inventory", str(tmp_path / "inventory.json"),
                                     "--database", str(tmp_path / "outbox.sqlite"),
                                     "--endpoint", "http://127.0.0.1:9", "--allow-loopback-http",
                                     "--replay", str(capture)])
    assert runner.main() == 0
    assert seen["loop"] is not None and seen["journal"] is seen["loop"] and seen["sender"] is seen["loop"]
