# homunculus-engine/tests/test_tres_egress.py
"""TRƏS-01 (spec D2): the install's lock. `TRES_EGRESS` unset or anything but `on` is closed, and
the app says which it is (`app.state.tres_egress`) from the environment it was built in. No
database, no network."""
from __future__ import annotations

import pytest

from homunculus.api.app import create_app
from homunculus.tres.egress import egress_on


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
