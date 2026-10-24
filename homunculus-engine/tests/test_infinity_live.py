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


# --- NBP: the time its value last changed ----------------------------------------------------------
#
# The monitor repeats its last NBP in every packet as a valid record, so a packet's age says nothing
# about the cuff. The hub keeps, per device, the last complete valid (systolic, diastolic, mean) and
# the receipt time of the packet in which it CHANGED: a measurement happened at or before then. A
# triple seen first after a start has no time at all — it may be hours old.

NBP_SYS, NBP_DIA, NBP_MEAN = 0x1E08, 0x1E07, 0x1E09
NBP_NAMES = ("nbp_systolic", "nbp_diastolic", "nbp_mean")


def nbp(systolic, diastolic, mean, *, valid=(True, True, True)):
    return (record(NBP_SYS, systolic, valid=valid[0]) + record(NBP_DIA, diastolic, valid=valid[1])
            + record(NBP_MEAN, mean, valid=valid[2]))


def changed_at(view, index=0):
    parameters = device(view.snapshot(), index)["parameters"]
    return {name: parameters[name]["changed_at"] for name in NBP_NAMES if name in parameters}


def test_an_nbp_seen_first_after_a_start_has_no_change_time():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., PAYLOAD + nbp(120, 80, 93))])
    parameters = device(view.snapshot())["parameters"]
    assert (parameters["nbp_systolic"]["value"], parameters["nbp_systolic"]["status"]) == (120, "candidate")
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)          # unknown, never "now"
    assert "changed_at" not in parameters["hr"] and "changed_at" not in parameters["spo2"]


def test_a_changed_triple_is_stamped_with_the_packet_that_showed_it():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.5
    view.consume([event(1001.5, nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.5)
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 118


def test_the_same_triple_repeated_keeps_the_older_time():
    # Every packet repeats the last NBP. An identical re-measurement looks the same and is not
    # detected either: the time stays older than the truth, never newer.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    for stamp in (1002., 1003., 1004.):
        now[0] = stamp
        view.consume([event(stamp, nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)
    assert device(view.snapshot())["parameters"]["nbp_mean"]["capture_epoch"] == 1004.


def test_a_packet_with_two_of_the_three_neither_counts_nor_replaces_the_triple():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., record(NBP_DIA, 70) + record(NBP_MEAN, 85))])     # no systolic
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)
    now[0] = 1002.
    view.consume([event(1002., nbp(120, 80, 93))])       # the triple held is still the first one
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)


def test_an_invalid_component_neither_counts_nor_clears():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([event(1002., nbp(118, 4, 92, valid=(True, False, True)))])     # the monitor shows *** once
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)
    now[0] = 1003.
    view.consume([event(1003., nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)


def test_a_newer_value_carried_without_its_triple_has_no_change_time():
    # A partial packet updates the research view's value; the time of the triple it is not part
    # of must not be lent to it, or a newer value would read as measured at the older time.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([event(1002., record(NBP_SYS, 105))])
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 105
    assert changed_at(view) == {"nbp_systolic": None, "nbp_diastolic": 1001., "nbp_mean": 1001.}


def test_a_change_seen_only_after_an_outage_has_no_time():
    # It may have happened at any moment of the outage. Stamped with the first packet after it, a
    # measurement as old as the outage would read as minutes old: hidden instead until the next
    # change seen as it happens, as after a hub restart.
    now, tick = [1000.], [0.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: tick[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0], tick[0] = 1001., 1.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0], tick[0] = 1600., 600.
    view.consume([event(1300., nbp(140, 90, 107)), event(1597., nbp(140, 90, 107))])   # the outbox's backlog
    view.consume([event(1001., nbp(150, 95, 113))])                                   # one already delivered
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)       # a packet 3 s old or older changes nothing
    assert view.snapshot()["old_or_duplicate_packets"] == 3
    view.consume([event(1599.2, nbp(140, 90, 107))])                 # the first live packet: changed, but when?
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)
    now[0], tick[0] = 1601., 601.
    view.consume([event(1600.4, nbp(141, 90, 107))])                 # the next change, seen as it happens
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1600.4)


@pytest.mark.parametrize(("gap", "stamped"), [(3.0, True), (3.1, False)])
def test_a_change_keeps_its_time_only_if_a_complete_triple_came_within_the_last_3_s(gap, stamped):
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., PAYLOAD + nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., PAYLOAD + nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([event(1002., PAYLOAD)])                            # HR and SpO₂ go on; no NBP record
    now[0] = 1001. + gap
    view.consume([event(1001. + gap, PAYLOAD + nbp(131, 85, 100))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001. + gap if stamped else None)


ALL_FLAGGED = (False, False, False)


def test_a_flagged_first_packet_after_an_outage_does_not_start_a_run():
    # A flagged record can mean "not carried in this message type", not "heard": hearing one proves
    # nothing about having watched the value. The result that follows 0.2 s later may be as old as
    # the outage, so it must not be stamped as seen live.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)
    now[0] = 1599.3                                                  # an outage; this is the first packet back
    view.consume([event(1599.2, nbp(1, 1, 1, valid=ALL_FLAGGED))])
    now[0] = 1599.5
    view.consume([event(1599.4, nbp(131, 85, 100))])                 # a result, but since when?
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 131
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)


def test_a_lone_component_as_the_first_packet_after_an_outage_does_not_start_a_run():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)
    now[0] = 1599.3
    view.consume([event(1599.2, record(NBP_SYS, 131))])              # one component alone, valid
    now[0] = 1599.5
    view.consume([event(1599.4, nbp(131, 85, 100))])
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 131
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)


def test_a_result_after_a_long_spell_of_stars_has_no_time_because_flagged_records_prove_no_continuity():
    # Strict rule: only a run of COMPLETE VALID triples is continuity. A spell of ten minutes of
    # flagged NBP, one packet a second, leaves the result that ends it unstamped; the next change,
    # seen right after a complete triple, is stamped again.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    for second in range(1, 600):                                     # 599 packets, 1001 .. 1599
        now[0] = 1000. + second
        view.consume([event(now[0], nbp(1, 1, 1, valid=ALL_FLAGGED))])
    now[0] = 1600.
    view.consume([event(1600., nbp(131, 85, 100))])
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 131
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)
    now[0] = 1601.
    view.consume([event(1601., nbp(132, 85, 100))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1601.)


def test_a_result_after_minutes_of_the_same_triple_is_stamped_because_every_repeat_renews_the_run():
    # The counterpart of the spell of stars: the monitor repeats its last result in every packet, so
    # a result that follows ten minutes of a stable triple is preceded by a complete valid triple
    # one second earlier. If only a CHANGE renewed the run, no real result would ever be stamped.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    for second in range(1, 600):                                     # 599 repeats, 1001 .. 1599
        now[0] = 1000. + second
        view.consume([event(now[0], nbp(120, 80, 93))])
    now[0] = 1600.5
    view.consume([event(1600.5, nbp(131, 85, 100))])                 # 1.5 s after the last repeat
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1600.5)


def test_packets_the_view_drops_do_not_renew_the_run():
    # Old, already delivered, replayed, undecodable and from-the-future packets are not heard: a
    # complete triple in one of them must not make the next change look watched.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0] = 1600.                                                   # an outage
    other = nbp(140, 90, 107)
    view.consume([event(1599., PAYLOAD)])                            # first packet back: no NBP record
    view.consume([event(1597., other),                               # old: 3 s or more
                  event(1598.9, other),                              # already delivered: before 1599.
                  event(1599.5, other, mode="replay"),               # not live
                  dict(event(1599.6, other), payload_base64="!"),    # not base64
                  event(1601., other)])                              # from the future
    snapshot = view.snapshot()
    assert (snapshot["old_or_duplicate_packets"], snapshot["rejected_packets"]) == (2, 3)
    view.consume([event(1599.8, nbp(141, 91, 108))])                 # the first live triple, not the dropped ones'
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)              # changed, but when?


def test_packets_the_view_drops_neither_clear_the_triple_nor_break_the_run():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([dict(event(1001.5, nbp(118, 79, 92)), payload_base64="!"),    # not base64
                  event(1003., nbp(150, 95, 113))])                             # from the future
    snapshot = view.snapshot()
    assert snapshot["rejected_packets"] == 2
    assert changed_at(view) == {}                                    # the readings are cleared, the triple is not
    now[0] = 1003.
    view.consume([event(1002.8, nbp(131, 85, 100))])                 # 1.8 s after the last complete triple
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1002.8)


def test_two_devices_keep_their_own_run():
    now = [1000.]
    view = LiveResearchView(inventory(2), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93), index=0), event(1000., nbp(120, 80, 93), index=1)])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92), index=0)])
    for stamp in (1002., 1003., 1004., 1005.):                       # device 0 goes on sending triples
        now[0] = stamp
        view.consume([event(stamp, nbp(118, 79, 92), index=0)])
    view.consume([event(1005., nbp(118, 79, 92), index=1)])          # device 1 is back after 5 s with a new triple
    assert changed_at(view, 0) == dict.fromkeys(NBP_NAMES, 1001.)
    assert changed_at(view, 1) == dict.fromkeys(NBP_NAMES)
    now[0] = 1006.
    view.consume([event(1006., nbp(131, 85, 100), index=1)])         # device 1's next change, seen live
    assert changed_at(view, 0) == dict.fromkeys(NBP_NAMES, 1001.)
    assert changed_at(view, 1) == dict.fromkeys(NBP_NAMES, 1006.)
