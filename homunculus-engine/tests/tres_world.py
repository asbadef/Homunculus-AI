# homunculus-engine/tests/tres_world.py
"""Synthetic stays for the national e-health feed's tests (TRƏS-01, plan F1): the kabul ward
(tests/kabul_world.py) and what the feed reads of it — a discharged admission of a synthetic person
with a FİN, the attending's identity on the tab, the unit's department, the tenant's settings
pointing at the stand-in (tests/fake_tres.py), and the bedside values as the app's audit trail
holds them (`chart` rows under the stay's board key). Every name, number and FİN here is made up."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.api.audit import AuditEvent
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from homunculus.tres.models import TresDelivery, TresDepartmentMap, TresPractitionerIdentity, TresSettings
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, Ward

#: Asia/Baku as a fixed +04:00 (no DST since 2016): the tests need no time zone database.
BAKU = timezone(timedelta(hours=4), "Asia/Baku")
ADMITTED = datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc)
DISCHARGED = datetime(2026, 11, 6, 11, 0, tzinfo=timezone.utc)
#: A day and an hour after the discharge: past the default 24-hour wait (D9).
NOW = DISCHARGED + timedelta(hours=25)
ORGANIZATION = "ORG-0001"


async def add_stay(db: AsyncSession, ward: Ward, *, protocol_no: str | None = "202600000101",
                   number: str = "H2600101", fin: str | None = "AB12C3D",
                   state: AdmissionState = AdmissionState.DISCHARGED, admitted_at: datetime = ADMITTED,
                   discharged_at: datetime | None = DISCHARGED, bed: str = "1", unit: str = "rea",
                   attending: str | None = "doctor", weight_kg: float | None = 72.5,
                   source: Admission | None = None, patient: Patient | None = None,
                   phone: str | None = "050 123 45 67") -> Admission:
    """One admission of a synthetic person (a new patient row unless `patient` is given — the
    admission form makes one per admission, so two stays of one FİN are two rows); with `source`,
    the arriving row of a transfer from it."""
    if patient is None:
        patient = Patient(tenant_id=ward.tenant.id, patient_number=number, display_name="Sentetikova Leyla",
                          date_of_birth="1980-01-31", sex="female", father_name="Sentetik", national_id=fin,
                          phone=phone)
        db.add(patient)
        await db.flush()
    admission = Admission(
        patient_id=patient.id, tenant_id=ward.tenant.id, state=state, admission_datetime=admitted_at,
        admitting_unit_id=ward.units[unit].id, bed_id=ward.beds[bed].id,
        attending_physician_id=ward.users[attending].id if attending else None,
        admission_diagnosis_free_text="Sentetik tanı", protocol_no=protocol_no, weight_kg=weight_kg,
        discharge_at=discharged_at if state == AdmissionState.DISCHARGED else None,
        source_admission_id=source.id if source is not None else None)
    db.add(admission)
    await db.commit()
    return admission


async def map_unit(db: AsyncSession, ward: Ward, unit: str = "rea", code: str = "RE-01",
                   display: str = "Reanimasiya") -> None:
    db.add(TresDepartmentMap(unit_id=ward.units[unit].id, tenant_id=ward.tenant.id, code=code, display=display))
    await db.commit()


async def identify(db: AsyncSession, ward: Ward, user: str = "doctor", fin: str | None = "ZZ99YY8") -> None:
    db.add(TresPractitionerIdentity(tenant_id=ward.tenant.id, user_id=ward.users[user].id, fin=fin,
                                    family_name="Sentetikov", given_name="Elçin"))
    await db.commit()


async def feed_settings(db: AsyncSession, ward: Ward, fake: FakeTres, *, mode: str = "send",
                        **over) -> TresSettings:
    """The tenant's settings, its test account the stand-in's."""
    account = fake.account
    settings = TresSettings(tenant_id=ward.tenant.id, mode=mode, environment="test",
                            test_base_url=account.base_url, test_username=account.username,
                            test_password=account.password, test_provider_id=account.provider_id,
                            test_organization_id=ORGANIZATION, **over)
    db.add(settings)
    await db.commit()
    return settings


async def other_tenants_stay(db: AsyncSession, *, discharged_at: datetime = DISCHARGED) -> Admission:
    """Another hospital's discharged stay of a synthetic person, with a `stuck` ledger row of its own:
    what the first tenant's rounds and reads must never reach (batch-3 review, A10)."""
    tenant = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db.add(tenant)
    await db.flush()
    site = Site(tenant_id=tenant.id, name="Başqa bina")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Otaq 9")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="9")
    db.add(bed)
    patient = Patient(tenant_id=tenant.id, patient_number="H2699901", display_name="Sentetikov Orxan",
                      date_of_birth="1975-05-05", sex="male", father_name="Sentetik", national_id="ZZ11YY2")
    db.add(patient)
    await db.flush()
    admission = Admission(patient_id=patient.id, tenant_id=tenant.id, state=AdmissionState.DISCHARGED,
                          admission_datetime=discharged_at - timedelta(days=3), admitting_unit_id=unit.id,
                          bed_id=bed.id, admission_diagnosis_free_text="Sentetik tanı", protocol_no="202699900001",
                          discharge_at=discharged_at)
    db.add(admission)
    await db.flush()
    db.add(TresDelivery(tenant_id=tenant.id, environment="test", resource_type="patient", local_id="hmn-p-baska.",
                        status="stuck", attempts=5, admission_id=admission.id))
    await db.commit()
    return admission


def chart(audit, key: str, slug: str, value: float, unit: str, at: datetime) -> int:
    """A bedside value as the door writes it (api/clinical.py): a `chart` row under the board key."""
    return audit.append(AuditEvent(SLUG, "chart", key, slug, {"value": value, "unit": unit,
                                                               "obs_ts": at.isoformat(),
                                                               "charted_by": "hemsire@kabul.example.com"})).id
