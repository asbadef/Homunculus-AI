"""How the worker paces its batches, and what it does with one the hub will never take.

Synthetic fixtures only.
"""
from test_infinity_transport import event, factory, inventory  # noqa: F401
from test_infinity_timing import Steps
from homunculus.edge.infinity_collector import forward_loop


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
