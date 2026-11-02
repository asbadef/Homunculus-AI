"""The local load bench (scripts/dev_waves_bench.py) reproduces the ward's shape with made-up data
only: N monitors whose packets are the ward's size and decode into the catalogue's waves, the worker's
own batching (32 events a POST, a 250 ms linger), pollers that ask the hub what the API asks it, a
window read the way the VM's hubdurum.py reads it, one `BENCH {…}` line, and hubdurum's before/after
verdict. Nothing is served or sent here: the hub app is driven in process (TestClient), the pollers
get an injected `get`, and the one subprocess is `--help`."""
import importlib.util
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from homunculus.edge.infinity_collector import LINGER, flush_once, save_batch
from homunculus.edge.infinity_journal import Journal
from homunculus.edge.infinity_records import parse_payload
from homunculus.edge.infinity_stream import MAX_BATCH, Inventory
from homunculus.edge.infinity_waves import WAVES, parse_waves

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SPEC = importlib.util.spec_from_file_location("dev_waves_bench", SCRIPTS / "dev_waves_bench.py")
bench = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bench)
replay = bench.replay

COLLECTOR, VIEWER = "synthetic-collector-" + "c" * 32, "synthetic-viewer-" + "v" * 32
NOW = 1_800_000_000.0
# A window as /v1/status shows it: [count, total, <=10, <=50, <=100, <=250, <=500, <=1000, <=3000, >3000].
ZERO = [0] * 10


# --- the packets ----------------------------------------------------------------------------------

def test_two_100_ms_saves_hold_13_live_packets_of_the_wards_size_that_decode_into_the_catalogue():
    monitors = bench.bench_monitors(13)
    inventory = bench.inventory_for(monitors)
    assert [d.source for d in inventory.devices] == [f"192.0.2.{20 + i}" for i in range(13)]
    assert len({m["group"] for m in monitors}) == 13
    # The worker saves every 100 ms (SAVE_PERIOD_S) what arrived; the monitors' phases are spread over the
    # 200 ms, so saves 2 and 3 (the second packet of each) hold 7 then 6 monitors, every monitor once.
    assert bench.SAVE_PERIOD_S == 0.1
    first, second = bench.events_at(inventory, 2, NOW, monitors=monitors), bench.events_at(inventory, 3, NOW + 0.1, monitors=monitors)
    assert [e["source_ip"] for e in first + second] == [m["source"] for m in monitors]
    assert {(e["mode"], e["payload_base64"] is not None) for e in first + second} == {("live", True)}
    ages = [NOW - e["received_at"] for e in first] + [NOW + 0.1 - e["received_at"] for e in second]
    assert all(0 < age <= 0.1 + 1e-9 for age in ages) and len(set(round(a, 6) for a in ages)) == 13   # each its own receive time
    assert ages[0] == pytest.approx(0.1) and ages[1] == pytest.approx(0.1 - 0.2 / 13)
    sizes = [e["payload_bytes"] for e in first + second]
    # The ward's type-0x03 packets were 522/468/346 B (docs/INFINITY-DALGA-FORMU.md): three ECG blocks,
    # ART and/or P1, pleth and RESP make 488 or 542 here; the record packet adds 108.
    assert set(sizes) == {488, 542}
    with_records = [e["payload_bytes"] for k in (0, 1) for e in bench.events_at(inventory, k, NOW, monitors=monitors)]
    assert set(with_records) == {596, 650} and len(with_records) == 13
    a_second = (4 * sum(sizes) + sum(with_records)) / (5 * 13)     # a second of one monitor, averaged
    assert 500 <= a_second <= 560
    # Save k carries packet k // 2: saves 0-9 are one second, five packets per monitor, 200 ms apart.
    saves = [e for k in range(10) for e in bench.events_at(inventory, k, NOW + 0.1 * k, monitors=monitors)]
    assert len(saves) == 65
    t = [parse_waves(bench.build_payload(monitors[0], k))[0].t_ms for k in range(4)]
    assert [b - a for a, b in zip(t, t[1:])] == [200] * 3
    for monitor in monitors:
        blocks = parse_waves(bench.build_payload(monitor, 1))
        assert all(b.wave_id in WAVES for b in blocks)
        rates = {b.wave_id: b.rate for b in blocks}
        assert rates[0x1916] == 100 and rates[0x0201] == 50
        assert all(rates[w] == 200 for w in (0x0102, 0x0103, 0x0104))
        assert all(rates[w] == 100 for w in monitor["pressures"])
        assert [b.wave_id for b in blocks if b.samples is None] == list(monitor["ecg_quiet"])
        assert len(blocks) == 3 + len(monitor["pressures"]) + 2
        assert all(len(b.samples) == b.rate // 5 for b in blocks if b.samples is not None)


def test_the_monitors_cycle_the_wards_profiles_and_carry_r7s_numbers_once_a_second():
    monitors = bench.bench_monitors(13)
    assert [m["pressures"] for m in monitors[:4]] == [(0x0301,), (0x0E01,), (0x0301, 0x0E01), (0x0301,)]
    assert [len(m["ecg_live"]) for m in monitors[:4]] == [2, 1, 2, 1]        # ECG live on 1-2 channels
    assert all(len(m["ecg_live"]) + len(m["ecg_quiet"]) == 3 for m in monitors)
    for monitor in monitors:
        numbers = {name: r["value"] for name, r in parse_payload(bench.build_payload(monitor, 0)).items()}
        assert numbers == monitor["numbers"] and numbers["pls"] == numbers["hr"] - 2
        assert abs(60 / numbers["hr"] - monitor["beat_s"]) < 1e-9
        assert parse_payload(bench.build_payload(monitor, 1)) == {}
    with pytest.raises(ValueError):
        bench.bench_monitors(0)
    with pytest.raises(ValueError):
        bench.bench_monitors(101)


def test_produce_hands_the_bench_monitors_saves_to_the_outbox_through_the_replays_own_loop_every_100_ms():
    monitors = bench.bench_monitors(4)                   # phases 0, 50, 100, 150 ms: two per save
    inventory = bench.inventory_for(monitors)
    batches, stop, waited = [], threading.Event(), []
    readings = iter([0.0, 0.0, 0.1, 0.2, 0.3])

    def save(batch):
        batches.append(batch)
        if len(batches) == 3:
            stop.set()

    stop.wait = lambda seconds: waited.append(round(seconds, 6))
    replay.produce(inventory, save, stop, clock=lambda: NOW, monotonic=lambda: next(readings),
                   events=bench.tick_events(monitors), period=bench.SAVE_PERIOD_S)
    sources = [m["source"] for m in monitors]
    assert [[e["source_ip"] for e in batch] for batch in batches] == [sources[:2], sources[2:], sources[:2]]
    assert waited == [0.1, 0.1, 0.1]
    assert batches[2][0]["payload_bytes"] == len(bench.build_payload(monitors[0], 1))     # save 2: packet 1
    # The replay's own three monitors keep their 200 ms tick when nothing is passed.
    batches.clear()
    stop.clear()
    readings = iter([0.0, 0.0, 0.2, 0.4, 0.6])
    waited.clear()
    replay.produce(Inventory.parse(replay.INVENTORY), save, stop, clock=lambda: NOW, monotonic=lambda: next(readings))
    assert waited == [0.2, 0.2, 0.2] and [len(b) for b in batches] == [3, 3, 3]


# --- the worker's batching ------------------------------------------------------------------------

def test_the_bench_posts_with_the_workers_own_batching_32_events_then_a_250_ms_linger(tmp_path):
    assert bench.BATCH == (MAX_BATCH, LINGER) == (32, 0.25)
    monitors = bench.bench_monitors(13)
    inventory = bench.inventory_for(monitors)
    outbox = Journal(tmp_path / "outbox.sqlite", Fernet.generate_key())
    posted = []

    class Recorder:
        def post(self, path, body):
            posted.append((path, len(body["events"])))
            return {"ack": [e["id"] for e in body["events"]]}

    try:
        for k in range(6):                                   # six 100 ms saves, 7+6+7+6+7+6: 39 events
            save_batch(outbox, bench.events_at(inventory, k, NOW, monitors=monitors))
        assert [flush_once(outbox, Recorder()) for _ in range(3)] == [32, 7, 0]
    finally:
        outbox.close()
    assert posted == [("/v1/packets", 32), ("/v1/packets", 7)]


# --- the pollers ----------------------------------------------------------------------------------

class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def hub(tmp_path, monitors):
    inventory = bench.inventory_for(monitors)
    app, _view, journal = replay.build_hub(tmp_path, inventory, COLLECTOR, VIEWER, clock=lambda: NOW)
    return inventory, app, journal


def test_a_poller_reads_the_waves_route_and_in_cursor_mode_sends_the_last_cursor_back(tmp_path):
    monitors = bench.bench_monitors(2)
    inventory, app, journal = hub(tmp_path, monitors)
    seen = []
    try:
        with TestClient(app) as client:
            def post(k):
                # Both 100 ms saves of the k-th packet: the two monitors' phases fall one in each.
                events = [e for save in (2 * k, 2 * k + 1) for e in bench.events_at(inventory, save, NOW - 0.1, monitors=monitors)]
                r = client.post("/v1/packets", json={"events": events}, headers={"Authorization": "Bearer " + COLLECTOR})
                assert r.status_code == 200 and len(events) == 2
                # The hub decodes after the ack, on its own thread (dalga-perf): wait for the 12 blocks.
                deadline = bench.time.monotonic() + 5
                while client.get("/v1/status", headers={"Authorization": "Bearer " + VIEWER}).json()["waves"]["cursor"] < 12 * (k + 1):
                    assert bench.time.monotonic() < deadline, "the hub never decoded the batch"
                    bench.time.sleep(0.02)

            def get(params):
                seen.append(dict(params))
                r = client.get("/infinity-research/waves", params=params, headers={"Authorization": "Bearer " + VIEWER})
                return r.status_code, r.content

            post(0)
            clock = Clock()
            whole = bench.Poller(get, monitors[1]["source"], interval=0.25, since="0", clock=clock)
            incremental = bench.Poller(get, monitors[1]["source"], interval=0.25, since="cursor", clock=clock)
            whole.once()
            incremental.once()
            post(1)
            whole.once()
            incremental.once()
    finally:
        journal.close()
    device = monitors[1]["source"]
    assert seen[0] == {"device": device, "since": "0"} and seen[2] == {"device": device, "since": "0"}
    assert seen[1] == {"device": device, "since": "0"}                   # the first poll has no cursor
    cursor = int(seen[3]["since"])
    # The cursor is hub-wide: the second tick added 2 monitors x 6 blocks after the one sent back.
    assert seen[3]["device"] == device and 0 < cursor == incremental.cursor - 12
    whole_samples, whole_errors = whole.window()
    incremental_samples, incremental_errors = incremental.window()
    assert (whole_errors, incremental_errors) == (0, 0)
    assert [blocks for _ms, _size, blocks in whole_samples] == [6, 12]           # since=0: the whole window again
    assert [blocks for _ms, _size, blocks in incremental_samples] == [6, 6]      # since=cursor: only the new
    assert all(size > 1000 for _ms, size, _blocks in whole_samples)
    assert whole_samples[1][1] > incremental_samples[1][1]
    assert whole.window() == ([], 0)                                           # a window read resets it


def test_a_poller_keeps_its_cadence_from_request_start_to_request_start_and_never_sleeps_after_a_slow_answer():
    clock, waits, stop = Clock(), [], threading.Event()
    cost = iter([0.05, 0.05, 0.40, 0.05])

    def get(params):
        clock.now += next(cost)
        return 200, json.dumps({"cursor": 7, "blocks": []}).encode()

    def wait(seconds):
        waits.append(round(seconds, 6))
        clock.now += seconds
        if len(waits) == 4:
            stop.set()

    poller = bench.Poller(get, "192.0.2.20", interval=0.25, since="0", clock=clock, wait=wait)
    poller.run(stop)
    assert waits == [0.2, 0.2, 0.0, 0.2]
    samples, errors = poller.window()
    assert [round(ms) for ms, _size, _blocks in samples] == [50, 50, 400, 50] and errors == 0


def test_a_poller_counts_a_transport_failure_and_a_non_200_as_errors_and_keeps_going():
    answers = iter([OSError("down"), (503, b"{}"), (200, b"not json"), (200, json.dumps({"cursor": 3, "blocks": [1]}).encode())])

    def get(params):
        answer = next(answers)
        if isinstance(answer, Exception):
            raise answer
        return answer

    poller = bench.Poller(get, "192.0.2.20", interval=0.25, since="cursor", clock=Clock())
    for _ in range(4):
        poller.once()
    samples, errors = poller.window()
    assert errors == 3 and [blocks for _ms, _size, blocks in samples] == [1] and poller.cursor == 3


def test_pollers_round_robin_over_the_first_monitors():
    monitors = bench.bench_monitors(3)
    assert bench.watched(monitors, 5) == [m["source"] for m in monitors] + [monitors[0]["source"], monitors[1]["source"]]
    assert bench.watched(monitors, 0) == []


def test_the_poll_summary_gives_p50_p95_bytes_and_blocks_per_answer():
    samples = [(float(ms), 1000 + ms, 10) for ms in range(1, 101)]       # 1..100 ms
    summary = bench.poll_summary(samples, errors=2)
    assert summary == {"poll_n": 100, "poll_errors": 2, "poll_p50": 50.0, "poll_p95": 95.0, "poll_ort": 50.5,
                       "poll_bytes": 1050.5, "poll_blocks": 10.0}
    assert bench.poll_summary([], errors=0) == {"poll_n": 0, "poll_errors": 0, "poll_p50": None, "poll_p95": None,
                                                "poll_ort": None, "poll_bytes": None, "poll_blocks": None}


# --- the window and the lines ---------------------------------------------------------------------

def reading(t, cpu_s, *, lag, packets, waves=None, waves_read=None, refused=0, errors=0, cursor=0, pid=4242,
            dropped=None, queued=None):
    timings = {"lag_ms": lag, "packets_ms": packets}
    if waves is not None:
        timings["waves_ms"] = waves
    if waves_read is not None:
        timings["waves_read_ms"] = waves_read
    status_waves = {"cursor": cursor, "refused": refused, "errors": errors, "started": "x"}
    if dropped is not None:                                   # the hub since 476feced (the decoder thread)
        status_waves.update(dropped=dropped, queued=queued or 0)
    return {"t": t, "pid": pid, "cpu_s": cpu_s, "cpu_method": "test", "timings": timings, "waves": status_waves,
            "research": {"errors": 0}, "devices": [[f"192.0.2.{20 + i}", "streaming"] for i in range(13)]}


def test_the_window_reads_two_status_readings_as_hubdurum_does():
    # The VM's C-2 (lead note L-9): 27.3 % over 500 ms, 7.8 % over 1000 ms, mean 542 ms, with refused +172.
    before = reading(0.0, 10.0, lag=ZERO, packets=ZERO, waves=ZERO, waves_read=ZERO)
    lag = [1000, 542_000, 100, 200, 100, 127, 200, 195, 78, 0]
    packets = [250, 36_500, 0, 0, 50, 150, 40, 10, 0, 0]
    after = reading(180.0, 10.0 + 0.12 * 180, lag=lag, packets=packets, waves=[250, 500, 250, 0, 0, 0, 0, 0, 0, 0],
                    waves_read=[720, 2160, 700, 20, 0, 0, 0, 0, 0, 0], refused=172, cursor=90_000)
    m, rows = bench.window(before, after)
    assert m["sn"] == 180 and abs(m["cpu"] - 0.12) < 1e-9
    assert (m["lag_n"], m["lag_ort"], m["lag_500"], m["lag_1000"], m["lag_10"]) == (1000, 542.0, 0.273, 0.078, 100)
    assert (m["paket_n"], m["paket_ort"], m["paket_250"]) == (250, 146.0, 0.2)
    assert (m["waves_ms"], m["waves_read_ms"], m["akan"]) == (2.0, 3.0, 13)
    assert (m["dalga_refused"], m["dalga_errors"], m["dalga_imlec"], m["arastirma_errors"]) == (172, 0, 90_000, 0)
    verdicts = {name: verdict for name, verdict, _text in rows}
    assert verdicts["hub_cpu"] == "KABUL" and verdicts["dalga_refused"] == "RED" and verdicts["waves_ms"] == "KABUL"
    assert verdicts["dalga_errors"] == "KABUL" and verdicts["dalga_imlec"] == "KABUL" and verdicts["gecikme"] == "BİLGİ"
    assert bench.verdict(rows) == "RED"


def test_the_decoder_queues_drops_and_depth_are_shown_when_the_hub_has_them():
    before = reading(0.0, 1.0, lag=ZERO, packets=ZERO, cursor=10)
    _m, rows = bench.window(before, reading(60.0, 2.0, lag=[10, 1000, 10, 0, 0, 0, 0, 0, 0, 0], packets=ZERO, cursor=20))
    assert not {name for name, _v, _t in rows} & {"dalga_dropped", "dalga_queued"}      # the pre-fix hub: no such keys
    before = reading(0.0, 1.0, lag=ZERO, packets=ZERO, cursor=10, dropped=0, queued=0)
    m, rows = bench.window(before, reading(60.0, 2.0, lag=[10, 1000, 10, 0, 0, 0, 0, 0, 0, 0], packets=ZERO, cursor=20,
                                           dropped=0, queued=1))
    verdicts = {name: verdict for name, verdict, _t in rows}
    assert (m["dalga_dropped"], m["dalga_queued"]) == (0, 1) and (verdicts["dalga_dropped"], verdicts["dalga_queued"]) == ("KABUL", "BİLGİ")
    m, rows = bench.window(before, reading(60.0, 2.0, lag=[10, 1000, 10, 0, 0, 0, 0, 0, 0, 0], packets=ZERO, cursor=20,
                                           dropped=3, queued=40))
    verdicts = {name: verdict for name, verdict, _t in rows}
    assert (m["dalga_dropped"], m["dalga_queued"]) == (3, 40) and (verdicts["dalga_dropped"], verdicts["dalga_queued"]) == ("RED", "DİKKAT")


def test_a_restarted_hub_or_a_quiet_window_invalidates_it():
    before = reading(0.0, 1.0, lag=ZERO, packets=ZERO)
    _m, rows = bench.window(before, reading(60.0, 2.0, lag=ZERO, packets=ZERO, pid=1))
    assert [(name, verdict) for name, verdict, _ in rows] == [("hub", "RED")]
    m, rows = bench.window(before, reading(60.0, 2.0, lag=ZERO, packets=ZERO))
    verdicts = {name: verdict for name, verdict, _ in rows}
    assert verdicts["gecikme"] == "RED" and "lag_n" not in m and verdicts["dalga_imlec"] == "RED"   # streaming, no cursor


def test_the_summary_line_is_one_json_object_with_the_run_and_the_window_and_loads_back():
    metrics = {"sn": 180, "cpu": 0.1, "lag_n": 10, "lag_ort": 20.0, "lag_500": 0.0, "lag_1000": 0.0, "paket_ort": 5.0,
               "paket_250": 0.0, "poll_n": 0, "poll_p95": None}
    run = bench.run_record(monitors=13, pollers=1, poll_interval=0.25, poll_since="0", warmup=30.0, bench_seconds=180.0,
                           cpu_method="GetProcessTimes")
    line = bench.summary_line(run, metrics)
    assert line.startswith("BENCH {") and "\n" not in line
    loaded = json.loads(line[len("BENCH "):])
    assert loaded["bench"]["monitors"] == 13 and loaded["bench"]["batch"] == [32, 0.25]
    assert {"pollers", "poll_interval", "poll_since", "warmup_s", "bench_s", "cpu_method", "cpus", "platform", "python"} <= set(loaded["bench"])
    assert (loaded["bench"]["hub_cpus"], loaded["bench"]["hub_mask"], loaded["bench"]["bench_mask"]) == (None, None, None)
    assert {k: v for k, v in loaded.items() if k != "bench"} == metrics
    pinned = bench.run_record(monitors=13, pollers=1, poll_interval=0.25, poll_since="0", warmup=30.0, bench_seconds=180.0,
                              cpu_method="GetProcessTimes", hub_cpus=2, hub_mask=0b11, bench_mask=0xfffc)
    assert (pinned["hub_cpus"], pinned["hub_mask"], pinned["bench_mask"]) == (2, "0x3", "0xfffc")
    assert bench.load_bench_text("--- a table\nKABUL  hub_cpu  x\n" + line + "\n") == loaded
    assert bench.load_bench_text(json.dumps(loaded)) == loaded


# --- the before/after verdict (hubdurum's karsilastir) --------------------------------------------

def metrics(lag_500, lag_1000, *, lag_ort=250.0, paket_ort=38.0, paket_250=0.0, cpu=0.2, **extra):
    return {"lag_500": lag_500, "lag_1000": lag_1000, "lag_ort": lag_ort, "paket_ort": paket_ort,
            "paket_250": paket_250, "cpu": cpu, **extra}


@pytest.mark.parametrize("before, after, expected", [
    (metrics(0.0144, 0.0053), metrics(0.0150, 0.0055), "KABUL"),      # within old + max(add, 25 %)
    (metrics(0.0144, 0.0053), metrics(0.0220, 0.0055), "DİKKAT"),     # 500 ms tail inside old + max(2 add, 50 %)
    (metrics(0.0144, 0.0053), metrics(0.0190, 0.0100), "DİKKAT"),     # the 1000 ms vote says DİKKAT
    (metrics(0.0144, 0.0053), metrics(0.0321, 0.0117), "RED"),        # the VM's B-2 window against A-3's R6
    (metrics(0.0144, 0.0053), metrics(0.2730, 0.0780), "RED"),        # the VM's C-2 with a panel polling
    (metrics(0.0, 0.0), metrics(0.0100, 0.0050), "KABUL"),            # the floors: 1 % and 0.5 % are never a tail
    (metrics(0.0, 0.0), metrics(0.0150, 0.0075), "DİKKAT"),           # floor + add
    (metrics(0.0, 0.0), metrics(0.0151, 0.0), "RED"),
], ids=["kabul", "dikkat-500", "dikkat-1000", "vm-b2", "vm-c2", "floor", "floor-add", "beyond"])
def test_the_compare_verdict_reproduces_hubdurums_rule(before, after, expected):
    rows = bench.compare(before, after)
    assert rows[0][0] == "gecikme_onceki" and rows[0][1] == expected
    assert bench.verdict(rows) == expected
    names = [name for name, _v, _t in rows]
    assert names[:3] == ["gecikme_onceki", "paket_onceki", "cpu_onceki"]
    assert all(verdict == "BİLGİ" for name, verdict, _ in rows[1:])


def test_the_compare_names_what_was_not_measured_and_the_pollers_when_both_have_them():
    rows = bench.compare({}, metrics(0.01, 0.0))
    assert rows == [("gecikme_onceki", "RED", "önceki ya da bu pencere gecikme ölçmedi")]
    rows = bench.compare(metrics(0.01, 0.0, poll_n=10, poll_p95=120.0, poll_bytes=50_000.0),
                         metrics(0.01, 0.0, poll_n=10, poll_p95=40.0, poll_bytes=8_000.0))
    assert [name for name, _v, _t in rows] == ["gecikme_onceki", "paket_onceki", "cpu_onceki", "sorgu_onceki"]
    assert "120 -> şimdi 40 ms" in rows[3][2] and "50000 -> şimdi 8000" in rows[3][2]


def test_main_compares_two_saved_runs_without_running_anything(tmp_path, capsys):
    before, after = tmp_path / "before.txt", tmp_path / "after.txt"
    run = bench.run_record(monitors=13, pollers=0, poll_interval=0.25, poll_since="0", warmup=30.0, bench_seconds=180.0,
                           cpu_method="test")
    before.write_text("noise\n" + bench.summary_line(run, metrics(0.0144, 0.0053)) + "\n", encoding="utf-8")
    after.write_text(bench.summary_line(run, metrics(0.0321, 0.0117)) + "\n", encoding="utf-8")
    assert bench.main(["--compare", str(before), str(after)]) == 1
    out = capsys.readouterr().out
    assert "RED    gecikme_onceki" in out and "SONUÇ (KARSILASTIR): RED" in out
    after.write_text(bench.summary_line(run, metrics(0.0150, 0.0055)) + "\n", encoding="utf-8")
    assert bench.main(["--compare", str(before), str(after)]) == 0
    assert "SONUÇ (KARSILASTIR): KABUL" in capsys.readouterr().out
    assert bench.main(["--compare", str(before)]) == 2         # one file is a run, and a run needs --folder
    assert "--folder" in capsys.readouterr().out


# --- the options, the CPU reading and the console -------------------------------------------------

def test_the_defaults_are_the_wards_count_no_poller_the_apis_cadence_and_a_three_minute_window(tmp_path):
    args = bench.parse_args(["--folder", str(tmp_path)])
    assert (args.monitors, args.pollers, args.poll_interval, args.poll_since) == (13, 0, 0.25, "0")
    assert (args.warmup, args.bench_seconds, args.port, args.host, args.api_port, args.role) == (30.0, 180.0, 8766, "127.0.0.1", 28000, "bench")
    assert args.api == "http://127.0.0.1:28000" and args.compare is None and not args.fresh
    moved = bench.parse_args(["--folder", str(tmp_path), "--pollers", "3", "--poll-interval", "0.75", "--poll-since", "cursor",
                              "--bench-seconds", "20", "--warmup", "0", "--port", "28766", "--monitors", "5"])
    assert (moved.pollers, moved.poll_interval, moved.poll_since, moved.bench_seconds, moved.warmup) == (3, 0.75, "cursor", 20.0, 0.0)
    assert (moved.port, moved.monitors) == (28766, 5)
    for bad in (["--monitors", "0"], ["--monitors", "101"], ["--pollers", "-1"], ["--poll-interval", "0"],
                ["--bench-seconds", "0"], ["--warmup", "-1"], ["--poll-since", "last"], ["--port", "70000"]):
        with pytest.raises(SystemExit):
            bench.parse_args(["--folder", str(tmp_path), *bad])


def test_the_pollers_clock_is_perf_counter_not_the_15_ms_monotonic_of_windows():
    assert bench.Poller(lambda params: (200, b"{}"), "192.0.2.20").clock is bench.time.perf_counter


def test_the_hub_child_writes_its_own_pid_and_the_parent_reads_that_not_the_launchers(tmp_path):
    # A venv's python.exe on Windows is a launcher whose child is the interpreter: Popen.pid is the wrong
    # process for GetProcessTimes (the smoke run read 0.0 % for a streaming hub).
    (tmp_path / bench.PID_FILE).write_text("4242\n", encoding="ascii")
    assert bench.hub_pid(tmp_path) == 4242
    assert bench.PID_FILE == "hub.pid"
    with pytest.raises(OSError):
        bench.hub_pid(tmp_path / "nowhere")


def test_hub_cpus_is_parsed_and_the_mask_is_the_lowest_n_cores_offered(tmp_path):
    assert bench.parse_args(["--folder", str(tmp_path)]).hub_cpus is None
    assert bench.parse_args(["--folder", str(tmp_path), "--hub-cpus", "2"]).hub_cpus == 2
    with pytest.raises(SystemExit):
        bench.parse_args(["--folder", str(tmp_path), "--hub-cpus", "0"])
    assert bench.affinity_mask(2, 0b1111) == 0b11
    assert bench.affinity_mask(1, 0b1111) == 0b1
    assert bench.affinity_mask(2, 0b1010) == 0b1010                 # a machine that offers cores 1 and 3
    assert bench.affinity_mask(16, (1 << 16) - 1) == (1 << 16) - 1
    for n, available in ((3, 0b11), (0, 0b11), (1, 0)):
        with pytest.raises(ValueError):
            bench.affinity_mask(n, available)


def test_the_hub_is_pinned_on_its_real_pid_and_the_bench_takes_the_rest_then_everything_is_restored():
    system = bench.system_affinity()
    if bin(system).count("1") < 2:
        pytest.skip("one core: nothing to pin apart")
    own = bench.process_affinity(os.getpid())
    # The interpreter itself, not a venv launcher: the hub's pid is read the same way (hub.pid).
    child = subprocess.Popen([getattr(sys, "_base_executable", None) or sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        hub_mask, bench_mask = bench.pin_hub(child.pid, 1)
        assert hub_mask == bench.affinity_mask(1, system) and bench_mask == system & ~hub_mask and bench_mask
        assert bench.process_affinity(child.pid) == hub_mask
        assert bench.process_affinity(os.getpid()) == bench_mask
    finally:
        child.kill()
        child.wait(timeout=20)
        bench.set_process_affinity(os.getpid(), own)
    assert bench.process_affinity(os.getpid()) == own
    with pytest.raises(ValueError):
        bench.pin_hub(os.getpid(), bin(system).count("1") + 1)


def test_the_hub_processs_cpu_time_is_read_without_psutil_and_grows():
    seconds, method = bench.cpu_seconds(os.getpid())
    assert method in ("psutil", "GetProcessTimes", "/proc") and seconds >= 0.0
    if sys.platform == "win32":
        assert method == "GetProcessTimes"
    deadline = bench.time.perf_counter() + 0.3
    while bench.time.perf_counter() < deadline:
        sum(range(10_000))
    later, _ = bench.cpu_seconds(os.getpid())
    assert later > seconds


def test_a_scratch_folder_inside_a_repository_is_refused_before_anything_runs(capsys):
    inside = SCRIPTS / "bench-scratch-that-must-not-exist"
    assert bench.main(["--folder", str(inside), "--bench-seconds", "1", "--warmup", "0"]) == 2
    assert "outside any repository" in capsys.readouterr().out
    assert not inside.exists()


def test_help_prints_under_a_redirected_cp1252_console():
    env = {**os.environ, "PYTHONIOENCODING": "cp1252:strict", "PYTHONUTF8": "0", "PYTHONDONTWRITEBYTECODE": "1",
           "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")}
    done = subprocess.run([sys.executable, str(SCRIPTS / "dev_waves_bench.py"), "--help"], capture_output=True, env=env, timeout=120)
    assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
    text = done.stdout.decode("utf-8", "replace")
    assert "--monitors" in text and "--pollers" in text and "--poll-since" in text and "--compare" in text
    assert "D?KKAT" in text or "DİKKAT" in text            # the word is in the help; cp1252 has no İ
