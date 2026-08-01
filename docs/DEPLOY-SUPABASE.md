# Gerçek sistemi canlıya alma — Supabase (DB) + Render (backend) + Vercel (frontend)

> **Not:** Public **demo** (`?demo=1` → ClinicalDemo) tamamen tarayıcı-içidir ve buna İHTİYAÇ DUYMAZ.
> Bu runbook, **gerçek sistem** (login/MFA, çok-kiracı, kalıcı Postgres) içindir. Yalnızca **sentetik
> veya de-identifiye veri** — gerçek PHI, InfoSec/BAA/SaMD yönetişimi kurulana kadar DB'ye girmez.

```
Frontend → Vercel        (push → otomatik build/deploy)
Backend  → Render         (push → otomatik build + `alembic upgrade head` + restart)
Database → Supabase Postgres (kalıcı; şema push'ta migration ile güncellenir)
```

Backend'in mevcut durumu (arkadaşın kurmuş): `db.py` async SQLAlchemy + `DATABASE_URL` env'den okur
(asyncpg sürücüsü); Alembic async-aware, **3 migration** var; `docker-compose.yml` yerel Postgres için.

---

## Adım 1 — Supabase projesi + bağlantı string'i (senin aksiyonun)

1. [supabase.com](https://supabase.com) → GitHub ile giriş → **New project**.
   - **Name:** `homunculus` · **Database Password:** güçlü bir parola belirle (kaydet) · **Region:** sana yakın (ör. Frankfurt).
2. Proje açılınca → **Project Settings → Database → Connection string**.
   - **Session pooler** (kalıcı sunucu = Render için doğru olan) sekmesindeki URI'yi al. Şu forma benzer:
     `postgresql://postgres.[REF]:[PAROLA]@aws-0-[region].pooler.supabase.com:5432/postgres`
3. Bunu **asyncpg** formatına çevir (backend asyncpg kullanıyor): baştaki `postgresql://` → `postgresql+asyncpg://`.
   Sonuç `DATABASE_URL` şu olur:
   `postgresql+asyncpg://postgres.[REF]:[PAROLA]@aws-0-[region].pooler.supabase.com:5432/postgres`

> **Supabase + asyncpg tuzağı (SSL):** Supabase SSL ister. asyncpg, psycopg'nin `?sslmode=require`'ını
> ANLAMAZ. İki seçenek: (a) URL'ye hiçbir sslmode ekleme; `db.py`'de `create_async_engine(..., connect_args={"ssl": True})`
> yap. (b) Ya da `?ssl=require` dene. Bu, aşağıdaki "repo değişiklikleri"nde hallolacak.
> Ayrıca **pgbouncer/pooler** kullanırken `prepared_statement_cache_size=0` gerekebilir (asyncpg + pooler).

---

## Adım 2 — Repo değişiklikleri (ben bir dalda hazırlarım)

Backend canlıya çıkmadan önce repoda 4 küçük ekleme gerekiyor (hepsi additive, mevcut demoyu bozmaz):

1. **Üretim ASGI girişi** — `devserver.py` yalnızca dev (tek kiracı, `dev-token`). Prod için env'den kiracı
   token'larını + secret'ları okuyan bir giriş (`homunculus.api.prodserver:app`).
2. **CORS** — FastAPI'ye `CORSMiddleware`, Vercel alan adına izin (`CORS_ORIGINS` env'den).
3. **asyncpg SSL/pooler** — `db.py`'de Supabase pooler için `connect_args` (SSL + prepared-statement cache off).
4. **`render.yaml`** — Render'ın repodan otomatik kurması için:
   ```yaml
   services:
     - type: web
       name: homunculus-api
       runtime: python
       rootDir: homunculus-engine
       buildCommand: pip install -e .
       startCommand: alembic upgrade head && uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port $PORT
       envVars:
         - key: DATABASE_URL
           sync: false          # panodan girilir (Supabase URI)
         - key: JWT_SECRET
           generateValue: true
         - key: CORS_ORIGINS
           sync: false          # https://homunculus-ai.vercel.app
   ```

> Bunları senin onayınla `feat/deploy-supabase` dalında hazırlarım (arkadaşın main'ini bozmadan),
> sen/arkadaşın gözden geçirip merge edersiniz.

---

## Adım 3 — Render'a backend'i bağla (senin aksiyonun)

1. [render.com](https://render.com) → GitHub ile giriş → **New → Blueprint** → `asbadef/Homunculus-AI`'yi seç
   (repoda `render.yaml` olduğu için Render her şeyi okur). Ya da **New → Web Service** → repo → root `homunculus-engine`.
2. **Environment** sekmesinde secret'ları gir:
   - `DATABASE_URL` = Adım 1'deki Supabase asyncpg URI'si.
   - `JWT_SECRET` = uzun rastgele string (Render "generate" edebilir).
   - `CORS_ORIGINS` = `https://homunculus-ai.vercel.app` (Vercel canlı adresin).
3. **Deploy.** İlk deploy'da `alembic upgrade head` çalışıp **Supabase'e 3 tabloyu/migration'ı kurar**
   (Supabase → **Table Editor**'da tabloları görürsün). Sana bir backend URL'i verir:
   `https://homunculus-api.onrender.com`.

> Ücretsiz kademede servis boşta uyur (~30 sn soğuk başlangıç). Always-on için ~$7/ay.

---

## Adım 4 — Frontend'i backend'e bağla (Vercel env)

1. Vercel → Proje → **Settings → Environment Variables** → ekle:
   - `VITE_API_URL` = `https://homunculus-api.onrender.com`
2. `api.js` bu değişkeni taban URL olarak kullanacak (repo değişikliği #— küçük, ben eklerim).
3. Vercel → **Redeploy** (env değişince yeni build gerekir).

---

## Bundan sonra "her push otomatik"

- Arkadaşın **main'e merge/commit** → **Vercel** frontend'i + **Render** backend'i (+ `alembic upgrade head`
  ile **Supabase şeması**) otomatik günceller.
- **Veri silinmez** — Supabase kalıcı; sadece şema migration'la değişir.

## Secret checklist (git'e ASLA konmaz)
- [ ] `DATABASE_URL` (Supabase) → Render env
- [ ] `JWT_SECRET` → Render env
- [ ] `CORS_ORIGINS` → Render env
- [ ] `VITE_API_URL` → Vercel env
