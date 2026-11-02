"""The local walk's fake hub (scripts/dev_waves_replay.py) builds what the panel needs, and only
made-up data: its packets decode as the three synthetic monitors, its numbers come out under the
labels hub release R7 must show (0x0101 = HR, 0x1905 = PLS), the real hub app takes them through its
own route, its table is one the strip's reader accepts, its certificate is for the names the API
container uses. A restart into the same folder keeps the tokens and the certificate a running API
already holds, `--fresh` replaces them, and no token is ever printed. Nothing is served or sent here:
the hub app is driven in process (TestClient), and `main` runs with uvicorn's `run` stubbed out."""
import datetime as dt
import importlib.util
import ipaddress
import itertools
import json
import threading
from pathlib import Path

import pytest
from cryptography import x509
from fastapi.testclient import TestClient

from homunculus.api.infinity_device_beds import parse_table
from homunculus.edge.infinity_records import PARAMETERS, parse_payload
from homunculus.edge.infinity_shadow import thin
from homunculus.edge.infinity_stream import Inventory
from homunculus.edge.infinity_waves import WAVES, parse_waves

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "dev_waves_replay.py"
SPEC = importlib.util.spec_from_file_location("dev_waves_replay", SCRIPT)
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)

COLLECTOR, VIEWER = "synthetic-collector-" + "c" * 32, "synthetic-viewer-" + "v" * 32
NOW = 1_800_000_000.0                     # a round hub clock; every event below is 100 ms older


def ids(monitor, k=1):
    return [(b.wave_id, b.samples is None) for b in parse_waves(replay.build_payload(monitor, k))]


def numbers(payload):
    return {name: record["value"] for name, record in parse_payload(payload).items()}


def test_the_three_monitors_send_the_waves_the_panel_must_draw():
    syn1, syn2, syn3 = replay.MONITORS
    assert ids(syn1) == [(0x0102, True), (0x0103, False), (0x0301, False), (0x1916, False), (0x0201, False)]
    assert ids(syn2) == [(0x0103, True), (0x0104, True), (0x0102, False), (0x0E01, False), (0x1916, False),
                         (0x0201, False)]
    assert ids(syn3) == [(0x0103, True), (0x0201, False)]
    assert all(wave in WAVES for monitor in replay.MONITORS for wave, _ in ids(monitor))


def test_its_pressure_is_a_made_up_80_to_120_mmhg_at_sample_over_40():
    blocks = [b for k in range(5) for b in parse_waves(replay.build_payload(replay.MONITORS[0], k)) if b.wave_id == 0x0301]
    values = [s / 40 for b in blocks for s in b.samples]
    assert 79 <= min(values) and max(values) <= 131


def test_once_a_second_a_packet_carries_the_strips_numbers_under_r7s_labels():
    # Hub release R7 (lead note L-3): 0x0101 is the screen's HR (ECG rate), 0x1905 its PLS (SpO2 pulse).
    assert (replay.HR_ID, replay.PLS_ID, replay.SPO2_ID) == (0x0101, 0x1905, 0x190E)
    assert [PARAMETERS[i][0] for i in (replay.HR_ID, replay.PLS_ID, replay.SPO2_ID)] == ["hr", "pls", "spo2"]
    syn1, syn2, syn3 = replay.MONITORS
    for monitor in replay.MONITORS:
        assert numbers(replay.build_payload(monitor, 0)) == monitor["numbers"]     # meant as HR, read as hr
    assert syn1["numbers"]["hr"] != syn1["numbers"]["pls"]           # a swapped label would show
    assert syn2["numbers"]["hr"] != syn2["numbers"]["pls"]
    assert parse_payload(replay.build_payload(syn3, 0))["hr"]["valid"] is False     # lead off: "***"
    assert parse_payload(replay.build_payload(syn1, 1)) == {}
    assert len(parse_waves(replay.build_payload(syn1, 0))) == 5     # the blocks still decode


def test_consecutive_packets_are_200_ms_apart_on_the_monitors_clock():
    t = [parse_waves(replay.build_payload(replay.MONITORS[0], k))[0].t_ms for k in range(6)]
    assert [b - a for a, b in zip(t, t[1:])] == [200] * 5


def test_the_inventory_parses_and_names_the_three_monitors():
    assert [d.source for d in Inventory.parse(replay.INVENTORY).devices] == ["192.0.2.21", "192.0.2.22", "192.0.2.23"]


def test_every_tick_saves_one_live_packet_per_monitor_as_the_workers_receiver_does():
    inventory, batches, stop = Inventory.parse(replay.INVENTORY), [], threading.Event()
    readings = itertools.count(0.0, replay.PERIOD_S)      # monotonic: the start, then one per tick

    def save(batch):
        batches.append(batch)
        if len(batches) == 3:
            stop.set()

    replay.produce(inventory, save, stop, clock=lambda: NOW, monotonic=lambda: next(readings))
    assert [[e["source_ip"] for e in batch] for batch in batches] == [["192.0.2.21", "192.0.2.22", "192.0.2.23"]] * 3
    assert {(e["mode"], e["received_at"], e["payload_base64"] is not None) for b in batches for e in b} == {("live", NOW, True)}
    assert batches[2][0]["payload_bytes"] == len(replay.build_payload(replay.MONITORS[0], 2))


def test_the_real_hub_takes_a_tick_through_its_own_route_and_the_strip_reads_hr_and_pls(tmp_path):
    inventory = Inventory.parse(replay.INVENTORY)
    app, view, journal = replay.build_hub(tmp_path, inventory, COLLECTOR, VIEWER, clock=lambda: NOW)
    try:
        with TestClient(app) as client:
            posted = client.post("/v1/packets", json={"events": replay.events_at(inventory, 0, NOW - 0.1)},
                                 headers={"Authorization": "Bearer " + COLLECTOR})
            window = client.get("/infinity-research/waves", params={"device": "192.0.2.22", "since": "0"},
                                headers={"Authorization": "Bearer " + VIEWER}).json()
            status = client.get("/v1/status", headers={"Authorization": "Bearer " + VIEWER}).json()
    finally:
        journal.close()
    assert posted.status_code == 200
    assert sorted((b["id"], b["samples"] is None) for b in window["blocks"]) == [
        (0x0102, False), (0x0103, True), (0x0104, True), (0x0201, False), (0x0E01, False), (0x1916, False)]
    assert {"consume_ms", "waves_ms"} <= set(status["timings"])          # the hub's own hooks ran
    body = thin(view.snapshot(), now=NOW, collector_age=0.0, counters={"sent": 0, "failed": 0})
    strip = {d["source"]: {r["parameter"]: (r["value"], r["valid"]) for r in d["readings"]} for d in body["devices"]}
    assert strip == {"192.0.2.21": {"hr": (75, True), "pls": (73, True), "spo2": (97, True)},
                     "192.0.2.22": {"hr": (80, True), "pls": (78, True), "spo2": (95, True)},
                     "192.0.2.23": {"hr": (None, False)}}


def test_the_scratch_folder_holds_a_valid_table_the_api_env_and_the_override(tmp_path):
    replay.issue_certificates(tmp_path)
    replay.write_scratch(tmp_path, port=8766, viewer="v" * 48, shadow="s" * 48, today="2026-10-27")
    table = parse_table(json.loads((tmp_path / "infinity-shadow" / "device-beds.json").read_text("utf-8")))
    assert table is not None
    env = (tmp_path / "api.env").read_text("utf-8")
    assert "INFINITY_WAVES=on" in env and "INFINITY_CLINICAL_STAGE=shadow" in env
    assert "INFINITY_HUB_URL=https://host.docker.internal:8766" in env
    # 28000 by default: 17811-18612 sat in Windows' excluded TCP ranges on the walk's machine (T1).
    assert '"127.0.0.1:28000:8000"' in (tmp_path / "compose.dalga.yml").read_text("utf-8")


def test_the_api_port_sets_the_published_port_and_the_strips_default_url(tmp_path):
    default = replay.parse_args(["--folder", str(tmp_path)])
    assert (default.api_port, default.api, default.port, default.fresh) == (28000, "http://127.0.0.1:28000", 8766, False)
    moved = replay.parse_args(["--folder", str(tmp_path), "--api-port", "29123"])
    assert moved.api == "http://127.0.0.1:29123"
    replay.write_scratch(tmp_path, port=8766, api_port=moved.api_port, viewer="v" * 48, shadow="s" * 48)
    compose = (tmp_path / "compose.dalga.yml").read_text("utf-8")
    assert '"127.0.0.1:29123:8000"' in compose and "28000" not in compose
    told = replay.parse_args(["--folder", str(tmp_path), "--api-port", "29123", "--api", "http://127.0.0.1:5000"])
    assert (told.api_port, told.api) == (29123, "http://127.0.0.1:5000")      # --api still wins for the URL
    with pytest.raises(SystemExit):
        replay.parse_args(["--folder", str(tmp_path), "--api-port", "0"])


PEMS = ("ca.pem", "hub.pem", "hub-key.pem")


def pems(folder):
    return {name: (folder / name).read_bytes() for name in PEMS}


def test_a_second_start_in_the_same_folder_keeps_the_tokens_and_the_certificate(tmp_path):
    first, same_tokens, same_certificate = replay.credentials(tmp_path)
    assert (same_tokens, same_certificate) == (False, False)
    issued = pems(tmp_path)
    replay.write_scratch(tmp_path, port=8766, viewer=first.viewer, shadow=first.shadow)
    env = (tmp_path / "api.env").read_text("utf-8")
    second, same_tokens, same_certificate = replay.credentials(tmp_path)
    assert (same_tokens, same_certificate) == (True, True)
    assert second == first and len({first.viewer, first.collector, first.shadow}) == 3
    assert pems(tmp_path) == issued
    replay.write_scratch(tmp_path, port=8766, viewer=second.viewer, shadow=second.shadow)
    assert (tmp_path / "api.env").read_text("utf-8") == env        # what the running API holds, unchanged
    assert first.viewer not in repr(first) and first.shadow not in repr(first) and first.collector not in repr(first)


def test_fresh_issues_new_tokens_and_a_new_certificate_and_keeps_those(tmp_path):
    first, _, _ = replay.credentials(tmp_path)
    issued = pems(tmp_path)
    second, same_tokens, same_certificate = replay.credentials(tmp_path, fresh=True)
    assert (same_tokens, same_certificate) == (False, False)
    assert {first.viewer, first.collector, first.shadow}.isdisjoint({second.viewer, second.collector, second.shadow})
    assert all(pems(tmp_path)[name] != issued[name] for name in PEMS)
    third, same_tokens, same_certificate = replay.credentials(tmp_path)
    assert third == second and same_tokens and same_certificate


THEN = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


def expired(folder):
    return THEN + dt.timedelta(days=31)


def about_to_expire(folder):
    return THEN + dt.timedelta(days=30) - dt.timedelta(hours=1)       # inside the one-day margin


def other_names(folder):
    replay.issue_certificates(folder, hosts=("localhost",), now=THEN)
    return THEN


def no_key(folder):
    (folder / "hub-key.pem").unlink()
    return THEN


def another_key(folder):
    elsewhere = folder / "elsewhere"
    elsewhere.mkdir()
    replay.issue_certificates(elsewhere, now=THEN)
    (folder / "hub-key.pem").write_bytes((elsewhere / "hub-key.pem").read_bytes())
    return THEN


def another_ca(folder):
    elsewhere = folder / "elsewhere"
    elsewhere.mkdir()
    replay.issue_certificates(elsewhere, now=THEN)
    (folder / "ca.pem").write_bytes((elsewhere / "ca.pem").read_bytes())
    return THEN


@pytest.mark.parametrize("spoil", [expired, about_to_expire, other_names, no_key, another_key, another_ca])
def test_a_certificate_that_no_longer_fits_is_issued_again_and_the_tokens_kept(tmp_path, spoil):
    first, _, _ = replay.credentials(tmp_path, now=THEN)
    now = spoil(tmp_path)
    second, same_tokens, same_certificate = replay.credentials(tmp_path, now=now)
    assert second == first and same_tokens and not same_certificate
    ca = x509.load_pem_x509_certificate((tmp_path / "ca.pem").read_bytes())
    leaf = x509.load_pem_x509_certificate((tmp_path / "hub.pem").read_bytes())
    leaf.verify_directly_issued_by(ca)
    assert leaf.not_valid_after_utc > now + dt.timedelta(days=29)
    names = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert set(names.get_values_for_type(x509.DNSName)) == {"host.docker.internal", "localhost"}
    assert replay.credentials(tmp_path, now=now)[1:] == (True, True)


@pytest.mark.parametrize("saved", [
    "{",                                                                    # not JSON
    json.dumps({"viewer": "v" * 48, "shadow": "s" * 48}),                   # one missing
    json.dumps({"viewer": "v" * 48, "collector": "c" * 48, "shadow": "s" * 20}),   # too short for the hub
    json.dumps({"viewer": "v" * 48 + "\nINFINITY_WAVES=off", "collector": "c" * 48, "shadow": "s" * 48}),
], ids=["not-json", "one-missing", "too-short", "a-second-line"])
def test_a_tokens_file_that_is_not_the_scripts_own_gives_new_tokens(tmp_path, saved):
    replay.credentials(tmp_path)
    (tmp_path / replay.TOKENS).write_text(saved, encoding="utf-8")
    tokens, same_tokens, same_certificate = replay.credentials(tmp_path)
    assert not same_tokens and same_certificate
    assert "\n" not in tokens.viewer and "v" * 48 not in tokens.viewer
    assert json.loads((tmp_path / replay.TOKENS).read_text("utf-8"))["viewer"] == tokens.viewer


def test_a_start_prints_no_token_and_says_whether_it_kept_the_credentials(tmp_path, monkeypatch, capsys):
    import uvicorn
    monkeypatch.setattr(uvicorn.Server, "run", lambda self, sockets=None: None)      # nothing is served
    seen, outputs = set(), []
    for argv in ([], [], ["--fresh"]):
        assert replay.main(["--folder", str(tmp_path), "--api-port", "29123", *argv]) == 0
        captured = capsys.readouterr()
        outputs.append(captured.out + captured.err)
        seen |= set(json.loads((tmp_path / replay.TOKENS).read_text("utf-8")).values())
    assert len(seen) == 6                     # the first start's three, then --fresh's three
    assert not [token for token in seen for output in outputs if token in output]
    assert ["previous run's tokens and certificate" in output for output in outputs] == [False, True, False]
    assert ["new tokens and a new certificate" in output for output in outputs] == [True, False, True]
    assert all("http://127.0.0.1:29123/infinity-shadow/readings" in output for output in outputs)
    assert '"127.0.0.1:29123:8000"' in (tmp_path / "compose.dalga.yml").read_text("utf-8")


def test_a_scratch_folder_inside_a_repository_is_refused_and_not_created():
    inside = SCRIPT.parent / "dalga-scratch-that-must-not-exist"
    with pytest.raises(ValueError):
        replay.scratch_folder(inside)
    with pytest.raises(ValueError):           # the tokens' own writer refuses it too
        replay.credentials(inside)
    assert not inside.exists()


def test_the_certificate_is_the_cas_and_names_the_hosts_the_api_container_uses(tmp_path):
    replay.issue_certificates(tmp_path)
    ca = x509.load_pem_x509_certificate((tmp_path / "ca.pem").read_bytes())
    leaf = x509.load_pem_x509_certificate((tmp_path / "hub.pem").read_bytes())
    leaf.verify_directly_issued_by(ca)
    names = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert set(names.get_values_for_type(x509.DNSName)) == {"host.docker.internal", "localhost"}
    assert names.get_values_for_type(x509.IPAddress) == [ipaddress.ip_address("127.0.0.1")]
