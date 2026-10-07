"""O3 — MFA (TOTP) gizli anahtarı veritabanında şifreli durur; uygulama katmanı düz metni görür."""
from __future__ import annotations

import pyotp
from sqlalchemy import text

from sec_harness import world  # noqa: F401
from homunculus.auth.models import User, UserRole
from homunculus.auth.service import setup_totp


async def _raw_secret(world, user_id):
    async with world.maker() as s:
        row = await s.execute(text("SELECT totp_secret FROM users WHERE id = :i"),
                              {"i": user_id.hex})
        return row.scalar_one()


async def test_totp_secret_is_ciphertext_in_database(world):
    user = await world.add_user(world.a, "hemsire-a", UserRole.NURSE, totp=True)
    raw = await _raw_secret(world, user.id)
    assert raw.startswith("enc::v1::")


async def test_totp_secret_roundtrips_for_the_application(world):
    user = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.maker() as s:
        db_user = await s.get(User, user.id)
        secret, _uri = await setup_totp(s, db_user)
    raw = await _raw_secret(world, user.id)
    assert secret not in raw  # düz anahtar veritabanında görünmez
    async with world.maker() as s:
        assert (await s.get(User, user.id)).totp_secret == secret
        assert pyotp.TOTP(secret).verify(pyotp.TOTP(secret).now())
