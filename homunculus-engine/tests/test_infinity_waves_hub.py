"""Lane C (dalga): the hub's two hooks — `/v1/packets` hands acknowledged events to the WaveBuffer,
`GET /infinity-research/waves` answers the viewer — and the runner that wires them. Synthetic
payloads only (infinity_wave_packets.py), synthetic tokens, a throwaway journal."""
import contextlib
import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from infinity_wave_packets import ECG, at, no_signal, packet, tick
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_journal import Journal
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
def hub(tmp_path):
    """A hub at the hub clock 1000.0 with the live view and the WaveBuffer, as the runner builds it."""
    now = [1000.0]
    journal = Journal(tmp_path / "hub.sqlite", Fernet.generate_key(), clock=lambda: now[0])
    waves = WaveBuffer(INV, clock=lambda: now[0])
    app = create_hub(INV, journal, COLLECTOR, VIEWER, accept_payload=True, clock=lambda: now[0],
                     research_view=LiveResearchView(INV, clock=lambda: now[0], monotonic=lambda: now[0]), waves=waves)
    try:
        with TestClient(app) as client:
            yield client, waves, now
    finally:
        journal.close()


def post(client, events):
    return client.post("/v1/packets", json={"events": events}, headers={"Authorization": "Bearer " + COLLECTOR})


def read(client, *devices, since="0", token=VIEWER):
    params = [("device", d) for d in devices] + [("since", since)]
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
    body = read(client, BED).json()
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
    body = read(client, BED, OTHER).json()
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


def test_the_hub_times_the_decoding_and_the_reads_under_its_closed_names(hub):
    client, _, _ = hub
    post(client, [event(tick(*at(0)), 1000.0)])
    read(client, BED)
    seen = status(client)["timings"]
    assert seen["waves_ms"][0] == 1 and seen["waves_read_ms"][0] == 1
    assert valid_snapshot(seen, HUB_NAMES)


def test_status_shows_how_many_events_the_buffer_took_and_refused(hub):
    # A worker clock a few hundred ms ahead of the hub's makes the buffer refuse every packet while the
    # journal acknowledges it: without these numbers the waves go dark and nothing says why.
    client, _, _ = hub
    assert status(client)["waves"] == {"cursor": 0, "refused": 0, "started": STARTED}
    assert post(client, [event(tick(*at(0)), 1000.4)]).status_code == 200      # ahead of the hub's clock
    assert status(client)["waves"] == {"cursor": 0, "refused": 1, "started": STARTED}
    assert post(client, [event(tick(*at(1)), 1000.0)]).status_code == 200
    assert status(client)["waves"] == {"cursor": 4, "refused": 1, "started": STARTED}
    assert read(client, BED).json()["cursor"] == 4


def test_status_has_no_waves_object_without_a_buffer(tmp_path):
    journal = Journal(tmp_path / "plain.sqlite", Fernet.generate_key())
    try:
        with TestClient(create_hub(INV, journal, COLLECTOR, VIEWER)) as client:
            assert "waves" not in status(client)
    finally:
        journal.close()


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
    assert code == 0 and "Waveform blocks decoded for display only" in out
    with TestClient(served[0]) as client:
        assert read(client, BED).json()["blocks"] == []


def test_without_live_research_the_runner_decodes_no_waves(tmp_path, monkeypatch):
    code, out, served = _run(tmp_path, monkeypatch, "--capture-payload")
    assert code == 0 and "Waveform" not in out
    with TestClient(served[0]) as client:
        assert read(client, BED).status_code == 409
