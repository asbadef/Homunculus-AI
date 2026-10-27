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
                       X62 as amended by A-20), so its audit rows are the ones a restart replays;
* `apply_profile`      the comorbidity codes ticked on the form, merged into the engine's profile
                       as `PUT /clinical/{id}/profile` merges them (the same audit row);
* `open_critical`      how many critical alerts on this patient's board nobody has acknowledged —
                       a latched one (`resolved_at` set, G2-A1) counted as firing ones are: the
                       same alerts the clinician sees, never the Postgres escalation tables;
* `is_discharged`      whether the number is a `kabul` tombstone — asked by the writes below
                       (`_refuse_discharged`) and by the bed's card check before it is freed
                       (tenant/router.py `_last_card_off`). The app's doors that drop a reading
                       for a tombstone before the engine (A-11) ask
                       `patient_identity.is_tombstone` themselves, not this;
* `discharge_identity` the tombstone written: the card is off every board read from then on. It
                       publishes NOTHING (A-11d, A-20), returns the tombstone (a second discharge
                       returns it too) and raises when the store refuses it;
* `retire`             the patient retired from the alert world through the app's own door
                       (`retire_patient`, injected: Lane A's `retire_and_publish`), handed this
                       number's tombstone's removal frame — the last bed and unit, no name — which
                       that door publishes once, after the alerts are ended (A-11d, A-20). What
                       the door itself raises comes out as `RetireIncomplete` (A-25);
* `take_off`           the two above as the discharge's one board step, never raising and
                       answering `board`/`alerts` — after the confirmation, at its retry and at
                       the bed release (review I-2). It does not look at alerts: the critical-alarm
                       hold is the confirmation's own (review I-1).

The discharge's removal is never BoardLink's to send. `put_identity`, `chart_weight` and
`apply_profile` refuse a discharged number before they build, chart or write anything (A-11; for
the card, the Task 8 re-review and A-29): a card written again after the discharge — a resend's
retry that read the admission open just before it — would otherwise be taken by the identity store
when stamped after the tombstone, and the patient would lie on a bed in cleaning for good. Each
refusal is one synchronous step with the write it guards, so in the one process that holds the
board no other request runs between them; a number is never issued twice, so no admission is
refused by it. The board republished after a write is, for a tombstone, its removal, never its
card; for a number with neither an identity nor a reading, nothing.
There is no fallback for a door the app did not wire: `chart_weight` and `retire` raise
`RuntimeError`, and every refusal raises, so the admission routes can say which part failed and
never report one `ok` that did not happen.

`api/app.py` builds it from its own stores and doors — Lane A's `chart_observations`,
`retire_and_publish` and the broadcaster's publish, by reference (Task 6b; A-20, A-23, A-25) —
and places it on `app.state.board_link`; a router reaches it through the request
(`board_link_of`). An app built without it (a test that mounts the routers alone) has none, and
the admission routes answer every part they asked of it `failed`, logged at ERROR (X53: `skipped`
means "not asked", never "not done").

PHI: the identity carries the name, as an ADT record does (encrypted at rest by the store). The
audit rows carry the number and the actor — never a name.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import Request

from homunculus.admission.schemas import AlertRetire, EngineWrite
from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.board import identity_only_board, patient_board, tombstone_board
from homunculus.api.clinical import build_entries, profile_from_payload, profile_to_payload
from homunculus.api.notify import Notifier
from homunculus.api.patient_identity import KABUL, IdentityRecord, IdentityStore, is_tombstone
from homunculus.pipeline import Engine
from homunculus.tenant.bedmap import BedMap

log = logging.getLogger(__name__)

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


class RetireIncomplete(Exception):
    """The app's retirement door was entered and raised (A-25), after the tombstone was written.
    What went wrong is not known from here: typically an `alert_cleared` row not written after
    the alerts were ended in memory, but the door's own `finally` — which re-arms the notifier and
    sends the removal frame — may have failed too, so a removal frame may or may not have gone
    out. Every read of the board (`/patients`, a screen reloading) leaves the card off either way:
    the tombstone is written. The discharge is not failed by it; the route reports the retirement
    `incomplete`. The door's own error is `__cause__`. Deliberately neither a `ValueError` nor a
    `RuntimeError`: those are `retire`'s refusals BEFORE the door, which sent nothing."""


def kabul_record(*, patient_number: str, display_name: str, birth_date: date, sex: str,
                 bed_label: str, bed_id: str, unit_id: str, at: datetime) -> IdentityRecord:
    """The board identity of an admission made here. The whole name goes in `given`: the form
    asks for one "ad soyad" field, and `display_name` joins given and family anyway. `at` must be
    aware, as `admission/numbers.py` requires (A-15): a naive one would be read in the server's
    own zone, and the identity store orders its writes by it."""
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("`at` must carry its time zone (an aware datetime, e.g. UTC).")
    return IdentityRecord(patient_id=patient_number, given=display_name.strip(),
                          birth_date=birth_date.isoformat(), sex=sex, bed=bed_label,
                          state="admitted", source=KABUL, updated_at=at,
                          bed_id=bed_id, unit_id=unit_id)


class BoardLink:
    """`engine` and `store` are the app's per-hospital accessors; `publish` its broadcaster's.
    `chart` is the app's charting door, called by keyword as Lane A's
    `chart_observations(engine, store, audit, notifier, hospital, patient_id, charted, now,
    escalate_after)` — `notifier` and `escalate_after` are the app's own, held here only to hand
    them on; the three are wired together or `chart_weight` refuses to run. `retire_patient` is the
    app's `retire_and_publish(hospital, patient_id, frame=None, now=None)` (A-20)."""

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
               identity: IdentityRecord | None = None) -> dict | None:
        """The patient's board as /patients would carry it, or None when there is none to send —
        built without creating the patient in the engine (`patient_board` reads `engine.state()`,
        which would). A tombstone's board is its removal (`tombstone_board`), never an
        identity-only card: the tombstone keeps the name (A-16), and such a card would bring the
        discharged patient back on every screen. A number with neither an identity nor a reading
        has no board."""
        engine = self._engine(tenant)
        identity = identity if identity is not None else self._identities.get(tenant, patient_number)
        if is_tombstone(identity):
            return tombstone_board(identity)
        if patient_number in set(engine.patient_ids()):
            return patient_board(engine, patient_number, self._store(tenant), identity=identity,
                                 bedmap=self._bedmap)
        if identity is None:
            return None
        return identity_only_board(identity, self._bedmap)

    async def _send(self, tenant: str, patient_number: str,
                    identity: IdentityRecord | None = None) -> None:
        board = self._board(tenant, patient_number, identity)
        if board is not None:
            await self._publish(tenant, board)

    async def put_identity(self, tenant: str, record: IdentityRecord) -> None:
        """The admission's card on its bed, then the card republished. A discharged number is
        refused first (`_refuse_discharged`), whatever the record's stamp: see the module's
        docstring."""
        self._refuse_discharged(tenant, record.patient_id)
        stored = self._identities.apply(tenant, record)
        await self._send(tenant, record.patient_id, stored)

    async def chart_weight(self, tenant: str, patient_number: str, kg: float, *,
                           actor: str) -> None:
        """The admission weight, built as `/clinical` builds an entry (`build_entries`: a weight
        outside the engine's bound is its `ClinicalEntryError`, before the door) and charted
        through the app's door, judged at this one instant. Then the card is republished.

        The door, the notifier and the escalation delay must all be wired, or nothing is built or
        charted: Lane A's `chart_observations` prunes the notifier before it writes the `chart`
        row, so a missing notifier would leave the weight in the engine with no row for a restart
        to replay. A discharged number is refused first (`_refuse_discharged`). It is called for a
        number the admission has just issued; it is not a door for charting."""
        self._refuse_discharged(tenant, patient_number)
        missing = [name for name, part in (("chart_observations", self._chart),
                                           ("notifier", self._notifier),
                                           ("escalate_after", self._escalate_after))
                   if part is None]
        if missing:
            raise RuntimeError(f"{', '.join(missing)} not wired")
        now = self._clock()
        charted = build_entries(patient_number, [{"code": WEIGHT, "value": kg}],
                                charted_by=actor, recorded_at=now)
        self._chart(engine=self._engine(tenant), store=self._store(tenant), audit=self._audit,
                    notifier=self._notifier, hospital=tenant, patient_id=patient_number,
                    charted=charted, now=now, escalate_after=self._escalate_after)
        await self._send(tenant, patient_number)

    async def apply_profile(self, tenant: str, patient_number: str, codes: list[str], *,
                            actor: str) -> None:
        """The comorbidities merged into the engine's profile, audited as `PUT
        /clinical/{id}/profile` audits them, then the card republished. A discharged number is
        refused first (`_refuse_discharged`)."""
        self._refuse_discharged(tenant, patient_number)
        engine = self._engine(tenant)
        profile = profile_from_payload(patient_number, {"comorbidities": list(codes)},
                                       engine.profile(patient_number))
        engine.set_profile(profile)
        self._audit.append(AuditEvent(tenant, "profile", profile.patient_id, "",
                                      {**profile_to_payload(profile), "charted_by": actor}))
        await self._send(tenant, patient_number)

    def open_critical(self, tenant: str, patient_number: str) -> int:
        engine = self._engine(tenant)
        if patient_number not in set(engine.patient_ids()):
            return 0                     # never measured: no alert can be on its board
        board = self._board(tenant, patient_number) or {}
        return count_open_critical(board.get("alerts") or [])

    def is_discharged(self, tenant: str, patient_number: str) -> bool:
        """True when the number is a `kabul` tombstone — a patient discharged here. A HIS-fed
        discharge is not one: its card keeps its 24 hours on the board."""
        return is_tombstone(self._identities.get(tenant, patient_number))

    def _refuse_discharged(self, tenant: str, patient_number: str) -> None:
        """A-11: nothing reaches the engine for a discharged number, no row a restart would replay
        is written for it, and its card never comes back (A-29). Lane A's `chart_observations`
        leaves that drop to its caller, so the writes here refuse before they build, chart or
        write anything."""
        if self.is_discharged(tenant, patient_number):
            raise RuntimeError(f"{patient_number} is discharged")

    async def discharge_identity(self, tenant: str, patient_number: str) -> IdentityRecord:
        """Write the tombstone: the patient left, the record stays with its name (A-16) and its
        last bed and unit (`_merge` keeps the location group when the incoming record names none).
        Returns the tombstone — what `retire` is handed. A second discharge returns it too, even
        when the store refuses the second stamp: the patient has left either way. Any other
        refusal (a newer record that is not a tombstone decides) raises `RuntimeError`: the
        discharge did not happen, and the caller must not report the board `ok`. Publishes
        nothing: the removal is the retirement's."""
        stored = self._identities.apply(tenant, IdentityRecord(
            patient_id=patient_number, state="discharged", source=KABUL,
            updated_at=self._clock()))
        if stored is not None:
            return stored
        current = self._identities.get(tenant, patient_number)
        if is_tombstone(current):
            return current
        raise RuntimeError(f"the discharge of {patient_number} was refused: the identity store "
                           "holds a newer record that is not a discharge")

    async def retire(self, tenant: str, patient_number: str,
                     record: IdentityRecord | None) -> list:
        """Retire the patient from the alert world through the app's door, handing it the
        tombstone's removal frame to publish once its alerts are ended. Returns what it cleared.

        `record` must be this number's `kabul` tombstone (`discharge_identity`'s answer): a frame
        built from another record would take another patient's card, or an admitted one, off the
        screens. Anything else is a `ValueError`, and a door not wired a `RuntimeError`, both
        before the door is called. Whatever the door raises is `RetireIncomplete`, from it."""
        if record is None or record.patient_id != patient_number or not is_tombstone(record):
            raise ValueError(f"retire takes the kabul tombstone of {patient_number}")
        if self._retire is None:
            raise RuntimeError("retire_patient not wired")
        try:
            return await self._retire(tenant, patient_number, frame=tombstone_board(record))
        except Exception as exc:
            raise RetireIncomplete(f"the retirement of {patient_number} did not finish") from exc

    async def take_off(self, tenant: str, patient_number: str) -> tuple[EngineWrite, AlertRetire]:
        """A discharged patient taken off the board and out of the alert world — the step after
        a discharge's commit, its nurse's retry (a confirmation of a DISCHARGED admission) and the
        bed release's check (review I-2): the tombstone (`discharge_identity`), then the
        retirement (`retire`). Both are idempotent, so the step may run again. Never raises; what
        it answers:

        * `ok`, `ok`: the tombstone written, the retirement done;
        * `failed`, `failed`: the tombstone refused, or the retirement refused before its door.
          Nothing was sent; when the tombstone stands, reads leave the card off all the same;
        * `ok`, `incomplete`: the door raised after the tombstone was written (`RetireIncomplete`)
          — a removal frame may or may not have gone out; reads leave the card off.

        It does not look at the patient's alerts. The hold on an unacknowledged critical alarm
        (review I-1) is the confirmation's own, under its locks, before the patient is DISCHARGED;
        this step runs for a patient already confirmed gone, and a card left standing must never
        be held on the board by its own alerts, or it could not be taken off (the dashboard
        review's ordering). The retirement ends them. Logged at ERROR with the number, never a
        name."""
        try:
            record = await self.discharge_identity(tenant, patient_number)
            await self.retire(tenant, patient_number, record)
        except RetireIncomplete:
            log.exception("discharge %s: the card is off the board, but the patient's retirement "
                          "from the alert world did not finish", patient_number)
            return "ok", "incomplete"
        except Exception:
            log.exception("discharge %s: the card did not leave the board and the patient's "
                          "alerts were not ended", patient_number)
            return "failed", "failed"
        return "ok", "ok"


def board_link_of(request: Request) -> BoardLink | None:
    """The app's BoardLink, or None when the app was built without one."""
    return getattr(request.app.state, "board_link", None)
