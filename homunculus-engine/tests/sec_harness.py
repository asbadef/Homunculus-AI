"""
Security-test harness: the real FastAPI app on an in-memory SQLite database, with two synthetic
hospitals (A and B) and users that belong to exactly one of them. SYNTHETIC DATA ONLY.

The ORM models use PostgreSQL types (UUID, JSONB). SQLAlchemy renders UUID natively on SQLite; JSONB is
mapped to JSON here so the same models run without a PostgreSQL server.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx
import pyotp
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

import homunculus.admission.models  # noqa: F401  (register tables)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
import homunculus.security_audit  # noqa: F401
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.auth.models import TenantMembership, User, UserRole
from homunculus.auth.service import hash_password, issue_mfa_verified_tokens, issue_tokens
from homunculus.db import Base, get_db
from homunculus.escalation.models import Alert, AlertTier
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType

PASSWORD = "Sentetik-Parola-1!"


@compiles(JSONB, "sqlite")
def _jsonb_as_json(_type, compiler, **kw):  # pragma: no cover - trivial
    return "JSON"


@dataclass
class Hospital:
    tenant_id: uuid.UUID
    site_id: uuid.UUID
    unit_id: uuid.UUID
    room_id: uuid.UUID
    bed_id: uuid.UUID
    patient_id: uuid.UUID
    admission_id: uuid.UUID
    alert_id: uuid.UUID
    users: dict[str, User] = field(default_factory=dict)


class World:
    def __init__(self, maker, app):
        self.maker, self.app = maker, app
        self.a: Hospital
        self.b: Hospital

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://t")

    async def add_user(self, hospital: Hospital, name: str, role: UserRole,
                       *, totp: bool = False) -> User:
        async with self.maker() as s:
            user = User(email=f"{name}@{hospital.tenant_id.hex[:6]}.example.com", full_name=name,
                        hashed_password=hash_password(PASSWORD))
            if totp:
                user.totp_secret, user.totp_enabled = pyotp.random_base32(), True
            s.add(user)
            await s.flush()
            s.add(TenantMembership(user_id=user.id, tenant_id=hospital.tenant_id, role=role))
            await s.commit()
        hospital.users[name] = user
        return user

    async def memberships(self, user: User) -> list[TenantMembership]:
        from homunculus.auth.service import get_user_memberships
        async with self.maker() as s:
            return await get_user_memberships(s, user.id)

    async def token(self, user: User, *, mfa: bool = True) -> dict[str, str]:
        """Bearer header for `user`. mfa=True mimics a completed MFA step."""
        ms = await self.memberships(user)
        tokens = (issue_mfa_verified_tokens if mfa else issue_tokens)(user, ms)
        return {"Authorization": f"Bearer {tokens['access_token']}"}

    async def _seed_hospital(self, label: str) -> Hospital:
        async with self.maker() as s:
            tenant = Tenant(name=f"Sentetik Hastane {label}", slug=f"hospital-{label.lower()}-{uuid.uuid4().hex[:6]}",
                            country_code="TR")
            s.add(tenant); await s.flush()
            site = Site(tenant_id=tenant.id, name="Ana Bina"); s.add(site); await s.flush()
            unit = Unit(site_id=site.id, name=f"YBU-{label}", unit_type=UnitType.ADULT_ICU)
            s.add(unit); await s.flush()
            room = Room(unit_id=unit.id, name="Oda 1"); s.add(room); await s.flush()
            bed = Bed(room_id=room.id, label=f"{label}-01"); s.add(bed); await s.flush()
            patient = Patient(tenant_id=tenant.id, display_name=f"Sentetik Hasta {label}",
                              date_of_birth="1970-01-01", sex="unknown",
                              his_patient_reference=f"SENT-{label}-0001")
            s.add(patient); await s.flush()
            admission = Admission(
                patient_id=patient.id, tenant_id=tenant.id, state=AdmissionState.ACTIVE,
                admission_datetime=datetime.now(timezone.utc), admitting_unit_id=unit.id, bed_id=bed.id,
                admission_diagnosis_free_text="sentetik tanı")
            s.add(admission); await s.flush()
            alert = Alert(tenant_id=tenant.id, admission_id=admission.id, patient_id=patient.id,
                          unit_id=unit.id, kind="septic_shock", tier=AlertTier.CRITICAL,
                          summary=f"{label}-01 sentetik bulgu")
            s.add(alert); await s.commit()
            return Hospital(tenant.id, site.id, unit.id, room.id, bed.id, patient.id, admission.id, alert.id)


@pytest_asyncio.fixture
async def world():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    from homunculus.api.app import create_app
    app = create_app({"sentetik-test-anahtari-0123456789": "HOSP1"}, run_escalation_loop=False)

    async def _get_db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db
    from homunculus.auth import throttle
    throttle.limiter.reset()  # sayaçlar testler arasında sızmasın
    w = World(maker, app)
    w.a = await w._seed_hospital("A")
    w.b = await w._seed_hospital("B")
    yield w
    await engine.dispose()
