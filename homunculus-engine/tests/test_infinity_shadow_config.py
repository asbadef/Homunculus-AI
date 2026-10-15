"""Aşama A's stage switch: `INFINITY_CLINICAL_STAGE`, off by default, never a reason to refuse start.

The shadow lane opens only with a dedicated token that is not a `TENANTS` device token: a device
token passes every permission check and can write `/ingest`, so it must never be the key to the
lane. A configuration problem makes the stage `off` and says why; it never stops the API.
"""
from __future__ import annotations

import logging

import pytest

from homunculus.api.infinity_shadow import DEFAULT_TABLE_PATH, ShadowSettings, shadow_settings_from_env

DEVICE = "tok-device-00000000000000000000000000"
VIEWER = "viewer-token-0000000000000000000000000000"
STRONG = "s" * 40
TENANTS = {DEVICE: "HOSP1"}


def _env(**over):
    env = {"INFINITY_CLINICAL_STAGE": "shadow", "INFINITY_SHADOW_TOKEN": STRONG,
           "INFINITY_SHADOW_HOSPITAL": "HOSP1", "INFINITY_VIEWER_TOKEN": VIEWER}
    env.update(over)
    return env


def test_unset_is_off():
    settings = shadow_settings_from_env({}, TENANTS)
    assert settings.stage == "off" and settings.configured == "off"
    assert settings.problem is None and not settings.on
    assert ShadowSettings().stage == "off" and not ShadowSettings().on


def test_off_and_shadow_are_read_case_and_space_insensitively():
    on = shadow_settings_from_env(_env(INFINITY_CLINICAL_STAGE=" Shadow "), TENANTS)
    assert on.stage == "shadow" and on.on and on.problem is None
    assert on.token == STRONG and on.hospital == "HOSP1"
    off = shadow_settings_from_env(_env(INFINITY_CLINICAL_STAGE=" OFF "), TENANTS)
    assert off.stage == "off" and off.configured == "off" and off.problem is None
    blank = shadow_settings_from_env(_env(INFINITY_CLINICAL_STAGE="   "), TENANTS)
    assert blank.stage == "off" and blank.problem is None


@pytest.mark.parametrize("stage", ["rules", "alarms", "ALARMS"])
def test_rules_and_alarms_are_not_in_this_build_and_run_as_off(stage, caplog):
    with caplog.at_level(logging.ERROR, logger="homunculus.api.infinity_shadow"):
        settings = shadow_settings_from_env(_env(INFINITY_CLINICAL_STAGE=stage), TENANTS)
    assert settings.stage == "off" and not settings.on
    assert settings.configured == stage.lower()
    assert settings.problem == "stage_not_implemented"
    assert settings.token == ""                      # an off lane holds no key
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    text = errors[0].getMessage()
    assert "stage_not_implemented" in text and stage.lower() in text
    assert STRONG not in text and VIEWER not in text


def test_an_unknown_value_runs_as_off():
    settings = shadow_settings_from_env(_env(INFINITY_CLINICAL_STAGE="on"), TENANTS)
    assert (settings.stage, settings.configured, settings.problem) == ("off", "on", "stage_unknown")


@pytest.mark.parametrize(("token", "problem"), [("", "token_missing"), ("   ", "token_missing"),
                                                 ("s" * 31, "token_weak")])
def test_shadow_needs_a_token_of_32_or_more(token, problem):
    settings = shadow_settings_from_env(_env(INFINITY_SHADOW_TOKEN=token), TENANTS)
    assert (settings.stage, settings.problem) == ("off", problem)
    assert shadow_settings_from_env(_env(INFINITY_SHADOW_TOKEN="s" * 32), TENANTS).on


@pytest.mark.parametrize("reused", [DEVICE, VIEWER])
def test_a_tenants_token_or_the_viewer_token_is_refused(reused):
    # A TENANTS token is a device Caller: it passes every permission check and can POST /ingest.
    # The lane's key must never be one, or the forwarder would hold a key to the engine.
    settings = shadow_settings_from_env(_env(INFINITY_SHADOW_TOKEN=reused), TENANTS)
    assert (settings.stage, settings.problem) == ("off", "token_reused")
    assert settings.token == ""


@pytest.mark.parametrize("hospital", ["", "HOSP2"])
def test_the_hospital_must_be_one_the_api_serves(hospital):
    settings = shadow_settings_from_env(_env(INFINITY_SHADOW_HOSPITAL=hospital), TENANTS)
    assert (settings.stage, settings.problem) == ("off", "hospital_missing")


def test_the_token_is_never_in_repr_or_logs(caplog):
    with caplog.at_level(logging.DEBUG, logger="homunculus.api.infinity_shadow"):
        on = shadow_settings_from_env(_env(), TENANTS)
        for over in ({"INFINITY_CLINICAL_STAGE": "rules"}, {"INFINITY_SHADOW_TOKEN": "w" * 31},
                     {"INFINITY_SHADOW_TOKEN": DEVICE}, {"INFINITY_SHADOW_HOSPITAL": "nope"}):
            shadow_settings_from_env(_env(**over), TENANTS)
    assert on.on and STRONG not in repr(on) and STRONG not in str(on)
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert caplog.records, "the refusals above must have been logged"
    for secret in (STRONG, "w" * 31, DEVICE, VIEWER):
        assert secret not in logged


def test_the_table_path_defaults_inside_the_mounted_directory():
    assert DEFAULT_TABLE_PATH == "/etc/homunculus/infinity-shadow/device-beds.json"
    assert shadow_settings_from_env({}, TENANTS).table_path == DEFAULT_TABLE_PATH
    assert shadow_settings_from_env(_env(), TENANTS).table_path == DEFAULT_TABLE_PATH
    moved = shadow_settings_from_env(_env(INFINITY_DEVICE_BEDS_PATH=" /tmp/x.json "), TENANTS)
    assert moved.table_path == "/tmp/x.json"
