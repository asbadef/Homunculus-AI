# homunculus-engine/src/homunculus/tres/source.py
"""Where a round's packages come from (TRƏS-01, spec D8, D9, D10, D21, D24; plan F1, N1–N3, O15,
O21): the stays that are due, read whole, each handed to the package (tres/package.py).

BUILT IN `create_app` (N1), because the bedside values are `chart` rows of the app's AUDIT LOG — a
synchronous store, keyed by the tenant's SLUG and the stay's board key — and put on
`app.state.tres_source`, which the lifespan hands to the rounds and the hand routes read. Every
audit read and write here goes through `asyncio.to_thread`: the event loop never waits on it.

WHICH STAYS A ROUND SENDS (D9, amended by plan F1; `window`):
* the chain's last admission is DISCHARGED, with a `discharge_at`;
* the window is judged on the later of its `discharge_at` and its `updated_at` (`window_key`,
  batch-4 review: a discharge confirmed or backdated long after its `discharge_at`, or a later edit
  of the row, brings the stay within reach — `transition_to` bumps `updated_at` when the row becomes
  DISCHARGED); the cut-off below is judged on `discharge_at` alone. Below, «its discharge» is that key;
* `settle_hours` have passed since it — `discharge <= now − settle_hours` (the round's UPPER
  bound, inclusive: a stay is due the moment its wait is over);
* it is within the rounds' REACH: after the week before that bound (`> upper − REACH`, exclusive) —
  a stay is rebuilt every round for a week after it became due, which is when a late correction is
  picked up by D7 (an unchanged resource asks the platform nothing) — OR, when the last round that
  ran to its END for the tenant is older than that week, after THAT round's upper bound
  (`tres_settings.reached_to`, amendment 25, A3; with none yet, the cut-off alone bounds it). So a
  stay discharged while no round could complete (a parked tenant, `TRES_EGRESS` closed for
  maintenance, an outage or 429s for more than a week) is not dropped: the first round that
  completes afterwards reaches back to the last one that did, and the window then closes to the
  week again. A stay older than all of that goes by hand («Şimdi gönder») or the nightly retry
  (when a row of it is unfinished);
* O15 (PROPOSED, AWAITING THE OWNER'S WORD): not discharged before the tenant's `send_from` — the
  moment `send` was first chosen, by default — so opening `send` where another system has reported
  the stays already (O11) does not send its whole recent past again. The cut-off is never crossed,
  however far back the watermark reaches.
A ROUND THAT RUNS TO ITS END (A3) is one whose packages were all handed out and none of whose
causes to stop came: the source's generator is exhausted only then (worker.py `_work` closes it on
every early end — a session refused, a 429, five failures in a row, the settings saved under it —
and a tenant parked, passed over or behind a closed lock never reaches the source). A package that
failed alone (fewer than five in a row) does not end the round: its stay was due in this window
and stays within the week of the next rounds — and, past it, its `failed` or `pending` row takes it
to the nightly retry (batch-4 review: a gap stay the watermark has passed included). Its last step
writes `reached_to` = its upper bound, by its own statement (never `updated_at`), as a
compare-and-set: only while the settings are still the version the round began on and `reached_to`
is still what it read — a save during the last package, or another process's round, moves nothing.
THE NIGHTLY RETRY (D21, O21; batch-4 review): at the first round after 04:00 in the tenant's zone —
on a tenant's first night too: never before 04:00 (A6) — every UNFINISHED stay is rebuilt and sent
with `force`, whatever its age (`retry_stays`):
* a stay with a row `stuck`, `failed` or `pending` in the selected environment (a gap stay whose
  catch-up met one outage or one refusal, a refusal in the last hours of a stay's week…);
* in `send` only, a stay whose Encounter row is not `sent` — skipped for any reason
  (`patient_unheld`, `unit_unmapped`, `timezone_unknown`, `discharge_missing`, `organization_missing`,
  `type_off`…): a FİN added, a unit mapped or a zone set later sends the old stay with no hand. In
  `validate` an Encounter `no_reference` is what every stay of a tenant that never sent has: the
  night would rebuild them all, so it takes only the three statuses above;
* NEVER a stay discharged before the cut-off (`send_from`; a stay not discharged is not before it):
  O15 exists to keep the stays another system reported from going again.
THE NIGHT'S COST is bounded by the unfinished stays since the cut-off, each rebuilt once a night
(its unchanged resources ask nothing, D7; a skip that still stands writes nothing new) — a stay
that can never be sent (a person with no FİN) is read every night until it can, or a hand sends it.
A stuck stay that is also due goes once, forced (A8). The night is marked first (`retried_at`, by
its own statement): a round that ends early leaves the rest to the next night or «Yeniden dene». A
zone this server's zone database does not hold is said in a warning — once per tenant in this
process, its id and nothing else — and the night is read in UTC.
ONE API PROCESS: `Dockerfile.api` runs uvicorn with one worker (state that must be one per server
lives in its memory), so one round runs at a time. The night's mark and the watermark are
compare-and-sets all the same (`WHERE … IS NOT DISTINCT FROM <what the round read>`, by rowcount):
were a second process ever to run rounds, two could not both run one night, nor move the watermark
over each other.

A STAY READ WHOLE (`load`, N2, N3): from any of its admissions, the chain up to its root and down
to its last row; the person from the root's patient row (a transfer keeps it) with the FİN
decrypted (`national_id` is an `EncryptedString` and cannot be searched); the last row's unit's
department; the chain's attendings with the identities the tab holds; the tenant's zone; and the
bedside values — ONE read of the trail under the last row's board key, because a transfer moves
the protocol number to the arriving row (admission/service.py, O8 of 2026-11-02) and keeps the
patient row, so every chart row of the stay is under that one key.

A stay whose Encounter's delivery in this run took its platform id (under the row's lock, A5:
`package.Outcome.first_complete`) and ran to its end writes the one `tres.package` audit row
(D24): the board key, the last admission's id, the environment and the counts by type and status —
no person, no value. Of a round and a hand on one stay, only the one that took the id writes it."""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, func, or_, select, update
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
    """Has NIGHTLY_HOUR come, in `zone`, since the last nightly retry? Never run: only once today's
    NIGHTLY_HOUR has come (A6) — the first round at or after 04:00 local, never one before it."""
    local = now.astimezone(zone)
    today = local.replace(hour=NIGHTLY_HOUR, minute=0, second=0, microsecond=0)
    if retried_at is None:
        return local >= today
    night = today if local >= today else today - timedelta(days=1)
    return retried_at < night


def window(settings: TresSettings, now: datetime) -> tuple[datetime | None, datetime]:
    """(after, upper) of a round at `now` (the module's docstring; amendment 25, A3): a stay is due
    when `after < its discharge <= upper` — its discharge being `window_key` (batch-4 review), no
    lower bound of this kind when `after` is None — and, with a cut-off, `discharge_at >= send_from`
    (`due_stays` adds that; the cut-off is never crossed).

        upper = now − settle_hours
        after = min(upper − REACH, reached_to)   when a round has run to its end (`reached_to`)
              = None                             when none has and there is a cut-off (`send_from`)
              = upper − REACH                    when there is neither (a `validate` round)"""
    upper = now - timedelta(hours=settings.settle_hours)
    week = upper - REACH
    if settings.reached_to is not None:
        return min(week, settings.reached_to), upper
    if settings.send_from is not None:
        return None, upper
    return week, upper


def window_key():
    """What the window is judged on (batch-4 review): the later of the last admission's `discharge_at`
    and its `updated_at` — `transition_to` bumps it when the row becomes DISCHARGED, and any later edit
    of the row does too. A discharge confirmed (or backdated) long after its `discharge_at`, or a row
    edited after the stay left the rounds, so comes within reach again, its wait counted from that
    moment. The cut-off is judged on `discharge_at` alone (`due_stays`)."""
    return func.greatest(Admission.discharge_at, Admission.updated_at)


async def due_stays(db: AsyncSession, settings: TresSettings, now: datetime) -> list[uuid.UUID]:
    """The last admissions of the stays a round sends (the module's docstring, `window`, judged on
    `window_key`), oldest first. The caller's tenant only."""
    after, upper = window(settings, now)
    key = window_key()
    query = select(Admission.id).where(
        Admission.tenant_id == settings.tenant_id, Admission.state == AdmissionState.DISCHARGED,
        Admission.discharge_at.is_not(None), key <= upper)
    if after is not None:
        query = query.where(key > after)
    if settings.send_from is not None:
        query = query.where(Admission.discharge_at >= settings.send_from)
    return list((await db.execute(query.order_by(key, Admission.id))).scalars())


#: The statuses whose stays the nightly retry takes in either mode: a refusal still waiting
#: (`failed`), five in a row (`stuck`), a row an outage left (`pending`) — batch-4 review.
RETRIED = ("stuck", "failed", "pending")
#: An Encounter in one of these is not taken by the night's «not sent» rule: `deleted` is F6's (a
#: record removed on purpose is not brought back by a night).
NOT_RETRIED_ENCOUNTER = ("sent", "deleted")


async def retry_stays(db: AsyncSession, settings: TresSettings) -> list[uuid.UUID]:
    """The stays (their last admissions) the nightly retry takes (the module's docstring): a row
    `stuck`, `failed` or `pending` in the selected environment; in `send`, also an Encounter row that
    is not `sent` (skipped for any reason: `patient_unheld`, `unit_unmapped`, `timezone_unknown`…).
    Never a stay discharged before the cut-off (`send_from`; one not discharged is not before it).
    The caller's tenant only."""
    unfinished = TresDelivery.status.in_(RETRIED)
    if settings.mode == "send":
        unfinished = or_(unfinished, and_(TresDelivery.resource_type == "encounter",
                                          TresDelivery.status.not_in(NOT_RETRIED_ENCOUNTER)))
    query = (select(TresDelivery.admission_id)
             .join(Admission, Admission.id == TresDelivery.admission_id)
             .where(TresDelivery.tenant_id == settings.tenant_id, Admission.tenant_id == settings.tenant_id,
                    TresDelivery.environment == settings.environment, unfinished))
    if settings.send_from is not None:
        query = query.where(or_(Admission.discharge_at.is_(None), Admission.discharge_at >= settings.send_from))
    return list((await db.execute(query.distinct().order_by(TresDelivery.admission_id))).scalars())


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
        #: The tenants whose unknown zone this process has said already (once each, not every round).
        self._zone_said: set[uuid.UUID] = set()

    async def __call__(self, db: AsyncSession, settings: TresSettings) -> AsyncIterator:
        """A round's packages for one tenant: the nightly retry's first when its night has come,
        then the stays that are due (each stay once); and, when the round has taken every one of
        them — the consumer asked past the last — the watermark (the module's docstring)."""
        now = self.clock()
        tenant_id = settings.tenant_id
        # What the round began on, as plain values: a rollback expires the row, and worker.py's
        # `_still_on` reads it again (the same object) before every package.
        version, seen_reach, seen_night = settings.updated_at, settings.reached_to, settings.retried_at
        upper = window(settings, now)[1]
        zone = self.night_zone(await db.get(Tenant, tenant_id))
        forced: set[uuid.UUID] = set()
        if nightly_due(seen_night, now, zone) and await self._mark_night(db, tenant_id, seen_night, now):
            for admission_id in await retry_stays(db, settings):
                forced.add(admission_id)
                yield self.package(db, settings, admission_id, force=True)
        for admission_id in await due_stays(db, settings, now):
            if admission_id not in forced:          # A8: a stuck stay that is due went once, forced
                yield self.package(db, settings, admission_id)
        # Reached only when the round ran to its END: an early end closes this generator at its
        # `yield` (worker.py `_closing`), and nothing after it runs.
        await self._mark_reach(db, tenant_id, version, seen_reach, upper)

    def night_zone(self, tenant: Tenant) -> tzinfo:
        """The zone the tenant's night is read in: its own; UTC, said in a warning, for a name this
        server's zone database does not hold (A6) — the tenant's id only, nothing else, and once per
        tenant in this process (batch-4 review: not 288 times a day)."""
        zone = self.zone(tenant.timezone)
        if zone is None:
            if tenant.id not in self._zone_said:
                self._zone_said.add(tenant.id)
                log.warning("TRƏS: tenant %s's time zone is not in this server's zone database; its nightly "
                            "retry is timed in UTC", tenant.id)
            return timezone.utc
        return zone

    async def _mark_night(self, db: AsyncSession, tenant_id: uuid.UUID, seen: datetime | None,
                          now: datetime) -> bool:
        """The night marked BEFORE it runs, by its own statement (never `updated_at`), as a
        compare-and-set on the `retried_at` the round read (A6): True when this round marked it —
        and so runs it; False when another round already did (no row changed)."""
        marked = (await db.execute(
            update(TresSettings).where(TresSettings.tenant_id == tenant_id,
                                       TresSettings.retried_at.is_not_distinct_from(seen))
            .values(retried_at=now).execution_options(synchronize_session=False))).rowcount > 0
        await db.commit()
        if not marked:
            log.info("TRƏS: tenant %s's nightly retry was marked by another round; this one leaves it", tenant_id)
        return marked

    async def _mark_reach(self, db: AsyncSession, tenant_id: uuid.UUID, version: datetime,
                          seen: datetime | None, upper: datetime) -> None:
        """The watermark of a round that ran to its end (A3): `reached_to` = its upper bound, by its
        own statement (never `updated_at`), only while the settings are the version the round began
        on and `reached_to` is what it read — a compare-and-set by rowcount."""
        moved = (await db.execute(
            update(TresSettings).where(TresSettings.tenant_id == tenant_id, TresSettings.updated_at == version,
                                       TresSettings.reached_to.is_not_distinct_from(seen))
            .values(reached_to=upper).execution_options(synchronize_session=False))).rowcount > 0
        await db.commit()
        if not moved:
            log.info("TRƏS: tenant %s's reach was not moved: its settings were saved during the round, or "
                     "another round moved it", tenant_id)

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
        # One stay's rows: `tenant = … AND patient_id = … AND event_type IN (…) AND id > … ORDER BY id
        # LIMIT …`, for every due stay of every round (amendment 25, A2). It is served by main's
        # `ix_audit_tenant_patient_id` on audit (tenant, patient_id, id), from main's migration
        # 0021_vital_readings — which this branch does NOT carry until the merge renumbers 0020 onto
        # it; until then (0013's (tenant, event_type, id) only) the read walks the tenant's chart rows.
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
