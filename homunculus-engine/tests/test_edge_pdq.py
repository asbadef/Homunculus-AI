"""Patient-demographics query (QBP^Q22) responder.

Welch Allyn NCE forwards the patient id a clinician types or scans on a Connex Spot as an IHE PDQ
query to its "patient query" host. If nothing answers, the id is never *validated* and NCE's ORU
rendering emits PID-3 as ^^^X^PI — the reading arrives without a patient. NCE's own query sheet
accepts a response that contains MSA|AA and a PID segment (TransformSheets/Host1/
nce.hl7.patient.query.xsl, seen on the ward 2026-09-04), so the bridge answers with exactly that,
echoing the queried id and nothing else: no demographics are invented.
"""
import asyncio
import sqlite3

import pytest

from homunculus.edge.mllp import CR, FS, VT, serve_mllp
from homunculus.edge.pdq import patient_query_response

# The shape NCE sent on the ward (ids masked): QPD-3 = @PID.3.1^<id>~@PID3.4^X
QBP = (
    "MSH|^~\\&|NCE|HOSP|EMR|HIS|20260903160900||QBP^Q22^QBP_Q21|20260903160900123|P|2.6|||AL|NE\r"
    "QPD|IHE PDQ Query|20260903160900123|@PID.3.1^123456A~@PID3.4^X\r"
    "RCP|I|1^RD\r"
)
ORU = (
    "MSH|^~\\&|NCE|HOSP|EMR|HIS|20260903160934||ORU^R01^ORU_R01|X1|P|2.5\r"
    "PID|||123456A\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F\r"
)


def segments(message: str) -> dict[str, list[str]]:
    return {seg.split("|", 1)[0]: seg.split("|") for seg in message.split("\r") if seg}


def test_a_pdq_query_is_answered_with_the_queried_id_and_nothing_else():
    reply = patient_query_response(QBP)
    assert reply is not None
    seg = segments(reply)
    assert seg["MSH"][8].startswith("RSP^K22")
    assert seg["MSH"][2:6] == ["EMR", "HIS", "NCE", "HOSP"]          # sender and receiver swapped
    assert seg["MSA"][1:3] == ["AA", "20260903160900123"]            # accepted, control id echoed
    assert seg["QAK"][1:3] == ["20260903160900123", "OK"]
    assert seg["QPD"][3] == "@PID.3.1^123456A"
    assert seg["PID"][3] == "123456A"
    # Field-complete like the vendor's own sample (PID|||id||name||dob|sex): NCE's sheets cut
    # fields out with substring-before(…,'|'), which returns EMPTY when the delimiter after a
    # field is missing — a PID that ends right after the id lost the id on the ward (2026-09-04).
    # The extra fields are present but empty: no name, no DOB, no sex is ever invented.
    assert len(seg["PID"]) == 9
    assert seg["PID"][4:] == [""] * 5
    assert reply.count("PID|||123456A|||||\r") == 1     # id, then five empty fields


def test_the_id_is_found_whether_nce_writes_pid_3_1_or_pid3_1():
    variant = QBP.replace("@PID.3.1^123456A", "@PID3.1^Y-77")
    assert segments(patient_query_response(variant))["PID"][3] == "Y-77"


def test_a_query_without_an_id_is_answered_not_found():
    empty = QBP.replace("@PID.3.1^123456A~", "")
    reply = patient_query_response(empty)
    seg = segments(reply)
    assert seg["MSA"][1] == "AE"
    assert "PID" not in seg


def test_anything_that_is_not_a_pdq_query_is_left_to_the_handler():
    assert patient_query_response(ORU) is None
    assert patient_query_response("garbage") is None


def frame(message: str) -> bytes:
    return VT + message.encode() + FS + CR


@pytest.mark.asyncio
async def test_the_server_replies_to_a_query_itself_and_keeps_the_handler_for_results():
    seen: list[str] = []
    server = await serve_mllp("127.0.0.1", 0, handler=seen.append, responder=patient_query_response)
    port = server.sockets[0].getsockname()[1]
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(frame(QBP))
        await writer.drain()
        first = (await asyncio.wait_for(reader.read(4096), timeout=5))[1:-2].decode()
        writer.write(frame(ORU))
        await writer.drain()
        second = (await asyncio.wait_for(reader.read(4096), timeout=5))[1:-2].decode()
        writer.close()
        await writer.wait_closed()
    finally:
        server.close()
        await server.wait_closed()

    assert "RSP^K22" in first and "PID|||123456A" in first
    assert seen == [ORU]                                   # the query never reached the handler
    assert "MSA|AA|X1" in second                           # results still get a plain ACK


def test_the_edge_bridge_answers_queries_and_counts_them_apart_from_results():
    from homunculus.edge.bridge import EdgeBridge

    bridge = EdgeBridge(send=lambda _p: None)
    assert bridge.answer_query(ORU) is None
    reply = bridge.answer_query(QBP)
    assert reply is not None and "PID|||123456A" in reply
    assert (bridge.stats.queries, bridge.stats.messages, bridge.stats.rejected) == (1, 0, 0)


def test_a_known_patient_is_answered_with_name_birth_date_and_sex():
    """The vendor's own sample is PID|||id||Family^Given||dob|sex (Connex CSK IDS 60059617 §5.4.2).
    Field positions matter: NCE's sheets slice with substring-before(...,'|')."""
    from datetime import datetime, timezone

    from homunculus.edge.adt import PatientIdentity

    known = PatientIdentity(patient_id="123456A", family="YILMAZ", given="AYSE",
                            birth_date="1980-01-15", sex="female",
                            at=datetime(2026, 9, 4, tzinfo=timezone.utc))
    reply = patient_query_response(QBP, lookup=lambda pid: known if pid == "123456A" else None)
    pid_fields = segments(reply)["PID"]
    assert pid_fields[3] == "123456A"
    assert pid_fields[5] == "YILMAZ^AYSE"
    assert pid_fields[7] == "19800115"          # HL7 date, not ISO
    assert pid_fields[8] == "F"
    assert len(pid_fields) == 9


def test_an_unknown_patient_still_gets_the_id_only_answer():
    """A patient Comed has not sent us must not block a reading: the id is echoed, nothing else."""
    reply = patient_query_response(QBP, lookup=lambda _pid: None)
    pid_fields = segments(reply)["PID"]
    assert pid_fields[3] == "123456A"
    assert pid_fields[5:] == ["", "", "", ""]


def test_a_lookup_that_raises_degrades_to_the_id_only_answer():
    """A broken mirror must not take the device down."""
    def boom(_pid):
        raise sqlite3.OperationalError("database is locked")

    reply = patient_query_response(QBP, lookup=boom)
    assert segments(reply)["PID"][3] == "123456A"
    assert "MSA|AA" in reply
