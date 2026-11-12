# homunculus-engine/tests/test_tres_codes.py
"""TRƏS-01 (spec D5, D10, D12; plan F1, O20): the checked codes and the local ids.

The codes are pinned EXACTLY as the terminology server answered them on 2026-11-12 (tres/codes.py
names the server): a change to one fails here until its line is looked up again and both move
together. The local ids: `hmn-`, a valid FHIR id, one dot at the end — so no id is a proper prefix
of another (O20) — and a person's id from the FİN, never the row. No database, synthetic ids only."""
from __future__ import annotations

import itertools
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
    assert all(s.loinc.system == codes.LOINC == "http://loinc.org" for s in (*codes.SIGNALS.values(), codes.WEIGHT))
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


def test_every_local_id_is_hmn_a_fhir_id_and_ends_with_its_only_dot():
    made = [ids.patient("AB12C3D"), ids.patient_placeholder(ROOT), ids.practitioner(USER), ids.encounter(ROOT),
            *(ids.vital(ROOT, s.loinc.code, which) for s in (*codes.SIGNALS.values(), codes.WEIGHT, codes.HEIGHT)
              for which in (ids.FIRST, ids.LAST))]
    for local_id in made:
        assert ids.is_local_id(local_id), local_id
        assert len(local_id) <= 64
    assert ids.encounter(ROOT) == f"hmn-e-{ROOT}."
    assert ids.vital(ROOT, "8867-4", "last") == f"hmn-v-{ROOT}-8867-4-last."
    assert ids.practitioner(USER) == f"hmn-pr-{USER}."
    for bad in ("hmn-l-12", "hmn-l-12.x.", "xmn-l-12.", "hmn-l 12.", "hmn-" + "x" * 64 + "."):
        assert not ids.is_local_id(bad), bad


def test_no_local_id_is_a_proper_prefix_of_another_in_any_case():
    """O20: the platform's search is by prefix and in any case. With one dot, at the end, none can be."""
    made = [ids.patient(fin) for fin in ("AB12C3D", "AB12C3E", "0000001")] + [
        ids.encounter(root) for root in (ROOT, OTHER)] + [
        ids.vital(root, s.loinc.code, which) for root in (ROOT, OTHER) for s in codes.SIGNALS.values()
        for which in (ids.FIRST, ids.LAST)]
    for a, b in itertools.permutations(made, 2):
        assert not b.lower().startswith(a.lower()), (a, b)


def test_a_person_is_keyed_by_the_fin_digest_never_by_the_fin():
    assert ids.patient("AB12C3D") == ids.patient("AB12C3D") != ids.patient("AB12C3E")
    assert "AB12C3D" not in ids.patient("AB12C3D") and len(ids.patient("AB12C3D")) == len("hmn-p-") + 32 + 1
    with pytest.raises(ValueError):
        ids.vital(ROOT, "8867-4", "middle")
