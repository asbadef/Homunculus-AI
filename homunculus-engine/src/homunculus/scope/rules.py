"""The scope rules themselves: a set of grants plus a board in, a smaller board out.

Three decisions in this file are worth more than the code around them.

**A scope that matches nothing yields an empty board, not a full one.** The screen falls back
to showing everything when a user has no assignment, and says so; that is a reasonable thing
for a screen to do. It is not a reasonable thing for the boundary to do. But an empty board is
dangerous in its own way — a nurse reading an empty ward believes the ward is quiet — so
`apply_scope` always returns *why* a board is the size it is, and the caller is expected to
publish that alongside the patients. Being blind is survivable; not knowing you are blind is
the failure this project keeps writing notes about.

**No assignment does not mean no access — yet.** At the pilot nobody has been assigned
anything, so enforcing "unassigned = sees nothing" the day this ships would black out every
clinical screen in the hospital at once. Unassigned therefore stays unrestricted and is
*reported* as unassigned, until an administrator has populated the matrix and the deployment
flips `enforce_unassigned`. The flag exists so that flip is a configuration change someone
makes deliberately, not a code change nobody dares to make.

**Ids are compared normalised.** One side of this comparison is `bed-mapping.json`, written by
hand at the hospital; the other is an administrator typing into a form. `Bed-A1` and `bed-a1`
being different beds would be a silent, invisible, entirely clerical way for a nurse's board
to come up empty.
"""
from __future__ import annotations

from dataclasses import dataclass, field


class ScopeReason:
    """Why a scope is what it is. The screen must not render these three the same way."""

    UNRESTRICTED_ROLE = "role"        # administrator, platform support
    BREAK_GLASS = "break_glass"       # time-boxed emergency access to the patients it names
    UNASSIGNED = "unassigned"         # nobody has given this user a scope
    ASSIGNED = "assigned"             # a real scope, applied
    TENANT_TOKEN = "tenant_token"     # a machine credential: the bridge, the wall board


# Roles that are not scoped to beds. Deliberately short.
#
# BIOMEDICAL is *not* here even though `patientScope.js` leaves it unrestricted on screen — but
# it is not excluded here either, because excluding it would break the device screen, which
# reads the board for feed health. The engineer's access to patient *names* is a separate open
# item (E2: field-level redaction); this file decides bed visibility and says nothing about it.
SCOPE_UNRESTRICTED_ROLES = frozenset({"HOSPITAL_ADMIN", "PLATFORM_SUPPORT"})


def normalise_id(value: str | None) -> str:
    """Case- and whitespace-insensitive form of a bed or unit id."""
    return (value or "").strip().casefold()


@dataclass(frozen=True)
class Scope:
    """One user's visibility, resolved.

    `unrestricted` short-circuits every filter. The three id sets are already normalised, so a
    caller never has to remember to do it.
    """

    unrestricted: bool
    reason: str
    unit_ids: frozenset[str] = field(default_factory=frozenset)
    bed_ids: frozenset[str] = field(default_factory=frozenset)
    own_patient_ids: frozenset[str] = field(default_factory=frozenset)

    @property
    def is_empty(self) -> bool:
        """True when this scope grants nothing at all — no unit, no bed, no own patient."""
        return not (self.unrestricted or self.unit_ids or self.bed_ids or self.own_patient_ids)

    def as_dict(self) -> dict:
        """The shape the API publishes so a screen can explain itself."""
        return {
            "unrestricted": self.unrestricted,
            "reason": self.reason,
            "unit_ids": sorted(self.unit_ids),
            "bed_ids": sorted(self.bed_ids),
            "own_patients": len(self.own_patient_ids),
        }


def build_scope(
    role: str | None,
    *,
    unit_ids: list[str] | None = None,
    bed_ids: list[str] | None = None,
    own_patient_ids: list[str] | None = None,
    break_glass_patient_ids: list[str] | None = None,
    unrestricted_roles: frozenset[str] = SCOPE_UNRESTRICTED_ROLES,
    enforce_unassigned: bool = False,
) -> Scope:
    """Turn what is known about a user into the scope the boundary will enforce.

    **Break-glass opens one patient, not the hospital.** `BreakGlassSession` carries a
    `patient_id` and a reason for *that* patient, so a session grants exactly the patient it
    names. Reading it as blanket access would hand over a whole ward on a justification written
    about one bed — and the reason field, which is what makes break-glass defensible at all,
    would no longer describe what was opened. The dashboard's own `patientScope.js` widens
    everything on break-glass; where the two disagree, this one is the boundary and the screen
    is only a view.

    Role comes first: an administrator's access must not depend on an assignment matrix having
    been filled in by someone.
    """
    units = frozenset(normalise_id(u) for u in (unit_ids or []) if normalise_id(u))
    beds = frozenset(normalise_id(b) for b in (bed_ids or []) if normalise_id(b))
    emergency = frozenset((p or "").strip() for p in (break_glass_patient_ids or [])
                          if (p or "").strip())
    own = frozenset((p or "").strip() for p in (own_patient_ids or []) if (p or "").strip())
    reachable = own | emergency

    if role and role.upper() in unrestricted_roles:
        return Scope(True, ScopeReason.UNRESTRICTED_ROLE)
    if not units and not beds:
        if emergency:
            # An otherwise unassigned clinician who broke glass: the emergency is the only
            # reason they can see anything, and the reason should say so.
            return Scope(False, ScopeReason.BREAK_GLASS, own_patient_ids=reachable)
        if enforce_unassigned:
            return Scope(False, ScopeReason.UNASSIGNED, own_patient_ids=own)
        return Scope(True, ScopeReason.UNASSIGNED, own_patient_ids=own)
    return Scope(False, ScopeReason.ASSIGNED, unit_ids=units, bed_ids=beds,
                 own_patient_ids=reachable)


def _card_ids(board: dict) -> tuple[str, str]:
    """The normalised (bed_id, unit_id) a board card sits on. Empty strings when unresolved."""
    identity = board.get("identity") or {}
    return normalise_id(identity.get("bed_id")), normalise_id(identity.get("unit_id"))


def sees_patient(board: dict, scope: Scope) -> bool:
    """Whether this card is inside this scope.

    Two rules beyond the obvious membership test:

    * **Own patient always wins.** A physician named on a patient's care team sees that patient
      even off their unit. Consultation and handover are real, and a system that hides a patient
      from the clinician it recorded as responsible for them is contradicting its own record.
    * **An unresolved bed is not visible to a scoped user.** A card whose HIS location matched
      no bed belongs to no unit, so no assignment can reach it. Those patients are not lost —
      they are exactly what the unmatched-bed discovery report is for, and an administrator
      still sees them — but they must not leak to whoever happens to be logged in.
    """
    if scope.unrestricted:
        return True
    if str(board.get("patient_id") or "") in scope.own_patient_ids:
        return True
    bed_id, unit_id = _card_ids(board)
    if bed_id and bed_id in scope.bed_ids:
        return True
    return bool(unit_id) and unit_id in scope.unit_ids


@dataclass(frozen=True)
class ScopeResult:
    """A filtered board, and everything needed to say why it is that size.

    G2-B1a (walk I-1): the grant keys no card matched are kept apart by kind —
    `unmatched_unit_ids`, `unmatched_bed_ids` — and published as data. Since B1a every key is the
    tenant's UUID (spec D9) and no screen prints one: the screen names each key from the structure,
    in its reader's language. `unmatched_grants` is the two together, for the server's own log."""

    boards: list[dict]
    scope: Scope
    hidden: int
    unresolved_hidden: int
    unmatched_unit_ids: tuple[str, ...] = ()
    unmatched_bed_ids: tuple[str, ...] = ()

    @property
    def unmatched_grants(self) -> tuple[str, ...]:
        """Every unmatched key, units and beds together, sorted — what the log line names."""
        return tuple(sorted((*self.unmatched_unit_ids, *self.unmatched_bed_ids)))

    @property
    def blind(self) -> bool:
        """A scope was enforced and nothing came through it."""
        return not self.scope.unrestricted and not self.boards

    def as_dict(self) -> dict:
        return {
            **self.scope.as_dict(),
            "hidden": self.hidden,
            "unresolved_hidden": self.unresolved_hidden,
            "unmatched_unit_ids": list(self.unmatched_unit_ids),
            "unmatched_bed_ids": list(self.unmatched_bed_ids),
            "blind": self.blind,
        }


def apply_scope(boards: list[dict], scope: Scope) -> ScopeResult:
    """Filter a board snapshot, and count what was taken out and why."""
    if scope.unrestricted:
        return ScopeResult(list(boards), scope, 0, 0)

    visible = [b for b in boards if sees_patient(b, scope)]
    hidden = len(boards) - len(visible)
    unresolved_hidden = sum(
        1 for b in boards if not sees_patient(b, scope) and not _card_ids(b)[0]
    )

    present_beds = {bed for bed, _unit in map(_card_ids, boards) if bed}
    present_units = {unit for _bed, unit in map(_card_ids, boards) if unit}
    return ScopeResult(visible, scope, hidden, unresolved_hidden,
                       unmatched_unit_ids=tuple(sorted(scope.unit_ids - present_units)),
                       unmatched_bed_ids=tuple(sorted(scope.bed_ids - present_beds)))


def scope_report(result: ScopeResult) -> str | None:
    """A one-line operator-facing explanation, or None when there is nothing to explain.

    Turkish, because whoever reads it is standing in a Turkish hospital. It goes to the log and
    to the API response; it is not a clinical statement, so it carries no "değerlendirilecek"
    register — it is a message about the system's own configuration.

    Only the blind board is said here. Grant keys no card matched are NOT written into a sentence
    (G2-B1a walk, I-1): since B1a they are UUIDs, and the sentence that listed them printed one on a
    nurse's board. They are published as data (`ScopeResult.as_dict`), and the screen names each
    from the structure in its reader's language.
    """
    if result.scope.unrestricted:
        return None
    if result.blind:
        return ("Kapsamınızda panoda karşılığı olan hiçbir yatak yok — pano boş görünmesi "
                "koğuşun sakin olduğu anlamına GELMEZ. Yöneticinizin kapsam atamasını "
                "kontrol etmesi gerekir.")
    return None
