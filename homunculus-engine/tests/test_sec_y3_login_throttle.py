"""Y3 — giriş deneme sınırı: hesap bazlı + IP bazlı, geçici kilit; TOTP kodu da kaba kuvvete kapalı."""
from __future__ import annotations

import pyotp

from sec_harness import PASSWORD, world  # noqa: F401
from homunculus.auth import throttle
from homunculus.auth.models import User, UserRole


async def _login(c, email, password, ip=None):
    h = {"X-Forwarded-For": ip} if ip else {}
    return await c.post("/auth/login", json={"email": email, "password": password}, headers=h)


async def test_account_locks_after_repeated_failures_even_for_correct_password(world):
    nurse = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    limit = throttle.limiter.account_max
    async with world.client() as c:
        for _ in range(limit):
            assert (await _login(c, nurse.email, "yanlis-parola")).status_code == 401
        locked = await _login(c, nurse.email, PASSWORD)  # doğru parola bile kilitliyken geçmez
        assert locked.status_code == 429
        assert int(locked.headers["Retry-After"]) > 0


async def test_lock_is_temporary(world):
    nurse = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        for _ in range(throttle.limiter.account_max):
            await _login(c, nurse.email, "yanlis-parola")
        assert (await _login(c, nurse.email, PASSWORD)).status_code == 429
        throttle.limiter.advance_clock(throttle.limiter.lock_seconds + 1)  # test saati
        assert (await _login(c, nurse.email, PASSWORD)).status_code == 200


async def test_success_resets_the_account_counter(world):
    nurse = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        for _ in range(throttle.limiter.account_max - 1):
            await _login(c, nurse.email, "yanlis-parola")
        assert (await _login(c, nurse.email, PASSWORD)).status_code == 200
        for _ in range(throttle.limiter.account_max - 1):
            assert (await _login(c, nurse.email, "yanlis-parola")).status_code == 401


async def test_one_ip_spraying_many_accounts_is_blocked(world):
    async with world.client() as c:
        for i in range(throttle.limiter.ip_max):
            r = await _login(c, f"yok-{i}@example.com", "x")
            assert r.status_code == 401
        blocked = await _login(c, "baska@example.com", "x")
    assert blocked.status_code == 429


async def test_unknown_account_is_throttled_like_a_known_one(world):
    async with world.client() as c:
        codes = [(await _login(c, "hayalet@example.com", "x")).status_code
                 for _ in range(throttle.limiter.account_max + 1)]
    assert codes[-1] == 429  # hesap varlığı sınırlama davranışından sızmaz


async def test_totp_code_guessing_is_limited(world):
    attending = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    async with world.client() as c:
        tokens = (await _login(c, attending.email, PASSWORD)).json()
        h = {"Authorization": f"Bearer {tokens['access_token']}"}
        for _ in range(throttle.limiter.account_max):
            assert (await c.post("/auth/totp/verify", json={"code": "000000"}, headers=h)).status_code == 401
        async with world.maker() as s:
            secret = (await s.get(User, attending.id)).totp_secret
        right = await c.post("/auth/totp/verify", json={"code": pyotp.TOTP(secret).now()}, headers=h)
    assert right.status_code == 429
