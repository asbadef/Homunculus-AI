"""Signing a severity form, and correcting it.

The form arrives pre-filled. That is the product's value and also its risk: a number that appeared
on its own is a number nobody checked. These tests hold the four rules that make a pre-filled form
safe to put a clinician's name on.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.canonical import Observation, SignalCode
from homunculus.scoring import sofa_form
from homunculus.scoring.signing import (
    MIN_REASON_CHARS, ScoreSigningError, form_digest, parse_overrides, sign,
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


def _digest(series, corrections=()):
    """The fingerprint of the form `series` fills, with `corrections` applied as the API applies them."""
    state = _state(series)
    auto = sofa_form.build(state, T0)
    overrides = parse_overrides(list(corrections), auto)
    rebuilt = sofa_form.build(state, T0, overrides={o.code: o.value for o in overrides})
    return form_digest(rebuilt, overrides)


class TestTheFormsFingerprint:
    """G2-A4 (D12, X20): `form_digest` is the fingerprint of a form as the clinician saw it — its total,
    every row's points, every cell's value, time and points, the respiration row's support basis and each
    correction's value and original. The preview answers it; a signature carries it back, and the engine
    signs only when the form it would seal has the same one."""

    PLATELETS_45 = [(SignalCode.PLATELETS, 45, 6)]

    def test_the_same_form_gives_the_same_fingerprint_in_lowercase_hex(self):
        first, second = _digest(self.PLATELETS_45), _digest(self.PLATELETS_45)
        assert first == second
        assert re.fullmatch(r"[0-9a-f]{64}", first)

    def test_it_is_the_sha256_of_the_canonical_payload(self):
        """The recipe itself, pinned: sorted keys, no spaces, UTF-8, SHA-256."""
        unmeasured = [None, None, 0]
        payload = {
            "total": 3,
            "points": {"respiration": 0, "cardiovascular": 0, "coagulation": 3, "liver": 0, "cns": 0,
                       "renal": 0},
            "cells": {"pao2_fio2": unmeasured, "map": unmeasured,
                      "platelets": [45, (T0 - timedelta(hours=6)).isoformat(), 3],   # as the form holds it
                      "bilirubin": unmeasured, "gcs": unmeasured, "creatinine": unmeasured},
            "support": None,                                  # no ratio, so no support basis
            "corrections": {},
        }
        text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        assert _digest(self.PLATELETS_45) == hashlib.sha256(text.encode("utf-8")).hexdigest()

    def test_a_moved_value_gives_another_fingerprint_even_inside_the_same_band(self):
        assert _digest(self.PLATELETS_45) != _digest([(SignalCode.PLATELETS, 44, 6)])   # both 3 points

    def test_a_moved_time_gives_another_fingerprint(self):
        assert _digest(self.PLATELETS_45) != _digest([(SignalCode.PLATELETS, 45, 5)])

    def test_a_correction_gives_another_fingerprint(self):
        fix = [{"code": "platelets", "value": 80, "reason": WHY}]
        assert _digest(self.PLATELETS_45) != _digest(self.PLATELETS_45, fix)

    def test_a_moved_support_time_gives_another_fingerprint(self):
        """The ratio, its time, its points (3) and the total are the same; only the support observation the
        row was scored on is another one (D13)."""
        ratio = (SignalCode.PAO2_FIO2, 150, 2)
        assert (_digest([ratio, (SignalCode.ON_RESP_SUPPORT, 1, 10)])
                != _digest([ratio, (SignalCode.ON_RESP_SUPPORT, 1, 9)]))

    def test_a_moved_original_gives_another_fingerprint(self):
        """The corrected cell, the points and the total are the same (80, 2); only the original the record
        held differs — and that is part of what the clinician signs."""
        fix = [{"code": "platelets", "value": 80, "reason": WHY}]
        assert _digest(self.PLATELETS_45, fix) != _digest([(SignalCode.PLATELETS, 44, 6)], fix)


DOCTOR = {"Authorization": "Bearer doctor-jwt"}
PHYSICIAN_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS
                                 if g["slug"] == "physician"))


def _preview_then_sign(client, patient_id, overrides=None, headers=None):
    """G2-A4 (D12, X20): a signature carries the fingerprint of the preview it signs — so preview, then
    sign exactly what was previewed."""
    headers = headers or DOCTOR
    body = {"overrides": overrides or []}
    previewed = client.post(f"/scores/sofa/{patient_id}/preview", headers=headers, json=body)
    assert previewed.status_code == 200, previewed.text
    return client.post(f"/scores/sofa/{patient_id}", headers=headers,
                       json={**body, "expect": previewed.json()["expect"]})


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
        r = _preview_then_sign(client, "yatak-1", [{"code": "platelets", "value": 180, "reason": WHY}])
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
        assert _preview_then_sign(client, "yatak-1").status_code == 200
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
        assert _preview_then_sign(client, "yatak-1").status_code == 200
        assert _preview_then_sign(client, "yatak-1",
                                  [{"code": "platelets", "value": 180, "reason": WHY}]).status_code == 200
        last = client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"]
        assert last == {"total": 0, "auto_total": 3, "signed_by": "dr.elif",
                        "at": last["at"], "corrections": 1}
        assert datetime.fromisoformat(last["at"]).tzinfo is not None

    def test_another_patients_signature_is_not_this_ones(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        self._chart(client, "yatak-2", "platelets", 45)
        assert _preview_then_sign(client, "yatak-2").status_code == 200
        assert client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"] is None
        assert client.get("/scores/sofa/yatak-2", headers=NURSE).json()["last_signed"]["total"] == 3

    def test_a_nurse_reads_the_signature_without_the_audit_permission(self, client):
        """The form's permission is `board.view`; the trail itself stays `audit.view`'s."""
        self._chart(client, "yatak-1", "platelets", 45)
        assert _preview_then_sign(client, "yatak-1").status_code == 200
        last = client.get("/scores/sofa/yatak-1", headers=NURSE).json()["last_signed"]
        assert last["signed_by"] == "dr.elif"
        assert client.get("/audit?patient_id=yatak-1", headers=NURSE).status_code == 403


PREVIEW = "/scores/sofa/yatak-1/preview"
SIGN = "/scores/sofa/yatak-1"


class _Logged(_AsPeople):
    """The app over an audit log the test holds, so a promise of "no row" is pinned against the whole log
    rather than one event type."""

    @pytest.fixture()
    def log(self):
        return InMemoryAuditLog()

    @pytest.fixture()
    def client(self, log):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve_person, audit=log)
        with TestClient(app) as c:
            yield c

    @staticmethod
    def _all_rows(log):
        return log.records(limit=1_000_000)


class TestPreviewSignsNothing(_AsPeople):
    """G2-A4 (D6, D12, X19): the preview is its own route, `POST /scores/sofa/{id}/preview`. It answers with
    the form a signature would seal — re-scored by the engine from the same corrections — and that form's
    fingerprint (`expect`), and writes nothing, so a clinician sees the exact number before she puts her
    name to it and the server stays the only scorer. Every refusal of signing holds for it: the two routes
    run one helper."""

    def test_the_preview_is_the_rebuilt_form_its_fingerprint_and_no_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post(PREVIEW, headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 180, "reason": WHY}]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"preview", "signed", "total", "auto_total", "overrides", "form", "expect"}
        assert body["preview"] is True and body["signed"] is False
        assert body["total"] == 0 and body["auto_total"] == 3
        assert body["overrides"] == [{"code": "platelets", "value": 180, "reason": WHY, "original": 45}]
        assert body["form"]["auto_total"] == 3 and body["form"]["signed"] is False
        assert body["form"]["corrected_cells"] == ["platelets"]
        assert re.fullmatch(r"[0-9a-f]{64}", body["expect"])
        assert self._signed_rows(client) == []

    def test_signing_with_the_previews_fingerprint_seals_the_previewed_total(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        overrides = [{"code": "platelets", "value": 80, "reason": WHY}]
        previewed = client.post(PREVIEW, headers=DOCTOR, json={"overrides": overrides}).json()
        signed = client.post(SIGN, headers=DOCTOR,
                             json={"overrides": overrides, "expect": previewed["expect"]}).json()
        assert signed["signed"] is True and signed["total"] == previewed["total"] == 2
        rows = self._signed_rows(client)
        assert len(rows) == 1 and rows[0]["payload"]["total"] == 2

    def test_a_short_reason_is_refused_for_a_preview_as_for_a_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post(PREVIEW, headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 180, "reason": "yanlis"}]})
        assert r.status_code == 400
        assert "gerekçe" in r.json()["detail"]
        assert self._signed_rows(client) == []

    def test_the_bridge_token_cannot_preview(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post(PREVIEW, headers=AUTH, json={})
        assert r.status_code == 403
        assert r.json()["detail"] == "skor formunu yalnız bir kişi imzalayabilir"

    def test_a_nurse_without_scores_sign_cannot_preview(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post(PREVIEW, headers=NURSE, json={})
        assert r.status_code == 403
        assert r.json()["detail"] == "permission required: scores.sign"

    def test_an_unknown_patient_is_404_for_a_preview_as_for_a_signature(self, client):
        for path in ("/scores/sofa/yok-1/preview", "/scores/sofa/yok-1"):
            r = client.post(path, headers=DOCTOR, json={"overrides": []})
            assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı"), path


async def _resolve_nameless(_credential: str) -> Caller:
    """A physician's rights behind an account with no name."""
    return Caller(hospital="h1", actor="   ", groups=("physician",), perms=PHYSICIAN_PERMS)


def test_a_nameless_account_is_refused_for_a_preview_as_for_a_signature():
    """X3: a signature names somebody. A JWT with no actor is refused at the door (`_caller`, 401) for
    both routes, before the form is read; `sign_score`'s own refusal of an unnamed signer, which the
    shared helper runs for both, stays behind it (TestNobodyIsNotASignature)."""
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve_nameless)
    with TestClient(app) as client:
        at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert client.post("/clinical/yatak-1", headers=AUTH, json={
            "entries": [{"code": "platelets", "value": 45}], "recorded_at": at}).status_code == 200
        for path, body in ((PREVIEW, {"overrides": []}), (SIGN, {"overrides": [], "expect": "0" * 64})):
            r = client.post(path, headers=DOCTOR, json=body)
            assert (r.status_code, r.json()["detail"]) == (401, "unknown credential"), path
        assert not client.get("/audit?event_type=score_signed", headers=AUTH).json()["records"]


class TestASignatureSignsWhatWasPreviewed(_Logged):
    """G2-A4 (D12, X19, X20): the sign route takes `{overrides, expect}`, where `expect` is the fingerprint
    the preview answered. The engine rebuilds the form it would seal from the same corrections and signs it
    only when its fingerprint is the one previewed: a record that moved in between is a 409, not a
    signature of a number nobody saw. And the sign route no longer previews — a `preview` key is refused,
    so an older screen asking it for a preview can never sign."""

    ASKS_PREVIEW = "önizleme imza yolundan istenemez — önizleme yolunu kullanın"
    NEEDS_EXPECT = "imza bir önizlemenin parmak izini ister — önce önizleyin"
    MOVED = "kayıt önizlemeden sonra değişti — formu yeniden önizleyin"

    def _expect(self, client, overrides=None):
        r = client.post(PREVIEW, headers=DOCTOR, json={"overrides": overrides or []})
        assert r.status_code == 200, r.text
        return r.json()["expect"]

    @pytest.mark.parametrize("flag", [True, False, None, "true", 0])
    def test_a_preview_asked_of_the_sign_route_is_refused_and_writes_nothing(self, client, log, flag):
        """The body an older screen sent to ask for a preview, any value of the key."""
        self._chart(client, "yatak-1", "platelets", 45)
        before = len(self._all_rows(log))
        r = client.post(SIGN, headers=DOCTOR, json={"preview": flag, "overrides": []})
        assert (r.status_code, r.json()["detail"]) == (400, self.ASKS_PREVIEW)
        assert len(self._all_rows(log)) == before

    def test_a_preview_key_is_refused_even_beside_a_good_fingerprint(self, client, log):
        self._chart(client, "yatak-1", "platelets", 45)
        expect = self._expect(client)
        before = len(self._all_rows(log))
        r = client.post(SIGN, headers=DOCTOR, json={"preview": False, "overrides": [], "expect": expect})
        assert (r.status_code, r.json()["detail"]) == (400, self.ASKS_PREVIEW)
        assert len(self._all_rows(log)) == before

    MISSING = object()

    @pytest.mark.parametrize("expect", [MISSING, None, "", "abc", "0" * 63, "0" * 65, "g" * 64, 123,
                                        ["0" * 64]],
                             ids=["missing", "null", "empty", "short-word", "63", "65", "not-hex", "number",
                                  "list"])
    def test_a_signature_without_a_well_formed_fingerprint_is_refused(self, client, log, expect):
        self._chart(client, "yatak-1", "platelets", 45)
        body = {"overrides": []} if expect is self.MISSING else {"overrides": [], "expect": expect}
        before = len(self._all_rows(log))
        r = client.post(SIGN, headers=DOCTOR, json=body)
        assert (r.status_code, r.json()["detail"]) == (400, self.NEEDS_EXPECT)
        assert len(self._all_rows(log)) == before

    def test_the_previews_own_fingerprint_in_capitals_is_not_well_formed(self, client, log):
        self._chart(client, "yatak-1", "platelets", 45)
        r = client.post(SIGN, headers=DOCTOR, json={"overrides": [], "expect": self._expect(client).upper()})
        assert (r.status_code, r.json()["detail"]) == (400, self.NEEDS_EXPECT)

    def test_a_record_that_moved_since_the_preview_is_a_409_and_nothing_is_written(self, client, log):
        """Another desk charts between the preview and the press: the signature would seal a total nobody
        saw. Previewed again, the form signs the record as it is now."""
        self._chart(client, "yatak-1", "platelets", 45)                     # coagulation 3
        expect = self._expect(client)
        self._chart(client, "yatak-1", "creatinine", 2.5, minutes_ago=30)   # renal 2
        before = len(self._all_rows(log))
        r = client.post(SIGN, headers=DOCTOR, json={"overrides": [], "expect": expect})
        assert (r.status_code, r.json()["detail"]) == (409, self.MOVED)
        assert len(self._all_rows(log)) == before
        signed = _preview_then_sign(client, "yatak-1")
        assert signed.status_code == 200 and signed.json()["total"] == 5

    def test_the_same_value_at_a_later_time_is_a_moved_record(self, client):
        """The worst platelet count is the same number but now a later reading (a tie goes to the most
        recent): the time the clinician checked against the chart is not the one she would sign."""
        self._chart(client, "yatak-1", "platelets", 45, minutes_ago=60)
        expect = self._expect(client)
        self._chart(client, "yatak-1", "platelets", 45, minutes_ago=30)
        r = client.post(SIGN, headers=DOCTOR, json={"overrides": [], "expect": expect})
        assert (r.status_code, r.json()["detail"]) == (409, self.MOVED)
        assert self._signed_rows(client) == []

    def test_a_reading_that_changes_nothing_shown_does_not_move_the_form(self, client):
        """A better platelet count charted after the preview leaves the worst — value, time, points — as
        it was: the clinician signs what she saw."""
        self._chart(client, "yatak-1", "platelets", 45, minutes_ago=60)
        expect = self._expect(client)
        self._chart(client, "yatak-1", "platelets", 160, minutes_ago=30)
        r = client.post(SIGN, headers=DOCTOR, json={"overrides": [], "expect": expect})
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 3

    def test_other_corrections_than_the_previewed_ones_are_a_409(self, client, log):
        self._chart(client, "yatak-1", "platelets", 45)
        expect = self._expect(client, [{"code": "platelets", "value": 80, "reason": WHY}])
        before = len(self._all_rows(log))
        r = client.post(SIGN, headers=DOCTOR, json={
            "overrides": [{"code": "platelets", "value": 90, "reason": WHY}], "expect": expect})
        assert (r.status_code, r.json()["detail"]) == (409, self.MOVED)
        assert len(self._all_rows(log)) == before


class TestThePreviewsPromises(_Logged):
    """G2-A4 review: what the preview promises, pinned against the whole audit log rather than one event
    type — a preview writes no row of ANY kind and refuses what a signature refuses."""

    def test_a_preview_of_no_correction_writes_no_audit_row_of_any_kind(self, client, log):
        self._chart(client, "yatak-1", "platelets", 45)
        before = len(self._all_rows(log))
        r = client.post(PREVIEW, headers=DOCTOR, json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["signed"] is False and body["overrides"] == []
        assert body["total"] == body["auto_total"] == 3
        assert len(self._all_rows(log)) == before

    @pytest.mark.parametrize(("overrides", "said"), [
        ([{"code": "kalp_hizi", "value": 90, "reason": WHY}], "bilinmeyen alan"),
        ([{"code": "platelets", "value": 38, "reason": WHY},
          {"code": "platelets", "value": 40, "reason": WHY}], "birden fazla"),
        ([{"code": "heart_rate", "value": 90, "reason": WHY}], "bu formda yok"),
    ], ids=["unknown-code", "duplicate-code", "not-on-the-form"])
    def test_a_preview_refuses_what_a_signature_refuses_and_writes_nothing(self, client, log,
                                                                           overrides, said):
        self._chart(client, "yatak-1", "platelets", 45)
        before = len(self._all_rows(log))
        for path, body in ((PREVIEW, {"overrides": overrides}),
                           (SIGN, {"overrides": overrides, "expect": "0" * 64})):
            r = client.post(path, headers=DOCTOR, json=body)
            assert r.status_code == 400, path
            assert said in r.json()["detail"]
        assert len(self._all_rows(log)) == before


class TestTheServerBoundsACorrection:
    """G2-A4 (O6): a corrected value is held to the same slip bounds the charting door holds a charted
    one to, in the door's words (api/clinical.py `_value`). `scoring` does not import `api`: the bounds
    are passed in, and without them only a finite number is required, as before."""

    BOUNDS = {SignalCode.PLATELETS: (0.0, 2000.0)}

    def test_without_bounds_any_finite_value_is_a_correction(self):
        [override] = parse_overrides([{"code": "platelets", "value": 18000, "reason": WHY}], _form())
        assert override.value == 18000

    def test_a_value_outside_its_bound_is_refused_in_the_doors_words(self):
        with pytest.raises(ScoreSigningError) as caught:
            parse_overrides([{"code": "platelets", "value": 18000, "reason": WHY}], _form(),
                            bounds=self.BOUNDS)
        assert str(caught.value) == ("platelets: 18000 beklenen aralığın (0–2000) dışında — "
                                     "birim veya ondalık hatası olabilir")

    def test_a_value_inside_its_bound_and_a_code_with_none_are_corrections(self):
        form = sofa_form.build(_state([(SignalCode.PLATELETS, 45, 6), (SignalCode.MAP, 60, 2)]), T0)
        overrides = parse_overrides([{"code": "platelets", "value": 2000, "reason": WHY},
                                     {"code": "map", "value": 900, "reason": WHY}],
                                    form, bounds=self.BOUNDS)
        assert [o.value for o in overrides] == [2000, 900]


class TestTheRouteBoundsACorrection(_AsPeople):
    """G2-A4 (O6): the route passes the door's PLAUSIBLE, so a slipped correction is refused for a preview
    and for a signature alike — both go through the same parse — and nothing is signed."""

    SLIPPED = [{"code": "platelets", "value": 18000, "reason": WHY}]
    SAID = "platelets: 18000 beklenen aralığın (0–5000) dışında — birim veya ondalık hatası olabilir"

    def test_a_slipped_correction_is_refused_for_a_preview_and_for_a_signature(self, client):
        self._chart(client, "yatak-1", "platelets", 45)
        for path, body in ((PREVIEW, {"overrides": self.SLIPPED}),
                           (SIGN, {"overrides": self.SLIPPED, "expect": "0" * 64})):
            r = client.post(path, headers=DOCTOR, json=body)
            assert r.status_code == 400, path
            assert r.json()["detail"] == self.SAID
        assert self._signed_rows(client) == []

    def test_a_slipped_map_correction_is_refused_for_a_preview_and_for_a_signature(self, client):
        """G2-A4 review: MAP has no bound at the door because it is not chartable there, but the
        cardiovascular row's MAP can be corrected; a correction of 9000 is held to the engineering slip
        bound the signing helper adds for it (0–300 mmHg). The door still refuses MAP."""
        self._chart(client, "yatak-1", "platelets", 45)
        slipped = [{"code": "map", "value": 9000, "reason": WHY}]
        said = "map: 9000 beklenen aralığın (0–300) dışında — birim veya ondalık hatası olabilir"
        for path, body in ((PREVIEW, {"overrides": slipped}), (SIGN, {"overrides": slipped, "expect": "0" * 64})):
            r = client.post(path, headers=DOCTOR, json=body)
            assert (r.status_code, r.json()["detail"]) == (400, said), path
        assert self._signed_rows(client) == []
        inside = client.post(PREVIEW, headers=DOCTOR,
                             json={"overrides": [{"code": "map", "value": 300, "reason": WHY}]})
        assert inside.status_code == 200, inside.text
        door = client.post("/clinical/yatak-1", headers=AUTH, json={"entries": [{"code": "map", "value": 65}]})
        assert door.status_code == 400 and "elle girilemez" in door.json()["detail"]

    def test_a_correction_inside_the_bound_still_previews_and_signs(self, client):
        """The edge itself is inside: 5000, the door's platelet bound (X18)."""
        self._chart(client, "yatak-1", "platelets", 45)
        inside = [{"code": "platelets", "value": 5000, "reason": WHY}]
        previewed = client.post(PREVIEW, headers=DOCTOR, json={"overrides": inside})
        assert previewed.status_code == 200 and previewed.json()["total"] == 0
        signed = client.post(SIGN, headers=DOCTOR,
                             json={"overrides": inside, "expect": previewed.json()["expect"]})
        assert signed.status_code == 200 and signed.json()["total"] == 0
        assert len(self._signed_rows(client)) == 1
