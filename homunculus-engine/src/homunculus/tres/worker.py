# homunculus-engine/src/homunculus/tres/worker.py
"""The rounds of the national e-health feed (TRƏS-01, spec D2, D21) — phase F0: the skeleton.

A ROUND works every tenant whose `mode` is not `off` and whose selected environment's account is
whole, one after the other, each on its own client:

* WHAT is sent is not decided here. A `PackageSource` yields the stays' PACKAGES; a package is
  handed a `Sender` and takes its resources to the platform in its own order (spec D8: Patient →
  Practitioner → Encounter → …), reading each row's `remote_id` for the references of the next.
  Phase F0 has no package builder: `no_packages` yields nothing, so a round asks the platform
  nothing. F1 supplies the source (`app.state.tres_source`).
* requests are sequential and at least PACE_S apart (the client's `pace` hook);
* HTTP 429 ends the tenant's round; the report carries how long to wait (`Retry-After`, or
  THROTTLED_S);
* a session refused (`TresSessionError`: a wrong password, a blocked provider) ends the tenant's
  round at once — every next package would ask the same token route the same question;
* A REFUSED LOGIN PARKS THE TENANT (`TresLoginRefused`: the token route answered a 4xx other than
  408 and 429): `session_refused_at` is set, and every round passes the tenant over (`parked`)
  until a save that changes something, or a successful connection test, clears it (router.py).
  Without it a wrong password costs a failed login every five minutes — 288 a day, and the
  ministry may lock the account (review I3). A token route that is down parks nothing;
* MAX_CONSECUTIVE packages failing in a row end the tenant's round too — the platform, or the
  line to it, is not well, and the next round will find out. What counts towards the five: an
  outage (no answer, a 3xx, 408, 502, 503, 504 — never counted against a row), a 5xx about one
  resource (500, 501… — counted against its row AS WELL: so during a platform-wide 500 a round
  burns at most five rows by one attempt, and those then wait 30 minutes), and a package's own
  exception. A refusal about one resource (a 4xx) is a package that ran: it ends the streak
  (review I2);
* THE TENANT'S SETTINGS HOLD DURING ITS ROUND (review #5, M8): its settings row is read again
  before every package, and ANY saved change since the round began — its `updated_at` moved: the
  mode, the environment, the types, the account — ends the tenant's round; the next round starts
  on the new settings. The `Sender` skips (`type_off`) any resource of a type switched off.

THE INSTALL'S LOCK (D2 (b)): with `egress` false `run_round` returns at once — no session is
opened, no client is built, no connection is made, whatever a tenant's row says. `tres_loop` is
started by the app's lifespan only when the lock is open, and a bad round never ends it; nor does
one tenant's failure end the round for the tenants after it. The app's
client factory is `egress.open_client` (the lock and the allowed hosts bound in): a tenant whose
address the install does not allow is passed over, counted in `refused`.

Log lines carry tenant ids, counts, statuses, exception classes and, for an unexpected exception,
WHERE it was raised — its last five frames as `file:line:function` (review M9) — never a message
and never a local value, either of which may echo a record (D25).

The session factory must not expire its objects on commit (`homunculus.db.AsyncSessionLocal` does
not): the ledger commits after every resource, and the settings rows are read after it."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import traceback
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.tres.client import TresAccount, TresClient, TresError, TresLoginRefused, TresSessionError
from homunculus.tres.egress import TresEgressRefused
from homunculus.tres.ledger import deliver, record_skip
from homunculus.tres.models import TresDelivery, TresSettings, account_of

log = logging.getLogger(__name__)

#: Seconds between two rounds (D21: every 5 minutes).
ROUND_S = 300.0
#: The least seconds between two requests to the platform (D21).
PACE_S = 0.3
#: Seconds to wait after a 429 that names no `Retry-After` (D21: 15 minutes).
THROTTLED_S = 900.0
#: The packages failing in a row after which a tenant's round ends (D21).
MAX_CONSECUTIVE = 5
#: The skip reason of a resource whose type the tenant has switched off (Yönetim › TRƏS).
TYPE_OFF = "type_off"


class Sender:
    """What a package is handed: `send` takes one built resource to the platform through the
    ledger (its row comes back, `remote_id` on it), `skip` records why one was not built. Bound to
    one tenant, its selected environment and its mode, for one round.

    THE TENANT'S TYPE SWITCHES ARE ENFORCED HERE, the one door every resource goes through (review
    #5): `send` of a type the tenant has switched off asks the platform nothing and records a skip
    with the reason TYPE_OFF — whatever the package builder forgot — unless the platform already
    holds that resource: its row (`remote_id`, `sent`) is left as it is (review M7). The round
    refreshes `enabled_types` before each package (`_work`)."""

    def __init__(self, db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID,
                 environment: str, mode: str, now: datetime, enabled_types: Iterable[str]) -> None:
        self._db, self._client = db, client
        self.tenant_id, self.environment, self.mode, self.now = tenant_id, environment, mode, now
        self.enabled_types = frozenset(enabled_types)

    async def send(self, *, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                   admission_id: uuid.UUID | None = None, force: bool = False) -> TresDelivery:
        if resource_type not in self.enabled_types:
            # Recorded only where the platform holds nothing: a sent row keeps its id and status.
            return await record_skip(self._db, tenant_id=self.tenant_id, environment=self.environment,
                                     resource_type=resource_type, local_id=local_id, reason=TYPE_OFF,
                                     admission_id=admission_id, keep_held=True)
        return await deliver(self._db, self._client, tenant_id=self.tenant_id,
                             environment=self.environment, mode=self.mode,
                             resource_type=resource_type, fhir_type=fhir_type, local_id=local_id,
                             resource=resource, admission_id=admission_id, now=self.now, force=force)

    async def skip(self, *, resource_type: str, local_id: str, reason: str,
                   admission_id: uuid.UUID | None = None) -> TresDelivery:
        return await record_skip(self._db, tenant_id=self.tenant_id, environment=self.environment,
                                 resource_type=resource_type, local_id=local_id, reason=reason,
                                 admission_id=admission_id)


#: One stay's resources, taken to the platform in order through the `Sender` it is handed. It lets
#: a `TresError` the ledger raised again (an outage, or a 5xx counted against its row) pass: the
#: round reads it.
Package = Callable[[Sender], Awaitable[None]]
#: The packages a tenant has to send this round, by its settings (F1: the stays that are due).
PackageSource = Callable[[AsyncSession, TresSettings], AsyncIterator[Package]]


async def no_packages(db: AsyncSession, settings: TresSettings) -> AsyncIterator[Package]:
    """Phase F0's source: nothing to send. F1 replaces it on `app.state.tres_source`."""
    return
    yield  # (never reached: it makes this function an async generator)


@dataclass
class RoundReport:
    tenants: int = 0                    # worked: mode not off, the account whole
    incomplete: int = 0                 # passed over: the selected environment's account is not whole
    refused: int = 0                    # passed over: the install does not allow the account's address
    parked: int = 0                     # passed over: the platform refused its login (session_refused_at)
    packages: int = 0                   # packages that ran to their end
    failed: int = 0                     # packages that raised, and tenants whose round itself did
    retry_after: float | None = None    # the longest wait a 429 asked for; None when none came


#: How many of an exception's innermost frames a log line names.
FRAMES = 5


def _where(exc: BaseException) -> str:
    """Where `exc` was raised: its last FRAMES frames, outermost first, as `file:line:function`
    (the file's base name). Nothing else of the traceback — not the source line, not a local value,
    and the caller never logs the message (D25)."""
    frames = traceback.extract_tb(exc.__traceback__)[-FRAMES:]
    return " > ".join(f"{os.path.basename(frame.filename)}:{frame.lineno}:{frame.name}"
                      for frame in frames) or "?"


class _Pacer:
    """The spacing of one client's requests: nothing before the first, PACE_S before each next."""

    def __init__(self, sleep: Callable[[float], Awaitable[None]]) -> None:
        self._sleep, self._started = sleep, False

    async def wait(self) -> None:
        if self._started:
            await self._sleep(PACE_S)
        self._started = True


async def _still_on(db: AsyncSession, sender: Sender, version: datetime | None) -> bool:
    """Reads the tenant's settings row again (by its key, `populate_existing`: the row held in
    memory is refreshed, not trusted) — an administrator may have saved the tab since the round
    began (review #5). False when the row is gone, its mode or environment differs from the
    round's, or its `updated_at` is no longer `version` (the one the round began on): ONE RULE,
    any saved change ends the tenant's round (review M8 — a changed account included), and the
    next one starts on what is set now. Otherwise the sender takes the types as they are."""
    current = await db.get(TresSettings, sender.tenant_id, populate_existing=True)
    if (current is None or current.mode != sender.mode or current.environment != sender.environment
            or (version is not None and current.updated_at != version)):
        log.warning("TRƏS: tenant %s's settings changed during its round; its round ends",
                    sender.tenant_id)
        return False
    sender.enabled_types = frozenset(current.enabled_types or ())
    return True


async def _park(db: AsyncSession, sender: Sender, status: int | None = None) -> None:
    """The platform refused this tenant's login: `session_refused_at` is set (by a statement of
    its own, so `updated_at` — the administrator's — is not touched) and committed. One log line:
    the tenant and the status, never the platform's words (they may echo the account)."""
    await db.execute(update(TresSettings).where(TresSettings.tenant_id == sender.tenant_id)
                     .values(session_refused_at=sender.now))
    await db.commit()
    log.warning("TRƏS: the platform refused tenant %s's login (HTTP %s); it is parked until its "
                "settings are saved or a connection test succeeds", sender.tenant_id, status)


@contextlib.asynccontextmanager
async def _closing(packages: AsyncIterator[Package]) -> AsyncIterator[AsyncIterator[Package]]:
    """`contextlib.aclosing`, for any async iterator: an async generator is closed on the way out;
    an iterator with no `aclose` is simply left."""
    try:
        yield packages
    finally:
        close = getattr(packages, "aclose", None)
        if close is not None:
            await close()


async def _work(db: AsyncSession, client: TresClient, sender: Sender, settings: TresSettings,
                source: PackageSource, report: RoundReport, version: datetime | None = None) -> None:
    """One tenant's packages, until they end, a 429 or a refused session comes, MAX_CONSECUTIVE
    fail in a row, or the tenant's settings change under it (re-read before every package).
    `version` is the settings' `updated_at` the round began on (read now when not given)."""
    consecutive = 0
    if version is None:
        current = await db.get(TresSettings, sender.tenant_id, populate_existing=True)
        version = current.updated_at if current is not None else None
    if not await _still_on(db, sender, version):
        return
    # Closed as soon as the tenant's round ends, early or not (review M11): an F1 source holds a
    # query open, and an async generator left behind is closed only when it is collected.
    async with _closing(source(db, settings)) as packages:
        async for package in packages:
            if not await _still_on(db, sender, version):
                return
            try:
                await package(sender)
            except TresError as exc:
                report.failed += 1
                if exc.status == 429:
                    wait = exc.retry_after if exc.retry_after is not None else THROTTLED_S
                    report.retry_after = max(report.retry_after or 0.0, wait)
                    log.warning("TRƏS: 429 for tenant %s; its round ends, the next waits %.0f s",
                                sender.tenant_id, report.retry_after)
                    return
                if isinstance(exc, TresLoginRefused):
                    await _park(db, sender, exc.status)
                    return
                if isinstance(exc, TresSessionError):
                    log.warning("TRƏS: %s (HTTP %s) for tenant %s; its round ends",
                                type(exc).__name__, exc.status, sender.tenant_id)
                    return
                consecutive += 1
            except Exception as exc:  # noqa: BLE001 — one bad package must not end the round
                report.failed += 1
                consecutive += 1
                log.error("TRƏS: a package failed for tenant %s (%s at %s)", sender.tenant_id,
                          type(exc).__name__, _where(exc))
                await db.rollback()
                # The rollback expired every row this session held, the settings the source reads
                # among them: read them again before the source runs on.
                if not await _still_on(db, sender, version):
                    return
            else:
                report.packages += 1
                consecutive = 0
            if consecutive >= MAX_CONSECUTIVE:
                log.warning("TRƏS: %d packages failed in a row for tenant %s; its round ends",
                            consecutive, sender.tenant_id)
                return


async def run_round(session_factory: Callable[[], AsyncSession], *, egress: bool,
                    source: PackageSource, now: datetime,
                    client_factory: Callable[[TresAccount], TresClient],
                    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> RoundReport:
    """One round over every tenant (the module's docstring). With `egress` false nothing at all is
    touched: not the database, not the client factory. One tenant's failure — its package source
    raising, say — is logged by its class and the round goes on to the next tenant."""
    report = RoundReport()
    if not egress:
        return report
    async with session_factory() as db:
        rows = (await db.execute(select(TresSettings).where(TresSettings.mode != "off")
                                 .order_by(TresSettings.tenant_id))).scalars().all()
        # Read before the first commit: (settings, account, tenant, environment, mode, parked, and
        # the `updated_at` the tenant's round begins on — any save after it ends that round).
        work = [(row, account_of(row), row.tenant_id, row.environment, row.mode,
                 row.session_refused_at is not None, row.updated_at) for row in rows]
        for settings, account, tenant_id, environment, mode, parked, version in work:
            if parked:
                report.parked += 1
                continue
            if account is None:
                report.incomplete += 1
                continue
            try:
                client = client_factory(account)
            except ValueError:
                # Only from a factory that builds a TresClient itself (the app's, open_client,
                # refuses first): its constructor refused the base URL (not https, not a URL).
                report.incomplete += 1
                continue
            except TresEgressRefused as exc:   # the lock, or an address the install does not allow
                log.warning("TRƏS: tenant %s passed over (%s)", tenant_id, exc.code)
                report.refused += 1
                continue
            report.tenants += 1
            client.pace = _Pacer(sleep).wait
            sender = Sender(db, client, tenant_id=tenant_id, environment=environment, mode=mode, now=now,
                            enabled_types=())        # `_work` reads the tenant's types before each package
            try:
                await _work(db, client, sender, settings, source, report, version)
            except Exception as exc:  # noqa: BLE001 — one tenant's failure must not end the others'
                report.failed += 1
                log.error("TRƏS: the round failed for tenant %s (%s at %s); the next tenant goes on",
                          tenant_id, type(exc).__name__, _where(exc))
                await db.rollback()
            finally:
                await client.aclose()
    return report


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def tres_loop(session_factory: Callable[[], AsyncSession], *, source: PackageSource,
                    client_factory: Callable[[TresAccount], TresClient],
                    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                    clock: Callable[[], datetime] = _utcnow) -> None:
    """A round every ROUND_S, for as long as the app runs — started by the lifespan ONLY when the
    install's lock is open, so every round here runs with `egress=True`. After a 429 the next
    round waits what the platform asked (never less than ROUND_S). A round that raises is logged
    by its class and the loop goes on (`_escalation_loop`'s rule: a bad cycle never kills it)."""
    wait = ROUND_S
    while True:
        await sleep(wait)
        wait = ROUND_S
        try:
            report = await run_round(session_factory, egress=True, source=source, now=clock(),
                                     client_factory=client_factory, sleep=sleep)
        except Exception as exc:  # noqa: BLE001 — a bad round must never kill the loop
            log.error("TRƏS round failed (%s at %s); the next one runs in %.0f s", type(exc).__name__,
                      _where(exc), ROUND_S)
            continue
        if report.retry_after is not None:
            wait = max(ROUND_S, report.retry_after)
