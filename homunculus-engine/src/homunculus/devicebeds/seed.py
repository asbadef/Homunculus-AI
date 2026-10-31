# homunculus-engine/src/homunculus/devicebeds/seed.py
"""The one-time seed of `device_beds` from the approved v2 file (spec D7, §5.4), and the grant of
`devices.map_beds` to the tenant's `charge_nurse` group (§4.6, O11) in the same transaction.

Not a migration: a migration runs on every database (the lab, the tests). The file is checked by its
sha256 against the approved one and parsed by Lane A's own reader; nothing is partly written. Run
again over the untouched rows it answers `already` and writes nothing — not even the grant, which an
administrator may have taken away since (a boot-time grant would put it back, so there is none).

Before the commit the rows are read back from the database and their rows digest (`rows_digest`, the
one `PostgresDeviceBeds` reports as `sha256`) must equal the file's own (A-9): if it does not, nothing
stays. The history trigger of migration 0014 refuses every later correction, so a wrong seed has to
be caught while it can still be rolled back.

PHI RULE: addresses, labels and ids only."""
from __future__ import annotations

import hashlib
import json
import sys
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.infinity_device_beds import (
    DeviceBedTable, Row, TableError, no_duplicate_keys, parse_table, rows_digest,
)
from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import to_row
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit

APPROVED_V2_SHA256 = "84ac1760d59f31b9ab016ca30f08cb1e7387addb02355ea02e3600e4e7ed584d"
DEFAULT_FILE = "/etc/homunculus/infinity-shadow/device-beds.json"
GRANT_KEY, GRANT_GROUP = "devices.map_beds", "charge_nurse"
LINE = "ESLEME_ICE_AKTARIM"


class ImportRefused(Exception):
    """Nothing was written. `code` is the CLI's exit code: 2 a check failed, 3 the tenant's table
    holds other rows than the file's."""

    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code, self.reason = code, reason


@dataclass
class ImportResult:
    tenant: str
    file_sha256: str
    rows: int
    with_bed: int
    without_bed: int
    granted: list[str] = field(default_factory=list)
    version: int | None = None
    sha256: str | None = None
    already: bool = False
    dry_run: bool = False

    def line(self) -> str:
        return f"{LINE} {json.dumps(asdict(self), ensure_ascii=False)}"


def _parse(data: bytes, approved_sha: str) -> tuple[str, DeviceBedTable]:
    digest = hashlib.sha256(data).hexdigest()
    if digest != approved_sha:
        raise ImportRefused(2, f"dosyanın sha256'sı onaylı v2'ninki değil ({digest[:12]}…)")
    try:
        raw = json.loads(data.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ImportRefused(2, "JSON okunamadı (bozuk ya da tekrarlanan anahtar)") from None
    try:
        return digest, parse_table(raw)
    except TableError as error:
        raise ImportRefused(2, error.reason) from None


async def _check_beds(db: AsyncSession, tenant_id: uuid.UUID, rows: tuple[Row, ...]) -> None:
    for row in rows:
        if row.bed_id is None:
            continue
        try:
            bed_id, unit_id = uuid.UUID(row.bed_id), uuid.UUID(row.unit_id or "")
        except ValueError:
            raise ImportRefused(2, f"{row.source}: yatak ya da birim kimliği bir UUID değil") from None
        found = (await db.execute(
            select(Room.unit_id, Site.tenant_id).select_from(Bed).join(Room, Room.id == Bed.room_id)
            .join(Unit, Unit.id == Room.unit_id).join(Site, Site.id == Unit.site_id)
            .where(Bed.id == bed_id))).first()
        if found is None or found.tenant_id != tenant_id:
            raise ImportRefused(2, f"{row.source}: yatak bu hastanenin değil ya da yok")
        if found.unit_id != unit_id:
            raise ImportRefused(2, f"{row.source}: birim, yatağın odasının birimi değil")


def _seeded(tenant_id: uuid.UUID, row: Row, table: DeviceBedTable) -> DeviceBed:
    approved = datetime.fromisoformat(f"{table.approved_at}T00:00:00+00:00")
    return DeviceBed(
        tenant_id=tenant_id, source=row.source, group_address=row.group, port=row.port,
        device_bed_label=row.bed_label, bed_label=row.bed_label,
        bed_id=None if row.bed_id is None else uuid.UUID(row.bed_id),
        unit_id=None if row.unit_id is None else uuid.UUID(row.unit_id),
        method=row.method, verified_at=row.verified_at, verified_by=None, note=row.note,
        valid_from=row.valid_from, valid_to=row.valid_to,
        approved_by=table.approved_by, approved_at=approved)


async def _grant(db: AsyncSession, tenant_id: uuid.UUID) -> list[str]:
    group_id = (await db.execute(select(Group.id).where(
        Group.tenant_id == tenant_id, Group.slug == GRANT_GROUP, Group.is_system.is_(False)))).scalar_one_or_none()
    if group_id is None:
        return []
    done = await db.execute(pg_insert(GroupPermission).values(group_id=group_id, permission=GRANT_KEY)
                            .on_conflict_do_nothing())
    return [GRANT_GROUP] if done.rowcount == 1 else []


async def _read_back(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[int, str]:
    """`version` and `sha256` as `PostgresDeviceBeds` reports them (D19): `max(id)` of the tenant's
    rows and `rows_digest` of its current ones, built by the accessor's own `to_row`. Read from the
    database, not from the session's memory (`populate_existing`)."""
    rows = (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id, DeviceBed.valid_to.is_(None))
                             .execution_options(populate_existing=True))).scalars().all()
    version = (await db.execute(select(func.max(DeviceBed.id))
                                .where(DeviceBed.tenant_id == tenant_id))).scalar_one()
    return int(version), rows_digest(to_row(r) for r in rows)


async def import_v2(db: AsyncSession, *, tenant_slug: str, data: bytes, audit: AuditLog | None,
                    dry_run: bool = False, approved_sha: str = APPROVED_V2_SHA256) -> ImportResult:
    file_sha, table = _parse(data, approved_sha)
    file_digest = rows_digest(table.rows)
    with_bed = sum(1 for row in table.rows if row.bed_id)
    result = ImportResult(tenant_slug, file_sha, len(table.rows), with_bed, len(table.rows) - with_bed,
                          dry_run=dry_run)
    tenant = (await db.execute(select(Tenant).where(Tenant.slug == tenant_slug)
                               .with_for_update())).scalar_one_or_none()
    if tenant is None:
        await db.rollback()
        raise ImportRefused(2, f"kiracı yok: {tenant_slug}")
    tenant_id = tenant.id
    existing = (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id)
                                 .order_by(DeviceBed.id).execution_options(populate_existing=True))).scalars().all()
    if existing:
        if tuple(to_row(r) for r in existing) != table.rows:
            await db.rollback()
            raise ImportRefused(3, "bu hastanenin tablosunda dosyadakinden başka satırlar var")
        result.version, result.sha256 = await _read_back(db, tenant_id)
        result.already = True
        await db.rollback()
        return result
    try:
        await _check_beds(db, tenant_id, table.rows)
    except ImportRefused:
        await db.rollback()
        raise
    if dry_run:
        result.sha256 = file_digest
        await db.rollback()
        return result
    db.add_all([_seeded(tenant_id, row, table) for row in table.rows])
    await db.flush()
    # A-9: what the database now holds must hash as the file does — or nothing stays (the history trigger
    # of 0014 would refuse every later correction).
    _, stored_digest = await _read_back(db, tenant_id)
    if stored_digest != file_digest:
        await db.rollback()
        raise ImportRefused(2, "dosyanın satır özeti (rows digest) veritabanına yazılanınkiyle aynı değil: "
                               f"{file_digest[:12]}… ≠ {stored_digest[:12]}…; hiçbir şey yazılmadı")
    result.granted = await _grant(db, tenant_id)
    await db.commit()
    result.version, result.sha256 = await _read_back(db, tenant_id)
    if audit is not None:
        try:
            audit.append(AuditEvent(tenant_slug, "device_bed.import", "", "", {
                "file_sha256": file_sha, "file_version": table.version, "site": table.site,
                "rows": result.rows, "with_bed": result.with_bed, "without_bed": result.without_bed,
                "granted": result.granted, "version": result.version, "sha256": result.sha256,
                "actor": "import"}))
        except Exception as exc:  # noqa: BLE001 — the rows are committed (A-26): say so, do not undo
            # stderr: stdout carries the one line the deploy blocks parse (`ESLEME_ICE_AKTARIM {…}`)
            print(f"{LINE}_DENETIM_YAZILAMADI {type(exc).__name__}", file=sys.stderr)
    return result
