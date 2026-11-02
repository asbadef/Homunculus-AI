"""Production identity store against a dedicated test database, when configured."""
import importlib.util
from pathlib import Path
from datetime import timedelta

import pytest
from sqlalchemy import text

from homunculus.api.patient_identity import parse_fhir_patient, parse_fhir_encounter
from homunculus.api.patient_identity_postgres import PostgresIdentityStore
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_api_patient_identity import PATIENT, ENCOUNTER, WHEN


def test_identity_migration_follows_the_audit_migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0005_patient_identity.py"
    spec = importlib.util.spec_from_file_location("identity_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "0005" and module.down_revision == "0004"


def _provisioned() -> PostgresIdentityStore:
    """The store, on the table alembic provisions — not a hand-maintained duplicate: 0005, 0006
    (`diagnoses`) and 0012's two identity columns (`bed_id`, `unit_id`)."""
    store = PostgresIdentityStore(TEST_DATABASE_URL)
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0005_patient_identity.py"
    modules = []
    for name in ("0005_patient_identity", "0006_identity_diagnoses", "0012_admission_kabul"):
        spec = importlib.util.spec_from_file_location(f"identity_{name[:4]}", path.with_name(name + ".py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    with store._engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            for module in modules[:2]:
                module.upgrade()
        for statement in modules[2].IDENTITY_COLUMNS:
            conn.execute(text(statement))
    return store


@requires_db
def test_postgres_identity_retention_is_encrypted_tenant_scoped_and_durable():
    import uuid
    hospital = f"identity-test-{uuid.uuid4()}"
    store = _provisioned()
    try:
        store.apply(hospital, parse_fhir_patient(PATIENT))
        store.apply(hospital, parse_fhir_encounter(ENCOUNTER))
        assert store.get(hospital, "20239121").bed_label == "YB 304-2"
        assert store.get(hospital + "-other", "20239121") is None
        with store._engine.connect() as conn:
            value = conn.execute(text("SELECT family FROM patient_identity WHERE tenant=:tenant"),
                                 {"tenant": hospital}).scalar_one()
            assert value.startswith("enc::v1::") and "YILMAZ" not in value
        stale = {**PATIENT, "meta": {"lastUpdated": (WHEN - timedelta(hours=1)).isoformat(),
                                     "source": "comed"}}
        assert store.apply(hospital, parse_fhir_patient(stale)) is None
        store.close()
        store = PostgresIdentityStore(TEST_DATABASE_URL)
        assert store.get(hospital, "20239121").display_name == "AYSE YILMAZ"
    finally:
        with store._engine.begin() as conn:
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()


@requires_db
def test_a_kabul_record_keeps_its_bed_and_its_tombstone_is_never_pruned():
    """G2-B1a: the record's own bed and unit survive a reconnect; a discharged `kabul` record is
    kept past the 24 hours, a discharged HIS one is not."""
    import uuid
    from datetime import datetime, timezone

    from homunculus.api.patient_identity import IdentityRecord

    hospital = f"identity-test-{uuid.uuid4()}"
    store = _provisioned()
    t0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
    try:
        store.apply(hospital, IdentityRecord(patient_id="H2600001", given="Sentetik", bed="1A",
                                             state="admitted", source="kabul", updated_at=t0,
                                             bed_id="bed-uuid", unit_id="unit-uuid"))
        store.apply(hospital, IdentityRecord(patient_id="H2600001", state="discharged",
                                             source="kabul", updated_at=t0 + timedelta(hours=1)))
        store.apply(hospital, IdentityRecord(patient_id="20239121", given="HIS", bed="2",
                                             state="discharged", source="comed", updated_at=t0))
        store.close()
        store = PostgresIdentityStore(TEST_DATABASE_URL)
        tomb = store.get(hospital, "H2600001")
        assert (tomb.state, tomb.bed, tomb.bed_id, tomb.unit_id) == \
            ("discharged", "", "bed-uuid", "unit-uuid")
        later = t0 + timedelta(days=30)
        assert [r.patient_id for r in store.expired(hospital, later)] == ["20239121"]
        store.prune(later)
        assert store.get(hospital, "H2600001") is not None
        assert store.get(hospital, "20239121") is None
    finally:
        with store._engine.begin() as conn:
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()


@requires_db
def test_a_kabul_tombstone_is_off_the_inventory_and_no_other_feed_rewrites_a_kabul_record():
    """G2-B1a (Task 5 review): `patient_ids` never lists a tombstone, a discharged HIS record it
    still does; a manual write, a HIS revival and a manual encounter — all newer than the record —
    are each refused for a `kabul` record, admitted or discharged, and change nothing."""
    import uuid
    from datetime import datetime, timezone

    from homunculus.api.patient_identity import IdentityRecord

    hospital = f"identity-test-{uuid.uuid4()}"
    store = _provisioned()
    t0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
    newer = {"lastUpdated": (t0 + timedelta(hours=2)).isoformat()}
    try:
        store.apply(hospital, IdentityRecord(patient_id="H2600001", given="Sentetik", bed="1A",
                                             state="admitted", source="kabul", updated_at=t0,
                                             bed_id="bed-uuid", unit_id="unit-uuid"))
        store.apply(hospital, IdentityRecord(patient_id="H2600001", state="discharged",
                                             source="kabul", updated_at=t0 + timedelta(hours=1)))
        store.apply(hospital, IdentityRecord(patient_id="H2600002", given="Sentetik", bed="1B",
                                             state="admitted", source="kabul", updated_at=t0,
                                             bed_id="bed-uuid-2", unit_id="unit-uuid"))
        store.apply(hospital, IdentityRecord(patient_id="20239121", given="HIS", bed="2",
                                             state="discharged", source="comed", updated_at=t0))
        assert store.patient_ids(hospital) == ["20239121", "H2600002"]
        assert store.admitted_ids(hospital) == ["H2600002"]
        for pid in ("H2600001", "H2600002"):
            before = store.get(hospital, pid)
            ident = [{"system": "http://homunculus.local/protocol-no", "value": pid}]
            for incoming in (
                parse_fhir_patient({**PATIENT, "identifier": ident,
                                    "meta": {**newer, "source": "manuel"}}),
                parse_fhir_patient({**PATIENT, "identifier": ident, "active": True,
                                    "meta": {**newer, "source": "comed"}}),
                parse_fhir_encounter({**ENCOUNTER, "subject": {"reference": f"Patient/{pid}"},
                                      "meta": {**newer, "source": "manuel"}}),
            ):
                assert store.apply(hospital, incoming) is None
            assert store.get(hospital, pid) == before
    finally:
        with store._engine.begin() as conn:
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()
