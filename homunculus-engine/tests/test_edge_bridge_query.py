# homunculus-engine/tests/test_edge_bridge_query.py
"""The bridge's answer to a Connex Spot's patient query (G2-B1d, spec §5.2, D3, D4, D8, §8): the
API first — found is the name (and the mirror keeps it, encrypted), not found is QAK NF with no PID
(and the mirror forgets the number) —; the API unable to answer: the mirror's answer, else the id
echoed without a name. Counted apart; no id ever logged; a broken mirror never costs the reply.
No network: a stub in place of PatientQueryClient.ask. Synthetic numbers and names only."""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timezone

import pytest

from homunculus.edge.mllp import CR, FS, VT

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


# ---------------------------------------------------------------- spec §5.3: no stall
ORU = ("MSH|^~\\&|NCE|HOSP|EMR|HIS|20261101080100||ORU^R01^ORU_R01|R1|P|2.5\r"
       f"PID|||{NUMBER}\r"
       "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F\r")


def frame(message: str) -> bytes:
    return VT + message.encode() + FS + CR


async def _shut(server, writers, *events: threading.Event) -> None:
    """Release the stub, close every client, then the server — bounded, so that a red test fails
    instead of hanging in `wait_closed` (which waits for the open connections)."""
    for event in events:
        event.set()
    for w in writers:
        w.close()
    server.close()
    await asyncio.wait_for(server.wait_closed(), timeout=5)


async def test_a_slow_api_holds_its_own_query_and_never_a_reading_on_another_connection(mirror):
    """The API takes its time (up to the client's 2 s in life; here until the test releases it).
    Meanwhile a reading arrives on another connection: it is acknowledged at once, and the query
    is still waiting — the responder runs on a worker thread, not on the event loop."""
    entered, release = threading.Event(), threading.Event()

    def slow(number: str):
        entered.set()
        release.wait(5)
        return found(number)

    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=slow)
    server = await bridge.serve(host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]
    writers: list[asyncio.StreamWriter] = []
    try:
        query_reader, query_writer = await asyncio.open_connection("127.0.0.1", port)
        writers.append(query_writer)
        query_writer.write(frame(qbp()))
        await query_writer.drain()
        assert await asyncio.wait_for(asyncio.to_thread(entered.wait, 5), 6)   # at the API now

        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writers.append(writer)
        writer.write(frame(ORU))
        await writer.drain()
        ack = await asyncio.wait_for(reader.read(4096), timeout=2)
        assert b"MSA|AA|R1" in ack
        with pytest.raises(TimeoutError):                    # the query has no answer yet
            await asyncio.wait_for(query_reader.read(1), timeout=0.2)

        release.set()
        reply = (await asyncio.wait_for(query_reader.read(4096), timeout=5))[1:-2].decode()
        assert f"PID|||{NUMBER}||^Test Hasta" in reply
        assert (bridge.stats.messages, bridge.stats.queries) == (1, 1)
    finally:
        await _shut(server, writers, release)


async def test_a_reading_is_handled_at_once_while_slow_queries_hold_every_worker(mirror):
    """F-32: only a patient query leaves the loop. The loop's default executor is made small (two
    workers stand in for the real cpu+4) and three queries wait on the API: every worker is busy
    and one query is queued behind them. A reading on another connection is still acknowledged
    at once — it never takes a worker, it runs on the loop as before Task 10."""
    import concurrent.futures

    release = threading.Event()
    at_api: list[str] = []

    def slow(number: str):
        at_api.append(number)
        release.wait(10)
        return found(number)

    async def both_workers_at_api() -> None:                 # polled: the pool is full, so no
        while len(at_api) < 2:                               # helper may borrow one of its threads
            await asyncio.sleep(0.01)

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    asyncio.get_running_loop().set_default_executor(pool)
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=slow)
    server = await bridge.serve(host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]
    writers: list[asyncio.StreamWriter] = []
    try:
        query_readers = []
        for _ in range(3):                                   # one more than there are workers
            query_reader, query_writer = await asyncio.open_connection("127.0.0.1", port)
            writers.append(query_writer)
            query_readers.append(query_reader)
            query_writer.write(frame(qbp()))
            await query_writer.drain()
        await asyncio.wait_for(both_workers_at_api(), timeout=5)    # and one query is queued

        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writers.append(writer)
        writer.write(frame(ORU))
        await writer.drain()
        ack = await asyncio.wait_for(reader.read(4096), timeout=1)
        assert b"MSA|AA|R1" in ack
        assert bridge.stats.messages == 1

        release.set()
        for query_reader in query_readers:                   # the queued one is answered too
            reply = (await asyncio.wait_for(query_reader.read(4096), timeout=5))[1:-2].decode()
            assert f"PID|||{NUMBER}||^Test Hasta" in reply
        assert bridge.stats.queries == 3
    finally:
        await _shut(server, writers, release)
        pool.shutdown(wait=True)


# ------------------------------------------- worker threads: the mirror and the counters (E25)
async def _ask_over_mllp(bridge: EdgeBridge, number: str = NUMBER) -> dict[str, list[str]]:
    server = await bridge.serve(host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]
    writers: list[asyncio.StreamWriter] = []
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writers.append(writer)
        writer.write(frame(qbp(number)))
        await writer.drain()
        reply = (await asyncio.wait_for(reader.read(4096), timeout=5))[1:-2].decode()
        return segments(reply)
    finally:
        await _shut(server, writers)


async def test_the_mirror_answers_from_the_worker_thread_when_the_api_cannot(mirror, caplog):
    """The mirror's sqlite connection is opened on the test (loop) thread; the responder reads it
    on a worker thread. A sqlite ProgrammingError there would surface as «unknown»/the bare echo —
    not the mirrored name — and as a failed responder in the log."""
    mirror.upsert(found())                                   # written on this thread
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror,
                        query=asking(raises=QueryUnavailable("the API answered 503")))
    caplog.set_level(logging.DEBUG)
    seg = await _ask_over_mllp(bridge)
    assert (seg["MSA"][1], seg["QAK"][2], seg["PID"][3], seg["PID"][5]) == (
        "AA", "OK", NUMBER, "^Test Hasta")                   # the name, not the bare echo
    assert counts(bridge) == (1, 0, 1)
    assert not any("responder failed" in rec.getMessage() for rec in caplog.records)
    assert not any("in the identity mirror" in rec.getMessage() for rec in caplog.records)


async def test_the_apis_answer_is_mirrored_and_forgotten_from_the_worker_thread(mirror, caplog):
    caplog.set_level(logging.DEBUG)
    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=asking(found()))
    seg = await _ask_over_mllp(bridge)
    assert seg["PID"][5] == "^Test Hasta"
    assert mirror.get(NUMBER).given == "Test Hasta"          # written on a worker, read here

    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=asking(NOT_FOUND))
    seg = await _ask_over_mllp(bridge)
    assert (seg["QAK"][2], "PID" in seg) == ("NF", False)
    assert mirror.get(NUMBER) is None                        # forgotten on a worker, seen here
    assert not any("in the identity mirror" in rec.getMessage() for rec in caplog.records)


def test_the_query_counters_lose_no_count_under_worker_threads(mirror):
    """E25: answer_query runs on worker threads, several at once (one per connection); a plain
    `+= 1` on a shared counter can lose an update between its read and its write."""
    import sys

    unavailable = QueryUnavailable("the API answered 503")

    def ask(number: str):
        if number.endswith("1"):
            raise unavailable
        return NOT_FOUND

    bridge = EdgeBridge(send=lambda _p: None, identity=mirror, query=ask)
    ours, others = qbp(NUMBER), qbp("202600000002")           # …1 fails, …2 is «not found»
    failures: list[BaseException] = []

    def work() -> None:
        try:
            for _ in range(300):
                bridge.answer_query(ours)
                bridge.answer_query(others)
        except BaseException as exc:  # noqa: BLE001 — collected, asserted below
            failures.append(exc)

    previous = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)                               # make a lost update likely
    try:
        threads = [threading.Thread(target=work) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
    finally:
        sys.setswitchinterval(previous)
    assert failures == []
    assert counts(bridge) == (8 * 600, 8 * 300, 8 * 300)
