from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole


async def test_harness_boots_and_serves_own_hospital(world):
    nurse = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.get("/auth/me", headers=await world.token(nurse))
    assert r.status_code == 200
