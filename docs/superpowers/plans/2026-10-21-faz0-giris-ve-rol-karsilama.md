# Faz 0.2 — Gerçek Giriş (JWT+MFA) + Rol Bazlı Karşılama — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kullanıcının gerçek arka uca (parola + gerektiğinde telefon kodu) girip rolüne göre bir karşılama ekranı gördüğü, tarayıcıda açılıp çalışan ilk görünür akışı kurmak; test ortamında telefon kodu olmadan hızlı giriş sağlamak.

**Architecture:** Arka uçtaki `/auth` API zaten hazır. (1) Backend'e **test-ortamına özel, canlıda otomatik kapalı** bir MFA-atlama anahtarı eklenir (tek kaynak: `user_needs_mfa`). (2) Giriş yapılacak hesaplar için bir **seed** (tohumlama) fonksiyonu + betiği eklenir. (3) Ön uçta `/auth`'a bağlanan bir **auth taşıma modülü**, gerçek **Giriş + MFA** ekranı ve **rol bazlı karşılama** (JWT `roles` iddiasını çözerek) eklenir; mevcut giriş ekranı deseni ve `clinicalI18n` metinleri yeniden kullanılır. Mevcut Board akışı bozulmaz.

**Tech Stack:** Backend: Python ≥3.12, FastAPI, SQLAlchemy async, pytest+pytest-asyncio, httpx. Frontend: React 18, Vite 6, Vitest 3 + @testing-library/react + jsdom (MSW yok; `vi.fn()`/`vi.stubGlobal` ile ağ taklidi), fetch, `clinicalI18n.js`. Router yok (main.jsx `pickRoot()`).

**Spec:** `docs/superpowers/specs/2026-10-21-hastane-sistemi-yol-haritasi-design.md`

## Global Constraints

- **Test MFA-atlama yalnızca test ortamında.** `HOMUNCULUS_DEV_SKIP_MFA` açık **ve** `ENVIRONMENT != "production"` iken etkindir; `ENVIRONMENT=production` olduğunda bayrak açık olsa bile **MFA zorunlu kalır** (mevcut "üretimde /docs kapalı" guard deseniyle aynı).
- Gerçek/canlı güvenlik zayıflatılmaz; değişiklik tek choke-point'te (`user_needs_mfa`) yapılır.
- Kullanıcıya görünen metinler `clinicalI18n.js` (tr/az/en/ru) üzerinden; yeni metin gerekiyorsa oraya eklenir. Üründe rakip adı geçmez. Varsayılan dil ileride az; bu parçada mevcut davranış korunur.
- PHI yok. JWT istemci tarafında yalnızca **okunur** (imza doğrulaması sunucuda).
- Mevcut Board/demo kökleri (`main.jsx pickRoot`) bozulmaz; yeni akış ayrı bir dalda (`?app=1`) açılır.
- `localStorage` erişimi her zaman try/catch ile sarılır (gizli sekmede çökmez).

## Review Focus

- **Üretimde MFA-atlama etkisiz olmalı:** `ENVIRONMENT=production` + bayrak açık → MFA hâlâ zorunlu. → Task 1 testi `test_prod_da_dev_skip_etkisiz`.
- **Bozuk/süresi geçmiş JWT:** `decodeRoles` çökmemeli, boş rol döndürmeli. → Task 3 testi `decodeRoles bozuk token`.
- **Hatalı giriş (401) / çok deneme (429):** kullanıcı anlaşılır hata görmeli, ekran çökmemeli. → Task 5 testi `hatali giris mesaji`.
- **Çok hastanede rolü olan kullanıcı:** karşılama tüm rolleri gösterebilmeli (tek tenant varsaymamalı). → Task 5 testi `coklu tenant rol`.
- **Oturum deposu yoksa (gizli sekme):** uygulama yine açılmalı. → Task 3'te storage try/catch + testi.

---

### Task 1: Test-ortamına özel MFA-atlama (guard'lı)

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/service.py` (`user_needs_mfa`)
- Modify: `homunculus-engine/src/homunculus/auth/router.py` (login `requires_mfa` tek kaynaktan gelsin)
- Test: `homunculus-engine/tests/test_sec_dev_mfa_skip.py`

**Interfaces:**
- `user_needs_mfa(db, user) -> bool` değişir: önce normal hesaplama; sonra **eğer** `os.getenv("HOMUNCULUS_DEV_SKIP_MFA")` truthy **ve** `os.getenv("ENVIRONMENT") != "production"` ise `False` döndür.
- `POST /auth/login`'in `requires_mfa` alanı `user_needs_mfa(...)` üzerinden hesaplanır (zaten değilse bu tek kaynağa bağlanır), böylece bayrak açıkken login `requires_mfa=false` döner ve `get_current_user` kapısı da geçer.

- [ ] **Step 1: Failing testleri yaz** — `tests/test_sec_dev_mfa_skip.py`

```python
import os
import pytest
from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.auth.service import user_needs_mfa


@pytest.fixture
def _clean_env(monkeypatch):
    monkeypatch.delenv("HOMUNCULUS_DEV_SKIP_MFA", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)


async def test_normalde_mfa_gerekir(world, _clean_env):
    u = await world.add_user(world.a, "hekim", UserRole.ATTENDING, totp=False)
    async with world.maker() as s:
        assert await user_needs_mfa(s, u) is True


async def test_dev_skip_ile_mfa_gerekmez(world, _clean_env, monkeypatch):
    monkeypatch.setenv("HOMUNCULUS_DEV_SKIP_MFA", "1")
    u = await world.add_user(world.a, "hekim2", UserRole.ATTENDING, totp=False)
    async with world.maker() as s:
        assert await user_needs_mfa(s, u) is False


async def test_prod_da_dev_skip_etkisiz(world, _clean_env, monkeypatch):
    monkeypatch.setenv("HOMUNCULUS_DEV_SKIP_MFA", "1")
    monkeypatch.setenv("ENVIRONMENT", "production")
    u = await world.add_user(world.a, "hekim3", UserRole.ATTENDING, totp=False)
    async with world.maker() as s:
        assert await user_needs_mfa(s, u) is True
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `cd homunculus-engine && pytest tests/test_sec_dev_mfa_skip.py -v` → `test_dev_skip_ile_mfa_gerekmez` FAIL (hâlâ True).

- [ ] **Step 3: Uygula** — `user_needs_mfa` sonuna guard'lı atlama ekle (`import os` varsa kullan). `router.py`'de login'in `requires_mfa`'sını `user_needs_mfa` çağrısına bağla (inline hesap varsa). Davranışı değiştiren tek yer burasıdır.

- [ ] **Step 4: Testi çalıştır, geçsin** — `pytest tests/test_sec_dev_mfa_skip.py -v` → PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/service.py homunculus-engine/src/homunculus/auth/router.py homunculus-engine/tests/test_sec_dev_mfa_skip.py
git commit -m "giris(F0): test-ortamina ozel MFA-atlama (uretimde etkisiz)"
```

---

### Task 2: Test hesapları seed'i (tohumlama)

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/seed.py` (test edilebilir fonksiyon)
- Create: `homunculus-engine/scripts/seed_users.py` (CLI sarıcı)
- Test: `homunculus-engine/tests/test_seed_users.py`

**Interfaces:**
- `async def seed_demo_users(db: AsyncSession, *, password: str = "Sinaq-Parol-1!") -> dict` — idempotent. Bir tenant (`slug="sinaq-xestexana"`) yoksa oluşturur; şu rollerden her biri için bir User (totp_enabled=False) + TenantMembership oluşturur, zaten varsa atlar: `HOSPITAL_ADMIN, ATTENDING, CHARGE_NURSE, NURSE, AUDITOR`. E-postalar `rol@sinaq.homunculus.example` biçiminde. Döner: `{"tenant_id": ..., "created": [emails], "existing": [emails]}`. Parola `auth.service.hash_password` ile hashlenir.
- `scripts/seed_users.py`: `DATABASE_URL`'den async engine kurar, `seed_demo_users` çağırır, sonucu yazdırır. (CLI; testte çağrılmaz.)

- [ ] **Step 1: Failing testleri yaz** — `tests/test_seed_users.py`

```python
from sqlalchemy import select, func
from sec_harness import world  # noqa: F401
from homunculus.auth.models import User
from homunculus.auth.seed import seed_demo_users


async def test_seed_kullanicilari_olusturur(world):
    async with world.maker() as s:
        r1 = await seed_demo_users(s)
        await s.commit()
    assert len(r1["created"]) == 5
    async with world.maker() as s:
        n = (await s.execute(select(func.count()).select_from(User).where(
            User.email.like("%@sinaq.homunculus.example")))).scalar_one()
    assert n == 5


async def test_seed_idempotent(world):
    async with world.maker() as s:
        await seed_demo_users(s); await s.commit()
    async with world.maker() as s:
        r2 = await seed_demo_users(s); await s.commit()
    assert r2["created"] == [] and len(r2["existing"]) == 5
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `pytest tests/test_seed_users.py -v` → FAIL (`No module named homunculus.auth.seed`).

- [ ] **Step 3: Uygula** — `seed.py` içinde `seed_demo_users`'ı yaz (varlık kontrolü e-posta ile; tenant'ı `slug` ile bul/oluştur — Tenant alanları için `tenant/models.py`'ye bak: name/slug/country_code/timezone). `scripts/seed_users.py` CLI sarıcısını yaz (engine + session + çağrı + print). Betik modeli metadata'ya kaydetmek için gereken importları `scripts/encrypt_legacy_phi.py` kalıbından al.

- [ ] **Step 4: Testi çalıştır, geçsin** — `pytest tests/test_seed_users.py -v` → PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/seed.py homunculus-engine/scripts/seed_users.py homunculus-engine/tests/test_seed_users.py
git commit -m "giris(F0): test hesaplari seed fonksiyonu ve betigi"
```

---

### Task 3: Ön uç auth taşıma modülü + /auth proxy

**Files:**
- Modify: `dashboard/vite.config.js` (`server.proxy`'ye `/auth` ekle)
- Create: `dashboard/src/authApi.js`
- Test: `dashboard/src/authApi.test.js`

**Interfaces:**
- `async function login(email, password)` → `POST /auth/login` (JSON `{email, password}`) → `{access_token, refresh_token, requires_mfa}`.
- `async function verifyTotp(accessToken, code)` → `POST /auth/totp/verify` (Bearer `accessToken`, JSON `{code}`) → `{access_token, refresh_token, requires_mfa}`.
- `async function me(accessToken)` → `GET /auth/me` (Bearer) → user alanları.
- `function decodeRoles(accessToken) -> object` — JWT payload'ını (ortadaki base64url parça) çözüp `roles` iddiasını (`{tenantId: roleValue}`) döndürür; token bozuk/parçasızsa `{}`.
- `function saveSession(sess)`, `function loadSession() -> sess|null`, `function clearSession()` — `localStorage["homunculus-auth"]`, hepsi try/catch (hata → yoksay / null).
- Tüm `fetch` çağrıları **göreli** yol (api.js stili); test `vi.stubGlobal("fetch", vi.fn())` ile yoklanır.

- [ ] **Step 1: Failing testleri yaz** — `dashboard/src/authApi.test.js`

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, decodeRoles } from "./authApi.js";

function fakeJwt(payload) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

describe("authApi", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("login dogru uca JSON ile POST atar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: "a", refresh_token: "r", requires_mfa: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await login("a@b.c", "parola");
    expect(fetchMock).toHaveBeenCalledWith("/auth/login", expect.objectContaining({ method: "POST" }));
    expect(res.requires_mfa).toBe(false);
  });

  it("decodeRoles JWT roles iddiasini cozer", () => {
    const t = fakeJwt({ roles: { "11111111-1111-1111-1111-111111111111": "ATTENDING" } });
    expect(decodeRoles(t)).toEqual({ "11111111-1111-1111-1111-111111111111": "ATTENDING" });
  });

  it("decodeRoles bozuk token icin bos dondurur", () => {
    expect(decodeRoles("bozuk")).toEqual({});
    expect(decodeRoles(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `cd dashboard && npx vitest run src/authApi.test.js` → FAIL (modül yok).

- [ ] **Step 3: Uygula** — `authApi.js`'i Interfaces'e göre yaz (fetch + JSON + Bearer; `decodeRoles` için `atob` + `JSON.parse`, base64url `-_`→`+/`; try/catch). `vite.config.js` `server.proxy`'ye `"/auth": "http://localhost:8000"` ekle (mevcut girişleri bozmadan).

- [ ] **Step 4: Testi çalıştır, geçsin** — `npx vitest run src/authApi.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/authApi.js dashboard/src/authApi.test.js dashboard/vite.config.js
git commit -m "giris(F0): auth tasima modulu (login/verify/me/decodeRoles) ve /auth proxy"
```

---

### Task 4: Rol eşleme ve bölümler

**Files:**
- Create: `dashboard/src/roleMap.js`
- Test: `dashboard/src/roleMap.test.js`

**Interfaces:**
- `export const ROLE_LABEL: Record<string,string>` — backend `UserRole` değerleri → görünür ad (şimdilik Türkçe; ör. `ATTENDING: "Həkim (Attending)"`, `HOSPITAL_ADMIN: "Admin"`, `NURSE: "Tibb bacısı"`, `CHARGE_NURSE: "Baş tibb bacısı"`, `AUDITOR: "Denetçi"`, + diğer 5 rol). Bilinmeyen rol → rolün kendisi.
- `export function sectionsForRole(role) -> {key, label}[]` — küçük, sabit bir harita: her role o rolün göreceği bölüm kutuları (ör. ATTENDING → [muayene, hastalarım, istemler]; HOSPITAL_ADMIN → [kullanıcılar, yetkiler, bölümler]; NURSE/CHARGE_NURSE → [hastalarım, numune]; AUDITOR → [denetim-kaydı]). Bilinmeyen rol → `[]`.

- [ ] **Step 1: Failing testleri yaz** — `dashboard/src/roleMap.test.js`

```js
import { describe, it, expect } from "vitest";
import { ROLE_LABEL, sectionsForRole } from "./roleMap.js";

describe("roleMap", () => {
  it("backend rolunu gorunur ada cevirir", () => {
    expect(ROLE_LABEL.HOSPITAL_ADMIN).toBeTruthy();
    expect(ROLE_LABEL.ATTENDING).toBeTruthy();
  });
  it("admin yetki/kullanici bolumlerini gorur", () => {
    const keys = sectionsForRole("HOSPITAL_ADMIN").map((s) => s.key);
    expect(keys).toContain("yetkiler");
  });
  it("bilinmeyen rol bos bolum dondurur", () => {
    expect(sectionsForRole("YOK")).toEqual([]);
  });
});
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `npx vitest run src/roleMap.test.js` → FAIL (modül yok).
- [ ] **Step 3: Uygula** — `roleMap.js`'i yaz (iki sabit harita + iki erişimci).
- [ ] **Step 4: Testi çalıştır, geçsin** — PASS.
- [ ] **Step 5: Commit**

```bash
git add dashboard/src/roleMap.js dashboard/src/roleMap.test.js
git commit -m "giris(F0): backend rol -> gorunur ad ve bolum esleme"
```

---

### Task 5: Giriş + MFA + rol bazlı karşılama ekranı

**Files:**
- Create: `dashboard/src/AppAuth.jsx`
- Test: `dashboard/src/AppAuth.test.jsx`

**Interfaces:**
- `export default function AppAuth({ auth = realAuthClient })` — `auth` enjekte edilebilir (testte mock). `auth` arayüzü: `login(email,password)`, `verifyTotp(token,code)`, `decodeRoles(token)`, `saveSession/loadSession/clearSession` (Task 3'ten; testte `vi.fn()`).
- Faz durumu: `"login" | "mfa" | "home"`. Akış: login → `requires_mfa` ise `"mfa"` (MfaGate deseni: 6 haneli kod → `verifyTotp`) değilse `"home"`. `"home"`: `decodeRoles(access_token)` ile roller; her tenant-rol için `ROLE_LABEL` + `sectionsForRole` kutularını ve **Çıkış** düğmesini gösterir. Çıkış → `clearSession` + `"login"`.
- Hata: `login`/`verifyTotp` reddederse kırmızı hata kutusu (mevcut `Login`'deki `err` deseni). Metinler `clinicalI18n.js` (`S.loginTitle`, `S.email`, `S.signIn`, `S.pr11.mfa*`, `S.roleName.*`) üzerinden.
- `data-testid`: `app-login`, `app-mfa`, `app-home`, `app-error`, `app-logout`.

- [ ] **Step 1: Failing testleri yaz** — `dashboard/src/AppAuth.test.jsx`

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AppAuth from "./AppAuth.jsx";

const ROLES = { "t1": "HOSPITAL_ADMIN" };
function mockAuth(over = {}) {
  return {
    login: vi.fn().mockResolvedValue({ access_token: "a", refresh_token: "r", requires_mfa: false }),
    verifyTotp: vi.fn().mockResolvedValue({ access_token: "a2", refresh_token: "r2", requires_mfa: false }),
    decodeRoles: vi.fn().mockReturnValue(ROLES),
    saveSession: vi.fn(), loadSession: vi.fn().mockReturnValue(null), clearSession: vi.fn(),
    ...over,
  };
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/e-?mail|e-posta|e-poçt/i), { target: { value: "a@b.c" } });
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: "p" } });
  fireEvent.submit(document.querySelector("form"));
}

describe("AppAuth", () => {
  it("basarili giris -> karsilama, rol gorunur", async () => {
    render(<AppAuth auth={mockAuth()} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByTestId("app-home")).toBeInTheDocument());
  });

  it("hatali giris -> hata mesaji, cokmez", async () => {
    const auth = mockAuth({ login: vi.fn().mockRejectedValue(new Error("E-posta veya parola yanlış")) });
    render(<AppAuth auth={auth} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByTestId("app-error")).toHaveTextContent(/yanlış/i));
  });

  it("requires_mfa -> mfa adimi -> dogrula -> karsilama", async () => {
    const auth = mockAuth({ login: vi.fn().mockResolvedValue({ access_token: "a", refresh_token: "r", requires_mfa: true }) });
    render(<AppAuth auth={auth} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByTestId("app-mfa")).toBeInTheDocument());
    fireEvent.change(document.querySelector('input[inputmode="numeric"]'), { target: { value: "123456" } });
    fireEvent.submit(screen.getByTestId("app-mfa").querySelector("form"));
    await waitFor(() => expect(screen.getByTestId("app-home")).toBeInTheDocument());
    expect(auth.verifyTotp).toHaveBeenCalled();
  });

  it("coklu tenant rol -> hepsi listelenir", async () => {
    const auth = mockAuth({ decodeRoles: vi.fn().mockReturnValue({ t1: "HOSPITAL_ADMIN", t2: "NURSE" }) });
    render(<AppAuth auth={auth} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByTestId("app-home")).toBeInTheDocument());
    expect(screen.getByTestId("app-home").textContent).toMatch(/Admin/);
    expect(screen.getByTestId("app-home").textContent).toMatch(/bacı/i);
  });

  it("cikis -> giris ekranina doner", async () => {
    const auth = mockAuth();
    render(<AppAuth auth={auth} />);
    await fillAndSubmit();
    await waitFor(() => screen.getByTestId("app-home"));
    fireEvent.click(screen.getByTestId("app-logout"));
    await waitFor(() => expect(screen.getByTestId("app-login")).toBeInTheDocument());
    expect(auth.clearSession).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `npx vitest run src/AppAuth.test.jsx` → FAIL (modül yok).
- [ ] **Step 3: Uygula** — `AppAuth.jsx`'i Interfaces'e göre yaz. Giriş/MFA görünümü için `ClinicalDemo.jsx`'teki `Login`/`MfaGate` desenini (alanlar, hata kutusu, `clinicalI18n`) örnek al; karşılamada `decodeRoles` + `ROLE_LABEL` + `sectionsForRole`. Idiomatik React; sadece testlerin ve Interfaces'in belirlediği kadar.
- [ ] **Step 4: Testi çalıştır, geçsin** — `npx vitest run src/AppAuth.test.jsx` → PASS (5/5).
- [ ] **Step 5: Commit**

```bash
git add dashboard/src/AppAuth.jsx dashboard/src/AppAuth.test.jsx
git commit -m "giris(F0): gercek giris + MFA + rol bazli karsilama ekrani"
```

---

### Task 6: main.jsx'e bağla + yerel çalıştırma

**Files:**
- Modify: `dashboard/src/main.jsx` (`pickRoot()`'a `?app=1` dalı)
- Test: `dashboard/src/mainRoot.test.jsx` (yalnızca seçim mantığı)

**Interfaces:**
- `pickRoot()` dışa aktarılır (test edilebilirlik için) **veya** seçim mantığı `chooseRoot(search, hash)` saf fonksiyonuna çıkarılır ve test edilir. `?app=1` → `<AppAuth/>`; mevcut dallar (`?demo`, `?mode=replay`, default Board) aynen korunur.

- [ ] **Step 1: Failing test yaz** — `dashboard/src/mainRoot.test.jsx`

```jsx
import { describe, it, expect } from "vitest";
import { chooseRoot } from "./main.jsx";

describe("chooseRoot", () => {
  it("?app=1 icin app anahtari doner", () => {
    expect(chooseRoot("?app=1", "")).toBe("app");
  });
  it("app yoksa varsayilan board", () => {
    expect(chooseRoot("", "")).toBe("board");
  });
});
```

- [ ] **Step 2: Testi çalıştır, hata ver** — `npx vitest run src/mainRoot.test.jsx` → FAIL.
- [ ] **Step 3: Uygula** — `main.jsx`'te seçim mantığını `export function chooseRoot(search, hash)` saf fonksiyonuna çıkar (string anahtar döndürür: `"app"|"demo"|"replay"|"board"`), `pickRoot()` bunu kullanıp bileşeni seçsin. `?app=1` → AppAuth. Board'ın `VITE_BOARD_TOKEN` guard'ı yalnızca board seçildiğinde çalışsın (app seçiliyken token gereksiz).
- [ ] **Step 4: Testi çalıştır, geçsin** — PASS. Ardından tüm ön uç takımı: `cd dashboard && npm test` → hepsi yeşil.
- [ ] **Step 5: Commit**

```bash
git add dashboard/src/main.jsx dashboard/src/mainRoot.test.jsx
git commit -m "giris(F0): ?app=1 ile gercek giris ekranini kok olarak bagla"
```

- [ ] **Step 6: Yerel çalıştırma ve gör (manuel doğrulama)** — Komutlar (Docker varsa):
  1. `cd homunculus-engine && docker compose up -d` (Postgres)
  2. `alembic upgrade head`
  3. `python scripts/seed_users.py` (test hesapları)
  4. `HOMUNCULUS_API_TOKEN=yerel-test-anahtari-0123456789 HOMUNCULUS_DEV_SKIP_MFA=1 python -m uvicorn homunculus.api.devserver:app --port 8000`
  5. `cd dashboard && npm run dev` → tarayıcıda `http://localhost:5173/?app=1`
  6. `admin@sinaq.homunculus.example` / seed parolası ile giriş → rol bazlı karşılama görünür.
  Docker/uvicorn yoksa bu adım ledger'a "ortam kısıtı" notuyla yazılır; komutlar sahibe verilir.

---

## Notlar

- Bu parça **görünür ilk akışı** (giriş + rol karşılama) verir. Tam klinik kabuk (muayene, istem ekranları), tek rol listesi/Azerice adların kesinleşmesi, hasta kimliği (FİN) ve admin ekranının ön yüzü **sonraki parçalardır**.
- `HOMUNCULUS_DEV_SKIP_MFA` yalnızca yerel/test içindir; üretim dağıtımında `ENVIRONMENT=production` olduğundan otomatik etkisizdir.
- Backend `UserRole` ↔ ön uç görünür ad eşlemesi `roleMap.js`'tedir; yeni roller eklendikçe oraya eklenir.
