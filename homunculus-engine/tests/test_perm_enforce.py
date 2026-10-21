import pytest
from fastapi import HTTPException
from sqlalchemy import select

from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.security_audit import SecurityAuditEvent
from homunculus.permissions.service import ensure_action_allowed, grant_role_permission


async def test_uye_olmayan_404(world):
    # A üyesi ama B üyesi değil -> B'de 404 (varlık sızdırılmaz).
    u = await world.add_user(world.a, "yabanci", UserRole.NURSE, totp=True)
    async with world.maker() as s:
        with pytest.raises(HTTPException) as ei:
            await ensure_action_allowed(s, u, world.b.tenant_id, "lab_order.create", resource_type="lab_order")
    assert ei.value.status_code == 404


async def test_yetkisiz_403_ve_denetim_denied(world):
    u = await world.add_user(world.a, "baci", UserRole.NURSE, totp=True)
    async with world.maker() as s:
        with pytest.raises(HTTPException) as ei:
            await ensure_action_allowed(s, u, world.a.tenant_id, "invoice.discount", resource_type="invoice")
    assert ei.value.status_code == 403
    async with world.maker() as s:
        rows = (await s.execute(
            select(SecurityAuditEvent).where(SecurityAuditEvent.action == "invoice.discount")
        )).scalars().all()
    assert any(r.outcome == "denied" for r in rows)


async def test_yetkili_gecer_ve_denetim_allowed(world):
    u = await world.add_user(world.a, "hekim", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.ATTENDING,
                                    action="lab_order.create", granted_by=u)
        await s.commit()
        await ensure_action_allowed(s, u, world.a.tenant_id, "lab_order.create", resource_type="lab_order")
        await s.commit()
    async with world.maker() as s:
        rows = (await s.execute(
            select(SecurityAuditEvent).where(SecurityAuditEvent.action == "lab_order.create")
        )).scalars().all()
    assert any(r.outcome == "allowed" for r in rows)
