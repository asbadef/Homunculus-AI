"""
Admission workflow business logic.

Encapsulates the rules that the API layer and background jobs both depend on, so
they can be unit-tested without HTTP:

  * single-ACTIVE-admission-per-patient constraint (hard)
  * admission state machine (§1.4) with bed-state side effects (§4.1/4.6/4.7)
  * DRAFT 2-hour review timeout reminder (S-26)
  * one-step transfer (Group 2 · B1b); S-27's receiving-attending deadline is not written
  * care-team assignment rules (§4.2–4.3), incl. ONCALL time-box (§3.3)
  * nurse–bed shift assignment with soft over-capacity warning (§4.4, S-25)
  * handover dual-signature + 30-min bridge (S-24) + CRITICAL-alert block (S-07)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import errors
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, CareTeamRole, DischargeDisposition, Handover,
    HandoverStatus, NurseBedAssignment, OPEN_ADMISSION_STATES, Patient,
)
from homunculus.auth.models import Group, TenantMembership, User, UserGroup
from homunculus.scope.service import _window_open
from homunculus.tenant.models import Bed, BedState, Room, Site, Unit

# --- Settled timing decisions ---
DRAFT_REVIEW_TIMEOUT = timedelta(hours=2)        # S-26
HANDOVER_BRIDGE_WINDOW = timedelta(minutes=30)   # S-24
ONCALL_MAX_WINDOW = timedelta(hours=48)          # §3.3


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowError(Exception):
    """Raised for business-rule violations; mapped to HTTP 409 by the router, with `code` beside
    the words (admission/errors.py) — the dashboard reads the code, never the words."""

    def __init__(self, message: str, code: str = errors.INVALID_TRANSITION) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Admission creation & the single-ACTIVE constraint
# ---------------------------------------------------------------------------
async def get_active_admission_for_patient(
    db: AsyncSession, patient_id: uuid.UUID
) -> Admission | None:
    result = await db.execute(
        select(Admission).where(
            Admission.patient_id == patient_id,
            Admission.state == AdmissionState.ACTIVE,
        )
    )
    return result.scalar_one_or_none()


async def get_open_admission_for_patient(
    db: AsyncSession, patient_id: uuid.UUID
) -> Admission | None:
    """Any non-terminal admission (DRAFT/ACTIVE/PENDING_*)."""
    result = await db.execute(
        select(Admission).where(
            Admission.patient_id == patient_id,
            Admission.state.in_(OPEN_ADMISSION_STATES),
        )
    )
    return result.scalars().first()


async def create_draft_admission(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    patient: Patient,
    note_fields: dict,
    request_id: uuid.UUID | None = None,
    request_digest: str | None = None,
    identity_digest: str | None = None,
    protocol_no: str | None = None,
    reserved_ok: bool = False,
) -> Admission:
    """
    §4.1 steps 2–3: create a DRAFT admission and provisionally occupy the bed.

    Enforces the hard constraint: a patient may not have another open admission.
    `request_id` and `request_digest` are the form's id and its body's digest (amendment A-19,
    admission/router.py); the row's unique `(tenant_id, request_id)` refuses a second admission
    under one id with an IntegrityError at the flush below. `identity_digest` is the person's
    (A-37, admission/form.py): the open-identity index refuses a second open admission of one
    person in the tenant the same way, by its own name (`models.OPEN_IDENTITY_INDEX`).
    """
    existing = await get_open_admission_for_patient(db, patient.id)
    if existing is not None:
        raise WorkflowError(
            f"Patient already has an open admission ({existing.state.value}); "
            f"a patient may have only one active admission at a time.",
            errors.OPEN_ADMISSION,
        )

    # The bed row is LOCKED until the transaction ends (G2-B1a, spec §3.1): two admissions into one
    # bed at once wait for each other here, and the second finds it OCCUPIED. FOR NO KEY UPDATE, as
    # every bed lock (tenant/router.py `_lock_bed`, amendment A-26): it lets an insert of a row
    # pointing at the bed through. A caller that already holds the lock takes nothing more here.
    # Read afresh under the lock: a bed loaded before it would come back as it was then.
    bed = (await db.execute(
        select(Bed).where(Bed.id == note_fields["bed_id"]).with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if bed is None:
        raise WorkflowError("Target bed not found.")
    # G2-B3a (D5): a reserved bed takes the admission its route confirmed (`reserved_ok`).
    if bed.state != BedState.AVAILABLE and not (reserved_ok and bed.state == BedState.RESERVED):
        raise WorkflowError(
            f"Bed is not AVAILABLE (current state: {bed.state.value}); "
            f"cannot admit.",
            errors.BED_NOT_AVAILABLE,
        )

    admission = Admission(
        patient_id=patient.id,
        tenant_id=tenant_id,
        state=AdmissionState.DRAFT,
        request_id=request_id,
        request_digest=request_digest,
        identity_digest=identity_digest,
        protocol_no=protocol_no,             # G2-B1d: issued by the route, in this transaction
        **note_fields,
    )
    if admission.admission_datetime is None:
        admission.admission_datetime = _now()
    db.add(admission)

    # Bed transitions to OCCUPIED provisionally (§4.1 step 3).
    bed.transition_to(BedState.OCCUPIED)

    await db.flush()
    return admission


# ---------------------------------------------------------------------------
# DRAFT → ACTIVE sign-off (§4.1 steps 4–5)
# ---------------------------------------------------------------------------
async def sign_off_admission(
    db: AsyncSession, admission: Admission, *, signing_user_id: uuid.UUID
) -> Admission:
    if admission.state != AdmissionState.DRAFT:
        raise WorkflowError(
            f"Only a DRAFT admission can be signed off (current: {admission.state.value})."
        )
    if admission.attending_physician_id is None:
        raise WorkflowError(
            "attending_physician_id must be resolved before a DRAFT can become ACTIVE "
            "(§5.2 field 8).",
            errors.MISSING_ATTENDING,
        )
    # Re-check single-ACTIVE constraint at the moment of activation.
    active = await get_active_admission_for_patient(db, admission.patient_id)
    if active is not None and active.id != admission.id:
        raise WorkflowError("Patient already has an ACTIVE admission.", errors.OPEN_ADMISSION)

    admission.transition_to(AdmissionState.ACTIVE)
    admission.signed_by = signing_user_id
    admission.signed_at = _now()
    await db.flush()
    return admission


# ---------------------------------------------------------------------------
# DRAFT review timeout — S-26
# ---------------------------------------------------------------------------
async def find_stale_draft_admissions(db: AsyncSession) -> list[Admission]:
    """
    Return DRAFT admissions older than the 2-hour review window that have not yet
    had a reminder emitted. Callers (background job) send the CHARGE_NURSE reminder
    and then mark `draft_reminder_sent = True`.
    """
    cutoff = _now() - DRAFT_REVIEW_TIMEOUT
    result = await db.execute(
        select(Admission).where(
            Admission.state == AdmissionState.DRAFT,
            Admission.created_at <= cutoff,
            Admission.draft_reminder_sent.is_(False),
        )
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Care team — §4.2–4.3, §3.3
# ---------------------------------------------------------------------------
async def add_care_team_member(
    db: AsyncSession, admission: Admission, *, user_id: uuid.UUID,
    role: CareTeamRole, granted_by_id: uuid.UUID,
    window_start: datetime | None = None, window_end: datetime | None = None,
) -> CareTeamMember:
    """§4.3 — attending adds an associate or a time-boxed on-call physician. Never an ATTENDING:
    G2-B1c (T4, X15) `set_attending` is the one writer of that row, because it ends the previous
    attending's row and names her on the admission; a second row written past it would meet the
    one-attending index as a 500."""
    if role == CareTeamRole.ATTENDING:
        raise WorkflowError("An ATTENDING row is written by set_attending only (T4).")
    if role == CareTeamRole.ONCALL_PHYSICIAN:
        if window_start is None or window_end is None:
            raise WorkflowError("ONCALL_PHYSICIAN requires window_start and window_end (§3.3).")
        if window_end <= window_start:
            raise WorkflowError("window_end must be after window_start.")
        if window_end - window_start > ONCALL_MAX_WINDOW:
            raise WorkflowError("On-call window cannot exceed 48 hours in a single grant (§3.3).")

    member = CareTeamMember(
        admission_id=admission.id,
        user_id=user_id,
        role=role,
        granted_by_id=granted_by_id,
        window_start=window_start,
        window_end=window_end,
    )
    db.add(member)
    await db.flush()
    return member


# ---------------------------------------------------------------------------
# Care team — Group 2 · B1c (spec D1–D4, T1, T4, T8)
# ---------------------------------------------------------------------------
#: G2-B1c (T1): the default ROLE groups whose members are physicians. The role group says what a
#: person is; a permission cannot, because the system group holds every key by rule. The dashboard
#: holds a copy (screens/patient/careTeam/careTeam.js); its test holds the two equal.
PHYSICIAN_GROUPS = ("attending", "unit_physician", "physician")


def physician_ids(tenant_id: uuid.UUID):
    """SELECT the ids of the tenant's physicians (T1): an active account with an active membership
    in this tenant and a group of this tenant among `PHYSICIAN_GROUPS`. One statement for the
    checks and for the picker's candidates (D8)."""
    return (
        select(User.id)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .join(UserGroup, UserGroup.user_id == User.id)
        .join(Group, Group.id == UserGroup.group_id)
        .where(User.is_active.is_(True), TenantMembership.tenant_id == tenant_id,
               TenantMembership.is_active.is_(True), Group.tenant_id == tenant_id,
               Group.slug.in_(PHYSICIAN_GROUPS))
        .distinct()
    )


async def is_physician(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """T1: whether `user_id` is a physician of this tenant. The routes refuse a member, a claimer
    or an attending a sign-off would make who is not: 409 `care_team_not_physician`."""
    found = await db.execute(physician_ids(tenant_id).where(User.id == user_id))
    return found.first() is not None


async def active_rows(db: AsyncSession, admission_id: uuid.UUID) -> list[CareTeamMember]:
    """The admission's ACTIVE care-team rows, oldest first, read afresh (`populate_existing`). The
    routes read them under `_locked`, and a row this session loaded before would otherwise come
    back as it was."""
    result = await db.execute(
        select(CareTeamMember)
        .where(CareTeamMember.admission_id == admission_id, CareTeamMember.is_active.is_(True))
        .order_by(CareTeamMember.created_at, CareTeamMember.id)
        .execution_options(populate_existing=True))
    return list(result.scalars().all())


def in_force(member: CareTeamMember, now: datetime) -> bool:
    """G2-B1c (§5.2): an active row, inside its window when it has one. This is what the board's
    own-patient rule grants on; `_window_open` is that rule's one copy (scope/service.py)."""
    return bool(member.is_active) and _window_open(member.window_start, member.window_end, now)


def expired(member: CareTeamMember, now: datetime) -> bool:
    """G2-B1c (T8): an on-call row whose window has passed. It grants nothing (F9), and an add of
    the same physician renews it instead of refusing her (X4)."""
    return (member.role == CareTeamRole.ONCALL_PHYSICIAN and member.window_end is not None
            and member.window_end < now)


async def end_care_team_member(db: AsyncSession, member: CareTeamMember, *,
                               now: datetime | None = None) -> None:
    """G2-B1c (§5.2): a row ends (`is_active` false, `closed_at` now) and is kept: the history
    stays (D4). Flushed, so a row written after it in the same transaction never meets it at an
    index."""
    member.is_active = False
    member.closed_at = now or _now()
    await db.flush()


async def set_attending(
    db: AsyncSession, admission: Admission, *, user_id: uuid.UUID,
    granted_by_id: uuid.UUID | None, now: datetime | None = None,
) -> tuple[CareTeamMember, list[uuid.UUID]]:
    """G2-B1c (T4, D2, D3, D4): `user_id` becomes the admission's attending: at sign-off, by a
    claim, or by an add with role ATTENDING. It is one function, so the three cannot differ:
      * the previous attending's row ends (one responsible physician at a time; the history stays);
      * her own other active row ends too (a promoted associate holds one row, not two);
      * `attending_physician_id` names her;
      * her ATTENDING row is written, granted by `granted_by_id`.
    The ends are flushed before the insert, so neither partial index meets the rows it replaces.
    Returns the new row and the ids of the rows it ended. The caller holds `_locked`, and has
    checked the state (T3) and that she is a physician (T1)."""
    now = now or _now()
    ended: list[uuid.UUID] = []
    for member in await active_rows(db, admission.id):
        if member.role == CareTeamRole.ATTENDING or member.user_id == user_id:
            member.is_active = False
            member.closed_at = now
            ended.append(member.id)
    if ended:
        await db.flush()
    admission.attending_physician_id = user_id
    member = CareTeamMember(admission_id=admission.id, user_id=user_id,
                            role=CareTeamRole.ATTENDING, granted_by_id=granted_by_id,
                            is_active=True, created_at=now)
    db.add(member)
    await db.flush()
    return member, ended


# ---------------------------------------------------------------------------
# Nurse–bed shift assignment — §4.4, S-25
# ---------------------------------------------------------------------------
async def create_shift_schedule(
    db: AsyncSession, *, unit_id: uuid.UUID, charge_nurse_id: uuid.UUID,
    assignments: list[dict],
) -> tuple[list[NurseBedAssignment], list[str]]:
    """
    Create bed–nurse assignments for a shift.

    S-25: exceeding the unit's max_beds_per_nurse is a SOFT warning (not a hard
    block); the over-capacity condition is surfaced and audit-logged by the caller.
    """
    unit = await db.get(Unit, unit_id)
    if unit is None:
        raise WorkflowError("Unit not found.")

    warnings: list[str] = []
    beds_per_nurse: dict[uuid.UUID, int] = {}
    for a in assignments:
        beds_per_nurse[a["nurse_id"]] = beds_per_nurse.get(a["nurse_id"], 0) + 1

    for nurse_id, count in beds_per_nurse.items():
        if count > unit.max_beds_per_nurse:
            warnings.append(
                f"Nurse {nurse_id} is assigned {count} beds, exceeding the unit "
                f"maximum of {unit.max_beds_per_nurse} (soft limit, S-25)."
            )

    created: list[NurseBedAssignment] = []
    for a in assignments:
        row = NurseBedAssignment(
            unit_id=unit_id,
            bed_id=a["bed_id"],
            nurse_id=a["nurse_id"],
            charge_nurse_id=charge_nurse_id,
            shift_start=a["shift_start"],
            shift_end=a["shift_end"],
        )
        db.add(row)
        created.append(row)

    await db.flush()
    return created, warnings


# ---------------------------------------------------------------------------
# Transfer — §4.6; Group 2 · B1b: one step (spec D1)
# ---------------------------------------------------------------------------
#: G2-B1b (spec T6, X8): the columns an arriving admission does NOT take from its source — its own
#: identity, state, place and time; the admission form's send bookkeeping (A-19), which belongs to
#: the source's admission; the move's own link, deadline, reason and note; and the protocol, which
#: moves explicitly (O8); and the discharge's five fields, which stay with the row the discharge was
#: decided on (a started discharge that was cancelled must not hand them to the arriving row).
#: Every other column is the stay's and is carried whole, so a column added later is carried unless
#: it is named here.
_OWN_TO_EACH_ROW = frozenset({
    "id", "state", "bed_id", "admitting_unit_id", "admission_datetime", "request_id",
    "request_digest", "engine_writes", "draft_reminder_sent", "source_admission_id",
    "transfer_confirm_deadline", "transfer_reason", "transfer_note", "protocol_no",
    "created_at", "updated_at",
    "discharge_disposition", "discharge_institution", "discharge_reported_by", "discharge_at",
    "discharge_note",
})


async def _all_lie_in(db: AsyncSession, admission_ids: list[str], unit_id: uuid.UUID) -> bool:
    """G2-B1b (X22): whether every admission a handover names lies on a bed of `unit_id` — bed →
    room → unit, as the handover route reads a bed's unit (`_reach_admission`, A-12). An id that is
    no admission of ours, or whose admission has no bed, does not lie there."""
    try:
        wanted = {uuid.UUID(a) for a in admission_ids}
    except ValueError:
        return False
    units = dict((await db.execute(
        select(Admission.id, Room.unit_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .where(Admission.id.in_(wanted)))).all())
    return bool(wanted) and wanted <= units.keys() and all(u == unit_id for u in units.values())


async def transfer_patient(
    db: AsyncSession, admission: Admission, *, target_bed: Bed, target_unit_id: uuid.UUID,
    reason: str, note: str | None, reserved_ok: bool = False,
) -> tuple[Admission, int, list[uuid.UUID]]:
    """Group 2 · B1b (spec D1, T3–T7, §5.3): the patient moves to `target_bed` in one step, inside
    the caller's transaction. The route has locked the source bed, the target bed and the
    admission (`_locked`), proved the target open and in the caller's units, and read
    `target_unit_id` from the bed (T2). Returns the arriving admission, how many care-team rows
    moved and the ids of the handovers in hand that followed her, in the order of their ids.

    1. The source walks ACTIVE → PENDING_TRANSFER → TRANSFERRED and its bed OCCUPIED →
       PENDING_TRANSFER_OUT → HOUSEKEEPING (T3): no machine changes, and no pending state is
       ever committed.
    2. The source gives up its protocol (O8) and its care team is closed (T7). A flush takes it
       out of `uq_admissions_tenant_protocol` and `uq_admissions_open_identity` before the insert.
    3. The arriving row is the source whole (`_OWN_TO_EACH_ROW` aside): `identity_digest` and B1a's
       form fields included (T6, F4). It is ACTIVE on the target bed, in its real unit, now, with
       the moved protocol and the move's own reason and note (D8).
    4. The target goes OCCUPIED, from AVAILABLE, or from RESERVED when the route confirmed it
       (`reserved_ok`, B3a R5). The transition clears the reservation's note (F10).
    5. The closed rows are copied, active, onto the arriving row: same role, window and grantor.
       The source's ATTENDING row is copied too, past `set_attending` (G2-B1c's one writer of a
       NEW attending, its X15): it is the same attending, carried with `attending_physician_id`,
       onto a row that holds none. Nothing is left to end, and the one-attending index holds (X20).
    6. Every handover of the tenant still in hand — OUTGOING_SIGNED, or OPEN inside its bridge
       (`my_handovers`' "held"; an OPEN one past it reads EXPIRED, S-24) — that names the source
       names the arriving row in its place (owner 2026-11-10, X17). B3b reads a handover's patient
       through the admission it names: its critical gate, its sealed summary, its audit rows and
       the screen's box and "already open" check. The source's key is the H-number now (O8), and
       the card's is the arriving row's. The rows are locked as `_locked_handover` locks one — and
       read afresh (`populate_existing`) — in the order of their ids, so two transfers in one
       tenant lock them in one order and cannot deadlock; a signature at the same moment waits for
       the move and reads the new admission. COMPLETED and EXPIRED handovers stay as they were
       written. The handover's unit follows her when every admission it names lies in the
       arriving unit now (X22; the others of a handover of several patients decide it).
       Only the handovers that name her are locked (final review M-2): on Postgres the read asks
       for them by containment (`admission_ids @> '["<source>"]'`, the column is JSONB), so a move
       never locks the hospital's other handovers in hand — OUTGOING_SIGNED never expires (G4-02),
       and every signature would wait for every move. SQLite (scripts/dev_local.py) keeps plain
       JSON, which has no containment: there the read takes every one in hand, as before. The
       match is made again here on every database, the list as stored."""
    if admission.state != AdmissionState.ACTIVE:
        raise WorkflowError(
            f"Only an ACTIVE admission is transferred (current: {admission.state.value}).")
    if target_bed.state != BedState.AVAILABLE and not (
            reserved_ok and target_bed.state == BedState.RESERVED):
        raise WorkflowError(
            f"Target bed is not AVAILABLE (state: {target_bed.state.value}).",
            errors.BED_NOT_AVAILABLE)
    # The patient's own bed, checked before anything changes in memory: the bed machine would raise
    # its ValueError only after the admission had walked on (Task 2 review).
    source_bed = await db.get(Bed, admission.bed_id)
    if source_bed is None or source_bed.state != BedState.OCCUPIED:
        raise WorkflowError(
            "The patient's bed is not OCCUPIED "
            f"(state: {source_bed.state.value if source_bed is not None else 'missing'}).")
    now = _now()

    admission.transition_to(AdmissionState.PENDING_TRANSFER)
    admission.transition_to(AdmissionState.TRANSFERRED)
    source_bed.transition_to(BedState.PENDING_TRANSFER_OUT)
    source_bed.transition_to(BedState.HOUSEKEEPING)

    moved_protocol, admission.protocol_no = admission.protocol_no, None
    team = await active_rows(db, admission.id)
    for member in team:
        member.is_active = False
        member.closed_at = now
    await db.flush()

    carried = {attr.key: getattr(admission, attr.key)
               for attr in Admission.__mapper__.column_attrs
               if attr.key not in _OWN_TO_EACH_ROW}
    arriving = Admission(
        **carried, state=AdmissionState.ACTIVE, bed_id=target_bed.id,
        admitting_unit_id=target_unit_id, admission_datetime=now, protocol_no=moved_protocol,
        source_admission_id=admission.id, transfer_confirm_deadline=None,
        transfer_reason=reason, transfer_note=note)
    db.add(arriving)
    target_bed.transition_to(BedState.OCCUPIED)
    await db.flush()                               # the arriving row's id, for the team below

    for member in team:
        db.add(CareTeamMember(
            admission_id=arriving.id, user_id=member.user_id, role=member.role,
            granted_by_id=member.granted_by_id, window_start=member.window_start,
            window_end=member.window_end))

    # Owner 2026-11-10 (X17): a handover still in hand follows the patient, as her team does (T7).
    source_id, arriving_id = str(admission.id), str(arriving.id)
    # Final review M-2: only hers are locked — by JSONB containment on Postgres, before the lock.
    names_her = ((Handover.admission_ids.contains([source_id]),)
                 if db.get_bind().dialect.name == "postgresql" else ())
    in_hand = (await db.execute(
        select(Handover)
        .join(Unit, Unit.id == Handover.unit_id)
        .join(Site, Site.id == Unit.site_id)
        .where(Site.tenant_id == admission.tenant_id,
               or_(Handover.status == HandoverStatus.OUTGOING_SIGNED,
                   and_(Handover.status == HandoverStatus.OPEN,
                        Handover.bridge_expires_at > now)),
               *names_her)
        .order_by(Handover.id)
        .with_for_update(of=Handover)
        .execution_options(populate_existing=True))).scalars().all()
    followed: list[uuid.UUID] = []
    for handover in in_hand:
        named = [str(a) for a in (handover.admission_ids or [])]
        if source_id in named:
            # A new list, assigned: an edit in place is not tracked and would never be written.
            named = [arriving_id if a == source_id else a for a in named]
            handover.admission_ids = named
            followed.append(handover.id)
            # X22 (controller): a handover's unit is its admissions' beds' (G4-02: the handover
            # route stores the unit its admissions lie in, and `GET /handovers/pending` counts by
            # it), so it follows the patient into her new unit — but only when EVERY admission it
            # names lies there now. A handover of several patients whose others stay behind keeps
            # its unit (the patients now lie in two): it moves with the move that brings the last
            # one over. A handover that names one patient always moves with her.
            if handover.unit_id != target_unit_id and await _all_lie_in(db, named, target_unit_id):
                handover.unit_id = target_unit_id
    await db.flush()
    return arriving, len(team), followed


# ---------------------------------------------------------------------------
# Discharge — §4.7, S-28
# ---------------------------------------------------------------------------
async def initiate_discharge(
    db: AsyncSession, admission: Admission, *,
    disposition: DischargeDisposition, institution: str | None = None,
    reported_by: str | None = None, discharge_at: datetime | None = None,
    note: str | None = None, unacknowledged_critical_count: int = 0,
) -> Admission:
    """§4.7 steps 1–2 as Group 2 · B1a decides them (spec D7): the physician's disposition — home,
    another institution (named), or exitus (reported by) — its time (now unless given) and a note,
    recorded on the admission; the narrative is no longer appended to (X58).
    `unacknowledged_critical_count` is the board's own (admission/boardlink.py `open_critical`);
    any one blocks the start."""
    if admission.state != AdmissionState.ACTIVE:
        raise WorkflowError("Only an ACTIVE admission can be discharged.")
    # §4.7 step 2 — block on unacknowledged CRITICAL alerts.
    if unacknowledged_critical_count > 0:
        raise WorkflowError(
            f"Discharge blocked: {unacknowledged_critical_count} unacknowledged "
            f"CRITICAL alert(s) must be acknowledged with a reason first (§4.7).",
            errors.CRITICAL_ALARM_OPEN,
        )
    admission.transition_to(AdmissionState.PENDING_DISCHARGE)
    admission.discharge_disposition = disposition
    admission.discharge_institution = institution
    admission.discharge_reported_by = reported_by
    admission.discharge_at = discharge_at or _now()
    admission.discharge_note = note
    bed = await db.get(Bed, admission.bed_id)
    if bed is not None:
        bed.transition_to(BedState.PENDING_DISCHARGE)
    await db.flush()
    return admission


async def confirm_discharge(
    db: AsyncSession, admission: Admission, *, unacknowledged_critical_count: int = 0,
) -> Admission:
    """§4.7 steps 5–7: charge nurse confirms the patient has left the bed.

    `unacknowledged_critical_count` is the board's own, read again at the confirmation (Group 2 ·
    B1a, the user's decision of 2026-10-26): the discharge ends every alert of the patient, so a
    critical one that fired after the start is acknowledged first. An exitus is not exempt."""
    if admission.state != AdmissionState.PENDING_DISCHARGE:
        raise WorkflowError("Admission is not pending discharge.")
    if unacknowledged_critical_count > 0:
        raise WorkflowError(
            f"Discharge blocked: {unacknowledged_critical_count} unacknowledged CRITICAL "
            f"alert(s) must be acknowledged before the discharge is confirmed.",
            errors.CRITICAL_ALARM_OPEN,
        )
    admission.transition_to(AdmissionState.DISCHARGED)
    bed = await db.get(Bed, admission.bed_id)
    if bed is not None:
        bed.transition_to(BedState.HOUSEKEEPING)
    # Close all active care-team assignments (§4.7 step 7).
    result = await db.execute(
        select(CareTeamMember).where(
            CareTeamMember.admission_id == admission.id,
            CareTeamMember.is_active.is_(True),
        )
    )
    for member in result.scalars().all():
        member.is_active = False
        member.closed_at = _now()
    await db.flush()
    return admission


# ---------------------------------------------------------------------------
# Handover — §4.5, S-07, S-24
# ---------------------------------------------------------------------------
async def open_handover(
    db: AsyncSession, *, unit_id: uuid.UUID, outgoing_user_id: uuid.UUID,
    incoming_user_id: uuid.UUID, admission_ids: list[uuid.UUID],
    auto_populated_summary: dict | None = None,
) -> Handover:
    now = _now()
    handover = Handover(
        unit_id=unit_id,
        outgoing_user_id=outgoing_user_id,
        incoming_user_id=incoming_user_id,
        admission_ids=[str(a) for a in admission_ids],
        auto_populated_summary=auto_populated_summary,
        status=HandoverStatus.OPEN,
        bridge_opened_at=now,
        bridge_expires_at=now + HANDOVER_BRIDGE_WINDOW,  # S-24
    )
    db.add(handover)
    await db.flush()
    return handover


def is_bridge_active(handover: Handover, *, at: datetime | None = None) -> bool:
    """S-24: both parties have simultaneous read access while the bridge is open."""
    at = at or _now()
    if handover.status == HandoverStatus.COMPLETED:
        return False
    return at < handover.bridge_expires_at


async def sign_handover_outgoing(
    db: AsyncSession, handover: Handover, *, user_id: uuid.UUID,
    narrative_note: str | None, unacknowledged_critical_count: int = 0,
) -> Handover:
    if handover.status not in (HandoverStatus.OPEN,):
        raise WorkflowError(f"Handover is not open (status: {handover.status.value}).")
    if user_id != handover.outgoing_user_id:
        raise WorkflowError("Only the outgoing clinician can sign the outgoing side.")
    if _now() >= handover.bridge_expires_at:
        handover.status = HandoverStatus.EXPIRED
        await db.flush()
        raise WorkflowError("Handover bridge window has expired (S-24); reopen the handover.")
    # S-07: cannot sign off while an unacknowledged CRITICAL alert exists.
    if unacknowledged_critical_count > 0:
        raise WorkflowError(
            f"Handover blocked: {unacknowledged_critical_count} unacknowledged "
            f"CRITICAL alert(s). Acknowledge (with reason) or escalate first (S-07).",
            errors.CRITICAL_ALARM_OPEN,
        )
    handover.outgoing_signed_at = _now()
    if narrative_note is not None:
        handover.narrative_note = narrative_note
    handover.status = HandoverStatus.OUTGOING_SIGNED
    await db.flush()
    return handover


async def countersign_handover_incoming(
    db: AsyncSession, handover: Handover, *, user_id: uuid.UUID,
) -> Handover:
    if handover.status != HandoverStatus.OUTGOING_SIGNED:
        raise WorkflowError("Outgoing clinician must sign before countersignature.")
    if user_id != handover.incoming_user_id:
        raise WorkflowError("Only the incoming clinician can countersign.")
    handover.incoming_signed_at = _now()
    handover.status = HandoverStatus.COMPLETED
    await db.flush()
    return handover
