# homunculus-engine/src/homunculus/admission/boardlink.py
"""The one way admission code touches the board world (Group 2 · B1a, spec §4.3).

Two worlds meet here. The admissions world — `admission/` and `tenant/`, in Postgres, keyed by
UUID — knows who lies in which bed. The board world — the engine, the identity store, the ack
store, the board stream — is keyed by a patient-id string and never saw an admission. `BoardLink`
writes from the first into the second, and nothing else in `admission/` does:

* `put_identity`       the board identity of an admission (source `kabul`, keyed by the patient
                       number, with the bed and unit ids) — the card appears on its bed;
* `chart_weight`       the admission weight, charted through the app's own charting door (`chart`,
                       injected: Lane A's `chart_observations`, the body `POST /clinical` runs —
                       X62 as amended, A-3), so its audit rows are the ones a restart replays;
* `apply_profile`      the comorbidity codes ticked on the form, merged into the engine's profile
                       as `PUT /clinical/{id}/profile` merges them (the same audit row);
* `open_critical`      how many critical alerts on this patient's board nobody has acknowledged —
                       a latched one (`resolved_at` set, G2-A1) counted as firing ones are: the
                       same alerts the clinician sees, never the Postgres escalation tables;
* `is_discharged`      whether the number is a `kabul` tombstone (A-11: the app's doors drop a
                       reading for it before the engine);
* `discharge_identity` the tombstone written: the card is off every board read from then on. It
                       publishes NOTHING (A-11d);
* `retire`             the patient retired from the alert world through the app's own door
                       (`retire_patient`, injected: Lane A's `retire_and_publish`), handed the
                       tombstone's removal frame — the last bed and unit, no name — which that door
                       publishes once, after the alerts are ended (A-11d).

BoardLink never publishes a removal itself, and has no fallback for a door the app did not wire:
`chart_weight` and `retire` raise `RuntimeError`, so the admission routes can say which part failed.

The app builds it from its own stores and doors and places it on `app.state.board_link` (wired in
`api/app.py` once Lane A's A-11 is merged); a router reaches it through the request
(`board_link_of`). An app built without it (a test that mounts the routers alone) has none, and the
admission routes answer `skipped` for its parts.

PHI: the identity carries the name, as an ADT record does (encrypted at rest by the store). The
audit rows carry the number and the actor — never a name.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import Request

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.board import (
    _is_tombstone, _tombstone_board, identity_only_board, patient_board,
)
from homunculus.api.clinical import build_entries, profile_from_payload, profile_to_payload
from homunculus.api.notify import Notifier
from homunculus.api.patient_identity import KABUL, IdentityRecord, IdentityStore
from homunculus.pipeline import Engine
from homunculus.tenant.bedmap import BedMap

CRITICAL = "critical"
#: The chartable code the admission weight goes in under (`api/clinical.CHARTABLE`).
WEIGHT = "weight_kg"


def count_open_critical(alerts: list[dict]) -> int:
    """Critical alerts nobody acknowledged, in the board's own alert shape (`api/board.py`). A
    latched one — its rule stopped, `resolved_at` set (G2-A1, O17) — counts like a firing one:
    a critical event is seen before the patient leaves (spec §3.3)."""
    return sum(1 for alert in alerts
               if isinstance(alert, dict) and alert.get("severity") == CRITICAL
               and not alert.get("acknowledged"))


def kabul_record(*, patient_number: str, display_name: str, birth_date: date, sex: str,
                 bed_label: str, bed_id: str, unit_id: str, at: datetime) -> IdentityRecord:
    """The board identity of an admission made here. The whole name goes in `given`: the form
    asks for one "ad soyad" field, and `display_name` joins given and family anyway."""
    return IdentityRecord(patient_id=patient_number, given=display_name.strip(),
                          birth_date=birth_date.isoformat(), sex=sex, bed=bed_label,
                          state="admitted", source=KABUL, updated_at=at,
                          bed_id=bed_id, unit_id=unit_id)


class BoardLink:
    """`engine` and `store` are the app's per-hospital accessors; `publish` its broadcaster's.
    `chart` is the app's charting door, called by keyword as Lane A's
    `chart_observations(engine, store, audit, notifier, hospital, patient_id, charted, now,
    escalate_after)` — `notifier` and `escalate_after` are the app's own, held here only to hand
    them on. `retire_patient` is the app's `retire_and_publish(hospital, patient_id, frame=None,
    now=None)`."""

    def __init__(self, *, identities: IdentityStore, engine: Callable[[str], Engine],
                 store: Callable[[str], AckStore], audit: AuditLog,
                 publish: Callable[[str, dict], Awaitable[None]],
                 notifier: Notifier | None = None, escalate_after: timedelta | None = None,
                 chart: Callable[..., list] | None = None,
                 retire_patient: Callable[..., Awaitable[list]] | None = None,
                 bedmap: BedMap | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self._identities = identities
        self._engine = engine
        self._store = store
        self._audit = audit
        self._publish = publish
        self._notifier = notifier
        self._escalate_after = escalate_after
        self._chart = chart
        self._retire = retire_patient
        self._bedmap = bedmap
        self._clock = clock

    def _board(self, tenant: str, patient_number: str,
               identity: IdentityRecord | None = None) -> dict:
        """The patient's board as /patients would carry it — built without creating the patient
        in the engine (`patient_board` reads `engine.state()`, which would)."""
        engine = self._engine(tenant)
        identity = identity if identity is not None else self._identities.get(tenant, patient_number)
        if patient_number in set(engine.patient_ids()) or identity is None:
            return patient_board(engine, patient_number, self._store(tenant), identity=identity,
                                 bedmap=self._bedmap)
        return identity_only_board(identity, self._bedmap)

    async def put_identity(self, tenant: str, record: IdentityRecord) -> None:
        stored = self._identities.apply(tenant, record)
        await self._publish(tenant, self._board(tenant, record.patient_id, stored))

    async def chart_weight(self, tenant: str, patient_number: str, kg: float, *,
                           actor: str) -> None:
        """The admission weight, built as `/clinical` builds an entry (`build_entries`: a weight
        outside the engine's bound is its `ClinicalEntryError`, before the door) and charted
        through the app's door, judged at this one instant. Then the card is republished.

        It is called for a number the admission has just issued; it is not a door for charting."""
        if self._chart is None:
            raise RuntimeError("chart_observations not wired")
        now = self._clock()
        charted = build_entries(patient_number, [{"code": WEIGHT, "value": kg}],
                                charted_by=actor, recorded_at=now)
        self._chart(engine=self._engine(tenant), store=self._store(tenant), audit=self._audit,
                    notifier=self._notifier, hospital=tenant, patient_id=patient_number,
                    charted=charted, now=now, escalate_after=self._escalate_after)
        await self._publish(tenant, self._board(tenant, patient_number))

    async def apply_profile(self, tenant: str, patient_number: str, codes: list[str], *,
                            actor: str) -> None:
        engine = self._engine(tenant)
        profile = profile_from_payload(patient_number, {"comorbidities": list(codes)},
                                       engine.profile(patient_number))
        engine.set_profile(profile)
        self._audit.append(AuditEvent(tenant, "profile", profile.patient_id, "",
                                      {**profile_to_payload(profile), "charted_by": actor}))
        await self._publish(tenant, self._board(tenant, patient_number))

    def open_critical(self, tenant: str, patient_number: str) -> int:
        engine = self._engine(tenant)
        if patient_number not in set(engine.patient_ids()):
            return 0                     # never measured: no alert can be on its board
        return count_open_critical(self._board(tenant, patient_number).get("alerts") or [])

    def is_discharged(self, tenant: str, patient_number: str) -> bool:
        """True when the number is a `kabul` tombstone — a patient discharged here. A HIS-fed
        discharge is not one: its card keeps its 24 hours on the board."""
        return _is_tombstone(self._identities.get(tenant, patient_number))

    async def discharge_identity(self, tenant: str, patient_number: str) -> IdentityRecord | None:
        """Write the tombstone: the patient left, the record stays with its last bed and unit
        (`_merge` keeps the location group when the incoming record names none). Returns the
        stored tombstone — what `retire` is handed — or None when the store refused it (a newer
        record exists, and it decides). Publishes nothing: the removal is the retirement's."""
        return self._identities.apply(tenant, IdentityRecord(
            patient_id=patient_number, state="discharged", source=KABUL,
            updated_at=self._clock()))

    async def retire(self, tenant: str, patient_number: str, record: IdentityRecord) -> list:
        """Retire the patient from the alert world through the app's door, handing it the
        tombstone's removal frame to publish once its alerts are ended. Returns what it cleared."""
        if self._retire is None:
            raise RuntimeError("retire_patient not wired")
        return await self._retire(tenant, patient_number, frame=_tombstone_board(record))


def board_link_of(request: Request) -> BoardLink | None:
    """The app's BoardLink, or None when the app was built without one."""
    return getattr(request.app.state, "board_link", None)
