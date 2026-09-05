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


@requires_db
def test_postgres_identity_retention_is_encrypted_tenant_scoped_and_durable():
    import uuid
    hospital = f"identity-test-{uuid.uuid4()}"
    store = PostgresIdentityStore(TEST_DATABASE_URL)
    # The real schema is provisioned by alembic, not a hand-maintained duplicate.
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0005_patient_identity.py"
    spec = importlib.util.spec_from_file_location("identity_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with store._engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
    try:
        store.apply(hospital, parse_fhir_patient(PATIENT))
        store.apply(hospital, parse_fhir_encounter(ENCOUNTER))
        assert store.get(hospital, "20239121").bed_label == "YB 304-2"
        assert store.get(hospital + "-other", "20239121") is None
        with store._engine.connect() as conn:
            value = conn.execute(text("SELECT family FROM patient_identity WHERE tenant=:tenant"),
                                 {"tenant": hospital}).scalar_one()
            assert value.startswith("enc::v1::") and "YILMAZ" not in value
        stale = {**PATIENT, "meta": {"lastUpdated": (WHEN - timedelta(hours=1)).isoformat()}}
        assert store.apply(hospital, parse_fhir_patient(stale)) is None
        store.close()
        store = PostgresIdentityStore(TEST_DATABASE_URL)
        assert store.get(hospital, "20239121").display_name == "AYSE YILMAZ"
    finally:
        with store._engine.begin() as conn:
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()
