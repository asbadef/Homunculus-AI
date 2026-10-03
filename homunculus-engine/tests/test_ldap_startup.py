"""Start-up (spec §9): with a directory configured, the API binds once with the service account
in the background and logs the outcome — a failure is a warning, never a refusal to boot, and a
hung directory never delays serving local sign-ins. Production builds the directory from
LDAP_*."""
from __future__ import annotations

import asyncio
import logging
import os

import pytest

from homunculus.api.app import create_app
from tests.fake_directory import FakeDirectory, runtime


async def _boot(rt):
    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False, ldap=rt)
    async with app.router.lifespan_context(app):
        await app.state.ldap_startup_check
    return app


async def test_the_api_binds_once_at_startup_and_remembers_the_outcome(caplog):
    rt = runtime(FakeDirectory())
    with caplog.at_level(logging.INFO, logger="homunculus.auth.ldap"):
        await _boot(rt)
    assert rt.last_test_ok is True and rt.directory.calls == [("test_connection", "")]
    assert "succeeded" in caplog.text


async def test_a_directory_that_does_not_answer_is_a_warning_not_a_refusal(caplog):
    rt = runtime(FakeDirectory())
    rt.directory.unavailable = True
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.ldap"):
        app = await _boot(rt)
    assert rt.last_test_ok is False and "FAILED (unreachable)" in caplog.text
    assert app.state.ldap is rt


async def test_a_hung_directory_does_not_hold_up_startup():
    class Hung(FakeDirectory):
        async def test_connection(self):
            await asyncio.sleep(3600)

    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False, ldap=runtime(Hung()))
    async with asyncio.timeout(2):
        async with app.router.lifespan_context(app):
            check = app.state.ldap_startup_check
            assert not check.done()                  # serving has begun; the check still runs
    with pytest.raises(asyncio.CancelledError):
        await check                                  # shutdown cancelled it


async def test_without_a_directory_there_is_no_check():
    app = create_app({"t": "demo-hastanesi"}, run_escalation_loop=False)
    async with app.router.lifespan_context(app):
        assert app.state.ldap_startup_check is None and app.state.ldap is None


def test_production_takes_the_directory_from_the_environment():
    if os.getenv("LDAP_URL"):
        pytest.skip("LDAP_URL is set in this shell")
    from homunculus.api import prodserver

    assert prodserver.app.state.ldap is None
