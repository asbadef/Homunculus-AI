"""Aşama A: the shadow lane. Unvalidated monitor values, shown to clinicians, fed to nothing.

The values are research decoding of bedside-monitor traffic (`edge/infinity_records.py`). They
are displayed in a strip labelled "doğrulanmamış" and are never an observation: nothing here
calls the engine, the audit, the board's broadcaster, the notification hub or the identity
store. `tests/test_infinity_shadow_isolation.py` holds this module to that, by its imports and
by spies; `tests/test_infinity_shadow_equivalence.py` proves that every clinical output is the
same with the stage on or off.

Configuration never stops the API: a clinical service that will not boot over an optional
display feature is the worse failure. A problem makes the stage `off`, says why, and the
device screen shows it.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

STAGES = ("off", "shadow", "rules", "alarms")   # the design's switch (§5)
IMPLEMENTED = ("off", "shadow")                 # this build: Stage A only
MIN_TOKEN = 32
DEFAULT_TABLE_PATH = "/etc/homunculus/infinity-shadow/device-beds.json"


@dataclass(frozen=True)
class ShadowSettings:
    stage: str = "off"                 # what runs: "off" or "shadow"
    configured: str = "off"            # what the environment asked for
    problem: str | None = None
    token: str = field(default="", repr=False)
    hospital: str = ""
    table_path: str = DEFAULT_TABLE_PATH

    @property
    def on(self) -> bool:
        return self.stage == "shadow"


def shadow_settings_from_env(env: Mapping[str, str], tenants: Mapping[str, str]) -> ShadowSettings:
    configured = (env.get("INFINITY_CLINICAL_STAGE", "") or "").strip().lower() or "off"
    table_path = (env.get("INFINITY_DEVICE_BEDS_PATH", "") or "").strip() or DEFAULT_TABLE_PATH
    token = (env.get("INFINITY_SHADOW_TOKEN", "") or "").strip()
    hospital = (env.get("INFINITY_SHADOW_HOSPITAL", "") or "").strip()
    viewer = (env.get("INFINITY_VIEWER_TOKEN", "") or "").strip()

    def off(problem: str | None) -> ShadowSettings:
        if problem:
            # Names the stage and the problem, never a token.
            log.error("INFINITY_CLINICAL_STAGE=%s çalıştırılamıyor (%s); aşama off olarak çalışıyor",
                      configured, problem)
        return ShadowSettings("off", configured, problem, table_path=table_path)

    if configured == "off":
        return off(None)
    if configured not in STAGES:
        return off("stage_unknown")
    if configured not in IMPLEMENTED:
        return off("stage_not_implemented")
    if not token:
        return off("token_missing")
    if len(token) < MIN_TOKEN:
        return off("token_weak")
    if token in tenants or (viewer and token == viewer):
        return off("token_reused")
    if not hospital or hospital not in set(tenants.values()):
        return off("hospital_missing")
    return ShadowSettings("shadow", configured, None, token, hospital, table_path)
