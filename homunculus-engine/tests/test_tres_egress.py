# homunculus-engine/tests/test_tres_egress.py
"""TRƏS-01 (spec D2): the install's lock. `TRES_EGRESS` unset or anything but `on` is closed, and
the app says which it is (`app.state.tres_egress`) from the environment it was built in. Where the
data may go is the install's decision too: `TRES_HOSTS` (the platform's two hosts when unset), and
`open_client`, the one way to a client, refuses a closed lock and any other host or port — the
app's own factory is that one. No database, no network."""
from __future__ import annotations

import inspect

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
    # review M1: the host as DNS reads it — a trailing dot is the same host, not another
    ("test", "https://ehr.e-health.gov.az.", True),
    ("test", "https://ehr.e-health.gov.az./fhir", True),
    ("test", "https://EHR.E-Health.GOV.az.:443/fhir-base", True),
    ("test", "https://ehr-sandbox.e-health.gov.az.", False),
    # No address at all: nothing to reach (the account is incomplete, and `address_allowed` refuses
    # it anyway). An address that CANNOT BE READ is another matter — see below.
    ("test", None, False), ("test", "", False), ("test", "   ", False),
    # review M1: fail CLOSED. This lock must hold whatever the install says: text that does not
    # parse to a host (no scheme, no host) counts as the live platform.
    ("test", "not a url", True), ("test", "ehr.e-health.gov.az", True), ("test", "https://", True),
    ("test", "https://xn--a.gov.az", False),                    # readable in its wire form, and not a live host
])
def test_a_package_to_the_live_platform_is_held_back(environment, base_url, closed):
    assert live_closed(environment, base_url) is closed


def test_an_address_httpx_refuses_outright_is_closed_too(monkeypatch):
    """The other way an address can be unreadable: httpx raises. Closed, never open."""
    def refuse(_):
        raise httpx.InvalidURL("sentetik")

    monkeypatch.setattr(httpx, "URL", refuse)
    assert live_closed("test", "https://tres.test") is True


def test_with_live_open_nothing_is_held_back(monkeypatch):
    monkeypatch.setattr(egress, "LIVE_OPEN", True)
    assert not live_closed("live", "https://ehr.e-health.gov.az")
    assert not live_closed("test", "not a url")


# ---------------------------------------------------------------- the lock inside the factory (review M10)
LIVE_ACCOUNT = TresAccount("https://ehr.e-health.gov.az", "sentetik", "gizli-parola", "PRV-0001")


def _no_client_may_be_built(monkeypatch) -> list:
    """Anything that builds a TresClient or an httpx client lands in the list."""
    built: list = []
    monkeypatch.setattr(httpx.AsyncClient, "__init__", lambda self, *a, **k: built.append("httpx"))
    monkeypatch.setattr(egress, "TresClient", lambda *a, **k: built.append("tres"))
    return built


@pytest.mark.parametrize("base_url, hosts", [
    ("https://ehr.e-health.gov.az", DEFAULT_HOSTS),                       # the platform's live host
    ("https://EHR.e-health.gov.az/fhir-base", DEFAULT_HOSTS),             # the test account on the live host
    ("https://ehr.e-health.gov.az.", frozenset({"ehr.e-health.gov.az."})),   # an install that names the dotted form
])
def test_the_factory_opens_nothing_on_the_live_host_unless_it_is_told_no_patient_data_goes(
        monkeypatch, base_url, hosts):
    """Review M10: closed by default. A path that forgets its own `live_closed` check (F2–F6 add
    new sending paths, deletes among them) still cannot reach the live host: `open_client` asks it
    itself, before any client exists."""
    built = _no_client_may_be_built(monkeypatch)
    account = TresAccount(base_url, "sentetik", "gizli-parola", "PRV-0001")
    with pytest.raises(egress.TresLiveClosed) as refused:
        open_client(account, egress=True, hosts=hosts)
    assert isinstance(refused.value, TresEgressRefused) and refused.value.code == "tres_live_closed"
    assert "e-health" not in str(refused.value) and "sentetik" not in str(refused.value)   # no URL, no account
    with pytest.raises(egress.TresLiveClosed):
        open_client(account, egress=True, hosts=hosts, patient_data=True)
    assert built == []


def test_the_connection_test_alone_may_open_the_live_host_and_only_through_the_other_locks():
    """`patient_data=False` is the connection test's (no patient data): the live lock does not hold
    it — the install's lock and its hosts still do. Nothing is connected here (a client connects
    on its first call), so no network is touched."""
    client = open_client(LIVE_ACCOUNT, egress=True, hosts=DEFAULT_HOSTS, patient_data=False)
    assert isinstance(client, TresClient) and client._client is None
    with pytest.raises(TresEgressRefused) as refused:
        open_client(LIVE_ACCOUNT, egress=False, hosts=DEFAULT_HOSTS, patient_data=False)
    assert refused.value.code == "egress_off"
    with pytest.raises(TresEgressRefused) as refused:
        open_client(LIVE_ACCOUNT, egress=True, hosts=frozenset({"tres.test"}), patient_data=False)
    assert refused.value.code == "tres_host_not_allowed"


def test_the_sandbox_is_opened_with_the_default_and_the_default_is_patient_data():
    sandbox = TresAccount("https://ehr-sandbox.e-health.gov.az", "sentetik", "gizli-parola", "PRV-0001")
    assert isinstance(open_client(sandbox, egress=True, hosts=DEFAULT_HOSTS), TresClient)
    assert inspect.signature(open_client).parameters["patient_data"].default is True
    assert inspect.signature(open_client).parameters["patient_data"].kind is inspect.Parameter.KEYWORD_ONLY


def test_the_factory_follows_live_open(monkeypatch):
    monkeypatch.setattr(egress, "LIVE_OPEN", True)
    assert isinstance(open_client(LIVE_ACCOUNT, egress=True, hosts=DEFAULT_HOSTS), TresClient)


def test_the_apps_own_factory_closes_the_live_host_to_patient_data_by_default(monkeypatch):
    monkeypatch.setenv("TRES_EGRESS", "on")
    monkeypatch.delenv("TRES_HOSTS", raising=False)
    opened = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    with pytest.raises(egress.TresLiveClosed):
        opened.state.tres_client_factory(LIVE_ACCOUNT)
    assert isinstance(opened.state.tres_client_factory(LIVE_ACCOUNT, patient_data=False), TresClient)
