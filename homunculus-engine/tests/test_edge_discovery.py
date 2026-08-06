"""
Discovery mode — the thing that stops Monday failing silently.

A real Mindray station emits its own OBX identifiers, not our SignalCode slugs. Without a mapping
every observation is dropped while messages still arrive and ACKs still go back: the link looks
perfectly healthy and no data lands. So the bridge counts the codes it could not map and reports
them, turning an invisible failure into a five-minute fix.

PHI: the OBX identifier is device metadata and is reported. The measured value is patient data and
must never reach a log.
"""
from __future__ import annotations

from homunculus.canonical import SignalCode
from homunculus.edge.bridge import EdgeBridge

MINDRAY_STYLE = (
    "MSH|^~\\&|MINDRAY|ICU|HOMUNCULUS|HOSP|20260803120000||ORU^R01|MSG1|P|2.5\r"
    "PID|||bed-3\r"
    "OBX|1|NM|MDC_ECG_HEART_RATE||118|bpm|||||F|||20260803120000\r"
    "OBX|2|NM|MDC_PRESS_BLD_NONINV_MEAN||58|mmHg|||||F|||20260803120000\r"
    "OBX|3|NM|heart_rate||120|bpm|||||F|||20260803120000\r"
)


def test_counts_codes_it_could_not_map():
    bridge = EdgeBridge(send=lambda _p: None)

    bridge.handle_message(MINDRAY_STYLE)

    assert bridge.stats.unmapped == {"MDC_ECG_HEART_RATE": 1, "MDC_PRESS_BLD_NONINV_MEAN": 1}


def test_counts_accumulate_across_messages():
    bridge = EdgeBridge(send=lambda _p: None)

    bridge.handle_message(MINDRAY_STYLE)
    bridge.handle_message(MINDRAY_STYLE)

    assert bridge.stats.unmapped["MDC_ECG_HEART_RATE"] == 2


def test_the_recognised_code_still_flows():
    """Discovery must not interfere with the observations we *can* map."""
    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append)

    bridge.handle_message(MINDRAY_STYLE)

    assert len(sent) == 1
    assert bridge.stats.observations == 1


def test_a_site_mapping_replaces_the_default_rather_than_extending_it():
    """Supplying a site mapping makes the vendor codes flow — and makes our own slugs unmapped.

    The site table is authoritative: it REPLACES the default rather than merging with it, so a
    vendor code cannot silently collide with one of our slugs. The consequence is worth stating —
    once a site mapping exists it must list every code that site actually sends.
    """
    sent: list[dict] = []
    bridge = EdgeBridge(
        send=sent.append,
        mapping={
            "MDC_ECG_HEART_RATE": SignalCode.HEART_RATE,
            "MDC_PRESS_BLD_NONINV_MEAN": SignalCode.MAP,
        },
    )

    bridge.handle_message(MINDRAY_STYLE)

    assert len(sent) == 2                              # the two vendor codes now forward
    assert bridge.stats.unmapped == {"heart_rate": 1}  # our slug is no longer recognised


def test_discovery_report_lists_codes_but_never_values():
    bridge = EdgeBridge(send=lambda _p: None)
    bridge.handle_message(MINDRAY_STYLE)

    report = bridge.discovery_report()

    assert "MDC_ECG_HEART_RATE" in report
    assert "118" not in report                  # the measurement is PHI and must not appear
    assert "bed-3" not in report                # nor the patient identifier


def test_report_is_empty_when_everything_maps():
    bridge = EdgeBridge(send=lambda _p: None)
    bridge.handle_message(
        "MSH|^~\\&|M|ICU|H|HOSP|20260803120000||ORU^R01|M2|P|2.5\r"
        "PID|||bed-3\r"
        "OBX|1|NM|heart_rate||118|bpm|||||F|||20260803120000\r"
    )

    assert bridge.discovery_report() == ""
