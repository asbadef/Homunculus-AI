# Faz 0.1 — İnce Yetki (Action-Level Permission) Modeli — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hangi rolün/kullanıcının bir hastanede hangi eylemi yapabileceğini tutan, hastane sınırına ve denetim kaydına bağlı bir arka uç yetki çekirdeği kurmak.

**Architecture:** Yeni bir `permissions/` modülü. `permission_grants` tablosu izinleri taşır (rol bazlı ALLOW + kullanıcı bazlı ALLOW/DENY istisnaları). Çözümleme kuralı: kullanıcı-DENY > kullanıcı-ALLOW > rol-ALLOW; eşleşme yoksa reddedilir (fail-closed). Yetki kontrolü mevcut `auth.access` (hastane sınırı) ve `security_audit.record` (denetim) üstüne oturur; eşleşme hep belirli bir tenant içinde yapılır.

**Tech Stack:** Python ≥3.12, FastAPI, SQLAlchemy 2.0 async, Alembic, Postgres (testlerde SQLite+aiosqlite), pytest + pytest-asyncio (`asyncio_mode=auto`), httpx.AsyncClient (ASGITransport).

**Spec:** `docs/superpowers/specs/2026-10-21-hastane-sistemi-yol-haritasi-design.md`

## Global Constraints

- Hastane sınırı (tenant) kuralı delinmez: her yetki kontrolü **belirli bir tenant içinde** yapılır; başka hastanede tutulan rol o hastanede sayılmaz. Üye olmayan için **404**, üye ama yetkisiz için **403**.
- Denetim kaydına **PHI yazılmaz** (`detail` yalnızca eylem/kod/kimlik id'leri).
- Fail-closed: tanımsız/eşleşmeyen eylem **reddedilir**, asla varsayılan olarak serbest değildir.
- Kod yorumları ve test adları **Türkçe** (proje kuralı). Sentetik veri.
- İsimlendirme: üründe rakip adı geçmez; eylem kodları iç kullanım için `kaynak.fiil` biçiminde snake_case (ör. `lab_order.create`).
- Mevcut desenler korunur: UUID PK + `created_at` kalıbı satır içi; `Enum(UserRole)`; `get_db` + `get_current_active_user` bağımlılıkları.

## Review Focus

- **Tanımsız eylem** (hiç izin tanımı yok) → fail-closed, reddedilmeli. → Task 2 testleri.
- **Kullanıcı-DENY, rol-ALLOW'u ezmeli** (istisna: "bu kullanıcı bu formu yapamaz"). → Task 2 testi `test_kullanici_deny_rol_allowu_ezer`.
- **Hastane sınırı:** A'da verilen rol izni B'de eylemi serbest bırakmamalı. → Task 2 testi `test_baska_hastanedeki_izin_sayilmaz`.
- **Çapraz hastane yönetimi:** A yöneticisi B'ye ait bir izni listeleyemez/silemez. → Task 4 testleri (403 / 404).
- **Çoklu rol:** kullanıcının bir rolü izinliyse (diğeri değilse) eylem serbest olmalı. → Task 2 testi `test_rollerden_biri_izinliyse_serbest`.

---

### Task 1: Yetki veri modeli + göç (migration)

**Files:**
- Create: `homunculus-engine/src/homunculus/permissions/__init__.py`
- Create: `homunculus-engine/src/homunculus/permissions/models.py`
- Create: `homunculus-engine/alembic/versions/0006_permission_grants.py`
- Modify: `homunculus-engine/tests/conftest.py` (model import bloğuna ekle)
- Modify: `homunculus-engine/alembic/env.py` (model import bloğuna ekle)
- Test: `homunculus-engine/tests/test_perm_model.py`

**Interfaces:**
- Produces:
  - `class PermissionEffect(str, enum.Enum): ALLOW = "allow"; DENY = "deny"`
  - `class PermissionGrant(Base)` — `__tablename__ = "permission_grants"`, kolonlar:
    `id: uuid.UUID` (PK, default uuid4), `tenant_id: uuid.UUID` (FK `tenants.id` ondelete CASCADE, not null, index), `action: str` (String(64), not null, index), `role: UserRole | None` (`Enum(UserRole)`, nullable), `user_id: uuid.UUID | None` (FK `users.id` ondelete CASCADE, nullable, index), `effect: str` (String(8), not null), `granted_by_id: uuid.UUID | None` (FK `users.id` ondelete SET NULL, nullable), `is_active: bool` (not null, default True), `created_at: datetime` (DateTime tz, default now).
  - Tablo kısıtı (role XOR user_id): `CheckConstraint("(CASE WHEN role IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) = 1", name="ck_permission_grants_role_xor_user")`.

- [ ] **Step 1: Failing testi yaz** — `tests/test_perm_model.py`

```python
from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.permissions.models import PermissionGrant, PermissionEffect

async def test_izin_satiri_yazilip_okunabilir(world):
    async with world.maker() as s:
        s.add(PermissionGrant(tenant_id=world.a.tenant_id, action="lab_order.create",
                              role=UserRole.ATTENDING, effect=PermissionEffect.ALLOW.value))
        await s.commit()
    async with world.maker() as s:
        rows = (await s.execute(__import__("sqlalchemy").select(PermissionGrant))).scalars().all()
        assert len(rows) == 1 and rows[0].action == "lab_order.create"
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `cd homunculus-engine && pytest tests/test_perm_model.py -v` → FAIL (`ModuleNotFoundError: homunculus.permissions`).

- [ ] **Step 3: Modeli uygula** — `permissions/__init__.py` (boş) ve `permissions/models.py` içinde `PermissionEffect` ve `PermissionGrant`'ı Interfaces'teki kolonlarla yaz. UUID PK + `created_at` kalıbını `auth/models.py`'den birebir kopyala (`from homunculus.db import Base`, `from sqlalchemy.dialects.postgresql import UUID`). `conftest.py` ve `alembic/env.py` içindeki model-import bloğuna `import homunculus.permissions.models  # noqa: F401` satırını ekle (SQLite testlerinde ve autogenerate'te tablo kaydı için).

- [ ] **Step 4: Göçü yaz** — `0006_permission_grants.py`, `revision="0006"`, `down_revision="0005"`. `upgrade()` içinde `op.create_table("permission_grants", ...)` ile yukarıdaki kolonları (`postgresql.UUID(as_uuid=True)`, `sa.String`, `sa.Enum(UserRole)`, `sa.Boolean`, `sa.DateTime(timezone=True)`, FK'ler, CheckConstraint, index'ler) oluştur; `downgrade()` içinde `op.drop_table("permission_grants")`.

- [ ] **Step 5: Testi çalıştır, geçsin** — `pytest tests/test_perm_model.py -v` → PASS.

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/permissions/ homunculus-engine/alembic/versions/0006_permission_grants.py homunculus-engine/tests/test_perm_model.py homunculus-engine/tests/conftest.py homunculus-engine/alembic/env.py
git commit -m "yetki(F0): permission_grants modeli ve 0006 goc"
```

---

### Task 2: Çözümleme — `action_allowed` ve izin verme yardımcıları

**Files:**
- Create: `homunculus-engine/src/homunculus/permissions/service.py`
- Test: `homunculus-engine/tests/test_perm_resolve.py`

**Interfaces:**
- Consumes: `homunculus.auth.access.roles_in_tenant(db, user, tenant_id) -> set[UserRole]`; `PermissionGrant`, `PermissionEffect` (Task 1).
- Produces:
  - `async def action_allowed(db: AsyncSession, user: User, tenant_id: uuid.UUID, action: str) -> bool`
  - `async def grant_role_permission(db, *, tenant_id: uuid.UUID, role: UserRole, action: str, granted_by: User) -> PermissionGrant`
  - `async def grant_user_permission(db, *, tenant_id: uuid.UUID, user_id: uuid.UUID, action: str, effect: PermissionEffect, granted_by: User) -> PermissionGrant`
- Çözümleme kuralı (action_allowed): o tenant'ta `is_active` grant'lar okunur → kullanıcıya ait DENY varsa `False`; kullanıcıya ait ALLOW varsa `True`; kullanıcının rollerinden biri için ALLOW varsa `True`; yoksa `False`. Roller `roles_in_tenant` ile alınır (hastane sınırı buradan gelir).

- [ ] **Step 1: Failing testleri yaz** — `tests/test_perm_resolve.py`

```python
from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.permissions.models import PermissionEffect
from homunculus.permissions.service import action_allowed, grant_role_permission, grant_user_permission

async def test_rol_izni_verilince_serbest(world):
    u = await world.add_user(world.a, "hekim", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.ATTENDING, action="lab_order.create", granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "lab_order.create") is True

async def test_izin_yoksa_kapali(world):          # fail-closed / tanımsız eylem
    u = await world.add_user(world.a, "hekim2", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        assert await action_allowed(s, u, world.a.tenant_id, "lab_order.create") is False

async def test_kullanici_deny_rol_allowu_ezer(world):
    u = await world.add_user(world.a, "istisna", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.ATTENDING, action="exam.print", granted_by=u)
        await grant_user_permission(s, tenant_id=world.a.tenant_id, user_id=u.id, action="exam.print", effect=PermissionEffect.DENY, granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "exam.print") is False

async def test_baska_hastanedeki_izin_sayilmaz(world):
    u = await world.add_user(world.a, "sinir", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.b.tenant_id, role=UserRole.ATTENDING, action="lab_order.create", granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "lab_order.create") is False

async def test_rollerden_biri_izinliyse_serbest(world):
    u = await world.add_user(world.a, "cokrol", UserRole.NURSE, totp=True)
    async with world.maker() as s:
        s.add(__import__("homunculus.auth.models", fromlist=["TenantMembership"]).TenantMembership(
            user_id=u.id, tenant_id=world.a.tenant_id, role=UserRole.CHARGE_NURSE))
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.CHARGE_NURSE, action="sample.accept", granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "sample.accept") is True
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `pytest tests/test_perm_resolve.py -v` → FAIL (`cannot import name ... from homunculus.permissions.service`).

- [ ] **Step 3: Servisi uygula** — `permissions/service.py` içinde Interfaces'teki üç fonksiyonu yaz. `action_allowed` çözümleme kuralını uygular (tek `select(PermissionGrant).where(tenant_id, action, is_active==True)` sorgusu + Python'da DENY/ALLOW/rol değerlendirmesi). `grant_role_permission` yalnızca `role` alanını (effect `"allow"`) doldurur; `grant_user_permission` yalnızca `user_id` + verilen `effect`'i doldurur (`effect.value` yazılır); ikisi de `db.add` + `db.flush`, nesneyi döndürür.

- [ ] **Step 4: Testi çalıştır, geçsin** — `pytest tests/test_perm_resolve.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/permissions/service.py homunculus-engine/tests/test_perm_resolve.py
git commit -m "yetki(F0): action_allowed cozumleme ve izin verme yardimcilari"
```

---

### Task 3: `ensure_action_allowed` — 404/403 + denetim kaydı

**Files:**
- Modify: `homunculus-engine/src/homunculus/permissions/service.py`
- Test: `homunculus-engine/tests/test_perm_enforce.py`

**Interfaces:**
- Consumes: `action_allowed` (Task 2); `homunculus.auth.access.ensure_member(db, user, tenant_id)` (üye değilse 404); `homunculus.security_audit.record(db, *, action, user_id, tenant_id, resource_type, resource_id, outcome, detail=None, commit=False)`.
- Produces:
  - `async def ensure_action_allowed(db, user: User, tenant_id: uuid.UUID, action: str, *, resource_type: str, resource_id: object | None = None) -> None`
- Davranış: önce `ensure_member` (üye değil → 404). Sonra `action_allowed`; `False` → `security_audit.record(..., outcome="denied", commit=True)` ve `raise HTTPException(403, detail=f"Bu islem icin yetki yok: {action}")`. `True` → `security_audit.record(..., outcome="allowed")` (flush), `None` döner.

- [ ] **Step 1: Failing testleri yaz** — `tests/test_perm_enforce.py`

```python
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.security_audit import SecurityAuditEvent
from homunculus.permissions.service import ensure_action_allowed, grant_role_permission

async def test_uye_olmayan_404(world):
    u = await world.add_user(world.a, "yabanci", UserRole.NURSE, totp=True)   # A üyesi, B değil
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
        rows = (await s.execute(select(SecurityAuditEvent).where(SecurityAuditEvent.action == "invoice.discount"))).scalars().all()
    assert any(r.outcome == "denied" for r in rows)

async def test_yetkili_gecer_ve_denetim_allowed(world):
    u = await world.add_user(world.a, "hekim", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.ATTENDING, action="lab_order.create", granted_by=u)
        await s.commit()
        await ensure_action_allowed(s, u, world.a.tenant_id, "lab_order.create", resource_type="lab_order")
        await s.commit()
    async with world.maker() as s:
        rows = (await s.execute(select(SecurityAuditEvent).where(SecurityAuditEvent.action == "lab_order.create"))).scalars().all()
    assert any(r.outcome == "allowed" for r in rows)
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `pytest tests/test_perm_enforce.py -v` → FAIL (`cannot import name ensure_action_allowed`).

- [ ] **Step 3: Uygula** — `ensure_action_allowed`'ı Interfaces'teki davranışa göre `service.py`'ye ekle. Deny ve non-member yollarında `detail` yalnızca `{"action": action}` gibi PHI'siz bilgi taşır.

- [ ] **Step 4: Testi çalıştır, geçsin** — `pytest tests/test_perm_enforce.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/permissions/service.py homunculus-engine/tests/test_perm_enforce.py
git commit -m "yetki(F0): ensure_action_allowed 404/403 ve denetim kaydi"
```

---

### Task 4: Admin uçları (izin ver/sil/listele) + create_app bağlama

**Files:**
- Create: `homunculus-engine/src/homunculus/permissions/schemas.py`
- Create: `homunculus-engine/src/homunculus/permissions/router.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`create_app` içinde router'ı dahil et)
- Test: `homunculus-engine/tests/test_perm_router.py`

**Interfaces:**
- Consumes: `grant_role_permission`, `grant_user_permission` (Task 2); `homunculus.auth.dependencies.require_roles`, `homunculus.auth.access.ensure_role_in_tenant`, `homunculus.db.get_db`.
- Produces:
  - Şemalar: `RoleGrantIn{role: UserRole, action: str}`, `UserGrantIn{user_id: uuid.UUID, action: str, effect: PermissionEffect}`, `PermissionGrantOut{id, tenant_id, action, role: UserRole|None, user_id: uuid.UUID|None, effect: str, is_active: bool}` (ORM'den okuma için `model_config = ConfigDict(from_attributes=True)`).
  - `router = APIRouter(prefix="/tenant/tenants/{tenant_id}/permissions", tags=["permissions"])` ve rotalar:
    - `GET  ""` → `list[PermissionGrantOut]` (admin) — `list_permissions(db, tenant_id)` (Task 2'ye küçük bir ekleme: `async def list_permissions(db, tenant_id) -> list[PermissionGrant]`).
    - `POST "/roles"` (RoleGrantIn) → 201, `PermissionGrantOut`.
    - `POST "/users"` (UserGrantIn) → 201, `PermissionGrantOut`.
    - `DELETE "/{grant_id}"` → 204; grant başka tenant'a aitse 404 (`async def revoke_permission(db, *, tenant_id, grant_id)` — bulunamazsa/yabancıysa 404).
  - Admin kapısı (tenant/router.py `_hospital_admin` desenini kopyala): `require_roles(UserRole.HOSPITAL_ADMIN)` + `await ensure_role_in_tenant(db, user, tenant_id, UserRole.HOSPITAL_ADMIN)`.

- [ ] **Step 1: Failing testleri yaz** — `tests/test_perm_router.py`

```python
from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole

async def test_admin_izin_verir_ve_listeler(world):
    admin = await world.add_user(world.a, "yonetici", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        h = await world.token(admin)
        r = await c.post(f"/tenant/tenants/{world.a.tenant_id}/permissions/roles",
                         json={"role": "ATTENDING", "action": "lab_order.create"}, headers=h)
        assert r.status_code == 201
        lst = await c.get(f"/tenant/tenants/{world.a.tenant_id}/permissions", headers=h)
        assert lst.status_code == 200 and any(g["action"] == "lab_order.create" for g in lst.json())

async def test_admin_baska_hastaneye_izin_veremez(world):
    admin = await world.add_user(world.a, "yonetici2", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        r = await c.post(f"/tenant/tenants/{world.b.tenant_id}/permissions/roles",
                         json={"role": "ATTENDING", "action": "lab_order.create"}, headers=await world.token(admin))
    assert r.status_code == 403

async def test_admin_olmayan_izin_veremez(world):
    baci = await world.add_user(world.a, "baci", UserRole.NURSE, totp=True)
    async with world.client() as c:
        r = await c.post(f"/tenant/tenants/{world.a.tenant_id}/permissions/roles",
                         json={"role": "NURSE", "action": "sample.accept"}, headers=await world.token(baci))
    assert r.status_code == 403

async def test_baska_hastaneye_ait_izin_silinemez(world):
    admin_a = await world.add_user(world.a, "yon-a", UserRole.HOSPITAL_ADMIN, totp=True)
    admin_b = await world.add_user(world.b, "yon-b", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        created = await c.post(f"/tenant/tenants/{world.b.tenant_id}/permissions/roles",
                               json={"role": "ATTENDING", "action": "exam.print"}, headers=await world.token(admin_b))
        gid = created.json()["id"]
        r = await c.delete(f"/tenant/tenants/{world.a.tenant_id}/permissions/{gid}", headers=await world.token(admin_a))
    assert r.status_code == 404
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `pytest tests/test_perm_router.py -v` → FAIL (404 route yok / import hatası).

- [ ] **Step 3: Uygula** — `schemas.py` ve `router.py`'yi yaz; `service.py`'ye `list_permissions` ve `revoke_permission`'ı ekle (revoke: grant'ı id ile çek, `tenant_id` eşleşmezse/`None`sa 404, eşleşirse `is_active=False` yap veya sil). `create_app` (api/app.py) içindeki router import/`include_router` bloğuna `from homunculus.permissions.router import router as permissions_router` ve `app.include_router(permissions_router)` ekle.

- [ ] **Step 4: Testi çalıştır, geçsin** — `pytest tests/test_perm_router.py -v` → PASS.

- [ ] **Step 5: Tüm takımı çalıştır** — `pytest` (homunculus-engine/ kökünden) → tüm testler PASS (yeni modül mevcut güvenlik testlerini bozmamalı).

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/permissions/ homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_perm_router.py
git commit -m "yetki(F0): admin izin uclari (ver/sil/listele) ve create_app baglama"
```

---

## Notlar

- Bu plan **sadece arka uç yetki çekirdeğini** kurar. Admin ekranları (ön uç), tek rol listesi/Azerice adlar, gerçek giriş akışının ön uca bağlanması ve hasta kimliği (FİN) alanları **sonraki Faz 0 planlarıdır**.
- Eylem kodları (`lab_order.create`, `exam.print`, `invoice.discount`, `sample.accept` ...) burada örnektir; gerçek eylem kataloğu ilgili modül yapılırken o modülün planında tanımlanır.
- Göç (0006) Postgres'te `alembic upgrade head` ile uygulanır; SQLite güvenlik testleri göçe ihtiyaç duymaz (metadata'dan `create_all`).
