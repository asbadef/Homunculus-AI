"""O6 — geçiş betiği: kuru çalıştırma yazmaz, --apply düz metni şifreler, tekrar çalıştırmak zararsız."""
from __future__ import annotations

import importlib.util
import pathlib
import uuid

import sqlalchemy as sa

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "encrypt_legacy_phi.py"
spec = importlib.util.spec_from_file_location("encrypt_legacy_phi", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def _engine():
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.ext.compiler import compiles

    @compiles(JSONB, "sqlite")
    def _j(_t, _c, **kw):  # pragma: no cover
        return "JSON"

    e = sa.create_engine("sqlite://")
    mod.Base.metadata.create_all(e)
    return e


def test_dry_run_apply_and_idempotent():
    e = _engine()
    uid = uuid.uuid4().hex
    with e.begin() as c:
        c.execute(sa.text("INSERT INTO users (id,email,full_name,hashed_password,totp_secret,"
                          "totp_enabled,is_active,is_platform_support,created_at,updated_at) VALUES "
                          "(:i,'s@x.example','S','h','DUZSIR',1,1,0,'2026-01-01','2026-01-01')"), {"i": uid})
    assert mod.migrate(e, apply=False)["users.totp_secret"] == 1
    with e.connect() as c:
        assert c.execute(sa.text("SELECT totp_secret FROM users")).scalar_one() == "DUZSIR"
    assert mod.migrate(e, apply=True)["users.totp_secret"] == 1
    with e.connect() as c:
        raw = c.execute(sa.text("SELECT totp_secret FROM users")).scalar_one()
    assert raw.startswith("enc::v1::") and "DUZSIR" not in raw
    assert mod.migrate(e, apply=True)["users.totp_secret"] == 0
