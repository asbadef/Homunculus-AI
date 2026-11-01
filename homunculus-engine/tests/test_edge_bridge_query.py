# homunculus-engine/tests/test_edge_bridge_query.py
"""The bridge's answer to a Connex Spot's patient query (G2-B1d, spec §5.2, D3, D4, D8, §8): the
API first — found is the name (and the mirror keeps it, encrypted), not found is QAK NF with no PID
(and the mirror forgets the number) —; the API unable to answer: the mirror's answer, else the id
echoed without a name. Counted apart; no id ever logged; a broken mirror never costs the reply.
No network: a stub in place of PatientQueryClient.ask. Synthetic numbers and names only."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import pytest

from homunculus.crypto import decrypt_phi
from homunculus.edge.adt import PatientIdentity
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.pdq import NOT_FOUND
from homunculus.edge.pdq_client import QueryUnavailable

NUMBER = "202600000001"
NOW = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


def qbp(number: str = NUMBER) -> str:
    """The shape NCE sent on the ward (tests/test_edge_pdq.py), for a synthetic number."""
    return ("MSH|^~\\&|NCE|HOSP|EMR|HIS|20261101080000||QBP^Q22^QBP_Q21|Q1|P|2.6|||AL|NE\r"
            f"QPD|IHE PDQ Query|Q1|@PID.3.1^{number}~@PID3.4^X\r"
            "RCP|I|1^RD\r")


def segments(message: str) -> dict[str, list[str]]:
    return {seg.split("|", 1)[0]: seg.split("|") for seg in message.split("\r") if seg}


def found(number: str = NUMBER) -> PatientIdentity:
    return PatientIdentity(patient_id=number, given="Test Hasta", birth_date="1970-05-05",
                           sex="female", state="admitted", at=NOW)


def asking(answer=None, *, raises: BaseException | None = None):
    asked: list[str] = []

    def ask(number: str):
        asked.append(number)
        if raises is not None:
            raise raises
        return answer

    ask.asked = asked
    return ask


def counts(bridge: EdgeBridge) -> tuple[int, int, int]:
    stats = bridge.stats
    return stats.queries, stats.queries_not_found, stats.queries_api_failed


@pytest.fixture
def mirror(tmp_path):
    m = IdentityMirror(tmp_path / "identity.db")
    yield m
    m.close()


def test_a_found_number_is_answered_with_the_name_and_mirrored(mirror):
    ask = asking(found())
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=ask)
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["MSA"][1], seg["QAK"][2], seg["PID"][3], seg["PID"][5]) == (
        "AA", "OK", NUMBER, "^Test Hasta")
    assert (seg["PID"][7], seg["PID"][8]) == ("19700505", "F")
    assert ask.asked == [NUMBER]
    kept = mirror.get(NUMBER)
    assert (kept.given, kept.state) == ("Test Hasta", "admitted")
    raw = mirror._conn.execute("SELECT given FROM identity").fetchone()[0]
    assert raw != "Test Hasta" and decrypt_phi(raw) == "Test Hasta"           # encrypted at rest
    assert counts(bridge) == (1, 0, 0)


def test_a_number_the_api_does_not_know_is_not_found_and_the_mirror_forgets_it(mirror):
    """D4 and §8: a name the mirror kept from before (a discharged patient's) leaves the disk."""
    mirror.upsert(found())
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=asking(NOT_FOUND))
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["MSA"][1], seg["QAK"][2]) == ("AA", "NF") and "PID" not in seg
    assert mirror.get(NUMBER) is None
    assert counts(bridge) == (1, 1, 0)


def test_the_api_unable_to_answer_is_answered_from_the_mirror(mirror):
    mirror.upsert(found())
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror,
                        query=asking(raises=QueryUnavailable("the API answered 503")))
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["QAK"][2], seg["PID"][5]) == ("OK", "^Test Hasta")
    assert (bridge.stats.queries_not_found, bridge.stats.queries_api_failed) == (0, 1)


@pytest.mark.parametrize("failure", [QueryUnavailable("timeout"), RuntimeError("anything else")])
def test_the_api_unable_to_answer_and_a_mirror_miss_echo_the_id_without_a_name(mirror, failure):
    """D8: 'we do not know' stays distinct from 'not found' — the reading is not lost."""
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=asking(raises=failure))
    seg = segments(bridge.answer_query(qbp()))
    assert (seg["QAK"][2], seg["PID"][3], seg["PID"][5]) == ("OK", NUMBER, "")
    assert bridge.stats.queries_api_failed == 1


def test_without_an_api_the_bridge_answers_as_before(mirror):
    """Capture-only (no --cloud-url): the mirror's answer, else the echo — today's behaviour."""
    mirror.upsert(found("20239121"))
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror)
    assert segments(bridge.answer_query(qbp("20239121")))["PID"][5] == "^Test Hasta"
    assert segments(bridge.answer_query(qbp()))["PID"][5] == ""
    assert segments(EdgeBridge(send=lambda _p: None).answer_query(qbp()))["PID"][3] == NUMBER
    assert bridge.stats.queries_api_failed == 0           # no API asked, none failed


def test_a_broken_mirror_never_costs_the_reply():
    class Broken:
        def get(self, _number):
            raise OSError("disk gone")

        def upsert(self, _identity):
            raise OSError("disk gone")

        def forget(self, _number):
            raise OSError("disk gone")

    for answer, qak in ((found(), "OK"), (NOT_FOUND, "NF")):
        bridge = EdgeBridge(send=lambda _p: None, identity=Broken(), query=asking(answer))
        assert segments(bridge.answer_query(qbp()))["QAK"][2] == qak
    bridge = EdgeBridge(send=lambda _p: None, identity=Broken(),
                        query=asking(raises=QueryUnavailable("x")))
    assert segments(bridge.answer_query(qbp()))["PID"][3] == NUMBER


def test_a_mirror_fault_is_logged_without_its_words_or_the_id(caplog):
    """E24: a store error's words may carry the statement's parameters — the number asked."""
    class Leaky:
        def get(self, number):
            raise OSError(f"no row for {number}")

        def upsert(self, identity):
            raise OSError(f"cannot write {identity.patient_id}")

        def forget(self, number):
            raise OSError(f"cannot delete {number}")

    caplog.set_level(logging.DEBUG)
    for answer in (found(), NOT_FOUND):
        EdgeBridge(send=lambda _p: None, identity=Leaky(), query=asking(answer)).answer_query(qbp())
    assert len(caplog.records) == 2
    assert all(rec.exc_info is None for rec in caplog.records)
    assert not any(NUMBER in rec.getMessage() for rec in caplog.records)


def test_no_id_is_ever_logged(mirror, caplog):
    caplog.set_level(logging.DEBUG)
    for ask in (asking(found()), asking(NOT_FOUND),
                asking(raises=QueryUnavailable("the API answered 503"))):
        EdgeBridge(send=lambda _p: None, identity=mirror, query=ask).answer_query(qbp())
    assert caplog.records, "the API failure is logged"
    assert not any(NUMBER in rec.getMessage() for rec in caplog.records)
    assert not any("Test Hasta" in rec.getMessage() for rec in caplog.records)
