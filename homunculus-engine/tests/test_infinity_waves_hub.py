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
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_journal import CapacityError, Journal
from homunculus.edge.infinity_live import LiveResearchView
from homunculus.edge.infinity_stream import Inventory, packet_event
from homunculus.edge.infinity_timing import HUB_NAMES, valid_snapshot
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


def post(client, events):
    return client.post("/v1/packets", json={"events": events}, headers={"Authorization": "Bearer " + COLLECTOR})


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
    assert seen["waves_ms"][0] == 1 and seen["waves_read_ms"][0] == 1
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
    assert "s.waves.cursor" in script and "s.waves.refused" in script


def test_status_shows_how_many_events_the_buffer_took_and_refused(hub):
    # A worker clock a few hundred ms ahead of the hub's makes the buffer refuse every packet while the
    # journal acknowledges it: without these numbers the waves go dark and nothing says why.
    client, _, _ = hub
    assert status(client)["waves"] == {"cursor": 0, "refused": 0, "started": STARTED, "errors": 0}
    assert post(client, [event(tick(*at(0)), 1000.4)]).status_code == 200      # ahead of the hub's clock
    assert status(client)["waves"] == {"cursor": 0, "refused": 1, "started": STARTED, "errors": 0}
    assert post(client, [event(tick(*at(1)), 1000.0)]).status_code == 200
    assert status(client)["waves"] == {"cursor": 4, "refused": 1, "started": STARTED, "errors": 0}
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
    monkeypatch.setattr(wired.waves, "consume", _raises(ValueError))
    assert _acknowledged(wired, event(tick(*at(0)), 1000.0))
    assert wired.journal.snapshot()["rows"] == 1
    seen = status(wired.client)
    assert seen["waves"] == {"cursor": 0, "refused": 0, "started": STARTED, "errors": 1}
    assert seen["research"] == {"errors": 0}
    assert _research_packets(wired.client) == 1                   # the live view had the events
    assert "waves_ms" not in seen["timings"] and seen["timings"]["consume_ms"][0] == 1


def test_a_live_view_that_raises_still_acknowledges_and_the_waves_still_decode(wired, monkeypatch):
    monkeypatch.setattr(wired.view, "consume", _raises(RuntimeError))
    assert _acknowledged(wired, event(tick(*at(0)), 1000.0))
    assert wired.journal.snapshot()["rows"] == 1
    seen = status(wired.client)
    assert seen["research"] == {"errors": 1}
    assert seen["waves"] == {"cursor": 4, "refused": 0, "started": STARTED, "errors": 0}
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
