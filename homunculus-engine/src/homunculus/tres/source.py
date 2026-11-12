# homunculus-engine/src/homunculus/tres/source.py
"""Where a round's packages come from (TRƏS-01, spec D8, D9, D10, D21, D24; plan F1, N1–N3, O15,
O21): the stays that are due, read whole, each handed to the package (tres/package.py).

BUILT IN `create_app` (N1), because the bedside values are `chart` rows of the app's AUDIT LOG — a
synchronous store, keyed by the tenant's SLUG and the stay's board key — and put on
`app.state.tres_source`, which the lifespan hands to the rounds and the hand routes read. Every
audit read and write here goes through `asyncio.to_thread`: the event loop never waits on it.

WHICH STAYS A ROUND SENDS (D9, amended by plan F1):
* the chain's last admission is DISCHARGED, with a `discharge_at`;
* `settle_hours` have passed since it;
* no more than REACH (7 days) have passed after that — a stay is rebuilt every round for a week
  after it became due, which is when a late correction is picked up by D7 (an unchanged resource
  asks the platform nothing). An older stay goes only by hand («Şimdi gönder»);
* O15 (PROPOSED, AWAITING THE OWNER'S WORD): not discharged before the tenant's `send_from` — the
  moment `send` was first chosen, by default — so opening `send` where another system has reported
  the stays already (O11) does not send its whole recent past again.
THE NIGHTLY RETRY (D21, O21): at the first round after 04:00 in the tenant's zone, every stay with
a `stuck` row in the selected environment is rebuilt and sent with `force` — whatever its age. The
night is marked first (`retried_at`, by its own statement): a round that ends early leaves the
rest to the next night or «Yeniden dene».

A STAY READ WHOLE (`load`, N2, N3): from any of its admissions, the chain up to its root and down
to its last row; the person from the root's patient row (a transfer keeps it) with the FİN
decrypted (`national_id` is an `EncryptedString` and cannot be searched); the last row's unit's
department; the chain's attendings with the identities the tab holds; the tenant's zone; and the
bedside values — ONE read of the trail under the last row's board key, because a transfer moves
the protocol number to the arriving row (admission/service.py, O8 of 2026-11-02) and keeps the
patient row, so every chart row of the stay is under that one key.

A stay whose Encounter reached the platform for the first time in this run writes the one
`tres.package` audit row (D24): the board key, the last admission's id, the environment and the
counts by type and status — no person, no value."""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.api.audit import AuditEvent, AuditLog, iter_records_of
from homunculus.tenant.models import Tenant
from homunculus.tres.models import TresDelivery, TresDepartmentMap, TresPractitionerIdentity, TresSettings
from homunculus.tres.package import Outcome, run
from homunculus.tres.stay import CHART, RETRACT, Clinician, Department, Person, Stay, readings_of

log = logging.getLogger(__name__)

#: How long after it became due a stay is still rebuilt by the rounds (plan F1, D9 amended).
REACH = timedelta(days=7)
#: The hour, in the tenant's zone, after which a night's retry of `stuck` rows runs (D21).
NIGHTLY_HOUR = 4
#: The trail is read this many rows at a time (iter_records_of).
PAGE = 500


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def zone_of(name: str | None) -> tzinfo | None:
    """The tenant's zone: UTC for an empty name or "UTC", None for a name this server's zone
    database does not hold — a time is then never sent (`timezone_unknown`), never guessed."""
    if not name or name == "UTC":
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return None


def nightly_due(retried_at: datetime | None, now: datetime, zone: tzinfo) -> bool:
    """Has NIGHTLY_HOUR come, in `zone`, since the last nightly retry? (Never run: yes.)"""
    local = now.astimezone(zone)
    night = local.replace(hour=NIGHTLY_HOUR, minute=0, second=0, microsecond=0)
    if local < night:
        night -= timedelta(days=1)
    return retried_at is None or retried_at < night


async def due_stays(db: AsyncSession, settings: TresSettings, now: datetime) -> list[uuid.UUID]:
    """The last admissions of the stays a round sends (the module's docstring), oldest discharge first."""
    settled = now - timedelta(hours=settings.settle_hours)
    query = select(Admission.id).where(
        Admission.tenant_id == settings.tenant_id, Admission.state == AdmissionState.DISCHARGED,
        Admission.discharge_at.is_not(None), Admission.discharge_at <= settled,
        Admission.discharge_at > settled - REACH)
    if settings.send_from is not None:
        query = query.where(Admission.discharge_at >= settings.send_from)
    return list((await db.execute(query.order_by(Admission.discharge_at, Admission.id))).scalars())


async def stuck_stays(db: AsyncSession, settings: TresSettings) -> list[uuid.UUID]:
    """The stays (their last admissions) with a `stuck` row in the selected environment."""
    return list((await db.execute(
        select(TresDelivery.admission_id).where(
            TresDelivery.tenant_id == settings.tenant_id, TresDelivery.environment == settings.environment,
            TresDelivery.status == "stuck", TresDelivery.admission_id.is_not(None))
        .distinct().order_by(TresDelivery.admission_id))).scalars())


async def chain_of(db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> list[Admission]:
    """The stay's admissions, root first, from any one of them — the caller's tenant only (empty
    when the admission is not the tenant's). Read afresh (`populate_existing`): a round's session
    lives for many stays."""
    async def one(query):
        return (await db.execute(query.execution_options(populate_existing=True))).scalars().first()

    row = await one(select(Admission).where(Admission.id == admission_id, Admission.tenant_id == tenant_id))
    if row is None:
        return []
    chain = [row]
    while chain[0].source_admission_id is not None and len(chain) < 64:
        parent = await one(select(Admission).where(Admission.id == chain[0].source_admission_id,
                                                   Admission.tenant_id == tenant_id))
        if parent is None:
            break
        chain.insert(0, parent)
    while len(chain) < 64:
        child = await one(select(Admission).where(Admission.source_admission_id == chain[-1].id,
                                                  Admission.tenant_id == tenant_id)
                          .order_by(Admission.created_at, Admission.id))
        if child is None:
            break
        chain.append(child)
    return chain


class StaySource:
    """The app's `PackageSource` (worker.py) and the hand routes' way to one stay's package."""

    def __init__(self, audit: AuditLog, *, clock: Callable[[], datetime] = _utcnow,
                 zone: Callable[[str | None], tzinfo | None] = zone_of) -> None:
        self.audit, self.clock, self.zone = audit, clock, zone

    async def __call__(self, db: AsyncSession, settings: TresSettings) -> AsyncIterator:
        """A round's packages for one tenant: the nightly retry's first when its night has come,
        then the stays that are due."""
        now = self.clock()
        tenant_id = settings.tenant_id
        zone = self.zone((await db.get(Tenant, tenant_id)).timezone) or timezone.utc
        if nightly_due(settings.retried_at, now, zone):
            await db.execute(update(TresSettings).where(TresSettings.tenant_id == tenant_id)
                             .values(retried_at=now))
            await db.commit()
            for admission_id in await stuck_stays(db, settings):
                yield self.package(db, settings, admission_id, force=True)
        for admission_id in await due_stays(db, settings, now):
            yield self.package(db, settings, admission_id)

    def package(self, db: AsyncSession, settings: TresSettings, admission_id: uuid.UUID, *,
                force: bool = False):
        """The package of the stay `admission_id` belongs to. It reads the stay when it runs (never
        before), and answers what it did (`package.Outcome`), or None when the stay is gone."""
        tenant_id = settings.tenant_id

        async def package(sender) -> Outcome | None:
            stay = await self.load(db, tenant_id, admission_id)
            if stay is None:
                return None
            organization = getattr(settings, f"{sender.environment}_organization_id", None)
            outcome = await run(stay, sender, organization_id=organization, force=force)
            if outcome.first_complete:
                await self._audit_package(db, tenant_id, stay, sender.environment, outcome)
            return outcome

        return package

    async def load(self, db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> Stay | None:
        """The stay `admission_id` belongs to, read whole (the module's docstring); None when the
        admission is not the tenant's."""
        chain = await chain_of(db, tenant_id, admission_id)
        if not chain:
            return None
        root, last = chain[0], chain[-1]
        person = await db.get(Patient, root.patient_id, populate_existing=True)
        tenant = await db.get(Tenant, tenant_id)
        department = (await db.execute(select(TresDepartmentMap).where(
            TresDepartmentMap.unit_id == last.admitting_unit_id, TresDepartmentMap.tenant_id == tenant_id)
            .execution_options(populate_existing=True))).scalar_one_or_none()
        attendings = list(dict.fromkeys(a.attending_physician_id for a in chain if a.attending_physician_id))
        identities = {row.user_id: row for row in (await db.execute(select(TresPractitionerIdentity).where(
            TresPractitionerIdentity.tenant_id == tenant_id, TresPractitionerIdentity.user_id.in_(attendings))
            .execution_options(populate_existing=True))).scalars()} if attendings else {}
        key = board_key(last.protocol_no, person.patient_number)
        records = await asyncio.to_thread(lambda: list(iter_records_of(
            self.audit, tenant=tenant.slug, event_types=(CHART, RETRACT), page=PAGE, patient_id=key)))
        clinicians = tuple(
            Clinician(user_id, identities[user_id].fin, identities[user_id].family_name,
                      identities[user_id].given_name, known=True) if user_id in identities else Clinician(user_id)
            for user_id in attendings)
        return Stay(
            root_id=root.id, last_id=last.id, board_key=key, admitted_at=root.admission_datetime,
            discharged_at=last.discharge_at, finished=last.state == AdmissionState.DISCHARGED,
            person=Person(fin=person.national_id, display_name=person.display_name,
                          father_name=person.father_name, sex=person.sex,
                          date_of_birth=person.date_of_birth, phone=person.phone),
            zone=self.zone(tenant.timezone),
            department=Department(department.code, department.display) if department else None,
            clinicians=clinicians, weight_kg=root.weight_kg, height_cm=root.height_cm,
            readings=readings_of(records))

    async def _audit_package(self, db: AsyncSession, tenant_id: uuid.UUID, stay: Stay, environment: str,
                             outcome: Outcome) -> None:
        """The stay's one `tres.package` row (D24). An audit that fails is logged by its class and
        never fails the package: the ledger already holds what was sent."""
        slug = (await db.get(Tenant, tenant_id)).slug
        event = AuditEvent(slug, "tres.package", stay.board_key, "",
                           {"admission_id": str(stay.last_id), "environment": environment,
                            "counts": outcome.counts()})
        try:
            await asyncio.to_thread(self.audit.append, event)
        except Exception as exc:  # noqa: BLE001 — the ledger is the record of what was sent
            log.error("TRƏS: the tres.package row of admission %s was not written (%s)", stay.last_id,
                      type(exc).__name__)
