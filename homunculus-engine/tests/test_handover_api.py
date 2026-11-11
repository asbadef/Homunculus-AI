# homunculus-engine/tests/test_handover_api.py
"""The shift handover as G2-B3b makes it (spec D3-D8): one patient per handover, the outgoing
person's D-Ö-D-Ö note and signature, the receiver she chose countersigning.

* D3: the critical gate reads the LIVE board (`BoardLink.open_critical`: firing or latched, nobody
  acknowledged), never the Postgres escalation table, which nothing on the ward writes;
* D4: an admission is handed over only while open and only from the caller's units;
* D5: the structured note, its bounds, and a legacy plain-text note read back;
* D6: the system summary sealed at the outgoing signature, with no name in it;
* D7: my handovers (incoming / outgoing, by person, 24 h for the closed ones) and my colleagues;
* D8: one audit row per step, the note's text in none.

Postgres (`db_session`). The ward is tests/kabul_world.py; everything synthetic."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import func, select, update

from homunculus.admission import service as adm_service
from homunculus.admission.models import Handover, HandoverStatus
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import Group, GroupPermission, TenantMembership, User
from homunculus.scope.models import StaffScope
from homunculus.escalation import service as esc_service
from homunculus.escalation.models import AlertTier
from homunculus.tenant.models import Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.kabul_world import BOARD, SLUG, build_ward, ward_client
from tests.signed_in import add_user, bearer
from tests.test_care_team_service import add_physician

pytestmark = [requires_db]

NAME = "Sentetik Hasta"
NOTE = {"situation": "Sentetik durum: hemodinami stabil",
        "background": "Sentetik öykü: postop 2. gün",
        "assessment": "Sentetik değerlendirme: laktat düşüyor",
        "recommendation": "Sentetik öneri: 2 saatte bir laktat"}


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def form(w, bed: str = "1", unit: str = "rea", weight: float | None = 50) -> dict:
    name = NAME if bed == "1" else f"{NAME} {bed}"
    return {"patient": {"display_name": name, "date_of_birth": "1970-05-05",
                        "sex": "male", "consent": "UNCONSCIOUS_LATER"},
            "note": {"admitting_unit_id": str(w.units[unit].id), "bed_id": str(w.beds[bed].id),
                     "admission_type": "MEDICAL", "admission_diagnosis_free_text": "Sentetik tanı",
                     "no_known_allergy": True, "weight_kg": weight}}


async def admit(w, client, bed: str = "1", unit: str = "rea", who: str = "nurse",
                weight: float | None = 50) -> dict:
    r = await client.post("/admissions", json=form(w, bed, unit, weight), headers=w.auth[who])
    assert r.status_code == 201, r.text
    return r.json()


async def signed(w, client, bed: str = "1", unit: str = "rea", who: str = "nurse",
                 signer: str = "doctor", weight: float | None = 50) -> dict:
    admission = await admit(w, client, bed, unit, who, weight)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth[signer])
    assert r.status_code == 200, r.text
    return admission


def body(w, admission: dict, to: str = "charge", unit: str = "rea") -> dict:
    return {"unit_id": str(w.units[unit].id), "incoming_user_id": str(w.users[to].id),
            "admission_ids": [admission["id"]]}


async def opened(w, client, admission: dict, who: str = "nurse", to: str = "charge") -> dict:
    r = await client.post("/handovers", json=body(w, admission, to), headers=w.auth[who])
    assert r.status_code == 201, r.text
    return r.json()


async def sign(w, client, handover: dict, who: str = "nurse", payload: dict | None = None):
    return await client.post(f"/handovers/{handover['id']}/sign-outgoing",
                             json={"note": NOTE} if payload is None else payload,
                             headers=w.auth[who])


async def handed(w, client, admission: dict, who: str = "nurse", to: str = "charge") -> dict:
    """Opened and signed by the outgoing person."""
    handover = await opened(w, client, admission, who, to)
    r = await sign(w, client, handover, who)
    assert r.status_code == 200, r.text
    return handover


async def box(w, client, which: str, who: str) -> list[dict]:
    r = await client.get("/handovers", params={"box": which}, headers=w.auth[who])
    assert r.status_code == 200, r.text
    return r.json()


async def septic_shock(client, number: str):
    """Charted as /clinical takes it: with the admission's 50 kg, septic shock — critical."""
    for entries in ([{"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                     {"code": "norepinephrine_rate", "value": 0.08}],
                    [{"code": "crystalloid_bolus_ml", "value": 1600}]):
        r = await client.post(f"/clinical/{number}", json={"entries": entries}, headers=BOARD)
        assert r.status_code == 200, r.text
    assert "septic_shock" in r.json()["alerts"]


async def acknowledged(client, number: str) -> None:
    ack = await client.post("/ack", json={"patient_id": number, "kind": "septic_shock"},
                            headers=BOARD)
    assert ack.status_code == 200, ack.text


async def card_alert(client, number: str, kind: str) -> dict | None:
    cards = (await client.get("/patients", headers=BOARD)).json()["patients"]
    return next((a for c in cards if c["patient_id"] == number
                 for a in c["alerts"] if a["kind"] == kind), None)


def audited(app, event: str) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=500) if r.event_type == event]


def refused(r, status: int, code: str) -> None:
    assert r.status_code == status, r.text
    assert r.json()["detail"]["code"] == code, r.text


async def handovers_in(db_session) -> int:
    return (await db_session.execute(select(func.count(Handover.id)))).scalar_one()


async def nurse_group(db_session, w) -> Group:
    """The ward's default «nurse» group (build_ward seeded it)."""
    return (await db_session.execute(select(Group).where(
        Group.tenant_id == w.tenant.id, Group.slug == "nurse"))).scalar_one()


# ---------------------------------------------------------------- D3: the gate on the live board
async def test_an_unacknowledged_critical_on_the_board_blocks_the_signature_until_acked(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    await septic_shock(client, admission["board_key"])
    handover = await opened(w, client, admission)

    refused(await sign(w, client, handover), 409, "critical_alarm_open")

    await acknowledged(client, admission["board_key"])
    r = await sign(w, client, handover)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "OUTGOING_SIGNED"


async def test_a_latched_critical_nobody_acknowledged_blocks_too(ward):
    """G2-A1: a critical alert whose rule stopped firing stays on the board, latched, until a
    clinician answers it — it holds the handover as a firing one does."""
    w, client, _ = ward
    admission = await signed(w, client)
    number = admission["board_key"]
    await septic_shock(client, number)
    r = await client.post(f"/clinical/{number}",
                          json={"entries": [{"code": "lactate", "value": 1.5}]}, headers=BOARD)
    assert r.status_code == 200, r.text
    shock = await card_alert(client, number, "septic_shock")
    assert shock["resolved_at"] is not None and shock["acknowledged"] is False     # latched
    handover = await opened(w, client, admission)

    refused(await sign(w, client, handover), 409, "critical_alarm_open")


async def test_a_postgres_alert_row_alone_does_not_block(ward, db_session):
    """The escalation table is not what the clinician sees; a CRITICAL row there for the admission,
    with a quiet board, holds nothing (D3)."""
    w, client, _ = ward
    admission = await signed(w, client)
    await esc_service.create_alert(
        db_session, tenant_id=w.tenant.id, admission_id=uuid.UUID(admission["id"]),
        unit_id=w.units["rea"].id, kind="septic_shock", tier=AlertTier.CRITICAL,
        summary="sentetik")
    await db_session.commit()
    handover = await opened(w, client, admission)

    r = await sign(w, client, handover)
    assert r.status_code == 200, r.text


async def test_a_critical_on_another_patient_does_not_hold_this_handover(ward):
    """D1: an unacknowledged critical alarm stops that patient's handover only."""
    w, client, _ = ward
    mine, theirs = await signed(w, client), await signed(w, client, "2")
    await septic_shock(client, theirs["board_key"])
    handover = await opened(w, client, mine)

    r = await sign(w, client, handover)
    assert r.status_code == 200, r.text


async def test_a_handover_of_two_patients_sums_their_criticals_and_seals_both(ward):
    """The API still takes a list (D4): the gate sums the patients' open criticals, the summary is
    sealed per patient under `patients`, and every audit row names both."""
    w, client, app = ward
    one, two = await signed(w, client), await signed(w, client, "2")
    keys = [one["board_key"], two["board_key"]]
    for key in keys:
        await septic_shock(client, key)
    r = await client.post("/handovers", headers=w.auth["nurse"],
                          json={**body(w, one), "admission_ids": [one["id"], two["id"]]})
    assert r.status_code == 201, r.text
    handover = r.json()

    r = await sign(w, client, handover)
    refused(r, 409, "critical_alarm_open")
    assert "2 unacknowledged" in r.json()["detail"]["message"]
    await acknowledged(client, keys[0])
    r = await sign(w, client, handover)
    refused(r, 409, "critical_alarm_open")
    assert "1 unacknowledged" in r.json()["detail"]["message"]
    await acknowledged(client, keys[1])
    r = await sign(w, client, handover)
    assert r.status_code == 200, r.text

    (row,) = await box(w, client, "incoming", "charge")
    assert [p["board_key"] for p in row["patients"]] == keys
    assert set(row["summary"]) == {"patients"}
    assert set(row["summary"]["patients"]) == set(keys)
    for summary in row["summary"]["patients"].values():
        assert set(summary) == {"risk", "news2", "latest", "on_pressor", "open_alerts",
                                "captured_at"}
        assert {"kind": "septic_shock", "severity": "critical", "acknowledged": True} \
            in summary["open_alerts"]
    (opened_row,) = audited(app, "handover.open")
    assert opened_row.patient_id == keys[0]
    assert opened_row.payload["patients"] == keys
    assert opened_row.payload["admission_ids"] == [one["id"], two["id"]]
    (signed_row,) = audited(app, "handover.sign_outgoing")
    assert signed_row.payload["patients"] == keys


# ---------------------------------------------------------------- D2: the receiver, at the server
async def test_the_caller_is_not_her_own_receiver(ward, db_session):
    w, client, _ = ward
    admission = await signed(w, client)
    r = await client.post("/handovers", json=body(w, admission, to="nurse"),
                          headers=w.auth["nurse"])
    refused(r, 422, "field_invalid:incoming_user_id")
    assert await handovers_in(db_session) == 0


async def test_the_receiver_holds_handover_sign(ward, db_session):
    """D2: the receiver is one of the caller's colleagues (`GET /handovers/colleagues`) — the
    auditor, a member without `handover.sign`, is not."""
    w, client, _ = ward
    admission = await signed(w, client)
    r = await client.post("/handovers", json=body(w, admission, to="auditor"),
                          headers=w.auth["nurse"])
    refused(r, 422, "field_invalid:incoming_user_id")
    assert await handovers_in(db_session) == 0


async def test_the_administrator_is_a_receiver_by_the_system_rule(ward):
    w, client, _ = ward
    await opened(w, client, await signed(w, client), to="admin")


async def test_a_handover_names_at_least_one_admission(ward, db_session):
    w, client, _ = ward
    await signed(w, client)
    empty = {"unit_id": str(w.units["rea"].id), "incoming_user_id": str(w.users["charge"].id)}
    for sent in ({**empty, "admission_ids": []}, empty):
        r = await client.post("/handovers", json=sent, headers=w.auth["nurse"])
        assert r.status_code == 422, (sent, r.text)
    assert await handovers_in(db_session) == 0


# ---------------------------------------------------------------- D4: checks on open
async def test_a_closed_or_draft_admission_is_not_handed_over(ward, db_session):
    w, client, _ = ward
    draft = await admit(w, client, "2")
    refused(await client.post("/handovers", json=body(w, draft), headers=w.auth["nurse"]),
            409, "invalid_transition")

    gone = await signed(w, client)
    r = await client.post(f"/admissions/{gone['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{gone['id']}/discharge/confirm", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    refused(await client.post("/handovers", json=body(w, gone), headers=w.auth["nurse"]),
            409, "invalid_transition")
    assert (await db_session.execute(select(func.count(Handover.id)))).scalar_one() == 0


async def test_a_patient_outside_the_callers_units_is_out_of_scope(ward, db_session):
    w, client, _ = ward
    # G2-B1c (T1): the signer becomes the attending, and the administrator is no physician.
    await add_physician(db_session, w, "neodoc", group="attending", unit="neo")
    neo = await signed(w, client, "N1", "neo", who="nurse_b", signer="neodoc")
    r = await client.post("/handovers", json=body(w, neo, unit="neo"), headers=w.auth["nurse"])
    refused(r, 403, "out_of_scope")
    assert (await db_session.execute(select(func.count(Handover.id)))).scalar_one() == 0


async def test_the_pending_states_are_handed_over(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    await opened(w, client, admission)                      # PENDING_DISCHARGE: still here


# ---------------------------------------------------------------- D5: the note
async def test_the_note_is_stored_and_read_back_by_the_receiver_in_its_shape(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    handover = await handed(w, client, admission)

    (row,) = await box(w, client, "incoming", "charge")
    assert row["id"] == handover["id"]
    assert row["note"] == NOTE


async def test_a_note_part_over_2000_characters_is_a_422(ward):
    w, client, _ = ward
    handover = await opened(w, client, await signed(w, client))
    r = await sign(w, client, handover, payload={"note": {**NOTE, "assessment": "x" * 2001}})
    assert r.status_code == 422, r.text
    r = await sign(w, client, handover, payload={"note": {**NOTE, "assessment": "x" * 2000}})
    assert r.status_code == 200, r.text


async def test_a_note_with_nothing_written_is_a_422(ward):
    w, client, _ = ward
    handover = await opened(w, client, await signed(w, client))
    for note in ({}, {"situation": "", "background": None},
                 {"situation": "  ab  ", "background": " \n ", "assessment": "x",
                  "recommendation": "yz"}):
        r = await sign(w, client, handover, payload={"note": note})
        assert r.status_code == 422, (note, r.text)
    r = await sign(w, client, handover, payload={"note": {"recommendation": " abc "}})
    assert r.status_code == 200, r.text


async def test_a_legacy_plain_text_note_reads_back_as_its_situation(ward):
    w, client, _ = ward
    handover = await opened(w, client, await signed(w, client))
    r = await sign(w, client, handover, payload={"narrative_note": "Sentetik eski not"})
    assert r.status_code == 200, r.text

    (row,) = await box(w, client, "outgoing", "nurse")
    assert row["note"] == {"situation": "Sentetik eski not", "background": None,
                           "assessment": None, "recommendation": None}


async def test_the_note_wins_over_the_legacy_text_when_both_come(ward):
    w, client, _ = ward
    handover = await opened(w, client, await signed(w, client))
    r = await sign(w, client, handover, payload={"note": NOTE, "narrative_note": "Sentetik eski"})
    assert r.status_code == 200, r.text

    (row,) = await box(w, client, "outgoing", "nurse")
    assert row["note"] == NOTE


async def test_the_legacy_text_is_bounded_clean_and_the_body_has_no_stray_field(ward):
    """The legacy text is held to 8000 characters and to the form's texts' rule (no control
    character but tab and the line breaks: a NUL would be a 500 at Postgres); a field the body
    does not have — `notes` for `note` — is a 422, never a signature with no note."""
    w, client, _ = ward
    handover = await opened(w, client, await signed(w, client))
    r = await sign(w, client, handover, payload={"narrative_note": "x" * 8001})
    assert r.status_code == 422, r.text
    refused(await sign(w, client, handover, payload={"narrative_note": "Sentetik\x00not"}),
            422, "field_invalid:narrative_note")
    r = await sign(w, client, handover, payload={"notes": NOTE})
    assert r.status_code == 422, r.text
    r = await sign(w, client, handover, payload={"narrative_note": "x" * 8000})
    assert r.status_code == 200, r.text


async def test_a_legacy_note_no_json_reader_can_hold_never_breaks_the_box(ward, db_session):
    """Whatever an older client stored in `narrative_note`, the box reads it back as text: a value
    nested past the JSON reader's recursion limit is a legacy note, not a 500 for every row."""
    w, client, _ = ward
    handover = await handed(w, client, await signed(w, client))
    deep = "[" * 20000 + "]" * 20000
    await db_session.execute(update(Handover).where(Handover.id == uuid.UUID(handover["id"]))
                             .values(narrative_note=deep))
    await db_session.commit()

    (row,) = await box(w, client, "outgoing", "nurse")
    assert row["note"]["situation"] == deep


# ---------------------------------------------------------------- D6: the summary
async def test_the_summary_is_sealed_at_the_signature_and_holds_no_name(ward, db_session):
    w, client, _ = ward
    admission = await signed(w, client)
    number = admission["board_key"]
    await septic_shock(client, number)
    await acknowledged(client, number)
    handover = await handed(w, client, admission)

    (row,) = await box(w, client, "incoming", "charge")
    summary = row["summary"]
    assert set(summary) == {"risk", "news2", "latest", "on_pressor", "open_alerts", "captured_at"}
    assert set(summary["news2"]) == {"total", "partial"}
    assert set(summary["latest"]) == {"heart_rate", "map", "spo2", "resp_rate", "temperature"}
    assert summary["on_pressor"] is True
    assert {"kind": "septic_shock", "severity": "critical", "acknowledged": True} \
        in summary["open_alerts"]
    assert summary["risk"] == "critical"
    datetime.fromisoformat(summary["captured_at"])
    text = json.dumps(summary, ensure_ascii=False)
    assert NAME not in text and "@kabul.example.com" not in text

    stored = (await db_session.execute(
        select(Handover.auto_populated_summary)
        .where(Handover.id == uuid.UUID(handover["id"])))).scalar_one()
    assert stored == summary


async def test_a_patient_never_measured_gets_the_moment_only(ward):
    w, client, _ = ward
    admission = await signed(w, client, weight=None)
    await handed(w, client, admission)

    (row,) = await box(w, client, "outgoing", "nurse")
    assert set(row["summary"]) == {"captured_at"}


# ---------------------------------------------------------------- D7: the boxes
async def test_each_box_holds_the_callers_own_handovers_only(ward):
    w, client, _ = ward
    one = await handed(w, client, await signed(w, client), who="nurse", to="charge")
    two = await handed(w, client, await signed(w, client, "2"), who="doctor", to="nurse")

    assert [r["id"] for r in await box(w, client, "incoming", "charge")] == [one["id"]]
    assert [r["id"] for r in await box(w, client, "outgoing", "nurse")] == [one["id"]]
    assert [r["id"] for r in await box(w, client, "incoming", "nurse")] == [two["id"]]
    assert [r["id"] for r in await box(w, client, "outgoing", "doctor")] == [two["id"]]
    assert await box(w, client, "outgoing", "charge") == []
    assert await box(w, client, "incoming", "admin") == []
    assert await box(w, client, "outgoing", "admin") == []


async def test_a_row_names_its_people_and_its_patient(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    handover = await handed(w, client, admission)

    (row,) = await box(w, client, "incoming", "charge")
    assert row["status"] == "OUTGOING_SIGNED"
    assert row["outgoing"] == {"id": str(w.users["nurse"].id), "name": "nurse"}
    assert row["incoming"] == {"id": str(w.users["charge"].id), "name": "charge"}
    assert row["patients"] == [{"admission_id": admission["id"],
                                "board_key": admission["board_key"], "display_name": NAME,
                                "bed_label": "1", "unit_name": "Reanimasiya"}]
    assert row["outgoing_signed_at"] is not None and row["incoming_signed_at"] is None
    assert row["created_at"] and row["bridge_expires_at"]
    assert handover["id"] == row["id"]


async def test_closed_handovers_older_than_a_day_are_left_out(ward, db_session):
    w, client, _ = ward
    admission = await signed(w, client)
    old_done, late_done, new_done, old_lapsed, old_waiting = [
        await handed(w, client, admission) for _ in range(5)]
    for done in (old_done, late_done, new_done):
        r = await client.post(f"/handovers/{done['id']}/countersign", headers=w.auth["charge"])
        assert r.status_code == 200, r.text
    day_ago = datetime.now(timezone.utc) - timedelta(hours=25)
    for handover, values in ((old_done, {"created_at": day_ago, "incoming_signed_at": day_ago}),
                             (late_done, {"created_at": day_ago}),     # countersigned just now
                             (old_lapsed, {"created_at": day_ago,
                                           "status": HandoverStatus.EXPIRED}),
                             (old_waiting, {"created_at": day_ago})):
        await db_session.execute(update(Handover).where(Handover.id == uuid.UUID(handover["id"]))
                                 .values(**values))
    await db_session.commit()

    ids = {r["id"] for r in await box(w, client, "incoming", "charge")}
    # A COMPLETED one counts its day from the countersignature (review): one countersigned late
    # stays. The OUTGOING_SIGNED one is still waiting for its countersign.
    assert ids == {late_done["id"], new_done["id"], old_waiting["id"]}


async def test_an_open_handover_past_its_bridge_reads_as_expired(ward, db_session):
    """The bridge (S-24, 30 min) lapses with nobody writing it: an OPEN row past it is read as the
    EXPIRED it is, and leaves the box after a day like any closed one."""
    w, client, _ = ward
    admission = await signed(w, client)
    lapsed, old = await opened(w, client, admission), await opened(w, client, admission)
    now = datetime.now(timezone.utc)
    await db_session.execute(update(Handover).where(Handover.id == uuid.UUID(lapsed["id"]))
                             .values(bridge_expires_at=now - timedelta(minutes=1)))
    await db_session.execute(update(Handover).where(Handover.id == uuid.UUID(old["id"]))
                             .values(bridge_expires_at=now - timedelta(hours=24),
                                     created_at=now - timedelta(hours=25)))
    await db_session.commit()

    (row,) = await box(w, client, "outgoing", "nurse")
    assert (row["id"], row["status"]) == (lapsed["id"], "EXPIRED")


async def test_the_box_is_required_and_named(ward):
    w, client, _ = ward
    for params in ({}, {"box": "all"}, {"box": ""}):
        r = await client.get("/handovers", params=params, headers=w.auth["nurse"])
        assert r.status_code == 422, (params, r.text)


async def test_the_boxes_need_handover_sign(ward):
    w, client, _ = ward
    r = await client.get("/handovers", params={"box": "incoming"}, headers=w.auth["auditor"])
    assert r.status_code == 403, r.text


async def test_a_member_of_two_tenants_sees_only_her_session_tenants_handovers(ward, db_session):
    """By person AND by tenant: a handover to her in her other hospital stays there. Her session
    runs in the lowest slug of her memberships (auth/groups.tenant_of_user): «kabul-hastane»."""
    w, client, _ = ward
    both = await add_user(db_session, username="iki@kabul.example.com", tenant_id=w.tenant.id,
                          group=await nurse_group(db_session, w))
    other = Tenant(name="Sentetik Zeta Hastanesi", slug="zeta-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, other.id)
    db_session.add(TenantMembership(user_id=both.id, tenant_id=other.id))
    await db_session.flush()
    await set_manual_groups(db_session, user=both, tenant_id=other.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    site = Site(tenant_id=other.id, name="Zeta bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Zeta YBÜ", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.commit()
    sender = await add_user(db_session, username="gonderen@zeta.example.com",
                            tenant_id=other.id, group=groups["nurse"])
    await adm_service.open_handover(db_session, unit_id=unit.id, outgoing_user_id=sender.id,
                                    incoming_user_id=both.id, admission_ids=[])
    await db_session.commit()
    admission = await signed(w, client)
    r = await client.post("/handovers", headers=w.auth["nurse"],
                          json={**body(w, admission), "incoming_user_id": str(both.id)})
    assert r.status_code == 201, r.text
    ours = r.json()

    r = await client.get("/handovers", params={"box": "incoming"},
                         headers=await bearer(db_session, both))
    assert r.status_code == 200, r.text
    assert [row["id"] for row in r.json()] == [ours["id"]]


# ---------------------------------------------------------------- D7: colleagues
async def test_colleagues_are_the_tenants_active_handover_signers_but_the_caller(
        ward, db_session):
    w, client, _ = ward
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, other.id)
    nurses = await nurse_group(db_session, w)
    await add_user(db_session, username="yabanci@baska.example.com", tenant_id=other.id,
                   group=groups["nurse"])
    gone = await add_user(db_session, username="ayrilan@kabul.example.com",
                          tenant_id=w.tenant.id, group=nurses)
    left = await add_user(db_session, username="cikan@kabul.example.com",
                          tenant_id=w.tenant.id, group=nurses)
    await db_session.execute(update(User).where(User.id == gone.id).values(is_active=False))
    await db_session.execute(update(TenantMembership).where(TenantMembership.user_id == left.id)
                             .values(is_active=False))
    await db_session.commit()

    r = await client.get("/handovers/colleagues", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    # admin: the system group holds every permission by rule; the auditor holds no handover.sign.
    assert r.json() == [{"id": str(w.users[name].id), "name": name}
                        for name in ("admin", "charge", "doctor", "nurse_b")]


async def test_colleagues_need_handover_sign(ward):
    w, client, _ = ward
    r = await client.get("/handovers/colleagues", headers=w.auth["auditor"])
    assert r.status_code == 403, r.text


async def test_a_full_name_names_a_colleague_before_the_user_name(ward, db_session):
    w, client, _ = ward
    await db_session.execute(update(User).where(User.id == w.users["doctor"].id)
                             .values(full_name="Aysel Sentetik"))
    await db_session.commit()
    names = [c["name"] for c in (await client.get("/handovers/colleagues",
                                                  headers=w.auth["nurse"])).json()]
    assert names == ["admin", "Aysel Sentetik", "charge", "nurse_b"]


# ---------------------------------------------------------------- D8: the trail
async def test_each_step_writes_one_audit_row_without_the_note(ward):
    w, client, app = ward
    admission = await signed(w, client)
    handover = await handed(w, client, admission)
    r = await client.post(f"/handovers/{handover['id']}/countersign", headers=w.auth["charge"])
    assert r.status_code == 200, r.text

    key = admission["board_key"]
    (opened_row,) = audited(app, "handover.open")
    assert (opened_row.patient_id, opened_row.payload) == (key, {
        "handover_id": handover["id"], "admission_id": admission["id"],
        "admission_ids": [admission["id"]], "patients": [key],
        "incoming_user_id": str(w.users["charge"].id), "actor": "nurse@kabul.example.com"})
    (signed_row,) = audited(app, "handover.sign_outgoing")
    assert (signed_row.patient_id, signed_row.payload) == (key, {
        "handover_id": handover["id"], "patients": [key], "actor": "nurse@kabul.example.com"})
    (counter_row,) = audited(app, "handover.countersign")
    assert (counter_row.patient_id, counter_row.payload) == (key, {
        "handover_id": handover["id"], "patients": [key], "actor": "charge@kabul.example.com"})

    every = json.dumps([r.payload for r in app.state.audit.records(tenant=SLUG, limit=500)],
                       ensure_ascii=False)
    assert all(part not in every for part in NOTE.values())


async def test_a_refused_signature_writes_no_row(ward):
    w, client, app = ward
    admission = await signed(w, client)
    await septic_shock(client, admission["board_key"])
    handover = await opened(w, client, admission)
    refused(await sign(w, client, handover), 409, "critical_alarm_open")
    assert audited(app, "handover.sign_outgoing") == []


# ---------------------------------------------------------------- countersign
async def test_only_the_named_receiver_countersigns(ward):
    w, client, _ = ward
    handover = await handed(w, client, await signed(w, client), to="charge")
    url = f"/handovers/{handover['id']}/countersign"
    for who in ("doctor", "nurse"):
        refused(await client.post(url, headers=w.auth[who]), 409, "invalid_transition")
    r = await client.post(url, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "COMPLETED"


# ---------------------------------------------------------------- G4-02: waiting for the countersignature
async def waiting(db_session, w, unit: str, *, signed_at: datetime | None = None,
                  status: HandoverStatus = HandoverStatus.OUTGOING_SIGNED) -> Handover:
    """A handover of `unit` as the outgoing signature leaves it (`status` for the other states), written
    straight into the database: counting one needs no patient and no live board (G4-02)."""
    handover = await adm_service.open_handover(db_session, unit_id=w.units[unit].id,
                                               outgoing_user_id=w.users["nurse"].id,
                                               incoming_user_id=w.users["charge"].id, admission_ids=[])
    handover.status = status
    handover.outgoing_signed_at = signed_at
    await db_session.commit()
    return handover


async def pending(client, headers: dict[str, str]) -> dict:
    r = await client.get("/handovers/pending", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def summary_reader(db_session, w, *, unit: str | None = None,
                         bed: str | None = None) -> dict[str, str]:
    """A member of a group the hospital made, holding `summary.view` alone (spec D2: the key can be given
    on the Roles screen later), granted one unit or one bed, or — neither named — no grant at all (an
    unassigned member). Her Authorization header."""
    tag = uuid.uuid4().hex[:8]
    group = Group(tenant_id=w.tenant.id, slug=f"ozet-{tag}", name=f"Sentetik özet {tag}",
                  permissions=[GroupPermission(permission="summary.view")])
    db_session.add(group)
    await db_session.flush()
    user = await add_user(db_session, username=f"ozet-{tag}@kabul.example.com",
                          tenant_id=w.tenant.id, group=group)
    if unit or bed:
        db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id,
                                  unit_id=str(w.units[unit].id) if unit else "",
                                  bed_id=str(w.beds[bed].id) if bed else ""))
        await db_session.commit()
    return await bearer(db_session, user)


async def test_the_waiting_handovers_need_summary_view(ward):
    """Spec D2: the summary is the system administrator's. A nurse signs handovers and reads none of it."""
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor", "auditor"):
        r = await client.get("/handovers/pending", headers=w.auth[who])
        assert r.status_code == 403, (who, r.text)
    body = await pending(client, w.auth["admin"])
    assert body["units"] == []                      # a unit with none is left out
    assert body["generated_at"]


async def test_each_unit_counts_its_waiting_handovers_and_names_the_oldest(ward, db_session):
    """Per unit, by name: how many wait, and when the oldest was signed — days ago if need be, since
    OUTGOING_SIGNED never expires (service.py)."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    oldest = now - timedelta(days=3)
    await waiting(db_session, w, "rea", signed_at=now - timedelta(hours=2))
    await waiting(db_session, w, "rea", signed_at=oldest)
    await waiting(db_session, w, "neo", signed_at=now - timedelta(minutes=5))

    body = await pending(client, w.auth["admin"])
    assert [(u["unit_name"], u["pending"]) for u in body["units"]] == [("Neonatal", 1), ("Reanimasiya", 2)]
    rea = body["units"][1]
    assert rea["unit_id"] == str(w.units["rea"].id)
    assert datetime.fromisoformat(rea["oldest_outgoing_signed_at"]) == oldest
    assert abs(datetime.fromisoformat(body["generated_at"]) - now) < timedelta(minutes=1)


async def test_only_a_handover_waiting_for_its_countersignature_counts(ward, db_session):
    """OPEN (not signed yet, or past its bridge), COMPLETED and EXPIRED wait for nobody."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    await waiting(db_session, w, "rea", status=HandoverStatus.OPEN)
    await waiting(db_session, w, "rea", signed_at=now, status=HandoverStatus.COMPLETED)
    await waiting(db_session, w, "rea", status=HandoverStatus.EXPIRED)
    assert (await pending(client, w.auth["admin"]))["units"] == []

    await waiting(db_session, w, "rea", signed_at=now)
    assert [u["pending"] for u in (await pending(client, w.auth["admin"]))["units"]] == [1]


async def test_the_answer_names_no_patient_note_or_person(ward):
    """Spec D4: counts and times only. A handover made the ward's way — a patient, the D-Ö-D-Ö note, two
    people — is counted, and nothing of it is told."""
    w, client, _ = ward
    admission = await signed(w, client)
    handover = await handed(w, client, admission)

    r = await client.get("/handovers/pending", headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"units", "generated_at"}
    (unit,) = body["units"]
    assert set(unit) == {"unit_id", "unit_name", "pending", "oldest_outgoing_signed_at"}
    assert unit["pending"] == 1
    for told in (NAME, *NOTE.values(), admission["id"], admission["board_key"], handover["id"],
                 str(w.users["nurse"].id), str(w.users["charge"].id), "nurse@kabul", "charge@kabul"):
        assert told not in r.text, told


async def test_a_reader_given_the_key_sees_her_own_units_only(ward, db_session):
    """Spec D4: the scope is the caller's units. A group given the key later (D2), granted one unit, sees
    that unit's; granted a bed alone, none — a handover belongs to a unit, not to a bed."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    await waiting(db_session, w, "rea", signed_at=now)
    await waiting(db_session, w, "neo", signed_at=now)
    neo_reader = await summary_reader(db_session, w, unit="neo")
    bed_reader = await summary_reader(db_session, w, bed="1")

    assert [u["unit_name"] for u in (await pending(client, neo_reader))["units"]] == ["Neonatal"]
    assert (await pending(client, bed_reader))["units"] == []
    assert [u["unit_name"] for u in (await pending(client, w.auth["admin"]))["units"]] == \
        ["Neonatal", "Reanimasiya"]


async def test_an_unassigned_reader_sees_every_unit_while_assignment_is_not_enforced(ward, db_session):
    """G4-02 review: a reader given the key and no unit or bed grant is unrestricted while
    `SCOPE_ENFORCE_UNASSIGNED` is off — the pilot's state (`scope.resolver.enforce_unassigned_default`)
    — exactly as the board treats her."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    await waiting(db_session, w, "rea", signed_at=now)
    await waiting(db_session, w, "neo", signed_at=now)
    unassigned = await summary_reader(db_session, w)

    assert [u["unit_name"] for u in (await pending(client, unassigned))["units"]] == \
        ["Neonatal", "Reanimasiya"]


async def test_an_unassigned_reader_sees_no_unit_once_assignment_is_enforced(ward, db_session, monkeypatch):
    """G4-02 review: with `SCOPE_ENFORCE_UNASSIGNED` on, a reader with no grant reaches no unit and is
    answered an empty list, not a 403; the administrator, unrestricted by role, still sees every unit."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    await waiting(db_session, w, "rea", signed_at=now)
    await waiting(db_session, w, "neo", signed_at=now)
    unassigned = await summary_reader(db_session, w)
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")

    assert (await pending(client, unassigned))["units"] == []
    assert [u["unit_name"] for u in (await pending(client, w.auth["admin"]))["units"]] == \
        ["Neonatal", "Reanimasiya"]


async def test_another_hospitals_waiting_handovers_are_not_counted(ward, db_session):
    """Tenant isolation: each administrator counts her own hospital's units only."""
    w, client, _ = ward
    other = Tenant(name="Sentetik Omega Hastanesi", slug="omega-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, other.id)
    site = Site(tenant_id=other.id, name="Omega bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Omega YBÜ", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.commit()
    sender = await add_user(db_session, username="gonderen@omega.example.com", tenant_id=other.id,
                            group=groups["nurse"])
    receiver = await add_user(db_session, username="alan@omega.example.com", tenant_id=other.id,
                              group=groups["nurse"])
    their_admin = await add_user(db_session, username="yonetici@omega.example.com", tenant_id=other.id,
                                 group=groups["hospital_admin"])
    theirs = await adm_service.open_handover(db_session, unit_id=unit.id, outgoing_user_id=sender.id,
                                             incoming_user_id=receiver.id, admission_ids=[])
    theirs.status, theirs.outgoing_signed_at = HandoverStatus.OUTGOING_SIGNED, datetime.now(timezone.utc)
    await db_session.commit()
    await waiting(db_session, w, "rea", signed_at=datetime.now(timezone.utc))

    assert [u["unit_name"] for u in (await pending(client, w.auth["admin"]))["units"]] == ["Reanimasiya"]
    assert [u["unit_name"] for u in (await pending(client, await bearer(db_session, their_admin)))["units"]] \
        == ["Omega YBÜ"]


# ---------------------------------------------------------------- G4-02 review: the handover's unit is its beds'
async def test_the_handovers_unit_is_its_patients_bed_unit_whatever_the_body_names(ward, db_session):
    """G4-02 review: a handover is stored under its admissions' beds' unit (bed → room → unit, as
    `_reach_admission` reads it, A-12), never under the body's `unit_id`. A body naming another unit of
    the hospital is not refused — a nurse is never stopped from handing over by a stale unit on the
    screen — but that unit is not stored, answered or counted: the summary counts the handover under
    the unit its patient lies in."""
    w, client, _ = ward
    admission = await signed(w, client)                                  # bed 1, Reanimasiya
    r = await client.post("/handovers", json=body(w, admission, unit="neo"), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["unit_id"] == str(w.units["rea"].id)
    assert (await db_session.execute(select(Handover.unit_id))).scalars().all() == [w.units["rea"].id]

    r = await sign(w, client, r.json())
    assert r.status_code == 200, r.text
    assert [(u["unit_name"], u["pending"]) for u in (await pending(client, w.auth["admin"]))["units"]] == \
        [("Reanimasiya", 1)]


async def test_admissions_whose_beds_lie_in_two_units_are_not_one_handover(ward, db_session):
    """G4-02 review: a handover has one unit, its patients' beds'. The screen sends one admission; a
    body naming two whose beds lie in two units — only a crafted one can — is refused on
    `admission_ids`, and nothing is opened. The administrator reaches both beds, so the refusal is
    this rule's, not the scope's."""
    w, client, _ = ward
    rea = await signed(w, client)
    # G2-B1c (T1): the signer becomes the attending, and the administrator is no physician.
    await add_physician(db_session, w, "neodoc", group="attending", unit="neo")
    neo = await signed(w, client, "N1", "neo", who="nurse_b", signer="neodoc")
    sent = {**body(w, rea), "admission_ids": [rea["id"], neo["id"]]}
    refused(await client.post("/handovers", json=sent, headers=w.auth["admin"]),
            422, "field_invalid:admission_ids")
    assert await handovers_in(db_session) == 0
