"""The acceptance reader judges two readings of the hub. Small in-code readings only."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("transport_check", ROOT / "deploy/infinity/transport_check.py")
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def lag(n, total, within_3s):
    # n, total, then buckets <=10, <=50, <=100, <=250, <=500, <=1000, <=3000, >3000
    return [n, total, 0, 0, 0, 0, within_3s, 0, 0, n - within_3s]


def reading(*, lag_ms, rows=40, oldest=0.4, expired=0, errors=0, quarantined=0, archived=1000,
            devices=("streaming",) * 13, live=("streaming",) * 13, accepted=900, old=0):
    counters = {"accepted": 5000, "expired": expired, "forward_errors": errors}
    if quarantined:
        counters["quarantined"] = quarantined
    status = {
        "devices": [{"id": f"BED{i:02d}", "status": s, "packet_age_seconds": 0.5} for i, s in enumerate(devices)],
        "collector": {"connected": True, "heartbeat": {"queue": {
            "rows": rows, "oldest_age_seconds": oldest, "counters": counters}}},
        "archive": {"counters": {"accepted": archived}},
        "timings": {"lag_ms": lag_ms},
    }
    state = {"accepted_packets": accepted, "old_or_duplicate_packets": old,
             "devices": [{"device_id": f"BED{i:02d}", "status": s} for i, s in enumerate(live)]}
    return status, state


def verdicts(before, after, cpu=0.10):
    return {name: ok for name, ok, _ in check.evaluate(before, after, cpu_share=cpu, cpu_ceiling=0.43)}


def test_a_live_pipeline_passes_every_criterion():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500)
    assert all(verdicts(before, after).values())


def test_old_packets_fail_the_delivery_and_live_view_criteria():
    before = reading(lag_ms=lag(100, 87000000, 0), oldest=870)
    after = reading(lag_ms=lag(4100, 3567000000, 0), oldest=872, archived=5000, accepted=900, old=4000)
    seen = verdicts(before, after)
    assert not seen["gecikme"] and not seen["kuyruk"] and not seen["canli_gorunum"]


def test_any_expiry_error_or_quarantine_in_the_window_fails():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500,
                    expired=3, errors=1, quarantined=2)
    seen = verdicts(before, after)
    assert not seen["suresi_dolan"] and not seen["aktarim_hatasi"] and not seen["karantina"]


def test_a_stale_device_is_named_and_fails():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500,
                    devices=("streaming",) * 12 + ("stale",), live=("streaming",) * 12 + ("stale",))
    results = check.evaluate(before, after, cpu_share=0.1, cpu_ceiling=0.43)
    device = next(r for r in results if r[0] == "cihazlar")
    assert not device[1] and "BED12" in device[2]


def test_hub_cpu_above_the_ceiling_fails():
    before = reading(lag_ms=lag(100, 30000, 100))
    after = reading(lag_ms=lag(4100, 1230000, 4100), archived=5000, accepted=4500)
    assert not verdicts(before, after, cpu=0.50)["hub_cpu"]


def test_a_hub_without_timings_cannot_pass_the_delay_criterion():
    before, after = reading(lag_ms=lag(100, 30000, 100)), reading(lag_ms=lag(4100, 1230000, 4100))
    before[0].pop("timings")
    after[0].pop("timings")
    assert not verdicts(before, after)["gecikme"]


def timed(n, total):
    return [n, total] + [0] * 7 + [n]


def phases(hub, worker):
    """A /v1/status-shaped reading carrying only timings: the hub's and the worker's."""
    return {"timings": {k: timed(*v) for k, v in hub.items()},
            "collector": {"heartbeat": {"timings": {k: timed(*v) for k, v in worker.items()}}}}


QUIET = {"packets_ms": (0, 0), "expire_ms": (0, 0), "capacity_ms": (0, 0), "commit_ms": (0, 0),
         "body_ms": (0, 0), "validate_ms": (0, 0)}
WORKER_QUIET = {"flush_ms": (0, 0), "pending_ms": (0, 0), "ack_ms": (0, 0), "post_ms": (0, 0),
                "connect_ms": (0, 0), "expire_ms": (0, 0), "capacity_ms": (0, 0), "append_ms": (0, 0),
                "snapshot_ms": (0, 0), "commit_ms": (0, 0), "lock_wait_ms": (0, 0)}


def test_the_measured_14_10_shape_points_at_the_journal_scans():
    # What the read-only evidence of 14.10 predicts: the hub's two scans take most of each
    # batch, and the worker's pending and ack wait on a journal busy scanning.
    hub = dict(QUIET, packets_ms=(1000, 260000), expire_ms=(1000, 110000), capacity_ms=(1000, 110000),
               commit_ms=(1000, 12000))
    worker = dict(WORKER_QUIET, flush_ms=(1000, 520000), pending_ms=(1000, 150000), ack_ms=(1000, 90000),
                  post_ms=(1000, 280000), connect_ms=(1000, 10000), expire_ms=(9000, 700000),
                  capacity_ms=(8000, 650000), append_ms=(8000, 1500000), snapshot_ms=(100, 20000))
    lines, rows = check.breakdown(phases(QUIET, WORKER_QUIET), phases(hub, worker))
    assert rows == ["A"] and any("expire" in line for line in lines)


def test_commits_dominating_after_the_scans_are_gone_points_at_durability():
    hub = dict(QUIET, packets_ms=(1000, 30000), expire_ms=(1000, 200), capacity_ms=(1000, 50),
               commit_ms=(1000, 20000))
    worker = dict(WORKER_QUIET, flush_ms=(1000, 60000), pending_ms=(1000, 2000), ack_ms=(1000, 25000),
                  post_ms=(1000, 33000), connect_ms=(1000, 9000), commit_ms=(3000, 70000),
                  append_ms=(2000, 50000))
    assert check.breakdown(phases(QUIET, WORKER_QUIET), phases(hub, worker))[1] == ["B"]


def test_a_slow_connection_points_at_keep_alive():
    hub = dict(QUIET, packets_ms=(1000, 8000), expire_ms=(1000, 100), commit_ms=(1000, 1000))
    worker = dict(WORKER_QUIET, flush_ms=(1000, 80000), pending_ms=(1000, 2000), ack_ms=(1000, 3000),
                  post_ms=(1000, 75000), connect_ms=(1000, 60000))
    assert check.breakdown(phases(QUIET, WORKER_QUIET), phases(hub, worker))[1] == ["C"]


def test_no_batches_means_no_verdict():
    assert check.breakdown(phases(QUIET, WORKER_QUIET), phases(QUIET, WORKER_QUIET))[1] == ["?"]
