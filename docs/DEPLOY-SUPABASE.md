# Gerçek sistemi canlıya alma — Supabase (DB) + Render (backend) + Vercel (frontend)

> **Not:** Public **demo** (`?demo=1` → ClinicalDemo) tamamen tarayıcı-içidir ve buna İHTİYAÇ DUYMAZ.
> Bu runbook, **gerçek sistem** (`?live=1` → gerçek login/MFA, kalıcı Postgres) içindir. Yalnızca
> **sentetik veya de-identifiye veri** — gerçek PHI, InfoSec/BAA/SaMD yönetişimi kurulana kadar girmez.

```
Frontend → Vercel        (push → otomatik build/deploy)
Backend  → Render         (push → build + alembic upgrade head + seed + restart)
Database → Supabase Postgres (kalıcı; şema push'ta migration ile güncellenir)
```

## Yerelde doğrulanmış olanlar

Aşağıdakiler gerçek Postgres'e karşı çalıştırılıp doğrulandı (docker compose):

- `alembic upgrade head` → **17 tablo** kuruluyor
- `scripts/seed_admin.py` → ilk kurum + 11 varsayılan grup + ilk yönetici, **`hospital_admin`**
  (Sistem Yöneticisi) grubunda (idempotent; parola yoksa **atlar**, hata vermez; yeni yönetici için
  parola 12 karakterden kısa ya da `change-me` gibi bilinen bir örnekse yöneticiyi **oluşturmaz**
  ve nedenini log'a yazar)
- Gerçek HTTP: `POST /auth/login` → JWT · `GET /auth/me` → kullanıcı · yanlış parola → **401**
- Frontend `liveStore` → gerçek backend → `{username, email, full_name, groups: [hospital_admin], perms: [...]}`
  (`hospital_admin` MFA ister: ilk girişte panel doğrulayıcı için QR gösterir)
- Test paketi: **306 backend / 190 frontend** yeşil

> ℹ️ **RBAC dalı (`feat/ldap-rbac`), B1 — düzeltildi (2026-09-26):** migration 0010 artık
> `tenant_memberships.role` sütununu `varchar(40)` yapıyor; seed ve `POST /admin/users` gerçek
> migration'dan geçmiş veritabanında çalışıyor (`tests/test_migration_0010_orm_writes.py`). Deploy
> sırası ve kontroller: `docs/superpowers/plans/2026-09-23-rbac-groups-permissions.md`, Task 20
> "Deploy notes for the VM".

---

## ✅ Supabase'de HAZIR olanlar (MCP ile yapıldı, 2026-08-03)

Proje: **Homunculus-AI** (`tfilvvlfhnxzgaqkxwaj`), eu-central-1, Postgres 17.6 — `ACTIVE_HEALTHY`.

- **17 tablo kuruldu.** Alembic'in kendi offline SQL'i uygulandı, `alembic_version` = **0003 (head)**
  → Render'daki `alembic upgrade head` **no-op** olacak, çakışma yok.
- **RLS 17/17 tabloda açık, 0 politika.** Bu kasıtlı: bu uygulama PostgREST'i (`/rest/v1/`) hiç
  kullanmaz; backend Postgres'e **tablo sahibi** olarak doğrudan bağlanır ve sahip RLS'i baypas eder.
  Politikasız RLS → **anon/publishable anahtar her şeyden tamamen bloke**, backend etkilenmez.
  (`FORCE ROW LEVEL SECURITY` **eklenmedi** — o, sahibi de kısıtlardı.)
- Kalan tek uyarı INFO seviyesinde "RLS enabled, no policy" — yukarıdaki nedenle beklenen durum.

> ⚠️ **Publishable/anon anahtarını yenile (rotate).** Anon anahtar tasarımı gereği herkese açıktır;
> RLS açılmadan önce paylaşılmış bir anahtar varsa Supabase panelinden değiştir.

**Geriye kalan tek şey:** Render'ı bağlayıp `DATABASE_URL` + seed parolasını girmek (Adım 1-2).

---

## Adım 1 — Supabase bağlantı string'i (senin aksiyonun)

1. Supabase → **Project Settings → Database → Connection string → "Session pooler"** sekmesi.
   (Pooler; Render gibi kalıcı sunucular için doğru olan bu.)
2. URI'nin başındaki `postgresql://` → **`postgresql+asyncpg://`** yap (backend asyncpg kullanıyor):

   ```
   postgresql+asyncpg://postgres.<ref>:<PAROLA>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

3. Bunu **Render'ın env'ine** yazacaksın. **Parolayı hiçbir yere commit etme, sohbete yapıştırma.**

> **SSL/pooler:** `DATABASE_SSL=require` verildiğinde kod asyncpg'ye TLS + `statement_cache_size=0`
> (pgbouncer uyumu) geçirir. URL'ye `sslmode=` **ekleme** — asyncpg onu anlamaz.

## Adım 2 — Render'a backend (senin aksiyonun)

1. [render.com](https://render.com) → **New → Blueprint** → `asbadef/Homunculus-AI` → branch
   **`feat/deploy-supabase`** (önce dalda dene; çalışınca main'e merge).
2. `render.yaml` okunur. Env'leri gir:

   | Anahtar | Değer |
   |---|---|
   | `DATABASE_URL` | Adım 1'deki asyncpg URI |
   | `DATABASE_SSL` | `require` (zaten varsayılan) |
   | `CORS_ORIGINS` | `https://homunculus-ai.vercel.app` |
   | `TENANTS` | `<openssl rand -base64 36 çıktısı>:demo-hastanesi` — köprünün cihaz token'ı ve kurum slug'ı (aşağıdaki nota bak) |
   | `SEED_ADMIN_EMAIL` | ör. `admin@hastane.com.tr` — yöneticinin hem kullanıcı adı hem e-postası olur |
   | `SEED_ADMIN_PASSWORD` | güçlü parola, **en az 12 karakter**, `change-me` gibi bir örnek değil (**ilk deploy'dan sonra sil**) |
   | `PHI_ENCRYPTION_KEY` | Fernet anahtarı: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — **bir kez üret, yedeklerle birlikte sakla**; yoksa API başlamaz |
   | `JWT_SECRET` | Render otomatik üretir |

   > **`TENANTS`:** `:`'dan sonraki kısım kurumun **slug'ı** olmalı — seed `demo-hastanesi`
   > oluşturur. `HOSP1` gibi başka bir anahtar hiçbir klinisyenin panosuyla eşleşmez; veriler gelir
   > ama pano boş kalır. Token'ı `openssl rand -base64 36` ile üret, repoda duran `demo-token`'ı
   > kullanma. `TENANTS` boş ya da geçersizse API başlamayı reddeder.

3. **Deploy.** Başlangıç komutu sırayla: `alembic upgrade head` → `seed_admin.py` → `uvicorn`.
   Supabase → **Table Editor**'da 17 tabloyu ve `users` içinde admini görmelisin.
4. Doğrula: `https://<servis>.onrender.com/health` → `{"status":"ok"}`
   ve login:
   ```
   curl -X POST https://<servis>.onrender.com/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@hastane.com.tr","password":"<parola>"}'
   ```
   Yanıtta `requires_mfa: true` beklenir: `hospital_admin` grubu MFA ister. Doğrulayıcı kurulumu
   panelden (`?live=1`) ilk girişte yapılır; kod girilene kadar API klinik rotalara 403 verir.
5. **İlk başarılı deploy'dan sonra `SEED_ADMIN_PASSWORD`'ü Render env'inden sil.** Seed onsuz
   sessizce atlar, restart'lar sorunsuz devam eder.

> Ücretsiz kademede servis boştayken uyur (~30 sn ilk yanıt). Always-on ≈ $7/ay.

## Adım 3 — Frontend'i backend'e bağla (Vercel)

1. Vercel → **Settings → Environment Variables** → `VITE_API_URL` = `https://<servis>.onrender.com`
2. **Redeploy** (env değişikliği yeni build ister).
3. Gerçek sistem: `https://homunculus-ai.vercel.app/?live=1` → login ekranı **gerçek** backend'e gider.
   Public demo (`/?demo=1`) değişmeden çalışmaya devam eder.

## Bundan sonra

`main`'e her push → **Vercel** frontend'i, **Render** backend'i + **Supabase şemasını** (migration)
otomatik günceller. Veri silinmez; sadece şema ilerler.

---

## ⚠️ Testleri ASLA canlı DB'ye yöneltme

`tests/conftest.py`'deki fixture **tüm tabloları DROP eder**. `TEST_DATABASE_URL`'i Supabase'e
yöneltmek **canlı veritabanını siler**. Bu yüzden conftest artık veritabanı adında `test` geçmiyorsa
çalışmayı reddediyor. Yerelde:

```
docker compose up -d                       # homunculus-engine/ içinde
# uygulama DB'si:  .../homunculus
# test DB'si:      .../homunculus_test     <-- testler yalnızca buna
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:5432/homunculus_test \
  .venv/Scripts/python.exe -m pytest -q
```

## Secret checklist (git'e ASLA konmaz)
- [ ] `DATABASE_URL` (Supabase) → Render env
- [ ] `JWT_SECRET` → Render env (otomatik üretilir)
- [ ] `CORS_ORIGINS` → Render env
- [ ] `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` → Render env (parolayı sonra sil)
- [ ] `PHI_ENCRYPTION_KEY` → Render env (bir kopyası yedeklerle birlikte)
- [ ] `VITE_API_URL` → Vercel env
