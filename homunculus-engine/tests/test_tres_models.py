# homunculus-engine/tests/test_tres_models.py
"""TRƏS-01 (spec D3, D6): the two tables as the models map them — the defaults (mode `off`,
environment `test`, every type on, 24 hours), the CHECKs, the ledger's key with the environment in
it, the password and the platform's message encrypted at rest, both gone with their tenant — and
`account_of`, which needs no database. The DB part runs on Postgres. Synthetic tenant only."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresAccount
from homunculus.tres.models import (
    ACCOUNT_FIELDS, ENVIRONMENTS, MODES, OPERATIONS, RESOURCE_TYPES, SESSION_FIELDS, STATUSES,
    TresDelivery, TresSettings, account_of,
)
from tests.conftest import requires_db


# ---------------------------------------------------------------- no database
def test_the_vocabulary_is_the_specs():
    assert RESOURCE_TYPES == ("patient", "practitioner", "encounter", "condition", "procedure",
                              "vital", "lab", "composition")
    assert MODES == ("off", "validate", "send") and ENVIRONMENTS == ("test", "live")
    assert STATUSES == ("pending", "sent", "validated", "failed", "skipped", "stuck", "deleted")
    assert OPERATIONS == ("create", "update", "validate", "delete")
    assert set(SESSION_FIELDS) < set(ACCOUNT_FIELDS)
    for prefix in ENVIRONMENTS:
        for name in ACCOUNT_FIELDS:
            assert hasattr(TresSettings, f"{prefix}_{name}")


def _settings(**values) -> TresSettings:
    return TresSettings(tenant_id=uuid.uuid4(), mode="send", environment="test", **values)


def test_the_account_is_the_selected_environments_and_only_when_whole():
    whole = _settings(test_base_url="https://tres.test", test_username="sentetik",
                      test_password="gizli-parola", test_provider_id="PRV-0001")
    assert account_of(whole) == TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
    assert account_of(whole, "live") is None            # the other environment has nothing
    whole.environment = "live"
    assert account_of(whole) is None
    assert account_of(whole, "test") is not None
    for missing in ("test_base_url", "test_username", "test_password", "test_provider_id"):
        partial = _settings(test_base_url="https://tres.test", test_username="sentetik",
                            test_password="gizli-parola", test_provider_id="PRV-0001")
        setattr(partial, missing, None)
        assert account_of(partial) is None, missing
        setattr(partial, missing, "  ")
        assert account_of(partial) is None, missing


# ---------------------------------------------------------------- Postgres
async def _tenant(db, slug: str = "tres-hastane") -> Tenant:
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug=slug, country_code="AZ", timezone="Asia/Baku")
    db.add(tenant)
    await db.commit()
    return tenant


@requires_db
async def test_a_settings_row_defaults_to_off_test_every_type_and_24_hours(db_session):
    tenant = await _tenant(db_session)
    db_session.add(TresSettings(tenant_id=tenant.id))
    await db_session.commit()
    db_session.expire_all()
    row = (await db_session.execute(select(TresSettings))).scalar_one()
    assert (row.mode, row.environment, row.settle_hours) == ("off", "test", 24)
    assert row.enabled_types == list(RESOURCE_TYPES)
    assert row.test_password is None and row.live_base_url is None
    assert row.updated_at is not None and row.updated_by is None
    # …and the database's own defaults say the same, for a row written without the model.
    other = await _tenant(db_session, "tres-hastane-2")
    await db_session.execute(text("INSERT INTO tres_settings (tenant_id) VALUES (:t)"), {"t": other.id})
    await db_session.commit()
    raw = (await db_session.execute(text(
        "SELECT mode, environment, settle_hours, enabled_types::text FROM tres_settings WHERE tenant_id = :t"),
        {"t": other.id})).one()
    assert tuple(raw[:3]) == ("off", "test", 24)
    assert raw[3].replace(" ", "") == '["patient","practitioner","encounter","condition","procedure","vital","lab","composition"]'


@requires_db
@pytest.mark.parametrize("values", [{"mode": "on"}, {"environment": "prod"}, {"settle_hours": -1},
                                    {"settle_hours": 169}])
async def test_the_settings_checks_refuse(db_session, values):
    tenant = await _tenant(db_session)
    db_session.add(TresSettings(tenant_id=tenant.id, **values))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@requires_db
async def test_the_password_is_ciphertext_at_rest_and_plain_to_the_model(db_session):
    tenant = await _tenant(db_session)
    db_session.add(TresSettings(tenant_id=tenant.id, test_password="gizli-parola", live_password="canlı-parola"))
    await db_session.commit()
    stored = (await db_session.execute(text("SELECT test_password, live_password FROM tres_settings"))).one()
    for value, plain in zip(stored, ("gizli-parola", "canlı-parola")):
        assert value.startswith("enc::v1::") and plain not in value
    db_session.expire_all()
    row = (await db_session.execute(select(TresSettings))).scalar_one()
    assert (row.test_password, row.live_password) == ("gizli-parola", "canlı-parola")


def _delivery(tenant: Tenant, **values) -> TresDelivery:
    return TresDelivery(**{"tenant_id": tenant.id, "environment": "test", "resource_type": "patient",
                           "local_id": "hmn-p-0001", **values})


@requires_db
async def test_a_delivery_starts_pending_and_its_message_is_ciphertext_at_rest(db_session):
    tenant = await _tenant(db_session)
    db_session.add(_delivery(tenant, last_error="Patient.name: Sentetik Ayşe"))
    await db_session.commit()
    stored = (await db_session.execute(text("SELECT last_error FROM tres_deliveries"))).scalar_one()
    assert stored.startswith("enc::v1::") and "Sentetik" not in stored
    db_session.expire_all()
    row = (await db_session.execute(select(TresDelivery))).scalar_one()
    assert (row.status, row.attempts, row.operation, row.remote_id, row.payload_digest) == (
        "pending", 0, None, None, None)
    assert row.last_error == "Patient.name: Sentetik Ayşe"
    assert row.created_at is not None and row.updated_at is not None


@requires_db
async def test_one_row_per_tenant_environment_type_and_local_id(db_session):
    tenant = await _tenant(db_session)
    db_session.add_all([_delivery(tenant), _delivery(tenant, environment="live"),
                        _delivery(tenant, resource_type="practitioner"),
                        _delivery(tenant, local_id="hmn-p-0002")])
    await db_session.commit()                             # four different keys
    db_session.add(_delivery(tenant))
    with pytest.raises(IntegrityError, match="uq_tres_deliveries_key"):
        await db_session.commit()


@requires_db
@pytest.mark.parametrize("values", [{"status": "done"}, {"operation": "patch"}, {"environment": "prod"}])
async def test_the_delivery_checks_refuse(db_session, values):
    tenant = await _tenant(db_session)
    db_session.add(_delivery(tenant, **values))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@requires_db
async def test_both_tables_go_with_their_tenant(db_session):
    tenant = await _tenant(db_session)
    db_session.add_all([TresSettings(tenant_id=tenant.id), _delivery(tenant)])
    await db_session.commit()
    await db_session.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant.id})
    await db_session.commit()
    for table in ("tres_settings", "tres_deliveries"):
        assert (await db_session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one() == 0
