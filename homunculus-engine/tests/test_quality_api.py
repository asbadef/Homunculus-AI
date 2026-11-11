# homunculus-engine/tests/test_quality_api.py
"""G4-03 «Kalite göstergeleri» (spec D4): `units_of_keys` and `GET /quality`, on Postgres (`db_session`).

The ward is tests/kabul_world.py (Reanimasiya, Neonatal; the default groups, whose `auditor` holds quality.view since
G4-03). Past admissions are written straight into the database and the audit rows straight into the app's own trail
(`app.state.audit`, in memory): a quality figure needs no live board. Synthetic everything."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from homunculus.admission import service as adm_service
from homunculus.admission import unitscope
from homunculus.api import audit as audit_module
from homunculus.admission.models import Admission, AdmissionState, Handover, HandoverStatus, Patient
from homunculus.admission.numbers import next_patient_number
from homunculus.api.audit import AuditEvent
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import Group, GroupPermission
from homunculus.quality import router as quality_router
from homunculus.quality.indicators import QUALITY_KINDS
from homunculus.quality.router import units_of_keys
from homunculus.scope.models import StaffScope
from homunculus.scope.resolver import UNKNOWN as UNKNOWN_SCOPE
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]

K1 = "202600000101"            # Reanimasiya: a protocol number
SHARED = "202600000102"        # Reanimasiya here; the other hospital uses the same number in its own unit
HIS = "S-HIS-1"                # no admission here: unplaced
OTHER = "omega-hastane"
OTHER_TEXT = "Sentetik açıklama, on beş harften uzun"
RRT_TEXT = "Sentetik gerekçe metni"
NURSE = {"role": "ayse.sentetik", "actor": "ayse.sentetik", "via": "user", "groups": ["nurse"]}


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def stay(db_session, *, tenant_id: uuid.UUID, unit_id: uuid.UUID, bed_id: uuid.UUID,
               protocol_no: str | None = None, patient: Patient | None = None) -> Patient:
    """One past admission (DISCHARGED), written straight into the database: the key → unit map reads every state. A
    new synthetic patient unless `patient` is given (a legacy patient's second stay)."""
    if patient is None:
        patient = Patient(tenant_id=tenant_id, display_name="Sentetik Hasta", date_of_birth="1970-01-01",
                          sex="female", patient_number=await next_patient_number(db_session, tenant_id))
        db_session.add(patient)
        await db_session.flush()
    db_session.add(Admission(patient_id=patient.id, tenant_id=tenant_id, state=AdmissionState.DISCHARGED,
                             admission_datetime=datetime.now(timezone.utc) - timedelta(days=2),
                             admitting_unit_id=unit_id, bed_id=bed_id,
                             admission_diagnosis_free_text="Sentetik tanı", protocol_no=protocol_no))
    await db_session.commit()
    return patient


async def here(db_session, w, unit: str, bed: str, **kw) -> Patient:
    """`stay` in the ward."""
    return await stay(db_session, tenant_id=w.tenant.id, unit_id=w.units[unit].id, bed_id=w.beds[bed].id, **kw)


async def other_hospital(db_session):
    """Sentetik Omega: its own unit, bed and administrator."""
    tenant = Tenant(name="Sentetik Omega Hastanesi", slug=OTHER, country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)
    site = Site(tenant_id=tenant.id, name="Omega bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Omega YBÜ", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.flush()
    room = Room(unit_id=unit.id, name="O-1")
    db_session.add(room)
    await db_session.flush()
    bed = Bed(room_id=room.id, label="O1")
    db_session.add(bed)
    await db_session.commit()
    admin = await add_user(db_session, username="yonetici@omega.example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
    return tenant, unit, bed, admin


async def handed(db_session, w, unit: str | None, status: HandoverStatus, *, signed_ago: float | None = None,
                 countersigned_ago: float | None = None, expired_ago: float | None = None,
                 opened_days_ago: float = 0, unit_id: uuid.UUID | None = None,
                 people: tuple[uuid.UUID, uuid.UUID] | None = None) -> Handover:
    """A handover in `status`, written straight into the database; its times in minutes (days) before now."""
    now = datetime.now(timezone.utc)
    outgoing, incoming = people or (w.users["nurse"].id, w.users["charge"].id)
    h = await adm_service.open_handover(db_session, unit_id=unit_id or w.units[unit].id, outgoing_user_id=outgoing,
                                        incoming_user_id=incoming, admission_ids=[])
    h.status = status
    if signed_ago is not None:
        h.outgoing_signed_at = now - timedelta(minutes=signed_ago)
    if countersigned_ago is not None:
        h.incoming_signed_at = now - timedelta(minutes=countersigned_ago)
    if expired_ago is not None:
        h.bridge_expires_at = now - timedelta(minutes=expired_ago)
    if opened_days_ago:
        h.bridge_opened_at = now - timedelta(days=opened_days_ago)
    await db_session.commit()
    return h


def write(app, event_type: str, key: str, kind: str, minutes_ago: float, *, tenant: str = SLUG, **payload) -> None:
    """One row of a hospital's audit trail, its event `minutes_ago` before now."""
    at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    app.state.audit.append(AuditEvent(tenant, event_type, key, kind, {"at": at, **payload}))


async def ward_with_a_trail(db_session, w, app) -> Patient:
    """Reanimasiya (K1): answered in 60 s and snoozed; another alarm cleared by itself, unanswered. Neonatal (a
    legacy H-number): escalated, an RRT call, answered in 600 s. Unplaced (a HIS-fed id): never answered, snoozed.
    The legacy patient."""
    await here(db_session, w, "rea", "1", protocol_no=K1)
    legacy = await here(db_session, w, "neo", "N1")
    k2 = legacy.patient_number
    write(app, "first_seen", K1, "news2", 120)
    write(app, "ack", K1, "news2", 119, **NURSE)
    write(app, "alert_snooze", K1, "news2", 118, **NURSE, minutes=15, reason="CLINICAL_DECISION_MADE",
          severity="moderate")
    write(app, "first_seen", K1, "spo2_low", 100)
    write(app, "alert_cleared", K1, "spo2_low", 98, reason="resolved", severity="high")
    write(app, "first_seen", k2, "news2", 90)
    write(app, "escalation", k2, "news2", 85)
    write(app, "rrt_call", k2, "news2", 84, **NURSE, reason=RRT_TEXT)
    write(app, "ack", k2, "news2", 80, **NURSE)
    write(app, "first_seen", HIS, "news2", 60)
    write(app, "alert_snooze", HIS, "news2", 59, **NURSE, minutes=10, reason="OTHER", reason_text=OTHER_TEXT,
          severity="high")
    return legacy


async def quality(client, headers: dict[str, str], days: int = 7) -> dict:
    r = await client.get("/quality", params={"days": days}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def quality_reader(db_session, w, *, unit: str | None = None, bed: str | None = None) -> dict[str, str]:
    """A member of a group the hospital made, holding `quality.view` alone (spec D2: a hospital's own «Kalite
    birimi»), granted one unit or one bed. Her Authorization header."""
    tag = uuid.uuid4().hex[:8]
    group = Group(tenant_id=w.tenant.id, slug=f"kalite-{tag}", name=f"Sentetik kalite {tag}",
                  permissions=[GroupPermission(permission="quality.view")])
    db_session.add(group)
    await db_session.flush()
    user = await add_user(db_session, username=f"kalite-{tag}@kabul.example.com", tenant_id=w.tenant.id,
                          group=group)
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id,
                              unit_id=str(w.units[unit].id) if unit else "",
                              bed_id=str(w.beds[bed].id) if bed else ""))
    await db_session.commit()
    return await bearer(db_session, user)


async def test_each_key_is_placed_in_the_unit_its_admission_was_admitted_to(ward, db_session):
    """Spec D4 §3: a protocol number; a legacy H-number (no protocol number); a legacy key admitted to two units is
    ambiguous and left out; a key with no admission is left out; a protocol-numbered admission's H-number is no
    key; another hospital's admission under the same protocol number is never matched."""
    w, _, _ = ward
    first = await here(db_session, w, "rea", "1", protocol_no=K1)
    legacy = await here(db_session, w, "neo", "N1")
    twice = await here(db_session, w, "rea", "2")
    await here(db_session, w, "neo", "N1", patient=twice)
    await here(db_session, w, "rea", "3", protocol_no=SHARED)
    tenant, unit, bed, _ = await other_hospital(db_session)
    await stay(db_session, tenant_id=tenant.id, unit_id=unit.id, bed_id=bed.id, protocol_no=SHARED)

    found = await units_of_keys(db_session, w.tenant.id, [K1, legacy.patient_number, twice.patient_number, SHARED,
                                                          first.patient_number, HIS, ""])
    assert found == {K1: w.units["rea"].id, legacy.patient_number: w.units["neo"].id, SHARED: w.units["rea"].id}
    assert await units_of_keys(db_session, tenant.id, [K1, SHARED]) == {SHARED: unit.id}


async def test_the_indicators_need_quality_view(ward):
    """Spec D2: the auditor group holds it by default, the system administrator by rule; the ward's groups do not."""
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor"):
        r = await client.get("/quality", headers=w.auth[who])
        assert r.status_code == 403, (who, r.text)
    for who in ("auditor", "admin"):
        body = await quality(client, w.auth[who])
        assert (body["days"], [u["unit_name"] for u in body["units"]], body["scoped"]) == (
            7, ["Neonatal", "Reanimasiya"], False)                     # the quiet units, with zeros (spec A3)
        assert [u["alarms"]["episodes"] for u in body["units"]] == [0, 0]


async def test_days_is_one_seven_or_thirty(ward):
    w, client, _ = ward
    for days in (1, 7, 30):
        assert (await quality(client, w.auth["admin"], days))["days"] == days
    for days in ("0", "2", "31", "abc"):
        r = await client.get("/quality", params={"days": days}, headers=w.auth["admin"])
        assert r.status_code == 422, (days, r.text)


async def test_the_permission_is_checked_before_days(ward):
    """Plan N4: without `quality.view` the answer is 403 whatever `days` says — never a 422 that tells a caller who
    may not read the page how to ask for it."""
    w, client, _ = ward
    for days in ("2", "abc"):
        r = await client.get("/quality", params={"days": days}, headers=w.auth["nurse"])
        assert r.status_code == 403, (days, r.text)


async def test_days_bounds_the_audit_read(ward, db_session):
    """The trail is read from `now − days`, by each row's own `ts`: a row written two days ago is outside «Bugün»
    (the last 24 hours) and inside «7 gün»."""
    w, client, app = ward
    await here(db_session, w, "rea", "1", protocol_no=K1)
    two_days_ago = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    with pytest.MonkeyPatch.context() as m:                             # the row's `ts`: the store stamps it
        m.setattr(audit_module, "_now_iso", lambda: two_days_ago)
        app.state.audit.append(AuditEvent(SLUG, "first_seen", K1, "news2", {"at": two_days_ago}))
    assert app.state.audit.records(tenant=SLUG, limit=1, newest=True)[0].ts == two_days_ago
    today = await quality(client, w.auth["admin"], 1)
    week = await quality(client, w.auth["admin"], 7)
    assert (today["coverage"]["episodes"], week["coverage"]["episodes"]) == (0, 1)
    assert {u["unit_name"]: u["alarms"]["episodes"] for u in week["units"]} == {"Neonatal": 0, "Reanimasiya": 1}


async def test_a_key_past_the_first_look_up_batch_is_placed(ward, db_session):
    """Keys are looked up KEYS_PER_QUERY at a time (asyncpg's parameter limit): a key in the second batch is placed
    as one in the first is."""
    w, _, _ = ward
    await here(db_session, w, "rea", "1", protocol_no=K1)
    fillers = [f"1{n:011d}" for n in range(quality_router.KEYS_PER_QUERY)]   # no admission; each sorts before K1
    assert sorted([*fillers, K1]).index(K1) == quality_router.KEYS_PER_QUERY == 2000
    assert await units_of_keys(db_session, w.tenant.id, [K1, *fillers]) == {K1: w.units["rea"].id}


async def test_a_scope_that_cannot_be_read_is_a_503_not_an_empty_reach(ward, monkeypatch):
    """As `/alarm-quality` answers (G2-A2, D13): «we could not find out» is not «you reach nothing». Answered as an
    empty reach, the page would say «Kapsamınızda birim yok» about a database blip."""
    w, client, _ = ward

    async def unreadable(db, user_id, tenant_id):
        return UNKNOWN_SCOPE

    monkeypatch.setattr(unitscope, "caller_scope", unreadable)
    r = await client.get("/quality", headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")


async def test_each_unit_counts_its_alarms_snoozes_and_rrt_calls_from_the_trail(ward, db_session):
    w, client, app = ward
    await ward_with_a_trail(db_session, w, app)
    body = await quality(client, w.auth["admin"])
    assert [u["unit_name"] for u in body["units"]] == ["Neonatal", "Reanimasiya"]
    neo, rea = body["units"]
    assert neo["unit_id"] == str(w.units["neo"].id)
    assert (neo["alarms"]["episodes"], neo["alarms"]["answered"], neo["alarms"]["escalated"],
            neo["alarms"]["median_response_sec"], neo["rrt"]["count"]) == (1, 1, 1, 600.0, 1)
    assert (rea["alarms"]["episodes"], rea["alarms"]["answered"], rea["alarms"]["unanswered"],
            rea["alarms"]["unanswered_resolved"], rea["alarms"]["median_response_sec"]) == (2, 1, 1, 1, 60.0)
    assert rea["snoozes"]["count"] == 1 and rea["snoozes"]["by_reason"]["CLINICAL_DECISION_MADE"] == 1
    assert rea["snoozes"]["by_severity"] == {"high": 0, "moderate": 1}
    assert (body["unplaced"]["alarms"]["episodes"], body["unplaced"]["snoozes"]["by_reason"]["OTHER"]) == (1, 1)
    assert body["coverage"] == {"episodes": 4, "placed": 3, "unplaced": 1}
    hospital = body["hospital"]
    assert (hospital["alarms"]["episodes"], hospital["alarms"]["answered"],
            hospital["alarms"]["median_response_sec"]) == (4, 2, 330.0)
    assert (hospital["snoozes"]["count"], hospital["rrt"]["count"]) == (2, 1)


async def test_handovers_are_counted_per_unit_by_their_state_and_times(ward, db_session):
    w, client, _ = ward
    await handed(db_session, w, "rea", HandoverStatus.COMPLETED, signed_ago=50, countersigned_ago=45)   # 300 s
    await handed(db_session, w, "rea", HandoverStatus.COMPLETED, signed_ago=40, countersigned_ago=25)   # 900 s
    await handed(db_session, w, "rea", HandoverStatus.OUTGOING_SIGNED, signed_ago=10)
    await handed(db_session, w, "rea", HandoverStatus.OPEN, expired_ago=1)          # past its bridge: expired
    await handed(db_session, w, "rea", HandoverStatus.OPEN)                         # still inside it
    await handed(db_session, w, "neo", HandoverStatus.EXPIRED)
    await handed(db_session, w, "neo", HandoverStatus.COMPLETED, signed_ago=60, countersigned_ago=59,
                 opened_days_ago=8)                                                 # before the 7 days
    body = await quality(client, w.auth["admin"])
    units = {u["unit_name"]: u["handovers"] for u in body["units"]}
    assert units["Reanimasiya"] == {"opened": 5, "countersigned": 2, "waiting": 1, "expired": 1,
                                    "median_countersign_sec": 600.0, "p90_countersign_sec": 900.0}
    assert units["Neonatal"] == {"opened": 1, "countersigned": 0, "waiting": 0, "expired": 1,
                                 "median_countersign_sec": None, "p90_countersign_sec": None}
    assert body["hospital"]["handovers"]["opened"] == 6
    assert (await quality(client, w.auth["admin"], 30))["hospital"]["handovers"]["opened"] == 7


async def test_a_scoped_reader_sees_her_units_only_and_no_unplaced(ward, db_session):
    """Spec D4: a unit grant reaches its unit; a bed grant names a bed, not its unit, and reaches none."""
    w, client, app = ward
    await ward_with_a_trail(db_session, w, app)
    await handed(db_session, w, "neo", HandoverStatus.EXPIRED)
    body = await quality(client, await quality_reader(db_session, w, unit="rea"))
    assert (body["scoped"], body["unplaced"]) == (True, None)
    assert [u["unit_name"] for u in body["units"]] == ["Reanimasiya"]
    assert body["coverage"] == {"episodes": 2, "placed": 2, "unplaced": 0}
    assert (body["hospital"]["alarms"]["episodes"], body["hospital"]["rrt"]["count"],
            body["hospital"]["handovers"]["opened"]) == (2, 0, 0)

    nothing = await quality(client, await quality_reader(db_session, w, bed="1"))
    assert (nothing["units"], nothing["unplaced"], nothing["scoped"]) == ([], None, True)
    assert nothing["coverage"] == {"episodes": 0, "placed": 0, "unplaced": 0}
    assert nothing["hospital"]["alarms"]["episodes"] == 0


async def test_every_open_unit_she_reaches_is_listed_and_a_closed_one_only_with_something(ward, db_session):
    """Spec A3: `units` is every active unit the caller reaches, a quiet one with zeros, so `units: []` means she
    reaches none. A unit closed since is listed only when something happened in it in the window."""
    w, client, app = ward
    quiet = await quality(client, await quality_reader(db_session, w, unit="neo"))
    assert ([u["unit_name"] for u in quiet["units"]], quiet["scoped"]) == (["Neonatal"], True)
    assert (quiet["units"][0]["alarms"]["episodes"], quiet["units"][0]["handovers"]["opened"]) == (0, 0)

    w.units["neo"].is_active = False                                   # Neonatal closed
    await db_session.commit()
    body = await quality(client, w.auth["admin"])
    assert [u["unit_name"] for u in body["units"]] == ["Reanimasiya"]

    legacy = await here(db_session, w, "neo", "N1")
    write(app, "first_seen", legacy.patient_number, "news2", 30)
    body = await quality(client, w.auth["admin"])
    assert [u["unit_name"] for u in body["units"]] == ["Neonatal", "Reanimasiya"]
    assert [u["alarms"]["episodes"] for u in body["units"]] == [1, 0]


async def test_a_truncated_read_says_so_and_from_when(ward, db_session, monkeypatch):
    """Capped as /alarm-quality is: the newest rows, one more to know. Then `window_from` is the oldest row kept."""
    w, client, app = ward
    await here(db_session, w, "rea", "1", protocol_no=K1)
    for minutes_ago in (50, 40, 30, 20, 10):
        write(app, "first_seen", K1, "news2", minutes_ago)
    whole = await quality(client, w.auth["admin"])
    assert whole["truncated"] is False and whole["hospital"]["alarms"]["episodes"] == 5
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    assert abs(datetime.fromisoformat(whole["window_from"]) - week_ago) < timedelta(minutes=1)

    monkeypatch.setattr(quality_router, "READ_CAP", 3)
    cut = await quality(client, w.auth["admin"])
    assert cut["truncated"] is True and cut["hospital"]["alarms"]["episodes"] == 3
    kept = app.state.audit.records(tenant=SLUG, limit=3, newest=True, event_types=QUALITY_KINDS)
    assert cut["window_from"] == kept[0].ts


async def test_alert_rows_take_no_place_under_the_cap(ward, db_session, monkeypatch):
    """Spec A2: the engine writes an `alert` row for every active alert on every ingest. Read, they filled the cap
    within hours, cut «7 gün» to the last hours and dropped episodes whose `first_seen` fell past the cut (the
    review's probe: cap 3, one answered episode and three `alert` rows → coverage 0). They are not read."""
    w, client, app = ward
    await here(db_session, w, "rea", "1", protocol_no=K1)
    write(app, "first_seen", K1, "news2", 30)
    write(app, "ack", K1, "news2", 29, **NURSE)
    for minutes_ago in (28, 27, 26, 25, 24):
        write(app, "alert", K1, "news2", minutes_ago)
    monkeypatch.setattr(quality_router, "READ_CAP", 2)
    body = await quality(client, w.auth["admin"])
    assert (body["truncated"], body["coverage"]) == (False, {"episodes": 1, "placed": 1, "unplaced": 0})
    assert (body["hospital"]["alarms"]["answered"], body["hospital"]["alarms"]["median_response_sec"]) == (1, 60.0)


async def test_the_answer_names_no_patient_key_person_or_free_text(ward, db_session):
    w, client, app = ward
    legacy = await ward_with_a_trail(db_session, w, app)
    await handed(db_session, w, "rea", HandoverStatus.COMPLETED, signed_ago=5, countersigned_ago=1)
    r = await client.get("/quality", headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    for told in (K1, legacy.patient_number, HIS, "ayse.sentetik", "Sentetik Hasta", OTHER_TEXT, RRT_TEXT,
                 str(w.users["nurse"].id), str(w.users["charge"].id), "nurse@kabul", "charge@kabul"):
        assert told not in r.text, told


async def test_another_hospitals_admissions_trail_and_handovers_are_not_counted(ward, db_session):
    """Tenant isolation: the other hospital admitted a patient under the same protocol number in its own unit and
    handed one over; ours still places the key in Reanimasiya, and neither answer counts the other's rows."""
    w, client, app = ward
    await here(db_session, w, "rea", "1", protocol_no=SHARED)
    tenant, unit, bed, their_admin = await other_hospital(db_session)
    await stay(db_session, tenant_id=tenant.id, unit_id=unit.id, bed_id=bed.id, protocol_no=SHARED)
    await handed(db_session, w, None, HandoverStatus.EXPIRED, unit_id=unit.id, people=(their_admin.id, their_admin.id))
    write(app, "first_seen", SHARED, "news2", 30)
    write(app, "first_seen", SHARED, "news2", 20, tenant=OTHER)

    ours = await quality(client, w.auth["admin"])
    assert [u["unit_name"] for u in ours["units"]] == ["Neonatal", "Reanimasiya"]      # Neonatal: quiet, zeros
    assert [u["alarms"]["episodes"] for u in ours["units"]] == [0, 1]
    assert ours["coverage"] == {"episodes": 1, "placed": 1, "unplaced": 0}
    assert ours["hospital"]["handovers"]["opened"] == 0
    theirs = await quality(client, await bearer(db_session, their_admin))
    assert [u["unit_name"] for u in theirs["units"]] == ["Omega YBÜ"]
    assert theirs["coverage"] == {"episodes": 1, "placed": 1, "unplaced": 0}
    assert theirs["hospital"]["handovers"]["opened"] == 1
