# src/homunculus/api/board.py
"""Pure builders that turn an Engine's state (+ ack/escalation store) into the dashboard's board JSON."""
from __future__ import annotations

from dataclasses import asdict

from homunculus.api.ackstore import AckStore
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.sofa import total_sofa

_SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]


def _risk(alerts: list[Alert]) -> str:
    if not alerts:
        return "none"
    return max((a.severity for a in alerts), key=_SEVERITY_ORDER.index)


def _latest(state, code: SignalCode):
    obs = state.latest(code)
    return None if obs is None else obs.value


def _merge_alert(patient_id: str, alert: Alert, store: AckStore) -> dict:
    key = (patient_id, alert.kind)
    ack = store.acks.get(key)
    seen = store.first_seen.get(key)
    return {
        **asdict(alert),
        "acknowledged": ack is not None,
        "acknowledged_by": ack["by"] if ack else None,
        "acknowledged_at": ack["at"].isoformat() if ack else None,
        "first_seen_at": seen.isoformat() if seen is not None else None,
        "escalated": key in store.escalated,
    }


def patient_board(engine: Engine, patient_id: str, store: AckStore) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
        "patient_id": patient_id,
        "risk": _risk(alerts),
        "alerts": [_merge_alert(patient_id, a, store) for a in alerts],
        "latest": {
            "heart_rate": _latest(state, SignalCode.HEART_RATE),
            "map": _latest(state, SignalCode.MAP),
            "spo2": _latest(state, SignalCode.SPO2),
            "temperature": _latest(state, SignalCode.TEMPERATURE),
            "resp_rate": _latest(state, SignalCode.RESP_RATE),
            "lactate": _latest(state, SignalCode.LACTATE),
            "sofa": total_sofa(state),
        },
    }


def board_snapshot(engine: Engine, store: AckStore) -> list[dict]:
    return [patient_board(engine, pid, store) for pid in engine.patient_ids()]
