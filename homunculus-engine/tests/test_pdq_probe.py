# homunculus-engine/tests/test_pdq_probe.py
"""scripts/pdq_probe.py (G2-B1d, the local walk): one synthetic QBP^Q22 in NCE's own shape, and a
summary of the reply that names no patient unless asked (`--show-name`, synthetic data only).
Loaded by path, as tests/test_run_bridge_identity.py loads run_bridge."""
import importlib.util
import pathlib

from homunculus.edge.pdq import NOT_FOUND, patient_query_response, queried_patient_id

_spec = importlib.util.spec_from_file_location(
    "pdq_probe", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "pdq_probe.py")
pdq_probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pdq_probe)


def _known(number):
    from homunculus.edge.adt import PatientIdentity
    return PatientIdentity(patient_id=number, given="Test Hasta", birth_date="1970-05-05", sex="female")


def test_the_query_is_ncess_shape_for_the_number():
    message = pdq_probe.build_qbp("202600000001", control_id="P1")
    qpd = next(s.split("|") for s in message.split("\r") if s.startswith("QPD|"))
    assert queried_patient_id(qpd) == "202600000001"
    assert patient_query_response(message) is not None


def test_the_summary_names_no_patient_unless_asked():
    reply = patient_query_response(pdq_probe.build_qbp("202600000001"), lookup=_known)
    line = pdq_probe.summarise(reply)
    assert line == "MSA=AA QAK=OK PID=evet ad=evet doğum=evet cinsiyet=F"
    assert "Test Hasta" not in line and "202600000001" not in line
    assert "ad=Test Hasta" in pdq_probe.summarise(reply, show_name=True)


def test_not_found_and_the_echo_are_told_apart():
    nf = patient_query_response(pdq_probe.build_qbp("202600000009"), lookup=lambda _n: NOT_FOUND)
    echo = patient_query_response(pdq_probe.build_qbp("202600000009"), lookup=lambda _n: None)
    assert pdq_probe.summarise(nf) == "MSA=AA QAK=NF PID=yok"
    assert pdq_probe.summarise(echo) == "MSA=AA QAK=OK PID=evet ad=yok doğum=yok cinsiyet=-"
