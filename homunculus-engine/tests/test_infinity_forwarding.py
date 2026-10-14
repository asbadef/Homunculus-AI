"""How the worker paces its batches, and what it does with one the hub will never take.

Synthetic fixtures only.
"""
import http.server
import threading

from fastapi.testclient import TestClient
import pytest

from test_infinity_transport import TOKEN, VIEW, client, event, factory, inventory, post, status  # noqa: F401
from test_infinity_timing import Steps
from homunculus.edge.infinity_collector import Refused, Sender, flush_once, forward_loop
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_stream import Inventory


class Recording(Steps):
    def __init__(self, passes, log):
        super().__init__(passes)
        self.log = log

    def wait(self, seconds):
        self.log.append(seconds)
        return self.flag


def test_a_part_batch_waits_a_moment_so_the_hub_gets_batches_not_a_trickle(factory):
    # Sent at once, a healthy queue left as a stream of one- and two-event requests, each
    # costing the hub a TLS handshake and a commit (84% of a core in late September).
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(3)])
    log = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                outbox.append([event(inv)])          # a packet arrives while the batch is out
                return {"ack": [e["id"] for e in body["events"]]}
            return {"ok": True}
    forward_loop(outbox, Hub(), inv, Recording(3, log), "live")
    assert log == [3, 0.25, 1, 0.25, 1, 0.25]


def test_a_full_batch_goes_straight_on_so_a_backlog_drains_at_full_speed(factory):
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(70)])
    log = []
    class Hub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                return {"ack": [e["id"] for e in body["events"]]}
            return {"ok": True}
    forward_loop(outbox, Hub(), inv, Recording(4, log), "live")
    assert log == [32, 32, 6, 0.25, 0.25]


def renamed(inv, new_id):
    """The same monitors at the same addresses, the first one under another name."""
    rows = [{"id": new_id if i == 0 else d.id, "source": d.source, "group": d.group, "port": d.port}
            for i, d in enumerate(inv.devices)]
    return Inventory.parse({"collector_id": inv.collector_id, "interface": inv.interface, "devices": rows})


def test_the_hub_knows_a_monitor_by_its_address_not_by_its_name(factory):
    # K1. On 22.09 a rename left 7,006 rows under the old name in the worker's queue; the hub
    # refused each with 400 and the queue never moved again.
    old = inventory()
    archive = factory()
    c = client(renamed(old, "BED-NEW"), archive)
    assert post(c, [event(old)]).status_code == 200
    row = status(c)["devices"][0]
    assert row["id"] == "BED-NEW" and row["packets"] == 1 and row["status"] == "streaming"


def test_an_address_the_hub_does_not_know_is_still_refused(factory):
    c = client(inventory(1), factory())
    response = post(c, [event(inventory(2), index=1)])
    # Refused, but not for good: the hub's inventory may simply not list it yet.
    assert response.status_code == 503 and response.status_code not in Refused.FINAL


def relay(c):
    """The worker's view of a test hub: a final refusal raises Refused, any other failure OSError."""
    class Relay:
        def post(self, path, body):
            response = c.post(path, json=body, headers={"Authorization": "Bearer " + TOKEN})
            if response.status_code in Refused.FINAL:
                raise Refused(response.status_code)
            if response.status_code != 200:
                raise OSError("Receiver refused delivery.")
            return response.json()
    return Relay()


def test_a_worker_clock_ahead_of_the_hub_is_retried_not_set_aside(factory):
    # Review of R2, I1: a hub that refused a batch from the future with 400 had every batch set
    # aside, good events included, for as long as the worker's clock ran more than 5 s ahead.
    inv = inventory()
    outbox, archive = factory(), factory()
    outbox.append([event(inv, stamp=1006.0) for _ in range(10)])
    c = client(inv, archive, now=lambda: 1000)
    with pytest.raises(OSError) as caught:
        flush_once(outbox, relay(c))
    assert not isinstance(caught.value, Refused)
    assert outbox.snapshot()["rows"] == 10 and "quarantined" not in outbox.snapshot()["counters"]
    c = client(inv, archive, now=lambda: 1006)                   # the clocks agree again
    assert flush_once(outbox, relay(c)) == 10 and archive.snapshot()["rows"] == 10


def test_an_address_the_hub_lacks_holds_the_queue_until_the_hub_learns_it(factory):
    # Review of R2, I1: a monitor added to the worker's inventory first had every mixed batch set
    # aside, all the other monitors' events with it. Inventory edits go hub first; until then the
    # queue waits instead of draining into the set-aside table.
    worker, hub = inventory(4), inventory(3)
    outbox, archive = factory(), factory()
    outbox.append([event(worker, index=i % 4) for i in range(8)])
    with pytest.raises(OSError) as caught:
        flush_once(outbox, relay(client(hub, archive)))
    assert not isinstance(caught.value, Refused)
    assert outbox.snapshot()["rows"] == 8 and archive.snapshot()["rows"] == 0
    c = client(worker, archive)                                  # the hub now lists monitor-4
    while flush_once(outbox, relay(c)):
        pass
    assert archive.snapshot()["rows"] == 8 and "quarantined" not in outbox.snapshot()["counters"]


def test_a_malformed_event_is_still_refused_for_good(factory):
    inv = inventory(2)
    c = client(inventory(1), factory())
    dirty = dict(event(inv), patient_id="MUST-NOT-BE-ACCEPTED")
    # Malformed beats "not now", whatever the order of the events in the batch.
    assert post(c, [event(inv, index=1), dirty]).status_code == 400
    assert post(c, [event(inv, stamp=1100), dirty]).status_code == 400


class _Status(http.server.BaseHTTPRequestHandler):
    code = 200

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = b'{"ack": []}'
        self.send_response(self.code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


@pytest.mark.parametrize("code, refused", [(400, True), (409, True), (413, True),
                                           (401, False), (500, False), (503, False), (507, False)])
def test_only_a_refusal_the_hub_would_repeat_forever_is_final(code, refused):
    handler = type("Handler", (_Status,), {"code": code})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        sender = Sender(f"http://127.0.0.1:{server.server_address[1]}", TOKEN, allow_loopback_http=True)
        with pytest.raises(OSError) as caught:
            sender.post("/v1/packets", {"events": []})
        assert isinstance(caught.value, Refused) is refused
    finally:
        server.shutdown()
        server.server_close()


class Refusing:
    def post(self, path, body):
        raise Refused(400)


def test_a_refused_batch_is_set_aside_and_the_queue_moves_on(factory):
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv), event(inv)])
    assert flush_once(outbox, Refusing()) == 0             # nothing delivered: the loop pauses (M4)
    state = outbox.snapshot()
    assert state["rows"] == 0 and state["counters"]["quarantined"] == 2
    assert outbox.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0] == 2
    outbox.append([event(inv)])
    class Accepting:
        def post(self, path, body):
            return {"ack": [e["id"] for e in body["events"]]}
    assert flush_once(outbox, Accepting()) == 1 and outbox.snapshot()["rows"] == 0


def test_a_set_aside_batch_is_followed_by_a_pause(factory):
    # Review of R2, M4: full batches set aside went out back to back, so a hub refusing
    # everything was sent some 30 TLS requests a second on a VM it shares with the clinical API.
    inv = inventory()
    outbox = factory()
    outbox.append([event(inv) for _ in range(70)])
    log = []
    class RefusingHub:
        def post(self, path, body):
            if path == "/v1/packets":
                log.append(len(body["events"]))
                raise Refused(400)
            return {"ok": True}
    forward_loop(outbox, RefusingHub(), inv, Recording(3, log), "live")
    assert log == [32, 0.25, 32, 0.25, 6, 0.25]


def test_a_transient_failure_keeps_the_batch_queued(factory):
    outbox = factory()
    outbox.append([event()])
    class Down:
        def post(self, path, body):
            raise OSError("Receiver refused delivery.")
    with pytest.raises(OSError):
        flush_once(outbox, Down())
    assert outbox.snapshot()["rows"] == 1 and "quarantined" not in outbox.snapshot()["counters"]


def test_set_aside_rows_expire_with_the_queue_retention(factory):
    now = [1000.0]
    outbox = factory(clock=lambda: now[0], retention=60)
    outbox.append([event()])
    flush_once(outbox, Refusing())
    now[0] += 61
    outbox.snapshot()
    assert outbox.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0] == 0


def test_the_22_09_wedge_cannot_recur(factory):
    # The worker's queue holds old-name and new-name rows; the hub knows only the new name.
    old = inventory()
    new = renamed(old, "BED-NEW")
    outbox, archive = factory(), factory()
    outbox.append([event(old) for _ in range(40)] + [event(new) for _ in range(10)])
    c = client(new, archive)
    class Local:
        def post(self, path, body):
            response = c.post(path, json=body, headers={"Authorization": "Bearer " + TOKEN})
            if response.status_code in Refused.FINAL:
                raise Refused(response.status_code)
            assert response.status_code == 200
            return response.json()
    while flush_once(outbox, Local()):
        pass
    assert outbox.snapshot()["rows"] == 0 and archive.snapshot()["rows"] == 50
    assert "quarantined" not in outbox.snapshot()["counters"]


def test_the_hub_accepts_the_quarantine_counter(factory):
    journal = factory()
    c = TestClient(create_hub(inventory(), journal, TOKEN, VIEW))
    queue = {"rows": 0, "encrypted_bytes": 0, "oldest_age_seconds": None, "retention_seconds": 900,
             "counters": {"accepted": 1, "quarantined": 2}}
    beat = {"collector_id": "collector-a", "mode": "live", "queue": queue, "clinical_forwarding": False}
    assert c.post("/v1/heartbeat", json=beat, headers={"Authorization": "Bearer " + TOKEN}).status_code == 200
