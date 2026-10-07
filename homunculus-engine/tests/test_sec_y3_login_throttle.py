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


async def test_spoofed_x_forwarded_for_does_not_evade_ip_limit(world):
    async with world.client() as c:
        for i in range(throttle.limiter.ip_max):
            r = await _login(c, f"yok{i}@example.com", "yanlis", ip=f"10.0.{i}.1")  # her istekte sahte IP
            assert r.status_code == 401
        blocked = await _login(c, "baska@example.com", "yanlis", ip="203.0.113.77")
    assert blocked.status_code == 429


async def test_expired_failure_records_are_purged(world):
    async with world.client() as c:
        for i in range(10):
            await _login(c, f"yok{i}@example.com", "yanlis")
    assert len(throttle.limiter._failures) > 0
    throttle.limiter.advance_clock(throttle.limiter.window_seconds + throttle.limiter.lock_seconds + 1)
    async with world.client() as c:
        await _login(c, "tetik@example.com", "yanlis")  # bakım bir sonraki işlemde çalışır
    # yalnızca bu son denemenin kayıtları (hesap + IP) kalır
    assert len(throttle.limiter._failures) <= 2
    assert len(throttle.limiter._locked_until) == 0


async def test_totp_setup_current_code_attempts_are_limited(world):
    attending = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    h = await world.token(attending)
    secret = attending.totp_secret
    async with world.client() as c:
        for _ in range(throttle.limiter.account_max):
            r = await c.post("/auth/totp/setup", json={"current_code": "000000"}, headers=h)
            assert r.status_code == 401
        locked = await c.post("/auth/totp/setup", json={"current_code": pyotp.TOTP(secret).now()}, headers=h)
    assert locked.status_code == 429
