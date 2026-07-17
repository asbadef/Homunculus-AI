# tests/test_edge_bridge.py
"""The on-prem edge bridge: store-and-forward resilience + HL7 -> FHIR for the cloud /ingest."""
from homunculus.edge.forwarder import StoreAndForward
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.gateway.hl7 import parse_hl7_oru


class _Link:
    """A fake uplink that can go down and can fail after N sends."""
    def __init__(self, up=True, fail_after=None):
        self.up = up
        self.fail_after = fail_after
        self.sent = []

    def send(self, payload):
        if not self.up:
            raise ConnectionError("uplink down")
        if self.fail_after is not None and len(self.sent) >= self.fail_after:
            raise ConnectionError("uplink dropped mid-stream")
        self.sent.append(payload)


def test_forwards_immediately_when_the_uplink_is_up():
    link = _Link()
    saf = StoreAndForward(sender=link.send)
    saf.submit({"n": 1})
    assert link.sent == [{"n": 1}]
    assert saf.pending == 0


def test_buffers_and_loses_nothing_when_the_uplink_is_down():
    link = _Link(up=False)
    saf = StoreAndForward(sender=link.send)
    saf.submit({"n": 1})
    assert link.sent == []
    assert saf.pending == 1


def test_backfills_in_order_on_reconnect():
    link = _Link(up=False)
    saf = StoreAndForward(sender=link.send)
    for i in (1, 2, 3):
        saf.submit({"n": i})
    assert saf.pending == 3
    link.up = True
    assert saf.flush() == 3
    assert link.sent == [{"n": 1}, {"n": 2}, {"n": 3}]
    assert saf.pending == 0


def test_stops_at_first_failure_preserving_order():
    # Uplink accepts one message then drops: the rest stay buffered, in order.
    link = _Link(fail_after=1)
    saf = StoreAndForward(sender=link.send)
    for i in (1, 2, 3):
        saf.submit({"n": i})
    assert link.sent == [{"n": 1}]
    assert saf.pending == 2  # 2 and 3 retained for the next flush


def test_hl7_observation_round_trips_through_fhir_for_the_cloud():
    # The bridge normalizes HL7, serializes to FHIR, and the cloud gateway parses it back
    # to the identical canonical Observation — no loss across the uplink.
    msg = "\r".join([
        r"MSH|^~\&|MON|ICU|HOM|HOSP|20260716143000||ORU^R01|M|P|2.5",
        "PID|1||bed-3^^^HOSP^MR",
        "OBX|1|NM|lactate||3.1|mmol/L|||||F|||20260716143000",
    ])
    obs = parse_hl7_oru(msg)[0]
    back = parse_fhir_observation(observation_to_fhir(obs))
    assert back == obs
