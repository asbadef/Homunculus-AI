"""The research window's API face: role gate, configuration, upstream failures, reshaping.

The hub itself is never contacted here — `fetch_state` is replaced — so these run without
network, credentials or a database. Synthetic payloads only.
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from homunculus.api import infinity_research
from homunculus.api.app import create_app

ENV = {"INFINITY_HUB_URL": "https://hub.example:8766", "INFINITY_VIEWER_TOKEN": "v" * 40,
       "INFINITY_HUB_CA_FILE": "/etc/homunculus/infinity-ca.pem"}

HUB_ANSWER = {
    "schema": "homunculus.infinity-preview.v3", "mode": "live", "evidence": "record_decoded",
    "clinical_ingest_enabled": False, "clinical_mapping_verified": False,
    "clinical_validity": "unknown", "stale_after_ms": 3000.0, "history_seconds": 180.0,
    "accepted_packets": 5, "rejected_packets": 0, "old_or_duplicate_packets": 0,
    "replay_cycle": None, "internal_only": "must not pass",
    "devices": [{"device_id": "m-1", "source_ip": "192.0.2.1", "group": "239.20.1.1",
                 "status": "streaming", "packets": 5, "packet_age_ms": 200.0, "secret": "no",
                 "parameters": {"hr": {"value": 70, "status": "candidate", "unit": "bpm",
                                       "age_ms": 500.0, "alarm_low": 45, "alarm_high": 130,
                                       "evidence": "display_verified", "capture_epoch": 1.0,
                                       "history": [[1.0, 70]], "leak": "no"}}}],
}


@pytest.fixture
def client(monkeypatch):
    app = create_app({}, run_escalation_loop=False)
    app.dependency_overrides[infinity_research.device_roles] = lambda: object()
    with TestClient(app) as c:
        yield c, monkeypatch


def test_the_gate_is_the_only_way_in(monkeypatch):
    app = create_app({}, run_escalation_loop=False)
    with TestClient(app) as c:
        assert c.get("/infinity-research/state").status_code == 401


def test_unconfigured_is_a_named_condition_not_a_crash(client):
    c, monkeypatch = client
    for key in ENV:
        monkeypatch.delenv(key, raising=False)
    response = c.get("/infinity-research/state")
    assert response.status_code == 503 and response.json()["detail"]["reason"] == "not_configured"


def test_a_half_filled_configuration_counts_as_unconfigured(client):
    c, monkeypatch = client
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("INFINITY_VIEWER_TOKEN", "")
    assert c.get("/infinity-research/state").json()["detail"]["reason"] == "not_configured"


def test_a_plain_http_hub_url_is_refused(client):
    c, monkeypatch = client
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("INFINITY_HUB_URL", "http://hub.example:8766")
    response = c.get("/infinity-research/state")
    assert response.status_code == 503 and response.json()["detail"]["reason"] == "misconfigured"


def test_the_answer_is_an_allow_list_copy(client):
    c, monkeypatch = client
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(infinity_research, "fetch_state",
                        lambda settings: infinity_research._reshape(HUB_ANSWER))
    body = c.get("/infinity-research/state").json()
    assert body["schema"] == "homunculus.infinity-preview.v3"
    assert "internal_only" not in body
    device = body["devices"][0]
    assert "secret" not in device and device["status"] == "streaming"
    assert device["parameters"]["hr"]["value"] == 70
    assert "leak" not in device["parameters"]["hr"]
    assert device["parameters"]["hr"]["history"] == [[1.0, 70]]


@pytest.mark.parametrize("reason", ["upstream_unreachable", "upstream_timeout",
                                    "upstream_unauthorized", "research_disabled"])
def test_upstream_failures_are_named_and_never_leak_the_hub_body(client, reason):
    c, monkeypatch = client
    for key, value in ENV.items():
        monkeypatch.setenv(key, value)
    def failing(settings):
        raise HTTPException(503, {"reason": reason})
    monkeypatch.setattr(infinity_research, "fetch_state", failing)
    response = c.get("/infinity-research/state")
    assert response.status_code == 503 and response.json()["detail"] == {"reason": reason}


def test_a_hub_that_started_clinical_forwarding_is_refused():
    # The window was built for a hub that never forwards. If that changes, refusing to
    # display is the honest response; carrying on as usual is not.
    assert infinity_research._reshape(HUB_ANSWER)["clinical_ingest_enabled"] is False
    changed = dict(HUB_ANSWER, clinical_ingest_enabled=True)
    import json
    from unittest import mock
    class Resp:
        def __init__(self, data): self._d = data
        def read(self, n=-1): return self._d
        def __enter__(self): return self
        def __exit__(self, *a): return False
    with mock.patch.object(infinity_research.urllib.request, "build_opener") as build:
        build.return_value.open.return_value = Resp(json.dumps(changed).encode())
        with mock.patch.object(infinity_research.ssl, "create_default_context"):
            with pytest.raises(HTTPException) as caught:
                infinity_research.fetch_state(("https://hub.example", "t" * 40, "/ca.pem"))
    assert caught.value.status_code == 502 and caught.value.detail == {"reason": "upstream_policy"}
