# Tur 0 — Sunucu güncelleme altyapısı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VM'deki (172.100.101.72) Homunculus'u — API, veritabanı göçleri ve web — `asbadef/main` ile aynı sürüme, yedekli ve geri dönülebilir biçimde getirmek; sonraki turların yayınını tek komuta indirmek.

**Architecture:** VM'deki `/opt/homunculus` git deposu `331df70`'tan `asbadef/main`'e ileri sarılır (fast-forward; 331df70 main'in atası). `docker compose build api web` + `up -d api web`: API açılışta `alembic upgrade head` çalıştırır (0020–0022). Önce `pg_dump` yedeği ve imaj etiketleri. Köprü (bridge) ve postgres konteynerine dokunulmaz.

**Tech Stack:** bash, git, docker compose, PostgreSQL 16 (`pg_dump`/`psql`), PowerShell (yerel).

**Spec:** `docs/superpowers/specs/2026-11-14-prototip-tam-tasima-design.md`

## Global Constraints

- Her sunucu yüklemesinden önce veritabanının tam yedeği: `/opt/homunculus/yedek/db-<YYYYmmdd-HHMM>.sql.gz`.
- Köprü (`homunculus-bridge`) ve `homunculus-postgres` konteynerleri yeniden başlatılmaz.
- Tur 0 sonunda kullanıcının gördüğü hiçbir şey değişmez: tanınmayan numaralı monitör okumaları bugünkü gibi panoda kart açar (`READINGS_UNKNOWN_KEY=card`, `.env`'de). Yeni davranışa geçiş ayrı karar.
- Asaf'ın bıraktığı `.env*.bak` ve izlenmeyen dosyalara dokunulmaz.

## Review Focus

- Göç yarıda kalırsa API açılmaz → yedekten dönüş adımı çalışmalı (Task 3, geri dönüş betiği kuru çalıştırılır).
- İleri sarma, VM'de elle değiştirilmiş izlenen bir dosya varsa durmalı (Task 2 ön kontrol).
- Monitör verisi akışı (köprü → API) güncellemeden sonra sürmeli: "x/13 veri gönderiyor" etiketi ve kart değerleri (Task 3 doğrulama).
- Oturum açık kullanıcılar güncellemeden sonra yeniden giriş istemeyebilir/isteyebilir — giriş ve pano yüklenmesi doğrulanır.
- `.env`'e eklenen ayar `docker compose up -d api` ile okunur (restart değil).

---

### Task 1: Veritabanı yedek ve geri dönüş betikleri

**Files:**
- Create: `.claude/vm/yedek-al.sh` — `pg_dump` → gzip, `local-web`/`local-api` imajlarını `yedek-<ts>` etiketler, git HEAD'i `yedek/head-<ts>.txt`'ye yazar; çıktının son satırı yedek dosyasının yolu.
- Create: `.claude/vm/geri-don.sh <ts>` — `head-<ts>.txt`'deki commit'e döner, `yedek-<ts>` imajlarını `latest` yapar, DB'yi dump'tan geri yükler (`--kuru` bayrağıyla yalnız ne yapacağını yazar).

- [ ] **Step 1:** `yedek-al.sh`'ı VM'e kopyala, çalıştır. Beklenen: `gunzip -t <dosya>` hatasız, boyut > 100 KB, `docker image ls | grep yedek-<ts>` iki satır.
- [ ] **Step 2:** `geri-don.sh <ts> --kuru` çalıştır. Beklenen: üç işlemi (git, imaj, db) yazar, hiçbirini yapmaz.
- [ ] **Step 3:** Commit `chore(vm): yedek ve geri dönüş betikleri`.

### Task 2: Ön kontrol

- [ ] **Step 1:** VM'de `git status --porcelain` (izlenen dosya değişikliği yok olmalı; yalnız `??` satırları), `git fetch origin main`, `git merge-base --is-ancestor HEAD origin/main` → 0.
- [ ] **Step 2:** `.env`'e `READINGS_UNKNOWN_KEY=card` yoksa ekle (yedeğini `.env.bak-tur0` olarak al).

### Task 3: Güncelleme ve doğrulama

- [ ] **Step 1:** `git merge --ff-only origin/main`.
- [ ] **Step 2:** `BUILD_SHA=$(git rev-parse --short HEAD) docker compose build api web` → `Built` iki satır.
- [ ] **Step 3:** `docker compose up -d --no-deps api web`; `docker logs homunculus-api` içinde `Running upgrade` 0020, 0021, 0022; `docker ps` api `healthy`.
- [ ] **Step 4:** Doğrula: `alembic current` = 0022 başı; web 200; sahibin oturumuyla `#/beds`, `#/alarms`, `#/gorevler`, `#/doluluk`, `#/kabul`, `#/devir` açılır, sayfa hatası 0; panoda "veri gönderiyor" etiketi ve monitör değerleri görünür; bridge konteyneri `Up` süresi değişmemiş.
- [ ] **Step 5:** Başarısızlıkta: `geri-don.sh <ts>` (kuru değil) ve sahibe bildir.

### Task 4: Tek komutlu yayın

**Files:**
- Modify: `.claude/vm-yayin.ps1` — artık yama yok: (1) yerelde testler geçmiş ve `asbadef/main`'e gönderilmiş olmalı, (2) VM'de `yedek-al.sh`, (3) `git merge --ff-only origin/main`, (4) değişen yola göre `build`/`up -d` (`dashboard/` → web, `homunculus-engine/` → api).
- Delete: `.claude/vm-yayin.sh` (yama yöntemi).

- [ ] **Step 1:** Betiği yaz; `-Kuru` bayrağıyla çalıştır → hangi servislerin derleneceğini yazar.
- [ ] **Step 2:** Commit `chore(yayin): VM yayını git ile — yama yöntemi kalktı`.

### Task 5: Notlar ve teslim

**Files:**
- Create: `docs/planlar/degisiklik-notlari.md` — Tur 0 girişi (ne güncellendi, yedek yolu, `READINGS_UNKNOWN_KEY=card` kararı ve nedeni).

- [ ] **Step 1:** Notu yaz, plan dosyasındaki durum tablosunu güncelle, `asbadef/main`'e gönder.
- [ ] **Step 2:** Sahibe kontrol listesi: girişi yap, Yataklar/Alarmlar/Görevlerim/Doluluk/Hasta Kabul/Devir'i aç, monitör değerleri ve alarm sayıları önceki gibi mi.
