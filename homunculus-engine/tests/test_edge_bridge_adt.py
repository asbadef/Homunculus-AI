"""ADT reaching the bridge: mirrored locally, forwarded upstream, counted separately.

Synthetic names throughout.
"""
import sqlite3

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.identity import IdentityMirror
from homunculus.gateway.fhir import GatewayError

A01 = (
    "MSH|^~\\&|COMED|HOSP|HOMUNCULUS|HOSP|20260904143000||ADT^A01|MSG1|P|2.5\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE^N||19800115|F\r"
    "PV1|1|I|YB^304^2\r"
)
ORU = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143525||ORU^R01^ORU_R01|X1|P|2.6\r"
    "PID|1||20239121^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F|||20260904143525\r"
)
QBP = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143000||QBP^Q22^QBP_Q21|C1|P|2.6\r"
    "QPD|IHE PDQ Query|C1|@PID.3.1^20239121~@PID3.4^EMR\r"
    "RCP|I|1^RD\r"
)


def make(tmp_path):
    sent: list[dict] = []
    mirror = IdentityMirror(tmp_path / "identity.db")
    bridge = EdgeBridge(send=sent.append, mapping={"150456": SignalCode.SPO2}, identity=mirror)
    return bridge, sent, mirror


def test_an_adt_is_forwarded_as_two_resources_and_counted_apart_from_readings(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    assert bridge.handle_message(A01) == []          # an ADT yields no observations
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter"]
    assert sent[0]["identifier"][0]["value"] == "20239121"
    assert (bridge.stats.adt, bridge.stats.messages, bridge.stats.rejected) == (1, 1, 0)
    mirror.close()


def test_an_adt_lands_in_the_mirror_so_the_next_query_carries_the_name(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    bridge.handle_message(A01)
    reply = bridge.answer_query(QBP)
    assert "PID|||20239121||YILMAZ^AYSE||19800115|F" in reply
    assert bridge.stats.queries == 1
    mirror.close()


def test_readings_still_flow_and_are_unaffected(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    observations = bridge.handle_message(ORU)
    assert len(observations) == 1 and observations[0].patient_id == "20239121"
    assert bridge.stats.adt == 0
    mirror.close()


def test_an_adt_without_an_id_is_rejected_and_nothing_is_forwarded(tmp_path):
    bridge, sent, mirror = make(tmp_path)
    with pytest.raises(GatewayError, match="PID-3"):
        bridge.handle_message(A01.replace("20239121^^^COMED^PI", "^^^COMED^PI"))
    assert sent == [] and bridge.stats.rejected == 1
    mirror.close()


def test_a_bridge_without_a_mirror_still_forwards_the_adt(tmp_path):
    """The mirror is an optimisation for the device; the upstream record is the point."""
    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append)
    bridge.handle_message(A01)
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter"]
    assert bridge.answer_query(QBP).count("PID|||20239121|||||") == 1


def test_a_mirror_that_cannot_be_written_does_not_stop_the_record(tmp_path):
    """A local disk fault must cost the device its name, never the board its patient."""
    class Broken:
        def upsert(self, _identity):
            raise sqlite3.OperationalError("attempt to write a readonly database")

        def get(self, _patient_id):
            return None

    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append, identity=Broken())
    bridge.handle_message(A01)
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter"]
    assert bridge.stats.adt == 1


def test_an_adt_trigger_we_do_not_act_on_is_acknowledged_not_nakked(tmp_path):
    """A31 (merge), pre-admits, cancels, ... are outside the seven we act on. The module's own
    contract is to ignore them, not guess -- and falling through to the ORU parser here would NAK
    them instead, which is exactly what makes a HIS interface engine suspend the whole feed."""
    bridge, sent, mirror = make(tmp_path)
    a05 = A01.replace("ADT^A01", "ADT^A05")
    assert bridge.handle_message(a05) == []
    assert sent == []
    assert (bridge.stats.rejected, bridge.stats.adt_ignored) == (0, 1)
    mirror.close()


def test_a_send_failing_partway_through_is_counted_before_it_propagates(tmp_path):
    """Patient delivered, Encounter not (or vice versa): the exception must still surface
    somewhere, or the message becomes invisible to every counter."""
    calls: list[dict] = []

    def flaky(resource: dict) -> None:
        calls.append(resource)
        if len(calls) == 2:
            raise RuntimeError("uplink dropped mid-send")

    bridge = EdgeBridge(send=flaky)
    with pytest.raises(RuntimeError, match="uplink dropped"):
        bridge.handle_message(A01)
    assert (bridge.stats.rejected, bridge.stats.adt) == (1, 0)


def test_a_stale_adt_is_still_forwarded_but_counted_separately(tmp_path):
    """The mirror refusing an older message must not be silently dropped -- upstream still gets
    it (its own ordering rule applies, and a resend is idempotent), but the refusal is counted."""
    bridge, sent, mirror = make(tmp_path)
    newer = A01.replace("20260904143000||ADT^A01", "20260904150000||ADT^A01")
    bridge.handle_message(newer)
    bridge.handle_message(A01)   # same patient, an older message arriving after the newer one
    assert (bridge.stats.adt, bridge.stats.adt_stale) == (2, 1)
    assert [r["resourceType"] for r in sent] == ["Patient", "Encounter", "Patient", "Encounter"]
    mirror.close()
