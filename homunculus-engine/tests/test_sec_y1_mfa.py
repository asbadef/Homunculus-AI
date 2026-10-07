"""Y1 — MFA yönetici ve klinik rollerde zorunlu; yalnızca parolayla alınan anahtar ilerleyemez;
MFA zaten açıksa yeniden kurulum eski kodu ister."""
from __future__ import annotations

import pyotp
from sqlalchemy import select

from sec_harness import PASSWORD, world  # noqa: F401
from homunculus.auth.models import User, UserRole


async def _secret(world, user) -> str:
    async with world.maker() as s:
        return (await s.get(User, user.id)).totp_secret


async def _login(c, user):
    r = await c.post("/auth/login", json={"email": user.email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_password_only_token_is_blocked_for_mfa_roles(world):
    attending = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    async with world.client() as c:
        r = await c.get("/admissions", headers=await world.token(attending, mfa=False))
    assert r.status_code == 403
    assert "MFA" in r.json()["detail"]


async def test_mfa_role_without_enrolment_is_still_blocked(world):
    admin = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN)  # TOTP kurulu değil
    async with world.client() as c:
        r = await c.get(f"/tenant/tenants/{world.a.tenant_id}/sites",
                        headers=await world.token(admin, mfa=False))
    assert r.status_code == 403


async def test_nurse_without_mfa_can_work_but_enrolled_nurse_is_gated(world):
    plain = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    enrolled = await world.add_user(world.a, "hemsire-a2", UserRole.NURSE, totp=True)
    async with world.client() as c:
        ok = await c.get("/admissions", headers=await world.token(plain, mfa=False))
        gated = await c.get("/admissions", headers=await world.token(enrolled, mfa=False))
    assert ok.status_code == 200
    assert gated.status_code == 403


async def test_login_then_totp_verify_unlocks_access(world):
    attending = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    async with world.client() as c:
        tokens = await _login(c, attending)
        assert tokens["requires_mfa"] is True
        assert (await c.get("/admissions", headers=_bearer(tokens["access_token"]))).status_code == 403
        code = pyotp.TOTP(await _secret(world, attending)).now()
        v = await c.post("/auth/totp/verify", json={"code": code},
                         headers=_bearer(tokens["access_token"]))
        assert v.status_code == 200
        assert (await c.get("/admissions", headers=_bearer(v.json()["access_token"]))).status_code == 200


async def test_unenrolled_mfa_role_must_still_enrol_before_access(world):
    admin = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN)
    async with world.client() as c:
        tokens = await _login(c, admin)
        assert tokens["requires_mfa"] is True  # kurulum zorunlu
        h = _bearer(tokens["access_token"])
        assert (await c.get(f"/tenant/tenants/{world.a.tenant_id}/sites", headers=h)).status_code == 403
        assert (await c.post("/auth/totp/setup", headers=h)).status_code == 200  # ilk kurulum yolu açık


async def test_totp_reset_requires_current_code(world):
    attending = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    secret = await _secret(world, attending)
    async with world.client() as c:
        tokens = await _login(c, attending)
        pw_only = _bearer(tokens["access_token"])
        # Yalnızca parolayla: sıfırlama yok (kodsuz da, kodlu da MFA'sız anahtarla olmaz).
        assert (await c.post("/auth/totp/setup", headers=pw_only)).status_code == 403
        verified = _bearer((await c.post("/auth/totp/verify", json={"code": pyotp.TOTP(secret).now()},
                                         headers=pw_only)).json()["access_token"])
        assert (await c.post("/auth/totp/setup", headers=verified)).status_code in (400, 422)
        assert (await c.post("/auth/totp/setup", json={"current_code": "000000"},
                             headers=verified)).status_code == 401
        assert (await c.post("/auth/totp/setup", json={"current_code": pyotp.TOTP(secret).now()},
                             headers=verified)).status_code == 200
    async with world.maker() as s:
        assert (await s.get(User, attending.id)).totp_secret != secret


async def test_refresh_cannot_launder_mfa(world):
    attending = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    secret = await _secret(world, attending)
    async with world.client() as c:
        tokens = await _login(c, attending)
        r1 = await c.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert (await c.get("/admissions", headers=_bearer(r1.json()["access_token"]))).status_code == 403
        v = await c.post("/auth/totp/verify", json={"code": pyotp.TOTP(secret).now()},
                         headers=_bearer(tokens["access_token"]))
        r2 = await c.post("/auth/refresh", json={"refresh_token": v.json()["refresh_token"]})
        assert (await c.get("/admissions", headers=_bearer(r2.json()["access_token"]))).status_code == 200
