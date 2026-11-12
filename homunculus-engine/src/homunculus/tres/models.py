# homunculus-engine/src/homunculus/tres/models.py
"""`tres_settings`, `tres_deliveries`, `tres_department_map` and `tres_practitioner_identity`
(migration 0020; TRƏS-01 spec D3, D6, D16, D17).

`tres_settings` — one row per tenant, none until the administrator saves the tab (no row reads as
the defaults: mode `off`, environment `test`):
* `mode`         the tenant's lock (D2 (a)): `off` · `validate` (the platform checks, stores
                 nothing) · `send`. The install's lock is `TRES_EGRESS` (egress.py).
* `environment`  which of the two accounts is in use: `test` (the sandbox) or `live`.
* `test_*`, `live_*`  each environment's account: the base URL (https only), the username, the
                 password, the provider id the session is opened for, and the hospital's
                 Organization id and name (an Encounter's `serviceProvider`, a Composition's
                 `custodian`). THE PASSWORD IS THE FIRST SECRET KEPT IN A TABLE rather than in the
                 environment: an `EncryptedString` (Fernet, the PHI key), and no route ever returns
                 it — only whether one is set (router.py).
* `enabled_types`  the resource types this tenant sends, as the ledger's keys (RESOURCE_TYPES).
* `settle_hours`   how long after a discharge a stay waits before it is sent (D9), 0–168.
* `session_refused_at`  when the platform last REFUSED this tenant's login (its token route
                 answered a 4xx other than 408/429): the rounds pass the tenant over while it is
                 set, so a wrong password costs one failed login, not one every five minutes
                 (review I3). Cleared by a save that changes something, or a successful
                 connection test. Not a setting: writing it never touches `updated_at`.
* `send_from`    the cut-off of the automatic rounds (open item O15, plan F1 — PROPOSED, AWAITING THE
                 OWNER'S WORD): only a stay discharged at or after it is sent without a hand.
                 Set to the moment of the save that first chooses `send`; the tab can move it.
                 None until then (no cut-off: a `validate` round reaches back as far as its window).
* `retried_at`   when the nightly retry of `stuck` rows last ran for this tenant (D21, O21): it runs
                 at the first round after 04:00 in the tenant's zone. Not a setting either: written
                 by its own statement, never touching `updated_at`.

`tres_deliveries` — the ledger (D6): one row per (tenant, environment, resource type, local id).
A sandbox success never counts for live: the environment is in the key. NO REQUEST OR RESPONSE
BODY IS STORED — a body is PHI and can be rebuilt on demand; `payload_digest` (a keyed digest,
`crypto.phi_digest`) is what tells a changed resource from an unchanged one (D7). `last_error` is
the platform's own message, which may echo a value, so it is encrypted too. `reason` is a
catalogue code for a skip (`fin_missing`, `unit_unmapped`…), never free text.

`resource_type` is the LEDGER's key (`vital`, `lab`, `patient`…), not the FHIR type: two of them
are both `Observation` on the platform. `admission_id` is the stay's LAST admission (its chain's
newest row: where its protocol number is held, plan F1).

`tres_department_map` — the tab's map of a unit to a `hospital-departments` code and display
(D17): an Encounter's `serviceType`. One row per unit; a unit with no row is unmapped, and its
stays' Encounters are skipped (`unit_unmapped`), never sent under a default department.

`tres_practitioner_identity` — what the platform needs of a practitioner and `users` does not hold
(D16): the FİN (encrypted at rest, as a patient's; write-only at the door), the family and the
given name. One row per user and tenant. `users` is not touched."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, String, UniqueConstraint,
    func, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.admission.models import PHI_COLUMN_LENGTH
from homunculus.crypto import EncryptedString
from homunculus.db import Base, JSON_COLUMN
from homunculus.tres.client import TresAccount

#: The resource types a tenant switches on or off, in the order of the package (spec D1, D8).
RESOURCE_TYPES: tuple[str, ...] = (
    "patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", "composition")
MODES: tuple[str, ...] = ("off", "validate", "send")
ENVIRONMENTS: tuple[str, ...] = ("test", "live")
STATUSES: tuple[str, ...] = ("pending", "sent", "validated", "failed", "skipped", "stuck", "deleted")
OPERATIONS: tuple[str, ...] = ("create", "update", "validate", "delete")
#: The parts of one environment's account, as the columns are named after the `test_` / `live_` prefix.
ACCOUNT_FIELDS: tuple[str, ...] = (
    "base_url", "username", "password", "provider_id", "organization_id", "organization_name")
#: The four a session cannot be opened without.
SESSION_FIELDS: tuple[str, ...] = ("base_url", "username", "password", "provider_id")
DEFAULT_SETTLE_HOURS = 24
#: `enabled_types`' default as the column's own: every type on.
ALL_TYPES_JSON = json.dumps(list(RESOURCE_TYPES))


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TresSettings(Base):
    __tablename__ = "tres_settings"
    __table_args__ = (
        CheckConstraint("mode IN ('off', 'validate', 'send')", name="ck_tres_settings_mode"),
        CheckConstraint("environment IN ('test', 'live')", name="ck_tres_settings_environment"),
        CheckConstraint("settle_hours BETWEEN 0 AND 168", name="ck_tres_settings_settle"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="off",
                                      server_default=text("'off'"))
    environment: Mapped[str] = mapped_column(String(8), nullable=False, default="test",
                                             server_default=text("'test'"))

    test_base_url: Mapped[str | None] = mapped_column(String(200), nullable=True)
    test_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    test_password: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    test_provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    test_organization_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    test_organization_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    live_base_url: Mapped[str | None] = mapped_column(String(200), nullable=True)
    live_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    live_password: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    live_provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    live_organization_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    live_organization_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    enabled_types: Mapped[list] = mapped_column(
        JSON_COLUMN, nullable=False, default=lambda: list(RESOURCE_TYPES),
        server_default=text(f"'{ALL_TYPES_JSON}'"))
    settle_hours: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=DEFAULT_SETTLE_HOURS,
        server_default=text(str(DEFAULT_SETTLE_HOURS)))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    session_refused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    send_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retried_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TresDelivery(Base):
    __tablename__ = "tres_deliveries"
    __table_args__ = (
        UniqueConstraint("tenant_id", "environment", "resource_type", "local_id",
                         name="uq_tres_deliveries_key"),
        Index("ix_tres_deliveries_tenant_status", "tenant_id", "status"),
        # A stay's rows are read by its admission (the tab, the preview), and deleting an
        # admission SETs NULL here: neither should scan the whole ledger.
        Index("ix_tres_deliveries_admission_id", "admission_id"),
        CheckConstraint("environment IN ('test', 'live')", name="ck_tres_deliveries_environment"),
        CheckConstraint("status IN ('pending', 'sent', 'validated', 'failed', 'skipped', 'stuck', "
                        "'deleted')", name="ck_tres_deliveries_status"),
        CheckConstraint("operation IS NULL OR operation IN ('create', 'update', 'validate', 'delete')",
                        name="ck_tres_deliveries_operation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    environment: Mapped[str] = mapped_column(String(8), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    local_id: Mapped[str] = mapped_column(String(96), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending",
                                        server_default=text("'pending'"))
    operation: Mapped[str | None] = mapped_column(String(16), nullable=True)
    remote_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(48), nullable=True)
    last_error: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    admission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admissions.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now, server_default=func.now())


class TresDepartmentMap(Base):
    __tablename__ = "tres_department_map"
    __table_args__ = (Index("ix_tres_department_map_tenant_id", "tenant_id"),)

    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    display: Mapped[str] = mapped_column(String(200), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class TresPractitionerIdentity(Base):
    __tablename__ = "tres_practitioner_identity"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    fin: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    family_name: Mapped[str] = mapped_column(String(100), nullable=False)
    given_name: Mapped[str] = mapped_column(String(100), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


def account_of(settings: TresSettings, environment: str | None = None) -> TresAccount | None:
    """The account a session is opened with in `environment` (the row's own by default), or None
    while any of its four parts is missing: such a tenant is not worked, and its connection test
    answers `tres_account_incomplete`."""
    prefix = environment or settings.environment
    parts = [getattr(settings, f"{prefix}_{name}") for name in SESSION_FIELDS]
    if not all(isinstance(part, str) and part.strip() for part in parts):
        return None
    return TresAccount(*parts)
