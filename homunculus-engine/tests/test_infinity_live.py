"""Synthetic continuous research tests; no clinical data or hospital traffic."""
import tempfile
import uuid
from pathlib import Path

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import pytest

from test_infinity_records import record, HR, SPO2
from homunculus.edge.infinity_hub import create_hub
from homunculus.edge.infinity_journal import Journal
from homunculus.edge.infinity_live import LiveResearchView
from homunculus.edge.infinity_stream import Inventory, packet_event

PAYLOAD = record(HR, 70, low=45, high=130) + record(SPO2, 97, low=85, high=100)
SPO2_ONLY = record(SPO2, 95, low=85, high=100)
NO_RECORDS = bytes(200)          # what a monitor in standby carries


def inventory(count=1):
    return Inventory.parse({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": f"synthetic-{i}", "source": f"192.0.2.{i}", "group": f"239.20.1.{i}", "port": 2050}
        for i in range(1, count + 1)]})


def event(stamp, payload=PAYLOAD, *, index=0, mode="live", inv=None):
    inv = inv or inventory(index + 1)
    return packet_event(inv, inv.devices[index], payload, 2564, received_at=stamp,
                        retain_payload=True, mode=mode)


def device(state, index=0):
    return state["devices"][index]


def test_records_name_their_own_parameters_and_carry_the_device_limits():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000.)])
    entry = device(view.snapshot())
    assert entry["status"] == "streaming"
    assert entry["parameters"]["hr"]["value"] == 70
    assert entry["parameters"]["hr"]["unit"] == "bpm"
    assert (entry["parameters"]["hr"]["alarm_low"], entry["parameters"]["hr"]["alarm_high"]) == (45, 130)
    assert entry["parameters"]["spo2"]["value"] == 97
    assert view.snapshot()["evidence"] == "record_decoded"


def test_a_device_reporting_no_valid_reading_is_not_shown_as_a_number():
    # The monitor shows *** for these; the placeholder in the record is not a measurement.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., record(SPO2, 4, valid=False))])
    entry = device(view.snapshot())["parameters"]["spo2"]
    assert entry["value"] is None and entry["status"] == "device_reports_invalid"


def test_a_standby_payload_is_reported_as_carrying_no_parameters():
    # A monitor in standby transmits at full rate and carries no records. Reporting that as
    # silence would send an engineer looking for a network fault that is not there.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., NO_RECORDS)])
    entry = device(view.snapshot())
    assert entry["status"] == "no_parameters" and entry["parameters"] == {}
    assert entry["packets"] == 1


def test_devices_keep_their_own_state():
    now = [1000.]
    inv = inventory(2)
    view = LiveResearchView(inv, clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., inv=inv, index=0), event(1000., SPO2_ONLY, inv=inv, index=1)])
    state = view.snapshot()
    assert set(device(state, 0)["parameters"]) == {"hr", "spo2"}
    assert set(device(state, 1)["parameters"]) == {"spo2"}
    assert device(state, 1)["parameters"]["spo2"]["value"] == 95
    assert device(state, 0)["parameters"]["spo2"]["value"] == 97


def test_continuous_over_a_day_has_no_packet_limit_and_no_growing_history():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    item = event(now[0])
    for index in range(30001):
        now[0] = 1000 + 3 * index        # 25 simulated hours
        item = dict(item, received_at=now[0], id=str(uuid.UUID(int=index + 1)))
        view.consume([item])
    state = view.snapshot()
    assert state["mode"] == "live" and state["accepted_packets"] == 30001
    assert device(state)["parameters"]["hr"]["value"] == 70
    assert state["clinical_mapping_verified"] is False and state["clinical_ingest_enabled"] is False
    assert len(view.devices["synthetic-1"].parameters) == 2


def test_outage_backlog_duplicate_and_recovery():
    now, tick = [1000.], [0.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: tick[0])
    first = event(999.)
    view.consume([first])
    assert device(view.snapshot())["parameters"]["hr"]["age_ms"] == 1000
    now[0], tick[0] = 1002., 2.
    view.consume([first])                # the same row again is not a new measurement
    assert device(view.snapshot())["parameters"]["hr"]["value"] is None
    assert view.snapshot()["old_or_duplicate_packets"] == 1
    view.consume([event(999.5)])         # delayed but under the limit, and still in order
    assert device(view.snapshot())["parameters"]["hr"]["age_ms"] == 2500
    now[0], tick[0] = 1010., 10.
    view.consume([event(1000.), event(1001.)])   # a backlog is never presented as current
    assert device(view.snapshot())["parameters"]["hr"]["value"] is None
    view.consume([event(1010.)])
    assert device(view.snapshot())["parameters"]["hr"]["value"] == 70


def test_a_payload_without_a_parameter_does_not_rejuvenate_it():
    now, tick = [1000.], [0.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: tick[0])
    view.consume([event(1000.)])
    now[0], tick[0] = 1003.1, 3.1
    view.consume([event(1003.1, SPO2_ONLY)])
    parameters = device(view.snapshot())["parameters"]
    assert parameters["hr"]["value"] is None and parameters["hr"]["status"] == "stale"
    assert parameters["spo2"]["value"] == 95


def test_replay_and_clock_regression_fail_closed():
    now, tick = [1000.], [0.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: tick[0])
    view.consume([event(1000.)])
    now[0], tick[0] = 999., 4.           # a hub clock step back must not extend validity
    assert device(view.snapshot())["parameters"]["hr"]["value"] is None
    now[0], tick[0] = 1005., 5.
    view.consume([event(1005., mode="replay")])
    assert device(view.snapshot())["status"] == "unsupported"
    assert device(view.snapshot())["parameters"] == {}
    assert view.snapshot()["rejected_packets"] == 1


def test_a_future_timestamp_is_refused():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1001.)])
    assert device(view.snapshot())["status"] == "unsupported"


def test_hub_live_values_only_after_durable_ack_and_viewer_auth():
    inv = inventory()
    now = [1000.]
    view = LiveResearchView(inv, clock=lambda: now[0], monotonic=lambda: now[0])
    collector, viewer = "c" * 40, "v" * 40
    with tempfile.TemporaryDirectory(prefix="homunculus-live-synthetic-") as folder:
        journal = Journal(Path(folder) / "test.sqlite", Fernet.generate_key(), clock=lambda: now[0])
        try:
            with pytest.raises(ValueError, match="explicit payload"):
                create_hub(inv, journal, collector, viewer, research_view=view)
            app = create_hub(inv, journal, collector, viewer, accept_payload=True,
                             research_view=view, clock=lambda: now[0])
            with TestClient(app) as client:
                target = "/infinity-research/state"
                assert client.get(target).status_code == 401
                assert client.get(target, headers={"Authorization": "Bearer " + collector}).status_code == 401
                item = event(1000.)
                response = client.post("/v1/packets", json={"events": [item]},
                                       headers={"Authorization": "Bearer " + collector})
                assert response.json()["ack"] == [item["id"]]
                assert journal.snapshot()["rows"] == 1
                data = client.get(target, headers={"Authorization": "Bearer " + viewer}).json()
                assert data["devices"][0]["parameters"]["hr"]["value"] == 70
                assert data["clinical_ingest_enabled"] is False
        finally:
            journal.close()


def test_a_waveform_payload_between_readings_does_not_flip_the_device_status():
    # Caught in deployment: a bed interleaves payloads that carry no records, so a status
    # taken from the most recent packet reported a fully reporting bed as having none.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000.)])
    now[0] = 1000.5
    view.consume([event(1000.5, NO_RECORDS)])
    entry = device(view.snapshot())
    assert entry["status"] == "streaming"
    assert entry["parameters"]["hr"]["value"] == 70


def test_a_device_recovers_from_unsupported_once_a_good_packet_arrives():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., mode="replay")])
    assert device(view.snapshot())["status"] == "unsupported"
    now[0] = 1001.
    view.consume([event(1001.)])
    assert device(view.snapshot())["status"] == "streaming"


def test_history_keeps_one_sample_a_second_for_three_minutes_and_no_more():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    item = event(now[0])
    for index in range(5 * 400):              # 400 s at the device's five packets a second
        now[0] = 1000 + index / 5
        view.consume([dict(item, received_at=now[0], id=str(uuid.UUID(int=index + 1)))])
    history = device(view.snapshot())["parameters"]["hr"]["history"]
    assert 179 <= len(history) <= 181           # one a second, not five, and bounded
    # Sampling is at most once a second, so the newest point sits within a second of
    # the newest packet rather than on it.
    assert now[0] - 1 < history[-1][0] <= now[0]
    # The window is measured from the newest sample, since trimming happens on append.
    assert history[0][0] >= history[-1][0] - 180
    assert all(sample == 70 for _, sample in history)
    assert view.snapshot()["history_seconds"] == 180


def test_an_invalid_reading_never_enters_the_trend():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000.)])
    now[0] = 1002.
    view.consume([event(1002., record(HR, 4, valid=False))])
    history = device(view.snapshot())["parameters"]["hr"]["history"]
    assert history == [[1000., 70]]


def test_the_trend_outlives_the_current_value_going_stale():
    # The graph shows what was valid; only the headline number is subject to freshness.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000.)])
    now[0] = 1010.
    entry = device(view.snapshot())["parameters"]["hr"]
    assert entry["value"] is None and entry["status"] == "stale"
    assert entry["history"] == [[1000., 70]]
