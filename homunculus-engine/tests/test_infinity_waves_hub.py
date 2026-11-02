"""Lane C (dalga): the hub's two hooks — `/v1/packets` hands acknowledged events to the WaveBuffer,
`GET /infinity-research/waves` answers the viewer — and the runner that wires them. Synthetic
payloads only (infinity_wave_packets.py), synthetic tokens, a throwaway journal."""
import base64
import contextlib
import importlib.util
import io
import json
import logging
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from infinity_wave_packets import ECG, at, no_signal, packet, tick
from homunculus.edge.infinity_hub import MAX_PENDING_BATCHES, WaveDecoder, create_hub
from homunculus.edge.infinity_journal import CapacityError, Journal
from homunculus.edge.infinity_live import LiveResearchView
from homunculus.edge.infinity_stream import Inventory, packet_event
from homunculus.edge.infinity_timing import HUB_NAMES, Timings, valid_snapshot
from homunculus.edge.infinity_waves import SCHEMA, WaveBuffer

ROOT = Path(__file__).resolve().parents[2]
COLLECTOR, VIEWER = "synthetic-collector-token-" + "c" * 32, "synthetic-viewer-token-" + "v" * 32
INV = Inventory.parse({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
    {"id": f"synthetic-{i}", "source": f"192.0.2.{i}", "group": f"239.20.1.{i}", "port": 2050} for i in (1, 2)]})
BED, OTHER = "192.0.2.1", "192.0.2.2"
STARTED = "1970-01-01T00:16:40.000Z"      # the hub fixture's clock when the hub is created


def event(payload, stamp, index=0):
    return packet_event(INV, INV.devices[index], payload, 2564, received_at=stamp, retain_payload=True)


@pytest.fixture
def wired(tmp_path):
    """A hub at the hub clock 1000.0 with the live view and the WaveBuffer, as the runner builds it,
    and its parts in reach."""
    now = [1000.0]
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key(), clock=lambda: now[0])
    view = LiveResearchView(INV, clock=lambda: now[0], monotonic=lambda: now[0])
    waves = WaveBuffer(INV, clock=lambda: now[0])
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, clock=lambda: now[0],
                     research_view=view, waves=waves)
    try:
        with TestClient(app) as client:
            yield SimpleNamespace(client=client, journal=journal, view=view, waves=waves, now=now)
    finally:
        journal.close()


@pytest.fixture
def hub(wired):
    return wired.client, wired.waves, wired.now


def post(client, events, *, settle=True):
    """POST a batch and, by default, wait until the decoder thread has taken it into the buffer
    (dalga-perf: the handler acknowledges before the decode). `settle=False` returns at the ack."""
    response = client.post("/v1/packets", json={"events": events}, headers={"Authorization": "Bearer " + COLLECTOR})
    if settle and client.app.state.wave_decoder is not None:
        client.app.state.wave_decoder.settle()
    return response


def gated(waves, monkeypatch):
    """Hold the decoder inside `consume` until `gate` is set; `entered` says it got there. Returns
    (gate, entered). The gate is set at teardown too, so a blocked thread never outlives the test."""
    original, gate, entered = waves.consume, threading.Event(), threading.Event()

    def consume(events):
        entered.set()
        gate.wait(timeout=10)
        original(events)

    monkeypatch.setattr(waves, "consume", consume)
    return gate, entered


def read(client, *devices, since="0", token=VIEWER):
    """`since=None` leaves the parameter out of the request."""
    params = [("device", d) for d in devices] + ([] if since is None else [("since", since)])
    return client.get("/infinity-research/waves", params=params,
                      headers={"Authorization": "Bearer " + token} if token else {})


def status(client):
    return client.get("/v1/status", headers={"Authorization": "Bearer " + VIEWER}).json()


def test_only_the_viewer_token_reads_the_waves(hub):
    client, _, _ = hub
    assert read(client, BED, token=None).status_code == 401
    assert read(client, BED, token=COLLECTOR).status_code == 401
    assert read(client, BED).status_code == 200


def test_an_acknowledged_packet_reaches_the_answer_in_the_schema(hub):
    client, _, _ = hub
    assert post(client, [event(tick(*at(0)), 999.8)]).status_code == 200
    answer = read(client, BED)
    assert answer.headers["content-type"] == "application/json"
    body = answer.json()
    assert set(body) == {"schema", "device_id", "cursor", "hub_now", "started", "blocks"}
    assert body["schema"] == SCHEMA and body["device_id"] == BED and body["cursor"] == 4
    assert body["hub_now"] == "1970-01-01T00:16:40.000Z"
    assert [set(b) for b in body["blocks"]] == [{"seq", "t", "recv", "id", "rate", "samples"}] * 4
    assert body["blocks"][0]["recv"] == "1970-01-01T00:16:39.800Z"


def test_a_no_signal_block_is_null_and_the_cursor_moves_on(hub):
    client, _, _ = hub
    post(client, [event(packet(no_signal(ECG, 200, **dict(zip(("device_s", "ms"), at(0))))), 1000.0)])
    first = read(client, BED).json()
    assert first["blocks"][0]["samples"] is None
    post(client, [event(tick(*at(1)), 1000.0)])
    assert len(read(client, BED, since=str(first["cursor"])).json()["blocks"]) == 4


def test_several_monitors_in_one_request_share_one_cursor(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0, 0), event(tick(*at(0)), 1000.0, 1)])
    answer = read(client, BED, OTHER)
    assert answer.headers["content-type"] == "application/json"
    body = answer.json()
    assert set(body) == {"schema", "cursor", "hub_now", "started", "devices"}
    assert body["cursor"] == 8 and set(body["devices"]) == {BED, OTHER}
    assert all(len(entry["blocks"]) == 4 for entry in body["devices"].values())


def test_every_answer_names_the_hub_process_it_came_from(hub):
    # A caller that holds a cursor compares `started` with the one it saw before: a different value is
    # a restarted hub, whose cursor counts from 0 again. It is fixed at create_hub; `hub_now` moves.
    client, _, now = hub
    one = read(client, BED).json()
    now[0] = 1005.0
    several = read(client, BED, OTHER).json()
    assert one["started"] == several["started"] == STARTED
    assert one["hub_now"] == STARTED and several["hub_now"] == "1970-01-01T00:16:45.000Z"


@pytest.mark.parametrize("devices, since", [((), "0"), (tuple(f"192.0.2.{i}" for i in range(17)), "0"),
                                            ((BED, BED), "0"), ((BED,), "-1"), ((BED,), "x"), ((BED,), "1" * 16)])
def test_a_request_out_of_bounds_is_400(hub, devices, since):
    client, _, _ = hub
    assert read(client, *devices, since=since).status_code == 400


def test_a_monitor_the_inventory_does_not_list_is_404(hub):
    client, _, _ = hub
    assert read(client, "192.0.2.99").status_code == 404
    assert read(client, BED, "192.0.2.99").status_code == 404


def test_since_left_out_counts_as_zero_but_present_and_empty_is_400(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0)])
    body = read(client, BED, since=None).json()
    assert body["cursor"] == 4 and len(body["blocks"]) == 4
    assert read(client, BED, since="").status_code == 400


def test_sixteen_devices_pass_the_bound_and_seventeen_do_not(hub):
    client, _, _ = hub
    sixteen = [f"192.0.2.{i}" for i in range(1, 17)]
    assert read(client, *sixteen).status_code == 404            # past the 400 gate: only .1 and .2 are listed
    assert read(client, *sixteen, "192.0.2.17").status_code == 400


def test_a_wrong_token_is_401_before_any_other_check(hub, tmp_path):
    client, _, _ = hub
    seventeen = [f"192.0.2.{i}" for i in range(17)]
    assert read(client, *seventeen, token=COLLECTOR).status_code == 401        # not 400
    assert read(client, "192.0.2.99", token=None).status_code == 401           # not 404
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as plain:
            assert read(plain, BED, token=COLLECTOR).status_code == 401        # not 409
    finally:
        journal.close()


def test_without_waves_the_route_is_409_and_waves_need_payload_acceptance(tmp_path):
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with pytest.raises(ValueError, match="explicit payload"):
            create_hub(INV, journal, COLLECTOR, VIEWER, waves=WaveBuffer(INV))
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as client:
            assert read(client, BED).status_code == 409
    finally:
        journal.close()


def test_a_refused_batch_feeds_the_waves_nothing(hub):
    client, waves, _ = hub
    outsider = dict(event(tick(*at(0)), 1000.0), source_ip="192.0.2.77", group="239.20.1.77")
    assert post(client, [event(tick(*at(0)), 1000.0), outsider]).status_code == 503
    assert waves.cursor == 0


def test_a_batch_the_journal_cannot_hold_feeds_the_waves_nothing(hub, monkeypatch):
    client, waves, _ = hub

    def full(*args, **kwargs):
        raise CapacityError("full")

    monkeypatch.setattr(Journal, "append", full)
    assert post(client, [event(tick(*at(0)), 1000.0)]).status_code == 507
    assert waves.cursor == 0 and waves.refused == 0
    assert "waves_ms" not in status(client)["timings"]


def test_the_hub_times_the_decoding_and_the_reads_under_its_closed_names(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0)])
    read(client, BED)
    seen = status(client)["timings"]
    assert seen["waves_ms"][0] == 1 and seen["waves_read_ms"][0] == 1 and seen["waves_lock_ms"][0] == 1
    assert valid_snapshot(seen, HUB_NAMES)


def test_only_a_read_that_answers_is_timed(hub):
    client, _, _ = hub
    assert read(client, "192.0.2.99").status_code == 404
    assert read(client, BED, since="x").status_code == 400
    assert read(client, BED, token=None).status_code == 401
    assert "waves_read_ms" not in status(client)["timings"]
    assert read(client).status_code == 400
    assert read(client, BED).status_code == 200
    assert status(client)["timings"]["waves_read_ms"][0] == 1


def test_the_answer_is_encoded_on_a_threadpool_thread_not_on_the_event_loop(hub, monkeypatch):
    # A bare dict would be encoded by FastAPI on the loop after the threadpool hop, where it holds up
    # /v1/packets (a wall poll of 16 devices: ~300 ms). /v1/packets is the loop's own handler, so the
    # thread that renders its answer is the loop thread; the waves answer must render on another.
    client, _, _ = hub
    rendered, original = [], JSONResponse.render

    def render(self, content):
        rendered.append(threading.get_ident())
        return original(self, content)

    monkeypatch.setattr(JSONResponse, "render", render)
    post(client, [event(tick(*at(0)), 1000.0)])
    loop_thread = rendered[-1]
    assert read(client, BED).status_code == 200
    assert read(client, BED, OTHER).status_code == 200
    assert rendered[-2] != loop_thread and rendered[-1] != loop_thread


def test_the_hub_page_shows_the_wave_counters(hub):
    client, _, _ = hub
    script = client.get("/app.js").text
    assert "s.waves.cursor" in script and "s.waves.refused" in script and "s.waves.dropped" in script
    assert "s.waves.alive" in script and "canlı" in script


IDLE = {"cursor": 0, "refused": 0, "started": STARTED, "errors": 0, "dropped": 0, "queued": 0, "alive": True}


def test_status_shows_how_many_events_the_buffer_took_and_refused(hub):
    # A worker clock a few hundred ms ahead of the hub's makes the buffer refuse every packet while the
    # journal acknowledges it: without these numbers the waves go dark and nothing says why.
    client, _, _ = hub
    assert status(client)["waves"] == IDLE
    assert post(client, [event(tick(*at(0)), 1000.4)]).status_code == 200      # ahead of the hub's clock
    assert status(client)["waves"] == dict(IDLE, refused=1)
    assert post(client, [event(tick(*at(1)), 1000.0)]).status_code == 200
    assert status(client)["waves"] == dict(IDLE, cursor=4, refused=1)
    assert read(client, BED).json()["cursor"] == 4


def test_status_has_no_waves_or_research_object_without_them(tmp_path):
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as client:
            assert "waves" not in status(client) and "research" not in status(client)
    finally:
        journal.close()


# --- I4: a display hook that raises never refuses a batch the journal holds ----------------------
# The journal has the batch before either hook runs. A 500 there would make the worker resend it
# until its events are over 3 s old, and every packet after it would arrive old too: the live view,
# the strip and Aşama B's shadow feed would go stale over a display-only decoder bug.

def _raises(kind):
    """A consume that fails the way a decoder bug might: its message quotes the payload."""
    def consume(events):
        payload = events[0]["payload_base64"]
        raise kind(f"cannot read {payload} = {base64.b64decode(payload)!r}")
    return consume


def _acknowledged(wired, item):
    response = post(wired.client, [item])
    return response.status_code == 200 and response.json() == {"ack": [item["id"]], "clinical_forwarding": False}


def _research_packets(client):
    state = client.get("/infinity-research/state", headers={"Authorization": "Bearer " + VIEWER}).json()
    return {d["source_ip"]: d["packets"] for d in state["devices"]}[BED]


def test_a_wave_decoder_that_raises_still_acknowledges_the_journaled_batch(wired, monkeypatch):
    original = wired.waves.consume
    monkeypatch.setattr(wired.waves, "consume", _raises(ValueError))
    assert _acknowledged(wired, event(tick(*at(0)), 1000.0))
    assert wired.journal.snapshot()["rows"] == 1
    seen = status(wired.client)
    assert seen["waves"] == dict(IDLE, errors=1)
    assert seen["research"] == {"errors": 0}
    assert _research_packets(wired.client) == 1                   # the live view had the events
    assert "waves_ms" not in seen["timings"] and seen["timings"]["consume_ms"][0] == 1
    # The decoder thread survives its hook raising: the next batch is decoded as if nothing happened.
    monkeypatch.setattr(wired.waves, "consume", original)
    assert _acknowledged(wired, event(tick(*at(1)), 1000.0))
    seen = status(wired.client)
    assert seen["waves"] == dict(IDLE, cursor=4, errors=1) and seen["timings"]["waves_ms"][0] == 1


def test_a_live_view_that_raises_still_acknowledges_and_the_waves_still_decode(wired, monkeypatch):
    monkeypatch.setattr(wired.view, "consume", _raises(RuntimeError))
    assert _acknowledged(wired, event(tick(*at(0)), 1000.0))
    assert wired.journal.snapshot()["rows"] == 1
    seen = status(wired.client)
    assert seen["research"] == {"errors": 1}
    assert seen["waves"] == dict(IDLE, cursor=4)
    assert len(read(wired.client, BED).json()["blocks"]) == 4
    assert "consume_ms" not in seen["timings"] and seen["timings"]["waves_ms"][0] == 1


def test_a_hook_error_is_logged_once_per_type_and_never_with_the_payload(wired, monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger="homunculus.edge.infinity_hub")
    sent = [event(tick(*at(k)), 1000.0) for k in range(4)]
    monkeypatch.setattr(wired.waves, "consume", _raises(ValueError))
    assert _acknowledged(wired, sent[0]) and _acknowledged(wired, sent[1])
    monkeypatch.setattr(wired.waves, "consume", _raises(KeyError))
    assert _acknowledged(wired, sent[2])
    monkeypatch.setattr(wired.view, "consume", _raises(ValueError))
    assert _acknowledged(wired, sent[3])
    seen = status(wired.client)
    assert seen["waves"]["errors"] == 4 and seen["research"] == {"errors": 1}
    records = [r for r in caplog.records if r.name == "homunculus.edge.infinity_hub"]
    said = [r.getMessage() for r in records]
    assert len(said) == 3                    # waves ValueError, waves KeyError, research ValueError
    assert "waves" in said[0] and "ValueError" in said[0]
    assert "waves" in said[1] and "KeyError" in said[1]
    assert "research" in said[2] and "ValueError" in said[2]
    assert all(r.exc_info is None for r in records)               # no traceback: its last line is the message
    assert "cannot read" not in caplog.text                       # the exception's own words never reach the log
    assert not any(item["payload_base64"] in caplog.text for item in sent)


def test_a_hook_error_raised_on_several_threads_at_once_is_still_logged_once(wired, caplog):
    """`hook_failed` runs on the event loop (the research hook) and on the decoder thread (the waves
    hook): its check-then-add on the logged set, and its counters, are under one lock, so one error
    type is never logged twice and no count is lost. (The race is a window of a few bytecodes: this
    test pins the behaviour under contention, it cannot reproduce the double log on demand.)"""
    caplog.set_level(logging.WARNING, logger="homunculus.edge.infinity_hub")
    failed = wired.client.app.state.wave_decoder.failed            # the decoder's hook_failed("waves", error)
    try:
        raise ValueError("synthetic")
    except ValueError as caught:
        error = caught
    count = 8
    barrier = threading.Barrier(count)

    def race():
        barrier.wait(timeout=5)
        failed(error)

    threads = [threading.Thread(target=race) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert not any(t.is_alive() for t in threads)
    records = [r for r in caplog.records if r.name == "homunculus.edge.infinity_hub"]
    assert len(records) == 1 and "waves" in records[0].getMessage() and "ValueError" in records[0].getMessage()
    assert status(wired.client)["waves"] == dict(IDLE, errors=count)


def test_an_error_hook_that_raises_does_not_end_the_decoder_thread(wired, monkeypatch, caplog):
    """Review M1. `consume` is guarded, but an exception outside it — `failed` itself raising, the
    timings — used to end the thread with nothing to say so: `queued` pinned at the bound, `dropped`
    climbing, the waves dark. The loop survives it: the error is handed to `failed` once more, and
    when `failed` is what raises it is logged once per type, by type and location, never with the
    payload. The next batch decodes as if nothing happened."""
    caplog.set_level(logging.WARNING, logger="homunculus.edge.infinity_hub")
    decoder = wired.client.app.state.wave_decoder
    original_consume, original_failed, calls = wired.waves.consume, decoder.failed, []

    def broken(error):
        calls.append(type(error).__name__)
        raise RuntimeError(f"the hook is broken on {error}")

    monkeypatch.setattr(wired.waves, "consume", _raises(ValueError))
    monkeypatch.setattr(decoder, "failed", broken)
    sent = [event(tick(*at(0)), 1000.0), event(tick(*at(1)), 1000.0)]
    assert _acknowledged(wired, sent[0])                          # settles: the thread is still draining
    assert _acknowledged(wired, sent[1])
    assert decoder.thread.is_alive()
    assert calls == ["ValueError", "RuntimeError"] * 2            # consume's error, then the hook's own, each batch
    seen = status(wired.client)
    assert seen["waves"] == IDLE                                  # uncounted: the counting hook is the broken one
    records = [r for r in caplog.records if r.name == "homunculus.edge.infinity_hub"]
    assert len(records) == 1 and "RuntimeError" in records[0].getMessage() and "goes on" in records[0].getMessage()
    assert records[0].exc_info is None and "cannot read" not in caplog.text and "the hook is broken" not in caplog.text
    assert not any(item["payload_base64"] in caplog.text for item in sent)
    monkeypatch.setattr(wired.waves, "consume", original_consume)
    monkeypatch.setattr(decoder, "failed", original_failed)
    assert _acknowledged(wired, event(tick(*at(2)), 1000.0))
    assert status(wired.client)["waves"] == dict(IDLE, cursor=4) and len(read(wired.client, BED).json()["blocks"]) == 4


# --- dalga-perf: the decode runs after the ack, on its own thread --------------------------------
# On the ward's hub the decode cost ≈2 ms per POST inside the handler, and one open panel took the
# handler from 38 to 146 ms (every read built its answer under the buffer lock the decode waits on).
# The handler now hands the batch to one decoder thread through a bounded queue and returns.

def test_the_ack_returns_before_the_waves_are_decoded(wired, monkeypatch):
    gate, entered = gated(wired.waves, monkeypatch)
    try:
        sent = event(tick(*at(0)), 1000.0)
        response = post(wired.client, [sent], settle=False)
        assert response.status_code == 200 and response.json() == {"ack": [sent["id"]], "clinical_forwarding": False}
        assert entered.wait(timeout=5)
        seen = status(wired.client)
        assert wired.waves.cursor == 0 and seen["waves"] == dict(IDLE, queued=0)   # taken off the queue, held in consume
        assert seen["timings"]["packets_ms"][0] == 1 and "waves_ms" not in seen["timings"]
        assert read(wired.client, BED).json()["blocks"] == []
    finally:
        gate.set()
    wired.client.app.state.wave_decoder.settle()
    seen = status(wired.client)
    assert seen["waves"] == dict(IDLE, cursor=4) and seen["timings"]["waves_ms"][0] == 1
    assert len(read(wired.client, BED).json()["blocks"]) == 4


def test_a_decoder_that_falls_behind_drops_the_oldest_batch_and_counts_it(wired, monkeypatch):
    gate, entered = gated(wired.waves, monkeypatch)
    try:
        batches = [[event(tick(*at(k)), 1000.0)] for k in range(MAX_PENDING_BATCHES + 3)]
        assert post(wired.client, batches[0], settle=False).status_code == 200
        assert entered.wait(timeout=5)                              # the first is in `consume`; the queue is empty
        for batch in batches[1:]:
            assert post(wired.client, batch, settle=False).status_code == 200
        seen = status(wired.client)["waves"]
        assert seen == dict(IDLE, dropped=2, queued=MAX_PENDING_BATCHES)
    finally:
        gate.set()
    wired.client.app.state.wave_decoder.settle()
    assert status(wired.client)["waves"] == dict(IDLE, cursor=4 * (MAX_PENDING_BATCHES + 1), dropped=2)
    held = {entry[0] for entry in wired.waves.devices[BED]}
    # the first batch (held in consume) and the last MAX_PENDING_BATCHES survive; batches 1 and 2 were the oldest queued
    assert 1000_040 in held and 1000_240 not in held and 1000_440 not in held and 1000_640 in held


def test_the_decoder_thread_ends_with_the_apps_lifespan_and_drops_what_was_queued(tmp_path, monkeypatch):
    now = [1000.0]
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key(), clock=lambda: now[0])
    waves = WaveBuffer(INV, clock=lambda: now[0])
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, clock=lambda: now[0], waves=waves)
    assert app.state.wave_decoder is not None and not app.state.wave_decoder.thread.is_alive()
    gate, entered = gated(waves, monkeypatch)
    try:
        with TestClient(app) as client:
            decoder = client.app.state.wave_decoder
            assert decoder.thread.is_alive() and decoder.thread.daemon
            for k in range(3):
                assert post(client, [event(tick(*at(k)), 1000.0)], settle=False).status_code == 200
            assert entered.wait(timeout=5) and decoder.queued == 2
            closing = threading.Thread(target=decoder.close)
            closing.start()                                         # shutdown while the first batch is still decoding
            gate.set()
            closing.join(timeout=5)
            assert not closing.is_alive() and not decoder.thread.is_alive()
            assert waves.cursor == 4 and decoder.queued == 3        # the two queued batches are dropped, the sentinel behind them
    finally:
        gate.set()
        journal.close()
    assert not app.state.wave_decoder.thread.is_alive()
    assert not any(t.name == decoder.thread.name for t in threading.enumerate())


def test_an_app_whose_lifespan_runs_twice_decodes_both_times(tmp_path):
    now = [1000.0]
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key(), clock=lambda: now[0])
    waves = WaveBuffer(INV, clock=lambda: now[0])
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, clock=lambda: now[0], waves=waves)
    try:
        for k in range(2):
            with TestClient(app) as client:
                assert post(client, [event(tick(*at(k)), 1000.0)]).status_code == 200
                assert status(client)["waves"] == dict(IDLE, cursor=4 * (k + 1))
            assert not app.state.wave_decoder.thread.is_alive()
    finally:
        journal.close()


def test_status_says_whether_the_decoder_thread_is_alive(tmp_path):
    """Review M1: `queued` pinned at the bound with `dropped` climbing is what a dead decoder looks
    like from outside; `alive` says it outright. True under the lifespan, False once it has ended."""
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key())
    waves = WaveBuffer(INV)
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, waves=waves)
    try:
        with TestClient(app) as client:
            assert status(client)["waves"]["alive"] is True
        assert not app.state.wave_decoder.thread.is_alive()
        assert status(TestClient(app))["waves"]["alive"] is False     # no `with`: the lifespan ended and did not rerun
    finally:
        journal.close()


def test_a_hub_without_waves_has_no_decoder(tmp_path):
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        app = create_hub(INV, journal, COLLECTOR, VIEWER)
        assert app.state.wave_decoder is None
        with TestClient(app) as client:
            assert client.get("/", headers={"Authorization": "Bearer " + VIEWER}).status_code == 200
    finally:
        journal.close()


def test_settle_raises_instead_of_hanging_when_no_thread_drains_the_queue(tmp_path, monkeypatch):
    """`post()` settles by default. A test client that never ran the lifespan (no `with`) has no
    decoder thread, and neither has one whose lifespan ended: a bare `queue.join()` there would wait
    forever. A thread that runs but does not drain the queue within `timeout` raises too."""
    now = [1000.0]
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key(), clock=lambda: now[0])
    waves = WaveBuffer(INV, clock=lambda: now[0])
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, clock=lambda: now[0], waves=waves)
    decoder = app.state.wave_decoder
    gate, entered = gated(waves, monkeypatch)
    try:
        client = TestClient(app)                                    # no `with`: the lifespan never runs
        with pytest.raises(RuntimeError, match="not running"):
            post(client, [event(tick(*at(0)), 1000.0)])
        assert decoder.queued == 1 and not decoder.thread.is_alive()   # acknowledged and queued; nobody decoding
        with TestClient(app) as client:
            assert post(client, [event(tick(*at(1)), 1000.0)], settle=False).status_code == 200
            assert entered.wait(timeout=5)                          # the thread is in `consume`, held at the gate
            with pytest.raises(RuntimeError, match="did not settle"):
                decoder.settle(timeout=0.1)
            gate.set()
            decoder.settle()
            assert waves.cursor == 8                                # the batch queued before the lifespan, then the second
        with pytest.raises(RuntimeError, match="not running"):      # the lifespan ended: the thread is gone
            decoder.settle()
    finally:
        gate.set()
        journal.close()


def test_start_does_not_run_a_second_consumer_beside_a_thread_that_outlived_close():
    """A `close` that timed out left the thread inside `consume` (a buffer lock never released, a
    hook that hangs). A later `start` on that decoder — a second lifespan on the same app — must not
    start a second consumer beside it: two would race on the buffer, and a thread that did not
    answer in 5 s is not one to hand the queue back to. It raises; once the thread has ended, the
    next `start` gets a fresh one."""
    gate, entered = threading.Event(), threading.Event()

    def consume(events):
        entered.set()
        gate.wait(timeout=10)

    decoder = WaveDecoder(SimpleNamespace(consume=consume), Timings(), lambda error: None)
    try:
        decoder.start()
        decoder.submit([object()])
        assert entered.wait(timeout=5)
        decoder.close(timeout=0.05)                                 # times out: the thread is still in `consume`
        stuck = decoder.thread
        assert stuck.is_alive()
        with pytest.raises(RuntimeError, match="still running"):
            decoder.start()
        assert decoder.thread is stuck and sum(t.name == stuck.name for t in threading.enumerate()) == 1
    finally:
        gate.set()
    stuck.join(timeout=5)
    assert not stuck.is_alive()
    decoder.start()                                                 # the thread ended: a fresh one, an empty queue
    assert decoder.thread is not stuck and decoder.thread.is_alive() and decoder.queued == 0
    decoder.close()
    assert not decoder.thread.is_alive()


def test_close_on_a_full_queue_costs_no_batch():
    """Review M3. `close` used to put its sentinel through `submit`, which on a full queue drops the
    oldest batch and counts it — a batch paid for a sentinel nobody needs: a full queue has no `get`
    to wake, and the thread checks `stopping` before every `get`. The sentinel now finds no room and
    is simply not put; `dropped` stays, the thread ends at the next batch boundary."""
    gate, entered = threading.Event(), threading.Event()

    def consume(events):
        entered.set()
        gate.wait(timeout=10)

    decoder = WaveDecoder(SimpleNamespace(consume=consume), Timings(), lambda error: None, limit=4)
    try:
        decoder.start()
        decoder.submit([0])
        assert entered.wait(timeout=5)                              # the first is held in `consume`; the queue is empty
        for k in range(1, 5):
            decoder.submit([k])                                     # four fill it
        assert decoder.queued == 4 and decoder.dropped == 0
        closing = threading.Thread(target=decoder.close)
        closing.start()
        assert decoder.stopping.wait(timeout=5)                     # `close` has asked; its sentinel found no room
    finally:
        gate.set()
    closing.join(timeout=5)
    assert not closing.is_alive() and not decoder.thread.is_alive()
    assert decoder.dropped == 0 and decoder.queued == 4             # nothing dropped for the sentinel, nothing decoded past `stopping`


# The answer, byte for byte, as the route rendered it before dalga-perf (captured at 720e48f with
# this very fixture: two monitors, blocks arriving out of device-time order, one no-signal block,
# a cursor part-way). `since` now builds the answer outside the lock from pre-serialised samples;
# the wire must not notice.
ONE_DEVICE = (
    b'{"schema":"homunculus.infinity-waves.v1","device_id":"192.0.2.1","cursor":13,'
    b'"hub_now":"1970-01-01T00:16:40.000Z","started":"1970-01-01T00:16:40.000Z","blocks":['
    b'{"seq":5,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":259,"rate":200,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102,139,176,-188,-151,-114,-77,'
    b'-40,-3,34,71,108,145,182,-182,-145,-108,-71,-34,3,40]},'
    b'{"seq":8,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":513,"rate":50,"samples":[-200,-163,-126,'
    b'-89,-52,-15,22,59,96,133]},'
    b'{"seq":6,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":769,"rate":100,"samples":[4000,4000,'
    b'4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000]},'
    b'{"seq":7,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":6422,"rate":100,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102]},'
    b'{"seq":1,"t":1000.24,"recv":"1970-01-01T00:16:39.900Z","id":259,"rate":200,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102,139,176,-188,-151,-114,-77,'
    b'-40,-3,34,71,108,145,182,-182,-145,-108,-71,-34,3,40]},'
    b'{"seq":4,"t":1000.24,"recv":"1970-01-01T00:16:39.900Z","id":513,"rate":50,"samples":[-200,-163,-126,'
    b'-89,-52,-15,22,59,96,133]},'
    b'{"seq":2,"t":1000.24,"recv":"1970-01-01T00:16:39.900Z","id":769,"rate":100,"samples":[4000,4000,'
    b'4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000]},'
    b'{"seq":3,"t":1000.24,"recv":"1970-01-01T00:16:39.900Z","id":6422,"rate":100,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102]},'
    b'{"seq":9,"t":1000.44,"recv":"1970-01-01T00:16:40.000Z","id":259,"rate":200,"samples":null}]}'
)
TWO_DEVICES = (
    b'{"schema":"homunculus.infinity-waves.v1","cursor":13,"hub_now":"1970-01-01T00:16:40.000Z",'
    b'"started":"1970-01-01T00:16:40.000Z","devices":{"192.0.2.1":{"blocks":['
    b'{"seq":5,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":259,"rate":200,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102,139,176,-188,-151,-114,-77,'
    b'-40,-3,34,71,108,145,182,-182,-145,-108,-71,-34,3,40]},'
    b'{"seq":8,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":513,"rate":50,"samples":[-200,-163,-126,'
    b'-89,-52,-15,22,59,96,133]},'
    b'{"seq":6,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":769,"rate":100,"samples":[4000,4000,'
    b'4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000]},'
    b'{"seq":7,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":6422,"rate":100,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102]},'
    b'{"seq":9,"t":1000.44,"recv":"1970-01-01T00:16:40.000Z","id":259,"rate":200,"samples":null}]},'
    b'"192.0.2.2":{"blocks":['
    b'{"seq":10,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":259,"rate":200,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102,139,176,-188,-151,-114,-77,'
    b'-40,-3,34,71,108,145,182,-182,-145,-108,-71,-34,3,40]},'
    b'{"seq":13,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":513,"rate":50,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133]},'
    b'{"seq":11,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":769,"rate":100,"samples":[4000,4000,'
    b'4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000]},'
    b'{"seq":12,"t":1000.04,"recv":"1970-01-01T00:16:40.000Z","id":6422,"rate":100,"samples":[-200,-163,'
    b'-126,-89,-52,-15,22,59,96,133,170,-194,-157,-120,-83,-46,-9,28,65,102]}]}}}'
)


def test_the_answer_bytes_are_what_they_were_before_the_answer_moved_outside_the_lock(hub):
    client, _, _ = hub
    sent = [event(tick(*at(1)), 999.9), event(tick(*at(0)), 1000.0),
            event(packet(no_signal(ECG, 200, device_s=1000, ms=440)), 1000.0), event(tick(*at(0)), 1000.0, 1)]
    assert post(client, sent).status_code == 200
    assert read(client, BED).content == ONE_DEVICE
    assert read(client, BED, OTHER, since="4").content == TWO_DEVICES


# --- the runner ----------------------------------------------------------------------------------

def _runner():
    spec = importlib.util.spec_from_file_location("run_infinity_transport",
                                                  ROOT / "homunculus-engine/scripts/run_infinity_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(tmp_path, monkeypatch, *flags):
    inventory = tmp_path / "inventory.json"
    inventory.write_text(json.dumps({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": "synthetic-1", "source": BED, "group": "239.20.1.1", "port": 2050}]}), encoding="utf-8")
    database = tmp_path / f"hub-{len(list(tmp_path.glob('hub-*.sqlite')))}.sqlite"
    monkeypatch.setenv("INFINITY_STORAGE_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("INFINITY_COLLECTOR_TOKEN", COLLECTOR)
    monkeypatch.setenv("INFINITY_VIEWER_TOKEN", VIEWER)
    for name in ("INFINITY_SHADOW_URL", "INFINITY_SHADOW_TOKEN", "INFINITY_SHADOW_CA_FILE"):
        monkeypatch.delenv(name, raising=False)
    runner, served = _runner(), []
    monkeypatch.setattr(sys, "argv", ["run_infinity_transport.py", "hub", "--inventory", str(inventory),
                                      "--database", str(database), *flags])
    monkeypatch.setattr(runner.uvicorn, "run", lambda app, **kwargs: served.append(app))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = runner.main()
    return code, out.getvalue(), served


def test_the_runner_decodes_waves_with_live_research_and_says_so(tmp_path, monkeypatch):
    code, out, served = _run(tmp_path, monkeypatch, "--capture-payload", "--unverified-live-research")
    assert code == 0 and "Waveform blocks decoded for display only" in out and "the last 20 s in memory" in out
    with TestClient(served[0]) as client:
        assert read(client, BED).json()["blocks"] == []


def test_without_live_research_the_runner_decodes_no_waves(tmp_path, monkeypatch):
    code, out, served = _run(tmp_path, monkeypatch, "--capture-payload")
    assert code == 0 and "Waveform" not in out
    with TestClient(served[0]) as client:
        assert read(client, BED).status_code == 409
