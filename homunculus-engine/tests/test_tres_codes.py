# homunculus-engine/tests/test_tres_codes.py
"""TRƏS-01 (spec D5, D10, D12; plan F1, O20): the checked codes and the local ids.

The codes are pinned EXACTLY as the terminology server answered them on 2026-11-12 (tres/codes.py
names the server): a change to one fails here until its line is looked up again and both move
together. The local ids: `hmn-`, a valid FHIR id, one dot at the end — so no id is a proper prefix
of another (O20) — and a person's id from the FİN, never the row. No database, synthetic ids only."""
from __future__ import annotations

import itertools
import re
import uuid

import pytest

from homunculus.tres import codes, ids

ROOT = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER = uuid.UUID("00000000-0000-4000-8000-000000000002")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000aa")


def test_the_signals_are_the_six_bedside_ones_with_their_checked_codes():
    assert {slug: (s.loinc.code, s.loinc.display, s.charted_unit, s.ucum) for slug, s in codes.SIGNALS.items()} == {
        "heart_rate": ("8867-4", "Heart rate", "/min", "/min"),
        "resp_rate": ("9279-1", "Respiratory rate", "/min", "/min"),
        "spo2": ("2708-6", "Oxygen saturation in Arterial blood", "%", "%"),
        "temperature": ("8310-5", "Body temperature", "°C", "Cel"),
        "sbp": ("8480-6", "Systolic blood pressure", "mmHg", "mm[Hg]"),
        "map": ("8478-0", "Mean blood pressure", "mmHg", "mm[Hg]"),
    }
    assert (codes.WEIGHT.loinc.code, codes.WEIGHT.loinc.display, codes.WEIGHT.ucum) == ("29463-7", "Body weight", "kg")
    assert (codes.HEIGHT.loinc.code, codes.HEIGHT.loinc.display, codes.HEIGHT.ucum) == ("8302-2", "Body height", "cm")
    assert all(s.loinc.system == codes.LOINC == "http://loinc.org"
               for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT))
    assert codes.UCUM == "http://unitsofmeasure.org"


def test_the_charted_units_are_the_bedside_doors_own():
    """A chart row in another unit is never sent (codes.py): the table must name the door's units."""
    from homunculus.api.clinical import CHARTABLE
    from homunculus.canonical import SignalCode
    for slug, signal in codes.SIGNALS.items():
        assert CHARTABLE[SignalCode(slug)] == signal.charted_unit, slug


def test_the_two_hl7_codings_and_every_check_is_recorded():
    assert codes.VITAL_SIGNS.coding() == {"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                          "code": "vital-signs", "display": "Vital Signs"}
    assert codes.INPATIENT.coding() == {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                                        "code": "IMP", "display": "inpatient encounter"}
    assert len(codes.CHECKS) == 8 and {check[3] for check in codes.CHECKS} == {"2026-11-12"}
    assert "tx.fhir.org" in codes.CHECKED_WITH


def test_each_vital_sign_has_its_stable_key_and_the_key_is_not_its_loinc_code():
    """A local id never changes once sent (amendment 1). SpO2's LOINC code is an open question to the
    ministry (O7: `2708-6` now, maybe `59408-5`): a code change must become a PUT of the SAME resource,
    so the id is keyed by the signal, never by the code. FHIR ids allow no `_`: hyphenated words."""
    assert {slug: s.id_key for slug, s in codes.SIGNALS.items()} == {
        "heart_rate": "heart-rate", "resp_rate": "resp-rate", "spo2": "spo2", "temperature": "temperature",
        "sbp": "sbp", "map": "map"}
    assert (codes.WEIGHT.id_key, codes.HEIGHT.id_key) == ("weight", "height")
    every = (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT)
    assert len({s.id_key for s in every}) == len(every)                      # no two share an id
    for s in every:
        assert s.loinc.code not in s.id_key and re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", s.id_key)


def test_every_local_id_is_hmn_a_fhir_id_and_ends_with_its_only_dot():
    made = [ids.patient("AB12C3D"), ids.patient_placeholder(ROOT), ids.practitioner(USER), ids.encounter(ROOT),
            *(ids.vital(ROOT, s.id_key, which) for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT)
              for which in (ids.FIRST, ids.LAST))]
    for local_id in made:
        assert ids.is_local_id(local_id), local_id
        assert len(local_id) <= 64
    assert ids.encounter(ROOT) == f"hmn-e-{ROOT}."
    assert ids.vital(ROOT, "heart-rate", "last") == f"hmn-v-{ROOT}-heart-rate-last."
    assert ids.vital(ROOT, codes.SIGNALS["spo2"].id_key, "first") == f"hmn-v-{ROOT}-spo2-first."
    assert ids.practitioner(USER) == f"hmn-pr-{USER}."
    for bad in ("hmn-l-12", "hmn-l-12.x.", "xmn-l-12.", "hmn-l 12.", "hmn-" + "x" * 64 + "."):
        assert not ids.is_local_id(bad), bad


def test_no_local_id_is_a_proper_prefix_of_another_in_any_case():
    """O20: the platform's search is by prefix and in any case. With one dot, at the end, none can be."""
    made = [ids.patient(fin) for fin in ("AB12C3D", "AB12C3E", "0000001")] + [
        ids.encounter(root) for root in (ROOT, OTHER)] + [
        ids.vital(root, s.id_key, which) for root in (ROOT, OTHER)
        for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT) for which in (ids.FIRST, ids.LAST)]
    for a, b in itertools.permutations(made, 2):
        assert not b.lower().startswith(a.lower()), (a, b)


def test_a_person_is_keyed_by_the_fin_digest_never_by_the_fin():
    assert ids.patient("AB12C3D") == ids.patient("AB12C3D") != ids.patient("AB12C3E")
    assert "AB12C3D" not in ids.patient("AB12C3D") and len(ids.patient("AB12C3D")) == len("hmn-p-") + 32 + 1
    with pytest.raises(ValueError):
        ids.vital(ROOT, "heart-rate", "middle")


def test_a_patient_id_is_made_from_the_normalised_fin_or_not_at_all():
    """`ids.patient` normalises through `az.normal_fin` itself: one person, one id however the FİN was
    typed — and a FİN the platform would not accept never gets an id (the message is a constant: a
    FİN is PHI and must not travel in an exception)."""
    assert ids.patient("ab12c3d") == ids.patient("AB12C3D") == ids.patient("  Ab12C3d ")
    for unusable in ("AB12C3", "ƏB12C3D", "ß12345", "", "   ", None):
        with pytest.raises(ValueError) as refused:
            ids.patient(unusable)
        assert str(refused.value) == ids.FIN_UNUSABLE
    with pytest.raises(ValueError) as refused:
        ids.patient("AB12C3")
    assert "AB12C3" not in str(refused.value) and "AB12C3" not in repr(refused.value)


@pytest.mark.parametrize("key", ["heart_rate", "Heart-Rate", "", "-heart", "heart-", "heart--rate", "heart.rate",
                                 "8867-4 ", "ürək", "x" * 20])
def test_a_vital_key_that_is_not_hyphenated_lower_case_words_is_refused(key):
    with pytest.raises(ValueError) as refused:
        ids.vital(ROOT, key, ids.FIRST)
    assert str(refused.value) == ids.VITAL_KEY_INVALID
