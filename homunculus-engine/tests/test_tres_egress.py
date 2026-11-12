# homunculus-engine/tests/test_tres_egress.py
"""TRƏS-01 (spec D2): the install's lock. `TRES_EGRESS` unset or anything but `on` is closed, and
the app says which it is (`app.state.tres_egress`) from the environment it was built in. Where the
data may go is the install's decision too: `TRES_HOSTS` (the platform's two hosts when unset), and
`open_client`, the one way to a client, refuses a closed lock and any other host or port — the
app's own factory is that one. No database, no network."""
from __future__ import annotations

import httpx
import pytest

from homunculus.api.app import create_app
from homunculus.tres.client import TresAccount, TresClient
from homunculus.tres import egress
from homunculus.tres.egress import (
    DEFAULT_HOSTS, LIVE_HOSTS, TresEgressRefused, address_allowed, allowed_hosts, egress_on, live_closed, open_client,
)


@pytest.mark.parametrize("value", ["on", "ON", " On ", "on\n"])
def test_on_in_any_case_and_with_stray_whitespace_opens_it(value):
    assert egress_on({"TRES_EGRESS": value}) is True


@pytest.mark.parametrize("value", ["", " ", "off", "1", "true", "yes", "open", "onn", "o n"])
def test_anything_else_is_closed(value):
    assert egress_on({"TRES_EGRESS": value}) is False


def test_unset_is_closed():
    assert egress_on({}) is False
    assert egress_on({"TRES_EGRESS_OTHER": "on"}) is False


def test_the_app_is_closed_unless_the_environment_says_on(monkeypatch):
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    assert create_app({"t": "HOSP1"}, run_escalation_loop=False).state.tres_egress is False
    monkeypatch.setenv("TRES_EGRESS", "off")
    assert create_app({"t": "HOSP1"}, run_escalation_loop=False).state.tres_egress is False
    monkeypatch.setenv("TRES_EGRESS", "on")
    assert create_app({"t": "HOSP1"}, run_escalation_loop=False).state.tres_egress is True


# ---------------------------------------------------------------- where the data may go (review #4)
def test_the_allowed_hosts_are_the_platforms_two_unless_the_install_names_its_own():
    assert DEFAULT_HOSTS == {"ehr-sandbox.e-health.gov.az", "ehr.e-health.gov.az"}
    for unset in ({}, {"TRES_HOSTS": ""}, {"TRES_HOSTS": " , ,"}):
        assert allowed_hosts(unset) == DEFAULT_HOSTS
    assert allowed_hosts({"TRES_HOSTS": " Tres.Test ,ehr-sandbox.example.az,, "}) == {
        "tres.test", "ehr-sandbox.example.az"}


@pytest.mark.parametrize("base_url, allowed", [
    ("https://tres.test", True), ("https://TRES.test/fhir-base", True), ("https://tres.test:443", True),
    ("https://tres.test:8443", False), ("https://other.test", False), ("http://tres.test", False),
    ("https://u:p@tres.test", False), ("https://tres.test/?x=1", False), ("https://tres.test/#a", False),
    ("https://tres.test.other.test", False), ("https://other.test\\@tres.test", False), ("", False),
    ("https://xn--a.gov.az", False), ("https://TRES.TEST.", False),
])
def test_an_address_is_allowed_only_on_an_allowed_host_and_port_443(base_url, allowed):
    assert address_allowed(base_url, frozenset({"tres.test"})) is allowed


def test_the_one_way_to_a_client_refuses_a_closed_lock_and_a_host_the_install_does_not_allow(monkeypatch):
    built = []
    monkeypatch.setattr(httpx.AsyncClient, "__init__", lambda self, *a, **k: built.append(1))
    hosts = frozenset({"tres.test"})
    with pytest.raises(TresEgressRefused) as refused:
        open_client(TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001"), egress=False, hosts=hosts)
    assert refused.value.code == "egress_off"
    for elsewhere in ("https://other.test", "https://tres.test:8443"):
        with pytest.raises(TresEgressRefused) as refused:
            open_client(TresAccount(elsewhere, "sentetik", "gizli-parola", "PRV-0001"), egress=True, hosts=hosts)
        assert refused.value.code == "tres_host_not_allowed"
    client = open_client(TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001"),
                         egress=True, hosts=hosts)
    assert isinstance(client, TresClient) and client._client is None and built == []


def test_the_apps_own_factory_is_the_guarded_one(monkeypatch):
    sandbox = TresAccount("https://ehr-sandbox.e-health.gov.az", "sentetik", "gizli-parola", "PRV-0001")
    stand_in = TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    monkeypatch.delenv("TRES_HOSTS", raising=False)
    closed = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    assert closed.state.tres_hosts == DEFAULT_HOSTS
    with pytest.raises(TresEgressRefused) as refused:
        closed.state.tres_client_factory(sandbox)          # a caller that forgot the lock fails closed
    assert refused.value.code == "egress_off"
    monkeypatch.setenv("TRES_EGRESS", "on")
    opened = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    assert isinstance(opened.state.tres_client_factory(sandbox), TresClient)
    with pytest.raises(TresEgressRefused) as refused:
        opened.state.tres_client_factory(stand_in)
    assert refused.value.code == "tres_host_not_allowed"
    monkeypatch.setenv("TRES_HOSTS", "tres.test")
    narrowed = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    assert narrowed.state.tres_hosts == {"tres.test"}
    assert isinstance(narrowed.state.tres_client_factory(stand_in), TresClient)
    with pytest.raises(TresEgressRefused):
        narrowed.state.tres_client_factory(sandbox)


def test_an_address_is_judged_by_its_wire_form_and_never_raises():
    """Review M1: the host as it goes on the wire (`raw_host`), so a host IDNA cannot read is just
    not allowed — unless the install named exactly that host."""
    assert address_allowed("https://xn--a.gov.az", frozenset({"tres.test"})) is False
    assert address_allowed("https://XN--A.gov.az/fhir", frozenset({"xn--a.gov.az"})) is True


# ---------------------------------------------------------------- the live platform (plan F1: O5, O11)
def test_the_live_platform_is_closed_in_this_version():
    """Opening it is a code change with the owner's word (O5, O11): this line changes with it."""
    assert egress.LIVE_OPEN is False
    assert LIVE_HOSTS == {"ehr.e-health.gov.az"} and LIVE_HOSTS < DEFAULT_HOSTS


@pytest.mark.parametrize("environment, base_url, closed", [
    ("live", "https://ehr.e-health.gov.az", True),
    ("live", "https://ehr-sandbox.e-health.gov.az", True),          # the live environment, wherever it points
    ("live", None, True),
    ("test", "https://ehr.e-health.gov.az", True),                  # the live host, under the test account
    ("test", "https://EHR.e-health.gov.az/fhir-base", True),
    ("test", "https://ehr-sandbox.e-health.gov.az", False),
    ("test", "https://tres.test", False),
    ("test", None, False), ("test", "not a url", False),
])
def test_a_package_to_the_live_platform_is_held_back(environment, base_url, closed):
    assert live_closed(environment, base_url) is closed


def test_with_live_open_nothing_is_held_back(monkeypatch):
    monkeypatch.setattr(egress, "LIVE_OPEN", True)
    assert not live_closed("live", "https://ehr.e-health.gov.az")
