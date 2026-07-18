# src/homunculus/api/board.py
"""Pure builders that turn an Engine's state into the dashboard's board JSON."""
from __future__ import annotations

from dataclasses import asdict

from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.sofa import total_sofa

# Ascending severity; risk is the max present, or "none" when the patient is quiet.
_SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]


def _risk(alerts: list[Alert]) -> str:
    if not alerts:
        return "none"
    return max((a.severity for a in alerts), key=_SEVERITY_ORDER.index)


def _latest(state, code: SignalCode):
    obs = state.latest(code)
    return None if obs is None else obs.value


def patient_board(engine: Engine, patient_id: str) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
        "patient_id": patient_id,
        "risk": _risk(alerts),
        "alerts": [asdict(a) for a in alerts],
        "latest": {
            "heart_rate": _latest(state, SignalCode.HEART_RATE),
            "map": _latest(state, SignalCode.MAP),
            "lactate": _latest(state, SignalCode.LACTATE),
            "sofa": total_sofa(state),
        },
    }


def board_snapshot(engine: Engine) -> list[dict]:
    return [patient_board(engine, pid) for pid in engine.patient_ids()]
