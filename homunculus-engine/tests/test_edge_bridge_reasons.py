"""A rejected message must say WHY in the log — without saying WHAT (no content)."""
import logging

import pytest

from homunculus.edge.bridge import EdgeBridge
from homunculus.gateway.fhir import GatewayError

ANONYMOUS_ORU = (
    "MSH|^~\\&|NCE|HOSP|EMR|HIS|20260904142002||ORU^R01^ORU_R01|C1|P|2.5\r"
    "PID|||^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F\r"
)


def test_rejection_log_names_the_reason_but_not_the_content(caplog):
    bridge = EdgeBridge(send=lambda _p: None)
    with caplog.at_level(logging.WARNING, logger="homunculus.edge.bridge"):
        with pytest.raises(GatewayError):
            bridge.handle_message(ANONYMOUS_ORU)
    [record] = [r for r in caplog.records if "rejected" in r.getMessage()]
    text = record.getMessage()
    assert "PID-3" in text                       # the reason
    assert "97" not in text and "^^^X^PI" not in text   # never the message itself
    assert bridge.stats.rejected == 1
