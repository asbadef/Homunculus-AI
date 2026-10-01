# Tasarım entegrasyonu · yol haritası ve Grup 1 uygulama planı

> Koordinasyon belgesi. Ayrıntılı TDD planları her dalga için ayrı dosyada yazılır
> (`docs/superpowers/plans/2026-10-01-g1-*.md`). Durum tablosu iş ilerledikçe güncellenir.

**Kaynak tasarım:** `origin/tasarim/prototip` (`8bebc67`, 01.10.2026) · `tasarim-taslaklari/app/`
(arka ucu olmayan, saf JS prototip: 26 ekran, 8 rol + 2 ek görev, 39 sayfa/sekme izni, 4 dil).
**Hedef:** canlı sistem (React `dashboard/` + FastAPI `homunculus-engine/`), LDAP ile birlikte.
**Kural:** prototipteki ekran, arka ucu olmadan canlıya çıkmaz; çıkan her kontrol gerçekten yazar.

---

## Beş grup

| Grup | Kapsam | Arka uç |
|---|---|---|
| **1** | Canlı ekranlar yeni tasarımda + LDAP Plan 2 · tek deploy | Var (LDAP hariç) |
| **2** | ICU vital diyagramları (önce) + hazır uçların ekranları: yapı/doluluk, birim kapsamı, devir, kabul/transfer/taburcu, denetim, alarm ertele/eskale | Kısmen (vital geçmişi ucu yok) |
| **3** | Klinik iş akışları: Görevlerim, formlar, yatak başı ölçüm, bakım planı, ilaç, sıvı, sonuçlar, belgeler, eczane, RRT | Yok |
| **4** | Yönetim/operasyon: yönetici özeti, kalite, enfeksiyon, pilot, iş yükü, cihaz bakımı, kamera, Y1–Y7, bildirim kuralları, bakım kataloğu | Yok |
| **5** | Tanıtım sayfası + mobil (tasarımcının yereldeki Expo commit'leri önce GitHub'a) | — |

**Grup 2 vital diyagramlarında eşik kuralı:** bant/eşik yalnız üç kaynaktan gelir: cihazın
kendi alarm limiti (Infinity kaydı), NEWS2 bantları (kasa), hekimin girdiği hastaya özel normal.
Prototipteki sabit sayılar (`core.js:499` `H.VITAL.al/nb`) kaynaksızdır, taşınmaz.

---

## İncelemede çıkan engeller (Grup 1'i şekillendirir)

1. **`feat/ldap-rbac` main'in 25 commit gerisinde.** Taban `cfbba2a` (05.09). Main'de Infinity,
   kapsam matrisi, duvar monitörü, RRT, ısı haritası, Sistem ayarları var. `git merge-tree`:
   9 dosya çakışıyor (`ClinicalDemo.jsx`, `backendApi.js`, `liveAuth.js`, `liveStore.js`,
   `api/app.py`, `api/prodserver.py`, `api/rehydrate.py`, `auth/models.py`,
   `tests/test_audit_postgres.py`).
2. **Göç zinciri çatallanıyor.** Main: `0006_identity_diagnoses → 0007_pharmacist_biomedical_roles
   → 0008_audit_chain → 0009_staff_scope`. LDAP dalı: `0006_groups_and_permissions` (down 0005).
   LDAP göçü `0010` olur (down `0009`) ve 0007'nin rollerini de dönüştürür.
3. **Main'in kapsam modülü rol tabanlı.** `scope/rules.py` `SCOPE_UNRESTRICTED_ROLES`,
   `scope/router.py` `require_roles(UserRole.HOSPITAL_ADMIN)` — LDAP dalında ikisi de yok.
   İzinlere çevrilir.
4. **nginx `/admin`'i iletmiyor** (`deploy/local/web/nginx.conf:36`). VM'de personel sekmesi
   çalışmaz. `/scope`, `/tenant`, `/admissions`, `/handovers`, `/shift-schedule`,
   `/break-glass`, `/infinity-research` de eksik.
5. **Birim ataması zaten var:** main'de `staff_scopes` tablosu + `/scope/*` + sunucuda
   uygulanan filtre. Tasarımın "rol AD'den, birim uygulamada" kararı bununla karşılanır.

---

## Kararlar

| # | Soru | Durum | Seçim |
|---|---|---|---|
| D0 | AD kullanıcısı nasıl açılır? | ✅ LDAP spec'i (23.09) | Yönetici AD'den içe aktarır; otomatik hesap yok |
| D1 | Eski simülasyon demosu (`?demo=1`) | ✅ 01.10 | **Kaldırılır.** Yeni kabuk canlı store'u demo store'a dayanmadan kurar; `ClinicalDemo.jsx`, `clinicalDemo.js`, `?mode=replay`, `?board=1` Grup 1 sonunda silinir (G1-16). Vercel'deki genel demo da kalkar (yayından kaldırma kullanıcının işi) |
| D2 | Varsayılan dil | ✅ 01.10 | **Azerbaycanca**; kullanıcı TR/RU/EN seçebilir, seçim tarayıcıda saklanır |
| D3 | Kullanıcı formu | ✅ 01.10 | **Rol + Ek görev + Birimler.** Rol = tek grup; ek görev = `charge_nurse`, `rapid_response`; birimler = `staff_scopes`. Arkada çoklu grup modeli değişmez; özel gruplar "Diğer gruplar" altında |
| D4 | Giriş akışı | ✅ 01.10 | **Giriş + 2FA + ilk girişte şifre değiştirme + kilit ekranı.** "Şifremi unuttum" = "BT birimine başvurun" (SMS/e-posta yok) |
| D5 | Kapsamsız (unrestricted) kim? | Mühendislik kararı | `hospital_admin` üyesi + platform operatörü (bugünkü rollerin aynısı); matrisi `users.manage` yönetir |

**D1'in sonucu:** main'de demo kabuğunun içinde gelen ve canlıda çalışan ekranlar (duvar monitörü,
RRT, ısı haritası, Sistem ayarları, kapsam atama) G1-02'de envanterlenir. Kapsam atama Grup 1'de
(G1-12) yeni kabuğa geçer; duvar monitörü, ısı haritası ve RRT Grup 2'ye (vital diyagramları) yazılır.

---

## Grup 1 · iş listesi

Puan ≈ yarım gün/3 puan. Toplam **82 puan ≈ 11–13 iş günü** (alt ajanlı yürütme, inceleme dahil).
Her dalganın ayrıntılı planı, bir önceki dalga bitince birleşmiş koda bakılarak yazılır.
Çalışma yeri: `feat/ldap-rbac`'tan açılan `feat/canli-tasarim` dalı, ayrı worktree
(`C:/tmp/homunculus-g1`) — ana ağaçtaki commit'lenmemiş `main.jsx`/`vite.config.js` düzenlemelerine
dokunulmaz.

| # | İş | Puan | Risk | Bağımlı | Durum |
|---|---|---|---|---|---|
| G1-01 | nginx: eksik API yolları + yapılandırma testi | 1 | Düşük | — | Bekliyor |
| G1-02 | main → LDAP birleştirme: 9 çakışma, göç `0010`, `clinical.chart` + `scores.sign` izinleri, kapsam izinlere, `infinity_research` `devices.manage`, demo kabuğu LDAP sürümü; bütün testler yeşil · plan: [dalga 0](2026-10-01-g1-dalga0-main-ldap-birlestirme.md) | 13 | **Yüksek** | G1-01 | Bekliyor |
| G1-03 | LDAP arka ucu · dizin modülü + AD girişi + yenilemede dizin kontrolü (spec §7, §4) | 5 | Orta | G1-02 | Bekliyor |
| G1-04 | LDAP arka ucu · `/admin/ldap/*` içe aktarma, grup eşlemesi, yerel yönetici koruması | 5 | Orta | G1-03 | Bekliyor |
| G1-05 | Tasarım temeli: Gece/Gün renk değişkenleri, fontlar (yerel paket), ikonlar, temel bileşenler — `dashboard/src/live/` | 5 | Düşük | G1-02 | Bekliyor |
| G1-06 | Dört dil çatısı (anahtarlı sözlük, D2 varsayılanı) | 3 | Düşük | G1-05 | Bekliyor |
| G1-07 | Kabuk: sol menü (izinle), üst çubuk (birim çipi, saat, nöbet bitimine, dil, tema, zil, kişi menüsü); canlı mod yeni kabuğa | 5 | Orta | G1-05, G1-06 | Bekliyor |
| G1-08 | Giriş + 2FA + (D4'e göre) ilk girişte şifre, kilit ekranı | 5 | Orta | G1-07 | Bekliyor |
| G1-09 | Yataklar: kart/liste, risk sırası, dikkat kartları, birim filtresi, kapsam açıklaması | 5 | Orta | G1-07 | Bekliyor |
| G1-10 | Alarmlar: yanıt bekliyor / değerlendiriliyor / kapanan, Gördüm, eskalasyon hapları, sunucu saatiyle süre | 3 | Düşük | G1-07 | Bekliyor |
| G1-11 | Hasta ekranı · Özet: başlık, vital çubuğu, öneri kartı (gerekçe + kaynak), salt okunur | 5 | Orta | G1-09 | Bekliyor |
| G1-12 | Yönetim · Kullanıcılar (D3) + birimler (kapsam matrisi) | 5 | Orta | G1-07 | Bekliyor |
| G1-13 | Yönetim · Roller ve yetkiler (grup × izin matrisi) | 3 | Düşük | G1-12 | Bekliyor |
| G1-14 | Yönetim · Sistem ayarları › Giriş kaynağı (AD durumu, bağlantı testi, ara + içe aktar, grup eşlemesi) | 5 | Orta | G1-04, G1-12 | Bekliyor |
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, replay, legacy board, `?demo` PWA başlangıcı) | 3 | Orta | G1-09…G1-14 | Bekliyor |
| G1-15 | Uçtan uca doğrulama (yerel yığın, 4 dil, 390 px/1440 px) + VM deploy notları | 3 | Orta | hepsi | Bekliyor |

> G1-15'teki VM deploy kullanıcının kararıdır: yedek → göç `0010` → herkes bir kez yeniden girer.

### Dalgalar

| Dalga | İşler | Paralel mi |
|---|---|---|
| 0 | G1-01 → G1-02 | Sıralı (her şey buna dayanır) |
| 1 | G1-03 → G1-04 ‖ G1-05 → G1-06 | İki kol paralel (arka uç / ön yüz) |
| 2 | G1-07 → G1-08 | Sıralı |
| 3 | G1-09 → G1-11 ‖ G1-10 ‖ G1-12 → G1-13 | Üç kol paralel |
| 4 | G1-14 → G1-16 → G1-15 | Sıralı |

### Hastaneden gerekenler (G1-03'ü bekletmez, G1-15'i bekletir)

1. LDAPS adresi (`ldaps://…:636`) ve CA sertifikası
2. Salt okunur servis hesabı (bind DN + şifre)
3. Arama kökü (base DN)
4. Rol karşılığı AD grupları (ör. YB-Hekim, YB-Hemşire)
5. VM'den etki alanı denetleyicisine 636 portu açık mı
