"""One synthetic admission, all the way through: Comed ADT -> bridge -> API -> board, and the
device query answered with the name in between. No network, no hardware."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.patient_identity import InMemoryIdentityStore
from homunculus.canonical import SignalCode
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.uplink import flush_once

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
A01 = (
    "MSH|^~\\&|COMED|HOSP|HOMUNCULUS|HOSP|20260904143000||ADT^A01|MSG1|P|2.5\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE^N||19800115|F\r"
    "PV1|1|I|YB^304^2\r"
)
QBP = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143100||QBP^Q22^QBP_Q21|C1|P|2.6\r"
    "QPD|IHE PDQ Query|C1|@PID.3.1^20239121~@PID3.4^EMR\r"
    "RCP|I|1^RD\r"
)
ORU = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143525||ORU^R01^ORU_R01|X1|P|2.6\r"
    "PID|1||20239121^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F|||20260904143525+0400\r"
)
A03 = A01.replace("ADT^A01", "ADT^A03").replace("20260904143000", "20260904180000")


def test_an_admission_names_the_card_the_reading_lands_on(tmp_path):
    mirror = IdentityMirror(tmp_path / "identity.db")
    client = TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False,
                                   identities=InMemoryIdentityStore()))
    with client:
        def send(resource: dict) -> None:
            assert client.post("/ingest", json=resource, headers=HEAD).status_code == 200

        bridge = EdgeBridge(send=send, mapping={"150456": SignalCode.SPO2}, identity=mirror)

        # 1. Comed admits the patient.
        bridge.handle_message(A01)
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["identity"]["display_name"] == "AYSE YILMAZ"
        assert card["identity"]["bed_label"] == "YB 304-2"
        assert card["latest"]["spo2"] is None

        # 2. The nurse types the protocol number; the device is told who that is.
        reply = bridge.answer_query(QBP)
        assert "PID|||20239121||YILMAZ^AYSE||19800115|F" in reply

        # 3. The reading lands on the same card.
        bridge.handle_message(ORU)
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["latest"]["spo2"] == 97.0
        assert card["identity"]["display_name"] == "AYSE YILMAZ"

        # 4. Discharge frees the bed but leaves the card until it is pruned.
        bridge.handle_message(A03)
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["identity"]["state"] == "discharged"
    mirror.close()


async def test_queued_adt_then_oru_drains_through_the_real_ingest_handler(tmp_path):
    """Regression: Patient used to get HTTP 400 and block every later reading."""
    buffer = SqliteBuffer(tmp_path / "outbox.db")
    bridge = EdgeBridge(send=buffer.append, mapping={"150456": SignalCode.SPO2})
    bridge.handle_message(A01)
    bridge.handle_message(ORU)
    assert buffer.depth() == 3
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False)) as client:
        def sender(resource):
            response = client.post("/ingest", json=resource, headers=HEAD)
            if response.status_code != 200:
                raise RuntimeError(f"HTTP {response.status_code}")
        assert await flush_once(buffer, sender=sender) == 3
        assert buffer.depth() == 0
        [card] = client.get("/patients", headers=HEAD).json()["patients"]
        assert card["identity"]["bed_label"] == "YB 304-2"
        assert card["latest"]["spo2"] == 97.0
    buffer.close()
