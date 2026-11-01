"""Signing a severity form, and correcting it.

The form arrives pre-filled. That is the product's value and also its risk: a number that appeared
on its own is a number nobody checked. These tests hold the four rules that make a pre-filled form
safe to put a clinician's name on.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.canonical import Observation, SignalCode
from homunculus.scoring import sofa_form
from homunculus.scoring.signing import (
    MIN_REASON_CHARS, ScoreSigningError, parse_overrides, sign,
)
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 9, 13, 12, 0, tzinfo=timezone.utc)
TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
WHY = "Cihazdan gelen deger hatali, laboratuvar sonucu esas alindi"


def _state(series):
    state = PatientState("yatak-1")
    for code, value, hours in series:
        state.ingest(Observation("yatak-1", code, value, "u", T0 - timedelta(hours=hours), "lab"))
    return state


def _form():
    return sofa_form.build(_state([(SignalCode.PLATELETS, 45, 6)]), T0)


def _corrected(value):
    return sofa_form.build(_state([(SignalCode.PLATELETS, 45, 6)]), T0,
                           overrides={SignalCode.PLATELETS: value})


def _cell(form, code):
    return next(c for r in form.rows for c in r.inputs if c.code == code)


class TestACorrectionChangesTheValueNotTheScore:
    def test_the_points_are_recomputed_from_the_table(self):
        """A clinician says the platelet count was 38. They do not say this row scores 2 — a typed
        point value would enter quality reporting unbanded, with nothing downstream able to tell it
        from a computed one."""
        assert _form().total == 3            # 45 platelets
        assert _corrected(180).total == 0    # a normal count, scored as one

    def test_the_original_value_is_kept_beside_the_correction(self):
        """An override that erased the original would destroy the only evidence a correction
        happened — and a pattern of corrections on one parameter is how a broken feed shows up."""
        cell = _cell(_corrected(38), SignalCode.PLATELETS)
        assert cell.value == 38
        assert cell.original == 45
        assert cell.overridden is True

    def test_the_printout_can_tell_a_corrected_form_from_a_measured_one(self):
        assert _corrected(38).as_dict()["corrected_cells"] == ["platelets"]
        assert _form().as_dict()["corrected_cells"] == []


class TestACorrectionNeedsAReason:
    def test_a_bare_correction_is_refused(self):
        with pytest.raises(ScoreSigningError, match="gerekçe"):
            parse_overrides([{"code": "platelets", "value": 38}], _form())

    def test_a_keystroke_is_not_a_reason(self):
        with pytest.raises(ScoreSigningError, match=str(MIN_REASON_CHARS)):
            parse_overrides([{"code": "platelets", "value": 38, "reason": "yanlis"}], _form())

    def test_a_real_sentence_is_accepted_and_carries_the_original(self):
        overrides = parse_overrides([{"code": "platelets", "value": 38, "reason": WHY}], _form())
        assert overrides[0].value == 38
        assert overrides[0].original == 45
        assert overrides[0].reason == WHY


class TestTheFormDecidesWhatIsOverridable:
    def test_a_parameter_this_score_does_not_use_is_refused(self):
        """Recording a correction that changes nothing, in a way that reads as though it did."""
        with pytest.raises(ScoreSigningError, match="bu formda yok"):
            parse_overrides([{"code": "heart_rate", "value": 90, "reason": WHY}], _form())

    def test_an_unknown_field_is_refused_by_name(self):
        with pytest.raises(ScoreSigningError, match="bilinmeyen alan"):
            parse_overrides([{"code": "kalp_hizi", "value": 90, "reason": WHY}], _form())

    def test_the_same_cell_cannot_be_corrected_twice_in_one_request(self):
        with pytest.raises(ScoreSigningError, match="birden fazla"):
            parse_overrides([{"code": "platelets", "value": 38, "reason": WHY},
                             {"code": "platelets", "value": 40, "reason": WHY}], _form())

    def test_a_non_numeric_correction_is_refused(self):
        with pytest.raises(ScoreSigningError, match="sayı olmalı"):
            parse_overrides([{"code": "platelets", "value": "düşük", "reason": WHY}], _form())


class TestNobodyIsNotASignature:
    def test_an_unidentified_signer_is_refused(self):
        """Unsigned is a valid state for a form. Anonymously signed is not."""
        form = _form()
        with pytest.raises(ScoreSigningError, match="kimliksiz"):
            sign(form, form, signed_by="   ", overrides=[])

    def test_a_signed_form_keeps_what_the_record_alone_produced(self):
        signed = sign(_form(), _corrected(180), signed_by="dr.elif", overrides=[])
        assert signed.total == 0
        assert signed.form["auto_total"] == 3     # the number before anyone touched it
        assert signed.signed_by == "dr.elif"


DOCTOR = {"Authorization": "Bearer doctor-jwt"}
PHYSICIAN_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS
                                 if g["slug"] == "physician"))


async def _resolve_doctor(_credential: str) -> Caller:
    """A signed-in physician: the default physician group holds `scores.sign`."""
    return Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=PHYSICIAN_PERMS)


class TestThroughTheApi:
    """The bridge's token charts and reads (a device passes every permission check); only a
    signed-in person signs, because a signature has to name somebody who can be asked."""

    @pytest.fixture()
    def client(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve_doctor)
        with TestClient(app) as c:
            yield c

    def _chart(self, client, code, value, minutes_ago=60):
        at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
        return client.post("/clinical/yatak-1",
                           json={"entries": [{"code": code, "value": value}], "recorded_at": at},
                           headers=AUTH)

    def test_the_unsigned_form_comes_back_filled(self, client):
        self._chart(client, "platelets", 45)
        body = client.get("/scores/sofa/yatak-1", headers=AUTH).json()
        assert body["total"] == 3
        assert body["signed"] is False
        assert body["source"] == "sepsis-3-jama-2016"

    def test_signing_records_who_and_what_changed(self, client):
        self._chart(client, "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 180, "reason": WHY}]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["signed"] is True and body["total"] == 0
        assert body["signed_by"] == "dr.elif"
        assert body["form"]["auto_total"] == 3
        assert body["overrides"][0]["original"] == 45

    def test_the_bridge_token_cannot_sign(self, client):
        """A device passes every permission check; a signature still has to name a person."""
        self._chart(client, "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=AUTH, json={})
        assert r.status_code == 403
        assert not client.get("/audit?event_type=score_signed", headers=AUTH).json()["records"]

    def test_the_signature_is_sealed_into_the_audit_chain(self, client):
        self._chart(client, "platelets", 45)
        client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={})
        rows = client.get("/audit?event_type=score_signed", headers=AUTH).json()["records"]
        assert rows and rows[0]["payload"]["total"] == 3
        assert rows[0]["payload"]["signed_by"] == "dr.elif"
        assert len(rows[0]["hash"]) == 64
        assert client.get("/audit/verify", headers=AUTH).json()["ok"] is True

    def test_a_reasonless_correction_is_refused_with_an_explanation(self, client):
        self._chart(client, "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 180}]})
        assert r.status_code == 400
        assert "gerekçe" in r.json()["detail"]


NURSE = {"Authorization": "Bearer nurse-jwt"}
NURSE_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "nurse"))


async def _resolve_person(credential: str) -> Caller:
    """A signed-in physician (the default group holds `scores.sign`) or, for `nurse-jwt`, a nurse — who
    sees and charts the patient (`board.view`, `clinical.chart`) but does not sign."""
    if credential == "nurse-jwt":
        return Caller(hospital="h1", actor="hem.ayse", groups=("nurse",), perms=NURSE_PERMS)
    return Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=PHYSICIAN_PERMS)


class _AsPeople:
    """G2-A4: the app with a physician and a nurse behind their tokens; the bridge's token charts."""

    @pytest.fixture()
    def client(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve_person)
        with TestClient(app) as c:
            yield c

    def _chart(self, client, patient_id, code, value, minutes_ago=60):
        at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
        r = client.post(f"/clinical/{patient_id}",
                        json={"entries": [{"code": code, "value": value}], "recorded_at": at},
                        headers=AUTH)
        assert r.status_code == 200, r.text

    def _signed_rows(self, client):
        return client.get("/audit?event_type=score_signed", headers=AUTH).json()["records"]


class TestTheFormKnowsItsLastSignature(_AsPeople):
    """G2-A4 (D7): the form's own answer says who signed it last, when, and to what total — read with the
    form's permission from this patient's `score_signed` rows only — and how long a correction's reason
    must be, so the screen counts against the engine's number rather than a copy of it."""

    def test_an_unsigned_form_has_no_last_signature_and_states_the_reason_length(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        body = client.get("/scores/sofa/yatak-1", headers=NURSE).json()
        assert body["last_signed"] is None
        assert body["min_reason_chars"] == MIN_REASON_CHARS == 20
        assert body["total"] == 3 and body["signed"] is False      # the form itself is unchanged

    def test_the_newest_signature_is_the_one_in_the_form(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        assert client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={}).status_code == 200
        assert client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 180, "reason": WHY}]}).status_code == 200
        last = client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"]
        assert last == {"total": 0, "auto_total": 3, "signed_by": "dr.elif",
                        "at": last["at"], "corrections": 1}
        assert datetime.fromisoformat(last["at"]).tzinfo is not None

    def test_another_patients_signature_is_not_this_ones(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        self._chart(client, "yatak-2", "platelets", 45)
        assert client.post("/scores/sofa/yatak-2", headers=DOCTOR, json={}).status_code == 200
        assert client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"] is None
        assert client.get("/scores/sofa/yatak-2", headers=NURSE).json()["last_signed"]["total"] == 3

    def test_a_nurse_reads_the_signature_without_the_audit_permission(self, client):
        """The form's permission is `board.view`; the trail itself stays `audit.view`'s."""
        self._chart(client, "yatak-1", "platelets", 45)
        assert client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={}).status_code == 200
        last = client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"]
        assert last["signed_by"] == "dr.elif"
        assert client.get("/audit?patient_id=yatak-1", headers=NURSE).status_code == 403


class TestPreviewSignsNothing(_AsPeople):
    """G2-A4 (D6): `preview: true` answers with the form a signature would seal — re-scored by the engine
    from the same corrections — and writes nothing, so a clinician sees the exact number before she puts
    her name to it and the server stays the only scorer. Every refusal of signing holds for it."""

    def test_the_preview_is_the_rebuilt_form_and_no_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "preview": True, "overrides": [{"code": "platelets", "value": 180, "reason": WHY}]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["preview"] is True and body["signed"] is False
        assert body["total"] == 0 and body["auto_total"] == 3
        assert body["overrides"] == [{"code": "platelets", "value": 180, "reason": WHY, "original": 45}]
        assert body["form"]["auto_total"] == 3 and body["form"]["signed"] is False
        assert body["form"]["corrected_cells"] == ["platelets"]
        assert self._signed_rows(client) == []

    def test_signing_the_same_corrections_seals_the_previewed_total(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        overrides = [{"code": "platelets", "value": 80, "reason": WHY}]
        previewed = client.post("/scores/sofa/yatak-1", headers=DOCTOR,
                                json={"preview": True, "overrides": overrides}).json()
        signed = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={"overrides": overrides}).json()
        assert signed["signed"] is True and signed["total"] == previewed["total"] == 2
        rows = self._signed_rows(client)
        assert len(rows) == 1 and rows[0]["payload"]["total"] == 2

    def test_a_short_reason_is_refused_for_a_preview_as_for_a_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={
            "preview": True, "overrides": [{"code": "platelets", "value": 180, "reason": "yanlis"}]})
        assert r.status_code == 400
        assert "gerekçe" in r.json()["detail"]
        assert self._signed_rows(client) == []

    def test_the_bridge_token_cannot_preview(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=AUTH, json={"preview": True})
        assert r.status_code == 403
        assert r.json()["detail"] == "skor formunu yalnız bir kişi imzalayabilir"

    def test_a_nurse_without_scores_sign_cannot_preview(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=NURSE, json={"preview": True})
        assert r.status_code == 403
        assert r.json()["detail"] == "permission required: scores.sign"

    def test_preview_must_be_a_real_yes_or_no(self, client):
        """X2: a "true" string read as false would SIGN a form its sender meant only to look at."""
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post("/scores/sofa/yatak-1", headers=DOCTOR, json={"preview": "true"})
        assert r.status_code == 400
        assert "preview" in r.json()["detail"]
        assert self._signed_rows(client) == []
