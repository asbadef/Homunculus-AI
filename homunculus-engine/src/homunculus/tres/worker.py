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
* MAX_CONSECUTIVE packages failing in a row end the tenant's round too — the platform, or the
  line to it, is not well, and the next round will find out.

THE INSTALL'S LOCK (D2 (b)): with `egress` false `run_round` returns at once — no session is
opened, no client is built, no connection is made, whatever a tenant's row says. `tres_loop` is
started by the app's lifespan only when the lock is open, and a bad round never ends it.

Log lines carry tenant ids, counts and exception classes — never a message, which may echo a
value (D25).

The session factory must not expire its objects on commit (`homunculus.db.AsyncSessionLocal` does
not): the ledger commits after every resource, and the settings rows are read after it."""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.tres.client import TresAccount, TresClient, TresError
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


class Sender:
    """What a package is handed: `send` takes one built resource to the platform through the
    ledger (its row comes back, `remote_id` on it), `skip` records why one was not built. Bound to
    one tenant, its selected environment and its mode, for one round."""

    def __init__(self, db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID,
                 environment: str, mode: str, now: datetime) -> None:
        self._db, self._client = db, client
        self.tenant_id, self.environment, self.mode, self.now = tenant_id, environment, mode, now

    async def send(self, *, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                   admission_id: uuid.UUID | None = None, force: bool = False) -> TresDelivery:
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
#: a `TresError` the ledger raised again (a 429, a dead line) pass: the round reads it.
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
    packages: int = 0                   # packages that ran to their end
    failed: int = 0                     # packages that raised
    retry_after: float | None = None    # the longest wait a 429 asked for; None when none came


class _Pacer:
    """The spacing of one client's requests: nothing before the first, PACE_S before each next."""

    def __init__(self, sleep: Callable[[float], Awaitable[None]]) -> None:
        self._sleep, self._started = sleep, False

    async def wait(self) -> None:
        if self._started:
            await self._sleep(PACE_S)
        self._started = True


async def _work(db: AsyncSession, client: TresClient, sender: Sender, settings: TresSettings,
                source: PackageSource, report: RoundReport) -> None:
    """One tenant's packages, until they end, a 429 comes, or MAX_CONSECUTIVE fail in a row."""
    consecutive = 0
    async for package in source(db, settings):
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
            consecutive += 1
        except Exception as exc:  # noqa: BLE001 — one bad package must not end the round
            report.failed += 1
            consecutive += 1
            log.error("TRƏS: a package failed for tenant %s (%s)", sender.tenant_id, type(exc).__name__)
            await db.rollback()
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
    touched: not the database, not the client factory."""
    report = RoundReport()
    if not egress:
        return report
    async with session_factory() as db:
        rows = (await db.execute(select(TresSettings).where(TresSettings.mode != "off")
                                 .order_by(TresSettings.tenant_id))).scalars().all()
        # Read before the first commit: (settings, account, tenant, environment, mode).
        work = [(row, account_of(row), row.tenant_id, row.environment, row.mode) for row in rows]
        for settings, account, tenant_id, environment, mode in work:
            if account is None:
                report.incomplete += 1
                continue
            try:
                client = client_factory(account)
            except ValueError:          # a base URL that is not https (a row written past the route)
                report.incomplete += 1
                continue
            report.tenants += 1
            client.pace = _Pacer(sleep).wait
            sender = Sender(db, client, tenant_id=tenant_id, environment=environment, mode=mode, now=now)
            try:
                await _work(db, client, sender, settings, source, report)
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
            log.error("TRƏS round failed (%s); the next one runs in %.0f s", type(exc).__name__, ROUND_S)
            continue
        if report.retry_after is not None:
            wait = max(ROUND_S, report.retry_after)
