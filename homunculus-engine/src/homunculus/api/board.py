# src/homunculus/api/board.py
"""Pure builders that turn an Engine's state (+ ack/escalation store) into the dashboard's board JSON."""
from __future__ import annotations

from dataclasses import asdict

from homunculus.api.ackstore import AckStore
from homunculus.api.patient_identity import IdentityRecord, IdentityStore
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


def identity_only_board(record: IdentityRecord) -> dict:
    """Admissions have a card before the first reading, without creating engine state."""
    return {
        "patient_id": record.patient_id, "risk": "none", "alerts": [],
        "latest": {key: None for key in (
            "heart_rate", "map", "spo2", "temperature", "resp_rate", "lactate", "sofa")},
        "identity": record.as_board(),
    }


def patient_board(engine: Engine, patient_id: str, store: AckStore,
                  identity: IdentityRecord | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
        "patient_id": patient_id,
        "identity": identity.as_board() if identity is not None else None,
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


def board_snapshot(engine: Engine, store: AckStore,
                   identities: IdentityStore | None = None, hospital: str = "") -> list[dict]:
    measured = engine.patient_ids()
    boards = [patient_board(engine, pid, store,
                            identity=identities.get(hospital, pid) if identities else None)
              for pid in measured]
    if identities is not None:
        seen = set(measured)
        # Keep discharged admissions visible until the store's 24-hour retention expires.
        for pid in identities.patient_ids(hospital):
            if pid not in seen:
                record = identities.get(hospital, pid)
                if record is not None:
                    boards.append(identity_only_board(record))
    return boards
